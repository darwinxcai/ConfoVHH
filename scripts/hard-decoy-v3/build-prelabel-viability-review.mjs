import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT_REL = "validation/hard-decoy-holdout-v3/prelabel-viability-review-2026-09-04";
const PROTOCOL_REL = "HARD_DECOY_PROTOCOL_V3.md";
const CENSUS_SUMMARY_REL = "validation/hard-decoy-holdout-v2/prelabel-census/census-summary.json";
const DEVELOPMENT_REL = "validation/hard-decoy-holdout-v2/prelabel-census/development-registry.json";
const ENTRIES_REL = "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl";
const TRIAGE_REL = "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/triage-signals.jsonl";
const EXACT_RELS = [
  "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29/candidate-candidate-evidence.jsonl",
  "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29/candidate-development-evidence.jsonl",
  "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29/development-development-evidence.jsonl",
];
const VHH_RELS = [
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-candidate-vhh-matrix.jsonl",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-development-vhh-matrix.jsonl",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/development-development-vhh-matrix.jsonl",
];
const RECEPTOR_RELS = [
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/receptor-pair-matrix.jsonl",
];

const STATUS = "PRELABEL_VIABILITY_REVIEW_CREATED_TARGET_CENSUS_BLOCKED";
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COORDINATES = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult)$/iu;
const EDGE_ORDER = new Map([
  ["DEFINITE_METADATA_IDENTITY", 0],
  ["POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE", 1],
  ["POSSIBLE_VHH_SEQUENCE_EDGE_ROLE_UNRESOLVED", 2],
]);
const REVIEW_ORDER = new Map([
  ["NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW", 0],
  ["TRANSITIVE_PREGRAPH_DEVELOPMENT_PATH_REVIEW", 1],
  ["DIRECT_PREGRAPH_DEVELOPMENT_PATH_REVIEW", 2],
]);

