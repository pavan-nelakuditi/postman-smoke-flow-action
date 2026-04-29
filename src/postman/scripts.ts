import type { FlowBinding, FlowExtract, FlowStep } from '../types.js';

function quote(value: string): string {
  return JSON.stringify(value);
}

export function countAssertionsForStep(step: FlowStep): number {
  return 3 + step.extract.length;
}

function createJsonPathResolverPrelude(): string[] {
  return [
    "function resolveJsonPath(root, jsonPath) {",
    "  if (!jsonPath || !jsonPath.startsWith('$.')) return undefined;",
    "  const segments = jsonPath.slice(2).replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean);",
    "  let cursor = root;",
    "  for (const segment of segments) {",
    "    if (cursor === null || cursor === undefined) return undefined;",
    "    cursor = cursor[segment];",
    "  }",
    "  return cursor;",
    "}"
  ];
}

export function buildPreRequestScript(step: FlowStep): string[] {
  const lines = [
    `// [Smoke Flow] Auto-generated prerequest script for ${step.operationId}`
  ];

  for (const binding of step.bindings) {
    if (binding.source === 'prior_output' && binding.variable) {
      lines.push(`pm.collectionVariables.set(${quote(binding.fieldKey)}, pm.collectionVariables.get(${quote(binding.variable)}) || '');`);
      continue;
    }
    if (binding.source === 'literal') {
      lines.push(`pm.collectionVariables.set(${quote(binding.fieldKey)}, ${quote(binding.value ?? '')});`);
    }
  }

  if (step.bindings.length === 0) {
    lines.push('// No explicit prerequest bindings were defined for this step.');
  }

  return lines;
}

export function buildTestScript(step: FlowStep): string[] {
  const lines = [
    `// [Smoke Flow] Auto-generated test script for ${step.operationId}`,
    '',
    "pm.test('Status code is successful (2xx)', function () {",
    '  pm.response.to.be.success;',
    '});',
    '',
    "pm.test('Response time is acceptable', function () {",
    "  const threshold = parseInt(pm.environment.get('RESPONSE_TIME_THRESHOLD') || '2000', 10);",
    '  pm.expect(pm.response.responseTime).to.be.below(threshold);',
    '});',
    '',
    "pm.test('Response body is not empty', function () {",
    '  if (pm.response.code !== 204) {',
    '    pm.expect(pm.response.text().length).to.be.above(0);',
    '  }',
    '});',
    ''
  ];

  if (step.extract.length > 0) {
    lines.push(...createJsonPathResolverPrelude(), '', 'let jsonBody;', 'try {', '  jsonBody = pm.response.json();', '} catch {', '  jsonBody = undefined;', '}');
    for (const extract of step.extract) {
      lines.push(
        '',
        `pm.test(${quote(`Extract ${extract.variable}`)}, function () {`,
        `  const value = resolveJsonPath(jsonBody, ${quote(extract.jsonPath)});`,
        "  pm.expect(value, 'expected extracted value to exist').to.not.be.undefined;",
        `  pm.collectionVariables.set(${quote(extract.variable)}, typeof value === 'string' ? value : JSON.stringify(value));`,
        '});'
      );
    }
  }

  return lines;
}

export function createTestEvent(step: FlowStep): Record<string, unknown> {
  return {
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: buildTestScript(step)
    }
  };
}

export function createPreRequestEvent(step: FlowStep): Record<string, unknown> {
  return {
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: buildPreRequestScript(step)
    }
  };
}

export function createSecretsResolverItem(): Record<string, unknown> {
  return {
    name: '00 - Resolve Secrets',
    request: {
      auth: {
        type: 'awsv4',
        awsv4: [
          { key: 'accessKey', value: '{{AWS_ACCESS_KEY_ID}}' },
          { key: 'secretKey', value: '{{AWS_SECRET_ACCESS_KEY}}' },
          { key: 'region', value: '{{AWS_REGION}}' },
          { key: 'service', value: 'secretsmanager' }
        ]
      },
      method: 'POST',
      header: [
        { key: 'X-Amz-Target', value: 'secretsmanager.GetSecretValue' },
        { key: 'Content-Type', value: 'application/x-amz-json-1.1' }
      ],
      body: {
        mode: 'raw',
        raw: '{"SecretId": "{{AWS_SECRET_NAME}}"}'
      },
      url: {
        raw: 'https://secretsmanager.{{AWS_REGION}}.amazonaws.com',
        protocol: 'https',
        host: ['secretsmanager', '{{AWS_REGION}}', 'amazonaws', 'com']
      }
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            'if (pm.environment.get("CI") === "true") { return; }',
            'const body = pm.response.json();',
            'if (body.SecretString) {',
            '  const secrets = JSON.parse(body.SecretString);',
            '  Object.entries(secrets).forEach(([k, v]) => pm.collectionVariables.set(k, v));',
            '}'
          ]
        }
      }
    ]
  };
}
