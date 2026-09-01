import { Annotator } from "immunum";

export const VHH_NUMBERING_POLICY_VERSION = "0.6.0" as const;
export const IMGT_NUMBERING_ENGINE = "immunum 1.3.0" as const;
export const VHH_NUMBERING_MINIMUM_CONFIDENCE = 0.5;

export const VHH_NUMBERING_POLICY = Object.freeze({
  version: VHH_NUMBERING_POLICY_VERSION,
  status: "production-integrated",
  scheme: "IMGT",
  engine: IMGT_NUMBERING_ENGINE,
  minimumEngineConfidence: VHH_NUMBERING_MINIMUM_CONFIDENCE,
  exactCoordinateSequenceMapBackRequired: true,
  completeSevenRegionCoverageRequired: true,
  numberingSegmentationAgreementRequired: true,
  failurePolicy: "fail-closed-to-unavailable-numbering",
} as const);

export type ImgtRegion =
  | "FR1-IMGT"
  | "CDR1-IMGT"
  | "FR2-IMGT"
  | "CDR2-IMGT"
  | "FR3-IMGT"
  | "CDR3-IMGT"
  | "FR4-IMGT"
  | "Outside numbered V-domain";

export type ImgtNumberedRegion = Exclude<
  ImgtRegion,
  "Outside numbered V-domain"
>;

export type ImgtSegmentName =
  | "fr1"
  | "cdr1"
  | "fr2"
  | "cdr2"
  | "fr3"
  | "cdr3"
  | "fr4";

export interface VhhResidueNumbering {
  sequenceIndex: number;
  aminoAcid: string;
  imgtPosition: string | null;
  region: ImgtRegion;
}

export interface VhhNumberingAnnotation {
  status: "numbered" | "unavailable";
  policyVersion: typeof VHH_NUMBERING_POLICY_VERSION;
  scheme: "IMGT";
  engine: typeof IMGT_NUMBERING_ENGINE;
  minimumEngineConfidence: number;
  detectedChain: string | null;
  confidence: number | null;
  queryStart: number | null;
  queryEnd: number | null;
  error: string | null;
  completeImgtRegionCoverage: boolean;
  numberingSegmentationAgreement: boolean;
  residues: VhhResidueNumbering[];
  cdrLengths: {
    cdr1: number;
    cdr2: number;
    cdr3: number;
  } | null;
}

export interface ImgtSegmentationCrossCheck {
  completeImgtRegionCoverage: boolean;
  numberingSegmentationAgreement: boolean;
  cdrLengths: VhhNumberingAnnotation["cdrLengths"];
  error: string | null;
}

const SEGMENT_DEFINITIONS = [
  ["fr1", "FR1-IMGT"],
  ["cdr1", "CDR1-IMGT"],
  ["fr2", "FR2-IMGT"],
  ["cdr2", "CDR2-IMGT"],
  ["fr3", "FR3-IMGT"],
  ["cdr3", "CDR3-IMGT"],
  ["fr4", "FR4-IMGT"],
] as const satisfies readonly (readonly [
  ImgtSegmentName,
  ImgtNumberedRegion,
])[];

interface ImmunumSegmentResult {
  error?: unknown;
  fr1?: unknown;
  cdr1?: unknown;
  fr2?: unknown;
  cdr2?: unknown;
  fr3?: unknown;
  cdr3?: unknown;
  fr4?: unknown;
}

function boundedErrorMessage(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .trim();
  return text ? text.slice(0, 512) : null;
}

export function imgtRegion(position: string | null): ImgtRegion {
  if (!position) return "Outside numbered V-domain";
  const numeric = Number.parseInt(position, 10);
  if (!Number.isFinite(numeric)) return "Outside numbered V-domain";
  if (numeric >= 1 && numeric <= 26) return "FR1-IMGT";
  if (numeric >= 27 && numeric <= 38) return "CDR1-IMGT";
  if (numeric >= 39 && numeric <= 55) return "FR2-IMGT";
  if (numeric >= 56 && numeric <= 65) return "CDR2-IMGT";
  if (numeric >= 66 && numeric <= 104) return "FR3-IMGT";
  if (numeric >= 105 && numeric <= 117) return "CDR3-IMGT";
  if (numeric >= 118 && numeric <= 128) return "FR4-IMGT";
  return "Outside numbered V-domain";
}

function unavailable(
  sequence: string,
  error: string,
): VhhNumberingAnnotation {
  return {
    status: "unavailable",
    policyVersion: VHH_NUMBERING_POLICY_VERSION,
    scheme: "IMGT",
    engine: IMGT_NUMBERING_ENGINE,
    minimumEngineConfidence: VHH_NUMBERING_MINIMUM_CONFIDENCE,
    detectedChain: null,
    confidence: null,
    queryStart: null,
    queryEnd: null,
    error,
    completeImgtRegionCoverage: false,
    numberingSegmentationAgreement: false,
    residues: Array.from(sequence, (aminoAcid, sequenceIndex) => ({
      sequenceIndex,
      aminoAcid,
      imgtPosition: null,
      region: "Outside numbered V-domain" as const,
    })),
    cdrLengths: null,
  };
}

