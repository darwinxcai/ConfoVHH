import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('official DockQ adapter rejects invalid inputs and preserves partial failure evidence', () => {
  const file = fileURLToPath(new URL('./gpcr-paper-dockq.test.py', import.meta.url));
  // These tests use only the Python standard library and fake DockQ responses.
  // Isolate user packages and disable bytecode writes in the repository.
  const result = spawnSync('python3', ['-I', '-B', file], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
