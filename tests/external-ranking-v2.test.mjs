import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rankFeatures, scoreExternalManifest } from '../scripts/external-ranking/score.mjs';
import { ARMS, NEW_ARMS, preferredPercentiles, validateInput, extractAuditFeature, rankExperimental, scoreExperimental } from '../scripts/external-ranking-v2/score.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const manifest = (ids = ['a', 'b', 'c']) => ({ schema: 'confovhh-external-development-input-v1', studyId: 'test',
  generators: [{ id: 'producer', scoreName: 'energy', direction: 'lower-better' }],
  sets: [{ id: 'set', receptorChain: 'A', vhhChain: 'B', selectedModelId: '1' }],
  attempts: ids.map(id => ({ id, setId: 'set', generatorId: 'producer', status: 'generated', reason: '', coordinate: null, producerScore: null })) });
const sourceFeature = (id, changes = {}) => ({ id, setId: 'set', generatorId: 'producer', coordinateSha256: 'a'.repeat(64), evidenceTier: 1,
  burial: 100, shippedBurial: 100, contacts: 20, clashes: 1, overlapBurden: .2, producerScore: -10, ...changes });
const ledger = m => m.attempts.map(a => ({ id: a.id, setId: a.setId, generatorId: a.generatorId, producerStatus: 'generated', status: 'scored', reason: '', producerScoreStatus: 'present', producerScoreReason: '' }));
const expanded = (f, changes = {}) => ({ id: f.id, setId: f.setId, generatorId: f.generatorId, coordinateSha256: f.coordinateSha256, sourceFeature: structuredClone(f), sourceAuditSha256: 'b'.repeat(64),
  vhhNumberingStatus: 'numbered', paratopeProxyShare: .5, polarContactProxyCount: 10, polarContactProxyPerResiduePair: 10 / f.contacts,
  nonclashingContactDensity: (f.contacts - f.clashes) / f.burial, missingReasons: { P: '', F: '', D: '' }, ...changes });
function data(features = [sourceFeature('a'), sourceFeature('b'), sourceFeature('c')]) {
  const m = manifest(features.map(f => f.id)), attempts = ledger(m);
  return { sourceManifest: m, sourceFeatures: features, sourceAttempts: attempts, sourceRanks: rankFeatures(features, m, attempts), features: features.map(f => expanded(f)) };
}

test('preferred percentile uses exact average ordinal ties, singleton .5, and rejects incomplete sets', () => {
  assert.deepEqual(preferredPercentiles([9, 9, 5, 1]), [5 / 6, 5 / 6, 1 / 3, 0]);
  assert.deepEqual(preferredPercentiles([2, 2, 2]), [.5, .5, .5]);
  assert.deepEqual(preferredPercentiles([99]), [.5]);
  assert.throws(() => preferredPercentiles([1, null]), /complete/u);
  assert.throws(() => preferredPercentiles([1, NaN]), /complete/u);
  assert.throws(() => preferredPercentiles([]), /complete/u);
});

test('all seven fixed formulas honor producer direction and original five arms are unchanged', () => {
  const input = data([sourceFeature('a', { producerScore: -20, burial: 100 }), sourceFeature('b', { producerScore: -10, burial: 200 }), sourceFeature('c', { producerScore: 0, burial: 300 })]);
  input.features[0].paratopeProxyShare = .9; input.features[1].paratopeProxyShare = .1; input.features[2].paratopeProxyShare = .5;
  const result = rankExperimental(input);
  assert.equal(result.ranks.length, ARMS.length);
  assert.deepEqual(result.ranks.slice(0, 5), input.sourceRanks);
  const arm = name => result.ranks.find(r => r.arm === name);
  assert.deepEqual(arm('hybrid-SG').rows.map(r => r.key[0]), [.5, .5, .5]);
  assert.deepEqual(arm('hybrid-SG').selected, ['a', 'b', 'c']);
  assert.deepEqual(arm('G-paratope').rows.map(r => r.key[0]), [.5, .25, .75]);
  assert.deepEqual(arm('H-paratope').rows.map(r => r.key[0]), [.75, .375, .375]);
  assert.deepEqual(arm('G-polar').rows.map(r => r.key[0]), [.25, .5, .75]);
  assert.deepEqual(arm('H-polar').rows.map(r => r.key[0]), [.625, .5, .375]);
  assert.deepEqual(arm('G-density').rows.map(r => r.key[0]), [.5, .5, .5]);
  assert.deepEqual(arm('H-density').rows.map(r => r.key[0]), [.75, .5, .25]);
  const shuffled = { ...input, sourceManifest: { ...input.sourceManifest, attempts: [...input.sourceManifest.attempts].reverse() }, sourceFeatures: [...input.sourceFeatures].reverse(), sourceAttempts: [...input.sourceAttempts].reverse(), features: [...input.features].reverse() };
  assert.deepEqual(rankExperimental(shuffled), result);
});

