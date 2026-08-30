import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDevelopmentMetadataSnapshot } from "../hard-decoy/v3-development-metadata.mjs";
import { verifyDispositionSeed } from "../hard-decoy/v3-disposition-seed.mjs";
import { verifyEntryMetadataSnapshot } from "../hard-decoy/v3-entry-metadata.mjs";
import { verifyExactEvidencePregraph } from "../hard-decoy/v3-exact-evidence-pregraph.mjs";
import { verifyVhhSequencePregraph } from "../hard-decoy/v3-vhh-sequence-pregraph.mjs";
import { verifySourceUniverse } from "../hard-decoy/v3-source-universe.mjs";
import { verifyV3CensusContracts } from "../hard-decoy/verify-v3-census-contracts.mjs";
import { verifyDesignRecord } from "./verify-design-record.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const STATE_RELATIVE = "validation/hard-decoy-holdout-v3/INTEGRATION_STATE_2026-08-29.json";
const EXPECTED_STATE_SHA256 = "e06e92945c8591d1ca64a12f8f352ecd682de36ffc9083e248ea2c3c52c64ec1";
const SHA256 = /^[a-f0-9]{64}$/u;

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBoundRegularFile(filename, maximumBytes = 128 * 1024) {
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${filename} must be one direct regular file.`);
  ok(info.size <= BigInt(maximumBytes), `${filename} exceeds its verification byte cap.`);
  const bytes = await readFile(filename);
  ok(bytes.byteLength <= maximumBytes, `${filename} changed beyond its verification byte cap.`);
  return bytes;
}

async function requireDigest(root, relative, expected) {
  ok(SHA256.test(expected), `Invalid expected SHA-256 for ${relative}.`);
  ok(!path.isAbsolute(relative) && relative.split("/").every((part) => part && part !== "." && part !== ".."), `Unsafe integration-state path: ${relative}`);
  const filename = path.join(root, relative);
  ok(await realpath(filename) === path.resolve(filename), `Integration-state path cannot traverse a symlink: ${relative}`);
  const bytes = await readBoundRegularFile(filename, 64 * 1024 * 1024);
  ok(sha256(bytes) === expected, `Integration-state digest mismatch: ${relative}`);
  return bytes;
}

function exactKeys(value, expected, label) {
  ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  ok(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields drifted.`);
}

function allFalse(record, fields, label) {
  for (const field of fields) ok(record[field] === false, `${label} field must remain false: ${field}`);
}

