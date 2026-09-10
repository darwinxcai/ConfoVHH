/**
 * Shipped pose ranking.
 *
 * Until this module existed the product measured every pose and then presented
 * them in upload order. The decision shortlist carried an evidence level per
 * pose but no ordering, so the one question a researcher actually asks of a
 * coordinate ensemble — which of these do I look at first — was left entirely to
 * the reader. This module answers it, under a policy that was designed, measured
 * and frozen as a development study before it was wired into anything.
 *
 * The rank key is:
 *
 *     (shipped evidence tier, then half-delta-SASA interface burial)
 *
 * The evidence tier is the product's existing v0.5 verdict, consumed exactly as
 * the audit reports it and never recomputed here. Burial is the product's
 * existing interface-area measurement, passed through unchanged. There are no
 * fitted coefficients and no thresholds that did not already ship, so ranking
 * introduces no new scientific claim of its own: it reorders evidence the
 * product was already computing and already showing.
 *
 * The safety property that makes this integrable is that burial can only ever
 * break ties INSIDE a shipped tier. It cannot promote a pose past the tier the
 * audit assigned it, which matters because burial on its own is actively
 * misleading at the top of the range — it keeps rising as chains interpenetrate,
 * so a pose driven through the receptor buries more surface than the correct
 * one. The tier gate keeps those poses where the audit already put them.
 *
 * Measured on the DockQ development pilot (5 targets, 360 poses,
 * validation/dockq-development-pilot-v1), this key raises target-macro AUROC
 * from 0.574 to 0.772 and average precision from 0.688 to 0.835 against the
 * unordered shipped ordinal, while holding rank-1 correctness at 5 of 5 targets.
 * Those are development numbers on the set the policy was chosen against, and
 * they are reported as such — see the claim boundary below.
 *
 * Implementation and provenance
 * -----------------------------
 * The scoring and ordering logic lives in `lib/pose-evidence-v06.ts` and is
 * consumed from here byte-identical to the file the development study executed,
 * so `validation/v0.6-pose-evidence-candidate-v2` remains a replayable record of
 * the code this module runs. That file's own POSE_EVIDENCE_V06_POLICY.status
 * still reads "development-candidate-not-integrated" because the frozen replay
 * artifact embeds that object verbatim and is bound by checksum; the production
 * status of the policy is declared here instead, and
 * `tests/pose-ranking.test.mjs` asserts that the two policies agree on every
 * field that changes behaviour.
 */
import {
  POSE_EVIDENCE_V06_BOUNDARY,
  POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS,
  POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
  POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM,
  POSE_EVIDENCE_V06_POLICY,
  POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS,
  POSE_EVIDENCE_V06_TIER_ORDER,
  rankPosesWithinTargetV06,
  scorePoseEvidenceV06,
  type PoseAssessabilityV06,
  type PoseEvidenceCautionCodeV06,
  type PoseEvidenceCautionV06,
  type PoseEvidenceV06,
  type ShippedEvidenceLevelV06,
} from "./pose-evidence-v06.ts";

export const POSE_RANKING_POLICY_VERSION = "0.6.0" as const;

export type PoseRankingAssessability = PoseAssessabilityV06;
export type PoseRankingCautionCode = PoseEvidenceCautionCodeV06;
export type PoseRankingCaution = PoseEvidenceCautionV06;
export type PoseRankingEvidenceLevel = ShippedEvidenceLevelV06;

const EVIDENCE_LEVELS = new Set<string>(Object.keys(POSE_EVIDENCE_V06_TIER_ORDER));

/**
 * The production declaration of the policy. Every behavioural field is carried
 * from the studied policy object rather than restated, so the two cannot drift
 * apart silently; only the identity and status fields are authored here.
 */
