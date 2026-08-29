import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyDevelopmentMetadataSnapshot } from "../scripts/hard-decoy/v3-development-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29");
const ATTESTATION = path.join(ROOT, "validation/hard-decoy-holdout-v3/DEVELOPMENT_METADATA_COMPLETION_2026-08-29.json");

test("the committed development metadata snapshot replays all 17 nodes and preserves the blind boundary", async () => {
  const result = await verifyDevelopmentMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: SNAPSHOT });
  assert.deepEqual(result, {
    status: "DEVELOPMENT_METADATA_COMPLETED_BLOCKED_PENDING_SCIENTIFIC_LEAKAGE_AUDIT",
    developmentNodeCount: 17,
    reusedMetadataNodeCount: 15,
    newlyCompletedMetadataNodeCount: 2,
    newlyCompletedPdbIds: ["6KNM", "6O3C"],
    uniquePreferredReceptorEntityCount: 17,
    receptorNodesWithExactlyOneUniProtAccession: 10,
    uniqueVhhMetadataCandidateCount: 16,
    multipleVhhMetadataCandidateCount: 1,
    noVhhMetadataCandidateCount: 0,
    directInterfaceEvidenceResolvedCount: 0,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  });
});

test("the completion attestation is cryptographically bound to the committed snapshot", async () => {
  const attestation = JSON.parse(await readFile(ATTESTATION, "utf8"));
  const checksums = await readFile(path.join(SNAPSHOT, "checksums.sha256"));
  const observed = createHash("sha256").update(checksums).digest("hex");
  assert.equal(attestation.snapshotDirectory, "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29");
  assert.equal(attestation.snapshotChecksumsSha256, observed);
  assert.equal(observed, "add32255432d635d55657f200636d61134e726e5bf2071130df1dcf94b546758");
  assert.equal(attestation.formalLeakageCertificationComplete, false);
  assert.equal(attestation.targetFreezePermitted, false);
  assert.equal(attestation.executionAuthorized, false);
  assert.equal(attestation.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(attestation.dockqLabelsAccessed, false);
});

test("metadata ambiguity remains explicit in the committed development node ledger", async () => {
  const nodes = (await readFile(path.join(SNAPSHOT, "development-nodes.jsonl"), "utf8"))
    .trimEnd().split("\n").map(JSON.parse);
  assert.equal(nodes.length, 17);
  assert.equal(nodes.filter((node) => node.vhhMetadataCandidateStatus === "MULTIPLE_METADATA_CANDIDATES").length, 1);
  assert.equal(nodes.filter((node) => node.receptor.uniprotAccessions.length !== 1).length, 7);
  assert.ok(nodes.every((node) => node.directReceptorVhhEvidence === "UNRESOLVED"));
  assert.ok(nodes.every((node) => node.constructEvidence === "UNRESOLVED"));
  assert.ok(nodes.every((node) => node.knownParentEvidence === "UNRESOLVED"));
  assert.ok(nodes.every((node) => node.annotationEpitopeAuthority === false));
  assert.ok(nodes.every((node) => node.targetFreezeAuthority === false));
  assert.ok(nodes.every((node) => node.nativeCoordinatesInspected === false));
});
