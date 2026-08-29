import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyDevelopmentMetadataSnapshot } from "../scripts/hard-decoy/v3-development-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29");

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
