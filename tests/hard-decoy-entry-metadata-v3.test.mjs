import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectEntryMetadata, verifyEntryMetadataSnapshot } from "../scripts/hard-decoy/v3-entry-metadata.mjs";
import { verifyV3EntryMetadataContracts } from "../scripts/hard-decoy/verify-v3-entry-metadata-contracts.mjs";

const DEV_ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/entry-metadata-draft";
const SOURCE_CONTRACT_REL = "validation/hard-decoy-holdout-v3/prelabel-census-draft";
const SOURCE_REL = "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29";
const ATTEST_REL = "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json";
const SNAPSHOT_REL = "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29";

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
test("the checked-in 287-entry metadata snapshot replays from all repeated raw responses", async () => {
  const result = await verifyEntryMetadataSnapshot({
    repositoryRoot: DEV_ROOT,
    snapshotDirectory: path.join(DEV_ROOT, SNAPSHOT_REL),
  });
  assert.equal(result.status, "ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS");
  assert.equal(result.sourceEntries, 287);
  assert.equal(result.polymerEntities, 1401);
  assert.equal(result.repeatedRawResponses, 24);
  assert.deepEqual(result.reviewStrata, {
    DIRECT_TARGET_CANDIDATE_REVIEW: 39,
    AUXILIARY_OR_CONSTRUCT_REVIEW: 242,
    METADATA_RESOLUTION_REQUIRED: 6,
  });
  assert.equal(result.pendingDispositionRows, 287);
  assert.equal(result.formallyClearedGroups, 0);
  assert.equal(result.targetFreezePermitted, false);
  assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(result.dockqLabelsAccessed, false);
  assert.equal(result.executionAuthorized, false);
});
function graphqlEntry(pdbId, index, { titleSuffix = "" } = {}) {
  const category = index % 3;
  const secondDescription = category === 1 ? "Nanobody 35" : category === 2 ? "Accessory protein" : "Conformation-selective nanobody";
  const secondOrganism = category === 2 ? "Escherichia coli" : "Lama glama";
  return {
    rcsb_id: pdbId,
    struct: { title: `Fixture GPCR complex ${pdbId}${titleSuffix}` },
    struct_keywords: { pdbx_keywords: "SIGNALING PROTEIN", text: category === 1 ? "GPCR, nanobody 35, G protein" : "GPCR, nanobody" },
    exptl: [{ method: "ELECTRON MICROSCOPY" }],
    rcsb_accession_info: { initial_release_date: "2026-01-01T00:00:00Z" },
    rcsb_primary_citation: {
      pdbx_database_id_DOI: `10.0000/${pdbId.toLowerCase()}`,
      pdbx_database_id_PubMed: 50000000 + index,
      title: `Fixture article ${pdbId}`,
    },
    rcsb_entry_info: { experimental_method: "EM", resolution_combined: [3.0], polymer_entity_count: 2 },
    polymer_entities: [
      {
        rcsb_id: `${pdbId}_2`,
        entity_poly: { pdbx_seq_one_letter_code_can: "Q".repeat(120), rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)" },
        rcsb_polymer_entity: { pdbx_description: secondDescription },
        rcsb_polymer_entity_container_identifiers: { entity_id: "2", asym_ids: ["B"], auth_asym_ids: ["B"], reference_sequence_identifiers: null },
        rcsb_entity_source_organism: [{ ncbi_scientific_name: secondOrganism, ncbi_taxonomy_id: category === 2 ? 562 : 9844 }],
      },
      {
        rcsb_id: `${pdbId}_1`,
        entity_poly: { pdbx_seq_one_letter_code_can: "M".repeat(320), rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)" },
        rcsb_polymer_entity: { pdbx_description: "Fixture receptor" },
        rcsb_polymer_entity_container_identifiers: {
          entity_id: "1", asym_ids: ["A"], auth_asym_ids: ["A"],
          reference_sequence_identifiers: [{ database_name: "UniProt", database_accession: `P${String(index).padStart(5, "0")}`, provenance_source: "SIFTS" }],
        },
        rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens", ncbi_taxonomy_id: 9606 }],
      },
    ],
  };
}
async function makeFixtureRepository() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-entry-v3-"));
  const root = path.join(temporary, "repo");
  await mkdir(path.join(root, path.dirname(CONTRACT_REL)), { recursive: true });
  await cp(path.join(DEV_ROOT, CONTRACT_REL), path.join(root, CONTRACT_REL), { recursive: true });
  await cp(path.join(DEV_ROOT, SOURCE_CONTRACT_REL), path.join(root, SOURCE_CONTRACT_REL), { recursive: true });
  await cp(path.join(DEV_ROOT, SOURCE_REL), path.join(root, SOURCE_REL), { recursive: true });
  await cp(path.join(DEV_ROOT, ATTEST_REL), path.join(root, ATTEST_REL));
  const ids = (await readFile(path.join(root, SOURCE_REL, "normalized/rcsb-gpcrdb-intersection.txt"), "utf8")).trimEnd().split("\n");
  const contract = JSON.parse(await readFile(path.join(root, CONTRACT_REL, "entry-metadata-contract.json"), "utf8"));
  return { temporary, root, ids, contract };
}
function makeFetch(ids, { disagreeBatch = null, injectCoordinate = false, omitId = null } = {}) {
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const callsByBatch = new Map();
  return async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    const requested = body.variables.ids;
    const key = requested.join(",");
    const repeat = (callsByBatch.get(key) ?? 0) + 1;
    callsByBatch.set(key, repeat);
    let entries = requested.map((id) => graphqlEntry(id, indexById.get(id), {
      titleSuffix: disagreeBatch === requested[0] && repeat === 2 && id === requested[0] ? " changed" : "",
    })).reverse();
    if (omitId) entries = entries.filter((entry) => entry.rcsb_id !== omitId);
    const payload = { data: { entries } };
    if (injectCoordinate && repeat === 1 && requested[0] === ids[0]) payload.data.entries[0].struct.title = "ATOM      1  CA  GLY A   1       0.000   0.000   0.000";
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json", etag: `fixture-${repeat}` } });
  };
}
async function refreshSnapshotChecksum(directory, relative) {
  const checksums = path.join(directory, "checksums.sha256");
  const rows = (await readFile(checksums, "utf8")).trimEnd().split("\n");
  const replacement = `${sha(await readFile(path.join(directory, relative)))}  ${relative}`;
  const next = rows.map((row) => row.endsWith(`  ${relative}`) ? replacement : row);
  assert.equal(next.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(checksums, `${next.join("\n")}\n`);
}

test("entry-metadata contract binds the exact source universe and remains fail-closed", async () => {
  const fixture = await makeFixtureRepository();
  try {
    const result = await verifyV3EntryMetadataContracts(fixture.root);
    assert.equal(result.sourceIdentifierCount, 287);
    assert.equal(result.batchSize, 25);
    assert.equal(result.batchCount, 12);
    assert.equal(result.repeatCount, 2);
    assert.equal(result.expectedRawResponses, 24);
    assert.equal(result.metadataTriageStatus, "NON_DISPOSITIVE_METADATA_SIGNALS_ONLY");
    assert.equal(result.pendingDispositionRows, 287);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.executionAuthorized, false);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("collector captures two semantic repeats and deterministically stratifies all 287 rows", async () => {
  const fixture = await makeFixtureRepository();
  const output = path.join(fixture.temporary, "snapshot");
  try {
    const result = await collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: output, fetchImpl: makeFetch(fixture.ids), delay: async () => {}, now: (() => { let index = 0; return () => `2026-08-29T00:00:${String(index++).padStart(2, "0")}Z`; })() });
    assert.equal(result.status, "ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS");
    assert.equal(result.sourceEntries, 287);
    assert.equal(result.repeatedRawResponses, 24);
    assert.ok(result.entriesWithUniquePreferredReceptorAuthChain > 0);
    assert.ok(result.entriesWithVhhLikeEntitySignal > 0);
    assert.ok(result.entriesWithBothReceptorAndVhhSignals > 0);
    assert.ok(result.entriesWithBothReceptorAndVhhSignals <= result.entriesWithUniquePreferredReceptorAuthChain);
    assert.ok(result.entriesWithBothReceptorAndVhhSignals <= result.entriesWithVhhLikeEntitySignal);
    assert.equal(Object.values(result.reviewStrata).reduce((sum, count) => sum + count, 0), 287);
    assert.ok(Object.values(result.reviewStrata).every((count) => count > 0));
    assert.equal(result.pendingDispositionRows, 287);
    assert.equal(result.formallyClearedGroups, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    const entries = (await readFile(path.join(output, "entries.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
    assert.deepEqual(entries.map((entry) => entry.pdbId), fixture.ids);
    assert.ok(entries.every((entry) => entry.dispositionStatus === "PENDING_DISPOSITION" && entry.directInterfaceEvidenceStatus === "UNRESOLVED"));
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("semantic disagreement between repeated RCSB batches fails closed", async () => {
  const fixture = await makeFixtureRepository();
  try {
    await assert.rejects(() => collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: path.join(fixture.temporary, "snapshot"), fetchImpl: makeFetch(fixture.ids, { disagreeBatch: fixture.ids[0] }), delay: async () => {} }), /repeat disagreement for batch 1/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("an omitted source-universe entry fails exact reconciliation", async () => {
  const fixture = await makeFixtureRepository();
  try {
    await assert.rejects(() => collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: path.join(fixture.temporary, "snapshot"), fetchImpl: makeFetch(fixture.ids, { omitId: fixture.ids[0] }), delay: async () => {} }), /omitted one or more entries from batch 1/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("coordinate-like content is rejected even inside an otherwise valid GraphQL payload", async () => {
  const fixture = await makeFixtureRepository();
  try {
    await assert.rejects(() => collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: path.join(fixture.temporary, "snapshot"), fetchImpl: makeFetch(fixture.ids, { injectCoordinate: true }), delay: async () => {} }), /Coordinate payload appeared in raw\/rcsb-entry-metadata-batch-001-repeat-1.json/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("snapshot byte mutation fails checksum replay", async () => {
  const fixture = await makeFixtureRepository();
  const output = path.join(fixture.temporary, "snapshot");
  try {
    await collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: output, fetchImpl: makeFetch(fixture.ids), delay: async () => {} });
    await writeFile(path.join(output, "summary.md"), "mutated\n");
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: fixture.root, snapshotDirectory: output }), /Entry-metadata checksum mismatch: summary.md/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("a rechecksummed manifest still cannot authorize execution", async () => {
  const fixture = await makeFixtureRepository();
  const output = path.join(fixture.temporary, "snapshot");
  try {
    await collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: output, fetchImpl: makeFetch(fixture.ids), delay: async () => {} });
    const manifestPath = path.join(output, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.executionAuthorized = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await refreshSnapshotChecksum(output, "manifest.json");
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: fixture.root, snapshotDirectory: output }), /blocked-state field drifted: executionAuthorized/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});

test("reordering normalized entry rows cannot bypass exact source reconciliation", async () => {
  const fixture = await makeFixtureRepository();
  const output = path.join(fixture.temporary, "snapshot");
  try {
    await collectEntryMetadata({ repositoryRoot: fixture.root, outputDirectory: output, fetchImpl: makeFetch(fixture.ids), delay: async () => {} });
    const entryPath = path.join(output, "entries.jsonl");
    const lines = (await readFile(entryPath, "utf8")).trimEnd().split("\n");
    [lines[0], lines[1]] = [lines[1], lines[0]];
    await writeFile(entryPath, `${lines.join("\n")}\n`);
    await refreshSnapshotChecksum(output, "entries.jsonl");
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: fixture.root, snapshotDirectory: output }), /does not reconstruct from the repeated raw RCSB responses/);
  } finally { await rm(fixture.temporary, { recursive: true, force: true }); }
});