async function verifyBoundedCensusAudit(root, census) {
  const expectedFiles = ["README.md", "access-state.json", "audit-state.json", "dispositions.jsonl", "provenance.json", "verify.mjs", "verify.test.mjs"];
  const checksumBytes = await requireDigest(root, census.boundedAuditChecksumsPath, census.boundedAuditChecksumsSha256);
  const checksumText = new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes);
  ok(checksumText.endsWith("\n"), "Bounded census-audit checksums must end with LF.");
  const rows = checksumText.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `Bounded census-audit checksum row ${index + 1} is invalid.`);
    return { digest: match[1], relative: match[2] };
  });
  ok(new Set(rows.map(({ relative }) => relative)).size === rows.length, "Bounded census-audit checksum paths must be unique.");
  ok(JSON.stringify(rows.map(({ relative }) => relative).sort()) === JSON.stringify(expectedFiles), "Bounded census-audit checksum inventory drifted.");
  const packageDirectory = path.dirname(census.boundedAuditChecksumsPath);
  const files = new Map();
  for (const row of rows) files.set(row.relative, await requireDigest(root, `${packageDirectory}/${row.relative}`, row.digest));
  const decode = (relative) => new TextDecoder("utf-8", { fatal: true }).decode(files.get(relative));
  const audit = JSON.parse(decode("audit-state.json"));
  const access = JSON.parse(decode("access-state.json"));
  ok(audit.schemaVersion === "1.0.0" && audit.studyId === "confovhh-hard-decoy-holdout-v3" && audit.artifactId === census.boundedAuditArtifactId, "Bounded census-audit identity drifted.");
  ok(audit.requiredIndependentComponents === census.requiredIndependentGroups
    && audit.existingProvisionalComponentCount === census.provisionalGroups
    && audit.formallyClearedComponentCount === census.formallyClearedGroups
    && audit.newIndependentComponentCount === census.boundedAuditNewGroups,
  "Bounded census-audit group accounting disagrees with the integration state.");
  ok(audit.reviewedLedgerRecordCount === census.boundedAuditReviewedLedgerRecords && audit.reviewedPdbEntryCount === census.boundedAuditReviewedPdbEntries, "Bounded census-audit review accounting drifted.");
  allFalse(audit, ["sourceUniverseFrozen", "dispositionLedgerComplete", "leakageGraphComplete", "targetManifestFrozen", "targetFreezeReady"], "Bounded census audit");
  allFalse(access, [
    "nativeHoldoutCoordinatesAccessed", "coordinateFilesDownloaded", "coordinateEndpointsRequested", "nativeRelativeReceptorVhhPosesInspected",
    "nativeStructuresVisualized", "coordinateDerivedContactsCalculated", "coordinateDerivedInterfacesCalculated", "dockqValuesAccessed",
    "capriLabelsAccessed", "fnatIrmsdLrmsdAccessed", "confoVhhHoldoutScoresGenerated", "candidateGeneratorOutputsAccessed",
    "holdoutPerformanceResultsAccessed", "rawHttpResponseBytesPreserved", "repeatResponseEqualityRecorded", "sourceUniverseFrozen",
    "dispositionLedgerComplete", "leakageMatricesComplete", "targetFreezePermitted", "executionAuthorized",
  ], "Bounded census audit access");
  ok(access.metadataOnly === true, "Bounded census audit must remain metadata-only.");
  const dispositionsText = decode("dispositions.jsonl");
  ok(dispositionsText.endsWith("\n"), "Bounded census-audit dispositions must end with LF.");
  const dispositions = dispositionsText.trimEnd().split("\n").map((line) => JSON.parse(line));
  ok(dispositions.length === census.boundedAuditReviewedLedgerRecords, "Bounded census-audit disposition count drifted.");
  const pdbIds = dispositions.flatMap((row) => {
    ok(row.directInterfaceEvidence?.coordinatesInspected === false, "Bounded census-audit disposition improperly claims coordinate inspection.");
    ok(Array.isArray(row.pdbIds), "Bounded census-audit disposition lacks PDB identifiers.");
    return row.pdbIds;
  });
  ok(pdbIds.length === census.boundedAuditReviewedPdbEntries && new Set(pdbIds).size === pdbIds.length, "Bounded census-audit PDB accounting drifted.");
  return {
    requiredIndependentGroups: audit.requiredIndependentComponents,
    provisionalGroups: audit.existingProvisionalComponentCount,
    formallyClearedGroups: audit.formallyClearedComponentCount,
    newIndependentGroups: audit.newIndependentComponentCount,
    reviewedLedgerRecords: dispositions.length,
    reviewedPdbEntries: pdbIds.length,
  };
}

