import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  POSE_RANKING_BOUNDARY,
  POSE_RANKING_POLICY,
  rankPoses,
  scorePoseRanking,
} from "../lib/pose-ranking.ts";
import {
  POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS,
  POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
  POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM,
  POSE_EVIDENCE_V06_POLICY,
  POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS,
} from "../lib/pose-evidence-v06.ts";
import { candidateShortlistToCsv, createCandidateShortlistReport } from "../lib/candidate-shortlist.ts";

const REPLAY = JSON.parse(
  readFileSync(new URL("../validation/v0.6-pose-evidence-candidate-v2/development-replay.json", import.meta.url), "utf8"),
);

const audit = (overrides = {}) => ({
  evidenceLevel: "limited",
  contactPairCount: 40,
  receptorInterfaceResidues: 20,
  vhhInterfaceResidues: 18,
  halfDeltaSasaInterfaceAreaAngstrom2: 800,
  severeClashCount: 0,
  maximumOverlapAngstrom: 0.4,
  imgtNumberingStatus: "numbered",
  ...overrides,
});

const order = (poses) =>
  rankPoses(poses, (pose) => scorePoseRanking(pose.audit)).map((pose) => pose.poseId);

test("the shipped policy carries every behavioural field from the studied candidate", () => {
  // The production module may relabel itself, but it must not quietly restate a
  // threshold or a rank key. Anything that changes behaviour is carried from the
  // frozen study, and this asserts the carry actually happened.
  for (const field of [
    "primaryRankingKey",
    "secondaryRankingKey",
    "rankingScope",
    "fittedCoefficients",
    "newThresholdsIntroduced",
    "reordersAcrossShippedTiers",
    "clashBurdenGatesRanking",
    "minimumContactPairs",
    "minimumInterfaceResiduesPerChain",
  ]) {
    assert.deepEqual(
      POSE_RANKING_POLICY[field],
      POSE_EVIDENCE_V06_POLICY[field],
      `${field} drifted between the shipped policy and the study it was measured under`,
    );
  }
  assert.equal(POSE_RANKING_POLICY.studiedAs, POSE_EVIDENCE_V06_POLICY.version);
  assert.equal(POSE_RANKING_POLICY.minimumContactPairs, POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS);
  assert.equal(
    POSE_RANKING_POLICY.minimumInterfaceResiduesPerChain,
    POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
  );
  assert.equal(POSE_RANKING_POLICY.sparseInterfaceContactPairs, POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS);
  assert.equal(
    POSE_RANKING_POLICY.interpenetrationCautionOverlapAngstrom,
    POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM,
  );
  assert.equal(POSE_RANKING_POLICY.fittedCoefficients, 0);
  assert.equal(POSE_RANKING_POLICY.newThresholdsIntroduced, 0);
  assert.equal(POSE_RANKING_POLICY.reordersAcrossShippedTiers, false);
  // The boundary must keep saying that the reported ordering performance is
  // development, not holdout, evidence.
  assert.match(POSE_RANKING_BOUNDARY, /not independent holdout evidence/i);
  assert.match(POSE_RANKING_BOUNDARY, /does not establish binding/i);
});

test("burial never promotes a pose past the shipped tier the audit assigned it", () => {
  // This is the property that makes the policy safe to ship. A pose driven
  // through the receptor buries an enormous amount of surface; it must still
  // rank below a modest, clash-free interface that the audit rated higher.
  assert.deepEqual(
    order([
      { poseId: "interpenetrating", audit: audit({ evidenceLevel: "limited", halfDeltaSasaInterfaceAreaAngstrom2: 2440, severeClashCount: 153, maximumOverlapAngstrom: 3.19 }) },
      { poseId: "near-native", audit: audit({ evidenceLevel: "supported", halfDeltaSasaInterfaceAreaAngstrom2: 844, severeClashCount: 1, maximumOverlapAngstrom: 0.62 }) },
    ]),
    ["near-native", "interpenetrating"],
  );
  // And across every ordered pair of distinct tiers, in both input orders.
  const tiers = ["supported", "mixed", "limited"];
  for (let i = 0; i < tiers.length; i += 1) {
    for (let j = i + 1; j < tiers.length; j += 1) {
      const better = { poseId: "better", audit: audit({ evidenceLevel: tiers[i], halfDeltaSasaInterfaceAreaAngstrom2: 1 }) };
      const worse = { poseId: "worse", audit: audit({ evidenceLevel: tiers[j], halfDeltaSasaInterfaceAreaAngstrom2: 99999 }) };
      assert.deepEqual(order([better, worse]), ["better", "worse"], `${tiers[i]} lost to ${tiers[j]}`);
      assert.deepEqual(order([worse, better]), ["better", "worse"], `${tiers[i]} lost to ${tiers[j]} on reversed input`);
    }
  }
});

