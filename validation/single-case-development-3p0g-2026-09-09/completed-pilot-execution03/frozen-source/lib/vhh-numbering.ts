/**
 * Production VHH IMGT numbering.
 *
 * As of the v0.6 numbering promotion this module is a thin adapter over
 * lib/vhh-numbering-v06.ts, which is the numbering policy the v0.6 candidate
 * study validated. It exists to keep the call surface `lib/confovhh.ts` and the
 * UI consume — `VhhNumberingAnnotation`, `imgtRegion`, `numberVhhSequence`,
 * `IMGT_NUMBERING_ENGINE` — stable across the promotion, and to keep the
 * candidate module byte-identical: its SHA-256 is bound into
 * validation/v0.6-vhh-numbering-candidate-v1/postlabel-replay.json, so the
 * study's `candidateFrozenBeforeReplay` claim only holds while it is unedited.
 *
 * What the promotion changes, measured rather than assumed:
 *
 *   - The engine provenance string. The previous value, "immunum 1.2.0", was
 *     false: the installed and executed engine has been 1.3.0. Across all 360
 *     poses of the DockQ development pilot, engine provenance is the ONLY field
 *     that changes — numbering status, region assignments, CDR contact shares,
 *     CDR3 contact shares, evidence bands and CDR-dependent ranking inputs are
 *     all unchanged (poseEngineProvenanceChanges 360, every other counter 0).
 *   - The policy tightens. v0.6 requires the engine's own confidence to clear
 *     the 0.5 threshold explicitly, bounds-checks the query window, type-checks
 *     every numbering entry, and cross-checks the number-map-derived regions
 *     against the engine's independent segment() output, requiring complete
 *     nonempty FR1/CDR1/FR2/CDR2/FR3/CDR3/FR4 coverage. A chain that fails any
 *     of these is now reported unavailable rather than numbered on partial
 *     evidence.
 *
 * On the public 17-structure coordinate panel the tightening changes nothing
 * measurable: status changes 0, query-bound changes 0, CDR-length changes 0,
 * region-assignment changes 0, paratope-share changes 0, CDR3-share changes 0,
 * changed contact pairs 0, coordinate-geometry regressions 0.
 *
 * See validation/v0.6-vhh-numbering-candidate-v1/ for the design record, the
 * public-panel differential and the post-label replay, and
 * validation/v0.6-engine-implementation-snapshot-v1/ for the implementation
 * attestation this promotion mints. All v0.5 attestations are preserved
 * byte-for-byte.
 */
import {
  IMGT_NUMBERING_ENGINE_V06,
  VHH_NUMBERING_V06_MINIMUM_CONFIDENCE,
  imgtRegionV06,
  numberVhhSequenceV06,
  type ImgtRegionV06,
  type VhhNumberingAnnotationV06,
} from "./vhh-numbering-v06.ts";

/** True provenance of the engine that actually runs. */
export const IMGT_NUMBERING_ENGINE = IMGT_NUMBERING_ENGINE_V06;

/** Minimum engine alignment confidence for a chain to be numbered at all. */
export const IMGT_NUMBERING_MINIMUM_CONFIDENCE =
  VHH_NUMBERING_V06_MINIMUM_CONFIDENCE;

export type ImgtRegion = ImgtRegionV06;

export interface VhhResidueNumbering {
  sequenceIndex: number;
  aminoAcid: string;
  imgtPosition: string | null;
  region: ImgtRegion;
}

export interface VhhNumberingAnnotation {
  status: "numbered" | "unavailable";
  scheme: "IMGT";
  engine: string;
  detectedChain: string | null;
  confidence: number | null;
  queryStart: number | null;
  queryEnd: number | null;
  error: string | null;
  residues: VhhResidueNumbering[];
  cdrLengths: {
    cdr1: number;
    cdr2: number;
    cdr3: number;
  } | null;
  /**
   * Integrity flags carried from the v0.6 policy. A numbered annotation always
   * has both true; they are surfaced so a caller can state on what basis the
   * numbering was accepted rather than inferring it from `status` alone.
   */
  completeImgtRegionCoverage: boolean;
  numberingSegmentationAgreement: boolean;
}

/**
 * IMGT region for a position label. Delegated so the region boundaries have one
 * definition; CDR3-IMGT spans 105–117, with insertion codes for long loops.
 */
export function imgtRegion(position: string | null): ImgtRegion {
  return imgtRegionV06(position);
}

function adapt(annotation: VhhNumberingAnnotationV06): VhhNumberingAnnotation {
  return {
    status: annotation.status,
    scheme: annotation.scheme,
    engine: annotation.engine,
    detectedChain: annotation.detectedChain,
    confidence: annotation.confidence,
    queryStart: annotation.queryStart,
    queryEnd: annotation.queryEnd,
    error: annotation.error,
    residues: annotation.residues.map((residue) => ({
      sequenceIndex: residue.sequenceIndex,
      aminoAcid: residue.aminoAcid,
      imgtPosition: residue.imgtPosition,
      region: residue.region,
    })),
    cdrLengths: annotation.cdrLengths,
    completeImgtRegionCoverage: annotation.completeImgtRegionCoverage,
    numberingSegmentationAgreement: annotation.numberingSegmentationAgreement,
  };
}

/**
 * Number a VHH chain under the v0.6 IMGT policy.
 *
 * Fails closed: a chain the engine does not recognise at the required
 * confidence, whose numbering does not map exactly back onto the coordinate
 * sequence, or whose number-map regions disagree with the engine's own
 * segmentation, is returned unavailable with every position null rather than
 * numbered on partial evidence.
 */
export function numberVhhSequence(sequence: string): VhhNumberingAnnotation {
  return adapt(numberVhhSequenceV06(sequence));
}
