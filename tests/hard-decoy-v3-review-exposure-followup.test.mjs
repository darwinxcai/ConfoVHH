import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { verifyReviewExposureFollowup } from "../scripts/hard-decoy-v3/verify-review-exposure-followup.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ADDENDUM = "validation/hard-decoy-holdout-v3/review-exposure-addendum-2026-09-07/exposure-addendum.json";

async function record() {
  return JSON.parse(await readFile(path.join(ROOT, ADDENDUM), "utf8"));
}

test("both web-search exposure incidents are quarantined without scientific authority", async () => {
  const result = await verifyReviewExposureFollowup(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.incidentCount, 2);
  assert.equal(result.affectedEntryCount, 11);
  assert.equal(result.newFamilyExposureReviewCount, 1);
  assert.equal(result.eligibleComponentCountChanged, false);
  assert.equal(result.targetFreezePermitted, false);
});

test("the follow-up cannot grant clearance or use exposed prose", async () => {
  const clearance = await record();
  clearance.effect.formalExposureClearanceGranted = true;
  await assert.rejects(verifyReviewExposureFollowup(ROOT, clearance));

  const roleUse = await record();
  roleUse.useRestrictions.usedForBindingRole = true;
  await assert.rejects(verifyReviewExposureFollowup(ROOT, roleUse));

  const advanced = await record();
  advanced.incidents[0].effect.sourceReviewAdvanced = true;
  await assert.rejects(verifyReviewExposureFollowup(ROOT, advanced));
});

test("restricted prose is distinguished from artifacts that were not opened", async () => {
  const incidents = (await record()).incidents;
  assert.equal(incidents[0].exposureCategories.actualResiduePairAssignmentsRead, false);
  assert.equal(incidents[0].exposureCategories.predictionOutputsRead, false);
  assert.equal(incidents[1].exposureCategories.actualResiduePairAssignmentsRead, true);
  assert.equal(incidents[1].exposureCategories.predictionOutputsRead, true);
  for (const incident of incidents) {
    assert.equal(incident.exposureCategories.nativeCoordinateValuesRead, false);
    assert.equal(incident.exposureCategories.nativeRelativePoseInspected, false);
    assert.equal(incident.exposureCategories.structuralImagesRendered, false);
    assert.equal(incident.exposureCategories.structuralContactTablesRead, false);
    assert.equal(incident.exposureCategories.dockqCapriLabelsRead, false);
  }
});
