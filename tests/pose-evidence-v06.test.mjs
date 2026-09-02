import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RELEASE_VALIDATION } from "../lib/release-validation.ts";
import {
  POSE_EVIDENCE_V06_BOUNDARY,
  POSE_EVIDENCE_V06_CANDIDATE_VERSION,
  POSE_EVIDENCE_V06_POLICY,
  rankPosesWithinTargetV06,
  scorePoseEvidenceV06,
} from "../lib/pose-evidence-v06.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidateDirectory = path.join(root, "validation", "v0.6-pose-evidence-candidate-v1");

/** A pose that clears every structural minimum. */
function assessablePose(overrides = {}) {
  return {
    contactPairCount: 30,
    receptorInterfaceResidues: 12,
    vhhInterfaceResidues: 10,
    halfDeltaSasaInterfaceAreaAngstrom2: 900,
    severeClashCount: 0,
    maximumOverlapAngstrom: 0.2,
    imgtNumberingStatus: "numbered",
    ...overrides,
  };
}

test("the candidate policy is frozen and carries no fitted coefficient", () => {
  assert.equal(POSE_EVIDENCE_V06_POLICY.version, POSE_EVIDENCE_V06_CANDIDATE_VERSION);
  assert.equal(POSE_EVIDENCE_V06_POLICY.status, "development-candidate-not-integrated");
  assert.equal(POSE_EVIDENCE_V06_POLICY.fittedCoefficients, 0);
  assert.equal(POSE_EVIDENCE_V06_POLICY.clashBurdenGatesRanking, false);
  assert.equal(POSE_EVIDENCE_V06_POLICY.rankingScope, "within-target-only");
  assert.throws(() => {
    POSE_EVIDENCE_V06_POLICY.fittedCoefficients = 1;
  });
  assert.match(POSE_EVIDENCE_V06_BOUNDARY, /does not establish binding/);
});

test("the ranking signal is interface burial passed through unchanged", () => {
  for (const burial of [0, 1, 38, 900.5, 4880]) {
    const evidence = scorePoseEvidenceV06(
      assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: burial }),
    );
    assert.equal(evidence.assessability, "assessable");
    assert.equal(evidence.burialScore, burial);
  }
});

test("assessability fails closed rather than defaulting optimistically", () => {
  const cases = [
    [{ contactPairCount: 0 }, /No receptor–VHH residue contacts/],
    [{ receptorInterfaceResidues: 2 }, /Fewer than 3 interface residues/],
    [{ vhhInterfaceResidues: 2 }, /Fewer than 3 interface residues/],
    [{ halfDeltaSasaInterfaceAreaAngstrom2: null }, /burial could not be computed/],
    [{ halfDeltaSasaInterfaceAreaAngstrom2: Number.NaN }, /burial could not be computed/],
  ];
  for (const [overrides, expected] of cases) {
    const evidence = scorePoseEvidenceV06(assessablePose(overrides));
    assert.equal(evidence.assessability, "not-assessable");
    assert.equal(evidence.burialScore, null);
    assert.match(evidence.notAssessableReason, expected);
  }
});

test("overlap burden is reported without altering the ranking", () => {
  const clean = scorePoseEvidenceV06(
    assessablePose({ severeClashCount: 0, maximumOverlapAngstrom: 0.2 }),
  );
  const clashing = scorePoseEvidenceV06(
    assessablePose({ severeClashCount: 44, maximumOverlapAngstrom: 2.7 }),
  );

  // The defect this candidate exists to fix: heavy overlap must not demote a
  // pose, because overlap burden is not monotonic in pose error.
  assert.equal(clean.burialScore, clashing.burialScore);
  assert.equal(clean.cautions.length, 0);

  const caution = clashing.cautions.find((entry) => entry.code === "high-overlap-burden");
  assert.ok(caution, "a heavy-overlap pose should raise a caution");
  assert.equal(caution.affectsRanking, false);
  assert.match(caution.detail, /not monotonic in pose error/);
  for (const entry of clashing.cautions) assert.equal(entry.affectsRanking, false);
});

test("sparse interfaces and missing numbering raise non-gating cautions", () => {
  const sparse = scorePoseEvidenceV06(assessablePose({ contactPairCount: 5 }));
  assert.equal(sparse.assessability, "assessable");
  assert.equal(sparse.burialScore, 900);
  assert.ok(sparse.cautions.some((entry) => entry.code === "sparse-interface"));

  const unnumbered = scorePoseEvidenceV06(
    assessablePose({ imgtNumberingStatus: "unavailable" }),
  );
  assert.equal(unnumbered.burialScore, 900);
  assert.ok(unnumbered.cautions.some((entry) => entry.code === "numbering-unavailable"));
});

