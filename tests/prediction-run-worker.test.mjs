import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parsePredictionRunWorkerRequest,
  recoverPredictionRunRequestId,
} from "../lib/prediction-run-worker-protocol.ts";

const minimalJob = {
  poses: [],
  referenceCoordinateFileId: "reference",
  referenceReceptorChain: "R",
  referenceVhhChain: "V",
  paeAssociationsAndOrderConfirmed: false,
  topologyAnnotation: null,
};

test("accepts only the two bounded prediction-run worker request types", () => {
  assert.deepEqual(parsePredictionRunWorkerRequest({
    requestId: 1,
    type: "prediction-run",
    job: minimalJob,
  }).job, minimalJob);
  const parseRequest = parsePredictionRunWorkerRequest({
    requestId: 2,
    type: "parse-native-pae",
    job: { source: {}, structure: {} },
  });
  assert.equal(parseRequest.type, "parse-native-pae");
  for (const invalid of [
    null,
    [],
    { requestId: -1, type: "prediction-run", job: {} },
    { requestId: 1.5, type: "prediction-run", job: {} },
    { requestId: 1, type: "unsupported", job: {} },
    { requestId: 1, type: "prediction-run", job: null },
    { requestId: 1, type: "prediction-run" },
    { requestId: 1, type: "prediction-run", job: minimalJob, extra: true },
    { requestId: 1, type: "parse-native-pae", job: { source: {}, structure: {}, extra: true } },
  ]) assert.throws(() => parsePredictionRunWorkerRequest(invalid), /request|identifier|unsupported|job/i);
});

test("recovers request identifiers without trusting malformed envelopes", () => {
  assert.equal(recoverPredictionRunRequestId({ requestId: 9 }), 9);
  assert.equal(recoverPredictionRunRequestId({ requestId: -1 }), -1);
  assert.equal(recoverPredictionRunRequestId({ requestId: "9" }), -1);
  assert.equal(recoverPredictionRunRequestId(null), -1);
});

test("production worker dispatches native PAE and full-run requests with explicit error conversion", async () => {
  const source = await readFile(new URL("../lib/prediction-run-worker.ts", import.meta.url), "utf8");
  assert.match(source, /parsePredictionRunWorkerRequest/);
  assert.match(source, /extractNativePredictionPae/);
  assert.match(source, /executePredictionRunAuditJob/);
  assert.match(source, /native-pae-result/);
  assert.match(source, /type:\s*"error"/);
  assert.doesNotMatch(source, /eval\(|new Function|importScripts/);
});
