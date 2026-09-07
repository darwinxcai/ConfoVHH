import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/review-exposure-addendum-2026-09-07";
const ADDENDUM = `${PACKAGE}/exposure-addendum.json`;
const PRIOR = "validation/hard-decoy-holdout-v3/adgrv1-source-followup-2026-09-04/exposure-scope.json";
const PRIOR_SHA256 = "1e1ac56c38aff7157c5ab006819a67c459dc99b1eb5de471ecad450150da315e";
const EXPECTED_IDS = [
  "AMYLIN_NB35_RESULTS_PROSE",
  "ADGRV1_SEARCH_SNIPPET_CONTACT_AND_PREDICTION_PROSE",
];

const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function verifyChecksums(repositoryRoot) {
  const file = await readFile(path.join(repositoryRoot, PACKAGE, "checksums.sha256"), "utf8");
  const lines = file.trimEnd().split("\n");
  assert.deepEqual(lines.map(line => line.split("  ")[1]), ["README.md", "exposure-addendum.json"]);
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^/]+)$/u.exec(line);
    assert.ok(match, `Malformed checksum line: ${line}`);
    const bytes = await readFile(path.join(repositoryRoot, PACKAGE, match[2]));
    assert.equal(sha(bytes), match[1], `${match[2]} checksum changed`);
  }
}

export async function verifyReviewExposureFollowup(repositoryRoot = ROOT, supplied = null) {
  const priorBytes = await readFile(path.join(repositoryRoot, PRIOR));
  assert.equal(sha(priorBytes), PRIOR_SHA256, "Prior ADGRV1 exposure record changed");
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.eligibilityOrExposureClearanceGranted, false);
  assert.equal(prior.historicalCaveatsRemainInForce.some(row => row.pdbId === "9FTE"), true);

  const actual = supplied ?? JSON.parse(await readFile(path.join(repositoryRoot, ADDENDUM), "utf8"));
  assert.equal(actual.schemaVersion, "1.0.0");
  assert.equal(actual.studyId, "confovhh-hard-decoy-holdout-v3");
  assert.equal(actual.reviewDate, "2026-09-07");
  assert.equal(actual.incidentClass, "INCIDENTAL_WEB_SEARCH_RESULT_RENDERING");
  assert.deepEqual(actual.incidents.map(row => row.incidentId), EXPECTED_IDS);
  assert.deepEqual(actual.incidents[0].affectedSource.pdbIds, [
    "7TYF", "7TYH", "7TYI", "7TYL", "7TYN", "7TYO", "7TYW", "7TYX", "7TYY", "7TZF",
  ]);
  assert.deepEqual(actual.incidents[1].affectedSource.pdbIds, ["9FTE"]);
  assert.equal(actual.incidents[1].priorExposureRecord.sha256, PRIOR_SHA256);
  assert.equal(actual.incidents[1].exposureCategories.actualResiduePairAssignmentsRead, true);
  assert.equal(actual.incidents[1].exposureCategories.predictionOutputsRead, true);
  for (const incident of actual.incidents) {
    assert.equal(incident.effect.familyNowRequiresExposureAdjudication, true);
    assert.equal(incident.effect.sourceReviewAdvanced, false);
    assert.equal(incident.exposureCategories.nativeCoordinateValuesRead, false);
    assert.equal(incident.exposureCategories.nativeRelativePoseInspected, false);
    assert.equal(incident.exposureCategories.structuralImagesRendered, false);
    assert.equal(incident.exposureCategories.structuralContactTablesRead, false);
    assert.equal(incident.exposureCategories.dockqCapriLabelsRead, false);
    assert.equal(incident.exposureCategories.benchmarkPerformanceResultsRead, false);
  }
  assert.deepEqual(actual.useRestrictions, {
    copiedRestrictedProseIntoAddendum: false,
    usedForEligibility: false,
    usedForBindingRole: false,
    usedForConstructAdjudication: false,
    usedForGraphEdge: false,
    usedForNoEdgeDecision: false,
    usedForComponentCount: false,
  });
  assert.equal(actual.effect.cleanBlindClaimPermittedForAffectedEntries, false);
  assert.equal(actual.effect.formalExposureClearanceGranted, false);
  assert.equal(actual.effect.scientificDispositionChanged, false);
  assert.equal(actual.effect.eligibleComponentCountChanged, false);
  assert.equal(actual.effect.wholeCensusBoundEstablished, false);
  assert.equal(actual.effect.targetFreezePermitted, false);
  if (supplied === null) await verifyChecksums(repositoryRoot);
  return {
    verified: true,
    incidentCount: actual.incidents.length,
    affectedEntryCount: new Set(actual.incidents.flatMap(row => row.affectedSource.pdbIds)).size,
    newFamilyExposureReviewCount: actual.incidents.filter(row => !row.effect.familyPreviouslyRecordedNonCleanBlind).length,
    eligibleComponentCountChanged: actual.effect.eligibleComponentCountChanged,
    targetFreezePermitted: actual.effect.targetFreezePermitted,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await verifyReviewExposureFollowup();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
