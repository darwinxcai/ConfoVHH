/**
 * v0.6 pose-evidence candidate — development only, not integrated into production.
 *
 * SUPERSEDES candidate.1, which was wrong. Candidate.1 replaced the shipped v0.5
 * evidence ordinal with raw interface burial, on the strength of burial's higher
 * target-macro AUROC (0.754 against 0.574) on the DockQ development pilot. That
 * comparison was real but it measured the wrong thing, and acting on it would have
 * made the product worse. Two findings, both reproducible from
 * validation/dockq-development-pilot-v1/poses.jsonl:
 *
 *   1. Burial overshoots. Half-delta-SASA rises with pose quality only until the
 *      chains begin to interpenetrate, after which it keeps rising while the pose
 *      becomes physically impossible. Across burial deciles, mean DockQ climbs to
 *      0.647 at decile 8 and then falls to 0.340 at decile 10, where mean severe
 *      overlap count jumps from 20.8 to 70.3. The single most-buried pose is
 *      DockQ-negative in 4 of 5 targets. For 3P0G the most-buried pose has 2440
 *      square angstroms of burial, 153 severe overlaps, 3.19 angstrom maximum
 *      overlap and DockQ 0.106; the near-native pose of the same target has 844
 *      square angstroms, 1 severe overlap, 0.62 angstroms and DockQ 0.979. Ranking
 *      on burial alone therefore puts a pose driven through the receptor at rank 1.
 *
 *   2. The shipped ordinal's low AUROC is a resolution failure, not a judgement
 *      failure. AUROC scores global separation, and the ordinal has almost none:
 *      309 of 360 development poses fall in "limited". But its top tier is exactly
 *      right. Every pose in the top occupied tier of every target is DockQ-positive
 *      (12 of 12), and its rank-1 pose is acceptable in 5 of 5 targets at DockQ
 *      0.94 to 0.99. The clash-free requirement for "supported" costs recall, as
 *      candidate.1 observed, but it buys the precision that keeps interpenetrating
 *      poses out of the top tier. Removing it was the error.
 *
 * This candidate therefore keeps the shipped judgement and fixes only what is
 * actually broken, which is the ordering below the top tier:
 *
 *     rank key = (shipped v0.5 evidence tier, then interface burial)
 *
 * The shipped tier is carried through unchanged and is the primary key, so the
 * candidate CANNOT reorder poses across tiers and cannot regress the top-tier
 * precision it inherits. Burial is the secondary key, breaking ties inside a tier
 * where the ordinal expresses no preference at all. Measured on the development
 * pilot this raises target-macro AUROC from 0.574 to 0.772 and average precision
 * from 0.688 to 0.835 while holding rank-1 correctness at 5 of 5. Burial earns the
 * tie-break on its own terms: inside the "limited" block alone it reaches 0.722
 * target-macro AUROC.
 *
 * There are no fitted coefficients and no new thresholds. Every tier boundary is
 * the shipped v0.5 boundary, carried verbatim; the secondary key is one existing
 * measurement passed through unchanged. Nothing here was optimised against DockQ,
 * although the choice BETWEEN candidate.1 and candidate.2 was made by looking at
 * development results, which is what a development set is for and which is
 * recorded as such in the design record.
 *
 * Scope and boundary: the rank key orders poses OF THE SAME COMPLEX. Burial scales
 * with interface size, so magnitudes are not comparable across targets. Nothing
 * here predicts binding, affinity, specificity, or pose correctness in any absolute
 * sense.
 */

export const POSE_EVIDENCE_V06_CANDIDATE_VERSION = "0.6.0-candidate.2" as const;

/** The shipped v0.5 verdict, consumed as-is. This candidate never recomputes it. */
export type ShippedEvidenceLevelV06 =
  | "supported"
  | "mixed"
  | "limited"
  | "not-assessable";

/**
 * Tier order transcribed from the development pilot's own scoreForArm, which
 * collapses "limited" and "not-assessable" to the same rank. Reproducing the
 * shipped arm exactly matters more than a mapping we might prefer: separating
 * those two levels would silently change the baseline this candidate is measured
 * against. Fail-closed behaviour for unmeasurable poses is handled by the
 * secondary key instead — a null burial sorts to the bottom of its tier.
 */
