import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizePhraseResponse, phraseChunkContext, runPhraseOnlyChunk, selectPhraseChunk, retryAfterDelay } from '../scripts/hard-decoy-v3/capture-phrase-only-chunk.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const contract = JSON.parse(await readFile(path.join(ROOT, 'validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json'), 'utf8'));
function rawEntry(id) { return { rcsb_id: id, struct: { title: 'Synthetic metadata fixture' }, struct_keywords: null, exptl: [], rcsb_accession_info: null, rcsb_primary_citation: null,
  rcsb_entry_info: { experimental_method: null, resolution_combined: null, polymer_entity_count: 0 }, polymer_entities: [] }; }
const goodResponse = request => new Response(JSON.stringify({ data: { entries: JSON.parse(request.body).variables.ids.map(rawEntry) } }), { status: 200, headers: { 'content-type': 'application/json' } });
const source = (id, complete) => ({ pdbId: id, polymerEntities: complete ? [] : undefined, polymerEntityCountReported: complete ? 0 : null, metadataCompleteness: { polymerEntityCountMatches: complete } });

test('lexical chunk preserves original denominator and only exact complete metadata excludes IDs', () => {
  const result = selectPhraseChunk(['1AAA', '1AAB', '1AAC'], [{ source: 'complete', entries: [source('1AAA', true)] }, { source: 'sparse', entries: [source('1AAB', false)] }]);
  assert.equal(result.originalPendingCount, 3); assert.equal(result.alreadyRetainedExclusionCount, 1); assert.equal(result.operationalRemainderCount, 2);
  assert.deepEqual(result.selected, ['1AAB', '1AAC']); assert.deepEqual(result.incompleteExistingMetadataIdsNotExcluded, ['1AAB']);
  assert.equal(result.exclusions[0].sources[0].source, 'complete');
  const mixed = selectPhraseChunk(['1AAA', '1AAB'], [{ source: 'complete', entries: [source('1AAA', true)] }, { source: 'partial', entries: [source('1AAA', false), source('1AAC', false)] }]);
  assert.deepEqual(mixed.incompleteExistingMetadataIdsNotExcluded, []);
  assert.throws(() => selectPhraseChunk(['1AAB', '1AAA'], []), /sorted and unique/);
  assert.throws(() => selectPhraseChunk(['1AAA', '1AAA'], []), /sorted and unique/);
  assert.throws(() => selectPhraseChunk(['1AAA'], [], 1), /outside/);
  assert.throws(() => selectPhraseChunk(['1AAA'], [{ source: 'same', entries: [] }, { source: 'same', entries: [] }]), /Duplicate/);
});

test('saved first chunk has exact250-ID membership and immutable metadata-only request query', async () => {
  const ctx = await phraseChunkContext();
  assert.equal(ctx.plan.originalPendingCount, 12262); assert.equal(ctx.plan.completeKnownMetadataIdCount, 5574); assert.equal(ctx.plan.alreadyRetainedExclusionCount, 0);
  assert.equal(ctx.plan.selected.length, 250); assert.equal(ctx.plan.selected[0], '10DJ'); assert.equal(ctx.plan.selected.at(-1), '1CVF'); assert.equal(ctx.requests.length, 20);
  assert.equal(ctx.plan.sparseDevelopmentIdsAreExclusions, false); assert.equal(ctx.plan.scientificPreregistrationClaimed, false);
  for (const request of ctx.requests) { assert.equal(request.endpoint, 'https://data.rcsb.org/graphql'); assert.equal(JSON.parse(request.body).variables.ids.length, 25); assert.doesNotMatch(JSON.parse(request.body).query, /atom_site|Cartn_|coordinates|DockQ|CAPRI/u); }
});

test('normalizer rejects unexpected identifiers, duplicate keys, forbidden schema and non-title controls', () => {
  const request = { batchIndex: 1, ids: ['1AAA'] };
  assert.throws(() => normalizePhraseResponse(Buffer.from(JSON.stringify({ data: { entries: [rawEntry('1AAB')] } })), request, contract), /outside requested/);
  assert.throws(() => normalizePhraseResponse(Buffer.from('{"data":{"entries":[]},"data":{"entries":[]}}'), request, contract), /Duplicate|duplicate/);
  const unexpected = rawEntry('1AAA'); unexpected.native_pose = [];
  assert.throws(() => normalizePhraseResponse(Buffer.from(JSON.stringify({ data: { entries: [unexpected] } })), request, contract));
  const controls = rawEntry('1AAA'); controls.struct.title = 'Forbidden\ncontrol';
  assert.throws(() => normalizePhraseResponse(Buffer.from(JSON.stringify({ data: { entries: [controls] } })), request, contract), /outside citation/);
  const missing = normalizePhraseResponse(Buffer.from('{"data":{"entries":[null]}}'), request, contract);
  assert.deepEqual(missing.entries, []); assert.deepEqual(missing.missingIds, ['1AAA']);
});

test('failed batch stays in denominator; resume reuses successful responses and offline replay is exact', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phrase-resume-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const first = await runPhraseOnlyChunk('collect', { outputDirectory: directory, delay: async () => {}, fetchImpl: async () => { calls++; return new Response('temporarily forbidden synthetic fixture', { status: 403 }); } });
  assert.equal(calls, 1); assert.equal(first.pendingCaptureIdentifierCount, 250); assert.equal(first.retainedFailedAttemptCount, 1); assert.equal(first.capturedEntryCount, 0);
  const resumed = await runPhraseOnlyChunk('collect', { outputDirectory: directory, delay: async () => {}, fetchImpl: async (_url, request) => { calls++; return goodResponse(request); } });
  assert.equal(calls, 21); assert.equal(resumed.capturedEntryCount, 250); assert.equal(resumed.savedSuccessfulResponseCount, 20); assert.equal(resumed.retainedFailedAttemptCount, 1);
  const repeated = await runPhraseOnlyChunk('collect', { outputDirectory: directory, delay: async () => {}, fetchImpl: async () => { throw new Error('Network must not repeat successful captures'); } });
  assert.deepEqual(repeated, resumed); assert.deepEqual(await runPhraseOnlyChunk('verify', { outputDirectory: directory }), resumed);
  const requestFile = path.join(directory, 'requests/batch-001-repeat-1.json'); await writeFile(requestFile, '{}\n');
  await assert.rejects(runPhraseOnlyChunk('collect', { outputDirectory: directory, fetchImpl: async () => { throw new Error('No network permitted after drift'); } }), /Immutable file drift/);
});


