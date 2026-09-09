// Synthetic coordinates and arbitrary outcome values test arithmetic, not performance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { exportSourceBoundCoordinateRanks } from '../scripts/paper/export-source-bound-coordinate-ranks.mjs';
import { runReviewerDemo } from '../scripts/paper/reviewer-demo.mjs';
import { compareSingleCaseDockq, renderSingleCaseDockqMarkdown, runSingleCaseDockqFile } from '../scripts/paper/compare-single-case-dockq.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceSha256 = 'e'.repeat(64);
const cache = new Map();
async function fixture(kind = 'complete') {
  if (!cache.has(kind)) cache.set(kind, (async () => {
    const demo = runReviewerDemo();
    const manifest = { schema: 'confovhh-source-bound-coordinate-input-v1', studyId: 'SYNTHETIC-NOT-PERFORMANCE-EVIDENCE', generators: [{ id: 'boltz', extractor: 'boltz-confidence-score-v1' }], attempts: [], coordinates: [], scoreSources: [] };
    const attempts = [], dockq = [], coordinates = new Map(), scoreBytes = new Map();
    for (const [id, shape, confidence, value] of [['a', 'near', 0.1, 0.2], ['b', 'separated', 0.9, 0.8], ['c', 'near', 0.9, 0.9]]) {
      let pdb = demo.artifacts[`synthetic-${shape}.pdb`];
      // Distinct relative geometry, not a global translation or different label
      // for identical model bytes. This tiny VHH-only displacement preserves the
      // synthetic discrete SASA tie; arbitrary DockQ values are arithmetic only.
      if (id === 'c' && kind !== 'identical-coordinate') pdb = pdb.split('\n').map(line => line.startsWith('ATOM') && line[21] === 'V' ? line.slice(0, 38) + (Number(line.slice(38, 46)) + 0.001).toFixed(3).padStart(8) + line.slice(46) : line).join('\n');
      const bytes = Buffer.from(pdb), source = Buffer.from(JSON.stringify({ confidence_score: confidence }));
      const generationFailed = kind === 'all-failed';
      const auditFailed = kind === 'audit-failed' && id === 'a';
      const eligible = !generationFailed && !auditFailed;
      const reason = generationFailed ? 'Synthetic generation failure' : auditFailed ? 'Synthetic audit failure' : '';
      manifest.attempts.push({ id, groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'boltz', status: eligible ? 'eligible' : 'failed', reason });
      attempts.push({ id, generationStatus: generationFailed ? 'failed' : 'success', auditStatus: generationFailed ? 'not-run' : auditFailed ? 'failed' : 'success', reason, coordinateSha256: generationFailed ? null : sha(bytes) });
      if (!generationFailed) dockq.push({ id, status: 'success', coordinateSha256: sha(bytes), referenceSha256, DockQ: value, reason: '' });
      if (!eligible) continue;
      manifest.coordinates.push({ id, format: 'pdb', coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', chainRolesConfirmed: true });
      const missing = kind === 'missing-confidence' && id === 'a';
      manifest.scoreSources.push({ id, extractor: 'boltz-confidence-score-v1', coordinatePath: `${id}/synthetic_model_0.pdb`, coordinateSha256: sha(bytes), source: missing ? null : { path: `${id}/confidence_synthetic_model_0.json`, sha256: sha(source), bytes: source.length } });
      coordinates.set(id, bytes); if (!missing) scoreBytes.set(id, source);
    }
    manifest.attempts.push({ id: 'failed', groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'boltz', status: 'failed', reason: 'Synthetic generation failure' });
    attempts.push({ id: 'failed', generationStatus: 'failed', auditStatus: 'not-run', reason: 'Synthetic generation failure', coordinateSha256: null });
    const result = await exportSourceBoundCoordinateRanks(manifest, coordinates, scoreBytes);
    return { schema: 'confovhh-single-case-dockq-input-v1', studyId: manifest.studyId, plan: { targetId: 'synthetic-target', generatorId: 'boltz', plannedCandidateIds: ['a', 'b', 'c', 'failed'], referenceSha256 }, attempts, sourceBoundReceipt: { inputSha256: sha(JSON.stringify(manifest)), result }, dockq };
  })());
  return structuredClone(await cache.get(kind));
}

test('complete tied-tier summaries retain every scientific tie and planned failures', async () => {
  const report = compareSingleCaseDockq(await fixture());
  assert.equal(report.status, 'descriptive-comparison-complete');
  assert.deepEqual(report.confo.candidateIds, ['a', 'c']);
  assert.deepEqual(report.predictor.candidateIds, ['b', 'c']);
  assert.equal(report.confo.meanDockQ, 0.55);
  assert.equal(report.confo.minDockQ, 0.2); assert.equal(report.confo.maxDockQ, 0.9);
  assert.equal(report.confo.fractionAtLeast023, 0.5);
  assert.ok(Math.abs(report.difference.meanDockQ + 0.3) < 1e-12);
  assert.ok(Math.abs(report.confo.regretToBestAvailable - 0.35) < 1e-12);
  assert.deepEqual(report.bestAvailableOracle.candidateIds, ['c']);
  assert.deepEqual(report.inventory, { planned: 4, generated: 3, audited: 3, scored: 3, generationFailures: 1, auditFailures: 0, dockqFailures: 0, confidenceFailures: 0 });
  assert.equal(report.uncertainty.estimated, false); assert.equal(report.claims.originalCloudRunVerified, false);
});

test('serialization order never breaks selector or oracle ties; outcome values are unrounded', async () => {
  const f = await fixture(); f.plan.plannedCandidateIds.reverse(); f.attempts.reverse(); f.dockq.reverse();
  f.dockq.find(row => row.id === 'b').DockQ = 0.9;
  const report = compareSingleCaseDockq(f);
  assert.deepEqual(report.confo.candidateIds, ['a', 'c']);
  assert.deepEqual(report.bestAvailableOracle.candidateIds, ['b', 'c']);
  f.dockq.find(row => row.id === 'b').DockQ = 0.9000000001;
  assert.deepEqual(compareSingleCaseDockq(f).bestAvailableOracle.candidateIds, ['b']);
  f.dockq.find(row => row.id === 'a').DockQ = 0.23;
  assert.equal(compareSingleCaseDockq(f).confo.fractionAtLeast023, 1);
});

test('identical coordinate/reference inputs reject conflicting success values but allow exact duplicate outcomes', async () => {
  const distinct = await fixture();
  assert.notEqual(distinct.attempts.find(row => row.id === 'a').coordinateSha256, distinct.attempts.find(row => row.id === 'c').coordinateSha256);
  const f = await fixture('identical-coordinate');
  assert.throws(() => compareSingleCaseDockq(f), /conflicting DockQ/);
  f.dockq.find(row => row.id === 'c').DockQ = f.dockq.find(row => row.id === 'a').DockQ;
  assert.equal(compareSingleCaseDockq(f).status, 'descriptive-comparison-complete');
});

test('exact planned/source attempt and score bindings reject omissions, swaps and altered receipt fields', async () => {
  for (const mutate of [
    f => f.attempts.pop(),
    f => f.plan.plannedCandidateIds.push('a'),
    f => f.sourceBoundReceipt.result.comparisonFields.attempts.pop(),
    f => { f.sourceBoundReceipt.result.scoreExtraction.bindings[0].coordinateSha256 = 'f'.repeat(64); },
    f => { f.sourceBoundReceipt.result.provenance.sourceJson.a = '{"confidence_score":0.9}'; },
    f => { f.sourceBoundReceipt.result.comparisonFields.rankings[0].methodTier = 0.5; },
    f => { f.dockq[0].referenceSha256 = 'f'.repeat(64); },
    f => { f.dockq[0].coordinateSha256 = 'f'.repeat(64); },
    f => { f.dockq.push({ ...f.dockq[0], id: 'unknown' }); },
  ]) { const f = await fixture(); mutate(f); assert.throws(() => compareSingleCaseDockq(f)); }
});

test('DockQ requires actual finite numbers in inclusive [0,1] and explicit null failures', async () => {
  for (const invalid of [NaN, Infinity, -0.01, 1.01, '0.8', null]) {
    const f = await fixture(); f.dockq[0].DockQ = invalid; assert.throws(() => compareSingleCaseDockq(f), /finite/);
  }
  const f = await fixture(); f.dockq[0].DockQ = 0; f.dockq[1].DockQ = 1;
  assert.equal(compareSingleCaseDockq(f).status, 'descriptive-comparison-complete');
});

test('failed or absent DockQ withholds the whole paired summary and records the lost outcome', async () => {
  for (const absent of [false, true]) {
    const f = await fixture(); if (absent) f.dockq.shift(); else Object.assign(f.dockq[0], { status: 'failed', DockQ: null, reason: 'Synthetic DockQ error' });
    const report = compareSingleCaseDockq(f);
    assert.equal(report.status, 'incomplete-comparison-withheld');
    assert.equal(report.confo, null); assert.equal(report.predictor, null); assert.equal(report.difference, null);
    assert.equal(report.inventory.dockqFailures, 1); assert.equal(report.bestAvailableOracle.completeGeneratedPool, false);
    assert.equal(report.failures.filter(row => row.stage === 'dockq').length, 1);
  }
});

test('a generated coordinate failing audit cannot be silently excluded from paired selection', async () => {
  const report = compareSingleCaseDockq(await fixture('audit-failed'));
  assert.equal(report.status, 'incomplete-comparison-withheld'); assert.equal(report.inventory.auditFailures, 1);
  assert.equal(report.inventory.generated, 3); assert.equal(report.inventory.audited, 2); assert.equal(report.inventory.scored, 3);
  assert.equal(report.confo, null);
});

test('missing producer confidence preserves coordinates and blocks paired ranks without imputation', async () => {
  const report = compareSingleCaseDockq(await fixture('missing-confidence'));
  assert.equal(report.status, 'incomplete-comparison-withheld'); assert.equal(report.inventory.confidenceFailures, 1);
  assert.equal(report.inventory.audited, 3); assert.equal(report.confo, null); assert.equal(report.predictor, null);
  assert.equal(report.candidateLedger.find(row => row.id === 'a').producerScore, null);
});

test('all generation failures have no eligible comparison or best-generated oracle', async () => {
  const report = compareSingleCaseDockq(await fixture('all-failed'));
  assert.equal(report.status, 'no-eligible-candidates'); assert.equal(report.inventory.generationFailures, 4);
  assert.equal(report.confo, null); assert.equal(report.predictor, null); assert.equal(report.bestAvailableOracle, null);
});

test('CLI writes exact JSON receipt and readable actual table, exclusively without overwrite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confovhh-single-case-'));
  try {
    const inputPath = path.join(directory, 'input.json'), outputPath = path.join(directory, 'result.json');
    await writeFile(inputPath, JSON.stringify(await fixture()));
    const result = await runSingleCaseDockqFile(inputPath, outputPath);
    assert.equal(result.inputSha256, sha(await readFile(inputPath)));
    assert.equal(await readFile(path.join(directory, 'result.md'), 'utf8'), renderSingleCaseDockqMarkdown(result.report));
    assert.match(await readFile(path.join(directory, 'result.md'), 'utf8'), /a, c.*0\.550000/);
    assert.match(await readFile(path.join(directory, 'result.md'), 'utf8'), /\| Best available candidate \(DockQ oracle\) \| c \| 1 \| 0\.900000 \| 0\.900000–0\.900000 \| 1\.000000 \| 0\.000000 \|/);
    await assert.rejects(runSingleCaseDockqFile(inputPath, outputPath), /exists/);
    const cli = spawnSync(process.execPath, ['scripts/paper/compare-single-case-dockq.mjs', `--input=${inputPath}`, `--output=${path.join(directory, 'cli.json')}`], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 30_000 });
    assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /descriptive-comparison-complete/);
    await writeFile(path.join(directory, 'sidecar.md'), 'reserved');
    await assert.rejects(runSingleCaseDockqFile(inputPath, path.join(directory, 'sidecar.json')), /exists/);
    const duplicateInput = path.join(directory, 'duplicate.json');
    await writeFile(duplicateInput, '{"studyId":"duplicate",' + (await readFile(inputPath, 'utf8')).slice(1));
    await assert.rejects(runSingleCaseDockqFile(duplicateInput, path.join(directory, 'duplicate-out.json')), /duplicate/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
