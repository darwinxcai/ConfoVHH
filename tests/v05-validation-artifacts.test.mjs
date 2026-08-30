import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RELEASE_VALIDATION } from "../lib/release-validation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDirectory = path.join(
  root,
  "validation",
  "v0.5-public-regression-attestation-v1",
);
const replayDirectory = path.join(
  root,
  "validation",
  "dockq-v0.5-regression-replay-v1",
);
const historicalDockqDirectory = path.join(
  root,
  "validation",
  "dockq-development-pilot-v1",
);
const implementationSnapshotDirectory = path.join(
  root,
  "validation",
  "v0.5-engine-implementation-snapshot-v1",
);
const EXPECTED_PUBLIC_SOURCE_COMMIT = "5cb57617b54baa314513486885c402449f643406";
const EXPECTED_REPLAY_SOURCE_COMMIT = "278ae1a74da133778fba5b17bc296a8e37f02e76";
const EXPECTED_PUBLIC_SUMMARY_SHA256 = "7d1dee34fe98a1b01cc05f5ad984f57841f9b1f2f545861ebca5d9a3fc83c4da";
const EXPECTED_REPLAY_SUMMARY_SHA256 = "50aedd70d049aa065e687e6bdfe2e62b914126d4634fb151b01bf73237508743";
const EXPECTED_PUBLIC_IMPLEMENTATION_FILES = [
  "lib/confovhh.ts",
  "lib/geometry-constants.ts",
  "lib/geometry-fit.ts",
  "lib/mmcif.ts",
  "lib/vhh-numbering.ts",
  "package.json",
  "package-lock.json",
  "scripts/benchmark-mmcif-assemblies.mjs",
  "scripts/benchmark-public-pdbs.mjs",
  "scripts/public-coordinate-download.mjs",
  "scripts/run-v05-public-regression-attestation.mjs",
  "validation/mmcif-regression-manifest.v1.json",
].sort();
const EXPECTED_REPLAY_IMPLEMENTATION_FILES = [
  "lib/audit-export.ts",
  "lib/audit-jobs.ts",
  "lib/audit-worker-protocol.ts",
  "lib/audit-worker.ts",
  "lib/confovhh.ts",
  "lib/coordinate-parser.ts",
  "lib/geometry-constants.ts",
  "lib/geometry-fit.ts",
  "lib/mmcif.ts",
  "lib/pose-ensemble.ts",
  "lib/state-pair.ts",
  "lib/vhh-numbering.ts",
  "package.json",
  "package-lock.json",
  "scripts/dockq-batch.py",
  "scripts/dockq-replay-comparison.mjs",
  "scripts/run-dockq-development-pilot.mjs",
  "scripts/run-dockq-v05-regression-replay.mjs",
  "validation/dockq-development-pilot-v1/pilot-spec.json",
  "validation/dockq-development-pilot-v1/source-manifest.json",
].sort();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function jsonl(filename) {
  const text = await readFile(filename, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function implementationSnapshot() {
  return json(path.join(implementationSnapshotDirectory, "index.json"));
}

async function snapshotImplementationBytes(attestationId, relative, expected) {
  const snapshot = await implementationSnapshot();
  assert.equal(snapshot.attestations[attestationId].files[relative], expected);
  const bytes = await readFile(path.join(implementationSnapshotDirectory, "objects", expected));
  assert.equal(sha256(bytes), expected);
  return bytes;
}

function checksumMap(text) {
  return new Map(text.trim().split("\n").map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/u);
    assert.ok(match, `Malformed checksum record: ${line}`);
    return [match[2], match[1]];
  }));
}

async function installedPackageDigest(packageDirectory) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else {
        assert.equal(entry.isFile(), true, `Unsupported installed-package entry: ${relative}`);
        const bytes = await readFile(absolute);
        files.push({ path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    }
  }
  await visit(packageDirectory);
  const combined = createHash("sha256");
  for (const entry of files) {
    combined.update(entry.path);
    combined.update("\0");
    combined.update(entry.sha256);
    combined.update("\0");
  }
  return { fileCount: files.length, combinedSha256: combined.digest("hex"), files };
}

