import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RELEASE_VALIDATION } from "../lib/release-validation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const pilotDirectory = path.join(root, "validation", "dockq-development-pilot-v1");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(filename) {
  return JSON.parse(await readFile(path.join(pilotDirectory, filename), "utf8"));
}

async function jsonl(filename) {
  return (await readFile(path.join(pilotDirectory, filename), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function expectedCapriClass(dockq) {
  if (dockq >= 0.8) return "high";
  if (dockq >= 0.49) return "medium";
  if (dockq >= 0.23) return "acceptable";
  return "incorrect";
}

test("release metadata namespaces, versions, bounds, and claim barriers are explicit", () => {
  assert.equal(RELEASE_VALIDATION.schemaVersion, "1.2.0");
  assert.equal(RELEASE_VALIDATION.softwareVersion, "0.5.0");
  assert.equal(RELEASE_VALIDATION.runtime.minimumNodeVersion, "22.18.0");
  assert.equal(
    RELEASE_VALIDATION.computationalBounds.maximumAbsoluteSourceCoordinateAngstrom,
    10_000_000,
  );
  assert.equal(RELEASE_VALIDATION.publicV05RegressionAttestation.status, "executed-current-release-regression");
  assert.equal(
    RELEASE_VALIDATION.publicV05RegressionAttestation.sourceCommit,
    "5cb57617b54baa314513486885c402449f643406",
  );
  assert.equal(
    RELEASE_VALIDATION.dockqV05RegressionReplay.status,
    "executed-post-label-regression-only",
  );
  assert.equal(
    RELEASE_VALIDATION.dockqV05RegressionReplay.sourceCommit,
    "278ae1a74da133778fba5b17bc296a8e37f02e76",
  );
  assert.equal(RELEASE_VALIDATION.holdoutStatus.provisionalGroups, 7);
  assert.equal(RELEASE_VALIDATION.holdoutStatus.formallyClearedGroups, 0);
  assert.equal(RELEASE_VALIDATION.holdoutStatus.minimumRequiredGroups, 10);
  assert.equal(RELEASE_VALIDATION.holdoutStatus.candidateDiscoveryComplete, false);
  assert.equal(RELEASE_VALIDATION.holdoutStatus.epitopeBlindingDesignResolved, false);
  assert.ok(Object.values(RELEASE_VALIDATION.claimFlags).every((value) => value === false));
});

test("clean-tree attestation runners pin committed source and publish without overwrite", async () => {
  const replay = await readFile(
    path.join(root, "scripts", "run-dockq-v05-regression-replay.mjs"),
    "utf8",
  );
  const publicAttestation = await readFile(
    path.join(root, "scripts", "run-v05-public-regression-attestation.mjs"),
    "utf8",
  );
  for (const source of [replay, publicAttestation]) {
    assert.match(source, /git", \["show", `\$\{sourceCommit\}:\$\{relative\}`\]/);
    assert.match(source, /"worktree", "add", "--detach"/);
    assert.match(source, /await rename\(staging(?:Directory)?, OUTPUT_DIRECTORY\)/);
    assert.match(source, /Refusing to overwrite/);
    assert.doesNotMatch(source, /rm\(OUTPUT_DIRECTORY/);
  }
  assert.match(replay, /"lib\/geometry-constants\.ts"/);
  assert.match(replay, /normalizedPoseRecord\(observed\)/);
  assert.match(replay, /normalizedTargetRecord\(observed\)/);

  const mmcifRunner = await readFile(
    path.join(root, "scripts", "benchmark-mmcif-assemblies.mjs"),
    "utf8",
  );
  const nativeRunner = await readFile(
    path.join(root, "scripts", "benchmark-public-pdbs.mjs"),
    "utf8",
  );
  const publicDownload = await readFile(
    path.join(root, "scripts", "public-coordinate-download.mjs"),
    "utf8",
  );
  for (const source of [mmcifRunner, nativeRunner]) {
    assert.match(source, /downloadPublicCoordinate/);
    assert.match(source, /softwareVersion: CONFOVHH_VERSION/);
  }
  assert.match(publicDownload, /AbortSignal\.timeout\(timeoutMilliseconds\)/);
  assert.match(publicDownload, /streamed response exceeds the \$\{limitLabel\} public-coordinate limit/);
  assert.doesNotMatch(publicDownload, /response\.arrayBuffer\(\)/);
  assert.match(publicAttestation, /installedPackageDigest/);
  assert.match(publicAttestation, /Installed immunum distribution changed during public regressions/);
  assert.match(publicAttestation, /Executed public-regression worktree changed during the run/);
  assert.match(publicAttestation, /independent PDB SHA-256 values differ/);
  assert.match(publicAttestation, /open\(PUBLICATION_LOCK_PATH, "wx"\)/);
});

test("mmCIF regression manifest freezes complete native and assembly provenance", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(root, "validation", "mmcif-regression-manifest.v1.json"),
    "utf8",
  ));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.nativePanel.length, 17);
  assert.equal(manifest.assemblyGoldens.length, 5);
  assert.equal(new Set(manifest.nativePanel.map((entry) => entry.pdb)).size, 17);
  assert.equal(manifest.claims.nearNativeRankingValidated, false);
  for (const entry of manifest.nativePanel) {
    assert.match(entry.cifSha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.cifBytes > 100_000);
    assert.ok(entry.proteinAtoms > 1_000);
    assert.ok(entry.proteinResidues > 100);
    assert.ok(entry.contacts > 0);
    assert.ok(entry.deltaSasa > 0);
  }
  for (const entry of manifest.assemblyGoldens) {
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.assemblySha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.sourceBytes > 100_000);
    assert.ok(entry.assemblyBytes > 100_000);
    assert.ok(entry.proteinChains >= 2);
  }
});

