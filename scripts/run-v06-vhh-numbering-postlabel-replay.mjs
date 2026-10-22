import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEVELOPMENT_DIRECTORY = path.join(
  ROOT,
  "validation",
  "dockq-development-pilot-v1",
);
const CANDIDATE_DIRECTORY = path.join(
  ROOT,
  "validation",
  "v0.6-vhh-numbering-candidate-v1",
);
const DEFAULT_OUTPUT_PATH = path.join(
  CANDIDATE_DIRECTORY,
  "postlabel-replay.json",
);

const SOURCE_PATHS = Object.freeze({
  checksumManifest: path.join(DEVELOPMENT_DIRECTORY, "checksums.sha256"),
  targets: path.join(DEVELOPMENT_DIRECTORY, "targets.jsonl"),
  poses: path.join(DEVELOPMENT_DIRECTORY, "poses.jsonl"),
  summary: path.join(DEVELOPMENT_DIRECTORY, "summary.json"),
  publicDifferential: path.join(CANDIDATE_DIRECTORY, "public-panel-differential.json"),
  replayPlan: path.join(CANDIDATE_DIRECTORY, "postlabel-replay-plan.json"),
  candidateImplementation: path.join(ROOT, "lib", "vhh-numbering-v06.ts"),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonLines(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `${label}:${index + 1}: ${error instanceof Error ? error.message : "invalid JSON"}`,
        );
      }
    });
}

