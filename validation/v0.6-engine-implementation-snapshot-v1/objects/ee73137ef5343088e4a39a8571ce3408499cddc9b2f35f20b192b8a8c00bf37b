import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  lstat,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  compareAuditWithSasaTolerance,
  DOCKQ_REPLAY_SASA_TOLERANCES,
} from "./dockq-replay-comparison.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HISTORICAL_DIRECTORY = path.join(ROOT, "validation", "dockq-development-pilot-v1");
const OUTPUT_DIRECTORY = path.join(ROOT, "validation", "dockq-v0.5-regression-replay-v1");
const HISTORICAL_CHECKSUM_PATH = path.join(HISTORICAL_DIRECTORY, "checksums.sha256");
const REPLAY_ID = "confovhh-dockq-v0.5-post-label-regression-replay-v1";
const EXPECTED_HISTORICAL_FILES = [
  "pilot-spec.json",
  "poses.jsonl",
  "source-manifest.json",
  "summary.json",
  "summary.md",
  "targets.jsonl",
];
const EXPECTED_HISTORICAL_CHECKSUM_FILE_SHA256 = "d68cde133ae39f1b142e5ecccfde3b8ffc2a17a94c6999c7d21d3e3d81d18e3c";
const EXPECTED_HISTORICAL_CHECKSUMS = {
  "pilot-spec.json": "110a8b93e00f668bcf8a25918f03a8b08b94533a019fa9814f9e517c9a1f89dc",
  "poses.jsonl": "3a9dc8f3e9348441e183d348354dd880d744aae6acef6291b709899dd3d852ef",
  "source-manifest.json": "d8f270e544901980782c37d8fee45c845abc24e414e136878167587f1d9b2176",
  "summary.json": "57e6d08e82f3b450bc4ceb682af2a1376af3a370fce717c8d6666ebb2638c0f9",
  "summary.md": "2843d3a101bf4aec6b93c544e6d828a81c0753b9ed177c0c1d01517c667e5a0d",
  "targets.jsonl": "38c32bbcadf4a7dbcd9a3c58b6e89c0a3bda0194fda4f13234c20a3ba3edc5d5",
};
const IMPLEMENTATION_FILES = [
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
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function readJsonl(filename) {
  const text = await readFile(filename, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function parseChecksumFile(text) {
  const entries = new Map();
  for (const line of text.trim().split("\n")) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `Malformed checksum line: ${line}`);
    assert.equal(entries.has(match[2]), false, `Duplicate checksum entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function verifyHistoricalArtifact() {
  const checksumBytes = await readFile(HISTORICAL_CHECKSUM_PATH);
  assert.equal(
    sha256(checksumBytes),
    EXPECTED_HISTORICAL_CHECKSUM_FILE_SHA256,
    "Historical checksum manifest changed",
  );
  const entries = parseChecksumFile(checksumBytes.toString("utf8"));
  assert.deepEqual(
    [...entries.keys()].sort(codeUnitCompare),
    [...EXPECTED_HISTORICAL_FILES].sort(codeUnitCompare),
    "Historical artifact file set changed",
  );
  assert.deepEqual(
    Object.fromEntries([...entries].sort(([left], [right]) => codeUnitCompare(left, right))),
    EXPECTED_HISTORICAL_CHECKSUMS,
    "Historical v0.4 checksums changed",
  );
  for (const [filename, expected] of entries) {
    const bytes = await readFile(path.join(HISTORICAL_DIRECTORY, filename));
    assert.equal(sha256(bytes), expected, `Historical artifact changed: ${filename}`);
  }
  return {
    checksumFileSha256: sha256(checksumBytes),
    files: Object.fromEntries([...entries].sort(([left], [right]) => codeUnitCompare(left, right))),
  };
}

function committedFileBytes(sourceCommit, relative) {
  return execFileSync("git", ["show", `${sourceCommit}:${relative}`], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function implementationDigest(sourceCommit) {
  const combined = createHash("sha256");
  const files = {};
  for (const relative of IMPLEMENTATION_FILES) {
    const bytes = committedFileBytes(sourceCommit, relative);
    const digest = sha256(bytes);
    files[relative] = digest;
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }
  return { combinedSha256: combined.digest("hex"), files };
}

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizedAudit(audit) {
  const copy = structuredClone(audit);
  delete copy.softwareVersion;
  return copy;
}

function normalizedPoseRecord(pose) {
  const copy = structuredClone(pose);
  delete copy.softwareVersion;
  delete copy.implementationSha256;
  delete copy.nodeVersion;
  copy.audit = normalizedAudit(copy.audit);
  return copy;
}

function normalizedTargetRecord(target) {
  const copy = structuredClone(target);
  delete copy.retrievedAt;
  copy.nativeAudit = normalizedAudit(copy.nativeAudit);
  copy.controls.farTranslation.audit = normalizedAudit(
    copy.controls.farTranslation.audit,
  );
  delete copy.controls.nativeSelf.auditReproduction.sourceAuditSha256;
  delete copy.controls.nativeSelf.auditReproduction.canonicalAuditSha256;
  return copy;
}

function comparePose(expected, observed) {
  const normalizedObserved = normalizedPoseRecord(observed);
  const normalizedExpected = normalizedPoseRecord(expected);
  const auditComparison = compareAuditWithSasaTolerance(
    normalizedExpected.audit,
    normalizedObserved.audit,
    `${expected.poseId} audit`,
  );
  delete normalizedObserved.audit;
  delete normalizedExpected.audit;
  assert.deepEqual(
    normalizedObserved,
    normalizedExpected,
    `${expected.poseId}: normalized non-audit pose ledger changed`,
  );
  return {
    schemaVersion: "1.0.0",
    replayId: REPLAY_ID,
    poseId: expected.poseId,
    targetId: expected.targetId,
    generatedCoordinate: {
      bytes: observed.generatedCoordinateBytes,
      sha256: observed.generatedCoordinateSha256,
      exactMatch: true,
    },
    audit: auditComparison,
    dockq: { exactMatch: true, value: observed.dockq.DockQ },
    capriClass: { exactMatch: true, value: observed.capriClass },
  };
}

function compareTarget(expected, observed) {
  const normalizedObserved = normalizedTargetRecord(observed);
  const normalizedExpected = normalizedTargetRecord(expected);
  const nativeAuditComparison = compareAuditWithSasaTolerance(
    normalizedExpected.nativeAudit,
    normalizedObserved.nativeAudit,
    `${expected.targetId} native audit`,
  );
  const farTranslationAuditComparison = compareAuditWithSasaTolerance(
    normalizedExpected.controls.farTranslation.audit,
    normalizedObserved.controls.farTranslation.audit,
    `${expected.targetId} far-translation audit`,
  );
  delete normalizedObserved.nativeAudit;
  delete normalizedExpected.nativeAudit;
  delete normalizedObserved.controls.farTranslation.audit;
  delete normalizedExpected.controls.farTranslation.audit;
  assert.deepEqual(
    normalizedObserved,
    normalizedExpected,
    `${expected.targetId}: normalized non-audit target/control ledger changed`,
  );

  return {
    targetId: expected.targetId,
    nativeSelfPassed: true,
    farTranslationPassed: true,
    nativeAudit: nativeAuditComparison,
    farTranslationAudit: farTranslationAuditComparison,
  };
}

function maximumAuditDifference(records, field) {
  return Math.max(...records.map((record) => record[field].absoluteDifference));
}

function compareAggregates(expected, observed) {
  assert.deepEqual(observed.poseAccounting, expected.poseAccounting);
  assert.deepEqual(observed.primaryAnalysis, expected.primaryAnalysis);
  assert.deepEqual(observed.sensitivityAnalysis, expected.sensitivityAnalysis);
  assert.deepEqual(observed.bootstrap, expected.bootstrap);
  assert.deepEqual(observed.methodClarifications, expected.methodClarifications);
  assert.deepEqual(observed.controls.crossChecks, expected.controls.crossChecks);
  assert.equal(observed.controls.nativeSelfPassed, expected.controls.nativeSelfPassed);
  assert.equal(observed.controls.farTranslationPassed, expected.controls.farTranslationPassed);
  assert.equal(observed.controls.cliCrossChecksRun, expected.controls.cliCrossChecksRun);
  assert.equal(observed.controls.cliCrossChecksPassed, expected.controls.cliCrossChecksPassed);
  assert.equal(
    observed.controls.maximumCliAbsoluteDifference,
    expected.controls.maximumCliAbsoluteDifference,
  );
}

function assertNodeRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(
    major > 22 || (major === 22 && minor >= 18),
    `Node >=22.18.0 is required; received ${process.versions.node}`,
  );
}

function patchHistoricalRunner(source, generatedArtifactDirectory) {
  const originalDirectoryLine =
    'const ARTIFACT_DIRECTORY = path.join(ROOT, "validation", "dockq-development-pilot-v1");';
  assert.ok(source.includes(originalDirectoryLine), "Historical runner artifact-directory declaration changed");
  let patched = source.replace(
    originalDirectoryLine,
    [
      'const BASELINE_ARTIFACT_DIRECTORY = path.join(ROOT, "validation", "dockq-development-pilot-v1");',
      `const ARTIFACT_DIRECTORY = ${JSON.stringify(generatedArtifactDirectory)};`,
    ].join("\n"),
  );
  patched = patched.replace(
    "const SPEC_PATH = path.join(ARTIFACT_DIRECTORY, \"pilot-spec.json\");",
    "const SPEC_PATH = path.join(BASELINE_ARTIFACT_DIRECTORY, \"pilot-spec.json\");",
  );
  patched = patched.replace(
    "const SOURCE_MANIFEST_PATH = path.join(ARTIFACT_DIRECTORY, \"source-manifest.json\");",
    "const SOURCE_MANIFEST_PATH = path.join(BASELINE_ARTIFACT_DIRECTORY, \"source-manifest.json\");",
  );
  const versionPattern = /assert\.equal\(CONFOVHH_VERSION, "0\.[45]\.0"\);/;
  assert.ok(versionPattern.test(patched), "Historical runner version assertion changed");
  patched = patched.replace(
    versionPattern,
    'assert.equal(CONFOVHH_VERSION, "0.5.0");',
  );
  return patched;
}

async function runIsolatedReplay(temporaryRoot, sourceCommit) {
  const worktree = path.join(temporaryRoot, "worktree");
  execFileSync("git", ["worktree", "add", "--detach", worktree, sourceCommit], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 120_000,
  });
  const generatedArtifactDirectory = path.join(
    worktree,
    "validation",
    ".dockq-v05-replay-generated",
  );
  try {
    await symlink(path.join(ROOT, "node_modules"), path.join(worktree, "node_modules"), "dir");
    await symlink(path.join(ROOT, ".bench-venv"), path.join(worktree, ".bench-venv"), "dir");
    const runnerPath = path.join(worktree, "scripts", "run-dockq-development-pilot.mjs");
    const runnerSource = await readFile(runnerPath, "utf8");
    await writeFile(
      runnerPath,
      patchHistoricalRunner(runnerSource, generatedArtifactDirectory),
      "utf8",
    );
    execFileSync(process.execPath, [runnerPath], {
      cwd: worktree,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 30 * 60_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return {
      poses: await readJsonl(path.join(generatedArtifactDirectory, "poses.jsonl")),
      targets: await readJsonl(path.join(generatedArtifactDirectory, "targets.jsonl")),
      summary: await readJson(path.join(generatedArtifactDirectory, "summary.json")),
    };
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 120_000,
    });
  }
}

async function main() {
  assertNodeRuntime();
  assert.equal(
    OUTPUT_DIRECTORY,
    path.join(ROOT, "validation", "dockq-v0.5-regression-replay-v1"),
    "Refusing to write an unexpected replay destination",
  );
  assert.equal(
    await pathExists(OUTPUT_DIRECTORY),
    false,
    "Refusing to overwrite an existing v0.5 replay artifact",
  );

  const packageRecord = await readJson(path.join(ROOT, "package.json"));
  assert.equal(packageRecord.version, "0.5.0");
  assert.equal(packageRecord.engines.node, ">=22.18.0");

  const statusAtStart = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  assert.equal(
    statusAtStart,
    "",
    "The v0.5 replay must start from a clean, committed source tree",
  );
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);

  const runStartedAt = new Date().toISOString();
  const historicalBefore = await verifyHistoricalArtifact();
  const implementation = await implementationDigest(sourceCommit);
  const historicalPoses = await readJsonl(path.join(HISTORICAL_DIRECTORY, "poses.jsonl"));
  const historicalTargets = await readJsonl(path.join(HISTORICAL_DIRECTORY, "targets.jsonl"));
  const historicalSummary = await readJson(path.join(HISTORICAL_DIRECTORY, "summary.json"));
  assert.equal(historicalPoses.length, 360);
  assert.equal(historicalTargets.length, 5);

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "confovhh-v05-replay-"));
  try {
    const observed = await runIsolatedReplay(temporaryRoot, sourceCommit);
    assert.equal(observed.poses.length, historicalPoses.length);
    assert.equal(observed.targets.length, historicalTargets.length);

    const observedPoses = new Map(observed.poses.map((pose) => [pose.poseId, pose]));
    assert.equal(observedPoses.size, observed.poses.length);
    const comparisons = historicalPoses.map((expected) => {
      const current = observedPoses.get(expected.poseId);
      assert.ok(current, `Missing replay pose: ${expected.poseId}`);
      return comparePose(expected, current);
    });

    const observedTargets = new Map(observed.targets.map((target) => [target.targetId, target]));
    assert.equal(observedTargets.size, observed.targets.length);
    const targetControls = historicalTargets.map((expected) => {
      const current = observedTargets.get(expected.targetId);
      assert.ok(current, `Missing replay target: ${expected.targetId}`);
      return compareTarget(expected, current);
    });
    compareAggregates(historicalSummary, observed.summary);

    const historicalAfter = await verifyHistoricalArtifact();
    assert.deepEqual(
      historicalAfter,
      historicalBefore,
      "Historical v0.4 artifact changed during the v0.5 replay",
    );

    const controlsAndCrossChecks =
      targetControls.length * 2 + observed.summary.controls.cliCrossChecksRun;
    const controlsAndCrossChecksPassed =
      targetControls.filter((entry) => entry.nativeSelfPassed).length +
      targetControls.filter((entry) => entry.farTranslationPassed).length +
      observed.summary.controls.cliCrossChecksPassed;
    assert.equal(controlsAndCrossChecks, 20);
    assert.equal(controlsAndCrossChecksPassed, 20);

    const replaySummary = {
      schemaVersion: "1.0.0",
      replayId: REPLAY_ID,
      title: "ConfoVHH v0.5 post-label DockQ regression replay",
      status: "executed-post-label-regression-only",
      dataRole: "regression",
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      relationshipToHistoricalStudy: {
        baselineArtifact: "validation/dockq-development-pilot-v1",
        baselineStatus: "executed-development-only",
        labelsPreviouslyObserved: true,
        independentValidation: false,
        formalHoldoutEvaluation: false,
        interpretation: "Exact coordinate, non-SASA audit, DockQ, and CAPRI replay plus explicitly tolerance-bounded SASA replay detects unintended software regression on an already labeled development ledger; it contributes no new performance estimate.",
      },
      sourceAttestation: {
        gitCommit: sourceCommit,
        workingTreeDirtyAtStart: false,
        nodeVersion: process.versions.node,
        minimumNodeVersion: "22.18.0",
        implementation,
      },
      historicalArtifact: historicalBefore,
      replayAccounting: {
        targets: historicalTargets.length,
        poses: comparisons.length,
        exactCoordinateMatches: comparisons.filter(
          (entry) => entry.generatedCoordinate.exactMatch,
        ).length,
        exactNonSasaAuditMatches: comparisons.filter(
          (entry) => entry.audit.exactNonSasaMatch,
        ).length,
        sasaToleranceMatches: comparisons.filter(
          (entry) => entry.audit.sasaWithinTolerance,
        ).length,
        exactFullAuditMatches: comparisons.filter(
          (entry) => entry.audit.exactFullMatch,
        ).length,
        sasaTolerancesAngstrom2: DOCKQ_REPLAY_SASA_TOLERANCES,
        maximumDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          comparisons.map((entry) => entry.audit),
          "deltaSasaAngstrom2",
        ),
        maximumHalfDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          comparisons.map((entry) => entry.audit),
          "halfDeltaSasaInterfaceAreaAngstrom2",
        ),
        exactDockqMatches: comparisons.filter((entry) => entry.dockq.exactMatch).length,
        exactCapriClassMatches: comparisons.filter(
          (entry) => entry.capriClass.exactMatch,
        ).length,
        aggregateComparisonsPassed: true,
      },
      controls: {
        nativeSelfPassed: targetControls.filter((entry) => entry.nativeSelfPassed).length,
        farTranslationPassed: targetControls.filter((entry) => entry.farTranslationPassed).length,
        cliCrossChecksRun: observed.summary.controls.cliCrossChecksRun,
        cliCrossChecksPassed: observed.summary.controls.cliCrossChecksPassed,
        controlsAndCrossChecks,
        controlsAndCrossChecksPassed,
        targetControls,
        maximumNativeDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          targetControls.map((entry) => entry.nativeAudit),
          "deltaSasaAngstrom2",
        ),
        maximumNativeHalfDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          targetControls.map((entry) => entry.nativeAudit),
          "halfDeltaSasaInterfaceAreaAngstrom2",
        ),
        maximumFarTranslationDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          targetControls.map((entry) => entry.farTranslationAudit),
          "deltaSasaAngstrom2",
        ),
        maximumFarTranslationHalfDeltaSasaAbsoluteDifferenceAngstrom2: maximumAuditDifference(
          targetControls.map((entry) => entry.farTranslationAudit),
          "halfDeltaSasaInterfaceAreaAngstrom2",
        ),
      },
      dockqEnvironment: {
        version: observed.summary.software.dockqVersion,
        installedDistribution: observed.summary.software.installedDockqDistribution,
        pythonVersion: observed.summary.software.pythonVersion,
        pythonEnvironment: observed.summary.software.pythonEnvironment,
      },
      holdoutStatus: {
        datasetExists: false,
        assembled: false,
        labeled: false,
        frozen: false,
        opened: false,
        evaluated: false,
        statement: "No independent family-clustered hard-decoy holdout dataset exists for this release; none has been assembled, labeled, frozen, opened, or evaluated.",
      },
      claimFlags: {
        bindingValidated: false,
        affinityValidated: false,
        specificityValidated: false,
        functionalStateValidated: false,
        stateSelectivityValidated: false,
        sameVhhCrossContextValidated: false,
        membraneCompatibilityValidated: false,
        formalHoldoutEvaluated: false,
        hardDecoyProtocolCompleted: false,
        nearNativeRankingValidated: false,
        preliminaryNearNativeClaimAllowed: false,
      },
      limitations: [
        "All DockQ labels and aggregate results were observed in the earlier development-only study before v0.5 was implemented.",
        "The replay requires exact coordinates, normalized non-SASA audit fields, DockQ records, and CAPRI classes; ΔSASA and half-ΔSASA are accepted only within their explicit 1e-9 Å² and 5e-10 Å² floating tolerances.",
        "This bounded replay is a software-regression result, not a second experiment or an independent validation set.",
        "The five native-derived targets do not cover realistic wrong-patch docking, flexible decoys, nonbinders, unseen receptor families, or unseen VHH lineages.",
        "DockQ similarity to a deposited complex does not establish binding, affinity, specificity, function, state selectivity, membrane compatibility, or physiological validity.",
        "No independent family-clustered hard-decoy holdout dataset exists for this release; none has been assembled, labeled, frozen, opened, or evaluated."
      ],
    };

    assert.equal(replaySummary.replayAccounting.exactCoordinateMatches, 360);
    assert.equal(replaySummary.replayAccounting.exactNonSasaAuditMatches, 360);
    assert.equal(replaySummary.replayAccounting.sasaToleranceMatches, 360);
    assert.equal(replaySummary.replayAccounting.exactDockqMatches, 360);
    assert.equal(replaySummary.replayAccounting.exactCapriClassMatches, 360);

    const statusBeforePublish = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    const headBeforePublish = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    assert.equal(
      statusBeforePublish,
      "",
      "The source checkout changed during replay; refusing to publish an ambiguous attestation",
    );
    assert.equal(
      headBeforePublish,
      sourceCommit,
      "The source commit changed during replay; refusing to publish an ambiguous attestation",
    );
    assert.equal(
      await pathExists(OUTPUT_DIRECTORY),
      false,
      "Refusing to overwrite an existing v0.5 replay artifact",
    );

    const comparisonOutput = `${comparisons.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const summaryOutput = `${JSON.stringify(replaySummary, null, 2)}\n`;
    const checksumOutput = [
      `${sha256(comparisonOutput)}  comparisons.jsonl`,
      `${sha256(summaryOutput)}  summary.json`,
    ].join("\n") + "\n";
    const stagingDirectory = await mkdtemp(
      path.join(ROOT, "validation", ".dockq-v05-replay-staging-"),
    );
    let published = false;
    try {
      await writeFile(path.join(stagingDirectory, "comparisons.jsonl"), comparisonOutput, "utf8");
      await writeFile(path.join(stagingDirectory, "summary.json"), summaryOutput, "utf8");
      await writeFile(path.join(stagingDirectory, "checksums.sha256"), checksumOutput, "utf8");
      assert.equal(
        sha256(await readFile(path.join(stagingDirectory, "comparisons.jsonl"))),
        sha256(comparisonOutput),
      );
      assert.equal(
        sha256(await readFile(path.join(stagingDirectory, "summary.json"))),
        sha256(summaryOutput),
      );
      assert.equal(await pathExists(OUTPUT_DIRECTORY), false);
      await rename(stagingDirectory, OUTPUT_DIRECTORY);
      published = true;
    } finally {
      if (!published) await rm(stagingDirectory, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
      replayId: replaySummary.replayId,
      status: replaySummary.status,
      sourceCommit,
      workingTreeDirtyAtStart: false,
      replayAccounting: replaySummary.replayAccounting,
      controls: {
        controlsAndCrossChecks,
        controlsAndCrossChecksPassed,
      },
      claimFlags: replaySummary.claimFlags,
    }, null, 2));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
