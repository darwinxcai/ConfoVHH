import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { batchPlan, canonical, deriveTriage, parseGraphqlResponse } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const BOUND_INPUTS = Object.freeze({
  [`${BASE}/annotation-discovery-2026-09-04/normalized/gpcr-ids.txt`]: "d9f628d6ea268740cd361b836e402da99c15ce63519491cf65787168234dc43f",
  [`${BASE}/entry-metadata-snapshot-2026-08-29/entries.jsonl`]: "bb34bdf41e129997591516283b7cddbdee03014d6828b1531461ba0b68e6c19c",
  [`${BASE}/gpcrdb-complement-metadata-2026-09-04/entries.jsonl`]: "70c7c8a05533d2cae4841307ccc4083a7ddf136adf29e0137b97df548740630c",
  [`${BASE}/gpcrdb-complement-replacements-2026-09-04/entries.jsonl`]: "b0b26eb7776fa1eb53182cf7c23213417209b47a67afbc05621680bfe79457cd",
  [`${BASE}/rcsb-recent-discovery-2026-09-04/entries.jsonl`]: "4ae69b0921f20b2874783b84322f32c3213d842c10e8ed98e65b6c14f0a2e99f",
  [`${BASE}/annotation-discovery-2026-09-04/entries.jsonl`]: "ab4ebb4597948b973af33ae55763c0f8a65fcbfe66db3748d24478ec33a429df",
  [`${BASE}/annotation-additional-priority-review-2026-09-04/publication-closure/entries.jsonl`]: "2797e0201296be05b4e0673beffaaf5f94a5787713565c952ca075773487f4e2",
});
const QUERY_SHA256 = "9dd4489ebd50216f506fd9147778d89e4a250abc2c688d459af817efa6e2fde0";
const CONTRACT = "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json";
const NORMALIZER = "scripts/hard-decoy/v3-entry-metadata.mjs";
const ENDPOINT = "https://data.rcsb.org/graphql";
const LIMIT = 16 * 1024 * 1024;
const ROUTE = "C.1_GPCR_DOMAIN_REMAINDER_WITHOUT_ANTIBODY_OR_TAXONOMY_FILTER";
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows) => rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ok = (value, message) => { if (!value) throw new Error(message); };
const sort = (values) => [...values].sort();
const parse = (bytes) => parseStrictJson(String(bytes), { maximumCharacters: LIMIT, maximumTokens: 500_000, maximumDepth: 64 });
const exists = async (filename) => { try { await lstat(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
async function direct(filename) {
  const info = await lstat(filename);
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `Expected a direct regular file: ${filename}`);
  ok(info.size <= LIMIT, `File exceeds size cap: ${filename}`);
  return await readFile(filename);
}
function identifiers(bytes, label) {
  const text = bytes.toString("utf8");
  ok(text.endsWith("\n"), `${label} lacks terminal LF.`);
  const ids = text.trimEnd().split("\n");
  ok(ids.every((id) => /^[0-9][A-Z0-9]{3}$/u.test(id)), `${label} contains invalid IDs.`);
  ok(canonical(ids) === canonical(sort(new Set(ids))), `${label} is not sorted and unique.`);
  return ids;
}
async function context(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const inputs = new Map();
  async function input(relative) { const bytes = await direct(path.join(root, relative)); inputs.set(relative, sha(bytes)); return bytes; }
  const [domainFile, ...knownFiles] = Object.keys(BOUND_INPUTS);
  const bytesByPath = new Map();
  for (const [relative, expectedSha] of Object.entries(BOUND_INPUTS)) {
    const bytes = await input(relative);
    ok(sha(bytes) === expectedSha, `Pinned source input changed: ${relative}`);
    bytesByPath.set(relative, bytes);
  }
  const allIds = identifiers(bytesByPath.get(domainFile), "GPCR-domain IDs");
  const known = new Set(), sources = [];
  for (const relative of knownFiles) {
    const text = bytesByPath.get(relative).toString("utf8");
    ok(text.endsWith("\n"), `Known metadata lacks terminal LF: ${relative}`);
    const rows = text.trimEnd().split("\n").map(parse);
    const sourceIds = rows.map((row) => row.pdbId);
    ok(sourceIds.every((id) => /^[0-9][A-Z0-9]{3}$/u.test(id)) && new Set(sourceIds).size === sourceIds.length,
      `Invalid or duplicate known metadata IDs: ${relative}`);
    sourceIds.forEach((id) => known.add(id));
    sources.push({ path: relative, sha256: inputs.get(relative), entryCount: sourceIds.length });
  }
  const knownIds = sort(known), overlapIds = allIds.filter((id) => known.has(id));
  const ids = allIds.filter((id) => !known.has(id));
  ok(allIds.length === 2477 && knownIds.length === 1971 && overlapIds.length === 1785 && ids.length === 692,
    "Pinned domain/known-union/overlap/remainder counts drifted.");
  // The shared normalizer requires an object. Empty per-ID records deliberately
  // provide no receptor chain, publication or other GPCRdb mapping to inherit.
  const gpcrdbMap = new Map(ids.map((id) => [id, {}]));
  const contract = parse(await input(CONTRACT));
  const queryBytes = await input(contract.rcsb.queryFile);
  ok(sha(queryBytes) === QUERY_SHA256 && contract.rcsb.querySha256 === QUERY_SHA256, "Pinned metadata GraphQL query changed.");
  ok(contract.rcsb.endpoint === ENDPOINT && contract.rcsb.method === "POST", "Metadata endpoint drifted.");
  ok(contract.rcsb.batchSize === 25 && contract.rcsb.repeatCount === 2, "Frozen request batch/repeat contract drifted.");
  ok(contract.triage.allDispositionStatus === "PENDING_DISPOSITION" && contract.triage.allDirectInterfaceEvidenceStatus === "UNRESOLVED", "Metadata normalization must remain non-dispositive.");
  ok(sha(await input(NORMALIZER)) === "77afbf8b485976fd902de4f8377dcf9f02e90d93328a1da06546c8d7aae7c562", "Pinned normalizer source changed.");
  ok(sha(await input("scripts/hard-decoy/oracle/canonical-json.mjs")) === "6d60625e181d68671d98ec59258660f27799c83261ddaa197ae0a2e449730f5f", "Pinned strict JSON parser changed.");
  inputs.set("scripts/hard-decoy-v3/capture-domain-remainder.mjs", sha(await direct(HERE)));
  const query = queryBytes.toString("utf8");
  const sourceMap = new Map(ids.map((pdbId) => [pdbId, { pdbId, rcsbQueryIds: [ROUTE] }]));
  const batches = batchPlan(ids, 25);
  const requests = [];
  for (const batch of batches) for (let repeat = 1; repeat <= 2; repeat += 1) {
    const stem = `batch-${String(batch.batchIndex).padStart(3, "0")}-repeat-${repeat}`;
    const body = `${JSON.stringify({ query, variables: { ids: batch.ids } })}\n`;
    requests.push({ batchIndex: batch.batchIndex, repeat, requestedIds: batch.ids, method: "POST", requestedUrl: ENDPOINT,
      requestFile: `requests/${stem}.json`, requestBodySha256: sha(body), rawFile: `raw/${stem}.json`, captureFile: `captures/${stem}.json` });
  }
  const plan = {
    schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", discoveryRoute: ROUTE,
    sourceInventoryDate: "2026-09-04", gpcrDomainEntryCount: allIds.length, knownMetadataUnionEntryCount: knownIds.length,
    knownMetadataSources: sources, domainKnownOverlapEntryCount: overlapIds.length,
    remainderEntryCount: ids.length, remainderIdentifiersSha256: sha(`${ids.join("\n")}\n`),
    sourcePredicate: "UNION_OF_PF00001_PF00002_PF00003_PF01534_ENTRY_IDS",
    antibodyOrTaxonomyFilterApplied: false, releaseDateRestriction: null, inheritedGpcrdbMapping: false,
    batchSize: 25, batchCount: batches.length, repeatCount: 2, expectedResponseCount: requests.length,
    inputDigests: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
    querySha256: sha(queryBytes), normalizationContractSha256: inputs.get(CONTRACT),
    requests, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", broaderDiscoveryComplete: false,
    metadataTriageStatus: "NON_DISPOSITIVE_METADATA_SIGNALS_ONLY", targetFreezePermitted: false,
    executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false, performanceResultsAccessed: false,
  };
  const prepared = new Map([["collection-plan.json", json(plan)], ["identifiers.txt", `${ids.join("\n")}\n`], ["batch-plan.json", json(batches)], ["known-metadata-identifiers.txt", `${knownIds.join("\n")}\n`], ["domain-known-overlap-identifiers.txt", `${overlapIds.join("\n")}\n`]]);
  for (const request of requests) prepared.set(request.requestFile, `${JSON.stringify({ query, variables: { ids: request.requestedIds } })}\n`);
  return { root, ids, contract, sourceMap, gpcrdbMap, batches, plan, prepared };
}
async function checkedOutput(directory, root, create) {
  const output = path.resolve(directory);
  const validation = path.join(root, "validation/hard-decoy-holdout-v3");
  ok(output !== root && output !== validation && !output.startsWith(path.join(validation, "source-snapshot-2026-08-29"))
    && !output.startsWith(path.join(validation, "entry-metadata-snapshot-2026-08-29")), "Use a new, isolated domain-remainder output directory.");
  if (create) await mkdir(output, { recursive: true });
  const info = await lstat(output);
  ok(info.isDirectory() && !info.isSymbolicLink(), "Output must be a direct directory.");
  return output;
}
async function immutableFile(directory, relative, content) {
  const filename = path.join(directory, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  if (await exists(filename)) ok((await direct(filename)).equals(Buffer.from(content)), `Prepared or immutable file drifted: ${relative}`);
  else await writeFile(filename, content, { flag: "wx" });
}
async function verifyPrepared(ctx, directory) {
  for (const [relative, content] of ctx.prepared) ok((await direct(path.join(directory, relative))).equals(Buffer.from(content)), `Prepared request or input binding drifted: ${relative}`);
}
export async function prepareDomainRemainderMetadata({ repositoryRoot = ROOT, outputDirectory }) {
  const ctx = await context(repositoryRoot);
  const directory = await checkedOutput(outputDirectory, ctx.root, true);
  const current = await readdir(directory);
  ok(current.length === 0 || current.includes("collection-plan.json"), "Refusing to use a nonempty unrelated output directory.");
  for (const [relative, content] of ctx.prepared) await immutableFile(directory, relative, content);
  return { status: "DOMAIN_REMAINDER_PREPARED", requestedEntries: ctx.ids.length, requests: ctx.plan.requests.length, outputDirectory: directory };
}
function normalizedCapture(bytes, request, ctx) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  ok(!/(?:^|[\r\n"'])[ \t]*(?:ATOM {2}|HETATM).{20,}|_atom_site\.(?:group_PDB|Cartn_[xyz])/imu.test(text), "Coordinate payload is forbidden.");
  ok(!/\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)/iu.test(text), "Observed holdout labels are forbidden.");
  const envelope = parse(text);
  ok(Array.isArray(envelope?.data?.entries), `Missing GraphQL entries array for batch ${request.batchIndex}.`);
  // RCSB may return fewer entries or nulls for removed IDs. Preserve raw bytes and
  // record the exact set difference; never invent replacement entry metadata.
  const present = envelope.data.entries.filter((entry) => entry !== null);
  const returned = present.map((entry) => String(entry.rcsb_id ?? "").toUpperCase());
  const missingIds = request.requestedIds.filter((id) => !returned.includes(id));
  const returnedBatch = { ...ctx.batches[request.batchIndex - 1], ids: request.requestedIds.filter((id) => returned.includes(id)) };
  const normalized = parseGraphqlResponse(JSON.stringify({ ...envelope, data: { ...envelope.data, entries: present } }), returnedBatch, ctx.sourceMap, ctx.gpcrdbMap, ctx.contract);
  return { entries: normalized, missingIds };
}
async function readCapture(ctx, directory, request) {
  const capture = parse(await direct(path.join(directory, request.captureFile)));
  ok(capture.requestFile === request.requestFile && capture.requestBodySha256 === request.requestBodySha256
    && capture.requestedUrl === ENDPOINT && capture.finalUrl === ENDPOINT && capture.method === "POST"
    && capture.batchIndex === request.batchIndex && capture.repeat === request.repeat
    && canonical(capture.requestedIds) === canonical(request.requestedIds) && capture.rawFile === request.rawFile, `Capture request binding drifted: ${request.captureFile}`);
  const bytes = await direct(path.join(directory, request.rawFile));
  ok(capture.rawSha256 === sha(bytes) && capture.bytes === bytes.length, `Raw response digest drifted: ${request.rawFile}`);
  ok(capture.status === 200 && ["application/json", "application/graphql-response+json"].includes(String(capture.contentType).split(";")[0].trim().toLowerCase()), `Capture has unsuccessful HTTP status/content type: ${request.captureFile}`);
  ok(Number.isFinite(Date.parse(capture.startedUtc)) && Number.isFinite(Date.parse(capture.completedUtc)) && Date.parse(capture.completedUtc) >= Date.parse(capture.startedUtc), `Capture timestamps invalid: ${request.captureFile}`);
  const normalized = normalizedCapture(bytes, request, ctx);
  ok(capture.normalizedEntriesSha256 === sha(jsonl(normalized.entries)) && canonical(capture.missingIds) === canonical(normalized.missingIds), `Capture normalization or missing IDs drifted: ${request.captureFile}`);
  return { capture, ...normalized };
}
async function bodyBytes(response) {
  ok(response.body, "GraphQL response body missing.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.length;
    if (length > LIMIT) { await reader.cancel(); throw new Error("GraphQL response exceeds size cap."); }
    chunks.push(Buffer.from(item.value));
  }
  return Buffer.concat(chunks);
}
async function retrieve(ctx, directory, request, fetchImpl, now, delay) {
  const body = await direct(path.join(directory, request.requestFile));
  ok(sha(body) === request.requestBodySha256, "Exact request bytes changed before retrieval.");
  const stem = path.basename(request.rawFile, ".json");
  const previousFailures = (await failedCaptures(ctx, directory)).filter((record) => record.requestFile === request.requestFile);
  const firstFailureOrdinal = Math.max(0, ...previousFailures.map((record) => Number(/-attempt-(\d+)-capture\.json$/u.exec(record.captureFile)[1]))) + 1;
  let response, startedUtc;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    startedUtc = now();
    try {
      response = await fetchImpl(ENDPOINT, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": ctx.contract.rcsb.userAgent }, body: body.toString("utf8"), redirect: "error", signal: AbortSignal.timeout(ctx.contract.rcsb.timeoutMilliseconds) });
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * attempt);
      continue;
    }
    ok(response.redirected !== true && (!response.url || response.url === ENDPOINT), "Metadata request escaped the pinned endpoint.");
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    const failedBytes = await bodyBytes(response);
    const failureOrdinal = firstFailureOrdinal + attempt - 1;
    const failureRaw = `failures/${stem}-attempt-${failureOrdinal}-body.json`;
    const failureRecord = `failures/${stem}-attempt-${failureOrdinal}-capture.json`;
    await immutableFile(directory, failureRaw, failedBytes);
    await immutableFile(directory, failureRecord, json({ requestFile: request.requestFile, requestBodySha256: request.requestBodySha256,
      requestedUrl: ENDPOINT, finalUrl: response.url || ENDPOINT, status: response.status,
      startedUtc, completedUtc: now(), rawFile: failureRaw, rawSha256: sha(failedBytes), bytes: failedBytes.length }));
    if (attempt === 3) throw new Error(`RCSB returned transient HTTP ${response.status} after three attempts; failed bodies retained.`);
    await delay(1000 * attempt);
  }
  ok(response.redirected !== true && (!response.url || response.url === ENDPOINT), "Metadata request escaped the pinned endpoint.");
  const bytes = await bodyBytes(response);
  const contentType = response.headers.get("content-type");
  // Save every received body before scientific/schema validation. A failed
  // capture cannot be reused by resume or mistaken for a successful response.
  await immutableFile(directory, request.rawFile, bytes);
  const capture = { ...request, finalUrl: response.url || ENDPOINT, status: response.status, contentType,
    startedUtc, completedUtc: now(), bytes: bytes.length, rawSha256: sha(bytes), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
  try {
    ok(response.status === 200, `RCSB returned HTTP ${response.status}.`);
    ok(["application/json", "application/graphql-response+json"].includes(String(contentType).split(";")[0].trim().toLowerCase()), "GraphQL returned a forbidden content type.");
    const normalized = normalizedCapture(bytes, request, ctx);
    capture.normalizedEntriesSha256 = sha(jsonl(normalized.entries));
    capture.missingIds = normalized.missingIds;
  } catch (error) {
    capture.validationError = error.message;
    await immutableFile(directory, request.captureFile, json(capture));
    throw error;
  }
  await immutableFile(directory, request.captureFile, json(capture));
}
async function failedCaptures(ctx, directory) {
  const location = path.join(directory, "failures");
  if (!await exists(location)) return [];
  const names = await readdir(location);
  const results = [];
  for (const name of names.filter((item) => item.endsWith("-capture.json")).sort()) {
    const match = /^(batch-\d{3}-repeat-[12])-attempt-([1-9]\d*)-capture\.json$/u.exec(name);
    ok(match, `Unexpected failure archive filename: ${name}`);
    const request = ctx.plan.requests.find((row) => path.basename(row.rawFile, ".json") === match[1]);
    ok(request, `Failure archive lacks a planned request: ${name}`);
    const record = parse(await direct(path.join(location, name)));
    const rawFile = `failures/${match[1]}-attempt-${match[2]}-body.json`;
    ok(record.requestFile === request.requestFile && record.requestBodySha256 === request.requestBodySha256
      && record.requestedUrl === ENDPOINT && record.finalUrl === ENDPOINT && record.rawFile === rawFile
      && [429, 500, 502, 503, 504].includes(record.status), `Failure archive request drifted: ${name}`);
    const raw = await direct(path.join(directory, rawFile));
    ok(record.rawSha256 === sha(raw) && record.bytes === raw.length, `Failure archive body drifted: ${name}`);
    results.push({ captureFile: `failures/${name}`, ...record });
  }
  ok(names.length === results.length * 2, "Failure archive contains unmatched files.");
  return results;
}
async function derived(ctx, directory) {
  const entries = [], missing = [], captures = [];
  for (const batch of ctx.batches) {
    const repeated = [];
    for (const request of ctx.plan.requests.filter((row) => row.batchIndex === batch.batchIndex)) {
      const result = await readCapture(ctx, directory, request);
      captures.push(result.capture);
      repeated.push(result);
    }
    ok(jsonl(repeated[0].entries) === jsonl(repeated[1].entries) && canonical(repeated[0].missingIds) === canonical(repeated[1].missingIds), `Metadata repeat disagreement for batch ${batch.batchIndex}; raw captures retained.`);
    entries.push(...repeated[0].entries);
    missing.push(...repeated[0].missingIds.map((pdbId) => ({ pdbId, batchIndex: batch.batchIndex, status: "NOT_RETURNED_IN_EITHER_REPEAT", dispositionStatus: "PENDING_REQUIRED_METADATA" })));
  }
  const triage = entries.map((entry) => deriveTriage(entry, ctx.contract));
  const reviewStrata = Object.fromEntries(ctx.contract.triage.allowedReviewStrata.map((name) => [name, triage.filter((row) => row.reviewStratum === name).length]));
  const summary = { schemaVersion: "1.0.0", studyId: ctx.plan.studyId, discoveryRoute: ROUTE,
    status: missing.length === 0 ? "DOMAIN_REMAINDER_METADATA_CAPTURED_PENDING_SCIENTIFIC_REVIEW" : "DOMAIN_REMAINDER_METADATA_INCOMPLETE_MISSING_ENTRIES",
    gpcrDomainEntryCount: ctx.plan.gpcrDomainEntryCount, knownMetadataUnionEntryCount: ctx.plan.knownMetadataUnionEntryCount,
    domainKnownOverlapEntryCount: ctx.plan.domainKnownOverlapEntryCount, requestedEntryCount: ctx.ids.length,
    antibodyOrTaxonomyFilterApplied: false, inheritedGpcrdbMapping: false,
    capturedEntryCount: entries.length, missingEntryCount: missing.length, repeatedRawResponseCount: captures.length,
    polymerEntityCount: entries.reduce((n, entry) => n + entry.polymerEntities.length, 0), reviewStrata,
    entriesWithVhhLikeEntitySignal: triage.filter((row) => row.vhhLikeEntityIds.length > 0).length,
    discoveryRouteMetadataCaptureComplete: missing.length === 0, routeScientificDispositionComplete: false,
    broaderDiscoveryComplete: false, sourceInventoryDate: "2026-09-04", inventoryFreshnessClaimed: false,
    pendingDispositionRows: ctx.ids.length, formallyClearedGroups: 0, wholeCensusComponentUpperBound: null,
    formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", targetFreezePermitted: false,
    executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false, performanceResultsAccessed: false,
  };
  const files = new Map([
    ["entries.jsonl", jsonl(entries)], ["triage-signals.jsonl", jsonl(triage)], ["missing-ids.jsonl", jsonl(missing)],
    ["requests.jsonl", jsonl(captures)], ["summary.json", json(summary)],
    ["summary.md", `# Receptor-domain metadata remainder\n\nThe repeated global annotation searches captured 2,477 entry IDs carrying one of four documented receptor-domain annotations (PF00001, PF00002, PF00003, PF01534). Six explicitly bound metadata inputs contain 1,971 distinct known entries, of which 1,785 overlap that domain set. The exact remainder is 692 entries, requested in 28 batches of at most 25 entries, each repeated twice. Selection uses no antibody descriptor, immunoglobulin annotation, taxonomy, or release-date filter.\n\nCaptured: ${entries.length}; missing in both repeats: ${missing.length}; raw responses: ${captures.length}. Metadata sequences and all polymer inventories are retained for an independent sequence screen. No receptor-chain mapping is inherited from another accession: all GPCRdb fields are null. Metadata signals do not establish VHH identity, direct receptor binding, absence of a hidden VHH, exclusions, or independent components.\n\nThis closes only the metadata remainder of the four archived receptor-domain query sets when no records are missing. Domain annotations can miss truncated, unannotated, engineered or other GPCR classes; the whole census remains incomplete. The protocol remains DRAFT/BLOCKED. The package authorizes no target freeze, native-coordinate access, label access, model execution or performance claim.\n`],
  ]);
  const transientHttpResponses = await failedCaptures(ctx, directory);
  files.set("manifest.json", json({ transientHttpResponses, schemaVersion: "1.0.0", studyId: ctx.plan.studyId, discoveryRoute: ROUTE,
    collectionPlanSha256: sha(json(ctx.plan)), inputDigests: ctx.plan.inputDigests,
    normalizedDigests: Object.fromEntries([...files].map(([name, bytes]) => [name, sha(bytes)])), summary,
    ...Object.fromEntries(["targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed", "broaderDiscoveryComplete"].map((key) => [key, false])),
  }));
  return { files, summary, failureFiles: transientHttpResponses.flatMap((row) => [row.captureFile, row.rawFile]) };
}
async function inventory(directory, prefix = "") {
  const files = [];
  for (const item of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    ok(!item.isSymbolicLink(), `Output contains a symlink: ${relative}`);
    if (item.isDirectory()) files.push(...await inventory(directory, relative));
    else { ok(item.isFile(), `Output contains a non-regular file: ${relative}`); files.push(relative); }
  }
  return sort(files);
}
async function checksumText(directory, filenames) {
  const rows = [];
  for (const name of sort(filenames)) rows.push(`${sha(await direct(path.join(directory, name)))}  ${name}`);
  return `${rows.join("\n")}\n`;
}
export async function collectDomainRemainderMetadata({ repositoryRoot = ROOT, outputDirectory, fetchImpl = fetch, now = () => new Date().toISOString(), delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), onProgress = () => {} }) {
  await prepareDomainRemainderMetadata({ repositoryRoot, outputDirectory });
  const ctx = await context(repositoryRoot);
  const directory = await checkedOutput(outputDirectory, ctx.root, false);
  await verifyPrepared(ctx, directory);
  for (const [index, request] of ctx.plan.requests.entries()) {
    if (await exists(path.join(directory, request.captureFile))) await readCapture(ctx, directory, request);
    else {
      ok(!await exists(path.join(directory, request.rawFile)), `Unfinished raw capture cannot be silently reused: ${request.rawFile}`);
      await retrieve(ctx, directory, request, fetchImpl, now, delay);
      await delay(ctx.contract.rcsb.minimumDelayMilliseconds);
    }
    onProgress({ completed: index + 1, total: ctx.plan.requests.length, batchIndex: request.batchIndex, repeat: request.repeat });
  }
  const result = await derived(ctx, directory);
  for (const [relative, bytes] of result.files) await immutableFile(directory, relative, bytes);
  const files = (await inventory(directory)).filter((name) => name !== "checksums.sha256");
  await immutableFile(directory, "checksums.sha256", await checksumText(directory, files));
  return await verifyDomainRemainderMetadata({ repositoryRoot, snapshotDirectory: directory });
}
export async function verifyDomainRemainderMetadata({ repositoryRoot = ROOT, snapshotDirectory }) {
  const ctx = await context(repositoryRoot);
  const directory = await checkedOutput(snapshotDirectory, ctx.root, false);
  await verifyPrepared(ctx, directory);
  const result = await derived(ctx, directory);
  for (const [relative, bytes] of result.files) ok((await direct(path.join(directory, relative))).equals(Buffer.from(bytes)), `Derived metadata artifact does not reconstruct: ${relative}`);
  const expected = sort([...ctx.prepared.keys(), ...ctx.plan.requests.flatMap((request) => [request.rawFile, request.captureFile]), ...result.files.keys(), ...result.failureFiles, "checksums.sha256"]);
  ok(canonical(await inventory(directory)) === canonical(expected), "Snapshot file inventory differs from the exact collection plan.");
  const checksum = await checksumText(directory, expected.filter((name) => name !== "checksums.sha256"));
  ok((await direct(path.join(directory, "checksums.sha256"))).toString("utf8") === checksum, "Snapshot checksum replay failed.");
  return result.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory, root = ROOT] = process.argv.slice(2);
  try {
    ok(["prepare", "collect", "verify"].includes(command) && directory, "Usage: capture-domain-remainder.mjs prepare|collect|verify <directory> [repository-root]");
    const options = { repositoryRoot: path.resolve(root), outputDirectory: path.resolve(directory), snapshotDirectory: path.resolve(directory) };
    if (command === "collect") options.onProgress = (progress) => console.error(`Metadata captures ${progress.completed}/${progress.total} (batch ${progress.batchIndex}, repeat ${progress.repeat})`);
    const result = await (command === "prepare" ? prepareDomainRemainderMetadata(options) : command === "collect" ? collectDomainRemainderMetadata(options) : verifyDomainRemainderMetadata(options));
    console.log(json(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
