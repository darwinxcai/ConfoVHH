// Two fixed synthetic test recipes in their unchanged historical workspace.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PLAN_PATH = 'paper/historical-synthetic-replay-plan-2026-09-09.json';
export const SYNTHETIC_PLAN_SHA256 = 'ee8562d564c968490d13b7dd34bb9d921dac93e12ec43bbce38be8fd4a96c6cc';
const RECIPES = Object.freeze({
  'reviewer-exports': 'tests/paper-reviewer-browser-evidence.test.mjs',
  'audit-report-ranks': 'tests/audit-report-rank-export.test.mjs',
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const usage = 'Usage: node run-historical-synthetic-replays.mjs --workspace=ORIGINAL_WORKSPACE --output=NEW_RECEIPT.json';

function relativePath(value) {
  assert.ok(typeof value === 'string' && !path.isAbsolute(value)
    && !value.includes('\\') && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe identity path');
  return value;
}

async function directBytes(root, relative, maximumBytes) {
  let filename = root;
  const parts = relativePath(relative).split('/');
  for (const [index, part] of parts.entries()) {
    filename = path.join(filename, part);
    const stat = await lstat(filename);
    assert.ok(!stat.isSymbolicLink(), `Symlinked identity path: ${relative}`);
    if (index < parts.length - 1) assert.ok(stat.isDirectory(), 'Non-directory identity ancestor');
    else assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= maximumBytes, `Non-file, linked or oversized identity: ${relative}`);
  }
  const bytes = await readFile(filename);
  assert.ok(bytes.length <= maximumBytes, `Oversized identity: ${relative}`);
  return bytes;
}

async function inventory(root, base, prefix = '') {
  const directory = path.join(root, base, prefix);
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Symlinked inventory directory');
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Symlink in inventory');
    if (entry.isDirectory()) names.push(...await inventory(root, base, relative));
    else {
      assert.ok(entry.isFile(), 'Non-file inventory member');
      if (base !== 'lib' || relative.endsWith('.ts')) names.push(relative);
    }
  }
  return names.sort();
}

/** A supplied plan is unauthenticated. Only the fixed-plan runner grants a receipt. */
export async function verifySyntheticIdentity(workspace, plan) {
  plan = structuredClone(plan);
  const root = path.resolve(workspace);
  assert.equal(await realpath(root), root, 'Symlinked workspace');
  assert.equal(plan.schemaVersion, '1.0.0');
  assert.match(plan.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.ok(Array.isArray(plan.files) && plan.files.length >= 6 && plan.files.length <= 200);
  const seen = new Set();
  for (const file of plan.files) {
    relativePath(file.path);
    assert.ok(!seen.has(file.path), 'Duplicate identity path'); seen.add(file.path);
    assert.ok(['manifest', 'source', 'dependency', 'synthetic-fixture'].includes(file.role));
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 8 * 1024 * 1024);
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
  }
  for (const required of ['package.json', 'package-lock.json', 'node_modules/immunum/package.json', 'node_modules/immunum/immunum.js', 'node_modules/immunum/immunum_bg.wasm', 'lib/vhh-numbering-v06.ts']) {
    assert.ok(seen.has(required), `Missing identity: ${required}`);
  }
  // Validate complete original root manifests before reading source or fixtures.
  const ordered = [...plan.files].sort((a, b) => Number(a.role !== 'manifest') - Number(b.role !== 'manifest'));
  for (const file of ordered) {
    const bytes = await directBytes(root, file.path, file.bytes);
    assert.equal(bytes.length, file.bytes, `Byte count drift: ${file.path}`);
    assert.equal(sha(bytes), file.sha256, `Digest drift: ${file.path}`);
  }
  for (const [base, expected] of Object.entries(plan.exactInventories)) {
    relativePath(base);
    assert.deepEqual(await inventory(root, base), expected, `Inventory drift: ${base}`);
  }
  // Nested package scopes can change Node semantics or external-module resolution.
  const ancestors = new Set();
  for (const file of plan.files.filter(row => row.role === 'source' && /^(lib|scripts|tests)\//u.test(row.path))) {
    let parent = path.posix.dirname(file.path);
    while (parent !== '.') { ancestors.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const ancestor of ancestors) {
    const candidate = `${ancestor}/package.json`;
    if (seen.has(candidate)) continue;
    try { await lstat(path.join(root, candidate)); throw new Error(`Unexpected package scope: ${candidate}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const expectedModule = path.join(root, 'node_modules/immunum/immunum.js');
  const resolved = createRequire(pathToFileURL(path.join(root, 'lib/vhh-numbering-v06.ts'))).resolve('immunum');
  assert.equal(resolved, expectedModule, 'Immunum resolution differs from pinned dependency');
  assert.equal(await realpath(resolved), expectedModule, 'Resolved dependency escaped workspace');
  return { sourceCommitClaim: plan.sourceCommit, checkedFileCount: plan.files.length, inventoryCount: Object.keys(plan.exactInventories).length, dependencyResolvedInsideWorkspace: true };
}

export function historicalSyntheticArguments(recipeId, nodeVersion) {
  assert.ok(Object.hasOwn(RECIPES, recipeId), 'Unknown historical synthetic recipe');
  return [...(nodeVersion === '22.23.2' ? ['--no-turbo-inline-js-wasm-calls'] : []), '--test', '--test-reporter=tap', '--test-concurrency=1', '--', RECIPES[recipeId]];
}

export function syntheticReplayEnvironment(environment = process.env) {
  // Do not forward Node injection, credentials, proxies or application variables.
  return { PATH: environment.PATH ?? '/usr/bin:/bin', TMPDIR: environment.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', NO_COLOR: '1' };
}

export function validateSyntheticTap(text, expectedNames) {
  assert.ok(Array.isArray(expectedNames) && expectedNames.length > 0);
  assert.ok(!/^(?:not ok\b|Bail out!)/mu.test(text), 'Historical synthetic test failure');
  const names = [...text.matchAll(/^ok \d+ - (.+)$/gmu)].map(match => match[1]);
  assert.deepEqual(names, expectedNames, 'Historical synthetic test inventory differs');
  for (const [key, expected] of Object.entries({ tests: expectedNames.length, pass: expectedNames.length, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
    const values = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].map(match => Number(match[1]));
    assert.deepEqual(values, [expected], `Historical synthetic TAP ${key} differs`);
  }
  assert.ok(text.startsWith('TAP version 13\n'), 'Missing TAP header');
  return { tests: expectedNames.length, passed: expectedNames.length, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
}

async function execute(workspace, args) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(process.execPath, args, { cwd: workspace, env: syntheticReplayEnvironment(), detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; let total = 0, failure;
    const stop = error => {
      failure ??= error;
      try { if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Process already ended. */ }
    };
    const timer = setTimeout(() => stop(new Error('Historical synthetic replay exceeded 180 seconds')), 180_000);
    const append = target => bytes => {
      total += bytes.length;
      if (total > 1_000_000) stop(new Error('Historical synthetic replay exceeded output limit'));
      else target.push(bytes);
    };
    child.stdout.on('data', append(stdout)); child.stderr.on('data', append(stderr));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export async function runHistoricalSyntheticReplays(workspace, outputPath) {
  const root = path.resolve(workspace), output = path.resolve(outputPath);
  assert.notEqual(root, ROOT, 'Supply the separate original historical workspace');
  assert.ok(!output.startsWith(`${root}${path.sep}`), 'Receipt must be outside historical workspace');
  try { await lstat(output); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(await realpath(path.dirname(output)), path.dirname(output), 'Symlinked output directory');
  const planBytes = await readFile(path.join(ROOT, PLAN_PATH));
  assert.equal(sha(planBytes), SYNTHETIC_PLAN_SHA256, 'Pinned synthetic plan drifted');
  const plan = parseStrictJson(decode(planBytes));
  assert.deepEqual(plan.recipes.map(recipe => [recipe.id, recipe.testFile]), Object.entries(RECIPES), 'Fixed recipe inventory differs');
  const startedAt = new Date().toISOString(), identity = await verifySyntheticIdentity(root, plan), executions = [];
  for (const recipe of plan.recipes) {
    assert.deepEqual(await verifySyntheticIdentity(root, plan), identity);
    const args = historicalSyntheticArguments(recipe.id, process.versions.node);
    const executionStartedAt = new Date().toISOString(), result = await execute(root, args);
    assert.deepEqual(await verifySyntheticIdentity(root, plan), identity, 'Historical identities changed during execution');
    assert.equal(result.signal, null, 'Historical synthetic child was terminated');
    assert.equal(result.code, 0, `Historical synthetic recipe ${recipe.id} failed; stderr SHA-256 ${sha(result.stderr)}`);
    const stdout = decode(result.stdout), summary = validateSyntheticTap(stdout, recipe.testNames);
    executions.push({ recipeId: recipe.id, startedAt: executionStartedAt, completedAt: new Date().toISOString(), arguments: args, exitCode: result.code, summary, stdout, stderr: decode(result.stderr), stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr) });
  }
  const sourceSha256 = {};
  for (const relative of ['scripts/paper/run-historical-synthetic-replays.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs', PLAN_PATH]) sourceSha256[relative] = sha(await readFile(path.join(ROOT, relative)));
  const receipt = {
    schema: 'confovhh-two-historical-synthetic-replays-v1', status: 'TWO_HISTORICAL_SYNTHETIC_REPLAYS_PASSED',
    startedAt, completedAt: new Date().toISOString(), sourceSha256, planSha256: SYNTHETIC_PLAN_SHA256,
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, sanitizedChildEnvironment: true },
    identity, executions,
    boundaries: { originalSourcesExecutedInHistoricalWorkspace: true, historicalSourceAndInputIdentitiesCheckedBeforeAndAfterEachRecipe: true,
      syntheticCoordinatesAndLabelsRead: true, nativeOrPredictedBiologicalCoordinatesRead: false, biologicalOutcomeLabelsRead: false,
      liveBrowserExecuted: false, independentParticipantCompletionEstablished: false, currentProductReleasePassed: false,
      allHistoricalReplaysPassed: false, completeDependencyClosureVerified: false, securityIsolationEstablished: false,
      runtimeEquivalenceToOriginalExecutionEstablished: false, networkIsolationEstablished: false,
      integrationAuthorized: false, independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false },
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 2 && args[0].startsWith('--workspace=') && args[0].length > 12 && args[1].startsWith('--output=') && args[1].length > 9, usage);
    const result = await runHistoricalSyntheticReplays(args[0].slice(12), args[1].slice(9));
    console.log(`${result.status}; 12/12 original synthetic tests; broader release gates remain unresolved`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