test("v0.5 public attestation checksums and commit-bound accounting are intact", async () => {
  const checksums = checksumMap(await readFile(
    path.join(publicDirectory, "checksums.sha256"),
    "utf8",
  ));
  assert.deepEqual([...checksums.keys()].sort(), [
    "mmcif-and-assemblies.json",
    "native-interfaces.json",
    "summary.json",
  ]);
  for (const [filename, expected] of checksums) {
    assert.equal(sha256(await readFile(path.join(publicDirectory, filename))), expected);
  }

  const summary = await json(path.join(publicDirectory, "summary.json"));
  assert.equal(summary.schemaVersion, "1.0.0");
  assert.equal(summary.status, "executed-current-release-regression");
  assert.equal(summary.dataRole, "regression");
  assert.equal(summary.sourceAttestation.gitCommit, EXPECTED_PUBLIC_SOURCE_COMMIT);
  assert.equal(summary.sourceAttestation.workingTreeDirtyAtStart, false);
  assert.equal(summary.sourceAttestation.minimumNodeVersion, "22.18.0");
  assert.deepEqual(summary.accounting, {
    pdbMmcifSerializationPairs: 17,
    depositedAssemblyOracles: 5,
    nativeInterfaces: 17,
    wholeComplexTranslationChecks: 17,
    farTranslationControls: 102,
  });
  assert.ok(Object.values(summary.claimFlags).every((value) => value === false));
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.status,
    summary.status,
  );
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.sourceCommit,
    summary.sourceAttestation.gitCommit,
  );
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.implementationSha256,
    summary.sourceAttestation.implementation.combinedSha256,
  );
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.executedImmunumSha256,
    summary.sourceAttestation.executedDependencies.immunum.combinedSha256,
  );
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.farTranslationControls,
    summary.accounting.farTranslationControls,
  );
});

test("v0.5 public attestation binds archived implementation, unchanged scientific-core bytes, and historical dependency separation", async () => {
  const summary = await json(path.join(publicDirectory, "summary.json"));
  const implementation = summary.sourceAttestation.implementation;
  assert.deepEqual(Object.keys(implementation.files).sort(), EXPECTED_PUBLIC_IMPLEMENTATION_FILES);
  const combined = createHash("sha256");
  for (const [relative, expected] of Object.entries(implementation.files)) {
    const bytes = await snapshotImplementationBytes("public-regression", relative, expected);
    if (relative !== "package.json" && relative !== "package-lock.json") {
      assert.equal(sha256(await readFile(path.join(root, relative))), expected, `${relative}: scientific-core drift`);
    }
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }
  assert.equal(combined.digest("hex"), implementation.combinedSha256);

  const snapshot = await implementationSnapshot();
  assert.equal(snapshot.currentProductDependencyEnvironmentMatchesAttestedV05, false);
  const recordedImmunum = summary.sourceAttestation.executedDependencies.immunum;
  assert.equal(recordedImmunum.name, "immunum");
  assert.equal(recordedImmunum.version, "1.2.0");
  assert.deepEqual(snapshot.executedDependencies.immunum, {
    name: recordedImmunum.name,
    version: recordedImmunum.version,
    fileCount: recordedImmunum.fileCount,
    combinedSha256: recordedImmunum.combinedSha256,
    files: Object.fromEntries(recordedImmunum.files.map((entry) => [
      entry.path,
      { bytes: entry.bytes, sha256: entry.sha256 },
    ])),
  });

  const currentPackage = await json(path.join(root, "node_modules", "immunum", "package.json"));
  assert.equal(currentPackage.version, "1.3.0");
  const currentImmunum = await installedPackageDigest(path.join(root, "node_modules", "immunum"));
  assert.notEqual(currentImmunum.combinedSha256, recordedImmunum.combinedSha256);
});