test("burial orders poses inside a tier and a missing measurement sinks without leaving the tier", () => {
  assert.deepEqual(
    order([
      { poseId: "small", audit: audit({ halfDeltaSasaInterfaceAreaAngstrom2: 300 }) },
      { poseId: "large", audit: audit({ halfDeltaSasaInterfaceAreaAngstrom2: 1200 }) },
      { poseId: "medium", audit: audit({ halfDeltaSasaInterfaceAreaAngstrom2: 700 }) },
    ]),
    ["large", "medium", "small"],
  );
  // Unmeasurable burial sinks to the bottom of its own tier, but a lower tier
  // with a perfectly good burial still ranks below it.
  assert.deepEqual(
    order([
      { poseId: "lower-tier-measured", audit: audit({ evidenceLevel: "limited", halfDeltaSasaInterfaceAreaAngstrom2: 1500 }) },
      { poseId: "same-tier-unmeasured", audit: audit({ evidenceLevel: "mixed", halfDeltaSasaInterfaceAreaAngstrom2: null }) },
      { poseId: "same-tier-measured", audit: audit({ evidenceLevel: "mixed", halfDeltaSasaInterfaceAreaAngstrom2: 200 }) },
    ]),
    ["same-tier-measured", "same-tier-unmeasured", "lower-tier-measured"],
  );
  // Ties are broken by pose identifier, so the order is total and reproducible.
  const tied = [
    { poseId: "b", audit: audit({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
    { poseId: "a", audit: audit({ halfDeltaSasaInterfaceAreaAngstrom2: 500 }) },
  ];
  assert.deepEqual(order(tied), ["a", "b"]);
  assert.deepEqual(order([...tied].reverse()), ["a", "b"]);
});

test("scoring fails closed on incomplete or unrecognised audit input", () => {
  const missing = scorePoseRanking({});
  assert.equal(missing.assessability, "not-assessable");
  assert.equal(missing.burialScore, null);
  assert.equal(missing.evidenceTier, 0);
  assert.match(missing.notAssessableReason, /contact/i);

  // A pose with contacts but no computable burial is still reported, still in
  // its shipped tier, just without a secondary key.
  const noBurial = scorePoseRanking(audit({ evidenceLevel: "mixed", halfDeltaSasaInterfaceAreaAngstrom2: Number.NaN }));
  assert.equal(noBurial.assessability, "not-assessable");
  assert.equal(noBurial.burialScore, null);
  assert.equal(noBurial.evidenceTier, 1, "a pose must keep its shipped tier when burial is unavailable");

  // An evidence level the audit did not produce is demoted, never trusted.
  assert.equal(scorePoseRanking(audit({ evidenceLevel: "excellent" })).evidenceTier, 0);
  assert.equal(scorePoseRanking(audit({ evidenceLevel: null })).evidenceTier, 0);

  // Below the structural floor, burial is withheld rather than guessed.
  assert.equal(scorePoseRanking(audit({ receptorInterfaceResidues: 2 })).assessability, "not-assessable");
  assert.equal(scorePoseRanking(audit({ vhhInterfaceResidues: 2 })).assessability, "not-assessable");
});

test("cautions report interpenetration at the shipped overlap boundary and mark what moves the rank", () => {
  const clean = scorePoseRanking(audit({ maximumOverlapAngstrom: 1.49 }));
  assert.deepEqual(clean.cautions.map((caution) => caution.code), []);

  const overlapping = scorePoseRanking(audit({ maximumOverlapAngstrom: 1.5, severeClashCount: 12 }));
  const interpenetration = overlapping.cautions.find((caution) => caution.code === "interpenetration-suspected");
  assert.ok(interpenetration, "overlap at the shipped boundary must raise the caution");
  assert.equal(interpenetration.affectsRanking, true, "overlap burden is an input to the shipped tier");

  const sparse = scorePoseRanking(audit({ contactPairCount: 5, receptorInterfaceResidues: 4, vhhInterfaceResidues: 3 }));
  const sparseCaution = sparse.cautions.find((caution) => caution.code === "sparse-interface");
  assert.ok(sparseCaution);
  assert.equal(sparseCaution.affectsRanking, false);

  const unnumbered = scorePoseRanking(audit({ imgtNumberingStatus: "unavailable" }));
  const numbering = unnumbered.cautions.find((caution) => caution.code === "numbering-unavailable");
  assert.ok(numbering);
  assert.equal(numbering.affectsRanking, false, "numbering is reported beside the rank, not inside it");

  // A live audit nests numbering; the recorded ledger flattens it. Both read the same.
  assert.deepEqual(
    scorePoseRanking({ ...audit({ imgtNumberingStatus: undefined }), vhhNumbering: { status: "unavailable" } }).cautions
      .map((caution) => caution.code),
    ["numbering-unavailable"],
  );
});

test("the shipped module reproduces the frozen development-pilot accounting", () => {
  // The production entry point must score the real 360-pose ledger exactly as
  // the study that measured it did. This replays the accounting the frozen
  // artifact recorded, through lib/pose-ranking.ts rather than the study script.
  const poses = readFileSync(new URL("../validation/dockq-development-pilot-v1/poses.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
    .filter((pose) => pose.eligibility === "retained" && pose.errorState == null);

  assert.equal(poses.length, REPLAY.poseAccounting.retainedPoses);

  const tierCounts = {};
  const cautionCounts = {};
  let assessable = 0;
  for (const pose of poses) {
    const evidence = scorePoseRanking(pose.audit);
    tierCounts[evidence.shippedEvidenceLevel] = (tierCounts[evidence.shippedEvidenceLevel] ?? 0) + 1;
    for (const caution of evidence.cautions) {
      cautionCounts[caution.code] = (cautionCounts[caution.code] ?? 0) + 1;
    }
    if (evidence.assessability === "assessable") assessable += 1;
  }

  assert.deepEqual(tierCounts, REPLAY.poseAccounting.shippedTierCounts);
  assert.deepEqual(cautionCounts, REPLAY.poseAccounting.cautionCounts);
  assert.equal(assessable, REPLAY.poseAccounting.candidateAssessable);
  assert.equal(poses.length - assessable, REPLAY.poseAccounting.candidateNotAssessable);
});

test("the shipped rank key puts an acceptable pose first in every development target", () => {
  // Reproduces the headline claim of the frozen replay: expectedPrecisionAtRank1
  // of 1 over 5 eligible targets, with an unshared top score.
  const cutoff = REPLAY.dockqPositiveCutoff;
  const byTarget = new Map();
  for (const line of readFileSync(new URL("../validation/dockq-development-pilot-v1/poses.jsonl", import.meta.url), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const pose = JSON.parse(line);
    if (pose.eligibility !== "retained" || pose.errorState != null) continue;
    if (!byTarget.has(pose.targetId)) byTarget.set(pose.targetId, []);
    byTarget.get(pose.targetId).push(pose);
  }

  assert.equal(byTarget.size, REPLAY.macro.pose_evidence_v0_6.eligibleTargets);
  for (const [targetId, targetPoses] of byTarget) {
    const ranked = rankPoses(
      targetPoses.map((pose) => ({ poseId: pose.poseId, pose })),
      (entry) => scorePoseRanking(entry.pose.audit),
    );
    assert.equal(ranked[0].evidenceRank, 1);
    assert.ok(
      ranked[0].pose.dockq.DockQ >= cutoff,
      `${targetId}: rank-1 pose scored DockQ ${ranked[0].pose.dockq.DockQ}, below the ${cutoff} acceptance cutoff`,
    );
    const top = ranked[0].evidence;
    const sharing = ranked.filter(
      (entry) => entry.evidence.evidenceTier === top.evidenceTier && entry.evidence.burialScore === top.burialScore,
    );
    assert.equal(sharing.length, 1, `${targetId}: the top rank key is shared by ${sharing.length} poses`);
  }
});

test("the decision shortlist is emitted in rank order and binds the policy that produced it", () => {
  const pose = (id, sha, evidenceLevel, burial) => ({
    id,
    provider: "boltz",
    coordinate: { fileId: id, path: `${id}.cif`, filename: `${id}.cif`, sha256: sha, bytes: 10 },
    singleAudit: {
      audit: {
        evidenceLevel,
        contactPairCount: 40,
        receptorInterfaceResidues: 20,
        vhhInterfaceResidues: 18,
        halfDeltaSasaInterfaceAreaAngstrom2: burial,
        severeClashCount: 0,
        maximumOverlapAngstrom: 0.4,
        vhhNumbering: { status: "numbered" },
        auditAttestation: { resultFingerprint: `audit-${id}` },
      },
    },
    pae: { sha256: null, conservativeLargerDirectionMedianAngstrom: 4.2, contactPairShareAtOrBelow10Angstrom: 0.9 },
    topology: null,
  });

  const result = {
    schemaVersion: "1.0.0",
    productRelease: "0.9.1",
    engineVersion: "0.5.0",
    referenceCoordinateFileId: "p1",
    coordinateEnsemble: { poses: [{ sha256: "a".repeat(64), rank: 1 }] },
    // Deliberately supplied worst-first, and with the biggest interface on the
    // pose the audit rated lowest.
    poseAudits: [
      pose("p1", "a".repeat(64), "limited", 2400),
      pose("p2", "b".repeat(64), "mixed", 500),
      pose("p3", "c".repeat(64), "supported", 900),
    ],
  };

  const report = createCandidateShortlistReport(result, {}, "2026-09-03T00:00:00.000Z", null);
  assert.equal(report.schemaVersion, "1.2.0");
  assert.deepEqual(report.rows.map((row) => row.poseId), ["p3", "p2", "p1"]);
  assert.deepEqual(report.rows.map((row) => row.evidenceRank), [1, 2, 3]);
  assert.deepEqual(report.rows.map((row) => row.evidenceTier), [2, 1, 0]);
  assert.deepEqual(report.rows.map((row) => row.interfaceBurialAngstrom2), [900, 500, 2400]);
  assert.ok(report.rows.every((row) => row.rankingAssessability === "assessable"));
  assert.equal(report.rows.length, result.poseAudits.length, "ranking must not drop or duplicate a pose");

  // Provenance for the ordering travels with the report, in both formats.
  assert.equal(report.source.ranking.policyVersion, POSE_RANKING_POLICY.version);
  assert.equal(report.source.ranking.fittedCoefficients, 0);
  assert.equal(report.source.ranking.boundary, POSE_RANKING_BOUNDARY);
  assert.match(report.interpretation, /not independent holdout evidence/i);

  const csv = candidateShortlistToCsv(report);
  const header = csv.split("\n")[0].split(",").map((cell) => cell.replaceAll('"', ""));
  for (const column of [
    "ranking_policy_version",
    "evidence_rank",
    "evidence_tier",
    "interface_burial_angstrom2",
    "ranking_assessability",
    "ranking_cautions",
  ]) assert.ok(header.includes(column), `missing CSV ranking column ${column}`);
  const firstDataRow = csv.split("\n")[1].split(",").map((cell) => cell.replaceAll('"', ""));
  assert.equal(firstDataRow[header.indexOf("pose_id")], "p3");
  assert.equal(firstDataRow[header.indexOf("evidence_rank")], "1");
  assert.equal(firstDataRow[header.indexOf("ranking_policy_version")], POSE_RANKING_POLICY.version);
  // Evidence bindings stay keyed to the audited poses, not to rank position.
  assert.deepEqual(report.source.evidenceBindings.map((binding) => binding.poseId), ["p1", "p2", "p3"]);
});