function parseChecksumManifest(text) {
  const checksums = new Map();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match, `checksums.sha256:${index + 1}: malformed checksum row`);
    assert.ok(!checksums.has(match[2]), `Duplicate checksum path ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function parseOutputPath(argv) {
  const index = argv.indexOf("--output");
  if (index === -1) return DEFAULT_OUTPUT_PATH;
  assert.ok(argv[index + 1], "--output requires a path");
  const resolved = path.resolve(ROOT, argv[index + 1]);
  const containment = path.relative(ROOT, resolved);
  assert.ok(
    containment &&
      containment !== ".." &&
      !containment.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(containment),
    "Output path must remain inside the repository",
  );
  return resolved;
}

function publicRecordKey(pdb, receptorChain, vhhChain) {
  return `${pdb}:${receptorChain}:${vhhChain}`;
}

function sortedObject(entries) {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function readVerifiedDevelopmentInputs() {
  const manifestBytes = await readFile(SOURCE_PATHS.checksumManifest);
  const manifest = parseChecksumManifest(manifestBytes.toString("utf8"));
  const required = ["targets.jsonl", "poses.jsonl", "summary.json"];
  const verified = {};

  for (const filename of required) {
    const expected = manifest.get(filename);
    assert.match(expected ?? "", /^[a-f0-9]{64}$/u, `Missing checksum for ${filename}`);
    const bytes = await readFile(path.join(DEVELOPMENT_DIRECTORY, filename));
    const observed = sha256(bytes);
    assert.equal(observed, expected, `${filename}: frozen checksum mismatch`);
    verified[filename] = { bytes, sha256: observed };
  }

  return {
    manifestBytes,
    verified,
    targets: parseJsonLines(
      verified["targets.jsonl"].bytes.toString("utf8"),
      "targets.jsonl",
    ),
    poses: parseJsonLines(
      verified["poses.jsonl"].bytes.toString("utf8"),
      "poses.jsonl",
    ),
    summary: JSON.parse(verified["summary.json"].bytes.toString("utf8")),
  };
}

async function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const development = await readVerifiedDevelopmentInputs();
  const publicDifferentialBytes = await readFile(SOURCE_PATHS.publicDifferential);
  const replayPlanBytes = await readFile(SOURCE_PATHS.replayPlan);
  const candidateImplementationBytes = await readFile(SOURCE_PATHS.candidateImplementation);
  const publicDifferential = JSON.parse(publicDifferentialBytes.toString("utf8"));
  const replayPlan = JSON.parse(replayPlanBytes.toString("utf8"));

  assert.equal(development.summary.dataRole, "development");
  assert.equal(development.summary.status, "executed-development-only");
  assert.equal(
    replayPlan.status,
    "PREREGISTERED_AFTER_CANDIDATE_FREEZE_BEFORE_REPLAY_EXECUTION",
  );
  assert.equal(replayPlan.candidate.version, "0.6.0-candidate.1");
  assert.equal(replayPlan.candidate.candidateRulesMayChangeAfterReplay, false);
  assert.equal(
    publicDifferential.status,
    "EXECUTED_PUBLIC_DEVELOPMENT_DIFFERENTIAL_NOT_PRODUCTION_VALIDATION",
  );
  assert.equal(publicDifferential.candidateVersion, replayPlan.candidate.version);
  assert.equal(publicDifferential.accounting.coordinateGeometryRegressions, 0);

  const publicRecords = new Map();
  for (const record of publicDifferential.records) {
    const [receptorChain, vhhChain] = record.pair.split(":");
    const key = publicRecordKey(record.pdb, receptorChain, vhhChain);
    assert.ok(!publicRecords.has(key), `Duplicate public differential record ${key}`);
    publicRecords.set(key, record);
  }

  const targetInvariants = new Map();
  for (const target of development.targets) {
    assert.equal(target.dataRole, "development");
    assert.equal(target.developmentReuse, true);
    const receptorChain = target.originalChainMapping?.receptor;
    const vhhChain = target.originalChainMapping?.vhh;
    assert.ok(receptorChain && vhhChain, `${target.targetId}: missing original chain mapping`);
    const key = publicRecordKey(target.pdb, receptorChain, vhhChain);
    const publicRecord = publicRecords.get(key);
    assert.ok(publicRecord, `${target.targetId}: absent from public differential`);
    assert.equal(publicRecord.pair, `${receptorChain}:${vhhChain}`);
    assert.equal(
      publicRecord.vhhSequenceSha256,
      target.vhhSequenceSha256,
      `${target.targetId}: VHH sequence mismatch`,
    );
    assert.equal(publicRecord.differences.statusChanged, false);
    assert.equal(publicRecord.differences.queryBoundsChanged, false);
    assert.equal(publicRecord.differences.cdrLengthsChanged, false);
    assert.equal(publicRecord.differences.regionAssignmentsChanged, false);
    assert.equal(publicRecord.differences.paratopeProxyShareChanged, false);
    assert.equal(publicRecord.differences.cdr3ProxyShareChanged, false);
    assert.equal(publicRecord.differences.changedContactPairCount, 0);
    assert.equal(publicRecord.candidate.status, "numbered");
    assert.equal(publicRecord.candidate.completeImgtRegionCoverage, true);
    assert.equal(publicRecord.candidate.numberingSegmentationAgreement, true);

    assert.ok(!targetInvariants.has(target.targetId), `Duplicate target ${target.targetId}`);
    targetInvariants.set(target.targetId, {
      targetId: target.targetId,
      pdb: target.pdb,
      pair: publicRecord.pair,
      vhhSequenceSha256: target.vhhSequenceSha256,
      legacyEngine: publicRecord.legacy.engine,
      candidateEngine: publicRecord.candidate.engine,
      statusChanged: false,
      queryBoundsChanged: false,
      cdrLengthsChanged: false,
      regionAssignmentsChanged: false,
    });
  }

  assert.equal(targetInvariants.size, development.targets.length);

  // Establish all sequence/region invariants before examining DockQ or CAPRI labels.
  const poseInferences = [];
  for (const pose of development.poses) {
    assert.equal(pose.dataRole, "development");
    assert.equal(pose.eligibility, "retained");
    assert.equal(
      pose.transform?.convention,
      "active x'=R(x-pivot)+pivot+translation",
      `${pose.poseId}: unexpected transform convention`,
    );
    const target = targetInvariants.get(pose.targetId);
    assert.ok(target, `${pose.poseId}: unknown target ${pose.targetId}`);
    assert.equal(
      pose.audit?.imgtNumberingStatus,
      "numbered",
      `${pose.poseId}: legacy numbering status drift`,
    );
    assert.equal(
      pose.audit?.imgtNumberingEngine,
      target.legacyEngine,
      `${pose.poseId}: legacy numbering engine drift`,
    );

    const cdrContactShare = pose.audit?.cdrContactShare ?? null;
    const cdr3ContactShare = pose.audit?.cdr3ContactShare ?? null;
    assert.ok(
      cdrContactShare == null ||
        (Number.isFinite(cdrContactShare) && cdrContactShare >= 0 && cdrContactShare <= 1),
      `${pose.poseId}: invalid CDR contact share`,
    );
    assert.ok(
      cdr3ContactShare == null ||
        (Number.isFinite(cdr3ContactShare) && cdr3ContactShare >= 0 && cdr3ContactShare <= 1),
      `${pose.poseId}: invalid CDR3 contact share`,
    );

    poseInferences.push({
      poseId: pose.poseId,
      targetId: pose.targetId,
      legacyEngine: target.legacyEngine,
      candidateEngine: target.candidateEngine,
      numberingStatusChanged: false,
      cdrContactShareChanged: false,
      cdr3ContactShareChanged: false,
      evidenceBandChanged: false,
      cdrDependentRankingInputChanged: false,
    });
  }

  assert.equal(poseInferences.length, development.poses.length);
  const inferenceByPose = new Map(
    poseInferences.map((inference) => [inference.poseId, inference]),
  );
  assert.equal(inferenceByPose.size, poseInferences.length);

  // DockQ/CAPRI labels are read only after the candidate and all equality inferences are fixed.
  const byCapriClass = new Map();
  const byTarget = new Map();
  for (const pose of development.poses) {
    const inference = inferenceByPose.get(pose.poseId);
    assert.ok(inference, `${pose.poseId}: missing frozen inference`);
    assert.ok(Number.isFinite(pose.dockq?.DockQ), `${pose.poseId}: missing DockQ label`);
    assert.ok(
      ["high", "medium", "acceptable", "incorrect"].includes(pose.capriClass),
      `${pose.poseId}: unrecognized CAPRI class`,
    );

    const capri = byCapriClass.get(pose.capriClass) ?? {
      poses: 0,
      numberingStatusChanges: 0,
      engineProvenanceChanges: 0,
      cdrContactShareChanges: 0,
      cdr3ContactShareChanges: 0,
      evidenceBandChanges: 0,
      cdrDependentRankingInputChanges: 0,
    };
    capri.poses += 1;
    capri.engineProvenanceChanges +=
      inference.legacyEngine === inference.candidateEngine ? 0 : 1;
    byCapriClass.set(pose.capriClass, capri);

    const target = byTarget.get(pose.targetId) ?? {
      poses: 0,
      high: 0,
      medium: 0,
      acceptable: 0,
      incorrect: 0,
      numberingStatusChanges: 0,
      engineProvenanceChanges: 0,
      cdrContactShareChanges: 0,
      cdr3ContactShareChanges: 0,
      evidenceBandChanges: 0,
      cdrDependentRankingInputChanges: 0,
    };
    target.poses += 1;
    target[pose.capriClass] += 1;
    target.engineProvenanceChanges +=
      inference.legacyEngine === inference.candidateEngine ? 0 : 1;
    byTarget.set(pose.targetId, target);
  }

  const output = {
    schemaVersion: "1.0.0",
    studyId: replayPlan.studyId,
    status: "EXECUTED_POSTLABEL_DEVELOPMENT_REPLAY_NOT_HOLDOUT",
    candidateVersion: replayPlan.candidate.version,
    sourceIntegrity: {
      checksumManifest: {
        path: "validation/dockq-development-pilot-v1/checksums.sha256",
        sha256: sha256(development.manifestBytes),
      },
      targets: {
        path: "validation/dockq-development-pilot-v1/targets.jsonl",
        sha256: development.verified["targets.jsonl"].sha256,
      },
      poses: {
        path: "validation/dockq-development-pilot-v1/poses.jsonl",
        sha256: development.verified["poses.jsonl"].sha256,
      },
      summary: {
        path: "validation/dockq-development-pilot-v1/summary.json",
        sha256: development.verified["summary.json"].sha256,
      },
      publicDifferential: {
        path: "validation/v0.6-vhh-numbering-candidate-v1/public-panel-differential.json",
        sha256: sha256(publicDifferentialBytes),
      },
      replayPlan: {
        path: "validation/v0.6-vhh-numbering-candidate-v1/postlabel-replay-plan.json",
        sha256: sha256(replayPlanBytes),
      },
      candidateImplementation: {
        path: "lib/vhh-numbering-v06.ts",
        sha256: sha256(candidateImplementationBytes),
      },
      allFrozenDevelopmentChecksumsVerified: true,
    },
    inferenceBasis: {
      allDevelopmentTargetsMatchedToPublicDifferential: true,
      allVhhSequenceSha256ValuesMatched: true,
      allTargetNumberingStatusesUnchanged: true,
      allTargetQueryBoundsUnchanged: true,
      allTargetCdrLengthsUnchanged: true,
      allTargetRegionAssignmentsUnchanged: true,
      poseGenerationIsRigidBodyOnly: true,
      residueIdentityAndOrderAreInvariantUnderPoseGeneration: true,
      dockqAndCapriLabelsReadOnlyAfterEqualityInference: true,
    },
    accounting: {
      targets: development.targets.length,
      poses: development.poses.length,
      targetNumberingStatusChanges: 0,
      targetRegionAssignmentChanges: 0,
      poseNumberingStatusChanges: 0,
      poseEngineProvenanceChanges: poseInferences.filter(
        (inference) => inference.legacyEngine !== inference.candidateEngine,
      ).length,
      cdrContactShareChanges: 0,
      cdr3ContactShareChanges: 0,
      evidenceBandChanges: 0,
      cdrDependentRankingInputChanges: 0,
    },
    byCapriClass: sortedObject(byCapriClass.entries()),
    byTarget: sortedObject(byTarget.entries()),
    targetInvariants: [...targetInvariants.values()].sort((left, right) =>
      left.targetId.localeCompare(right.targetId)),
    integrity: {
      dataRole: "previously-observed-development-ledger",
      candidateFrozenBeforeReplay: true,
      candidateModifiedAfterDockqLabels: false,
      historicalArtifactsModified: false,
      usesPreviouslyObservedDockqLabels: true,
      usesDockqLabelsForTuning: false,
      usesNativeHoldoutCoordinates: false,
      usesNativeHoldoutRelativePoses: false,
      usesNativeHoldoutEpitopes: false,
      constitutesIndependentHoldoutEvidence: false,
      productionIntegrated: false,
    },
    claimFlags: {
      improvesBindingPrediction: false,
      improvesAffinityPrediction: false,
      improvesPoseCorrectnessPrediction: false,
      improvesCandidateRanking: false,
      establishesGeneralization: false,
      establishesExperimentalBinding: false,
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output.accounting, null, 2));
  console.log(JSON.stringify(output.byCapriClass, null, 2));
}

await main();
