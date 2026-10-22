import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactDirectory = path.join(root, "validation", "dockq-development-pilot-v1");
const arms = [
  "confovhh_evidence_v0_4",
  "contact_count",
  "delta_sasa",
  "clash_burden",
  "cdr_contact_share",
  "random_all_tied",
];
const metrics = ["averagePrecision", "auroc", "kendallTauB"];
const bootstrapSeed = 90_420_260_827;
const bootstrapReplicates = 10_000;

async function json(filename) {
  return JSON.parse(await readFile(path.join(artifactDirectory, filename), "utf8"));
}

async function jsonl(filename) {
  return (await readFile(path.join(artifactDirectory, filename), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function score(pose, arm) {
  if (arm === "confovhh_evidence_v0_4") {
    return pose.audit.evidenceLevel === "supported"
      ? 2
      : pose.audit.evidenceLevel === "mixed" ? 1 : 0;
  }
  if (arm === "contact_count") return pose.audit.contactPairCount;
  if (arm === "delta_sasa") return pose.audit.deltaSasaAngstrom2;
  if (arm === "clash_burden") return -pose.audit.severeClashCount;
  if (arm === "cdr_contact_share") {
    return pose.audit.imgtNumberingStatus === "numbered"
      ? pose.audit.cdrContactShare ?? 0
      : -1;
  }
  if (arm === "random_all_tied") return 0;
  throw new Error(`Unknown arm ${arm}`);
}

function groups(rows) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  const result = [];
  for (const row of ordered) {
    const previous = result.at(-1);
    if (previous && Object.is(previous.score, row.score)) previous.rows.push(row);
    else result.push({ score: row.score, rows: [row] });
  }
  return result;
}

function averagePrecision(rows) {
  const positives = rows.reduce((sum, row) => sum + row.label, 0);
  if (!positives || positives === rows.length) return null;
  let positiveSeen = 0;
  let totalSeen = 0;
  let result = 0;
  for (const group of groups(rows)) {
    const groupPositives = group.rows.reduce((sum, row) => sum + row.label, 0);
    positiveSeen += groupPositives;
    totalSeen += group.rows.length;
    result += groupPositives / positives * positiveSeen / totalSeen;
  }
  return result;
}

function auroc(rows) {
  const positives = rows.filter((row) => row.label === 1);
  const negatives = rows.filter((row) => row.label === 0);
  if (!positives.length || !negatives.length) return null;
  let credit = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive.score > negative.score) credit += 1;
      else if (positive.score === negative.score) credit += 0.5;
    }
  }
  return credit / (positives.length * negatives.length);
}

