import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectDevelopmentMetadata,
  verifyDevelopmentMetadataSnapshot,
} from "../scripts/hard-decoy/v3-development-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT = path.join(ROOT, "validation/hard-decoy-holdout-v3/development-metadata-contract-2026-08-29.json");

function receptorSequence(seed) {
  return `${"M".repeat(20)}${seed.repeat(5)}${"A".repeat(220)}`;
}

function vhhSequence(seed) {
  return `QVQLVESGGGLVQAGGSLRLSCAAS${seed.repeat(4)}WYRQAPGKEREFVAAIS${"G".repeat(20)}YYADSVKGRFTISRDNAKNTVYLQMNSLKPEDTAVYYC${"A".repeat(15)}WGQGTQVTVSS`;
}

async function fixtureResponse({ mutateSecond = false, coordinatePayload = false } = {}) {
  const contract = JSON.parse(await readFile(CONTRACT, "utf8"));
  const gpcrdb = JSON.parse(await readFile(path.join(ROOT, contract.gpcrdbMetadata.path), "utf8"));
  const rows = new Map(gpcrdb.map((row) => [String(row.pdb_code).toUpperCase(), row]));
  let call = 0;
  return async (url, options = {}) => {
    assert.equal(url, contract.missingEntryMetadata.endpoint);
    assert.equal(options.method, "POST");
    const ids = JSON.parse(options.body).variables.ids;
    assert.deepEqual(ids, contract.missingEntryMetadata.requiredStructureIds);
    const repeat = ++call;
    const entries = ids.map((id, index) => {
      const preferred = rows.get(id).preferred_chain;
      const title = mutateSecond && repeat === 2 && index === 0 ? `Changed ${id}` : `Development metadata fixture ${id}`;
      const receptor = receptorSequence(index === 0 ? "ACDE" : "FGHI");
      const vhh = vhhSequence(index === 0 ? "ST" : "YN");
      return {
        rcsb_id: id,
        struct: { title },
        struct_keywords: { pdbx_keywords: "MEMBRANE PROTEIN", text: "GPCR development metadata fixture" },
        exptl: [{ method: "ELECTRON MICROSCOPY" }],
        rcsb_accession_info: { initial_release_date: "2024-01-01T00:00:00Z" },
        rcsb_primary_citation: {
          pdbx_database_id_DOI: `10.0000/${id.toLowerCase()}`,
          pdbx_database_id_PubMed: String(10000000 + index),
          title: `Fixture publication ${id}`,
        },
        rcsb_entry_info: {
          experimental_method: "EM",
          resolution_combined: [3.1 + index / 10],
          polymer_entity_count: 2,
        },
        polymer_entities: [
          {
            rcsb_id: `${id}_1`,
            entity_poly: {
              pdbx_seq_one_letter_code_can: receptor,
              rcsb_entity_polymer_type: "Protein",
              type: "polypeptide(L)",
            },
            rcsb_polymer_entity: { pdbx_description: coordinatePayload && index === 0 ? "ATOM      1  CA  GLY A   1       0.000   0.000   0.000" : `Fixture receptor ${id}` },
            rcsb_polymer_entity_container_identifiers: {
              entity_id: "1",
              asym_ids: [preferred],
              auth_asym_ids: [preferred],
              reference_sequence_identifiers: [{ database_name: "UniProt", database_accession: `P${index + 1}0000`, provenance_source: "SIFTS" }],
            },
            rcsb_entity_source_organism: [{ ncbi_scientific_name: "Homo sapiens", ncbi_taxonomy_id: 9606 }],
          },
          {
            rcsb_id: `${id}_2`,
            entity_poly: {
              pdbx_seq_one_letter_code_can: vhh,
              rcsb_entity_polymer_type: "Protein",
              type: "polypeptide(L)",
            },
            rcsb_polymer_entity: { pdbx_description: `Nanobody fixture ${id}` },
            rcsb_polymer_entity_container_identifiers: {
              entity_id: "2",
              asym_ids: ["N"],
              auth_asym_ids: ["N"],
              reference_sequence_identifiers: [],
            },
            rcsb_entity_source_organism: [{ ncbi_scientific_name: "Lama glama", ncbi_taxonomy_id: 9844 }],
          },
        ],
      };
    });
    return new Response(JSON.stringify({ data: { entries } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function temporarySnapshot(options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-metadata-"));
  const output = path.join(temporary, "snapshot");
  const result = await collectDevelopmentMetadata({
    repositoryRoot: ROOT,
    outputDirectory: output,
    fetchImpl: await fixtureResponse(options),
    now: (() => { let second = 0; return () => `2026-08-29T08:00:${String(second++).padStart(2, "0")}Z`; })(),
    delay: async () => {},
  });
  return { temporary, output, result };
}

async function refreshChecksum(snapshot, relative) {
  const digest = createHash("sha256").update(await readFile(path.join(snapshot, relative))).digest("hex");
  const checksumPath = path.join(snapshot, "checksums.sha256");
  const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
  const changed = rows.map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row);
  assert.equal(changed.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(checksumPath, `${changed.join("\n")}\n`);
}

test("development metadata completion covers all 17 nodes and fills only the two prespecified gaps", async () => {
  const { temporary, output, result } = await temporarySnapshot();
  try {
    assert.equal(result.status, "DEVELOPMENT_METADATA_COMPLETED_BLOCKED_PENDING_SCIENTIFIC_LEAKAGE_AUDIT");
    assert.equal(result.developmentNodeCount, 17);
    assert.equal(result.reusedMetadataNodeCount, 15);
    assert.equal(result.newlyCompletedMetadataNodeCount, 2);
    assert.deepEqual(result.newlyCompletedPdbIds, ["6KNM", "6O3C"]);
    assert.equal(result.directInterfaceEvidenceResolvedCount, 0);
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(result.dockqLabelsAccessed, false);

    const nodes = (await readFile(path.join(output, "development-nodes.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
    assert.equal(nodes.length, 17);
    assert.equal(new Set(nodes.map((node) => node.pdbId)).size, 17);
    assert.deepEqual(nodes.map((node) => node.pdbId), [...nodes.map((node) => node.pdbId)].sort());
    const completed = nodes.filter((node) => node.metadataSource === "NEW_REPEATED_RCSB_METADATA_COMPLETION");
    assert.deepEqual(completed.map((node) => node.pdbId), ["6KNM", "6O3C"]);
    assert.ok(completed.every((node) => node.vhhMetadataCandidateStatus === "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE"));
    assert.ok(nodes.every((node) => node.directReceptorVhhEvidence === "UNRESOLVED"));
    assert.ok(nodes.every((node) => node.formalLeakageCertificationComplete === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a unique VHH-like metadata entity never becomes direct-interface evidence", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const nodes = (await readFile(path.join(output, "development-nodes.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
    const unique = nodes.filter((node) => node.vhhMetadataCandidateStatus === "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE");
    assert.ok(unique.length > 0);
    assert.ok(unique.every((node) => node.directReceptorVhhEvidence === "UNRESOLVED" && node.targetFreezeAuthority === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("normalized disagreement between repeated public metadata requests fails closed", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-repeat-"));
  try {
    const fetchImpl = await fixtureResponse({ mutateSecond: true });
    await assert.rejects(
      () => collectDevelopmentMetadata({
        repositoryRoot: ROOT,
        outputDirectory: path.join(temporary, "snapshot"),
        fetchImpl,
        delay: async () => {},
      }),
      /Normalized repeated development metadata responses disagree/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("coordinate-like text in an otherwise valid metadata response is rejected", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-development-coordinate-"));
  try {
    const fetchImpl = await fixtureResponse({ coordinatePayload: true });
    await assert.rejects(
      () => collectDevelopmentMetadata({
        repositoryRoot: ROOT,
        outputDirectory: path.join(temporary, "snapshot"),
        fetchImpl,
        delay: async () => {},
      }),
      /Coordinate payload appeared/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a content mutation cannot bypass the committed snapshot checksum inventory", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const summaryPath = path.join(output, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.targetFreezePermitted = true;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await assert.rejects(
      () => verifyDevelopmentMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: output }),
      /checksum mismatch/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("even a rechecksummed label injection fails closed", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const nodesPath = path.join(output, "development-nodes.jsonl");
    const rows = (await readFile(nodesPath, "utf8")).trimEnd().split("\n").map(JSON.parse);
    rows[0].constructEvidence = "DockQ=0.42";
    await writeFile(nodesPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await refreshChecksum(output, "development-nodes.jsonl");
    await assert.rejects(
      () => verifyDevelopmentMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: output }),
      /Observed holdout-label assignment|not reproducible/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
