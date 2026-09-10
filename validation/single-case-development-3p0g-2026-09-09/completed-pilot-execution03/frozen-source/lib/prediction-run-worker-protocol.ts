import type {
  NativePaeMappingProvenance,
  PredictionRunAuditJob,
  PredictionRunAuditResult,
  PredictionRunAuditSourceFile,
  PredictionRunProgress,
} from "./prediction-run-jobs.ts";
import type { ParsedPae, ParsedStructure } from "./confovhh.ts";

export type PredictionRunWorkerRequest =
  | { requestId: number; type: "prediction-run"; job: PredictionRunAuditJob }
  | {
      requestId: number;
      type: "parse-native-pae";
      job: { source: PredictionRunAuditSourceFile; structure: ParsedStructure };
    };

export type PredictionRunWorkerResponse =
  | ({ requestId: number; type: "progress" } & PredictionRunProgress)
  | { requestId: number; type: "result"; result: PredictionRunAuditResult }
  | {
      requestId: number;
      type: "native-pae-result";
      pae: ParsedPae;
      mapping: NativePaeMappingProvenance;
    }
  | { requestId: number; type: "error"; error: string };

export function recoverPredictionRunRequestId(value: unknown): number {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return -1;
  const requestId = (value as { requestId?: unknown }).requestId;
  return Number.isSafeInteger(requestId) && (requestId as number) >= 0 ? requestId as number : -1;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parsePredictionRunWorkerRequest(value: unknown): PredictionRunWorkerRequest {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prediction-run worker request must be an object.");
  }
  const envelope = value as { requestId?: unknown; type?: unknown; job?: unknown };
  if (!hasExactKeys(envelope, ["requestId", "type", "job"])) {
    throw new Error("Prediction-run worker request contains missing or unsupported fields.");
  }
  if (!Number.isSafeInteger(envelope.requestId) || (envelope.requestId as number) < 0) {
    throw new Error("Prediction-run worker request identifier is invalid.");
  }
  if (envelope.type !== "prediction-run" && envelope.type !== "parse-native-pae") {
    throw new Error("Prediction-run worker request type is unsupported.");
  }
  if (envelope.job == null || typeof envelope.job !== "object" || Array.isArray(envelope.job)) {
    throw new Error("Prediction-run worker request job must be an object.");
  }
  if (envelope.type === "parse-native-pae" && !hasExactKeys(envelope.job, ["source", "structure"])) {
    throw new Error("Native PAE worker job contains missing or unsupported fields.");
  }
  return value as PredictionRunWorkerRequest;
}
