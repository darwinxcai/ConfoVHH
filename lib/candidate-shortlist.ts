import type { PredictionRunAuditResult } from "./prediction-run-jobs.ts";

export const CANDIDATE_SHORTLIST_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_CANDIDATE_NOTE_LENGTH = 500;

export type CandidateDisposition = "unreviewed" | "advance" | "hold" | "reject";

export interface CandidateDecision {
  disposition: CandidateDisposition;
  note: string;
}

export interface CandidateShortlistRow {
  poseId: string;
  filename: string;
  coordinateSha256: string;
  provider: string;
  recurrenceRank: number | null;
  evidenceLevel: string;
  contactPairCount: number;
  severeClashCount: number;
  conservativePaeMedianAngstrom: number | null;
  paeShareAtOrBelow10Angstrom: number | null;
  topologyStatus: string | null;
  disposition: CandidateDisposition;
  researcherNote: string;
}

export interface CandidateShortlistReport {
  schemaVersion: typeof CANDIDATE_SHORTLIST_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    auditSchemaVersion: string;
    productRelease: string;
    engineVersion: string;
    referenceCoordinateFileId: string;
  };
  counts: Record<CandidateDisposition, number>;
  rows: CandidateShortlistRow[];
  interpretation: string;
}

const DISPOSITIONS = new Set<CandidateDisposition>(["unreviewed", "advance", "hold", "reject"]);

export function normalizeCandidateDecision(value: unknown): CandidateDecision {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { disposition: "unreviewed", note: "" };
  }
  const candidate = value as Partial<CandidateDecision>;
  const disposition = DISPOSITIONS.has(candidate.disposition as CandidateDisposition)
    ? candidate.disposition as CandidateDisposition
    : "unreviewed";
  const note = typeof candidate.note === "string"
    ? candidate.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_CANDIDATE_NOTE_LENGTH)
    : "";
  return { disposition, note };
}

export function createCandidateShortlistReport(
  result: PredictionRunAuditResult,
  decisions: Readonly<Record<string, CandidateDecision>>,
  generatedAt = new Date().toISOString(),
): CandidateShortlistReport {
  const rankByDigest = new Map(
    result.coordinateEnsemble?.poses.map((pose) => [pose.sha256, pose.rank]) ?? [],
  );
  const rows = result.poseAudits.map((pose): CandidateShortlistRow => {
    const decision = normalizeCandidateDecision(decisions[pose.id]);
    return {
      poseId: pose.id,
      filename: pose.coordinate.filename,
      coordinateSha256: pose.coordinate.sha256,
      provider: pose.provider,
      recurrenceRank: rankByDigest.get(pose.coordinate.sha256) ?? null,
      evidenceLevel: pose.singleAudit.audit.evidenceLevel,
      contactPairCount: pose.singleAudit.audit.contactPairCount,
      severeClashCount: pose.singleAudit.audit.severeClashCount,
      conservativePaeMedianAngstrom: pose.pae.conservativeLargerDirectionMedianAngstrom,
      paeShareAtOrBelow10Angstrom: pose.pae.contactPairShareAtOrBelow10Angstrom,
      topologyStatus: pose.topology?.status ?? null,
      disposition: decision.disposition,
      researcherNote: decision.note,
    };
  });
  const counts = { unreviewed: 0, advance: 0, hold: 0, reject: 0 };
  rows.forEach((row) => { counts[row.disposition] += 1; });
  return {
    schemaVersion: CANDIDATE_SHORTLIST_SCHEMA_VERSION,
    generatedAt,
    source: {
      auditSchemaVersion: result.schemaVersion,
      productRelease: result.productRelease,
      engineVersion: result.engineVersion,
      referenceCoordinateFileId: result.referenceCoordinateFileId,
    },
    counts,
    rows,
    interpretation: "Disposition and notes are researcher-authored decisions. ConfoVHH metrics describe uploaded coordinate evidence and do not establish binding, affinity, function, or pose correctness.",
  };
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  const protectedText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function candidateShortlistToCsv(report: CandidateShortlistReport): string {
  const headers = [
    "pose_id", "filename", "coordinate_sha256", "provider", "recurrence_rank",
    "evidence_level", "contact_pairs", "severe_clashes", "conservative_pae_median_angstrom",
    "pae_share_at_or_below_10_angstrom", "topology_status", "researcher_disposition", "researcher_note",
  ];
  const rows = report.rows.map((row) => [
    row.poseId, row.filename, row.coordinateSha256, row.provider, row.recurrenceRank,
    row.evidenceLevel, row.contactPairCount, row.severeClashCount, row.conservativePaeMedianAngstrom,
    row.paeShareAtOrBelow10Angstrom, row.topologyStatus, row.disposition, row.researcherNote,
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}
