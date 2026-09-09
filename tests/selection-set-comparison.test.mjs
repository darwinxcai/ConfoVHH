import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareSelectionSets, runSelectionSetComparisonFile } from '../scripts/paper/compare-selection-sets.mjs';

function empty() {
  return {
    schema: 'confovhh-selection-sets-v1', studyId: 'SYNTHETIC-ONLY',
    positiveOutcomeDefinition: 'Arbitrary binary arithmetic controls; no biological meaning.',
    method: { name: 'test-method', policySha256: '1'.repeat(64) },
    baseline: { name: 'test-baseline', policySha256: '2'.repeat(64) },
    targets: [{ id: 't1', groupId: 'g1' }],
    generators: [{ id: 'gen-a', conditionIds: ['c1'] }],
    selectionSets: [], attempts: [], rankings: [], outcomes: [],
  };
}
function addSet(input, { id = 'set1', targetId = 't1', generatorId = 'gen-a', conditionId = 'c1', seed = 7, delta = 1, labels = [1, 0], method = delta === -1 ? [1, 0] : [0, 1], baseline = delta === 1 ? [1, 0] : [0, 1] } = {}) {
  input.selectionSets.push({ id, targetId, generatorId, conditionId, seed, plannedCandidates: labels.length });
  for (let index = 0; index < labels.length; index++) {
    const candidateId = `${id}.${index}`;
    input.attempts.push({ id: candidateId, groupId: input.targets.find(row => row.id === targetId).groupId, targetId, generatorId, selectionSetId: id, status: 'eligible', reason: '' });
    input.rankings.push({ id: candidateId, methodTier: method[index], baselineTier: baseline[index] });
    input.outcomes.push({ id: candidateId, positive: labels[index] });
  }
  return input;
}
function fixture() { return addSet(empty()); }
function exclude(input, ids, status = 'failed') {
  const excluded = new Set(ids);
  for (const row of input.attempts) if (excluded.has(row.id)) { row.status = status; row.reason = 'Synthetic failure or exclusion, retained in accounting.'; }
  input.rankings = input.rankings.filter(row => !excluded.has(row.id));
  input.outcomes = input.outcomes.filter(row => !excluded.has(row.id));
}

test('selection-set boundaries prevent pooling from changing the scientific question', () => {
  const input = addSet(empty(), { labels: [1, 0, 0], method: [0, 1, 2], baseline: [1, 0, 2] });
  addSet(input, { id: 'seed2', seed: 19, labels: [1, 0, 0], method: [0, 0, 0], baseline: [0, 1, 1] });
  const result = compareSelectionSets(input);
  assert.equal(result.selectionSets.find(set => set.id === 'set1').values.delta, 1);
  assert.ok(Math.abs(result.selectionSets.find(set => set.id === 'seed2').values.delta + 2 / 3) < 1e-12);
  assert.equal(result.primary.method, 2 / 3);
  assert.equal(result.primary.baseline, 0.5);
  assert.ok(Math.abs(result.primary.delta - 1 / 6) < 1e-12);
  // Even with locally normalized tiers and full ties, pooling weights jobs by
  // their different tie sizes and changes +1/6 into zero.
  const label = id => input.outcomes.find(row => row.id === id).positive;
  const pooled = key => {
    const best = Math.min(...input.rankings.map(row => row[key]));
    const tied = input.rankings.filter(row => row[key] === best);
    return tied.reduce((sum, row) => sum + label(row.id), 0) / tied.length;
  };
  assert.equal(pooled('methodTier') - pooled('baselineTier'), 0);
  assert.equal(result.declaredTargetCount, 1);
  assert.equal(result.declaredGroupCount, 1);
});

test('equal condition, generator, target and group weights resist unequal seed counts', () => {
  const input = empty();
  input.targets = [{ id: 't1', groupId: 'g1' }, { id: 't2', groupId: 'g1' }, { id: 't3', groupId: 'g2' }];
  input.generators = [{ id: 'gen-a', conditionIds: ['c1', 'c2'] }, { id: 'gen-b', conditionIds: ['c1'] }];
  for (const target of input.targets) for (const generator of input.generators) for (const conditionId of generator.conditionIds) {
    const delta = target.id === 't3' ? -1 : target.id === 't2' ? 0 : generator.id === 'gen-a' && conditionId === 'c2' ? -1 : 1;
    const replicates = target.id === 't1' && generator.id === 'gen-a' && conditionId === 'c2' ? 3 : 1;
    for (let seed = 0; seed < replicates; seed++) addSet(input, { id: `${target.id}.${generator.id}.${conditionId}.${seed}`, targetId: target.id, generatorId: generator.id, conditionId, delta, seed });
  }
  const result = compareSelectionSets(input);
  assert.deepEqual(result.groups.map(group => group.values.delta), [0.25, -1]);
  assert.equal(result.primary.delta, -0.375);
  assert.equal(result.groups[0].targets[0].generators[0].values.delta, 0);
  assert.equal(result.groups[0].targets[0].values.delta, 0.5);
  assert.ok(Math.abs(result.selectionSets.reduce((sum, set) => sum + set.primaryWeight, 0) - 1) < 1e-12);
  // Another identical seed in that condition cannot give the condition or target more weight.
  addSet(input, { id: 'extra-seed', conditionId: 'c2', seed: 99, delta: -1 });
  const replicated = compareSelectionSets(input);
  assert.deepEqual(replicated.primary, result.primary);
  assert.equal(replicated.declaredGroupCount, 2);
  assert.equal(replicated.declaredTargetCount, 3);
});

