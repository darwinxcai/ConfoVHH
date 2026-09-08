import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runPhraseOnlyChunk } from '../scripts/hard-decoy-v3/capture-phrase-only-chunk.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = 'validation/hard-decoy-holdout-v3/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = relative => readFile(path.join(ROOT, relative));
const parse = async relative => JSON.parse(await read(relative));
const lines = bytes => String(bytes).trimEnd().split('\n');
const jsonRows = bytes => lines(bytes).map(line => JSON.parse(line));
// Validate actual identity and ordinal coverage, rather than only comparing counts.
function validateMembership(pending, packets, indices = [0, 1, 2]) {
  assert.equal(new Set(pending).size, pending.length, 'Duplicate original membership');
  assert.deepEqual(pending, [...pending].sort(), 'Original membership order changed');
  assert.deepEqual(packets.map(packet => packet.chunkIndex), indices, 'Missing or duplicate chunk');
  const union = [];
  for (const packet of packets) {
    assert.equal(new Set(packet.ids).size, packet.ids.length, 'Duplicate within packet');
    assert.deepEqual(packet.ids, pending.slice(packet.chunkIndex * 250, (packet.chunkIndex + 1) * 250), 'Packet ordinal membership differs');
    union.push(...packet.ids);
  }
  assert.equal(new Set(union).size, union.length, 'Duplicate across packets');
  assert.deepEqual(union, pending.slice(0, indices.length * 250), 'Union ordinal coverage differs');
  const captured = new Set(union);
  return { ids: union, remaining: pending.filter(id => !captured.has(id)) };
}