test("state-context inventory is internally reconciled and makes no biological validation claim", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(root, "validation", "mmcif-regression-manifest.v1.json"),
    "utf8",
  ));
  const inventory = JSON.parse(await readFile(
    path.join(root, "validation", "state-context-native-regression-v1.json"),
    "utf8",
  ));
  assert.equal(inventory.schemaVersion, "1.0.0");
  assert.equal(inventory.dataRole, "regression");
  assert.equal(inventory.counts.nativeComplexes, 4);
  assert.equal(inventory.counts.nativeInterfacesDetected, 4);
  assert.equal(inventory.counts.receptorContextPairs, 2);
  assert.equal(inventory.counts.sameVhhCrossContextPairs, 0);
  assert.equal(inventory.counts.pairedFeatureEligiblePairs, 0);
  assert.equal(inventory.nativeComplexes.length, inventory.counts.nativeComplexes);
  assert.equal(inventory.receptorContextPairs.length, inventory.counts.receptorContextPairs);
  assert.ok(Object.values(inventory.claimFlags).every((value) => value === false));
  assert.match(
    inventory.limitations.at(-1),
    /No independent family-clustered hard-decoy holdout dataset exists.*none has been assembled, labeled, frozen, opened, or evaluated\./,
  );
  for (const entry of inventory.nativeComplexes) {
    const source = manifest.nativePanel.find((candidate) => candidate.pdb === entry.pdb);
    assert.ok(source, `${entry.pdb} must originate in the frozen public native panel`);
    assert.equal(entry.cifSha256, source.cifSha256);
    assert.equal(entry.cifBytes, source.cifBytes);
    assert.equal(entry.nativeAuditRegression.contactPairCount, source.contacts);
    assert.equal(entry.nativeAuditRegression.deltaSasaAngstrom2, source.deltaSasa);
    assert.equal(entry.nativeAuditRegression.interfaceDetected, true);
  }
  for (const pair of inventory.receptorContextPairs) {
    assert.equal(pair.sameVhh, false);
    assert.equal(pair.pairedFeatureEligible, false);
    assert.match(pair.ineligibilityReason, /exact equality of the observed VHH sequence/i);
  }
});