function ok(value, message) {
  if (!value) throw new Error(message);
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function byteSort(values) {
  return [...values].sort(byteCompare);
}

function uniqueStrings(values) {
  return byteSort([...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]);
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

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORDINATES.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout label appeared in ${label}.`);
}

function walk(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    ok(!FORBIDDEN_KEYS.test(key), `Forbidden result field: ${[...trail, key].join(".")}`);
    if (typeof item === "number") ok(Number.isFinite(item), `Nonfinite number at ${[...trail, key].join(".")}`);
    if (typeof item === "string") clean([...trail, key].join("."), item);
    walk(item, [...trail, key]);
  }
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

function mapByPdb(rows, label) {
  const map = new Map();
  for (const row of rows) {
    ok(PDB_ID.test(row?.pdbId ?? ""), `${label} contains an invalid PDB ID.`);
    ok(!map.has(row.pdbId), `${label} contains duplicate PDB ID ${row.pdbId}.`);
    map.set(row.pdbId, row);
  }
  return map;
}

function edgeKey(nodeA, nodeB) {
  return byteCompare(nodeA, nodeB) <= 0 ? `${nodeA}|${nodeB}` : `${nodeB}|${nodeA}`;
}

function addEvidence(edgeMap, row, evidenceType) {
  ok(typeof row.nodeA === "string" && typeof row.nodeB === "string" && row.nodeA !== row.nodeB, "Invalid pregraph edge nodes.");
  const key = edgeKey(row.nodeA, row.nodeB);
  if (!edgeMap.has(key)) {
    const [nodeA, nodeB] = byteCompare(row.nodeA, row.nodeB) <= 0 ? [row.nodeA, row.nodeB] : [row.nodeB, row.nodeA];
    edgeMap.set(key, { nodeA, nodeB, evidenceTypes: new Set(), sourcePairIds: new Set() });
  }
  const edge = edgeMap.get(key);
  edge.evidenceTypes.add(evidenceType);
  if (typeof row.pairId === "string") edge.sourcePairIds.add(row.pairId);
}

function edgeTypeCompare(left, right) {
  return (EDGE_ORDER.get(left) ?? 99) - (EDGE_ORDER.get(right) ?? 99) || byteCompare(left, right);
}

function finalizeGraph(edgeMap) {
  const edges = [...edgeMap.values()].map((edge) => {
    const evidenceTypes = [...edge.evidenceTypes].sort(edgeTypeCompare);
    return {
      nodeA: edge.nodeA,
      nodeB: edge.nodeB,
      preferredEvidenceType: evidenceTypes[0],
      pregraphEvidenceTypes: evidenceTypes,
      sourcePairIds: byteSort(edge.sourcePairIds),
      formalLeakageAuthority: false,
    };
  }).sort((left, right) => byteCompare(edgeKey(left.nodeA, left.nodeB), edgeKey(right.nodeA, right.nodeB)));
  const adjacency = new Map();
  for (const edge of edges) {
    for (const [node, neighbor] of [[edge.nodeA, edge.nodeB], [edge.nodeB, edge.nodeA]]) {
      if (!adjacency.has(node)) adjacency.set(node, []);
      adjacency.get(node).push({ neighbor, edge });
    }
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => edgeTypeCompare(left.edge.preferredEvidenceType, right.edge.preferredEvidenceType) || byteCompare(left.neighbor, right.neighbor));
  }
  return { edges, adjacency };
}

function shortestDevelopmentPath(start, adjacency) {
  const queue = [start];
  const previous = new Map([[start, null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.startsWith("development:")) {
      const result = [];
      let cursor = current;
      while (previous.get(cursor) !== null) {
        const step = previous.get(cursor);
        result.push({
          from: step.from,
          to: cursor,
          preferredEvidenceType: step.edge.preferredEvidenceType,
          pregraphEvidenceTypes: step.edge.pregraphEvidenceTypes,
          sourcePairIds: step.edge.sourcePairIds,
          formalLeakageAuthority: false,
        });
        cursor = step.from;
      }
      return result.reverse();
    }
    for (const { neighbor, edge } of adjacency.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, { from: current, edge });
      queue.push(neighbor);
    }
  }
  return null;
}

function selectedEntity(entry, entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length !== 1) return null;
  return entry.polymerEntities?.find((entity) => entity.entityId === entityIds[0]) ?? null;
}

function uniprotAccessions(entity) {
  return uniqueStrings((entity?.referenceSequences ?? [])
    .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
    .map((reference) => reference.databaseAccession));
}

function buildQueueRow({ pdbId, entry, triage, pathToDevelopment }) {
  const receptor = selectedEntity(entry, triage.preferredReceptorAuthChainEntityIds);
  const vhhCandidates = (entry.polymerEntities ?? [])
    .filter((entity) => triage.vhhLikeEntityIds.includes(entity.entityId))
    .map((entity) => ({
      entityId: entity.entityId,
      description: entity.description ?? null,
      sequenceLength: entity.sequenceLength ?? null,
      sequenceSha256: entity.sequenceSha256 ?? null,
    }))
    .sort((left, right) => byteCompare(left.entityId, right.entityId));
  const reviewClass = pathToDevelopment === null
    ? "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW"
    : pathToDevelopment.length === 1
      ? "DIRECT_PREGRAPH_DEVELOPMENT_PATH_REVIEW"
      : "TRANSITIVE_PREGRAPH_DEVELOPMENT_PATH_REVIEW";
  const reviewClassReason = reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW"
    ? "No path to a development node was found in the combined metadata, receptor-TM, and role-unresolved VHH pregraphs. This is a review priority, not evidence of independence or eligibility."
    : reviewClass === "DIRECT_PREGRAPH_DEVELOPMENT_PATH_REVIEW"
      ? "A one-edge path to a development node exists in at least one pregraph. Direct-role, parent/variant, and formal edge authority remain unresolved unless separately adjudicated."
      : "A multi-edge path to a development node exists through candidate nodes. Every edge and intermediate direct-binder role requires source-backed adjudication before a formal leakage conclusion.";
  return {
    pdbId,
    reviewPriority: null,
    reviewClass,
    reviewClassReason,
    sourceReviewStratum: triage.reviewStratum,
    title: entry.title ?? null,
    releaseDate: entry.releaseDate ?? null,
    experimentalMethods: uniqueStrings(entry.experimentalMethods ?? []),
    resolutionAngstrom: [...(entry.resolutionAngstrom ?? [])].filter(Number.isFinite).sort((a, b) => a - b),
    receptor: {
      gpcrdbProtein: entry.gpcrdb?.protein ?? null,
      preferredAuthChain: triage.preferredReceptorAuthChain ?? null,
      selectedEntityId: receptor?.entityId ?? null,
      description: receptor?.description ?? null,
      uniprotAccessions: uniprotAccessions(receptor),
      constructSequenceSha256: receptor?.sequenceSha256 ?? null,
    },
    vhhCandidates,
    publication: {
      doi: entry.primaryCitation?.doi ?? null,
      pmid: entry.primaryCitation?.pmid ?? null,
      title: entry.primaryCitation?.title ?? null,
    },
    metadataSignals: {
      auxiliaryLexicalEntityIds: uniqueStrings(triage.auxiliaryLexicalEntityIds ?? []),
      constructRiskEntityIds: uniqueStrings(triage.constructRiskEntityIds ?? []),
    },
    developmentPath: pathToDevelopment === null ? null : {
      edgeCount: pathToDevelopment.length,
      edges: pathToDevelopment,
      formalLeakageAuthority: false,
    },
    requiredAdjudications: [
      "direct receptor-VHH role and interface from public source evidence",
      "construct, fusion, and auxiliary-binder status",
      "VHH parent and variant provenance",
      "formal receptor and VHH sequence-edge authority",
      "primary-publication identity and cross-entry linkage",
      "sealed native-epitope oracle after all pre-oracle gates pass",
    ],
    formalLeakageStatus: "UNRESOLVED",
    formalDisposition: "PENDING_REQUIRED_METADATA",
    pregraphPathMayAutoExclude: false,
    automaticTargetPromotionPermitted: false,
    targetFreezePermitted: false,
    nativeCoordinatesInspected: false,
    evidenceUrls: uniqueStrings([
      `https://www.rcsb.org/structure/${pdbId}`,
      entry.primaryCitation?.doi ? `https://doi.org/${entry.primaryCitation.doi}` : null,
      entry.primaryCitation?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${entry.primaryCitation.pmid}/` : null,
    ]),
  };
}

async function loadInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const allRels = [PROTOCOL_REL, CENSUS_SUMMARY_REL, DEVELOPMENT_REL, ENTRIES_REL, TRIAGE_REL, ...EXACT_RELS, ...VHH_RELS, ...RECEPTOR_RELS];
  const loaded = new Map();
  for (const relative of allRels) loaded.set(relative, await readBound(root, relative, relative));
  const protocolText = loaded.get(PROTOCOL_REL).text;
  ok(/at least\s+ten/u.test(protocolText) && /Fewer than ten terminates this\s+protocol version/u.test(protocolText), "The v3 minimum-component rule drifted.");
  const censusSummary = JSON.parse(loaded.get(CENSUS_SUMMARY_REL).text);
  ok(censusSummary.requiredIndependentGroups === 10 && censusSummary.screenedProvisionalGroupCount === 7 && censusSummary.formallyClearedGroupCount === 0, "The recorded census checkpoint drifted.");
  const development = JSON.parse(loaded.get(DEVELOPMENT_REL).text);
  const developmentIds = new Set((development.developmentGpcrVhhStructures ?? []).map((row) => row.pdbId));
  ok(developmentIds.size === 17, "The development registry must retain 17 unique structures.");
  const entries = parseJsonl(loaded.get(ENTRIES_REL).text, ENTRIES_REL);
  const triage = parseJsonl(loaded.get(TRIAGE_REL).text, TRIAGE_REL);
  ok(entries.length === 287 && triage.length === 287, "The frozen entry snapshot must retain 287 rows.");
  const entryMap = mapByPdb(entries, "entry metadata");
  const triageMap = mapByPdb(triage, "triage metadata");
  ok(entryMap.size === triageMap.size && [...entryMap.keys()].every((id) => triageMap.has(id)), "Entry and triage snapshots do not reconcile.");
  return {
    root,
    loaded,
    censusSummary,
    developmentIds,
    entries,
    triage,
    entryMap,
    triageMap,
    inputDigests: Object.fromEntries(allRels.map((relative) => [relative, loaded.get(relative).sha256])),
  };
}

function validateModel(model) {
  const { decision, summary, queue } = model;
  ok(decision.status === STATUS && summary.status === STATUS, "Pre-label viability status drifted.");
  ok(decision.requiredIndependentComponents === 10, "The minimum independent-component requirement changed.");
  ok(decision.currentFormallyClearedComponents === 0 && decision.currentProvisionalComponents === 7, "Checkpoint component counts drifted.");
  ok(decision.decisionRule.thresholdMayBeLoweredAfterReview === false, "The minimum-component threshold cannot be relaxed after review.");
  ok(decision.decisionRule.fewerThanTenOutcome === "TARGET_CENSUS_BLOCKED", "The fewer-than-ten stop rule changed.");
  ok(decision.decisionRule.smallerGpcrPanelStudyLabel === "EXPLORATORY_FEASIBILITY_STUDY", "A smaller GPCR panel cannot be relabeled as the formal holdout.");
  ok(decision.decisionRule.broaderStudyMustBeSeparatelyPreregistered === true && decision.decisionRule.crossStudyPoolingPermitted === false, "The fallback-study separation rule changed.");
  ok(decision.targetFreezePermitted === false && decision.executionAuthorized === false, "The decision record cannot authorize execution.");
  ok(summary.sourceEntryCount === 287 && summary.directLookingEntryCount === 39 && summary.nonDevelopmentDirectLookingEntryCount === 29, "Priority-queue source counts drifted.");
  ok(summary.directDevelopmentPathCount === 19 && summary.transitiveDevelopmentPathCount === 4 && summary.noDevelopmentPathCount === 6, "Priority-queue path counts drifted.");
  ok(queue.length === 29 && new Set(queue.map((row) => row.pdbId)).size === 29, "Priority queue must contain 29 unique entries.");
  ok(queue.every((row, index) => row.reviewPriority === index + 1), "Priority ranks must be contiguous and deterministic.");
  ok(queue.every((row) => PDB_ID.test(row.pdbId) && row.sourceReviewStratum === "DIRECT_TARGET_CANDIDATE_REVIEW"), "Priority queue includes an invalid source row.");
  ok(queue.every((row) => row.formalLeakageStatus === "UNRESOLVED" && row.formalDisposition === "PENDING_REQUIRED_METADATA"), "The review queue assigned an unauthorized formal disposition.");
  ok(queue.every((row) => row.pregraphPathMayAutoExclude === false && row.automaticTargetPromotionPermitted === false && row.targetFreezePermitted === false), "The review queue granted unauthorized decision authority.");
  ok(queue.every((row) => row.nativeCoordinatesInspected === false), "The review queue cannot access native coordinates.");
  const noPath = queue.filter((row) => row.reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW").map((row) => row.pdbId);
  ok(canonical(noPath) === canonical(["6N51", "7DGE", "7EPB", "8T7H", "8XFP", "8XFS"]), "The highest-priority no-path set drifted.");
  const sorted = [...queue].sort((left, right) => (REVIEW_ORDER.get(left.reviewClass) - REVIEW_ORDER.get(right.reviewClass)) || byteCompare(left.pdbId, right.pdbId));
  ok(canonical(queue.map((row) => row.pdbId)) === canonical(sorted.map((row) => row.pdbId)), "Priority queue order drifted.");
  walk(model);
}

export async function buildPrelabelViabilityReview(repositoryRoot = ROOT) {
  const inputs = await loadInputs(repositoryRoot);
  const edgeMap = new Map();
  for (const relative of EXACT_RELS) {
    for (const row of parseJsonl(inputs.loaded.get(relative).text, relative)) {
      if (row.definitePregraphEdge === true) addEvidence(edgeMap, row, "DEFINITE_METADATA_IDENTITY");
    }
  }
  for (const relative of VHH_RELS) {
    for (const row of parseJsonl(inputs.loaded.get(relative).text, relative)) {
      if (row.possibleMetadataSequenceLeakageEdge === true) addEvidence(edgeMap, row, "POSSIBLE_VHH_SEQUENCE_EDGE_ROLE_UNRESOLVED");
    }
  }
  for (const relative of RECEPTOR_RELS) {
    for (const row of parseJsonl(inputs.loaded.get(relative).text, relative)) {
      if (row.possiblePrimaryReceptorSequenceLeakageEdge === true) addEvidence(edgeMap, row, "POSSIBLE_RECEPTOR_TM_SEQUENCE_EDGE");
    }
  }
  const graph = finalizeGraph(edgeMap);
  const directLookingIds = inputs.triage.filter((row) => row.reviewStratum === "DIRECT_TARGET_CANDIDATE_REVIEW").map((row) => row.pdbId);
  const developmentDirectIds = directLookingIds.filter((id) => inputs.developmentIds.has(id));
  const reviewIds = directLookingIds.filter((id) => !inputs.developmentIds.has(id));
  let queue = reviewIds.map((pdbId) => buildQueueRow({
    pdbId,
    entry: inputs.entryMap.get(pdbId),
    triage: inputs.triageMap.get(pdbId),
    pathToDevelopment: shortestDevelopmentPath(`candidate:${pdbId}`, graph.adjacency),
  }));
  queue = queue
    .sort((left, right) => (REVIEW_ORDER.get(left.reviewClass) - REVIEW_ORDER.get(right.reviewClass)) || byteCompare(left.pdbId, right.pdbId))
    .map((row, index) => ({ ...row, reviewPriority: index + 1 }));
  const counts = Object.fromEntries([...REVIEW_ORDER.keys()].map((key) => [key, queue.filter((row) => row.reviewClass === key).length]));
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: "2026-09-04T20:30:00Z",
    sourceEntryCount: inputs.entries.length,
    directLookingEntryCount: directLookingIds.length,
    exactDevelopmentPdbDirectLookingCount: developmentDirectIds.length,
    nonDevelopmentDirectLookingEntryCount: queue.length,
    directDevelopmentPathCount: counts.DIRECT_PREGRAPH_DEVELOPMENT_PATH_REVIEW,
    transitiveDevelopmentPathCount: counts.TRANSITIVE_PREGRAPH_DEVELOPMENT_PATH_REVIEW,
    noDevelopmentPathCount: counts.NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW,
    noDevelopmentPathIds: queue.filter((row) => row.reviewClass === "NO_PREGRAPH_DEVELOPMENT_PATH_REVIEW").map((row) => row.pdbId),
    pregraphPathsAreFormalLeakageDecisions: false,
    queueRowsAreScientificDispositions: false,
    formallyClearedComponentCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  const decision = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    recordedAtUtc: summary.recordedAtUtc,
    purpose: "Record the statistical stop/fallback rule before completing candidate adjudication and prioritize label-safe review without converting pregraph signals into formal leakage decisions.",
    authoritativeProtocol: {
      path: PROTOCOL_REL,
      sha256: inputs.inputDigests[PROTOCOL_REL],
    },
    requiredIndependentComponents: 10,
    currentProvisionalComponents: inputs.censusSummary.screenedProvisionalGroupCount,
    currentFormallyClearedComponents: inputs.censusSummary.formallyClearedGroupCount,
    interpretation: "Provisional components are candidates for adjudication, not independent observations in a completed benchmark. The current formal sample size is zero because no component has cleared every gate.",
    decisionRule: {
      atLeastTenOutcome: "CONTINUE_TO_REMAINING_PRELABEL_GATES_WITHOUT_AUTOMATIC_EXECUTION",
      fewerThanTenOutcome: "TARGET_CENSUS_BLOCKED",
      thresholdMayBeLoweredAfterReview: false,
      candidateMayBeAddedOnlyToReachCount: false,
      smallerGpcrPanelStudyLabel: "EXPLORATORY_FEASIBILITY_STUDY",
      smallerPanelMaySupportFormalHoldoutClaim: false,
      broaderStudyMustBeSeparatelyPreregistered: true,
      crossStudyPoolingPermitted: false,
    },
    fallbackDirection: {
      preferredScope: "separately preregistered membrane-protein-VHH hard-decoy benchmark",
      rationale: "A broader membrane-protein scope can increase independent components while remaining closer to the intended receptor-VHH use case than a general soluble-antigen benchmark.",
      gpcrPanelRoleIfBelowTen: "secondary exploratory feasibility result",
      exactFallbackProtocolFrozen: false,
    },
    prioritizedReview: {
      sourceEntryCount: summary.sourceEntryCount,
      pendingDispositionRowsAtRecovery: 272,
      directLookingEntryCount: summary.directLookingEntryCount,
      nonDevelopmentDirectLookingEntryCount: summary.nonDevelopmentDirectLookingEntryCount,
      directOrTransitivePregraphDevelopmentPathCount: summary.directDevelopmentPathCount + summary.transitiveDevelopmentPathCount,
      noPregraphDevelopmentPathCount: summary.noDevelopmentPathCount,
      noPregraphPathDoesNotEstablishIndependence: true,
    },
    allowedNow: [
      "public metadata and primary-publication adjudication",
      "direct receptor-VHH and construct-role review",
      "VHH parent and variant provenance review",
      "reproducibility and immutable generator-environment work",
      "separate fallback-study protocol drafting",
      "manuscript methods and claim-boundary drafting",
    ],
    forbiddenNow: [
      "target freeze",
      "final MSA retrieval",
      "GPU prediction generation",
      "native holdout coordinate or relative-pose inspection",
      "DockQ or CAPRI label access",
      "ConfoVHH holdout scoring or performance analysis",
      "CRO commissioning tied to an unfrozen target set",
    ],
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const queueText = jsonl(queue);
  const summaryText = pretty(summary);
  const decisionText = pretty(decision);
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    generatorScript: "scripts/hard-decoy-v3/build-prelabel-viability-review.mjs",
    generatorScriptSha256: sha256(await readFile(HERE)),
    inputDigests: inputs.inputDigests,
    graphConstruction: {
      exactMetadataEdgeRule: "definitePregraphEdge=true",
      receptorEdgeRule: "possiblePrimaryReceptorSequenceLeakageEdge=true",
      vhhEdgeRule: "possibleMetadataSequenceLeakageEdge=true",
      pathsAreReviewOnly: true,
      formalLeakageAuthority: false,
      intermediateCandidateNodesPermitted: true,
      shortestPathTieBreak: "fewest edges, then preferred evidence type, then bytewise node ID",
    },
    outputDigests: {
      "candidate-review-queue.jsonl": sha256(Buffer.from(queueText)),
      "decision-record.json": sha256(Buffer.from(decisionText)),
      "summary.json": sha256(Buffer.from(summaryText)),
    },
    exactDevelopmentPdbDirectLookingIds: byteSort(developmentDirectIds),
    formalDispositionAssigned: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
  };
  const manifestText = pretty(manifest);
  const readme = [
    "# ConfoVHH hard-decoy v3 pre-label viability review",
    "",
    `Status: **${STATUS}**`,
    "",
    "This package records the statistical stop/fallback rule before further candidate adjudication and creates a deterministic review queue from already frozen public metadata and pregraphs. It does not inspect native coordinates, assign labels, clear targets, or authorize execution.",
    "",
    "## Statistical decision",
    "",
    "The formal GPCR-VHH holdout still requires at least 10 leakage-cleared independent components. Seven previously screened components remain provisional and zero are formally cleared. If fewer than 10 survive, v3 remains blocked; any smaller GPCR panel must be reported as an exploratory feasibility study. A broader membrane-protein-VHH benchmark must be separately preregistered and cannot be pooled with v3.",
    "",
    "## Review queue",
    "",
    `The frozen 287-entry snapshot contains ${summary.directLookingEntryCount} metadata-direct-looking entries. After removing ${summary.exactDevelopmentPdbDirectLookingCount} exact development PDB IDs, ${summary.nonDevelopmentDirectLookingEntryCount} entries remain for prioritized review:`,
    "",
    `- ${summary.noDevelopmentPathCount} have no path to development in the combined review-only pregraph and are reviewed first;`,
    `- ${summary.transitiveDevelopmentPathCount} have a multi-edge path to development through candidate nodes; and`,
    `- ${summary.directDevelopmentPathCount} have a one-edge path to development.`,
    "",
    "A path is not yet a formal exclusion because VHH roles, parent/variant provenance, and some edge authority remain unresolved. Likewise, absence of a path is not evidence that a target is independent or eligible. Every row remains `PENDING_REQUIRED_METADATA`.",
    "",
    "## Highest-priority entries",
    "",
    summary.noDevelopmentPathIds.map((id) => `- ${id}`).join("\n"),
    "",
    "These entries still require public-source direct-interface, construct, auxiliary-binder, parent/variant, publication, and later sealed native-epitope review. The queue intentionally contains no coordinates, native interface residues, prediction outputs, DockQ/CAPRI labels, or ConfoVHH holdout results.",
    "",
  ].join("\n");
  const model = { decision, summary, queue, manifest };
  validateModel(model);
  clean("README.md", readme);
  return {
    model,
    files: {
      "README.md": readme,
      "candidate-review-queue.jsonl": queueText,
      "decision-record.json": decisionText,
      "manifest.json": manifestText,
      "summary.json": summaryText,
    },
  };
}

function checksumsFor(files) {
  return `${Object.keys(files).sort(byteCompare).map((name) => `${sha256(Buffer.from(files[name]))}  ${name}`).join("\n")}\n`;
}

export async function writePrelabelViabilityReview({ repositoryRoot = ROOT, outputDirectory } = {}) {
  ok(typeof outputDirectory === "string" && outputDirectory.length > 0, "An output directory is required.");
  const built = await buildPrelabelViabilityReview(repositoryRoot);
  await mkdir(outputDirectory, { recursive: false });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text, { flag: "wx" });
  await writeFile(path.join(outputDirectory, "checksums.sha256"), checksumsFor(built.files), { flag: "wx" });
  return built.model.summary;
}

export async function verifyPrelabelViabilityReview(repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT_REL)) {
  const built = await buildPrelabelViabilityReview(repositoryRoot);
  const expectedChecksums = checksumsFor(built.files);
  for (const [name, expected] of Object.entries(built.files)) {
    const observed = await readFile(path.join(outputDirectory, name), "utf8");
    clean(name, observed);
    ok(observed === expected, `${name} drifted from deterministic reconstruction.`);
  }
  const observedChecksums = await readFile(path.join(outputDirectory, "checksums.sha256"), "utf8");
  ok(observedChecksums === expectedChecksums, "checksums.sha256 drifted from the deterministic inventory.");
  validateModel(built.model);
  return built.model.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const writeArg = process.argv.find((arg) => arg.startsWith("--write="));
  const verifyArg = process.argv.find((arg) => arg.startsWith("--verify="));
  const result = writeArg
    ? await writePrelabelViabilityReview({ repositoryRoot: ROOT, outputDirectory: path.resolve(writeArg.slice("--write=".length)) })
    : await verifyPrelabelViabilityReview(ROOT, verifyArg ? path.resolve(verifyArg.slice("--verify=".length)) : path.join(ROOT, OUTPUT_REL));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
