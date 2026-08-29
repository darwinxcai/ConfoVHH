import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectDevelopmentMetadata, verifyDevelopmentMetadata } from "../scripts/hard-decoy/v3-development-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY = JSON.parse(await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v2/prelabel-census/development-registry.json"), "utf8"));
const GPCRDB = JSON.parse(await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-api-1.json"), "utf8"));
const PREFERRED = new Map(GPCRDB.map((row) => [String(row.pdb_code).toUpperCase(), row.preferred_chain]));
const IDS = REGISTRY.developmentGpcrVhhStructures.map((row) => row.pdbId).sort();

function sequenceFor(index, length, offset = 0) {
  const alphabet = "ACDEFGHIKLMNPQRSTVWY";
  return Array.from({ length }, (_, position) => alphabet[(position + index + offset) % alphabet.length]).join("");
}
function entryFor(pdbId, index, { mutate = false, coordinate = false, observedLabel = false } = {}) {
  const preferred = PREFERRED.get(pdbId) ?? "A";
  const receptor = sequenceFor(index, 300, mutate ? 1 : 0);
  const vhh = sequenceFor(index + 7, 110);
  return {
    rcsb_id: pdbId,
    rcsb_accession_info: { initial_release_date: `2020-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z` },
    struct: { title: coordinate ? "ATOM      1  CA  GLY A   1       0.000   0.000   0.000" : `Fixture development entry ${pdbId}` },
    struct_keywords: { pdbx_keywords: "MEMBRANE PROTEIN", text: "GPCR nanobody metadata fixture" },
    exptl: [{ method: "ELECTRON MICROSCOPY" }],
    rcsb_entry_info: { experimental_method: "EM", resolution_combined: [3.1], polymer_entity_count: 2 },
    rcsb_primary_citation: {
      pdbx_database_id_DOI: `10.1000/${pdbId.toLowerCase()}`,
      pdbx_database_id_PubMed: String(10000000 + index),
      title: observedLabel ? "DockQ: 0.42" : `Metadata fixture publication ${pdbId}`,
    },
    polymer_entities: [
      {
        rcsb_id: `${pdbId}_1`,
        rcsb_polymer_entity: { pdbx_description: `Fixture receptor ${pdbId}` },
        entity_poly: { rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)", pdbx_seq_one_letter_code_can: receptor },
        rcsb_polymer_entity_container_identifiers: {
          entity_id: "1", asym_ids: [preferred], auth_asym_ids: [preferred],
          reference_sequence_identifiers: [{ database_name: "UniProt", database_accession: `P${String(index).padStart(5, "0")}`, provenance_source: "SIFTS" }],
        },
        rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens", ncbi_taxonomy_id: 9606 }],
      },
      {
        rcsb_id: `${pdbId}_2`,
        rcsb_polymer_entity: { pdbx_description: `Nanobody fixture ${pdbId}` },
        entity_poly: { rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)", pdbx_seq_one_letter_code_can: vhh },
        rcsb_polymer_entity_container_identifiers: {
          entity_id: "2", asym_ids: ["V"], auth_asym_ids: ["V"], reference_sequence_identifiers: [],
        },
        rcsb_entity_source_organism: [{ ncbi_scientific_name: "Lama glama", ncbi_taxonomy_id: 9844 }],
      },
    ],
  };
}
function fixtureFetch({ disagree = false, coordinate = false, observedLabel = false } = {}) {
  let call = 0;
  return async (_url, options = {}) => {
    call += 1;
    const ids = JSON.parse(options.body).variables.ids;
    const entries = ids.map((id, index) => entryFor(id, index, {
      mutate: disagree && call === 2 && index === 0,
      coordinate: coordinate && index === 0,
      observedLabel: observedLabel && index === 0,
    }));
    return new Response(JSON.stringify({ data: { entries } }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
function clock() { let second = 0; return () => `2026-08-29T12:00:${String(second++).padStart(2, "0")}Z`; }
async function snapshot(fetchImpl = fixtureFetch(), prefix = "confovhh-development-metadata-") {
  const temporary = await mkdtemp(path.join(os.tmpdir(), prefix));
  const output = path.join(temporary, "snapshot");
  const result = await collectDevelopmentMetadata({ repositoryRoot: ROOT, outputDirectory: output, fetchImpl, now: clock(), delay: async () => {} });
  return { temporary, output, result };
}
function parseJsonl(payload) { return payload.trimEnd().split("\n").filter(Boolean).map(JSON.parse); }

test("development metadata captures every frozen registry PDB without scientific clearance", async () => {
  const { temporary, output, result } = await snapshot();
  try {
    assert.equal(result.status, "DEVELOPMENT_METADATA_SNAPSHOT_VERIFIED_BLOCKED");
    assert.equal(result.registeredDevelopmentPdbCount, 17);
    assert.equal(result.allRegisteredPdbMetadataCaptured, true);
    assert.equal(result.entriesWithAllPolymerSequences, 17);
    assert.equal(result.entriesWithPrimaryCitationIdentifier, 17);
    assert.equal(result.entriesWithAtLeastOneVhhExposureSequence, 17);
    assert.equal(result.receptorExposureTokenRows, 17);
    assert.equal(result.vhhExposureTokenRows, 17);
    assert.equal(result.publicationExposureTokenRows, 17);
    assert.equal(result.developmentRegistryCompleteForFormalLeakageCertification, false);
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(result.dockqLabelsAccessed, false);
    assert.equal(result.executionAuthorized, false);
    const entries = parseJsonl(await readFile(path.join(output, "development-entries.jsonl"), "utf8"));
    assert.deepEqual(entries.map((entry) => entry.pdbId), IDS);
    assert.ok(entries.every((entry) => entry.frozenEligible === false && entry.nativeCoordinatesInspected === false));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("VHH-like polymers are retained only as development exposure tokens", async () => {
  const { temporary, output } = await snapshot();
  try {
    const tokens = parseJsonl(await readFile(path.join(output, "vhh-exposure-tokens.jsonl"), "utf8"));
    assert.equal(tokens.length, 17);
    assert.ok(tokens.every((token) => token.directBinderIdentityResolved === false));
    const entries = parseJsonl(await readFile(path.join(output, "development-entries.jsonl"), "utf8"));
    assert.ok(entries.every((entry) => entry.vhhExposureInterpretation === "ALL_VHH_LIKE_ENTITIES_ARE_EXPOSURE_TOKENS_NOT_DIRECT_BINDER_ASSIGNMENTS"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("normalized disagreement between repeated public metadata retrievals fails closed", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-disagreement-"));
  try {
    await assert.rejects(() => collectDevelopmentMetadata({ repositoryRoot: ROOT, outputDirectory: path.join(temporary, "snapshot"), fetchImpl: fixtureFetch({ disagree: true }), now: clock(), delay: async () => {} }), /repeats disagree/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("coordinate-like text in public metadata is rejected before archival", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-coordinate-"));
  try {
    await assert.rejects(() => collectDevelopmentMetadata({ repositoryRoot: ROOT, outputDirectory: path.join(temporary, "snapshot"), fetchImpl: fixtureFetch({ coordinate: true }), now: clock(), delay: async () => {} }), /Coordinate payload/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("observed holdout-label syntax in metadata is rejected before archival", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-label-"));
  try {
    await assert.rejects(() => collectDevelopmentMetadata({ repositoryRoot: ROOT, outputDirectory: path.join(temporary, "snapshot"), fetchImpl: fixtureFetch({ observedLabel: true }), now: clock(), delay: async () => {} }), /Observed holdout-label/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("a normalized artifact mutation fails checksum verification", async () => {
  const { temporary, output } = await snapshot();
  try {
    await writeFile(path.join(output, "summary.json"), "{}\n");
    await assert.rejects(() => verifyDevelopmentMetadata({ repositoryRoot: ROOT, snapshotDirectory: output }), /checksum mismatch/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("an unlisted result file fails exact snapshot inventory", async () => {
  const { temporary, output } = await snapshot();
  try {
    await writeFile(path.join(output, "results.json"), "{}\n");
    await assert.rejects(() => verifyDevelopmentMetadata({ repositoryRoot: ROOT, snapshotDirectory: output }), /inventory drifted/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("normalized development exposure artifacts are deterministic for identical source responses", async () => {
  const first = await snapshot(fixtureFetch(), "confovhh-development-a-");
  const second = await snapshot(fixtureFetch(), "confovhh-development-b-");
  try {
    for (const file of ["development-entries.jsonl", "receptor-exposure-tokens.jsonl", "vhh-exposure-tokens.jsonl", "publication-exposure-tokens.jsonl", "summary.json", "summary.md"]) {
      assert.deepEqual(await readFile(path.join(first.output, file)), await readFile(path.join(second.output, file)));
    }
  } finally {
    await rm(first.temporary, { recursive: true, force: true });
    await rm(second.temporary, { recursive: true, force: true });
  }
});
