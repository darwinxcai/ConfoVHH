#!/usr/bin/env node
/**
 * Implementation-equivalence gate for the local-SE(3) panel extension.
 *
 * validation/panel-extension-v1/study-spec.json requires this to pass before a
 * single pose of the seventeen-target study is generated:
 *
 *   "Re-execute the scoring pipeline over
 *    validation/dockq-development-pilot-v1/poses.jsonl using the pilot's
 *    benchmark ID, arms and tie policy, and compare every macro metric of every
 *    shared arm against validation/dockq-development-pilot-v1/summary.json."
 *
 * The reason is not ceremony. scripts/panel-extension/metrics.mjs is a
 * re-implementation of an estimator whose original is hash-pinned and cannot be
 * imported. If it does not reproduce the pilot's recorded numbers, then the
 * seventeen-target result is not comparable to the five-target result, and the
 * whole point of the study — has the ordering transferred — cannot be read off
 * it. So a mismatch aborts rather than warns.
 *
 * This checks more than the spec asks. Beyond the macro values it also
 * reproduces all 10,000-replicate bootstrap intervals and every per-target
 * metric. Matching an interval to 1e-9 across 10,000 replicates is only possible
 * if the same estimator consumed the same random stream in the same order, which
 * settles the question the spec's wording leaves open.
 *
 * Usage:
 *   node scripts/verify-panel-extension-gate.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  METRIC_KEYS,
  PILOT_SCORE_ARMS,
  calculatePerTarget,
  clusterBootstrap,
  macroFromPerTarget,
} from "./panel-extension/metrics.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PILOT = path.join(ROOT, "validation", "dockq-development-pilot-v1");
const STUDY = path.join(ROOT, "validation", "panel-extension-v1");
const TOLERANCE = 1e-9;

/** The pilot's own bootstrap constants, transcribed from its frozen spec. */
const PILOT_BOOTSTRAP_REPLICATES = 10_000;
const PILOT_BOOTSTRAP_SEED = 90_420_260_827;
const PILOT_CUTOFF = 0.23;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const failures = [];

function compare(label, actual, expected) {
  if (actual == null && expected == null) return;
  if (actual == null || expected == null) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
    return;
  }
  const difference = Math.abs(actual - expected);
  if (!(difference <= TOLERANCE)) {
    failures.push(`${label}: expected ${expected}, got ${actual} (delta ${difference})`);
  }
}

// ---------------------------------------------------------------------------
// The freeze must still be intact before its gate means anything.
// ---------------------------------------------------------------------------
const checksums = readFileSync(path.join(STUDY, "checksums.sha256"), "utf8");
for (const line of checksums.split("\n").filter((row) => row.trim())) {
  const [digest, name] = line.trim().split(/\s+/u);
  const actual = sha256(readFileSync(path.join(STUDY, name)));
  assert.equal(
    actual,
    digest,
    `${name} no longer matches the digest frozen at pre-registration. The ` +
      "protocol has drifted between freeze and run; the study cannot proceed.",
  );
}

const spec = JSON.parse(readFileSync(path.join(STUDY, "study-spec.json"), "utf8"));
assert.equal(spec.dockqPolicy.primaryBinaryLabel, "DockQ >= 0.23");
assert.equal(spec.implementationEquivalenceGate.tolerance, TOLERANCE);

