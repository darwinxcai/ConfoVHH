import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { historicalVhhArguments, runHistoricalVhhReplay, validateHistoricalVhhResult } from '../scripts/paper/run-historical-vhh-replay.mjs';

function syntheticResult() {
  return { status: 'VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION', candidateNodeCount: 2, developmentNodeCount: 1, totalNodeCount: 3, totalMetadataProfileCount: 3, numberedProfileCount: 2, unavailableProfileCount: 1, allUnorderedPairCount: 3, possibleMetadataSequenceEdgePairCount: 0, candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge: 0, thresholdPregraphComponentCount: 3, exactFullSequenceEvidencePairCount: 0, formallyClearedGroupCount: 0, targetFreezePermitted: false, executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, dockqLabelsAccessed: false };
}

test('historical execution permits only the fixed verify command and exact affected-runtime workaround', () => {
  const command = ['scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs', 'verify', 'validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29'];
  assert.deepEqual(historicalVhhArguments('24.19.0'), command);
  assert.deepEqual(historicalVhhArguments('22.23.2'), ['--no-turbo-inline-js-wasm-calls', ...command]);
  assert.deepEqual(historicalVhhArguments('22.23.3'), command);
  assert.ok(!command.includes('generate'));
});

test('historical result validation rejects elevated authority, labels, inconsistent inventories and missing result fields', () => {
  const result = syntheticResult();
  assert.deepEqual(validateHistoricalVhhResult(result), result);
  for (const mutate of [
    row => { row.executionAuthorized = true; }, row => { row.formallyClearedGroupCount = 1; },
    row => { row.targetFreezePermitted = true; }, row => { row.nativeHoldoutCoordinatesAccessed = true; },
    row => { row.dockqLabelsAccessed = true; }, row => { row.performanceResult = 1; },
    row => { row.numberedProfileCount++; }, row => { row.allUnorderedPairCount--; },
    row => { row.totalNodeCount++; }, row => { delete row.status; }, row => { row.status = 'CLEARED'; },
  ]) { const changed = syntheticResult(); mutate(changed); assert.throws(() => validateHistoricalVhhResult(changed)); }
});

test('runner rejects output overwrite and an unprovisioned workspace without executing a producer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confovhh-historical-runner-'));
  try {
    const output = path.join(directory, 'receipt.json'); await writeFile(output, 'retained');
    await assert.rejects(runHistoricalVhhReplay(directory, output), /already exists/);
    await assert.rejects(runHistoricalVhhReplay(directory, path.join(directory, 'new.json')), /ENOENT|identity|Digest/);
    const cli = spawnSync(process.execPath, ['scripts/paper/run-historical-vhh-replay.mjs', `--workspace=${directory}`, `--output=${output}`, '--generate'], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 10_000 });
    assert.equal(cli.status, 1); assert.match(cli.stderr, /Usage/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