export function validateImgtSegmentationAgreement(
  residues: readonly VhhResidueNumbering[],
  segmented: Partial<Record<ImgtSegmentName, unknown>>,
): ImgtSegmentationCrossCheck {
  const mapDerived = {} as Record<ImgtNumberedRegion, string>;
  const segmentDerived = {} as Record<ImgtNumberedRegion, string>;

  for (const [segmentName, region] of SEGMENT_DEFINITIONS) {
    const fromNumberMap = residues
      .filter((residue) => residue.region === region)
      .map((residue) => residue.aminoAcid)
      .join("");
    const fromSegmentation = segmented[segmentName];

    if (!fromNumberMap || typeof fromSegmentation !== "string" || !fromSegmentation) {
      return {
        completeImgtRegionCoverage: false,
        numberingSegmentationAgreement: false,
        cdrLengths: null,
        error:
          "IMGT numbering must yield nonempty FR1, CDR1, FR2, CDR2, FR3, CDR3, and FR4 regions.",
      };
    }

    mapDerived[region] = fromNumberMap;
    segmentDerived[region] = fromSegmentation;
  }

  for (const [, region] of SEGMENT_DEFINITIONS) {
    if (mapDerived[region] !== segmentDerived[region]) {
      return {
        completeImgtRegionCoverage: true,
        numberingSegmentationAgreement: false,
        cdrLengths: null,
        error: "Number-map-derived and segment-derived IMGT regions disagree.",
      };
    }
  }

  return {
    completeImgtRegionCoverage: true,
    numberingSegmentationAgreement: true,
    cdrLengths: {
      cdr1: mapDerived["CDR1-IMGT"].length,
      cdr2: mapDerived["CDR2-IMGT"].length,
      cdr3: mapDerived["CDR3-IMGT"].length,
    },
    error: null,
  };
}

export function numberVhhSequence(
  sequence: string,
): VhhNumberingAnnotation {
  const normalized = sequence.trim().toUpperCase();
  if (!normalized || !/^[ACDEFGHIKLMNPQRSTVWYOU]+$/u.test(normalized)) {
    return unavailable(
      normalized,
      "The chain does not contain a valid protein sequence for IMGT numbering.",
    );
  }

  let annotator: Annotator | null = null;
  try {
    annotator = new Annotator(
      ["H"],
      "imgt",
      VHH_NUMBERING_MINIMUM_CONFIDENCE,
    );
    const result = annotator.number(normalized);
    if (
      result.error ||
      result.chain !== "H" ||
      typeof result.confidence !== "number" ||
      !Number.isFinite(result.confidence) ||
      result.confidence < VHH_NUMBERING_MINIMUM_CONFIDENCE ||
      result.query_start == null ||
      result.query_end == null ||
      !result.numbering
    ) {
      return unavailable(
        normalized,
        boundedErrorMessage(result.error) ??
          "No antibody heavy-chain V-domain was recognized at the required confidence threshold.",
      );
    }

    const entries = Array.from(result.numbering.entries()) as Array<[
      unknown,
      unknown,
    ]>;
    const expectedLength = result.query_end - result.query_start + 1;
    if (
      !Number.isSafeInteger(result.query_start) ||
      !Number.isSafeInteger(result.query_end) ||
      result.query_start < 0 ||
      result.query_end < result.query_start ||
      result.query_end >= normalized.length ||
      entries.length !== expectedLength ||
      expectedLength <= 0
    ) {
      return unavailable(
        normalized,
        "The numbering engine returned an inconsistent sequence mapping.",
      );
    }

    const residues: VhhResidueNumbering[] = Array.from(
      normalized,
      (aminoAcid, sequenceIndex) => ({
        sequenceIndex,
        aminoAcid,
        imgtPosition: null,
        region: "Outside numbered V-domain" as const,
      }),
    );

    for (let offset = 0; offset < entries.length; offset += 1) {
      const [position, aminoAcid] = entries[offset];
      const sequenceIndex = result.query_start + offset;
      if (
        typeof position !== "string" ||
        typeof aminoAcid !== "string" ||
        aminoAcid.length !== 1 ||
        residues[sequenceIndex]?.aminoAcid !== aminoAcid
      ) {
        return unavailable(
          normalized,
          "The numbered residues did not map exactly back to the coordinate sequence.",
        );
      }
      residues[sequenceIndex] = {
        sequenceIndex,
        aminoAcid,
        imgtPosition: position,
        region: imgtRegion(position),
      };
    }

    const segmented = annotator.segment(normalized) as unknown as ImmunumSegmentResult;
    if (segmented.error) {
      return unavailable(
        normalized,
        boundedErrorMessage(segmented.error) ??
          "The numbering engine could not independently segment the V-domain.",
      );
    }

    const crossCheck = validateImgtSegmentationAgreement(residues, segmented);
    if (
      !crossCheck.completeImgtRegionCoverage ||
      !crossCheck.numberingSegmentationAgreement ||
      !crossCheck.cdrLengths
    ) {
      return unavailable(
        normalized,
        crossCheck.error ?? "The IMGT numbering cross-check failed.",
      );
    }

    return {
      status: "numbered",
      policyVersion: VHH_NUMBERING_POLICY_VERSION,
      scheme: "IMGT",
      engine: IMGT_NUMBERING_ENGINE,
      minimumEngineConfidence: VHH_NUMBERING_MINIMUM_CONFIDENCE,
      detectedChain: result.chain,
      confidence: result.confidence,
      queryStart: result.query_start,
      queryEnd: result.query_end,
      error: null,
      completeImgtRegionCoverage: true,
      numberingSegmentationAgreement: true,
      residues,
      cdrLengths: crossCheck.cdrLengths,
    };
  } catch (caught) {
    return unavailable(
      normalized,
      caught instanceof Error
        ? boundedErrorMessage(caught.message) ?? "IMGT numbering could not be completed."
        : "IMGT numbering could not be completed.",
    );
  } finally {
    annotator?.free();
  }
}
