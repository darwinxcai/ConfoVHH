import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyV3EntryMetadataContracts } from "./verify-v3-entry-metadata-contracts.mjs";
import { parseStrictJson } from "./oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_PATH = "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json";
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEY = /(?:^|[_-])(?:[xyz]|atom[_-]?site|cartn[_-]?[xyz]|cartesian[_-]?[xyz]|coordinates?|dockq|fnat|rmsd|[il]rmsd|interface[_-]?rmsd|ligand[_-]?rmsd|capri(?:class|label)?|native[_-]?(?:pose|interface)|relative[_-]?(?:pose|interface)|confovhh[_-]?(?:score|rank)|performance[_-]?results?)(?:$|[_-])/iu;
const FALSE_SENTINELS = new Set(["nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "nativeCoordinatesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
const MAX_SCAN_DEPTH = 64;
const MAX_SCAN_NODES = 500_000;
const MAX_BASE64_BYTES = 1024 * 1024;
const MAX_INVENTORY_FILES = 128;
const MAX_CHECKSUM_BYTES = 1024 * 1024;
const MAX_JSON_CHARACTERS = 16 * 1024 * 1024;

function ok(value, message) {
  if (!value) throw new Error(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function parseMetadataJson(name, text, maximumCharacters = MAX_JSON_CHARACTERS) {
  try {
    return parseStrictJson(text, {
      maximumCharacters,
      maximumTokens: MAX_SCAN_NODES,
      maximumDepth: MAX_SCAN_DEPTH,
    });
  } catch (error) {
    throw new Error(`${name} failed strict JSON validation: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function inspectEncodedString(name, value, state, depth) {
  const candidate = value.trim();
  if (candidate.length < 24 || candidate.length > MAX_BASE64_BYTES * 2 || !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(candidate)) return;
  const unpadded = candidate.replace(/-/gu, "+").replace(/_/gu, "/").replace(/=+$/u, "");
  if (unpadded.length % 4 === 1) return;
  const encoded = `${unpadded}${"=".repeat((4 - (unpadded.length % 4)) % 4)}`;
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength > MAX_BASE64_BYTES || decoded.toString("base64").replace(/=+$/u, "") !== unpadded) return;
  let decodedText;
  try { decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decoded); }
  catch { return; }
  ok(!COORD.test(decodedText), `Coordinate payload appeared in ${name} after base64 decoding.`);
  ok(!LABEL.test(decodedText), `Observed holdout-label assignment appeared in ${name} after base64 decoding.`);
  const trimmed = decodedText.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    scanValue(name, parseMetadataJson(`${name} decoded metadata`, trimmed, MAX_BASE64_BYTES), state, depth + 1);
  }
}
function scanValue(name, value, state, depth) {
  ok(depth <= MAX_SCAN_DEPTH, `Metadata nesting exceeded the ${MAX_SCAN_DEPTH}-level cap in ${name}.`);
  state.nodes += 1;
  ok(state.nodes <= MAX_SCAN_NODES, `Metadata node count exceeded the ${MAX_SCAN_NODES}-node cap in ${name}.`);
  if (typeof value === "string") {
    ok(!COORD.test(value), `Coordinate payload appeared in ${name}.`);
    ok(!LABEL.test(value), `Observed holdout-label assignment appeared in ${name}.`);
    inspectEncodedString(name, value, state, depth);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanValue(name, item, state, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FALSE_SENTINELS.has(key)) ok(item === false, `Forbidden-access sentinel must remain false in ${name}: ${key}`);
    else {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
      ok(!FORBIDDEN_KEY.test(normalizedKey), `Forbidden coordinate- or label-like JSON key appeared in ${name}: ${key}`);
    }
    scanValue(name, item, state, depth + 1);
  }
}
function clean(name, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${name}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${name}.`);
  ok(!LABEL.test(text), `Observed holdout-label assignment appeared in ${name}.`);
  const state = { nodes: 0 };
  if (name.endsWith(".json")) scanValue(name, parseMetadataJson(name, text), state, 0);
  else if (name.endsWith(".jsonl") && text.length) {
    ok(text.endsWith("\n"), `${name} must end with LF.`);
    for (const [index, line] of text.trimEnd().split("\n").entries()) {
      scanValue(name, parseMetadataJson(`${name} row ${index + 1}`, line), state, 0);
    }
  }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function requireObject(value, label) {
  ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value;
}
function requireAllowedKeys(value, allowed, required, label) {
  const object = requireObject(value, label);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(object).filter((key) => !allowedSet.has(key));
  ok(!unexpected.length, `${label} contains unexpected fields: ${unexpected.join(", ")}`);
  for (const key of required) ok(Object.hasOwn(object, key), `${label} is missing required field: ${key}`);
  return object;
}
function requireNullableString(value, label) {
  ok(value === null || typeof value === "string", `${label} must be a string or null.`);
}
function requireStringArrayOrNull(value, label) {
  if (value === null) return;
  ok(Array.isArray(value) && value.every((item) => typeof item === "string"), `${label} must be an array of strings or null.`);
}
function validateGraphqlEntity(value, entryIndex, entityIndex) {
  const label = `RCSB GraphQL entry ${entryIndex + 1} polymer entity ${entityIndex + 1}`;
  const entity = requireAllowedKeys(value,
    ["entity_poly", "rcsb_entity_source_organism", "rcsb_id", "rcsb_polymer_entity", "rcsb_polymer_entity_container_identifiers"],
    ["entity_poly", "rcsb_entity_source_organism", "rcsb_id", "rcsb_polymer_entity", "rcsb_polymer_entity_container_identifiers"], label);
  ok(typeof entity.rcsb_id === "string", `${label}.rcsb_id must be a string.`);
  if (entity.entity_poly !== null) {
    const polymer = requireAllowedKeys(entity.entity_poly, ["pdbx_seq_one_letter_code_can", "rcsb_entity_polymer_type", "type"], ["pdbx_seq_one_letter_code_can", "rcsb_entity_polymer_type", "type"], `${label}.entity_poly`);
    for (const key of Object.keys(polymer)) requireNullableString(polymer[key], `${label}.entity_poly.${key}`);
  }
  if (entity.rcsb_polymer_entity !== null) {
    const description = requireAllowedKeys(entity.rcsb_polymer_entity, ["pdbx_description"], ["pdbx_description"], `${label}.rcsb_polymer_entity`);
    requireNullableString(description.pdbx_description, `${label}.rcsb_polymer_entity.pdbx_description`);
  }
  if (entity.rcsb_polymer_entity_container_identifiers !== null) {
    const identifiers = requireAllowedKeys(entity.rcsb_polymer_entity_container_identifiers,
      ["asym_ids", "auth_asym_ids", "entity_id", "reference_sequence_identifiers"],
      ["asym_ids", "auth_asym_ids", "entity_id", "reference_sequence_identifiers"], `${label}.rcsb_polymer_entity_container_identifiers`);
    requireNullableString(identifiers.entity_id, `${label}.rcsb_polymer_entity_container_identifiers.entity_id`);
    requireStringArrayOrNull(identifiers.asym_ids, `${label}.rcsb_polymer_entity_container_identifiers.asym_ids`);
    requireStringArrayOrNull(identifiers.auth_asym_ids, `${label}.rcsb_polymer_entity_container_identifiers.auth_asym_ids`);
    if (identifiers.reference_sequence_identifiers !== null) {
      ok(Array.isArray(identifiers.reference_sequence_identifiers), `${label}.reference_sequence_identifiers must be an array or null.`);
      for (const [referenceIndex, reference] of identifiers.reference_sequence_identifiers.entries()) {
        const referenceLabel = `${label}.reference_sequence_identifiers[${referenceIndex}]`;
        const normalized = requireAllowedKeys(reference, ["database_accession", "database_name", "provenance_source"], ["database_accession", "database_name", "provenance_source"], referenceLabel);
        for (const key of Object.keys(normalized)) requireNullableString(normalized[key], `${referenceLabel}.${key}`);
      }
    }
  }
  if (entity.rcsb_entity_source_organism !== null) {
    ok(Array.isArray(entity.rcsb_entity_source_organism), `${label}.rcsb_entity_source_organism must be an array or null.`);
    for (const [organismIndex, organism] of entity.rcsb_entity_source_organism.entries()) {
      const organismLabel = `${label}.rcsb_entity_source_organism[${organismIndex}]`;
      const normalized = requireAllowedKeys(organism, ["ncbi_scientific_name", "ncbi_taxonomy_id"], ["ncbi_scientific_name", "ncbi_taxonomy_id"], organismLabel);
      requireNullableString(normalized.ncbi_scientific_name, `${organismLabel}.ncbi_scientific_name`);
      ok(normalized.ncbi_taxonomy_id === null || Number.isSafeInteger(normalized.ncbi_taxonomy_id), `${organismLabel}.ncbi_taxonomy_id must be a safe integer or null.`);
    }
  }
}
function validateGraphqlEntry(value, entryIndex) {
  const label = `RCSB GraphQL entry ${entryIndex + 1}`;
  const entry = requireAllowedKeys(value,
    ["exptl", "polymer_entities", "rcsb_accession_info", "rcsb_entry_info", "rcsb_id", "rcsb_primary_citation", "struct", "struct_keywords"],
    ["exptl", "polymer_entities", "rcsb_accession_info", "rcsb_entry_info", "rcsb_id", "rcsb_primary_citation", "struct", "struct_keywords"], label);
  ok(typeof entry.rcsb_id === "string", `${label}.rcsb_id must be a string.`);
  for (const [field, keys] of [
    ["struct", ["title"]],
    ["struct_keywords", ["pdbx_keywords", "text"]],
    ["rcsb_accession_info", ["initial_release_date"]],
    ["rcsb_primary_citation", ["pdbx_database_id_DOI", "pdbx_database_id_PubMed", "title"]],
  ]) {
    if (entry[field] === null) continue;
    const normalized = requireAllowedKeys(entry[field], keys, keys, `${label}.${field}`);
    for (const key of keys) {
      if (field === "rcsb_primary_citation" && key === "pdbx_database_id_PubMed") {
        ok(normalized[key] === null || Number.isSafeInteger(normalized[key]), `${label}.${field}.${key} must be a safe integer or null.`);
      } else requireNullableString(normalized[key], `${label}.${field}.${key}`);
    }
  }
  if (entry.exptl !== null) {
    ok(Array.isArray(entry.exptl), `${label}.exptl must be an array or null.`);
    for (const [index, row] of entry.exptl.entries()) {
      const normalized = requireAllowedKeys(row, ["method"], ["method"], `${label}.exptl[${index}]`);
      requireNullableString(normalized.method, `${label}.exptl[${index}].method`);
    }
  }
  if (entry.rcsb_entry_info !== null) {
    const info = requireAllowedKeys(entry.rcsb_entry_info, ["experimental_method", "polymer_entity_count", "resolution_combined"], ["experimental_method", "polymer_entity_count", "resolution_combined"], `${label}.rcsb_entry_info`);
    requireNullableString(info.experimental_method, `${label}.rcsb_entry_info.experimental_method`);
    ok(info.polymer_entity_count === null || Number.isSafeInteger(info.polymer_entity_count), `${label}.rcsb_entry_info.polymer_entity_count must be a safe integer or null.`);
    ok(info.resolution_combined === null || (Array.isArray(info.resolution_combined) && info.resolution_combined.every((item) => typeof item === "number" && Number.isFinite(item))), `${label}.rcsb_entry_info.resolution_combined must be finite numbers or null.`);
  }
  ok(Array.isArray(entry.polymer_entities), `${label}.polymer_entities must be an array.`);
  entry.polymer_entities.forEach((entity, entityIndex) => validateGraphqlEntity(entity, entryIndex, entityIndex));
}
function validateGraphqlEnvelope(value, batchIndex) {
  const envelope = requireAllowedKeys(value, ["data", "errors"], ["data"], `RCSB GraphQL response for batch ${batchIndex}`);
  if (Object.hasOwn(envelope, "errors")) ok(Array.isArray(envelope.errors), `RCSB GraphQL errors for batch ${batchIndex} must be an array.`);
  const data = requireAllowedKeys(envelope.data, ["entries"], ["entries"], `RCSB GraphQL data for batch ${batchIndex}`);
  ok(Array.isArray(data.entries), `RCSB GraphQL response lacks entries for batch ${batchIndex}.`);
  data.entries.forEach((entry, entryIndex) => validateGraphqlEntry(entry, entryIndex));
  return envelope;
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
  return payload.trimEnd().split("\n").map((line, index) => parseMetadataJson(`${label}:${index + 1}`, line));
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
    signallingProtein: row.signalling_protein === undefined ? null : parseMetadataJson("canonical GPCRdb signalling-protein metadata", canonical(row.signalling_protein)),
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
  const result = validateGraphqlEnvelope(parseMetadataJson(`RCSB GraphQL response for batch ${batch.batchIndex}`, payload, contract.rcsb.maximumResponseBytes), batch.batchIndex);
  ok(!result.errors?.length, `RCSB GraphQL returned errors for batch ${batch.batchIndex}: ${canonical(result.errors ?? [])}`);
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
async function readBoundedDirect(file, label, maximum) {
  const info = await lstat(file, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct, unaliased regular file.`);
  ok(info.size <= BigInt(maximum), `${label} exceeds the ${maximum}-byte cap.`);
  const payload = await readFile(file);
  ok(payload.byteLength <= maximum, `${label} exceeds the ${maximum}-byte cap after read.`);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  const extension = path.extname(file);
  clean(extension && !label.endsWith(extension) ? `${label}${extension}` : label, decoded);
  return { payload, decoded };
}
async function readContext(root) {
  await verifyV3EntryMetadataContracts(root);
  const contractFile = await readBoundedDirect(path.join(root, CONTRACT_PATH), "entry-metadata contract", 2 * 1024 * 1024);
  const contract = parseMetadataJson("entry-metadata contract", contractFile.decoded, 2 * 1024 * 1024);
  const queryFile = await readBoundedDirect(path.join(root, contract.rcsb.queryFile), "entry-metadata GraphQL query", 2 * 1024 * 1024);
  const query = queryFile.decoded;
  ok(sha256(queryFile.payload) === contract.rcsb.querySha256, "Entry-metadata query changed after contract verification.");
  const sourceDirectory = path.join(root, contract.input.sourceSnapshotDirectory);
  const identifierFile = await readBoundedDirect(path.join(sourceDirectory, contract.input.sourceIdentifierListFile), "source identifier list", 1024 * 1024);
  const idText = identifierFile.decoded;
  ok(sha256(identifierFile.payload) === contract.input.sourceIdentifierListSha256, "Source identifier list changed after source-universe verification.");
  const ids = idText.trimEnd().split("\n");
  const universeFile = await readBoundedDirect(path.join(sourceDirectory, contract.input.sourceUniverseFile), "source-universe", contract.rcsb.maximumResponseBytes);
  ok(sha256(universeFile.payload) === contract.input.sourceUniverseJsonlSha256, "Source universe changed after source-universe verification.");
  const universeRows = parseJsonl(universeFile.decoded, "source-universe.jsonl");
  const sourceMap = new Map(universeRows.map((row) => [row.pdbId, row]));
  const sourceChecksums = await readBoundedDirect(path.join(sourceDirectory, "checksums.sha256"), "source checksums", 1024 * 1024);
  ok(sha256(sourceChecksums.payload) === contract.input.sourceChecksumsSha256, "Source checksum manifest changed after source-universe verification.");
  const gpcrdbChecksumRows = sourceChecksums.decoded.trimEnd().split("\n").map((row) => /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row));
  ok(gpcrdbChecksumRows.every(Boolean), "Source checksum manifest became syntactically invalid after source-universe verification.");
  const gpcrdbChecksum = gpcrdbChecksumRows.filter((row) => row[2] === contract.input.gpcrdbRawFile);
  ok(gpcrdbChecksum.length === 1, "Source checksum manifest does not bind exactly one frozen GPCRdb file.");
  const gpcrdbFile = await readBoundedDirect(path.join(sourceDirectory, contract.input.gpcrdbRawFile), "frozen GPCRdb metadata", contract.rcsb.maximumResponseBytes);
  ok(sha256(gpcrdbFile.payload) === gpcrdbChecksum[0][1], "Frozen GPCRdb metadata changed after source-universe verification.");
  const gpcrdbRows = parseMetadataJson("frozen GPCRdb metadata", gpcrdbFile.decoded, contract.rcsb.maximumResponseBytes);
  const gpcrdbMap = normalizeGpcrdbMap(gpcrdbRows, ids);
  return { contract, contractSha256: sha256(contractFile.payload), query, ids, sourceMap, gpcrdbMap };
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
function requireHttpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`${label} is not a valid URL.`); }
  ok(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash, `${label} must be an uncredentialed HTTPS URL without a fragment.`);
  return parsed;
}
function requireJsonContentType(response, label) {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  ok(["application/json", "application/graphql-response+json"].includes(mediaType), `${label} returned forbidden content type: ${contentType ?? "missing"}`);
  return contentType;
}
async function fetchBatch({ batch, repeat, contract, query, fetchImpl, now }) {
  const body = `${JSON.stringify({ query, variables: { ids: batch.ids } })}\n`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), contract.rcsb.timeoutMilliseconds);
  const startedUtc = now();
  const requested = requireHttpsUrl(contract.rcsb.endpoint, "RCSB GraphQL endpoint");
  try {
    const response = await fetchImpl(contract.rcsb.endpoint, {
      method: contract.rcsb.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": contract.rcsb.userAgent,
      },
      body,
      redirect: "error",
      signal: controller.signal,
    });
    ok(response.ok, `RCSB GraphQL batch ${batch.batchIndex} repeat ${repeat} returned HTTP ${response.status}.`);
    ok(response.redirected !== true, `RCSB GraphQL batch ${batch.batchIndex} repeat ${repeat} redirected; redirects are forbidden.`);
    const finalUrl = response.url || contract.rcsb.endpoint;
    const final = requireHttpsUrl(finalUrl, "RCSB GraphQL final URL");
    ok(final.href === requested.href, "RCSB GraphQL response did not return from the exact pinned endpoint.");
    const contentType = requireJsonContentType(response, `RCSB GraphQL batch ${batch.batchIndex} repeat ${repeat}`);
    const payload = await responseBytes(response, contract.rcsb.maximumResponseBytes);
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
        contentType,
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
async function listFiles(root, current = "", result = []) {
  ok(current.split("/").filter(Boolean).length <= 4, "Entry-metadata directory nesting exceeded the four-level cap.");
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    ok(!entry.isSymbolicLink(), `Entry-metadata inventory contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) await listFiles(root, relative, result);
    else result.push(relative);
    ok(result.length <= MAX_INVENTORY_FILES, `Entry-metadata inventory exceeded the ${MAX_INVENTORY_FILES}-file cap.`);
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
  const outputParent = path.dirname(output);
  ok(await realpath(outputParent) === path.resolve(outputParent), "Output parent cannot contain symlinked ancestors.");
  await mkdir(output, { recursive: false });
  const { contract, contractSha256, query, ids, sourceMap, gpcrdbMap } = await readContext(root);
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
    contractSha256,
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
    "These are metadata-only review signals, not scientific dispositions. All entries remain pending source-backed direct-interface, construct, publication, sequence-cluster/parent, and receptor-cluster review. Annotation-epitope fields are descriptive only; formal epitope independence requires the sealed native-contact oracle selected in HARD_DECOY_PROTOCOL_V3.md.",
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
  const { contract, contractSha256, query, ids, sourceMap, gpcrdbMap } = await readContext(root);
  const expected = expectedFiles(contract);
  ok(JSON.stringify(await listFiles(snapshot)) === JSON.stringify(expected), "Entry-metadata snapshot does not match the exact file allowlist.");

  const expectedPayloads = expected.filter((file) => file !== "checksums.sha256");
  const allowed = new Set(expected);
  async function readAllowed(relative, maximum = contract.rcsb.maximumResponseBytes) {
    ok(allowed.has(relative), `Entry-metadata path is outside the exact allowlist: ${relative}`);
    const file = path.resolve(snapshot, relative);
    ok(path.relative(snapshot, file) === relative, `Entry-metadata path resolution drifted: ${relative}`);
    const info = await lstat(file, { bigint: true });
    ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `Entry-metadata snapshot file must be direct and unaliased: ${relative}`);
    ok(info.size <= BigInt(maximum), `Entry-metadata snapshot file exceeds byte cap: ${relative}`);
    const payload = await readFile(file);
    ok(payload.byteLength <= maximum, `Entry-metadata snapshot file exceeds byte cap after read: ${relative}`);
    return payload;
  }
  const checksumText = new TextDecoder("utf-8", { fatal: true }).decode(await readAllowed("checksums.sha256", MAX_CHECKSUM_BYTES));
  clean("entry metadata checksums.sha256", checksumText);
  ok(checksumText.endsWith("\n"), "Entry-metadata checksums must end with LF.");
  const checksumRows = checksumText.trimEnd().split("\n");
  ok(checksumRows.length === expectedPayloads.length, "Entry-metadata checksum row count does not match the exact allowlist.");
  const parsedChecksums = checksumRows.map((row) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    ok(match, `Invalid entry-metadata checksum row: ${row}`);
    return { digest: match[1], relative: match[2] };
  });
  ok(new Set(parsedChecksums.map(({ relative }) => relative)).size === parsedChecksums.length, "Entry-metadata checksum paths must be unique.");
  ok(JSON.stringify(byteSort(parsedChecksums.map(({ relative }) => relative))) === JSON.stringify(expectedPayloads), "Entry-metadata checksum paths must exactly match the allowlist before payload access.");
  const covered = new Map();
  for (const { digest, relative } of parsedChecksums) {
    const payload = await readAllowed(relative);
    ok(sha256(payload) === digest, `Entry-metadata checksum mismatch: ${relative}`);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    clean(relative, decoded);
    covered.set(relative, decoded);
  }
  ok(JSON.stringify(byteSort([...covered.keys()])) === JSON.stringify(expectedPayloads), "Entry-metadata checksum coverage is incomplete.");

  const plan = parseMetadataJson("batch-plan.json", covered.get("batch-plan.json"));
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
      const requestBody = `${JSON.stringify({ query, variables: { ids: batch.ids } })}\n`;
      repeats.push(normalizedText);
      reconstructedRequests.push({
        batchIndex: batch.batchIndex,
        repeat,
        requestedIds: batch.ids,
        requestedIdentifierListSha256: batch.identifierListSha256,
        requestBodySha256: sha256(Buffer.from(requestBody)),
        requestedUrl: contract.rcsb.endpoint,
        method: contract.rcsb.method,
        status: 200,
        rawFile: file,
        bytes: Buffer.byteLength(payload),
        rawSha256: sha256(Buffer.from(payload)),
        normalizedEntriesSha256: sha256(Buffer.from(normalizedText)),
        normalizedEntryCount: normalized.length,
      });
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
  ok(covered.get("requests.jsonl") === jsonl(requests), "requests.jsonl is not canonical JSONL.");
  ok(requests.length === contract.snapshot.rawResponseCount, "Entry-metadata request ledger count drifted.");
  for (const reconstructed of reconstructedRequests) {
    const matches = requests.filter((row) => row.batchIndex === reconstructed.batchIndex && row.repeat === reconstructed.repeat && row.rawFile === reconstructed.rawFile);
    ok(matches.length === 1, `Entry-metadata request ledger lacks one exact row for batch ${reconstructed.batchIndex} repeat ${reconstructed.repeat}.`);
    const row = matches[0];
    ok(JSON.stringify(row.requestedIds) === JSON.stringify(reconstructed.requestedIds)
      && row.requestedIdentifierListSha256 === reconstructed.requestedIdentifierListSha256
      && row.requestBodySha256 === reconstructed.requestBodySha256,
    `Entry-metadata request mapping drifted for ${reconstructed.rawFile}.`);
    ok(row.requestedUrl === reconstructed.requestedUrl && row.method === reconstructed.method && row.status === reconstructed.status && row.rawFile === reconstructed.rawFile,
      `Entry-metadata request endpoint or status drifted for ${reconstructed.rawFile}.`);
    const requested = requireHttpsUrl(row.requestedUrl, `${reconstructed.rawFile} requested URL`);
    const final = requireHttpsUrl(row.finalUrl, `${reconstructed.rawFile} final URL`);
    ok(final.href === requested.href && row.finalUrl === reconstructed.requestedUrl && contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !row.finalUrl.toLowerCase().includes(fragment.toLowerCase())), `Entry-metadata request escaped the exact pinned HTTPS endpoint for ${reconstructed.rawFile}.`);
    const mediaType = String(row.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
    ok(["application/json", "application/graphql-response+json"].includes(mediaType), `Entry-metadata request has a forbidden content type for ${reconstructed.rawFile}.`);
    const started = Date.parse(row.startedUtc), completed = Date.parse(row.completedUtc);
    ok(Number.isFinite(started) && Number.isFinite(completed) && completed >= started, `Entry-metadata request timestamps are invalid for ${reconstructed.rawFile}.`);
    ok(row.bytes === reconstructed.bytes && row.sha256 === reconstructed.rawSha256 && row.normalizedEntriesSha256 === reconstructed.normalizedEntriesSha256 && row.normalizedEntryCount === reconstructed.normalizedEntryCount, `Entry-metadata request ledger digest drifted for ${reconstructed.rawFile}.`);
    ok(row.etag === null || typeof row.etag === "string", `Entry-metadata ETag is invalid for ${reconstructed.rawFile}.`);
    ok(row.lastModified === null || typeof row.lastModified === "string", `Entry-metadata Last-Modified is invalid for ${reconstructed.rawFile}.`);
  }

  const summary = summarize(entries, triageRows, entities);
  ok(JSON.stringify(parseMetadataJson("summary.json", covered.get("summary.json"))) === JSON.stringify(summary), "Entry-metadata summary.json drifted from the normalized rows.");
  const manifest = parseMetadataJson("manifest.json", covered.get("manifest.json"));
  ok(manifest.schemaVersion === "1.0.0" && manifest.studyId === contract.studyId && manifest.stage === contract.stage && manifest.status === "ENTRY_METADATA_CAPTURED_BLOCKED_PENDING_SCIENTIFIC_DISPOSITIONS", "Entry-metadata manifest identity or status drifted.");
  ok(manifest.contractSha256 === contractSha256 && manifest.querySha256 === sha256(Buffer.from(query)), "Entry-metadata manifest contract/query binding drifted.");
  ok(manifest.contractPath === CONTRACT_PATH && manifest.queryPath === contract.rcsb.queryFile && manifest.sourceSnapshotDirectory === contract.input.sourceSnapshotDirectory, "Entry-metadata manifest core provenance paths drifted.");
  ok(manifest.sourceIdentifierCount === ids.length && manifest.sourceIdentifierListSha256 === contract.input.sourceIdentifierListSha256 && manifest.batchSize === contract.rcsb.batchSize && manifest.batchCount === batches.length && manifest.repeatCount === contract.rcsb.repeatCount, "Entry-metadata manifest source or batch binding drifted.");
  ok(manifest.requests.length === requests.length && jsonl(manifest.requests) === jsonl(requests), "Entry-metadata manifest request ledger drifted.");
  ok(manifest.normalized.entries.count === entries.length && manifest.normalized.entities.count === entities.length && manifest.normalized.triageSignals.count === triageRows.length
    && manifest.normalized.entries.sha256 === sha256(Buffer.from(jsonl(entries))) && manifest.normalized.entities.sha256 === sha256(Buffer.from(jsonl(entities))) && manifest.normalized.triageSignals.sha256 === sha256(Buffer.from(jsonl(triageRows))), "Entry-metadata manifest normalized count or digest drifted.");
  const collectionStarted = Date.parse(manifest.collectionStartedUtc), collectionCompleted = Date.parse(manifest.collectionCompletedUtc);
  ok(Number.isFinite(collectionStarted) && Number.isFinite(collectionCompleted) && collectionCompleted >= collectionStarted, "Entry-metadata manifest collection timestamps are invalid.");
  ok(requests.every((row) => Date.parse(row.startedUtc) >= collectionStarted && Date.parse(row.completedUtc) <= collectionCompleted), "Entry-metadata request timestamps fall outside the manifest collection interval.");
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
