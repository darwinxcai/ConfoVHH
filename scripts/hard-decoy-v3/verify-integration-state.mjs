import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDesignRecord } from "./verify-design-record.mjs";
import { verifyEntryMetadataSnapshot } from "../hard-decoy/v3-entry-metadata.mjs";
import { verifySourceUniverse } from "../hard-decoy/v3-source-universe.mjs";
import { verifyV3CensusContracts } from "../hard-decoy/verify-v3-census-contracts.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const STATE_RELATIVE = "validation/hard-decoy-holdout-v3/INTEGRATION_STATE_2026-08-29.json";
const EXPECTED_STATE_SHA256 = "34ee524f8e27baa4de2d8de74b19467328c957ef38cf416ea4ac5ae3b877a2aa";
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
  const bytes = await readBoundRegularFile(filename, 8 * 1024 * 1024);
  const observed = sha256(bytes);
  ok(observed === expected, `Integration-state digest mismatch: ${relative}`);
  return bytes;
}

function exactKeys(value, expected, label) {
  ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  ok(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields drifted.`);
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
  for (const field of ["sourceUniverseFrozen", "dispositionLedgerComplete", "leakageGraphComplete", "targetManifestFrozen", "targetFreezeReady"]) ok(audit[field] === false, `Bounded census-audit field must remain false: ${field}`);
  const accessFalseFields = [
    "nativeHoldoutCoordinatesAccessed", "coordinateFilesDownloaded", "coordinateEndpointsRequested", "nativeRelativeReceptorVhhPosesInspected",
    "nativeStructuresVisualized", "coordinateDerivedContactsCalculated", "coordinateDerivedInterfacesCalculated", "dockqValuesAccessed",
    "capriLabelsAccessed", "fnatIrmsdLrmsdAccessed", "confoVhhHoldoutScoresGenerated", "candidateGeneratorOutputsAccessed",
    "holdoutPerformanceResultsAccessed", "rawHttpResponseBytesPreserved", "repeatResponseEqualityRecorded", "sourceUniverseFrozen",
    "dispositionLedgerComplete", "leakageMatricesComplete", "targetFreezePermitted", "executionAuthorized",
  ];
  for (const field of accessFalseFields) ok(access[field] === false, `Bounded census-audit access field must remain false: ${field}`);
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
  ok(state.schemaVersion === "1.0.0" && state.studyId === "confovhh-hard-decoy-holdout-v3", "Integration-state identity drifted.");
  ok(state.status === "DRAFT", "The incomplete v3 census must remain in the protocol DRAFT state.");
  exactKeys(state.targetFreezeGate, ["status", "minimumSatisfied", "discoveryComplete", "dispositionLedgerComplete", "statement"], "Target-freeze gate");
  ok(state.targetFreezeGate.status === "BLOCKED", "Target freeze must remain blocked.");
  for (const field of ["minimumSatisfied", "discoveryComplete", "dispositionLedgerComplete"]) {
    ok(state.targetFreezeGate[field] === false, `Target-freeze gate field must remain false: ${field}`);
  }
  ok(state.selectedProtocol.path === "HARD_DECOY_PROTOCOL_V3.md" && state.selectedProtocol.epitopeDesign === "sealed-one-way-native-epitope-boolean-oracle", "Selected protocol drifted.");
  ok(state.historicalAncestry.annotationDraftAdvancementAuthority === false && state.historicalAncestry.annotationEpitopeEligibilityAuthority === false, "The archived annotation draft cannot authorize eligibility.");
  ok(state.sourceUniverse.role === "frozen-historical-four-term-sub-universe-not-exhaustive-candidate-universe" && state.sourceUniverse.broaderDiscoveryComplete === false, "Source-universe claim boundary drifted.");
  ok(state.sourceUniverse.rcsbUnionEntries === 2065 && state.sourceUniverse.gpcrdbEntries === 1716 && state.sourceUniverse.intersectionEntries === 287, "Source-universe counts drifted.");
  ok(state.entryMetadata.entries === 287 && state.entryMetadata.polymerEntities === 1401 && state.entryMetadata.repeatedRawResponses === 24, "Entry-metadata counts drifted.");
  ok(state.entryMetadata.pendingDispositionRows === 287 && state.entryMetadata.formalEligibilityAuthority === false, "Entry metadata cannot be treated as eligibility evidence.");
  ok(state.entryMetadata.independentCaptureCount === 2, "Both independent entry-metadata captures must remain bound.");
  exactKeys(state.entryMetadata.normalizedOutputSha256, ["entries", "entities", "triageSignals"], "Entry-metadata normalized-output digests");
  ok(Object.values(state.entryMetadata.normalizedOutputSha256).every((value) => typeof value === "string" && SHA256.test(value)), "Entry-metadata normalized-output digest is invalid.");
  ok(state.census.requiredIndependentGroups === 10 && state.census.provisionalGroups === 7 && state.census.formallyClearedGroups === 0 && state.census.boundedAuditNewGroups === 0, "Census accounting drifted.");
  ok(state.census.boundedAuditChecksumsPath === "validation/hard-decoy-holdout-v3/census-audit-2026-08-29/checksums.sha256" && SHA256.test(state.census.boundedAuditChecksumsSha256), "Bounded census-audit binding drifted.");
  ok(state.census.boundedAuditArtifactId === "census-audit-2026-08-29" && state.census.boundedAuditReviewedLedgerRecords === 13 && state.census.boundedAuditReviewedPdbEntries === 20, "Bounded census-audit accounting drifted.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "minimumSatisfied", "targetManifestFrozen"]) ok(state.census[field] === false, `Census field must remain false: ${field}`);
  ok(state.oracle.designSelected === true, "The sealed-oracle design must remain selected.");
  for (const field of ["requestFrozen", "independentImplementationContainerFrozen", "keyCeremonyCompleted", "executed", "opened"]) ok(state.oracle[field] === false, `Oracle field must remain false: ${field}`);
  const labelBoundaryFields = ["nativeCoordinatesAccessedDuringV3Preparation", "nativeRelativePosesInspectedDuringV3Preparation", "dockqOrCapriLabelsAccessedDuringV3Preparation", "confovhhHoldoutScoresAccessed", "holdoutPerformanceResultsAccessed"];
  exactKeys(state.labelBoundary, labelBoundaryFields, "Integration label boundary");
  for (const field of labelBoundaryFields) ok(state.labelBoundary[field] === false, `Integration label-boundary field must remain false: ${field}`);
  ok(state.authorization.approvalReady === false && state.authorization.userApproved === false && state.authorization.executionAuthorized === false, "Blocked integration state cannot authorize approval or execution.");
  ok(state.authorization.blockers.includes("fewer-than-ten-formally-cleared-leakage-components"), "The formal minimum blocker is missing.");
  return state;
}

export async function verifyIntegrationState(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const statePath = path.join(root, STATE_RELATIVE);
  const stateBytes = await readBoundRegularFile(statePath);
  ok(sha256(stateBytes) === EXPECTED_STATE_SHA256, "Integration-state root differs from the externally pinned verifier root.");
  const state = validateBlockedState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stateBytes)));

  await requireDigest(root, state.selectedProtocol.path, state.selectedProtocol.sha256);
  await requireDigest(root, state.selectedProtocol.designChecksumsPath, state.selectedProtocol.designChecksumsSha256);
  await requireDigest(root, state.historicalAncestry.annotationDraftChecksumsPath, state.historicalAncestry.annotationDraftChecksumsSha256);
  await requireDigest(root, state.sourceUniverse.checksumsPath, state.sourceUniverse.checksumsSha256);
  await requireDigest(root, state.sourceUniverse.importReceiptPath, state.sourceUniverse.importReceiptSha256);
  await requireDigest(root, state.sourceUniverse.licenseRecordPath, state.sourceUniverse.licenseRecordSha256);
  await requireDigest(root, state.entryMetadata.checksumsPath, state.entryMetadata.checksumsSha256);
  await requireDigest(root, state.entryMetadata.attestationPath, state.entryMetadata.attestationSha256);
  await requireDigest(root, state.entryMetadata.independentReplayChecksumsPath, state.entryMetadata.independentReplayChecksumsSha256);

  const primaryEntryDirectory = path.dirname(state.entryMetadata.checksumsPath);
  const replayEntryDirectory = path.dirname(state.entryMetadata.independentReplayChecksumsPath);
  for (const [field, relative] of [["entries", "entries.jsonl"], ["entities", "entities.jsonl"], ["triageSignals", "triage-signals.jsonl"]]) {
    const expected = state.entryMetadata.normalizedOutputSha256[field];
    await requireDigest(root, `${primaryEntryDirectory}/${relative}`, expected);
    await requireDigest(root, `${replayEntryDirectory}/${relative}`, expected);
  }

  const importReceipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundRegularFile(path.join(root, state.sourceUniverse.importReceiptPath)),
  ));
  ok(importReceipt.snapshotGitTree === "9732ae10954a5336442e4a565a55ddf16e3b34d5" && importReceipt.result.intersectionEntries === 287, "Source-snapshot import receipt drifted.");
  const importBoundaryFields = ["nativeCoordinatesAccessed", "nativeRelativePosesInspected", "dockqOrCapriLabelsAccessed", "confovhhHoldoutScoresAccessed", "performanceResultsAccessed", "executionAuthorized"];
  exactKeys(importReceipt.accessBoundary, importBoundaryFields, "Source import access boundary");
  for (const field of importBoundaryFields) ok(importReceipt.accessBoundary[field] === false, `Source import access-boundary field must remain false: ${field}`);
  const licenseRecord = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundRegularFile(path.join(root, state.sourceUniverse.licenseRecordPath)),
  ));
  const licenses = Object.fromEntries(licenseRecord.sources.map((source) => [source.sourceId, source]));
  ok(licenses["rcsb-pdb-search-and-data-apis"]?.licenseSpdx === "CC0-1.0" && licenses["rcsb-pdb-search-and-data-apis"]?.licenseEvidenceUrl === "https://www.rcsb.org/pages/usage-policy", "RCSB license mapping drifted.");
  ok(licenses["gpcrdb-structure-api-and-table-data"]?.licenseSpdx === "CC-BY-4.0" && licenses["gpcrdb-structure-api-and-table-data"]?.licenseEvidenceUrl === "https://docs.gpcrdb.org/legal_notice.html", "GPCRdb license mapping drifted.");
  const entryAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundRegularFile(path.join(root, state.entryMetadata.attestationPath)),
  ));
  ok(entryAttestation.status === "ENTRY_METADATA_ARCHIVED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS"
    && entryAttestation.snapshotChecksumsSha256 === state.entryMetadata.checksumsSha256
    && entryAttestation.sourceIdentifierCount === state.entryMetadata.entries
    && entryAttestation.summary?.polymerEntities === state.entryMetadata.polymerEntities,
  "Entry-metadata attestation drifted from the primary capture.");
  for (const field of ["targetFreezePermitted", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    ok(entryAttestation[field] === false, `Entry-metadata attestation field must remain false: ${field}`);
  }

  const [design, archivedDraft, source, entry, entryReplay, boundedAudit] = await Promise.all([
    verifyDesignRecord(root),
    verifyV3CensusContracts(root),
    verifySourceUniverse({ repositoryRoot: root, snapshotDirectory: path.join(root, "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29") }),
    verifyEntryMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, primaryEntryDirectory) }),
    verifyEntryMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, replayEntryDirectory) }),
    verifyBoundedCensusAudit(root, state.census),
  ]);
  ok(design.selectedDesign === state.selectedProtocol.epitopeDesign && design.oracleRequestFrozen === false, "Selected design replay disagrees with integration state.");
  ok(archivedDraft.advancementAuthority === false && archivedDraft.annotationEpitopeEligibilityAuthority === false, "Archived draft replay gained authority.");
  ok(source.intersectionCount === state.sourceUniverse.intersectionEntries && source.formallyClearedGroups === 0 && source.targetFreezePermitted === false, "Source replay disagrees with integration state.");
  ok(entry.sourceEntries === state.entryMetadata.entries && entry.polymerEntities === state.entryMetadata.polymerEntities
    && entry.repeatedRawResponses === state.entryMetadata.repeatedRawResponses && entry.pendingDispositionRows === state.entryMetadata.pendingDispositionRows
    && entry.targetFreezePermitted === false, "Entry-metadata replay disagrees with integration state.");
  ok(JSON.stringify(entryReplay) === JSON.stringify(entry), "The independent entry-metadata captures disagree after normalized replay.");
  ok(boundedAudit.requiredIndependentGroups === state.census.requiredIndependentGroups && boundedAudit.provisionalGroups === state.census.provisionalGroups
    && boundedAudit.formallyClearedGroups === state.census.formallyClearedGroups && boundedAudit.newIndependentGroups === state.census.boundedAuditNewGroups,
  "Bounded census-audit replay disagrees with integration state.");

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
