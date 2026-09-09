import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SYNTHETIC_PLAN_SHA256, historicalSyntheticArguments, syntheticReplayEnvironment, validateSyntheticTap, verifySyntheticIdentity, runHistoricalSyntheticReplays } from '../scripts/paper/run-historical-synthetic-replays.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'confovhh-synthetic-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = {
    'package.json': '{"type":"module"}\n', 'package-lock.json': '{"lockfileVersion":3}\n',
    'lib/vhh-numbering-v06.ts': 'export const synthetic = true;\n',
    'node_modules/immunum/package.json': '{"name":"immunum","main":"immunum.js"}\n',
    'node_modules/immunum/immunum.js': 'module.exports = {};\n',
    'node_modules/immunum/immunum_bg.wasm': 'synthetic placeholder, never executed\n',
    'synthetic/receipt.json': '{"synthetic":true}\n',
  };
  const plan = { schemaVersion: '1.0.0', sourceCommit: 'a'.repeat(40), files: [], exactInventories: { lib: ['vhh-numbering-v06.ts'], synthetic: ['receipt.json'] } };
  for (const [relative, bytes] of Object.entries(content)) {
    const filename = path.join(root, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    plan.files.push({ path: relative, bytes: Buffer.byteLength(bytes), sha256: sha(bytes), role: relative.startsWith('package') ? 'manifest' : relative.startsWith('lib') ? 'source' : relative.startsWith('node_modules') ? 'dependency' : 'synthetic-fixture' });
  }
  return { root, plan };
}

test('fixed recipes cannot select arbitrary files, filter tests or add generation arguments', () => {
  assert.deepEqual(historicalSyntheticArguments('reviewer-exports', '24.19.0'), ['--test', '--test-reporter=tap', '--test-concurrency=1', '--', 'tests/paper-reviewer-browser-evidence.test.mjs']);
  assert.equal(historicalSyntheticArguments('audit-report-ranks', '22.23.2')[0], '--no-turbo-inline-js-wasm-calls');
  assert.equal(historicalSyntheticArguments('audit-report-ranks', '22.23.3')[0], '--test');
  for (const id of ['__proto__', '--test-name-pattern=skip', 'generate', '../other.mjs']) assert.throws(() => historicalSyntheticArguments(id, '24.19.0'));
});

test('child environment drops Node hooks, test context, credentials and proxies', () => {
  const env = syntheticReplayEnvironment({ PATH: '/synthetic/bin', TMPDIR: '/synthetic/tmp', NODE_OPTIONS: '--require=evil', NODE_PATH: '/evil', NODE_TEST_CONTEXT: 'child-v8', GH_TOKEN: 'synthetic-secret', HTTPS_PROXY: 'synthetic-proxy' });
  assert.deepEqual(Object.keys(env).sort(), ['LANG', 'LC_ALL', 'NO_COLOR', 'PATH', 'TMPDIR', 'TZ']);
  assert.equal(env.PATH, '/synthetic/bin'); assert.equal(env.TMPDIR, '/synthetic/tmp');
});

const tap = 'TAP version 13\n# Subtest: synthetic case\nok 1 - synthetic case\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
test('TAP acceptance requires the complete exact test inventory and zero failures, skips or cancellations', () => {
  assert.deepEqual(validateSyntheticTap(tap, ['synthetic case']), { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 });
  for (const changed of [tap.replace('ok 1', 'not ok 1'), tap.replace('# skipped 0', '# skipped 1'), tap.replace('# todo 0', '# todo 1'), tap.replace('# cancelled 0', '# cancelled 1'), tap.replace('# pass 1', '# pass 0'), tap.replace('ok 1 - synthetic case', 'ok 1 - synthetic case # SKIP'), tap + '# tests 1\n', tap.replace('TAP version 13\n', ''), tap + 'Bail out!\n']) assert.throws(() => validateSyntheticTap(changed, ['synthetic case']));
  assert.throws(() => validateSyntheticTap(tap, ['different case']));
});

test('bounded identity verifies files and module resolution, with no execution authority', async t => {
  const f = await fixture(t); const result = await verifySyntheticIdentity(f.root, f.plan);
  assert.deepEqual(result, { sourceCommitClaim: 'a'.repeat(40), checkedFileCount: 7, inventoryCount: 2, dependencyResolvedInsideWorkspace: true });
});

