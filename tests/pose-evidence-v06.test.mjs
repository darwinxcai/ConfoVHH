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
  POSE_EVIDENCE_V06_TIER_ORDER,
  poseEvidenceInputFromAuditV06,
  rankPosesWithinTargetV06,
  scorePoseEvidenceV06,
} from "../lib/pose-evidence-v06.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidateDirectory = path.join(root, "validation", "v0.6-pose-evidence-candidate-v2");
const supersededDirectory = path.join(root, "validation", "v0.6-pose-evidence-candidate-v1");

const readCandidate = async (name) =>
  JSON.parse(await readFile(path.join(candidateDirectory, name), "utf8"));

/** A pose that clears every structural minimum. */
function assessablePose(overrides = {}) {
  return {
    evidenceLevel: "mixed",
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

const scored = (poses) =>
  poses.map((pose) => ({ ...pose, evidence: scorePoseEvidenceV06(pose.audit) }));

test("the candidate policy is frozen and carries no fitted coefficient or new threshold", () => {
  assert.equal(POSE_EVIDENCE_V06_POLICY.version, POSE_EVIDENCE_V06_CANDIDATE_VERSION);
  assert.equal(POSE_EVIDENCE_V06_POLICY.status, "development-candidate-not-integrated");
  assert.equal(POSE_EVIDENCE_V06_POLICY.supersedes, "0.6.0-candidate.1");
  assert.equal(POSE_EVIDENCE_V06_POLICY.fittedCoefficients, 0);
  assert.equal(POSE_EVIDENCE_V06_POLICY.newThresholdsIntroduced, 0);
  assert.equal(POSE_EVIDENCE_V06_POLICY.reordersAcrossShippedTiers, false);
  assert.equal(POSE_EVIDENCE_V06_POLICY.rankingScope, "within-target-only");
  // Clash burden gates the ranking again, inherited with the shipped tier.
  // Candidate.1 removed that gate and rank-1 precision collapsed to 0.2.
  assert.equal(POSE_EVIDENCE_V06_POLICY.clashBurdenGatesRanking, true);
  assert.throws(() => {
    POSE_EVIDENCE_V06_POLICY.fittedCoefficients = 1;
  });
  assert.throws(() => {
    POSE_EVIDENCE_V06_TIER_ORDER.supported = 9;
  });
  assert.match(POSE_EVIDENCE_V06_BOUNDARY, /does not establish binding/);
});

test("the shipped evidence level is carried through, never recomputed", () => {
  // A pose whose geometry would not earn "supported" on merit keeps the tier the
  // shipped policy gave it: this candidate is not a second opinion on the verdict.
  const contradictory = scorePoseEvidenceV06(
    assessablePose({ evidenceLevel: "supported", severeClashCount: 40, maximumOverlapAngstrom: 2.9 }),
  );
  assert.equal(contradictory.shippedEvidenceLevel, "supported");
  assert.equal(contradictory.evidenceTier, 2);

  for (const [level, tier] of Object.entries(POSE_EVIDENCE_V06_TIER_ORDER)) {
    const evidence = scorePoseEvidenceV06(assessablePose({ evidenceLevel: level }));
    assert.equal(evidence.shippedEvidenceLevel, level);
    assert.equal(evidence.evidenceTier, tier);
  }
  // "limited" and "not-assessable" share a tier, exactly as the development
  // pilot's own scoreForArm collapses them. Splitting them would move the
  // baseline this candidate is measured against.
  assert.equal(POSE_EVIDENCE_V06_TIER_ORDER.limited, POSE_EVIDENCE_V06_TIER_ORDER["not-assessable"]);
});

test("the audit adapter reads both numbering shapes identically", () => {
  // A live analyzeInterface result nests numbering; the recorded development
  // ledger flattens it. Two mappings would let the replay and the public panel
  // disagree about which poses raise a numbering caution.
  const flattened = assessablePose({ imgtNumberingStatus: "unavailable" });
  const withoutFlattened = assessablePose();
  delete withoutFlattened.imgtNumberingStatus;
  const nested = { ...withoutFlattened, vhhNumbering: { status: "unavailable" } };

  assert.deepEqual(
    poseEvidenceInputFromAuditV06(nested),
    poseEvidenceInputFromAuditV06(flattened),
  );
  assert.deepEqual(
    scorePoseEvidenceV06(poseEvidenceInputFromAuditV06(nested)).cautions,
    scorePoseEvidenceV06(poseEvidenceInputFromAuditV06(flattened)).cautions,
  );

  // Absent on both shapes means "not reported", not "unnumbered": inventing a
  // status here would raise a caution on every pose the panel scores.
  assert.equal(
    poseEvidenceInputFromAuditV06(withoutFlattened).imgtNumberingStatus,
    null,
  );
  assert.deepEqual(
    scorePoseEvidenceV06(poseEvidenceInputFromAuditV06(withoutFlattened)).cautions,
    [],
  );

  // The adapter carries the ranking inputs verbatim; it must not reshape them.
  const numbered = poseEvidenceInputFromAuditV06(assessablePose());
  assert.equal(numbered.evidenceLevel, "mixed");
  assert.equal(numbered.halfDeltaSasaInterfaceAreaAngstrom2, 900);
  assert.equal(numbered.imgtNumberingStatus, "numbered");
});

test("the secondary key is interface burial passed through unchanged", () => {
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
    const evidence = scorePoseEvidenceV06(assessablePose({ ...overrides, evidenceLevel: "supported" }));
    assert.equal(evidence.assessability, "not-assessable");
    assert.equal(evidence.burialScore, null);
    assert.match(evidence.notAssessableReason, expected);
    // Failing closed must not move the pose out of the tier the shipped policy
    // put it in; it sinks within that tier and no further.
    assert.equal(evidence.evidenceTier, 2);
  }
});

test("interpenetration is reported, and is honest that it already moved the tier", () => {
  const clean = scorePoseEvidenceV06(
    assessablePose({ severeClashCount: 0, maximumOverlapAngstrom: 0.2 }),
  );
  const interpenetrating = scorePoseEvidenceV06(
    assessablePose({ severeClashCount: 44, maximumOverlapAngstrom: 2.7 }),
  );

  assert.equal(clean.cautions.length, 0);
  const caution = interpenetrating.cautions.find(
    (entry) => entry.code === "interpenetration-suspected",
  );
  assert.ok(caution, "a deeply overlapping pose should raise a caution");
  assert.match(caution.detail, /inflated by chains passing through one another/);
  // Overlap is an input to the shipped tier, so claiming it does not affect the
  // ranking would be false. Candidate.1 made exactly that claim.
  assert.equal(caution.affectsRanking, true);
});

test("sparse interfaces and missing numbering raise non-gating cautions", () => {
  const sparse = scorePoseEvidenceV06(assessablePose({ contactPairCount: 5 }));
  assert.equal(sparse.assessability, "assessable");
  assert.equal(sparse.burialScore, 900);
  const sparseCaution = sparse.cautions.find((entry) => entry.code === "sparse-interface");
  assert.ok(sparseCaution);
  assert.equal(sparseCaution.affectsRanking, false);

  const unnumbered = scorePoseEvidenceV06(assessablePose({ imgtNumberingStatus: "unavailable" }));
  assert.equal(unnumbered.burialScore, 900);
  const numberingCaution = unnumbered.cautions.find(
    (entry) => entry.code === "numbering-unavailable",
  );
  assert.ok(numberingCaution);
  assert.equal(numberingCaution.affectsRanking, false);
});

test("burial orders poses inside a tier and never across tiers", () => {
  const poses = scored([
    // Highest burial in the pilot's range, but the shipped policy called it limited.
    { poseId: "deep", audit: assessablePose({ evidenceLevel: "limited", halfDeltaSasaInterfaceAreaAngstrom2: 4880 }) },
    { poseId: "mid", audit: assessablePose({ evidenceLevel: "mixed", halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "top", audit: assessablePose({ evidenceLevel: "supported", halfDeltaSasaInterfaceAreaAngstrom2: 100 }) },
    { poseId: "shallow", audit: assessablePose({ evidenceLevel: "limited", halfDeltaSasaInterfaceAreaAngstrom2: 200 }) },
  ]);

  // This is the safety property: a hugely buried but interpenetrating pose cannot
  // climb past a pose the shipped policy ranked above it, however deep it is.
  assert.deepEqual(rankPosesWithinTargetV06(poses).map((pose) => pose.poseId), [
    "top",
    "mid",
    "deep",
    "shallow",
  ]);
});

test("within-target ranking is total, deterministic, and sinks unassessable poses in tier", () => {
  const poses = scored([
    { poseId: "c", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "a", audit: assessablePose({ contactPairCount: 0 }) },
    { poseId: "d", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 1200 }) },
    { poseId: "b", audit: assessablePose({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "e", audit: assessablePose({ vhhInterfaceResidues: 1 }) },
  ]);

  const order = rankPosesWithinTargetV06(poses).map((pose) => pose.poseId);
  // One tier throughout; highest burial first, the 500 tie breaks on pose id,
  // unassessable last, also by id.
  assert.deepEqual(order, ["d", "b", "c", "a", "e"]);

  assert.deepEqual(rankPosesWithinTargetV06(poses).map((pose) => pose.poseId), order);
  assert.deepEqual(
    rankPosesWithinTargetV06([...poses].reverse()).map((pose) => pose.poseId),
    order,
  );
});

test("the development replay reproduces the recorded v0.5 arms exactly", async () => {
  const replay = await readCandidate("development-replay.json");
  const recorded = RELEASE_VALIDATION.dockqDevelopmentPilot;

  // If this drifts, the candidate is being compared against a moved baseline.
  assert.equal(replay.macro.confovhh_evidence_v0_4.auroc, recorded.evidenceBand.auroc);
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

test("rank-k is measured tie-aware, so the all-tied control cannot beat its prevalence", async () => {
  const replay = await readCandidate("development-replay.json");
  const control = replay.macro.random_all_tied;

  // The bug this guards against: breaking ties on pose identifier orders a tied
  // block by perturbation magnitude, because pose ids encode it in zero-padded
  // fields. Under that definition the control scored a perfect rank-1. A control
  // that beats its own prevalence is measuring the tie-break, not the arm.
  assert.equal(control.expectedPrecisionAtRank1, control.averagePrecision);
  for (const depth of [1, 3, 5, 10]) {
    assert.equal(control[`expectedPrecisionAtRank${depth}`], control.averagePrecision);
  }
  assert.equal(control.meanTopScoreGroupSize, 72);
});

test("the candidate improves ranking without giving up the shipped top tier", async () => {
  const replay = await readCandidate("development-replay.json");
  const shipped = replay.macro.confovhh_evidence_v0_4;
  const candidate = replay.macro.pose_evidence_v0_6;
  const superseded = replay.macro.pose_evidence_v0_6_candidate_1;

  // Resolution gained: the ordinal is nearly constant, the candidate is not.
  assert.ok(candidate.auroc > shipped.auroc, "the candidate should separate better than the ordinal");
  assert.ok(candidate.auroc > superseded.auroc, "and better than burial alone");
  assert.ok(candidate.averagePrecision > shipped.averagePrecision);
  assert.ok(candidate.averagePrecision > superseded.averagePrecision);
  assert.ok(shipped.auroc < 0.6, "the shipped ordinal should remain recorded as barely above chance");

  // Precision kept: the shipped top tier is inherited, so rank 1 cannot regress.
  assert.equal(shipped.expectedPrecisionAtRank1, 1);
  assert.equal(candidate.expectedPrecisionAtRank1, 1);
  assert.equal(candidate.meanTopScoreGroupSize, 1, "the candidate should leave no tie at rank 1");

  // The finding that superseded candidate.1: burial alone is worse at rank 1
  // than an all-tied control, because it ranks interpenetrating poses first.
  assert.equal(superseded.expectedPrecisionAtRank1, 0.2);
  assert.ok(
    superseded.expectedPrecisionAtRank1 < replay.macro.random_all_tied.expectedPrecisionAtRank1,
    "burial alone should be recorded as worse than the control at rank 1",
  );

  // The secondary key earns its place where the ordinal is silent.
  assert.ok(replay.secondaryKeyWithinLimitedTier.targetMacroAuroc > 0.7);
});

test("the burial overshoot is recorded, not asserted", async () => {
  const replay = await readCandidate("development-replay.json");
  const overshoot = replay.burialOvershoot;

  assert.equal(overshoot.targetsWhereMostBuriedPoseIsDockqNegative, 4);
  assert.equal(overshoot.targets, 5);

  const deciles = overshoot.burialDeciles;
  assert.equal(deciles.length, 10);
  // Burial keeps climbing while pose quality turns over, and severe overlaps
  // more than triple. That inversion is the whole reason for the tier key.
  assert.ok(deciles.at(-1).meanBurial > deciles[7].meanBurial);
  assert.ok(deciles.at(-1).meanDockq < deciles[7].meanDockq);
  assert.ok(deciles.at(-1).meanSevereOverlaps > 3 * deciles[7].meanSevereOverlaps);

  const worst = overshoot.perTarget["3P0G-A-B"];
  assert.ok(worst.mostBuried.burialAngstrom2 > 2 * worst.nearNative.burialAngstrom2);
  assert.ok(worst.mostBuried.dockq < 0.23);
  assert.ok(worst.nearNative.dockq > 0.9);
});

test("the candidate claims nothing about binding, generalization, or the holdout", async () => {
  const replay = await readCandidate("development-replay.json");
  const design = await readCandidate("design-record.json");

  for (const flags of [replay.claimFlags, design.claimFlags]) {
    for (const [name, value] of Object.entries(flags)) {
      assert.equal(value, false, `${name} must remain false`);
    }
  }

  assert.equal(design.status, "DEVELOPMENT_CANDIDATE_NOT_INTEGRATED");
  assert.equal(design.scope.productionIntegrated, false);
  assert.equal(design.scope.changesEvidenceLevelComputation, false);
  assert.equal(design.developmentEvidence.labelsUsedForFitting, false);
  assert.equal(design.candidatePolicy.fittedCoefficients, 0);
  assert.equal(design.candidatePolicy.newThresholdsIntroduced, 0);

  // Choosing candidate.2 over candidate.1 used development labels. Saying so is
  // the difference between a development record and a claim.
  assert.equal(design.developmentEvidence.labelsUsedForRevisionSelection, true);
  assert.equal(design.metricIntegrity.tieBreakLeakageFound, true);

  for (const [name, value] of Object.entries(design.frozenIntegrity)) {
    assert.equal(value, false, `${name} must remain false`);
  }

  assert.match(replay.interpretationBoundary, /hard-decoy protocol remains unexecuted/);
  assert.ok(design.knownLimitations.length >= 6);
});

test("the executed public panel is recorded, checksummed, and consistent with the design record", async () => {
  const panel = await readCandidate("public-panel.json");
  const design = await readCandidate("design-record.json");
  const recorded = await readFile(
    path.join(candidateDirectory, "public-panel.sha256"),
    "utf8",
  );
  const serialized = await readFile(
    path.join(candidateDirectory, "public-panel.json"),
    "utf8",
  );
  const digest = createHash("sha256").update(serialized).digest("hex");
  assert.equal(recorded.trim(), `${digest}  public-panel.json`);
  assert.equal(design.publicCoordinatePanel.sha256, digest);

  // The safety property, checked on real crystal coordinates rather than on
  // the perturbation grid the candidate was developed against.
  assert.equal(panel.accounting.structures, 17);
  assert.equal(panel.accounting.tierChangesAgainstShippedOrdinal, 0);
  assert.equal(panel.accounting.structuresWithAuditDrift, 0);
  assert.equal(panel.accounting.nativeRankedFirstAgainstTranslatedControls, 17);
  assert.equal(panel.accounting.translatedControlsNotAssessable, 102);
  assert.equal(panel.accounting.translatedControls, 102);
  for (const record of panel.records) {
    assert.equal(record.tierCarriedUnchanged, true, `${record.pdb}: tier not carried`);
    assert.deepEqual(record.auditDriftFields, [], `${record.pdb}: audit drift`);
  }

  // Caution calibration. A threshold that fires on 81% of the development
  // pilot and on no published structure is discriminating; one that fires on
  // real crystal contacts would not be.
  assert.equal(panel.accounting.interpenetrationCautions, 0);
  const overlaps = panel.nativeOverlapDistributionAngstrom;
  assert.equal(overlaps.cautionBoundary, 1.5);
  assert.ok(
    overlaps.maximum < overlaps.cautionBoundary,
    "a published structure reaching the caution boundary would mean it is mis-set",
  );

  for (const [name, value] of Object.entries(panel.claimFlags)) {
    assert.equal(value, false, `${name} must remain false`);
  }
  assert.equal(panel.integrity.productionIntegrated, false);
  assert.equal(panel.integrity.usesDockqLabels, false);
  assert.match(panel.interpretationBoundary, /not ranking accuracy/);
  assert.equal(design.publicCoordinatePanel.status, "EXECUTED");
});

test("the replay artifact matches its recorded checksum", async () => {
  const serialized = await readFile(path.join(candidateDirectory, "development-replay.json"), "utf8");
  const recorded = await readFile(path.join(candidateDirectory, "checksums.sha256"), "utf8");
  const digest = createHash("sha256").update(serialized).digest("hex");
  assert.equal(recorded.trim(), `${digest}  development-replay.json`);
});

test("the superseded candidate.1 record is preserved byte-for-byte", async () => {
  // Superseding a result must not edit it. The earlier measurement stands as
  // recorded; the correction is a new record that points at it.
  const serialized = await readFile(
    path.join(supersededDirectory, "development-replay.json"),
    "utf8",
  );
  const recorded = await readFile(path.join(supersededDirectory, "checksums.sha256"), "utf8");
  const digest = createHash("sha256").update(serialized).digest("hex");
  assert.equal(recorded.trim(), `${digest}  development-replay.json`);
  assert.equal(digest, "2120aa9e43c60ebc3538a3044b676442ff4979d8169cbfd2e552a64166d476dd");

  const design = await readCandidate("design-record.json");
  assert.equal(design.supersedes.candidateId, "confovhh-v0.6-pose-evidence-candidate-v1");
  assert.equal(design.supersedes.artifactPreservedByteForByte, true);
  assert.equal(design.frozenIntegrity.candidateV1ArtifactsModified, false);
});
