/**
 * Scoring and aggregation for the local-SE(3) panel extension.
 *
 * validation/panel-extension-v1/study-spec.json inherits its tie policy,
 * endpoints and aggregation from the frozen DockQ development pilot. That
 * pilot's implementation, scripts/run-dockq-development-pilot.mjs, is bound by
 * SHA-256 in the v0.5 DockQ regression attestation and exports nothing, so it
 * can neither be imported nor edited. This module therefore re-implements the
 * same estimator.
 *
 * A re-implementation is only trustworthy if it reproduces the original. The
 * spec makes that a gate rather than a claim: scripts/verify-panel-extension-gate.mjs
 * replays the pilot's own 360-pose ledger through this module and requires every
 * macro value AND every bootstrap interval to match
 * validation/dockq-development-pilot-v1/summary.json. The study aborts before
 * generating a pose if that fails.
 *
 * Reproducing the bootstrap intervals is stricter than the spec's wording, which
 * asks only for the macro metrics. It is done anyway because it removes the
 * ambiguity: an interval that matches to 1e-9 across 10,000 replicates can only
 * come from the same estimator consuming the same random stream.
 */
import assert from "node:assert/strict";

export const METRIC_KEYS = Object.freeze([
  "averagePrecision",
  "averagePrecisionLift",
  "auroc",
  "precisionAt1",
  "precisionAt5",
  "precisionAt10",
  "successAt1",
  "successAt5",
  "successAt10",
  "enrichmentFactor1Percent",
  "enrichmentFactor5Percent",
  "kendallTauB",
]);

/** The pilot's six arms, transcribed. The study adds pose_ranking_v0_6. */
export const PILOT_SCORE_ARMS = Object.freeze([
  "confovhh_evidence_v0_4",
  "contact_count",
  "delta_sasa",
  "clash_burden",
  "cdr_contact_share",
  "random_all_tied",
]);

/**
 * The shipped rank key is lexicographic — tier first, then burial — but the
 * pilot's metric machinery consumes one scalar per pose, and every tie-aware
 * metric depends on exact score equality. Encoding the pair as
 * `tier * TIER_STRIDE + burial` reproduces the lexicographic order exactly and
 * preserves ties exactly, provided burial can never reach the stride. That is
 * asserted at scoring time rather than assumed: a buried area of 10^6 square
 * angstroms is far outside anything a protein interface can produce, and if one
 * ever appeared the encoding would silently reorder tiers, so it fails closed.
 *
 * A pose with no measurable burial scores one below its tier's floor, which puts
 * it at the bottom of its own tier without letting it fall into the tier below.
 */
export const TIER_STRIDE = 1e6;

const TIER_BY_LEVEL = Object.freeze({
  supported: 2,
  mixed: 1,
  limited: 0,
  "not-assessable": 0,
});

function poseRankingScore(audit) {
  const tier = TIER_BY_LEVEL[audit.evidenceLevel] ?? 0;
  const burial = audit.halfDeltaSasaInterfaceAreaAngstrom2;
  if (!Number.isFinite(burial)) return tier * TIER_STRIDE - 1;
  assert.ok(
    burial >= 0 && burial < TIER_STRIDE - 1,
    `Interface burial ${burial} does not fit the lexicographic encoding; the ` +
      "rank key would silently reorder evidence tiers.",
  );
  return tier * TIER_STRIDE + burial;
}

export function scoreForArm(pose, arm) {
  if (arm === "pose_ranking_v0_6") return poseRankingScore(pose.audit);
  if (arm === "confovhh_evidence_v0_4") {
    return pose.audit.evidenceLevel === "supported"
      ? 2
      : pose.audit.evidenceLevel === "mixed" ? 1 : 0;
  }
  if (arm === "contact_count") return pose.audit.contactPairCount;
  if (arm === "delta_sasa") return pose.audit.deltaSasaAngstrom2;
  if (arm === "clash_burden") return -pose.audit.severeClashCount;
  if (arm === "cdr_contact_share") {
    if (pose.audit.imgtNumberingStatus !== "numbered") return -1;
    return pose.audit.cdrContactShare ?? 0;
  }
  if (arm === "random_all_tied") return 0;
  throw new Error(`Unknown score arm ${arm}`);
}

export function round(value, digits = 12) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function mean(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

export function quantile(values, probability) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

export function classifyDockq(value) {
  if (value >= 0.8) return "high";
  if (value >= 0.49) return "medium";
  if (value >= 0.23) return "acceptable";
  return "incorrect";
}

/** Descending score order, with every exact tie collected into one block. */
export function groupedRows(rows) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  const groups = [];
  for (const row of ordered) {
    const last = groups.at(-1);
    if (last && Object.is(last.score, row.score)) last.rows.push(row);
    else groups.push({ score: row.score, rows: [row] });
  }
  return groups;
}