test("v0.5 public result ledgers reconcile all source hashes and exact regressions", async () => {
  const mmcif = await json(path.join(publicDirectory, "mmcif-and-assemblies.json"));
  const native = await json(path.join(publicDirectory, "native-interfaces.json"));
  assert.equal(mmcif.schemaVersion, "1.0.0");
  assert.equal(mmcif.softwareVersion, "0.5.0");
  assert.equal(mmcif.nativeSerializationParity.structures, 17);
  assert.equal(mmcif.nativeSerializationParity.exactDiscreteMatches, 17);
  assert.equal(mmcif.nativeSerializationParity.deltaSasaParityToleranceAngstrom2, 1e-9);
  assert.equal(mmcif.depositedAssemblyOracle.structures, 5);
  assert.equal(mmcif.depositedAssemblyOracle.exactCountMatches, 5);

  assert.equal(native.schemaVersion, "1.0.0");
  assert.equal(native.softwareVersion, "0.5.0");
  assert.equal(native.structures, 17);
  assert.equal(native.nativeInterfacesDetected, 17);
  assert.equal(native.wholeComplexTranslationsInvariant, 17);
  assert.equal(native.translatedDecoysRejected, 102);
  const nativeByPdb = new Map(native.results.map((entry) => [entry.pdb, entry]));
  for (const entry of mmcif.nativeSerializationParity.results) {
    assert.equal(entry.exactDiscreteSerializationParity, true);
    assert.ok(entry.deltaSasaAbsoluteDifferenceAngstrom2 <= 1e-9);
    const independent = nativeByPdb.get(entry.pdb);
    assert.ok(independent, entry.pdb);
    assert.equal(independent.sourceBytes, entry.pdbSourceBytes);
    assert.equal(independent.sourceSha256, entry.pdbSourceSha256);
  }
  assert.ok(mmcif.depositedAssemblyOracle.results.every((entry) => (
    entry.maximumCoordinateErrorAngstrom <= 0.0011 &&
    /^[a-f0-9]{64}$/u.test(entry.sourceSha256) &&
    /^[a-f0-9]{64}$/u.test(entry.officialAssemblySha256)
  )));
});

test("v0.5 DockQ replay checksums, source attestation, and claim barriers are intact", async () => {
  const checksums = checksumMap(await readFile(
    path.join(replayDirectory, "checksums.sha256"),
    "utf8",
  ));
  assert.deepEqual([...checksums.keys()].sort(), ["comparisons.jsonl", "summary.json"]);
  for (const [filename, expected] of checksums) {
    assert.equal(sha256(await readFile(path.join(replayDirectory, filename))), expected);
  }

  const summary = await json(path.join(replayDirectory, "summary.json"));
  assert.equal(summary.schemaVersion, "1.0.0");
  assert.equal(summary.status, "executed-post-label-regression-only");
  assert.equal(summary.dataRole, "regression");
  assert.equal(summary.sourceAttestation.gitCommit, EXPECTED_REPLAY_SOURCE_COMMIT);
  assert.equal(summary.sourceAttestation.workingTreeDirtyAtStart, false);
  assert.equal(summary.relationshipToHistoricalStudy.labelsPreviouslyObserved, true);
  assert.equal(summary.relationshipToHistoricalStudy.independentValidation, false);
  assert.equal(summary.relationshipToHistoricalStudy.formalHoldoutEvaluation, false);
  assert.ok(Object.values(summary.claimFlags).every((value) => value === false));
  for (const field of ["datasetExists", "assembled", "labeled", "frozen", "opened", "evaluated"]) {
    assert.equal(summary.holdoutStatus[field], false, field);
  }

  const historicalChecksums = await readFile(
    path.join(historicalDockqDirectory, "checksums.sha256"),
  );
  assert.equal(summary.historicalArtifact.checksumFileSha256, sha256(historicalChecksums));
  assert.deepEqual(
    summary.historicalArtifact.files,
    Object.fromEntries(checksumMap(historicalChecksums.toString("utf8"))),
  );
  assert.equal(RELEASE_VALIDATION.dockqV05RegressionReplay.status, summary.status);
  assert.equal(
    RELEASE_VALIDATION.dockqV05RegressionReplay.sourceCommit,
    summary.sourceAttestation.gitCommit,
  );
  assert.equal(
    RELEASE_VALIDATION.dockqV05RegressionReplay.implementationSha256,
    summary.sourceAttestation.implementation.combinedSha256,
  );
});

