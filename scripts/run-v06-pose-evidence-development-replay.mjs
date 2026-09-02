#!/usr/bin/env node
/**
 * v0.6 pose-evidence candidate — development replay.
 *
 * Scores the already-executed DockQ development pilot with both the attested
 * v0.5 evidence ordinal and the v0.6 candidate, using the pilot's own tie-aware
 * metric definitions so the two are directly comparable.
 *
 * This reads development-role poses only. It does not touch the hard-decoy
 * holdout, and it fits nothing: the candidate carries no coefficients, so this
 * script measures a fixed function rather than selecting one.
 *
 * Usage:
 *   node scripts/run-v06-pose-evidence-development-replay.mjs [--write]
 *
 * Without --write it prints the comparison. With --write it also refreshes
 * validation/v0.6-pose-evidence-candidate-v1/development-replay.json and its
 * checksum record.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scorePoseEvidenceV06, POSE_EVIDENCE_V06_POLICY } from "../lib/pose-evidence-v06.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const PILOT = path.join(root, "validation", "dockq-development-pilot-v1", "poses.jsonl");
const OUT_DIR = path.join(root, "validation", "v0.6-pose-evidence-candidate-v1");

/** Matches the development pilot's prespecified primary cutoff. */
const DOCKQ_POSITIVE_CUTOFF = 0.23;
/** Fixed so repeated runs are byte-identical. */
const RECORDED_DATE = "2026-09-02";

/**
 * Transcribed exactly from the pilot's own scoreForArm, which collapses
 * "limited" and "not-assessable" to the same rank. Reproducing the recorded
 * baseline matters more than a mapping we might prefer: a four-level split
 * would quietly improve the arm we are comparing against.
 */
const EVIDENCE_ORDINAL = {
  supported: 2,
  mixed: 1,
  limited: 0,
  "not-assessable": 0,
};

// ---------------------------------------------------------------------------
// Metric definitions, transcribed from scripts/run-dockq-development-pilot.mjs
// so the candidate is measured on identical terms to the recorded v0.5 arms.
// ---------------------------------------------------------------------------

function groupedRows(rows) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  const groups = [];
  for (const row of ordered) {
    const last = groups.at(-1);
    if (last && Object.is(last.score, row.score)) last.rows.push(row);
    else groups.push({ score: row.score, rows: [row] });
  }
  return groups;
}

function groupedAveragePrecision(rows) {
  const positives = rows.reduce((sum, row) => sum + row.label, 0);
  if (!positives || positives === rows.length) return null;
  let cumulativePositive = 0;
  let cumulativeTotal = 0;
  let result = 0;
  for (const group of groupedRows(rows)) {
    const groupPositive = group.rows.reduce((sum, row) => sum + row.label, 0);
    cumulativePositive += groupPositive;
    cumulativeTotal += group.rows.length;
    result += (groupPositive / positives) * (cumulativePositive / cumulativeTotal);
  }
  return result;
}

function tiedAuRoc(rows) {
  const positive = rows.filter((row) => row.label === 1);
  const negative = rows.filter((row) => row.label === 0);
  if (!positive.length || !negative.length) return null;
  let credit = 0;
  for (const left of positive) {
    for (const right of negative) {
      if (left.score > right.score) credit += 1;
      else if (left.score === right.score) credit += 0.5;
    }
  }
  return credit / (positive.length * negative.length);
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value) => (Number.isFinite(value) ? Number(value.toFixed(12)) : null);

// ---------------------------------------------------------------------------
// Score arms
// ---------------------------------------------------------------------------

/**
 * Not-assessable poses are given the bottom score rather than dropped, matching
 * the pilot's documented missing-value policy for the CDR arm.
 */
function scoreForArm(pose, arm) {
  switch (arm) {
    case "confovhh_evidence_v0_4":
      return EVIDENCE_ORDINAL[pose.audit.evidenceLevel] ?? 0;
    case "pose_evidence_v0_6": {
      const evidence = scorePoseEvidenceV06(pose.audit);
      return evidence.burialScore ?? 0;
    }
    case "delta_sasa":
      return pose.audit.deltaSasaAngstrom2 ?? 0;
    case "random_all_tied":
      return 0;
    default:
      throw new Error(`Unknown arm: ${arm}`);
  }
}

const ARMS = ["confovhh_evidence_v0_4", "pose_evidence_v0_6", "delta_sasa", "random_all_tied"];

function perTargetMetrics(poses, arm) {
  const scored = poses
    .map((pose) => ({
      score: scoreForArm(pose, arm),
      label: pose.dockq.DockQ >= DOCKQ_POSITIVE_CUTOFF ? 1 : 0,
    }))
    .filter((row) => Number.isFinite(row.score));
  if (!scored.length) return null;
  const positives = scored.reduce((sum, row) => sum + row.label, 0);
  const prevalence = positives / scored.length;
  const averagePrecision = groupedAveragePrecision(scored);
  return {
    poseCount: scored.length,
    positiveCount: positives,
    prevalence,
    averagePrecision,
    averagePrecisionLift:
      averagePrecision == null || prevalence === 0 ? null : averagePrecision / prevalence,
    auroc: tiedAuRoc(scored),
  };
}

