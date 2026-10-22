import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDevelopmentMetadataSnapshot } from "./v3-development-metadata.mjs";
import { verifyDispositionSeed } from "./v3-disposition-seed.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/exact-evidence-contract-2026-08-29.json";
const STATUS = "EXACT_METADATA_EVIDENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_FORMAL_LEAKAGE_AUDIT";
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const NODE_ID = /^(?:candidate|development):[0-9][A-Z0-9]{3}$/u;
const COORDINATE = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult|annotationEpitopeEdge)$/iu;
const MAX_FILES = 24;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function uniqueStrings(values) {
  return byteSort([...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]);
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
}

function parseJsonl(text, label) {
  clean(label, text);
  ok(text.endsWith("\n") || text.length === 0, `${label} must be empty or end with LF.`);
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line, index) => {
    try {
      const value = JSON.parse(line);
      walk(value);
      return value;
    } catch (error) {
      throw new Error(`${label}:${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORDINATE.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout-label assignment appeared in ${label}.`);
}

function walk(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    ok(!FORBIDDEN_KEYS.test(key), `Forbidden result field: ${[...trail, key].join(".")}`);
    walk(item, [...trail, key]);
  }
}

function safePath(root, relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped its root.`);
  return filename;
}

async function readDirect(root, relative, label, maximumBytes = MAX_FILE_BYTES) {
  const filename = safePath(root, relative, label);
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  ok(await realpath(filename) === filename, `${label} path cannot contain symlinks.`);
  ok(info.size <= BigInt(maximumBytes), `${label} exceeds its byte cap.`);
  const bytes = await readFile(filename);
  ok(bytes.byteLength <= maximumBytes, `${label} changed beyond its byte cap.`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { filename, bytes, text, sha256: sha256(bytes) };
}

function mapUnique(rows, key, label, pattern = null) {
  const map = new Map();
  for (const row of rows) {
    const id = row?.[key];
    ok(typeof id === "string" && (!pattern || pattern.test(id)), `${label} contains an invalid ${key}.`);
    ok(!map.has(id), `${label} contains duplicate ${key}: ${id}`);
    map.set(id, row);
  }
  return map;
}

function uniProtAccessions(entity) {
  if (!entity) return [];
  return uniqueStrings((entity.referenceSequences ?? [])
    .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
    .map((reference) => reference.databaseAccession));
}

function candidateNode(entry, disposition) {
  const receptorIds = entry.receptorMapping?.preferredAuthChainEntityIds ?? [];
  const receptor = receptorIds.length === 1
    ? entry.polymerEntities?.find((entity) => entity.entityId === receptorIds[0]) ?? null
    : null;
  const vhhIds = uniqueStrings(entry.metadataSignals?.vhhLikeEntityIds ?? []);
  const vhhCandidates = vhhIds.map((entityId) => entry.polymerEntities?.find((entity) => entity.entityId === entityId) ?? null)
    .filter(Boolean)
    .map((entity) => ({
      entityId: entity.entityId,
      description: entity.description ?? null,
      sequenceLength: entity.sequenceLength ?? null,
      sequenceSha256: entity.sequenceSha256 ?? null,
      authAsymIds: uniqueStrings(entity.authAsymIds ?? []),
      labelAsymIds: uniqueStrings(entity.labelAsymIds ?? []),
    }))
    .sort((left, right) => byteCompare(left.entityId, right.entityId));
  ok(vhhCandidates.length === vhhIds.length, `${entry.pdbId} VHH metadata candidate IDs do not resolve to entities.`);
  const status = vhhCandidates.length === 1 ? "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE"
    : vhhCandidates.length === 0 ? "NO_METADATA_CANDIDATE" : "MULTIPLE_METADATA_CANDIDATES";
  return {
    nodeId: `candidate:${entry.pdbId}`,
    role: "CANDIDATE_SOURCE_ENTRY",
    pdbId: entry.pdbId,
    sourceDispositionCode: disposition.dispositionCode,
    sourceReceptorClusterStatus: disposition.receptorClusterStatus,
    releaseDate: entry.releaseDate ?? null,
    receptor: {
      selectionStatus: receptor ? "UNIQUE_PREFERRED_AUTH_CHAIN_ENTITY" : "UNRESOLVED",
      entityId: receptor?.entityId ?? null,
      description: receptor?.description ?? null,
      sequenceLength: receptor?.sequenceLength ?? null,
      sequenceSha256: receptor?.sequenceSha256 ?? null,
      uniprotAccessions: uniProtAccessions(receptor),
      preferredAuthChain: entry.gpcrdb?.preferredChain ?? null,
    },
    vhhMetadataCandidateStatus: status,
    vhhMetadataCandidates: vhhCandidates,
    publication: {
      doi: entry.primaryCitation?.doi ?? null,
      pmid: entry.primaryCitation?.pmid ?? null,
      title: entry.primaryCitation?.title ?? null,
    },
    directReceptorVhhEvidence: "UNRESOLVED",
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
    targetEligibilityAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function developmentNode(row) {
  return {
    nodeId: `development:${row.pdbId}`,
    role: "DEVELOPMENT_EXPOSURE",
    pdbId: row.pdbId,
    sourceDispositionCode: null,
    sourceReceptorClusterStatus: null,
    releaseDate: row.releaseDate ?? null,
    receptor: {
      selectionStatus: row.receptor?.selectionStatus ?? "UNRESOLVED",
      entityId: row.receptor?.entityId ?? null,
      description: row.receptor?.description ?? null,
      sequenceLength: row.receptor?.sequenceLength ?? null,
      sequenceSha256: row.receptor?.sequenceSha256 ?? null,
      uniprotAccessions: uniqueStrings(row.receptor?.uniprotAccessions ?? []),
      preferredAuthChain: row.receptor?.preferredAuthChain ?? null,
    },
    vhhMetadataCandidateStatus: row.vhhMetadataCandidateStatus,
    vhhMetadataCandidates: (row.vhhMetadataCandidates ?? []).map((candidate) => ({
      entityId: candidate.entityId,
      description: candidate.description ?? null,
      sequenceLength: candidate.sequenceLength ?? null,
      sequenceSha256: candidate.sequenceSha256 ?? null,
      authAsymIds: uniqueStrings(candidate.authAsymIds ?? []),
      labelAsymIds: uniqueStrings(candidate.labelAsymIds ?? []),
    })).sort((left, right) => byteCompare(left.entityId, right.entityId)),
    publication: {
      doi: row.publication?.doi ?? null,
      pmid: row.publication?.pmid ?? null,
      title: row.publication?.title ?? null,
    },
    directReceptorVhhEvidence: row.directReceptorVhhEvidence,
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
    targetEligibilityAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function validateNode(node) {
  ok(NODE_ID.test(node.nodeId) && PDB_ID.test(node.pdbId), `Invalid pregraph node identity: ${node.nodeId}`);
  ok(node.nodeId.endsWith(node.pdbId), `Pregraph node ID/PDB mismatch: ${node.nodeId}`);
  ok(["CANDIDATE_SOURCE_ENTRY", "DEVELOPMENT_EXPOSURE"].includes(node.role), `${node.nodeId} has an invalid role.`);
  ok(node.receptor.sequenceSha256 === null || SHA256.test(node.receptor.sequenceSha256), `${node.nodeId} receptor sequence digest is invalid.`);
  ok(canonical(node.receptor.uniprotAccessions) === canonical(uniqueStrings(node.receptor.uniprotAccessions)), `${node.nodeId} UniProt accessions are not normalized.`);
  ok(node.vhhMetadataCandidates.every((candidate) => candidate.sequenceSha256 === null || SHA256.test(candidate.sequenceSha256)), `${node.nodeId} VHH digest is invalid.`);
  ok(node.directReceptorVhhEvidence === "UNRESOLVED", `${node.nodeId} improperly resolves direct-interface evidence.`);
  for (const field of ["formalLeakageEdgeAuthority", "formalNoEdgeAuthority", "targetEligibilityAuthority", "nativeCoordinatesInspected"]) {
    ok(node[field] === false, `${node.nodeId} authority/access field must remain false: ${field}`);
  }
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((value) => rightSet.has(value)));
}

function vhhHashes(node) {
  return uniqueStrings(node.vhhMetadataCandidates.map((candidate) => candidate.sequenceSha256).filter((value) => SHA256.test(value)));
}

function compareNodes(left, right, contract, pairType) {
  ok(byteCompare(left.nodeId, right.nodeId) < 0, `Pair nodes are not canonical: ${left.nodeId}, ${right.nodeId}`);
  const evidenceTypes = [];
  const details = {
    exactPdbId: null,
    exactReceptorEntitySequenceSha256: null,
    singletonReceptorUniProt: null,
    sharedReceptorUniProtAccessions: [],
    exactVhhMetadataSequenceSha256s: [],
    primaryDoi: null,
    primaryPmid: null,
  };

  if (left.pdbId === right.pdbId) {
    evidenceTypes.push("EXACT_PDB_ID_REUSE");
    details.exactPdbId = left.pdbId;
  }
  if (left.receptor.sequenceSha256 && left.receptor.sequenceSha256 === right.receptor.sequenceSha256) {
    evidenceTypes.push("EXACT_RECEPTOR_ENTITY_SEQUENCE");
    details.exactReceptorEntitySequenceSha256 = left.receptor.sequenceSha256;
  }
  const sharedUniProt = intersection(left.receptor.uniprotAccessions, right.receptor.uniprotAccessions);
  if (sharedUniProt.length > 0) {
    details.sharedReceptorUniProtAccessions = sharedUniProt;
    if (left.receptor.uniprotAccessions.length === 1 && right.receptor.uniprotAccessions.length === 1) {
      evidenceTypes.push("EXACT_SINGLETON_RECEPTOR_UNIPROT");
      details.singletonReceptorUniProt = sharedUniProt[0];
    } else {
      evidenceTypes.push("SHARED_RECEPTOR_UNIPROT_WITH_MULTIACCESSION_AMBIGUITY");
    }
  }

  const leftVhh = vhhHashes(left);
  const rightVhh = vhhHashes(right);
  const sharedVhh = intersection(leftVhh, rightVhh);
  if (sharedVhh.length > 0) {
    details.exactVhhMetadataSequenceSha256s = sharedVhh;
    if (leftVhh.length === 1 && rightVhh.length === 1
      && left.vhhMetadataCandidateStatus === "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE"
      && right.vhhMetadataCandidateStatus === "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE") {
      evidenceTypes.push("EXACT_UNIQUE_VHH_METADATA_SEQUENCE");
    } else {
      evidenceTypes.push("SHARED_VHH_METADATA_SEQUENCE_WITH_ROLE_AMBIGUITY");
    }
  }

  if (left.publication.doi && left.publication.doi === right.publication.doi) {
    evidenceTypes.push("EXACT_PRIMARY_DOI");
    details.primaryDoi = left.publication.doi;
  }
  if (left.publication.pmid && left.publication.pmid === right.publication.pmid) {
    evidenceTypes.push("EXACT_PRIMARY_PMID");
    details.primaryPmid = left.publication.pmid;
  }

  const normalizedTypes = uniqueStrings(evidenceTypes);
  if (normalizedTypes.length === 0) return null;
  const definiteSet = new Set(contract.evidenceTypes.definiteExact);
  const unresolvedVhhSet = new Set(contract.evidenceTypes.exactRoleUnresolved);
  const ambiguousSet = new Set(contract.evidenceTypes.ambiguous);
  ok(normalizedTypes.every((type) => definiteSet.has(type) || unresolvedVhhSet.has(type) || ambiguousSet.has(type)), "Uncontracted evidence type was generated.");
  const definite = normalizedTypes.some((type) => definiteSet.has(type));
  const exactVhhRoleUnresolved = normalizedTypes.some((type) => unresolvedVhhSet.has(type));
  const classification = definite ? "DEFINITE_METADATA_IDENTITY_EVIDENCE"
    : exactVhhRoleUnresolved ? "EXACT_VHH_SEQUENCE_EVIDENCE_ROLE_UNRESOLVED"
      : "AMBIGUOUS_ENTITY_EVIDENCE";
  const exactPdbReconcilesSeed = pairType === "CANDIDATE_DEVELOPMENT"
    && normalizedTypes.includes("EXACT_PDB_ID_REUSE")
    && [left, right].find((node) => node.role === "CANDIDATE_SOURCE_ENTRY")?.sourceDispositionCode === "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE";
  return {
    pairId: `${left.nodeId}|${right.nodeId}`,
    pairType,
    nodeA: left.nodeId,
    nodeB: right.nodeId,
    evidenceTypes: normalizedTypes,
    evidenceClassification: classification,
    evidenceDetails: details,
    definitePregraphEdge: definite,
    inclusivePregraphEdge: true,
    exactPdbReconcilesExistingDisposition: exactPdbReconcilesSeed,
    formalLeakageEdgeStatus: "UNRESOLVED",
    formalNoEdgeStatus: "NOT_ASSESSED",
    directInterfaceRolesResolved: false,
    automaticTargetPromotionPermitted: false,
    nativeCoordinatesInspected: false,
  };
}

function canonicalPair(left, right) {
  return byteCompare(left.nodeId, right.nodeId) < 0 ? [left, right] : [right, left];
}

function enumerateSame(nodes, contract, pairType) {
  const pairIds = [];
  const positive = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const [left, right] = canonicalPair(nodes[leftIndex], nodes[rightIndex]);
      pairIds.push(`${left.nodeId}|${right.nodeId}`);
      const evidence = compareNodes(left, right, contract, pairType);
      if (evidence) positive.push(evidence);
    }
  }
  positive.sort((left, right) => byteCompare(left.pairId, right.pairId));
  return { pairIds: byteSort(pairIds), positive };
}

function enumerateCross(candidateNodes, developmentNodes, contract) {
  const pairIds = [];
  const positive = [];
  for (const candidate of candidateNodes) {
    for (const development of developmentNodes) {
      const [left, right] = canonicalPair(candidate, development);
      pairIds.push(`${left.nodeId}|${right.nodeId}`);
      const evidence = compareNodes(left, right, contract, "CANDIDATE_DEVELOPMENT");
      if (evidence) positive.push(evidence);
    }
  }
  positive.sort((left, right) => byteCompare(left.pairId, right.pairId));
  return { pairIds: byteSort(pairIds), positive };
}

class UnionFind {
  constructor(nodeIds) {
    this.parent = new Map(nodeIds.map((nodeId) => [nodeId, nodeId]));
  }

  find(nodeId) {
    const parent = this.parent.get(nodeId);
    ok(parent, `Unknown union-find node: ${nodeId}`);
    if (parent !== nodeId) this.parent.set(nodeId, this.find(parent));
    return this.parent.get(nodeId);
  }

  union(left, right) {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);
    if (rootLeft === rootRight) return;
    if (byteCompare(rootLeft, rootRight) < 0) this.parent.set(rootRight, rootLeft);
    else this.parent.set(rootLeft, rootRight);
  }
}

function components(nodes, evidenceRows, mode) {
  const nodeIds = nodes.map((node) => node.nodeId);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const unionFind = new UnionFind(nodeIds);
  const includedEdges = evidenceRows.filter((row) => mode === "DEFINITE_EXACT_METADATA_EVIDENCE"
    ? row.definitePregraphEdge
    : row.inclusivePregraphEdge);
  for (const row of includedEdges) unionFind.union(row.nodeA, row.nodeB);
  const groups = new Map();
  for (const nodeId of nodeIds) {
    const root = unionFind.find(nodeId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(nodeId);
  }
  const rows = [];
  for (const memberIds of groups.values()) {
    const members = byteSort(memberIds);
    const payload = `${members.join("\n")}\n`;
    const memberSet = new Set(members);
    const internalEdges = includedEdges.filter((row) => memberSet.has(row.nodeA) && memberSet.has(row.nodeB));
    const candidateNodeCount = members.filter((nodeId) => byId.get(nodeId).role === "CANDIDATE_SOURCE_ENTRY").length;
    const developmentNodeCount = members.length - candidateNodeCount;
    rows.push({
      componentId: sha256(Buffer.from(payload)),
      pregraphMode: mode,
      nodeIds: members,
      nodeCount: members.length,
      candidateNodeCount,
      developmentNodeCount,
      evidencePairCount: internalEdges.length,
      connectedToDevelopment: developmentNodeCount > 0,
      formalLeakageComponent: false,
      formalTargetEligibilityAuthority: false,
    });
  }
  return rows.sort((left, right) => byteCompare(left.componentId, right.componentId));
}

function pairCommitment(pairIds) {
  const sorted = byteSort(pairIds);
  const text = sorted.length ? `${sorted.join("\n")}\n` : "";
  return { count: sorted.length, sha256: sha256(Buffer.from(text)) };
}

function countEvidenceTypes(rows, contract) {
  const types = [...contract.evidenceTypes.definiteExact, ...contract.evidenceTypes.exactRoleUnresolved, ...contract.evidenceTypes.ambiguous];
  const counts = Object.fromEntries(types.map((type) => [type, 0]));
  for (const row of rows) for (const type of row.evidenceTypes) counts[type] += 1;
  return counts;
}

function countClassifications(rows) {
  const counts = {
    AMBIGUOUS_ENTITY_EVIDENCE: 0,
    DEFINITE_METADATA_IDENTITY_EVIDENCE: 0,
    EXACT_VHH_SEQUENCE_EVIDENCE_ROLE_UNRESOLVED: 0,
  };
  for (const row of rows) counts[row.evidenceClassification] += 1;
  return counts;
}

function candidateConnectivity(candidateNodes, componentRows) {
  const connected = new Set(componentRows
    .filter((component) => component.connectedToDevelopment)
    .flatMap((component) => component.nodeIds.filter((nodeId) => nodeId.startsWith("candidate:"))));
  return candidateNodes.filter((node) => connected.has(node.nodeId)).length;
}

async function readInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const contractFile = await readDirect(root, CONTRACT_REL, "exact evidence contract", 2 * 1024 * 1024);
  const contract = JSON.parse(contractFile.text);
  walk(contract);
  ok(contract.schemaVersion === "1.0.0" && contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.status === "EXACT_METADATA_EVIDENCE_PREGRAPH_RULE_FROZEN", "Exact evidence contract identity drifted.");
  ok(contract.selectedProtocol.metadataPreparationStageOnly && contract.integrity.formalLeakageGraphComplete === false && contract.integrity.formallyClearedGroupCount === 0, "Exact evidence pregraph authority boundary drifted.");
  ok(contract.pairRules.formalNoEdgeClaimPermitted === false && contract.pairRules.formalLeakageEdgeClaimPermitted === false, "Exact evidence pair authority drifted.");
  ok(contract.forbiddenDerivations.includes("absence-of-exact-evidence-interpreted-as-NO_EDGE") && contract.forbiddenDerivations.includes("automatic-target-promotion"), "Exact evidence forbidden derivations drifted.");

  await verifyDispositionSeed({ repositoryRoot: root, snapshotDirectory: path.join(root, contract.candidateInputs.dispositionSnapshotDirectory) });
  await verifyDevelopmentMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: path.join(root, contract.developmentInputs.snapshotDirectory) });

  const protocolFile = await readDirect(root, contract.selectedProtocol.path, "selected v3 protocol", 4 * 1024 * 1024);
  const entryFile = await readDirect(root, contract.candidateInputs.entryMetadataPath, "candidate entry metadata");
  const dispositionFile = await readDirect(root, `${contract.candidateInputs.dispositionSnapshotDirectory}/${contract.candidateInputs.dispositionLedgerFile}`, "candidate disposition seed");
  const developmentChecksumsFile = await readDirect(root, `${contract.developmentInputs.snapshotDirectory}/checksums.sha256`, "development metadata checksums", 128 * 1024);
  const developmentFile = await readDirect(root, `${contract.developmentInputs.snapshotDirectory}/${contract.developmentInputs.nodeLedgerFile}`, "development metadata nodes");
  for (const [observed, expected, label] of [
    [protocolFile.sha256, contract.selectedProtocol.sha256, "selected protocol"],
    [entryFile.sha256, contract.candidateInputs.entryMetadataSha256, "candidate entry metadata"],
    [dispositionFile.sha256, contract.candidateInputs.dispositionLedgerSha256, "candidate disposition ledger"],
    [developmentChecksumsFile.sha256, contract.developmentInputs.snapshotChecksumsSha256, "development snapshot checksums"],
    [developmentFile.sha256, contract.developmentInputs.nodeLedgerSha256, "development node ledger"],
  ]) ok(observed === expected, `${label} digest drifted.`);

  const entries = parseJsonl(entryFile.text, "candidate entry metadata");
  const dispositions = parseJsonl(dispositionFile.text, "candidate disposition seed");
  const developmentRows = parseJsonl(developmentFile.text, "development metadata nodes");
  ok(entries.length === contract.candidateInputs.expectedNodeCount && dispositions.length === entries.length, "Candidate input count drifted.");
  ok(developmentRows.length === contract.developmentInputs.expectedNodeCount, "Development input count drifted.");
  const entryMap = mapUnique(entries, "pdbId", "candidate entry metadata", PDB_ID);
  const dispositionMap = mapUnique(dispositions, "pdbId", "candidate disposition seed", PDB_ID);
  const developmentMap = mapUnique(developmentRows, "pdbId", "development metadata nodes", PDB_ID);
  ok([...entryMap.keys()].every((pdbId) => dispositionMap.has(pdbId)), "Candidate disposition seed does not cover every entry metadata row.");

  const candidateNodes = byteSort([...entryMap.keys()]).map((pdbId) => candidateNode(entryMap.get(pdbId), dispositionMap.get(pdbId)));
  const developmentNodes = byteSort([...developmentMap.keys()]).map((pdbId) => developmentNode(developmentMap.get(pdbId)));
  [...candidateNodes, ...developmentNodes].forEach(validateNode);
  ok(new Set([...candidateNodes, ...developmentNodes].map((node) => node.nodeId)).size === candidateNodes.length + developmentNodes.length, "Pregraph node IDs are duplicated.");
  const exactPdbOverlap = candidateNodes.filter((node) => developmentMap.has(node.pdbId));
  ok(exactPdbOverlap.length === contract.candidateInputs.expectedExactDevelopmentPdbExclusionCount, "Exact development PDB overlap count drifted.");
  ok(exactPdbOverlap.every((node) => node.sourceDispositionCode === "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE" && node.sourceReceptorClusterStatus === "FAIL"), "Exact development PDB overlaps do not reconcile to the disposition seed.");

  return {
    root,
    contract,
    candidateNodes,
    developmentNodes,
    inputDigests: {
      contract: contractFile.sha256,
      selectedProtocol: protocolFile.sha256,
      candidateEntryMetadata: entryFile.sha256,
      candidateDispositionLedger: dispositionFile.sha256,
      developmentSnapshotChecksums: developmentChecksumsFile.sha256,
      developmentNodeLedger: developmentFile.sha256,
      generatorScript: sha256(await readFile(HERE)),
    },
  };
}

function buildEvidence(inputs) {
  const candidateCandidate = enumerateSame(inputs.candidateNodes, inputs.contract, "CANDIDATE_CANDIDATE");
  const candidateDevelopment = enumerateCross(inputs.candidateNodes, inputs.developmentNodes, inputs.contract);
  const developmentDevelopment = enumerateSame(inputs.developmentNodes, inputs.contract, "DEVELOPMENT_DEVELOPMENT");
  ok(candidateCandidate.pairIds.length === inputs.contract.pairRules.candidateCandidatePairs, "Candidate-candidate pair count drifted.");
  ok(candidateDevelopment.pairIds.length === inputs.contract.pairRules.candidateDevelopmentPairs, "Candidate-development pair count drifted.");
  ok(developmentDevelopment.pairIds.length === inputs.contract.pairRules.developmentDevelopmentPairs, "Development-development pair count drifted.");
  const allPairIds = byteSort([...candidateCandidate.pairIds, ...candidateDevelopment.pairIds, ...developmentDevelopment.pairIds]);
  ok(allPairIds.length === inputs.contract.pairRules.allUnorderedPairs && new Set(allPairIds).size === allPairIds.length, "Complete unordered pair space drifted.");
  const allEvidence = [...candidateCandidate.positive, ...candidateDevelopment.positive, ...developmentDevelopment.positive]
    .sort((left, right) => byteCompare(left.pairId, right.pairId));
  ok(new Set(allEvidence.map((row) => row.pairId)).size === allEvidence.length, "Positive exact-evidence pairs are duplicated.");
  const allNodes = [...inputs.candidateNodes, ...inputs.developmentNodes].sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const definiteComponents = components(allNodes, allEvidence, "DEFINITE_EXACT_METADATA_EVIDENCE");
  const inclusiveComponents = components(allNodes, allEvidence, "INCLUSIVE_EXACT_AND_AMBIGUOUS_METADATA_EVIDENCE");
  const pairSpace = {
    schemaVersion: "1.0.0",
    serialization: "bytewise-sorted-canonical-nodeA-pipe-nodeB-with-terminal-LF",
    candidateCandidate: pairCommitment(candidateCandidate.pairIds),
    candidateDevelopment: pairCommitment(candidateDevelopment.pairIds),
    developmentDevelopment: pairCommitment(developmentDevelopment.pairIds),
    allUnorderedPairs: pairCommitment(allPairIds),
    positivePairRowsStoredOnly: true,
    absenceOfStoredPairIsNotNoEdgeEvidence: true,
    formalLeakageGraphAuthority: false,
  };
  const exactPdbRows = candidateDevelopment.positive.filter((row) => row.evidenceTypes.includes("EXACT_PDB_ID_REUSE"));
  ok(exactPdbRows.length === inputs.contract.candidateInputs.expectedExactDevelopmentPdbExclusionCount && exactPdbRows.every((row) => row.exactPdbReconcilesExistingDisposition), "Exact PDB evidence does not reconcile to all existing seed exclusions.");
  const summary = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    status: STATUS,
    candidateNodeCount: inputs.candidateNodes.length,
    developmentNodeCount: inputs.developmentNodes.length,
    totalNodeCount: allNodes.length,
    pairSpace: {
      candidateCandidate: candidateCandidate.pairIds.length,
      candidateDevelopment: candidateDevelopment.pairIds.length,
      developmentDevelopment: developmentDevelopment.pairIds.length,
      allUnorderedPairs: allPairIds.length,
    },
    positiveEvidencePairCounts: {
      candidateCandidate: candidateCandidate.positive.length,
      candidateDevelopment: candidateDevelopment.positive.length,
      developmentDevelopment: developmentDevelopment.positive.length,
      all: allEvidence.length,
    },
    evidenceTypePairCounts: countEvidenceTypes(allEvidence, inputs.contract),
    evidenceClassificationPairCounts: countClassifications(allEvidence),
    exactPdbExclusionReconciliationCount: exactPdbRows.length,
    definiteEvidenceComponentCount: definiteComponents.length,
    inclusiveEvidenceComponentCount: inclusiveComponents.length,
    candidateNodesConnectedToDevelopmentByDefiniteEvidence: candidateConnectivity(inputs.candidateNodes, definiteComponents),
    candidateNodesConnectedToDevelopmentByInclusiveEvidence: candidateConnectivity(inputs.candidateNodes, inclusiveComponents),
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  return {
    allNodes,
    candidateCandidate,
    candidateDevelopment,
    developmentDevelopment,
    definiteComponents,
    inclusiveComponents,
    pairSpace,
    summary,
  };
}

function outputPayloads(inputs, built) {
  const candidateNodesText = jsonl(inputs.candidateNodes);
  const developmentNodesText = jsonl(inputs.developmentNodes);
  const candidateCandidateText = jsonl(built.candidateCandidate.positive);
  const candidateDevelopmentText = jsonl(built.candidateDevelopment.positive);
  const developmentDevelopmentText = jsonl(built.developmentDevelopment.positive);
  const definiteComponentsText = jsonl(built.definiteComponents);
  const inclusiveComponentsText = jsonl(built.inclusiveComponents);
  const pairSpaceText = `${JSON.stringify(built.pairSpace, null, 2)}\n`;
  const summaryText = `${JSON.stringify(built.summary, null, 2)}\n`;
  const readmeText = [
    "# ConfoVHH hard-decoy v3 exact metadata evidence pregraph",
    "",
    `Status: **${STATUS}**`,
    "",
    `- Candidate source-entry nodes: ${built.summary.candidateNodeCount}`,
    `- Development exposure nodes: ${built.summary.developmentNodeCount}`,
    `- Complete unordered pair space committed: ${built.summary.pairSpace.allUnorderedPairs}`,
    `- Positive exact or ambiguous metadata-evidence pairs stored: ${built.summary.positiveEvidencePairCounts.all}`,
    `- Existing exact-development-PDB exclusions reconciled: ${built.summary.exactPdbExclusionReconciliationCount}`,
    `- Candidate nodes connected to development by definite exact metadata evidence: ${built.summary.candidateNodesConnectedToDevelopmentByDefiniteEvidence}`,
    `- Candidate nodes connected after including role-ambiguous exact metadata evidence: ${built.summary.candidateNodesConnectedToDevelopmentByInclusiveEvidence}`,
    "",
    "This artifact is an evidence pregraph, not the formal leakage graph. It records only exact public metadata matches and explicitly classified ambiguity. It does not infer a direct receptor–VHH interface from a VHH-like entity, does not compute approximate receptor or IMGT similarity, does not use metadata epitope annotations as formal edges, and does not treat absence of exact evidence as NO_EDGE.",
    "",
    "Canonical TM1–TM7 similarity, IMGT framework/CDR3 thresholds, source-backed parent/variant evidence, construct adjudication, direct-interface adjudication, and native epitope overlap remain unresolved. Formal native epitope decisions require the sealed one-way oracle selected in HARD_DECOY_PROTOCOL_V3.md.",
    "",
    "No native coordinates, native relative poses, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results were accessed. No target was promoted or frozen.",
    "",
  ].join("\n");
  const base = {
    "README.md": readmeText,
    "candidate-candidate-evidence.jsonl": candidateCandidateText,
    "candidate-development-evidence.jsonl": candidateDevelopmentText,
    "candidate-nodes.jsonl": candidateNodesText,
    "definite-evidence-components.jsonl": definiteComponentsText,
    "development-development-evidence.jsonl": developmentDevelopmentText,
    "development-nodes.jsonl": developmentNodesText,
    "inclusive-evidence-components.jsonl": inclusiveComponentsText,
    "pair-space-commitments.json": pairSpaceText,
    "summary.json": summaryText,
  };
  const normalizedOutputs = Object.fromEntries(Object.entries(base).map(([relative, text]) => [relative, { bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) }]));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    stage: "V3_METADATA_PREPARATION",
    status: STATUS,
    snapshotDateUtc: inputs.contract.snapshotDateUtc,
    contractPath: CONTRACT_REL,
    generatorScript: path.relative(inputs.root, HERE).split(path.sep).join("/"),
    inputDigests: inputs.inputDigests,
    normalizedOutputs,
    pairSpaceCommitments: built.pairSpace,
    summary: built.summary,
    evidencePregraphOnly: true,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  return { ...base, "manifest.json": `${JSON.stringify(manifest, null, 2)}\n` };
}

async function put(root, relative, value) {
  const filename = safePath(root, relative, `output ${relative}`);
  await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(relative, text);
  await writeFile(filename, bytes, { flag: "wx" });
}

async function listFiles(root, current = "", result = []) {
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    ok(!entry.isSymbolicLink(), `Exact evidence inventory contains a symlink: ${relative}`);
    if (entry.isDirectory()) await listFiles(root, relative, result);
    else result.push(relative);
    ok(result.length <= MAX_FILES, `Exact evidence inventory exceeded the ${MAX_FILES}-file cap.`);
  }
  return byteSort(result);
}

export async function collectExactEvidencePregraph({ repositoryRoot = ROOT, outputDirectory } = {}) {
  ok(outputDirectory, "An exact evidence output directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const output = path.resolve(outputDirectory);
  ok(await realpath(path.dirname(output)) === path.resolve(path.dirname(output)), "Exact evidence output parent contains symlinked ancestors.");
  await mkdir(output, { recursive: false });
  const built = buildEvidence(inputs);
  const payloads = outputPayloads(inputs, built);
  const expectedWithoutChecksums = byteSort(inputs.contract.output.requiredFiles.filter((file) => file !== "checksums.sha256"));
  ok(canonical(Object.keys(payloads).sort(byteCompare)) === canonical(expectedWithoutChecksums), "Exact evidence output payload inventory drifted.");
  for (const relative of expectedWithoutChecksums) await put(output, relative, payloads[relative]);
  ok(canonical(await listFiles(output)) === canonical(expectedWithoutChecksums), "Exact evidence output inventory drifted before checksumming.");
  const checksumRows = await Promise.all(expectedWithoutChecksums.map(async (relative) => `${sha256(await readFile(path.join(output, relative)))}  ${relative}`));
  await put(output, "checksums.sha256", `${checksumRows.join("\n")}\n`);
  return { ...await verifyExactEvidencePregraph({ repositoryRoot: inputs.root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifyExactEvidencePregraph({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "An exact evidence snapshot directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(snapshot === path.resolve(snapshotDirectory), "Exact evidence snapshot path contains symlinked ancestors.");
  const expected = byteSort(inputs.contract.output.requiredFiles);
  ok(canonical(await listFiles(snapshot)) === canonical(expected), "Exact evidence snapshot does not match its exact file allowlist.");
  const checksumFile = await readDirect(snapshot, "checksums.sha256", "exact evidence checksums", 128 * 1024);
  ok(checksumFile.text.endsWith("\n"), "Exact evidence checksums must end with LF.");
  const checksumRows = checksumFile.text.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `Exact evidence checksum row ${index + 1} is invalid.`);
    return { digest: match[1], relative: match[2] };
  });
  const payloadFiles = expected.filter((file) => file !== "checksums.sha256");
  ok(canonical(checksumRows.map((row) => row.relative)) === canonical(payloadFiles) && new Set(checksumRows.map((row) => row.relative)).size === payloadFiles.length, "Exact evidence checksum coverage drifted.");
  const observed = new Map();
  for (const row of checksumRows) {
    const file = await readDirect(snapshot, row.relative, `exact evidence ${row.relative}`);
    ok(file.sha256 === row.digest, `Exact evidence checksum mismatch: ${row.relative}`);
    observed.set(row.relative, file.text);
  }
  const expectedPayloads = outputPayloads(inputs, buildEvidence(inputs));
  for (const relative of payloadFiles) ok(observed.get(relative) === expectedPayloads[relative], `Exact evidence snapshot is not reproducible: ${relative}`);
  const summary = JSON.parse(observed.get("summary.json"));
  const manifest = JSON.parse(observed.get("manifest.json"));
  walk(summary);
  walk(manifest);
  for (const record of [summary, manifest]) {
    for (const field of ["formalLeakageGraphComplete", "dispositionLedgerComplete", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
      ok(record[field] === false, `Exact evidence authority/access field must remain false: ${field}`);
    }
    ok(record.formallyClearedGroupCount === 0, "Exact evidence pregraph cannot claim cleared groups.");
  }
  return {
    status: summary.status,
    candidateNodeCount: summary.candidateNodeCount,
    developmentNodeCount: summary.developmentNodeCount,
    totalNodeCount: summary.totalNodeCount,
    allUnorderedPairCount: summary.pairSpace.allUnorderedPairs,
    positiveEvidencePairCount: summary.positiveEvidencePairCounts.all,
    exactPdbExclusionReconciliationCount: summary.exactPdbExclusionReconciliationCount,
    definiteEvidenceComponentCount: summary.definiteEvidenceComponentCount,
    inclusiveEvidenceComponentCount: summary.inclusiveEvidenceComponentCount,
    candidateNodesConnectedToDevelopmentByDefiniteEvidence: summary.candidateNodesConnectedToDevelopmentByDefiniteEvidence,
    candidateNodesConnectedToDevelopmentByInclusiveEvidence: summary.candidateNodesConnectedToDevelopmentByInclusiveEvidence,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2];
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "validation/hard-decoy-holdout-v3/exact-evidence-pregraph-2026-08-29");
  try {
    if (command === "generate") {
      await rm(output, { recursive: true, force: true });
      console.log(JSON.stringify(await collectExactEvidencePregraph({ outputDirectory: output }), null, 2));
    } else if (command === "verify") {
      console.log(JSON.stringify(await verifyExactEvidencePregraph({ snapshotDirectory: output }), null, 2));
    } else {
      throw new Error("Usage: node scripts/hard-decoy/v3-exact-evidence-pregraph.mjs <generate|verify> [snapshot-directory]");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
