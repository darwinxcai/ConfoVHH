import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { extractProducerScoreSources, getProducerScorePolicy, PRODUCER_SCORE_EXTRACTORS } from '../scripts/paper/producer-score-sources.mjs';

// Generated nonbiological fixtures only. No holdout coordinates or outcomes.
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture({ id = 'attempt-0', extractor = 'af3-ranking-score-v1', value = { ranking_score: 0.83, iptm: 0.7 }, coordinatePath, text } = {}) {
  const boltz = extractor.startsWith('boltz-');
  coordinatePath ??= boltz ? 'predictions/toy/toy_model_0.cif' : 'toy/seed-7_sample-0/toy_seed-7_sample-0_model.cif';
  const sourcePath = boltz ? coordinatePath.replace(/([^/]+)\.(?:cif|pdb)$/u, 'confidence_$1.json') : coordinatePath.replace(/_model\.cif$/u, '_summary_confidences.json');
  const bytes = Buffer.from(text ?? JSON.stringify(value));
  const descriptor = { id, extractor, coordinatePath, coordinateSha256: sha('synthetic coordinate placeholder'),
    source: { path: sourcePath, sha256: sha(bytes), bytes: bytes.length } };
  return { descriptor, bytes, run: () => extractProducerScoreSources([descriptor], new Map([[id, bytes]])) };
}

test('extracts the reported AF3 rank, preserves negatives, and never reconstructs component scores', () => {
  for (const value of [-100, -99.2, 0, 0.83, 1.5]) {
    const input = fixture({ value: { ranking_score: value, iptm: 0.99, ptm: 0.99, fraction_disordered: 1, has_clash: false } });
    const receipt = input.run();
    assert.deepEqual(receipt.scores, [{ id: 'attempt-0', scoreName: 'alphafold3-ranking-score', direction: 'higher-better', value, missingReason: null }]);
    assert.equal(receipt.bindings[0].sourceSha256, sha(input.bytes));
    assert.equal(receipt.bindings[0].coordinateSha256, input.descriptor.coordinateSha256);
    assert.equal(receipt.bindings[0].jsonPointer, '/ranking_score');
    assert.equal(receipt.claims.originalProducerExecutionVerified, false);
    assert.equal(receipt.claims.coordinateBytesVerified, false);
  }
});

test('extracts Boltz confidence_score and explicitly selected whole-complex ipTM', () => {
  for (const [extractor, value, field] of [
    ['boltz-confidence-score-v1', { confidence_score: 0.76, iptm: 0.42 }, 'confidence_score'],
    ['boltz-iptm-v1', { confidence_score: 0.76, iptm: 0.42, protein_iptm: 0.9 }, 'iptm'],
    ['af3-iptm-v1', { ranking_score: 1.2, iptm: 0.6, chain_pair_iptm: [[1, 0.99], [0.99, 1]] }, 'iptm'],
  ]) {
    const receipt = fixture({ extractor, value }).run();
    assert.equal(receipt.scores[0].value, value[field]);
    assert.equal(receipt.bindings[0].jsonPointer, `/${field}`);
    assert.equal(receipt.scores[0].direction, 'higher-better');
  }
  assert.equal(fixture({ extractor: 'boltz-confidence-score-v1', value: { confidence_score: 0 }, coordinatePath: 'predictions/fold_job/fold_job_model_7.pdb' }).run().scores[0].value, 0);
});

test('missing file, missing field, explicit null and real zero remain distinct', () => {
  const inputs = [fixture({ id: 'missing-file' }), fixture({ id: 'missing-field', value: { ptm: 0.6 } }),
    fixture({ id: 'null-field', value: { ranking_score: null } }), fixture({ id: 'zero', value: { ranking_score: 0 } })];
  for (const input of inputs) {
    input.descriptor.coordinatePath = `${input.descriptor.id}/toy_model.cif`;
    input.descriptor.source.path = `${input.descriptor.id}/toy_summary_confidences.json`;
  }
  inputs[0].descriptor.source = null;
  const receipt = extractProducerScoreSources(inputs.map(row => row.descriptor), new Map(inputs.slice(1).map(row => [row.descriptor.id, row.bytes])));
  assert.deepEqual(receipt.scores.map(row => [row.id, row.value, row.missingReason]), [
    ['missing-field', null, 'missing-field'], ['missing-file', null, 'missing-file'], ['null-field', null, 'null-field'], ['zero', 0, null],
  ]);
  assert.deepEqual(receipt.missingness, { total: 4, available: 1, missingFile: 1, missingField: 1, nullField: 1 });
  assert.equal(receipt.verifiedSourceCount, 3);
});

