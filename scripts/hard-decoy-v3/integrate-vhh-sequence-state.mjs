import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const STATE_RELATIVE = "validation/hard-decoy-holdout-v3/INTEGRATION_STATE_2026-08-29.json";
const VERIFIER_RELATIVE = "scripts/hard-decoy-v3/verify-integration-state.mjs";
const TEST_RELATIVE = "tests/hard-decoy-v3-integration-state.test.mjs";
const ATTESTATION_RELATIVE = "validation/hard-decoy-holdout-v3/VHH_SEQUENCE_PREGRAPH_ATTESTATION_2026-08-30.json";
const CONTRACT_RELATIVE = "validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json";
const CORRECTION_RELATIVE = "validation/hard-decoy-holdout-v3/VHH_NUMBERING_CORRECTION_2026-08-30.json";
const SNAPSHOT_RELATIVE = "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29";
const CHECKSUMS_RELATIVE = `${SNAPSHOT_RELATIVE}/checksums.sha256`;
const MANIFEST_RELATIVE = `${SNAPSHOT_RELATIVE}/manifest.json`;
const SUMMARY_RELATIVE = `${SNAPSHOT_RELATIVE}/summary.json`;
const PACKAGE_LOCK_RELATIVE = "package-lock.json";
const GENERATOR_RELATIVE = "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs";
const SHA256 = /^[a-f0-9]{64}$/u;

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function filename(relative) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `Unsafe relative path: ${relative}`);
  const resolved = path.resolve(ROOT, relative);
  const containment = path.relative(ROOT, resolved);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `Path escaped repository root: ${relative}`);
  return resolved;
}

async function bytes(relative) {
  return readFile(filename(relative));
}

async function text(relative) {
  return readFile(filename(relative), "utf8");
}

async function json(relative) {
  return JSON.parse(await text(relative));
}

async function digest(relative) {
  return sha256(await bytes(relative));
}

async function writeJson(relative, value) {
  await writeFile(filename(relative), `${JSON.stringify(value, null, 2)}\n`);
}

function occurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = occurrences(source, before);
  ok(count === 1, `${label} expected one source fragment, observed ${count}.`);
  return source.replace(before, after);
}

function insertAfterOnce(source, anchor, insertion, marker, label) {
  if (source.includes(marker)) return source;
  const count = occurrences(source, anchor);
  ok(count === 1, `${label} expected one anchor, observed ${count}.`);
  return source.replace(anchor, `${anchor}${insertion}`);
}

function assertFalse(record, fields, label) {
  for (const field of fields) ok(record[field] === false, `${label} must remain false: ${field}`);
}

