/**
 * v0.6 pose-evidence candidate — development only, not integrated into production.
 *
 * The attested v0.5 path collapses several orthogonal measurements into one
 * four-level ordinal (`evidenceLevel`). Measured against the DockQ development
 * pilot, that ordinal ranks near-native poses at AUROC 0.602, barely above the
 * 0.5 coin-flip line, while a single measurement the ordinal does not consult —
 * interface burial — reaches 0.748 on the same poses.
 *
 * Three defects account for the gap, each reproducible from
 * validation/dockq-development-pilot-v1/poses.jsonl:
 *
 *   1. The ordinal is nearly constant. 309 of 360 development poses land in
 *      "limited" and 4 in "supported", so it carries almost no ranking
 *      resolution regardless of how well its inputs discriminate.
 *
 *   2. Interface burial is not an input. Within the "limited" bucket alone,
 *      half-delta-SASA spans 38 to 4880 square angstroms.
 *
 *   3. The `severeClashCount === 0` requirement for "supported" is applied as
 *      though clash burden were monotonic in pose error. It is not. Poses with
 *      zero severe clashes are correct 23% of the time, while poses with four
 *      or more are correct 67% of the time, because a near-native pose packs
 *      tightly enough to trip the 0.6 angstrom overlap threshold while a pose
 *      rotated off the interface entirely stops touching the receptor at all.
 *      96.9% of CAPRI high/medium development poses carry at least one severe
 *      clash and are therefore barred from "supported" on merit they have.
 *
 * This candidate answers those three points and nothing else:
 *
 *   - Ranking is continuous rather than bucketed.
 *   - The ranking signal is interface burial, carried directly.
 *   - Clash burden is reported beside the ranking rather than gating it.
 *
 * It deliberately introduces NO fitted coefficients. The ranking signal is one
 * physically meaningful quantity passed through unchanged, so there is nothing
 * for five development targets to overfit. Combining burial with contact count
 * or an overlap penalty was explored on the development pilot and moved AUROC
 * by less than the spread expected across five correlated targets; those
 * variants were rejected rather than adopted.
 *
 * Scope and boundary: the ranking signal orders poses OF THE SAME COMPLEX.
 * Burial scales with interface size, so magnitudes are not comparable across
 * targets. Nothing here predicts binding, affinity, specificity, or pose
 * correctness in any absolute sense, and no threshold in this module was fitted
 * against DockQ labels.
 */

export const POSE_EVIDENCE_V06_CANDIDATE_VERSION = "0.6.0-candidate.1" as const;

/**
 * Structural minimums for an interface to be measurable at all. These are
 * carried over unchanged from the attested v0.5 assessability floor; they were
 * not derived from DockQ labels. Below them, burial is dominated by numerical
 * noise rather than interface geometry.
 */
export const POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS = 1;
export const POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN = 3;

export const POSE_EVIDENCE_V06_POLICY = Object.freeze({
  version: POSE_EVIDENCE_V06_CANDIDATE_VERSION,
  status: "development-candidate-not-integrated",
  rankingSignal: "half-delta-SASA interface burial",
  rankingScope: "within-target-only",
  fittedCoefficients: 0,
  clashBurdenGatesRanking: false,
  minimumContactPairs: POSE_EVIDENCE_V06_MINIMUM_CONTACT_PAIRS,
  minimumInterfaceResiduesPerChain:
    POSE_EVIDENCE_V06_MINIMUM_INTERFACE_RESIDUES_PER_CHAIN,
} as const);

export const POSE_EVIDENCE_V06_BOUNDARY =
  "Interface burial orders coordinate poses of the same complex under a fixed " +
  "geometric policy. It does not establish binding, affinity, specificity, " +
  "function, state selectivity, or pose correctness, and it is not comparable " +
  "between different complexes.";

export type PoseAssessabilityV06 = "assessable" | "not-assessable";

export type PoseEvidenceCautionCodeV06 =
  | "sparse-interface"
  | "high-overlap-burden"
  | "numbering-unavailable";

export interface PoseEvidenceCautionV06 {
  code: PoseEvidenceCautionCodeV06;
  detail: string;
  /** Cautions never alter burialScore. They are reported beside it. */
  affectsRanking: false;
}

/** The subset of an interface audit this candidate consumes. */
export interface PoseEvidenceInputV06 {
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
  /** Ranking signal in square angstroms; null exactly when not assessable. */
  burialScore: number | null;
  rankingScope: "within-target-only";
  notAssessableReason: string | null;
  cautions: PoseEvidenceCautionV06[];
  boundary: string;
}

/**
 * Overlap burden above which a caution is raised. Set at the point where the
 * shipped v0.5 policy already declares an interface "limited"
 * (maximumOverlapAngstrom >= 1.5), so the caution surfaces exactly the
 * geometry v0.5 considered materially overlapping. It does not gate ranking,
 * and it was not fitted against DockQ.
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
 * Fails closed: an interface that does not meet the structural minimums, or
 * whose burial could not be computed, returns a null burialScore and sorts to
 * the bottom rather than receiving an optimistic default.
 */
export function scorePoseEvidenceV06(
  audit: PoseEvidenceInputV06,
): PoseEvidenceV06 {
  const cautions: PoseEvidenceCautionV06[] = [];

  const base = {
    version: POSE_EVIDENCE_V06_CANDIDATE_VERSION,
    rankingScope: "within-target-only",
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
      code: "high-overlap-burden",
      detail:
        `Maximum cross-chain overlap ${audit.maximumOverlapAngstrom.toFixed(2)} Å ` +
        `across ${audit.severeClashCount} severe overlap(s). Reported for review: ` +
        "overlap burden is not monotonic in pose error and does not adjust the ranking.",
      affectsRanking: false,
    });
  }

  if (audit.imgtNumberingStatus && audit.imgtNumberingStatus !== "numbered") {
    cautions.push({
      code: "numbering-unavailable",
      detail:
        "IMGT numbering is unavailable for this chain, so CDR participation " +
        "cannot be checked. Burial is unaffected.",
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
 * Order poses of a single complex, best first. Not-assessable poses sort last,
 * then ties break on the caller-supplied identifier so the order is total and
 * reproducible.
 */
export function rankPosesWithinTargetV06<T extends { poseId: string }>(
  poses: readonly (T & { evidence: PoseEvidenceV06 })[],
): (T & { evidence: PoseEvidenceV06 })[] {
  return [...poses].sort((left, right) => {
    const a = left.evidence.burialScore;
    const b = right.evidence.burialScore;
    if (a === null && b === null) return left.poseId.localeCompare(right.poseId);
    if (a === null) return 1;
    if (b === null) return -1;
    if (a !== b) return b - a;
    return left.poseId.localeCompare(right.poseId);
  });
}
