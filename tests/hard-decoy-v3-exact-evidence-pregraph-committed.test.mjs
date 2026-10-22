import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyExactEvidencePregraph } from "../scripts/hard-decoy/v3-exact-evidence-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29");
const ATTESTATION = path.join(ROOT, "validation/hard-decoy-holdout-v3/EXACT_EVIDENCE_PREGRAPH_ATTESTATION_2026-08-29.json");
const DEVELOPMENT_ATTESTATION = path.join(ROOT, "validation/hard-decoy-holdout-v3/DEVELOPMENT_METADATA_COMPLETION_2026-08-29.json");

test("the committed exact-evidence pregraph replays all nodes, pairs, and conservative authority states", async () => {
  const result = await verifyExactEvidencePregraph({ repositoryRoot: ROOT, snapshotDirectory: SNAPSHOT });
  assert.deepEqual(result, {
    status: "EXACT_METADATA_EVIDENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_FORMAL_LEAKAGE_AUDIT",
    candidateNodeCount: 287,
    developmentNodeCount: 17,
    totalNodeCount: 304,
    allUnorderedPairCount: 46056,
    positiveEvidencePairCount: 3013,
    exactPdbExclusionReconciliationCount: 15,
    definiteEvidenceComponentCount: 100,
    inclusiveEvidenceComponentCount: 18,
    candidateNodesConnectedToDevelopmentByDefiniteEvidence: 33,
    candidateNodesConnectedToDevelopmentByInclusiveEvidence: 262,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  });
});

test("the exact-evidence attestation is cryptographically bound to both evidence and development snapshots", async () => {
  const attestation = JSON.parse(await readFile(ATTESTATION, "utf8"));
  const evidenceChecksums = await readFile(path.join(SNAPSHOT, "checksums.sha256"));
  const developmentAttestationBytes = await readFile(DEVELOPMENT_ATTESTATION);
  const evidenceRoot = createHash("sha256").update(evidenceChecksums).digest("hex");
  const developmentAttestationRoot = createHash("sha256").update(developmentAttestationBytes).digest("hex");
  assert.equal(attestation.snapshotChecksumsSha256, evidenceRoot);
  assert.equal(evidenceRoot, "d0a4e22b0b4f879dd59b551dffbef4e2860fffebbf6bb458eb6280c850a08553");
  assert.equal(attestation.developmentMetadataAttestationSha256, developmentAttestationRoot);
  assert.equal(developmentAttestationRoot, "c04c62b46ccc5f2a9c64d26ee6f801208e1a9afe0e88e7db0c43eeb6a1e104c0");
  assert.equal(attestation.interpretation.exactMetadataEvidencePregraphOnly, true);
  assert.equal(attestation.interpretation.formalLeakageGraph, false);
  assert.equal(attestation.interpretation.formalNoEdgeClaims, false);
  assert.equal(attestation.formallyClearedGroupCount, 0);
  assert.equal(attestation.targetFreezePermitted, false);
  assert.equal(attestation.executionAuthorized, false);
  assert.equal(attestation.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(attestation.dockqLabelsAccessed, false);
});

test("the 262-node inclusive development connectivity is explicitly not treated as formal leakage", async () => {
  const summary = JSON.parse(await readFile(path.join(SNAPSHOT, "summary.json"), "utf8"));
  assert.equal(summary.candidateNodesConnectedToDevelopmentByDefiniteEvidence, 33);
  assert.equal(summary.candidateNodesConnectedToDevelopmentByInclusiveEvidence, 262);
  assert.equal(summary.formalLeakageGraphComplete, false);
  assert.equal(summary.dispositionLedgerComplete, false);
  assert.equal(summary.formallyClearedGroupCount, 0);
  assert.equal(summary.targetFreezePermitted, false);
});
