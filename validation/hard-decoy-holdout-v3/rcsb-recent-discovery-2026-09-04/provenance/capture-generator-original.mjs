import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, parseGraphqlResponse } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT = "validation/hard-decoy-holdout-v3/rcsb-recent-discovery-2026-09-04";
const SCHEMA = "https://search.rcsb.org/rcsbsearch/v2/metadata/schema";
const SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const GRAPHQL = "https://data.rcsb.org/graphql";
const DOMAIN_BASE = "https://www.ebi.ac.uk/interpro/api/entry/pfam/";
const CONTRACT = "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json";
const GPCRDB = "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-api-1.json";
const START = "2026-08-30T00:00:00Z";
const END = "2026-09-05T00:00:00Z";
const ROWS = 100;
const MAX_PAGES = 20;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows) => rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
const idsText = (ids) => ids.length ? `${ids.join("\n")}\n` : "";
const unique = (values) => [...new Set(values)].sort();
const parse = (text) => parseStrictJson(text, { maximumCharacters: 16 * 1024 * 1024, maximumTokens: 500000, maximumDepth: 64 });
const term = (attribute, operator, value) => ({ type: "terminal", service: "text", parameters: { attribute, operator, value } });
const group = (nodes, logical_operator = "and") => ({ type: "group", logical_operator, nodes });

export const DOMAINS = [
  { accession: "PF00001", shortName: "7tm_1", description: "rhodopsin-family membrane domain", controlPdbId: "5UZ7" },
  { accession: "PF00002", shortName: "7tm_2", description: "secretin-family membrane domain, also found in adhesion GPCRs", controlPdbId: "7VVN" },
  { accession: "PF00003", shortName: "7tm_3", description: "family-3 membrane domain", controlPdbId: "4OR2" },
  { accession: "PF01534", shortName: "Frizzled", description: "Frizzled/Smoothened membrane region", controlPdbId: "4JKV" },
];
export const QUERY_DEFINITIONS = [
  ...DOMAINS.map((domain) => ({ id: `pfam-${domain.accession.toLowerCase()}`, kind: "recent-domain", domain: domain.accession })),
  ...["GPCR", '"G protein coupled receptor"', '"G-protein-coupled receptor"', "Frizzled", "Smoothened", "receptor"].map((value, index) => ({ id: `text-${String(index + 1).padStart(2, "0")}`, kind: "recent-full-text", value })),
  ...DOMAINS.map((domain) => ({ id: `control-${domain.accession.toLowerCase()}`, kind: "domain-positive-control", domain: domain.accession, pdbId: domain.controlPdbId })),
];

export function buildRecentSearchQuery(definition, start = 0) {
  const annotation = definition.domain ? group([term("rcsb_polymer_entity_annotation.type", "exact_match", "Pfam"), term("rcsb_polymer_entity_annotation.annotation_id", "exact_match", definition.domain)]) : { type: "terminal", service: "full_text", parameters: { value: definition.value } };
  const query = definition.kind === "domain-positive-control" ? group([term("rcsb_id", "exact_match", definition.pdbId), annotation]) : group([term("rcsb_accession_info.initial_release_date", "greater_or_equal", START), term("rcsb_accession_info.initial_release_date", "less", END), annotation]);
  return { query, return_type: "entry", request_options: { paginate: { start, rows: ROWS }, results_content_type: ["experimental"], sort: [{ sort_by: "rcsb_id", direction: "asc" }] } };
}

async function inputFiles(root) {
  const contractText = await readFile(path.join(root, CONTRACT), "utf8");
  const contract = parse(contractText);
  const query = await readFile(path.join(root, contract.rcsb.queryFile), "utf8");
  assert.equal(sha(query), contract.rcsb.querySha256);
  const gpcrdbText = await readFile(path.join(root, GPCRDB), "utf8");
  return { contract, query, gpcrdbMap: new Map(parse(gpcrdbText).map((row) => [row.pdb_code, row])), inputDigests: { [CONTRACT]: sha(contractText), [contract.rcsb.queryFile]: sha(query), [GPCRDB]: sha(gpcrdbText) } };
}

async function filenames(directory, prefix = "") {
  const out = [];
  for (const row of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    assert(!row.isSymbolicLink());
    if (row.isDirectory()) out.push(...await filenames(directory, name));
    else { assert(row.isFile()); out.push(name); }
  }
  return out.sort();
}

