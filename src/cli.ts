import { summarizeError } from './lib/logging.js';
import { readActionInputs, runAction } from './index.js';
import type { CoreLike } from './types.js';

function applyArgsToEnv(argv: string[], env: NodeJS.ProcessEnv): void {
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--')) {
      continue;
    }
    const inputName = key.slice(2);
    env[`INPUT_${inputName.replace(/-/g, '_').toUpperCase()}`] = value ?? '';
  }
}

const outputs: Record<string, string> = {};

const cliCore: CoreLike = {
  setOutput(name, value) {
    outputs[name] = value;
  },
  info(message) {
    console.error(message);
  },
  warning(message) {
    console.error(`warning: ${message}`);
  },
  setFailed(message) {
    console.error(`error: ${message}`);
  }
};

async function main(): Promise<void> {
  const env = { ...process.env };
  applyArgsToEnv(process.argv, env);
  readActionInputs(env);
  await runAction(cliCore, env);
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}

main().catch((error) => {
  console.error(summarizeError(error));
  process.exitCode = 1;
});
