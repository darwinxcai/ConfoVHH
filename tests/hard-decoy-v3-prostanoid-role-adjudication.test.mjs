import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildProstanoidRoleAdjudication, verifyProstanoidRoleAdjudication } from "../scripts/hard-decoy-v3/adjudicate-prostanoid-roles.mjs";
import { restoreGlobalTextArtifacts } from "../scripts/hard-decoy-v3/restore-global-text-artifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REVIEW = "validation/hard-decoy-holdout-v3/prostanoid-role-adjudication-2026-09-06/source-reviews.json";

test("all twelve prostanoid entries receive bounded source-and-inventory dispositions", async () => {
  await restoreGlobalTextArtifacts({ repositoryRoot: ROOT });
  await buildProstanoidRoleAdjudication(ROOT);
  const result = await verifyProstanoidRoleAdjudication(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.reviewedEntryCount, 12);
  assert.equal(result.reviewedPolymerCount, 47);
  assert.equal(result.entryAuxiliaryExclusionCount, 9);
  assert.equal(result.entryNoDirectTargetExclusionCount, 3);
  assert.equal(result.sourceGroupIndependentComponentIncrement, 0);
  assert.equal(result.wholeCensusUpperBound, null);
});

test("sequence relationships stay contextual and cannot become role proof", async () => {
  const review = JSON.parse(await readFile(path.join(ROOT, REVIEW), "utf8"));
  const changed = structuredClone(review);
  changed.reviews.find(row => row.pdbId === "9JRO").roleEvidence.sequenceRelationship.roleProofBySequenceAlone = true;
  await assert.rejects(verifyProstanoidRoleAdjudication(ROOT, changed), /differs from deterministic source evidence/u);
});

test("no-target dispositions do not claim experimental antibody absence", async () => {
  const review = JSON.parse(await readFile(path.join(ROOT, REVIEW), "utf8"));
  const noTarget = review.reviews.filter(row => row.entryDisposition === "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE");
  assert.deepEqual(noTarget.map(row => row.pdbId), ["9JQY", "9JQZ", "9UWD"]);
  assert.ok(noTarget.every(row => /experimental antibody absence.*not claimed/iu.test(row.dispositionReason)));
  assert.equal(noTarget.find(row => row.pdbId === "9UWD").polymerEntityCount, 1);
});

test("bounded exclusions cannot gain graph, census, freeze or restricted-content authority", async () => {
  const review = JSON.parse(await readFile(path.join(ROOT, REVIEW), "utf8"));
  assert.equal(review.authority.masterDispositionLedgerRewritten, false);
  assert.equal(review.authority.formalEligibilityAuthority, false);
  assert.equal(review.authority.formalLeakageEdgeAuthority, false);
  assert.equal(review.authority.formalNoEdgeAuthority, false);
  assert.equal(review.authority.wholeCensusDecisionMade, false);
  assert.equal(review.authority.targetFreezePermitted, false);
  assert.ok(review.reviews.every(row => !row.nativeCoordinatesInspected && !row.nativeRelativePoseInspected && !row.structuralContactTablesInspected && !row.structuralResultsInspected && !row.labelsAccessed && !row.predictionOutputsAccessed));

  const changed = structuredClone(review);
  changed.authority.targetFreezePermitted = true;
  await assert.rejects(verifyProstanoidRoleAdjudication(ROOT, changed), /differs from deterministic source evidence/u);
});
