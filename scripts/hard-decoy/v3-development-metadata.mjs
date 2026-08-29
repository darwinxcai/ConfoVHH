import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/development-metadata-contract-2026-08-29.json";
const STATUS = "DEVELOPMENT_METADATA_COMPLETED_BLOCKED_PENDING_SCIENTIFIC_LEAKAGE_AUDIT";
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const COORDINATE = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult)$/iu;

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

function uniqueObjects(values) {
  const map = new Map(values.map((value) => [canonical(value), value]));
  return byteSort([...map.keys()]).map((key) => map.get(key));
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
  ok(text.endsWith("\n"), `${label} must end with LF.`);
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line, index) => {
    try {
      const row = JSON.parse(line);
      walk(row);
      return row;
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

async function readDirect(root, relative, label, maximumBytes = 64 * 1024 * 1024) {
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

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/gu, " ") : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrString(value) {
  if (Number.isInteger(value)) return String(value);
  return text(value);
}

function sequence(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, "").toUpperCase();
  return normalized.length ? normalized : null;
}

function normalizeReferenceSequence(row) {
  const databaseName = text(row?.database_name);
  const databaseAccession = text(row?.database_accession);
  const provenanceSource = text(row?.provenance_source);
  if (!databaseName && !databaseAccession && !provenanceSource) return null;
  return { databaseName, databaseAccession, provenanceSource };
}

function normalizeSourceOrganism(row) {
  const scientificName = text(row?.ncbi_scientific_name);
  const taxonomyId = integerOrString(row?.ncbi_taxonomy_id);
  if (!scientificName && !taxonomyId) return null;
  return { scientificName, taxonomyId };
}

function normalizeEntity(row, contract) {
  const identifiers = row?.rcsb_polymer_entity_container_identifiers ?? {};
  const rcsbId = text(row?.rcsb_id);
  const entityId = text(identifiers.entity_id) ?? rcsbId?.split("_").at(-1) ?? null;
  ok(rcsbId && entityId, "RCSB polymer entity lacks a stable identifier.");
  const normalizedSequence = sequence(row?.entity_poly?.pdbx_seq_one_letter_code_can);
  const description = text(row?.rcsb_polymer_entity?.pdbx_description);
  const referenceSequences = uniqueObjects((identifiers.reference_sequence_identifiers ?? []).map(normalizeReferenceSequence).filter(Boolean));
  const sourceOrganisms = uniqueObjects((row?.rcsb_entity_source_organism ?? []).map(normalizeSourceOrganism).filter(Boolean));
  const labelAsymIds = uniqueStrings(identifiers.asym_ids ?? []);
  const authAsymIds = uniqueStrings(identifiers.auth_asym_ids ?? []);
  const signal = contract.vhhMetadataSignal;
  const vhhDescription = new RegExp(signal.descriptionPattern, "iu").test(description ?? "");
  const camelidSource = sourceOrganisms.some((organism) => new RegExp(signal.camelidOrganismPattern, "iu").test(organism.scientificName ?? ""));
  const vhhLength = normalizedSequence !== null && normalizedSequence.length >= signal.minimumSequenceLength && normalizedSequence.length <= signal.maximumSequenceLength;
  return {
    rcsbId,
    entityId,
    description,
    polymerType: text(row?.entity_poly?.rcsb_entity_polymer_type),
    polymerTypeDetail: text(row?.entity_poly?.type),
    sequence: normalizedSequence,
    sequenceLength: normalizedSequence?.length ?? null,
    sequenceSha256: normalizedSequence ? sha256(Buffer.from(normalizedSequence)) : null,
    labelAsymIds,
    authAsymIds,
    referenceSequences,
    sourceOrganisms,
    metadataSignals: {
      vhhDescription,
      camelidSource,
      vhhLength,
      vhhLikeCandidate: vhhDescription || (camelidSource && vhhLength),
    },
  };
}

function normalizeGpcrdb(row) {
  ok(row && typeof row === "object", "Missing frozen GPCRdb development metadata.");
  return {
    protein: text(row.protein),
    class: text(row.class),
    family: text(row.family),
    species: text(row.species),
    preferredChain: text(row.preferred_chain),
    resolution: numberOrNull(row.resolution),
    publicationDate: text(row.publication_date),
    experimentalType: text(row.type),
    state: text(row.state),
    activationDistance: numberOrNull(row.distance),
    publication: text(row.publication),
    signallingProtein: row.signalling_protein === undefined ? null : JSON.parse(canonical(row.signalling_protein)),
  };
}

function normalizeMissingEntry(raw, gpcrdbRow, contract) {
  const pdbId = text(raw?.rcsb_id)?.toUpperCase();
  ok(pdbId && PDB_ID.test(pdbId), "RCSB development entry lacks a valid PDB identifier.");
  const polymerEntities = (raw.polymer_entities ?? []).map((row) => normalizeEntity(row, contract))
    .sort((left, right) => byteCompare(`${left.entityId}\0${left.rcsbId}`, `${right.entityId}\0${right.rcsbId}`));
  ok(polymerEntities.length > 0 && new Set(polymerEntities.map((entity) => entity.entityId)).size === polymerEntities.length, `${pdbId} polymer entities are missing or duplicated.`);
  const gpcrdb = normalizeGpcrdb(gpcrdbRow);
  const preferred = gpcrdb.preferredChain;
  const preferredAuthChainEntityIds = preferred ? polymerEntities.filter((entity) => entity.authAsymIds.includes(preferred)).map((entity) => entity.entityId) : [];
  const preferredLabelChainEntityIds = preferred ? polymerEntities.filter((entity) => entity.labelAsymIds.includes(preferred)).map((entity) => entity.entityId) : [];
  const citation = raw.rcsb_primary_citation ?? {};
  const primaryDoi = text(citation.pdbx_database_id_DOI)?.toLowerCase() ?? null;
  const primaryPmid = integerOrString(citation.pdbx_database_id_PubMed);
  const experimentalMethods = uniqueStrings([
    ...(raw.exptl ?? []).map((row) => text(row?.method)).filter(Boolean),
    text(raw.rcsb_entry_info?.experimental_method),
  ]);
  const resolutionAngstrom = [...new Set((raw.rcsb_entry_info?.resolution_combined ?? []).map(numberOrNull).filter((value) => value !== null))].sort((a, b) => a - b);
  return {
    pdbId,
    discoveryRouteIds: ["development-registry-completion"],
    title: text(raw.struct?.title),
    keywords: {
      pdbxKeywords: text(raw.struct_keywords?.pdbx_keywords),
      text: text(raw.struct_keywords?.text),
    },
    releaseDate: text(raw.rcsb_accession_info?.initial_release_date),
    primaryCitation: {
      doi: primaryDoi,
      pmid: primaryPmid,
      title: text(citation.title),
    },
    experimentalMethods,
    resolutionAngstrom,
    polymerEntityCountReported: Number.isInteger(raw.rcsb_entry_info?.polymer_entity_count) ? raw.rcsb_entry_info.polymer_entity_count : null,
    gpcrdb,
    receptorMapping: {
      preferredAuthChainEntityIds: uniqueStrings(preferredAuthChainEntityIds),
      preferredLabelChainEntityIds: uniqueStrings(preferredLabelChainEntityIds),
    },
    polymerEntities,
    metadataCompleteness: {
      entryTitlePresent: text(raw.struct?.title) !== null,
      primaryCitationIdentified: primaryDoi !== null || primaryPmid !== null,
      preferredReceptorAuthChainUniquelyMapped: preferredAuthChainEntityIds.length === 1,
      allPolymerSequencesPresent: polymerEntities.every((entity) => entity.sequence !== null),
      polymerEntityCountMatches: Number.isInteger(raw.rcsb_entry_info?.polymer_entity_count) && raw.rcsb_entry_info.polymer_entity_count === polymerEntities.length,
    },
    metadataSignals: {
      vhhLikeEntityIds: polymerEntities.filter((entity) => entity.metadataSignals.vhhLikeCandidate).map((entity) => entity.entityId),
    },
    directInterfaceEvidenceStatus: "UNRESOLVED",
    dispositionStatus: "DEVELOPMENT_METADATA_ONLY",
    nativeCoordinatesInspected: false,
  };
}

function parseGraphql(payload, expectedIds, gpcrdbMap, contract) {
  const parsed = JSON.parse(payload);
  ok(!parsed.errors?.length, `RCSB GraphQL returned errors: ${canonical(parsed.errors ?? [])}`);
  ok(Array.isArray(parsed.data?.entries), "RCSB GraphQL response lacks entries.");
  const expected = new Set(expectedIds);
  const seen = new Set();
  const entries = parsed.data.entries.map((raw) => {
    const id = text(raw?.rcsb_id)?.toUpperCase();
    ok(id && expected.has(id) && !seen.has(id), `RCSB GraphQL returned unexpected or duplicate development entry: ${id}`);
    seen.add(id);
    return normalizeMissingEntry(raw, gpcrdbMap.get(id), contract);
  }).sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(seen.size === expected.size && expectedIds.every((id) => seen.has(id)), "RCSB GraphQL omitted a required development entry.");
  return entries;
}

function uniprotAccessions(entity) {
  if (!entity) return [];
  return uniqueStrings((entity.referenceSequences ?? [])
    .filter((reference) => /uniprot/iu.test(reference.databaseName ?? ""))
    .map((reference) => reference.databaseAccession));
}

function buildDevelopmentNode(registryRow, entry, metadataSource, contract) {
  const receptorIds = entry.receptorMapping?.preferredAuthChainEntityIds ?? [];
  const receptor = receptorIds.length === 1 ? entry.polymerEntities.find((entity) => entity.entityId === receptorIds[0]) ?? null : null;
  const vhhCandidates = (entry.polymerEntities ?? []).filter((entity) => entity.metadataSignals?.vhhLikeCandidate).map((entity) => ({
    entityId: entity.entityId,
    description: entity.description,
    sequenceLength: entity.sequenceLength,
    sequenceSha256: entity.sequenceSha256,
    authAsymIds: entity.authAsymIds,
    labelAsymIds: entity.labelAsymIds,
    sourceOrganisms: entity.sourceOrganisms,
  })).sort((left, right) => byteCompare(left.entityId, right.entityId));
  const vhhMetadataCandidateStatus = vhhCandidates.length === 1 ? "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE"
    : vhhCandidates.length === 0 ? "NO_METADATA_CANDIDATE" : "MULTIPLE_METADATA_CANDIDATES";
  const primaryDoi = entry.primaryCitation?.doi ?? null;
  const primaryPmid = entry.primaryCitation?.pmid ?? null;
  return {
    pdbId: registryRow.pdbId,
    registryReceptor: registryRow.receptor,
    registryVhh: registryRow.vhh ?? null,
    developmentRoles: uniqueStrings(registryRow.roles ?? []),
    metadataSource,
    releaseDate: entry.releaseDate ?? null,
    experimentalMethods: entry.experimentalMethods ?? [],
    resolutionAngstrom: entry.resolutionAngstrom ?? [],
    gpcrdb: entry.gpcrdb,
    publication: {
      doi: primaryDoi,
      pmid: primaryPmid,
      title: entry.primaryCitation?.title ?? null,
      status: primaryDoi !== null || primaryPmid !== null ? "PUBLISHED" : "UNKNOWN",
    },
    receptor: {
      selectionStatus: receptor ? "UNIQUE_PREFERRED_AUTH_CHAIN_ENTITY" : "UNRESOLVED",
      preferredAuthChain: entry.gpcrdb?.preferredChain ?? null,
      entityId: receptor?.entityId ?? null,
      description: receptor?.description ?? null,
      sequenceLength: receptor?.sequenceLength ?? null,
      sequenceSha256: receptor?.sequenceSha256 ?? null,
      uniprotAccessions: uniprotAccessions(receptor),
      authAsymIds: receptor?.authAsymIds ?? [],
      labelAsymIds: receptor?.labelAsymIds ?? [],
    },
    vhhMetadataCandidateStatus,
    vhhMetadataCandidates: vhhCandidates,
    directReceptorVhhEvidence: contract.metadataSelection.directInterfaceEvidence,
    constructEvidence: contract.metadataSelection.constructEvidence,
    knownParentEvidence: contract.metadataSelection.knownParentEvidence,
    annotationEpitopeAuthority: false,
    formalLeakageCertificationComplete: false,
    targetFreezeAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function summarize(nodes, reusedIds, missingIds) {
  const vhhCounts = {
    unique: nodes.filter((node) => node.vhhMetadataCandidateStatus === "UNIQUE_METADATA_CANDIDATE_NOT_DIRECT_INTERFACE_EVIDENCE").length,
    multiple: nodes.filter((node) => node.vhhMetadataCandidateStatus === "MULTIPLE_METADATA_CANDIDATES").length,
    none: nodes.filter((node) => node.vhhMetadataCandidateStatus === "NO_METADATA_CANDIDATE").length,
  };
  return {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    developmentNodeCount: nodes.length,
    reusedMetadataNodeCount: reusedIds.length,
    newlyCompletedMetadataNodeCount: missingIds.length,
    newlyCompletedPdbIds: missingIds,
    uniquePreferredReceptorEntityCount: nodes.filter((node) => node.receptor.selectionStatus === "UNIQUE_PREFERRED_AUTH_CHAIN_ENTITY").length,
    receptorNodesWithExactlyOneUniProtAccession: nodes.filter((node) => node.receptor.uniprotAccessions.length === 1).length,
    vhhMetadataCandidateCounts: vhhCounts,
    nodesWithPrimaryCitationIdentifier: nodes.filter((node) => node.publication.doi !== null || node.publication.pmid !== null).length,
    directInterfaceEvidenceResolvedCount: 0,
    formalLeakageCertificationComplete: false,
    dispositionLedgerComplete: false,
    leakageGraphComplete: false,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
}

async function responseBytes(response, maximumBytes) {
  ok(response.body, "RCSB GraphQL response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    ok(total <= maximumBytes, "RCSB GraphQL response exceeded its byte cap.");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function readInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const contractFile = await readDirect(root, CONTRACT_REL, "development metadata contract", 2 * 1024 * 1024);
  const contract = JSON.parse(contractFile.text);
  walk(contract);
  ok(contract.schemaVersion === "1.0.0" && contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.status === "DEVELOPMENT_METADATA_COMPLETION_RULE_FROZEN", "Development metadata contract identity drifted.");
  ok(contract.selectedProtocol.metadataPreparationStageOnly === true, "Development metadata work must remain in metadata preparation.");
  ok(contract.integrity.exactDevelopmentCoverageRequired && contract.integrity.normalizedRepeatEqualityRequired && contract.integrity.metadataSignalsCannotPromoteTargets, "Development metadata integrity rules drifted.");
  ok(contract.integrity.targetFreezePermitted === false && contract.integrity.executionAuthorized === false, "Development metadata contract cannot authorize target freeze or execution.");

  const protocolFile = await readDirect(root, contract.selectedProtocol.path, "selected v3 protocol", 4 * 1024 * 1024);
  const registryFile = await readDirect(root, contract.developmentRegistry.path, "development registry", 4 * 1024 * 1024);
  const entryFile = await readDirect(root, `${contract.reusedEntryMetadata.directory}/${contract.reusedEntryMetadata.entryLedgerFile}`, "reused entry metadata ledger");
  const gpcrdbFile = await readDirect(root, contract.gpcrdbMetadata.path, "frozen GPCRdb metadata");
  const queryFile = await readDirect(root, contract.missingEntryMetadata.queryPath, "RCSB metadata query", 2 * 1024 * 1024);
  const licenseFile = await readDirect(root, contract.sourceLicenses.path, "source license record", 2 * 1024 * 1024);
  for (const [observed, expected, label] of [
    [protocolFile.sha256, contract.selectedProtocol.sha256, "selected protocol"],
    [registryFile.sha256, contract.developmentRegistry.sha256, "development registry"],
    [entryFile.sha256, contract.reusedEntryMetadata.entryLedgerSha256, "reused entry metadata"],
    [gpcrdbFile.sha256, contract.gpcrdbMetadata.sha256, "GPCRdb metadata"],
    [queryFile.sha256, contract.missingEntryMetadata.querySha256, "RCSB query"],
    [licenseFile.sha256, contract.sourceLicenses.sha256, "source license record"],
  ]) ok(observed === expected, `${label} digest drifted.`);

  const registry = JSON.parse(registryFile.text).developmentGpcrVhhStructures ?? [];
  const registryIds = byteSort(registry.map((row) => row.pdbId));
  ok(registry.length === contract.developmentRegistry.expectedStructureCount && canonical(registryIds) === canonical(contract.developmentRegistry.requiredStructureIds), "Development registry structure set drifted.");
  const registryMap = new Map(registry.map((row) => [row.pdbId, row]));
  ok(registryMap.size === registry.length && registryIds.every((id) => PDB_ID.test(id)), "Development registry contains duplicate or invalid PDB IDs.");

  const entryRows = parseJsonl(entryFile.text, "reused development entry metadata");
  const entryMap = new Map(entryRows.map((row) => [row.pdbId, row]));
  ok(entryMap.size === entryRows.length, "Reused entry metadata contains duplicate PDB IDs.");
  const reusedIds = registryIds.filter((id) => entryMap.has(id));
  const missingIds = registryIds.filter((id) => !entryMap.has(id));
  ok(canonical(reusedIds) === canonical(contract.reusedEntryMetadata.reusedStructureIds) && reusedIds.length === contract.reusedEntryMetadata.expectedReusedStructureCount, "Reused development metadata set drifted.");
  ok(canonical(missingIds) === canonical(contract.missingEntryMetadata.requiredStructureIds), "Derived missing development metadata set drifted.");

  const gpcrdbRows = JSON.parse(gpcrdbFile.text);
  ok(Array.isArray(gpcrdbRows) && gpcrdbRows.length === contract.gpcrdbMetadata.expectedInventoryCount, "Frozen GPCRdb inventory count drifted.");
  const gpcrdbMap = new Map();
  for (const row of gpcrdbRows) {
    const id = text(row?.[contract.gpcrdbMetadata.pdbCodeField])?.toUpperCase();
    if (!registryMap.has(id)) continue;
    ok(!gpcrdbMap.has(id), `Frozen GPCRdb metadata duplicates development entry ${id}.`);
    gpcrdbMap.set(id, row);
  }
  ok(registryIds.every((id) => gpcrdbMap.has(id)), "Frozen GPCRdb metadata omits a development entry.");

  const licenseRecord = JSON.parse(licenseFile.text);
  const mappings = Object.fromEntries((licenseRecord.sources ?? []).map((source) => [source.sourceId, source.licenseSpdx]));
  for (const [sourceId, expected] of Object.entries(contract.sourceLicenses.requiredMappings)) ok(mappings[sourceId] === expected, `Source license mapping drifted: ${sourceId}`);

  return {
    root,
    contract,
    query: queryFile.text,
    registryIds,
    registryMap,
    entryMap,
    reusedIds,
    missingIds,
    gpcrdbMap,
    inputDigests: {
      contract: contractFile.sha256,
      selectedProtocol: protocolFile.sha256,
      developmentRegistry: registryFile.sha256,
      reusedEntryMetadata: entryFile.sha256,
      frozenGpcrdbMetadata: gpcrdbFile.sha256,
      rcsbQuery: queryFile.sha256,
      sourceLicenseRecord: licenseFile.sha256,
      generatorScript: sha256(await readFile(HERE)),
    },
  };
}

async function fetchMissing({ contract, query, missingIds, fetchImpl, now }) {
  const body = `${JSON.stringify({ query, variables: { ids: missingIds } })}\n`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), contract.missingEntryMetadata.timeoutMilliseconds);
  const startedUtc = now();
  try {
    const response = await fetchImpl(contract.missingEntryMetadata.endpoint, {
      method: contract.missingEntryMetadata.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": contract.missingEntryMetadata.userAgent,
      },
      body,
      redirect: contract.missingEntryMetadata.redirectPolicy,
      signal: controller.signal,
    });
    ok(response.ok, `RCSB development metadata request returned HTTP ${response.status}.`);
    ok(response.redirected !== true && (response.url || contract.missingEntryMetadata.endpoint) === contract.missingEntryMetadata.endpoint, "RCSB development metadata request redirected.");
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
    ok(["application/json", "application/graphql-response+json"].includes(mediaType), `RCSB development metadata returned forbidden content type: ${contentType ?? "missing"}`);
    const bytes = await responseBytes(response, contract.missingEntryMetadata.maximumResponseBytes);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    clean("RCSB development metadata response", decoded);
    return {
      bytes,
      decoded,
      record: {
        requestedIds: missingIds,
        requestBodySha256: sha256(Buffer.from(body)),
        requestedUrl: contract.missingEntryMetadata.endpoint,
        finalUrl: response.url || contract.missingEntryMetadata.endpoint,
        method: contract.missingEntryMetadata.method,
        startedUtc,
        completedUtc: now(),
        status: response.status,
        contentType,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function put(root, relative, value) {
  const filename = safePath(root, relative, `output ${relative}`);
  await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const textValue = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(relative, textValue);
  await writeFile(filename, bytes, { flag: "wx" });
}

async function listFiles(root, current = "", result = []) {
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    ok(!entry.isSymbolicLink(), `Output inventory contains a symlink: ${relative}`);
    if (entry.isDirectory()) await listFiles(root, relative, result);
    else result.push(relative);
    ok(result.length <= 32, "Development metadata output inventory exceeded its file cap.");
  }
  return byteSort(result);
}

function flattenEntities(entries) {
  return entries.flatMap((entry) => (entry.polymerEntities ?? []).map((entity) => ({ pdbId: entry.pdbId, ...entity })))
    .sort((left, right) => byteCompare(`${left.pdbId}\0${left.entityId}`, `${right.pdbId}\0${right.entityId}`));
}

export async function collectDevelopmentMetadata({ repositoryRoot = ROOT, outputDirectory, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  ok(outputDirectory && typeof fetchImpl === "function", "Output directory and fetch implementation are required.");
  const inputs = await readInputs(repositoryRoot);
  const output = path.resolve(outputDirectory);
  const parent = path.dirname(output);
  ok(await realpath(parent) === path.resolve(parent), "Output parent cannot contain symlinked ancestors.");
  await mkdir(output, { recursive: false });

  const rawResponses = [];
  const normalizedRepeats = [];
  const requests = [];
  for (let repeat = 1; repeat <= inputs.contract.missingEntryMetadata.repeatCount; repeat += 1) {
    const response = await fetchMissing({ ...inputs, fetchImpl, now });
    rawResponses.push(response.bytes);
    const normalized = parseGraphql(response.decoded, inputs.missingIds, inputs.gpcrdbMap, inputs.contract);
    const normalizedText = jsonl(normalized);
    normalizedRepeats.push(normalizedText);
    requests.push({ repeat, ...response.record, normalizedEntryCount: normalized.length, normalizedEntriesSha256: sha256(Buffer.from(normalizedText)) });
    if (inputs.contract.missingEntryMetadata.minimumDelayMilliseconds > 0) await delay(inputs.contract.missingEntryMetadata.minimumDelayMilliseconds);
  }
  ok(normalizedRepeats.every((value) => value === normalizedRepeats[0]), "Normalized repeated development metadata responses disagree.");
  const missingEntries = parseJsonl(normalizedRepeats[0], "normalized missing development entries");
  const completeEntries = inputs.registryIds.map((id) => inputs.entryMap.get(id) ?? missingEntries.find((entry) => entry.pdbId === id));
  ok(completeEntries.every(Boolean), "Complete development metadata omitted an entry.");
  const nodes = inputs.registryIds.map((id) => buildDevelopmentNode(
    inputs.registryMap.get(id),
    inputs.entryMap.get(id) ?? missingEntries.find((entry) => entry.pdbId === id),
    inputs.entryMap.has(id) ? "REUSED_FROZEN_REPEATED_ENTRY_METADATA" : "NEW_REPEATED_RCSB_METADATA_COMPLETION",
    inputs.contract,
  ));
  const entities = flattenEntities(completeEntries);
  const summary = summarize(nodes, inputs.reusedIds, inputs.missingIds);
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    stage: "V3_METADATA_PREPARATION",
    status: STATUS,
    snapshotDateUtc: inputs.contract.snapshotDateUtc,
    contractPath: CONTRACT_REL,
    generatorScript: path.relative(inputs.root, HERE).split(path.sep).join("/"),
    inputDigests: inputs.inputDigests,
    sourceLicenses: inputs.contract.sourceLicenses.requiredMappings,
    reusedDevelopmentMetadataIds: inputs.reusedIds,
    newlyCompletedDevelopmentMetadataIds: inputs.missingIds,
    repeatedRequestCount: requests.length,
    requests,
    normalizedOutputs: {
      developmentNodes: { count: nodes.length, sha256: sha256(Buffer.from(jsonl(nodes))) },
      entities: { count: entities.length, sha256: sha256(Buffer.from(jsonl(entities))) },
      missingEntries: { count: missingEntries.length, sha256: sha256(Buffer.from(jsonl(missingEntries))) },
    },
    summary,
    directInterfaceEvidenceResolved: false,
    formalLeakageCertificationComplete: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };

  for (let index = 0; index < rawResponses.length; index += 1) await put(output, `raw/rcsb-development-metadata-repeat-${index + 1}.json`, rawResponses[index]);
  await put(output, "missing-entries.jsonl", jsonl(missingEntries));
  await put(output, "development-nodes.jsonl", jsonl(nodes));
  await put(output, "entities.jsonl", jsonl(entities));
  await put(output, "requests.jsonl", jsonl(requests));
  await put(output, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  await put(output, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await put(output, "README.md", [
    "# ConfoVHH hard-decoy v3 development metadata snapshot",
    "",
    `Status: **${STATUS}**`,
    "",
    `- Development structures: ${summary.developmentNodeCount}`,
    `- Reused from the previously repeated 287-entry metadata snapshot: ${summary.reusedMetadataNodeCount}`,
    `- Newly completed by two repeated metadata-only RCSB requests: ${summary.newlyCompletedMetadataNodeCount} (${summary.newlyCompletedPdbIds.join(", ")})`,
    `- Unique preferred-receptor entity mappings: ${summary.uniquePreferredReceptorEntityCount}`,
    `- Receptor nodes with exactly one UniProt accession: ${summary.receptorNodesWithExactlyOneUniProtAccession}`,
    `- Unique VHH-like metadata candidates: ${summary.vhhMetadataCandidateCounts.unique}`,
    `- Multiple VHH-like metadata candidates: ${summary.vhhMetadataCandidateCounts.multiple}`,
    `- No VHH-like metadata candidate: ${summary.vhhMetadataCandidateCounts.none}`,
    "",
    "A unique VHH-like metadata candidate is not direct receptor–VHH interface evidence. Direct-interface, construct, known-parent, canonical TM1–TM7, IMGT and sealed native-epitope gates remain unresolved. This snapshot cannot promote targets, freeze the leakage graph, or authorize benchmark execution.",
    "",
    "No native coordinates, native relative poses, DockQ/CAPRI labels, ConfoVHH holdout scores or performance results were accessed.",
    "",
  ].join("\n"));

  const expectedWithoutChecksums = byteSort(inputs.contract.output.requiredFiles.filter((file) => file !== "checksums.sha256"));
  ok(canonical(await listFiles(output)) === canonical(expectedWithoutChecksums), "Development metadata output inventory drifted before checksumming.");
  const checksumRows = await Promise.all(expectedWithoutChecksums.map(async (relative) => `${sha256(await readFile(path.join(output, relative)))}  ${relative}`));
  await put(output, "checksums.sha256", `${checksumRows.join("\n")}\n`);
  return { ...await verifyDevelopmentMetadataSnapshot({ repositoryRoot: inputs.root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifyDevelopmentMetadataSnapshot({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "A development metadata snapshot directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(snapshot === path.resolve(snapshotDirectory), "Development metadata snapshot path contains symlinked ancestors.");
  const expected = byteSort(inputs.contract.output.requiredFiles);
  ok(canonical(await listFiles(snapshot)) === canonical(expected), "Development metadata snapshot does not match the exact file allowlist.");
  const checksumFile = await readDirect(snapshot, "checksums.sha256", "development metadata checksums", 128 * 1024);
  ok(checksumFile.text.endsWith("\n"), "Development metadata checksums must end with LF.");
  const checksumRows = checksumFile.text.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    ok(match, `Development metadata checksum row ${index + 1} is invalid.`);
    return { digest: match[1], relative: match[2] };
  });
  const payloadFiles = expected.filter((file) => file !== "checksums.sha256");
  ok(canonical(checksumRows.map((row) => row.relative)) === canonical(payloadFiles) && new Set(checksumRows.map((row) => row.relative)).size === payloadFiles.length, "Development metadata checksum coverage drifted.");
  const payloads = new Map();
  for (const row of checksumRows) {
    const file = await readDirect(snapshot, row.relative, `development metadata ${row.relative}`, inputs.contract.missingEntryMetadata.maximumResponseBytes * 4);
    ok(file.sha256 === row.digest, `Development metadata checksum mismatch: ${row.relative}`);
    payloads.set(row.relative, file);
  }

  const missingRepeats = [1, 2].map((repeat) => parseGraphql(
    payloads.get(`raw/rcsb-development-metadata-repeat-${repeat}.json`).text,
    inputs.missingIds,
    inputs.gpcrdbMap,
    inputs.contract,
  ));
  const missingText = missingRepeats.map(jsonl);
  ok(missingText.every((value) => value === missingText[0]), "Archived normalized development metadata repeats disagree.");
  ok(payloads.get("missing-entries.jsonl").text === missingText[0], "Archived missing development entry ledger is not reproducible from raw metadata.");
  const missingEntries = parseJsonl(missingText[0], "archived missing development entries");
  const completeEntries = inputs.registryIds.map((id) => inputs.entryMap.get(id) ?? missingEntries.find((entry) => entry.pdbId === id));
  const expectedNodes = inputs.registryIds.map((id) => buildDevelopmentNode(
    inputs.registryMap.get(id),
    inputs.entryMap.get(id) ?? missingEntries.find((entry) => entry.pdbId === id),
    inputs.entryMap.has(id) ? "REUSED_FROZEN_REPEATED_ENTRY_METADATA" : "NEW_REPEATED_RCSB_METADATA_COMPLETION",
    inputs.contract,
  ));
  const expectedEntities = flattenEntities(completeEntries);
  const expectedSummary = summarize(expectedNodes, inputs.reusedIds, inputs.missingIds);
  ok(payloads.get("development-nodes.jsonl").text === jsonl(expectedNodes), "Development node ledger is not reproducible from frozen metadata inputs.");
  ok(payloads.get("entities.jsonl").text === jsonl(expectedEntities), "Development entity ledger is not reproducible from frozen metadata inputs.");
  ok(canonical(JSON.parse(payloads.get("summary.json").text)) === canonical(expectedSummary), "Development metadata summary drifted.");

  const requests = parseJsonl(payloads.get("requests.jsonl").text, "development metadata requests");
  ok(requests.length === inputs.contract.missingEntryMetadata.repeatCount && requests.every((row, index) => row.repeat === index + 1), "Development metadata request ledger drifted.");
  for (const request of requests) {
    const raw = payloads.get(`raw/rcsb-development-metadata-repeat-${request.repeat}.json`);
    ok(request.sha256 === raw.sha256 && request.bytes === raw.bytes.byteLength && request.normalizedEntriesSha256 === sha256(Buffer.from(missingText[request.repeat - 1])), "Development metadata request evidence drifted.");
  }

  const manifest = JSON.parse(payloads.get("manifest.json").text);
  walk(manifest);
  ok(manifest.status === STATUS && canonical(manifest.inputDigests) === canonical(inputs.inputDigests), "Development metadata manifest identity or input digests drifted.");
  ok(manifest.normalizedOutputs.developmentNodes.sha256 === sha256(Buffer.from(jsonl(expectedNodes))) && manifest.normalizedOutputs.entities.sha256 === sha256(Buffer.from(jsonl(expectedEntities))) && manifest.normalizedOutputs.missingEntries.sha256 === sha256(Buffer.from(missingText[0])), "Development metadata normalized-output digests drifted.");
  for (const field of ["directInterfaceEvidenceResolved", "formalLeakageCertificationComplete", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) ok(manifest[field] === false, `Development metadata manifest field must remain false: ${field}`);

  return {
    status: STATUS,
    developmentNodeCount: expectedSummary.developmentNodeCount,
    reusedMetadataNodeCount: expectedSummary.reusedMetadataNodeCount,
    newlyCompletedMetadataNodeCount: expectedSummary.newlyCompletedMetadataNodeCount,
    newlyCompletedPdbIds: expectedSummary.newlyCompletedPdbIds,
    uniquePreferredReceptorEntityCount: expectedSummary.uniquePreferredReceptorEntityCount,
    receptorNodesWithExactlyOneUniProtAccession: expectedSummary.receptorNodesWithExactlyOneUniProtAccession,
    uniqueVhhMetadataCandidateCount: expectedSummary.vhhMetadataCandidateCounts.unique,
    multipleVhhMetadataCandidateCount: expectedSummary.vhhMetadataCandidateCounts.multiple,
    noVhhMetadataCandidateCount: expectedSummary.vhhMetadataCandidateCounts.none,
    directInterfaceEvidenceResolvedCount: 0,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2];
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29");
  try {
    if (command === "generate") {
      await rm(output, { recursive: true, force: true });
      console.log(JSON.stringify(await collectDevelopmentMetadata({ outputDirectory: output }), null, 2));
    } else if (command === "verify") {
      console.log(JSON.stringify(await verifyDevelopmentMetadataSnapshot({ snapshotDirectory: output }), null, 2));
    } else {
      throw new Error("Usage: node scripts/hard-decoy/v3-development-metadata.mjs <generate|verify> [snapshot-directory]");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
