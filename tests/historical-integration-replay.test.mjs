import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStrictJson } from '../scripts/hard-decoy/oracle/canonical-json.mjs';
import {
  INTEGRATION_PLAN_SHA256, historicalIntegrationArguments, integrationReplayEnvironment,
  runHistoricalIntegrationReplay, validateHistoricalIntegrationResult,
  validateIntegrationTap, verifyIntegrationIdentity,
} from '../scripts/paper/run-historical-integration-replay.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLAN = path.join(ROOT, 'paper/historical-integration-replay-plan-2026-09-09.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const importer = 'scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs';
const fixtureBase = 'validation/hard-decoy-holdout-v3/design-record';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'integration-replay-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rows = [
    ['package.json', 'manifest', '{"type":"module"}\n'],
    ['package-lock.json', 'manifest', '{"lockfileVersion":3}\n'],
    [importer, 'source', '// Synthetic identity only; never executed.\n'],
    ['node_modules/immunum/package.json', 'dependency', '{"main":"immunum.js"}\n'],
    ['node_modules/immunum/immunum.js', 'dependency', 'module.exports = {};\n'],
    ['node_modules/immunum/immunum_bg.wasm', 'dependency', 'synthetic-wasm-identity\n'],
    [`${fixtureBase}/control.json`, 'metadata-input', '{"synthetic":true,"executionAuthorized":false}\n'],
  ];
  const files = [];
  for (const [relative, role, text] of rows) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
    const bytes = Buffer.from(text); files.push({ path: relative, role, bytes: bytes.length, sha256: sha(bytes) });
  }
  return { root, plan: { schemaVersion: '1.0.0', sourceCommit: 'a'.repeat(40), files,
    exactInventories: { [fixtureBase]: ['control.json'] } } };
}

test('integration recipes expose only the unchanged verifier and complete original test file', () => {
  assert.deepEqual(historicalIntegrationArguments('integration-verifier', '24.19.0'), ['scripts/hard-decoy-v3/verify-integration-state.mjs']);
  assert.deepEqual(historicalIntegrationArguments('integration-tests', '24.19.0'), ['--test', '--test-reporter=tap', '--test-concurrency=1', '--', 'tests/hard-decoy-v3-integration-state.test.mjs']);
  assert.equal(historicalIntegrationArguments('integration-verifier', '22.23.2')[0], '--no-turbo-inline-js-wasm-calls');
  assert.equal(historicalIntegrationArguments('integration-tests', '22.23.3')[0], '--test');
  for (const recipe of ['__proto__', '--test-name-pattern=skip', 'collect', '../other.mjs']) assert.throws(() => historicalIntegrationArguments(recipe, '24.19.0'));
});

test('integration children exclude ambient Node hooks, credentials, proxies and inherited test context', () => {
  const env = integrationReplayEnvironment({ PATH: '/synthetic/bin', TMPDIR: '/synthetic/tmp', NODE_OPTIONS: '--require=evil', NODE_PATH: '/evil', NODE_TEST_CONTEXT: 'child-v8', GH_TOKEN: 'synthetic-secret', HTTPS_PROXY: 'synthetic-proxy' });
  assert.deepEqual(env, { PATH: '/synthetic/bin', TMPDIR: '/synthetic/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', NO_COLOR: '1' });
});

test('integration result requires the exact historical accounting and blocked scientific authority', async () => {
  const { expectedResult } = JSON.parse(await readFile(PLAN));
  assert.deepEqual(validateHistoricalIntegrationResult(expectedResult), expectedResult);
  assert.deepEqual(validateHistoricalIntegrationResult(parseStrictJson(JSON.stringify(expectedResult))), expectedResult);
  for (const field of Object.keys(expectedResult)) {
    const changed = structuredClone(expectedResult);
    changed[field] = typeof changed[field] === 'boolean' ? !changed[field]
      : typeof changed[field] === 'number' ? changed[field] + 1 : 'DRIFTED';
    assert.throws(() => validateHistoricalIntegrationResult(changed), /blocked authority drifted/);
  }
  assert.throws(() => validateHistoricalIntegrationResult({ ...expectedResult, predictiveAccuracyMeasured: true }));
  const missing = structuredClone(expectedResult); delete missing.executionAuthorized;
  assert.throws(() => validateHistoricalIntegrationResult(missing));
});