export const POSE_EVIDENCE_V06_TIER_ORDER: Readonly<
  Record<ShippedEvidenceLevelV06, number>
> = Object.freeze({
  supported: 2,
  mixed: 1,
  limited: 0,
  "not-assessable": 0,
});

/**
 * Structural minimums for burial to be measurable at all. Carried over unchanged
 * from the attested v0.5 assessability floor; not derived from DockQ labels.
 * Below them, burial is dominated by numerical noise rather than interface
 * geometry, so it is withheld rather than guessed.
 */
export const POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS = 1;
export const POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN = 3;

export const POSE_EVIDENCE_V06_POLICY = Object.freeze({
  version: POSE_EVIDENCE_V06_CANDIDATE_VERSION,
  status: "development-candidate-not-integrated",
  supersedes: "0.6.0-candidate.1",
  primaryRankingKey: "shipped v0.5 evidence tier, carried unchanged",
  secondaryRankingKey: "half-delta-SASA interface burial, carried unchanged",
  rankingScope: "within-target-only",
  fittedCoefficients: 0,
  newThresholdsIntroduced: 0,
  /** The safety property: burial only ever breaks ties inside a shipped tier. */
  reordersAcrossShippedTiers: false,
  /** True, and deliberately so: it is inherited with the shipped tier. */
  clashBurdenGatesRanking: true,
  minimumContactPairs: POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS,
  minimumInterfaceResiduesPerChain:
    POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
} as const);

export const POSE_EVIDENCE_V06_BOUNDARY =
  "The rank key orders coordinate poses of the same complex under a fixed " +
  "geometric policy. It does not establish binding, affinity, specificity, " +
  "function, state selectivity, or pose correctness, and burial is not " +
  "comparable between different complexes.";

export type PoseAssessabilityV06 = "assessable" | "not-assessable";

export type PoseEvidenceCautionCodeV06 =
  | "sparse-interface"
  | "interpenetration-suspected"
  | "numbering-unavailable";

export interface PoseEvidenceCautionV06 {
  code: PoseEvidenceCautionCodeV06;
  detail: string;
  /**
   * Whether this observation changed the rank key. Overlap burden does, because
   * it is one of the inputs to the shipped tier this candidate carries; the
   * other two cautions are reported beside the ranking and do not move it.
   */
  affectsRanking: boolean;
}

/** The subset of an interface audit this candidate consumes. */
export interface PoseEvidenceInputV06 {
  /** The shipped v0.5 verdict. Consumed, never recomputed. */
  evidenceLevel: ShippedEvidenceLevelV06;
  contactPairCount: number;
  receptorInterfaceResidues: number;
  vhhInterfaceResidues: number;
  halfDeltaSasaInterfaceAreaAngstrom2: number | null;
  severeClashCount: number;
  maximumOverlapAngstrom: number;
  imgtNumberingStatus?: string | null;
}

export interface PoseEvidenceV06 {
  version: typeof POSE_EVIDENCE_V06_CANDIDATE_VERSION;
  assessability: PoseAssessabilityV06;
  /** Primary key: the shipped tier, carried through. Higher ranks better. */
  evidenceTier: number;
  /** The level the tier came from, echoed so callers need not re-derive it. */
  shippedEvidenceLevel: ShippedEvidenceLevelV06;
  /** Secondary key, in square angstroms; null exactly when not assessable. */
  burialScore: number | null;
  rankingScope: "within-target-only";
  notAssessableReason: string | null;
  cautions: PoseEvidenceCautionV06[];
  boundary: string;
}

/**
 * Overlap above which interpenetration is reported. This is the shipped v0.5
 * "limited" boundary (maximumOverlapAngstrom >= 1.5), reused so the caution
 * surfaces exactly the geometry v0.5 already treats as materially overlapping.
 * It introduces no new threshold and was not fitted against DockQ.
 */
export const POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM = 1.5;

/**
 * Interfaces below this many contact pairs are reported as sparse. Carried from
 * the v0.5 "limited" contact floor for continuity of meaning; advisory only.
 */
