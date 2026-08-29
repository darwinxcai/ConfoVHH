import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDispositionSeed } from "./v3-disposition-seed.mjs";
import { verifyExactEvidencePregraph } from "./v3-exact-evidence-pregraph.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/definite-exclusion-contract-2026-08-29.json";
const STATUS = "MONOTONIC_DEFINITE_EXCLUSIONS_COMPLETED_BLOCKED_PENDING_REMAINING_SCIENTIFIC_DISPOSITIONS";
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const NODE_ID = /^(?:candidate|development):[0-9][A-Z0-9]{3}$/u;
const COORDINATE = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult|targetEligible|formalNoEdge)$/iu;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 16;

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

function parseJsonl(text, label) {
  clean(label, text);
  ok(text.length === 0 || text.endsWith("\n"), `${label} must be empty or end with LF.`);
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

function evidencePermalink(contract, relative) {
  return `https://github.com/darwinxcai/ConfoVHH/blob/${contract.evidencePermalinkCommit}/${contract.exactEvidencePregraph.directory}/${relative}`;
}

function relationClass(evidenceTypes, contract) {
  const receptor = new Set(contract.eligibleEvidenceTypes.receptor);
  const publication = new Set(contract.eligibleEvidenceTypes.publication);
  if (evidenceTypes.some((type) => receptor.has(type))) return "RECEPTOR";
  if (evidenceTypes.some((type) => publication.has(type))) return "PUBLICATION";
  return null;
}

function normalizedEligibleEvidenceTypes(evidenceTypes, contract) {
  const allowed = new Set([
    ...contract.eligibleEvidenceTypes.receptor,
    ...contract.eligibleEvidenceTypes.publication,
  ]);
  const order = new Map(contract.pathRule.edgeEvidenceTypeOrder.map((type, index) => [type, index]));
  return uniqueStrings(evidenceTypes.filter((type) => allowed.has(type)))
    .sort((left, right) => (order.get(left) - order.get(right)) || byteCompare(left, right));
}

function edgeFromEvidence(row, sourceFile, contract) {
  ok(row.definitePregraphEdge === true, `Non-definite evidence reached the definite graph: ${row.pairId}`);
  const eligibleEvidenceTypes = normalizedEligibleEvidenceTypes(row.evidenceTypes ?? [], contract);
  const relation = relationClass(eligibleEvidenceTypes, contract);
  ok(relation && eligibleEvidenceTypes.length > 0, `Definite evidence row has no contracted positive type: ${row.pairId}`);
  return {
    pairId: row.pairId,
    nodeA: row.nodeA,
    nodeB: row.nodeB,
    relationClass: relation,
    eligibleEvidenceTypes,
    sourceFile,
  };
}

function edgeSortKey(edge, fromNodeId) {
  const toNodeId = edge.nodeA === fromNodeId ? edge.nodeB : edge.nodeA;
  const classOrder = edge.relationClass === "RECEPTOR" ? "0" : "1";
  return `${classOrder}|${edge.eligibleEvidenceTypes.join(",")}|${edge.pairId}|${toNodeId}`;
}

function buildAdjacency(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  const seenPairs = new Set();
  for (const edge of edges) {
    ok(adjacency.has(edge.nodeA) && adjacency.has(edge.nodeB), `Evidence edge references an unknown node: ${edge.pairId}`);
    ok(!seenPairs.has(edge.pairId), `Duplicate definite evidence pair: ${edge.pairId}`);
    seenPairs.add(edge.pairId);
    adjacency.get(edge.nodeA).push(edge);
    adjacency.get(edge.nodeB).push(edge);
  }
  for (const [nodeId, rows] of adjacency) rows.sort((left, right) => byteCompare(edgeSortKey(left, nodeId), edgeSortKey(right, nodeId)));
  return adjacency;
}

function stepRecord(edge, fromNodeId) {
  const toNodeId = edge.nodeA === fromNodeId ? edge.nodeB : edge.nodeA;
  return {
    pairId: edge.pairId,
    fromNodeId,
    toNodeId,
    relationClass: edge.relationClass,
    eligibleEvidenceTypes: edge.eligibleEvidenceTypes,
    sourceFile: edge.sourceFile,
  };
}

function pathSignature(pathNodes, pathEdges) {
  const pieces = [pathNodes[0]];
  for (let index = 0; index < pathEdges.length; index += 1) {
    const edge = pathEdges[index];
    pieces.push(`[${edge.relationClass}:${edge.eligibleEvidenceTypes.join(",")}:${edge.pairId}]`, pathNodes[index + 1]);
  }
  return pieces.join(">");
}

function shortestDevelopmentPath(startNodeId, adjacency, developmentNodeIds) {
  const development = new Set(developmentNodeIds);
  const queue = [{ nodeId: startNodeId, pathNodes: [startNodeId], pathEdges: [], signature: startNodeId }];
  const best = new Map([[startNodeId, { distance: 0, signature: startNodeId }]]);
  while (queue.length > 0) {
    queue.sort((left, right) => (left.pathEdges.length - right.pathEdges.length) || byteCompare(left.signature, right.signature));
    const current = queue.shift();
    const remembered = best.get(current.nodeId);
    if (!remembered || remembered.distance !== current.pathEdges.length || remembered.signature !== current.signature) continue;
    if (current.nodeId !== startNodeId && development.has(current.nodeId)) return current;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const step = stepRecord(edge, current.nodeId);
      const nextNodeId = step.toNodeId;
      const nextPathNodes = [...current.pathNodes, nextNodeId];
      const nextPathEdges = [...current.pathEdges, step];
      const signature = pathSignature(nextPathNodes, nextPathEdges);
      const distance = nextPathEdges.length;
      const previous = best.get(nextNodeId);
      if (previous && (previous.distance < distance || (previous.distance === distance && byteCompare(previous.signature, signature) <= 0))) continue;
      best.set(nextNodeId, { distance, signature });
      queue.push({ nodeId: nextNodeId, pathNodes: nextPathNodes, pathEdges: nextPathEdges, signature });
    }
  }
  return null;
}