function validateBlockedState(state) {
  ok(state.schemaVersion === "1.2.0" && state.studyId === "confovhh-hard-decoy-holdout-v3", "Integration-state identity drifted.");
  ok(state.status === "DRAFT", "The incomplete v3 census must remain in the protocol DRAFT state.");
  exactKeys(state.targetFreezeGate, ["status", "minimumSatisfied", "discoveryComplete", "dispositionLedgerComplete", "statement"], "Target-freeze gate");
  ok(state.targetFreezeGate.status === "BLOCKED", "Target freeze must remain blocked.");
  allFalse(state.targetFreezeGate, ["minimumSatisfied", "discoveryComplete", "dispositionLedgerComplete"], "Target-freeze gate");

  ok(state.selectedProtocol.path === "HARD_DECOY_PROTOCOL_V3.md" && state.selectedProtocol.epitopeDesign === "sealed-one-way-native-epitope-boolean-oracle", "Selected protocol drifted.");
  ok(state.historicalAncestry.annotationDraftAdvancementAuthority === false && state.historicalAncestry.annotationEpitopeEligibilityAuthority === false, "The archived annotation draft cannot authorize eligibility.");
  ok(state.sourceUniverse.role === "frozen-historical-four-term-sub-universe-not-exhaustive-candidate-universe" && state.sourceUniverse.broaderDiscoveryComplete === false, "Source-universe claim boundary drifted.");
  ok(state.sourceUniverse.rcsbUnionEntries === 2065 && state.sourceUniverse.gpcrdbEntries === 1716 && state.sourceUniverse.intersectionEntries === 287, "Source-universe counts drifted.");

  ok(state.entryMetadata.entries === 287 && state.entryMetadata.polymerEntities === 1401 && state.entryMetadata.repeatedRawResponses === 24, "Entry-metadata counts drifted.");
  ok(state.entryMetadata.snapshotPendingDispositionRows === 287 && state.entryMetadata.formalEligibilityAuthority === false, "Entry metadata cannot be treated as eligibility evidence.");
  ok(state.entryMetadata.independentCaptureCount === 2, "Both independent entry-metadata captures must remain bound.");
  exactKeys(state.entryMetadata.normalizedOutputSha256, ["entries", "entities", "triageSignals"], "Entry-metadata normalized-output digests");
  ok(Object.values(state.entryMetadata.normalizedOutputSha256).every((value) => SHA256.test(value)), "Entry-metadata normalized-output digest is invalid.");

  ok(state.dispositionSeed.rows === 287 && state.dispositionSeed.resolvedRows === 15 && state.dispositionSeed.pendingRows === 272, "Disposition-seed accounting drifted.");
  ok(state.dispositionSeed.exactDevelopmentPdbExclusions === 15 && state.dispositionSeed.provisionalDirectTargets === 0 && state.dispositionSeed.formalEligibilityAuthority === false, "Disposition-seed authority or exact-exclusion accounting drifted.");

  ok(state.developmentMetadata.nodes === 17 && state.developmentMetadata.reusedMetadataNodes === 15 && state.developmentMetadata.newlyCompletedMetadataNodes === 2, "Development-metadata node accounting drifted.");
  ok(JSON.stringify(state.developmentMetadata.newlyCompletedPdbIds) === JSON.stringify(["6KNM", "6O3C"]), "Development-metadata completion set drifted.");
  ok(state.developmentMetadata.uniquePreferredReceptorEntities === 17 && state.developmentMetadata.singleUniProtReceptorNodes === 10, "Development receptor metadata accounting drifted.");
  ok(state.developmentMetadata.uniqueVhhMetadataCandidates === 16 && state.developmentMetadata.multipleVhhMetadataCandidates === 1, "Development VHH metadata accounting drifted.");
  ok(state.developmentMetadata.directInterfaceEvidenceResolvedNodes === 0 && state.developmentMetadata.formalLeakageAuthority === false, "Development metadata improperly gained scientific authority.");

  ok(state.exactEvidencePregraph.candidateNodes === 287 && state.exactEvidencePregraph.developmentNodes === 17 && state.exactEvidencePregraph.totalNodes === 304, "Exact-evidence node accounting drifted.");
  ok(state.exactEvidencePregraph.allUnorderedPairs === 46056 && state.exactEvidencePregraph.positiveEvidencePairs === 3013, "Exact-evidence pair accounting drifted.");
  ok(state.exactEvidencePregraph.definiteEvidencePairs === 823 && state.exactEvidencePregraph.exactVhhRoleUnresolvedPairs === 1551 && state.exactEvidencePregraph.ambiguousEvidencePairs === 639, "Exact-evidence classification accounting drifted.");
  ok(state.exactEvidencePregraph.definiteEvidenceComponents === 100 && state.exactEvidencePregraph.inclusiveEvidenceComponents === 18, "Exact-evidence component accounting drifted.");
  ok(state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByDefiniteEvidence === 33 && state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByInclusiveEvidence === 262, "Exact-evidence development-connectivity accounting drifted.");
  ok(state.exactEvidencePregraph.formalLeakageGraphAuthority === false && state.exactEvidencePregraph.formalNoEdgeAuthority === false, "Exact-evidence pregraph gained formal graph authority.");

  ok(state.vhhSequencePregraph.status === "VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION", "VHH sequence pregraph status drifted.");
  ok(state.vhhSequencePregraph.numberingEngine === "immunum 1.3.0" && state.vhhSequencePregraph.completeImgtRegionCoverageRequired === true && state.vhhSequencePregraph.numberingSegmentationAgreementRequired === true, "Corrected VHH numbering policy drifted.");
  ok(state.vhhSequencePregraph.candidateNodes === 287 && state.vhhSequencePregraph.developmentNodes === 17 && state.vhhSequencePregraph.totalNodes === 304, "VHH sequence node accounting drifted.");
  ok(state.vhhSequencePregraph.totalMetadataProfiles === 303 && state.vhhSequencePregraph.numberedProfiles === 302 && state.vhhSequencePregraph.unavailableProfiles === 1, "VHH sequence profile accounting drifted.");
  ok(state.vhhSequencePregraph.allUnorderedPairs === 46056 && state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs === 20859 && state.vhhSequencePregraph.exactFullSequenceEvidencePairs === 2023, "VHH sequence pair accounting drifted.");
  exactKeys(state.vhhSequencePregraph.matrixStatusCounts, ["FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE", "NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY", "POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED"], "VHH matrix status counts");
  ok(state.vhhSequencePregraph.matrixStatusCounts.FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE === 1803 && state.vhhSequencePregraph.matrixStatusCounts.NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY === 23394 && state.vhhSequencePregraph.matrixStatusCounts.POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED === 20859, "VHH matrix status accounting drifted.");
  ok(state.vhhSequencePregraph.thresholdPregraphComponents === 34 && state.vhhSequencePregraph.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge === 57, "VHH component/connectivity accounting drifted.");
  for (const field of ["checksumsSha256", "manifestSha256", "summarySha256", "contractSha256", "attestationSha256", "correctionRecordSha256", "dependencyLockSha256", "generatorScriptSha256"]) ok(SHA256.test(state.vhhSequencePregraph[field]), `Invalid VHH integration digest: ${field}`);
  allFalse(state.vhhSequencePregraph, ["directBinderRolesResolved", "knownParentVariantEvidenceComplete", "formalLeakageGraphAuthority", "formalNoEdgeAuthority", "targetEligibilityAuthority"], "VHH sequence pregraph");

  ok(state.census.requiredIndependentGroups === 10 && state.census.provisionalGroups === 7 && state.census.formallyClearedGroups === 0 && state.census.boundedAuditNewGroups === 0, "Census accounting drifted.");
  ok(state.census.boundedAuditArtifactId === "census-audit-2026-08-29" && state.census.boundedAuditReviewedLedgerRecords === 13 && state.census.boundedAuditReviewedPdbEntries === 20, "Bounded census-audit accounting drifted.");
  allFalse(state.census, ["dispositionLedgerComplete", "leakageGraphComplete", "minimumSatisfied", "targetManifestFrozen"], "Census");

  ok(state.oracle.designSelected === true, "The sealed-oracle design must remain selected.");
  allFalse(state.oracle, ["requestFrozen", "independentImplementationContainerFrozen", "keyCeremonyCompleted", "executed", "opened"], "Oracle");
  const labelBoundaryFields = ["nativeCoordinatesAccessedDuringV3Preparation", "nativeRelativePosesInspectedDuringV3Preparation", "dockqOrCapriLabelsAccessedDuringV3Preparation", "confovhhHoldoutScoresAccessed", "holdoutPerformanceResultsAccessed"];
  exactKeys(state.labelBoundary, labelBoundaryFields, "Integration label boundary");
  allFalse(state.labelBoundary, labelBoundaryFields, "Integration label boundary");
  allFalse(state.authorization, ["approvalReady", "userApproved", "executionAuthorized"], "Authorization");
  const requiredBlockers = [
    "272-source-entries-still-pending-scientific-disposition",
    "direct-receptor-vhh-interface-and-construct-adjudication-incomplete",
    "canonical-TM1-through-TM7-receptor-matrix-unfrozen",
    "vhh-direct-role-and-known-parent-adjudication-incomplete",
    "formal-publication-and-candidate-component-graph-incomplete",
    "sealed-native-epitope-oracle-request-and-custody-unfrozen",
    "broader-candidate-discovery-incomplete",
    "fewer-than-ten-formally-cleared-leakage-components",
  ];
  ok(requiredBlockers.every((blocker) => state.authorization.blockers.includes(blocker)), "One or more required authorization blockers are missing.");
  return state;
}