test('verifies exact bytes, not merely equivalent JSON, and rejects incorrect byte counts', () => {
  const input = fixture();
  const changed = Buffer.from(input.bytes.toString().replace('0.83', '0.84'));
  assert.throws(() => extractProducerScoreSources([input.descriptor], new Map([['attempt-0', changed]])), /SHA-256 mismatch/u);
  input.descriptor.source.bytes += 1;
  assert.throws(input.run, /byte count mismatch/u);
  const spacing = fixture({ text: '{ "ranking_score": 0.83, "iptm": 0.7 }\n' });
  assert.notEqual(spacing.run().bindings[0].sourceSha256, sha(input.bytes));
});

test('rejects duplicate keys, escaped duplicate keys, nonfinite tokens and invalid JSON anywhere', () => {
  for (const text of [
    '{"ranking_score":0.1,"ranking_score":0.9}', '{"ranking_score":0.1,"ranking_\\u0073core":0.9}',
    '{"ranking_score":NaN}', '{"ranking_score":Infinity}', '{"ranking_score":1e999}',
    '{"ranking_score":0.5,"extra":{"x":1,"x":2}}', '{"ranking_score":0.5,"extra":1e999}',
    '{"ranking_score":-0}', '{"ranking_score":0.5} false', '{"ranking_score":0.5,}',
    '{"ranking_score":0.5,"text":"\\ud800"}', '\uFEFF{"ranking_score":0.5}',
  ]) assert.throws(fixture({ text }).run, /strict JSON/u, text);
  for (const value of [null, [], 0, 'text']) assert.throws(fixture({ value }).run, /JSON object/u);
});

test('rejects coercions and out-of-range scores rather than normalizing them', () => {
  for (const value of ['0.8', true, false, {}, [], -100.01, 1.5001]) {
    assert.throws(fixture({ value: { ranking_score: value } }).run, /Invalid alphafold3 ranking_score/u);
  }
  for (const value of [-0.001, 1.001, '0.8', true, []]) {
    assert.throws(fixture({ extractor: 'boltz-confidence-score-v1', value: { confidence_score: value } }).run, /Invalid boltz confidence_score/u);
    assert.throws(fixture({ extractor: 'af3-iptm-v1', value: { iptm: value } }).run, /Invalid alphafold3 iptm/u);
  }
  assert.throws(fixture({ value: { ranking_score: 0.5, iptm: 'bad' } }).run, /Invalid alphafold3 iptm/u);
});

test('forbids arbitrary score paths, caller scores and baseline-direction overrides', () => {
  for (const field of ['producerScore', 'direction', 'scoreName', 'jsonPointer']) {
    const input = fixture(); input.descriptor[field] = 0.9;
    assert.throws(input.run, /Unexpected or missing producer descriptor fields/u);
  }
  const unknown = fixture(); unknown.descriptor.extractor = 'custom-favorite-score';
  assert.throws(unknown.run, /Unsupported producer score extractor/u);
  const extra = fixture(); extra.descriptor.source.value = 0.9;
  assert.throws(extra.run, /Unexpected or missing producer source fields/u);
  assert.equal(fixture({ value: { scores: { ranking_score: 0.9 }, arbitrary_score: 0.7 } }).run().scores[0].missingReason, 'missing-field');
});

test('requires exact native filename, sample and directory association', () => {
  for (const path of [
    'toy/seed-7_sample-0/toy_seed-7_sample-1_summary_confidences.json',
    'other/toy_seed-7_sample-0_summary_confidences.json',
    'toy/seed-7_sample-0/toy_seed-7_sample-0_confidences.json',
  ]) {
    const input = fixture(); input.descriptor.source.path = path;
    assert.throws(input.run, /does not match/u);
  }
  const boltz = fixture({ extractor: 'boltz-confidence-score-v1', value: { confidence_score: 0.5 } });
  boltz.descriptor.source.path = 'predictions/toy/confidence_toy_model_1.json';
  assert.throws(boltz.run, /does not match/u);
  for (const coordinatePath of ['toy.pdb', 'fold_toy_model_0.cif', 'toy_model.pdb']) {
    const input = fixture(); input.descriptor.coordinatePath = coordinatePath;
    assert.throws(input.run, /Unsupported native local AF3/u);
  }
  assert.equal(fixture({ coordinatePath: 'job/job_model.cif' }).run().bindings[0].modelKey, 'job');
});

test('rejects path traversal and alias forms without silently normalizing them', () => {
  for (const path of ['/toy_model.cif', '../toy_model.cif', './toy_model.cif', 'a//toy_model.cif', 'C:/toy_model.cif', 'a\\toy_model.cif', 'a/../toy_model.cif', 'a\u202E/toy_model.cif']) {
    const input = fixture(); input.descriptor.coordinatePath = path;
    assert.throws(input.run, /path|JSON/u, path);
  }
});

