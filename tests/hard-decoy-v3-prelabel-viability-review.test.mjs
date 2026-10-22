import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPrelabelViabilityReview,
  verifyPrelabelViabilityReview,
  writePrelabelViabilityReview,
} from "../scripts/hard-decoy-v3/build-prelabel-viability-review.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const COMMITTED = path.join(ROOT, "validation/hard-decoy-holdout-v3/prelabel-viability-review-2026-09-04");
const SNAPSHOT_FILES = [
  "README.md",
  "candidate-review-queue.jsonl",
  "checksums.sha256",
  "decision-record.json",
  "manifest.json",
  "summary.json",
];

test("the committed pre-label viability review matches deterministic reconstruction", async () => {
  const summary = await verifyPrelabelViabilityReview(ROOT, COMMITTED);
  assert.equal(summary.sourceEntryCount, 287);
  assert.equal(summary.directLookingEntryCount, 39);
  assert.equal(summary.nonDevelopmentDirectLookingEntryCount, 29);
  assert.equal(summary.directDevelopmentPathCount, 19);
  assert.equal(summary.transitiveDevelopmentPathCount, 4);
  assert.equal(summary.noDevelopmentPathCount, 6);
  assert.equal(summary.formallyClearedComponentCount, 0);
  assert.equal(summary.targetFreezePermitted, false);
  assert.equal(summary.executionAuthorized, false);
});

test("a fresh queue is byte-identical and remains review-only", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-prelabel-viability-"));
  const output = path.join(temporary, "snapshot");
  try {
    await writePrelabelViabilityReview({ repositoryRoot: ROOT, outputDirectory: output });
    for (const name of SNAPSHOT_FILES) {
      assert.deepEqual(await readFile(path.join(output, name)), await readFile(path.join(COMMITTED, name)), `${name} is not deterministic.`);
    }
    const queue = (await readFile(path.join(output, "candidate-review-queue.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
    assert.equal(queue.length, 29);
    assert.ok(queue.every((row) => row.formalLeakageStatus === "UNRESOLVED"));
    assert.ok(queue.every((row) => row.formalDisposition === "PENDING_REQUIRED_METADATA"));
    assert.ok(queue.every((row) => row.automaticTargetPromotionPermitted === false));
    assert.ok(queue.every((row) => row.nativeCoordinatesInspected === false));
    assert.deepEqual(
      queue.filter((row) => row.reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW").map((row) => row.pdbId),
      ["6N51", "7DGE", "7EPB", "8T7H", "8XFP", "8XFS"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the decision rule cannot shrink or relabel the formal holdout", async () => {
  const { model } = await buildPrelabelViabilityReview(ROOT);
  assert.equal(model.decision.requiredIndependentComponents, 10);
  assert.equal(model.decision.currentFormallyClearedComponents, 0);
  assert.equal(model.decision.decisionRule.thresholdMayBeLoweredAfterReview, false);
  assert.equal(model.decision.decisionRule.fewerThanTenOutcome, "TARGET_CENSUS_BLOCKED");
  assert.equal(model.decision.decisionRule.smallerGpcrPanelStudyLabel, "EXPLORATORY_FEASIBILITY_STUDY");
  assert.equal(model.decision.decisionRule.smallerPanelMaySupportFormalHoldoutClaim, false);
  assert.equal(model.decision.decisionRule.broaderStudyMustBeSeparatelyPreregistered, true);
  assert.equal(model.decision.decisionRule.crossStudyPoolingPermitted, false);
});
