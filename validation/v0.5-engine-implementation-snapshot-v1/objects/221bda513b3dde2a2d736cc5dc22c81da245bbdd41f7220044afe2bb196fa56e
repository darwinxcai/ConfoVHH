import { Annotator } from "immunum";

export const IMGT_NUMBERING_ENGINE = "immunum 1.2.0";

export type ImgtRegion =
  | "FR1-IMGT"
  | "CDR1-IMGT"
  | "FR2-IMGT"
  | "CDR2-IMGT"
  | "FR3-IMGT"
  | "CDR3-IMGT"
  | "FR4-IMGT"
  | "Outside numbered V-domain";

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

function unavailable(sequence: string, error: string): VhhNumberingAnnotation {
  return {
    status: "unavailable",
    scheme: "IMGT",
    engine: IMGT_NUMBERING_ENGINE,
    detectedChain: null,
    confidence: null,
    queryStart: null,
    queryEnd: null,
    error,
    residues: Array.from(sequence, (aminoAcid, sequenceIndex) => ({
      sequenceIndex,
      aminoAcid,
      imgtPosition: null,
      region: "Outside numbered V-domain" as const,
    })),
    cdrLengths: null,
  };
}

export function numberVhhSequence(sequence: string): VhhNumberingAnnotation {
  const normalized = sequence.trim().toUpperCase();
  if (!normalized || !/^[ACDEFGHIKLMNPQRSTVWYOU]+$/.test(normalized)) {
    return unavailable(normalized, "The chain does not contain a valid protein sequence for IMGT numbering.");
  }

  let annotator: Annotator | null = null;
  try {
    annotator = new Annotator(["H"], "imgt", 0.5);
    const result = annotator.number(normalized);
    if (
      result.error ||
      result.chain !== "H" ||
      result.confidence == null ||
      result.query_start == null ||
      result.query_end == null ||
      !result.numbering
    ) {
      return unavailable(normalized, result.error ?? "No antibody heavy-chain V-domain was recognized.");
    }

    const entries = Array.from(result.numbering.entries());
    const expectedLength = result.query_end - result.query_start + 1;
    if (entries.length !== expectedLength) {
      return unavailable(normalized, "The numbering engine returned an inconsistent sequence mapping.");
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
      if (residues[sequenceIndex]?.aminoAcid !== aminoAcid) {
        return unavailable(normalized, "The numbered residues did not map back to the coordinate sequence.");
      }
      residues[sequenceIndex] = {
        sequenceIndex,
        aminoAcid,
        imgtPosition: position,
        region: imgtRegion(position),
      };
    }

    const countRegion = (region: ImgtRegion) => residues.filter(
      (residue) => residue.region === region,
    ).length;
    return {
      status: "numbered",
      scheme: "IMGT",
      engine: IMGT_NUMBERING_ENGINE,
      detectedChain: result.chain,
      confidence: result.confidence,
      queryStart: result.query_start,
      queryEnd: result.query_end,
      error: null,
      residues,
      cdrLengths: {
        cdr1: countRegion("CDR1-IMGT"),
        cdr2: countRegion("CDR2-IMGT"),
        cdr3: countRegion("CDR3-IMGT"),
      },
    };
  } catch (caught) {
    return unavailable(
      normalized,
      caught instanceof Error ? caught.message : "IMGT numbering could not be completed.",
    );
  } finally {
    annotator?.free();
  }
}
