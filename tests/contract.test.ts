import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type ActionManifest = {
  name: string;
  description: string;
  inputs: Record<string, { required?: boolean; default?: string }>;
  outputs: Record<string, { description?: string }>;
};

function loadManifest(): ActionManifest {
  return parse(readFileSync(path.join(repoRoot, 'action.yml'), 'utf8')) as ActionManifest;
}

describe('postman-smoke-flow-action contract', () => {
  it('uses the expected action name and required inputs', () => {
    const manifest = loadManifest();
    expect(manifest.name).toBe('postman-smoke-flow-action');
    expect(manifest.inputs['flow-path']?.required).toBe(true);
    expect(manifest.inputs['smoke-collection-id']?.required).toBe(true);
  });

  it('defines the expected primary outputs', () => {
    const manifest = loadManifest();
    expect(Object.keys(manifest.outputs)).toEqual([
      'smoke-collection-id',
      'flow-apply-status',
      'flow-apply-summary-json',
      'temporary-smoke-collection-id',
      'flow-step-count',
      'resolved-operation-count',
      'applied-binding-count',
      'applied-extract-count',
      'assertion-count'
    ]);
  });
});