async function createAttestation() {
  const [contract, correction, manifest, summary] = await Promise.all([
    json(CONTRACT_RELATIVE),
    json(CORRECTION_RELATIVE),
    json(MANIFEST_RELATIVE),
    json(SUMMARY_RELATIVE),
  ]);
  const [contractSha256, correctionSha256, checksumsSha256, manifestSha256, summarySha256, packageLockSha256, generatorSha256] = await Promise.all([
    digest(CONTRACT_RELATIVE),
    digest(CORRECTION_RELATIVE),
    digest(CHECKSUMS_RELATIVE),
    digest(MANIFEST_RELATIVE),
    digest(SUMMARY_RELATIVE),
    digest(PACKAGE_LOCK_RELATIVE),
    digest(GENERATOR_RELATIVE),
  ]);

  ok(contract.schemaVersion === "1.1.0" && contract.numbering?.engine === "immunum 1.3.0", "Corrected VHH contract identity drifted.");
  ok(correction.status === "PRELABEL_NUMBERING_ENGINE_CORRECTION_APPLIED_BEFORE_TARGET_FREEZE", "VHH correction record identity drifted.");
  ok(manifest.status === summary.status && manifest.summary?.possibleMetadataSequenceEdgePairCounts?.all === 20859, "VHH manifest/summary accounting drifted.");
  ok(manifest.inputDigests?.contract === contractSha256, "VHH manifest contract binding drifted.");
  ok(manifest.inputDigests?.dependencyPackageLock === packageLockSha256, "VHH manifest dependency-lock binding drifted.");
  ok(manifest.inputDigests?.numberingCorrectionRecord === correctionSha256, "VHH manifest correction-record binding drifted.");
  ok(manifest.inputDigests?.generatorScript === generatorSha256, "VHH manifest generator binding drifted.");
  ok(manifest.normalizedOutputs?.["summary.json"]?.sha256 === summarySha256, "VHH manifest summary binding drifted.");
  ok(summary.totalNodeCount === 304 && summary.totalMetadataProfileCount === 303 && summary.numberedProfileCount === 302 && summary.unavailableProfileCount === 1, "VHH profile accounting drifted.");
  ok(summary.pairSpace?.allUnorderedPairs === 46056 && summary.possibleMetadataSequenceEdgePairCounts?.all === 20859, "VHH pair accounting drifted.");
  ok(summary.exactFullSequenceEvidencePairCount === 2023 && summary.thresholdPregraphComponentCount === 34 && summary.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge === 57, "VHH evidence/component accounting drifted.");
  assertFalse(summary, [
    "directBinderRolesResolved",
    "knownParentVariantEvidenceComplete",
    "formalLeakageGraphComplete",
    "dispositionLedgerComplete",
    "exactFrozenTargetSetExists",
    "targetFreezePermitted",
    "executionAuthorized",
    "nativeHoldoutCoordinatesAccessed",
    "nativeRelativePosesInspected",
    "dockqLabelsAccessed",
    "confovhhHoldoutScoresAccessed",
    "performanceResultsAccessed",
  ], "VHH summary authority/access field");

  const attestation = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    recordedAtUtc: "2026-08-30T01:25:00Z",
    status: "VHH_SEQUENCE_PREGRAPH_ATTESTED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION",
    snapshotDirectory: SNAPSHOT_RELATIVE,
    snapshotChecksumsPath: CHECKSUMS_RELATIVE,
    snapshotChecksumsSha256: checksumsSha256,
    manifestPath: MANIFEST_RELATIVE,
    manifestSha256,
    summaryPath: SUMMARY_RELATIVE,
    summarySha256,
    contractPath: CONTRACT_RELATIVE,
    contractSha256,
    correctionRecordPath: CORRECTION_RELATIVE,
    numberingCorrectionRecordSha256: correctionSha256,
    dependencyPackageLockPath: PACKAGE_LOCK_RELATIVE,
    dependencyPackageLockSha256: packageLockSha256,
    generatorScriptPath: GENERATOR_RELATIVE,
    generatorScriptSha256: generatorSha256,
    numberingEngine: contract.numbering.engine,
    candidateNodeCount: summary.candidateNodeCount,
    developmentNodeCount: summary.developmentNodeCount,
    totalNodeCount: summary.totalNodeCount,
    totalMetadataProfileCount: summary.totalMetadataProfileCount,
    numberedProfileCount: summary.numberedProfileCount,
    unavailableProfileCount: summary.unavailableProfileCount,
    allUnorderedPairCount: summary.pairSpace.allUnorderedPairs,
    possibleMetadataSequenceEdgePairCount: summary.possibleMetadataSequenceEdgePairCounts.all,
    exactFullSequenceEvidencePairCount: summary.exactFullSequenceEvidencePairCount,
    thresholdPregraphComponentCount: summary.thresholdPregraphComponentCount,
    candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge: summary.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge,
    interpretation: {
      sequenceEvidencePregraphOnly: true,
      possibleMetadataSequenceEdgesAreNotFormalLeakageEdges: true,
      thresholdComponentsAreNotIndependentBenchmarkGroups: true,
      absenceOfThresholdMatchIsNotFormalNoEdgeEvidence: true,
      directBinderRoleAdjudicationComplete: false,
      knownParentVariantEvidenceComplete: false,
    },
    directBinderRolesResolved: false,
    knownParentVariantEvidenceComplete: false,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    exactFrozenTargetSetExists: false,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    nativeEpitopesAccessed: false,
    dockqLabelsAccessed: false,
    confovhhHoldoutScoresAccessed: false,
    performanceResultsAccessed: false,
  };
  await writeJson(ATTESTATION_RELATIVE, attestation);
  return { attestation, attestationSha256: await digest(ATTESTATION_RELATIVE) };
}

