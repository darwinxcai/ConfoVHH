import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RELEASE_VALIDATION } from "../lib/release-validation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const record = JSON.parse(await readFile(
  path.join(root, "validation", "real-prediction-run-regression-v1.json"),
  "utf8",
));

test("real prediction-run artifact identifies immutable public source bytes", () => {
  assert.equal(record.schemaVersion, "real-prediction-run-regression-1.0.0");
  assert.deepEqual(record.datasets.map((dataset) => dataset.producer), ["colabfold", "alphafold-server"]);
  assert.equal(record.datasets.length, 2);
  assert.equal(record.datasets.flatMap((dataset) => dataset.inputs).length, 26);
  const digests = record.datasets.flatMap((dataset) => dataset.inputs.map((input) => input.sha256));
  assert.equal(new Set(digests).size, 26);
  assert.ok(digests.every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  assert.ok(record.datasets.every((dataset) => /^https:\/\//.test(dataset.sourceUrl)));
});

test("real producer outputs complete manifest, recurrence, and per-pose PAE paths", () => {
  for (const dataset of record.datasets) {
    assert.equal(dataset.manifest.readyPoseCount, 5);
    assert.equal(dataset.manifest.reviewPoseCount, 0);
    assert.equal(dataset.resultCounts.coordinateAccepted, 5);
    assert.equal(dataset.resultCounts.coordinateRejected, 0);
    assert.equal(dataset.resultCounts.paeAudited, 5);
    assert.equal(dataset.resultCounts.paeRejected, 0);
    assert.equal(dataset.ensemble.poseCount, 5);
    assert.equal(dataset.poseAudits.length, 5);
    assert.ok(dataset.poseAudits.every((pose) => pose.paeStatus === "audited"));
    assert.ok(dataset.poseAudits.every((pose) => Number.isFinite(pose.deltaSasaAngstrom2)));
  }
  assert.ok(record.datasets.find((dataset) => dataset.producer === "colabfold").poseAudits.every(
    (pose) => pose.paeMappingBasis === "researcher-confirmed-complete-protein-order",
  ));
  assert.ok(record.datasets.find((dataset) => dataset.producer === "alphafold-server").poseAudits.every(
    (pose) => pose.paeMappingBasis === "token-residue-metadata-verified",
  ));
});

test("real-run evidence remains explicitly separate from GPCR-VHH validation claims", () => {
  assert.match(record.claimBoundary, /do not establish binding/i);
  assert.ok(record.datasets.every((dataset) => /not a GPCR–VHH complex/.test(dataset.biologicalContext)));
  assert.ok(record.datasets.every((dataset) => /not GPCR–VHH validation/.test(dataset.domainBoundary)));
  assert.deepEqual(RELEASE_VALIDATION.realPredictionRunRegression, {
    status: "executed-public-producer-output-compatibility",
    outputArtifact: "validation/real-prediction-run-regression-v1.json",
    datasets: 2,
    sourceFiles: 26,
    coordinatePoses: 10,
    coordinatePosesAccepted: 10,
    paeAttachments: 10,
    paeAttachmentsAudited: 10,
    providers: ["alphafold-server", "colabfold"],
    domainValidation: false,
  });
});