function connectedComponentIndex(components, nodeIds) {
  const index = new Map();
  const seen = new Set();
  for (const component of components) {
    ok(SHA256.test(component.componentId), "Definite component has an invalid identifier.");
    ok(component.pregraphMode === "DEFINITE_EXACT_METADATA_EVIDENCE", `Unexpected component mode: ${component.componentId}`);
    for (const nodeId of component.nodeIds ?? []) {
      ok(nodeIds.has(nodeId) && !seen.has(nodeId), `Definite components omit, duplicate, or invent node ${nodeId}.`);
      seen.add(nodeId);
      index.set(nodeId, component);
    }
  }
  ok(seen.size === nodeIds.size, "Definite components do not partition every pregraph node.");
  return index;
}

function pathRecord(candidate, component, pathResult, priorDisposition) {
  ok(pathResult && pathResult.pathEdges.length > 0, `${candidate.nodeId} lacks a definite path to development.`);
  const firstRelationClass = pathResult.pathEdges[0].relationClass;
  const derivedDispositionCode = firstRelationClass === "RECEPTOR"
    ? "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE"
    : "EXCLUDE_PUBLICATION_LEAKAGE";
  return {
    candidatePdbId: candidate.pdbId,
    candidateNodeId: candidate.nodeId,
    componentId: component.componentId,
    componentNodeCount: component.nodeCount,
    componentCandidateNodeCount: component.candidateNodeCount,
    componentDevelopmentNodeCount: component.developmentNodeCount,
    pathLength: pathResult.pathEdges.length,
    pathNodeIds: pathResult.pathNodes,
    pathEdges: pathResult.pathEdges,
    pathSignature: pathResult.signature,
    terminalDevelopmentNodeId: pathResult.pathNodes.at(-1),
    firstEdgeRelationClass,
    priorDispositionCode: priorDisposition.dispositionCode,
    derivedDispositionCode,
    newlyResolved: priorDisposition.dispositionCode === "PENDING_REQUIRED_METADATA",
    exactPositiveEvidenceOnly: true,
    formalLeakageGraphComplete: false,
    formalNoEdgeStatus: "NOT_ASSESSED",
    directInterfaceRolesResolved: false,
    automaticTargetPromotionPermitted: false,
    nativeCoordinatesInspected: false,
  };
}

