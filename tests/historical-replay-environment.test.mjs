import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PLAN_SHA256, verifyEnvironmentIdentity } from '../scripts/paper/verify-historical-replay-environment.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'confovhh-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const producer = 'scripts/historical/producer.mjs';
  const values = {
    'package.json': '{"type":"module"}\n', 'package-lock.json': '{"lockfileVersion":3}\n',
    [producer]: 'throw new Error("Producer must never execute");\n',
    'node_modules/immunum/package.json': '{"name":"immunum","main":"immunum.js"}\n',
    'node_modules/immunum/immunum.js': 'throw new Error("Module must never execute");\n',
    'node_modules/immunum/immunum_bg.wasm': 'synthetic, not executable wasm\n',
  };
  const files = [];
  for (const [p, value] of Object.entries(values)) {
    await mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await writeFile(path.join(root, p), value);
    files.push({ path: p, bytes: Buffer.byteLength(value), sha256: digest(value) });
  }
  return { workspace: root, environment: {}, plan: { schemaVersion: '1.0.0', sourceCommit: 'a'.repeat(40), producer, files } };
}
test('identity-only preflight authenticates bytes and local resolution without executing source or module', async t => {
  const f = await fixture(t); const result = await verifyEnvironmentIdentity(f);
  assert.equal(result.checkedFileCount, 6);
  assert.equal(result.dependencyResolvedInsideWorkspace, true);
  for (const k of ['producerExecuted', 'scientificInputsRead', 'completeDependencyGraphVerified', 'runtimeEquivalenceEstablished', 'securityIsolationEstablished', 'historicalReplayPassed', 'integrationAuthorized', 'frozenEngineEstablished', 'predictiveAccuracyMeasured']) assert.equal(result[k], false);
  assert.equal(result.independentEligibleGroupsAdded, 0);
});
test('complete root lock change rejects before any module inspection', async t => {
  const f = await fixture(t); await writeFile(path.join(f.workspace, 'package-lock.json'), '{"lockfileVersion":4}\n');
  await rm(path.join(f.workspace, 'node_modules'), { recursive: true });
  await assert.rejects(verifyEnvironmentIdentity(f), /Digest drift: package-lock.json/);
});
test('source and dependency mutation reject even when lengths remain equal', async t => {
  for (const p of ['scripts/historical/producer.mjs', 'node_modules/immunum/immunum.js', 'node_modules/immunum/immunum_bg.wasm']) {
    const f = await fixture(t); const file = path.join(f.workspace, p); const bytes = await readFile(file); bytes[0] ^= 1; await writeFile(file, bytes);
    await assert.rejects(verifyEnvironmentIdentity(f), /Digest drift/);
  }
});
test('missing, duplicate, traversing and scientific-input paths are rejected at plan validation', async t => {
  for (const mutate of [
    p => p.files.pop(), p => p.files.push(p.files[0]),
    p => { p.files[0].path = '../package.json'; },
    p => { p.files[0].path = 'validation/prediction.json'; },
    p => { p.files[0].bytes = Infinity; },
    p => { p.extra = true; },
  ]) { const f = await fixture(t); mutate(f.plan); await assert.rejects(verifyEnvironmentIdentity(f)); }
});
test('symlinked dependency directories are rejected even with identical bytes', async t => {
  const f = await fixture(t); const external = await fixture(t);
  await rm(path.join(f.workspace, 'node_modules'), { recursive: true });
  await symlink(path.join(external.workspace, 'node_modules'), path.join(f.workspace, 'node_modules'));
  await assert.rejects(verifyEnvironmentIdentity(f), /Symlinked identity path/);
});
test('nested module shadow cannot substitute for the checked root dependency', async t => {
  const f = await fixture(t); const nested = path.join(f.workspace, 'scripts/historical/node_modules/immunum');
  await mkdir(nested, { recursive: true }); await writeFile(path.join(nested, 'package.json'), '{"main":"immunum.js"}'); await writeFile(path.join(nested, 'immunum.js'), '');
  await assert.rejects(verifyEnvironmentIdentity(f), /module resolution differs/);
});
test('ambient module hooks and search paths reject', async t => {
  for (const environment of [{ NODE_OPTIONS: '--import=hook.mjs' }, { NODE_PATH: '/other/modules' }]) {
    const f = await fixture(t); await assert.rejects(verifyEnvironmentIdentity({ ...f, environment }), /Ambient Node injection/);
  }
});
test('caller cannot replace the identity plan while filesystem checks await', async t => {
  const f = await fixture(t);
  const pending = verifyEnvironmentIdentity(f);
  f.plan.files.length = 0;
  f.plan.producer = 'scripts/unverified.mjs';
  const result = await pending;
  assert.equal(result.checkedFileCount, 6);
  assert.equal(result.producerExecuted, false);
});
test('pinned plan binds historical complete lock, source identity and all three package files', async () => {
  const bytes = await readFile(new URL('../paper/evidence/historical-replay-environment-2026-09-09/identity-plan.json', import.meta.url));
  assert.equal(digest(bytes), PLAN_SHA256); const p = JSON.parse(bytes);
  assert.equal(p.sourceCommit, 'b19cae064f621f97fb460da0d401fba7aa140f1a');
  assert.equal(p.files.find(f => f.path === 'package-lock.json').sha256, '0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54');
  assert.equal(p.files.length, 9);
});
