import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson } from "../../scripts/hard-decoy/oracle/canonical-json.mjs";

const CONTENT_FILES = [
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

export const V3_REQUEST_TRUST = Object.freeze({
  v1: "9a6c441d844069f52f87e60fa2cf00dfc671b588a19454d0479d188e4cb46c1f",
  v2: "9c38f2d2f7ed2ce4acd5b6730fedd6a37151fe992a808bfefc4268888f862421",
  v3: "1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376",
  census: "e2020cf5863246058d3c89d974b49da0d5d41803904b899670712f1509609502",
  design: "dbc489509f38deb467016fa96a2f45a6d63c14a5804865569b222fa2bf1e97fd",
  engineCommit: "04c6bda2289157dd294c290609f6052aa0ef9195",
  engineTree: "1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9",
});

export function v3FixtureSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalV3Jsonl(rows) {
  return `${rows.map((row) => canonicalJson(row)).join("\n")}\n`;
}

export function makeV3RequestSource(sourceId, sourceKind) {
  return {
    schemaVersion: "1.0.0",
    sourceId,
    sourceKind,
    objectId: sourceId.replace(/^SRC-/u, "OBJECT:"),
    url: `https://example.org/sources/${sourceId}`,
    retrievedUtc: "2026-01-01T00:00:00Z",
    byteLength: 1_000 + sourceId.length,
    sha256: v3FixtureSha256(`source:${sourceId}`),
    spdxLicense: "CC0-1.0",
    httpStatus: 200,
    responseMetadataSha256: v3FixtureSha256(`response:${sourceId}`),
  };
}

function makeTarget(targetId, role, number) {
  const prefix = role === "candidate" ? "C" : "D";
  const suffix = String(number).padStart(3, "0");
  const tm = "ACDEFGHIKLMNPQRSTVWY".repeat(3);
  const construct = `${"M".repeat(12)}${tm}${"A".repeat(12)}`;
  const framework = "QVQLVESGGGLVQPGGSLRLSCAAS";
  const cdr1 = "GFTF";
  const cdr2 = "ISWG";
  const cdr3 = `ARD${"ACDEFGHIKLMNPQRSTVWY"[number % 20]}Y`;
  const vhh = `${framework}${cdr1}WYRQAPGKEREFVAAI${cdr2}SGSTYYADSVKGRFTISRDNAKNTVYLQMNSLKPEDTAVYYC${cdr3}WGQGTQVTVSS`;
  const accession = `${role === "candidate" ? "P" : "Q"}${String(number).padStart(5, "0")}`;
  return {
    schemaVersion: "1.0.0",
    targetId,
    role,
    componentId: `COMP-${String(role === "candidate" ? number : 900 + number).padStart(3, "0")}`,
    structureSourceId: `SRC-STRUCT-${prefix}${suffix}`,
    annotationSourceId: `SRC-ANN-${prefix}${suffix}`,
    publicationId: `DOI:10.1000/${role}.${suffix}`,
    assemblySelector: "1",
    modelSelector: 1,
    receptorChainCopy: "A#1",
    vhhChainCopy: "B#1",
    receptorEntityId: `UNIPROT:${accession}`,
    receptorCanonicalAccession: accession,
    receptorConstructSequence: construct,
    receptorConstructSequenceSha256: v3FixtureSha256(construct),
    receptorTm1Tm7Sequence: tm,
    receptorTm1Tm7SequenceSha256: v3FixtureSha256(tm),
    receptorAlignmentSha256: v3FixtureSha256(`alignment:${targetId}`),
    vhhEntityId: `VHH:${targetId}`,
    vhhSequence: vhh,
    vhhSequenceSha256: v3FixtureSha256(vhh),
    vhhImgtNumberingSha256: v3FixtureSha256(`imgt:${targetId}`),
    vhhFrameworkSequence: framework,
    vhhCdr1Sequence: cdr1,
    vhhCdr2Sequence: cdr2,
    vhhCdr3Sequence: cdr3,
    vhhParentEvidenceSourceId: `SRC-ANN-${prefix}${suffix}`,
    mappingContractId: "MAPPING-CONTRACT-1",
    selectionOrdinal: 1,
  };
}

export async function writeV3RequestChecksumManifest(directory) {
  const rows = [];
  for (const filename of CONTENT_FILES) {
    rows.push(`${v3FixtureSha256(await readFile(path.join(directory, filename)))}  ${filename}`);
  }
  const bytes = Buffer.from(`${rows.join("\n")}\n`);
  await writeFile(path.join(directory, "checksums.sha256"), bytes);
  return v3FixtureSha256(bytes);
}

export async function rebindV3OracleRequest(directory, mutateOracle = (value) => value) {
  const oraclePath = path.join(directory, "oracle-contract.json");
  const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  const fieldByFile = {
    "development-registry.jsonl": "developmentRegistrySha256",
    "key-ceremony.json": "keyCeremonySha256",
    "mapping-contract.json": "mappingContractSha256",
    "pair-manifest.jsonl": "pairManifestSha256",
    "resource-contract.json": "resourceContractSha256",
    "selection-contract.json": "selectionContractSha256",
    "source-manifest.jsonl": "sourceManifestSha256",
    "target-universe.jsonl": "targetUniverseSha256",
    "topology-ontology.json": "topologyOntologySha256",
  };
  for (const [filename, field] of Object.entries(fieldByFile)) {
    oracle[field] = v3FixtureSha256(await readFile(path.join(directory, filename)));
  }
  const next = mutateOracle(oracle) ?? oracle;
  await writeFile(oraclePath, canonicalJson(next));
  return writeV3RequestChecksumManifest(directory);
}

/**
 * Build a canonical, synthetic v3 request package with no native structures or
 * labels. Key-ceremony overrides allow transcript tests to bind real ephemeral
 * test keys before the package is verified.
 */
export async function buildV3RequestFixture(options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-request-"));
  const directory = path.join(temporary, "request");
  await mkdir(directory, { mode: 0o700 });
  const candidateCount = options.candidateCount ?? 10;
  const developmentCount = options.developmentCount ?? 2;
  const candidates = Array.from(
    { length: candidateCount },
    (_, index) => makeTarget(`CAND-${String(index + 1).padStart(3, "0")}`, "candidate", index + 1),
  );
  const developments = Array.from(
    { length: developmentCount },
    (_, index) => makeTarget(`DEV-${String(index + 1).padStart(3, "0")}`, "development", index + 1),
  );
  const targets = [...candidates, ...developments].sort((left, right) => left.targetId.localeCompare(right.targetId));

  const developmentRegistry = developments.map((row, index) => ({
    schemaVersion: "1.0.0",
    targetId: row.targetId,
    developmentArtifactSourceId: `SRC-DEVART-D${String(index + 1).padStart(3, "0")}`,
    developmentArtifactSha256: v3FixtureSha256(`source:SRC-DEVART-D${String(index + 1).padStart(3, "0")}`),
    inclusionEvidenceSha256: v3FixtureSha256(`development-inclusion:${row.targetId}`),
    frozenEngineCommit: V3_REQUEST_TRUST.engineCommit,
    useClass: "frozen-score-development",
  })).sort((left, right) => left.targetId.localeCompare(right.targetId));

  const sources = [];
  for (const row of targets) {
    sources.push(makeV3RequestSource(row.structureSourceId, "structure"), makeV3RequestSource(row.annotationSourceId, "annotation"));
  }
  for (const row of developmentRegistry) sources.push(makeV3RequestSource(row.developmentArtifactSourceId, "code"));
  for (const [sourceId, kind] of [
    ["SRC-ALIGNMENTS", "mapping"], ["SRC-CONTAINER", "container"], ["SRC-DEPENDENCY", "dependency"],
    ["SRC-EXCLUSIONS", "exclusion-ledger"], ["SRC-GPCRDB", "mapping"], ["SRC-IMGT", "code"],
    ["SRC-ONTOLOGY", "ontology"], ["SRC-ORACLE-CODE", "code"], ["SRC-PARSER", "code"],
  ]) sources.push(makeV3RequestSource(sourceId, kind));
  sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const pairs = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const endpoints = [candidates[left].targetId, candidates[right].targetId].sort();
      pairs.push({
        schemaVersion: "1.0.0",
        pairId: `${endpoints[0]}--${endpoints[1]}`,
        leftTargetId: endpoints[0],
        rightTargetId: endpoints[1],
        pairKind: "candidate-candidate",
      });
    }
    for (const development of developments) {
      const endpoints = [candidates[left].targetId, development.targetId].sort();
      pairs.push({
        schemaVersion: "1.0.0",
        pairId: `${endpoints[0]}--${endpoints[1]}`,
        leftTargetId: endpoints[0],
        rightTargetId: endpoints[1],
        pairKind: "candidate-development",
      });
    }
  }
  pairs.sort((left, right) => left.pairId.localeCompare(right.pairId));

  const mapping = {
    schemaVersion: "1.0.0",
    contractId: "MAPPING-CONTRACT-1",
    gpcrdbSnapshotSourceId: "SRC-GPCRDB",
    constructAlignmentSourceId: "SRC-ALIGNMENTS",
    imgtImplementationSourceId: "SRC-IMGT",
    parserImplementationSourceId: "SRC-PARSER",
    modifiedResiduePolicy: "pinned-protein-map-else-fail-closed",
    alternateConformerPolicy: "highest-occupancy-whole-residue-then-bytewise",
    occupancyPolicy: "finite-positive-only",
    insertionCodePolicy: "preserve-explicitly",
    assemblyOperationPolicy: "exact-preselected-operator-chain-copy",
    malformedRecordPolicy: "FAIL_CLOSED",
    everyContactingReceptorResidueMapped: true,
    mappingUnknownPolicy: "FAIL_CLOSED",
    contactDistanceAngstrom: 5,
    contactDistanceBoundary: "inclusive",
    minimumUniqueResiduePairs: 8,
  };
  const topology = {
    schemaVersion: "1.0.0",
    ontologyId: "TOPOLOGY-ONTOLOGY-1",
    ontologySourceId: "SRC-ONTOLOGY",
    tokenVersion: "1.0.0",
    regionTokens: ["ECL1", "ECL2", "ECL3", "H8", "ICL1", "ICL2", "ICL3", "NTERM"],
  };
  const selection = {
    schemaVersion: "1.0.0",
    contractId: "SELECTION-CONTRACT-1",
    priority: [
      "direct-non-fusion-receptor-vhh-construct",
      "complete-assembly-and-unambiguous-chain-copies",
      "higher-resolution-experimental-model",
      "fewer-unresolved-receptor-vhh-backbone-residues",
      "earlier-pdb-release-date",
      "bytewise-pdb-id",
    ],
    representativeSelectionFrozen: true,
    failureSubstitutionPolicy: "forbidden",
    excludedComponentLedgerSourceId: "SRC-EXCLUSIONS",
    candidateRepresentatives: candidates.map((row) => ({ componentId: row.componentId, targetId: row.targetId, selectionOrdinal: 1 })),
  };

  const keyCeremony = {
    schemaVersion: "1.0.0",
    ceremonyId: "KEY-CEREMONY-1",
    sequenceNumber: 1,
    signingAlgorithm: "Ed25519",
    signingPublicKeySpkiSha256: v3FixtureSha256("signing-key"),
    signingKeyFingerprintSha256: v3FixtureSha256("signing-key"),
    evidenceEncryptionAlgorithm: "X25519-HKDF-SHA256-AES-256-GCM",
    encryptionRecipientPublicKeySpkiSha256: v3FixtureSha256("recipient-key"),
    encryptionRecipientFingerprintSha256: v3FixtureSha256("recipient-key"),
    precommittedEphemeralPublicKeySpkiSha256: v3FixtureSha256("ephemeral-public-key"),
    precommittedEphemeralSecretCommitmentSha256: v3FixtureSha256("ephemeral-secret"),
    commitmentNonceSeedCommitmentSha256: v3FixtureSha256("commitment-nonce-seed"),
    paddingSeedCommitmentSha256: v3FixtureSha256("padding-seed"),
    transparencyLogKeyFingerprintSha256: v3FixtureSha256("transparency-key"),
    transparencyChallengeSha256: v3FixtureSha256("transparency-challenge"),
    authorizationReceiptSha256: v3FixtureSha256("authorization-receipt"),
    authorizationScope: "freeze-whole-batch-oracle-request-only",
    entropyCommitmentDomain: "confovhh-hard-decoy-v3-oracle-request-1",
    frozenUtc: "2026-01-02T00:00:00Z",
    ...options.keyCeremonyOverrides,
  };
  const sourceById = new Map(sources.map((row) => [row.sourceId, row]));
  const resource = {
    schemaVersion: "1.0.0",
    contractId: "RESOURCE-CONTRACT-1",
    oracleCodeSourceId: "SRC-ORACLE-CODE",
    oracleImplementationSha256: sourceById.get("SRC-ORACLE-CODE").sha256,
    containerSourceId: "SRC-CONTAINER",
    containerImageDigest: `sha256:${sourceById.get("SRC-CONTAINER").sha256}`,
    dependencyLockSourceId: "SRC-DEPENDENCY",
    dependencyLockSha256: sourceById.get("SRC-DEPENDENCY").sha256,
    parserVersion: "independent-oracle-parser-1.0.0",
    runtimeVersion: "node-v22.18.0",
    fixedSeedCommitmentSha256: keyCeremony.commitmentNonceSeedCommitmentSha256,
    maximumInputBytes: 100_000_000,
    maximumTargets: 1_000,
    maximumPairs: 1_000_000,
    maximumAtomsPerTarget: 1_000_000,
    maximumResiduesPerTarget: 100_000,
    maximumWallSeconds: 86_400,
    maximumMemoryBytes: 64_000_000_000,
    sourceMountReadOnly: true,
    networkAfterStaging: "disabled",
    outputCount: 2,
    stdoutPolicy: "fixed-status-only",
    malformedInputPolicy: "FAIL_CLOSED",
    rerunPolicy: "same-version-forbidden",
    failedAttemptRetentionPolicy: "retain-every-attempt-without-replacement",
    ...options.resourceOverrides,
  };

  const documents = {
    "target-universe.jsonl": canonicalV3Jsonl(targets),
    "development-registry.jsonl": canonicalV3Jsonl(developmentRegistry),
    "source-manifest.jsonl": canonicalV3Jsonl(sources),
    "pair-manifest.jsonl": canonicalV3Jsonl(pairs),
    "mapping-contract.json": canonicalJson(mapping),
    "topology-ontology.json": canonicalJson(topology),
    "selection-contract.json": canonicalJson(selection),
    "key-ceremony.json": canonicalJson(keyCeremony),
    "resource-contract.json": canonicalJson(resource),
  };
  for (const [filename, value] of Object.entries(documents)) await writeFile(path.join(directory, filename), value);
  const fileDigest = async (filename) => v3FixtureSha256(await readFile(path.join(directory, filename)));
  const oracle = {
    schemaVersion: "1.0.0",
    protocolId: "confovhh-hard-decoy-v3",
    state: "ORACLE_REQUEST_FROZEN",
    oracleRequestFrozen: true,
    requestId: "REQUEST-0123456789ABCDEF",
    requestSequence: 1,
    requestMode: "one-nonadaptive-whole-batch",
    canonicalizationProfile: "confovhh-canonical-json-v1",
    requestFrozenUtc: "2026-01-03T00:00:00Z",
    targetUniverseSha256: await fileDigest("target-universe.jsonl"),
    developmentRegistrySha256: await fileDigest("development-registry.jsonl"),
    sourceManifestSha256: await fileDigest("source-manifest.jsonl"),
    pairManifestSha256: await fileDigest("pair-manifest.jsonl"),
    mappingContractSha256: await fileDigest("mapping-contract.json"),
    topologyOntologySha256: await fileDigest("topology-ontology.json"),
    selectionContractSha256: await fileDigest("selection-contract.json"),
    keyCeremonySha256: await fileDigest("key-ceremony.json"),
    resourceContractSha256: await fileDigest("resource-contract.json"),
    candidateTargetCount: candidates.length,
    developmentTargetCount: developments.length,
    candidateComponentCount: candidates.length,
    expectedPairCount: pairs.length,
    v1ProtocolSha256: V3_REQUEST_TRUST.v1,
    v2ProtocolSha256: V3_REQUEST_TRUST.v2,
    v3ProtocolSha256: V3_REQUEST_TRUST.v3,
    v2BlockedCensusManifestSha256: V3_REQUEST_TRUST.census,
    designRecordManifestSha256: V3_REQUEST_TRUST.design,
    engineCommit: V3_REQUEST_TRUST.engineCommit,
    engineTree: V3_REQUEST_TRUST.engineTree,
    authorizationReceiptSha256: keyCeremony.authorizationReceiptSha256,
    benchmarkExecutionAuthorized: false,
    benchmarkExecutionApprovalSha256: null,
    ...options.oracleOverrides,
  };
  await writeFile(path.join(directory, "oracle-contract.json"), canonicalJson(oracle));
  const root = await writeV3RequestChecksumManifest(directory);
  return {
    temporary,
    directory,
    root,
    candidates,
    developments,
    targets,
    pairs,
    keyCeremony,
    resource,
    oracle,
  };
}
