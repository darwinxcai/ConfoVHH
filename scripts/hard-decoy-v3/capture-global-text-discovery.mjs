import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, parseGraphqlResponse, deriveTriage } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const GRAPHQL = "https://data.rcsb.org/graphql";
const LIMIT = 16 * 1024 * 1024;
const ROWS = 500;
const MAX_PAGES = 40;
const ROUTE = "C6_ALL_RELEASE_DATE_RECEPTOR_TEXT_COMPLEMENT";
const CONTRACT = `${BASE}/entry-metadata-draft/entry-metadata-contract.json`;
const ADAPTED_CAPTURE_SCRIPT_SHA256 = "8ec2dee77f63c846b36aaa26085193851bf2b51285ba89674c3f0886ea45250a";
const ORIGINAL_SCRIPT_SHA256 = "c46a87cb17f3ac3e19a7151c66076d659dbbcbeb83a5c1be4a92a479e8c6c961";
const SCRIPT = "scripts/hard-decoy-v3/capture-global-text-discovery.mjs";
export const KNOWN_INPUTS = Object.freeze({
  [`${BASE}/entry-metadata-snapshot-2026-08-29/entries.jsonl`]: "bb34bdf41e129997591516283b7cddbdee03014d6828b1531461ba0b68e6c19c",
  [`${BASE}/gpcrdb-complement-metadata-2026-09-04/entries.jsonl`]: "70c7c8a05533d2cae4841307ccc4083a7ddf136adf29e0137b97df548740630c",
  [`${BASE}/gpcrdb-complement-replacements-2026-09-04/entries.jsonl`]: "b0b26eb7776fa1eb53182cf7c23213417209b47a67afbc05621680bfe79457cd",
  [`${BASE}/rcsb-recent-discovery-2026-09-04/entries.jsonl`]: "4ae69b0921f20b2874783b84322f32c3213d842c10e8ed98e65b6c14f0a2e99f",
  [`${BASE}/annotation-discovery-2026-09-04/entries.jsonl`]: "ab4ebb4597948b973af33ae55763c0f8a65fcbfe66db3748d24478ec33a429df",
  [`${BASE}/annotation-additional-priority-review-2026-09-04/publication-closure/entries.jsonl`]: "2797e0201296be05b4e0673beffaaf5f94a5787713565c952ca075773487f4e2",
  [`${BASE}/domain-remainder-2026-09-04/entries.jsonl`]: "6aa103cf88f5fb69874842da11ce5306a23429f7590a77210f892a40ef046017",
});
export const TEXT_QUERIES = Object.freeze(["GPCR", '"G protein coupled receptor"', '"G-protein-coupled receptor"', "Frizzled", "Smoothened"].map((value, index) => Object.freeze({ id: `text-${index + 1}`, value })));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows) => rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
const idsText = (ids) => ids.length ? `${ids.join("\n")}\n` : "";
const sorted = (values) => [...new Set(values)].sort();
const parse = (bytes) => parseStrictJson(String(bytes), { maximumCharacters: LIMIT, maximumTokens: 500000, maximumDepth: 64 });
const exists = async (file) => { try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
async function direct(file) { const s = await lstat(file); assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= LIMIT * 4, `Expected bounded direct file: ${file}`); return await readFile(file); }
async function immutable(directory, name, bytes) { const file = path.join(directory, name); await mkdir(path.dirname(file), { recursive: true }); if (await exists(file)) assert((await direct(file)).equals(Buffer.from(bytes)), `Immutable file drifted: ${name}`); else await writeFile(file, bytes, { flag: "wx" }); }
async function inventory(directory, prefix = "") { const out = []; for (const s of await readdir(path.join(directory, prefix), { withFileTypes: true })) { const name = path.posix.join(prefix, s.name); assert(!s.isSymbolicLink(), `Symlink in evidence: ${name}`); if (s.isDirectory()) out.push(...await inventory(directory, name)); else { assert(s.isFile()); out.push(name); } } return sorted(out); }
async function context(root) {
  const digests = {}, known = new Set(), sources = [];
  const read = async (name, expected) => { const bytes = await direct(path.join(root, name)); digests[name] = sha(bytes); if (expected) assert.equal(digests[name], expected, `Pinned source changed: ${name}`); return bytes; };
  for (const [name, expected] of Object.entries(KNOWN_INPUTS)) {
    const bytes = await read(name, expected); assert(String(bytes).endsWith("\n"));
    const ids = String(bytes).trimEnd().split("\n").map((row) => parse(row).pdbId);
    assert(ids.every((id) => /^[0-9][A-Z0-9]{3}$/u.test(id)) && sorted(ids).length === ids.length);
    ids.forEach((id) => known.add(id)); sources.push({ path: name, sha256: expected, entryCount: ids.length });
  }
  assert.equal(known.size, 2663, "Pinned seven-source metadata union changed");
  const contract = parse(await read(CONTRACT));
  const query = String(await read(contract.rcsb.queryFile, "9dd4489ebd50216f506fd9147778d89e4a250abc2c688d459af817efa6e2fde0"));
  assert.equal(contract.rcsb.querySha256, sha(query)); assert.equal(contract.rcsb.endpoint, GRAPHQL); assert.equal(contract.rcsb.method, "POST"); assert.equal(contract.rcsb.batchSize, 25); assert.equal(contract.rcsb.repeatCount, 2);
  assert.equal(contract.triage.allDispositionStatus, "PENDING_DISPOSITION"); assert.equal(contract.triage.allDirectInterfaceEvidenceStatus, "UNRESOLVED");
  await read("scripts/hard-decoy/v3-entry-metadata.mjs", "77afbf8b485976fd902de4f8377dcf9f02e90d93328a1da06546c8d7aae7c562");
  await read("scripts/hard-decoy/oracle/canonical-json.mjs", "6d60625e181d68671d98ec59258660f27799c83261ddaa197ae0a2e449730f5f");
  await read(SCRIPT, sha(await direct(HERE)));
  const plan = { schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", route: ROUTE,
    externalCitationTitleWhitespacePolicy: "REPLACE_ESCAPED_HT_LF_CR_WITH_SPACES_ONLY_IN_PRIMARY_CITATION_TITLE_AND_RECORD_SOURCE_DIGESTS", queryDefinitions: TEXT_QUERIES, metadataQueryIds: ["text-1", "text-4", "text-5"], metadataScope: "UNION_OF_GPCR_FRIZZLED_SMOOTHENED_MINUS_SEVEN_KNOWN_METADATA_SOURCES", phraseOnlyRemainderStatus: "NOT_CAPTURED_PENDING", endpoint: SEARCH, pageSize: ROWS, maximumPagesPerRepeat: MAX_PAGES, repeatCount: 2,
    rationale: "The five receptor-specific text terms from the prior recent-release route are rerun across all release dates to complement the selected Pfam panel. Generic receptor is omitted because it does not specifically target GPCR discovery. Preliminary count probes showed the two quoted phrases each returned 16,530 entries. Before capturing complete query sets, metadata collection is limited to the union of the three nonphrase queries. Every phrase-only new ID remains explicitly uncollected and pending. No additional aliases are introduced after seeing results.",
    documentation: "https://search.rcsb.org/", releaseDateRestriction: null, domainFilterApplied: false, antibodyOrTaxonomyFilterApplied: false,
    knownMetadataSources: sources, knownMetadataUnionEntryCount: known.size, inputDigests: digests,
    ...authority() };
  return { root, contract, query, known, plan };
}
function authority() { return { formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", broaderDiscoveryComplete: false, targetFreezePermitted: false, executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false, formalDispositionAssigned: false, wholeCensusComponentUpperBound: null }; }
export function buildGlobalTextQuery(definition, start = 0) { assert(TEXT_QUERIES.some((row) => canonical(row) === canonical(definition))); assert(Number.isSafeInteger(start) && start >= 0 && start % ROWS === 0 && start < ROWS * MAX_PAGES); return { query: { type: "terminal", service: "full_text", parameters: { value: definition.value } }, return_type: "entry", request_options: { paginate: { start, rows: ROWS }, results_content_type: ["experimental"], sort: [{ sort_by: "rcsb_id", direction: "asc" }] } }; }
export function parseGlobalTextPage(record, bytes) {
  assert(!record.error, record.error); if (record.status === 204) { assert.equal(bytes.length, 0); return { ids: [], total: 0 }; }
  assert.equal(record.status, 200); const value = parse(bytes);
  assert(Object.keys(value).every((key) => ["query_id", "result_type", "total_count", "result_set"].includes(key)), "Unexpected search fields");
  assert.equal(value.result_type, "entry"); assert.equal(typeof value.query_id, "string"); assert(Number.isSafeInteger(value.total_count) && value.total_count >= 0 && value.total_count <= ROWS * MAX_PAGES, "Search count exceeds bounded coverage"); assert(Array.isArray(value.result_set));
  const ids = value.result_set.map((row) => { assert.deepEqual(Object.keys(row).sort(), ["identifier", "score"]); assert(/^[0-9][A-Z0-9]{3}$/u.test(row.identifier)); assert(Number.isFinite(row.score)); return row.identifier; });
  assert.deepEqual(ids, sorted(ids), "Duplicate or unsorted search IDs"); assert(ids.length <= ROWS && ids.length <= value.total_count); return { ids, total: value.total_count };
}
function searchRequest(definition, repeat, start) { const stem = `${definition.id}-repeat-${repeat}-page-${String(start / ROWS + 1).padStart(3, "0")}`; return requestSpec(stem, SEARCH, json(buildGlobalTextQuery(definition, start)), { kind: "search", queryId: definition.id, repeat, start }); }
function requestSpec(stem, endpoint, body, fields) { return { ...fields, stem, endpoint, method: "POST", requestFile: `requests/${stem}.json`, requestBodySha256: sha(body), rawFile: `raw/${stem}.json`, captureFile: `captures/${stem}.json`, body }; }
function publicRequest(request) { const fields = { ...request }; delete fields.body; return fields; }
async function responseBytes(response) { assert(response.body || response.status === 204); const chunks = []; let total = 0; if (response.body) for await (const chunk of response.body) { total += chunk.length; assert(total <= LIMIT, "Response exceeds size cap"); chunks.push(chunk); } return Buffer.concat(chunks); }
async function loadCapture(directory, request, validate) {
  assert((await direct(path.join(directory, request.requestFile))).equals(Buffer.from(request.body)), "Request bytes drifted");
  const record = parse(await direct(path.join(directory, request.captureFile))); for (const [key, value] of Object.entries(publicRequest(request))) assert.equal(canonical(record[key]), canonical(value), `Request binding drifted: ${key}`);
  assert.equal(record.finalUrl, request.endpoint); assert.equal(record.redirected, false); assert(!record.error, record.error); assert([200, 204].includes(record.status));
  assert(Number.isFinite(Date.parse(record.startedAt)) && Number.isFinite(Date.parse(record.completedAt)) && Date.parse(record.completedAt) >= Date.parse(record.startedAt));
  if (record.status !== 204) assert(["application/json", "application/graphql-response+json"].includes(String(record.contentType).split(";")[0].trim().toLowerCase()), "Non-JSON capture");
  const bytes = await direct(path.join(directory, request.rawFile)); assert.equal(sha(bytes), record.responseSha256, "Response digest drifted"); assert.equal(bytes.length, record.responseByteCount); const result = validate(record, bytes); assert.equal(sha(canonical(result)), record.parsedResultSha256, "Parsed result drifted"); return { record, result };
}
async function fetchCapture(directory, request, validate, { fetchImpl, now, delay }) {
  await immutable(directory, request.requestFile, request.body);
  if (await exists(path.join(directory, request.captureFile))) return await loadCapture(directory, request, validate);
  assert(!await exists(path.join(directory, request.rawFile)), "Unfinished raw capture cannot be silently overwritten");
  const failuresDirectory = path.join(directory, "failures"); await mkdir(failuresDirectory, { recursive: true });
  const prior = (await readdir(failuresDirectory)).filter((name) => name.startsWith(`${request.stem}-attempt-`) && name.endsWith("-capture.json"));
  const ordinal = Math.max(0, ...prior.map((name) => Number(/-attempt-(\d+)-capture\.json$/u.exec(name)[1]))) + 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = { ...publicRequest(request), startedAt: now(), completedAt: null, finalUrl: request.endpoint, redirected: false, status: null, contentType: null, responseSha256: null, responseByteCount: 0, error: null };
    let bytes = Buffer.alloc(0), result;
    try {
      const response = await fetchImpl(request.endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "ConfoVHH-global-text-metadata/1.0 (+https://github.com/darwinxcai/ConfoVHH)" }, body: request.body, redirect: "error", signal: AbortSignal.timeout(90000) });
      record.status = response.status; record.finalUrl = response.url || request.endpoint; record.redirected = response.redirected; record.contentType = response.headers.get("content-type");
      assert.equal(record.finalUrl, request.endpoint); assert.equal(record.redirected, false); bytes = await responseBytes(response);
      assert([200, 204].includes(record.status), `HTTP ${record.status}`); if (record.status !== 204) assert(["application/json", "application/graphql-response+json"].includes(String(record.contentType).split(";")[0].trim().toLowerCase()), "Non-JSON response");
      result = validate(record, bytes);
    } catch (error) { record.error = error.message; }
    record.completedAt = now(); record.responseSha256 = sha(bytes); record.responseByteCount = bytes.length;
    if (record.error) {
      const stem = `${request.stem}-attempt-${ordinal + attempt}`;
      record.failureRawFile = `failures/${stem}-body.json`;
      await immutable(directory, record.failureRawFile, bytes); await immutable(directory, `failures/${stem}-capture.json`, json(record));
      if (attempt === 2 || (record.status !== null && ![429, 500, 502, 503, 504].includes(record.status))) throw new Error(record.error);
      await delay((attempt + 1) * 1000); continue;
    }
    record.parsedResultSha256 = sha(canonical(result)); await immutable(directory, request.rawFile, bytes); await immutable(directory, request.captureFile, json(record)); return { record, result };
  }
  throw new Error("Unreachable exhausted retries");
}
async function parallel(items, action, width = 3) { let next = 0; const outcomes = await Promise.allSettled(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) { const item = items[next++]; await action(item); } })); const failure = outcomes.find((row) => row.status === "rejected"); if (failure) throw failure.reason; }
async function searches(directory, online, options) {
  const requests = [], results = [];
  await parallel(TEXT_QUERIES, async (definition) => {
    const repeats = [];
    for (const repeat of [1, 2]) {
      const ids = []; let total = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const request = searchRequest(definition, repeat, page * ROWS); requests.push(request);
        const { result } = online ? await fetchCapture(directory, request, parseGlobalTextPage, options) : await loadCapture(directory, request, parseGlobalTextPage);
        if (total === null) total = result.total; assert.equal(total, result.total, "Total changed during pagination"); assert.equal(result.ids.length, Math.min(ROWS, Math.max(0, total - request.start)), "Truncated search page");
        ids.push(...result.ids); options.onProgress?.({ kind: "search", queryId: definition.id, repeat, page: page + 1, total, observed: ids.length });
        if (ids.length >= total) break;
      }
      assert.equal(ids.length, total, "Search pagination incomplete"); assert.deepEqual(ids, sorted(ids), "Duplicate or unordered IDs across pages"); repeats.push({ repeat, total, ids });
    }
    assert.deepEqual(repeats[0].ids, repeats[1].ids, "Search repeat disagreement"); results.push({ ...definition, repeats, repeatAgreement: true });
  });
  return { requests: requests.sort((a, b) => a.stem.localeCompare(b.stem)), results: results.sort((a, b) => a.id.localeCompare(b.id)), ids: sorted(results.flatMap((row) => row.repeats[0].ids)) };
}
export function parseExternalMetadata(text) {
  // Token rewriting preserves duplicate-key detection in the unchanged strict
  // parser. Only valid escaped HT/LF/CR may be rewritten, and only citation-title
  // values may contain them. Identifiers, sequences, object keys and all other
  // metadata retain the original strict control-character policy.
  const lexical = text.replace(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/gu, (token) => {
    const value = JSON.parse(token);
    return /[\t\n\r]/u.test(value) ? JSON.stringify(value.replace(/[\t\n\r]/gu, " ")) : token;
  });
  const normalized = parse(lexical);
  const original = JSON.parse(text); const adjustments = [];
  function walk(value, components = [], entry = null) {
    if (Array.isArray(value)) { value.forEach((child, index) => walk(child, [...components, index], components.length === 2 && components[0] === "data" && components[1] === "entries" ? child : entry)); return; }
    if (value && typeof value === "object") { for (const [key, child] of Object.entries(value)) { assert(!/[\t\n\r]/u.test(key), "Control whitespace in object key is forbidden"); walk(child, [...components, key], entry); } return; }
    if (typeof value !== "string" || !/[\t\n\r]/u.test(value)) return;
    assert(components.length === 5 && components[0] === "data" && components[1] === "entries" && Number.isSafeInteger(components[2]) && components[3] === "rcsb_primary_citation" && components[4] === "title", "Control whitespace outside citation title is forbidden");
    assert(/^[0-9][A-Z0-9]{3}$/u.test(entry?.rcsb_id), "Citation title adjustment lacks exact entry ID");
    const replacement = value.replace(/[\t\n\r]/gu, " ");
    adjustments.push({ pdbId: entry.rcsb_id, field: "rcsb_primary_citation.title", originalUtf8Sha256: sha(value), normalizedUtf8Sha256: sha(replacement), replacedControlCount: [...value].filter((character) => /[\t\n\r]/u.test(character)).length, policy: "ESCAPED_HT_LF_CR_TO_ASCII_SPACE" });
  }
  walk(original); adjustments.sort((a, b) => a.pdbId.localeCompare(b.pdbId));
  return { normalized, adjustments };
}
function normalizeMetadata(request, ctx, record, bytes) {
  assert.equal(record.status, 200); const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert(!/(?:^|[\r\n"'])[ \t]*(?:ATOM {2}|HETATM).{20,}|_atom_site\.(?:group_PDB|Cartn_[xyz])/imu.test(text), "Coordinate payload forbidden");
  assert(!/\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)/iu.test(text), "Holdout labels forbidden");
  const external = parseExternalMetadata(text); const envelope = external.normalized; assert(Array.isArray(envelope?.data?.entries), "Missing GraphQL entries"); const present = envelope.data.entries.filter((entry) => entry !== null);
  const returned = present.map((entry) => entry.rcsb_id); const missingIds = request.ids.filter((id) => !returned.includes(id));
  const sourceMap = new Map(request.ids.map((pdbId) => [pdbId, { pdbId, rcsbQueryIds: [ROUTE] }])); const gpcrdbMap = new Map(request.ids.map((id) => [id, {}]));
  const entries = parseGraphqlResponse(JSON.stringify({ ...envelope, data: { ...envelope.data, entries: present } }), { batchIndex: request.batchIndex, ids: request.ids.filter((id) => returned.includes(id)) }, sourceMap, gpcrdbMap, ctx.contract);
  return { entries, missingIds, ...(external.adjustments.length ? { normalizationAdjustments: external.adjustments } : {}) };
}
function metadataRequests(ids, ctx) { const out = []; for (let offset = 0; offset < ids.length; offset += 25) for (const repeat of [1, 2]) { const batchIndex = offset / 25 + 1, batch = ids.slice(offset, offset + 25); out.push(requestSpec(`metadata-${String(batchIndex).padStart(3, "0")}-repeat-${repeat}`, GRAPHQL, `${JSON.stringify({ query: ctx.query, variables: { ids: batch } })}\n`, { kind: "entry-metadata", batchIndex, repeat, ids: batch })); } return out; }
async function failures(directory, requests) {
  if (!await exists(path.join(directory, "failures"))) return { files: [], records: [] };
  const files = [], records = [], names = await readdir(path.join(directory, "failures"));
  for (const name of names.filter((item) => item.endsWith("-capture.json")).sort()) {
    const match = /^(.*)-attempt-([1-9]\d*)-capture\.json$/u.exec(name); assert(match, "Unexpected failure name"); const request = requests.find((row) => row.stem === match[1]); assert(request, "Failure outside planned requests");
    const record = parse(await direct(path.join(directory, "failures", name))); for (const [key, value] of Object.entries(publicRequest(request))) assert.equal(canonical(record[key]), canonical(value), `Failure binding drifted: ${key}`);
    assert(record.error); const rawFile = `failures/${match[1]}-attempt-${match[2]}-body.json`; assert.equal(record.failureRawFile, rawFile); const bytes = await direct(path.join(directory, rawFile)); assert.equal(sha(bytes), record.responseSha256); assert.equal(bytes.length, record.responseByteCount); records.push(record); files.push(`failures/${name}`, rawFile);
  }
  assert.equal(names.length, files.length, "Unmatched failure files"); return { files, records };
}
async function checksum(directory, files) { const lines = []; for (const name of sorted(files)) lines.push(`${sha(await direct(path.join(directory, name)))}  ${name}`); return `${lines.join("\n")}\n`; }
async function run({ repositoryRoot = ROOT, outputDirectory, snapshotDirectory, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onProgress = () => {} }, online) {
  const ctx = await context(path.resolve(repositoryRoot)), directory = path.resolve(online ? outputDirectory : snapshotDirectory);
  assert(![ctx.root, path.join(ctx.root, BASE)].includes(directory));
  assert(!directory.includes("source-snapshot-2026-08-29") && !directory.includes("entry-metadata-snapshot-2026-08-29"), "Frozen outputs forbidden");
  if (online) { await mkdir(directory, { recursive: true }); const names = await readdir(directory); assert(names.length === 0 || names.includes("discovery-plan.json"), "Unrelated output directory"); }
  assert((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink());
  const finalizationFiles = new Map();
  if (await exists(path.join(directory, "continuation-plan.json"))) {
    const prior = parse(await direct(path.join(directory, "continuation-plan.json")));
    if (prior.inputDigests?.[SCRIPT] === ADAPTED_CAPTURE_SCRIPT_SHA256) {
      const priorExpected = { ...ctx.plan, inputDigests: { ...ctx.plan.inputDigests, [SCRIPT]: ADAPTED_CAPTURE_SCRIPT_SHA256 } };
      assert.equal(canonical(prior), canonical(priorExpected), "Adapted capture plan changed beyond the finalization-only source revision");
      const adaptedSource = await direct(path.join(directory, "provenance/capture-generator-corrected.mjs"));
      assert.equal(sha(adaptedSource), ADAPTED_CAPTURE_SCRIPT_SHA256, "Adapted capture source provenance changed");
      finalizationFiles.set("provenance/capture-generator-corrected.mjs", adaptedSource);
      finalizationFiles.set("provenance/finalization-code.json", json({ adaptedCaptureScriptSha256: ADAPTED_CAPTURE_SCRIPT_SHA256, finalizerScriptSha256: ctx.plan.inputDigests[SCRIPT], reason: "All repeated captures and scientific normalization completed under the adapted collector. Final checksum generation found a 22.7 MB aggregate entries file above its 16 MiB local-file read cap. The finalizer raises only local-file reads to 64 MiB while retaining the 16 MiB individual HTTP response/parser cap. Capture source plans, records, normalized scientific outputs and their attribution are unchanged.", finalizationRequestsNetworkAccess: false }));
      // The manifest identifies the code that captured these responses. The
      // separately hashed finalizer must not reattribute their source epoch.
      ctx.plan = priorExpected;
    }
  }
  const prepared = new Map([["discovery-plan.json", json(ctx.plan)], ["known-metadata-identifiers.txt", idsText(sorted(ctx.known))]]);
  if (await exists(path.join(directory, "discovery-plan.json"))) {
    const initial = parse(await direct(path.join(directory, "discovery-plan.json")));
    if (initial.inputDigests?.[SCRIPT] === ORIGINAL_SCRIPT_SHA256) {
      const originalPlan = { ...ctx.plan, inputDigests: { ...ctx.plan.inputDigests, [SCRIPT]: ORIGINAL_SCRIPT_SHA256 } };
      delete originalPlan.externalCitationTitleWhitespacePolicy;
      assert.equal(canonical(initial), canonical(originalPlan), "Original discovery plan drifted beyond the documented adapter revision");
      const originalSource = await direct(path.join(directory, "provenance/capture-generator-original.mjs"));
      assert.equal(sha(originalSource), ORIGINAL_SCRIPT_SHA256, "Original collector provenance changed");
      prepared.set("discovery-plan.json", json(originalPlan));
      prepared.set("provenance/capture-generator-original.mjs", originalSource);
      prepared.set("continuation-plan.json", json(ctx.plan));
      prepared.set("provenance/adapter-correction.json", json({ originalScriptSha256: ORIGINAL_SCRIPT_SHA256, correctedScriptSha256: ctx.plan.inputDigests[SCRIPT], originalPlanSha256: sha(json(originalPlan)), continuationPlanSha256: sha(json(ctx.plan)), reason: "Older RCSB primary-citation titles contain valid escaped newlines rejected by the strict manifest parser. Original failed bodies and successful captures are preserved. The external-metadata adapter replaces only HT/LF/CR in citation-title values with spaces and records both text digests. The frozen parser, normalizer, GraphQL query, scientific sequences, query scopes and request bodies are unchanged.", reusedSearchCapturesPermittedOnlyAfterExactReplay: true }));
    }
  }
  for (const [name, bytes] of finalizationFiles) prepared.set(name, bytes);
  for (const [name, bytes] of prepared) if (online) await immutable(directory, name, bytes); else assert((await direct(path.join(directory, name))).equals(Buffer.from(bytes)), `Prepared input drifted: ${name}`);
  const options = { fetchImpl, now, delay, onProgress }; const search = await searches(directory, online, options);
  const selectedIds = sorted(search.results.filter((row) => ctx.plan.metadataQueryIds.includes(row.id)).flatMap((row) => row.repeats[0].ids));
  const ids = selectedIds.filter((id) => !ctx.known.has(id)), overlap = search.ids.filter((id) => ctx.known.has(id));
  const pendingIds = search.ids.filter((id) => !ctx.known.has(id) && !selectedIds.includes(id));
  onProgress({ kind: "scope", searchUnionEntryCount: search.ids.length, selectedThreeTermEntryCount: selectedIds.length, newMetadataEntryCount: ids.length, phraseOnlyNewEntriesPending: pendingIds.length });
  const requests = metadataRequests(ids, ctx); const captures = new Map();
  await parallel(requests, async (request) => { const validate = (record, bytes) => normalizeMetadata(request, ctx, record, bytes); const result = online ? await fetchCapture(directory, request, validate, options) : await loadCapture(directory, request, validate); captures.set(request.stem, result); onProgress({ kind: "metadata", completed: captures.size, total: requests.length, newIds: ids.length }); if (online) await delay(ctx.contract.rcsb.minimumDelayMilliseconds); });
  const entries = [], missingIds = [], normalizationAdjustments = [];
  for (const request of requests.filter((row) => row.repeat === 1)) { const first = captures.get(request.stem).result, second = captures.get(request.stem.replace(/1$/u, "2")).result; assert.equal(canonical(first), canonical(second), `Metadata repeat disagreement in batch ${request.batchIndex}`); entries.push(...first.entries); missingIds.push(...first.missingIds); normalizationAdjustments.push(...(first.normalizationAdjustments ?? [])); }
  const allRequests = [...search.requests, ...requests]; const failure = await failures(directory, allRequests);
  const summary = { schemaVersion: "1.0.0", studyId: ctx.plan.studyId, route: ROUTE, status: "METADATA_DISCOVERY_PENDING_SCIENTIFIC_REVIEW", discoveryQueryCount: TEXT_QUERIES.length, repeatConfirmedQueryCount: search.results.length, queryEntryCounts: Object.fromEntries(search.results.map((row) => [row.value, row.repeats[0].total])), searchUnionEntryCount: search.ids.length, knownMetadataUnionEntryCount: ctx.known.size, overlapEntryCount: overlap.length, newEntryCount: ids.length, selectedThreeTermEntryCount: selectedIds.length, selectedThreeTermOverlapEntryCount: selectedIds.length - ids.length, phraseOnlyNewEntriesPendingCount: pendingIds.length, allQueryNewEntryCount: ids.length + pendingIds.length, capturedEntryCount: entries.length, missingEntryCount: missingIds.length, polymerEntityCount: entries.reduce((n, entry) => n + entry.polymerEntities.length, 0), repeatedSearchResponseCount: search.requests.length, repeatedMetadataResponseCount: requests.length, failedRequestAttemptCount: failure.records.length, citationTitlesWithEscapedWhitespaceNormalized: normalizationAdjustments.length, specifiedQueriesComplete: true, selectedMetadataScopeComplete: missingIds.length === 0, allQueryMetadataComplete: missingIds.length === 0 && pendingIds.length === 0, releaseDateRestriction: null, domainFilterApplied: false, antibodyOrTaxonomyFilterApplied: false, inheritedGpcrdbMapping: false, formallyClearedGroups: 0, ...authority() };
  const readme = `# Global receptor-text discovery complement\n\nFive predeclared RCSB full-text queries reuse the receptor-specific terms from the recent-release route across all release dates: GPCR, quoted G protein coupled receptor, quoted G-protein-coupled receptor, Frizzled and Smoothened. No domain, antibody, taxonomy or release-date predicate is applied. Generic receptor and post hoc aliases are not searched. Experimental entry IDs are sorted and paginated at 500 rows, bounded at 20,000 hits per query. Each complete query is repeated; totals, full ID coverage and exact ID-set agreement are required.\n\nThe query union contains ${search.ids.length} entries. Seven pinned earlier metadata sources contain ${ctx.known.size} distinct entries; ${overlap.length} overlap these text results. After preliminary count probes, and before capturing complete repeated ID sets, the metadata scope was set to only the union of GPCR, Frizzled and Smoothened: ${selectedIds.length} entries before subtracting known metadata. The ${ids.length} new IDs within that scope are requested in batches of 25, each twice: ${entries.length} captured, ${missingIds.length} missing, ${summary.polymerEntityCount} polymer entities. Metadata uses the existing hash-pinned GraphQL query and normalizer, with null GPCRdb fields and no borrowed receptor mappings. Every present protein is retained for the separate unchanged sequence screen. The two quoted-phrase queries contribute ${pendingIds.length} additional new IDs outside the three-term metadata scope. All are retained in phrase-only-pending-identifiers.txt and pending-metadata.jsonl as NOT_CAPTURED_PENDING. Completing the five ID queries does not mean metadata is complete for their union.\n\nThis is a bounded indexed-text discovery route, not exhaustive GPCR coverage. RCSB full_text searches indexed text fields; tokenization and matches across descriptive fields can yield broad false positives even when phrase strings contain quotes. No exact biological phrase semantics are assumed. Text hits include non-GPCR proteins, effectors, isolated binders and unrelated matches. These five terms can miss receptor aliases and records lacking indexed wording; repeat agreement does not validate search sensitivity. Neither a hit nor an absent hit establishes GPCR identity, VHH identity, direct binding, eligibility, exclusion, independent components or absence of hidden binders. The whole-census upper bound remains unknown and the study remains DRAFT/BLOCKED. No native coordinates, poses, holdout labels, Results prose or model outputs were requested.\n\nEscaped HT/LF/CR controls in primary-citation titles are replaced with spaces by a narrow external-metadata adapter; original response bytes and exact original/normalized title digests are retained. No sequence, identifier or other field permits that transformation. The frozen strict parser and normalizer are unchanged. The initial collector and failed title captures are preserved where the adapter was added during continuation.\n\nExact requests, successful and failed response bytes, capture metadata, normalized outputs, input/script digests and the complete file inventory are retained. Resume verifies completed requests and retains further failures under increasing attempt ordinals. Offline replay: node scripts/hard-decoy-v3/capture-global-text-discovery.mjs verify DIRECTORY [REPOSITORY_ROOT].\n`;
  const files = new Map([["query-results.json", json(search.results)], ["citation-title-normalization.jsonl", jsonl(normalizationAdjustments)], ["identifiers.txt", idsText(ids)], ["search-union-identifiers.txt", idsText(search.ids)], ["selected-three-term-identifiers.txt", idsText(selectedIds)], ["phrase-only-pending-identifiers.txt", idsText(pendingIds)], ["pending-metadata.jsonl", jsonl(pendingIds.map((pdbId) => ({ pdbId, status: "NOT_CAPTURED_PENDING", reason: "OUTSIDE_PREDECLARED_THREE_NONPHRASE_TERM_METADATA_SCOPE", formalDispositionAssigned: false })))], ["known-overlap-identifiers.txt", idsText(overlap)], ["entries.jsonl", jsonl(entries)], ["missing-ids.jsonl", jsonl(missingIds.map((pdbId) => ({ pdbId, status: "MISSING_IN_BOTH_REPEATS", dispositionStatus: "PENDING_REQUIRED_METADATA" })))], ["triage-signals.jsonl", jsonl(entries.map((entry) => deriveTriage(entry, ctx.contract)))], ["summary.json", json(summary)], ["README.md", readme]]);
  files.set("manifest.json", json({ schemaVersion: "1.0.0", inputDigests: ctx.plan.inputDigests, discoveryPlanSha256: sha(prepared.get("discovery-plan.json")), ...(prepared.has("continuation-plan.json") ? { continuationPlanSha256: sha(prepared.get("continuation-plan.json")) } : {}), requests: allRequests.map(publicRequest), failedRequests: failure.records, normalizedDigests: Object.fromEntries([...files].map(([name, bytes]) => [name, sha(bytes)])), summary, ...authority() }));
  for (const [name, bytes] of files) if (online) await immutable(directory, name, bytes); else assert((await direct(path.join(directory, name))).equals(Buffer.from(bytes)), `Derived artifact does not reconstruct: ${name}`);
  const expected = sorted([...prepared.keys(), ...files.keys(), ...allRequests.flatMap((request) => [request.requestFile, request.rawFile, request.captureFile]), ...failure.files, "checksums.sha256"]);
  const sums = await checksum(directory, expected.filter((name) => name !== "checksums.sha256"));
  if (online) await immutable(directory, "checksums.sha256", sums); else assert.equal(String(await direct(path.join(directory, "checksums.sha256"))), sums, "Checksum replay failed");
  assert.deepEqual(await inventory(directory), expected, "Exact evidence inventory differs"); return summary;
}
export const collectGlobalTextDiscovery = (options) => run(options, true);
export const verifyGlobalTextDiscovery = (options) => run(options, false);
if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory, root = ROOT] = process.argv.slice(2);
  try { assert(["collect", "verify"].includes(command) && directory, "Usage: capture-global-text-discovery.mjs collect|verify DIRECTORY [REPOSITORY_ROOT]"); const options = { repositoryRoot: root, outputDirectory: directory, snapshotDirectory: directory, onProgress: command === "collect" ? (progress) => console.error(JSON.stringify(progress)) : () => {} }; console.log(json(await (command === "collect" ? collectGlobalTextDiscovery(options) : verifyGlobalTextDiscovery(options)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
