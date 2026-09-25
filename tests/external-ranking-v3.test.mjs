import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scoreExternalManifest } from '../scripts/external-ranking/score.mjs';
import { BASE_ARMS, CALIBRATED_ARM, validateInput, validateCalibration, assessValidity, invalidValidity, emptyCdr, decomposeCdr, rankSourceFirst } from '../scripts/external-ranking-v3/policy.mjs';
import { scoreSourceFirst } from '../scripts/external-ranking-v3/score.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileBinding = filename => ({ path: filename, bytes: 1, sha256: 'a'.repeat(64) });
const manifest = ids => ({ schema: 'confovhh-external-development-input-v1', studyId: 'test', generators: [{ id: 'producer', scoreName: 'confidence', direction: 'higher-better' }],
  sets: [{ id: 'set', receptorChain: 'A', vhhChain: 'B', selectedModelId: '1' }], attempts: ids.map(id => ({ id, setId: 'set', generatorId: 'producer', status: 'generated', reason: '',
    coordinate: { ...fileBinding(id+'.pdb'), format: 'pdb' }, producerScore: { ...fileBinding(id+'.json'), jsonPointer: '/score' } })) });
const request = m => ({ schema: 'confovhh-source-first-input-v3', studyId: m.studyId, evaluationRole: 'development', sourceScoreReceipt: fileBinding('v1/receipt.json'),
  producerProfiles: [{ generatorId: 'producer', version: 'test-1', scoreContext: 'pair-confidence', scoreProvenance: null, calibration: null }],
  setPolicies: [{ setId: 'set', biologicalGroupId: 'group', receptorSequenceSha256: null, vhhSequenceSha256: null }] });

function structure(step = 3.8) {
  const chains = ['A', 'B'].map(id => ({ id, atomCount: 3, sequence: 'AAA', residues: [1, 2, 3].map(number => ({ number, insertionCode: '', atoms: [{ name: 'CA', x: step * number, y: id === 'A' ? 0 : 4, z: 0 }] })) }));
  return { chains, selectedModelId: '1', malformedAtomRecords: 0, duplicateAtomRecords: 0, residueNameConflicts: 0, zeroOccupancyAtomRecords: 0, ignoredHydrogens: 0, ignoredAlternateLocations: 0, unsupportedResidueRecords: 0 };
}

function cdrFeature(p = .5) {
  const count = Math.round(p*10);
  return decomposeCdr({ contactPairCount: 10, paratopeProxyShare: p, vhhNumbering: { status: 'numbered' }, contacts: Array.from({ length: 10 }, (_, i) => ({ receptorResidue: 'A:'+i, vhhResidue: 'B:'+i, vhhRegion: i < count ? 'CDR3-IMGT' : 'FR3-IMGT' })) });
}

function dataset(scores = [.9, .8, .7], paratopes = [.1, .8, .5]) {
  const sourceManifest = manifest(scores.map((_, i) => String.fromCharCode(97+i))), input = request(sourceManifest);
  const features = sourceManifest.attempts.map((a, i) => ({ id: a.id, setId: a.setId, generatorId: a.generatorId, producerStatus: a.status, coordinateSha256: a.coordinate.sha256, sourceAuditSha256: 'b'.repeat(64), contactEvidence: { kind: 'full-audit', sha256: 'b'.repeat(64) },
    source: { status: 'present', rawValue: scores[i], preferredValue: scores[i], reason: '', binding: a.producerScore },
    validity: assessValidity(structure(), sourceManifest.sets[0], input.setPolicies[0]), interface: { status: 'contacting', contactPairCount: 10 }, cdr: cdrFeature(paratopes[i]) }));
  return { input, sourceManifest, features, calibrations: {} };
}

function frozenGap(data, gap) {
  const profile = data.input.producerProfiles[0]; profile.scoreProvenance = fileBinding('provenance.json'); profile.calibration = fileBinding('gap.json');
  data.calibrations.producer = { schema: 'confovhh-source-gap-freeze-v1', calibrationId: 'frozen-dev-gap', generatorId: 'producer', producerVersion: profile.version, scoreContext: profile.scoreContext,
    scoreName: 'confidence', direction: 'higher-better', maximumPreferredScoreGap: gap, developmentGroupIds: ['group'], selectionRule: 'development-selected-tolerance-not-confidence-uncertainty', frozenAtUtc: '2026-09-24T00:00:00Z', evidenceSha256: 'c'.repeat(64) };
}

