#!/usr/bin/env node
/**
 * v0.6 pose-evidence candidate — development replay.
 *
 * Scores the already-executed DockQ development pilot with the attested v0.5
 * evidence ordinal, the superseded candidate.1 burial-only arm, and the current
 * candidate.2 arm, using the pilot's own tie-aware metric definitions so all
 * arms are directly comparable.
 *
 * This reads development-role poses only. It does not touch the hard-decoy
 * holdout, and it fits nothing: the candidate carries no coefficients and
 * introduces no thresholds, so this script measures fixed functions rather than
 * selecting one.
 *
 * Two accountings are reported side by side because they answer different
 * questions and the two candidates disagree about which matters:
 *
 *   - AUROC and average precision score global separation across all poses.
 *   - Rank-1 and rank-k correctness score what the product actually shows a
 *     user, which is the top of the list.
 *
 * Candidate.1 won the first and lost the second. See the module header of
 * lib/pose-evidence-v06.ts.
 *
 * Usage:
 *   node scripts/run-v06-pose-evidence-development-replay.mjs [--write]
 *
 * Without --write it prints the comparison. With --write it also refreshes
 * validation/v0.6-pose-evidence-candidate-v2/development-replay.json and its
 * checksum record. It never writes to the frozen candidate-v1 directory.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scorePoseEvidenceV06,
  POSE_EVIDENCE_V06_POLICY,
  POSE_EVIDENCE_V06_TIER_ORDER,
} from "../lib/pose-evidence-v06.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const PILOT = path.join(root, "validation", "dockq-development-pilot-v1", "poses.jsonl");
const OUT_DIR = path.join(root, "validation", "v0.6-pose-evidence-candidate-v2");

/** Matches the development pilot's prespecified primary cutoff. */
const DOCKQ_POSITIVE_CUTOFF = 0.23;
/** Fixed so repeated runs are byte-identical. */
const RECORDED_DATE = "2026-09-02";

/**
 * Lexicographic stride for the (tier, burial) rank key. Burial is bounded far
 * below this on any physical interface, and the assertion below refuses to
 * proceed if that ever stops being true, so the composition stays exact rather
 * than becoming a weighted sum by accident.
 */
const TIER_STRIDE = 1e6;

/**
 * Transcribed exactly from the pilot's own scoreForArm, which collapses
 * "limited" and "not-assessable" to the same rank. Reproducing the recorded
 * baseline matters more than a mapping we might prefer: a four-level split
 * would quietly improve the arm we are comparing against.
 */
const EVIDENCE_ORDINAL = POSE_EVIDENCE_V06_TIER_ORDER;

// ---------------------------------------------------------------------------
// Metric definitions, transcribed from scripts/run-dockq-development-pilot.mjs
// so every arm is measured on identical terms to the recorded v0.5 arms.
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
 * Not-assessable poses are given the bottom score of their tier rather than
 * dropped, matching the pilot's documented missing-value policy for the CDR arm.
 */
function scoreForArm(pose, arm) {
  const evidence = scorePoseEvidenceV06(pose.audit);
  const burial = evidence.burialScore ?? 0;
  switch (arm) {
    case "confovhh_evidence_v0_4":
      return EVIDENCE_ORDINAL[pose.audit.evidenceLevel] ?? 0;
    case "pose_evidence_v0_6_candidate_1":
      // The superseded arm: burial alone, ignoring the shipped verdict.
      return burial;
    case "pose_evidence_v0_6":
      if (burial >= TIER_STRIDE) {
        throw new Error(
          `Burial ${burial} exceeds the lexicographic stride; the rank key would ` +
            "stop being a strict tier ordering.",
        );
      }
      return evidence.evidenceTier * TIER_STRIDE + burial;
    case "delta_sasa":
      return pose.audit.deltaSasaAngstrom2 ?? 0;
    case "random_all_tied":
      return 0;
    default:
      throw new Error(`Unknown arm: ${arm}`);
  }
}

const ARMS = [
  "confovhh_evidence_v0_4",
  "pose_evidence_v0_6",
  "pose_evidence_v0_6_candidate_1",
  "delta_sasa",
  "random_all_tied",
];

