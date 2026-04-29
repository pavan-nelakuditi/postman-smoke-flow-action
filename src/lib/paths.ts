import path from 'node:path';

import { ValidationError } from './errors.js';

export function assertPathWithinCwd(targetPath: string, fieldName: string): string {
  const base = path.resolve('.');
  const resolved = path.resolve(base, targetPath);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ValidationError(`${fieldName} must stay within the repository root; received ${targetPath}`);
  }
  return resolved;
}
