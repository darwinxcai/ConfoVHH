import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/review-exposure-addendum-2026-09-06";
const ADDENDUM = `${PACKAGE}/exposure-addendum.json`;
const PRIOR = "validation/hard-decoy-holdout-v3/global-text-priority-review-2026-09-04/exposure-scope.json";
const PRIOR_SHA256 = "06454094fa17d299d78ba9e752cfaa342dd0662d390132340a8a5e5e2cab0e28";

const EXPECTED = {
  schemaVersion: "1.0.0",
  studyId: "confovhh-hard-decoy-holdout-v3",
  reviewDate: "2026-09-06",
  incidentClass: "INCIDENTAL_RETAINED_SOURCE_TEXT_RENDERING",
  trigger: "A broad local text search over an already-retained validation package printed raw mGlu5 article XML beyond the intended search result. No new network source or coordinate file was opened.",
  priorExposureRecord: {
    path: PRIOR,
    sha256: PRIOR_SHA256,
    familyAlreadyNonCleanBlind: true,
  },
  affectedSource: {
    doi: "10.1038/s41586-019-0881-4",
    pdbIds: ["6N4X", "6N4Y", "6N50", "6N51", "6N52"],
  },
  exposureCategories: {
    figureCaptionsRead: true,
    qualitativeStructuralNarrativeRead: true,
    qualitativeContactRegionNarrativeRead: true,
    mutationAndStructuralInterpretationNarrativeRead: true,
    actualResiduePairAssignmentsRead: false,
    nativeCoordinateValuesRead: false,
    nativeRelativePoseInspected: false,
    structuralImagesRendered: false,
    structuralContactTablesRead: false,
    dockqCapriLabelsRead: false,
    predictionOutputsRead: false,
    benchmarkPerformanceResultsRead: false,
  },
  useRestrictions: {
    copiedRestrictedProseIntoAddendum: false,
    usedForEligibility: false,
    usedForBindingRole: false,
    usedForGraphEdge: false,
    usedForNoEdgeDecision: false,
    usedForComponentCount: false,
  },
  effect: {
    familyAlreadyRequiredExposureAdjudication: true,
    cleanBlindClaimPermitted: false,
    formalExposureClearanceGranted: false,
    scientificDispositionChanged: false,
    eligibleComponentCountChanged: false,
    wholeCensusBoundEstablished: false,
    targetFreezePermitted: false,
    note: "The incident expands the preserved prose-exposure scope for an already non-clean-blind family. It supplies no scientific evidence or decision authority.",
  },
};

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

export async function verifyReviewExposureAddendum(repositoryRoot = ROOT, supplied = null) {
  const priorBytes = await readFile(path.join(repositoryRoot, PRIOR));
  assert.equal(sha(priorBytes), PRIOR_SHA256, "Prior exposure record changed");
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.incidentalProseExposure, true);
  assert.equal(prior.formalExposureClearanceGranted, false);
  assert.deepEqual(prior.incident.mglu5SourceFamilyEntriesRequiringExposureAdjudication, EXPECTED.affectedSource.pdbIds);

  const actual = supplied ?? JSON.parse(await readFile(path.join(repositoryRoot, ADDENDUM), "utf8"));
  assert.deepEqual(actual, EXPECTED, "Exposure addendum differs from the bounded record");
  await verifyChecksums(repositoryRoot);
  return {
    verified: true,
    affectedEntryCount: actual.affectedSource.pdbIds.length,
    familyAlreadyNonCleanBlind: actual.priorExposureRecord.familyAlreadyNonCleanBlind,
    eligibleComponentCountChanged: actual.effect.eligibleComponentCountChanged,
    targetFreezePermitted: actual.effect.targetFreezePermitted,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await verifyReviewExposureAddendum();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

