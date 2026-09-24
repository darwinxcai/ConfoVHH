import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARMS, validateManifest, rankFeatures, overlapCensus, scoreExternalManifest } from '../scripts/external-ranking/score.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const manifest = (ids = ['a', 'b']) => ({ schema: 'confovhh-external-development-input-v1', studyId: 'test',
  generators: [{ id: 'producer', scoreName: 'confidence_score', direction: 'higher-better' }],
  sets: [{ id: 'set', receptorChain: 'A', vhhChain: 'B', selectedModelId: '1' }],
  attempts: ids.map(id => ({ id, setId: 'set', generatorId: 'producer', status: 'generated', reason: '', coordinate: null, producerScore: null })) });
const feature = (id, changes = {}) => ({ id, setId: 'set', generatorId: 'producer', coordinateSha256: 'a'.repeat(64), evidenceTier: 1, burial: 100, shippedBurial: 100, contacts: 20, clashes: 1, overlapBurden: 0.2, producerScore: 0.7, ...changes });
const ledger = m => m.attempts.map(a => ({ id: a.id, status: 'scored', reason: '' }));

test('manifest rejects reference/outcome injection, unsafe binding, duplicate IDs, and ambient Node injection', () => {
  assert.throws(() => validateManifest({ ...manifest(), DockQ: [] }), /fields/u);
  const bad = manifest(); bad.sets[0].nativeMask = [];
  assert.throws(() => validateManifest(bad), /fields/u);
  bad.sets[0] = manifest().sets[0]; bad.generators[0].scoreName = 'DockQ';
  assert.throws(() => validateManifest(bad), /outcome/u);
  const traversal = manifest(); traversal.attempts[0].coordinate = { path: '../escape.pdb', bytes: 1, sha256: 'a'.repeat(64), format: 'pdb' };
  assert.throws(() => validateManifest(traversal), /path/u);
  assert.throws(() => validateManifest(manifest(['a', 'a'])), /Duplicate/u);
  const old = process.env.NODE_OPTIONS;
  try { process.env.NODE_OPTIONS = '--test'; assert.throws(() => validateManifest(manifest()), /injection/u); }
  finally { if (old === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = old; }
  const extra = feature('a', { nativeContactCount: 20 });
  assert.throws(() => rankFeatures([extra], manifest(['a']), ledger(manifest(['a']))), /fields/u);
});

test('scientific ties and rank keys survive shuffled candidates; energies use declared direction without range restriction', () => {
  const m = manifest(['z', 'a', 'low']);
  m.generators[0] = { id: 'producer', scoreName: 'haddock-energy', direction: 'lower-better' };
  const features = [feature('z', { producerScore: -90 }), feature('a', { producerScore: -90 }), feature('low', { burial: 80, shippedBurial: 80, producerScore: 10 })];
  const expected = rankFeatures(features, m, ledger(m));
  assert.deepEqual(rankFeatures([...features].reverse(), { ...m, attempts: [...m.attempts].reverse() }, ledger(m).reverse()), expected);
  for (const arm of expected) assert.deepEqual(arm.selected, ['a', 'z']);
  assert.deepEqual(expected.find(r => r.arm === 'producer-score').rows.find(r => r.id === 'z').key, [90]);
  const altered = features.map(f => f.id === 'low' ? { ...f, evidenceTier: 2 } : f);
  assert.deepEqual(rankFeatures(altered, m, ledger(m)).find(r => r.arm === 'frozen-v06').selected, ['low']);
});

test('missing producer score and zero-contact graded formulas abstain without removing rows; shipped null burial remains ranked', () => {
  const m = manifest();
  const result = rankFeatures([feature('a'), feature('b', { producerScore: null, contacts: 0, clashes: 0, overlapBurden: null, burial: 0, shippedBurial: null, evidenceTier: 0 })], m, ledger(m));
  for (const arm of result) assert.equal(arm.rows.length, 2);
  for (const name of ['producer-score', 'clash-fraction-v1', 'overlap-burial-v1']) {
    assert.equal(result.find(r => r.arm === name).status, 'abstain');
    assert.deepEqual(result.find(r => r.arm === name).selected, []);
  }
  assert.equal(result.find(r => r.arm === 'frozen-v06').status, 'ranked');
  const failureLedger = ledger(m); failureLedger[1].status = 'evaluation-failed'; failureLedger[1].reason = 'Missing coordinate';
  const failed = rankFeatures([feature('a')], m, failureLedger);
  assert.ok(failed.every(r => r.status === 'abstain' && r.rows.length === 2 && r.rows[1].reason === 'Missing coordinate'));
});

test('all historical five-arm rank keys reproduce using frozen features, without opening native outcomes', async () => {
  const root = new URL('../validation/single-case-development-3p0g-2026-09-09/graded-clash-exploration-v1/results/', import.meta.url);
  const oldFeatures = JSON.parse(await readFile(new URL('features.json', root), 'utf8'));
  const oldRanks = JSON.parse(await readFile(new URL('ranks.json', root), 'utf8'));
  const m = manifest(oldFeatures.map(f => f.id));
  const features = oldFeatures.map(f => feature(f.id, { coordinateSha256: f.coordinateSha256, evidenceTier: f.evidenceTier, burial: f.burial, shippedBurial: f.burial, contacts: f.contacts, clashes: f.clashes, overlapBurden: f.overlapBurden, producerScore: f.confidence }));
  const actual = rankFeatures(features, m, ledger(m));
  assert.equal(actual.length, 5);
  for (const old of oldRanks) {
    const name = old.arm === 'predictor-confidence' ? 'producer-score' : old.arm;
    const row = actual.find(r => r.arm === name).rows.find(r => r.id === old.id);
    assert.deepEqual(row.key, old.key, `${old.arm}/${old.id} key`);
    assert.equal(row.rank, old.rank, `${old.arm}/${old.id} rank`);
  }
  assert.equal(oldRanks.length, 50);
});

test('brute-force overlap retains mild overlap severity and exempts only plausible CYS SG pairs', () => {
  const atom = (chain, residue, name, x, element = 'C', residueName = 'ALA') => ({ chainId: chain, residueKey: `${chain}:${residue}`, name, residueName, element, x, y: 0, z: 0 });
  const structure = { chains: [{ id: 'A', residues: [{ atoms: [atom('A', 1, 'CA', 0)] }] }, { id: 'B', residues: [{ atoms: [atom('B', 1, 'CA', 3)] }] }] };
  const mild = overlapCensus(structure, 'A', 'B');
  assert.equal(mild.contacts, 1); assert.equal(mild.clashes, 0);
  assert.ok(Math.abs(mild.overlapBurden - (0.4 / 0.6) ** 2) < 1e-14);
  structure.chains[0].residues[0].atoms = [atom('A', 1, 'SG', 0, 'S', 'CYS')];
  structure.chains[1].residues[0].atoms = [atom('B', 1, 'SG', 2.05, 'S', 'CYS')];
  const exempt = overlapCensus(structure, 'A', 'B');
  assert.equal(exempt.atomContacts, 1); assert.equal(exempt.overlapBurden, 0); assert.equal(exempt.clashes, 0);
});

function pdb() {
  const line = (serial, atom, chain, n, x, y, z, element) => `ATOM  ${String(serial).padStart(5)} ${atom.padStart(4)} ALA ${chain}${String(n).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}  `;
  const rows = []; let serial = 1;
  for (const chain of ['A', 'B']) for (let res = 1; res <= 3; res += 1) {
    const offset = chain === 'A' ? 0 : 4;
    for (const [name, x, y, element] of [['N', 0, 0, 'N'], ['CA', 1, 0.5, 'C'], ['C', 2, 0, 'C'], ['O', 2.5, -0.6, 'O']]) rows.push(line(serial++, name, chain, res, x + (res - 1) * 3.7, y + offset, 0, element));
  }
  return Buffer.from(`${rows.join('\n')}\nEND\n`);
}

test('actual frozen coordinate engine: valid audit, missing/invalid sources, and exclusive receipt creation', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'confovhh-external-test-')));
  try {
    const coord = pdb(), score = Buffer.from('{"iptm":0.82}\n');
    await writeFile(path.join(temp, 'pose.pdb'), coord); await writeFile(path.join(temp, 'score.json'), score);
    const m = manifest(['good', 'bad']);
    m.generators[0].scoreName = 'iptm';
    m.attempts[0].coordinate = { path: 'pose.pdb', format: 'pdb', bytes: coord.length, sha256: sha(coord) };
    m.attempts[0].producerScore = { path: 'score.json', bytes: score.length, sha256: '0'.repeat(64), jsonPointer: '/iptm' };
    m.attempts[1].coordinate = { path: 'absent.pdb', format: 'pdb', bytes: coord.length, sha256: sha(coord) };
    const output = path.join(temp, 'result');
    const result = await scoreExternalManifest(m, temp, output);
    assert.equal(result.features.length, 1);
    assert.equal(result.attempts.find(a => a.id === 'good').status, 'scored');
    assert.equal(result.attempts.find(a => a.id === 'good').producerScoreStatus, 'invalid');
    assert.equal(result.attempts.find(a => a.id === 'bad').status, 'evaluation-failed');
    assert.ok(result.ranks.every(r => r.status === 'abstain' && r.rows.length === 2));
    assert.deepEqual(result.receipt.outcomeInputs, []);
    assert.equal(result.receipt.attemptCount, 2);
    const oldReceipt = await readFile(path.join(output, 'receipt.json'));
    await assert.rejects(scoreExternalManifest(m, temp, output), /EEXIST/u);
    assert.deepEqual(await readFile(path.join(output, 'receipt.json')), oldReceipt);
    const valid = manifest(['good']); valid.generators[0].scoreName = 'iptm';
    valid.attempts[0].coordinate = m.attempts[0].coordinate;
    valid.attempts[0].producerScore = { ...m.attempts[0].producerScore, sha256: sha(score) };
    const accepted = await scoreExternalManifest(valid, temp, path.join(temp, 'valid'));
    assert.equal(accepted.features[0].producerScore, 0.82);
    assert.equal(accepted.ranks.length, ARMS.length);
    const badCoordinates = manifest(['bad']); badCoordinates.attempts[0].coordinate = { ...m.attempts[0].coordinate, sha256: 'f'.repeat(64) };
    const rejected = await scoreExternalManifest(badCoordinates, temp, path.join(temp, 'bad-coordinates'));
    assert.equal(rejected.features.length, 0); assert.match(rejected.attempts[0].reason, /hash mismatch/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
