import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportCoordinateRanks, runCoordinateRankExport } from '../scripts/paper/export-coordinate-ranks.mjs';
import { runReviewerDemo } from '../scripts/paper/reviewer-demo.mjs';
import { exportAuditReportRanks } from '../scripts/paper/export-audit-report-ranks.mjs';
import { parsePdb } from '../lib/confovhh.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const demo = runReviewerDemo(); // Arbitrary generated atom arrangements, no biological input.
function fixture() {
  const manifest = { schema: 'confovhh-coordinate-rank-input-v1', studyId: 'SYNTHETIC-COORDINATE-RANKS', generators: [{ id: 'g', scoreName: 'synthetic-score', direction: 'higher-better' }], attempts: [], coordinates: [] };
  const coordinates = new Map();
  for (const [id, kind, score] of [['a-near', 'near', 0.9], ['z-near', 'near', 0.2], ['separated', 'separated', 0.9]]) {
    const bytes = Buffer.from(demo.artifacts[`synthetic-${kind}.pdb`]);
    manifest.attempts.push({ id, groupId: 'synthetic', targetId: 'synthetic', generatorId: 'g', status: 'eligible', reason: '' });
    manifest.coordinates.push({ id, format: 'pdb', coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', chainRolesConfirmed: true, producerScore: score });
    coordinates.set(id, bytes);
  }
  manifest.attempts.push({ id: 'failed', groupId: 'synthetic', targetId: 'synthetic', generatorId: 'g', status: 'failed', reason: 'Synthetic producer failure' });
  return { manifest, coordinates };
}
function replaceBytes(f, id, bytes) {
  const row = f.manifest.coordinates.find(row => row.id === id);
  row.coordinateBytes = bytes.length; row.coordinateSha256 = sha(bytes); f.coordinates.set(id, bytes);
}

test('actual coordinate execution recovers contact controls and sends complete tied ranks to the existing report bridge', async () => {
  const f = fixture(), result = await exportCoordinateRanks(f.manifest, f.coordinates);
  assert.deepEqual(result.comparisonFields.rankings, [{ id: 'a-near', methodTier: 0, baselineTier: 0 }, { id: 'separated', methodTier: 1, baselineTier: 0 }, { id: 'z-near', methodTier: 0, baselineTier: 1 }]);
  assert.equal(result.comparisonFields.attempts.length, 4);
  for (const [id, kind] of [['a-near', 'near'], ['separated', 'separated']]) {
    const report = JSON.parse(result.reports[id]);
    const oracle = demo.cases.find(row => row.name === kind);
    assert.equal(report.audit.contactPairCount, oracle.residuePairs);
    assert.equal(report.audit.atomContactCount, oracle.atomContacts);
    assert.equal(report.auditPolicy.confidenceMode, 'none');
    assert.equal(report.pae, null);
    assert.equal(report.auditPolicy.sasaOrientation, 'deterministic-proper-signed-frame');
    assert.equal(report.structure.sourceFileSha256, sha(f.coordinates.get(id)));
  }
  const replay = await exportAuditReportRanks(result.reportManifest, new Map(Object.entries(result.reports).map(([id, json]) => [id, Buffer.from(json)])));
  assert.deepEqual(result.comparisonFields.rankings, replay.comparisonFields.rankings);
  assert.notEqual(result.comparisonFields.method.policySha256, replay.comparisonFields.method.policySha256);
  assert.equal(result.claims.currentAuditExecuted, true);
  for (const field of ['originalProducerExecutionVerified', 'biologicalRolesVerified', 'eligibilityVerified', 'independenceCertified', 'prelabelChronologyCertified', 'producerScoreSourcesVerified', 'frozenV3Compatible', 'completeExecutionClosureVerified', 'predictiveAccuracyMeasured']) assert.equal(result.claims[field], false);
});

test('wrong coordinate bytes reject and correctly reidentified changed coordinates are genuinely recomputed', async () => {
  const wrong = fixture(); wrong.coordinates.get('a-near')[0] = 32;
  await assert.rejects(exportCoordinateRanks(wrong.manifest, wrong.coordinates), /SHA-256/);
  const f = fixture(); replaceBytes(f, 'a-near', Buffer.from(demo.artifacts['synthetic-separated.pdb']));
  const result = await exportCoordinateRanks(f.manifest, f.coordinates);
  assert.equal(JSON.parse(result.reports['a-near']).audit.contactPairCount, 0);
  assert.equal(result.comparisonFields.rankings.find(row => row.id === 'a-near').methodTier, 1);
});

test('supplied features, reports, labels and ambiguous chain/model decisions cannot enter execution', async () => {
  for (const mutate of [
    f => { f.manifest.features = []; }, f => { f.manifest.reports = []; }, f => { f.manifest.outcomes = []; },
    f => { f.manifest.coordinates[0].chainRolesConfirmed = false; },
    f => { f.manifest.coordinates[0].receptorChain = 'X'; },
    f => { f.manifest.coordinates[0].selectedModelId = '99'; },
    f => { f.manifest.coordinates[0].assemblyId = '1'; },
    f => { f.manifest.coordinates[0].producerScore = Infinity; },
    f => { f.manifest.coordinates[0].coordinateBytes++; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(exportCoordinateRanks(f.manifest, f.coordinates)); }
});

test('membership and failure accounting reject omitted, duplicate, excluded and unexpected coordinates', async () => {
  for (const mutate of [
    f => f.coordinates.delete('a-near'),
    f => f.coordinates.set('extra', Buffer.from('extra')),
    f => f.manifest.coordinates.push({ ...f.manifest.coordinates[0] }),
    f => f.manifest.coordinates.pop(),
    f => { f.manifest.attempts[0].status = 'failed'; f.manifest.attempts[0].reason = 'Declared failure'; },
    f => { f.manifest.attempts[1].groupId = 'different'; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(exportCoordinateRanks(f.manifest, f.coordinates)); }
  const f = fixture();
  f.manifest.attempts = [f.manifest.attempts.at(-1)]; f.manifest.coordinates = []; f.coordinates.clear();
  const result = await exportCoordinateRanks(f.manifest, f.coordinates);
  assert.equal(result.provenance.coordinateCount, 0);
  assert.equal(result.claims.currentAuditExecuted, false);
  assert.equal(result.comparisonFields.attempts[0].status, 'failed');
});

test('missing producer scores withhold paired rankings without imputing a baseline', async () => {
  const f = fixture(); f.manifest.coordinates[0].producerScore = null;
  const result = await exportCoordinateRanks(f.manifest, f.coordinates);
  assert.equal(result.reportRankExport.rankExport.status, 'baseline-unavailable');
  assert.deepEqual(result.comparisonFields.rankings, []);
  assert.equal(Object.keys(result.reports).length, 3);
});

test('mutable caller buffers and manifest changes after invocation cannot change the captured execution', async () => {
  const f = fixture(), expected = sha(f.coordinates.get('a-near'));
  const pending = exportCoordinateRanks(f.manifest, f.coordinates);
  f.coordinates.get('a-near').fill(0); f.manifest.coordinates[0].receptorChain = 'X'; f.manifest.attempts.length = 0;
  const result = await pending;
  assert.equal(result.provenance.executionBindings.find(row => row.id === 'a-near').coordinateSha256, expected);
  assert.equal(result.comparisonFields.attempts.length, 4);
});

test('explicit model selection and equivalent mmCIF atoms preserve coordinate identity and contact semantics', async () => {
  const f = fixture(), atoms = parsePdb(demo.artifacts['synthetic-near.pdb']).atoms;
  const fields = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_asym_id', 'pdbx_PDB_model_num'];
  const rows = atoms.map((a, i) => ['ATOM', i + 1, a.element, a.name, '.', 'ALA', a.chainId, a.chainId === 'R' ? 1 : 2, a.residueNumber, '?', a.x, a.y, a.z, 1, 80, a.residueNumber, a.chainId, 7].join(' '));
  const cif = Buffer.from(`data_synthetic\nloop_\n${fields.map(f => `_atom_site.${f}`).join('\n')}\n${rows.join('\n')}\n#\n`);
  replaceBytes(f, 'a-near', cif); f.manifest.coordinates[0].format = 'mmcif'; f.manifest.coordinates[0].selectedModelId = '7';
  const result = await exportCoordinateRanks(f.manifest, f.coordinates), report = JSON.parse(result.reports['a-near']);
  assert.equal(report.structure.selectedModelId, '7');
  assert.equal(report.structure.sourceFileSha256, sha(cif));
  assert.equal(report.audit.contactPairCount, demo.cases[0].residuePairs);
});

test('coordinate CLI reads only declared regular files, rejects overwrite and strict JSON ambiguity, and retains replayable reports', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confovhh-coordinate-rank-'));
  try {
    const f = fixture(), inputs = path.join(directory, 'coordinates'), manifestPath = path.join(directory, 'manifest.json'), output = path.join(directory, 'receipt.json');
    await mkdir(inputs);
    for (const [id, bytes] of f.coordinates) await writeFile(path.join(inputs, `${id}.pdb`), bytes);
    await writeFile(manifestPath, JSON.stringify(f.manifest));
    const receipt = await runCoordinateRankExport(manifestPath, inputs, output);
    assert.equal(JSON.parse(await readFile(output)).inputSha256, sha(await readFile(manifestPath)));
    assert.equal(receipt.result.provenance.coordinateCount, 3);
    await assert.rejects(runCoordinateRankExport(manifestPath, inputs, output), /exists/);
    await writeFile(path.join(inputs, 'unexpected.pdb'), 'not a structure');
    await assert.rejects(runCoordinateRankExport(manifestPath, inputs, path.join(directory, 'unexpected.json')), /exactly/);
    await rm(path.join(inputs, 'unexpected.pdb'));
    const saved = path.join(directory, 'saved.pdb'); await writeFile(saved, f.coordinates.get('a-near'));
    await rm(path.join(inputs, 'a-near.pdb')); await symlink(saved, path.join(inputs, 'a-near.pdb'));
    await assert.rejects(runCoordinateRankExport(manifestPath, inputs, path.join(directory, 'symlink.json')), /regular/);
    await rm(path.join(inputs, 'a-near.pdb')); await writeFile(path.join(inputs, 'a-near.pdb'), f.coordinates.get('a-near'));
    await writeFile(manifestPath, JSON.stringify(f.manifest).replace('"studyId":', '"studyId":"duplicate","studyId":'));
    await assert.rejects(runCoordinateRankExport(manifestPath, inputs, path.join(directory, 'duplicate.json')), /duplicate/i);
    await writeFile(manifestPath, JSON.stringify(f.manifest));
    const cliOutput = path.join(directory, 'cli.json');
    const cli = spawnSync(process.execPath, ['scripts/paper/export-coordinate-ranks.mjs', `--input=${manifestPath}`, `--coordinates=${inputs}`, `--output=${cliOutput}`], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 30_000 });
    assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /predictive accuracy not measured/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