export async function verifyIntegrationState(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const stateBytes = await readBoundRegularFile(path.join(root, STATE_RELATIVE));
  ok(sha256(stateBytes) === EXPECTED_STATE_SHA256, "Integration-state root differs from the externally pinned verifier root.");
  const state = validateBlockedState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stateBytes)));

  await Promise.all([
    requireDigest(root, state.selectedProtocol.path, state.selectedProtocol.sha256),
    requireDigest(root, state.selectedProtocol.designChecksumsPath, state.selectedProtocol.designChecksumsSha256),
    requireDigest(root, state.historicalAncestry.annotationDraftChecksumsPath, state.historicalAncestry.annotationDraftChecksumsSha256),
    requireDigest(root, state.sourceUniverse.checksumsPath, state.sourceUniverse.checksumsSha256),
    requireDigest(root, state.sourceUniverse.importReceiptPath, state.sourceUniverse.importReceiptSha256),
    requireDigest(root, state.sourceUniverse.licenseRecordPath, state.sourceUniverse.licenseRecordSha256),
    requireDigest(root, state.entryMetadata.checksumsPath, state.entryMetadata.checksumsSha256),
    requireDigest(root, state.entryMetadata.attestationPath, state.entryMetadata.attestationSha256),
    requireDigest(root, state.entryMetadata.independentReplayChecksumsPath, state.entryMetadata.independentReplayChecksumsSha256),
    requireDigest(root, state.dispositionSeed.checksumsPath, state.dispositionSeed.checksumsSha256),
    requireDigest(root, state.dispositionSeed.summaryPath, state.dispositionSeed.summarySha256),
    requireDigest(root, state.developmentMetadata.checksumsPath, state.developmentMetadata.checksumsSha256),
    requireDigest(root, state.developmentMetadata.attestationPath, state.developmentMetadata.attestationSha256),
    requireDigest(root, state.exactEvidencePregraph.checksumsPath, state.exactEvidencePregraph.checksumsSha256),
    requireDigest(root, state.exactEvidencePregraph.attestationPath, state.exactEvidencePregraph.attestationSha256),
    requireDigest(root, state.vhhSequencePregraph.checksumsPath, state.vhhSequencePregraph.checksumsSha256),
    requireDigest(root, state.vhhSequencePregraph.manifestPath, state.vhhSequencePregraph.manifestSha256),
    requireDigest(root, state.vhhSequencePregraph.summaryPath, state.vhhSequencePregraph.summarySha256),
    requireDigest(root, state.vhhSequencePregraph.contractPath, state.vhhSequencePregraph.contractSha256),
    requireDigest(root, state.vhhSequencePregraph.attestationPath, state.vhhSequencePregraph.attestationSha256),
    requireDigest(root, state.vhhSequencePregraph.correctionRecordPath, state.vhhSequencePregraph.correctionRecordSha256),
    requireDigest(root, state.vhhSequencePregraph.dependencyLockPath, state.vhhSequencePregraph.dependencyLockSha256),
    requireDigest(root, state.vhhSequencePregraph.generatorScriptPath, state.vhhSequencePregraph.generatorScriptSha256),
  ]);

  const primaryEntryDirectory = path.dirname(state.entryMetadata.checksumsPath);
  const replayEntryDirectory = path.dirname(state.entryMetadata.independentReplayChecksumsPath);
  for (const [field, relative] of [["entries", "entries.jsonl"], ["entities", "entities.jsonl"], ["triageSignals", "triage-signals.jsonl"]]) {
    const expected = state.entryMetadata.normalizedOutputSha256[field];
    await requireDigest(root, `${primaryEntryDirectory}/${relative}`, expected);
    await requireDigest(root, `${replayEntryDirectory}/${relative}`, expected);
  }

  const importReceipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.sourceUniverse.importReceiptPath))));
  ok(importReceipt.snapshotGitTree === "9732ae10954a5336442e4a565a55ddf16e3b34d5" && importReceipt.result.intersectionEntries === 287, "Source-snapshot import receipt drifted.");
  allFalse(importReceipt.accessBoundary, ["nativeCoordinatesAccessed", "nativeRelativePosesInspected", "dockqOrCapriLabelsAccessed", "confovhhHoldoutScoresAccessed", "performanceResultsAccessed", "executionAuthorized"], "Source import access boundary");

  const licenseRecord = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.sourceUniverse.licenseRecordPath))));
  const licenses = Object.fromEntries(licenseRecord.sources.map((source) => [source.sourceId, source]));
  ok(licenses["rcsb-pdb-search-and-data-apis"]?.licenseSpdx === "CC0-1.0" && licenses["rcsb-pdb-search-and-data-apis"]?.licenseEvidenceUrl === "https://www.rcsb.org/pages/usage-policy", "RCSB license mapping drifted.");
  ok(licenses["gpcrdb-structure-api-and-table-data"]?.licenseSpdx === "CC-BY-4.0" && licenses["gpcrdb-structure-api-and-table-data"]?.licenseEvidenceUrl === "https://docs.gpcrdb.org/legal_notice.html", "GPCRdb license mapping drifted.");

  const entryAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.entryMetadata.attestationPath))));
  ok(entryAttestation.status === "ENTRY_METADATA_ARCHIVED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS"
    && entryAttestation.snapshotChecksumsSha256 === state.entryMetadata.checksumsSha256
    && entryAttestation.sourceIdentifierCount === state.entryMetadata.entries
    && entryAttestation.summary?.polymerEntities === state.entryMetadata.polymerEntities,
  "Entry-metadata attestation drifted from the primary capture.");
  allFalse(entryAttestation, ["targetFreezePermitted", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"], "Entry metadata attestation");

  const developmentAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.developmentMetadata.attestationPath))));
  ok(developmentAttestation.snapshotChecksumsSha256 === state.developmentMetadata.checksumsSha256
    && developmentAttestation.developmentNodeCount === state.developmentMetadata.nodes
    && developmentAttestation.newlyCompletedRepeatedMetadataNodeCount === state.developmentMetadata.newlyCompletedMetadataNodes,
  "Development-metadata attestation drifted.");
  allFalse(developmentAttestation, ["formalLeakageCertificationComplete", "dispositionLedgerComplete", "leakageGraphComplete", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"], "Development metadata attestation");

  const exactAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.exactEvidencePregraph.attestationPath))));
  ok(exactAttestation.snapshotChecksumsSha256 === state.exactEvidencePregraph.checksumsSha256
    && exactAttestation.totalNodeCount === state.exactEvidencePregraph.totalNodes
    && exactAttestation.allUnorderedPairCount === state.exactEvidencePregraph.allUnorderedPairs
    && exactAttestation.positiveEvidencePairCount === state.exactEvidencePregraph.positiveEvidencePairs,
  "Exact-evidence pregraph attestation drifted.");
  ok(exactAttestation.interpretation?.exactMetadataEvidencePregraphOnly === true && exactAttestation.interpretation?.formalLeakageGraph === false && exactAttestation.interpretation?.formalNoEdgeClaims === false, "Exact-evidence interpretation boundary drifted.");
  allFalse(exactAttestation, ["formalLeakageGraphComplete", "dispositionLedgerComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"], "Exact evidence attestation");

  const vhhAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.vhhSequencePregraph.attestationPath))));
  ok(vhhAttestation.status === "VHH_SEQUENCE_PREGRAPH_ATTESTED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION"
    && vhhAttestation.snapshotChecksumsSha256 === state.vhhSequencePregraph.checksumsSha256
    && vhhAttestation.contractSha256 === state.vhhSequencePregraph.contractSha256
    && vhhAttestation.numberingCorrectionRecordSha256 === state.vhhSequencePregraph.correctionRecordSha256
    && vhhAttestation.dependencyPackageLockSha256 === state.vhhSequencePregraph.dependencyLockSha256
    && vhhAttestation.generatorScriptSha256 === state.vhhSequencePregraph.generatorScriptSha256
    && vhhAttestation.totalNodeCount === state.vhhSequencePregraph.totalNodes
    && vhhAttestation.allUnorderedPairCount === state.vhhSequencePregraph.allUnorderedPairs
    && vhhAttestation.possibleMetadataSequenceEdgePairCount === state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs,
  "VHH sequence pregraph attestation drifted.");
  ok(vhhAttestation.interpretation?.sequenceEvidencePregraphOnly === true
    && vhhAttestation.interpretation?.possibleMetadataSequenceEdgesAreNotFormalLeakageEdges === true
    && vhhAttestation.interpretation?.thresholdComponentsAreNotIndependentBenchmarkGroups === true
    && vhhAttestation.interpretation?.absenceOfThresholdMatchIsNotFormalNoEdgeEvidence === true,
  "VHH sequence interpretation boundary drifted.");
  allFalse(vhhAttestation, ["directBinderRolesResolved", "knownParentVariantEvidenceComplete", "formalLeakageGraphComplete", "dispositionLedgerComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "nativeEpitopesAccessed", "dockqLabelsAccessed", "confovhhHoldoutScoresAccessed", "performanceResultsAccessed"], "VHH sequence attestation");
  ok(vhhAttestation.formallyClearedGroupCount === 0, "VHH sequence attestation cannot clear benchmark groups.");

  const [design, archivedDraft, source, entry, entryReplay, seed, development, exactEvidence, vhhSequence, boundedAudit] = await Promise.all([
    verifyDesignRecord(root),
    verifyV3CensusContracts(root),
    verifySourceUniverse({ repositoryRoot: root, snapshotDirectory: path.join(root, "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29") }),
    verifyEntryMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, primaryEntryDirectory) }),
    verifyEntryMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, replayEntryDirectory) }),
    verifyDispositionSeed({ repositoryRoot: root, snapshotDirectory: path.join(root, path.dirname(state.dispositionSeed.checksumsPath)) }),
    verifyDevelopmentMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, path.dirname(state.developmentMetadata.checksumsPath)) }),
    verifyExactEvidencePregraph({ repositoryRoot: root, snapshotDirectory: path.join(root, path.dirname(state.exactEvidencePregraph.checksumsPath)) }),
    verifyVhhSequencePregraph({ repositoryRoot: root, snapshotDirectory: path.join(root, state.vhhSequencePregraph.snapshotDirectory) }),
    verifyBoundedCensusAudit(root, state.census),
  ]);

  ok(design.selectedDesign === state.selectedProtocol.epitopeDesign && design.oracleRequestFrozen === false, "Selected design replay disagrees with integration state.");
  ok(archivedDraft.advancementAuthority === false && archivedDraft.annotationEpitopeEligibilityAuthority === false, "Archived draft replay gained authority.");
  ok(source.intersectionCount === state.sourceUniverse.intersectionEntries && source.formallyClearedGroups === 0 && source.targetFreezePermitted === false, "Source replay disagrees with integration state.");
  ok(entry.sourceEntries === state.entryMetadata.entries && entry.polymerEntities === state.entryMetadata.polymerEntities && entry.repeatedRawResponses === state.entryMetadata.repeatedRawResponses && entry.pendingDispositionRows === state.entryMetadata.snapshotPendingDispositionRows && entry.targetFreezePermitted === false, "Entry-metadata replay disagrees with integration state.");
  ok(JSON.stringify(entryReplay) === JSON.stringify(entry), "The independent entry-metadata captures disagree after normalized replay.");
  ok(seed.dispositionRowCount === state.dispositionSeed.rows && seed.resolvedDispositionRowCount === state.dispositionSeed.resolvedRows && seed.pendingDispositionRowCount === state.dispositionSeed.pendingRows && seed.exactDevelopmentExclusionCount === state.dispositionSeed.exactDevelopmentPdbExclusions && seed.provisionalDirectTargetCount === 0, "Disposition-seed replay disagrees with integration state.");
  ok(development.developmentNodeCount === state.developmentMetadata.nodes && development.newlyCompletedMetadataNodeCount === state.developmentMetadata.newlyCompletedMetadataNodes && development.uniquePreferredReceptorEntityCount === state.developmentMetadata.uniquePreferredReceptorEntities, "Development-metadata replay disagrees with integration state.");
  ok(exactEvidence.totalNodeCount === state.exactEvidencePregraph.totalNodes && exactEvidence.allUnorderedPairCount === state.exactEvidencePregraph.allUnorderedPairs && exactEvidence.positiveEvidencePairCount === state.exactEvidencePregraph.positiveEvidencePairs && exactEvidence.candidateNodesConnectedToDevelopmentByDefiniteEvidence === state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByDefiniteEvidence && exactEvidence.candidateNodesConnectedToDevelopmentByInclusiveEvidence === state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByInclusiveEvidence, "Exact-evidence replay disagrees with integration state.");
  ok(vhhSequence.totalNodeCount === state.vhhSequencePregraph.totalNodes && vhhSequence.totalMetadataProfileCount === state.vhhSequencePregraph.totalMetadataProfiles && vhhSequence.numberedProfileCount === state.vhhSequencePregraph.numberedProfiles && vhhSequence.unavailableProfileCount === state.vhhSequencePregraph.unavailableProfiles && vhhSequence.allUnorderedPairCount === state.vhhSequencePregraph.allUnorderedPairs && vhhSequence.possibleMetadataSequenceEdgePairCount === state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs && vhhSequence.thresholdPregraphComponentCount === state.vhhSequencePregraph.thresholdPregraphComponents && vhhSequence.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge === state.vhhSequencePregraph.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge && vhhSequence.formallyClearedGroupCount === 0 && vhhSequence.targetFreezePermitted === false && vhhSequence.executionAuthorized === false, "VHH sequence replay disagrees with integration state.");
  ok(boundedAudit.requiredIndependentGroups === state.census.requiredIndependentGroups && boundedAudit.provisionalGroups === state.census.provisionalGroups && boundedAudit.formallyClearedGroups === state.census.formallyClearedGroups && boundedAudit.newIndependentGroups === state.census.boundedAuditNewGroups, "Bounded census-audit replay disagrees with integration state.");

  return {
    status: state.status,
    targetFreezeGate: state.targetFreezeGate.status,
    selectedProtocol: state.selectedProtocol.path,
    selectedDesign: state.selectedProtocol.epitopeDesign,
    sourceEntries: source.intersectionCount,
    entryMetadataRows: entry.sourceEntries,
    polymerEntities: entry.polymerEntities,
    repeatedRawResponses: entry.repeatedRawResponses,
    entryMetadataCaptures: state.entryMetadata.independentCaptureCount,
    normalizedCaptureAgreement: true,
    dispositionRows: seed.dispositionRowCount,
    resolvedDispositionRows: seed.resolvedDispositionRowCount,
    pendingDispositionRows: seed.pendingDispositionRowCount,
    developmentMetadataNodes: development.developmentNodeCount,
    exactEvidenceNodes: exactEvidence.totalNodeCount,
    exactEvidenceUnorderedPairs: exactEvidence.allUnorderedPairCount,
    positiveExactOrAmbiguousEvidencePairs: exactEvidence.positiveEvidencePairCount,
    candidateNodesConnectedToDevelopmentByDefiniteEvidence: exactEvidence.candidateNodesConnectedToDevelopmentByDefiniteEvidence,
    candidateNodesConnectedToDevelopmentByInclusiveEvidence: exactEvidence.candidateNodesConnectedToDevelopmentByInclusiveEvidence,
    vhhMetadataProfiles: vhhSequence.totalMetadataProfileCount,
    vhhNumberedProfiles: vhhSequence.numberedProfileCount,
    vhhUnavailableProfiles: vhhSequence.unavailableProfileCount,
    vhhSequenceUnorderedPairs: vhhSequence.allUnorderedPairCount,
    possibleVhhSequenceEvidencePairs: vhhSequence.possibleMetadataSequenceEdgePairCount,
    vhhThresholdPregraphComponents: vhhSequence.thresholdPregraphComponentCount,
    candidateNodesConnectedToDevelopmentByPossibleVhhSequenceEvidence: vhhSequence.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge,
    boundedAuditReviewedLedgerRecords: boundedAudit.reviewedLedgerRecords,
    boundedAuditReviewedPdbEntries: boundedAudit.reviewedPdbEntries,
    provisionalGroups: state.census.provisionalGroups,
    formallyClearedGroups: state.census.formallyClearedGroups,
    requiredIndependentGroups: state.census.requiredIndependentGroups,
    approvalReady: false,
    executionAuthorized: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try {
    console.log(JSON.stringify(await verifyIntegrationState(process.argv[2] ? path.resolve(process.argv[2]) : ROOT), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { EXPECTED_STATE_SHA256, STATE_RELATIVE, validateBlockedState };