async function main() {
  const write = process.argv.includes("--write");

  const raw = await readFile(PILOT, "utf8");
  const poses = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((pose) => pose.eligibility === "retained" && pose.dockq);

  if (!poses.length) throw new Error("No retained development poses were read.");
  for (const pose of poses) {
    if (pose.dataRole !== "development") {
      throw new Error(`Refusing to score a non-development pose: ${pose.poseId}`);
    }
  }

  const byTarget = new Map();
  for (const pose of poses) {
    if (!byTarget.has(pose.targetId)) byTarget.set(pose.targetId, []);
    byTarget.get(pose.targetId).push(pose);
  }
  const targetIds = [...byTarget.keys()].sort();

  const macro = {};
  const perTarget = {};
  for (const arm of ARMS) {
    perTarget[arm] = {};
    for (const targetId of targetIds) {
      perTarget[arm][targetId] = perTargetMetrics(byTarget.get(targetId), arm);
    }
    const collect = (metric) =>
      Object.values(perTarget[arm])
        .map((target) => target?.[metric])
        .filter(Number.isFinite);
    macro[arm] = {
      averagePrecision: round(mean(collect("averagePrecision"))),
      averagePrecisionLift: round(mean(collect("averagePrecisionLift"))),
      auroc: round(mean(collect("auroc"))),
      eligibleTargets: collect("auroc").length,
    };
  }

  // Assessability accounting for the candidate.
  let assessable = 0;
  let notAssessable = 0;
  const cautionCounts = {};
  for (const pose of poses) {
    const evidence = scorePoseEvidenceV06(pose.audit);
    if (evidence.assessability === "assessable") assessable += 1;
    else notAssessable += 1;
    for (const caution of evidence.cautions) {
      cautionCounts[caution.code] = (cautionCounts[caution.code] ?? 0) + 1;
    }
  }

  const record = {
    schemaVersion: "1.0.0",
    candidateId: "confovhh-v0.6-pose-evidence-candidate-v1",
    recordedDate: RECORDED_DATE,
    status: "DEVELOPMENT_REPLAY_ONLY_NOT_INTEGRATED",
    dataRole: "development",
    sourceArtifact: "validation/dockq-development-pilot-v1",
    dockqPositiveCutoff: DOCKQ_POSITIVE_CUTOFF,
    metricDefinitions:
      "Tie-aware grouped average precision and tie-aware AUROC, transcribed from " +
      "scripts/run-dockq-development-pilot.mjs; target-macro aggregation.",
    candidatePolicy: POSE_EVIDENCE_V06_POLICY,
    poseAccounting: {
      retainedPoses: poses.length,
      targets: targetIds.length,
      candidateAssessable: assessable,
      candidateNotAssessable: notAssessable,
      cautionCounts,
    },
    macro,
    perTarget,
    claimFlags: {
      improvesBindingPrediction: false,
      improvesAffinityPrediction: false,
      improvesPoseCorrectnessPrediction: false,
      establishesGeneralization: false,
      constitutesIndependentHoldoutEvidence: false,
      establishesExperimentalBinding: false,
      tunedAgainstDockqLabels: false,
      hardDecoyHoldoutAccessed: false,
    },
    interpretationBoundary:
      "Development-set association only, on a native-derived local rigid-body " +
      "perturbation grid across five previously used complexes. It does not test " +
      "blind docking, wrong-patch decoys, flexible conformational change, non-binders, " +
      "unseen receptor families, or experimental binding. The prospectively specified " +
      "hard-decoy protocol remains unexecuted.",
  };

  const table = [
    "arm                          AP       AP lift   AUROC",
    ...ARMS.map((arm) => {
      const m = macro[arm];
      const f = (v) => (v == null ? "  n/a  " : v.toFixed(4).padStart(7));
      return `${arm.padEnd(28)}${f(m.averagePrecision)}  ${f(m.averagePrecisionLift)}  ${f(m.auroc)}`;
    }),
  ].join("\n");

  console.log(`Targets: ${targetIds.length}   Retained poses: ${poses.length}`);
  console.log(`Candidate assessable: ${assessable}   not-assessable: ${notAssessable}`);
  console.log();
  console.log(table);
  console.log();
  const shipped = macro.confovhh_evidence_v0_4.auroc;
  const candidate = macro.pose_evidence_v0_6.auroc;
  console.log(
    `AUROC change, shipped -> candidate: ${shipped.toFixed(4)} -> ${candidate.toFixed(4)} ` +
      `(${candidate > shipped ? "+" : ""}${(candidate - shipped).toFixed(4)})`,
  );

  if (write) {
    await mkdir(OUT_DIR, { recursive: true });
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    const target = path.join(OUT_DIR, "development-replay.json");
    await writeFile(target, serialized);
    const digest = createHash("sha256").update(serialized).digest("hex");
    await writeFile(
      path.join(OUT_DIR, "checksums.sha256"),
      `${digest}  development-replay.json\n`,
    );
    console.log(`\nWrote ${path.relative(root, target)}`);
    console.log(`sha256 ${digest}`);
  }
}

await main();