function updateDisposition(prior, pathRow, contract) {
  if (!pathRow.newlyResolved) return JSON.parse(JSON.stringify(prior));
  const next = JSON.parse(JSON.stringify(prior));
  next.dispositionCode = pathRow.derivedDispositionCode;
  if (pathRow.firstEdgeRelationClass === "RECEPTOR") next.receptorClusterStatus = "FAIL";
  else next.publicationEdgeStatus = "FAIL";
  const pathDescription = pathRow.pathEdges.map((edge) => `${edge.fromNodeId} --${edge.eligibleEvidenceTypes.join("+")}--> ${edge.toNodeId}`).join("; ");
  next.dispositionReason = `Definite exact metadata evidence places ${pathRow.candidateNodeId} in component ${pathRow.componentId} with ${pathRow.terminalDevelopmentNodeId}. Deterministic shortest path: ${pathDescription}. Under the frozen union-graph rule this positive path is sufficient for conservative exclusion; direct-interface, construct, VHH parent, approximate receptor, IMGT, and native-epitope gates remain unresolved.`;
  const evidenceFiles = uniqueStrings([
    ...pathRow.pathEdges.map((edge) => edge.sourceFile),
    contract.exactEvidencePregraph.definiteComponentsFile,
  ]);
  next.evidenceUrls = uniqueStrings([
    ...(prior.evidenceUrls ?? []),
    ...evidenceFiles.map((relative) => evidencePermalink(contract, relative)),
  ]);
  return next;
}

function componentRows(components, nodeMap, pathRowsByCandidate) {
  return components.filter((component) => component.connectedToDevelopment).map((component) => {
    const candidateNodeIds = byteSort(component.nodeIds.filter((nodeId) => nodeMap.get(nodeId)?.role === "CANDIDATE_SOURCE_ENTRY"));
    const developmentNodeIds = byteSort(component.nodeIds.filter((nodeId) => nodeMap.get(nodeId)?.role === "DEVELOPMENT_EXPOSURE"));
    const pathRows = candidateNodeIds.map((nodeId) => pathRowsByCandidate.get(nodeId));
    ok(pathRows.every(Boolean), `Development-connected component lacks one or more exclusion paths: ${component.componentId}`);
    return {
      componentId: component.componentId,
      nodeIds: component.nodeIds,
      nodeCount: component.nodeCount,
      candidateNodeIds,
      candidateNodeCount: candidateNodeIds.length,
      developmentNodeIds,
      developmentNodeCount: developmentNodeIds.length,
      evidencePairCount: component.evidencePairCount,
      previouslyResolvedCandidateCount: pathRows.filter((row) => !row.newlyResolved).length,
      newlyResolvedCandidateCount: pathRows.filter((row) => row.newlyResolved).length,
      formalLeakageComponent: false,
      formalTargetEligibilityAuthority: false,
    };
  }).sort((left, right) => byteCompare(left.componentId, right.componentId));
}

function codeCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.dispositionCode] = (counts[row.dispositionCode] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => byteCompare(left, right)));
}

function relationCounts(pathRows) {
  return {
    PUBLICATION: pathRows.filter((row) => row.firstEdgeRelationClass === "PUBLICATION").length,
    RECEPTOR: pathRows.filter((row) => row.firstEdgeRelationClass === "RECEPTOR").length,
  };
}

