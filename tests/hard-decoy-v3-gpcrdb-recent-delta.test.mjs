import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveRecentDelta, verifyRecentGpcrdbDelta } from "../scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, "validation/hard-decoy-holdout-v3");
const readJson = async (name) => JSON.parse(await readFile(path.join(BASE, name), "utf8"));
const sourceContract = await readJson("prelabel-census-draft/source-query-contract.json");
const entryContract = await readJson("entry-metadata-draft/entry-metadata-contract.json");
const gpcrdbRow = (await readJson("source-snapshot-2026-08-29/raw/gpcrdb-api-1.json")).find((row) => row.pdb_code === "5UZ7");
const rcsbRow = (await readJson("entry-metadata-snapshot-2026-08-29/raw/rcsb-entry-metadata-batch-001-repeat-1.json")).data.entries.find((row) => row.rcsb_id === "5UZ7");
const GPCRDB = "https://gpcrdb.org/services/structure/";
const RCSB = "https://data.rcsb.org/graphql";

function fixture(newToIndex = false) {
  const raw = new Map();
  const records = [];
  for (const repeat of [1, 2]) {
    records.push({ endpoint: GPCRDB, repeat, rawFile: `gpcrdb-${repeat}.json`, error: null });
    raw.set(`gpcrdb-${repeat}.json`, JSON.stringify([gpcrdbRow]));
    if (newToIndex) {
      records.push({ endpoint: RCSB, repeat, requestedIds: ["5UZ7"], rawFile: `rcsb-${repeat}.json`, error: null });
      raw.set(`rcsb-${repeat}.json`, JSON.stringify({ data: { entries: [rcsbRow] } }));
    }
  }
  return { source: { sourceContract, entryContract, baselineIds: newToIndex ? [] : ["5UZ7"], baselineRows: newToIndex ? [] : [gpcrdbRow] }, raw, records };
}

test("recent GPCRdb delta replays from archived bytes without rewriting evidence", async () => {
  const result = await verifyRecentGpcrdbDelta();
  assert.equal(result.baselineEntryCount, 1716);
  assert.equal(result.currentObservedEntryCount, 1716);
  assert.equal(result.newIndexEntryCount, 0);
  assert.equal(result.changedExistingMetadataEntryCount, 0);
  assert.equal(result.observedIndexDeltaCaptureComplete, true);
  assert.equal(result.allRecentPublicGpcrEntriesCovered, false);
  assert.equal(result.broaderDiscoveryComplete, false);
});

test("a failed inventory repeat leaves removal and discovery completeness unresolved", () => {
  const input = fixture();
  input.records.find((record) => record.repeat === 2).error = "HTTP 503";
  const result = deriveRecentDelta(input).summary;
  assert.equal(result.currentObservedEntryCount, 1);
  assert.equal(result.removedIndexEntryCount, null);
  assert.equal(result.gpcrdbIdentifierRepeatAgreement, false);
  assert.equal(result.observedIndexDeltaCaptureComplete, false);
  assert.deepEqual(result.gpcrdbRepeatFailures, [{ repeat: 2, error: "HTTP 503" }]);
});

test("new index membership is distinct from initial PDB release date", () => {
  const older = deriveRecentDelta(fixture(true)).summary;
  assert.equal(older.newIndexEntryCount, 1);
  assert.equal(older.newEntryMetadataCompleteCount, 1);
  assert.equal(older.olderPdbEntryNewToIndexCount, 1);
  assert.equal(older.newlyReleasedPdbEntryCount, 0);
  const input = fixture(true);
  for (const repeat of [1, 2]) {
    const envelope = JSON.parse(input.raw.get(`rcsb-${repeat}.json`));
    envelope.data.entries[0].rcsb_accession_info.initial_release_date = "2026-09-02T00:00:00Z";
    input.raw.set(`rcsb-${repeat}.json`, JSON.stringify(envelope));
  }
  const recent = deriveRecentDelta(input).summary;
  assert.equal(recent.newlyReleasedPdbEntryCount, 1);
  assert.equal(recent.olderPdbEntryNewToIndexCount, 0);
  assert.equal(recent.formalWholeCensusAuthority, false);
});

test("an omitted RCSB entry remains visible and unresolved", () => {
  const input = fixture(true);
  input.raw.set("rcsb-2.json", JSON.stringify({ data: { entries: [null] } }));
  const result = deriveRecentDelta(input);
  assert.equal(result.summary.newEntryMetadataUnresolvedCount, 1);
  assert.equal(result.summary.newEntryMetadataCompleteCount, 0);
  assert.equal(result.summary.releaseDateUnresolvedCount, 1);
  assert.equal(result.summary.observedIndexDeltaCaptureComplete, false);
  const row = JSON.parse(result.files["new-entry-status.jsonl"]);
  assert.equal(row.pdbId, "5UZ7");
  assert.equal(row.status, "RCSB_METADATA_UNRESOLVED");
  assert.match(row.attempts[1].error, /Entry omitted/u);
});

test("metadata disagreement with unchanged identifiers blocks a complete delta capture", () => {
  const input = fixture();
  input.raw.set("gpcrdb-2.json", JSON.stringify([{ ...gpcrdbRow, publication: "https://example.invalid/changed" }]));
  const result = deriveRecentDelta(input);
  assert.equal(result.summary.gpcrdbIdentifierRepeatAgreement, true);
  assert.equal(result.summary.gpcrdbMetadataRepeatAgreement, false);
  assert.equal(result.summary.changedExistingMetadataEntryCount, 1);
  assert.equal(result.summary.observedIndexDeltaCaptureComplete, false);
  assert.equal(result.files["normalized/repeat-metadata-disagreement-ids.txt"], "5UZ7\n");
});

test("unexpected entries and duplicate JSON keys do not pass metadata replay", () => {
  for (const malformed of [JSON.stringify({ data: { entries: [rcsbRow, { rcsb_id: "9ZZZ" }] } }), '{"data":{"entries":[]},"data":{"entries":[]}}']) {
    const input = fixture(true);
    input.raw.set("rcsb-1.json", malformed);
    const result = deriveRecentDelta(input).summary;
    assert.equal(result.newEntryMetadataUnresolvedCount, 1);
    assert.equal(result.observedIndexDeltaCaptureComplete, false);
  }
});