test("v0.5 DockQ replay binds archived implementation and current scientific-core bytes", async () => {
  const summary = await json(path.join(replayDirectory, "summary.json"));
  const implementation = summary.sourceAttestation.implementation;
  assert.deepEqual(Object.keys(implementation.files).sort(), EXPECTED_REPLAY_IMPLEMENTATION_FILES);
  const combined = createHash("sha256");
  for (const [relative, expected] of Object.entries(implementation.files)) {
    const bytes = await snapshotImplementationBytes("dockq-regression-replay", relative, expected);
    if (relative !== "package.json" && relative !== "package-lock.json") {
      assert.equal(sha256(await readFile(path.join(root, relative))), expected, `${relative}: scientific-core drift`);
    }
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }
  assert.equal(combined.digest("hex"), implementation.combinedSha256);

  const historicalSummary = await json(path.join(historicalDockqDirectory, "summary.json"));
  assert.equal(summary.dockqEnvironment.version, historicalSummary.software.dockqVersion);
  assert.deepEqual(
    summary.dockqEnvironment.installedDistribution,
    historicalSummary.software.installedDockqDistribution,
  );
  assert.equal(summary.dockqEnvironment.pythonVersion, historicalSummary.software.pythonVersion);
  assert.deepEqual(
    summary.dockqEnvironment.pythonEnvironment,
    historicalSummary.software.pythonEnvironment,
  );
});

test("supplemental v0.5 implementation snapshot is complete and checksum-covered", async () => {
  const snapshot = await implementationSnapshot();
  assert.equal(snapshot.schemaVersion, "1.0.0");
  assert.equal(snapshot.status, "frozen-supplemental-source-snapshot");
  assert.equal(snapshot.currentProductDependencyEnvironmentMatchesAttestedV05, false);
  assert.deepEqual(Object.keys(snapshot.attestations).sort(), [
    "dockq-regression-replay",
    "public-regression",
  ]);

  const expectedBindings = {
    "public-regression": {
      summary: "validation/v0.5-public-regression-attestation-v1/summary.json",
      summarySha256: EXPECTED_PUBLIC_SUMMARY_SHA256,
      sourceCommit: EXPECTED_PUBLIC_SOURCE_COMMIT,
      implementationFiles: EXPECTED_PUBLIC_IMPLEMENTATION_FILES,
    },
    "dockq-regression-replay": {
      summary: "validation/dockq-v0.5-regression-replay-v1/summary.json",
      summarySha256: EXPECTED_REPLAY_SUMMARY_SHA256,
      sourceCommit: EXPECTED_REPLAY_SOURCE_COMMIT,
      implementationFiles: EXPECTED_REPLAY_IMPLEMENTATION_FILES,
    },
  };
  for (const [id, expected] of Object.entries(expectedBindings)) {
    const archived = snapshot.attestations[id];
    assert.equal(archived.summary, expected.summary);
    assert.equal(archived.summarySha256, expected.summarySha256);
    assert.equal(archived.sourceCommit, expected.sourceCommit);
    const summaryBytes = await readFile(path.join(root, archived.summary));
    assert.equal(sha256(summaryBytes), expected.summarySha256);
    const summary = JSON.parse(summaryBytes.toString("utf8"));
    assert.equal(archived.sourceCommit, summary.sourceAttestation.gitCommit);
    assert.equal(
      archived.implementationCombinedSha256,
      summary.sourceAttestation.implementation.combinedSha256,
    );
    assert.deepEqual(archived.files, summary.sourceAttestation.implementation.files);
    assert.deepEqual(Object.keys(archived.files).sort(), expected.implementationFiles);
  }

  const checksums = checksumMap(await readFile(
    path.join(implementationSnapshotDirectory, "checksums.sha256"),
    "utf8",
  ));
  const files = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else if (relative !== "checksums.sha256") files.push(relative);
    }
  }
  await visit(implementationSnapshotDirectory);
  assert.deepEqual([...checksums.keys()].sort(), files.sort());
  for (const [relative, expected] of checksums) {
    assert.equal(sha256(await readFile(path.join(implementationSnapshotDirectory, relative))), expected);
  }

  const immunum = snapshot.executedDependencies.immunum;
  const publicSummary = await json(path.join(publicDirectory, "summary.json"));
  const recordedImmunum = publicSummary.sourceAttestation.executedDependencies.immunum;
  assert.deepEqual(immunum, {
    name: recordedImmunum.name,
    version: recordedImmunum.version,
    fileCount: recordedImmunum.fileCount,
    combinedSha256: recordedImmunum.combinedSha256,
    files: Object.fromEntries(recordedImmunum.files.map((entry) => [
      entry.path,
      { bytes: entry.bytes, sha256: entry.sha256 },
    ])),
  });
  assert.equal(immunum.version, "1.2.0");
  assert.equal(Object.keys(immunum.files).length, immunum.fileCount);
  const combined = createHash("sha256");
  for (const [relative, entry] of Object.entries(immunum.files)) {
    const bytes = await readFile(path.join(implementationSnapshotDirectory, "objects", entry.sha256));
    assert.equal(bytes.byteLength, entry.bytes);
    assert.equal(sha256(bytes), entry.sha256);
    combined.update(relative);
    combined.update("\0");
    combined.update(entry.sha256);
    combined.update("\0");
  }
  assert.equal(combined.digest("hex"), immunum.combinedSha256);

  const expectedObjects = new Set([
    ...Object.values(snapshot.attestations).flatMap((attestation) => Object.values(attestation.files)),
    ...Object.values(immunum.files).map((entry) => entry.sha256),
  ]);
  const objectEntries = await readdir(
    path.join(implementationSnapshotDirectory, "objects"),
    { withFileTypes: true },
  );
  assert.ok(objectEntries.every((entry) => entry.isFile() && /^[a-f0-9]{64}$/u.test(entry.name)));
  assert.deepEqual(
    objectEntries.map((entry) => entry.name).sort(),
    [...expectedObjects].sort(),
  );
});

