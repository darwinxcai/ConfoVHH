import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, deriveTriage, parseGraphqlResponse } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const RECENT = `${BASE}/rcsb-recent-discovery-2026-09-04`;
const FROZEN = `${BASE}/source-snapshot-2026-08-29`;
const DEFAULT_OUTPUT = `${BASE}/annotation-discovery-2026-09-04`;
const SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const GRAPHQL = "https://data.rcsb.org/graphql";
const ROWS = 1000, MAX_PAGES = 100, LIMIT = 16 * 1024 * 1024;
const GPCR_DOMAINS = ["PF00001", "PF00002", "PF00003", "PF01534"];
const IG_DOMAINS = [{ accession: "PF07686", name: "Immunoglobulin V-set domain", short: "V-set" }, { accession: "PF00047", name: "Immunoglobulin domain", short: "ig" }];
const NCBI = "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=9835&mode=Info";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (values) => values.length ? `${values.map(canonical).join("\n")}\n` : "";
const idsText = (ids) => ids.length ? `${ids.join("\n")}\n` : "";
const unique = (values) => [...new Set(values)].sort();
const parse = (value) => parseStrictJson(String(value), { maximumCharacters: LIMIT, maximumTokens: 500000, maximumDepth: 64 });
const lines = (value) => String(value).trimEnd().split("\n").filter(Boolean);
const term = (attribute, value) => ({ type: "terminal", service: "text", parameters: { attribute, operator: "exact_match", value } });
export const ANNOTATION_QUERIES = [
  ...GPCR_DOMAINS.map((accession) => ({ id: `gpcr-${accession.toLowerCase()}`, group: "gpcr", accession })),
  ...IG_DOMAINS.map(({ accession }) => ({ id: `ig-${accession.toLowerCase()}`, group: "immunoglobulin", accession })),
  { id: "camelid-lineage-id", group: "camelid", attribute: "rcsb_entity_source_organism.taxonomy_lineage.id", value: "9835" },
  { id: "camelid-lineage-name", group: "camelid", attribute: "rcsb_entity_source_organism.taxonomy_lineage.name", value: "Camelidae" },
];
export function buildAnnotationQuery(definition, start = 0) {
  const query = definition.accession ? { type: "group", logical_operator: "and", nodes: [term("rcsb_polymer_entity_annotation.type", "Pfam"), term("rcsb_polymer_entity_annotation.annotation_id", definition.accession)] } : term(definition.attribute, definition.value);
  return { query, return_type: "entry", request_options: { paginate: { start, rows: ROWS }, results_content_type: ["experimental"], sort: [{ sort_by: "rcsb_id", direction: "asc" }] } };
}
async function exists(filename) { try { await lstat(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function read(filename) { const info = await lstat(filename); assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= LIMIT, `Expected bounded direct file: ${filename}`); return await readFile(filename); }
async function immutable(output, name, bytes) { const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true }); if (await exists(file)) assert((await read(file)).equals(Buffer.from(bytes)), `Immutable file drifted: ${name}`); else await writeFile(file, bytes, { flag: "wx" }); }
async function context(root) {
  const inputDigests = {};
  const input = async (name) => { const bytes = await read(path.join(root, name)); inputDigests[name] = sha(bytes); return bytes; };
  const sourceChecksums = new Map();
  async function covered(directory, name) {
    if (!sourceChecksums.has(directory)) sourceChecksums.set(directory, lines(await input(`${directory}/checksums.sha256`)));
    const bytes = await input(`${directory}/${name}`);
    assert(sourceChecksums.get(directory).includes(`${sha(bytes)}  ${name}`), `Source checksum mismatch: ${directory}/${name}`);
    return bytes;
  }
  const authority = parse(await covered(RECENT, "authority-evidence.json"));
  assert.equal(authority.verified, true);
  // Documentation JSON permits escaped newlines in descriptions; raw bytes are bound.
  const schema = JSON.parse(await covered(RECENT, "raw/rcsb-search-schema.json"));
  const ann = schema.properties.rcsb_polymer_entity_annotation;
  assert.equal(ann.rcsb_nested_indexing, true);
  assert(ann.items.properties.annotation_id.rcsb_search_context.includes("exact-match"));
  assert(ann.items.properties.type.enum.includes("Pfam"));
  const lineage = schema.properties.rcsb_entity_source_organism.items.properties.taxonomy_lineage.items.properties;
  assert.equal(lineage.id.type, "string");
  assert(lineage.id.rcsb_search_context.includes("exact-match") && lineage.name.rcsb_search_context.includes("exact-match"));
  for (const accession of GPCR_DOMAINS) {
    const domain = parse(await covered(RECENT, `raw/domain-${accession.toLowerCase()}.json`)).metadata;
    const evidence = authority.domains.find((row) => row.accession === accession);
    assert(evidence?.verified && domain.accession === accession && domain.name.short === evidence.shortName);
  }
  const frozenIds = new Set(lines(await covered(FROZEN, "normalized/gpcrdb-api.txt")));
  const historicalIds = new Set(lines(await covered(FROZEN, "normalized/rcsb-gpcrdb-intersection.txt")));
  const gpcrdb = parse(await covered(FROZEN, "raw/gpcrdb-api-1.json"));
  const gpcrdbMap = new Map(gpcrdb.map((row) => [row.pdb_code.toUpperCase(), row]));
  const capturedSources = ["entry-metadata-snapshot-2026-08-29", "gpcrdb-complement-metadata-2026-09-04", "gpcrdb-complement-replacements-2026-09-04", "rcsb-recent-discovery-2026-09-04"];
  const capturedIds = new Set(), c2UnionIds = new Set();
  for (const directory of capturedSources) for (const entry of lines(await covered(`${BASE}/${directory}`, "entries.jsonl")).map(parse)) {
    capturedIds.add(entry.pdbId);
    if (directory.startsWith("gpcrdb-complement-")) c2UnionIds.add(entry.pdbId);
  }
  const literature = parse(await input(`${BASE}/publication-accession-review-2026-09-04/priority-reviews.json`));
  const literatureIds = new Set(literature.reviews.flatMap((row) => row.depositedPdbIdsNamedByThisPaper));
  const contractName = `${BASE}/entry-metadata-draft/entry-metadata-contract.json`;
  const contract = parse(await input(contractName));
  const queryBytes = await input(contract.rcsb.queryFile);
  assert.equal(sha(queryBytes), contract.rcsb.querySha256);
  await input("scripts/hard-decoy/v3-entry-metadata.mjs");
  await input("scripts/hard-decoy/oracle/canonical-json.mjs");
  inputDigests["scripts/hard-decoy-v3/capture-annotation-discovery.mjs"] = sha(await read(HERE));
  const plan = { schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", route: "C1_GLOBAL_DOMAIN_AND_SOURCE_TAXONOMY_DISCOVERY", queries: ANNOTATION_QUERIES, rowsPerPage: ROWS, maximumPagesPerQuery: MAX_PAGES, repeatCount: 2, releaseDateRestriction: null, inputDigests, capturedMetadataSources: capturedSources, positiveControlPdbId: "3P0G", gpcrDomainControlPdbIds: { PF00001: "3SN6", PF00002: "7VVN", PF00003: "4OR2", PF01534: "4JKV" }, immunoglobulinDomainControlPdbIds: { PF07686: "1A14", PF00047: "1B6U" }, intersectionUnit: "PDB_ENTRY_ID_ACROSS_SEPARATE_QUERIES", broaderDiscoveryComplete: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED" };
  return { plan, contract, query: String(queryBytes), frozenIds, historicalIds, capturedIds, c2UnionIds, literatureIds, gpcrdbMap };
}
async function inventory(output, prefix = "") { const out = []; for (const row of await readdir(path.join(output, prefix), { withFileTypes: true })) { assert(!row.isSymbolicLink()); const name = path.posix.join(prefix, row.name); if (row.isDirectory()) out.push(...await inventory(output, name)); else { assert(row.isFile()); out.push(name); } } return out.sort(); }
async function fetchRecord(output, name, url, request, fetchImpl, kind = "json") {
  const requestFile = request ? `requests/${name}.json` : null;
  const requestBytes = request ? `${JSON.stringify(request)}\n` : null;
  const specification = { name, url, method: "GET", requestFile, requestSha256: requestBytes ? sha(requestBytes) : null, rawFile: `raw/${name}.${kind === "html" ? "html" : "json"}`, captureFile: `captures/${name}.json` };
  if (requestFile) await immutable(output, requestFile, requestBytes);
  if (await exists(path.join(output, specification.captureFile))) {
    const record = parse(await read(path.join(output, specification.captureFile)));
    assert.equal(canonical(record.specification), canonical(specification), `Request binding drifted: ${name}`);
    const bytes = await read(path.join(output, specification.rawFile));
    assert.equal(record.sha256, sha(bytes)); assert.equal(record.bytes, bytes.length);
    return { record, payload: String(bytes) };
  }
  assert(!await exists(path.join(output, specification.rawFile)), `Unfinished raw capture retained: ${name}`);
  const startedUtc = new Date().toISOString();
  const response = await fetchImpl(url, { headers: { accept: kind === "html" ? "text/html" : "application/json", "user-agent": "ConfoVHH-C1-annotation-discovery/1.0 (+https://github.com/darwinxcai/ConfoVHH)" }, redirect: "error", signal: AbortSignal.timeout(60000) });
  assert(!response.redirected && (!response.url || response.url === url), "Response escaped exact metadata endpoint.");
  const chunks = []; let size = 0;
  if (response.body) for await (const bytes of response.body) { size += bytes.length; assert(size <= LIMIT); chunks.push(Buffer.from(bytes)); }
  const bytes = Buffer.concat(chunks), contentType = response.headers.get("content-type");
  const record = { specification, startedUtc, completedUtc: new Date().toISOString(), status: response.status, finalUrl: response.url || url, contentType, dateHeader: response.headers.get("date"), sha256: sha(bytes), bytes: bytes.length };
  await immutable(output, specification.rawFile, bytes); await immutable(output, specification.captureFile, json(record));
  assert([200, 204].includes(response.status), `HTTP ${response.status}: ${name}`);
  if (response.status !== 204) assert(kind === "html" ? /^text\/html/iu.test(contentType) : /^application\/(?:json|[^;]+\+json)/iu.test(contentType), `Unexpected media type: ${name}`);
  return { record, payload: String(bytes) };
}
export function parseAnnotationSearchPage(status, payload) {
  if (status === 204) { assert.equal(payload, ""); return { ids: [], total: 0 }; }
  assert.equal(status, 200);
  const value = parse(payload);
  assert(Object.keys(value).every((key) => ["query_id", "result_type", "total_count", "result_set"].includes(key)));
  assert.equal(value.result_type, "entry"); assert.equal(typeof value.query_id, "string");
  assert(Number.isSafeInteger(value.total_count) && value.total_count >= 0 && Array.isArray(value.result_set));
  const ids = value.result_set.map((row) => { assert.deepEqual(Object.keys(row).sort(), ["identifier", "score"]); assert(/^[0-9][A-Z0-9]{3}$/u.test(row.identifier) && Number.isFinite(row.score)); return row.identifier; });
  assert.deepEqual(ids, unique(ids)); assert(ids.length <= ROWS && ids.length <= value.total_count);
  return { ids, total: value.total_count };
}
function searchRequest(definition, repeat, page) { const request = buildAnnotationQuery(definition, page * ROWS); return { name: `${definition.id}-repeat-${repeat}-page-${String(page + 1).padStart(3, "0")}`, request, url: `${SEARCH}?json=${encodeURIComponent(JSON.stringify(request))}` }; }
function metadataRequest(ids, batchIndex, repeat, ctx) { const request = { query: ctx.query, variables: { ids } }; return { name: `new-entry-metadata-batch-${String(batchIndex).padStart(3, "0")}-repeat-${repeat}`, request, url: `${GRAPHQL}?query=${encodeURIComponent(ctx.query)}&variables=${encodeURIComponent(JSON.stringify({ ids }))}` }; }
async function existingRecord(output, name, url, request, kind = "json") {
  return await fetchRecord(output, name, url, request, async () => { throw new Error(`Missing archived capture: ${name}`); }, kind);
}
async function authorities(output, fetchImpl) {
  const evidence = [];
  for (const expected of IG_DOMAINS) {
    const url = `https://www.ebi.ac.uk/interpro/api/entry/pfam/${expected.accession}/`;
    const result = await fetchRecord(output, `authority-${expected.accession.toLowerCase()}`, url, null, fetchImpl);
    assert.equal(result.record.status, 200);
    const metadata = parse(result.payload).metadata;
    assert.equal(metadata.accession, expected.accession); assert.equal(metadata.name.name, expected.name); assert.equal(metadata.name.short, expected.short);
    evidence.push({ accession: expected.accession, observedName: metadata.name.name, observedShortName: metadata.name.short, integratedInterProId: metadata.integrated, url, rawSha256: result.record.sha256 });
  }
  const tax = await fetchRecord(output, "authority-camelidae-9835", NCBI, null, fetchImpl, "html");
  assert.equal(tax.record.status, 200);
  const text = tax.payload.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
  assert(/Taxonomy ID:\s*9835/u.test(text) && /Camelidae/u.test(text) && /Rank:\s*family/u.test(text), "NCBI source does not confirm Camelidae9835.");
  return { immunoglobulinDomains: evidence, camelidTaxonomy: { id: "9835", name: "Camelidae", rank: "family", url: NCBI, rawSha256: tax.record.sha256 }, taxonomyIsSourceOrganismNotExpressionHost: true };
}
async function readSearches(output) {
  const queries = [];
  for (const definition of ANNOTATION_QUERIES) {
    const repetitions = [];
    for (const repeat of [1, 2]) {
      let total = null; const ids = [], pages = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const spec = searchRequest(definition, repeat, page);
        const captured = await existingRecord(output, spec.name, spec.url, spec.request);
        const parsed = parseAnnotationSearchPage(captured.record.status, captured.payload);
        if (total === null) total = parsed.total;
        assert.equal(parsed.total, total, `Total changed during pagination: ${definition.id}`);
        assert.equal(parsed.ids.length, Math.min(ROWS, total - page * ROWS), `Truncated page: ${definition.id}`);
        ids.push(...parsed.ids); pages.push({ page: page + 1, start: page * ROWS, count: parsed.ids.length, rawFile: captured.record.specification.rawFile });
        if (ids.length === total) break;
      }
      assert.equal(ids.length, total, `Incomplete/capped pagination: ${definition.id}`); assert.deepEqual(ids, unique(ids));
      repetitions.push({ repeat, total, pages, ids });
    }
    assert.equal(canonical(repetitions[0].ids), canonical(repetitions[1].ids), `Search repeat disagreement: ${definition.id}`);
    queries.push({ ...definition, repeatAgreement: true, ids: repetitions[0].ids, repetitions });
  }
  return queries;
}
export function intersectAnnotationResults(queries, controls = true) {
  const union = (group) => unique(queries.filter((query) => query.group === group).flatMap((query) => query.ids));
  const gpcrIds = union("gpcr"), igIds = union("immunoglobulin"), camelidIds = union("camelid");
  const ig = new Set(igIds), camelid = new Set(camelidIds);
  const gpcrIgIds = gpcrIds.filter((id) => ig.has(id)), gpcrCamelidIds = gpcrIds.filter((id) => camelid.has(id));
  const intersectionIds = unique([...gpcrIgIds, ...gpcrCamelidIds]);
  const positiveControl = { pdbId: "3P0G", inGpcrSet: gpcrIds.includes("3P0G"), inImmunoglobulinSet: ig.has("3P0G"), inCamelidSet: camelid.has("3P0G"), inFinalIntersection: intersectionIds.includes("3P0G") };
  if (controls) assert(positiveControl.inGpcrSet && positiveControl.inCamelidSet && positiveControl.inFinalIntersection, "Known GPCR–VHH positive control was not recovered; do not interpret a zero intersection as absence.");
  const taxonomyIdSet = queries.find((query) => query.id === "camelid-lineage-id")?.ids ?? [], taxonomyNameSet = queries.find((query) => query.id === "camelid-lineage-name")?.ids ?? [];
  return { gpcrIds, igIds, camelidIds, gpcrIgIds, gpcrCamelidIds, intersectionIds, positiveControl, taxonomyIdNameAgreement: canonical(taxonomyIdSet) === canonical(taxonomyNameSet) };
}
function normalizeNewEntries(payload, ids, ctx, queryIds) {
  assert(!/(?:^|[\r\n"'])[ \t]*(?:ATOM {2}|HETATM).{20,}|_atom_site\.(?:group_PDB|Cartn_[xyz])/imu.test(payload));
  const envelope = parse(payload); assert(Array.isArray(envelope?.data?.entries));
  const present = envelope.data.entries.filter((row) => row !== null);
  const returnedIds = present.map((row) => row.rcsb_id);
  assert(returnedIds.every((id) => ids.includes(id)) && unique(returnedIds).length === returnedIds.length);
  const sourceMap = new Map(returnedIds.map((id) => [id, { pdbId: id, rcsbQueryIds: queryIds.get(id) }]));
  const gpcrdbMap = new Map(returnedIds.map((id) => [id, ctx.gpcrdbMap.get(id) ?? { pdb_code: id }]));
  const entries = parseGraphqlResponse(JSON.stringify({ ...envelope, data: { ...envelope.data, entries: present } }), { batchIndex: 1, ids: returnedIds }, sourceMap, gpcrdbMap, ctx.contract);
  return { entries, missingIds: ids.filter((id) => !returnedIds.includes(id)) };
}
async function derived(output, ctx) {
  const authority = await authorities(output, async () => { throw new Error("Missing authority capture"); });
  const queries = await readSearches(output), sets = intersectAnnotationResults(queries);
  const domainControls = Object.entries(ctx.plan.gpcrDomainControlPdbIds).map(([accession, pdbId]) => ({ accession, pdbId, found: queries.find((query) => query.accession === accession).ids.includes(pdbId) }));
  assert(domainControls.every((row) => row.found), "A verified GPCR domain positive control was not recovered.");
  const immunoglobulinControls = Object.entries(ctx.plan.immunoglobulinDomainControlPdbIds).map(([accession, pdbId]) => ({ accession, pdbId, found: queries.find((query) => query.accession === accession).ids.includes(pdbId) }));
  assert(immunoglobulinControls.every((row) => row.found), "A verified immunoglobulin domain positive control was not recovered.");
  const vhhAnnotationSensitivity = ["3P0G", "3SN6"].map((pdbId) => ({ pdbId, inGpcrDomainSet: sets.gpcrIds.includes(pdbId), inImmunoglobulinDomainSet: sets.igIds.includes(pdbId), inCamelidSourceSet: sets.camelidIds.includes(pdbId), inCombinedIntersection: sets.intersectionIds.includes(pdbId), interpretation: "Known GPCR–VHH controls can lack the selected immunoglobulin Pfam annotations; annotation absence cannot establish VHH absence." }));
  const newIds = sets.intersectionIds.filter((id) => !ctx.capturedIds.has(id));
  const queryIds = new Map(sets.intersectionIds.map((id) => [id, queries.filter((query) => query.ids.includes(id)).map((query) => query.id)]));
  const entries = [], missing = [];
  for (let offset = 0; offset < newIds.length; offset += 25) {
    const ids = newIds.slice(offset, offset + 25), repeats = [];
    for (const repeat of [1, 2]) {
      const spec = metadataRequest(ids, offset / 25 + 1, repeat, ctx);
      const result = await existingRecord(output, spec.name, spec.url, spec.request);
      assert.equal(result.record.status, 200); repeats.push(normalizeNewEntries(result.payload, ids, ctx, queryIds));
    }
    assert.equal(canonical(repeats[0]), canonical(repeats[1]), "New-entry metadata repeat disagreement.");
    entries.push(...repeats[0].entries); missing.push(...repeats[0].missingIds);
  }
  const candidates = sets.intersectionIds.map((pdbId) => ({ pdbId, sourceQueryIds: queryIds.get(pdbId), inGpcrPfamSet: true, inImmunoglobulinPfamSet: sets.igIds.includes(pdbId), inCamelidSourceSet: sets.camelidIds.includes(pdbId), inFrozenGpcrdb1716: ctx.frozenIds.has(pdbId), inHistorical287: ctx.historicalIds.has(pdbId), inCapturedC2Union: ctx.c2UnionIds.has(pdbId), inAnyBoundCapturedMetadata: ctx.capturedIds.has(pdbId), inPriorityLiteratureDepositions: ctx.literatureIds.has(pdbId), newlyRequestedMetadata: newIds.includes(pdbId), metadataMissingInBothRepeats: missing.includes(pdbId), formalDisposition: "PENDING_REQUIRED_METADATA", directGpcrVhhComplexConfirmed: false, independentComponentIncrement: null }));
  const summary = { schemaVersion: "1.0.0", studyId: ctx.plan.studyId, route: ctx.plan.route, status: "SPECIFIED_ANNOTATION_QUERIES_CAPTURED_SCIENTIFIC_REVIEW_PENDING", releaseDateRestriction: null, repeatedQueryCount: queries.length, gpcrDomainEntryCount: sets.gpcrIds.length, immunoglobulinDomainEntryCount: sets.igIds.length, camelidSourceEntryCount: sets.camelidIds.length, gpcrImmunoglobulinIntersectionCount: sets.gpcrIgIds.length, gpcrCamelidIntersectionCount: sets.gpcrCamelidIds.length, combinedIntersectionCount: sets.intersectionIds.length, intersectionAbsentFromFrozenGpcrdbCount: candidates.filter((r) => !r.inFrozenGpcrdb1716).length, intersectionAbsentFromHistorical287Count: candidates.filter((r) => !r.inHistorical287).length, metadataAlreadyCapturedCount: candidates.filter((r) => r.inAnyBoundCapturedMetadata).length, newlyRequestedMetadataEntryCount: newIds.length, newlyCapturedMetadataEntryCount: entries.length, unresolvedNewMetadataEntryCount: missing.length, positiveControl: sets.positiveControl, domainControls, immunoglobulinControls, vhhAnnotationSensitivity, taxonomyIdNameAgreement: sets.taxonomyIdNameAgreement, specifiedQueriesComplete: sets.taxonomyIdNameAgreement && missing.length === 0, exhaustiveGpcrDomainCoverage: false, exhaustiveImmunoglobulinCoverage: false, taxonomyCompletenessAssumed: false, broaderDiscoveryComplete: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", independentComponentsAdded: 0, wholeCensusComponentUpperBound: null, targetFreezePermitted: false, executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false };
  const files = { "authority-evidence.json": json(authority), "query-results.json": json(queries), "normalized/gpcr-ids.txt": idsText(sets.gpcrIds), "normalized/immunoglobulin-ids.txt": idsText(sets.igIds), "normalized/camelid-ids.txt": idsText(sets.camelidIds), "normalized/gpcr-immunoglobulin-intersection.txt": idsText(sets.gpcrIgIds), "normalized/gpcr-camelid-intersection.txt": idsText(sets.gpcrCamelidIds), "normalized/combined-intersection.txt": idsText(sets.intersectionIds), "normalized/new-metadata-ids.txt": idsText(newIds), "candidate-status.jsonl": jsonl(candidates), "entries.jsonl": jsonl(entries), "triage-signals.jsonl": jsonl(entries.map((entry) => deriveTriage(entry, ctx.contract))), "missing-new-ids.jsonl": jsonl(missing.map((pdbId) => ({ pdbId, formalDisposition: "PENDING_REQUIRED_METADATA" }))), "summary.json": json(summary), "README.md": `# Global annotation and source-taxonomy discovery\n\nNo release-date restriction was used. Eight independent searches were repeated twice: four verified GPCR Pfam families (PF00001, PF00002, PF00003, PF01534), two immunoglobulin Pfam families (PF07686, PF00047), and Camelidae source lineage by NCBI ID 9835 and by name. All queries return entry IDs. GPCR and antibody-source predicates were intersected locally across separate result sets, so a receptor and binder can belong to different polymer entities.\n\nThe combined intersection contains ${sets.intersectionIds.length} entries. Metadata already existed for ${candidates.filter((r) => r.inAnyBoundCapturedMetadata).length}; ${newIds.length} new entries were requested twice, with ${missing.length} unresolved. The known GPCR–VHH complex 3P0G and four GPCR-family controls were recovered.\n\nThis is a bounded search of documented annotation families and one source lineage. Immunoglobulin domains also occur in non-antibody proteins; camelid source is not VHH identity. Synthetic, humanized, engineered, unannotated or incompletely annotated chains can be missed. Known GPCR–VHH controls 3P0G and 3SN6 were checked separately against the selected immunoglobulin families and camelid lineage; their results are retained in the summary, including any annotation sensitivity failures. The four GPCR Pfam families do not establish coverage of every GPCR class, fungal receptor, or isolated/truncated receptor domain. Entry intersections establish co-occurrence only, not direct receptor binding or a usable experimental reference pose.\n\nRaw pages, requests, dates/statuses, repeated hit sets, authorities and hashes are retained. New metadata uses the existing sequence-only GraphQL contract and does not inherit receptor mapping from an unrelated entry. Candidate eligibility and leakage independence remain pending. The broader census is incomplete and the protocol remains DRAFT/BLOCKED.\n` };
  const expectedCaptureNames = ["authority-pf07686", "authority-pf00047", "authority-camelidae-9835"];
  for (const query of queries) for (const repetition of query.repetitions) for (const page of repetition.pages) expectedCaptureNames.push(searchRequest(query, repetition.repeat, page.page - 1).name);
  for (let offset = 0; offset < newIds.length; offset += 25) for (const repeat of [1, 2]) expectedCaptureNames.push(metadataRequest(newIds.slice(offset, offset + 25), offset / 25 + 1, repeat, ctx).name);
  return { files, summary, expectedCaptureNames };
}
async function checksums(output, names) { const out = []; for (const name of names.filter((n) => n !== "checksums.sha256").sort()) out.push(`${sha(await read(path.join(output, name)))}  ${name}`); return `${out.join("\n")}\n`; }
async function validateCaptures(output, result, finalized = false) {
  const files = await inventory(output), captures = files.filter((name) => name.startsWith("captures/"));
  assert.deepEqual(captures, result.expectedCaptureNames.map((name) => `captures/${name}.json`).sort(), "Unexpected or missing capture files.");
  const bound = new Set();
  for (const filename of captures) {
    const record = parse(await read(path.join(output, filename))), spec = record.specification;
    assert.equal(spec.captureFile, filename); assert.equal(spec.method, "GET"); assert.equal(record.finalUrl, spec.url);
    assert([200, 204].includes(record.status));
    if (record.status !== 204) assert(spec.rawFile.endsWith(".html") ? /^text\/html/iu.test(record.contentType) : /^application\/(?:json|[^;]+\+json)/iu.test(record.contentType));
    assert(Number.isFinite(Date.parse(record.startedUtc)) && Date.parse(record.completedUtc) >= Date.parse(record.startedUtc));
    const bytes = await read(path.join(output, spec.rawFile)); assert.equal(sha(bytes), record.sha256); assert.equal(bytes.length, record.bytes); bound.add(spec.rawFile);
    if (spec.requestFile) { assert.equal(sha(await read(path.join(output, spec.requestFile))), spec.requestSha256); bound.add(spec.requestFile); }
  }
  assert.deepEqual(files.filter((name) => name.startsWith("raw/") || name.startsWith("requests/")), [...bound].sort(), "Unmatched raw/request files.");
  if (finalized) assert.deepEqual(files, [...captures, ...bound, ...Object.keys(result.files), "collection-plan.json", "manifest.json", "checksums.sha256"].sort(), "Unexpected snapshot files.");
  return captures.length;
}
export async function collectAnnotationDiscovery({ repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, DEFAULT_OUTPUT), fetchImpl = fetch, onProgress = () => {} } = {}) {
  const ctx = await context(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  const old = await readdir(outputDirectory); assert(old.length === 0 || old.includes("collection-plan.json"), "Use a new isolated annotation output directory.");
  await immutable(outputDirectory, "collection-plan.json", json(ctx.plan));
  await authorities(outputDirectory, fetchImpl);
  for (const definition of ANNOTATION_QUERIES) for (const repeat of [1, 2]) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const spec = searchRequest(definition, repeat, page);
      const response = await fetchRecord(outputDirectory, spec.name, spec.url, spec.request, fetchImpl);
      const result = parseAnnotationSearchPage(response.record.status, response.payload);
      onProgress({ query: definition.id, repeat, page: page + 1, total: result.total });
      if (page * ROWS + result.ids.length >= result.total) break;
      assert.equal(result.ids.length, ROWS, "Truncated search page.");
    }
  }
  const searches = await readSearches(outputDirectory), sets = intersectAnnotationResults(searches);
  const newIds = sets.intersectionIds.filter((id) => !ctx.capturedIds.has(id));
  for (let offset = 0; offset < newIds.length; offset += 25) for (const repeat of [1, 2]) {
    const spec = metadataRequest(newIds.slice(offset, offset + 25), offset / 25 + 1, repeat, ctx);
    await fetchRecord(outputDirectory, spec.name, spec.url, spec.request, fetchImpl);
    onProgress({ metadataBatch: offset / 25 + 1, repeat, newEntryCount: newIds.length });
  }
  const result = await derived(outputDirectory, ctx);
  for (const [name, value] of Object.entries(result.files)) await immutable(outputDirectory, name, value);
  const responseCount = await validateCaptures(outputDirectory, result);
  await immutable(outputDirectory, "manifest.json", json({ schemaVersion: "1.0.0", collectionPlanSha256: sha(json(ctx.plan)), inputDigests: ctx.plan.inputDigests, responseCount, outputDigests: Object.fromEntries(Object.entries(result.files).map(([name, bytes]) => [name, sha(bytes)])), summary: result.summary }));
  await immutable(outputDirectory, "checksums.sha256", await checksums(outputDirectory, await inventory(outputDirectory)));
  return await verifyAnnotationDiscovery({ repositoryRoot, snapshotDirectory: outputDirectory });
}
export async function verifyAnnotationDiscovery({ repositoryRoot = ROOT, snapshotDirectory = path.join(repositoryRoot, DEFAULT_OUTPUT) } = {}) {
  const ctx = await context(repositoryRoot);
  assert.equal(String(await read(path.join(snapshotDirectory, "collection-plan.json"))), json(ctx.plan));
  const result = await derived(snapshotDirectory, ctx);
  for (const [name, bytes] of Object.entries(result.files)) assert.equal(String(await read(path.join(snapshotDirectory, name))), bytes, `Artifact does not reconstruct: ${name}`);
  const responseCount = await validateCaptures(snapshotDirectory, result, true);
  const expected = { schemaVersion: "1.0.0", collectionPlanSha256: sha(json(ctx.plan)), inputDigests: ctx.plan.inputDigests, responseCount, outputDigests: Object.fromEntries(Object.entries(result.files).map(([name, bytes]) => [name, sha(bytes)])), summary: result.summary };
  assert.equal(String(await read(path.join(snapshotDirectory, "manifest.json"))), json(expected));
  assert.equal(String(await read(path.join(snapshotDirectory, "checksums.sha256"))), await checksums(snapshotDirectory, await inventory(snapshotDirectory)));
  return result.summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory = path.join(ROOT, DEFAULT_OUTPUT)] = process.argv.slice(2);
  try { assert(["collect", "verify"].includes(command), "Usage: capture-annotation-discovery.mjs collect|verify [output-directory]"); const result = command === "collect" ? await collectAnnotationDiscovery({ outputDirectory: path.resolve(directory), onProgress: (event) => console.error(JSON.stringify(event)) }) : await verifyAnnotationDiscovery({ snapshotDirectory: path.resolve(directory) }); console.log(json(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
