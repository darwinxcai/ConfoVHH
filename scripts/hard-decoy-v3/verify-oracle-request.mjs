import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCanonicalJson } from "../hard-decoy/oracle/canonical-json.mjs";
import { decodeUtf8, readContainedStableFile, readStableFile, sha256 } from "../hard-decoy/oracle/secure-io.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), "../..");
const SHA256 = /^[a-f0-9]{64}$/u;
const TARGET_ID = /^(?:CAND|DEV)-[0-9]{3,5}$/u;
const COMPONENT_ID = /^COMP-[0-9]{3,5}$/u;
const SOURCE_ID = /^SRC-[A-Z0-9][A-Z0-9-]{0,59}$/u;
const SAFE_ID = /^[A-Z0-9][A-Z0-9._:-]{0,63}$/u;
const ENTITY_ID = /^(?:UNIPROT|VHH):[A-Z0-9][A-Z0-9._-]{0,50}$/u;
const PUBLICATION_ID = /^(?:PMID:[0-9]{1,12}|DOI:10\.[0-9]{4,9}\/[a-z0-9._;()/:+-]{1,180})$/u;
const CHAIN_COPY = /^[A-Za-z0-9]{1,4}#[1-9][0-9]{0,3}$/u;
const AMINO_ACIDS = /^[ACDEFGHIKLMNPQRSTVWYUX]+$/u;

const EXPECTED_FILES = [
  "checksums.sha256",
  "development-registry.jsonl",
  "key-ceremony.json",
  "mapping-contract.json",
  "oracle-contract.json",
  "pair-manifest.jsonl",
  "resource-contract.json",
  "selection-contract.json",
  "source-manifest.jsonl",
  "target-universe.jsonl",
  "topology-ontology.json",
].sort();
const CONTENT_FILES = EXPECTED_FILES.filter((name) => name !== "checksums.sha256");
const VERIFIED_REQUESTS = new WeakSet();

const TRUST = Object.freeze({
  v1ProtocolSha256: "9a6c441d844069f52f87e60fa2cf00dfc671b588a19454d0479d188e4cb46c1f",
  v2ProtocolSha256: "9c38f2d2f7ed2ce4acd5b6730fedd6a37151fe992a808bfefc4268888f862421",
  v3ProtocolSha256: "1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376",
  v2BlockedCensusManifestSha256: "e2020cf5863246058d3c89d974b49da0d5d41803904b899670712f1509609502",
  v3DesignRecordManifestSha256: "dbc489509f38deb467016fa96a2f45a6d63c14a5804865569b222fa2bf1e97fd",
  engineCommit: "04c6bda2289157dd294c290609f6052aa0ef9195",
  engineTree: "1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9",
});

