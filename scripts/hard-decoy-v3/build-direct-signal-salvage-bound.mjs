import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/direct-signal-salvage-bound-2026-09-04";
const INPUT_RELS = [
  "HARD_DECOY_PROTOCOL_V3.md",
  "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json",
  "validation/hard-decoy-holdout-v2/prelabel-census/target-census.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl",
  "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04/salvage-review-queue.jsonl",
  "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04/summary.json",
  "validation/hard-decoy-holdout-v3/no-direct-signal-role-audit-2026-09-04/summary.json",
  "validation/hard-decoy-holdout-v3/direct-stratum-bound-2026-09-04/summary.json",
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/receptor-pair-matrix.jsonl",
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl",
];
const STATUS = "DIRECT_SIGNAL_SALVAGE_ADDS_ZERO_PRIORITIZED_FRONTIER_AT_MOST_EIGHT";
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

const SOURCE_BACKED_EXCLUSIONS = [
  {
    pdbId: "5WB1",
    dispositionCode: "EXCLUDE_FUSION_DOMINATED_INTERFACE",
    reviewedApparentVhhEntities: ["nanobody 7 within the US28-Nb7 fusion"],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_SAME_CHAIN_RECEPTOR_VHH_FUSION",
      basis: "The primary paper identifies 5WB1 as the structure of a US28 fusion to nanobody 7, and the frozen entry metadata places the US28 receptor and nanobody 7 in one polymer entity with no separate VHH chain.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "The only VHH is covalently fused in the receptor polymer, while the frozen protocol excludes same-chain receptor-VHH fusions.",
    evidenceUrls: [
      "https://elifesciences.org/articles/35850",
      "https://www.rcsb.org/structure/5WB1",
    ],
  },
  {
    pdbId: "8TB7",
    dispositionCode: "EXCLUDE_AUXILIARY_BINDER",
    reviewedApparentVhhEntities: ["Fab hinge-binding nanobody"],
    directInterfaceEvidence: {
      classification: "SOURCE_BACKED_FAB_HINGE_FIDUCIAL",
      basis: "The primary GPR61 paper describes a BRIL-binding Fab and a hinge-stabilizing nanobody as the inactive-state cryo-EM fiducial, and the frozen entry metadata names the VHH entity as a Fab hinge-binding nanobody.",
      nativeCoordinatesInspected: false,
    },
    dispositionReason: "The VHH stabilizes the Fab fiducial rather than forming the direct receptor-VHH target required by the benchmark.",
    evidenceUrls: [
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC10517971/",
      "https://www.rcsb.org/structure/8TB7",
    ],
  },
];

function ok(value, message) {
  if (!value) throw new Error(message);
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function byteSort(values) {
  return [...values].sort(byteCompare);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(byteCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORDINATES.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout label appeared in ${label}.`);
}

function parseJsonl(text, label) {
  ok(text.endsWith("\n"), `${label} must end with LF.`);
  return text.trimEnd().split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function directPath(root, relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped the repository.`);
  return filename;
}

async function readBound(root, relative, label, maximumBytes = 128 * 1024 * 1024) {
  const filename = directPath(root, relative, label);
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  ok(await realpath(filename) === filename, `${label} path cannot contain symlinks.`);
  ok(info.size <= BigInt(maximumBytes), `${label} exceeds its byte cap.`);
  const bytes = await readFile(filename);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { bytes, text, sha256: sha256(bytes) };
}

function mapBy(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    const value = row?.[key];
    ok(typeof value === "string" && value.length > 0 && !result.has(value), `${label} contains an invalid or duplicate ${key}.`);
    result.set(value, row);
  }
  return result;
}

function indexesOf(sequence, segment) {
  const indexes = [];
  for (let start = sequence.indexOf(segment); start >= 0; start = sequence.indexOf(segment, start + 1)) indexes.push(start);
  return indexes;
}