test('ties use the entire best tier and are independent of candidate order or labels in IDs', () => {
  const input = addSet(empty(), { labels: [1, 0, 0], method: [0, 0, 0], baseline: [0, 1, 1] });
  const result = compareSelectionSets(input);
  // The six permutations put the sole positive first exactly twice.
  const permutations = [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 1]];
  assert.equal(result.primary.method, permutations.filter(row => row[0] === 1).length / permutations.length);
  assert.equal(result.selectionSets[0].method.tiedCandidates, 3);
  for (const collection of [input.attempts, input.rankings, input.outcomes, input.selectionSets, input.targets, input.generators]) collection.reverse();
  assert.deepEqual(compareSelectionSets(input), result);
  for (const collection of [input.attempts, input.rankings, input.outcomes]) for (const row of collection) row.id = `renamed.${row.id}`;
  assert.deepEqual(compareSelectionSets(input).primary, result.primary);
});

test('additional worse-ranked candidates do not change selection-set weights', () => {
  const input = fixture();
  addSet(input, { id: 'seed2', seed: 19, delta: -1 });
  const initial = compareSelectionSets(input);
  for (let i = 0; i < 100; i++) {
    const id = `extra.${i}`;
    input.attempts.push({ ...input.attempts[0], id });
    input.rankings.push({ id, methodTier: 99, baselineTier: 99 });
    input.outcomes.push({ id, positive: 1 });
    input.selectionSets[0].plannedCandidates++;
  }
  const result = compareSelectionSets(input);
  assert.deepEqual(result.primary, initial.primary);
  assert.deepEqual(result.selectionSets.map(set => set.primaryWeight), initial.selectionSets.map(set => set.primaryWeight));
});

test('all-positive and all-negative sets remain primary; mixed secondary preserves original weights', () => {
  const input = fixture();
  input.targets.push({ id: 't2', groupId: 'g1' }, { id: 't3', groupId: 'g2' });
  addSet(input, { id: 'all-positive', targetId: 't2', labels: [1, 1] });
  addSet(input, { id: 'all-negative', targetId: 't2', labels: [0, 0] });
  addSet(input, { id: 'other-mixed', targetId: 't3', delta: -1 });
  const result = compareSelectionSets(input);
  assert.equal(result.primary.delta, -0.25);
  assert.equal(result.selectionSets.length, 4);
  assert.deepEqual(result.selectionSets.filter(set => !set.mixedOutcomes).map(set => set.values.delta), [0, 0]);
  assert.equal(result.mixedSecondary.selectionSetCount, 2);
  assert.equal(result.mixedSecondary.declaredGroupCount, 2);
  assert.equal(result.mixedSecondary.primaryWeightFraction, 0.75);
  assert.equal(result.mixedSecondary.values.delta, -1 / 3);
  assert.equal(result.primary.delta, result.mixedSecondary.primaryWeightFraction * result.mixedSecondary.values.delta);
  for (const row of input.outcomes) row.positive = 0;
  const noMixed = compareSelectionSets(input);
  assert.equal(noMixed.primary.delta, 0);
  assert.equal(noMixed.mixedSecondary.values, null);
  assert.equal(noMixed.mixedSecondary.status, 'no-mixed-outcome-selection-sets');
});

test('partial candidate failure is accounted for without claiming scheduled-job yield', () => {
  const input = fixture();
  exclude(input, ['set1.1']);
  const result = compareSelectionSets(input);
  assert.equal(result.primary.method, 1);
  assert.equal(result.inventory.failed, 1);
  assert.equal(result.selectionSets[0].recordedAttempts, 2);
  assert.equal(result.selectionSets[0].eligibleCandidates, 1);
  assert.equal(result.attemptAccounting.find(row => row.id === 'set1.1').reason, input.attempts[1].reason);
  assert.equal(result.claims.scheduledJobYieldEstimated, false);
});

test('an entirely failed selection set blocks primary and mixed aggregate without being deleted', () => {
  const input = fixture();
  addSet(input, { id: 'no-output', seed: 23 });
  exclude(input, ['no-output.0', 'no-output.1']);
  const result = compareSelectionSets(input);
  assert.equal(result.status, 'incomplete-no-aggregate');
  assert.equal(result.inventory.selectionSets, 2);
  assert.equal(result.inventory.failed, 2);
  assert.equal(result.selectionSets.find(set => set.id === 'no-output').status, 'no-eligible-candidates');
  assert.equal(result.primary, null);
  assert.equal(result.mixedSecondary.values, null);
  assert.equal(result.mixedSecondary.primaryWeightFraction, null);
  assert.equal(result.mixedSecondary.selectionSetCount, 1);
  assert.ok(Object.values(result.claims).every(value => value === false));
  assert.equal(result.uncertainty.deltaInterval, null);
});