async function request({ output, name, endpoint, body, context, records, raw, fetchImpl, now }) {
  assert([SCHEMA, SEARCH, GRAPHQL, ...DOMAINS.map((domain) => `${DOMAIN_BASE}${domain.accession}/`)].includes(endpoint));
  const record = { ...context, endpoint, method: body === undefined ? "GET" : "POST", startedAt: now(), finishedAt: null, status: null, finalUrl: null, redirected: null, responseHeaders: null, requestFile: body === undefined ? null : `requests/${name}.json`, requestBodySha256: body === undefined ? null : sha(body), rawFile: `raw/${name}.json`, responseByteCount: 0, responseSha256: null, bodyRepresentation: "fetch-decoded-response-bytes", error: null };
  if (body !== undefined) await writeFile(path.join(output, record.requestFile), body);
  const chunks = [];
  try {
    const response = await fetchImpl(endpoint, { method: record.method, body, redirect: "error", signal: AbortSignal.timeout(90000), headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), "user-agent": "ConfoVHH-recent-release-metadata/1.0 (+https://github.com/darwinxcai/ConfoVHH)" } });
    record.status = response.status; record.finalUrl = response.url || endpoint; record.redirected = response.redirected;
    record.responseHeaders = Object.fromEntries(["date", "content-type", "content-length", "content-encoding", "etag", "last-modified"].map((key) => [key, response.headers.get(key)]));
    assert.equal(record.finalUrl, endpoint); assert.equal(record.redirected, false);
    let total = 0;
    if (response.body) for await (const chunk of response.body) { total += chunk.length; assert(total <= 16 * 1024 * 1024, "Response exceeded 16 MiB cap"); chunks.push(chunk); }
    assert(response.ok, `HTTP ${response.status}`);
    if (response.status !== 204) assert(/^application\/(?:json|[^;]+\+json)(?:;|$)/iu.test(record.responseHeaders["content-type"] ?? ""), "Non-JSON response");
  } catch (error) { record.error = error.message; }
  const bytes = Buffer.concat(chunks);
  record.finishedAt = now(); record.responseByteCount = bytes.length; record.responseSha256 = sha(bytes);
  await writeFile(path.join(output, record.rawFile), bytes);
  raw.set(record.rawFile, bytes.toString("utf8")); records.push(record);
  await writeFile(path.join(output, "response-records.json"), json(records));
  return record;
}

export function parseRecentSearchPage(record, payload) {
  assert(!record.error, record.error ?? "Failed search request");
  if (record.status === 204) { assert.equal(payload, ""); return { ids: [], total: 0 }; }
  assert.equal(record.status, 200);
  const value = parse(payload);
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(Object.keys(value).every((key) => ["query_id", "result_type", "total_count", "result_set"].includes(key)), "Unexpected search response fields");
  assert.equal(value.result_type, "entry");
  assert.equal(typeof value.query_id, "string");
  assert(Number.isSafeInteger(value.total_count) && value.total_count >= 0);
  assert(Array.isArray(value.result_set));
  const ids = value.result_set.map((row) => { assert.deepEqual(Object.keys(row).sort(), ["identifier", "score"]); assert(/^[0-9][A-Z0-9]{3}$/u.test(row.identifier)); assert(Number.isFinite(row.score)); return row.identifier; });
  assert.equal(unique(ids).length, ids.length, "Duplicate result identifiers");
  assert.deepEqual(ids, [...ids].sort(), "Result order does not match pinned PDB-ID sort");
  assert(ids.length <= ROWS && ids.length <= value.total_count);
  return { ids, total: value.total_count };
}