// ---------------------------------------------------------------------------
// Replay the pilot's ledger through the re-implemented estimator.
// ---------------------------------------------------------------------------
const pilotSpec = JSON.parse(readFileSync(path.join(PILOT, "pilot-spec.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(PILOT, "summary.json"), "utf8"));

const posesByTarget = new Map();
for (const line of readFileSync(path.join(PILOT, "poses.jsonl"), "utf8").split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (!posesByTarget.has(row.targetId)) posesByTarget.set(row.targetId, []);
  posesByTarget.get(row.targetId).push({
    poseId: row.poseId,
    eligibility: row.eligibility,
    audit: row.audit,
    dockq: row.dockq,
  });
}

const targetIds = pilotSpec.targets.map((target) => target.targetId);
assert.deepEqual(
  [...posesByTarget.keys()].sort(),
  [...targetIds].sort(),
  "The pilot ledger does not carry exactly the pilot spec's targets.",
);

const perTarget = calculatePerTarget(posesByTarget, PILOT_SCORE_ARMS, PILOT_CUTOFF);
const macro = macroFromPerTarget(perTarget, PILOT_SCORE_ARMS);

// Every pilot target sits in its own receptor-family cluster, so the two-stage
// scheme must degenerate to the pilot's single uniform draw per sampled unit.
// Ordering follows the spec's target order, which is the order the pilot's own
// bootstrap indexed.
const clusters = pilotSpec.targets.map((target) => ({
  component: target.receptorFamilyCluster,
  targetIds: [target.targetId],
}));
assert.equal(
  new Set(clusters.map((cluster) => cluster.component)).size,
  clusters.length,
  "Two pilot targets share a receptor-family cluster; the degeneracy argument " +
    "that makes this bootstrap reproduce the pilot no longer holds.",
);

const bootstrap = clusterBootstrap({
  perTarget,
  arms: PILOT_SCORE_ARMS,
  clusters,
  replicates: PILOT_BOOTSTRAP_REPLICATES,
  seed: PILOT_BOOTSTRAP_SEED,
});

// ---------------------------------------------------------------------------
// Compare against what the frozen artifact recorded.
// ---------------------------------------------------------------------------
let macroChecks = 0;
let intervalChecks = 0;
let perTargetChecks = 0;

for (const arm of PILOT_SCORE_ARMS) {
  const recordedArm = recorded.primaryAnalysis.macro[arm];
  assert.ok(recordedArm, `summary.json has no macro block for ${arm}`);
  for (const metric of METRIC_KEYS) {
    compare(`macro.${arm}.${metric}.value`, macro[arm][metric].value, recordedArm[metric].value);
    compare(
      `macro.${arm}.${metric}.eligibleTargets`,
      macro[arm][metric].eligibleTargets,
      recordedArm[metric].eligibleTargets,
    );
    macroChecks += 1;

    const recordedInterval = recordedArm[metric].bootstrapDispersion95;
    if (recordedInterval) {
      const actual = bootstrap.intervals[arm][metric];
      compare(`bootstrap.${arm}.${metric}.lower`, actual.lower, recordedInterval.lower);
      compare(`bootstrap.${arm}.${metric}.upper`, actual.upper, recordedInterval.upper);
      compare(
        `bootstrap.${arm}.${metric}.finiteReplicates`,
        actual.finiteReplicates,
        recordedInterval.finiteReplicates,
      );
      intervalChecks += 1;
    }
  }

  const recordedPerTarget = recorded.primaryAnalysis.perTarget?.[arm];
  if (!recordedPerTarget) continue;
  for (const [targetId, expected] of Object.entries(recordedPerTarget)) {
    const actual = perTarget[arm][targetId];
    if (expected == null || actual == null) {
      assert.equal(
        actual == null,
        expected == null,
        `perTarget.${arm}.${targetId}: eligibility disagrees with the record`,
      );
      continue;
    }
    for (const metric of [...METRIC_KEYS, "poseCount", "positiveCount", "prevalence"]) {
      if (!(metric in expected)) continue;
      compare(`perTarget.${arm}.${targetId}.${metric}`, actual[metric], expected[metric]);
      perTargetChecks += 1;
    }
  }
}

const recordedDifferences = recorded.primaryAnalysis.pairedAveragePrecisionDifferenceVsAllTied;
if (recordedDifferences) {
  for (const [arm, expected] of Object.entries(recordedDifferences)) {
    const actual = bootstrap.pairedAveragePrecisionDifferenceVsAllTied[arm];
    assert.ok(actual, `no paired difference computed for ${arm}`);
    compare(`pairedApDifference.${arm}.lower`, actual.lower, expected.lower);
    compare(`pairedApDifference.${arm}.upper`, actual.upper, expected.upper);
    intervalChecks += 1;
  }
}

if (failures.length) {
  process.stderr.write(
    `\nImplementation-equivalence gate FAILED with ${failures.length} mismatch(es).\n` +
      "The re-implementation is not the pilot's estimator, so a seventeen-target\n" +
      "result computed with it would not be comparable to the five-target result.\n" +
      "The study must not run.\n\n",
  );
  for (const failure of failures.slice(0, 40)) process.stderr.write(`  - ${failure}\n`);
  if (failures.length > 40) {
    process.stderr.write(`  ... and ${failures.length - 40} more\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    gate: "implementation-equivalence",
    status: "PASS",
    specDigestVerified: true,
    replayedFrom: "validation/dockq-development-pilot-v1/poses.jsonl",
    targets: targetIds.length,
    poses: [...posesByTarget.values()].reduce((sum, poses) => sum + poses.length, 0),
    arms: PILOT_SCORE_ARMS.length,
    macroMetricsMatched: macroChecks,
    bootstrapIntervalsMatched: intervalChecks,
    perTargetMetricsMatched: perTargetChecks,
    tolerance: TOLERANCE,
  }, null, 2)}\n`,
);
