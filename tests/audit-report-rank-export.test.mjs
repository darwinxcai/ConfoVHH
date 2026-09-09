import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportAuditReportRanks } from '../scripts/paper/export-audit-report-ranks.mjs';
import { runReviewerDemo } from '../scripts/paper/reviewer-demo.mjs';
import { analyzeInterface, parsePdb } from '../lib/confovhh.ts';
import { createSingleAuditExportReport } from '../lib/audit-export.ts';
import { canonicalizeSelectedGeometry } from '../lib/geometry-fit.ts';
import { comparePairedSelection } from '../scripts/paper/compare-paired-selection.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
// Generated arbitrary atom arrangements, never a native or predicted complex.
const demo = runReviewerDemo();

function fixture() {
  const manifest = {
    schema: 'confovhh-audit-report-rank-input-v1', studyId: 'SYNTHETIC-AUDIT-RANK',
    generators: [{ id: 'generator', scoreName: 'synthetic-score', direction: 'higher-better' }],
    attempts: [], reports: [],
  };
  const reports = new Map();
  for (const [id, kind, producerScore] of [['a-near', 'near', 0.9], ['z-near', 'near', 0.2], ['separated', 'separated', 0.9]]) {
    const bytes = Buffer.from(demo.artifacts[`synthetic-${kind}.audit.json`]);
    const report = JSON.parse(bytes);
    manifest.attempts.push({ id, groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'generator', status: 'eligible', reason: '' });
    manifest.reports.push({ id, reportSha256: sha(bytes), coordinateSha256: report.structure.sourceFileSha256, coordinateBytes: report.structure.sourceFileBytes, receptorChain: 'R', vhhChain: 'V', selectedModelId: '1', producerScore });
    reports.set(id, bytes);
  }
  manifest.attempts.push({ id: 'failed', groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'generator', status: 'failed', reason: 'Synthetic generation failure' });
  return { manifest, reports };
}

function substitute(f, id, bytes) {
  f.reports.set(id, bytes);
  f.manifest.reports.find(row => row.id === id).reportSha256 = sha(bytes);
}

function alternateReport({ confidenceMode = 'none', canonical = false, withPae = false, kind = 'near' } = {}) {
  const pdb = demo.artifacts[`synthetic-${kind}.pdb`];
  const structure = parsePdb(pdb);
  const sasaStructure = canonical ? canonicalizeSelectedGeometry(structure, 'R', 'V') : null;
  const pae = withPae ? { matrix: new Float32Array(64), residueCount: 8, maxPaeAngstrom: 31.75, sourceFormat: 'AlphaFold predicted_aligned_error', filename: 'synthetic-pae.json' } : null;
  const audit = analyzeInterface(structure, 'R', 'V', confidenceMode, pae, withPae, sasaStructure);
  return encode(createSingleAuditExportReport({ filename: 'synthetic-near.pdb', coordinateSha256: sha(pdb), coordinateBytes: Buffer.byteLength(pdb), structure, receptorChain: 'R', vhhChain: 'V', chainIdentityConfirmed: true, pae, paeSha256: withPae ? 'f'.repeat(64) : null, paeOrderConfirmed: withPae, audit, generatedAt: '2026-09-08T00:00:00.000Z' }));
}

test('validated synthetic audit reports feed the shipped ranker with scientific ties and full attempt accounting', async () => {
  const f = fixture();
  const result = await exportAuditReportRanks(f.manifest, f.reports);
  assert.deepEqual(result.rankExport.rankings, [
    { id: 'a-near', methodTier: 0, baselineTier: 0 },
    { id: 'separated', methodTier: 1, baselineTier: 0 },
    { id: 'z-near', methodTier: 0, baselineTier: 1 },
  ]);
  assert.equal(result.rankExport.attempts.length, 4);
  assert.equal(result.rankExport.claims.sourceAuditsVerified, false);
  assert.equal(result.rankExport.claims.independenceCertified, false);
  assert.match(result.provenance.auditPolicySha256, /^[a-f0-9]{64}$/);
  assert.equal(result.provenance.auditPolicy.confidenceMode, 'none');
  assert.equal(result.provenance.auditPolicy.pae, 'omitted');
});

