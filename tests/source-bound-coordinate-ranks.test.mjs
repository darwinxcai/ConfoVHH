import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { exportSourceBoundCoordinateRanks, runSourceBoundCoordinateRanks } from '../scripts/paper/export-source-bound-coordinate-ranks.mjs';
import { runReviewerDemo } from '../scripts/paper/reviewer-demo.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const demo = runReviewerDemo();
function fixture() {
  const manifest = { schema: 'confovhh-source-bound-coordinate-input-v1', studyId: 'SYNTHETIC-SOURCE-BOUND', generators: [{ id: 'boltz', extractor: 'boltz-confidence-score-v1' }], attempts: [], coordinates: [], scoreSources: [] };
  const coordinates = new Map(), scores = new Map();
  for (const [id, kind, score] of [['near', 'near', 0.1], ['far', 'separated', 0.9], ['near-tie', 'near', 0.9]]) {
    const bytes = Buffer.from(demo.artifacts[`synthetic-${kind}.pdb`]), source = Buffer.from(JSON.stringify({ confidence_score: score, iptm: 0.42 }));
    manifest.attempts.push({ id, groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'boltz', status: 'eligible', reason: '' });
    manifest.coordinates.push({ id, format: 'pdb', coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', chainRolesConfirmed: true });
    manifest.scoreSources.push({ id, extractor: 'boltz-confidence-score-v1', coordinatePath: `${id}/synthetic_model_0.pdb`, coordinateSha256: sha(bytes), source: { path: `${id}/confidence_synthetic_model_0.json`, sha256: sha(source), bytes: source.length } });
    coordinates.set(id, bytes); scores.set(id, source);
  }
  manifest.attempts.push({ id: 'failed', groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'boltz', status: 'failed', reason: 'Generated failure control' });
  return { manifest, coordinates, scores };
}

test('producer-file values determine baseline tiers while actual coordinates determine method ties', async () => {
  const f = fixture(), result = await exportSourceBoundCoordinateRanks(f.manifest, f.coordinates, f.scores);
  assert.equal(result.status, 'source-bound-ranks-complete');
  assert.deepEqual(result.comparisonFields.rankings, [
    { id: 'far', methodTier: 1, baselineTier: 0 },
    { id: 'near', methodTier: 0, baselineTier: 1 },
    { id: 'near-tie', methodTier: 0, baselineTier: 0 },
  ]);
  assert.equal(result.comparisonFields.attempts.length, 4);
  assert.notEqual(result.comparisonFields.baseline.policySha256, result.coordinateExecution.comparisonFields.baseline.policySha256);
  assert.equal(result.claims.availableProducerScoreBytesVerified, true);
  assert.equal(result.claims.predictiveAccuracyMeasured, false);
  assert.equal(result.claims.originalProducerExecutionVerified, false);
  assert.equal(result.coordinateExecution.claims.producerScoreSourcesVerified, false);
  assert.equal(result.provenance.sourceJson.near, f.scores.get('near').toString());
});

test('missing source is explicit, method audits remain, and no paired ranking is fabricated', async () => {
  const f = fixture(); f.manifest.scoreSources[0].source = null; f.scores.delete('near');
  const result = await exportSourceBoundCoordinateRanks(f.manifest, f.coordinates, f.scores);
  assert.equal(result.status, 'baseline-unavailable');
  assert.deepEqual(result.comparisonFields.rankings, []);
  assert.deepEqual(result.provenance.missingScoreIds, ['near']);
  assert.equal(Object.keys(result.coordinateExecution.reports).length, 3);
});

test('manual numeric overrides, wrong generator extraction, source/coordinate swaps and partial inventories reject', async () => {
  for (const mutate of [
    f => { f.manifest.coordinates[0].producerScore = 1; },
    f => { f.manifest.generators[0].direction = 'lower-better'; },
    f => { f.manifest.scoreSources[0].extractor = 'boltz-iptm-v1'; },
    f => { f.manifest.scoreSources[0].coordinateSha256 = '0'.repeat(64); },
    f => { f.manifest.scoreSources[0].source.path = 'near/confidence_synthetic_model_1.json'; },
    f => { f.manifest.scoreSources.pop(); },
    f => { f.manifest.scoreSources[0].coordinatePath = '../synthetic_model_0.pdb'; },
    f => { f.manifest.outcomes = []; },
    f => { f.scores.get('near')[0] = 32; },
    f => { f.coordinates.get('near')[0] = 32; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(exportSourceBoundCoordinateRanks(f.manifest, f.coordinates, f.scores)); }
});

test('capture is immutable across caller changes after invocation', async () => {
  const f = fixture(), scoreHash = sha(f.scores.get('near'));
  const pending = exportSourceBoundCoordinateRanks(f.manifest, f.coordinates, f.scores);
  f.scores.get('near').fill(0); f.coordinates.get('near').fill(0); f.manifest.scoreSources.length = 0;
  const result = await pending;
  assert.equal(sha(result.provenance.sourceJson.near), scoreHash);
  assert.equal(result.comparisonFields.rankings.find(row => row.id === 'near').baselineTier, 1);
});

test('declared all-failed population survives without synthetic scores or a false audit claim', async () => {
  const f = fixture(); f.manifest.attempts = [f.manifest.attempts.at(-1)]; f.manifest.coordinates = []; f.manifest.scoreSources = [];
  const result = await exportSourceBoundCoordinateRanks(f.manifest, new Map(), new Map());
  assert.equal(result.status, 'no-eligible-candidates');
  assert.deepEqual(result.comparisonFields.rankings, []);
  assert.equal(result.coordinateExecution.claims.currentAuditExecuted, false);
  assert.equal(result.comparisonFields.attempts[0].status, 'failed');
});

test('one file-level confidence cannot be attached to a selected internal MODEL of an ensemble', async () => {
  const f = fixture();
  const atoms = kind => demo.artifacts[`synthetic-${kind}.pdb`].split('\n').filter(line => line.startsWith('ATOM')).join('\n');
  const bytes = Buffer.from(`MODEL        1\n${atoms('near')}\nENDMDL\nMODEL        2\n${atoms('separated')}\nENDMDL\nEND\n`);
  f.coordinates.set('near', bytes);
  Object.assign(f.manifest.coordinates[0], { coordinateSha256: sha(bytes), coordinateBytes: bytes.length, selectedModelId: '2' });
  f.manifest.scoreSources[0].coordinateSha256 = sha(bytes);
  await assert.rejects(exportSourceBoundCoordinateRanks(f.manifest, f.coordinates, f.scores), /single coordinate MODEL/);
});

test('CLI reads the exact declared producer paths and rejects unexpected files, symlinks and overwrite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confovhh-source-bound-'));
  try {
    const f = fixture(), artifactRoot = path.join(directory, 'artifacts'), input = path.join(directory, 'input.json'), output = path.join(directory, 'receipt.json');
    await mkdir(artifactRoot);
    for (const row of f.manifest.scoreSources) {
      await mkdir(path.dirname(path.join(artifactRoot, row.coordinatePath)), { recursive: true });
      await writeFile(path.join(artifactRoot, row.coordinatePath), f.coordinates.get(row.id));
      await writeFile(path.join(artifactRoot, row.source.path), f.scores.get(row.id));
    }
    await writeFile(input, JSON.stringify(f.manifest));
    const result = await runSourceBoundCoordinateRanks(input, artifactRoot, output);
    assert.equal(result.inputSha256, sha(await readFile(input)));
    await assert.rejects(runSourceBoundCoordinateRanks(input, artifactRoot, output), /exists/);
    const extra = path.join(artifactRoot, 'extra.json'); await writeFile(extra, '{}');
    await assert.rejects(runSourceBoundCoordinateRanks(input, artifactRoot, path.join(directory, 'extra-out.json')), /Unexpected/);
    await rm(extra);
    const source = path.join(artifactRoot, f.manifest.scoreSources[0].source.path), saved = path.join(directory, 'saved.json');
    await writeFile(saved, f.scores.get('near')); await rm(source); await symlink(saved, source);
    await assert.rejects(runSourceBoundCoordinateRanks(input, artifactRoot, path.join(directory, 'symlink-out.json')), /Symlink/);
    await rm(source); await writeFile(source, f.scores.get('near'));
    const cli = spawnSync(process.execPath, ['scripts/paper/export-source-bound-coordinate-ranks.mjs', `--input=${input}`, `--artifacts=${artifactRoot}`, `--output=${path.join(directory, 'cli.json')}`], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 30_000 });
    assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /source-bound-ranks-complete/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
