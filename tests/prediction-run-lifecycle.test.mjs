import assert from "node:assert/strict";
import test from "node:test";

import {
  canAcceptPredictionRunWorkerEvent,
  isCurrentPredictionRunGeneration,
  isCurrentPredictionRunWorkerEvent,
  nextPredictionRunGeneration,
  nextPredictionRunProgress,
} from "../lib/prediction-run-lifecycle.ts";

function progress(overrides = {}) {
  return {
    phase: "coordinate-recurrence",
    completed: 0,
    total: 4,
    filename: "reference.pdb",
    ...overrides,
  };
}

test("generation advancement is monotonic, bounded, and stale-safe", () => {
  assert.equal(nextPredictionRunGeneration(0), 1);
  assert.equal(nextPredictionRunGeneration(41), 42);
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => nextPredictionRunGeneration(invalid), /generation/i);
  }
  assert.equal(isCurrentPredictionRunGeneration(4, 4), true);
  assert.equal(isCurrentPredictionRunGeneration(4, 3), false);
  assert.equal(isCurrentPredictionRunGeneration(4, Number.NaN), false);
});

test("worker events require both the current generation and request identifier", () => {
  assert.equal(isCurrentPredictionRunWorkerEvent(8, 8, 12, 12), true);
  assert.equal(isCurrentPredictionRunWorkerEvent(8, 7, 12, 12), false);
  assert.equal(isCurrentPredictionRunWorkerEvent(8, 8, 12, 11), false);
  assert.equal(isCurrentPredictionRunWorkerEvent(8, 8, 12, -1), false);
  assert.equal(canAcceptPredictionRunWorkerEvent(8, 8, 12, 12, false), true);
  assert.equal(canAcceptPredictionRunWorkerEvent(8, 8, 12, 12, true), false);
});

test("progress accepts phase-local monotonic updates and the one forward phase transition", () => {
  const initialCandidate = progress();
  const initial = nextPredictionRunProgress(null, initialCandidate);
  assert.deepEqual(initial, initialCandidate);
  assert.notEqual(initial, initialCandidate, "accepted progress must be copied away from worker-owned data");

  const advanced = nextPredictionRunProgress(initial, progress({ completed: 4, filename: "pose-4.pdb" }));
  assert.equal(advanced.completed, 4);
  const nextPhase = nextPredictionRunProgress(advanced, progress({
    phase: "per-pose-audit",
    completed: 0,
    total: 2,
    filename: "reference.pdb",
  }));
  assert.deepEqual(nextPhase, {
    phase: "per-pose-audit",
    completed: 0,
    total: 2,
    filename: "reference.pdb",
  });
});

test("progress retains its prior snapshot for malformed, regressive, or phase-reversing events", () => {
  const accepted = progress({ phase: "per-pose-audit", completed: 1, total: 3 });
  const rejected = [
    progress({ phase: "coordinate-recurrence", completed: 4, total: 4 }),
    progress({ phase: "per-pose-audit", completed: 0, total: 3 }),
    progress({ phase: "per-pose-audit", completed: 2, total: 4 }),
    progress({ phase: "per-pose-audit", completed: 4, total: 3 }),
    progress({ phase: "per-pose-audit", completed: 2.5, total: 3 }),
    progress({ phase: "per-pose-audit", completed: 2, total: 3, filename: "bad\nname.pdb" }),
    { phase: "unknown", completed: 2, total: 3, filename: "pose.pdb" },
    null,
  ];
  for (const candidate of rejected) {
    assert.equal(nextPredictionRunProgress(accepted, candidate), accepted);
  }
});

test("progress cannot enter per-pose audit before coordinate recurrence completes", () => {
  const incomplete = progress({ completed: 3, total: 4 });
  const early = progress({
    phase: "per-pose-audit",
    completed: 0,
    total: 2,
  });
  assert.equal(nextPredictionRunProgress(incomplete, early), incomplete);
});
