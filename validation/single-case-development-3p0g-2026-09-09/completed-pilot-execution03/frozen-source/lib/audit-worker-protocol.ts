import type {
  EnsembleAuditJob,
  EnsembleAuditJobResult,
  ParseCoordinateJob,
  ParsePaeJob,
  SingleAuditJob,
  StatePairAuditJob,
  StatePairAuditJobResult,
} from "./audit-jobs.ts";
import type { InterfaceAudit, ParsedPae, ParsedStructure } from "./confovhh.ts";

export type AuditWorkerRequest =
  | { requestId: number; type: "parse-coordinate"; job: ParseCoordinateJob }
  | { requestId: number; type: "parse-pae"; job: ParsePaeJob }
  | { requestId: number; type: "single"; job: SingleAuditJob }
  | { requestId: number; type: "ensemble"; job: EnsembleAuditJob }
  | { requestId: number; type: "state-pair"; job: StatePairAuditJob };

export type AuditWorkerResponse =
  | { requestId: number; type: "progress"; completed: number; total: number; filename: string }
  | { requestId: number; type: "parse-result"; structure: ParsedStructure }
  | { requestId: number; type: "pae-result"; pae: ParsedPae }
  | { requestId: number; type: "single-result"; audit: InterfaceAudit }
  | { requestId: number; type: "ensemble-result"; result: EnsembleAuditJobResult }
  | { requestId: number; type: "state-pair-result"; result: StatePairAuditJobResult }
  | { requestId: number; type: "error"; error: string };

const REQUEST_TYPES = new Set<AuditWorkerRequest["type"]>([
  "parse-coordinate",
  "parse-pae",
  "single",
  "ensemble",
  "state-pair",
]);

export function recoverAuditWorkerRequestId(value: unknown): number {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return -1;
  const requestId = (value as { requestId?: unknown }).requestId;
  return Number.isSafeInteger(requestId) && (requestId as number) >= 0
    ? requestId as number
    : -1;
}

/**
 * Validate only the common worker envelope here. Each execution function then
 * validates its job metadata before parsing or scientific analysis begins.
 */
export function parseAuditWorkerRequest(value: unknown): AuditWorkerRequest {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The background audit request must be an object.");
  }
  const envelope = value as { requestId?: unknown; type?: unknown; job?: unknown };
  if (!Number.isSafeInteger(envelope.requestId) || (envelope.requestId as number) < 0) {
    throw new Error("The background audit request identifier is invalid.");
  }
  if (typeof envelope.type !== "string" ||
      !REQUEST_TYPES.has(envelope.type as AuditWorkerRequest["type"])) {
    throw new Error("The background audit request type is unsupported.");
  }
  if (!("job" in envelope) || envelope.job == null ||
      typeof envelope.job !== "object" || Array.isArray(envelope.job)) {
    throw new Error("The background audit request job must be an object.");
  }
  return value as AuditWorkerRequest;
}