test('source-first exact floor never overrides unequal source scores; source ties use optional CDR only', () => {
  const input = dataset();
  const result = rankSourceFirst(input);
  assert.deepEqual(result.arms, BASE_ARMS);
  assert.ok(result.ranks.every(r => r.selected.join() === 'a'));
  const tied = dataset([.9, .9, .7], [.1, .8, .5]);
  const ranks = rankSourceFirst(tied).ranks;
  assert.deepEqual(ranks[0].selected, ['a', 'b']);
  assert.deepEqual(ranks[2].selected, ['b']);
  assert.deepEqual(ranks[2].rows.find(r => r.id === 'a').key, [.9, .1, .9]);
});

test('missing optional CDR falls back for its source block without dropping a candidate or unrelated blocks', () => {
  const input = dataset([.9, .9, .7]); input.features[1].cdr = emptyCdr('Optional numbering unavailable');
  const result = rankSourceFirst(input), arm = result.ranks[2];
  assert.equal(arm.status, 'ranked'); assert.deepEqual(arm.selected, ['a', 'b']);
  assert.equal(arm.rows.length, 3); assert.equal(arm.coverage.eligibleCount, 3);
  assert.ok(arm.rows.slice(0, 2).every(r => r.cdrAction === 'fallback-source-optional-cdr-unavailable'));
  assert.equal(result.blocks.find(b => b.ids.join() === 'a,b').action, 'fallback-source-optional-cdr-unavailable');
});

test('scientific ties and whole outputs survive shuffled inputs; equal P preserves source order within tolerance', () => {
  const input = dataset([1, 1, .875], [.5, .5, .9]);
  const first = rankSourceFirst(input);
  assert.deepEqual(first.ranks[2].selected, ['a', 'b']);
  const shuffled = structuredClone(input); shuffled.features.reverse(); shuffled.sourceManifest.attempts.reverse();
  assert.deepEqual(rankSourceFirst(shuffled), first);
  const near = dataset([1, .9375, .875], [.5, .5, .9]); frozenGap(near, .0625);
  assert.deepEqual(rankSourceFirst(near).ranks.find(r => r.arm === CALIBRATED_ARM).selected, ['a']);
});

test('frozen producer tolerance uses bounded anchored blocks, not chained near-tie transitivity', () => {
  const input = dataset([1, .9375, .875], [.1, .8, 1]); frozenGap(input, .0625);
  const result = rankSourceFirst(input), arm = result.ranks.find(r => r.arm === CALIBRATED_ARM);
  assert.deepEqual(result.ranks.find(r => r.arm === 'source-validity-cdr-exact').selected, ['a']);
  assert.deepEqual(arm.selected, ['b']);
  assert.deepEqual(result.blocks.filter(b => b.arm === CALIBRATED_ARM).map(b => b.ids), [['a', 'b'], ['c']]);
  assert.ok(result.blocks.every(b => b.sourceAnchor - b.minimumPreferredSource <= b.maximumPreferredScoreGap));
  assert.equal(arm.selectionPolicy.toleranceMode, 'development-selected-tolerance-not-confidence-uncertainty');
});

test('calibration forbids version/context mismatch, false uncertainty claims, and development-lineage reuse in sealed validation', () => {
  const input = dataset(); frozenGap(input, .01);
  const profile = input.input.producerProfiles[0], generator = input.sourceManifest.generators[0], record = input.calibrations.producer;
  validateCalibration(record, profile, generator, input.input);
  for (const changes of [{ producerVersion: 'different' }, { scoreContext: 'full-complex-confidence' }, { maximumPreferredScoreGap: Infinity }, { selectionRule: 'confidence-uncertainty' }, { DockQ: .9 }]) assert.throws(() => validateCalibration({ ...record, ...changes }, profile, generator, input.input));
  const sealed = structuredClone(input); sealed.input.evaluationRole = 'sealed-validation';
  assert.throws(() => rankSourceFirst(sealed), /overlaps/u);
  sealed.input.setPolicies[0].biologicalGroupId = 'unseen-group'; assert.equal(rankSourceFirst(sealed).arms.length, 4);
});

