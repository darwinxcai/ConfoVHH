import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyV3EntryMetadataContracts } from "./verify-v3-entry-metadata-contracts.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_PATH = "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json";
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

function ok(value, message) {
  if (!value) throw new Error(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function clean(name, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${name}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${name}.`);
  ok(!LABEL.test(text), `Observed holdout-label assignment appeared in ${name}.`);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function byteCompare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}
function byteSort(values) {
  return [...values].sort(byteCompare);
}
function uniqueStrings(values) {
  return byteSort([...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]);
}
function uniqueObjects(values) {
  const map = new Map(values.map((value) => [canonical(value), value]));
  return byteSort([...map.keys()]).map((key) => map.get(key));
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
function entitySort(left, right) {
  const a = Number.parseInt(left.entityId, 10);
  const b = Number.parseInt(right.entityId, 10);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
  return byteCompare(`${left.entityId}\0${left.rcsbId}`, `${right.entityId}\0${right.rcsbId}`);
}
function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
}
function parseJsonl(payload, label) {
  if (!payload) return [];
  ok(payload.endsWith("\n"), `${label} must end with LF.`);
  return payload.trimEnd().split("\n").map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${label}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  });
}
function batchPlan(ids, batchSize) {
  const batches = [];
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batchIds = ids.slice(offset, offset + batchSize);
    batches.push({
      batchIndex: batches.length + 1,
      firstPdbId: batchIds[0],
      lastPdbId: batchIds.at(-1),
      count: batchIds.length,
      ids: batchIds,
      identifierListSha256: sha256(Buffer.from(`${batchIds.join("\n")}\n`)),
    });
  }
  return batches;
}
function rawFile(batchIndex, repeat) {
  return `raw/rcsb-entry-metadata-batch-${String(batchIndex).padStart(3, "0")}-repeat-${repeat}.json`;
}
function expectedFiles(contract) {
  const raw = [];
  for (let batch = 1; batch <= contract.rcsb.expectedBatchCount; batch += 1) {
    for (let repeat = 1; repeat <= contract.rcsb.repeatCount; repeat += 1) raw.push(rawFile(batch, repeat));
  }
  return byteSort([...contract.snapshot.staticFiles, ...raw]);
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
  const entityId = text(identifiers.entity_id) ?? text(row?.rcsb_id)?.split("_").at(-1) ?? null;
  const rcsbId = text(row?.rcsb_id);
  ok(entityId && rcsbId, "RCSB polymer entity lacks a stable identifier.");
  const normalizedSequence = sequence(row?.entity_poly?.pdbx_seq_one_letter_code_can);
  const description = text(row?.rcsb_polymer_entity?.pdbx_description);
  const sourceOrganisms = uniqueObjects((row?.rcsb_entity_source_organism ?? []).map(normalizeSourceOrganism).filter(Boolean));
  const referenceSequences = uniqueObjects((identifiers.reference_sequence_identifiers ?? []).map(normalizeReferenceSequence).filter(Boolean));
  const labelAsymIds = uniqueStrings(identifiers.asym_ids ?? []);
  const authAsymIds = uniqueStrings(identifiers.auth_asym_ids ?? []);
  const vhhDescription = new RegExp(contract.triage.vhhDescriptionPattern, "iu").test(description ?? "");
  const camelidSource = sourceOrganisms.some((organism) => new RegExp(contract.triage.camelidOrganismPattern, "iu").test(organism.scientificName ?? ""));
  const vhhLength = normalizedSequence !== null && normalizedSequence.length >= contract.triage.vhhLengthMinimum && normalizedSequence.length <= contract.triage.vhhLengthMaximum;
  const vhhLikeCandidate = vhhDescription || (camelidSource && vhhLength);
  const auxiliaryLexical = new RegExp(contract.triage.auxiliaryPattern, "iu").test(description ?? "");
  const constructRiskLexical = new RegExp(contract.triage.constructRiskPattern, "iu").test(description ?? "");
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
      vhhLikeCandidate,
      auxiliaryLexical,
      constructRiskLexical,
    },
  };
}
function normalizeGpcrdb(row) {
  ok(row && typeof row === "object", "Missing frozen GPCRdb row.");
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
function deriveTriage(entry, contract) {
  const vhhEntityIds = entry.polymerEntities.filter((entity) => entity.metadataSignals.vhhLikeCandidate).map((entity) => entity.entityId);
  const auxiliaryEntityIds = entry.polymerEntities.filter((entity) => entity.metadataSignals.auxiliaryLexical).map((entity) => entity.entityId);
  const constructRiskEntityIds = entry.polymerEntities.filter((entity) => entity.metadataSignals.constructRiskLexical).map((entity) => entity.entityId);
  const combinedText = [entry.title, entry.keywords.pdbxKeywords, entry.keywords.text].filter(Boolean).join(" ");
  const entryAuxiliaryLexical = new RegExp(contract.triage.auxiliaryPattern, "iu").test(combinedText);
  const entryConstructRiskLexical = new RegExp(contract.triage.constructRiskPattern, "iu").test(combinedText);
  const reasons = [];
  if (entry.receptorMapping.preferredAuthChainEntityIds.length !== 1) reasons.push("PREFERRED_RECEPTOR_AUTH_CHAIN_NOT_UNIQUELY_MAPPED");
  if (vhhEntityIds.length === 0) reasons.push("NO_VHH_LIKE_POLYMER_ENTITY_SIGNAL");
  if (auxiliaryEntityIds.length > 0 || entryAuxiliaryLexical) reasons.push("AUXILIARY_BINDER_LEXICAL_SIGNAL");
  if (constructRiskEntityIds.length > 0 || entryConstructRiskLexical) reasons.push("ENGINEERED_CONSTRUCT_LEXICAL_SIGNAL");
  if (entry.gpcrdb.signallingProtein !== null) reasons.push("GPCRDB_SIGNALLING_COMPLEX_PRESENT");
  if (!entry.metadataCompleteness.primaryCitationIdentified) reasons.push("PRIMARY_CITATION_IDENTIFIER_MISSING");
  if (!entry.metadataCompleteness.allPolymerSequencesPresent) reasons.push("POLYMER_SEQUENCE_MISSING");
  let reviewStratum = "DIRECT_TARGET_CANDIDATE_REVIEW";
  if (entry.receptorMapping.preferredAuthChainEntityIds.length !== 1 || vhhEntityIds.length === 0) reviewStratum = "METADATA_RESOLUTION_REQUIRED";
  else if (reasons.some((reason) => ["AUXILIARY_BINDER_LEXICAL_SIGNAL", "ENGINEERED_CONSTRUCT_LEXICAL_SIGNAL", "GPCRDB_SIGNALLING_COMPLEX_PRESENT"].includes(reason))) reviewStratum = "AUXILIARY_OR_CONSTRUCT_REVIEW";
  ok(contract.triage.allowedReviewStrata.includes(reviewStratum), `Unexpected review stratum: ${reviewStratum}`);
  return {
    pdbId: entry.pdbId,
    reviewStratum,
    reasons: uniqueStrings(reasons),
    preferredReceptorAuthChain: entry.gpcrdb.preferredChain,
    preferredReceptorAuthChainEntityIds: entry.receptorMapping.preferredAuthChainEntityIds,
    preferredReceptorLabelChainEntityIds: entry.receptorMapping.preferredLabelChainEntityIds,
    vhhLikeEntityIds: vhhEntityIds,
    auxiliaryLexicalEntityIds: auxiliaryEntityIds,
    constructRiskEntityIds,
    entryAuxiliaryLexical,
    entryConstructRiskLexical,
    directInterfaceEvidenceStatus: contract.triage.allDirectInterfaceEvidenceStatus,
    dispositionStatus: contract.triage.allDispositionStatus,
    nativeCoordinatesInspected: false,
  };
}
function normalizeEntry(raw, sourceRow, gpcrdbRaw, contract) {
  const pdbId = text(raw?.rcsb_id)?.toUpperCase();
  ok(pdbId && pdbId === sourceRow.pdbId, `RCSB entry/source-row mismatch for ${sourceRow.pdbId}.`);
  const polymerEntities = (raw.polymer_entities ?? []).map((row) => normalizeEntity(row, contract)).sort(entitySort);
  ok(new Set(polymerEntities.map((entity) => entity.entityId)).size === polymerEntities.length, `${pdbId} contains duplicate polymer entity IDs.`);
  const gpcrdb = normalizeGpcrdb(gpcrdbRaw);
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
  const entry = {
    pdbId,
    sourceQueryIds: uniqueStrings(sourceRow.rcsbQueryIds ?? []),
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
      allPolymerSequencesPresent: polymerEntities.length > 0 && polymerEntities.every((entity) => entity.sequence !== null),
      polymerEntityCountMatches: Number.isInteger(raw.rcsb_entry_info?.polymer_entity_count) && raw.rcsb_entry_info.polymer_entity_count === polymerEntities.length,
    },
    directInterfaceEvidenceStatus: contract.triage.allDirectInterfaceEvidenceStatus,
    dispositionStatus: contract.triage.allDispositionStatus,
    nativeCoordinatesInspected: false,
  };
  entry.metadataSignals = {
    vhhLikeEntityIds: entry.polymerEntities.filter((entity) => entity.metadataSignals.vhhLikeCandidate).map((entity) => entity.entityId),
    auxiliaryLexicalEntityIds: entry.polymerEntities.filter((entity) => entity.metadataSignals.auxiliaryLexical).map((entity) => entity.entityId),
    constructRiskEntityIds: entry.polymerEntities.filter((entity) => entity.metadataSignals.constructRiskLexical).map((entity) => entity.entityId),
  };
  return entry;
}
function parseGraphqlResponse(payload, batch, sourceMap, gpcrdbMap, contract) {
  const result = JSON.parse(payload);
  ok(!result.errors?.length, `RCSB GraphQL returned errors for batch ${batch.batchIndex}: ${canonical(result.errors ?? [])}`);
  ok(Array.isArray(result.data?.entries), `RCSB GraphQL response lacks entries for batch ${batch.batchIndex}.`);
  const rawEntries = result.data.entries;
  const seen = new Set();
  const normalized = [];
  for (const raw of rawEntries) {
    const id = text(raw?.rcsb_id)?.toUpperCase();
    ok(id && batch.ids.includes(id) && !seen.has(id), `RCSB GraphQL returned an unexpected or duplicate entry in batch ${batch.batchIndex}: ${id}`);
    seen.add(id);
    normalized.push(normalizeEntry(raw, sourceMap.get(id), gpcrdbMap.get(id), contract));
  }
  ok(seen.size === batch.ids.length && batch.ids.every((id) => seen.has(id)), `RCSB GraphQL omitted one or more entries from batch ${batch.batchIndex}.`);
  return normalized.sort((left, right) => byteCompare(left.pdbId, right.pdbId));
}
function normalizeGpcrdbMap(rows, ids) {
  const map = new Map();
  for (const row of rows) {
    const id = text(row?.pdb_code)?.toUpperCase();
    if (!id || !ids.includes(id)) continue;
    ok(!map.has(id), `Frozen GPCRdb metadata contains duplicate rows for ${id}.`);
    map.set(id, row);
  }
  ok(ids.every((id) => map.has(id)), "Frozen GPCRdb metadata is missing one or more exact source-universe entries.");
  return map;
}
async function readContext(root) {
  await verifyV3EntryMetadataContracts(root);
  const contract = JSON.parse(await readFile(path.join(root, CONTRACT_PATH), "utf8"));
  const query = await readFile(path.join(root, contract.rcsb.queryFile), "utf8");
  const sourceDirectory = path.join(root, contract.input.sourceSnapshotDirectory);
  const idText = await readFile(path.join(sourceDirectory, contract.input.sourceIdentifierListFile), "utf8");
  const ids = idText.trimEnd().split("\n");
  const universeRows = parseJsonl(await readFile(path.join(sourceDirectory, contract.input.sourceUniverseFile), "utf8"), "source-universe.jsonl");
  const sourceMap = new Map(universeRows.map((row) => [row.pdbId, row]));
  const gpcrdbRows = JSON.parse(await readFile(path.join(sourceDirectory, contract.input.gpcrdbRawFile), "utf8"));
  const gpcrdbMap = normalizeGpcrdbMap(gpcrdbRows, ids);
  return { contract, query, ids, sourceMap, gpcrdbMap };
}
async function responseBytes(response, maximum) {
  ok(response.body, "RCSB GraphQL response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    ok(total <= maximum, `RCSB GraphQL response exceeded the ${maximum}-byte cap.`);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
async function fetchBatch({ batch, repeat, contract, query, fetchImpl, now }) {
  const body = `${JSON.stringify({ query, variables: { ids: batch.ids } })}\n`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), contract.rcsb.timeoutMilliseconds);
  const startedUtc = now();
  try {
    const response = await fetchImpl(contract.rcsb.endpoint, {
      method: contract.rcsb.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": contract.rcsb.userAgent,
      },
      body,
      redirect: "follow",
      signal: controller.signal,
    });
    ok(response.ok, `RCSB GraphQL batch ${batch.batchIndex} repeat ${repeat} returned HTTP ${response.status}.`);
    const payload = await responseBytes(response, contract.rcsb.maximumResponseBytes);
    const finalUrl = response.url || contract.rcsb.endpoint;
    ok(contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !finalUrl.toLowerCase().includes(fragment.toLowerCase())), `RCSB GraphQL redirected to a forbidden URL class: ${finalUrl}`);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    clean(rawFile(batch.batchIndex, repeat), decoded);
    return {
      payload,
      decoded,
      record: {
        batchIndex: batch.batchIndex,
        repeat,
        requestedIds: batch.ids,
        requestedIdentifierListSha256: batch.identifierListSha256,
        requestBodySha256: sha256(Buffer.from(body)),
        requestedUrl: contract.rcsb.endpoint,
        finalUrl,
        method: contract.rcsb.method,
        startedUtc,
        completedUtc: now(),
        status: response.status,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        bytes: payload.byteLength,
        sha256: sha256(payload),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
async function put(root, relative, value) {
  const file = path.resolve(root, relative);
  const relativeCheck = path.relative(root, file);
  ok(relativeCheck && !relativeCheck.startsWith("..") && !path.isAbsolute(relativeCheck), `Unsafe entry-metadata snapshot path: ${relative}`);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  clean(relative, decoded);
  await writeFile(file, payload, { flag: "wx" });
}
async function listFiles(root, current = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) result.push(...await listFiles(root, relative));
    else result.push(relative);
  }
  return byteSort(result);
}
async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function summarize(entries, triageRows, entities) {
  const strata = Object.fromEntries(["DIRECT_TARGET_CANDIDATE_REVIEW", "AUXILIARY_OR_CONSTRUCT_REVIEW", "METADATA_RESOLUTION_REQUIRED"].map((key) => [key, 0]));
  for (const row of triageRows) strata[row.reviewStratum] += 1;
  return {
    sourceEntries: entries.length,
    polymerEntities: entities.length,
    entriesWithUniquePreferredReceptorAuthChain: entries.filter((entry) => entry.receptorMapping.preferredAuthChainEntityIds.length === 1).length,
    entriesWithVhhLikeEntitySignal: entries.filter((entry) => entry.metadataSignals.vhhLikeEntityIds.length > 0).length,
    entriesWithBothReceptorAndVhhSignals: entries.filter((entry) => entry.receptorMapping.preferredAuthChainEntityIds.length === 1 && entry.metadataSignals.vhhLikeEntityIds.length > 0).length,
    entriesWithPrimaryCitationIdentifier: entries.filter((entry) => entry.metadataCompleteness.primaryCitationIdentified).length,
    entriesWithAllPolymerSequences: entries.filter((entry) => entry.metadataCompleteness.allPolymerSequencesPresent).length,
    entriesWithAuxiliaryLexicalSignal: triageRows.filter((row) => row.reasons.includes("AUXILIARY_BINDER_LEXICAL_SIGNAL")).length,
    entriesWithConstructRiskSignal: triageRows.filter((row) => row.reasons.includes("ENGINEERED_CONSTRUCT_LEXICAL_SIGNAL")).length,
    entriesWithGpcrdbSignallingComplex: triageRows.filter((row) => row.reasons.includes("GPCRDB_SIGNALLING_COMPLEX_PRESENT")).length,
    reviewStrata: strata,
    pendingDispositionRows: entries.length,
    formallyClearedGroups: 0,
    targetFreezePermitted: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  };
}

export async function collectEntryMetadata({ repositoryRoot = ROOT, outputDirectory, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), delay = sleep } = {}) {
  ok(outputDirectory && typeof fetchImpl === "function", "Output directory and fetch implementation are required.");
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const output = path.resolve(outputDirectory);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const { contract, query, ids, sourceMap, gpcrdbMap } = await readContext(root);
  const batches = batchPlan(ids, contract.rcsb.batchSize);
  ok(batches.length === contract.rcsb.expectedBatchCount, "Derived entry-metadata batch count drifted.");
  const collectionStartedUtc = now();
  const requests = [];
  const entries = [];
  await put(output, "batch-plan.json", `${JSON.stringify({ schemaVersion: "1.0.0", sourceIdentifierCount: ids.length, sourceIdentifierListSha256: contract.input.sourceIdentifierListSha256, batchSize: contract.rcsb.batchSize, batchCount: batches.length, repeatCount: contract.rcsb.repeatCount, batches }, null, 2)}\n`);

  for (const batch of batches) {
    const normalizedRepeats = [];
    for (let repeat = 1; repeat <= contract.rcsb.repeatCount; repeat += 1) {
      const response = await fetchBatch({ batch, repeat, contract, query, fetchImpl, now });
      const file = rawFile(batch.batchIndex, repeat);
      await put(output, file, response.payload);
      const normalized = parseGraphqlResponse(response.decoded, batch, sourceMap, gpcrdbMap, contract);
      const normalizedText = jsonl(normalized);
      normalizedRepeats.push(normalizedText);
      requests.push({ ...response.record, rawFile: file, normalizedEntryCount: normalized.length, normalizedEntriesSha256: sha256(Buffer.from(normalizedText)) });
      if (contract.rcsb.minimumDelayMilliseconds > 0) await delay(contract.rcsb.minimumDelayMilliseconds);
    }
    ok(normalizedRepeats.every((payload) => payload === normalizedRepeats[0]), `Normalized RCSB entry metadata repeat disagreement for batch ${batch.batchIndex}.`);
    entries.push(...parseJsonl(normalizedRepeats[0], `normalized batch ${batch.batchIndex}`));
  }

  entries.sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  ok(entries.length === ids.length && JSON.stringify(entries.map((entry) => entry.pdbId)) === JSON.stringify(ids), "Combined entry metadata does not reconcile to the exact source universe.");
  const entities = entries.flatMap((entry) => entry.polymerEntities.map((entity) => ({ pdbId: entry.pdbId, ...entity }))).sort((left, right) => byteCompare(`${left.pdbId}\0${left.entityId}`, `${right.pdbId}\0${right.entityId}`));
  const triageRows = entries.map((entry) => deriveTriage(entry, contract));
  const summary = summarize(entries, triageRows, entities);
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: contract.studyId,
    stage: contract.stage,
    status: "ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS",
    contractPath: CONTRACT_PATH,
    contractSha256: sha256(await readFile(path.join(root, CONTRACT_PATH))),
    queryPath: contract.rcsb.queryFile,
    querySha256: contract.rcsb.querySha256,
    sourceSnapshotDirectory: contract.input.sourceSnapshotDirectory,
    sourceIdentifierCount: ids.length,
    sourceIdentifierListSha256: contract.input.sourceIdentifierListSha256,
    collectionStartedUtc,
    collectionCompletedUtc: now(),
    batchSize: contract.rcsb.batchSize,
    batchCount: batches.length,
    repeatCount: contract.rcsb.repeatCount,
    requests,
    normalized: {
      entries: { count: entries.length, sha256: sha256(Buffer.from(jsonl(entries))) },
      entities: { count: entities.length, sha256: sha256(Buffer.from(jsonl(entities))) },
      triageSignals: { count: triageRows.length, sha256: sha256(Buffer.from(jsonl(triageRows))) },
    },
    summary,
    metadataTriageStatus: contract.triage.status,
    dispositionLedgerComplete: false,
    leakageGraphComplete: false,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    prelabelSealCreated: false,
    userApproved: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    performanceResultsAccessed: false,
  };
  await put(output, "entries.jsonl", jsonl(entries));
  await put(output, "entities.jsonl", jsonl(entities));
  await put(output, "triage-signals.jsonl", jsonl(triageRows));
  await put(output, "requests.jsonl", jsonl(requests));
  await put(output, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  await put(output, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await put(output, "summary.md", [
    "# ConfoVHH hard-decoy v3 entry-metadata snapshot",
    "",
    "Status: **ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS**",
    "",
    `- Exact source entries: ${summary.sourceEntries}`,
    `- Polymer entities: ${summary.polymerEntities}`,
    `- Unique preferred-receptor auth-chain mappings: ${summary.entriesWithUniquePreferredReceptorAuthChain}`,
    `- Entries with a VHH-like polymer-entity signal: ${summary.entriesWithVhhLikeEntitySignal}`,
    `- Entries with both receptor-chain and VHH-like signals: ${summary.entriesWithBothReceptorAndVhhSignals}`,
    `- Direct-target candidate review stratum: ${summary.reviewStrata.DIRECT_TARGET_CANDIDATE_REVIEW}`,
    `- Auxiliary/construct review stratum: ${summary.reviewStrata.AUXILIARY_OR_CONSTRUCT_REVIEW}`,
    `- Metadata-resolution-required stratum: ${summary.reviewStrata.METADATA_RESOLUTION_REQUIRED}`,
    "",
    "These are metadata-only review signals, not scientific dispositions. All entries remain pending source-backed direct-interface, construct, publication, sequence-cluster/parent, receptor-cluster, and annotation-epitope review.",
    "",
    "No holdout coordinate, native relative receptor–VHH pose, DockQ/CAPRI label, ConfoVHH holdout score, or performance result was accessed.",
    "",
  ].join("\n"));

  const expectedBeforeChecksums = expectedFiles(contract).filter((file) => file !== "checksums.sha256");
  ok(JSON.stringify(await listFiles(output)) === JSON.stringify(expectedBeforeChecksums), "Entry-metadata output inventory drifted before checksum creation.");
  const checksumRows = await Promise.all(expectedBeforeChecksums.map(async (file) => `${sha256(await readFile(path.join(output, file)))}  ${file}`));
  await put(output, "checksums.sha256", `${checksumRows.join("\n")}\n`);
  return { ...await verifyEntryMetadataSnapshot({ repositoryRoot: root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifyEntryMetadataSnapshot({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "An entry-metadata snapshot directory is required.");
  const root = await realpath(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(root === path.resolve(repositoryRoot) && snapshot === path.resolve(snapshotDirectory), "Repository or entry-metadata snapshot path contains symlinked ancestors.");
  const { contract, query, ids, sourceMap, gpcrdbMap } = await readContext(root);
  const expected = expectedFiles(contract);
  ok(JSON.stringify(await listFiles(snapshot)) === JSON.stringify(expected), "Entry-metadata snapshot does not match the exact file allowlist.");

  const checksumText = await readFile(path.join(snapshot, "checksums.sha256"), "utf8");
  clean("entry metadata checksums.sha256", checksumText);
  ok(checksumText.endsWith("\n"), "Entry-metadata checksums must end with LF.");
  const covered = new Map();
  for (const row of checksumText.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    ok(match && !covered.has(match[2]), `Invalid or duplicate entry-metadata checksum row: ${row}`);
    const file = path.join(snapshot, match[2]);
    const info = await lstat(file, { bigint: true });
    ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `Entry-metadata snapshot file must be direct and unaliased: ${match[2]}`);
    const payload = await readFile(file);
    ok(payload.byteLength <= contract.rcsb.maximumResponseBytes, `Entry-metadata snapshot file exceeds byte cap: ${match[2]}`);
    ok(sha256(payload) === match[1], `Entry-metadata checksum mismatch: ${match[2]}`);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    clean(match[2], decoded);
    covered.set(match[2], decoded);
  }
  ok(JSON.stringify(byteSort([...covered.keys()])) === JSON.stringify(expected.filter((file) => file !== "checksums.sha256")), "Entry-metadata checksum coverage is incomplete.");

  const plan = JSON.parse(covered.get("batch-plan.json"));
  const batches = batchPlan(ids, contract.rcsb.batchSize);
  ok(plan.sourceIdentifierCount === ids.length && plan.sourceIdentifierListSha256 === contract.input.sourceIdentifierListSha256 && plan.batchSize === contract.rcsb.batchSize && plan.batchCount === batches.length && plan.repeatCount === contract.rcsb.repeatCount, "Entry-metadata batch plan header drifted.");
  ok(JSON.stringify(plan.batches) === JSON.stringify(batches), "Entry-metadata batch plan rows drifted.");

  const reconstructedEntries = [];
  const reconstructedRequests = [];
  for (const batch of batches) {
    const repeats = [];
    for (let repeat = 1; repeat <= contract.rcsb.repeatCount; repeat += 1) {
      const file = rawFile(batch.batchIndex, repeat);
      const payload = covered.get(file);
      const normalized = parseGraphqlResponse(payload, batch, sourceMap, gpcrdbMap, contract);
      const normalizedText = jsonl(normalized);
      repeats.push(normalizedText);
      reconstructedRequests.push({ batchIndex: batch.batchIndex, repeat, rawFile: file, rawSha256: sha256(Buffer.from(payload)), normalizedEntriesSha256: sha256(Buffer.from(normalizedText)), normalizedEntryCount: normalized.length });
    }
    ok(repeats.every((payload) => payload === repeats[0]), `Normalized RCSB entry metadata repeat disagreement in snapshot for batch ${batch.batchIndex}.`);
    reconstructedEntries.push(...parseJsonl(repeats[0], `reconstructed batch ${batch.batchIndex}`));
  }
  reconstructedEntries.sort((left, right) => byteCompare(left.pdbId, right.pdbId));
  const entries = parseJsonl(covered.get("entries.jsonl"), "entries.jsonl");
  ok(covered.get("entries.jsonl") === jsonl(entries), "entries.jsonl is not canonical JSONL.");
  ok(jsonl(entries) === jsonl(reconstructedEntries), "entries.jsonl does not reconstruct from the repeated raw RCSB responses.");
  ok(JSON.stringify(entries.map((entry) => entry.pdbId)) === JSON.stringify(ids), "Entry metadata rows do not reconcile to the exact source universe.");

  const entities = parseJsonl(covered.get("entities.jsonl"), "entities.jsonl");
  const expectedEntities = entries.flatMap((entry) => entry.polymerEntities.map((entity) => ({ pdbId: entry.pdbId, ...entity }))).sort((left, right) => byteCompare(`${left.pdbId}\0${left.entityId}`, `${right.pdbId}\0${right.entityId}`));
  ok(covered.get("entities.jsonl") === jsonl(entities) && jsonl(entities) === jsonl(expectedEntities), "entities.jsonl does not reconcile to entries.jsonl.");

  const triageRows = parseJsonl(covered.get("triage-signals.jsonl"), "triage-signals.jsonl");
  const expectedTriage = entries.map((entry) => deriveTriage(entry, contract));
  ok(covered.get("triage-signals.jsonl") === jsonl(triageRows) && jsonl(triageRows) === jsonl(expectedTriage), "triage-signals.jsonl does not deterministically derive from entries.jsonl.");
  for (const row of triageRows) {
    ok(row.directInterfaceEvidenceStatus === "UNRESOLVED" && row.dispositionStatus === "PENDING_DISPOSITION" && row.nativeCoordinatesInspected === false, `${row.pdbId} triage row improperly claims a scientific disposition or coordinate access.`);
  }

  const requests = parseJsonl(covered.get("requests.jsonl"), "requests.jsonl");
  ok(requests.length === contract.snapshot.rawResponseCount, "Entry-metadata request ledger count drifted.");
  for (const reconstructed of reconstructedRequests) {
    const matches = requests.filter((row) => row.batchIndex === reconstructed.batchIndex && row.repeat === reconstructed.repeat && row.rawFile === reconstructed.rawFile);
    ok(matches.length === 1, `Entry-metadata request ledger lacks one exact row for batch ${reconstructed.batchIndex} repeat ${reconstructed.repeat}.`);
    const row = matches[0];
    ok(row.sha256 === reconstructed.rawSha256 && row.normalizedEntriesSha256 === reconstructed.normalizedEntriesSha256 && row.normalizedEntryCount === reconstructed.normalizedEntryCount, `Entry-metadata request ledger digest drifted for ${reconstructed.rawFile}.`);
  }

  const summary = summarize(entries, triageRows, entities);
  ok(JSON.stringify(JSON.parse(covered.get("summary.json"))) === JSON.stringify(summary), "Entry-metadata summary.json drifted from the normalized rows.");
  const manifest = JSON.parse(covered.get("manifest.json"));
  ok(manifest.studyId === contract.studyId && manifest.stage === contract.stage && manifest.status === "ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS", "Entry-metadata manifest identity or status drifted.");
  ok(manifest.contractSha256 === sha256(await readFile(path.join(root, CONTRACT_PATH))) && manifest.querySha256 === sha256(Buffer.from(query)), "Entry-metadata manifest contract/query binding drifted.");
  ok(manifest.sourceIdentifierCount === ids.length && manifest.sourceIdentifierListSha256 === contract.input.sourceIdentifierListSha256 && manifest.batchCount === batches.length && manifest.repeatCount === contract.rcsb.repeatCount, "Entry-metadata manifest source or batch binding drifted.");
  ok(manifest.requests.length === requests.length && jsonl(manifest.requests) === jsonl(requests), "Entry-metadata manifest request ledger drifted.");
  ok(manifest.normalized.entries.sha256 === sha256(Buffer.from(jsonl(entries))) && manifest.normalized.entities.sha256 === sha256(Buffer.from(jsonl(entities))) && manifest.normalized.triageSignals.sha256 === sha256(Buffer.from(jsonl(triageRows))), "Entry-metadata manifest normalized digest drifted.");
  ok(JSON.stringify(manifest.summary) === JSON.stringify(summary) && manifest.metadataTriageStatus === "NON_DISPOSITIVE_METADATA_SIGNALS_ONLY", "Entry-metadata manifest summary or triage status drifted.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    ok(manifest[field] === false, `Entry-metadata manifest blocked-state field drifted: ${field}`);
  }
  return {
    status: manifest.status,
    sourceEntries: entries.length,
    polymerEntities: entities.length,
    repeatedRawResponses: requests.length,
    entriesWithUniquePreferredReceptorAuthChain: summary.entriesWithUniquePreferredReceptorAuthChain,
    entriesWithVhhLikeEntitySignal: summary.entriesWithVhhLikeEntitySignal,
    entriesWithBothReceptorAndVhhSignals: summary.entriesWithBothReceptorAndVhhSignals,
    reviewStrata: summary.reviewStrata,
    pendingDispositionRows: entries.length,
    formallyClearedGroups: 0,
    targetFreezePermitted: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
    executionAuthorized: false,
  };
}

export { batchPlan, canonical, deriveTriage, expectedFiles, normalizeEntry, parseGraphqlResponse, rawFile };

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory, rootArg] = process.argv.slice(2);
  try {
    ok(["collect", "verify"].includes(command) && directory, "Usage: v3-entry-metadata.mjs collect|verify <directory> [repository-root]");
    const repositoryRoot = rootArg ? path.resolve(rootArg) : ROOT;
    const result = command === "collect"
      ? await collectEntryMetadata({ repositoryRoot, outputDirectory: path.resolve(directory) })
      : await verifyEntryMetadataSnapshot({ repositoryRoot, snapshotDirectory: path.resolve(directory) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
