import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectDefiniteExclusions,
  verifyDefiniteExclusions,
} from "../scripts/hard-decoy/v3-definite-exclusions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PRIOR = path.join(ROOT, "validation/hard-decoy-holdout-v3/disposition-seed-2026-08-29/entry-dispositions.jsonl");
const FILES = [
  "README.md",
  "checksums.sha256",
  "development-connected-components.jsonl",
  "entry-dispositions.jsonl",
  "exclusion-paths.jsonl",
  "manifest.json",
  "summary.json",
];
const ELIGIBLE = new Set([
  "EXACT_PDB_ID_REUSE",
  "EXACT_RECEPTOR_ENTITY_SEQUENCE",
  "EXACT_SINGLETON_RECEPTOR_UNIPROT",
  "EXACT_PRIMARY_DOI",
  "EXACT_PRIMARY_PMID",
]);
const INELIGIBLE = new Set([
  "EXACT_UNIQUE_VHH_METADATA_SEQUENCE",
  "SHARED_RECEPTOR_UNIPROT_WITH_MULTIACCESSION_AMBIGUITY",
  "SHARED_VHH_METADATA_SEQUENCE_WITH_ROLE_AMBIGUITY",
]);

function parseJsonl(text) {
  return text.trim() ? text.trimEnd().split("\n").map(JSON.parse) : [];
}

async function temporarySnapshot() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-definite-exclusions-"));
  const output = path.join(temporary, "snapshot");
  const result = await collectDefiniteExclusions({ repositoryRoot: ROOT, outputDirectory: output });
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