test('corrupt candidates remain visible in source baseline; validity exclusion and all-invalid selection are explicit', () => {
  const input = dataset(); input.features[0].validity = invalidValidity('duplicate-atom-identities'); input.features[0].interface = { status: 'invalid-input', contactPairCount: null }; input.features[0].cdr = emptyCdr('Invalid input');
  const result = rankSourceFirst(input);
  assert.deepEqual(result.ranks[0].selected, ['a']); assert.deepEqual(result.ranks[1].selected, ['b']);
  assert.equal(result.ranks[1].rows[0].status, 'excluded'); assert.equal(result.ranks[1].coverage.plannedCount, 3);
  for (const f of input.features) { f.validity = invalidValidity('unparseable-coordinate-or-model'); f.interface = { status: 'invalid-input', contactPairCount: null }; f.cdr = emptyCdr('Invalid input'); }
  const allInvalid = rankSourceFirst(input);
  assert.equal(allInvalid.ranks[0].status, 'ranked'); assert.equal(allInvalid.ranks[1].status, 'abstain');
  assert.match(allInvalid.ranks[1].reason, /No valid/u); assert.deepEqual(allInvalid.ranks[1].selected, []);
});

test('missing source on invalid inputs does not poison eligible valid candidates; missing eligible source abstains', () => {
  const input = dataset(), f = input.features[0];
  f.source = { ...f.source, status: 'missing', rawValue: null, preferredValue: null, reason: 'No source score' };
  f.validity = invalidValidity('unparseable-coordinate-or-model'); f.interface = { status: 'invalid-input', contactPairCount: null }; f.cdr = emptyCdr('Invalid input');
  const result = rankSourceFirst(input);
  assert.equal(result.ranks[0].status, 'abstain'); assert.equal(result.ranks[1].status, 'ranked'); assert.deepEqual(result.ranks[1].selected, ['b']);
  input.features[1].source = { ...input.features[1].source, status: 'invalid', rawValue: null, preferredValue: null, reason: 'Invalid source scalar' };
  assert.ok(rankSourceFirst(input).ranks.every(r => r.status === 'abstain' && r.selected.length === 0));
});

test('no-contact poses are valid and preserve ranking with unsupported-interface metadata', () => {
  const input = dataset();
  for (const f of input.features) { f.interface = { status: 'no-contact', contactPairCount: 0 }; f.cdr = decomposeCdr({ contactPairCount: 0, contacts: [], paratopeProxyShare: null, vhhNumbering: { status: 'numbered' } }); }
  const result = rankSourceFirst(input);
  assert.ok(result.ranks.every(r => r.status === 'ranked' && r.selected.join() === 'a' && r.interfaceSupport.status === 'unsupported-all-no-contact'));
  assert.ok(result.ranks.every(r => r.coverage.excludedCount === 0));
});

test('diagnostic backbone gaps never reject virtual chains; malformed identities and optional sequence mismatch do', () => {
  const m = manifest(['a']), policy = request(m).setPolicies[0];
  const stretched = assessValidity(structure(100), m.sets[0], policy);
  assert.equal(stretched.status, 'valid'); assert.equal(stretched.backboneDiagnostics[0].distanceGreaterThan5AngstromCount, 2);
  const duplicate = structure(); duplicate.duplicateAtomRecords = 1;
  assert.equal(assessValidity(duplicate, m.sets[0], policy).status, 'invalid');
  const nonfinite = structure(); nonfinite.chains[0].residues[0].atoms[0].x = NaN;
  assert.equal(assessValidity(nonfinite, m.sets[0], policy).status, 'invalid');
  assert.equal(assessValidity(structure(), { ...m.sets[0], vhhChain: 'A' }, policy).status, 'invalid');
  assert.equal(assessValidity(structure(), m.sets[0], { ...policy, receptorSequenceSha256: 'd'.repeat(64) }).status, 'invalid');
});

test('CDR/framework/unnumbered components preserve the total-interface denominator and expose extension confounding', () => {
  const audit = { contactPairCount: 4, paratopeProxyShare: .25, vhhNumbering: { status: 'numbered' }, contacts: ['CDR3-IMGT', 'FR2-IMGT', 'Unnumbered', 'Unnumbered'].map((vhhRegion, i) => ({ receptorResidue: 'A:'+i, vhhResidue: 'B:'+i, vhhRegion })) };
  const cdr = decomposeCdr(audit);
  assert.equal(cdr.paratopeProxyShare, .25); assert.equal(cdr.components.cdrShareAmongNumberedContacts, .5); assert.equal(cdr.components.unnumberedShareOfTotal, .5);
  assert.throws(() => decomposeCdr({ ...audit, paratopeProxyShare: .5 }), /differs/u);
  assert.throws(() => decomposeCdr({ ...audit, contacts: [...audit.contacts.slice(0, 3), audit.contacts[0]] }), /Duplicate/u);
});

