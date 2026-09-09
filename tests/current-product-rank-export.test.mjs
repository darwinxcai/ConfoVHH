import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCurrentProductRanks } from '../scripts/paper/export-current-product-ranks.mjs';
import { comparePairedSelection } from '../scripts/paper/compare-paired-selection.mjs';

// Entirely synthetic feature rows: no coordinate, prediction or outcome input.
function fixture(spec = [['a', 'target', 'gen', 'supported', 100, 0.8]]) {
  const input = {
    schema: 'confovhh-current-product-rank-input-v1', studyId: 'SYNTHETIC-RANK-EXPORT',
    generators: [{ id: 'gen', scoreName: 'synthetic-confidence', direction: 'higher-better' }],
    attempts: [], features: [],
  };
  for (const [id, targetId, generatorId, evidenceLevel, burial, producerScore] of spec) {
    input.attempts.push({ id, groupId: 'declared-group', targetId, generatorId, status: 'eligible', reason: '' });
    input.features.push({
      id, auditArtifactSha256: 'a'.repeat(64), producerScore,
      audit: {
        evidenceLevel, contactPairCount: 1, receptorInterfaceResidues: 3,
        vhhInterfaceResidues: 3, halfDeltaSasaInterfaceAreaAngstrom2: burial,
        severeClashCount: 0, maximumOverlapAngstrom: 0, imgtNumberingStatus: null,
      },
    });
  }
  return input;
}
const index = rows => new Map(rows.map(row => [row.id, row]));

test('current product export preserves complete scientific ties and keeps burial within evidence tiers', async () => {
  const input = fixture([
    ['supported', 'target', 'gen', 'supported', 1, 1],
    ['mixed', 'target', 'gen', 'mixed', 10000, 1],
    ['z-limited', 'target', 'gen', 'limited', 700, 1],
    ['a-not-assessable', 'target', 'gen', 'not-assessable', 700, 1],
    ['zero', 'target', 'gen', 'limited', 0, 1],
    ['absent', 'target', 'gen', 'limited', null, 1],
  ]);
  const original = structuredClone(input);
  const result = await exportCurrentProductRanks(input);
  const ranks = index(result.rankings);
  assert.equal(result.status, 'rank-export-complete');
  assert.deepEqual(['supported', 'mixed', 'z-limited', 'a-not-assessable', 'zero', 'absent'].map(id => ranks.get(id).methodTier), [0, 1, 2, 2, 3, 4]);
  assert.ok(result.rankings.every(row => row.baselineTier === 0));
  const method = index(result.methodRanks);
  assert.equal(method.get('z-limited').evidenceTier, 0);
  assert.equal(method.get('a-not-assessable').evidenceTier, 0);
  assert.equal(method.get('absent').burialScore, null);
  assert.deepEqual(input, original, 'The adapter must not mutate the declared inventory or features');
  for (const rows of [input.attempts, input.features]) rows.reverse();
  const reordered = await exportCurrentProductRanks(input);
  assert.notEqual(reordered.provenance.canonicalInputSha256, result.provenance.canonicalInputSha256);
  assert.deepEqual(reordered.rankings, result.rankings);
  assert.deepEqual(reordered.methodRanks, result.methodRanks);
  assert.deepEqual(reordered.method, result.method);
  assert.deepEqual(reordered.baseline, result.baseline);
});

test('burial stays unquantized and null burial stays at the bottom of its own evidence tier', async () => {
  const input = fixture([
    ['small', 'target', 'gen', 'supported', 100, 1],
    ['larger', 'target', 'gen', 'supported', 100.0000000001, 1],
    ['missing', 'target', 'gen', 'supported', null, 1],
    ['lower-tier', 'target', 'gen', 'mixed', 100000, 1],
  ]);
  const result = await exportCurrentProductRanks(input);
  const ranks = index(result.rankings);
  assert.deepEqual(['larger', 'small', 'missing', 'lower-tier'].map(id => ranks.get(id).methodTier), [0, 1, 2, 3]);
  assert.equal(index(result.methodRanks).get('larger').burialScore, 100.0000000001);
});

test('current product assessability floors withhold burial while retaining the declared evidence tier', async () => {
  const input = fixture([
    ['floor', 'target', 'gen', 'supported', 100, 1],
    ['contacts-zero', 'target', 'gen', 'supported', 1000, 1],
    ['contacts-null', 'target', 'gen', 'supported', 1000, 1],
    ['receptor-short', 'target', 'gen', 'supported', 1000, 1],
    ['binder-short', 'target', 'gen', 'supported', 1000, 1],
    ['residues-null', 'target', 'gen', 'supported', 1000, 1],
  ]);
  const features = index(input.features);
  features.get('contacts-zero').audit.contactPairCount = 0;
  features.get('contacts-null').audit.contactPairCount = null;
  features.get('receptor-short').audit.receptorInterfaceResidues = 2;
  features.get('binder-short').audit.vhhInterfaceResidues = 2;
  features.get('residues-null').audit.vhhInterfaceResidues = null;
  const result = await exportCurrentProductRanks(input);
  for (const row of result.methodRanks) {
    assert.equal(row.evidenceTier, 2);
    assert.equal(row.methodTier, row.id === 'floor' ? 0 : 1);
    assert.equal(row.burialScore, row.id === 'floor' ? 100 : null);
  }
});