test("all 360 replay comparisons reconcile exact records and bounded SASA drift", async () => {
  const summary = await json(path.join(replayDirectory, "summary.json"));
  const comparisons = await jsonl(path.join(replayDirectory, "comparisons.jsonl"));
  const historicalPoses = await jsonl(path.join(historicalDockqDirectory, "poses.jsonl"));
  const historicalById = new Map(historicalPoses.map((entry) => [entry.poseId, entry]));
  assert.equal(comparisons.length, 360);
  assert.equal(new Set(comparisons.map((entry) => entry.poseId)).size, 360);

  let exactFullAudits = 0;
  let maximumDelta = 0;
  let maximumHalfDelta = 0;
  let positiveDeltaDrifts = 0;
  let negativeDeltaDrifts = 0;
  let zeroDeltaDrifts = 0;
  for (const comparison of comparisons) {
    const historical = historicalById.get(comparison.poseId);
    assert.ok(historical, comparison.poseId);
    assert.equal(comparison.targetId, historical.targetId);
    assert.equal(comparison.generatedCoordinate.bytes, historical.generatedCoordinateBytes);
    assert.equal(comparison.generatedCoordinate.sha256, historical.generatedCoordinateSha256);
    assert.equal(comparison.generatedCoordinate.exactMatch, true);
    assert.equal(comparison.audit.exactNonSasaMatch, true);
    assert.equal(comparison.audit.sasaWithinTolerance, true);
    assert.equal(comparison.dockq.exactMatch, true);
    assert.equal(comparison.dockq.value, historical.dockq.DockQ);
    assert.equal(comparison.capriClass.exactMatch, true);
    assert.equal(comparison.capriClass.value, historical.capriClass);

    const delta = comparison.audit.deltaSasaAngstrom2;
    const half = comparison.audit.halfDeltaSasaInterfaceAreaAngstrom2;
    assert.equal(delta.expected, historical.audit.deltaSasaAngstrom2);
    assert.equal(half.expected, historical.audit.halfDeltaSasaInterfaceAreaAngstrom2);
    assert.equal(delta.absoluteDifference, Math.abs(delta.observed - delta.expected));
    assert.equal(half.absoluteDifference, Math.abs(half.observed - half.expected));
    assert.equal(delta.tolerance, 1e-9);
    assert.equal(half.tolerance, 5e-10);
    assert.ok(delta.absoluteDifference <= delta.tolerance);
    assert.ok(half.absoluteDifference <= half.tolerance);
    assert.equal(delta.withinTolerance, true);
    assert.equal(half.withinTolerance, true);
    assert.equal(half.expected, delta.expected / 2);
    assert.equal(half.observed, delta.observed / 2);
    assert.equal(comparison.audit.exactFullMatch, delta.exactMatch && half.exactMatch);
    if (comparison.audit.exactFullMatch) exactFullAudits += 1;
    maximumDelta = Math.max(maximumDelta, delta.absoluteDifference);
    maximumHalfDelta = Math.max(maximumHalfDelta, half.absoluteDifference);
    if (delta.observed > delta.expected) positiveDeltaDrifts += 1;
    else if (delta.observed < delta.expected) negativeDeltaDrifts += 1;
    else zeroDeltaDrifts += 1;
  }

  assert.deepEqual(
    { positiveDeltaDrifts, negativeDeltaDrifts, zeroDeltaDrifts },
    { positiveDeltaDrifts: 131, negativeDeltaDrifts: 208, zeroDeltaDrifts: 21 },
  );
  assert.equal(exactFullAudits, 21);
  assert.equal(maximumDelta, 1.0277290130034089e-10);
  assert.equal(maximumHalfDelta, 5.1386450650170445e-11);
  assert.deepEqual(summary.replayAccounting, {
    targets: 5,
    poses: 360,
    exactCoordinateMatches: 360,
    exactNonSasaAuditMatches: 360,
    sasaToleranceMatches: 360,
    exactFullAuditMatches: 21,
    sasaTolerancesAngstrom2: {
      deltaSasaAngstrom2: 1e-9,
      halfDeltaSasaInterfaceAreaAngstrom2: 5e-10,
    },
    maximumDeltaSasaAbsoluteDifferenceAngstrom2: maximumDelta,
    maximumHalfDeltaSasaAbsoluteDifferenceAngstrom2: maximumHalfDelta,
    exactDockqMatches: 360,
    exactCapriClassMatches: 360,
    aggregateComparisonsPassed: true,
  });
});

