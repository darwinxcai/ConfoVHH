import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { comparePairedSelection, runComparisonFile } from '../scripts/paper/compare-paired-selection.mjs';

function fixture(spec = [['g1', 't1', 1], ['g1', 't2', 0], ['g2', 't3', -1]]) {
  const input = {
    schema: 'confovhh-paired-selection-v1', studyId: 'SYNTHETIC-ONLY',
    positiveOutcomeDefinition: 'Arbitrary synthetic binary test labels; no biological meaning.',
    method: { name: 'test-method', policySha256: '1'.repeat(64) },
    baseline: { name: 'test-baseline', policySha256: '2'.repeat(64) },
    generators: ['gen-a', 'gen-b'], attempts: [], rankings: [], outcomes: [],
  };
  for (const [groupId, targetId, delta] of spec) for (const generatorId of input.generators) {
    for (let i = 0; i < 2; i++) {
      const id = `${targetId}.${generatorId}.${i}`;
      input.attempts.push({ id, groupId, targetId, generatorId, status: 'eligible', reason: '' });
      input.rankings.push({ id, methodTier: delta === -1 ? 1 - i : i, baselineTier: delta === 1 ? 1 - i : i });
      input.outcomes.push({ id, positive: 1 - i });
    }
  }
  return input;
}
const evaluate = input => comparePairedSelection(input, { seed: 7, bootstrapReplicates: 1000 });

test('paired top-1 uses generator then target then group weights, not pose counts', () => {
  const input = fixture();
  const result = evaluate(input);
  assert.deepEqual(result.groups.map(g => g.values.delta), [0.5, -1]);
  assert.equal(result.macro.delta, -0.25);
  assert.equal(result.macro.method, 0.5);
  assert.equal(result.macro.baseline, 0.75);
  assert.deepEqual(result.leaveOneGroupOut.map(g => g.delta), [-1, 0.5]);
  // Many worse-ranked positives must not give this stratum extra macro weight.
  for (let i = 0; i < 100; i++) {
    const id = `extra${i}`;
    input.attempts.push({ ...input.attempts[0], id });
    input.rankings.push({ id, methodTier: 99, baselineTier: 99 });
    input.outcomes.push({ id, positive: 1 });
  }
  assert.deepEqual(evaluate(input).macro, result.macro);
  const differentGenerators = fixture();
  for (const row of differentGenerators.rankings) if (row.id.startsWith('t1.gen-b')) [row.methodTier, row.baselineTier] = [row.baselineTier, row.methodTier];
  assert.equal(evaluate(differentGenerators).groups[0].values.delta, 0);
  assert.equal(evaluate(differentGenerators).macro.delta, -0.5);
});

test('tied first place agrees with exhaustive uniform permutations and ignores IDs', () => {
  const input = fixture([['g1', 't1', 1]]);
  for (const row of input.rankings) row.methodTier = 0;
  const result = evaluate(input);
  // Every permutation of two tied candidates gives first-position labels [1, 0].
  const exhaustiveExpected = [[1, 0], [0, 1]].reduce((sum, permutation) => sum + permutation[0], 0) / 2;
  assert.equal(result.macro.method, exhaustiveExpected);
  assert.equal(result.macro.delta, 0.5);
  assert.equal(result.uncertainty.deltaInterval, null);
  for (const collection of [input.attempts, input.rankings, input.outcomes]) {
    collection.reverse();
    for (const row of collection) row.id = `renamed.${row.id}`;
  }
  assert.deepEqual(evaluate(input), result);
});

test('paired resampling preserves a zero contrast for identical arms', () => {
  const input = fixture([['g1', 't1', 1], ['g2', 't2', -1], ['g3', 't3', 0]]);
  for (const row of input.rankings) row.baselineTier = row.methodTier;
  const result = evaluate(input);
  assert.equal(result.macro.delta, 0);
  assert.deepEqual(result.uncertainty.deltaInterval, [0, 0]);
  assert.ok(result.limitations.some(text => text.includes('degenerate')));
  assert.deepEqual(evaluate(input), result);
});

test('two singleton groups reproduce the exact bootstrap distribution endpoints', () => {
  const input = fixture([['g1', 't1', 1], ['g2', 't2', -1]]);
  // Exhaustive group resampling: means of (+1,+1), (+1,-1), (-1,+1), (-1,-1).
  assert.equal(evaluate(input).macro.delta, 0);
  assert.deepEqual(evaluate(input).uncertainty.deltaInterval, [-1, 1]);
  const swapped = structuredClone(input);
  for (const row of swapped.rankings) [row.methodTier, row.baselineTier] = [row.baselineTier, row.methodTier];
  assert.equal(evaluate(swapped).macro.delta, -evaluate(input).macro.delta || 0);
});

test('all-positive and all-negative strata stay in accounting without creating class diversity', () => {
  const input = fixture();
  for (const row of input.outcomes) row.positive = row.id.startsWith('t3') ? 0 : 1;
  const result = evaluate(input);
  assert.equal(result.macro.delta, 0);
  assert.equal(result.mixedOutcomeStrata, 0);
  assert.equal(result.declaredGroupsWithMixedOutcomeStrata, 0);
  assert.equal(result.strata.length, 6);
  assert.ok(Object.values(result.claims).every(value => value === false));
});