test('strict interfaces reject injected outcomes, inconsistent integrity and source booleans', () => {
  const data = dataset();
  const mutations = [d => { d.DockQ = .9; }, d => { d.input.DockQ = .9; }, d => { d.features[0].source.DockQ = .9; }, d => { d.features[0].cdr.components.DockQ = .9; }, d => { d.features[0].validity.parserDiagnostics.duplicateAtomRecords = 1; }, d => { d.features[0].source.rawValue = true; }];
  for (const mutate of mutations) { const changed = structuredClone(data); mutate(changed); assert.throws(() => rankSourceFirst(changed)); }
  assert.throws(() => validateInput({ ...data.input, native: {} }), /fields/u);
  const lower = dataset([-20, -10, 0]); lower.sourceManifest.generators[0].direction = 'lower-better'; for (const f of lower.features) f.source.preferredValue = -f.source.rawValue;
  assert.deepEqual(rankSourceFirst(lower).ranks[0].selected, ['a']);
});

function pdb() {
  const line = (serial, atom, chain, n, x, y, z, element) => `ATOM  ${String(serial).padStart(5)} ${atom.padStart(4)} ALA ${chain}${String(n).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}  `;
  const rows = []; let serial = 1;
  for (const chain of ['A', 'B']) for (let res = 1; res <= 3; res += 1) for (const [name, x, y, element] of [['N', 0, 0, 'N'], ['CA', 1, .5, 'C'], ['C', 2, 0, 'C'], ['O', 2.5, -.6, 'O']]) rows.push(line(serial++, name, chain, res, x + (res - 1) * 3.7, y + (chain === 'A' ? 0 : 4), 0, element));
  return Buffer.from(`${rows.join('\n')}\nEND\n`);
}

test('end-to-end: recover source independently of failed coordinate scoring, preserve corrupt rows, and bind exclusive output', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'confovhh-source-first-v3-')));
  try {
    const bytes = pdb(), bad = Buffer.from('invalid coordinates\n'), sourceValues = { good: .7, bad: .99 };
    const m = manifest(['good', 'bad']);
    for (const attempt of m.attempts) {
      const coordinate = attempt.id === 'good' ? bytes : bad, score = Buffer.from(JSON.stringify({ score: sourceValues[attempt.id] })+'\n');
      await writeFile(path.join(temp, attempt.id+'.pdb'), coordinate); await writeFile(path.join(temp, attempt.id+'.json'), score);
      attempt.coordinate = { path: attempt.id+'.pdb', bytes: coordinate.length, sha256: sha(coordinate), format: 'pdb' };
      attempt.producerScore = { path: attempt.id+'.json', bytes: score.length, sha256: sha(score), jsonPointer: '/score' };
    }
    const v1 = await scoreExternalManifest(m, temp, path.join(temp, 'v1'));
    assert.equal(v1.features.length, 1);
    const receipt = await readFile(path.join(temp, 'v1/receipt.json')), input = request(m);
    input.sourceScoreReceipt = { path: 'v1/receipt.json', bytes: receipt.length, sha256: sha(receipt) };
    const output = path.join(temp, 'v3'), v3 = await scoreSourceFirst(input, temp, output);
    assert.equal(v3.receipt.sourceAvailableCount, 2); assert.equal(v3.receipt.sourceRecoveredWithoutV1CoordinateFeatureCount, 1);
    assert.deepEqual(v3.ranks[0].selected, ['bad']); assert.deepEqual(v3.ranks[1].selected, ['good']);
    assert.equal(v3.features.find(f => f.id === 'bad').validity.status, 'invalid');
    assert.equal(v3.ranks[1].rows.length, 2); assert.deepEqual(v3.receipt.outcomeInputs, []);
    assert.equal(v3.features.find(f => f.id === 'good').cdr.status, 'unavailable');
    assert.equal(v3.ranks[2].status, 'ranked');
    await assert.rejects(scoreSourceFirst(input, temp, output), /EEXIST/u);
    await writeFile(path.join(temp, 'bad.json'), '{"score":0.1}\n');
    const unavailable = await scoreSourceFirst(input, temp, path.join(temp, 'source-invalid'));
    assert.equal(unavailable.ranks[0].status, 'abstain'); assert.deepEqual(unavailable.ranks[1].selected, ['good']);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
