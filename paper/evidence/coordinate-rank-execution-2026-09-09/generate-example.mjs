// Reproduce this synthetic packet in a NEW directory. Never consumes study data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runReviewerDemo } from '../../../scripts/paper/reviewer-demo.mjs';
import { runCoordinateRankExport } from '../../../scripts/paper/export-coordinate-ranks.mjs';

const args = process.argv.slice(2);
assert.ok(args.length === 1 && args[0].startsWith('--output=') && args[0].length > 9, 'Supply --output=NEW_DIRECTORY');
const directory = path.resolve(args[0].slice(9));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const demo = runReviewerDemo();
const manifest = { schema: 'confovhh-coordinate-rank-input-v1', studyId: 'SYNTHETIC-COORDINATE-EXECUTION', generators: [{ id: 'synthetic', scoreName: 'arbitrary-fixture-score', direction: 'higher-better' }], attempts: [], coordinates: [] };
await mkdir(directory);
await mkdir(path.join(directory, 'coordinates'));
for (const [id, kind, producerScore] of [['near-a', 'near', 0.9], ['near-b', 'near', 0.2], ['separated', 'separated', 0.9]]) {
  const bytes = Buffer.from(demo.artifacts[`synthetic-${kind}.pdb`]);
  await writeFile(path.join(directory, 'coordinates', `${id}.pdb`), bytes, { flag: 'wx' });
  manifest.attempts.push({ id, groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'synthetic', status: 'eligible', reason: '' });
  manifest.coordinates.push({ id, format: 'pdb', coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', chainRolesConfirmed: true, producerScore });
}
manifest.attempts.push({ id: 'failed', groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'synthetic', status: 'failed', reason: 'Arbitrary synthetic failure for accounting verification' });
await writeJson('input.json', manifest);
const receipt = await runCoordinateRankExport(path.join(directory, 'input.json'), path.join(directory, 'coordinates'), path.join(directory, 'rank-receipt.json'));
assert.deepEqual(receipt.result.comparisonFields.rankings, [{ id: 'near-a', methodTier: 0, baselineTier: 0 }, { id: 'near-b', methodTier: 0, baselineTier: 1 }, { id: 'separated', methodTier: 1, baselineTier: 0 }]);
for (const [id, kind] of [['near-a', 'near'], ['separated', 'separated']]) {
  const report = JSON.parse(receipt.result.reports[id]), oracle = demo.cases.find(row => row.name === kind);
  assert.equal(report.audit.contactPairCount, oracle.residuePairs);
  assert.equal(report.audit.atomContactCount, oracle.atomContacts);
}
const sources = {};
for (const relative of ['paper/evidence/coordinate-rank-execution-2026-09-09/generate-example.mjs', 'scripts/paper/reviewer-demo.mjs', 'scripts/paper/export-coordinate-ranks.mjs']) sources[relative] = sha(await readFile(path.resolve(import.meta.dirname, '../../..', relative)));
await writeJson('generation.json', { scope: 'Generated arbitrary alanine fragments and supplied arbitrary baseline scores; no biological model or outcome', node: process.version, sourceSha256: sources, contactOracleAgreed: true, scientificTiesPreserved: true, failedAttemptRetained: true, pairedOutcomeComparisonExecuted: false, originalCoordinatesAccessed: false, independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false });
console.log('Synthetic coordinate execution and report/rank verification passed; no predictive outcome measured');