test('unrecorded candidates and undeclared cells cannot silently shrink the denominator', () => {
  const input = fixture();
  input.attempts.pop(); input.rankings.pop(); input.outcomes.pop();
  let result = compareSelectionSets(input);
  assert.equal(result.primary, null);
  assert.equal(result.inventory.unrecordedAttempts, 1);
  assert.equal(result.selectionSets[0].status, 'incomplete-attempt-inventory');
  assert.equal(result.selectionSets[0].mixedOutcomes, null);
  assert.equal(result.selectionSets[0].values, null);
  input.generators[0].conditionIds.push('c2');
  result = compareSelectionSets(input);
  assert.deepEqual(result.inventory.missingTargetGeneratorConditionCells, [{ groupId: 'g1', targetId: 't1', generatorId: 'gen-a', conditionId: 'c2' }]);
  const noJobs = compareSelectionSets(empty());
  assert.equal(noJobs.primary, null);
  assert.equal(noJobs.declaredTargetCount, 1);
  assert.equal(noJobs.inventory.missingTargetGeneratorConditionCells.length, 1);
});

test('unknown outcomes reject instead of becoming failure, even if ranks are complete', () => {
  for (const value of [null, undefined, 'unknown', false, 0.5, NaN]) {
    const input = fixture(); input.outcomes[0].positive = value;
    assert.throws(() => compareSelectionSets(input), /binary/);
  }
  const missing = fixture(); missing.outcomes.pop();
  assert.throws(() => compareSelectionSets(missing), /known outcome/);
});

test('rejects malformed inventory, cross-set membership, duplicate rows and extra fields', () => {
  const mutations = [
    x => x.targets.push({ ...x.targets[0] }),
    x => x.generators.push({ ...x.generators[0] }),
    x => x.selectionSets.push({ ...x.selectionSets[0] }),
    x => x.attempts.push({ ...x.attempts[0] }),
    x => x.rankings.push({ ...x.rankings[0] }),
    x => x.outcomes.push({ ...x.outcomes[0] }),
    x => { x.generators[0].conditionIds.push('c1'); },
    x => { x.selectionSets[0].targetId = 'unknown'; },
    x => { x.selectionSets[0].generatorId = 'unknown'; },
    x => { x.selectionSets[0].conditionId = 'unknown'; },
    x => { x.selectionSets[0].seed = -1; },
    x => { x.selectionSets[0].plannedCandidates = 1; },
    x => { x.selectionSets[0].plannedCandidates = 0; },
    x => { x.attempts[0].selectionSetId = 'unknown'; },
    x => { x.attempts[0].targetId = 'unknown'; },
    x => { x.attempts[0].generatorId = 'unknown'; },
    x => { x.attempts[0].groupId = 'other-group'; },
    x => { x.attempts[0].status = 'failed'; },
    x => { x.attempts[0].reason = 'An eligible row must not have an exclusion reason.'; },
    x => { x.rankings[0].methodTier = -1; },
    x => { x.rankings[0].baselineTier = 0.5; },
    x => x.rankings.pop(),
    x => x.outcomes.push({ id: 'unknown', positive: 1 }),
    x => { x.method.policySha256 = 'unbound'; },
    x => { x.positiveOutcomeDefinition = ''; },
    x => { x.certified = true; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => compareSelectionSets(input)); }
  const excluded = fixture();
  excluded.attempts[0].status = 'ineligible'; excluded.attempts[0].reason = 'Synthetic';
  assert.throws(() => compareSelectionSets(excluded), /Excluded attempts/);
});

test('file receipts bind input and implementation, reject overwrite and ambiguous JSON', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'selection-sets-synthetic-'));
  try {
    const inputPath = path.join(directory, 'input.json');
    const outputPath = path.join(directory, 'receipt.json');
    const bytes = JSON.stringify(fixture());
    await writeFile(inputPath, bytes);
    const receipt = await runSelectionSetComparisonFile(inputPath, outputPath);
    assert.equal(receipt.inputSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(receipt.evaluatorSha256, createHash('sha256').update(await readFile(new URL('../scripts/paper/compare-selection-sets.mjs', import.meta.url))).digest('hex'));
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), receipt);
    await assert.rejects(runSelectionSetComparisonFile(inputPath, outputPath), /EEXIST/);
    await writeFile(inputPath, bytes.replace('"positive":1', '"positive":0,"positive":1'));
    await assert.rejects(runSelectionSetComparisonFile(inputPath, path.join(directory, 'duplicate.json')));
    await writeFile(inputPath, Buffer.from([0xff]));
    await assert.rejects(runSelectionSetComparisonFile(inputPath, path.join(directory, 'invalid-utf8.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