const FORBIDDEN_KEY = /(?:coordinate|native|private.?key|result|label|blob|free.?form)/iu;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactObject(value, expectedKeys, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be one object.`);
  invariant(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()),
    `${label} has unexpected, missing, or forbidden fields.`,
  );
}

function exactString(value, pattern, label, maximumLength = 256) {
  invariant(typeof value === "string" && value.length > 0 && value.length <= maximumLength && pattern.test(value), `${label} is invalid.`);
}

function digest(value, label) {
  exactString(value, SHA256, label, 64);
  invariant(value !== "0".repeat(64), `${label} cannot be the all-zero digest.`);
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  invariant(Number.isSafeInteger(value) && value > 0 && value <= maximum, `${label} must be one bounded positive integer.`);
}

function exactBoolean(value, expected, label) {
  invariant(value === expected, `${label} must be ${expected}.`);
}

function uniqueSortedStrings(values, label, pattern = SAFE_ID, minimum = 1, maximum = 10_000) {
  invariant(Array.isArray(values) && values.length >= minimum && values.length <= maximum, `${label} has an invalid row count.`);
  for (const [index, value] of values.entries()) exactString(value, pattern, `${label}[${index}]`);
  invariant(new Set(values).size === values.length, `${label} contains duplicates.`);
  invariant(JSON.stringify(values) === JSON.stringify([...values].sort()), `${label} must be bytewise sorted.`);
}

function rejectForbiddenKeys(value, trail = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    invariant(!FORBIDDEN_KEY.test(key), `${trail}.${key} uses a forbidden disclosure field.`);
    invariant(!["__proto__", "constructor", "prototype"].includes(key), `${trail}.${key} is unsafe.`);
    rejectForbiddenKeys(item, `${trail}.${key}`);
  }
}

function parseCanonicalDocument(text, label) {
  let value;
  try {
    value = parseCanonicalJson(text, { maximumCharacters: 16 * 1024 * 1024, maximumTokens: 2_000_000 });
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  rejectForbiddenKeys(value);
  return value;
}

function parseCanonicalJsonl(text, label, maximumRows = 100_000) {
  invariant(text.endsWith("\n") && !text.endsWith("\n\n"), `${label} must contain one canonical JSON record per LF-terminated line.`);
  invariant(!text.includes("\r"), `${label} must use LF line endings.`);
  const lines = text.slice(0, -1).split("\n");
  invariant(lines.length > 0 && lines.length <= maximumRows && lines.every((line) => line.length > 0), `${label} has an invalid row count.`);
  return lines.map((line, index) => parseCanonicalDocument(line, `${label} row ${index + 1}`));
}

function assertHttpsUrl(value, label) {
  invariant(typeof value === "string" && value.length <= 2_048 && !/[\\\x00-\x20]/u.test(value), `${label} is invalid.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not one absolute URL.`);
  }
  invariant(
    parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.hash === "" && parsed.href === value &&
      !/%2e|%2f|%5c/iu.test(value) && !parsed.pathname.split("/").includes(".."),
    `${label} must be one canonical HTTPS URL without credentials, fragment, or traversal encoding.`,
  );
}

function assertUtc(value, label) {
  exactString(value, /^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u, label, 20);
  invariant(Number.isFinite(Date.parse(value)), `${label} is not a valid UTC timestamp.`);
}

function assertSequence(value, label, minimum, maximum) {
  invariant(typeof value === "string" && value.length >= minimum && value.length <= maximum && AMINO_ACIDS.test(value), `${label} is not one bounded uppercase amino-acid sequence.`);
}

function isSubsequence(fragment, sequence) {
  let cursor = 0;
  for (const residue of sequence) {
    if (residue === fragment[cursor]) cursor += 1;
    if (cursor === fragment.length) return true;
  }
  return false;
}

function verifyTarget(row, index) {
  const label = `target row ${index + 1}`;
  exactObject(row, [
    "annotationSourceId", "assemblySelector", "componentId", "mappingContractId", "modelSelector",
    "publicationId", "receptorAlignmentSha256", "receptorCanonicalAccession", "receptorChainCopy",
    "receptorConstructSequence", "receptorConstructSequenceSha256", "receptorEntityId", "receptorTm1Tm7Sequence",
    "receptorTm1Tm7SequenceSha256", "role", "schemaVersion", "selectionOrdinal", "structureSourceId", "targetId",
    "vhhCdr1Sequence", "vhhCdr2Sequence", "vhhCdr3Sequence", "vhhChainCopy", "vhhEntityId",
    "vhhFrameworkSequence", "vhhImgtNumberingSha256", "vhhParentEvidenceSourceId", "vhhSequence", "vhhSequenceSha256",
  ], label);
  invariant(row.schemaVersion === "1.0.0", `${label} schema version drifted.`);
  exactString(row.targetId, TARGET_ID, `${label} targetId`, 10);
  invariant(row.role === "candidate" || row.role === "development", `${label} has an invalid role.`);
  invariant(row.targetId.startsWith(row.role === "candidate" ? "CAND-" : "DEV-"), `${label} role and target ID disagree.`);
  exactString(row.componentId, COMPONENT_ID, `${label} componentId`, 10);
  for (const field of ["structureSourceId", "annotationSourceId", "vhhParentEvidenceSourceId"]) exactString(row[field], SOURCE_ID, `${label} ${field}`, 64);
  exactString(row.publicationId, PUBLICATION_ID, `${label} publicationId`, 200);
  exactString(row.assemblySelector, /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u, `${label} assemblySelector`, 32);
  positiveInteger(row.modelSelector, `${label} modelSelector`, 10_000);
  exactString(row.receptorChainCopy, CHAIN_COPY, `${label} receptorChainCopy`, 9);
  exactString(row.vhhChainCopy, CHAIN_COPY, `${label} vhhChainCopy`, 9);
  invariant(row.receptorChainCopy !== row.vhhChainCopy, `${label} chain copies must differ.`);
  exactString(row.receptorEntityId, ENTITY_ID, `${label} receptorEntityId`, 60);
  invariant(row.receptorEntityId.startsWith("UNIPROT:"), `${label} receptor entity must be a UniProt entity.`);
  exactString(row.receptorCanonicalAccession, /^[A-Z0-9]{6,10}$/u, `${label} receptorCanonicalAccession`, 10);
  invariant(row.receptorEntityId === `UNIPROT:${row.receptorCanonicalAccession}`, `${label} receptor entity/accession mismatch.`);
  assertSequence(row.receptorConstructSequence, `${label} receptorConstructSequence`, 30, 2_048);
  assertSequence(row.receptorTm1Tm7Sequence, `${label} receptorTm1Tm7Sequence`, 30, 1_024);
  invariant(isSubsequence(row.receptorTm1Tm7Sequence, row.receptorConstructSequence), `${label} concatenated TM1-TM7 sequence must be an ordered subsequence of the receptor construct sequence.`);
  invariant(sha256(row.receptorConstructSequence) === row.receptorConstructSequenceSha256, `${label} receptor construct sequence digest mismatch.`);
  invariant(sha256(row.receptorTm1Tm7Sequence) === row.receptorTm1Tm7SequenceSha256, `${label} receptor TM1-TM7 sequence digest mismatch.`);
  digest(row.receptorAlignmentSha256, `${label} receptorAlignmentSha256`);
  exactString(row.vhhEntityId, ENTITY_ID, `${label} vhhEntityId`, 60);
  invariant(row.vhhEntityId.startsWith("VHH:"), `${label} VHH entity is invalid.`);
  assertSequence(row.vhhSequence, `${label} vhhSequence`, 50, 220);
  invariant(sha256(row.vhhSequence) === row.vhhSequenceSha256, `${label} VHH sequence digest mismatch.`);
  digest(row.vhhImgtNumberingSha256, `${label} vhhImgtNumberingSha256`);
  assertSequence(row.vhhFrameworkSequence, `${label} vhhFrameworkSequence`, 20, 180);
  assertSequence(row.vhhCdr1Sequence, `${label} vhhCdr1Sequence`, 2, 40);
  assertSequence(row.vhhCdr2Sequence, `${label} vhhCdr2Sequence`, 2, 40);
  assertSequence(row.vhhCdr3Sequence, `${label} vhhCdr3Sequence`, 3, 60);
  invariant(isSubsequence(row.vhhFrameworkSequence, row.vhhSequence), `${label} concatenated framework sequence must be an ordered subsequence of the frozen VHH sequence.`);
  const cdrPositions = [row.vhhCdr1Sequence, row.vhhCdr2Sequence, row.vhhCdr3Sequence].map((sequence) => row.vhhSequence.indexOf(sequence));
  invariant(cdrPositions.every((position) => position >= 0) && cdrPositions[0] < cdrPositions[1] && cdrPositions[1] < cdrPositions[2], `${label} CDR sequences must occur once in IMGT order in the frozen VHH sequence.`);
  invariant(row.mappingContractId === "MAPPING-CONTRACT-1", `${label} mapping contract reference drifted.`);
  invariant(row.selectionOrdinal === 1, `${label} must be the preselected representative.`);
}

function verifyDevelopment(row, index) {
  const label = `development row ${index + 1}`;
  exactObject(row, [
    "developmentArtifactSha256", "developmentArtifactSourceId", "frozenEngineCommit", "inclusionEvidenceSha256",
    "schemaVersion", "targetId", "useClass",
  ], label);
  invariant(row.schemaVersion === "1.0.0" && row.useClass === "frozen-score-development", `${label} schema/use class drifted.`);
  exactString(row.targetId, /^DEV-[0-9]{3,5}$/u, `${label} targetId`, 10);
  exactString(row.developmentArtifactSourceId, SOURCE_ID, `${label} developmentArtifactSourceId`, 64);
  digest(row.developmentArtifactSha256, `${label} developmentArtifactSha256`);
  digest(row.inclusionEvidenceSha256, `${label} inclusionEvidenceSha256`);
  invariant(row.frozenEngineCommit === TRUST.engineCommit, `${label} engine ancestry drifted.`);
}

const SOURCE_KINDS = new Set(["annotation", "code", "container", "dependency", "exclusion-ledger", "mapping", "ontology", "structure"]);

function verifySource(row, index) {
  const label = `source row ${index + 1}`;
  exactObject(row, [
    "byteLength", "httpStatus", "objectId", "responseMetadataSha256", "retrievedUtc", "schemaVersion", "sha256",
    "sourceId", "sourceKind", "spdxLicense", "url",
  ], label);
  invariant(row.schemaVersion === "1.0.0" && SOURCE_KINDS.has(row.sourceKind), `${label} schema/source kind drifted.`);
  exactString(row.sourceId, SOURCE_ID, `${label} sourceId`, 64);
  exactString(row.objectId, SAFE_ID, `${label} objectId`, 64);
  assertHttpsUrl(row.url, `${label} url`);
  assertUtc(row.retrievedUtc, `${label} retrievedUtc`);
  positiveInteger(row.byteLength, `${label} byteLength`, 10_000_000_000);
  digest(row.sha256, `${label} sha256`);
  exactString(row.spdxLicense, /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u, `${label} spdxLicense`, 64);
  invariant(row.httpStatus === 200, `${label} HTTP status must be 200.`);
  digest(row.responseMetadataSha256, `${label} responseMetadataSha256`);
}

function verifyPair(row, index, targetById) {
  const label = `pair row ${index + 1}`;
  exactObject(row, ["leftTargetId", "pairId", "pairKind", "rightTargetId", "schemaVersion"], label);
  invariant(row.schemaVersion === "1.0.0", `${label} schema version drifted.`);
  exactString(row.leftTargetId, TARGET_ID, `${label} leftTargetId`, 10);
  exactString(row.rightTargetId, TARGET_ID, `${label} rightTargetId`, 10);
  invariant(row.leftTargetId < row.rightTargetId, `${label} must use bytewise canonical unordered-pair order.`);
  invariant(targetById.has(row.leftTargetId) && targetById.has(row.rightTargetId), `${label} references an unknown target.`);
  const expectedId = `${row.leftTargetId}--${row.rightTargetId}`;
  invariant(row.pairId === expectedId, `${label} pairId does not match its endpoints.`);
  const roles = [targetById.get(row.leftTargetId).role, targetById.get(row.rightTargetId).role].sort().join("-");
  const expectedKind = roles === "candidate-candidate" ? "candidate-candidate" : roles === "candidate-development" ? "candidate-development" : null;
  invariant(row.pairKind === expectedKind, `${label} has a forbidden or inconsistent pair kind.`);
}

function verifyMapping(row) {
  exactObject(row, [
    "alternateConformerPolicy", "assemblyOperationPolicy", "constructAlignmentSourceId", "contactDistanceAngstrom",
    "contactDistanceBoundary", "contractId", "everyContactingReceptorResidueMapped", "gpcrdbSnapshotSourceId",
    "imgtImplementationSourceId", "insertionCodePolicy", "malformedRecordPolicy", "mappingUnknownPolicy",
    "minimumUniqueResiduePairs", "modifiedResiduePolicy", "occupancyPolicy", "parserImplementationSourceId", "schemaVersion",
  ], "mapping contract");
  invariant(row.schemaVersion === "1.0.0" && row.contractId === "MAPPING-CONTRACT-1", "Mapping-contract identity drifted.");
  for (const field of ["constructAlignmentSourceId", "gpcrdbSnapshotSourceId", "imgtImplementationSourceId", "parserImplementationSourceId"]) {
    exactString(row[field], SOURCE_ID, `mapping contract ${field}`, 64);
  }
  invariant(row.contactDistanceAngstrom === 5 && row.contactDistanceBoundary === "inclusive" && row.minimumUniqueResiduePairs === 8, "Mapping contact rule drifted.");
  exactBoolean(row.everyContactingReceptorResidueMapped, true, "Mapping completeness policy");
  invariant(row.mappingUnknownPolicy === "FAIL_CLOSED", "Mapping unknown policy drifted.");
  invariant(row.modifiedResiduePolicy === "pinned-protein-map-else-fail-closed", "Modified-residue policy drifted.");
  invariant(row.alternateConformerPolicy === "highest-occupancy-whole-residue-then-bytewise", "Alternate-conformer policy drifted.");
  invariant(row.occupancyPolicy === "finite-positive-only", "Occupancy policy drifted.");
  invariant(row.insertionCodePolicy === "preserve-explicitly", "Insertion-code policy drifted.");
  invariant(row.assemblyOperationPolicy === "exact-preselected-operator-chain-copy", "Assembly-operation policy drifted.");
  invariant(row.malformedRecordPolicy === "FAIL_CLOSED", "Malformed-record policy drifted.");
}

function verifyTopology(row) {
  exactObject(row, ["ontologyId", "ontologySourceId", "regionTokens", "schemaVersion", "tokenVersion"], "topology ontology");
  invariant(row.schemaVersion === "1.0.0" && row.ontologyId === "TOPOLOGY-ONTOLOGY-1" && row.tokenVersion === "1.0.0", "Topology-ontology identity drifted.");
  exactString(row.ontologySourceId, SOURCE_ID, "topology ontology source", 64);
  uniqueSortedStrings(row.regionTokens, "topology region tokens", /^[A-Z0-9][A-Z0-9._:-]{0,63}$/u, 7, 128);
}

const SELECTION_PRIORITY = [
  "direct-non-fusion-receptor-vhh-construct",
  "complete-assembly-and-unambiguous-chain-copies",
  "higher-resolution-experimental-model",
  "fewer-unresolved-receptor-vhh-backbone-residues",
  "earlier-pdb-release-date",
  "bytewise-pdb-id",
];

function verifySelection(row, candidateByComponent) {
  exactObject(row, [
    "candidateRepresentatives", "contractId", "excludedComponentLedgerSourceId", "failureSubstitutionPolicy",
    "priority", "representativeSelectionFrozen", "schemaVersion",
  ], "selection contract");
  invariant(row.schemaVersion === "1.0.0" && row.contractId === "SELECTION-CONTRACT-1", "Selection-contract identity drifted.");
  invariant(JSON.stringify(row.priority) === JSON.stringify(SELECTION_PRIORITY), "Representative priority drifted.");
  exactBoolean(row.representativeSelectionFrozen, true, "Representative freeze policy");
  invariant(row.failureSubstitutionPolicy === "forbidden", "Post-failure substitution must be forbidden.");
  exactString(row.excludedComponentLedgerSourceId, SOURCE_ID, "excluded component ledger source", 64);
  invariant(Array.isArray(row.candidateRepresentatives) && row.candidateRepresentatives.length === candidateByComponent.size, "Candidate representative count drifted.");
  const ids = [];
  for (const [index, representative] of row.candidateRepresentatives.entries()) {
    exactObject(representative, ["componentId", "selectionOrdinal", "targetId"], `candidate representative ${index + 1}`);
    exactString(representative.componentId, COMPONENT_ID, `candidate representative ${index + 1} componentId`, 10);
    exactString(representative.targetId, /^CAND-[0-9]{3,5}$/u, `candidate representative ${index + 1} targetId`, 10);
    invariant(representative.selectionOrdinal === 1, `candidate representative ${index + 1} ordinal drifted.`);
    invariant(candidateByComponent.get(representative.componentId)?.targetId === representative.targetId, `candidate representative ${index + 1} does not match the target universe.`);
    ids.push(representative.componentId);
  }
  invariant(JSON.stringify(ids) === JSON.stringify([...candidateByComponent.keys()].sort()), "Candidate representatives must be complete and bytewise sorted.");
}

function verifyKeyCeremony(row, requestFrozenUtc) {
  exactObject(row, [
    "authorizationReceiptSha256", "authorizationScope", "ceremonyId", "commitmentNonceSeedCommitmentSha256",
    "encryptionRecipientFingerprintSha256", "encryptionRecipientPublicKeySpkiSha256", "entropyCommitmentDomain",
    "evidenceEncryptionAlgorithm", "frozenUtc", "paddingSeedCommitmentSha256", "precommittedEphemeralPublicKeySpkiSha256",
    "precommittedEphemeralSecretCommitmentSha256", "schemaVersion", "sequenceNumber", "signingAlgorithm",
    "signingKeyFingerprintSha256", "signingPublicKeySpkiSha256", "transparencyLogKeyFingerprintSha256",
    "transparencyChallengeSha256",
  ], "key ceremony");
  invariant(row.schemaVersion === "1.0.0" && row.ceremonyId === "KEY-CEREMONY-1" && row.sequenceNumber === 1, "Key-ceremony identity drifted.");
  invariant(row.signingAlgorithm === "Ed25519" && row.evidenceEncryptionAlgorithm === "X25519-HKDF-SHA256-AES-256-GCM", "Key-ceremony algorithm drifted.");
  for (const field of [
    "authorizationReceiptSha256", "commitmentNonceSeedCommitmentSha256", "encryptionRecipientFingerprintSha256",
    "encryptionRecipientPublicKeySpkiSha256", "paddingSeedCommitmentSha256", "precommittedEphemeralPublicKeySpkiSha256",
    "precommittedEphemeralSecretCommitmentSha256", "signingKeyFingerprintSha256", "signingPublicKeySpkiSha256",
    "transparencyLogKeyFingerprintSha256", "transparencyChallengeSha256",
  ]) digest(row[field], `key ceremony ${field}`);
  invariant(row.signingKeyFingerprintSha256 === row.signingPublicKeySpkiSha256, "Signing-key fingerprint substitution detected.");
  invariant(row.encryptionRecipientFingerprintSha256 === row.encryptionRecipientPublicKeySpkiSha256, "Encryption-recipient fingerprint substitution detected.");
  const entropy = [row.commitmentNonceSeedCommitmentSha256, row.paddingSeedCommitmentSha256, row.precommittedEphemeralSecretCommitmentSha256];
  invariant(new Set(entropy).size === entropy.length, "Precommitted entropy domains must use distinct commitments.");
  invariant(row.entropyCommitmentDomain === "confovhh-hard-decoy-v3-oracle-request-1", "Entropy commitment domain drifted.");
  invariant(row.authorizationScope === "freeze-whole-batch-oracle-request-only", "Authorization scope drifted.");
  assertUtc(row.frozenUtc, "key ceremony frozenUtc");
  invariant(Date.parse(row.frozenUtc) <= Date.parse(requestFrozenUtc), "Key ceremony must be frozen no later than the request.");
}

function verifyResource(row, sourceById) {
  exactObject(row, [
    "containerImageDigest", "containerSourceId", "contractId", "dependencyLockSha256", "dependencyLockSourceId",
    "failedAttemptRetentionPolicy", "fixedSeedCommitmentSha256", "malformedInputPolicy", "maximumAtomsPerTarget",
    "maximumInputBytes", "maximumMemoryBytes", "maximumPairs", "maximumResiduesPerTarget", "maximumTargets",
    "maximumWallSeconds", "networkAfterStaging", "oracleCodeSourceId", "oracleImplementationSha256", "outputCount",
    "parserVersion", "rerunPolicy", "runtimeVersion", "schemaVersion", "sourceMountReadOnly", "stdoutPolicy",
  ], "resource contract");
  invariant(row.schemaVersion === "1.0.0" && row.contractId === "RESOURCE-CONTRACT-1", "Resource-contract identity drifted.");
  for (const field of ["containerSourceId", "dependencyLockSourceId", "oracleCodeSourceId"]) exactString(row[field], SOURCE_ID, `resource contract ${field}`, 64);
  digest(row.oracleImplementationSha256, "resource contract oracleImplementationSha256");
  digest(row.dependencyLockSha256, "resource contract dependencyLockSha256");
  digest(row.fixedSeedCommitmentSha256, "resource contract fixedSeedCommitmentSha256");
  invariant(row.containerImageDigest === `sha256:${sourceById.get(row.containerSourceId)?.sha256}`, "Container digest/source substitution detected.");
  invariant(row.oracleImplementationSha256 === sourceById.get(row.oracleCodeSourceId)?.sha256, "Oracle implementation/source substitution detected.");
  invariant(row.dependencyLockSha256 === sourceById.get(row.dependencyLockSourceId)?.sha256, "Dependency-lock/source substitution detected.");
  exactString(row.parserVersion, /^[a-z0-9][a-z0-9.-]{0,63}$/u, "resource contract parserVersion", 64);
  exactString(row.runtimeVersion, /^node-v[0-9]+\.[0-9]+\.[0-9]+$/u, "resource contract runtimeVersion", 32);
  positiveInteger(row.maximumInputBytes, "resource contract maximumInputBytes", 1_000_000_000);
  positiveInteger(row.maximumTargets, "resource contract maximumTargets", 10_000);
  positiveInteger(row.maximumPairs, "resource contract maximumPairs", 50_000_000);
  positiveInteger(row.maximumAtomsPerTarget, "resource contract maximumAtomsPerTarget", 10_000_000);
  positiveInteger(row.maximumResiduesPerTarget, "resource contract maximumResiduesPerTarget", 1_000_000);
  positiveInteger(row.maximumWallSeconds, "resource contract maximumWallSeconds", 604_800);
  positiveInteger(row.maximumMemoryBytes, "resource contract maximumMemoryBytes", 1_000_000_000_000);
  exactBoolean(row.sourceMountReadOnly, true, "resource contract sourceMountReadOnly");
  invariant(row.networkAfterStaging === "disabled" && row.outputCount === 2 && row.stdoutPolicy === "fixed-status-only", "Resource isolation policy drifted.");
  invariant(row.malformedInputPolicy === "FAIL_CLOSED" && row.rerunPolicy === "same-version-forbidden", "Resource failure policy drifted.");
  invariant(row.failedAttemptRetentionPolicy === "retain-every-attempt-without-replacement", "Failed-attempt retention policy drifted.");
}

function verifyOracleContract(row, bytesByName, counts, keyCeremony) {
  exactObject(row, [
    "authorizationReceiptSha256", "benchmarkExecutionApprovalSha256", "benchmarkExecutionAuthorized", "candidateComponentCount",
    "candidateTargetCount", "canonicalizationProfile", "designRecordManifestSha256", "developmentRegistrySha256",
    "developmentTargetCount", "engineCommit", "engineTree", "expectedPairCount", "keyCeremonySha256", "mappingContractSha256",
    "oracleRequestFrozen", "pairManifestSha256", "protocolId", "requestFrozenUtc", "requestId", "requestMode",
    "requestSequence", "resourceContractSha256", "schemaVersion", "selectionContractSha256", "sourceManifestSha256", "state",
    "targetUniverseSha256", "topologyOntologySha256", "v1ProtocolSha256", "v2BlockedCensusManifestSha256",
    "v2ProtocolSha256", "v3ProtocolSha256",
  ], "oracle contract");
  invariant(row.schemaVersion === "1.0.0" && row.protocolId === "confovhh-hard-decoy-v3", "Oracle-contract identity drifted.");
  invariant(row.state === "ORACLE_REQUEST_FROZEN" && row.oracleRequestFrozen === true, "Oracle request is not explicitly frozen.");
  exactString(row.requestId, /^REQUEST-[A-F0-9]{16}$/u, "oracle contract requestId", 24);
  invariant(row.requestSequence === 1 && row.requestMode === "one-nonadaptive-whole-batch", "Oracle request mode/sequence drifted.");
  invariant(row.canonicalizationProfile === "confovhh-canonical-json-v1", "Canonicalization profile drifted.");
  assertUtc(row.requestFrozenUtc, "oracle contract requestFrozenUtc");
  invariant(row.candidateTargetCount === counts.candidates && row.developmentTargetCount === counts.development && row.candidateComponentCount === counts.components && row.expectedPairCount === counts.pairs, "Oracle-contract counts disagree with the frozen manifests.");
  invariant(row.candidateTargetCount >= 10 && row.candidateComponentCount >= 10, "The request has fewer than ten independent candidate targets/components.");
  for (const [field, filename] of [
    ["targetUniverseSha256", "target-universe.jsonl"], ["developmentRegistrySha256", "development-registry.jsonl"],
    ["sourceManifestSha256", "source-manifest.jsonl"], ["pairManifestSha256", "pair-manifest.jsonl"],
    ["mappingContractSha256", "mapping-contract.json"], ["topologyOntologySha256", "topology-ontology.json"],
    ["selectionContractSha256", "selection-contract.json"], ["keyCeremonySha256", "key-ceremony.json"],
    ["resourceContractSha256", "resource-contract.json"],
  ]) invariant(row[field] === sha256(bytesByName.get(filename)), `Oracle-contract ${field} does not bind ${filename}.`);
  invariant(row.v1ProtocolSha256 === TRUST.v1ProtocolSha256 && row.v2ProtocolSha256 === TRUST.v2ProtocolSha256 && row.v3ProtocolSha256 === TRUST.v3ProtocolSha256, "Protocol ancestry digest drifted.");
  invariant(row.v2BlockedCensusManifestSha256 === TRUST.v2BlockedCensusManifestSha256 && row.designRecordManifestSha256 === TRUST.v3DesignRecordManifestSha256, "Historical/design trust root drifted.");
  invariant(row.engineCommit === TRUST.engineCommit && row.engineTree === TRUST.engineTree, "Scientific-engine ancestry drifted.");
  digest(row.authorizationReceiptSha256, "oracle contract authorizationReceiptSha256");
  invariant(row.authorizationReceiptSha256 === keyCeremony.authorizationReceiptSha256, "Authorization-receipt substitution detected.");
  exactBoolean(row.benchmarkExecutionAuthorized, false, "benchmark execution authorization");
  invariant(row.benchmarkExecutionApprovalSha256 === null, "Benchmark execution approval must remain absent at request freeze.");
}

async function verifyRepositoryTrust(repositoryRoot) {
  const repository = path.resolve(repositoryRoot);
  const roots = [
    ["HARD_DECOY_PROTOCOL.md", TRUST.v1ProtocolSha256],
    ["HARD_DECOY_PROTOCOL_V2.md", TRUST.v2ProtocolSha256],
    ["HARD_DECOY_PROTOCOL_V3.md", TRUST.v3ProtocolSha256],
    ["validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256", TRUST.v2BlockedCensusManifestSha256],
    ["validation/hard-decoy-holdout-v3/design-record/checksums.sha256", TRUST.v3DesignRecordManifestSha256],
  ];
  for (const [relative, expected] of roots) {
    invariant(sha256(await readStableFile(path.join(repository, relative), { maximumBytes: 8 * 1024 * 1024 })) === expected, `Pinned repository trust root drifted: ${relative}`);
  }
}

async function readFrozenPackage(requestDirectory, expectedChecksumsSha256) {
  digest(expectedChecksumsSha256, "Expected external checksum-manifest trust root");
  const directory = path.resolve(requestDirectory);
  const before = await lstat(directory, { bigint: true });
  invariant(before.isDirectory() && !before.isSymbolicLink(), "Oracle request must be one direct directory.");
  invariant(await realpath(directory) === directory, "Oracle request directory cannot contain symlinked ancestors.");
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), "Every oracle-request entry must be one direct regular file.");
  invariant(JSON.stringify(entries.map((entry) => entry.name).sort()) === JSON.stringify(EXPECTED_FILES), "Oracle-request file allowlist drifted.");

  const checksumBytes = await readContainedStableFile(directory, "checksums.sha256", { maximumBytes: 64 * 1024, label: "Checksum manifest" });
  invariant(sha256(checksumBytes) === expectedChecksumsSha256, "Oracle request drifted from its externally pinned checksum-manifest trust root.");
  const checksumText = decodeUtf8(checksumBytes, "Oracle-request checksum manifest");
  invariant(checksumText.endsWith("\n") && !checksumText.includes("\r"), "Oracle-request checksum manifest must be LF terminated.");
  const rows = checksumText.trimEnd().split("\n");
  invariant(rows.length === CONTENT_FILES.length, "Oracle-request checksum coverage count drifted.");
  const checksums = new Map();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u.exec(row);
    invariant(match, `Checksum row ${index + 1} is malformed.`);
    const [, expected, filename] = match;
    invariant(CONTENT_FILES.includes(filename) && !checksums.has(filename), `Checksum row ${index + 1} names an unlisted or duplicate file.`);
    checksums.set(filename, expected);
  }
  invariant(JSON.stringify([...checksums.keys()]) === JSON.stringify(CONTENT_FILES), "Checksum rows must cover the exact allowlist in bytewise order.");

  const bytesByName = new Map();
  const textByName = new Map();
  for (const filename of CONTENT_FILES) {
    const bytes = await readContainedStableFile(directory, filename, { maximumBytes: 16 * 1024 * 1024, label: filename });
    invariant(sha256(bytes) === checksums.get(filename), `Oracle-request checksum mismatch: ${filename}`);
    bytesByName.set(filename, bytes);
    textByName.set(filename, decodeUtf8(bytes, filename));
  }

  const after = await lstat(directory, { bigint: true });
  invariant(after.dev === before.dev && after.ino === before.ino && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs, "Oracle-request directory changed during verification.");
  const finalEntries = await readdir(directory, { withFileTypes: true });
  invariant(JSON.stringify(finalEntries.map((entry) => entry.name).sort()) === JSON.stringify(EXPECTED_FILES), "Oracle-request inventory changed during verification.");
  return { bytesByName, textByName };
}

/**
 * Verify a future frozen v3 request against an out-of-band checksum-manifest
 * digest. The package cannot authenticate its own mutation: callers must pass
 * the digest from the approval/transparency channel.
 *
 * The returned `requestSummary` is deeply frozen and has the exact shape
 * consumed by `verifyOracleTranscript`: its request digest is the external
 * checksum-manifest trust root, and its target/pair rows are derived only from
 * the verified complete package. Callers must not rebuild this summary from
 * user input or certificate content.
 */
export async function verifyFrozenOracleRequest(requestDirectory, options = {}) {
  invariant(options && typeof options === "object" && !Array.isArray(options), "Verifier options are required.");
  const expectedChecksumsSha256 = options.expectedChecksumsSha256;
  const repositoryRoot = options.repositoryRoot ? path.resolve(options.repositoryRoot) : DEFAULT_REPOSITORY_ROOT;
  await verifyRepositoryTrust(repositoryRoot);
  const { bytesByName, textByName } = await readFrozenPackage(requestDirectory, expectedChecksumsSha256);

  const targets = parseCanonicalJsonl(textByName.get("target-universe.jsonl"), "target universe", 10_000);
  const developments = parseCanonicalJsonl(textByName.get("development-registry.jsonl"), "development registry", 10_000);
  const sources = parseCanonicalJsonl(textByName.get("source-manifest.jsonl"), "source manifest", 100_000);
  const pairs = parseCanonicalJsonl(textByName.get("pair-manifest.jsonl"), "pair manifest", 50_000_000);
  const mapping = parseCanonicalDocument(textByName.get("mapping-contract.json"), "mapping contract");
  const topology = parseCanonicalDocument(textByName.get("topology-ontology.json"), "topology ontology");
  const selection = parseCanonicalDocument(textByName.get("selection-contract.json"), "selection contract");
  const keyCeremony = parseCanonicalDocument(textByName.get("key-ceremony.json"), "key ceremony");
  const resource = parseCanonicalDocument(textByName.get("resource-contract.json"), "resource contract");
  const oracle = parseCanonicalDocument(textByName.get("oracle-contract.json"), "oracle contract");

  targets.forEach(verifyTarget);
  invariant(JSON.stringify(targets.map((row) => row.targetId)) === JSON.stringify(targets.map((row) => row.targetId).sort()), "Target universe must be bytewise sorted by targetId.");
  const targetById = new Map(targets.map((row) => [row.targetId, row]));
  invariant(targetById.size === targets.length, "Target universe contains duplicate IDs.");
  const candidates = targets.filter((row) => row.role === "candidate");
  const developmentTargets = targets.filter((row) => row.role === "development");
  invariant(candidates.length >= 10 && developmentTargets.length >= 1, "Oracle request requires at least ten candidates and one development target.");
  const candidateByComponent = new Map(candidates.map((row) => [row.componentId, row]));
  invariant(candidateByComponent.size === candidates.length && candidateByComponent.size >= 10, "Candidate targets must represent at least ten distinct components, one representative each.");

  developments.forEach(verifyDevelopment);
  invariant(JSON.stringify(developments.map((row) => row.targetId)) === JSON.stringify(developments.map((row) => row.targetId).sort()), "Development registry must be bytewise sorted by targetId.");
  const developmentById = new Map(developments.map((row) => [row.targetId, row]));
  invariant(developmentById.size === developments.length && developmentById.size === developmentTargets.length, "Development registry IDs are duplicate or incomplete.");
  invariant(developmentTargets.every((row) => developmentById.has(row.targetId)) && developments.every((row) => targetById.get(row.targetId)?.role === "development"), "Development registry and target universe disagree.");

  sources.forEach(verifySource);
  invariant(JSON.stringify(sources.map((row) => row.sourceId)) === JSON.stringify(sources.map((row) => row.sourceId).sort()), "Source manifest must be bytewise sorted by sourceId.");
  const sourceById = new Map(sources.map((row) => [row.sourceId, row]));
  invariant(sourceById.size === sources.length, "Source manifest contains duplicate IDs.");

  verifyMapping(mapping);
  verifyTopology(topology);
  verifySelection(selection, candidateByComponent);
  verifyResource(resource, sourceById);
  assertUtc(oracle.requestFrozenUtc, "oracle request frozen time");
  verifyKeyCeremony(keyCeremony, oracle.requestFrozenUtc);

  const referencedSources = new Map();
  const recordSource = (sourceId, expectedKind, label) => {
    const source = sourceById.get(sourceId);
    invariant(source, `${label} references missing source ${sourceId}.`);
    invariant(source.sourceKind === expectedKind, `${label} source kind mismatch for ${sourceId}.`);
    referencedSources.set(sourceId, (referencedSources.get(sourceId) ?? 0) + 1);
  };
  for (const row of targets) {
    recordSource(row.structureSourceId, "structure", row.targetId);
    recordSource(row.annotationSourceId, "annotation", row.targetId);
    recordSource(row.vhhParentEvidenceSourceId, "annotation", row.targetId);
  }
  for (const row of developments) {
    recordSource(row.developmentArtifactSourceId, "code", row.targetId);
    invariant(sourceById.get(row.developmentArtifactSourceId).sha256 === row.developmentArtifactSha256, `${row.targetId} development artifact digest mismatch.`);
  }
  recordSource(mapping.gpcrdbSnapshotSourceId, "mapping", "mapping contract");
  recordSource(mapping.constructAlignmentSourceId, "mapping", "mapping contract");
  recordSource(mapping.imgtImplementationSourceId, "code", "mapping contract");
  recordSource(mapping.parserImplementationSourceId, "code", "mapping contract");
  recordSource(topology.ontologySourceId, "ontology", "topology ontology");
  recordSource(selection.excludedComponentLedgerSourceId, "exclusion-ledger", "selection contract");
  recordSource(resource.oracleCodeSourceId, "code", "resource contract");
  recordSource(resource.containerSourceId, "container", "resource contract");
  recordSource(resource.dependencyLockSourceId, "dependency", "resource contract");
  invariant(JSON.stringify([...referencedSources.keys()].sort()) === JSON.stringify([...sourceById.keys()].sort()), "Source manifest must contain exactly the referenced source mapping, without unbound rows.");

  pairs.forEach((row, index) => verifyPair(row, index, targetById));
  const pairIds = pairs.map((row) => row.pairId);
  invariant(JSON.stringify(pairIds) === JSON.stringify([...pairIds].sort()), "Pair manifest must be bytewise sorted by pairId.");
  invariant(new Set(pairIds).size === pairIds.length, "Pair manifest contains duplicate or reversed pairs.");
  const expectedPairs = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const endpoints = [candidates[left].targetId, candidates[right].targetId].sort();
      expectedPairs.push(`${endpoints[0]}--${endpoints[1]}`);
    }
    for (const development of developmentTargets) {
      const endpoints = [candidates[left].targetId, development.targetId].sort();
      expectedPairs.push(`${endpoints[0]}--${endpoints[1]}`);
    }
  }
  expectedPairs.sort();
  invariant(JSON.stringify(pairIds) === JSON.stringify(expectedPairs), "Pair manifest omits, duplicates, reverses, or adds a forbidden unordered pair.");

  verifyOracleContract(oracle, bytesByName, {
    candidates: candidates.length,
    development: developmentTargets.length,
    components: candidateByComponent.size,
    pairs: pairs.length,
  }, keyCeremony);
  invariant(resource.maximumTargets >= targets.length && resource.maximumPairs >= pairs.length, "Frozen resource limits cannot accommodate the request.");
  invariant(resource.fixedSeedCommitmentSha256 === keyCeremony.commitmentNonceSeedCommitmentSha256, "Fixed-seed commitment substitution detected.");

  const targetManifest = Object.freeze(targets.map((row) => Object.freeze({ targetId: row.targetId, role: row.role })));
  const pairManifest = Object.freeze(pairs.map((row) => Object.freeze({
    pairId: row.pairId,
    leftId: row.leftTargetId,
    rightId: row.rightTargetId,
  })));
  const requestSummary = Object.freeze({
    requestSha256: expectedChecksumsSha256,
    requestId: oracle.requestId,
    sequenceNumber: oracle.requestSequence,
    protocolSha256: oracle.v3ProtocolSha256,
    oracleImplementationSha256: resource.oracleImplementationSha256,
    containerImageDigest: resource.containerImageDigest,
    mappingContractSha256: oracle.mappingContractSha256,
    topologyOntologySha256: oracle.topologyOntologySha256,
    signingPublicKeySpkiSha256: keyCeremony.signingPublicKeySpkiSha256,
    recipientPublicKeySpkiSha256: keyCeremony.encryptionRecipientPublicKeySpkiSha256,
    ephemeralPublicKeySpkiSha256: keyCeremony.precommittedEphemeralPublicKeySpkiSha256,
    commitmentNonceSeedCommitmentSha256: keyCeremony.commitmentNonceSeedCommitmentSha256,
    paddingSeedCommitmentSha256: keyCeremony.paddingSeedCommitmentSha256,
    authorizationReceiptSha256: keyCeremony.authorizationReceiptSha256,
    transparencyLogKeyFingerprintSha256: keyCeremony.transparencyLogKeyFingerprintSha256,
    transparencyChallengeSha256: keyCeremony.transparencyChallengeSha256,
    targetManifest,
    pairManifest,
  });
  const verified = Object.freeze({
    state: oracle.state,
    requestId: oracle.requestId,
    requestSequence: oracle.requestSequence,
    checksumManifestSha256: expectedChecksumsSha256,
    candidateTargets: candidates.length,
    candidateComponents: candidateByComponent.size,
    developmentTargets: developmentTargets.length,
    pairCount: pairs.length,
    benchmarkExecutionAuthorized: oracle.benchmarkExecutionAuthorized,
    requestSummary,
  });
  VERIFIED_REQUESTS.add(verified);
  return verified;
}

export function isVerifiedFrozenOracleRequest(value) {
  return Boolean(value && typeof value === "object" && Object.isFrozen(value) && VERIFIED_REQUESTS.has(value));
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  try {
    invariant(process.argv[2] && process.argv[3], "Usage: node verify-oracle-request.mjs <request-directory> <externally-pinned-checksums-sha256> [repository-root]");
    const result = await verifyFrozenOracleRequest(path.resolve(process.argv[2]), {
      expectedChecksumsSha256: process.argv[3],
      repositoryRoot: process.argv[4] ? path.resolve(process.argv[4]) : DEFAULT_REPOSITORY_ROOT,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
