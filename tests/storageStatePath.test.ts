import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveStorageStatePath } from '../src/executors/web/playwrightExecutor';

describe('resolveStorageStatePath', () => {
  const baseDir = '/workflows/auth';

  it('returns absolute string paths unchanged', () => {
    expect(resolveStorageStatePath('/abs/auth.json', baseDir)).toBe('/abs/auth.json');
  });

  it('resolves relative string paths against the provided base dir', () => {
    expect(resolveStorageStatePath('./auth.json', baseDir)).toBe(path.resolve(baseDir, './auth.json'));
  });

  it('resolves bare relative paths against the provided base dir', () => {
    expect(resolveStorageStatePath('auth.json', baseDir)).toBe(path.resolve(baseDir, 'auth.json'));
  });

  it('resolves parent-relative paths against the provided base dir', () => {
    expect(resolveStorageStatePath('../shared/auth.json', baseDir)).toBe(
      path.resolve(baseDir, '../shared/auth.json'),
    );
  });

  it('passes through inline {cookies, origins} objects by reference', () => {
    const inline = { cookies: [], origins: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveStorageStatePath(inline as any, baseDir)).toBe(inline);
  });

  it('returns undefined for undefined input', () => {
    expect(resolveStorageStatePath(undefined, baseDir)).toBeUndefined();
  });
});