/**
 * Rank-k correctness, computed tie-aware.
 *
 * The obvious implementation — sort, break ties on pose identifier, ask whether
 * rank 1 is a positive — is invalid on this pilot, and visibly so: the all-tied
 * control arm scores 5/5 under it. Pose identifiers encode perturbation
 * magnitude in zero-padded fields ("rot0020-trans0005"), so ordering a tied
 * block lexicographically orders it by increasing distance from the native pose.
 * Any arm that leaves a large tie at the top is handed the near-native pose for
 * free. That is ground truth leaking through the tie-break.
 *
 * So rank-k is reported as an expectation under uniform random tie-breaking,
 * consistent with the tie-aware AUROC and average precision the pilot already
 * uses. A group that straddles the rank-k boundary contributes its positives in
 * proportion to the slots it fills. Under this definition the all-tied control
 * returns the target's positive prevalence, which is what a control should return.
 */
function expectedPrecisionAtK(scored, k) {
  const depth = Math.min(k, scored.length);
  let slots = depth;
  let hits = 0;
  for (const group of groupedRows(scored)) {
    if (slots <= 0) break;
    const take = Math.min(slots, group.rows.length);
    const positives = group.rows.reduce((sum, row) => sum + row.label, 0);
    hits += positives * (take / group.rows.length);
    slots -= take;
  }
  return hits / depth;
}

function rankAccounting(scored, depths) {
  const groups = groupedRows(scored);
  const topGroup = groups[0].rows;
  const accounting = {};
  for (const depth of depths) {
    accounting[`expectedPrecisionAtRank${depth}`] = expectedPrecisionAtK(scored, depth);
  }
  return {
    ...accounting,
    // Reported so a reader can see how much resolution the arm actually has at
    // the top, rather than inferring it from the expectation alone.
    topScoreGroupSize: topGroup.length,
    expectedRank1Dockq: mean(topGroup.map((row) => row.dockq)),
  };
}

const RANK_DEPTHS = [1, 3, 5, 10];

