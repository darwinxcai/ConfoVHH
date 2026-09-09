// Fixed metadata/sequence integration recipes in the unchanged original root.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PLAN_PATH = 'paper/historical-integration-replay-plan-2026-09-09.json';
export const INTEGRATION_PLAN_SHA256 = '30a126089b5dd3c0d93721aeda4edbbade2a4023167cc7f3a6901638cf6acf63';
const RECIPES = Object.freeze({
  'integration-verifier': 'scripts/hard-decoy-v3/verify-integration-state.mjs',
  'integration-tests': 'tests/hard-decoy-v3-integration-state.test.mjs',
});
const IMPORTER = 'scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs';
const EXPECTED_RESULT = Object.freeze({
  status: 'DRAFT', targetFreezeGate: 'BLOCKED', selectedProtocol: 'HARD_DECOY_PROTOCOL_V3.md',
  selectedDesign: 'sealed-one-way-native-epitope-boolean-oracle',
  sourceEntries: 287, entryMetadataRows: 287, polymerEntities: 1401, repeatedRawResponses: 24,
  entryMetadataCaptures: 2, normalizedCaptureAgreement: true, dispositionRows: 287,
  resolvedDispositionRows: 15, pendingDispositionRows: 272, developmentMetadataNodes: 17,
  exactEvidenceNodes: 304, exactEvidenceUnorderedPairs: 46056, positiveExactOrAmbiguousEvidencePairs: 3013,
  candidateNodesConnectedToDevelopmentByDefiniteEvidence: 33,
  candidateNodesConnectedToDevelopmentByInclusiveEvidence: 262,
  vhhMetadataProfiles: 303, vhhNumberedProfiles: 302, vhhUnavailableProfiles: 1,
  vhhSequenceUnorderedPairs: 46056, possibleVhhSequenceEvidencePairs: 20859,
  vhhThresholdPregraphComponents: 34, candidateNodesConnectedToDevelopmentByPossibleVhhSequenceEvidence: 57,
  boundedAuditReviewedLedgerRecords: 13, boundedAuditReviewedPdbEntries: 20,
  provisionalGroups: 7, formallyClearedGroups: 0, requiredIndependentGroups: 10,
  approvalReady: false, executionAuthorized: false,
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const usage = 'Usage: node run-historical-integration-replay.mjs --workspace=ORIGINAL_WORKSPACE --output=NEW_RECEIPT.json';

function relativePath(value) {
  assert.ok(typeof value === 'string' && !path.isAbsolute(value) && !value.includes('\\')
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe identity path');
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
  const directory = path.join(root, base, prefix), stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Symlinked inventory directory');
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Symlink in inventory');
    if (entry.isDirectory()) files.push(...await inventory(root, base, relative));
    else { assert.ok(entry.isFile(), 'Non-file inventory member'); files.push(relative); }
  }
  return files.sort();
}

/** Supplied plans are unauthenticated; only the fixed-plan runner creates a receipt. */
export async function verifyIntegrationIdentity(workspace, plan) {
  plan = structuredClone(plan);
  const root = path.resolve(workspace);
  assert.equal(await realpath(root), root, 'Symlinked workspace');
  assert.equal(plan.schemaVersion, '1.0.0');
  assert.match(plan.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.ok(Array.isArray(plan.files) && plan.files.length >= 6 && plan.files.length <= 300);
  const seen = new Set();
  for (const file of plan.files) {
    relativePath(file.path);
    assert.ok(!seen.has(file.path), 'Duplicate identity path'); seen.add(file.path);
    assert.ok(['manifest', 'source', 'dependency', 'control', 'metadata-input'].includes(file.role));
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 96 * 1024 * 1024);
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
  }
  for (const required of ['package.json', 'package-lock.json', IMPORTER,
    'node_modules/immunum/package.json', 'node_modules/immunum/immunum.js', 'node_modules/immunum/immunum_bg.wasm']) {
    assert.ok(seen.has(required), `Missing identity: ${required}`);
  }
  assert.ok(plan.exactInventories && typeof plan.exactInventories === 'object' && !Array.isArray(plan.exactInventories));
  for (const [base, expected] of Object.entries(plan.exactInventories)) {
    relativePath(base);
    assert.ok(Array.isArray(expected) && expected.length > 0);
    assert.deepEqual(expected, [...new Set(expected)].sort(), 'Unsorted or duplicate inventory');
    for (const relative of expected) {
      relativePath(relative);
      assert.ok(seen.has(`${base}/${relative}`), 'Inventory member lacks identity binding');
    }
  }
  // Check complete original root manifests before source, installed modules or inputs.
  const ordered = [...plan.files].sort((a, b) => Number(!['package.json', 'package-lock.json'].includes(a.path)) - Number(!['package.json', 'package-lock.json'].includes(b.path)));
  for (const file of ordered) {
    const bytes = await directBytes(root, file.path, file.bytes);
    assert.equal(bytes.length, file.bytes, `Byte count drift: ${file.path}`);
    assert.equal(sha(bytes), file.sha256, `Digest drift: ${file.path}`);
  }
  for (const [base, expected] of Object.entries(plan.exactInventories)) {
    assert.deepEqual(await inventory(root, base), expected, `Inventory drift: ${base}`);
  }
  const ancestors = new Set();
  for (const file of plan.files.filter(row => row.role === 'source')) {
    let parent = path.posix.dirname(file.path);
    while (parent !== '.') { ancestors.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const ancestor of ancestors) {
    const candidate = `${ancestor}/package.json`;
    if (seen.has(candidate)) continue;
    try { await lstat(path.join(root, candidate)); throw new Error(`Unexpected package scope: ${candidate}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // ESM import and createRequire resolution can select different conditional
  // exports in a nearer package. Reject every competing ancestor package first.
  let importerParent = path.posix.dirname(IMPORTER);
  while (importerParent !== '.') {
    const candidate = `${importerParent}/node_modules/immunum`;
    try { await lstat(path.join(root, candidate)); throw new Error(`Unexpected competing immunum package: ${candidate}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    importerParent = path.posix.dirname(importerParent);
  }
  const expectedModule = path.join(root, 'node_modules/immunum/immunum.js');
  const resolved = createRequire(pathToFileURL(path.join(root, IMPORTER))).resolve('immunum');
  assert.equal(resolved, expectedModule, 'Immunum resolution differs from pinned dependency');
  assert.equal(await realpath(resolved), expectedModule, 'Resolved dependency escaped workspace');
  return { sourceCommitClaim: plan.sourceCommit, checkedFileCount: plan.files.length,
    inventoryCount: Object.keys(plan.exactInventories).length, dependencyResolvedInsideWorkspace: true };
}

export function historicalIntegrationArguments(recipeId, nodeVersion) {
  assert.ok(Object.hasOwn(RECIPES, recipeId), 'Unknown historical integration recipe');
  return [...(nodeVersion === '22.23.2' ? ['--no-turbo-inline-js-wasm-calls'] : []),
    ...(recipeId === 'integration-tests' ? ['--test', '--test-reporter=tap', '--test-concurrency=1', '--'] : []), RECIPES[recipeId]];
}

export function integrationReplayEnvironment(environment = process.env) {
  return { PATH: environment.PATH ?? '/usr/bin:/bin', TMPDIR: environment.TMPDIR ?? '/tmp',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', NO_COLOR: '1' };
}

export function validateHistoricalIntegrationResult(value) {
  value = structuredClone(value); // Strict JSON parsing deliberately uses null prototypes.
  assert.deepEqual(value, EXPECTED_RESULT, 'Historical integration result or blocked authority drifted');
  return value;
}

export function validateIntegrationTap(text, expectedNames) {
  assert.ok(Array.isArray(expectedNames) && expectedNames.length === 2);
  assert.ok(!/^(?:not ok\b|Bail out!)/mu.test(text), 'Historical integration test failure');
  const cases = [...text.matchAll(/^ok (\d+) - (.+)$/gmu)];
  assert.deepEqual(cases.map(match => Number(match[1])), [1, 2], 'Historical integration test numbering differs');
  assert.deepEqual(cases.map(match => match[2]), expectedNames, 'Historical integration test inventory differs');
  assert.deepEqual([...text.matchAll(/^1\.\.(\d+)$/gmu)].map(match => Number(match[1])), [2], 'Historical integration TAP plan differs');
  for (const [key, expected] of Object.entries({ tests: 2, suites: 0, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
    assert.deepEqual([...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].map(match => Number(match[1])), [expected], `Historical integration TAP ${key} differs`);
  }
  assert.ok(text.startsWith('TAP version 13\n'), 'Missing TAP header');
  return { tests: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
}

async function execute(workspace, args) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(process.execPath, args, { cwd: workspace, env: integrationReplayEnvironment(), detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; let total = 0, failure;
    const stop = error => {
      failure ??= error;
      try { if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already ended. */ }
    };
    const timer = setTimeout(() => stop(new Error('Historical integration replay exceeded 180 seconds')), 180_000);
    const append = target => bytes => {
      total += bytes.length;
      if (total > 1_000_000) stop(new Error('Historical integration replay exceeded output limit'));
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

export async function runHistoricalIntegrationReplay(workspace, outputPath) {
  const root = path.resolve(workspace), output = path.resolve(outputPath);
  assert.notEqual(root, ROOT, 'Supply the separate original historical workspace');
  assert.ok(output !== root && !output.startsWith(`${root}${path.sep}`), 'Receipt must be outside historical workspace');
  try { await lstat(output); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(await realpath(path.dirname(output)), path.dirname(output), 'Symlinked output directory');
  const planBytes = await readFile(path.join(ROOT, PLAN_PATH));
  assert.equal(sha(planBytes), INTEGRATION_PLAN_SHA256, 'Pinned integration plan drifted');
  const plan = parseStrictJson(decode(planBytes));
  assert.deepEqual(plan.recipes.map(recipe => [recipe.id, recipe.file]), Object.entries(RECIPES), 'Fixed recipe inventory differs');
  validateHistoricalIntegrationResult(plan.expectedResult);
  const startedAt = new Date().toISOString(), identity = await verifyIntegrationIdentity(root, plan), executions = [];
  for (const recipe of plan.recipes) {
    assert.deepEqual(await verifyIntegrationIdentity(root, plan), identity);
    const args = historicalIntegrationArguments(recipe.id, process.versions.node), executionStartedAt = new Date().toISOString();
    let child, executionError;
    try { child = await execute(root, args); } catch (error) { executionError = error; }
    assert.deepEqual(await verifyIntegrationIdentity(root, plan), identity, 'Historical identities changed during execution');
    if (executionError) throw executionError;
    assert.equal(child.signal, null, 'Historical integration child was terminated');
    assert.equal(child.code, 0, `Historical integration recipe ${recipe.id} failed; stderr SHA-256 ${sha(child.stderr)}`);
    const stdout = decode(child.stdout), result = recipe.format === 'json'
      ? validateHistoricalIntegrationResult(parseStrictJson(stdout)) : validateIntegrationTap(stdout, recipe.testNames);
    executions.push({ recipeId: recipe.id, startedAt: executionStartedAt, completedAt: new Date().toISOString(),
      arguments: args, exitCode: child.code, result, stdout, stderr: decode(child.stderr),
      stdoutSha256: sha(child.stdout), stderrSha256: sha(child.stderr) });
  }
  const sourceSha256 = {};
  for (const relative of ['scripts/paper/run-historical-integration-replay.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs', PLAN_PATH]) {
    sourceSha256[relative] = sha(await readFile(path.join(ROOT, relative)));
  }
  const receipt = {
    schema: 'confovhh-historical-integration-replay-v1', status: 'HISTORICAL_INTEGRATION_REPLAY_PASSED_SCIENTIFIC_GATES_BLOCKED',
    startedAt, completedAt: new Date().toISOString(), sourceSha256, planSha256: INTEGRATION_PLAN_SHA256,
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, sanitizedChildEnvironment: true },
    identity, executions,
    boundaries: { originalSourcesExecutedInHistoricalWorkspace: true, historicalSourceAndInputIdentitiesCheckedBeforeAndAfterEachRecipe: true,
      metadataAndSequencesRead: true, sequenceNumberingDependencyExecuted: true,
      nativeOrPredictedBiologicalCoordinatesRead: false, biologicalOutcomeLabelsRead: false,
      originalEvidenceOverwritten: false, integrationStateRemainsDraft: true, targetFreezeRemainsBlocked: true,
      currentProductReleasePassed: false, allHistoricalReplaysPassed: false, mandatoryCiRoutingCompleted: false,
      completeDependencyClosureVerified: false, securityIsolationEstablished: false,
      runtimeEquivalenceToOriginalExecutionEstablished: false, networkIsolationEstablished: false,
      integrationAuthorized: false, frozenScoringEngineEstablished: false, independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false },
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 2 && args[0].startsWith('--workspace=') && args[0].length > 12 && args[1].startsWith('--output=') && args[1].length > 9, usage);
    const receipt = await runHistoricalIntegrationReplay(args[0].slice(12), args[1].slice(9));
    console.log(`${receipt.status}; unchanged verifier and 2/2 original tests; broader release gates remain unresolved`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