test('report-byte mismatch and declared coordinate, chain or model mismatches reject', async () => {
  for (const mutate of [
    f => { f.reports.get('a-near')[0] = 32; },
    f => { f.manifest.reports[0].coordinateSha256 = 'a'.repeat(64); },
    f => { f.manifest.reports[0].coordinateBytes++; },
    f => { f.manifest.reports[0].receptorChain = 'V'; f.manifest.reports[0].vhhChain = 'R'; },
    f => { f.manifest.reports[0].selectedModelId = '2'; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports));
  }
});

test('freshly rehashed edits still must pass the production report validator', async () => {
  for (const mutate of [
    r => { r.audit.contactPairCount++; },
    r => { r.audit.evidenceLevel = 'supported'; },
    r => { r.structure.chainIdentityConfirmed = false; },
    r => { r.auditPolicy.sasaSpherePoints++; },
  ]) {
    const f = fixture(); const report = JSON.parse(f.reports.get('a-near'));
    mutate(report); substitute(f, 'a-near', encode(report));
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports));
  }
});

test('geometry-only export rejects confidence inputs and mixed legitimate audit frames', async () => {
  for (const options of [{ confidenceMode: 'plddt' }, { withPae: true }, { canonical: true }]) {
    const f = fixture(); substitute(f, 'a-near', alternateReport(options));
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports), /policy|geometry|confidence|PAE|frame/i);
  }
});

test('comparison method identity binds the upstream audit policy, not only the final rank transformation', async () => {
  const source = fixture(); const canonical = fixture();
  for (const row of canonical.manifest.reports) substitute(canonical, row.id, alternateReport({ canonical: true, kind: row.id === 'separated' ? 'separated' : 'near' }));
  const a = await exportAuditReportRanks(source.manifest, source.reports);
  const b = await exportAuditReportRanks(canonical.manifest, canonical.reports);
  assert.notEqual(a.provenance.auditPolicySha256, b.provenance.auditPolicySha256);
  assert.deepEqual(a.rankExport.method, b.rankExport.method, 'Underlying feature-rank policy is unchanged');
  assert.notEqual(a.comparisonFields.method.policySha256, b.comparisonFields.method.policySha256);
  assert.deepEqual(a.comparisonFields.rankings, a.rankExport.rankings);
  assert.deepEqual(a.comparisonFields.attempts, a.rankExport.attempts);
  assert.deepEqual(a.comparisonFields.generators, a.rankExport.generators);
  assert.deepEqual(a.comparisonFields.baseline, a.rankExport.baseline);
});

test('strict parsing rejects duplicate keys, invalid UTF-8, extra outcomes and supplied features', async () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{"schemaVersion":"1.2.0","schemaVersion":"1.2.0"}')]) {
    const f = fixture(); substitute(f, 'a-near', bytes);
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports));
  }
  for (const extra of ['features', 'outcomes']) {
    const f = fixture(); f.manifest[extra] = [];
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports));
  }
});