test('one missing paratope component abstains full affected arm and never normalizes the remaining subset', () => {
  const input = data();
  Object.assign(input.features[1], { vhhNumberingStatus: 'unavailable', paratopeProxyShare: null, missingReasons: { P: 'Numbering unavailable', F: '', D: '' } });
  const result = rankExperimental(input);
  for (const name of ['G-paratope', 'H-paratope']) {
    const arm = result.ranks.find(r => r.arm === name);
    assert.equal(arm.status, 'abstain'); assert.deepEqual(arm.selected, []); assert.equal(arm.rows.length, 3);
    assert.ok(arm.rows.every(r => r.key === null && r.rank === null));
  }
  assert.ok(result.ranks.filter(r => !['G-paratope', 'H-paratope'].includes(r.arm)).every(r => r.status === 'ranked'));
  const percentile = result.percentiles.find(r => r.component === 'P');
  assert.deepEqual(percentile.rows.map(r => r.value), [.5, null, .5]);
  assert.ok(percentile.rows.every(r => r.percentile === null));
});

test('absent producer score only disables hybrid arms; zero burial/contact density is missing', () => {
  const input = data([sourceFeature('a'), sourceFeature('b', { producerScore: null }), sourceFeature('c')]);
  input.sourceAttempts[1].producerScoreStatus = 'missing'; input.sourceAttempts[1].producerScoreReason = 'No producer score';
  input.sourceRanks = rankFeatures(input.sourceFeatures, input.sourceManifest, input.sourceAttempts);
  const result = rankExperimental(input);
  for (const name of ['producer-score', 'hybrid-SG', 'H-paratope', 'H-polar', 'H-density']) assert.equal(result.ranks.find(r => r.arm === name).status, 'abstain');
  for (const name of ['G-paratope', 'G-polar', 'G-density']) assert.equal(result.ranks.find(r => r.arm === name).status, 'ranked');
  input.features[0].nonclashingContactDensity = null; input.features[0].missingReasons.D = 'No positive burial';
  const absent = rankExperimental(input);
  assert.equal(absent.ranks.find(r => r.arm === 'G-density').status, 'abstain');
});

