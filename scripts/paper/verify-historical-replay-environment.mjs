// Read-only identity preflight. Never imports a producer or reads scientific inputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAN = 'paper/evidence/historical-replay-environment-2026-09-09/identity-plan.json';
export const PLAN_SHA256 = '8c18f86b5119bfb340c28ce5e6aa3d21f6a1d47210b7b053ff20d01a9e6a2eef';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, expected) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unexpected identity-plan fields');
};
function allowed(relative) {
  assert.ok(typeof relative === 'string' && relative.split('/').every(p => p && p !== '.' && p !== '..'));
  assert.match(relative, /^(?:package(?:-lock)?\.json|scripts\/[a-zA-Z0-9_/-]+\.mjs|node_modules\/immunum\/(?:package\.json|immunum\.js|immunum_bg\.wasm))$/u, 'Outside source/dependency-only inventory');
}
async function directBytes(root, relative, maximumBytes) {
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await lstat(current);
    assert.ok(!stat.isSymbolicLink(), 'Symlinked identity path');
    if (index < parts.length - 1) assert.ok(stat.isDirectory(), 'Non-directory identity ancestor');
    else assert.ok(stat.isFile() && stat.size <= maximumBytes, 'Non-file or oversized identity artifact');
  }
  assert.equal(await realpath(current), current, 'Identity path escaped workspace');
  const bytes = await readFile(current);
  assert.ok(bytes.length <= maximumBytes, 'Oversized identity artifact');
  return bytes;
}

/** Supplied plans are not authenticated here. The CLI pins its plan separately. */
export async function verifyEnvironmentIdentity({ workspace, plan, environment = process.env } = {}) {
  assert.ok(!environment.NODE_OPTIONS && !environment.NODE_PATH, 'Ambient Node injection must be absent');
  plan = structuredClone(plan);
  keys(plan, ['schemaVersion', 'sourceCommit', 'producer', 'files']);
  assert.equal(plan.schemaVersion, '1.0.0');
  assert.match(plan.sourceCommit, /^[a-f0-9]{40}$/u);
  allowed(plan.producer);
  assert.ok(plan.producer.startsWith('scripts/'));
  assert.ok(Array.isArray(plan.files) && plan.files.length >= 6 && plan.files.length <= 100);
  const seen = new Set();
  for (const row of plan.files) {
    keys(row, ['path', 'bytes', 'sha256']);
    allowed(row.path);
    assert.ok(!seen.has(row.path), 'Duplicate identity artifact');
    seen.add(row.path);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 32 * 1024 * 1024);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
  }
  for (const required of ['package.json', 'package-lock.json', plan.producer, 'node_modules/immunum/package.json', 'node_modules/immunum/immunum.js', 'node_modules/immunum/immunum_bg.wasm']) {
    assert.ok(seen.has(required), `Missing identity binding: ${required}`);
  }
  const root = path.resolve(workspace);
  assert.equal(await realpath(root), root, 'Workspace has symlinked ancestors');
  const checked = [];
  // Complete root manifest/lock must pass before inspecting source or module bytes.
  const ordered = [...plan.files].sort((a, b) => Number(!a.path.startsWith('package')) - Number(!b.path.startsWith('package')));
  for (const row of ordered) {
    const bytes = await directBytes(root, row.path, row.bytes);
    assert.equal(bytes.length, row.bytes, `Byte count drift: ${row.path}`);
    assert.equal(sha(bytes), row.sha256, `Digest drift: ${row.path}`);
    checked.push(row.path);
  }
  const expected = path.join(root, 'node_modules/immunum/immunum.js');
  const resolved = createRequire(pathToFileURL(path.join(root, plan.producer))).resolve('immunum');
  assert.equal(resolved, expected, 'Producer module resolution differs from verified dependency');
  assert.equal(await realpath(resolved), expected, 'Resolved module escaped workspace');
  return {
    schemaVersion: '1.0.0', status: 'BOUNDED_ENVIRONMENT_IDENTITIES_VERIFIED',
    sourceCommitClaim: plan.sourceCommit, checkedFileCount: checked.length,
    dependencyResolvedInsideWorkspace: true,
    producerExecuted: false, scientificInputsRead: false,
    completeDependencyGraphVerified: false, runtimeEquivalenceEstablished: false,
    securityIsolationEstablished: false, historicalReplayPassed: false,
    integrationAuthorized: false, frozenEngineEstablished: false,
    independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false,
  };
}

export async function verifyPinnedEnvironment(workspace) {
  const bytes = await readFile(path.join(ROOT, PLAN));
  assert.equal(sha(bytes), PLAN_SHA256, 'Pinned environment plan digest drifted');
  const plan = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return verifyEnvironmentIdentity({ workspace, plan });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node verify-historical-replay-environment.mjs WORKSPACE');
  console.log(JSON.stringify(await verifyPinnedEnvironment(process.argv[2]), null, 2));
}