function exactOrderedTmMapping(entry, queueRow, developmentProfile) {
  const receptor = (entry.polymerEntities ?? []).find((entity) => entity.entityId === queueRow.receptor.selectedEntityId);
  ok(receptor, `${entry.pdbId} lacks its selected receptor entity.`);
  ok(developmentProfile.mappingStatus === "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7", "The 4XT1 development receptor profile is unresolved.");
  ok((developmentProfile.tmSegments ?? []).length === 7, "The 4XT1 development receptor profile must contain seven TM segments.");
  let previousEnd = -1;
  const segments = developmentProfile.tmSegments.map((segment) => {
    const positions = indexesOf(receptor.sequence, segment.sequence);
    ok(positions.length === 1, `${entry.pdbId} ${segment.segment} is not a unique exact construct-sequence match.`);
    const constructStartIndex0 = positions[0];
    const constructEndIndexExclusive0 = constructStartIndex0 + segment.sequence.length;
    ok(constructStartIndex0 >= previousEnd, `${entry.pdbId} ${segment.segment} is not in canonical order.`);
    previousEnd = constructEndIndexExclusive0;
    ok(sha256(Buffer.from(segment.sequence)) === segment.sequenceSha256, `${entry.pdbId} ${segment.segment} digest drifted.`);
    return {
      segment: segment.segment,
      residueCount: segment.residueCount,
      constructStartIndex0,
      constructEndIndexExclusive0,
      exactOccurrenceCount: positions.length,
      sequenceSha256: segment.sequenceSha256,
    };
  });
  const concatenated = developmentProfile.tmSegments.map((segment) => segment.sequence).join("");
  ok(sha256(Buffer.from(concatenated)) === developmentProfile.concatenatedTmSequenceSha256, "The development concatenated TM digest drifted.");
  return {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    pdbId: entry.pdbId,
    candidateNode: `candidate:${entry.pdbId}`,
    developmentNode: "development:4XT1",
    candidateReceptorEntityId: receptor.entityId,
    candidateSourceUniProtAccessions: byteSort((receptor.referenceSequences ?? [])
      .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
      .map((reference) => reference.databaseAccession)),
    candidateConstructSequenceLength: receptor.sequence.length,
    candidateConstructSequenceSha256: receptor.sequenceSha256,
    developmentCanonicalAccession: developmentProfile.canonicalAccession,
    developmentCanonicalTmSequenceLength: concatenated.length,
    developmentCanonicalTmSequenceSha256: developmentProfile.concatenatedTmSequenceSha256,
    mappingMethod: "EXACT_UNIQUE_ORDERED_MATCH_OF_EACH_DEVELOPMENT_CANONICAL_TM_SEGMENT_IN_FROZEN_CANDIDATE_CONSTRUCT_SEQUENCE",
    segments,
    allSevenSegmentsUniqueExactAndOrdered: true,
    globalTmIdentity: 1,
    coverageCandidateTm: 1,
    coverageDevelopmentTm: 1,
    frozenPrimaryReceptorThresholdSatisfied: true,
    componentUpperBoundAuthority: true,
    formalLeakageGraphRewritten: false,
    candidateGpcrdbProfileRewritten: false,
    targetEligibilityAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function conditionalReceptorAccounting(row, receptorPairMap) {
  const signals = row.directDevelopmentPregraphSignals.filter((signal) => signal.evidenceType === "POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE");
  ok(signals.length > 0, `${row.pdbId} lacks its recorded receptor-development signal.`);
  const links = signals.flatMap((signal) => signal.sourcePairIds.map((pairId) => {
    const pair = receptorPairMap.get(pairId);
    ok(pair?.possiblePrimaryReceptorSequenceLeakageEdge === true && pair.primaryThresholdSatisfied === true, `${pairId} is not a positive frozen primary receptor match.`);
    ok(pair.pairType === "CANDIDATE_DEVELOPMENT", `${pairId} is not a candidate-development pair.`);
    return {
      pairId,
      developmentNode: signal.developmentNode,
      exactCanonicalAccessionMatch: pair.exactCanonicalAccessionMatch,
      primaryIdentity: pair.alignment.identity,
      coverageA: pair.alignment.coverageA,
      coverageB: pair.alignment.coverageB,
    };
  })).sort((left, right) => byteCompare(left.pairId, right.pairId));
  return {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    pdbId: row.pdbId,
    priorReviewPriority: row.reviewPriority,
    upperBoundClass: "RECORDED_PRIMARY_RECEPTOR_EDGE_TO_DEVELOPMENT",
    recordedDevelopmentLinks: links,
    formalDisposition: "PENDING_REQUIRED_METADATA",
    independentComponentCountIncrementUpperBound: 0,
    upperBoundLogic: "If this entry contains an otherwise eligible direct receptor-VHH target, its selected receptor satisfies the frozen primary receptor rule against development and is excluded; if it does not, the entry contributes no component.",
    directVhhRoleInferenceRequiredForUpperBound: false,
    masterDispositionLedgerRewritten: false,
    targetFreezePermitted: false,
    nativeCoordinatesInspected: false,
  };
}

export async function buildDirectSignalSalvageBound(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const loaded = new Map();
  for (const relative of INPUT_RELS) loaded.set(relative, await readBound(root, relative, relative));
  const protocol = loaded.get(INPUT_RELS[0]).text;
  ok(/at least\s+ten/u.test(protocol) && /Fewer than ten terminates this\s+protocol version/u.test(protocol), "The minimum-component rule drifted.");
  ok(/same-chain receptor.?VHH fusions/iu.test(protocol) && /auxiliary G-protein nanobodies/iu.test(protocol), "The protocol exclusion rules drifted.");

  const contract = JSON.parse(loaded.get(INPUT_RELS[1]).text);
  const targetCensus = parseJsonl(loaded.get(INPUT_RELS[2]).text, INPUT_RELS[2]);
  const entries = parseJsonl(loaded.get(INPUT_RELS[3]).text, INPUT_RELS[3]);
  const queue = parseJsonl(loaded.get(INPUT_RELS[4]).text, INPUT_RELS[4]);
  const queueSummary = JSON.parse(loaded.get(INPUT_RELS[5]).text);
  const noDirectSummary = JSON.parse(loaded.get(INPUT_RELS[6]).text);
  const directStratumSummary = JSON.parse(loaded.get(INPUT_RELS[7]).text);
  const receptorPairs = parseJsonl(loaded.get(INPUT_RELS[8]).text, INPUT_RELS[8]);
  const developmentProfiles = parseJsonl(loaded.get(INPUT_RELS[9]).text, INPUT_RELS[9]);
  const targetMap = mapBy(targetCensus, "pdbId", "target census");
  const entryMap = mapBy(entries, "pdbId", "entry metadata");
  const receptorPairMap = mapBy(receptorPairs, "pairId", "receptor pair matrix");
  const developmentProfileMap = mapBy(developmentProfiles, "pdbId", "development receptor profiles");

  const directRows = queue.filter((row) => row.directDevelopmentPregraphSignalPresent === true);
  ok(directRows.length === 24 && queueSummary.directDevelopmentPregraphSignalCount === 24, "The 24-entry direct-signal salvage set drifted.");
  const directRowMap = mapBy(directRows, "pdbId", "direct-signal salvage rows");
  const recordedReceptorRows = directRows.filter((row) => row.directDevelopmentPregraphSignals.some((signal) => signal.evidenceType === "POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE"));
  ok(recordedReceptorRows.length === 21, "The recorded receptor-edge subset must contain 21 entries.");
  const recordedAccounting = recordedReceptorRows.map((row) => conditionalReceptorAccounting(row, receptorPairMap));

  const us28Mappings = ["5WB1", "5WB2"].map((pdbId) => {
    ok(directRowMap.has(pdbId) && entryMap.has(pdbId), `${pdbId} is absent from the frozen direct-signal inputs.`);
    return exactOrderedTmMapping(entryMap.get(pdbId), directRowMap.get(pdbId), developmentProfileMap.get("4XT1"));
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(us28Mappings.every((row) => row.developmentCanonicalTmSequenceSha256 === "1e239aa540e5be37c6875af243ff8687b335fee3f79e386cfe65993320cf2d8b"), "The US28 canonical TM sequence changed.");

  const exclusions = SOURCE_BACKED_EXCLUSIONS.map((assessment) => {
    const row = directRowMap.get(assessment.pdbId);
    const entry = entryMap.get(assessment.pdbId);
    ok(row && entry, `${assessment.pdbId} is absent from the direct-signal salvage set.`);
    ok(Object.hasOwn(contract.dispositionCodes, assessment.dispositionCode), `${assessment.dispositionCode} is not in the frozen disposition contract.`);
    return {
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId: assessment.pdbId,
      priorReviewPriority: row.reviewPriority,
      dispositionCode: assessment.dispositionCode,
      componentEffect: "NO_NEW_COMPONENT",
      reviewedApparentVhhEntities: assessment.reviewedApparentVhhEntities,
      directInterfaceEvidence: assessment.directInterfaceEvidence,
      dispositionReason: assessment.dispositionReason,
      publication: {
        doi: entry.primaryCitation?.doi ?? null,
        pmid: entry.primaryCitation?.pmid ?? null,
        title: entry.primaryCitation?.title ?? null,
      },
      evidenceUrls: byteSort(assessment.evidenceUrls),
      publicSourcesReviewed: true,
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
      nativeCoordinatesInspected: false,
    };
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(canonical(exclusions.map((row) => row.pdbId)) === canonical(["5WB1", "8TB7"]), "The source-backed exclusion set drifted.");

  const mappingByPdb = mapBy(us28Mappings, "pdbId", "US28 TM mappings");
  const exclusionByPdb = mapBy(exclusions, "pdbId", "source-backed exclusions");
  const specialAccounting = ["5WB1", "5WB2", "8TB7"].map((pdbId) => {
    const row = directRowMap.get(pdbId);
    if (pdbId === "5WB2") {
      const mapping = mappingByPdb.get(pdbId);
      return {
        schemaVersion: "1.0.0",
        studyId: "confovhh-hard-decoy-holdout-v3",
        pdbId,
        priorReviewPriority: row.reviewPriority,
        upperBoundClass: "SUPPLEMENTAL_EXACT_TM_EDGE_TO_DEVELOPMENT",
        recordedDevelopmentLinks: [{
          developmentNode: mapping.developmentNode,
          primaryIdentity: mapping.globalTmIdentity,
          coverageCandidateTm: mapping.coverageCandidateTm,
          coverageDevelopmentTm: mapping.coverageDevelopmentTm,
          evidenceFile: "supplemental-us28-tm-mappings.jsonl",
        }],
        formalDisposition: "PENDING_REQUIRED_METADATA",
        independentComponentCountIncrementUpperBound: 0,
        upperBoundLogic: "Any otherwise eligible direct receptor-VHH target in 5WB2 uses a receptor construct whose seven TM segments exactly match development entry 4XT1 under the frozen primary rule; otherwise it contributes no component.",
        directVhhRoleInferenceRequiredForUpperBound: false,
        masterDispositionLedgerRewritten: false,
        targetFreezePermitted: false,
        nativeCoordinatesInspected: false,
      };
    }
    const exclusion = exclusionByPdb.get(pdbId);
    return {
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId,
      priorReviewPriority: row.reviewPriority,
      upperBoundClass: pdbId === "5WB1" ? "SOURCE_BACKED_SAME_CHAIN_FUSION_EXCLUSION" : "SOURCE_BACKED_AUXILIARY_BINDER_EXCLUSION",
      recordedDevelopmentLinks: pdbId === "5WB1" ? [{
        developmentNode: mappingByPdb.get(pdbId).developmentNode,
        evidenceFile: "supplemental-us28-tm-mappings.jsonl",
      }] : [],
      formalDisposition: exclusion.dispositionCode,
      independentComponentCountIncrementUpperBound: 0,
      upperBoundLogic: exclusion.dispositionReason,
      directVhhRoleInferenceRequiredForUpperBound: false,
      masterDispositionLedgerRewritten: false,
      targetFreezePermitted: false,
      nativeCoordinatesInspected: false,
    };
  });
  const accounting = [...recordedAccounting, ...specialAccounting].sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(canonical(accounting.map((row) => row.pdbId)) === canonical(byteSort(directRows.map((row) => row.pdbId))), "The 24-entry accounting set is incomplete.");
  ok(accounting.every((row) => row.independentComponentCountIncrementUpperBound === 0), "A direct-signal salvage row retained a positive component increment.");

  const existingGroupCount = new Set(targetCensus.map((row) => row.provisionalGroupId)).size;
  ok(existingGroupCount === 7 && directStratumSummary.existingProvisionalComponentCount === 7, "The seven-group provisional census drifted.");
  const affectedExistingIds = byteSort(recordedReceptorRows.filter((row) => targetMap.has(row.pdbId)).map((row) => row.pdbId));
  ok(canonical(affectedExistingIds) === canonical(["8JXS"]), "The development-connected existing representative set drifted.");
  const censusImpact = affectedExistingIds.map((pdbId) => {
    const target = targetMap.get(pdbId);
    const accountingRow = accounting.find((row) => row.pdbId === pdbId);
    return {
      schemaVersion: "1.0.0",
      studyId: "confovhh-hard-decoy-holdout-v3",
      pdbId,
      provisionalGroupId: target.provisionalGroupId,
      priorProvisionalStatus: target.status,
      v3SurvivalUpperBound: 0,
      basis: "The existing representative has a frozen primary receptor-sequence edge to development. If otherwise eligible it is development-connected; if ineligible it cannot represent a holdout component.",
      recordedDevelopmentLinks: accountingRow.recordedDevelopmentLinks,
      formalDisposition: "PENDING_REQUIRED_METADATA",
      masterDispositionLedgerRewritten: false,
      nativeCoordinatesInspected: false,
    };
  });

  const existingProvisionalComponentSurvivalUpperBound = existingGroupCount - censusImpact.length;
  const selectedSalvageReviewIncrementUpperBound = noDirectSummary.independentComponentCountIncrementUpperBoundFromReviewedSet
    + accounting.reduce((sum, row) => sum + row.independentComponentCountIncrementUpperBound, 0);
  const prioritizedFrontierUpperBound = existingProvisionalComponentSurvivalUpperBound
    + directStratumSummary.directLookingEntryIncrementUpperBound
    + selectedSalvageReviewIncrementUpperBound;
  const minimumAdditionalComponentsRequiredFromUnselectedRows = directStratumSummary.requiredIndependentComponentCount - prioritizedFrontierUpperBound;
  const remainingFormalPendingRowCount = noDirectSummary.otherStrataRowsStillPendingAfterBoundedAudit - exclusions.length;
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T21:03:00Z",
    reviewedDirectSignalSalvageEntryCount: directRows.length,
    recordedPrimaryReceptorEdgeAccountingCount: recordedAccounting.length,
    supplementalUs28ExactTmMappingCount: us28Mappings.length,
    supplementalExactTmEdgeAccountingCount: 1,
    sourceBackedAuxiliaryBinderExclusionCount: exclusions.filter((row) => row.dispositionCode === "EXCLUDE_AUXILIARY_BINDER").length,
    sourceBackedFusionExclusionCount: exclusions.filter((row) => row.dispositionCode === "EXCLUDE_FUSION_DOMINATED_INTERFACE").length,
    independentComponentCountIncrementUpperBoundFromReviewedSet: 0,
    noDirectSignalReviewedIncrementUpperBound: noDirectSummary.independentComponentCountIncrementUpperBoundFromReviewedSet,
    selectedSalvageReviewEntryCount: queueSummary.selectedForSalvageReviewCount,
    selectedSalvageReviewCombinedIncrementUpperBound: selectedSalvageReviewIncrementUpperBound,
    existingProvisionalComponentCountBeforeThisAudit: existingGroupCount,
    developmentConnectedExistingRepresentativeIds: affectedExistingIds,
    existingProvisionalComponentSurvivalUpperBound,
    directLookingStratumIncrementUpperBound: directStratumSummary.directLookingEntryIncrementUpperBound,
    prioritizedFrontierUpperBound,
    requiredIndependentComponentCount: directStratumSummary.requiredIndependentComponentCount,
    unselectedOtherRowsStillOpenForComponentSearch: queueSummary.unselectedStillPendingCount,
    minimumAdditionalComponentsRequiredFromUnselectedRows,
    remainingFormalPendingOtherStrataRowCount: remainingFormalPendingRowCount,
    formalPendingRowsWithZeroComponentIncrementUpperBoundInThisPackage: accounting.filter((row) => row.formalDisposition === "PENDING_REQUIRED_METADATA").length,
    masterDispositionLedgerRewritten: false,
    wholeCensusTerminalDecisionReached: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
    interpretation: "All 24 direct-signal salvage rows have a zero independent-component increment upper bound. Twenty-one already carry a frozen primary receptor edge to development, 5WB2 gains the same bound from an exact seven-segment US28 TM mapping to development entry 4XT1, 5WB1 is a same-chain receptor-VHH fusion, and 8TB7 contains a Fab-hinge fiducial nanobody. Because existing representative 8JXS is development-connected, at most six of the seven prior provisional groups survive. Even adding both direct-looking transitive groups leaves the prioritized frontier at eight, so at least two independent eligible components must come from the 212 unselected rows under the most favorable remaining assumptions.",
  };
  ok(summary.selectedSalvageReviewEntryCount === 31 && summary.selectedSalvageReviewCombinedIncrementUpperBound === 0, "The combined 31-row salvage bound drifted.");
  ok(summary.existingProvisionalComponentSurvivalUpperBound === 6 && summary.prioritizedFrontierUpperBound === 8, "The prioritized frontier bound drifted.");
  ok(summary.minimumAdditionalComponentsRequiredFromUnselectedRows === 2 && summary.unselectedOtherRowsStillOpenForComponentSearch === 212, "The remaining component requirement drifted.");
  ok(summary.remainingFormalPendingOtherStrataRowCount === 236 && summary.formalPendingRowsWithZeroComponentIncrementUpperBoundInThisPackage === 22, "The formal pending-row accounting drifted.");

  const accountingBytes = Buffer.from(jsonl(accounting));
  const mappingBytes = Buffer.from(jsonl(us28Mappings));
  const exclusionBytes = Buffer.from(jsonl(exclusions));
  const censusImpactBytes = Buffer.from(jsonl(censusImpact));
  const summaryBytes = Buffer.from(pretty(summary));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: path.relative(root, HERE),
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: Object.fromEntries(INPUT_RELS.map((relative) => [relative, loaded.get(relative).sha256])),
    evidenceBoundary: "Frozen public metadata and sequence pregraphs plus public primary-paper role statements only; no coordinate-derived interface inference.",
    outputDigests: {
      "component-upper-bound-accounting.jsonl": sha256(accountingBytes),
      "supplemental-us28-tm-mappings.jsonl": sha256(mappingBytes),
      "source-backed-exclusions.jsonl": sha256(exclusionBytes),
      "provisional-census-impact.jsonl": sha256(censusImpactBytes),
      "summary.json": sha256(summaryBytes),
    },
    partialAuditOnly: true,
    formalLeakageGraphRewritten: false,
    masterDispositionLedgerRewritten: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const readme = [
    "# ConfoVHH hard-decoy v3 direct-signal salvage bound",
    "",
    `Status: **${STATUS}**`,
    "",
    "This bounded metadata-stage audit closes the independent-component upper bound for the 24 salvage-review rows that carried a direct development-pregraph signal. It does not require native coordinates or direct-interface geometry.",
    "",
    "## Result",
    "",
    "Twenty-one rows already have a frozen primary receptor-sequence match to development. Conditional upper-bound logic is sufficient: if a row contains an otherwise eligible direct receptor-VHH target, the receptor edge excludes it; if it does not, the row contributes no component.",
    "",
    "The two US28 receptor-fusion sequences, 5WB1 and 5WB2, each contain all seven canonical TM segments from development entry 4XT1 as unique, exact, ordered matches. This supplies the same zero-component upper bound despite their unresolved GPCRdb candidate profiles. Independently, 5WB1 is excluded as a same-chain receptor-VHH fusion. Entry 8TB7 is excluded because its VHH is a Fab-hinge fiducial rather than a direct GPR61 binder.",
    "",
    "All 31 rows in the selected salvage queue now add zero independent components. Existing provisional representative 8JXS is also development-connected by the frozen receptor rule, so at most six of the seven earlier provisional groups survive. Adding the direct-looking stratum's favorable two-group bound yields a prioritized frontier of at most eight. Therefore at least two independent eligible components must be recovered from the 212 unselected rows, and more would be required if another provisional group fails.",
    "",
    "This is a component-viability bound, not a completed formal disposition ledger or whole-census terminal decision. Target freeze and execution remain forbidden. No native coordinates, relative poses, prediction outputs, holdout labels, or ConfoVHH performance results were accessed.",
    "",
  ].join("\n");
  const files = {
    "README.md": readme,
    "component-upper-bound-accounting.jsonl": accountingBytes.toString(),
    "supplemental-us28-tm-mappings.jsonl": mappingBytes.toString(),
    "source-backed-exclusions.jsonl": exclusionBytes.toString(),
    "provisional-census-impact.jsonl": censusImpactBytes.toString(),
    "summary.json": summaryBytes.toString(),
    "manifest.json": pretty(manifest),
  };
  Object.entries(files).forEach(([name, text]) => clean(name, text));
  return { accounting, us28Mappings, exclusions, censusImpact, files, manifest, summary };
}

function checksumsFor(files) {
  return `${Object.keys(files).sort(byteCompare).map((name) => `${sha256(Buffer.from(files[name]))}  ${name}`).join("\n")}\n`;
}

export async function writeDirectSignalSalvageBound(repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT_REL)) {
  const built = await buildDirectSignalSalvageBound(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), checksumsFor(built.files));
  return { output: outputDirectory, ...built };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const result = await writeDirectSignalSalvageBound();
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
}
