import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { verifyReviewExposureAddendum } from "../scripts/hard-decoy-v3/verify-review-exposure-addendum.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ADDENDUM = "validation/hard-decoy-holdout-v3/review-exposure-addendum-2026-09-06/exposure-addendum.json";

async function record() {
  return JSON.parse(await readFile(path.join(ROOT, ADDENDUM), "utf8"));
}

test("mGlu5 extra-scope prose exposure is bound to the existing non-clean-blind family", async () => {
  const result = await verifyReviewExposureAddendum(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.affectedEntryCount, 5);
  assert.equal(result.familyAlreadyNonCleanBlind, true);
  assert.equal(result.eligibleComponentCountChanged, false);
  assert.equal(result.targetFreezePermitted, false);
});

test("the addendum cannot grant clearance or scientific authority", async () => {
  const changed = await record();
  changed.effect.formalExposureClearanceGranted = true;
  await assert.rejects(verifyReviewExposureAddendum(ROOT, changed), /differs from the bounded record/u);

  const changedEligibility = await record();
  changedEligibility.useRestrictions.usedForEligibility = true;
  await assert.rejects(verifyReviewExposureAddendum(ROOT, changedEligibility), /differs from the bounded record/u);
});

test("the addendum distinguishes narrative exposure from restricted artifacts", async () => {
  const exposure = (await record()).exposureCategories;
  assert.equal(exposure.figureCaptionsRead, true);
  assert.equal(exposure.qualitativeContactRegionNarrativeRead, true);
  assert.equal(exposure.actualResiduePairAssignmentsRead, false);
  assert.equal(exposure.nativeCoordinateValuesRead, false);
  assert.equal(exposure.nativeRelativePoseInspected, false);
  assert.equal(exposure.structuralImagesRendered, false);
  assert.equal(exposure.structuralContactTablesRead, false);
  assert.equal(exposure.dockqCapriLabelsRead, false);
  assert.equal(exposure.predictionOutputsRead, false);
});