function replaySearches(records, raw) {
  return QUERY_DEFINITIONS.map((definition) => {
    const repeats = [1, 2].map((repeat) => {
      const pages = records.filter((row) => row.kind === "search" && row.queryId === definition.id && row.repeat === repeat).sort((a, b) => a.start - b.start);
      const ids = []; let total = null; let error = null;
      try {
        assert(pages.length > 0 && pages.length <= MAX_PAGES, "Missing search pages or cap exceeded");
        for (const [index, record] of pages.entries()) {
          assert.equal(record.start, index * ROWS, "Pagination gap");
          const page = parseRecentSearchPage(record, raw.get(record.rawFile));
          if (total === null) total = page.total;
          assert.equal(page.total, total, "Total count changed during pagination");
          assert.equal(page.ids.length, Math.min(ROWS, Math.max(0, total - record.start)), "Truncated search page");
          ids.push(...page.ids);
        }
        assert.equal(ids.length, total, "Search pagination incomplete or capped");
        assert.equal(unique(ids).length, ids.length, "Repeated identifiers across pages");
      } catch (failure) { error = failure.message; }
      return { repeat, total, observedIds: unique(ids), pageCount: pages.length, complete: error === null, error };
    });
    const repeatAgreement = repeats.every((row) => row.complete) && canonical(repeats[0].observedIds) === canonical(repeats[1].observedIds);
    return { ...definition, repeats, repeatAgreement, observedIds: unique(repeats.flatMap((row) => row.observedIds)), status: repeatAgreement ? "REPEAT_CONFIRMED" : "UNRESOLVED" };
  });
}

function schemaEvidence(records, raw) {
  const errors = [];
  let schemaFields = null;
  try {
    const record = records.find((row) => row.kind === "schema"); assert(record && !record.error, record?.error ?? "Missing schema capture");
    const schema = parse(raw.get(record.rawFile));
    const release = schema.properties?.rcsb_accession_info?.properties?.initial_release_date;
    const annotations = schema.properties?.rcsb_polymer_entity_annotation;
    assert.equal(release?.format, "date");
    assert.equal(annotations?.type, "array");
    assert(annotations.rcsb_nested_indexing, "Missing nested-indexing schema annotation");
    assert(annotations.items?.properties?.annotation_id?.rcsb_search_context?.includes("exact-match"));
    assert(annotations.items?.properties?.type?.rcsb_search_context?.includes("exact-match"));
    schemaFields = { releaseDate: release, annotationId: annotations.items.properties.annotation_id, annotationType: annotations.items.properties.type, nestedIndexing: annotations.rcsb_nested_indexing, nestedContext: annotations.rcsb_nested_indexing_context };
  } catch (failure) { errors.push({ source: "RCSB_SCHEMA", error: failure.message }); }
  const domains = DOMAINS.map((domain) => {
    try {
      const record = records.find((row) => row.kind === "domain-authority" && row.accession === domain.accession); assert(record && !record.error, record?.error ?? "Missing domain authority capture");
      const metadata = parse(raw.get(record.rawFile)).metadata;
      assert.equal(metadata.accession, domain.accession); assert.equal(metadata.name.short, domain.shortName);
      return { ...domain, verified: true, authorityUrl: record.endpoint, observedName: metadata.name.name, observedType: metadata.type };
    } catch (failure) { errors.push({ source: domain.accession, error: failure.message }); return { ...domain, verified: false }; }
  });
  return { verified: errors.length === 0, schemaFields, domains, errors };
}