test("DockQ development artifact checksums and frozen-before-labeling contract are intact", async () => {
  const checksumText = await readFile(path.join(pilotDirectory, "checksums.sha256"), "utf8");
  assert.equal(
    sha256(checksumText),
    "d68cde133ae39f1b142e5ecccfde3b8ffc2a17a94c6999c7d21d3e3d81d18e3c",
  );
  const checksums = new Map(checksumText.trim().split("\n").map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `Malformed checksum line: ${line}`);
    return [match[2], match[1]];
  }));
  assert.deepEqual([...checksums.keys()].sort(), [
    "pilot-spec.json",
    "poses.jsonl",
    "source-manifest.json",
    "summary.json",
    "summary.md",
    "targets.jsonl",
  ]);
  for (const [filename, expected] of checksums) {
    assert.equal(sha256(await readFile(path.join(pilotDirectory, filename))), expected, filename);
  }

  const spec = await json("pilot-spec.json");
  const summary = await json("summary.json");
  assert.ok(new Date(spec.frozenAt) < new Date(summary.runStartedAt));
  assert.equal(summary.frozenSpecification.sha256, checksums.get("pilot-spec.json"));
  assert.equal(summary.artifactIntegrity.sourceManifestSha256, checksums.get("source-manifest.json"));
  assert.equal(summary.artifactIntegrity.targetsJsonlSha256, checksums.get("targets.jsonl"));
  assert.equal(summary.artifactIntegrity.posesJsonlSha256, checksums.get("poses.jsonl"));
  assert.equal(spec.protocolRelationship, "local-SE3-subset-not-formal-hard-decoy-execution");
  assert.equal(summary.status, "executed-development-only");
  assert.equal(summary.dataRole, "development");
});

test("DockQ development artifact preserves its historical implementation attestation", async () => {
  const summary = await json("summary.json");
  const recorded = summary.software.implementation;
  assert.ok(recorded && typeof recorded === "object");
  assert.ok(recorded.files && typeof recorded.files === "object");
  for (const [relative, expectedDigest] of Object.entries(recorded.files)) {
    assert.match(relative, /^(?:(?:lib|scripts|validation)\/|package(?:-lock)?\.json$)/);
    assert.match(expectedDigest, /^[a-f0-9]{64}$/);
  }
  assert.match(recorded.combinedSha256, /^[a-f0-9]{64}$/);
  assert.equal(summary.software.confovhhVersion, "0.4.0");
  assert.equal(summary.software.workingTreeDirty, true);
  // The historical artifact is byte-frozen by checksums above. Current v0.5
  // source is bound by the separate clean-tree replay artifact instead of by
  // pretending that a development-era implementation is still shipping.
});

test("DockQ public-source manifest exactly matches the executed target ledger", async () => {
  const manifest = await json("source-manifest.json");
  const targets = await jsonl("targets.jsonl");
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.targets.length, targets.length);
  for (const expected of manifest.targets) {
    const observed = targets.find((target) => target.targetId === expected.targetId);
    assert.ok(observed, expected.targetId);
    assert.equal(observed.pdb, expected.pdb);
    assert.equal(observed.sourceUrl, expected.sourceUrl);
    assert.equal(observed.sourceBytes, expected.sourceBytes);
    assert.equal(observed.sourceSha256, expected.sourceSha256);
  }
});