async function updateState(attestationSha256) {
  const [state, contract, manifest, summary] = await Promise.all([
    json(STATE_RELATIVE),
    json(CONTRACT_RELATIVE),
    json(MANIFEST_RELATIVE),
    json(SUMMARY_RELATIVE),
  ]);
  const [contractSha256, correctionSha256, checksumsSha256, manifestSha256, summarySha256, packageLockSha256, generatorSha256] = await Promise.all([
    digest(CONTRACT_RELATIVE),
    digest(CORRECTION_RELATIVE),
    digest(CHECKSUMS_RELATIVE),
    digest(MANIFEST_RELATIVE),
    digest(SUMMARY_RELATIVE),
    digest(PACKAGE_LOCK_RELATIVE),
    digest(GENERATOR_RELATIVE),
  ]);

  ok(state.studyId === "confovhh-hard-decoy-holdout-v3" && state.status === "DRAFT", "Unexpected integration-state identity.");
  state.schemaVersion = "1.2.0";
  state.recordedAtUtc = "2026-08-30T01:25:00Z";
  state.targetFreezeGate.statement = "The v3 protocol remains DRAFT. The 287-row seed has 15 exact development-PDB exclusions and 272 pending rows; all 17 development metadata nodes, the 304-node exact-evidence pregraph, and a corrected complete 46,056-pair IMGT VHH sequence pregraph are reproducibly bound. The VHH layer conservatively marks 20,859 possible metadata-sequence leakage pairs, but direct receptor-VHH role, known-parent/variant, construct, canonical TM1-TM7, exhaustive discovery, formal graph, and sealed native-epitope gates remain incomplete. Zero of at least ten required independent groups are formally cleared.";

  const oldBlocker = "IMGT-and-known-parent-vhh-matrix-unfrozen";
  const newBlocker = "vhh-direct-role-and-known-parent-adjudication-incomplete";
  const blockerSet = new Set(state.authorization.blockers);
  ok(blockerSet.has(oldBlocker) || blockerSet.has(newBlocker), "Expected VHH authorization blocker is missing.");
  state.authorization.blockers = state.authorization.blockers.map((blocker) => blocker === oldBlocker ? newBlocker : blocker);
  ok(new Set(state.authorization.blockers).size === state.authorization.blockers.length, "Integration-state blockers became duplicated.");

  const vhhSequencePregraph = {
    status: summary.status,
    snapshotDirectory: SNAPSHOT_RELATIVE,
    checksumsPath: CHECKSUMS_RELATIVE,
    checksumsSha256,
    manifestPath: MANIFEST_RELATIVE,
    manifestSha256,
    summaryPath: SUMMARY_RELATIVE,
    summarySha256,
    contractPath: CONTRACT_RELATIVE,
    contractSha256,
    attestationPath: ATTESTATION_RELATIVE,
    attestationSha256,
    correctionRecordPath: CORRECTION_RELATIVE,
    correctionRecordSha256: correctionSha256,
    dependencyLockPath: PACKAGE_LOCK_RELATIVE,
    dependencyLockSha256: packageLockSha256,
    generatorScriptPath: GENERATOR_RELATIVE,
    generatorScriptSha256: generatorSha256,
    numberingEngine: contract.numbering.engine,
    candidateNodes: summary.candidateNodeCount,
    developmentNodes: summary.developmentNodeCount,
    totalNodes: summary.totalNodeCount,
    totalMetadataProfiles: summary.totalMetadataProfileCount,
    numberedProfiles: summary.numberedProfileCount,
    unavailableProfiles: summary.unavailableProfileCount,
    allUnorderedPairs: summary.pairSpace.allUnorderedPairs,
    matrixStatusCounts: summary.matrixStatusCounts,
    possibleMetadataSequenceEdgePairs: summary.possibleMetadataSequenceEdgePairCounts.all,
    exactFullSequenceEvidencePairs: summary.exactFullSequenceEvidencePairCount,
    thresholdPregraphComponents: summary.thresholdPregraphComponentCount,
    candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge: summary.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge,
    completeImgtRegionCoverageRequired: contract.numbering.completeImgtRegionCoverageRequired,
    numberingSegmentationAgreementRequired: contract.numbering.numberingSegmentationAgreementRequired,
    directBinderRolesResolved: false,
    knownParentVariantEvidenceComplete: false,
    formalLeakageGraphAuthority: false,
    formalNoEdgeAuthority: false,
    targetEligibilityAuthority: false,
  };
  ok(manifest.inputDigests.contract === contractSha256 && manifest.inputDigests.dependencyPackageLock === packageLockSha256 && manifest.inputDigests.numberingCorrectionRecord === correctionSha256 && manifest.inputDigests.generatorScript === generatorSha256, "VHH state provenance disagrees with its manifest.");

  const { census, oracle, labelBoundary, authorization, ...prefix } = state;
  const next = { ...prefix, vhhSequencePregraph, census, oracle, labelBoundary, authorization };
  await writeJson(STATE_RELATIVE, next);
  return sha256(await bytes(STATE_RELATIVE));
}