export function deriveRecentRcsbDiscovery({ source, records, raw }) {
  const authority = schemaEvidence(records, raw);
  const searches = replaySearches(records, raw);
  const discovery = searches.filter((row) => row.kind !== "domain-positive-control");
  const control = searches.filter((row) => row.kind === "domain-positive-control");
  const ids = unique(discovery.flatMap((row) => row.observedIds));
  const statuses = []; const entries = [];
  for (const id of ids) {
    const queryIds = discovery.filter((row) => row.observedIds.includes(id)).map((row) => row.id);
    const attempts = [1, 2].map((repeat) => {
      try {
        const record = records.find((row) => row.kind === "entry-metadata" && row.repeat === repeat && row.ids.includes(id)); assert(record && !record.error, record?.error ?? "Metadata request missing");
        const envelope = parse(raw.get(record.rawFile));
        assert(!envelope.errors?.length, `GraphQL errors: ${canonical(envelope.errors)}`);
        assert(Array.isArray(envelope.data?.entries), "Missing metadata entries");
        const present = envelope.data.entries.filter((row) => row !== null);
        assert(present.every((row) => record.ids.includes(row.rcsb_id)), "Unexpected metadata entry");
        assert.equal(unique(present.map((row) => row.rcsb_id)).length, present.length, "Duplicate metadata entry");
        const matches = present.filter((row) => row.rcsb_id === id); assert.equal(matches.length, 1, "Entry omitted from metadata response");
        const gpcrdb = source.gpcrdbMap.get(id) ?? { pdb_code: id };
        const entry = parseGraphqlResponse(JSON.stringify({ data: { entries: matches } }), { batchIndex: 1, ids: [id] }, new Map([[id, { pdbId: id, rcsbQueryIds: queryIds }]]), new Map([[id, gpcrdb]]), source.contract)[0];
        const date = Date.parse(entry.releaseDate); assert(Number.isFinite(date) && date >= Date.parse(START) && date < Date.parse(END), "Release date missing or outside requested window");
        return { repeat, entry, error: null };
      } catch (error) { return { repeat, entry: null, error: error.message }; }
    });
    const agreement = attempts.every((row) => row.error === null) && canonical(attempts[0].entry) === canonical(attempts[1].entry);
    if (agreement) entries.push(attempts[0].entry);
    statuses.push({ pdbId: id, sourceQueryIds: queryIds, gpcrdbBaselineMember: source.gpcrdbMap.has(id), metadataStatus: agreement ? "REPEAT_CONFIRMED_METADATA" : "UNRESOLVED", attempts: attempts.map(({ repeat, error }) => ({ repeat, error })), directGpcrVhhComplexConfirmed: false, formalDispositionAssigned: false });
  }
  const summary = {
    schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", route: "C4_INDEPENDENT_RCSB_RECENT_RELEASE_SEARCH", releaseDateLowerInclusive: START, releaseDateUpperExclusive: END,
    discoveryQueryCount: discovery.length, repeatConfirmedDiscoveryQueries: discovery.filter((row) => row.repeatAgreement).length,
    domainQueryCount: DOMAINS.length, positiveControlsConfirmed: control.filter((row) => row.repeatAgreement && row.observedIds.includes(row.pdbId)).length,
    schemaAndDomainAuthoritiesVerified: authority.verified, observedCandidateEntryCount: ids.length,
    repeatConfirmedMetadataEntryCount: entries.length, unresolvedMetadataEntryCount: statuses.filter((row) => row.metadataStatus === "UNRESOLVED").length,
    absentFromArchivedGpcrdbCount: statuses.filter((row) => !row.gpcrdbBaselineMember).length,
    specifiedQueriesComplete: authority.verified && discovery.every((row) => row.repeatAgreement) && control.every((row) => row.repeatAgreement && row.observedIds.includes(row.pdbId)) && entries.length === ids.length,
    exhaustiveGpcrDomainCoverage: false, allRecentPublicGpcrEntriesCovered: false, broaderDiscoveryComplete: false,
    formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false,
    interpretation: "Date-bounded search of four verified Pfam annotation families plus complementary full-text terms. Hits are discovery candidates, not confirmed GPCR-VHH complexes. These domain IDs and indexed text cannot ensure complete coverage of every GPCR class, unannotated construct, truncated receptor domain, or delayed annotation."
  };
  return { summary, files: { "authority-evidence.json": json(authority), "query-results.json": json(searches), "normalized/candidate-ids.txt": idsText(ids), "candidate-status.jsonl": jsonl(statuses), "entries.jsonl": jsonl(entries), "summary.json": json(summary) } };
}

