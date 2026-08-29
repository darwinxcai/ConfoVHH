import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectExactEvidencePregraph,
  verifyExactEvidencePregraph,
} from "../scripts/hard-decoy/v3-exact-evidence-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILES = [
  "README.md",
  "candidate-candidate-evidence.jsonl",
  "candidate-development-evidence.jsonl",
  "candidate-nodes.jsonl",
  "checksums.sha256",
  "definite-evidence-components.jsonl",
  "development-development-evidence.jsonl",
  "development-nodes.jsonl",
  "inclusive-evidence-components.jsonl",
  "manifest.json",
  "pair-space-commitments.json",
  "summary.json",
];
const ALLOWED_EVIDENCE_TYPES = new Set([
  "EXACT_PDB_ID_REUSE",
  "EXACT_RECEPTOR_ENTITY_SEQUENCE",
  "EXACT_SINGLETON_RECEPTOR_UNIPROT",
  "EXACT_PRIMARY_DOI",
  "EXACT_PRIMARY_PMID",
  "EXACT_UNIQUE_VHH_METADATA_SEQUENCE",
  "SHARED_RECEPTOR_UNIPROT_WITH_MULTIACCESSION_AMBIGUITY",
  "SHARED_VHH_METADATA_SEQUENCE_WITH_ROLE_AMBIGUITY",
]);

function parseJsonl(text) {
  return text.trim() ? text.trimEnd().split("\n").map(JSON.parse) : [];
}

async function temporarySnapshot() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-exact-evidence-"));
  const output = path.join(temporary, "snapshot");
  const result = await collectExactEvidencePregraph({ repositoryRoot: ROOT, outputDirectory: output });
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

test("the pregraph commits all 304 nodes and all 46,056 unordered pairs without claiming a formal graph", async () => {
  const { temporary, output, result } = await temporarySnapshot();
  try {
    assert.equal(result.status, "EXACT_METADATA_EVIDENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_FORMAL_LEAKAGE_AUDIT");
    assert.equal(result.candidateNodeCount, 287);
    assert.equal(result.developmentNodeCount, 17);
    assert.equal(result.totalNodeCount, 304);
    assert.equal(result.allUnorderedPairCount, 46056);
    assert.ok(result.positiveEvidencePairCount > 0);
    assert.equal(result.exactPdbExclusionReconciliationCount, 15);
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(result.dockqLabelsAccessed, false);

    const pairSpace = JSON.parse(await readFile(path.join(output, "pair-space-commitments.json"), "utf8"));
    assert.equal(pairSpace.candidateCandidate.count, 41041);
    assert.equal(pairSpace.candidateDevelopment.count, 4879);
    assert.equal(pairSpace.developmentDevelopment.count, 136);
    assert.equal(pairSpace.allUnorderedPairs.count, 46056);
    assert.equal(pairSpace.absenceOfStoredPairIsNotNoEdgeEvidence, true);
    assert.equal(pairSpace.formalLeakageGraphAuthority, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("exact development PDB reuse reconciles the 15 frozen seed exclusions and nothing is promoted", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const rows = parseJsonl(await readFile(path.join(output, "candidate-development-evidence.jsonl"), "utf8"));
    const exactPdb = rows.filter((row) => row.evidenceTypes.includes("EXACT_PDB_ID_REUSE"));
    assert.equal(exactPdb.length, 15);
    assert.ok(exactPdb.every((row) => row.exactPdbReconcilesExistingDisposition === true));
    assert.ok(rows.every((row) => row.formalLeakageEdgeStatus === "UNRESOLVED"));
    assert.ok(rows.every((row) => row.formalNoEdgeStatus === "NOT_ASSESSED"));
    assert.ok(rows.every((row) => row.directInterfaceRolesResolved === false));
    assert.ok(rows.every((row) => row.automaticTargetPromotionPermitted === false));
    assert.ok(rows.every((row) => row.nativeCoordinatesInspected === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("only prespecified exact or explicitly ambiguous metadata evidence types are emitted", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const evidenceFiles = [
      "candidate-candidate-evidence.jsonl",
      "candidate-development-evidence.jsonl",
      "development-development-evidence.jsonl",
    ];
    const rows = (await Promise.all(evidenceFiles.map(async (file) => parseJsonl(await readFile(path.join(output, file), "utf8"))))).flat();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.evidenceTypes.length > 0);
      assert.ok(row.evidenceTypes.every((type) => ALLOWED_EVIDENCE_TYPES.has(type)), `Unexpected evidence type in ${row.pairId}`);
      assert.doesNotMatch(JSON.stringify(row), /(?:TM1|TM7|IMGT|epitopeEdge|sequenceIdentityPercent)/iu);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("development and candidate VHH ambiguity remains explicit rather than becoming direct-interface evidence", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const development = parseJsonl(await readFile(path.join(output, "development-nodes.jsonl"), "utf8"));
    const candidate = parseJsonl(await readFile(path.join(output, "candidate-nodes.jsonl"), "utf8"));
    const eightQot = development.find((node) => node.pdbId === "8QOT");
    assert.ok(eightQot);
    assert.equal(eightQot.vhhMetadataCandidateStatus, "MULTIPLE_METADATA_CANDIDATES");
    assert.equal(eightQot.vhhMetadataCandidates.length, 2);
    assert.equal(eightQot.directReceptorVhhEvidence, "UNRESOLVED");
    assert.ok([...development, ...candidate].every((node) => node.formalLeakageEdgeAuthority === false));
    assert.ok([...development, ...candidate].every((node) => node.formalNoEdgeAuthority === false));
    assert.ok([...development, ...candidate].every((node) => node.targetEligibilityAuthority === false));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("definite and inclusive components are deterministic complete partitions, not formal leakage components", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    for (const file of ["definite-evidence-components.jsonl", "inclusive-evidence-components.jsonl"]) {
      const rows = parseJsonl(await readFile(path.join(output, file), "utf8"));
      const members = rows.flatMap((row) => row.nodeIds);
      assert.equal(members.length, 304);
      assert.equal(new Set(members).size, 304);
      assert.ok(rows.every((row) => row.formalLeakageComponent === false));
      assert.ok(rows.every((row) => row.formalTargetEligibilityAuthority === false));
      assert.ok(rows.every((row) => row.nodeCount === row.nodeIds.length));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("exact evidence generation is byte-for-byte deterministic", async () => {
  const first = await temporarySnapshot();
  const second = await temporarySnapshot();
  try {
    for (const file of FILES) {
      assert.deepEqual(await readFile(path.join(first.output, file)), await readFile(path.join(second.output, file)), file);
    }
  } finally {
    await rm(first.temporary, { recursive: true, force: true });
    await rm(second.temporary, { recursive: true, force: true });
  }
});

test("a content mutation cannot bypass the checksum inventory", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const summaryPath = path.join(output, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.formalLeakageGraphComplete = true;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await assert.rejects(
      () => verifyExactEvidencePregraph({ repositoryRoot: ROOT, snapshotDirectory: output }),
      /checksum mismatch/i,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("even a rechecksummed observed-label injection fails closed", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    const evidencePath = path.join(output, "candidate-development-evidence.jsonl");
    const rows = parseJsonl(await readFile(evidencePath, "utf8"));
    assert.ok(rows.length > 0);
    rows[0].formalLeakageEdgeStatus = "DockQ=0.42";
    await writeFile(evidencePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await refreshChecksum(output, "candidate-development-evidence.jsonl");
    await assert.rejects(
      () => verifyExactEvidencePregraph({ repositoryRoot: ROOT, snapshotDirectory: output }),
      /Observed holdout-label assignment|not reproducible/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
