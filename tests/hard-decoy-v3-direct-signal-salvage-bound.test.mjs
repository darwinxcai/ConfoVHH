import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildDirectSignalSalvageBound, writeDirectSignalSalvageBound } from "../scripts/hard-decoy-v3/build-direct-signal-salvage-bound.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/direct-signal-salvage-bound-2026-09-04");

test("all 24 direct-signal salvage rows have a zero component-increment upper bound", async () => {
  const { accounting, summary } = await buildDirectSignalSalvageBound(ROOT);
  assert.equal(accounting.length, 24);
  assert.ok(accounting.every((row) => row.independentComponentCountIncrementUpperBound === 0));
  assert.equal(summary.recordedPrimaryReceptorEdgeAccountingCount, 21);
  assert.equal(summary.supplementalExactTmEdgeAccountingCount, 1);
  assert.equal(summary.independentComponentCountIncrementUpperBoundFromReviewedSet, 0);
  assert.equal(summary.selectedSalvageReviewCombinedIncrementUpperBound, 0);
});

test("US28 fusion constructs map exactly and unambiguously to all seven 4XT1 TM segments", async () => {
  const { us28Mappings } = await buildDirectSignalSalvageBound(ROOT);
  assert.deepEqual(us28Mappings.map((row) => row.pdbId), ["5WB1", "5WB2"]);
  for (const row of us28Mappings) {
    assert.equal(row.segments.length, 7);
    assert.ok(row.segments.every((segment) => segment.exactOccurrenceCount === 1));
    assert.ok(row.segments.every((segment, index, segments) => index === 0 || segment.constructStartIndex0 >= segments[index - 1].constructEndIndexExclusive0));
    assert.equal(row.allSevenSegmentsUniqueExactAndOrdered, true);
    assert.equal(row.globalTmIdentity, 1);
    assert.equal(row.coverageCandidateTm, 1);
    assert.equal(row.coverageDevelopmentTm, 1);
    assert.equal(row.developmentCanonicalTmSequenceSha256, "1e239aa540e5be37c6875af243ff8687b335fee3f79e386cfe65993320cf2d8b");
    assert.equal(row.nativeCoordinatesInspected, false);
  }
});

test("the source-backed exclusions distinguish fusion and auxiliary roles", async () => {
  const { exclusions, summary } = await buildDirectSignalSalvageBound(ROOT);
  assert.deepEqual(exclusions.map((row) => row.pdbId), ["5WB1", "8TB7"]);
  assert.deepEqual(exclusions.map((row) => row.dispositionCode), ["EXCLUDE_FUSION_DOMINATED_INTERFACE", "EXCLUDE_AUXILIARY_BINDER"]);
  assert.equal(summary.sourceBackedFusionExclusionCount, 1);
  assert.equal(summary.sourceBackedAuxiliaryBinderExclusionCount, 1);
  assert.ok(exclusions.every((row) => row.publicSourcesReviewed && row.evidenceUrls.length >= 2));
});

test("8JXS loss lowers the prioritized frontier to eight groups", async () => {
  const { censusImpact, summary } = await buildDirectSignalSalvageBound(ROOT);
  assert.deepEqual(censusImpact.map((row) => row.pdbId), ["8JXS"]);
  assert.deepEqual(summary.developmentConnectedExistingRepresentativeIds, ["8JXS"]);
  assert.equal(summary.existingProvisionalComponentCountBeforeThisAudit, 7);
  assert.equal(summary.existingProvisionalComponentSurvivalUpperBound, 6);
  assert.equal(summary.directLookingStratumIncrementUpperBound, 2);
  assert.equal(summary.prioritizedFrontierUpperBound, 8);
  assert.equal(summary.requiredIndependentComponentCount, 10);
  assert.equal(summary.minimumAdditionalComponentsRequiredFromUnselectedRows, 2);
  assert.equal(summary.unselectedOtherRowsStillOpenForComponentSearch, 212);
});

test("the bounded audit preserves formal and pre-oracle guardrails", async () => {
  const { accounting, summary, manifest } = await buildDirectSignalSalvageBound(ROOT);
  assert.equal(summary.remainingFormalPendingOtherStrataRowCount, 236);
  assert.equal(summary.formalPendingRowsWithZeroComponentIncrementUpperBoundInThisPackage, 22);
  assert.equal(summary.wholeCensusTerminalDecisionReached, false);
  assert.equal(summary.targetFreezePermitted, false);
  assert.equal(summary.executionAuthorized, false);
  assert.equal(summary.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(summary.nativeRelativePosesInspected, false);
  assert.equal(summary.dockqLabelsAccessed, false);
  assert.equal(summary.performanceResultsAccessed, false);
  assert.equal(manifest.partialAuditOnly, true);
  assert.equal(manifest.formalLeakageGraphRewritten, false);
  assert.equal(manifest.masterDispositionLedgerRewritten, false);
  assert.ok(accounting.every((row) => row.nativeCoordinatesInspected === false));
});

test("checked-in direct-signal salvage artifacts are deterministic and checksummed", async () => {
  const generated = await writeDirectSignalSalvageBound(ROOT, OUTPUT);
  assert.equal(generated.output, OUTPUT);
  const checksums = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
});