test("within-target ranking is total, deterministic, and sinks unassessable poses", () => {
  const poses = [
    { poseId: "c", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "a", audit: assessablePose({ contactPairCount: 0 }) },
    { poseId: "d", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 1200 }) },
    { poseId: "b", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "e", audit: assessablePose({ vhhInterfaceResidues: 1 }) },
  ].map((pose) => ({ ...pose, evidence: scorePoseEvidenceV06(pose.audit) }));

  const order = rankPosesWithinTargetV06(poses).map((pose) => pose.poseId);
  // Highest burial first; the 500 tie breaks on pose id; unassessable last, also by id.
  assert.deepEqual(order, ["d", "b", "c", "a", "e"]);

  assert.deepEqual(rankPosesWithinTargetV06(poses).map((pose) => pose.poseId), order);
  assert.deepEqual(
    rankPosesWithinTargetV06([...poses].reverse()).map((pose) => pose.poseId),
    order,
  );
});

test("the development replay reproduces the recorded v0.5 arms exactly", async () => {
  const replay = JSON.parse(
    await readFile(path.join(candidateDirectory, "development-replay.json"), "utf8"),
  );
  const recorded = RELEASE_VALIDATION.dockqDevelopmentPilot;

  // If this drifts, the candidate is being compared against a moved baseline.
  assert.equal(
    replay.macro.confovhh_evidence_v0_4.auroc,
    recorded.evidenceBand.auroc,
  );
  assert.equal(
    replay.macro.confovhh_evidence_v0_4.averagePrecision,
    recorded.evidenceBand.averagePrecision,
  );
  assert.equal(replay.macro.delta_sasa.auroc, recorded.deltaSasa.auroc);
  assert.equal(replay.macro.delta_sasa.averagePrecision, recorded.deltaSasa.averagePrecision);
  assert.equal(replay.macro.random_all_tied.auroc, 0.5);

  assert.equal(replay.poseAccounting.retainedPoses, recorded.retainedPoses);
  assert.equal(replay.poseAccounting.targets, recorded.targets);
  assert.equal(replay.dockqPositiveCutoff, 0.23);
  assert.equal(replay.dataRole, "development");
});

test("the candidate outranks the shipped ordinal on the development pilot", async () => {
  const replay = JSON.parse(
    await readFile(path.join(candidateDirectory, "development-replay.json"), "utf8"),
  );
  const shipped = replay.macro.confovhh_evidence_v0_4.auroc;
  const candidate = replay.macro.pose_evidence_v0_6.auroc;

  assert.ok(candidate > shipped, "the candidate should rank better than the shipped ordinal");
  assert.ok(candidate > 0.7, "the candidate should clear 0.7 target-macro AUROC");
  assert.ok(
    shipped < 0.6,
    "the shipped ordinal should remain recorded as barely above chance",
  );
  assert.equal(replay.poseAccounting.candidateAssessable, 339);
  assert.equal(replay.poseAccounting.candidateNotAssessable, 21);
});

test("the candidate claims nothing about binding, generalization, or the holdout", async () => {
  const replay = JSON.parse(
    await readFile(path.join(candidateDirectory, "development-replay.json"), "utf8"),
  );
  const design = JSON.parse(
    await readFile(path.join(candidateDirectory, "design-record.json"), "utf8"),
  );

  for (const flags of [replay.claimFlags, design.claimFlags]) {
    for (const [name, value] of Object.entries(flags)) {
      assert.equal(value, false, `${name} must remain false`);
    }
  }

  assert.equal(design.status, "DEVELOPMENT_CANDIDATE_NOT_INTEGRATED");
  assert.equal(design.scope.productionIntegrated, false);
  assert.equal(design.developmentEvidence.labelsUsedForFitting, false);
  assert.equal(design.candidatePolicy.fittedCoefficients, 0);

  for (const [name, value] of Object.entries(design.frozenIntegrity)) {
    assert.equal(value, false, `${name} must remain false`);
  }

  assert.match(replay.interpretationBoundary, /hard-decoy protocol remains unexecuted/);
  assert.ok(design.knownLimitations.length >= 4);
});

test("the replay artifact matches its recorded checksum", async () => {
  const serialized = await readFile(
    path.join(candidateDirectory, "development-replay.json"),
    "utf8",
  );
  const recorded = await readFile(path.join(candidateDirectory, "checksums.sha256"), "utf8");
  const digest = createHash("sha256").update(serialized).digest("hex");
  assert.equal(recorded.trim(), `${digest}  development-replay.json`);
});
