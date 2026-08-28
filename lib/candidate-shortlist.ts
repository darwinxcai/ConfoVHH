import type { PredictionRunAuditResult } from "./prediction-run-jobs.ts";

export const CANDIDATE_SHORTLIST_SCHEMA_VERSION = "1.1.0" as const;
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
  paeSha256: string | null;
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
    topologyAnnotationFingerprint: string | null;
    evidenceBindings: Array<{
      poseId: string;
      coordinateSha256: string;
      auditResultFingerprint: string;
      paeSha256: string | null;
      topologyStatus: string | null;
    }>;
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
  topologyAnnotationFingerprint: string | null = null,
): CandidateShortlistReport {
  if (
    topologyAnnotationFingerprint != null &&
    !/^fnv1a64-topology-v1:[0-9a-f]{16}$/u.test(topologyAnnotationFingerprint)
  ) throw new Error("Candidate shortlist topology annotation fingerprint is invalid.");
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
      paeSha256: pose.pae.sha256,
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
      topologyAnnotationFingerprint,
      evidenceBindings: result.poseAudits.map((pose) => ({
        poseId: pose.id,
        coordinateSha256: pose.coordinate.sha256,
        auditResultFingerprint: pose.singleAudit.audit.auditAttestation.resultFingerprint,
        paeSha256: pose.pae.sha256,
        topologyStatus: pose.topology?.status ?? null,
      })),
    },
    counts,
    rows,
    interpretation: "Disposition and notes are researcher-authored decisions. ConfoVHH metrics describe uploaded coordinate evidence and do not establish binding, affinity, function, or pose correctness.",
  };
}

function csvCell(value: string | number | null): string {
  if (value == null) return '""';
  const raw = String(value);
  const formulaLike = typeof value === "string" &&
    /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[=+\-@]/u.test(raw);
  const normalized = typeof value === "string"
    ? raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      if (/\p{Cf}/u.test(character)) return "";
      return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    })
    : raw;
  const text = formulaLike ? `'${normalized}` : normalized;
  return `"${text.replaceAll('"', '""')}"`;
}

export function candidateShortlistToCsv(report: CandidateShortlistReport): string {
  const headers = [
    "product_release", "engine_version", "audit_schema_version", "reference_coordinate_file_id",
    "topology_annotation_fingerprint", "pose_id", "filename", "coordinate_sha256",
    "audit_result_fingerprint", "provider", "recurrence_rank",
    "evidence_level", "contact_pairs", "severe_clashes", "conservative_pae_median_angstrom", "pae_sha256",
    "pae_share_at_or_below_10_angstrom", "topology_status", "researcher_disposition", "researcher_note",
  ];
  const bindingsByPose = new Map(report.source.evidenceBindings.map((binding) => [binding.poseId, binding]));
  const rows = report.rows.map((row) => {
    const binding = bindingsByPose.get(row.poseId);
    return [
      report.source.productRelease, report.source.engineVersion, report.source.auditSchemaVersion,
      report.source.referenceCoordinateFileId, report.source.topologyAnnotationFingerprint,
      row.poseId, row.filename, row.coordinateSha256, binding?.auditResultFingerprint ?? null,
      row.provider, row.recurrenceRank, row.evidenceLevel, row.contactPairCount, row.severeClashCount,
      row.conservativePaeMedianAngstrom, row.paeSha256, row.paeShareAtOrBelow10Angstrom,
      row.topologyStatus, row.disposition, row.researcherNote,
    ].map(csvCell).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}