test('strict selectors reject injected DockQ and unexpected fields at every exposed layer', () => {
  const original = data();
  const mutations = [
    d => { d.DockQ = .9; },
    d => { d.sourceManifest.DockQ = .9; },
    d => { d.sourceFeatures[0].DockQ = .9; },
    d => { d.sourceRanks[0].DockQ = .9; },
    d => { d.sourceRanks[0].rows[0].key = [.9]; },
    d => { d.sourceAttempts[0].DockQ = .9; },
    d => { d.sourceAttempts[0].setId = 'wrong-set'; },
    d => { d.sourceAttempts[0].generatorId = 'wrong-generator'; },
    d => { d.sourceAttempts[0].producerStatus = 'failed'; },
    d => { d.sourceAttempts[0].status = 'evaluation-failed'; },
    d => { d.features[0].DockQ = .9; },
    d => { d.features[0].missingReasons.DockQ = .9; },
    d => { d.features[0].sourceFeature.DockQ = .9; },
    d => { d.features[0].polarContactProxyPerResiduePair = .123; },
    d => { d.features[0].vhhNumberingStatus = 'unavailable'; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(original); mutate(copy); assert.throws(() => rankExperimental(copy)); }
  const request = { schema: 'confovhh-external-development-input-v2', studyId: 'test', sourceScoreReceipt: { path: 'scores/receipt.json', bytes: 100, sha256: 'a'.repeat(64) } };
  validateInput(request);
  assert.throws(() => validateInput({ ...request, DockQ: [] }), /fields/u);
  assert.throws(() => validateInput({ ...request, sourceScoreReceipt: { ...request.sourceScoreReceipt, path: '../receipt.json' } }), /path/u);
});

function pdb() {
  const line = (serial, atom, chain, n, x, y, z, element) => `ATOM  ${String(serial).padStart(5)} ${atom.padStart(4)} ALA ${chain}${String(n).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}  `;
  const rows = []; let serial = 1;
  for (const chain of ['A', 'B']) for (let res = 1; res <= 3; res += 1) for (const [name, x, y, element] of [['N', 0, 0, 'N'], ['CA', 1, .5, 'C'], ['C', 2, 0, 'C'], ['O', 2.5, -.6, 'O']]) rows.push(line(serial++, name, chain, res, x + (res - 1) * 3.7, y + (chain === 'A' ? 0 : 4), 0, element));
  return Buffer.from(`${rows.join('\n')}\nEND\n`);
}

test('hash-bound original scoring to new extraction/ranking roundtrip; audit tampering and receipt rewrite rejected', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'confovhh-external-v2-test-')));
  try {
    const coordinate = pdb(), score = Buffer.from('{"energy":-42}\n');
    await writeFile(path.join(temp, 'pose.pdb'), coordinate); await writeFile(path.join(temp, 'score.json'), score);
    const m = manifest(['a']);
    m.attempts[0].coordinate = { path: 'pose.pdb', bytes: coordinate.length, sha256: sha(coordinate), format: 'pdb' };
    m.attempts[0].producerScore = { path: 'score.json', bytes: score.length, sha256: sha(score), jsonPointer: '/energy' };
    const v1 = await scoreExternalManifest(m, temp, path.join(temp, 'v1'));
    const reportBytes = await readFile(path.join(temp, 'v1/a/audit.json'));
    const report = JSON.parse(reportBytes);
    const changedCensus = structuredClone(report); changedCensus.audit.contactPairCount += 1;
    assert.throws(() => extractAuditFeature(m.attempts[0], v1.features[0], changedCensus, sha(reportBytes)), /N\/C\/B/u);
    const injectedOutcome = structuredClone(report); injectedOutcome.audit.vhhNumbering.DockQ = .9;
    assert.throws(() => extractAuditFeature(m.attempts[0], v1.features[0], injectedOutcome, sha(reportBytes)), /Outcome/u);
    const numbered = structuredClone(report); numbered.audit.vhhNumbering.status = 'numbered'; numbered.audit.paratopeProxyShare = .7;
    assert.equal(extractAuditFeature(m.attempts[0], v1.features[0], numbered, sha(reportBytes)).paratopeProxyShare, .7);
    const zeroAreaFeature = { ...v1.features[0], burial: 0 }, zeroAreaReport = structuredClone(report);
    zeroAreaReport.audit.halfDeltaSasaInterfaceAreaAngstrom2 = 0;
    assert.equal(extractAuditFeature(m.attempts[0], zeroAreaFeature, zeroAreaReport, sha(reportBytes)).nonclashingContactDensity, null);
    const receipt = await readFile(path.join(temp, 'v1/receipt.json'));
    const input = { schema: 'confovhh-external-development-input-v2', studyId: 'test', sourceScoreReceipt: { path: 'v1/receipt.json', bytes: receipt.length, sha256: sha(receipt) } };
    const output = path.join(temp, 'v2');
    const result = await scoreExperimental(input, temp, output);
    assert.equal(result.ranks.length, 12); assert.deepEqual(result.ranks.slice(0, 5), v1.ranks);
    assert.equal(result.features[0].vhhNumberingStatus, 'unavailable');
    assert.ok(['G-paratope', 'H-paratope'].every(arm => result.ranks.find(r => r.arm === arm).status === 'abstain'));
    assert.ok(NEW_ARMS.filter(arm => !['G-paratope', 'H-paratope'].includes(arm)).every(arm => result.ranks.find(r => r.arm === arm).rows[0].key[0] === .5));
    assert.equal(result.receipt.sourceScoreReceiptSha256, sha(receipt));
    assert.deepEqual(result.receipt.outcomeInputs, []);
    assert.equal(result.features[0].nonclashingContactDensity, (v1.features[0].contacts - v1.features[0].clashes) / v1.features[0].burial);
    await assert.rejects(scoreExperimental(input, temp, output), /EEXIST/u);
    const wrongAdapterReceipt = JSON.parse(receipt); wrongAdapterReceipt.adapterSha256 = '0'.repeat(64);
    const wrongAdapterBytes = Buffer.from(`${JSON.stringify(wrongAdapterReceipt, null, 2)}\n`);
    await writeFile(path.join(temp, 'v1/wrong-adapter.json'), wrongAdapterBytes);
    const wrongAdapterInput = { ...input, sourceScoreReceipt: { path: 'v1/wrong-adapter.json', bytes: wrongAdapterBytes.length, sha256: sha(wrongAdapterBytes) } };
    await assert.rejects(scoreExperimental(wrongAdapterInput, temp, path.join(temp, 'wrong-adapter')), /original adapter/u);
    await writeFile(path.join(temp, 'v1/a/audit.json'), '{}\n');
    await assert.rejects(scoreExperimental(input, temp, path.join(temp, 'tampered')), /hash mismatch/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