test('unknown or null evidence levels fail closed into tier zero without inventing evidence', async () => {
  const input = fixture([
    ['unknown', 'target', 'gen', 'unsupported-new-level', 100, 1],
    ['null', 'target', 'gen', null, 100, 1],
    ['limited', 'target', 'gen', 'limited', 100, 1],
  ]);
  const result = await exportCurrentProductRanks(input);
  assert.ok(result.methodRanks.every(row => row.evidenceTier === 0 && row.methodTier === 0));
});

test('baseline direction and ties apply independently within each target and generator', async () => {
  const input = fixture([
    ['high-a', 'target1', 'gen', 'supported', 100, 0.9],
    ['high-b', 'target1', 'gen', 'supported', 100, 0.9],
    ['low', 'target1', 'gen', 'supported', 100, 0.2],
    ['other-target', 'target2', 'gen', 'supported', 1, -100],
    ['low-best', 'target1', 'other', 'supported', 1, -3],
    ['high-worse', 'target1', 'other', 'supported', 1, 0.8],
  ]);
  input.generators.push({ id: 'other', scoreName: 'synthetic-error', direction: 'lower-better' });
  const result = await exportCurrentProductRanks(input);
  const ranks = index(result.rankings);
  assert.deepEqual(['high-a', 'high-b', 'low', 'other-target', 'low-best', 'high-worse'].map(id => ranks.get(id).baselineTier), [0, 0, 1, 0, 0, 1]);
  assert.ok(result.methodRanks.every(row => row.methodTier === 0));
});

test('missing producer scores block the entire paired export and retain every method rank', async () => {
  const input = fixture([
    ['available', 'target', 'gen', 'supported', 100, 0.9],
    ['missing', 'target', 'gen', 'limited', 10, null],
  ]);
  const result = await exportCurrentProductRanks(input);
  assert.equal(result.status, 'baseline-unavailable');
  assert.deepEqual(result.rankings, []);
  assert.deepEqual(result.missingProducerScoreIds, ['missing']);
  assert.deepEqual(new Set(result.methodRanks.map(row => row.id)), new Set(['available', 'missing']));
  assert.equal(index(result.methodRanks).get('available').methodTier, 0);
  assert.equal(index(result.methodRanks).get('missing').methodTier, 1);
  assert.deepEqual(result.attempts, input.attempts);
});

test('failed and ineligible inventory rows remain explicit even without any eligible stratum', async () => {
  const input = fixture([]);
  input.attempts.push(
    { id: 'failed', groupId: 'g', targetId: 't', generatorId: 'gen', status: 'failed', reason: 'Synthetic producer failure' },
    { id: 'excluded', groupId: 'g', targetId: 't', generatorId: 'gen', status: 'ineligible', reason: 'Synthetic prior exclusion' },
  );
  const result = await exportCurrentProductRanks(input);
  assert.deepEqual(new Set(result.attempts.map(row => row.id)), new Set(['failed', 'excluded']));
  assert.deepEqual(result.rankings, []);
  assert.deepEqual(result.methodRanks, []);
  assert.equal(result.claims.frozenV3Compatible, false);
  assert.equal(result.claims.independenceCertified, false);
  assert.equal(result.claims.sourceAuditsVerified, false);
});

test('rejects incomplete, duplicated, excluded or unknown feature membership and contradictory groups', async () => {
  const mutations = [
    x => x.features.pop(),
    x => x.features.push({ ...structuredClone(x.features[0]), id: 'unknown' }),
    x => x.features.push(structuredClone(x.features[0])),
    x => x.attempts.push(structuredClone(x.attempts[0])),
    x => { x.attempts[0].status = 'failed'; x.attempts[0].reason = 'Synthetic failure'; },
    x => { x.attempts[0].status = 'ineligible'; x.attempts[0].reason = 'Synthetic exclusion'; },
    x => x.attempts.push({ ...x.attempts[0], id: 'different-group', groupId: 'other-group', status: 'failed', reason: 'Synthetic failure' }),
    x => { x.attempts[0].generatorId = 'unknown'; },
    x => x.generators.push({ ...x.generators[0] }),
    x => { x.attempts[0].reason = 'Not empty'; },
    x => { x.attempts[0].status = 'failed'; x.attempts[0].reason = ''; x.features = []; },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    await assert.rejects(exportCurrentProductRanks(input));
  }
});