test('Retry-After honors seconds/date and stops rather than exceeding a bounded wait', () => {
  const when = '2026-09-08T16:00:00.000Z';
  assert.deepEqual(retryAfterDelay('5', when, 2000), { milliseconds: 5000, exceedsRunBudget: false });
  assert.deepEqual(retryAfterDelay('Tue, 08 Sep 2026 16:00:10 GMT', when, 2000), { milliseconds: 10000, exceedsRunBudget: false });
  assert.equal(retryAfterDelay('120', when, 2000).exceedsRunBudget, true);
  assert.equal(retryAfterDelay('9'.repeat(400), when, 2000).exceedsRunBudget, true);
  assert.deepEqual(retryAfterDelay('invalid', when, 2000), { milliseconds: 2000, exceedsRunBudget: false });
});

test('long rate-limit request stops without retry and repeated partial inventories remain unresolved', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phrase-partial-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0, clock = '2026-09-08T16:00:00.000Z';
  const limited = await runPhraseOnlyChunk('collect', { outputDirectory: directory, now: () => clock, delay: async () => { throw new Error('Long server delay must stop rather than wait or retry'); }, fetchImpl: async () => { calls++; return new Response('synthetic rate limit', { status: 429, headers: { 'retry-after': '120' } }); } });
  assert.equal(calls, 1); assert.equal(limited.retainedFailedAttemptCount, 1); assert.equal(limited.intendedIdentifierCount, 250);
  const deferred = await runPhraseOnlyChunk('collect', { outputDirectory: directory, now: () => clock, delay: async () => { throw new Error('Must defer beyond run budget'); }, fetchImpl: async () => { throw new Error('Saved Retry-After must prevent immediate retry'); } });
  assert.deepEqual(deferred, limited);
  clock = '2026-09-08T16:02:01.000Z';
  const partial = await runPhraseOnlyChunk('collect', { outputDirectory: directory, now: () => clock, delay: async () => {}, fetchImpl: async (_url, request) => {
    const entries = JSON.parse(request.body).variables.ids.map(id => { const row = rawEntry(id); row.rcsb_entry_info.polymer_entity_count = 1; return row; });
    return new Response(JSON.stringify({ data: { entries } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(partial.status, 'CHUNK_REQUESTS_COMPLETE_WITH_PARTIAL_INVENTORIES'); assert.equal(partial.capturedEntryCount, 250); assert.equal(partial.completePolymerInventoryEntryCount, 0); assert.equal(partial.partialPolymerInventoryEntryCount, 250);
  assert.equal(partial.notCapturedByThisChunkWithinPinnedRemainder, 12012); assert.equal(partial.notCompletelyInventoriedByThisChunkWithinPinnedRemainder, 12262);
  assert.deepEqual(await runPhraseOnlyChunk('verify', { outputDirectory: directory }), partial);
});

test('real250-entry capture replays original provenance and revised offline finalization without network', async () => {
  const result = await runPhraseOnlyChunk('verify');
  assert.equal(result.status, 'CHUNK_REPEATED_METADATA_COMPLETE');
  assert.equal(result.originalPhraseOnlyPendingCount, 12262); assert.equal(result.capturedEntryCount, 250);
  assert.equal(result.completePolymerInventoryEntryCount, 250); assert.equal(result.partialPolymerInventoryEntryCount, 0);
  assert.equal(result.savedSuccessfulResponseCount, 20); assert.equal(result.retainedFailedAttemptCount, 0);
  assert.equal(result.screenSummary.polymerEntityCount, 449); assert.equal(result.screenSummary.distinctPresentSequencesScreened, 227);
  assert.equal(result.independentEligibleGroupsAdded, 0); assert.equal(result.wholeCensusComponentUpperBound, null);
  assert.equal(result.notCapturedByThisChunkWithinPinnedRemainder, 12012);
  const packet = path.join(ROOT, 'validation/hard-decoy-holdout-v3/phrase-only-chunk-000-2026-09-08');
  const plan = JSON.parse(await readFile(path.join(packet, 'collection-plan.json'), 'utf8'));
  assert.equal(plan.inputDigests['scripts/hard-decoy-v3/capture-phrase-only-chunk.mjs'].sha256, '58c01b08a5be6166016fa1d633ee20ae339aeb08dc70f6d501aeefb192e2804f');
});


test('legacy finalization refuses omission of the exact original snapshot', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phrase-original-required-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const original = path.join(ROOT, 'validation/hard-decoy-holdout-v3/phrase-only-chunk-000-2026-09-08');
  await cp(original, directory, { recursive: true });
  await rm(path.join(directory, 'snapshots/6b638a563f3c09da056ed70247316fa214958a23fa6097786c6c7cb847a94b2d'), { recursive: true });
  await assert.rejects(runPhraseOnlyChunk('collect', { outputDirectory: directory, fetchImpl: async () => { throw new Error('Missing original must not start new captures'); } }), /Original legacy snapshot is required/);
});