export async function collectRecentRcsbDiscovery({ repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT), fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const source = await inputFiles(repositoryRoot); const records = []; const raw = new Map();
  await mkdir(outputDirectory, { recursive: false });
  for (const name of ["raw", "requests", "normalized"]) await mkdir(path.join(outputDirectory, name));
  const run = (args) => request({ output: outputDirectory, records, raw, fetchImpl, now, ...args });
  await run({ name: "rcsb-search-schema", endpoint: SCHEMA, context: { kind: "schema" } });
  for (const domain of DOMAINS) await run({ name: `domain-${domain.accession.toLowerCase()}`, endpoint: `${DOMAIN_BASE}${domain.accession}/`, context: { kind: "domain-authority", accession: domain.accession } });
  await writeFile(path.join(outputDirectory, "query-definitions.json"), json(QUERY_DEFINITIONS));
  for (const definition of QUERY_DEFINITIONS) for (const repeat of [1, 2]) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * ROWS;
      const body = json(buildRecentSearchQuery(definition, start));
      const record = await run({ name: `${definition.id}-repeat-${repeat}-page-${String(page + 1).padStart(3, "0")}`, endpoint: SEARCH, body, context: { kind: "search", queryId: definition.id, repeat, start } });
      try { const parsed = parseRecentSearchPage(record, raw.get(record.rawFile)); if (start + parsed.ids.length >= parsed.total || parsed.ids.length !== ROWS) break; }
      catch { break; }
    }
  }
  const ids = unique(replaySearches(records, raw).filter((row) => row.kind !== "domain-positive-control").flatMap((row) => row.observedIds));
  for (let offset = 0; offset < ids.length; offset += 25) for (const repeat of [1, 2]) {
    const batch = ids.slice(offset, offset + 25);
    await run({ name: `entry-metadata-batch-${String(offset / 25 + 1).padStart(3, "0")}-repeat-${repeat}`, endpoint: GRAPHQL, body: `${JSON.stringify({ query: source.query, variables: { ids: batch } })}\n`, context: { kind: "entry-metadata", ids: batch, repeat } });
  }
  const built = deriveRecentRcsbDiscovery({ source, records, raw });
  for (const [name, content] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), content);
  await writeFile(path.join(outputDirectory, "manifest.json"), json({ schemaVersion: "1.0.0", createdAt: now(), inputDigests: source.inputDigests, generatorScript: path.relative(repositoryRoot, HERE), generatorScriptSha256: sha(await readFile(HERE)), responseRecordCount: records.length, searchDocumentation: "https://search.rcsb.org/#querying-nested-attributes", requestWindow: { lowerInclusive: START, upperExclusive: END }, collectionTimeDoesNotEstablishFutureCoverage: true }));
  const s = built.summary;
  await writeFile(path.join(outputDirectory, "README.md"), `# Independent RCSB recent-release discovery\n\nThis package searches experimental PDB entries initially released from 2026-08-30 through 2026-09-04 UTC. The end-date filter is exclusive at 2026-09-05; coverage is limited to what was indexed at the recorded request times, not future releases later in the nominal window.\n\nFour Pfam annotation queries and six complementary text queries were each repeated twice. The text terms are GPCR, two quoted forms of G-protein-coupled receptor, Frizzled, Smoothened, and receptor. The broad receptor term intentionally retains false positives for subsequent sequence and role review. Four older PDB IDs serve only as positive controls for the domain-query mechanism and are never added to the recent candidate set.\n\n- Observed recent candidate entries: ${s.observedCandidateEntryCount}.\n- Repeat-confirmed discovery queries: ${s.repeatConfirmedDiscoveryQueries}/${s.discoveryQueryCount}.\n- Confirmed domain controls: ${s.positiveControlsConfirmed}/4.\n- Repeat-confirmed entry metadata: ${s.repeatConfirmedMetadataEntryCount}; unresolved: ${s.unresolvedMetadataEntryCount}.\n- Candidates absent from the archived GPCRdb inventory: ${s.absentFromArchivedGpcrdbCount}.\n- Specified query capture complete: ${s.specifiedQueriesComplete}.\n\nThe [official RCSB search schema](${SCHEMA}) and [search documentation](https://search.rcsb.org/) establish attribute names, date filters, nested-annotation grouping, and pagination. Pfam accession identities are archived from the [InterPro API](https://www.ebi.ac.uk/interpro/api/). Annotation type and accession are grouped together to refer to the same nested annotation object. Pagination uses 100 IDs per page, checks total counts and gaps, and fails incomplete after 20 pages rather than silently truncating. HTTP 204 with an empty body is retained as a zero-result response; failed HTTP requests remain unresolved.\n\n| Pfam accession | Verified short name | Scope |\n| --- | --- | --- |\n${DOMAINS.map((domain) => `| ${domain.accession} | ${domain.shortName} | ${domain.description} |`).join("\n")}\n\nThis is not an exhaustive GPCR classification. Other noncanonical or nonvertebrate receptor families, domain-poor or truncated constructs, unannotated receptor sequences and delayed Pfam assignments are not guaranteed coverage. The generic receptor text query helps recover some omissions but provides no exhaustive guarantee. A hit can be an unrelated receptor, an isolated receptor fragment, or a GPCR without a VHH. Eligibility, direct binding role and independent leakage components remain unresolved. The protocol stays DRAFT and target freeze stays BLOCKED.\n\nAll raw request and response bodies, query definitions, HTTP statuses/dates, hashes, per-page results, failures, normalized metadata and checksums are archived. RCSB entry capture uses the pinned existing GraphQL metadata query. No coordinates, native interface geometry, rendered structures, model scores or holdout labels were requested.\n\nReplay without network access:\n\n\`\`\`sh\nnode scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs verify\n\`\`\`\n\nFuture capture of this same historical date window requires a new output directory:\n\n\`\`\`sh\nnode scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs collect /absolute/path/to/new-output\n\`\`\`\n`);
  const names = await filenames(outputDirectory);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), (await Promise.all(names.map(async (name) => `${sha(await readFile(path.join(outputDirectory, name)))}  ${name}`))).join("\n") + "\n");
  return built.summary;
}