test('manifest drift rejects before a missing dependency can be inspected', async t => {
  const f = await fixture(t); await writeFile(path.join(f.root, 'package-lock.json'), '{"lockfileVersion":4}\n');
  await rm(path.join(f.root, 'node_modules/immunum/immunum.js'));
  await assert.rejects(verifySyntheticIdentity(f.root, f.plan), /Digest drift: package-lock.json/);
});

test('source, dependency and preserved synthetic input mutations reject', async t => {
  for (const relative of ['lib/vhh-numbering-v06.ts', 'node_modules/immunum/immunum_bg.wasm', 'synthetic/receipt.json']) {
    const f = await fixture(t); const file = path.join(f.root, relative), bytes = await readFile(file); bytes[0] ^= 1; await writeFile(file, bytes);
    await assert.rejects(verifySyntheticIdentity(f.root, f.plan), /Digest drift/);
  }
});

test('additional libraries, package scopes, symlinks and shadowed dependency resolution reject', async t => {
  const extra = await fixture(t); await writeFile(path.join(extra.root, 'lib/extra.ts'), 'export {};');
  await assert.rejects(verifySyntheticIdentity(extra.root, extra.plan), /Inventory drift/);
  const scope = await fixture(t); await writeFile(path.join(scope.root, 'lib/package.json'), '{}');
  await assert.rejects(verifySyntheticIdentity(scope.root, scope.plan), /Unexpected package scope/);
  const linked = await fixture(t); const file = path.join(linked.root, 'synthetic/receipt.json'); await rm(file); await symlink(path.join(linked.root, 'package.json'), file);
  await assert.rejects(verifySyntheticIdentity(linked.root, linked.plan), /Symlink/);
  const shadow = await fixture(t); const nested = path.join(shadow.root, 'lib/node_modules/immunum'); await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'package.json'), '{"main":"index.js"}'); await writeFile(path.join(nested, 'index.js'), 'module.exports = {};');
  await assert.rejects(verifySyntheticIdentity(shadow.root, shadow.plan), /resolution differs/);
});

test('published plan pins the original full lock, source inventory and exactly two synthetic recipes', async () => {
  const bytes = await readFile(path.join(ROOT, 'paper/historical-synthetic-replay-plan-2026-09-09.json'));
  assert.equal(sha(bytes), SYNTHETIC_PLAN_SHA256);
  const plan = JSON.parse(bytes);
  assert.equal(plan.sourceCommit, 'b19cae064f621f97fb460da0d401fba7aa140f1a');
  assert.equal(plan.files.find(row => row.path === 'package-lock.json').sha256, '0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54');
  assert.deepEqual(plan.recipes.map(row => [row.id, row.testNames.length]), [['reviewer-exports', 1], ['audit-report-ranks', 11]]);
  assert.equal(plan.files.length, 63);
  assert.ok(plan.files.filter(row => row.role === 'synthetic-fixture').every(row => /^paper\/evidence\/(reviewer-browser-2026-09-08|audit-report-rank-synthetic-2026-09-08)\//u.test(row.path)));
  assert.ok(plan.files.every(row => !row.path.startsWith('validation/')));
});

test('runner rejects output overwrite, current workspace, missing original workspace and additional CLI arguments', async t => {
  const f = await fixture(t); const output = path.join(f.root, 'retained.json'); await writeFile(output, 'retained');
  await assert.rejects(runHistoricalSyntheticReplays('/unprovisioned-original', output), /already exists/);
  await assert.rejects(runHistoricalSyntheticReplays(ROOT, path.join(f.root, 'new.json')), /separate original/);
  await assert.rejects(runHistoricalSyntheticReplays('/unprovisioned-original', path.join(f.root, 'new.json')), /ENOENT/);
  const cli = spawnSync(process.execPath, ['scripts/paper/run-historical-synthetic-replays.mjs', '--workspace=/unprovisioned-original', `--output=${output}`, '--generate'], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /Usage/); assert.equal(await readFile(output, 'utf8'), 'retained');
});
