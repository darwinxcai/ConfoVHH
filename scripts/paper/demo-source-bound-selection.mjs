// Reproducible generated arithmetic control. This contains no GPCR/VHH predictions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runReviewerDemo } from './reviewer-demo.mjs';
import { runSourceBoundCoordinateRanks } from './export-source-bound-coordinate-ranks.mjs';
import { runSelectionSetComparisonFile } from './compare-selection-sets.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function runSourceBoundSelectionDemo(outputDirectory) {
  // mkdir without recursive rejects reuse of an existing evidence directory.
  await mkdir(outputDirectory);
  const artifacts = path.join(outputDirectory, 'artifacts'); await mkdir(artifacts);
  const demo = runReviewerDemo();
  const manifest = { schema: 'confovhh-source-bound-coordinate-input-v1', studyId: 'SYNTHETIC-SOURCE-SELECTION-CONTROL', generators: [{ id: 'boltz-format-control', extractor: 'boltz-confidence-score-v1' }], attempts: [], coordinates: [], scoreSources: [] };
  const selectionSets = [], setByAttempt = new Map(), outcomes = [];
  for (const seed of [1, 2]) {
    const selectionSetId = `toy-seed-${seed}`;
    await mkdir(path.join(artifacts, selectionSetId));
    selectionSets.push({ id: selectionSetId, targetId: 'toy-target', generatorId: 'boltz-format-control', conditionId: 'arbitrary-control', seed, plannedCandidates: seed === 1 ? 3 : 2 });
    for (const [model, kind] of [[0, 'near'], [1, 'separated']]) {
      const id = `${selectionSetId}-model-${model}`;
      const bytes = Buffer.from(demo.artifacts[`synthetic-${kind}.pdb`]);
      const score = Buffer.from(`${JSON.stringify({ confidence_score: model === 0 ? 0.1 : 0.9 })}\n`);
      const coordinatePath = `${selectionSetId}/toy_model_${model}.pdb`, scorePath = `${selectionSetId}/confidence_toy_model_${model}.json`;
      await writeFile(path.join(artifacts, coordinatePath), bytes, { flag: 'wx' });
      await writeFile(path.join(artifacts, scorePath), score, { flag: 'wx' });
      manifest.attempts.push({ id, groupId: 'toy-component', targetId: 'toy-target', generatorId: 'boltz-format-control', status: 'eligible', reason: '' });
      manifest.coordinates.push({ id, format: 'pdb', coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', chainRolesConfirmed: true });
      manifest.scoreSources.push({ id, extractor: 'boltz-confidence-score-v1', coordinatePath, coordinateSha256: sha(bytes), source: { path: scorePath, sha256: sha(score), bytes: score.length } });
      setByAttempt.set(id, selectionSetId);
      // Deliberately opposite labels across seeds: arbitrary arithmetic, no biology.
      outcomes.push({ id, positive: Number(seed === 1 ? model === 0 : model === 1) });
    }
  }
  manifest.attempts.push({ id: 'toy-failure', groupId: 'toy-component', targetId: 'toy-target', generatorId: 'boltz-format-control', status: 'failed', reason: 'Generated no-output control' });
  setByAttempt.set('toy-failure', 'toy-seed-1');
  const inputPath = path.join(outputDirectory, 'input.json');
  await writeFile(inputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const ranks = await runSourceBoundCoordinateRanks(inputPath, artifacts, path.join(outputDirectory, 'rank-receipt.json'));
  const fields = ranks.result.comparisonFields;
  const comparison = {
    schema: 'confovhh-selection-sets-v1', studyId: manifest.studyId,
    positiveOutcomeDefinition: 'Arbitrary opposite labels across toy seeds for arithmetic control only; not biological pose accuracy.',
    method: fields.method, baseline: fields.baseline,
    targets: [{ id: 'toy-target', groupId: 'toy-component' }],
    generators: [{ id: 'boltz-format-control', conditionIds: ['arbitrary-control'] }], selectionSets,
    attempts: fields.attempts.map(row => ({ ...row, selectionSetId: setByAttempt.get(row.id) })),
    rankings: fields.rankings, outcomes,
  };
  const comparisonPath = path.join(outputDirectory, 'comparison-input.json');
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, { flag: 'wx' });
  const result = await runSelectionSetComparisonFile(comparisonPath, path.join(outputDirectory, 'comparison-receipt.json'));
  assert.deepEqual(result.report.primary, { method: 0.5, baseline: 0.5, delta: 0 });
  assert.equal(result.report.inventory.failed, 1);
  assert.equal(result.report.declaredGroupCount, 1);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: node scripts/paper/demo-source-bound-selection.mjs NEW_DIRECTORY');
    const result = await runSourceBoundSelectionDemo(path.resolve(process.argv[2]));
    console.log(`${result.report.inventory.selectionSets} synthetic selection sets; method=0.5 baseline=0.5; no biological performance result`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