function kendallTauB(rows) {
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

function targetMetrics(poses, arm, cutoff, excludeBoundary = false) {
  const eligible = poses.filter((pose) => (
    pose.eligibility === "retained" &&
    pose.dockq &&
    !(excludeBoundary && pose.dockq.DockQ >= 0.21 && pose.dockq.DockQ <= 0.25)
  ));
  if (
    arm === "cdr_contact_share" &&
    eligible.every((pose) => pose.audit.imgtNumberingStatus !== "numbered")
  ) return null;
  const rows = eligible.map((pose) => ({
    score: score(pose, arm),
    dockq: pose.dockq.DockQ,
    label: Number(pose.dockq.DockQ >= cutoff),
  }));
  const positives = rows.reduce((sum, row) => sum + row.label, 0);
  return {
    poseCount: rows.length,
    positiveCount: positives,
    prevalence: positives / rows.length,
    averagePrecision: averagePrecision(rows),
    auroc: auroc(rows),
    kendallTauB: kendallTauB(rows),
  };
}

function rounded(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(12));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, probability) {
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper
    ? ordered[lower]
    : ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function close(actual, expected, label) {
  if (actual == null || expected == null) assert.equal(actual, expected, label);
  else assert.ok(Math.abs(actual - expected) <= 1e-12, `${label}: ${actual} != ${expected}`);
}

test("every DockQ AP, AUROC, Kendall and target-macro point estimate independently recomputes", async () => {
  const spec = await json("pilot-spec.json");
  const summary = await json("summary.json");
  const poses = await jsonl("poses.jsonl");
  const byTarget = new Map(spec.targets.map((target) => [
    target.targetId,
    poses.filter((pose) => pose.targetId === target.targetId),
  ]));

  for (const arm of arms) {
    const targetResults = [];
    for (const [targetId, targetPoses] of byTarget) {
      const expected = targetMetrics(targetPoses, arm, 0.23);
      const recorded = summary.primaryAnalysis.perTarget[arm][targetId];
      for (const key of ["poseCount", "positiveCount", "prevalence", ...metrics]) {
        close(recorded?.[key], expected?.[key], `${arm}/${targetId}/${key}`);
      }
      if (expected) targetResults.push(expected);
    }
    for (const metric of metrics) {
      const values = targetResults.map((result) => result[metric]).filter(Number.isFinite);
      close(
        summary.primaryAnalysis.macro[arm][metric].value,
        rounded(mean(values)),
        `${arm}/macro/${metric}`,
      );
      assert.equal(summary.primaryAnalysis.macro[arm][metric].eligibleTargets, values.length);
    }
  }
});

test("DockQ cutoff and boundary sensitivity AP/AUROC/Kendall values independently recompute", async () => {
  const spec = await json("pilot-spec.json");
  const summary = await json("summary.json");
  const poses = await jsonl("poses.jsonl");
  const byTarget = new Map(spec.targets.map((target) => [
    target.targetId,
    poses.filter((pose) => pose.targetId === target.targetId),
  ]));

  const exercises = [
    ...[0.21, 0.23, 0.25].map((cutoff) => ({
      cutoff,
      excludeBoundary: false,
      recorded: summary.sensitivityAnalysis.dockqCutoffs[String(cutoff)],
    })),
    {
      cutoff: 0.23,
      excludeBoundary: true,
      recorded: summary.sensitivityAnalysis.excludeDockqBetween0_21And0_25.macro,
    },
  ];
  for (const exercise of exercises) {
    for (const arm of arms) {
      const targetResults = [...byTarget.values()]
        .map((targetPoses) => targetMetrics(
          targetPoses,
          arm,
          exercise.cutoff,
          exercise.excludeBoundary,
        ))
        .filter(Boolean);
      for (const metric of metrics) {
        const values = targetResults.map((result) => result[metric]).filter(Number.isFinite);
        close(
          exercise.recorded[arm][metric].value,
          rounded(mean(values)),
          `${exercise.cutoff}/${exercise.excludeBoundary}/${arm}/${metric}`,
        );
      }
    }
  }
});

test("all 10,000 target-bootstrap AP/AUROC/Kendall intervals independently recompute", async () => {
  const spec = await json("pilot-spec.json");
  const summary = await json("summary.json");
  const poses = await jsonl("poses.jsonl");
  const targetIds = spec.targets.map((target) => target.targetId);
  const byTarget = new Map(targetIds.map((targetId) => [
    targetId,
    poses.filter((pose) => pose.targetId === targetId),
  ]));
  const perTarget = Object.fromEntries(arms.map((arm) => [
    arm,
    Object.fromEntries([...byTarget].map(([targetId, targetPoses]) => [
      targetId,
      targetMetrics(targetPoses, arm, 0.23),
    ])),
  ]));
  const distributions = Object.fromEntries(arms.map((arm) => [
    arm,
    Object.fromEntries(metrics.map((metric) => [metric, []])),
  ]));
  const pairedAp = Object.fromEntries(arms
    .filter((arm) => arm !== "random_all_tied")
    .map((arm) => [arm, []]));
  const random = xorshift32(bootstrapSeed % 0x1_0000_0000);

  for (let replicate = 0; replicate < bootstrapReplicates; replicate += 1) {
    const sampled = Array.from({ length: targetIds.length }, () => (
      targetIds[Math.floor(random() * targetIds.length)]
    ));
    const replicateAp = {};
    for (const arm of arms) {
      for (const metric of metrics) {
        const values = sampled.map((targetId) => perTarget[arm][targetId]?.[metric]).filter(Number.isFinite);
        if (values.length) distributions[arm][metric].push(mean(values));
      }
      const values = sampled
        .map((targetId) => perTarget[arm][targetId]?.averagePrecision)
        .filter(Number.isFinite);
      replicateAp[arm] = values.length ? mean(values) : null;
    }
    for (const arm of Object.keys(pairedAp)) {
      if (Number.isFinite(replicateAp[arm]) && Number.isFinite(replicateAp.random_all_tied)) {
        pairedAp[arm].push(replicateAp[arm] - replicateAp.random_all_tied);
      }
    }
  }

  for (const arm of arms) {
    for (const metric of metrics) {
      const values = distributions[arm][metric];
      const recorded = summary.primaryAnalysis.macro[arm][metric].bootstrapDispersion95;
      assert.equal(recorded.finiteReplicates, values.length);
      close(recorded.lower, rounded(quantile(values, 0.025)), `${arm}/${metric}/bootstrap lower`);
      close(recorded.upper, rounded(quantile(values, 0.975)), `${arm}/${metric}/bootstrap upper`);
    }
  }
  for (const [arm, values] of Object.entries(pairedAp)) {
    const recorded = summary.primaryAnalysis.pairedAveragePrecisionDifferenceVsAllTied[arm];
    assert.equal(recorded.finiteReplicates, values.length);
    close(recorded.lower, rounded(quantile(values, 0.025)), `${arm}/paired AP lower`);
    close(recorded.upper, rounded(quantile(values, 0.975)), `${arm}/paired AP upper`);
  }
});