test('hierarchical interval agrees with an exhaustive small-population resampling oracle', () => {
  // One sampled group mean has probabilities: -1 (1/2), 0 (1/8), 0.5 (1/4), 1 (1/8).
  // This enumerates group selection and target resampling with integer multiplicities.
  const singleDraw = [-1, -1, -1, -1, 0, 0.5, 0.5, 1];
  const exhaustive = singleDraw.flatMap(a => singleDraw.map(b => (a + b) / 2)).sort((a, b) => a - b);
  const percentile = p => {
    const position = (exhaustive.length - 1) * p;
    const fraction = position % 1;
    return exhaustive[Math.floor(position)] * (1 - fraction) + exhaustive[Math.ceil(position)] * fraction;
  };
  const result = comparePairedSelection(fixture(), { seed: 7, bootstrapReplicates: 50000 });
  assert.deepEqual(result.uncertainty.deltaInterval, [percentile(0.025), percentile(0.975)]);
});

test('failed attempts are retained and empty or missing generator strata block aggregation', () => {
  const input = fixture();
  const failures = new Set(input.attempts.filter(row => row.targetId === 't1' && row.generatorId === 'gen-a').map(row => row.id));
  for (const row of input.attempts) if (failures.has(row.id)) { row.status = 'failed'; row.reason = 'synthetic failure'; }
  input.rankings = input.rankings.filter(row => !failures.has(row.id));
  input.outcomes = input.outcomes.filter(row => !failures.has(row.id));
  let result = evaluate(input);
  assert.equal(result.attemptCounts.failed, 2);
  assert.equal(result.status, 'incomplete-no-aggregate');
  assert.equal(result.macro, null);
  assert.equal(result.uncertainty.deltaInterval, null);
  assert.ok(result.strata.some(s => s.status === 'no-eligible-candidates'));
  input.attempts = input.attempts.filter(row => !failures.has(row.id));
  result = evaluate(input);
  assert.ok(result.strata.some(s => s.status === 'missing-generator-attempts'));
  assert.equal(result.macro, null);
});

test('rejects altered row membership, outcomes, ranks, grouping, and schemas', () => {
  const mutations = [
    x => x.outcomes.pop(), x => x.rankings.pop(),
    x => x.outcomes.push({ id: 'not-in-inventory', positive: 1 }),
    x => x.attempts.push({ ...x.attempts[0] }),
    x => x.rankings.push({ ...x.rankings[0] }),
    x => x.outcomes.push({ ...x.outcomes[0] }),
    x => { x.outcomes[0].positive = true; },
    x => { x.outcomes[0].positive = NaN; },
    x => { x.rankings[0].methodTier = -1; },
    x => { x.rankings[0].methodTier = 0.5; },
    x => { x.attempts[0].groupId = 'another-group'; },
    x => { x.attempts[0].status = 'ineligible'; x.attempts[0].reason = 'synthetic'; },
    x => { x.attempts[0].generatorId = 'unplanned-generator'; },
    x => { x.method.policySha256 = 'unbound'; },
    x => { x.positiveOutcomeDefinition = ''; },
    x => { x.independentGroupsCertified = true; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => evaluate(input)); }
  for (const options of [{ seed: 0 }, { bootstrapReplicates: 0 }, { bootstrapReplicates: 50001 }, { unplanned: true }]) assert.throws(() => comparePairedSelection(fixture(), options));
});

test('file replay binds exact bytes and implementation, refuses overwrite and ambiguous JSON', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'selection-synthetic-'));
  try {
    const inputPath = path.join(directory, 'input.json');
    const outputPath = path.join(directory, 'receipt.json');
    const bytes = JSON.stringify(fixture());
    await writeFile(inputPath, bytes);
    const receipt = await runComparisonFile(inputPath, outputPath);
    assert.equal(receipt.inputSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), receipt);
    assert.match(receipt.evaluatorSha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.strictJsonParserSha256, /^[a-f0-9]{64}$/);
    await assert.rejects(runComparisonFile(inputPath, outputPath), /EEXIST/);
    await writeFile(inputPath, bytes.replace('"positive":1', '"positive":0,"positive":1'));
    await assert.rejects(runComparisonFile(inputPath, path.join(directory, 'duplicate.json')));
    await writeFile(inputPath, Buffer.from([0xff]));
    await assert.rejects(runComparisonFile(inputPath, path.join(directory, 'utf8.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preserved synthetic receipt reproduces with the exact current implementation', async () => {
  const root = new URL('../', import.meta.url);
  const directory = new URL('paper/evidence/paired-selection-synthetic-2026-09-08/', root);
  const bytes = await readFile(new URL('input.json', directory));
  const receipt = JSON.parse(await readFile(new URL('receipt.json', directory), 'utf8'));
  const digest = data => createHash('sha256').update(data).digest('hex');
  assert.equal(receipt.inputSha256, digest(bytes));
  assert.equal(receipt.evaluatorSha256, digest(await readFile(new URL('scripts/paper/compare-paired-selection.mjs', root))));
  assert.equal(receipt.strictJsonParserSha256, digest(await readFile(new URL('scripts/hard-decoy/oracle/canonical-json.mjs', root))));
  assert.deepEqual(receipt.report, comparePairedSelection(JSON.parse(bytes)));
  assert.equal(receipt.report.macro.delta, -0.25);
  assert.equal(receipt.report.attemptCounts.failed, 1);
});