export function groupedAveragePrecision(rows) {
  const positives = rows.reduce((sum, row) => sum + row.label, 0);
  if (!positives || positives === rows.length) return null;
  let cumulativePositive = 0;
  let cumulativeTotal = 0;
  let result = 0;
  for (const group of groupedRows(rows)) {
    const groupPositive = group.rows.reduce((sum, row) => sum + row.label, 0);
    cumulativePositive += groupPositive;
    cumulativeTotal += group.rows.length;
    result += groupPositive / positives * cumulativePositive / cumulativeTotal;
  }
  return result;
}

export function tiedAuRoc(rows) {
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

function combinationRatioWithoutPositive(total, negative, draws) {
  if (draws <= 0) return 1;
  if (draws > negative) return 0;
  let result = 1;
  for (let index = 0; index < draws; index += 1) {
    result *= (negative - index) / (total - index);
  }
  return result;
}

/**
 * Expected precision and success at k when a tie block straddles the boundary,
 * i.e. the value under uniform random tie-breaking rather than whichever order
 * the rows happened to arrive in. Without this, a rule that ties everything
 * scores whatever the input ordering encodes.
 */
export function tiedTopK(rows, requestedK) {
  const k = Math.min(requestedK, rows.length);
  if (!k) return { precision: null, success: null };
  let positions = 0;
  let positivesBeforeBoundary = 0;
  for (const group of groupedRows(rows)) {
    if (positions + group.rows.length <= k) {
      positivesBeforeBoundary += group.rows.reduce((sum, row) => sum + row.label, 0);
      positions += group.rows.length;
      if (positions === k) break;
      continue;
    }
    const remaining = k - positions;
    const groupPositive = group.rows.reduce((sum, row) => sum + row.label, 0);
    const expectedPositive = positivesBeforeBoundary + remaining * groupPositive / group.rows.length;
    const success = positivesBeforeBoundary > 0
      ? 1
      : 1 - combinationRatioWithoutPositive(
        group.rows.length,
        group.rows.length - groupPositive,
        remaining,
      );
    return { precision: expectedPositive / k, success };
  }
  return {
    precision: positivesBeforeBoundary / k,
    success: positivesBeforeBoundary > 0 ? 1 : 0,
  };
}

export function kendallTauB(rows) {
  if (rows.length < 2) return null;
  let concordant = 0;
  let discordant = 0;
  let scoreOnlyTies = 0;
  let dockqOnlyTies = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const scoreDifference = Math.sign(rows[left].score - rows[right].score);
      const dockqDifference = Math.sign(rows[left].dockq - rows[right].dockq);
      if (scoreDifference === 0 && dockqDifference === 0) continue;
      if (scoreDifference === 0) scoreOnlyTies += 1;
      else if (dockqDifference === 0) dockqOnlyTies += 1;
      else if (scoreDifference === dockqDifference) concordant += 1;
      else discordant += 1;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + scoreOnlyTies) *
    (concordant + discordant + dockqOnlyTies),
  );
  return denominator ? (concordant - discordant) / denominator : null;
}

export function targetMetrics(poses, arm, cutoff, excludeBoundary = false) {
  const candidates = poses.filter((pose) => {
    if (pose.eligibility !== "retained" || !pose.dockq) return false;
    if (excludeBoundary && pose.dockq.DockQ >= 0.21 && pose.dockq.DockQ <= 0.25) return false;
    return true;
  });
  if (
    arm === "cdr_contact_share" &&
    candidates.every((pose) => pose.audit.imgtNumberingStatus !== "numbered")
  ) return null;
  const scored = candidates
    .map((pose) => ({
      poseId: pose.poseId,
      score: scoreForArm(pose, arm),
      dockq: pose.dockq.DockQ,
      label: pose.dockq.DockQ >= cutoff ? 1 : 0,
    }))
    .filter((row) => Number.isFinite(row.score));
  if (!scored.length) return null;
  const positives = scored.reduce((sum, row) => sum + row.label, 0);
  const prevalence = positives / scored.length;
  const averagePrecision = groupedAveragePrecision(scored);
  const top1 = tiedTopK(scored, 1);
  const top5 = tiedTopK(scored, 5);
  const top10 = tiedTopK(scored, 10);
  const top1Percent = tiedTopK(scored, Math.max(1, Math.ceil(scored.length * 0.01)));
  const top5Percent = tiedTopK(scored, Math.max(1, Math.ceil(scored.length * 0.05)));
  return {
    poseCount: scored.length,
    positiveCount: positives,
    prevalence,
    averagePrecision,
    averagePrecisionLift: averagePrecision == null || prevalence === 0
      ? null
      : averagePrecision / prevalence,
    auroc: tiedAuRoc(scored),
    precisionAt1: top1.precision,
    precisionAt5: top5.precision,
    precisionAt10: top10.precision,
    successAt1: top1.success,
    successAt5: top5.success,
    successAt10: top10.success,
    enrichmentFactor1Percent: prevalence > 0 && prevalence < 1
      ? top1Percent.precision / prevalence
      : null,
    enrichmentFactor5Percent: prevalence > 0 && prevalence < 1
      ? top5Percent.precision / prevalence
      : null,
    kendallTauB: kendallTauB(scored),
  };
}

