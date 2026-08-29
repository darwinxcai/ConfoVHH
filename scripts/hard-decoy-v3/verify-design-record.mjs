import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";
import { decodeUtf8, readStableFile, sha256 } from "../hard-decoy/oracle/secure-io.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(THIS_FILE), "../..");
const DESIGN_RELATIVE = "validation/hard-decoy-holdout-v3/design-record";
const EXPECTED_FILES = [
  "README.md",
  "checksums.sha256",
  "design-state.json",
  "isolation-contract.json",
  "oracle-contract.json",
  "precommit-inventory.json",
  "protocol-lock.json",
].sort();
const TRUSTED_DESIGN_MANIFEST_SHA256 = "dbc489509f38deb467016fa96a2f45a6d63c14a5804865569b222fa2bf1e97fd";
const SHA256 = /^[a-f0-9]{64}$/u;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} has unexpected keys.`);
}

async function readDesignPackage(repositoryRoot) {
  const repository = path.resolve(repositoryRoot);
  const repositoryInfo = await lstat(repository);
  invariant(repositoryInfo.isDirectory() && !repositoryInfo.isSymbolicLink(), "Repository root must be one direct directory.");
  invariant(await realpath(repository) === repository, "Repository root cannot contain symlinked ancestors.");
  const directory = path.join(repository, DESIGN_RELATIVE);
  const info = await lstat(directory);
  invariant(info.isDirectory() && !info.isSymbolicLink(), "V3 design record must be one direct directory.");
  invariant(await realpath(directory) === directory, "V3 design record cannot contain symlinked ancestors.");
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Every v3 design-record entry must be one direct file.");
  invariant(JSON.stringify(entries.map((entry) => entry.name).sort()) === JSON.stringify(EXPECTED_FILES), "V3 design-record inventory drifted.");

  const manifestBytes = await readStableFile(path.join(directory, "checksums.sha256"));
  const manifestText = decodeUtf8(manifestBytes, "V3 checksum manifest");
  invariant(sha256(manifestBytes) === TRUSTED_DESIGN_MANIFEST_SHA256, "V3 design record drifted from its pinned release root.");
  invariant(manifestText.endsWith("\n"), "V3 checksum manifest must end with LF.");
  const rows = manifestText.trimEnd().split("\n");
  invariant(rows.length === EXPECTED_FILES.length - 1, "V3 checksum coverage count drifted.");
  const seen = new Set();
  const texts = new Map();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    invariant(match, `V3 checksum row ${index + 1} is malformed.`);
    const [, expected, relative] = match;
    invariant(relative !== "checksums.sha256" && EXPECTED_FILES.includes(relative) && !seen.has(relative), `Invalid v3 checksum target: ${relative}`);
    seen.add(relative);
    const bytes = await readStableFile(path.join(directory, relative));
    invariant(sha256(bytes) === expected, `V3 design checksum mismatch: ${relative}`);
    texts.set(relative, decodeUtf8(bytes, relative));
  }
  invariant(JSON.stringify([...seen].sort()) === JSON.stringify(EXPECTED_FILES.filter((name) => name !== "checksums.sha256")), "V3 checksum coverage drifted.");
  return { repository, texts };
}

async function repositoryDigest(repository, relative) {
  invariant(typeof relative === "string" && /^[A-Z0-9_.\/-]+$/iu.test(relative) && !relative.includes("..") && !path.isAbsolute(relative), "Unsafe protocol path.");
  const absolute = path.resolve(repository, relative);
  invariant(path.relative(repository, absolute) === relative, "Protocol path escaped repository root.");
  return sha256(await readStableFile(absolute, { maximumBytes: 4 * 1024 * 1024 }));
}

export async function verifyDesignRecord(repositoryRoot = DEFAULT_ROOT) {
  const { repository, texts } = await readDesignPackage(repositoryRoot);
  const state = parseStrictJson(texts.get("design-state.json"));
  const protocols = parseStrictJson(texts.get("protocol-lock.json"));
  const oracle = parseStrictJson(texts.get("oracle-contract.json"));
  const isolation = parseStrictJson(texts.get("isolation-contract.json"));
  const inventory = parseStrictJson(texts.get("precommit-inventory.json"));

  exactKeys(state, [
    "auditManifestFrozen", "candidateDiscoveryExhaustive", "candidateManifestFrozen", "currentBlockers",
    "dockqLabelsAccessed", "executionAuthorized", "formallyClearedGroups", "leakageGraphFrozen",
    "nativeCoordinatesAccessedByOracle", "nativeCoordinatesObservedByBenchmarkTeam", "nativeInterfaceDeclassifiedPrelabel",
    "oracleExecuted", "oracleRequestFrozen", "performanceResultsAccessed", "prelabelManifestFrozen", "protocolId",
    "requiredIndependentGroups", "schemaVersion", "screenedProvisionalGroupsInheritedFromV2", "selectedDesign",
    "status", "substantialGpuWorkAuthorized", "targetManifestFrozen", "userApprovedPrelabelManifest",
  ], "v3 design state");
  invariant(state.schemaVersion === "1.0.0" && state.protocolId === "confovhh-hard-decoy-v3" && state.status === "DRAFT", "Unexpected v3 design state.");
  invariant(state.selectedDesign === "sealed-one-way-native-epitope-boolean-oracle", "Unexpected v3 oracle design.");
  invariant(state.requiredIndependentGroups === 10 && state.screenedProvisionalGroupsInheritedFromV2 === 7 && state.formallyClearedGroups === 0, "V3 target-count boundary drifted.");
  for (const field of [
    "candidateDiscoveryExhaustive", "oracleRequestFrozen", "oracleExecuted", "leakageGraphFrozen", "targetManifestFrozen",
    "candidateManifestFrozen", "auditManifestFrozen", "prelabelManifestFrozen", "userApprovedPrelabelManifest",
    "executionAuthorized", "nativeCoordinatesAccessedByOracle", "nativeCoordinatesObservedByBenchmarkTeam",
    "nativeInterfaceDeclassifiedPrelabel", "dockqLabelsAccessed", "performanceResultsAccessed", "substantialGpuWorkAuthorized",
  ]) invariant(state[field] === false, `V3 draft access/freeze state drifted: ${field}`);
  invariant(Array.isArray(state.currentBlockers) && state.currentBlockers.length === 6, "V3 blocker ledger drifted.");

  exactKeys(protocols, ["protocols", "schemaVersion", "scientificEngine", "v2BlockedCensus"], "v3 protocol lock");
  invariant(protocols.schemaVersion === "1.0.0" && protocols.protocols.length === 4, "V3 protocol ancestry drifted.");
  for (const item of protocols.protocols) {
    exactKeys(item, ["path", "role", "sha256"], "v3 protocol lock row");
    invariant(SHA256.test(item.sha256) && await repositoryDigest(repository, item.path) === item.sha256, `V3 protocol lock mismatch: ${item.path}`);
  }
  invariant(protocols.scientificEngine.commit === "04c6bda2289157dd294c290609f6052aa0ef9195" && protocols.scientificEngine.tree === "1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9", "Scientific-engine ancestry drifted.");
  invariant(protocols.v2BlockedCensus.checksumManifestSha256 === "e2020cf5863246058d3c89d974b49da0d5d41803904b899670712f1509609502", "V2 census trust root drifted.");
  invariant(await repositoryDigest(repository, "validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256") === protocols.v2BlockedCensus.checksumManifestSha256, "V2 census bytes drifted under v3.");

  invariant(oracle.requestMode === "one-nonadaptive-whole-batch", "Oracle request mode drifted.");
  invariant(oracle.nativeContactPolicy.distanceAngstrom === 5 && oracle.nativeContactPolicy.boundary === "inclusive" && oracle.nativeContactPolicy.minimumUniqueResiduePairsForDirectInterface === 8, "Oracle contact policy drifted.");
  invariant(oracle.overlapPolicy.jaccardEdgeIntegerRule === "5*intersection>=2*union" && oracle.overlapPolicy.containmentEdgeIntegerRule === "5*intersection>=3*minSize" && oracle.overlapPolicy.thresholdEqualityCreatesEdge === true, "Oracle overlap policy drifted.");
  invariant(JSON.stringify(oracle.publicDecisionValues) === JSON.stringify(["EDGE", "NO_EDGE", "FAIL_CLOSED"]), "Oracle decision vocabulary drifted.");
  invariant(oracle.publicOutputPolicy.allowedScientificDisclosure === "boolean-pair-decision-only" && oracle.publicOutputPolicy.sequenceNumber === 1, "Oracle disclosure policy drifted.");
  invariant(oracle.encryptedEvidence.plaintextBytes === 4_194_304 && oracle.encryptedEvidence.ciphertextEnvelopeBytes === 4_194_406, "Oracle fixed-size evidence contract drifted.");
  invariant(oracle.publicOutputPolicy.certificateBindings.length === 6 && oracle.encryptedEvidence.postOpeningReconciliation === "recompute-every-target-and-pair-commitment-decision-merkle-root-and-entropy-precommitment", "Oracle certificate/opening binding contract drifted.");
  invariant(oracle.subliminalChannelControls.oracleChosenRandomnessAfterNativeAccessForbidden === true && oracle.subliminalChannelControls.allCommitmentAndEncryptionEntropyCommittedBeforeNativeAccess === true, "Oracle subliminal-channel controls drifted.");
  invariant(oracle.forbiddenPrelabelOutput.length === 11, "Oracle forbidden-output ledger drifted.");

  invariant(isolation.executionEnvironment === "separate-noninteractive-vm-or-independent-custodian", "Oracle isolation environment drifted.");
  invariant(isolation.failurePolicy.targetFailure === "signed-FAIL_CLOSED-and-target-mechanically-ineligible", "FAIL_CLOSED target policy drifted.");
  invariant(isolation.failurePolicy.sameVersionRerunForbidden === true && isolation.claimBoundary === "process-separation-not-proof-against-malicious-privileged-operator", "Oracle failure/claim boundary drifted.");

  invariant(inventory.currentPrecommitExists === false && inventory.futureStateRequired === "ORACLE_REQUEST_FROZEN", "V3 precommit-existence state drifted.");
  invariant(inventory.minimumCandidateComponentsBeforeOracle === 10 && inventory.requiredFiles.length === 11, "Future v3 precommit inventory drifted.");

  return {
    status: state.status,
    selectedDesign: state.selectedDesign,
    requiredIndependentGroups: state.requiredIndependentGroups,
    screenedProvisionalGroups: state.screenedProvisionalGroupsInheritedFromV2,
    formallyClearedGroups: state.formallyClearedGroups,
    oracleRequestFrozen: state.oracleRequestFrozen,
    nativeCoordinatesAccessedByOracle: state.nativeCoordinatesAccessedByOracle,
    dockqLabelsAccessed: state.dockqLabelsAccessed,
    executionAuthorized: state.executionAuthorized,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  try {
    console.log(JSON.stringify(await verifyDesignRecord(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
