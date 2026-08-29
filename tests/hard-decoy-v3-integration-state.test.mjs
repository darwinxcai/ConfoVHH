import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  EXPECTED_STATE_SHA256,
  STATE_RELATIVE,
  validateBlockedState,
  verifyIntegrationState,
} from "../scripts/hard-decoy-v3/verify-integration-state.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("the authoritative v3 integration state replays every current pre-label evidence layer and stays blocked", async () => {
  const result = await verifyIntegrationState(ROOT);
  assert.deepEqual(result, {
    status: "DRAFT",
    targetFreezeGate: "BLOCKED",
    selectedProtocol: "HARD_DECOY_PROTOCOL_V3.md",
    selectedDesign: "sealed-one-way-native-epitope-boolean-oracle",
    sourceEntries: 287,
    entryMetadataRows: 287,
    polymerEntities: 1401,
    repeatedRawResponses: 24,
    entryMetadataCaptures: 2,
    normalizedCaptureAgreement: true,
    dispositionRows: 287,
    resolvedDispositionRows: 15,
    pendingDispositionRows: 272,
    developmentMetadataNodes: 17,
    exactEvidenceNodes: 304,
    exactEvidenceUnorderedPairs: 46056,
    positiveExactOrAmbiguousEvidencePairs: 3013,
    candidateNodesConnectedToDevelopmentByDefiniteEvidence: 33,
    candidateNodesConnectedToDevelopmentByInclusiveEvidence: 262,
    boundedAuditReviewedLedgerRecords: 13,
    boundedAuditReviewedPdbEntries: 20,
    provisionalGroups: 7,
    formallyClearedGroups: 0,
    requiredIndependentGroups: 10,
    approvalReady: false,
    executionAuthorized: false,
  });
  assert.match(EXPECTED_STATE_SHA256, /^[a-f0-9]{64}$/u);
});

test("the integration-state policy rejects authority, label access, count drift, and threshold relaxation", async () => {
  const original = JSON.parse(await readFile(path.join(ROOT, STATE_RELATIVE), "utf8"));
  for (const mutate of [
    (state) => { state.historicalAncestry.annotationDraftAdvancementAuthority = true; },
    (state) => { state.labelBoundary.dockqOrCapriLabelsAccessedDuringV3Preparation = true; },
    (state) => { state.labelBoundary = {}; },
    (state) => { state.census.requiredIndependentGroups = 7; },
    (state) => { state.census.boundedAuditReviewedPdbEntries = 19; },
    (state) => { state.authorization.approvalReady = true; },
    (state) => { state.entryMetadata.independentCaptureCount = 1; },
    (state) => { state.dispositionSeed.pendingRows = 271; },
    (state) => { state.developmentMetadata.directInterfaceEvidenceResolvedNodes = 1; },
    (state) => { state.exactEvidencePregraph.formalLeakageGraphAuthority = true; },
    (state) => { state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByInclusiveEvidence = 261; },
    (state) => { state.status = "TARGETS_FROZEN"; },
    (state) => { state.targetFreezeGate.status = "OPEN"; },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => validateBlockedState(changed));
  }
});