test('missing, additional, duplicate and excluded report membership rejects without dropping failures', async () => {
  for (const mutate of [
    f => { f.reports.delete('a-near'); },
    f => { f.reports.set('unknown', f.reports.get('a-near')); },
    f => { f.manifest.reports.push(structuredClone(f.manifest.reports[0])); },
    f => { f.manifest.reports[0].id = 'failed'; f.reports.set('failed', f.reports.get('a-near')); f.reports.delete('a-near'); },
    f => { f.manifest.attempts[0].status = 'ineligible'; f.manifest.attempts[0].reason = 'Synthetic prior exclusion'; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(exportAuditReportRanks(f.manifest, f.reports));
  }
});

test('caller mutation after invocation cannot change checked report bytes or ranking provenance', async () => {
  const f = fixture(); const expected = await exportAuditReportRanks(f.manifest, f.reports);
  const pending = exportAuditReportRanks(f.manifest, f.reports);
  f.manifest.reports[0].producerScore = -100;
  f.reports.get('a-near').fill(0);
  f.reports.clear();
  assert.deepEqual(await pending, expected);
});

test('missing producer confidence remains unavailable and is not recovered from report geometry', async () => {
  const f = fixture(); f.manifest.reports[0].producerScore = null;
  const result = await exportAuditReportRanks(f.manifest, f.reports);
  assert.equal(result.rankExport.status, 'baseline-unavailable');
  assert.deepEqual(result.rankExport.rankings, []);
  assert.equal(result.rankExport.methodRanks.length, 3);
});

test('CLI reads only declared ID files, refuses symlinks/traversal and never overwrites output', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'confovhh-audit-rank-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reports = path.join(root, 'reports'); await mkdir(reports);
  const input = path.join(root, 'input.json'); const output = path.join(root, 'receipt.json');
  const f = fixture(); await writeFile(input, encode(f.manifest));
  for (const [id, bytes] of f.reports) await writeFile(path.join(reports, `${id}.json`), bytes);
  // Directory membership is checked before any unlisted object can be read.
  await symlink(path.join(root, 'missing-target'), path.join(reports, 'unlisted.json'));
  const run = () => spawnSync(process.execPath, ['scripts/paper/export-audit-report-ranks.mjs', `--input=${input}`, `--reports=${reports}`, `--output=${output}`], { cwd: ROOT, encoding: 'utf8' });
  let result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /exactly.*declared/i);
  await rm(path.join(reports, 'unlisted.json'));
  result = run(); assert.equal(result.status, 0, result.stderr);
  const original = await readFile(output);
  result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /EEXIST|exist/i);
  assert.deepEqual(await readFile(output), original);
  await rm(output);
  const source = path.join(reports, 'a-near.json'); await rm(source);
  await symlink(path.join(reports, 'z-near.json'), source);
  result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink|regular/i);
  f.manifest.reports[0].id = '../escape'; await writeFile(input, encode(f.manifest));
  result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /ID|identity|report|id/i);
});

test('preserved synthetic reports, policy-bound rankings and separately supplied labels replay as one workflow', async () => {
  const directory = path.join(ROOT, 'paper/evidence/audit-report-rank-synthetic-2026-09-08');
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const reports = new Map();
  for (const row of manifest.reports) {
    const bytes = await readFile(path.join(directory, 'reports', `${row.id}.json`));
    const kind = row.id === 'separated' ? 'separated' : 'near';
    assert.equal(bytes.toString(), demo.artifacts[`synthetic-${kind}.audit.json`], 'Saved reports reproduce from generated synthetic coordinates');
    reports.set(row.id, bytes);
  }
  const expected = JSON.parse(await readFile(path.join(directory, 'rank-receipt.json')));
  assert.equal(expected.inputSha256, sha(manifestBytes));
  const replay = await exportAuditReportRanks(manifest, reports);
  assert.deepEqual(replay, expected.result);
  const comparisonBytes = await readFile(path.join(directory, 'comparison-input.json'));
  const comparison = JSON.parse(comparisonBytes);
  assert.deepEqual(comparison.outcomes, JSON.parse(await readFile(path.join(directory, 'synthetic-outcomes.json'))));
  for (const [key, value] of Object.entries(replay.comparisonFields)) assert.deepEqual(comparison[key], value);
  const comparisonReceipt = JSON.parse(await readFile(path.join(directory, 'comparison-receipt.json')));
  assert.equal(comparisonReceipt.inputSha256, sha(comparisonBytes));
  assert.deepEqual(comparePairedSelection(comparison), comparisonReceipt.report);
  assert.equal(replay.claims.biologicalValidation, false);
  assert.equal(replay.claims.censusIndependenceCertified, false);
});