async function readInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const contractFile = await readDirect(root, CONTRACT_REL, "definite exclusion contract", 2 * 1024 * 1024);
  const contract = JSON.parse(contractFile.text);
  walk(contract);
  ok(contract.schemaVersion === "1.0.0" && contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.status === "MONOTONIC_DEFINITE_EXCLUSION_RULE_FROZEN", "Definite exclusion contract identity drifted.");
  ok(contract.graphRule.absenceOfEligibleEdgeIsNoEdge === false && contract.graphRule.absenceOfDevelopmentConnectivityIsEligibility === false && contract.graphRule.formalLeakageGraphComplete === false, "Definite exclusion graph authority drifted.");
  ok(contract.integrity.priorResolvedRowsCannotRevert && contract.integrity.onlyDefiniteDevelopmentConnectedCandidatesMayNewlyResolve && contract.integrity.inclusiveOnlyCandidatesMustRemainPending, "Definite exclusion monotonicity rules drifted.");
  ok(contract.integrity.targetFreezePermitted === false && contract.integrity.executionAuthorized === false, "Definite exclusion contract cannot authorize target freeze or execution.");

  await verifyDispositionSeed({ repositoryRoot: root, snapshotDirectory: path.join(root, contract.priorDispositionSeed.directory) });
  await verifyExactEvidencePregraph({ repositoryRoot: root, snapshotDirectory: path.join(root, contract.exactEvidencePregraph.directory) });

  const protocolFile = await readDirect(root, contract.selectedProtocol.path, "selected v3 protocol", 4 * 1024 * 1024);
  const seedChecksums = await readDirect(root, `${contract.priorDispositionSeed.directory}/${contract.priorDispositionSeed.checksumsFile}`, "prior disposition checksums", 128 * 1024);
  const seedLedger = await readDirect(root, `${contract.priorDispositionSeed.directory}/${contract.priorDispositionSeed.ledgerFile}`, "prior disposition ledger");
  const pregraphChecksums = await readDirect(root, `${contract.exactEvidencePregraph.directory}/${contract.exactEvidencePregraph.checksumsFile}`, "exact evidence checksums", 128 * 1024);
  const pregraphAttestation = await readDirect(root, contract.exactEvidencePregraph.attestationPath, "exact evidence attestation", 2 * 1024 * 1024);
  const requiredPregraphFiles = [
    [contract.exactEvidencePregraph.candidateNodesFile, contract.exactEvidencePregraph.candidateNodesSha256, "candidate nodes"],
    [contract.exactEvidencePregraph.developmentNodesFile, contract.exactEvidencePregraph.developmentNodesSha256, "development nodes"],
    [contract.exactEvidencePregraph.candidateCandidateEvidenceFile, contract.exactEvidencePregraph.candidateCandidateEvidenceSha256, "candidate-candidate evidence"],
    [contract.exactEvidencePregraph.candidateDevelopmentEvidenceFile, contract.exactEvidencePregraph.candidateDevelopmentEvidenceSha256, "candidate-development evidence"],
    [contract.exactEvidencePregraph.developmentDevelopmentEvidenceFile, contract.exactEvidencePregraph.developmentDevelopmentEvidenceSha256, "development-development evidence"],
    [contract.exactEvidencePregraph.definiteComponentsFile, contract.exactEvidencePregraph.definiteComponentsSha256, "definite components"],
  ];
  const pregraphFiles = new Map();
  for (const [relative, expected, label] of requiredPregraphFiles) {
    const file = await readDirect(root, `${contract.exactEvidencePregraph.directory}/${relative}`, label);
    ok(file.sha256 === expected, `${label} digest drifted.`);
    pregraphFiles.set(relative, file);
  }
  for (const [observed, expected, label] of [
    [protocolFile.sha256, contract.selectedProtocol.sha256, "selected protocol"],
    [seedChecksums.sha256, contract.priorDispositionSeed.checksumsSha256, "prior disposition checksum root"],
    [seedLedger.sha256, contract.priorDispositionSeed.ledgerSha256, "prior disposition ledger"],
    [pregraphChecksums.sha256, contract.exactEvidencePregraph.checksumsSha256, "exact evidence checksum root"],
    [pregraphAttestation.sha256, contract.exactEvidencePregraph.attestationSha256, "exact evidence attestation"],
  ]) ok(observed === expected, `${label} digest drifted.`);

  const priorRows = parseJsonl(seedLedger.text, "prior disposition ledger");
  const candidateNodes = parseJsonl(pregraphFiles.get(contract.exactEvidencePregraph.candidateNodesFile).text, "candidate nodes");
  const developmentNodes = parseJsonl(pregraphFiles.get(contract.exactEvidencePregraph.developmentNodesFile).text, "development nodes");
  const evidenceInputs = [
    [contract.exactEvidencePregraph.candidateCandidateEvidenceFile, "CANDIDATE_CANDIDATE"],
    [contract.exactEvidencePregraph.candidateDevelopmentEvidenceFile, "CANDIDATE_DEVELOPMENT"],
    [contract.exactEvidencePregraph.developmentDevelopmentEvidenceFile, "DEVELOPMENT_DEVELOPMENT"],
  ];
  const edges = [];
  for (const [relative, pairType] of evidenceInputs) {
    const rows = parseJsonl(pregraphFiles.get(relative).text, `${pairType} evidence`);
    for (const row of rows) {
      ok(row.pairType === pairType, `${row.pairId} appears in the wrong evidence file.`);
      if (row.definitePregraphEdge === true) edges.push(edgeFromEvidence(row, relative, contract));
    }
  }
  edges.sort((left, right) => byteCompare(left.pairId, right.pairId));
  const components = parseJsonl(pregraphFiles.get(contract.exactEvidencePregraph.definiteComponentsFile).text, "definite components");
  const priorMap = mapUnique(priorRows, "pdbId", "prior disposition ledger", PDB_ID);
  const candidateMap = mapUnique(candidateNodes, "pdbId", "candidate nodes", PDB_ID);
  const developmentMap = mapUnique(developmentNodes, "pdbId", "development nodes", PDB_ID);
  ok(priorRows.length === contract.priorDispositionSeed.expectedRows && candidateNodes.length === contract.exactEvidencePregraph.expectedCandidateNodes, "Candidate disposition or node count drifted.");
  ok(developmentNodes.length === contract.exactEvidencePregraph.expectedDevelopmentNodes && candidateNodes.length + developmentNodes.length === contract.exactEvidencePregraph.expectedAllNodes, "Development or total node count drifted.");
  ok([...candidateMap.keys()].every((pdbId) => priorMap.has(pdbId)), "Candidate nodes and prior dispositions disagree.");
  const resolvedPrior = priorRows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA");
  ok(resolvedPrior.length === contract.priorDispositionSeed.expectedResolvedRows && priorRows.length - resolvedPrior.length === contract.priorDispositionSeed.expectedPendingRows, "Prior disposition accounting drifted.");
  const nodeMap = new Map([...candidateNodes, ...developmentNodes].map((node) => [node.nodeId, node]));
  ok(nodeMap.size === contract.exactEvidencePregraph.expectedAllNodes && [...nodeMap.keys()].every((nodeId) => NODE_ID.test(nodeId)), "Pregraph node identity set drifted.");
  const componentIndex = connectedComponentIndex(components, new Set(nodeMap.keys()));
  const developmentNodeIds = developmentNodes.map((node) => node.nodeId);
  const adjacency = buildAdjacency([...nodeMap.keys()], edges);
  const connectedCandidates = candidateNodes.filter((node) => componentIndex.get(node.nodeId)?.connectedToDevelopment === true)
    .sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  ok(connectedCandidates.length === contract.exactEvidencePregraph.expectedDefiniteDevelopmentConnectedCandidateNodes, "Definite development-connected candidate count drifted.");

  const pathRows = connectedCandidates.map((candidate) => pathRecord(
    candidate,
    componentIndex.get(candidate.nodeId),
    shortestDevelopmentPath(candidate.nodeId, adjacency, developmentNodeIds),
    priorMap.get(candidate.pdbId),
  ));
  const pathMap = new Map(pathRows.map((row) => [row.candidateNodeId, row]));
  ok(pathMap.size === pathRows.length, "Definite exclusion paths are duplicated.");
  const outputRows = priorRows.map((prior) => {
    const candidate = candidateMap.get(prior.pdbId);
    const pathRow = pathMap.get(candidate.nodeId);
    return pathRow ? updateDisposition(prior, pathRow, contract) : JSON.parse(JSON.stringify(prior));
  });
  const componentOutput = componentRows(components, nodeMap, pathMap);

  const expected = contract.expectedOutputCounts;
  const newlyResolved = pathRows.filter((row) => row.newlyResolved);
  const resolvedOutput = outputRows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA");
  const pendingOutput = outputRows.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA");
  ok(outputRows.length === expected.sourceRows && pathRows.length === expected.developmentConnectedCandidates, "Definite exclusion output source or path count drifted.");
  ok(pathRows.filter((row) => !row.newlyResolved).length === expected.previouslyResolvedCandidates && newlyResolved.length === expected.newlyResolvedCandidates, "Definite exclusion prior/new accounting drifted.");
  ok(resolvedOutput.length === expected.resolvedCandidatesAfterUpdate && pendingOutput.length === expected.pendingCandidatesAfterUpdate, "Definite exclusion resolved/pending accounting drifted.");
  ok(outputRows.every((row) => row.dispositionCode !== "PROVISIONAL_DIRECT_TARGET") && expected.provisionalDirectTargets === 0, "Definite exclusion layer promoted a target.");
  const connectedPdbIds = new Set(connectedCandidates.map((node) => node.pdbId));
  for (const prior of priorRows) {
    const next = outputRows.find((row) => row.pdbId === prior.pdbId);
    if (prior.dispositionCode !== "PENDING_REQUIRED_METADATA") ok(canonical(next) === canonical(prior), `Prior resolved disposition changed: ${prior.pdbId}`);
    else if (!connectedPdbIds.has(prior.pdbId)) ok(canonical(next) === canonical(prior), `Non-connected pending disposition changed: ${prior.pdbId}`);
  }
  ok(newlyResolved.every((row) => connectedPdbIds.has(row.candidatePdbId)), "A candidate without definite development connectivity was resolved.");

  return {
    root,
    contract,
    priorRows,
    outputRows,
    pathRows,
    componentRows: componentOutput,
    inputDigests: {
      contract: contractFile.sha256,
      selectedProtocol: protocolFile.sha256,
      priorDispositionChecksums: seedChecksums.sha256,
      priorDispositionLedger: seedLedger.sha256,
      exactEvidenceChecksums: pregraphChecksums.sha256,
      exactEvidenceAttestation: pregraphAttestation.sha256,
      candidateNodes: contract.exactEvidencePregraph.candidateNodesSha256,
      developmentNodes: contract.exactEvidencePregraph.developmentNodesSha256,
      candidateCandidateEvidence: contract.exactEvidencePregraph.candidateCandidateEvidenceSha256,
      candidateDevelopmentEvidence: contract.exactEvidencePregraph.candidateDevelopmentEvidenceSha256,
      developmentDevelopmentEvidence: contract.exactEvidencePregraph.developmentDevelopmentEvidenceSha256,
      definiteComponents: contract.exactEvidencePregraph.definiteComponentsSha256,
      generatorScript: sha256(await readFile(HERE)),
    },
  };
}