export const POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS = 8;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Score one pose.
 *
 * Fails closed on the secondary key: an interface that does not meet the
 * structural minimums, or whose burial could not be computed, returns a null
 * burialScore and sorts to the bottom of its tier rather than receiving an
 * optimistic default. It is not promoted or demoted across tiers, because the
 * shipped verdict is the authority on tier placement.
 */
export function scorePoseEvidenceV06(
  audit: PoseEvidenceInputV06,
): PoseEvidenceV06 {
  const cautions: PoseEvidenceCautionV06[] = [];
  const shippedEvidenceLevel = audit.evidenceLevel;
  const evidenceTier = POSE_EVIDENCE_V06_TIER_ORDER[shippedEvidenceLevel] ?? 0;

  const base = {
    version: POSE_EVIDENCE_V06_CANDIDATE_VERSION,
    rankingScope: "within-target-only",
    evidenceTier,
    shippedEvidenceLevel,
    boundary: POSE_EVIDENCE_V06_BOUNDARY,
  } as const;

  let notAssessableReason: string | null = null;
  if (audit.contactPairCount < POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS) {
    notAssessableReason =
      "No receptor–VHH residue contacts were detected at the configured cutoff.";
  } else if (
    audit.receptorInterfaceResidues <
      POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN ||
    audit.vhhInterfaceResidues <
      POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN
  ) {
    notAssessableReason =
      `Fewer than ${POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN} ` +
      "interface residues on one chain; burial is not measurable.";
  } else if (!finite(audit.halfDeltaSasaInterfaceAreaAngstrom2)) {
    notAssessableReason =
      "Interface burial could not be computed for this pose.";
  }

  if (notAssessableReason) {
    return {
      ...base,
      assessability: "not-assessable",
      burialScore: null,
      notAssessableReason,
      cautions,
    };
  }

  if (audit.contactPairCount < POSE_EVIDENCE_V06_SPARSE_CONTACT_PAIRS) {
    cautions.push({
      code: "sparse-interface",
      detail:
        `Only ${audit.contactPairCount} contacting residue pairs. Burial is ` +
        "measurable but rests on a small footprint.",
      affectsRanking: false,
    });
  }

  if (
    finite(audit.maximumOverlapAngstrom) &&
    audit.maximumOverlapAngstrom >= POSE_EVIDENCE_V06_OVERLAP_CAUTION_ANGSTROM
  ) {
    cautions.push({
      code: "interpenetration-suspected",
      detail:
        `Maximum cross-chain overlap ${audit.maximumOverlapAngstrom.toFixed(2)} Å ` +
        `across ${audit.severeClashCount} severe overlap(s). Burial can be ` +
        "inflated by chains passing through one another rather than packing " +
        "against one another, so read the burial score with this in mind. " +
        "This geometry already places the pose in the shipped tier it is " +
        "ranked in.",
      affectsRanking: true,
    });
  }

  if (audit.imgtNumberingStatus && audit.imgtNumberingStatus !== "numbered") {
    cautions.push({
      code: "numbering-unavailable",
      detail:
        "IMGT numbering is unavailable for this chain, so CDR participation " +
        "cannot be checked. The rank key is unaffected.",
      affectsRanking: false,
    });
  }

  return {
    ...base,
    assessability: "assessable",
    burialScore: audit.halfDeltaSasaInterfaceAreaAngstrom2 as number,
    notAssessableReason: null,
    cautions,
  };
}

/**
 * Order poses of a single complex, best first: shipped tier descending, then
 * burial descending, then pose identifier so the order is total and reproducible.
 * A null burial sorts to the bottom of its own tier and never leaves it.
 */
export function rankPosesWithinTargetV06<T extends { poseId: string }>(
  poses: readonly (T & { evidence: PoseEvidenceV06 })[],
): (T & { evidence: PoseEvidenceV06 })[] {
  return [...poses].sort((left, right) => {
    if (left.evidence.evidenceTier !== right.evidence.evidenceTier) {
      return right.evidence.evidenceTier - left.evidence.evidenceTier;
    }
    const a = left.evidence.burialScore;
    const b = right.evidence.burialScore;
    if (a === null && b === null) return left.poseId.localeCompare(right.poseId);
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return b - a;
    return left.poseId.localeCompare(right.poseId);
  });
}