test("DockQ pose ledger is complete, finite, mapped, and internally reproducible", async () => {
  const spec = await json("pilot-spec.json");
  const targets = await jsonl("targets.jsonl");
  const poses = await jsonl("poses.jsonl");
  const summary = await json("summary.json");
  assert.equal(targets.length, 5);
  assert.equal(poses.length, 360);
  assert.equal(new Set(poses.map((pose) => pose.poseId)).size, poses.length);
  assert.equal(summary.poseAccounting.generatedBeforeDeduplication, poses.length);
  assert.equal(summary.poseAccounting.retained, poses.filter((pose) => pose.eligibility === "retained").length);
  assert.equal(summary.poseAccounting.excludedError, poses.filter((pose) => pose.eligibility === "excluded-error").length);

  const counts = { high: 0, medium: 0, acceptable: 0, incorrect: 0 };
  for (const target of targets) {
    assert.match(target.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(target.canonicalNativeCoordinateSha256, /^[a-f0-9]{64}$/);
    assert.match(target.receptorSequenceSha256, /^[a-f0-9]{64}$/);
    assert.match(target.vhhSequenceSha256, /^[a-f0-9]{64}$/);
    assert.equal(target.coordinateScope, "as-supplied");
    assert.equal(target.canonicalDockqChainMapping.explicitMapping, "AB:AB");
    assert.equal(target.controls.nativeSelf.passed, true);
    assert.equal(target.controls.nativeSelf.auditReproduction.passed, true);
    assert.ok(Object.values(target.controls.nativeSelf.auditReproduction.exactMatches).every(Boolean));
    assert.ok(Object.values(target.controls.nativeSelf.auditReproduction.numericToleranceChecks)
      .every((check) => check.absoluteDifference <= check.tolerance));
    assert.equal(target.controls.farTranslation.passed, true);
    assert.equal(target.controls.farTranslation.audit.contactPairCount, 0);
    assert.equal(target.controls.farTranslation.audit.deltaSasaAngstrom2, 0);
  }

  for (const target of spec.targets) {
    assert.equal(poses.filter((pose) => pose.targetId === target.targetId).length, 72);
  }
  for (const pose of poses) {
    assert.equal(pose.dataRole, "development");
    assert.match(pose.deterministicSeedSha256, /^[a-f0-9]{64}$/);
    assert.match(pose.implementationSha256, /^[a-f0-9]{64}$/);
    assert.equal(pose.transform.matrixRowMajor4x4.length, 4);
    assert.ok(pose.transform.matrixRowMajor4x4.flat().every(Number.isFinite));
    if (pose.eligibility !== "retained") continue;
    assert.equal(pose.errorState, null);
    assert.equal(pose.audit.confidenceMode, "none");
    assert.equal(pose.audit.paeAttached, false);
    assert.equal(pose.audit.plddtInterpreted, false);
    assert.equal(pose.dockq.version, "2.1.3");
    assert.equal(pose.dockq.mapping, "AB:AB");
    assert.equal(pose.dockq.interface, "A:B");
    assert.ok(Number.isFinite(pose.dockq.DockQ));
    assert.equal(pose.capriClass, expectedCapriClass(pose.dockq.DockQ));
    counts[pose.capriClass] += 1;
  }
  assert.deepEqual(counts, summary.poseAccounting.capriClasses);
});

test("DockQ summaries recompute their label counts and preserve all claim barriers", async () => {
  const poses = await jsonl("poses.jsonl");
  const summary = await json("summary.json");
  const markdown = await readFile(path.join(pilotDirectory, "summary.md"), "utf8");
  const retained = poses.filter((pose) => pose.eligibility === "retained");
  const positive = retained.filter((pose) => pose.dockq.DockQ >= 0.23);
  assert.equal(summary.poseAccounting.primaryPositiveCount, positive.length);
  assert.ok(Math.abs(
    summary.poseAccounting.primaryPositiveRate - positive.length / retained.length,
  ) <= 1e-12);

  for (const [targetId, metrics] of Object.entries(
    summary.primaryAnalysis.perTarget.random_all_tied,
  )) {
    const targetPoses = retained.filter((pose) => pose.targetId === targetId);
    const targetPositive = targetPoses.filter((pose) => pose.dockq.DockQ >= 0.23).length;
    assert.equal(metrics.poseCount, targetPoses.length);
    assert.equal(metrics.positiveCount, targetPositive);
    assert.equal(metrics.prevalence, targetPositive / targetPoses.length);
    assert.equal(metrics.averagePrecision, metrics.prevalence);
    assert.equal(metrics.auroc, 0.5);
  }

  assert.equal(summary.controls.nativeSelfPassed, 5);
  assert.equal(summary.controls.farTranslationPassed, 5);
  assert.equal(summary.controls.cliCrossChecksRun, 10);
  assert.equal(summary.controls.cliCrossChecksPassed, 10);
  assert.equal(summary.controls.maximumCliAbsoluteDifference, 0);
  assert.equal(summary.software.installedDockqDistribution.name.toLowerCase(), "dockq");
  assert.equal(summary.software.installedDockqDistribution.version, "2.1.3");
  assert.ok(summary.software.installedDockqDistribution.fileCount > 0);
  assert.match(summary.software.installedDockqDistribution.combinedSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    summary.software.installedDockqDistribution.files.length,
    summary.software.installedDockqDistribution.fileCount,
  );
  assert.ok(summary.software.installedDockqDistribution.files.every((entry) => (
    Number.isInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/.test(entry.sha256)
  )));
  const dockqCombined = createHash("sha256");
  for (const entry of summary.software.installedDockqDistribution.files) {
    dockqCombined.update(entry.path);
    dockqCombined.update("\0");
    dockqCombined.update(entry.sha256);
    dockqCombined.update("\0");
  }
  assert.equal(
    dockqCombined.digest("hex"),
    summary.software.installedDockqDistribution.combinedSha256,
  );
  assert.equal(summary.software.pythonEnvironment.command, "python -m pip freeze --all");
  assert.equal(
    summary.software.pythonEnvironment.packages.length,
    summary.software.pythonEnvironment.packageCount,
  );
  assert.ok(summary.software.pythonEnvironment.packages.some(
    (entry) => entry.toLowerCase() === "dockq==2.1.3",
  ));
  assert.equal(
    sha256(`${summary.software.pythonEnvironment.packages.join("\n")}\n`),
    summary.software.pythonEnvironment.sha256,
  );
  assert.equal(summary.bootstrap.replicates, 10_000);
  assert.equal(summary.formalHoldoutEvaluated, false);
  assert.equal(summary.hardDecoyProtocolCompleted, false);
  assert.equal(summary.nearNativeRankingValidated, false);
  assert.equal(summary.preliminaryNearNativeClaimAllowed, false);
  assert.equal(summary.methodClarifications.cdrZeroContactPolicy.dockqFittingPerformed, false);
  assert.match(summary.methodClarifications.cdrZeroContactPolicy.status, /final-attested-rerun/);
  assert.equal(RELEASE_VALIDATION.softwareVersion, "0.5.0");
  assert.equal(summary.software.confovhhVersion, "0.4.0");
  assert.equal(RELEASE_VALIDATION.dockqDevelopmentPilot.targets, summary.poseAccounting.targets);
  assert.equal(RELEASE_VALIDATION.dockqDevelopmentPilot.generatedPoses, summary.poseAccounting.generatedBeforeDeduplication);
  assert.equal(RELEASE_VALIDATION.dockqDevelopmentPilot.retainedPoses, summary.poseAccounting.retained);
  assert.equal(RELEASE_VALIDATION.dockqDevelopmentPilot.primaryPositiveRate, summary.poseAccounting.primaryPositiveRate);
  assert.equal(
    RELEASE_VALIDATION.dockqDevelopmentPilot.evidenceBand.averagePrecision,
    summary.primaryAnalysis.macro.confovhh_evidence_v0_4.averagePrecision.value,
  );
  assert.equal(
    RELEASE_VALIDATION.dockqDevelopmentPilot.deltaSasa.auroc,
    summary.primaryAnalysis.macro.delta_sasa.auroc.value,
  );
  assert.equal(RELEASE_VALIDATION.claimFlags.nearNativeRankingValidated, false);
  assert.match(markdown, /development-only plumbing and association study/i);
  assert.match(markdown, /not the formal hard-decoy protocol/i);
  assert.doesNotMatch(markdown, /validated near-native ranking/i);

  for (const metrics of Object.values(summary.primaryAnalysis.perTarget.cdr_contact_share)) {
    assert.equal(metrics.poseCount, 72, "zero-contact numbered poses must remain in the CDR arm");
  }
});