const names = ['synthetic replay', 'synthetic authority rejection'];
const tap = `TAP version 13\n# Subtest: ${names[0]}\nok 1 - ${names[0]}\n# Subtest: ${names[1]}\nok 2 - ${names[1]}\n1..2\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`;
test('integration TAP rejects omitted tests, skips, failures, cancellations and repeated accounting', () => {
  assert.deepEqual(validateIntegrationTap(tap, names), { tests: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 });
  for (const changed of [tap.replace('ok 1', 'not ok 1'), tap.replace('# skipped 0', '# skipped 1'), tap.replace('# todo 0', '# todo 1'), tap.replace('# cancelled 0', '# cancelled 1'), tap.replace('# pass 2', '# pass 1'), tap.replace(`ok 2 - ${names[1]}\n`, ''), tap.replace(`ok 1 - ${names[0]}`, `ok 1 - ${names[0]} # SKIP`), tap + '# tests 2\n', tap.replace('TAP version 13\n', ''), tap + 'Bail out!\n']) {
    assert.throws(() => validateIntegrationTap(changed, names));
  }
  assert.throws(() => validateIntegrationTap(tap, ['another', names[1]]));
  for (const changed of [tap.replace('1..2\n', ''), tap.replace('1..2', '1..3'), tap + '1..2\n', tap.replace('ok 2 -', 'ok 1 -'), tap.replace('# suites 0', '# suites 1')]) {
    assert.throws(() => validateIntegrationTap(changed, names));
  }
});

test('bounded integration identity resolves the pinned numbering dependency without executing it', async t => {
  const f = await fixture(t);
  assert.deepEqual(await verifyIntegrationIdentity(f.root, f.plan), {
    sourceCommitClaim: 'a'.repeat(40), checkedFileCount: 7, inventoryCount: 1, dependencyResolvedInsideWorkspace: true,
  });
});

test('complete root manifest drift rejects before missing dependency or input inspection', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'package-lock.json'), '{"lockfileVersion":4}\n');
  await rm(path.join(f.root, 'node_modules/immunum/immunum.js'));
  await assert.rejects(verifyIntegrationIdentity(f.root, f.plan), /Digest drift: package-lock.json/);
});

test('source, installed WASM and preserved metadata-control mutations reject', async t => {
  for (const relative of [importer, 'node_modules/immunum/immunum_bg.wasm', `${fixtureBase}/control.json`]) {
    const f = await fixture(t), filename = path.join(f.root, relative), bytes = await readFile(filename);
    bytes[0] ^= 1; await writeFile(filename, bytes);
    await assert.rejects(verifyIntegrationIdentity(f.root, f.plan), /Digest drift/);
  }
});

test('unexpected evidence, nested package scopes and shadowed numbering modules reject', async t => {
  const extra = await fixture(t); await writeFile(path.join(extra.root, fixtureBase, 'extra.json'), '{}');
  await assert.rejects(verifyIntegrationIdentity(extra.root, extra.plan), /Inventory drift/);
  const scope = await fixture(t); await writeFile(path.join(scope.root, 'scripts/package.json'), '{}');
  await assert.rejects(verifyIntegrationIdentity(scope.root, scope.plan), /Unexpected package scope/);
  const shadow = await fixture(t), directory = path.join(shadow.root, 'scripts/hard-decoy/node_modules/immunum');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{"main":"index.js"}');
  await writeFile(path.join(directory, 'index.js'), 'module.exports = {};');
  await assert.rejects(verifyIntegrationIdentity(shadow.root, shadow.plan), /competing immunum package/);
  const conditional = await fixture(t), conditionalDirectory = path.join(conditional.root, 'scripts/node_modules/immunum');
  await mkdir(conditionalDirectory, { recursive: true });
  await writeFile(path.join(conditionalDirectory, 'package.json'), '{"exports":{"import":"./alternate.mjs","require":"./immunum.js"}}');
  await writeFile(path.join(conditionalDirectory, 'alternate.mjs'), 'export const Annotator = null;');
  await symlink(path.join(conditional.root, 'node_modules/immunum/immunum.js'), path.join(conditionalDirectory, 'immunum.js'));
  await assert.rejects(verifyIntegrationIdentity(conditional.root, conditional.plan), /competing immunum package/);
});