export const POSE_RANKING_POLICY = Object.freeze({
  version: POSE_RANKING_POLICY_VERSION,
  status: "integrated-into-decision-shortlist",
  studiedAs: POSE_EVIDENCE_V06_POLICY.version,
  implementation: "lib/pose-evidence-v06.ts",
  developmentEvidence: "validation/v0.6-pose-evidence-candidate-v2",
  primaryRankingKey: POSE_EVIDENCE_V06_POLICY.primaryRankingKey,
  secondaryRankingKey: POSE_EVIDENCE_V06_POLICY.secondaryRankingKey,
  rankingScope: POSE_EVIDENCE_V06_POLICY.rankingScope,
  fittedCoefficients: POSE_EVIDENCE_V06_POLICY.fittedCoefficients,
  newThresholdsIntroduced: POSE_EVIDENCE_V06_POLICY.newThresholdsIntroduced,
  reordersAcrossShippedTiers: POSE_EVIDENCE_V06_POLICY.reordersAcrossShippedTiers,
  clashBurdenGatesRanking: POSE_EVIDENCE_V06_POLICY.clashBurdenGatesRanking,
  minimumContactPairs: POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS,
  minimumInterfaceResiduesPerChain:
    POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
  sparseInterfaceContactPairs: POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS,
  interpenetrationCautionOverlapAngstrom: POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM,
} as const);

export const POSE_RANKING_BOUNDARY =
  `${POSE_EVIDENCE_V06_BOUNDARY} Rank position is an ordering of the uploaded ` +
  "coordinates under this fixed policy, not a probability, a score, or a " +
  "statement that the top-ranked pose is correct. Reported ordering performance " +
  "comes from a five-target development pilot the policy was selected against " +
  "and is not independent holdout evidence.";

/**
 * What ranking needs from an interface audit. Every field is one the audit
 * already computes; nothing here is derived or estimated.
 */
export interface PoseRankingAuditLike {
  evidenceLevel?: string | null;
  contactPairCount?: number | null;
  receptorInterfaceResidues?: number | null;
  vhhInterfaceResidues?: number | null;
  halfDeltaSasaInterfaceAreaAngstrom2?: number | null;
  severeClashCount?: number | null;
  maximumOverlapAngstrom?: number | null;
  imgtNumberingStatus?: string | null;
  vhhNumbering?: { status?: string | null } | null;
}

/** The scored result. Structurally the studied type, under the shipped name. */
export type PoseRanking = PoseEvidenceV06;

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function measurement(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Score one pose, fail-closed on incomplete input.
 *
 * A field the audit did not report is treated as absent rather than as zero
 * evidence in the pose's favour: missing counts read as 0, which drives the pose
 * below the assessability floor, and a missing or non-finite burial makes it
 * not-assessable outright. An unrecognised evidence level is demoted to
 * "not-assessable" rather than being given the benefit of the doubt. In every
 * case the pose keeps its place in the shipped tier and simply sorts to the
 * bottom of it; it is never dropped from the report.
 */
export function scorePoseRanking(audit: PoseRankingAuditLike): PoseRanking {
  const level = typeof audit.evidenceLevel === "string" && EVIDENCE_LEVELS.has(audit.evidenceLevel)
    ? audit.evidenceLevel as PoseRankingEvidenceLevel
    : "not-assessable";
  return scorePoseEvidenceV06({
    evidenceLevel: level,
    contactPairCount: count(audit.contactPairCount),
    receptorInterfaceResidues: count(audit.receptorInterfaceResidues),
    vhhInterfaceResidues: count(audit.vhhInterfaceResidues),
    halfDeltaSasaInterfaceAreaAngstrom2: measurement(
      audit.halfDeltaSasaInterfaceAreaAngstrom2,
    ),
    severeClashCount: count(audit.severeClashCount),
    maximumOverlapAngstrom: count(audit.maximumOverlapAngstrom),
    imgtNumberingStatus: audit.imgtNumberingStatus ?? audit.vhhNumbering?.status ?? null,
  });
}

/**
 * Order poses of ONE complex, best first, and assign 1-based rank positions.
 *
 * Ranking across different complexes is not defined: burial scales with
 * interface size, so the secondary key is only meaningful between poses of the
 * same pair of chains. Callers hold that invariant — a prediction run is a set
 * of poses of a single complex, which is why this is safe there.
 */
export function rankPoses<T extends { poseId: string }>(
  poses: readonly T[],
  score: (pose: T) => PoseRanking,
): Array<T & { evidence: PoseRanking; evidenceRank: number }> {
  const scored = poses.map((pose) => ({ ...pose, evidence: score(pose) }));
  return rankPosesWithinTargetV06(scored).map((pose, index) => ({
    ...pose,
    evidenceRank: index + 1,
  }));
}