test('rejects malformed numbers, hashes, identifiers and extra fields including outcomes', async () => {
  const mutations = [
    x => { x.schema = 'unexpected'; },
    x => { x.studyId = ''; },
    x => { x.generators[0].direction = 'guess'; },
    x => { x.generators[0].scoreName = ''; },
    x => { x.features[0].auditArtifactSha256 = 'unverified'; },
    x => { x.features[0].auditArtifactSha256 = 'A'.repeat(64); },
    x => { x.features[0].producerScore = Infinity; },
    x => { x.features[0].producerScore = NaN; },
    x => { x.features[0].producerScore = '0.9'; },
    x => { x.features[0].audit.contactPairCount = -1; },
    x => { x.features[0].audit.receptorInterfaceResidues = 2.5; },
    x => { x.features[0].audit.vhhInterfaceResidues = Number.MAX_SAFE_INTEGER + 1; },
    x => { x.features[0].audit.severeClashCount = Infinity; },
    x => { x.features[0].audit.maximumOverlapAngstrom = -1; },
    x => { x.features[0].audit.halfDeltaSasaInterfaceAreaAngstrom2 = NaN; },
    x => { x.features[0].audit.halfDeltaSasaInterfaceAreaAngstrom2 = -1; },
    x => { x.features[0].audit.evidenceLevel = 1; },
    x => { x.features[0].audit.imgtNumberingStatus = {}; },
    x => { x.outcomes = []; },
    x => { x.features[0].positive = 1; },
    x => { x.features[0].audit.nativeOutcome = 1; },
    x => { x.attempts[0].certified = true; },
    x => { x.generators[0].extra = true; },
    x => { delete x.features[0].audit.contactPairCount; },
    x => { delete x.features[0].producerScore; },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    await assert.rejects(exportCurrentProductRanks(input));
  }
});

test('exports policy identities while explicitly withholding scientific and source attestation', async () => {
  const result = await exportCurrentProductRanks(fixture());
  for (const arm of [result.method, result.baseline]) {
    assert.equal(typeof arm.name, 'string');
    assert.match(arm.policySha256, /^[a-f0-9]{64}$/);
  }
  assert.notEqual(result.method.name, result.baseline.name);
  assert.deepEqual(result.generators, ['gen']);
  assert.deepEqual(result.missingProducerScoreIds, []);
  assert.equal(typeof result.provenance, 'object');
  assert.equal(result.claims.frozenV3Compatible, false);
  assert.equal(result.claims.independenceCertified, false);
  assert.equal(result.claims.sourceAuditsVerified, false);
});

test('async source verification cannot separate validated input from ranked and hashed input', async () => {
  const input = fixture();
  const expected = await exportCurrentProductRanks(input);
  const pending = exportCurrentProductRanks(input);
  // A caller can mutate its own object while source verification awaits I/O.
  // The adapter must already hold a detached snapshot of the validated input.
  input.features[0].audit.contactPairCount = -1;
  input.features[0].producerScore = null;
  input.studyId = 'invalid name after validation';
  input.generators[0].direction = 'invalid-direction';
  assert.deepEqual(await pending, expected);
});

test('exported scientific ties feed the paired evaluator without favorable identifier tie-breaking', async () => {
  const input = fixture([
    ['a', 'target', 'gen', 'supported', 100, 0.1],
    ['b', 'target', 'gen', 'supported', 100, 0.8],
    ['c', 'target', 'gen', 'supported', 100, 0.8],
  ]);
  input.attempts.push({ id: 'failed', groupId: 'declared-group', targetId: 'target', generatorId: 'gen', status: 'failed', reason: 'Synthetic failure' });
  const exported = await exportCurrentProductRanks(input);
  const report = comparePairedSelection({
    schema: 'confovhh-paired-selection-v1', studyId: exported.studyId,
    positiveOutcomeDefinition: 'Arbitrary synthetic arithmetic labels only.',
    method: exported.method, baseline: exported.baseline,
    generators: exported.generators, attempts: exported.attempts, rankings: exported.rankings,
    outcomes: [{ id: 'a', positive: 1 }, { id: 'b', positive: 0 }, { id: 'c', positive: 1 }],
  }, { seed: 7, bootstrapReplicates: 1000 });
  assert.equal(report.macro.method, 2 / 3);
  assert.equal(report.macro.baseline, 1 / 2);
  assert.equal(report.macro.delta, 2 / 3 - 1 / 2);
  assert.equal(report.attemptCounts.failed, 1);
  assert.equal(report.claims.nearNativeRankingValidated, false);
});