test('symlinked, hardlinked, escaped and unbound inventory identities reject', async t => {
  for (const kind of ['symlink', 'hardlink']) {
    const f = await fixture(t), target = path.join(f.root, fixtureBase, 'control.json'), original = path.join(f.root, 'retained.json');
    await writeFile(original, await readFile(target)); await rm(target);
    await (kind === 'symlink' ? symlink(original, target) : link(original, target));
    await assert.rejects(verifyIntegrationIdentity(f.root, f.plan), /Symlink|linked/);
  }
  const f = await fixture(t);
  for (const relative of ['../escaped', '/absolute', 'scripts\\escape']) {
    const plan = structuredClone(f.plan); plan.files[0].path = relative;
    await assert.rejects(verifyIntegrationIdentity(f.root, plan), /Unsafe identity path/);
  }
  const unbound = structuredClone(f.plan); unbound.exactInventories[fixtureBase] = ['missing.json'];
  await assert.rejects(verifyIntegrationIdentity(f.root, unbound), /lacks identity binding/);
});

test('fixed integration plan authenticates the complete original lock, source closure and preserved inventories', async () => {
  const bytes = await readFile(PLAN), plan = JSON.parse(bytes);
  assert.equal(sha(bytes), INTEGRATION_PLAN_SHA256);
  assert.equal(plan.sourceCommit, 'b19cae064f621f97fb460da0d401fba7aa140f1a');
  assert.equal(plan.files.find(row => row.path === 'package-lock.json').sha256, '0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54');
  assert.equal(plan.files.length, 190); assert.equal(plan.files.filter(row => row.role === 'source').length, 13);
  assert.equal(Object.keys(plan.exactInventories).length, 11);
  assert.deepEqual(plan.recipes.map(row => [row.id, row.format]), [['integration-verifier', 'json'], ['integration-tests', 'tap']]);
  assert.equal(plan.recipes[1].testNames.length, 2);
  assert.equal(plan.files.find(row => row.path.endsWith('/INTEGRATION_STATE_2026-08-29.json')).sha256, 'e06e92945c8591d1ca64a12f8f352ecd682de36ffc9083e248ea2c3c52c64ec1');
  assert.ok(plan.files.every(row => !/\.(pdb|cif|bcif|pdbqt)$/u.test(row.path)));
});

test('runner rejects original-workspace writes, overwrite, output symlinks and arbitrary CLI options', async t => {
  const f = await fixture(t), output = path.join(f.root, 'retained.json'); await writeFile(output, 'retained');
  await assert.rejects(runHistoricalIntegrationReplay('/unprovisioned-original', output), /already exists/);
  await assert.rejects(runHistoricalIntegrationReplay(ROOT, path.join(f.root, 'new.json')), /separate original/);
  await assert.rejects(runHistoricalIntegrationReplay(f.root, path.join(f.root, 'new.json')), /outside historical/);
  const linked = path.join(f.root, 'output-link'); await symlink(f.root, linked);
  await assert.rejects(runHistoricalIntegrationReplay('/unprovisioned-original', path.join(linked, 'new.json')), /Symlinked output directory/);
  await assert.rejects(runHistoricalIntegrationReplay('/unprovisioned-original', path.join(f.root, 'new.json')), /ENOENT/);
  const cli = spawnSync(process.execPath, ['scripts/paper/run-historical-integration-replay.mjs', '--workspace=/unprovisioned-original', `--output=${output}`, '--generate'], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /Usage/); assert.equal(await readFile(output, 'utf8'), 'retained');
});