for (const [receiptName, indices, replayIndices] of [
  ['phrase-only-union-2026-09-08', [0, 1, 2], [1, 2]],
  ['phrase-only-union-through-003-2026-09-08', [0, 1, 2, 3], [3]],
  ['phrase-only-union-through-007-2026-09-08', [0, 1, 2, 3, 4, 5, 6, 7], [4, 5, 6, 7]],
]) {
const RECEIPT = `${BASE}${receiptName}/`;
const receipt = await parse(`${RECEIPT}summary.json`);
for (const chunkIndex of replayIndices) {
  test(`retained phrase-only chunk ${chunkIndex} replays exactly without network`, async () => {
    const packet = receipt.packets.find(row => row.chunkIndex === chunkIndex);
    assert.ok(packet);
    const expected = await parse(packet.snapshotBindings['summary.json'].path);
    const replay = await runPhraseOnlyChunk('verify', {
      repositoryRoot: ROOT,
      outputDirectory: path.join(ROOT, packet.packetPath),
      chunkIndex,
      fetchImpl: async () => { throw new Error('Offline evidence replay must not use network'); },
    });
    assert.deepEqual(replay, { ...expected, snapshotDirectory: path.posix.relative(packet.packetPath, packet.snapshotPath) });
    assert.equal(replay.status, 'CHUNK_REPEATED_METADATA_COMPLETE');
    assert.equal(replay.independentEligibleGroupsAdded, 0);
    assert.equal(replay.wholeCensusComponentUpperBound, null);
  });
}

test(`${indices.length}-packet union verifies exact evidence hashes and recomputes identity, polymer and review accounting`, async () => {
  const expectedChecksums = [];
  const inventory = indices.length === 8 ? ['README.md', 'lead-triage.json', 'summary.json'] : ['README.md', 'summary.json'];
  for (const name of inventory) expectedChecksums.push(`${sha(await read(`${RECEIPT}${name}`))}  ${name}\n`);
  assert.equal(String(await read(`${RECEIPT}checksums.sha256`)), expectedChecksums.join(''));
  const bindings = [...receipt.inputBindings, ...receipt.packets.flatMap(packet => [...Object.values(packet.bindings), ...Object.values(packet.snapshotBindings)])];
  for (const binding of bindings) {
    assert.ok(!path.isAbsolute(binding.path) && binding.path.split('/').every(part => part && !['.', '..'].includes(part)), 'Unsafe evidence path');
    const bytes = await read(binding.path);
    assert.equal(bytes.length, binding.bytes, `Evidence byte count differs: ${binding.path}`);
    assert.equal(sha(bytes), binding.sha256, `Evidence digest differs: ${binding.path}`);
  }
  const pendingBinding = receipt.inputBindings.find(row => row.path.endsWith('/phrase-only-pending-identifiers.txt'));
  assert.equal(pendingBinding.sha256, '0860b4bc5539ad90eed5868e7c173b0f541ae54e4b71b9e2e4f07ba431ec8b75');
  const pending = lines(await read(pendingBinding.path));
  assert.equal(pending.length, 12262);
  assert.equal(receipt.packets[0].snapshotPath, `${BASE}phrase-only-chunk-000-2026-09-08/snapshots/75aa996e3bdf68d433fb062ec9cc3e225b7cc12dc8583929518d9905af60cafe`);
  const packets = await Promise.all(receipt.packets.map(async packet => ({ chunkIndex: packet.chunkIndex, ids: lines(await read(packet.bindings['identifiers.txt'].path)) })));
  const union = validateMembership(pending, packets, indices);
  const totals = {};
  for (const packet of receipt.packets) {
    const ids = packets.find(row => row.chunkIndex === packet.chunkIndex).ids;
    const plan = await parse(packet.bindings['collection-plan.json'].path);
    assert.deepEqual(plan.selected, ids);
    assert.equal(plan.alreadyRetainedExclusionCount, 0);
    assert.equal(plan.selectedOrdinalStartInclusive, packet.selectedOrdinalStartInclusive);
    assert.equal(plan.selectedOrdinalEndExclusive, packet.selectedOrdinalEndExclusive);
    const summary = await parse(packet.snapshotBindings['summary.json'].path);
    const entries = jsonRows(await read(packet.snapshotBindings['entries.jsonl'].path));
    const accounting = jsonRows(await read(packet.snapshotBindings['identifier-accounting.jsonl'].path));
    const screens = jsonRows(await read(packet.snapshotBindings['entity-screens.jsonl'].path));
    const queue = jsonRows(await read(packet.snapshotBindings['review-queue.jsonl'].path));
    assert.deepEqual(entries.map(row => row.pdbId), ids);
    assert.deepEqual(accounting.map(row => row.pdbId), ids);
    assert.ok(accounting.every(row => row.status === 'CAPTURED_REPEATED_METADATA' && row.repeatAgreement));
    const entityIds = entries.flatMap(entry => entry.polymerEntities.map(entity => `${entry.pdbId}_${entity.entityId}`));
    assert.equal(new Set(entityIds).size, entityIds.length, 'Duplicate deposited entity');
    assert.deepEqual(screens.map(row => `${row.pdbId}_${row.entityId}`).sort(), [...entityIds].sort());
    assert.deepEqual(queue.map(row => `${row.pdbId}_${row.entityId}`).sort(), screens.filter(row => row.reviewQueueIncluded).map(row => `${row.pdbId}_${row.entityId}`).sort());
    assert.ok(entries.every(entry => entry.polymerEntityCountReported === entry.polymerEntities.length && entry.metadataCompleteness.polymerEntityCountMatches));
    const counts = {
      intendedIdentifiers: ids.length,
      capturedEntries: entries.length,
      completePolymerInventoryEntries: accounting.filter(row => row.status === 'CAPTURED_REPEATED_METADATA').length,
      polymerEntities: entityIds.length,
      proteinOrUnknownTypeEntities: screens.filter(row => row.proteinSequenceScreened).length,
      nonProteinEntities: screens.filter(row => !row.proteinSequenceScreened).length,
      reviewQueueEntities: queue.length,
      entitiesRequiringMissingNoncanonicalOrEngineErrorReview: screens.filter(row => row.metadataSequenceReviewRequired).length,
      numberedHeavyDomainEntities: screens.filter(row => row.numberedHeavyDomainCallCount > 0).length,
      successfulResponses: summary.savedSuccessfulResponseCount,
      failedAttempts: summary.retainedFailedAttemptCount,
    };
    assert.equal(counts.proteinOrUnknownTypeEntities + counts.nonProteinEntities, counts.polymerEntities);
    assert.deepEqual(counts, packet.counts);
    assert.equal(packet.packetLocalNotCapturedByThisChunkWithinPinnedRemainder, pending.length - entries.length);
    for (const [name, count] of Object.entries(counts)) totals[name] = (totals[name] ?? 0) + count;
  }
  assert.deepEqual(totals, receipt.union.counts);
  assert.equal(receipt.union.originalPhraseOnlyMembershipCount, pending.length);
  assert.equal(receipt.union.uniqueIntendedIdentifiers, new Set(union.ids).size);
  assert.equal(receipt.union.uniqueCapturedEntries, totals.capturedEntries);
  assert.equal(receipt.union.uniqueCompletelyInventoriedEntries, totals.completePolymerInventoryEntries);
  assert.equal(receipt.union.identifiersNotCapturedWithinPinnedPhraseOnlyMembership, union.remaining.length);
  assert.equal(receipt.union.identifiersNotCompletelyInventoriedWithinPinnedPhraseOnlyMembership, union.remaining.length);
  assert.equal(receipt.union.identifierStreamSha256, sha(`${union.ids.join('\n')}\n`));
  assert.equal(receipt.union.duplicateIdentifierCount, 0);
  assert.equal(receipt.authority.independentEligibleGroupsAdded, 0);
  assert.equal(receipt.authority.wholeCensusComponentUpperBound, null);
  assert.ok(Object.entries(receipt.authority).every(([key, value]) => ['independentEligibleGroupsAdded', 'wholeCensusComponentUpperBound'].includes(key) || value === false));
  assert.ok(Object.values(receipt.interpretation).every(value => typeof value === 'boolean'));
});

if (indices.length === 8) test('all eleven new heavy-domain leads retain complete inventories and unresolved formal dispositions', async () => {
  const triage = await parse(`${RECEIPT}lead-triage.json`);
  const screens = (await Promise.all(receipt.packets.filter(packet => packet.chunkIndex >= 4)
    .map(async packet => jsonRows(await read(packet.snapshotBindings['entity-screens.jsonl'].path))))).flat();
  const leads = screens.filter(row => row.numberedHeavyDomainCallCount > 0);
  const expected = [...new Set(leads.map(row => row.pdbId))].sort();
  assert.deepEqual(triage.entries.map(row => row.pdbId).sort(), expected);
  assert.equal(expected.length, 11);
  for (const binding of triage.inputBindings) {
    const bytes = await read(binding.path);
    assert.equal(bytes.length, binding.bytes);
    assert.equal(sha(bytes), binding.sha256);
  }
  for (const entry of triage.entries) {
    const packet = receipt.packets.find(row => row.chunkIndex === entry.chunkIndex);
    assert.equal(entry.sourceEntriesPath, packet.snapshotBindings['entries.jsonl'].path);
    const line = lines(await read(entry.sourceEntriesPath)).find(row => JSON.parse(row).pdbId === entry.pdbId);
    assert.equal(sha(line), entry.sourceEntryRawLineSha256);
    const deposited = JSON.parse(line);
    assert.equal(entry.completeInventory, true);
    assert.equal(deposited.polymerEntityCountReported, entry.allPolymerInventory.length);
    assert.deepEqual(entry.primaryCitation, deposited.primaryCitation);
    assert.deepEqual(entry.candidateEntityIds, leads.filter(row => row.pdbId === entry.pdbId).map(row => row.entityId));
    for (const [index, entity] of entry.allPolymerInventory.entries()) {
      const original = deposited.polymerEntities[index];
      for (const key of Object.keys(entity)) assert.deepEqual(entity[key], original[key]);
      assert.equal(sha(original.sequence), entity.sequenceSha256);
      assert.equal(original.sequence.length, entity.sequenceLength);
    }
    assert.equal(entry.formalDisposition, 'PENDING_DISPOSITION');
    assert.equal(entry.primaryPreparationReviewed, false);
    assert.equal(entry.directGpcrVhhCaseEstablished, false);
  }
  for (const id of ['25ST', '25SU']) {
    const entry = triage.entries.find(row => row.pdbId === id);
    assert.equal(entry.primaryCitation.doi, null);
    assert.equal(entry.primaryCitation.pmid, null);
    assert.ok(entry.allPolymerInventory.some(row => row.description === 'Single-chain variable fragment 16' && row.sequenceLength === 307));
    assert.ok(entry.allPolymerInventory.some(row => row.description === 'Taste receptor type 2 member 4'));
  }
  assert.ok(Object.entries(triage.authority).every(([key, value]) => key === 'independentEligibleGroupsAdded' ? value === 0 : value === false));
});

}

test('union rejects duplicate, omitted, substituted and shifted identifiers even when total counts agree', () => {
  const pending = Array.from({ length: 1000 }, (_, index) => String(index).padStart(4, '0'));
  const packets = [0, 1, 2].map(chunkIndex => ({ chunkIndex, ids: pending.slice(chunkIndex * 250, (chunkIndex + 1) * 250) }));
  assert.equal(validateMembership(pending, packets).ids.length, 750);
  for (const mutate of [
    rows => { rows[1].ids[10] = rows[1].ids[11]; },
    rows => { rows[1].ids[0] = rows[0].ids[0]; },
    rows => { rows[1].ids.splice(10, 1); },
    rows => { rows[1].ids[10] = pending[750]; },
    rows => { rows[1].ids = pending.slice(251, 501); },
    rows => { rows.splice(1, 1); },
    rows => { rows[2].chunkIndex = 1; },
  ]) {
    const mutated = structuredClone(packets);
    mutate(mutated);
    assert.throws(() => validateMembership(pending, mutated), /Duplicate|differs|Missing/);
  }
});
