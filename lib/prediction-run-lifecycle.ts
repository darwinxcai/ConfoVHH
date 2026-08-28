import type { PredictionRunProgress } from "./prediction-run-jobs.ts";

const MAX_PROGRESS_FILENAME_CHARACTERS = 1_024;

/**
 * Advance the local operation generation without allowing integer wraparound.
 * Every cancel, replacement, reset, or new operation invalidates earlier work
 * by advancing this value.
 */
export function nextPredictionRunGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Prediction-run generation must be a non-negative safe integer below the maximum.");
  }
  return current + 1;
}

/** Fail closed for malformed or stale async generations. */
export function isCurrentPredictionRunGeneration(
  currentGeneration: number,
  eventGeneration: number,
): boolean {
  return Number.isSafeInteger(currentGeneration) && currentGeneration >= 0 &&
    Number.isSafeInteger(eventGeneration) && eventGeneration >= 0 &&
    currentGeneration === eventGeneration;
}

/**
 * A worker message can mutate UI state only when both its operation generation
 * and request identifier match the currently owned worker request.
 */
export function isCurrentPredictionRunWorkerEvent(
  currentGeneration: number,
  eventGeneration: number,
  expectedRequestId: number,
  eventRequestId: number,
): boolean {
  return isCurrentPredictionRunGeneration(currentGeneration, eventGeneration) &&
    Number.isSafeInteger(expectedRequestId) && expectedRequestId >= 0 &&
    Number.isSafeInteger(eventRequestId) && eventRequestId >= 0 &&
    expectedRequestId === eventRequestId;
}

/**
 * Terminal worker operations are immutable. Even a queued message carrying the
 * right generation and request identifier cannot mutate state after the first
 * result, error, timeout, cancellation, or decode failure terminalizes it.
 */
export function canAcceptPredictionRunWorkerEvent(
  currentGeneration: number,
  eventGeneration: number,
  expectedRequestId: number,
  eventRequestId: number,
  operationFinished: boolean,
): boolean {
  return operationFinished === false && isCurrentPredictionRunWorkerEvent(
    currentGeneration,
    eventGeneration,
    expectedRequestId,
    eventRequestId,
  );
}

function isPredictionRunProgress(value: unknown): value is PredictionRunProgress {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Partial<PredictionRunProgress>;
  return (progress.phase === "coordinate-recurrence" || progress.phase === "per-pose-audit") &&
    Number.isSafeInteger(progress.completed) && (progress.completed as number) >= 0 &&
    Number.isSafeInteger(progress.total) && (progress.total as number) >= 1 &&
    (progress.completed as number) <= (progress.total as number) &&
    typeof progress.filename === "string" && progress.filename.length > 0 &&
    progress.filename.length <= MAX_PROGRESS_FILENAME_CHARACTERS &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(progress.filename);
}

/**
 * Retain the last accepted progress when a worker reports malformed,
 * regressive, phase-reversing, or total-changing progress. A transition from
 * coordinate recurrence into per-pose audit starts a new phase-local counter.
 */
export function nextPredictionRunProgress(
  previous: PredictionRunProgress | null,
  candidate: unknown,
): PredictionRunProgress | null {
  if (!isPredictionRunProgress(candidate)) return previous;
  if (previous != null) {
    if (!isPredictionRunProgress(previous)) {
      throw new Error("Previously accepted prediction-run progress is invalid.");
    }
    if (previous.phase === "per-pose-audit" && candidate.phase === "coordinate-recurrence") {
      return previous;
    }
    if (
      previous.phase === "coordinate-recurrence" && candidate.phase === "per-pose-audit" &&
      previous.completed !== previous.total
    ) return previous;
    if (
      previous.phase === candidate.phase &&
      (candidate.total !== previous.total || candidate.completed < previous.completed)
    ) return previous;
  }
  return {
    phase: candidate.phase,
    completed: candidate.completed,
    total: candidate.total,
    filename: candidate.filename,
  };
}
