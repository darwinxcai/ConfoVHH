// One explicit historical metadata replay, executed from its verified workspace.
// This is not a general command runner or a full release/integration harness.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLAN_SHA256, verifyPinnedEnvironment } from './verify-historical-replay-environment.mjs';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PRODUCER = 'scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs';
const SNAPSHOT = 'validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29';
const CONTROLS = {
  'validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json': 'bc31adf14cf1222ebade348337facefb209c286c631f0da0bf640bd778b0688f',
  [`${SNAPSHOT}/checksums.sha256`]: '9cca78fa06d568a56cd74da129752b28691e7a1d7e59afccec55cf18bc685578',
};
const STATUS = 'VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const COUNT_FIELDS = ['candidateNodeCount', 'developmentNodeCount', 'totalNodeCount', 'totalMetadataProfileCount', 'numberedProfileCount', 'unavailableProfileCount', 'allUnorderedPairCount', 'possibleMetadataSequenceEdgePairCount', 'candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge', 'thresholdPregraphComponentCount', 'exactFullSequenceEvidencePairCount'];
const FALSE_FIELDS = ['targetFreezePermitted', 'executionAuthorized', 'nativeHoldoutCoordinatesAccessed', 'dockqLabelsAccessed'];

export function historicalVhhArguments(nodeVersion) {
  return [...(nodeVersion === '22.23.2' ? ['--no-turbo-inline-js-wasm-calls'] : []), PRODUCER, 'verify', SNAPSHOT];
}

export function validateHistoricalVhhResult(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid historical replay result');
  assert.deepEqual(Object.keys(value).sort(), ['status', ...COUNT_FIELDS, 'formallyClearedGroupCount', ...FALSE_FIELDS].sort(), 'Unexpected historical replay result fields');
  assert.equal(value.status, STATUS, 'Historical replay status changed');
  for (const key of COUNT_FIELDS) assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0, `Invalid metadata count: ${key}`);
  for (const key of FALSE_FIELDS) assert.equal(value[key], false, `Historical replay cannot grant authority: ${key}`);
  assert.equal(value.formallyClearedGroupCount, 0, 'Historical replay cannot clear groups');
  assert.equal(value.totalNodeCount, value.candidateNodeCount + value.developmentNodeCount, 'Inconsistent node inventory');
  assert.equal(value.totalMetadataProfileCount, value.numberedProfileCount + value.unavailableProfileCount, 'Inconsistent numbering accounting');
  assert.equal(value.allUnorderedPairCount, value.totalNodeCount * (value.totalNodeCount - 1) / 2, 'Incomplete pair space');
  return structuredClone(value);
}

async function verifyControls(workspace) {
  for (const [relative, digest] of Object.entries(CONTROLS)) {
    const filename = path.join(workspace, relative), stat = await lstat(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 128 * 1024, 'Historical control must be a bounded direct file');
    assert.equal(await realpath(filename), filename, 'Historical control has symlinked ancestors');
    assert.equal(sha(await readFile(filename)), digest, `Historical control digest drifted: ${relative}`);
  }
}

async function execute(workspace, args) {
  return new Promise((resolve, reject) => {
    // Use a real child process in the historical root; import.meta.url and module
    // resolution consequently belong to that root. No supplied command/options.
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let total = 0, failure;
    const stop = error => { failure ??= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error('Historical replay exceeded its 180-second limit')), 180_000);
    const append = list => bytes => {
      total += bytes.length;
      if (total > 1_000_000) stop(new Error('Historical replay exceeded its output limit'));
      else list.push(bytes);
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

export async function runHistoricalVhhReplay(workspace, outputPath) {
  assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  const historicalRoot = path.resolve(workspace);
  assert.notEqual(historicalRoot, ROOT, 'Supply the separate original historical workspace');
  try { await lstat(outputPath); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const identityBefore = await verifyPinnedEnvironment(historicalRoot);
  await verifyControls(historicalRoot);
  const startedAt = new Date().toISOString(), args = historicalVhhArguments(process.versions.node);
  const child = await execute(historicalRoot, args);
  assert.equal(child.signal, null, 'Historical replay child was terminated');
  assert.equal(child.code, 0, `Historical verifier failed with exit ${child.code}; stderr SHA-256 ${sha(child.stderr)}`);
  const result = validateHistoricalVhhResult(parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(child.stdout)));
  const identityAfter = await verifyPinnedEnvironment(historicalRoot);
  await verifyControls(historicalRoot);
  assert.deepEqual(identityAfter, identityBefore, 'Historical identities changed during execution');
  const sourceSha256 = {};
  for (const relative of ['scripts/paper/run-historical-vhh-replay.mjs', 'scripts/paper/verify-historical-replay-environment.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs']) sourceSha256[relative] = sha(await readFile(path.join(ROOT, relative)));
  const receipt = {
    schema: 'confovhh-one-historical-vhh-replay-v1', status: 'ONE_HISTORICAL_METADATA_REPLAY_PASSED',
    startedAt, completedAt: new Date().toISOString(), sourceSha256,
    environmentPlanSha256: PLAN_SHA256, controlsSha256: CONTROLS,
    historicalSourceClaim: identityBefore.sourceCommitClaim,
    execution: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, arguments: args, producerLoadedFromHistoricalWorkspace: true, stdoutSha256: sha(child.stdout), stderrSha256: sha(child.stderr), exitCode: child.code },
    result,
    boundaries: { scientificMetadataRead: true, nativeOrPredictionCoordinatesRead: false, outcomeLabelsRead: false, oneHistoricalReplayPassed: true, allHistoricalReplaysPassed: false, currentProductReleasePassed: false, completeDependencyClosureVerified: false, securityIsolationEstablished: false, runtimeEquivalenceToOriginalExecutionEstablished: false, integrationAuthorized: false, frozenScoringEngineEstablished: false, independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false },
  };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 2 && args[0].startsWith('--workspace=') && args[0].length > 12 && args[1].startsWith('--output=') && args[1].length > 9, 'Usage: node run-historical-vhh-replay.mjs --workspace=ORIGINAL_WORKSPACE --output=NEW_RECEIPT.json');
    const receipt = await runHistoricalVhhReplay(args[0].slice(12), args[1].slice(9));
    console.log(`${receipt.status}; all-replay and predictive gates remain open`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