function buildSummary(inputs) {
  const resolved = inputs.outputRows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA");
  const pending = inputs.outputRows.filter((row) => row.dispositionCode === "PENDING_REQUIRED_METADATA");
  const newlyResolved = inputs.pathRows.filter((row) => row.newlyResolved);
  return {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    status: STATUS,
    sourceDispositionRows: inputs.outputRows.length,
    priorResolvedRows: inputs.priorRows.filter((row) => row.dispositionCode !== "PENDING_REQUIRED_METADATA").length,
    definiteDevelopmentConnectedCandidateRows: inputs.pathRows.length,
    newlyResolvedRows: newlyResolved.length,
    resolvedRowsAfterUpdate: resolved.length,
    pendingRowsAfterUpdate: pending.length,
    dispositionCodeCounts: codeCounts(inputs.outputRows),
    connectedCandidateFirstEdgeRelationCounts: relationCounts(inputs.pathRows),
    newlyResolvedFirstEdgeRelationCounts: relationCounts(newlyResolved),
    developmentConnectedComponentCount: inputs.componentRows.length,
    provisionalDirectTargetCount: 0,
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
}

function outputPayloads(inputs) {
  const summary = buildSummary(inputs);
  const base = {
    "README.md": [
      "# ConfoVHH hard-decoy v3 monotonic definite exclusions",
      "",
      `Status: **${STATUS}**`,
      "",
      `- Source disposition rows: ${summary.sourceDispositionRows}`,
      `- Prior resolved rows preserved byte-for-byte: ${summary.priorResolvedRows}`,
      `- Candidate rows with a definite exact-evidence path to development: ${summary.definiteDevelopmentConnectedCandidateRows}`,
      `- Newly resolved conservative exclusions: ${summary.newlyResolvedRows}`,
      `- Resolved rows after this layer: ${summary.resolvedRowsAfterUpdate}`,
      `- Rows still pending scientific disposition: ${summary.pendingRowsAfterUpdate}`,
      `- Development-connected definite-evidence components: ${summary.developmentConnectedComponentCount}`,
      "",
      "Only exact PDB reuse, exact receptor-entity sequence, exact singleton receptor UniProt accession, and exact primary DOI/PMID evidence are admitted. Each exclusion has a deterministic shortest path to a development node. Existing resolved rows are unchanged; all inclusive-only VHH-role or multiaccession matches remain pending.",
      "",
      "This is a monotonic positive-exclusion layer, not a complete leakage graph. Absence of exact evidence is not NO_EDGE and does not establish target eligibility. Direct-interface, construct, canonical TM1–TM7, IMGT/known-parent, exhaustive discovery, and sealed native-epitope gates remain unresolved.",
      "",
      "No native coordinates, native relative poses, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results were accessed. No target was promoted or frozen.",
      "",
    ].join("\n"),
    "development-connected-components.jsonl": jsonl(inputs.componentRows),
    "entry-dispositions.jsonl": jsonl(inputs.outputRows),
    "exclusion-paths.jsonl": jsonl(inputs.pathRows),
    "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
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
    summary,
    monotonicPositiveExclusionLayerOnly: true,
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
    ok(!entry.isSymbolicLink(), `Definite exclusion inventory contains a symlink: ${relative}`);
    if (entry.isDirectory()) await listFiles(root, relative, result);
    else result.push(relative);
    ok(result.length <= MAX_FILES, `Definite exclusion inventory exceeded the ${MAX_FILES}-file cap.`);
  }
  return byteSort(result);
}

export async function collectDefiniteExclusions({ repositoryRoot = ROOT, outputDirectory } = {}) {
  ok(outputDirectory, "A definite exclusion output directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const output = path.resolve(outputDirectory);
  ok(await realpath(path.dirname(output)) === path.resolve(path.dirname(output)), "Definite exclusion output parent contains symlinked ancestors.");
  await mkdir(output, { recursive: false });
  const payloads = outputPayloads(inputs);
  const expectedWithoutChecksums = byteSort(inputs.contract.output.requiredFiles.filter((file) => file !== "checksums.sha256"));
  ok(canonical(Object.keys(payloads).sort(byteCompare)) === canonical(expectedWithoutChecksums), "Definite exclusion output payload inventory drifted.");
  for (const relative of expectedWithoutChecksums) await put(output, relative, payloads[relative]);
  ok(canonical(await listFiles(output)) === canonical(expectedWithoutChecksums), "Definite exclusion output inventory drifted before checksumming.");
  const checksumRows = await Promise.all(expectedWithoutChecksums.map(async (relative) => `${sha256(await readFile(path.join(output, relative)))}  ${relative}`));
  await put(output, "checksums.sha256", `${checksumRows.join("\n")}\n`);
  return { ...await verifyDefiniteExclusions({ repositoryRoot: inputs.root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifyDefiniteExclusions({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "A definite exclusion snapshot directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(snapshot === path.resolve(snapshotDirectory), "Definite exclusion snapshot path contains symlinked ancestors.");
  const expected = byteSort(inputs.contract.output.requiredFiles);
  ok(canonical(await listFiles(snapshot)) === canonical(expected), "Definite exclusion snapshot does not match its exact file allowlist.");
  const checksums = await readDirect(snapshot, "checksums.sha256", "definite exclusion checksums", 128 * 1024);
  ok(checksums.text.endsWith("\n"), "Definite exclusion checksums must end with LF.");
  const checksumRows = checksums.text.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `Definite exclusion checksum row ${index + 1} is invalid.`);
    return { digest: match[1], relative: match[2] };
  });
  const payloadFiles = expected.filter((file) => file !== "checksums.sha256");
  ok(canonical(checksumRows.map((row) => row.relative)) === canonical(payloadFiles) && new Set(checksumRows.map((row) => row.relative)).size === payloadFiles.length, "Definite exclusion checksum coverage drifted.");
  const observed = new Map();
  for (const row of checksumRows) {
    const file = await readDirect(snapshot, row.relative, `definite exclusion ${row.relative}`);
    ok(file.sha256 === row.digest, `Definite exclusion checksum mismatch: ${row.relative}`);
    observed.set(row.relative, file.text);
  }
  const expectedPayloads = outputPayloads(inputs);
  for (const relative of payloadFiles) ok(observed.get(relative) === expectedPayloads[relative], `Definite exclusion snapshot is not reproducible: ${relative}`);
  const summary = JSON.parse(observed.get("summary.json"));
  const manifest = JSON.parse(observed.get("manifest.json"));
  walk(summary);
  walk(manifest);
  for (const record of [summary, manifest]) {
    for (const field of ["formalLeakageGraphComplete", "dispositionLedgerComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
      ok(record[field] === false, `Definite exclusion authority/access field must remain false: ${field}`);
    }
    ok(record.formallyClearedGroupCount === 0, "Definite exclusion layer cannot claim cleared groups.");
  }
  return {
    status: summary.status,
    sourceDispositionRows: summary.sourceDispositionRows,
    priorResolvedRows: summary.priorResolvedRows,
    definiteDevelopmentConnectedCandidateRows: summary.definiteDevelopmentConnectedCandidateRows,
    newlyResolvedRows: summary.newlyResolvedRows,
    resolvedRowsAfterUpdate: summary.resolvedRowsAfterUpdate,
    pendingRowsAfterUpdate: summary.pendingRowsAfterUpdate,
    dispositionCodeCounts: summary.dispositionCodeCounts,
    connectedCandidateFirstEdgeRelationCounts: summary.connectedCandidateFirstEdgeRelationCounts,
    newlyResolvedFirstEdgeRelationCounts: summary.newlyResolvedFirstEdgeRelationCounts,
    developmentConnectedComponentCount: summary.developmentConnectedComponentCount,
    provisionalDirectTargetCount: 0,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2];
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "validation/hard-decoy-holdout-v3/definite-exclusion-snapshot-2026-08-29");
  try {
    if (command === "generate") {
      await rm(output, { recursive: true, force: true });
      console.log(JSON.stringify(await collectDefiniteExclusions({ outputDirectory: output }), null, 2));
    } else if (command === "verify") {
      console.log(JSON.stringify(await verifyDefiniteExclusions({ snapshotDirectory: output }), null, 2));
    } else {
      throw new Error("Usage: node scripts/hard-decoy/v3-definite-exclusions.mjs <generate|verify> [snapshot-directory]");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
