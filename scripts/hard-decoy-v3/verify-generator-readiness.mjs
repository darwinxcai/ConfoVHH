#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const READINESS_RELATIVE = "validation/hard-decoy-holdout-v3/generator-readiness-2026-09-04/readiness.json";
const CHECKSUMS_RELATIVE = "validation/hard-decoy-holdout-v3/generator-readiness-2026-09-04/checksums.sha256";
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const OCI_SHA256 = /^sha256:[a-f0-9]{64}$/u;

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRegularFile(filename, maximumBytes = 64 * 1024 * 1024) {
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${filename} must be one direct regular file.`);
  ok(info.size <= BigInt(maximumBytes), `${filename} exceeds its verification byte cap.`);
  const bytes = await readFile(filename);
  ok(bytes.byteLength <= maximumBytes, `${filename} changed beyond its verification byte cap.`);
  return bytes;
}

async function requireDigest(root, record) {
  ok(record && typeof record.path === "string" && SHA256.test(record.sha256), "Invalid bound-file record.");
  ok(!path.isAbsolute(record.path) && record.path.split("/").every((part) => part && part !== "." && part !== ".."), `Unsafe path: ${record.path}`);
  const filename = path.join(root, record.path);
  ok(await realpath(filename) === path.resolve(filename), `Bound path cannot traverse a symlink: ${record.path}`);
  const bytes = await readRegularFile(filename);
  ok(sha256(bytes) === record.sha256, `Digest mismatch: ${record.path}`);
  return bytes;
}

function allFalse(record, fields, label) {
  for (const field of fields) ok(record[field] === false, `${label} must remain false: ${field}`);
}

export function validateGeneratorReadiness(readiness, { generatorContracts, receptorManifest, receptorSummary }) {
  ok(readiness.schemaVersion === "1.0.0" && readiness.studyId === "confovhh-hard-decoy-holdout-v3", "Generator-readiness identity drifted.");
  ok(readiness.status === "BLOCKED_BEFORE_TARGET_FREEZE_AND_MSA_RETRIEVAL", "Generator readiness must remain blocked.");

  ok(readiness.completedCheckpoint.canonicalReceptorTmPregraphComplete === true, "Completed receptor TM pregraph was lost.");
  ok(readiness.completedCheckpoint.canonicalReceptorTmPregraphMustNotBeRegenerated === true, "The completed receptor TM pregraph must not be regenerated.");
  ok(readiness.completedCheckpoint.totalNodes === 304 && readiness.completedCheckpoint.allUnorderedReceptorPairs === 46056, "Recovered receptor pregraph accounting drifted.");
  ok(readiness.completedCheckpoint.resolvedCanonicalTmProfiles === 282 && readiness.completedCheckpoint.failClosedCanonicalTmProfiles === 22, "Recovered receptor mapping accounting drifted.");
  ok(receptorManifest.status === "RECEPTOR_TM_PREGRAPH_COMPLETED_BLOCKED_PENDING_REMAINING_PRELABEL_ADJUDICATION", "Receptor pregraph status drifted.");
  ok(receptorSummary.totalNodeCount === readiness.completedCheckpoint.totalNodes && receptorSummary.pairSpace.allUnorderedPairs === readiness.completedCheckpoint.allUnorderedReceptorPairs, "Readiness disagrees with the receptor pregraph.");
  allFalse(readiness.completedCheckpoint, ["nativeHoldoutCoordinatesAccessed", "dockqLabelsAccessed", "performanceResultsAccessed"], "Recovered label boundary");

  allFalse(readiness.targetState, ["exactTargetManifestFrozen", "dispositionLedgerComplete", "broaderCandidateDiscoveryComplete", "predictionGenerationAuthorized"], "Target state");
  ok(readiness.targetState.formallyClearedIndependentGroups === 0 && readiness.targetState.requiredIndependentGroups === 10, "Independent-group gate drifted.");
  ok(readiness.targetState.pendingDispositionRows === 272, "Pending disposition count drifted.");

  const msa = readiness.msaPreparation;
  ok(msa.status === "BLOCKED_UNTIL_EXACT_TARGET_MANIFEST_AND_RETRIEVAL_CONTRACT" && msa.retrievalAuthorized === false, "MSA retrieval was prematurely authorized.");
  for (const field of [
    "finalTargetManifestPath", "finalTargetManifestSha256", "pairFastaInventoryPath", "pairFastaInventorySha256",
    "uniqueSequenceInventoryPath", "uniqueSequenceInventorySha256", "retrievalServerBaseUrl", "retrievalServerDatabaseRelease",
    "retrievalServerDatabaseDigest", "requestRetryAndTimeoutContractPath", "requestRetryAndTimeoutContractSha256",
  ]) ok(msa[field] === null, `Unverified MSA field must remain null: ${field}`);
  ok(msa.historicalV2PolicyAssessment.sufficientForUnpairedMsa === true, "Unpaired-MSA policy assessment drifted.");
  ok(msa.historicalV2PolicyAssessment.sufficientForConfiguredUnpairedPairedMode === false, "The per-chain-only policy cannot authorize paired MSA retrieval.");
  ok(msa.requiredRetrievalUnits.unpaired.includes("unique frozen protein-sequence SHA-256"), "Unpaired retrieval unit is not sequence-deduplicated.");
  ok(msa.requiredRetrievalUnits.paired.includes("exact final heteromeric target"), "Paired retrieval unit is not target-specific.");
  ok(msa.fixedCurrentGeneratorOptions.colabfoldPairMode === "unpaired_paired" && msa.fixedCurrentGeneratorOptions.colabfoldPairingStrategy === "greedy", "Historical pairing options drifted.");
  ok(msa.fixedCurrentGeneratorOptions.templates === false && msa.fixedCurrentGeneratorOptions.liveRetrievalDuringFinalGeneration === false && msa.fixedCurrentGeneratorOptions.offlineReuseRequired === true, "MSA/template isolation weakened.");
  ok(msa.requiredCapturePerRequest.includes("canonicalRequestSha256") && msa.requiredCapturePerRequest.includes("rawResponseSha256") && msa.requiredCapturePerRequest.includes("normalizedA3mSha256"), "MSA request/response hashes are incomplete.");
  ok(msa.requiredFrozenOutputs.includes("request-response-ledger.jsonl") && msa.requiredFrozenOutputs.includes("colabfold-complex-a3m-inventory.json") && msa.requiredFrozenOutputs.includes("boltz-chain-csv-inventory.json"), "Generator-specific MSA outputs are incomplete.");

  const historicalMsa = generatorContracts.commonMsaPolicy;
  ok(historicalMsa.retrieval === msa.historicalV2PolicyAssessment.policy, "Historical MSA policy was not quoted exactly.");
  const historicalColabfold = generatorContracts.generators.find((generator) => generator.id === "colabfold-1.6.2-afmultimer-v3");
  const historicalBoltz = generatorContracts.generators.find((generator) => generator.id === "boltz-2.2.1");
  ok(historicalColabfold, "Pinned ColabFold generator is missing.");
  ok(historicalBoltz, "Pinned Boltz generator is missing.");

  const colabfold = readiness.generatorAssets.colabfold;
  ok(OCI_SHA256.test(colabfold.containerIndexDigest) && OCI_SHA256.test(colabfold.containerLinuxAmd64ManifestDigest), "ColabFold OCI digests are invalid.");
  ok(historicalColabfold.container.indexDigest === colabfold.containerIndexDigest
    && historicalColabfold.container.linuxAmd64ManifestDigest === colabfold.containerLinuxAmd64ManifestDigest,
  "Recovered ColabFold OCI digests disagree with the historical contract.");
  ok(colabfold.parameterArchiveSha256 === null && colabfold.extractedParameterInventorySha256 === null, "Unverified AlphaFold parameter hashes must remain unresolved.");
  ok(colabfold.status === "BLOCKED_PENDING_PARAMETER_ARCHIVE_AND_EXTRACTED_FILE_HASHES", "ColabFold parameter blocker was lost.");

  const boltz = readiness.generatorAssets.boltz;
  ok(SHA256.test(boltz.wheelSha256) && SHA256.test(boltz.checkpointSha256), "Boltz artifact digest is invalid.");
  ok(historicalBoltz.pythonArtifact.sha256 === boltz.wheelSha256
    && historicalBoltz.checkpoint.huggingFaceLfsSha256 === boltz.checkpointSha256,
  "Recovered Boltz artifact digests disagree with the historical contract.");
  ok(boltz.environmentImageDigest === null && boltz.resolvedDependencyLockSha256 === null, "Unverified Boltz environment hashes must remain unresolved.");
  ok(boltz.status === "BLOCKED_PENDING_IMMUTABLE_ENVIRONMENT_IMAGE_AND_DEPENDENCY_LOCK", "Boltz environment blocker was lost.");

  ok(GIT_SHA.test(msa.colabfoldImplementationEvidence.gitCommit), "Invalid ColabFold source commit.");
  for (const field of ["batchPySha256", "mmseqsApiPySha256", "downloadPySha256"]) {
    ok(SHA256.test(msa.colabfoldImplementationEvidence[field]), `Invalid ColabFold implementation digest: ${field}`);
  }
  ok(GIT_SHA.test(msa.boltzImplementationEvidence.gitCommit), "Invalid Boltz source commit.");
  for (const field of ["mainPySha256", "mmseqsApiPySha256"]) {
    ok(SHA256.test(msa.boltzImplementationEvidence[field]), `Invalid Boltz implementation digest: ${field}`);
  }

  ok(readiness.activeExecution.githubActionsInProgress === 0 && readiness.activeExecution.githubActionsQueued === 0 && readiness.activeExecution.scientificGenerationRunning === false, "Recovery artifact cannot claim active execution.");
  const requiredBlockers = [
    "exact-target-manifest-not-frozen",
    "fewer-than-ten-formally-cleared-leakage-components",
    "paired-msa-retrieval-unit-not-frozen-for-current-unpaired-paired-mode",
    "alphafold-multimer-v3-parameter-archive-and-file-hashes-unresolved",
    "boltz-2.2.1-environment-image-digest-unresolved",
  ];
  ok(requiredBlockers.every((blocker) => readiness.blockers.includes(blocker)), "One or more generator-readiness blockers are missing.");
  return readiness;
}

export async function verifyGeneratorReadiness(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const checksumBytes = await readRegularFile(path.join(root, CHECKSUMS_RELATIVE));
  const checksumRows = checksumBytes.toString("utf8").trimEnd().split("\n").map((line) => {
    const match = /^([a-f0-9]{64})  (README\.md|readiness\.json)$/u.exec(line);
    ok(match, "Generator-readiness checksum row is invalid.");
    return { sha256: match[1], relative: match[2] };
  });
  ok(checksumRows.length === 2 && new Set(checksumRows.map(({ relative }) => relative)).size === 2, "Generator-readiness checksum inventory drifted.");
  const packageDirectory = path.dirname(CHECKSUMS_RELATIVE);
  await Promise.all(checksumRows.map(({ relative, sha256: expected }) => requireDigest(root, { path: `${packageDirectory}/${relative}`, sha256: expected })));
  const readiness = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readRegularFile(path.join(root, READINESS_RELATIVE))));
  await Promise.all([
    requireDigest(root, readiness.sourceState.protocolV2),
    requireDigest(root, readiness.sourceState.protocolV3),
    requireDigest(root, readiness.sourceState.integrationState),
    requireDigest(root, readiness.sourceState.generatorContracts),
    requireDigest(root, { path: readiness.sourceState.receptorTmPregraph.checksumsPath, sha256: readiness.sourceState.receptorTmPregraph.checksumsSha256 }),
    requireDigest(root, { path: readiness.sourceState.receptorTmPregraph.manifestPath, sha256: readiness.sourceState.receptorTmPregraph.manifestSha256 }),
    requireDigest(root, { path: readiness.sourceState.receptorTmPregraph.summaryPath, sha256: readiness.sourceState.receptorTmPregraph.summarySha256 }),
  ]);
  const [generatorContracts, receptorManifest, receptorSummary] = await Promise.all([
    readRegularFile(path.join(root, readiness.sourceState.generatorContracts.path)).then((bytes) => JSON.parse(bytes.toString("utf8"))),
    readRegularFile(path.join(root, readiness.sourceState.receptorTmPregraph.manifestPath)).then((bytes) => JSON.parse(bytes.toString("utf8"))),
    readRegularFile(path.join(root, readiness.sourceState.receptorTmPregraph.summaryPath)).then((bytes) => JSON.parse(bytes.toString("utf8"))),
  ]);
  return validateGeneratorReadiness(readiness, { generatorContracts, receptorManifest, receptorSummary });
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const readiness = await verifyGeneratorReadiness();
  process.stdout.write(`${JSON.stringify({
    status: readiness.status,
    receptorTmPregraphComplete: readiness.completedCheckpoint.canonicalReceptorTmPregraphComplete,
    msaRetrievalAuthorized: readiness.msaPreparation.retrievalAuthorized,
    knownGeneratorAssetHashes: 5,
    unresolvedGeneratorAssetHashes: 4,
    blockers: readiness.blockers.length,
  })}\n`);
}