export async function verifyRecentRcsbDiscovery({ repositoryRoot = ROOT, snapshotDirectory = path.join(repositoryRoot, OUTPUT) } = {}) {
  const source = await inputFiles(repositoryRoot);
  const names = (await filenames(snapshotDirectory)).filter((name) => name !== "checksums.sha256");
  const checksums = (await readFile(path.join(snapshotDirectory, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  assert.equal(checksums.length, names.length);
  for (const [index, name] of names.entries()) assert.equal(checksums[index], `${sha(await readFile(path.join(snapshotDirectory, name)))}  ${name}`);
  const manifest = parse(await readFile(path.join(snapshotDirectory, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.inputDigests, source.inputDigests); assert.equal(manifest.generatorScriptSha256, sha(await readFile(HERE)));
  assert.equal(await readFile(path.join(snapshotDirectory, "query-definitions.json"), "utf8"), json(QUERY_DEFINITIONS));
  const records = parse(await readFile(path.join(snapshotDirectory, "response-records.json"), "utf8"));
  assert.equal(records.length, manifest.responseRecordCount); const raw = new Map(); const requests = new Set();
  for (const record of records) {
    assert(/^raw\/[a-z0-9-]+\.json$/u.test(record.rawFile)); assert(!raw.has(record.rawFile));
    const bytes = await readFile(path.join(snapshotDirectory, record.rawFile)); assert.equal(bytes.length, record.responseByteCount); assert.equal(sha(bytes), record.responseSha256);
    assert(Number.isFinite(Date.parse(record.startedAt)) && Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
    if (!record.error) { assert(record.status >= 200 && record.status <= 299); assert.equal(record.finalUrl, record.endpoint); assert.equal(record.redirected, false); }
    if (record.requestFile !== null) {
      assert(/^requests\/[a-z0-9-]+\.json$/u.test(record.requestFile)); assert(!requests.has(record.requestFile)); requests.add(record.requestFile);
      const body = await readFile(path.join(snapshotDirectory, record.requestFile), "utf8"); assert.equal(sha(body), record.requestBodySha256);
      if (record.kind === "search") { assert.equal(record.endpoint, SEARCH); assert.equal(body, json(buildRecentSearchQuery(QUERY_DEFINITIONS.find((definition) => definition.id === record.queryId), record.start))); }
      else { assert.equal(record.kind, "entry-metadata"); assert.equal(record.endpoint, GRAPHQL); assert.equal(body, `${JSON.stringify({ query: source.query, variables: { ids: record.ids } })}\n`); }
    } else assert(record.endpoint === SCHEMA || DOMAINS.some((domain) => record.endpoint === `${DOMAIN_BASE}${domain.accession}/`));
    raw.set(record.rawFile, bytes.toString("utf8"));
  }
  assert.deepEqual([...raw.keys()].sort(), names.filter((name) => name.startsWith("raw/")));
  assert.deepEqual([...requests].sort(), names.filter((name) => name.startsWith("requests/")));
  const built = deriveRecentRcsbDiscovery({ source, records, raw });
  for (const [name, content] of Object.entries(built.files)) assert.equal(await readFile(path.join(snapshotDirectory, name), "utf8"), content, `Replay mismatch: ${name}`);
  return built.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory] = process.argv.slice(2);
  const run = command === "collect" ? () => collectRecentRcsbDiscovery({ outputDirectory: directory ? path.resolve(directory) : path.join(ROOT, OUTPUT) }) : command === "verify" ? () => verifyRecentRcsbDiscovery({ snapshotDirectory: directory ? path.resolve(directory) : path.join(ROOT, OUTPUT) }) : null;
  if (!run) { console.error("Usage: node scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs <collect|verify> [directory]"); process.exitCode = 1; }
  else run().then((result) => console.log(json(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