async function patchVerifier(stateSha256) {
  let source = await text(VERIFIER_RELATIVE);
  source = replaceOnce(
    source,
    'import { verifyExactEvidencePregraph } from "../hard-decoy/v3-exact-evidence-pregraph.mjs";\n',
    'import { verifyExactEvidencePregraph } from "../hard-decoy/v3-exact-evidence-pregraph.mjs";\nimport { verifyVhhSequencePregraph } from "../hard-decoy/v3-vhh-sequence-pregraph.mjs";\n',
    "VHH verifier import",
  );
  source = source.replace(/const EXPECTED_STATE_SHA256 = "[a-f0-9]{64}";/u, `const EXPECTED_STATE_SHA256 = "${stateSha256}";`);
  source = source.replace('state.schemaVersion === "1.1.0"', 'state.schemaVersion === "1.2.0"');

  const exactValidationAnchor = '  ok(state.exactEvidencePregraph.formalLeakageGraphAuthority === false && state.exactEvidencePregraph.formalNoEdgeAuthority === false, "Exact-evidence pregraph gained formal graph authority.");\n';
  const vhhValidation = `\n  ok(state.vhhSequencePregraph.status === "VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION", "VHH sequence pregraph status drifted.");\n  ok(state.vhhSequencePregraph.numberingEngine === "immunum 1.3.0" && state.vhhSequencePregraph.completeImgtRegionCoverageRequired === true && state.vhhSequencePregraph.numberingSegmentationAgreementRequired === true, "Corrected VHH numbering policy drifted.");\n  ok(state.vhhSequencePregraph.candidateNodes === 287 && state.vhhSequencePregraph.developmentNodes === 17 && state.vhhSequencePregraph.totalNodes === 304, "VHH sequence node accounting drifted.");\n  ok(state.vhhSequencePregraph.totalMetadataProfiles === 303 && state.vhhSequencePregraph.numberedProfiles === 302 && state.vhhSequencePregraph.unavailableProfiles === 1, "VHH sequence profile accounting drifted.");\n  ok(state.vhhSequencePregraph.allUnorderedPairs === 46056 && state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs === 20859 && state.vhhSequencePregraph.exactFullSequenceEvidencePairs === 2023, "VHH sequence pair accounting drifted.");\n  exactKeys(state.vhhSequencePregraph.matrixStatusCounts, ["FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE", "NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY", "POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED"], "VHH matrix status counts");\n  ok(state.vhhSequencePregraph.matrixStatusCounts.FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE === 1803 && state.vhhSequencePregraph.matrixStatusCounts.NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY === 23394 && state.vhhSequencePregraph.matrixStatusCounts.POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED === 20859, "VHH matrix status accounting drifted.");\n  ok(state.vhhSequencePregraph.thresholdPregraphComponents === 34 && state.vhhSequencePregraph.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge === 57, "VHH component/connectivity accounting drifted.");\n  for (const field of ["checksumsSha256", "manifestSha256", "summarySha256", "contractSha256", "attestationSha256", "correctionRecordSha256", "dependencyLockSha256", "generatorScriptSha256"]) ok(SHA256.test(state.vhhSequencePregraph[field]), \`Invalid VHH integration digest: \${field}\`);\n  allFalse(state.vhhSequencePregraph, ["directBinderRolesResolved", "knownParentVariantEvidenceComplete", "formalLeakageGraphAuthority", "formalNoEdgeAuthority", "targetEligibilityAuthority"], "VHH sequence pregraph");\n`;
  source = insertAfterOnce(source, exactValidationAnchor, vhhValidation, "VHH sequence pregraph status drifted.", "VHH state validation");
  source = source.replace('    "IMGT-and-known-parent-vhh-matrix-unfrozen",', '    "vhh-direct-role-and-known-parent-adjudication-incomplete",');

  const exactDigestAnchor = '    requireDigest(root, state.exactEvidencePregraph.attestationPath, state.exactEvidencePregraph.attestationSha256),\n';
  const vhhDigestChecks = `    requireDigest(root, state.vhhSequencePregraph.checksumsPath, state.vhhSequencePregraph.checksumsSha256),\n    requireDigest(root, state.vhhSequencePregraph.manifestPath, state.vhhSequencePregraph.manifestSha256),\n    requireDigest(root, state.vhhSequencePregraph.summaryPath, state.vhhSequencePregraph.summarySha256),\n    requireDigest(root, state.vhhSequencePregraph.contractPath, state.vhhSequencePregraph.contractSha256),\n    requireDigest(root, state.vhhSequencePregraph.attestationPath, state.vhhSequencePregraph.attestationSha256),\n    requireDigest(root, state.vhhSequencePregraph.correctionRecordPath, state.vhhSequencePregraph.correctionRecordSha256),\n    requireDigest(root, state.vhhSequencePregraph.dependencyLockPath, state.vhhSequencePregraph.dependencyLockSha256),\n    requireDigest(root, state.vhhSequencePregraph.generatorScriptPath, state.vhhSequencePregraph.generatorScriptSha256),\n`;
  source = insertAfterOnce(source, exactDigestAnchor, vhhDigestChecks, "state.vhhSequencePregraph.checksumsPath", "VHH digest checks");

  const exactAttestationAnchor = '  allFalse(exactAttestation, ["formalLeakageGraphComplete", "dispositionLedgerComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"], "Exact evidence attestation");\n';
  const vhhAttestationChecks = `\n  const vhhAttestation = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundRegularFile(path.join(root, state.vhhSequencePregraph.attestationPath))));\n  ok(vhhAttestation.status === "VHH_SEQUENCE_PREGRAPH_ATTESTED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION"\n    && vhhAttestation.snapshotChecksumsSha256 === state.vhhSequencePregraph.checksumsSha256\n    && vhhAttestation.contractSha256 === state.vhhSequencePregraph.contractSha256\n    && vhhAttestation.numberingCorrectionRecordSha256 === state.vhhSequencePregraph.correctionRecordSha256\n    && vhhAttestation.dependencyPackageLockSha256 === state.vhhSequencePregraph.dependencyLockSha256\n    && vhhAttestation.generatorScriptSha256 === state.vhhSequencePregraph.generatorScriptSha256\n    && vhhAttestation.totalNodeCount === state.vhhSequencePregraph.totalNodes\n    && vhhAttestation.allUnorderedPairCount === state.vhhSequencePregraph.allUnorderedPairs\n    && vhhAttestation.possibleMetadataSequenceEdgePairCount === state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs,\n  "VHH sequence pregraph attestation drifted.");\n  ok(vhhAttestation.interpretation?.sequenceEvidencePregraphOnly === true\n    && vhhAttestation.interpretation?.possibleMetadataSequenceEdgesAreNotFormalLeakageEdges === true\n    && vhhAttestation.interpretation?.thresholdComponentsAreNotIndependentBenchmarkGroups === true\n    && vhhAttestation.interpretation?.absenceOfThresholdMatchIsNotFormalNoEdgeEvidence === true,\n  "VHH sequence interpretation boundary drifted.");\n  allFalse(vhhAttestation, ["directBinderRolesResolved", "knownParentVariantEvidenceComplete", "formalLeakageGraphComplete", "dispositionLedgerComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "nativeEpitopesAccessed", "dockqLabelsAccessed", "confovhhHoldoutScoresAccessed", "performanceResultsAccessed"], "VHH sequence attestation");\n  ok(vhhAttestation.formallyClearedGroupCount === 0, "VHH sequence attestation cannot clear benchmark groups.");\n`;
  source = insertAfterOnce(source, exactAttestationAnchor, vhhAttestationChecks, "const vhhAttestation =", "VHH attestation verification");

  source = replaceOnce(
    source,
    '  const [design, archivedDraft, source, entry, entryReplay, seed, development, exactEvidence, boundedAudit] = await Promise.all([\n',
    '  const [design, archivedDraft, source, entry, entryReplay, seed, development, exactEvidence, vhhSequence, boundedAudit] = await Promise.all([\n',
    "VHH replay destructuring",
  );
  const exactReplayAnchor = '    verifyExactEvidencePregraph({ repositoryRoot: root, snapshotDirectory: path.join(root, path.dirname(state.exactEvidencePregraph.checksumsPath)) }),\n';
  source = insertAfterOnce(
    source,
    exactReplayAnchor,
    '    verifyVhhSequencePregraph({ repositoryRoot: root, snapshotDirectory: path.join(root, state.vhhSequencePregraph.snapshotDirectory) }),\n',
    "verifyVhhSequencePregraph({ repositoryRoot: root",
    "VHH replay call",
  );

  const exactReplayCheckAnchor = '  ok(exactEvidence.totalNodeCount === state.exactEvidencePregraph.totalNodes && exactEvidence.allUnorderedPairCount === state.exactEvidencePregraph.allUnorderedPairs && exactEvidence.positiveEvidencePairCount === state.exactEvidencePregraph.positiveEvidencePairs && exactEvidence.candidateNodesConnectedToDevelopmentByDefiniteEvidence === state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByDefiniteEvidence && exactEvidence.candidateNodesConnectedToDevelopmentByInclusiveEvidence === state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByInclusiveEvidence, "Exact-evidence replay disagrees with integration state.");\n';
  const vhhReplayCheck = '  ok(vhhSequence.totalNodeCount === state.vhhSequencePregraph.totalNodes && vhhSequence.totalMetadataProfileCount === state.vhhSequencePregraph.totalMetadataProfiles && vhhSequence.numberedProfileCount === state.vhhSequencePregraph.numberedProfiles && vhhSequence.unavailableProfileCount === state.vhhSequencePregraph.unavailableProfiles && vhhSequence.allUnorderedPairCount === state.vhhSequencePregraph.allUnorderedPairs && vhhSequence.possibleMetadataSequenceEdgePairCount === state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs && vhhSequence.thresholdPregraphComponentCount === state.vhhSequencePregraph.thresholdPregraphComponents && vhhSequence.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge === state.vhhSequencePregraph.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge && vhhSequence.formallyClearedGroupCount === 0 && vhhSequence.targetFreezePermitted === false && vhhSequence.executionAuthorized === false, "VHH sequence replay disagrees with integration state.");\n';
  source = insertAfterOnce(source, exactReplayCheckAnchor, vhhReplayCheck, "VHH sequence replay disagrees with integration state.", "VHH replay reconciliation");

  const returnAnchor = '    candidateNodesConnectedToDevelopmentByInclusiveEvidence: exactEvidence.candidateNodesConnectedToDevelopmentByInclusiveEvidence,\n';
  const vhhReturn = `    vhhMetadataProfiles: vhhSequence.totalMetadataProfileCount,\n    vhhNumberedProfiles: vhhSequence.numberedProfileCount,\n    vhhUnavailableProfiles: vhhSequence.unavailableProfileCount,\n    vhhSequenceUnorderedPairs: vhhSequence.allUnorderedPairCount,\n    possibleVhhSequenceEvidencePairs: vhhSequence.possibleMetadataSequenceEdgePairCount,\n    vhhThresholdPregraphComponents: vhhSequence.thresholdPregraphComponentCount,\n    candidateNodesConnectedToDevelopmentByPossibleVhhSequenceEvidence: vhhSequence.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge,\n`;
  source = insertAfterOnce(source, returnAnchor, vhhReturn, "vhhMetadataProfiles:", "VHH integration return fields");

  await writeFile(filename(VERIFIER_RELATIVE), source);
}