test('requires exact byte membership, unique attempts and unique coordinate paths', () => {
  const input = fixture();
  assert.throws(() => extractProducerScoreSources([input.descriptor], new Map()), /membership/u);
  assert.throws(() => extractProducerScoreSources([input.descriptor], new Map([['other', input.bytes]])), /Unknown/u);
  assert.throws(() => extractProducerScoreSources([input.descriptor], { 'attempt-0': input.bytes }), /membership/u);
  assert.throws(() => extractProducerScoreSources([input.descriptor, input.descriptor], new Map()), /duplicate producer attempt/u);
  const duplicate = structuredClone(input.descriptor); duplicate.id = 'other';
  assert.throws(() => extractProducerScoreSources([input.descriptor, duplicate], new Map()), /Duplicate declared coordinate path/u);
  const boltz = fixture({ extractor: 'boltz-confidence-score-v1', value: { confidence_score: 0.5 } });
  const reused = structuredClone(boltz.descriptor); reused.id = 'other'; reused.coordinatePath = reused.coordinatePath.replace('.cif', '.pdb');
  assert.throws(() => extractProducerScoreSources([boltz.descriptor, reused], new Map()), /Duplicate declared producer source path/u);
  input.descriptor.source = null;
  assert.throws(input.run, /membership/u);
});

test('bounds count, size, nesting and aggregate bytes; forbids shared or text input', () => {
  const input = fixture();
  assert.throws(() => extractProducerScoreSources(Array(201).fill(input.descriptor), new Map()), /count/u);
  input.descriptor.source.bytes = 1_000_001;
  assert.throws(input.run, /byte count/u);
  const text = fixture();
  assert.throws(() => extractProducerScoreSources([text.descriptor], new Map([['attempt-0', text.bytes.toString()]])), /non-shared bytes/u);
  const shared = new Uint8Array(new SharedArrayBuffer(text.bytes.length)); shared.set(text.bytes);
  assert.throws(() => extractProducerScoreSources([text.descriptor], new Map([['attempt-0', shared]])), /non-shared bytes/u);
  assert.throws(fixture({ text: '{"ranking_score":0.5,"extra":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}' }).run, /nesting-depth/u);
  const largeText = '{"ranking_score":0.5,"unused":"' + 'a'.repeat(999_940) + '"}';
  const inputs = Array.from({ length: 17 }, (_, index) => fixture({ id: `attempt-${index}`, coordinatePath: `job${index}_model.cif`, text: largeText }));
  assert.throws(() => extractProducerScoreSources(inputs.map(row => row.descriptor), new Map(inputs.map(row => [row.descriptor.id, row.bytes]))), /combined 16 MB/u);
});

test('rejects invalid UTF-8 and malformed declared identities', () => {
  const input = fixture(); const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
  input.descriptor.source.bytes = bytes.length; input.descriptor.source.sha256 = sha(bytes);
  assert.throws(() => extractProducerScoreSources([input.descriptor], new Map([['attempt-0', bytes]])), /encoded data/u);
  const hash = fixture(); hash.descriptor.coordinateSha256 = 'bad'; assert.throws(hash.run, /coordinate SHA-256/u);
  const sourceHash = fixture(); sourceHash.descriptor.source.sha256 = 'bad'; assert.throws(sourceHash.run, /source SHA-256/u);
});

test('policy mapping is immutable and present for empty eligible populations', () => {
  const receipt = extractProducerScoreSources([], new Map());
  assert.deepEqual(receipt.scores, []);
  assert.equal(receipt.verifiedSourceCount, 0);
  assert.equal(receipt.policySha256.length, 64);
  assert.equal(getProducerScorePolicy('af3-ranking-score-v1').minimum, -100);
  assert.throws(() => { PRODUCER_SCORE_EXTRACTORS['af3-ranking-score-v1'].direction = 'lower-better'; }, TypeError);
  receipt.policy.extractors['af3-ranking-score-v1'].minimum = 0;
  assert.equal(getProducerScorePolicy('af3-ranking-score-v1').minimum, -100);
});

test('returned identities and values are stable after caller input mutation', () => {
  const input = fixture(); const receipt = input.run(); const expected = structuredClone(receipt);
  input.bytes.fill(0); input.descriptor.source.sha256 = 'b'.repeat(64); input.descriptor.coordinatePath = 'changed_model.cif';
  assert.deepEqual(receipt, expected);
  const access = fixture();
  Object.defineProperty(access.descriptor, 'extractor', { enumerable: true, get: () => 'af3-ranking-score-v1' });
  assert.throws(access.run, /inert data property/u);
});