function perTargetMetrics(poses, arm) {
  const scored = poses
    .map((pose) => ({
      score: scoreForArm(pose, arm),
      label: pose.dockq.DockQ >= DOCKQ_POSITIVE_CUTOFF ? 1 : 0,
      dockq: pose.dockq.DockQ,
      poseId: pose.poseId,
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
    ...rankAccounting(scored, RANK_DEPTHS),
  };
}

/**
 * The overshoot diagnostic: burial against pose quality by decile, and the
 * single most-buried pose of each target. This is the evidence that ranking on
 * burial alone promotes interpenetrating poses, so it is recorded in the
 * artifact rather than left in the commit message.
 */
function overshootDiagnostic(poses, byTarget, targetIds) {
  const ordered = [...poses].sort(
    (left, right) =>
      left.audit.halfDeltaSasaInterfaceAreaAngstrom2 -
      right.audit.halfDeltaSasaInterfaceAreaAngstrom2,
  );
  const deciles = [];
  for (let index = 0; index < 10; index += 1) {
    const slice = ordered.slice(
      Math.floor((index * ordered.length) / 10),
      Math.floor(((index + 1) * ordered.length) / 10),
    );
    deciles.push({
      decile: index + 1,
      poseCount: slice.length,
      meanBurial: round(mean(slice.map((p) => p.audit.halfDeltaSasaInterfaceAreaAngstrom2))),
      meanDockq: round(mean(slice.map((p) => p.dockq.DockQ))),
      meanSevereOverlaps: round(mean(slice.map((p) => p.audit.severeClashCount))),
      positiveRate: round(
        slice.filter((p) => p.dockq.DockQ >= DOCKQ_POSITIVE_CUTOFF).length / slice.length,
      ),
    });
  }

  const describe = (pose) => ({
    poseId: pose.poseId,
    burialAngstrom2: round(pose.audit.halfDeltaSasaInterfaceAreaAngstrom2),
    severeOverlapCount: pose.audit.severeClashCount,
    maximumOverlapAngstrom: round(pose.audit.maximumOverlapAngstrom),
    contactPairCount: pose.audit.contactPairCount,
    shippedEvidenceLevel: pose.audit.evidenceLevel,
    dockq: round(pose.dockq.DockQ),
  });

  const perTarget = {};
  let mostBuriedNegative = 0;
  for (const targetId of targetIds) {
    const group = byTarget.get(targetId);
    const mostBuried = group.reduce((best, pose) =>
      pose.audit.halfDeltaSasaInterfaceAreaAngstrom2 >
      best.audit.halfDeltaSasaInterfaceAreaAngstrom2
        ? pose
        : best,
    );
    const nearNative = group.reduce((best, pose) =>
      pose.dockq.DockQ > best.dockq.DockQ ? pose : best,
    );
    if (mostBuried.dockq.DockQ < DOCKQ_POSITIVE_CUTOFF) mostBuriedNegative += 1;
    perTarget[targetId] = {
      mostBuried: describe(mostBuried),
      nearNative: describe(nearNative),
    };
  }

  return {
    burialDeciles: deciles,
    perTarget,
    targetsWhereMostBuriedPoseIsDockqNegative: mostBuriedNegative,
    targets: targetIds.length,
  };
}

/**
 * Top-tier precision of the shipped ordinal, which is the property candidate.2
 * inherits and candidate.1 discarded.
 */
function shippedTopTierPrecision(byTarget, targetIds) {
  const perTarget = {};
  let occupants = 0;
  let positives = 0;
  for (const targetId of targetIds) {
    const group = byTarget.get(targetId);
    const top = Math.max(
      ...group.map((pose) => EVIDENCE_ORDINAL[pose.audit.evidenceLevel] ?? 0),
    );
    const tier = group.filter(
      (pose) => (EVIDENCE_ORDINAL[pose.audit.evidenceLevel] ?? 0) === top,
    );
    const good = tier.filter((pose) => pose.dockq.DockQ >= DOCKQ_POSITIVE_CUTOFF).length;
    occupants += tier.length;
    positives += good;
    perTarget[targetId] = { tier: top, occupants: tier.length, dockqPositive: good };
  }
  return { perTarget, occupants, dockqPositive: positives };
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
      ...Object.fromEntries(
        RANK_DEPTHS.map((depth) => [
          `expectedPrecisionAtRank${depth}`,
          round(mean(collect(`expectedPrecisionAtRank${depth}`))),
        ]),
      ),
      meanTopScoreGroupSize: round(mean(collect("topScoreGroupSize"))),
      expectedRank1Dockq: round(mean(collect("expectedRank1Dockq"))),
    };
  }

  // Assessability accounting for the candidate.
  let assessable = 0;
  let notAssessable = 0;
  const cautionCounts = {};
  const tierCounts = {};
  for (const pose of poses) {
    const evidence = scorePoseEvidenceV06(pose.audit);
    if (evidence.assessability === "assessable") assessable += 1;
    else notAssessable += 1;
    tierCounts[evidence.shippedEvidenceLevel] =
      (tierCounts[evidence.shippedEvidenceLevel] ?? 0) + 1;
    for (const caution of evidence.cautions) {
      cautionCounts[caution.code] = (cautionCounts[caution.code] ?? 0) + 1;
    }
  }

  // Does the secondary key earn its place? Burial's separation inside the
  // "limited" block, which is where the shipped ordinal expresses no preference.
  const withinLimited = {};
  const withinLimitedAuroc = [];
  for (const targetId of targetIds) {
    const group = byTarget
      .get(targetId)
      .filter((pose) => pose.audit.evidenceLevel === "limited");
    const scored = group.map((pose) => ({
      score: pose.audit.halfDeltaSasaInterfaceAreaAngstrom2 ?? 0,
      label: pose.dockq.DockQ >= DOCKQ_POSITIVE_CUTOFF ? 1 : 0,
    }));
    const auroc = tiedAuRoc(scored);
    withinLimited[targetId] = {
      poseCount: group.length,
      positiveCount: scored.filter((row) => row.label).length,
      auroc: round(auroc),
    };
    if (Number.isFinite(auroc)) withinLimitedAuroc.push(auroc);
  }

  const record = {
    schemaVersion: "1.1.0",
    candidateId: "confovhh-v0.6-pose-evidence-candidate-v2",
    supersedes: "confovhh-v0.6-pose-evidence-candidate-v1",
    recordedDate: RECORDED_DATE,
    status: "DEVELOPMENT_REPLAY_ONLY_NOT_INTEGRATED",
    dataRole: "development",
    sourceArtifact: "validation/dockq-development-pilot-v1",
    dockqPositiveCutoff: DOCKQ_POSITIVE_CUTOFF,
    metricDefinitions:
      "Tie-aware grouped average precision and tie-aware AUROC, transcribed from " +
      "scripts/run-dockq-development-pilot.mjs; target-macro aggregation. Rank-k " +
      "correctness uses the same total order as rankPosesWithinTargetV06, with " +
      "ties broken on pose identifier rather than credited to their best member.",
    candidatePolicy: POSE_EVIDENCE_V06_POLICY,
    poseAccounting: {
      retainedPoses: poses.length,
      targets: targetIds.length,
      candidateAssessable: assessable,
      candidateNotAssessable: notAssessable,
      shippedTierCounts: tierCounts,
      cautionCounts,
    },
    macro,
    perTarget,
    shippedTopTierPrecision: shippedTopTierPrecision(byTarget, targetIds),
    secondaryKeyWithinLimitedTier: {
      perTarget: withinLimited,
      targetMacroAuroc: round(mean(withinLimitedAuroc)),
      note:
        "Burial's separation inside the shipped 'limited' block, where the " +
        "ordinal expresses no preference at all. This is the resolution the " +
        "secondary key contributes.",
    },
    burialOvershoot: overshootDiagnostic(poses, byTarget, targetIds),
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
    developmentSetSelection: {
      armsCompared: ARMS.length,
      candidateRevisionsCompared: 2,
      note:
        "The choice between candidate.1 (burial alone) and candidate.2 (shipped " +
        "tier refined by burial) was made by reading development results, which " +
        "is what a development set is for. No coefficient was fitted and no " +
        "threshold was introduced, but the reported development figures carry " +
        "the optimism of that selection and are expected to fall on a holdout.",
    },
    interpretationBoundary:
      "Development-set association only, on a native-derived local rigid-body " +
      "perturbation grid across five previously used complexes. It does not test " +
      "blind docking, wrong-patch decoys, flexible conformational change, non-binders, " +
      "unseen receptor families, or experimental binding. The prospectively specified " +
      "hard-decoy protocol remains unexecuted.",
  };

  const table = [
    "arm                                  AP    AUROC     P@1     P@5   tie@1   DockQ@1",
    ...ARMS.map((arm) => {
      const m = macro[arm];
      const f = (v) => (v == null ? "  n/a  " : v.toFixed(4).padStart(7));
      return (
        `${arm.padEnd(32)}${f(m.averagePrecision)}  ${f(m.auroc)}  ` +
        `${f(m.expectedPrecisionAtRank1)}  ${f(m.expectedPrecisionAtRank5)}  ` +
        `${m.meanTopScoreGroupSize.toFixed(1).padStart(5)}  ${f(m.expectedRank1Dockq)}`
      );
    }),
  ].join("\n");

  console.log(`Targets: ${targetIds.length}   Retained poses: ${poses.length}`);
  console.log(`Candidate assessable: ${assessable}   not-assessable: ${notAssessable}`);
  console.log();
  console.log(table);
  console.log(
    "\nP@k is expected precision under random tie-breaking; tie@1 is the mean size of " +
      "the top-scoring\ntied block. The all-tied control returns the positive prevalence, " +
      "as it should.",
  );
  console.log();
  const shipped = macro.confovhh_evidence_v0_4;
  const candidate = macro.pose_evidence_v0_6;
  const superseded = macro.pose_evidence_v0_6_candidate_1;
  console.log(
    `AUROC, shipped -> candidate.2: ${shipped.auroc.toFixed(4)} -> ${candidate.auroc.toFixed(4)} ` +
      `(${candidate.auroc > shipped.auroc ? "+" : ""}${(candidate.auroc - shipped.auroc).toFixed(4)})`,
  );
  console.log(
    `Expected precision at rank 1: shipped ${shipped.expectedPrecisionAtRank1.toFixed(4)}, ` +
      `candidate.2 ${candidate.expectedPrecisionAtRank1.toFixed(4)}, ` +
      `candidate.1 ${superseded.expectedPrecisionAtRank1.toFixed(4)}, ` +
      `all-tied control ${macro.random_all_tied.expectedPrecisionAtRank1.toFixed(4)}`,
  );
  console.log(
    `Most-buried pose is DockQ-negative in ` +
      `${record.burialOvershoot.targetsWhereMostBuriedPoseIsDockqNegative}/${targetIds.length} targets.`,
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