export function calculatePerTarget(posesByTarget, arms, cutoff, excludeBoundary = false) {
  const result = {};
  for (const arm of arms) {
    result[arm] = {};
    for (const [targetId, poses] of posesByTarget) {
      result[arm][targetId] = targetMetrics(poses, arm, cutoff, excludeBoundary);
    }
  }
  return result;
}

/**
 * Equal-weight macro mean over eligible targets, with the denominator retained
 * so a metric that was unavailable on some targets cannot be read as if it had
 * been measured everywhere.
 *
 * `targetIds`, when given, restricts the macro to a named population — the study
 * uses it to compute the primary endpoint over only the structures the pilot
 * never touched.
 */
export function macroFromPerTarget(perTarget, arms, targetIds = null) {
  const select = (armTable) => (
    targetIds === null
      ? Object.values(armTable)
      : targetIds.map((targetId) => armTable[targetId])
  );
  const result = {};
  for (const arm of arms) {
    result[arm] = {};
    for (const metric of METRIC_KEYS) {
      const values = select(perTarget[arm])
        .map((target) => target?.[metric])
        .filter(Number.isFinite);
      result[arm][metric] = {
        value: round(mean(values)),
        eligibleTargets: values.length,
      };
    }
    const poseCounts = select(perTarget[arm])
      .map((target) => target?.poseCount)
      .filter(Number.isFinite);
    result[arm].coverage = {
      eligibleTargets: poseCounts.length,
      minimumPosesPerEligibleTarget: poseCounts.length ? Math.min(...poseCounts) : null,
      maximumPosesPerEligibleTarget: poseCounts.length ? Math.max(...poseCounts) : null,
    };
  }
  return result;
}

export function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Paired hierarchical cluster bootstrap: sample components with replacement,
 * then targets within each sampled component with replacement. Poses are never
 * resampled — the uncertainty being described is over targets, not over the
 * grid of perturbations, which is deterministic.
 *
 * A component holding one target consumes no second draw, because there is no
 * choice to make. That is what lets this reproduce the pilot exactly: all five
 * pilot targets sit in distinct components, so the two-stage scheme degenerates
 * to the pilot's single uniform draw per sampled unit, over the same ordering
 * and therefore the same random stream.
 */
export function clusterBootstrap({ perTarget, arms, clusters, replicates, seed }) {
  const random = xorshift32(seed % 0x1_0000_0000);
  const distributions = Object.fromEntries(arms.map((arm) => [
    arm,
    Object.fromEntries(METRIC_KEYS.map((metric) => [metric, []])),
  ]));
  const pairedApDifferences = Object.fromEntries(
    arms.filter((arm) => arm !== "random_all_tied").map((arm) => [arm, []]),
  );

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const sampled = [];
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      if (cluster.targetIds.length === 1) sampled.push(cluster.targetIds[0]);
      else {
        for (let member = 0; member < cluster.targetIds.length; member += 1) {
          sampled.push(cluster.targetIds[Math.floor(random() * cluster.targetIds.length)]);
        }
      }
    }
    const replicateAp = {};
    for (const arm of arms) {
      for (const metric of METRIC_KEYS) {
        const values = sampled
          .map((targetId) => perTarget[arm][targetId]?.[metric])
          .filter(Number.isFinite);
        if (values.length) distributions[arm][metric].push(mean(values));
      }
      const apValues = sampled
        .map((targetId) => perTarget[arm][targetId]?.averagePrecision)
        .filter(Number.isFinite);
      replicateAp[arm] = apValues.length ? mean(apValues) : null;
    }
    for (const arm of Object.keys(pairedApDifferences)) {
      if (Number.isFinite(replicateAp[arm]) && Number.isFinite(replicateAp.random_all_tied)) {
        pairedApDifferences[arm].push(replicateAp[arm] - replicateAp.random_all_tied);
      }
    }
  }

  const intervals = {};
  for (const arm of arms) {
    intervals[arm] = {};
    for (const metric of METRIC_KEYS) {
      const values = distributions[arm][metric];
      intervals[arm][metric] = {
        lower: round(quantile(values, 0.025)),
        upper: round(quantile(values, 0.975)),
        finiteReplicates: values.length,
      };
    }
  }
  const differences = {};
  for (const [arm, values] of Object.entries(pairedApDifferences)) {
    differences[arm] = {
      pointReference: "paired macro average-precision difference versus all-tied baseline",
      lower: round(quantile(values, 0.025)),
      upper: round(quantile(values, 0.975)),
      finiteReplicates: values.length,
    };
  }
  return { intervals, pairedAveragePrecisionDifferenceVsAllTied: differences };
}