test("the definite layer resolves exactly 18 additional source entries and leaves 254 pending", async () => {
  const { temporary, output, result } = await temporarySnapshot();
  try {
    assert.equal(result.status, "MONOTONIC_DEFINITE_EXCLUSIONS_COMPLETED_BLOCKED_PENDING_REMAINING_SCIENTIFIC_DISPOSITIONS");
    assert.equal(result.sourceDispositionRows, 287);
    assert.equal(result.priorResolvedRows, 15);
    assert.equal(result.definiteDevelopmentConnectedCandidateRows, 33);
    assert.equal(result.newlyResolvedRows, 18);
    assert.equal(result.resolvedRowsAfterUpdate, 33);
    assert.equal(result.pendingRowsAfterUpdate, 254);
    assert.equal(result.provisionalDirectTargetCount, 0);
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(result.dockqLabelsAccessed, false);

    const rows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    assert.equal(rows.length, 287);
    assert.equal(new Set(rows.map((row) => row.pdbId)).size, 287);
    assert.equal(rows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA").length, 33);
    assert.equal(rows.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA").length, 254);
    assert.ok(rows.every((row) => row.dispositionCode !== "PROVISIONAL_DIRECT_TARGET"));
    assert.ok(rows.every((row) => row.nativeCoordinatesInspected === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("all 15 prior resolved rows are preserved exactly and every new exclusion has a deterministic path", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const priorRows = parseJsonl(await readFile(PRIOR, "utf8"));
    const outputRows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    const outputById = new Map(outputRows.map((row) => [row.pdbId, row]));
    const priorResolved = priorRows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA");
    assert.equal(priorResolved.length, 15);
    for (const row of priorResolved) assert.deepEqual(outputById.get(row.pdbId), row);

    const paths = parseJsonl(await readFile(path.join(output, "exclusion-paths.jsonl"), "utf8"));
    assert.equal(paths.length, 33);
    assert.equal(paths.filter((row) => row.newlyResolved).length, 18);
    assert.equal(paths.filter((row) => !row.newlyResolved).length, 15);
    assert.equal(new Set(paths.map((row) => row.candidatePdbId)).size, 33);
    for (const row of paths) {
      assert.equal(row.pathLength, row.pathEdges.length);
      assert.equal(row.pathNodeIds.length, row.pathEdges.length + 1);
      assert.equal(row.pathNodeIds[0], row.candidateNodeId);
      assert.equal(row.pathNodeIds.at(-1), row.terminalDevelopmentNodeId);
      assert.match(row.terminalDevelopmentNodeId, /^development:/u);
      assert.ok(["PUBLICATION", "RECEPTOR"].includes(row.firstEdgeRelationClass));
      assert.equal(row.exactPositiveEvidenceOnly, true);
      assert.equal(row.formalLeakageGraphComplete, false);
      assert.equal(row.formalNoEdgeStatus, "NOT_ASSESSED");
      assert.equal(row.automaticTargetPromotionPermitted, false);
      assert.equal(row.nativeCoordinatesInspected, false);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("only contracted definite receptor or publication evidence appears in exclusion paths", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const paths = parseJsonl(await readFile(path.join(output, "exclusion-paths.jsonl"), "utf8"));
    for (const row of paths) {
      for (const edge of row.pathEdges) {
        assert.ok(edge.eligibleEvidenceTypes.length > 0);
        assert.ok(edge.eligibleEvidenceTypes.every((type) => ELIGIBLE.has(type)));
        assert.ok(edge.eligibleEvidenceTypes.every((type) => !INELIGIBLE.has(type)));
        assert.equal(edge.relationClass, edge.eligibleEvidenceTypes.some((type) => [
          "EXACT_PDB_ID_REUSE",
          "EXACT_RECEPTOR_ENTITY_SEQUENCE",
          "EXACT_SINGLETON_RECEPTOR_UNIPROT",
        ].includes(type)) ? "RECEPTOR" : "PUBLICATION");
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("every newly resolved disposition follows the first exact-evidence edge and retains unresolved downstream gates", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const rows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    const byId = new Map(rows.map((row) => [row.pdbId, row]));
    const paths = parseJsonl(await readFile(path.join(output, "exclusion-paths.jsonl"), "utf8")).filter((row) => row.newlyResolved);
    for (const pathRow of paths) {
      const row = byId.get(pathRow.candidatePdbId);
      const expectedCode = pathRow.firstEdgeRelationClass === "RECEPTOR"
        ? "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE"
        : "EXCLUDE_PUBLICATION_LEAKAGE";
      assert.equal(row.dispositionCode, expectedCode);
      assert.equal(row.receptorClusterStatus, expectedCode === "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE" ? "FAIL" : "UNRESOLVED");
      assert.equal(row.publicationEdgeStatus, expectedCode === "EXCLUDE_PUBLICATION_LEAKAGE" ? "FAIL" : "UNRESOLVED");
      assert.equal(row.directReceptorVhhEvidence, "UNRESOLVED");
      assert.equal(row.constructEvidence, "UNRESOLVED");
      assert.equal(row.vhhClusterStatus, "UNRESOLVED");
      assert.equal(row.knownParentStatus, "UNRESOLVED");
      assert.equal(row.annotationEpitope, null);
      assert.match(row.dispositionReason, /Definite exact metadata evidence/u);
      assert.match(row.dispositionReason, /remain unresolved/u);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("development-connected components are complete but explicitly not formal leakage components", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const components = parseJsonl(await readFile(path.join(output, "development-connected-components.jsonl"), "utf8"));
    assert.ok(components.length > 0);
    assert.equal(components.reduce((sum, row) => sum + row.candidateNodeCount, 0), 33);
    assert.equal(components.reduce((sum, row) => sum + row.previouslyResolvedCandidateCount, 0), 15);
    assert.equal(components.reduce((sum, row) => sum + row.newlyResolvedCandidateCount, 0), 18);
    assert.ok(components.every((row) => row.developmentNodeCount > 0));
    assert.ok(components.every((row) => row.formalLeakageComponent === false));
    assert.ok(components.every((row) => row.formalTargetEligibilityAuthority === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("definite exclusion generation is byte-for-byte deterministic", async () => {
  const first = await temporarySnapshot();
  const second = await temporarySnapshot();
  try {
    for (const file of FILES) assert.deepEqual(await readFile(path.join(first.output, file)), await readFile(path.join(second.output, file)), file);
  } finally {
    await rm(first.temporary, { recursive: true, force: true });
    await rm(second.temporary, { recursive: true, force: true });
  }
});

test("a checksum mutation and a rechecksummed observed-label injection both fail closed", async () => {
  const first = await temporarySnapshot();
  try {
    const summaryPath = path.join(first.output, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.targetFreezePermitted = true;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await assert.rejects(
      () => verifyDefiniteExclusions({ repositoryRoot: ROOT, snapshotDirectory: first.output }),
      /checksum mismatch/i,
    );
  } finally {
    await rm(first.temporary, { recursive: true, force: true });
  }

  const second = await temporarySnapshot();
  try {
    const pathsFile = path.join(second.output, "exclusion-paths.jsonl");
    const rows = parseJsonl(await readFile(pathsFile, "utf8"));
    rows[0].formalNoEdgeStatus = "DockQ=0.42";
    await writeFile(pathsFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await refreshChecksum(second.output, "exclusion-paths.jsonl");
    await assert.rejects(
      () => verifyDefiniteExclusions({ repositoryRoot: ROOT, snapshotDirectory: second.output }),
      /Observed holdout-label assignment|not reproducible/,
    );
  } finally {
    await rm(second.temporary, { recursive: true, force: true });
  }
});
