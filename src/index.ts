import core from '@actions/core';

import { openAlphaActionContract } from './contracts.js';
import { loadFlowManifest } from './flow/parser.js';
import { resolveFlowRequests } from './flow/resolver.js';
import { validateFlowManifest } from './flow/validator.js';
import { summarizeError } from './lib/logging.js';
import type { ActionInputs, ActionOutputs, CoreLike, FlowApplySummary } from './types.js';
import { buildCuratedSmokeCollection } from './postman/collection-transform.js';
import { PostmanSmokeClient } from './postman/postman-smoke-client.js';

type SmokeFlowDependencies = {
  core: CoreLike;
  postman: Pick<PostmanSmokeClient, 'generateCollection' | 'getCollection' | 'updateCollection' | 'deleteCollection'>;
};

function parseBooleanInput(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getInput(name: string, env: NodeJS.ProcessEnv): string {
  const envName = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
  return String(env[envName] ?? '').trim();
}

export function readActionInputs(env: NodeJS.ProcessEnv = process.env): ActionInputs {
  return {
    projectName: getInput('project-name', env),
    workspaceId: getInput('workspace-id', env),
    specId: getInput('spec-id', env),
    smokeCollectionId: getInput('smoke-collection-id', env),
    flowPath: getInput('flow-path', env),
    postmanApiKey: getInput('postman-api-key', env),
    specPath: getInput('spec-path', env) || undefined,
    collectionSyncMode: (getInput('collection-sync-mode', env) || 'refresh') as 'refresh' | 'version',
    postmanAccessToken: getInput('postman-access-token', env) || undefined,
    failOnFlowWarning: parseBooleanInput(getInput('fail-on-flow-warning', env), false),
    keepTempCollectionOnFailure: parseBooleanInput(getInput('keep-temp-collection-on-failure', env), false),
    tempCollectionPrefix: getInput('temp-collection-prefix', env) || '[Smoke][Temp]'
  };
}

function ensureRequiredInputs(inputs: ActionInputs): void {
  for (const [name, details] of Object.entries(openAlphaActionContract.inputs)) {
    if (details.required) {
      const camel = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      const value = inputs[camel as keyof ActionInputs];
      if (!value) {
        throw new Error(`Missing required input: ${name}`);
      }
    }
  }
}

function createOutputs(summary: FlowApplySummary): ActionOutputs {
  return {
    'smoke-collection-id': summary.canonicalSmokeCollectionId,
    'flow-apply-status': summary.status,
    'flow-apply-summary-json': JSON.stringify(summary),
    'temporary-smoke-collection-id': summary.temporaryCollectionId ?? '',
    'flow-step-count': String(summary.stepCount),
    'resolved-operation-count': String(summary.resolvedOperationCount),
    'applied-binding-count': String(summary.appliedBindingCount),
    'applied-extract-count': String(summary.appliedExtractCount),
    'assertion-count': String(summary.assertionCount)
  };
}

export async function runSmokeFlow(
  inputs: ActionInputs,
  dependencies: SmokeFlowDependencies
): Promise<ActionOutputs> {
  ensureRequiredInputs(inputs);

  const manifest = loadFlowManifest(inputs.flowPath);
  const { flow, warnings } = validateFlowManifest(manifest);
  const flowName = flow.name;
  warnings.forEach((warning) => dependencies.core.warning(warning.message));
  if (warnings.length > 0 && inputs.failOnFlowWarning) {
    throw new Error(`Flow validation produced ${warnings.length} warning(s) and fail-on-flow-warning=true.`);
  }

  let tempCollectionId = '';
  let tempCollectionDeleted = false;
  let runFailed = false;
  try {
    tempCollectionId = await dependencies.postman.generateCollection(inputs.specId, inputs.projectName, inputs.tempCollectionPrefix);
    dependencies.core.info(`Generated temporary Smoke collection ${tempCollectionId}`);

    const generatedCollection = await dependencies.postman.getCollection(tempCollectionId);
    const resolvedRequests = resolveFlowRequests(flow, generatedCollection);
    const transformed = buildCuratedSmokeCollection(generatedCollection, flow, resolvedRequests);
    await dependencies.postman.updateCollection(inputs.smokeCollectionId, transformed.collection);
    dependencies.core.info(`Updated canonical Smoke collection ${inputs.smokeCollectionId} from curated flow.`);

    const summary: FlowApplySummary = {
      flowName: flow.name,
      status: 'success',
      temporaryCollectionId: tempCollectionId,
      canonicalSmokeCollectionId: inputs.smokeCollectionId,
      stepCount: flow.steps.length,
      resolvedOperationCount: resolvedRequests.length,
      appliedBindingCount: transformed.bindingCount,
      appliedExtractCount: transformed.extractCount,
      assertionCount: transformed.assertionCount,
      warnings: warnings.map((warning) => warning.message)
    };

    return createOutputs(summary);
  } catch (error) {
    runFailed = true;
    const summary: FlowApplySummary = {
      flowName,
      status: 'failed',
      temporaryCollectionId: tempCollectionId || undefined,
      canonicalSmokeCollectionId: inputs.smokeCollectionId,
      stepCount: 0,
      resolvedOperationCount: 0,
      appliedBindingCount: 0,
      appliedExtractCount: 0,
      assertionCount: 0,
      warnings: [...warnings.map((warning) => warning.message), summarizeError(error)]
    };
    if (tempCollectionId && !inputs.keepTempCollectionOnFailure) {
      try {
        await dependencies.postman.deleteCollection(tempCollectionId);
        tempCollectionDeleted = true;
      } catch (cleanupError) {
        dependencies.core.warning(`Failed to delete temporary Smoke collection ${tempCollectionId}: ${summarizeError(cleanupError)}`);
      }
    }
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      summary
    });
  } finally {
    const shouldDeleteInFinally =
      tempCollectionId &&
      !tempCollectionDeleted &&
      !(runFailed && inputs.keepTempCollectionOnFailure);
    if (shouldDeleteInFinally) {
      try {
        await dependencies.postman.deleteCollection(tempCollectionId);
        dependencies.core.info(`Deleted temporary Smoke collection ${tempCollectionId}`);
      } catch (cleanupError) {
        if (!inputs.keepTempCollectionOnFailure) {
          dependencies.core.warning(`Failed to delete temporary Smoke collection ${tempCollectionId}: ${summarizeError(cleanupError)}`);
        }
      }
    }
  }
}

export async function runAction(actionCore: CoreLike = core, env: NodeJS.ProcessEnv = process.env): Promise<ActionOutputs> {
  const inputs = readActionInputs(env);
  const postman = new PostmanSmokeClient(inputs.postmanApiKey);
  const outputs = await runSmokeFlow(inputs, {
    core: actionCore,
    postman
  });
  for (const [name, value] of Object.entries(outputs)) {
    actionCore.setOutput(name, value);
  }
  return outputs;
}