test("replay controls reconcile the five targets and remain exact at far translation", async () => {
  const summary = await json(path.join(replayDirectory, "summary.json"));
  const historicalTargets = await jsonl(path.join(historicalDockqDirectory, "targets.jsonl"));
  const historicalById = new Map(historicalTargets.map((entry) => [entry.targetId, entry]));
  assert.equal(summary.controls.targetControls.length, 5);
  for (const control of summary.controls.targetControls) {
    const historical = historicalById.get(control.targetId);
    assert.ok(historical, control.targetId);
    assert.equal(control.nativeSelfPassed, true);
    assert.equal(control.farTranslationPassed, true);
    assert.equal(
      control.nativeAudit.deltaSasaAngstrom2.expected,
      historical.nativeAudit.deltaSasaAngstrom2,
    );
    assert.equal(
      control.nativeAudit.halfDeltaSasaInterfaceAreaAngstrom2.expected,
      historical.nativeAudit.halfDeltaSasaInterfaceAreaAngstrom2,
    );
    assert.equal(
      control.nativeAudit.halfDeltaSasaInterfaceAreaAngstrom2.observed,
      control.nativeAudit.deltaSasaAngstrom2.observed / 2,
    );
    for (const field of ["deltaSasaAngstrom2", "halfDeltaSasaInterfaceAreaAngstrom2"]) {
      assert.equal(control.farTranslationAudit[field].expected, 0);
      assert.equal(control.farTranslationAudit[field].observed, 0);
      assert.equal(control.farTranslationAudit[field].absoluteDifference, 0);
      assert.equal(control.farTranslationAudit[field].exactMatch, true);
    }
  }
  assert.equal(summary.controls.nativeSelfPassed, 5);
  assert.equal(summary.controls.farTranslationPassed, 5);
  assert.equal(summary.controls.cliCrossChecksRun, 10);
  assert.equal(summary.controls.cliCrossChecksPassed, 10);
  assert.equal(summary.controls.controlsAndCrossChecks, 20);
  assert.equal(summary.controls.controlsAndCrossChecksPassed, 20);
  assert.equal(summary.controls.maximumFarTranslationDeltaSasaAbsoluteDifferenceAngstrom2, 0);
  assert.equal(summary.controls.maximumFarTranslationHalfDeltaSasaAbsoluteDifferenceAngstrom2, 0);
});