async function patchTest() {
  let source = await text(TEST_RELATIVE);
  const expectedAnchor = '    candidateNodesConnectedToDevelopmentByInclusiveEvidence: 262,\n';
  const expectedFields = `    vhhMetadataProfiles: 303,\n    vhhNumberedProfiles: 302,\n    vhhUnavailableProfiles: 1,\n    vhhSequenceUnorderedPairs: 46056,\n    possibleVhhSequenceEvidencePairs: 20859,\n    vhhThresholdPregraphComponents: 34,\n    candidateNodesConnectedToDevelopmentByPossibleVhhSequenceEvidence: 57,\n`;
  source = insertAfterOnce(source, expectedAnchor, expectedFields, "vhhMetadataProfiles: 303", "VHH integration expected result");
  const mutationAnchor = '    (state) => { state.exactEvidencePregraph.candidateNodesConnectedToDevelopmentByInclusiveEvidence = 261; },\n';
  const mutations = `    (state) => { state.vhhSequencePregraph.numberingEngine = "immunum 1.2.0"; },\n    (state) => { state.vhhSequencePregraph.possibleMetadataSequenceEdgePairs = 20858; },\n    (state) => { state.vhhSequencePregraph.formalLeakageGraphAuthority = true; },\n`;
  source = insertAfterOnce(source, mutationAnchor, mutations, "state.vhhSequencePregraph.numberingEngine", "VHH integration mutation tests");
  await writeFile(filename(TEST_RELATIVE), source);
}

async function main() {
  const { attestationSha256 } = await createAttestation();
  ok(SHA256.test(attestationSha256), "Generated VHH attestation digest is invalid.");
  const stateSha256 = await updateState(attestationSha256);
  ok(SHA256.test(stateSha256), "Generated integration-state digest is invalid.");
  await patchVerifier(stateSha256);
  await patchTest();
  console.log(JSON.stringify({
    status: "VHH_SEQUENCE_PREGRAPH_BOUND_IN_AUTHORITATIVE_DRAFT_STATE",
    stateSha256,
    attestationSha256,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
  }, null, 2));
}

await main();
