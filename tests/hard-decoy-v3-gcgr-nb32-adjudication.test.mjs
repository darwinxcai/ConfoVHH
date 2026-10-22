import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { verifyGcgrNb32Adjudication } from "../scripts/hard-decoy-v3/adjudicate-gcgr-nb32.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REVIEW = "validation/hard-decoy-holdout-v3/gcgr-nb32-role-adjudication-2026-09-07/source-reviews.json";

async function review() {
  return JSON.parse(await readFile(path.join(ROOT, REVIEW), "utf8"));
}

test("both GCGR entries receive bounded auxiliary-binder exclusions", async () => {
  const result = await verifyGcgrNb32Adjudication(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.reviewedEntryCount, 2);
  assert.equal(result.reviewedPolymerCount, 7);
  assert.equal(result.entryAuxiliaryExclusionCount, 2);
  assert.equal(result.independentEligibleComponentIncrement, 0);
  assert.equal(result.formallyClearedIndependentComponentCount, 0);
  assert.equal(result.targetFreezePermitted, false);
});

test("primary source, complete inventories and Nb32 identity jointly support disposition", async () => {
  const value = await review();
  assert.deepEqual(value.reviews.map(row => row.pdbId), ["8JRU", "8JRV"]);
  assert.deepEqual(value.reviews.map(row => row.polymerEntityCount), [3, 4]);
  assert.ok(value.reviews.every(row => row.primaryDepositionLinkVerified));
  assert.ok(value.reviews.every(row => row.roleEvidence.identityEvidence.metadataDescriptionMatchesNamedReagent));
  assert.ok(value.reviews.every(row => !row.roleEvidence.identityEvidence.roleProofBySequenceAlone));
  assert.ok(value.reviews.every(row => row.coPresentAntibodyFormat.classification.includes("NOT_VHH_TARGET")));
});

test("bounded exclusions cannot gain whole-census, graph or freeze authority", async () => {
  const name = "source-reviews.json";
  const value = await review();
  assert.equal(value.authority.formalEligibilityAuthority, false);
  assert.equal(value.authority.formalLeakageEdgeAuthority, false);
  assert.equal(value.authority.formalNoEdgeAuthority, false);
  assert.equal(value.authority.wholeCensusDecisionMade, false);
  assert.equal(value.summary.wholeCensusUpperBound, null);
  value.authority.targetFreezePermitted = true;
  await assert.rejects(verifyGcgrNb32Adjudication(ROOT, new Map([[name, `${JSON.stringify(value, null, 2)}\n`]])), /differs from deterministic source evidence/u);
});

test("construct mismatch remains explicit without undoing exact core identity", async () => {
  const value = await review();
  assert.ok(value.reviews.every(row => row.unresolvedConstructDiscrepancy.includes("does not reconcile")));
  assert.ok(value.reviews.every(row => row.roleEvidence.identityEvidence.exactPublishedCoreLength === 114));
  assert.ok(value.reviews.every(row => row.roleEvidence.identityEvidence.wholeExpressionConstructIdentical === false));
});

