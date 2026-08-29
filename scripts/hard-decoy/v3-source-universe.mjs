import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT = "validation/hard-decoy-holdout-v3/prelabel-census-draft/source-query-contract.json";
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEY = /(?:^|[_-])(?:[xyz]|atom[_-]?site|cartn[_-]?[xyz]|cartesian[_-]?[xyz]|coordinates?|dockq|fnat|rmsd|[il]rmsd|interface[_-]?rmsd|ligand[_-]?rmsd|capri(?:class|label)?|native[_-]?(?:pose|interface)|relative[_-]?(?:pose|interface)|confovhh[_-]?(?:score|rank)|performance[_-]?results?)(?:$|[_-])/iu;
const FALSE_SENTINELS = new Set(["nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "nativeCoordinatesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
const MAX_SCAN_DEPTH = 64;
const MAX_SCAN_NODES = 500_000;
const MAX_BASE64_BYTES = 1024 * 1024;
const MAX_TOTAL_DECODED_BYTES = 16 * 1024 * 1024;
const MAX_ENCODED_TOKENS = 100_000;
const MAX_INVENTORY_FILES = 128;
const MAX_CHECKSUM_BYTES = 1024 * 1024;
const MAX_JSON_CHARACTERS = 16 * 1024 * 1024;

function ok(value, message) { if (!value) throw new Error(message); }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
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
  state.decodedBytes += decoded.byteLength;
  ok(state.decodedBytes <= MAX_TOTAL_DECODED_BYTES, `Decoded metadata scanning exceeded the ${MAX_TOTAL_DECODED_BYTES}-byte cap in ${name}.`);
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
  const state = { nodes: 0, decodedBytes: 0 };
  if (name.endsWith(".json")) scanValue(name, parseMetadataJson(name, text), state, 0);
  else if (name.endsWith(".jsonl") && text.length) {
    ok(text.endsWith("\n"), `${name} must end with LF.`);
    for (const [index, line] of text.trimEnd().split("\n").entries()) {
      scanValue(name, parseMetadataJson(`${name} row ${index + 1}`, line), state, 0);
    }
  } else {
    let tokens = 0;
    for (const match of text.matchAll(/(?<![A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{24,}={0,2})(?![A-Za-z0-9+/_-])/gu)) {
      tokens += 1;
      ok(tokens <= MAX_ENCODED_TOKENS, `Encoded metadata token count exceeded the ${MAX_ENCODED_TOKENS}-token cap in ${name}.`);
      inspectEncodedString(name, match[1], state, 0);
    }
  }
}
function sorted(values) { return [...new Set(values)].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))); }
function serialize(values) { const ids = sorted(values); return ids.length ? `${ids.join("\n")}\n` : ""; }
function summary(values) { const text = serialize(values); return { count: sorted(values).length, sha256: sha(Buffer.from(text)) }; }
function union(groups) { return sorted(groups.flat()); }
function intersect(left, right) { const set = new Set(right); return left.filter((id) => set.has(id)); }
function difference(left, right) { const set = new Set(right); return left.filter((id) => !set.has(id)); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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
function requireFiniteNumberOrNull(value, label) {
  ok(value === null || (typeof value === "number" && Number.isFinite(value)), `${label} must be a finite number or null.`);
}
function validateGpcrdbSignallingProtein(value, label) {
  if (value === null || value === undefined) return;
  const signalling = requireAllowedKeys(value, ["data", "type"], ["data", "type"], label);
  ok(typeof signalling.type === "string", `${label}.type must be a string.`);
  const data = requireObject(signalling.data, `${label}.data`);
  for (const [key, entity] of Object.entries(data)) {
    ok(/^entity[1-9][0-9]*$/u.test(key), `${label}.data contains an unexpected field: ${key}`);
    const normalized = requireAllowedKeys(entity, ["chain", "entry_name"], ["chain", "entry_name"], `${label}.data.${key}`);
    ok(typeof normalized.chain === "string" && typeof normalized.entry_name === "string", `${label}.data.${key} fields must be strings.`);
  }
}
function validateGpcrdbRow(row, index) {
  const label = `GPCRdb API row ${index + 1}`;
  const allowed = ["class", "distance", "family", "ligands", "pdb_code", "preferred_chain", "protein", "publication", "publication_date", "resolution", "signalling_protein", "species", "state", "type"];
  const object = requireAllowedKeys(row, allowed, ["pdb_code"], label);
  for (const key of ["class", "family", "pdb_code", "preferred_chain", "protein", "publication_date", "species", "state", "type"]) {
    if (Object.hasOwn(object, key)) requireNullableString(object[key], `${label}.${key}`);
  }
  if (Object.hasOwn(object, "publication")) requireNullableString(object.publication, `${label}.publication`);
  if (Object.hasOwn(object, "distance")) requireFiniteNumberOrNull(object.distance, `${label}.distance`);
  if (Object.hasOwn(object, "resolution")) requireFiniteNumberOrNull(object.resolution, `${label}.resolution`);
  if (Object.hasOwn(object, "ligands")) {
    ok(Array.isArray(object.ligands), `${label}.ligands must be an array.`);
    for (const [ligandIndex, ligand] of object.ligands.entries()) {
      const ligandLabel = `${label}.ligands[${ligandIndex}]`;
      const normalized = requireAllowedKeys(ligand, ["PDB", "SMILES", "function", "name", "type"], ["function", "name", "type"], ligandLabel);
      for (const key of Object.keys(normalized)) requireNullableString(normalized[key], `${ligandLabel}.${key}`);
    }
  }
  validateGpcrdbSignallingProtein(object.signalling_protein, `${label}.signalling_protein`);
  return object;
}

export function normalizeIdentifiers(values, pattern = "^[0-9][A-Z0-9]{3}$") {
  const regex = new RegExp(pattern, "u");
  return sorted(values.map((value) => String(value ?? "").trim().toUpperCase()).filter((value) => regex.test(value)));
}
export function serializeIdentifiers(values) { return serialize(values); }
export function parseRcsbIds(text, contract) {
  const json = requireAllowedKeys(parseMetadataJson("RCSB response", text), ["query_id", "result_set", "result_type", "total_count"], ["query_id", "result_set", "result_type", "total_count"], "RCSB response");
  ok(typeof json.query_id === "string" && json.query_id.length > 0, "RCSB response query_id must be a non-empty string.");
  ok(json.result_type === contract.rcsb.returnType, "RCSB response result_type drifted from the request contract.");
  ok(Number.isSafeInteger(json.total_count) && json.total_count >= 0, "RCSB response total_count must be a non-negative safe integer.");
  ok(Array.isArray(json.result_set), "RCSB response lacks result_set.");
  ok(json.total_count === json.result_set.length, `RCSB response is incomplete: total_count ${json.total_count} differs from ${json.result_set.length} returned rows.`);
  const pattern = new RegExp(contract.normalization.identifierPattern, "u");
  const ids = [];
  for (const [index, row] of json.result_set.entries()) {
    const normalized = requireAllowedKeys(row, ["identifier", "score"], ["identifier", "score"], `RCSB result row ${index + 1}`);
    ok(typeof normalized.identifier === "string" && pattern.test(normalized.identifier), `RCSB result row ${index + 1} has an invalid identifier.`);
    ok(normalized.identifier === normalized.identifier.trim().toUpperCase(), `RCSB result row ${index + 1} identifier is not canonical uppercase.`);
    ok(typeof normalized.score === "number" && Number.isFinite(normalized.score), `RCSB result row ${index + 1} has an invalid score.`);
    ids.push(normalized.identifier);
  }
  ok(new Set(ids).size === ids.length, "RCSB response contains duplicate identifiers.");
  return sorted(ids);
}
export function parseGpcrdbApiIds(text, contract) {
  const json = parseMetadataJson("GPCRdb API response", text);
  ok(Array.isArray(json), "GPCRdb API response is not an array.");
  const pattern = new RegExp(contract.normalization.identifierPattern, "u");
  const ids = json.map((row, index) => {
    const normalized = validateGpcrdbRow(row, index);
    const identifier = normalized[contract.gpcrdb.pdbCodeField];
    ok(typeof identifier === "string" && pattern.test(identifier), `GPCRdb API row ${index + 1} has an invalid PDB identifier.`);
    ok(identifier === identifier.trim().toUpperCase(), `GPCRdb API row ${index + 1} identifier is not canonical uppercase.`);
    return identifier;
  });
  ok(new Set(ids).size === ids.length, "GPCRdb API response contains duplicate PDB identifiers.");
  return sorted(ids);
}
function decodeEntities(text) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/giu, (all, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? all;
  });
}
export function parseGpcrdbHtmlIds(text, contract) {
  const ids = [];
  for (const row of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map((match) => match[1]);
    const cell = cells[contract.gpcrdb.htmlPdbColumnIndexZeroBased];
    if (!cell) continue;
    const plain = decodeEntities(cell.replace(/<[^>]+>/gu, " "));
    const match = /(?:^|[^A-Za-z0-9])([0-9][A-Za-z0-9]{3})(?=$|[^A-Za-z0-9])/u.exec(plain);
    if (match) ids.push(match[1]);
  }
  const normalized = normalizeIdentifiers(ids, contract.normalization.identifierPattern);
  ok(normalized.length, "GPCRdb HTML parser found no PDB identifiers in the configured column.");
  return normalized;
}

async function loadContract(root) {
  const file = path.join(root, CONTRACT);
  const info = await lstat(file, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.size <= 2n * 1024n * 1024n, "V3 source contract must be one bounded, direct regular file.");
  const payload = await readFile(file);
  ok(payload.byteLength <= 2 * 1024 * 1024, "V3 source contract exceeds the byte cap after read.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  clean(CONTRACT, text);
  const contract = parseMetadataJson(CONTRACT, text);
  ok(contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.stage === "V3_CENSUS_IN_PROGRESS", "Unexpected v3 source contract.");
  ok(contract.retrieval.repeatCount === 2 && contract.snapshot.requiredFiles.length === 24, "V3 source contract is not frozen as expected.");
  return { contract, digest: sha(payload) };
}
async function bytes(response, limit) {
  ok(response.body, "HTTP response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    ok(total <= limit, `HTTP response exceeded the ${limit}-byte cap.`);
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
function requireMediaType(response, allowed, label) {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  ok(allowed.includes(mediaType), `${label} returned forbidden content type: ${contentType ?? "missing"}`);
  return contentType;
}
async function fetchOne({ url, method, headers, body, contract, fetchImpl, now, allowedMediaTypes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), contract.retrieval.timeoutMilliseconds);
  const startedUtc = now();
  const requested = requireHttpsUrl(url, `${method} endpoint`);
  try {
    const response = await fetchImpl(url, { method, headers, body, redirect: "error", signal: controller.signal });
    ok(response.ok, `${method} ${url} returned HTTP ${response.status}.`);
    ok(response.redirected !== true, `${method} ${url} redirected; redirects are forbidden.`);
    const finalUrl = response.url || url;
    const final = requireHttpsUrl(finalUrl, `${method} final URL`);
    ok(final.href === requested.href, `${method} ${url} did not return from the exact pinned endpoint.`);
    const contentType = requireMediaType(response, allowedMediaTypes, `${method} ${url}`);
    const payload = await bytes(response, contract.retrieval.maximumResponseBytes);
    ok(contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !finalUrl.toLowerCase().includes(fragment.toLowerCase())), `Retrieval redirected to a forbidden URL class: ${finalUrl}`);
    return { payload, record: {
      requestedUrl: url, finalUrl, method, startedUtc, completedUtc: now(), status: response.status,
      contentType, etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"), bytes: payload.byteLength, sha256: sha(payload),
    } };
  } finally { clearTimeout(timer); }
}

function exactCollectionEndpoint(url) {
  const parsed = requireHttpsUrl(url, "Source collection endpoint");
  if (parsed.hostname === "gpcrdb.org" && parsed.pathname === "/structure") parsed.pathname = "/structure/";
  return parsed.href;
}
async function put(root, relative, value) {
  const file = path.resolve(root, relative);
  ok(path.relative(root, file) && !path.relative(root, file).startsWith(".."), `Unsafe snapshot path: ${relative}`);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  clean(relative, new TextDecoder("utf-8", { fatal: true }).decode(payload));
  await writeFile(file, payload, { flag: "wx" });
}
async function files(root, current = "", result = []) {
  ok(current.split("/").filter(Boolean).length <= 4, "Snapshot directory nesting exceeded the four-level cap.");
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    ok(!entry.isSymbolicLink(), `Snapshot inventory contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) await files(root, relative, result);
    else result.push(relative);
    ok(result.length <= MAX_INVENTORY_FILES, `Snapshot inventory exceeded the ${MAX_INVENTORY_FILES}-file cap.`);
  }
  return result.sort();
}
function requestBody(contract, term) {
  return { query: { type: "terminal", service: contract.rcsb.service, parameters: { value: term } }, return_type: contract.rcsb.returnType,
    request_options: { paginate: contract.rcsb.pagination, results_content_type: contract.rcsb.resultsContentType } };
}

export async function collectSourceUniverse({ repositoryRoot = ROOT, outputDirectory, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  ok(outputDirectory && typeof fetchImpl === "function", "Output directory and fetch implementation are required.");
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const output = path.resolve(outputDirectory);
  const outputParent = path.dirname(output);
  ok(await realpath(outputParent) === path.resolve(outputParent), "Output parent cannot contain symlinked ancestors.");
  await mkdir(output, { recursive: false });
  const { contract, digest: contractSha256 } = await loadContract(root);
  const collectionStartedUtc = now();
  const sourceRecords = [];
  const queries = new Map();

  for (const query of contract.rcsb.queries) {
    const repeats = [];
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      const body = `${canonical(requestBody(contract, query.term))}\n`;
      const response = await fetchOne({ url: contract.rcsb.endpoint, method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": contract.retrieval.userAgent }, body, contract, fetchImpl, now, allowedMediaTypes: ["application/json"] });
      const rawFile = `raw/rcsb-${query.id}-${repeat}.json`;
      await put(output, rawFile, response.payload);
      const ids = parseRcsbIds(new TextDecoder().decode(response.payload), contract);
      repeats.push(ids);
      sourceRecords.push({ sourceId: `rcsb-${query.id}`, queryId: query.id, term: query.term, repeat, rawFile, requestBodySha256: sha(Buffer.from(body)), ...response.record, normalized: summary(ids) });
    }
    ok(serialize(repeats[0]) === serialize(repeats[1]), `RCSB normalized repeat disagreement for query ${query.id}.`);
    queries.set(query.id, repeats[0]);
    await put(output, `normalized/rcsb-${query.id}.txt`, serialize(repeats[0]));
  }

  async function repeated(sourceId, endpoint, accept, parser, extension) {
    const repeats = [];
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      const allowedMediaTypes = extension === "json" ? ["application/json"] : ["text/html", "application/xhtml+xml"];
      const response = await fetchOne({ url: endpoint, method: "GET", headers: { accept, "user-agent": contract.retrieval.userAgent }, contract, fetchImpl, now, allowedMediaTypes });
      const rawFile = `raw/${sourceId}-${repeat}.${extension}`;
      await put(output, rawFile, response.payload);
      const ids = parser(new TextDecoder("utf-8", { fatal: true }).decode(response.payload), contract);
      repeats.push(ids);
      sourceRecords.push({ sourceId, repeat, rawFile, ...response.record, normalized: summary(ids) });
    }
    ok(serialize(repeats[0]) === serialize(repeats[1]), `${sourceId === "gpcrdb-api" ? "GPCRdb API" : "GPCRdb HTML"} normalized repeat disagreement.`);
    return repeats[0];
  }

  const gpcrdbApi = await repeated("gpcrdb-api", exactCollectionEndpoint(contract.gpcrdb.apiEndpoint), "application/json", parseGpcrdbApiIds, "json");
  const gpcrdbHtml = await repeated("gpcrdb-html", exactCollectionEndpoint(contract.gpcrdb.htmlEndpoint), "text/html,application/xhtml+xml", parseGpcrdbHtmlIds, "html");
  await put(output, "normalized/gpcrdb-api.txt", serialize(gpcrdbApi));
  await put(output, "normalized/gpcrdb-html.txt", serialize(gpcrdbHtml));

  const rcsbUnion = union([...queries.values()]);
  const intersection = intersect(rcsbUnion, gpcrdbApi);
  await put(output, "normalized/rcsb-union.txt", serialize(rcsbUnion));
  await put(output, "normalized/rcsb-gpcrdb-intersection.txt", serialize(intersection));
  const htmlSet = new Set(gpcrdbHtml);
  const universe = intersection.map((pdbId) => ({
    pdbId,
    rcsbQueryIds: [...queries].filter(([, ids]) => ids.includes(pdbId)).map(([id]) => id),
    presentInGpcrdbApi: true,
    presentInGpcrdbHtml: htmlSet.has(pdbId),
    dispositionStatus: "PENDING_DISPOSITION",
    nativeCoordinatesInspected: false,
  }));
  await put(output, "source-universe.jsonl", universe.length ? `${universe.map(canonical).join("\n")}\n` : "");

  const onlyInApi = difference(gpcrdbApi, gpcrdbHtml);
  const onlyInHtml = difference(gpcrdbHtml, gpcrdbApi);
  const crossCheck = onlyInApi.length === 0 && onlyInHtml.length === 0;
  const normalized = {
    rcsbQueries: Object.fromEntries([...queries].map(([id, ids]) => [id, summary(ids)])),
    rcsbUnion: summary(rcsbUnion), gpcrdbApi: summary(gpcrdbApi), gpcrdbHtml: summary(gpcrdbHtml), intersection: summary(intersection),
  };
  const old = contract.historicalReferenceOnly;
  const manifest = {
    schemaVersion: "1.0.0", studyId: contract.studyId, stage: contract.stage,
    status: crossCheck ? "SOURCE_UNIVERSE_CAPTURED_BLOCKED_PENDING_DISPOSITIONS" : "SOURCE_UNIVERSE_CAPTURED_BLOCKED_SOURCE_CROSSCHECK_AND_PENDING_DISPOSITIONS",
    sourceContract: CONTRACT, sourceContractSha256: contractSha256, collectionStartedUtc, collectionCompletedUtc: now(), sourceRecords, normalized,
    gpcrdbCrossCheck: { pass: crossCheck, policy: contract.gpcrdb.crossCheckPolicy, onlyInApi, onlyInApiSha256: summary(onlyInApi).sha256, onlyInHtml, onlyInHtmlSha256: summary(onlyInHtml).sha256 },
    historicalReferenceComparison: {
      rcsbQueries: Object.fromEntries(contract.rcsb.queries.map(({ id }) => [id, { countMatches: normalized.rcsbQueries[id].count === old.rcsbQueryCounts[id], digestMatches: normalized.rcsbQueries[id].sha256 === old.rcsbQueryDigests[id] }])),
      rcsbUnion: { countMatches: normalized.rcsbUnion.count === old.rcsbUnionCount, digestMatches: normalized.rcsbUnion.sha256 === old.rcsbUnionDigest },
      gpcrdbApi: { countMatches: normalized.gpcrdbApi.count === old.gpcrdbCount, digestMatches: normalized.gpcrdbApi.sha256 === old.gpcrdbDigest },
      intersection: { countMatches: normalized.intersection.count === old.intersectionCount, digestMatches: normalized.intersection.sha256 === old.intersectionDigest },
    },
    dispositionLedgerComplete: false, leakageGraphComplete: false, formallyClearedGroupCount: 0, exactFrozenTargetSetExists: false,
    targetFreezePermitted: false, prelabelSealCreated: false, userApproved: false, executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false,
  };
  await put(output, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await put(output, "summary.md", [
    "# ConfoVHH hard-decoy v3 metadata source snapshot", "", `Status: **${manifest.status}**`, "",
    `- RCSB four-query union: ${normalized.rcsbUnion.count} entries; SHA-256 \`${normalized.rcsbUnion.sha256}\``,
    `- GPCRdb API inventory: ${normalized.gpcrdbApi.count} entries; SHA-256 \`${normalized.gpcrdbApi.sha256}\``,
    `- GPCRdb HTML cross-check: ${normalized.gpcrdbHtml.count} entries; SHA-256 \`${normalized.gpcrdbHtml.sha256}\``,
    `- RCSB/GPCRdb API intersection: ${normalized.intersection.count} entries; SHA-256 \`${normalized.intersection.sha256}\``,
    `- GPCRdb API/HTML exact normalized agreement: ${crossCheck ? "PASS" : "BLOCKED"}`, "",
    "Every intersection entry remains pending an auditable disposition and leakage analysis. This metadata snapshot cannot authorize target freeze or execution.", "",
    "No holdout coordinate, native relative pose, DockQ/CAPRI label, ConfoVHH holdout score, or performance result was accessed by this collector.", "",
  ].join("\n"));

  const expected = contract.snapshot.requiredFiles.filter((file) => file !== "checksums.sha256").sort();
  ok(JSON.stringify(await files(output)) === JSON.stringify(expected), "Collector output inventory drifted before checksum creation.");
  await put(output, "checksums.sha256", `${(await Promise.all(expected.map(async (file) => `${sha(await readFile(path.join(output, file)))}  ${file}`))).join("\n")}\n`);
  return { ...await verifySourceUniverse({ repositoryRoot: root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifySourceUniverse({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "A snapshot directory is required.");
  const root = await realpath(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(root === path.resolve(repositoryRoot) && snapshot === path.resolve(snapshotDirectory), "Repository or snapshot path contains symlinked ancestors.");
  const { contract, digest: contractSha256 } = await loadContract(root);
  const expected = [...contract.snapshot.requiredFiles].sort();
  ok(JSON.stringify(await files(snapshot)) === JSON.stringify(expected), "Source snapshot does not match the exact file allowlist.");
  const expectedPayloads = expected.filter((file) => file !== "checksums.sha256");
  const allowed = new Set(expected);
  async function readAllowed(relative, maximum = contract.retrieval.maximumResponseBytes) {
    ok(allowed.has(relative), `Snapshot path is outside the exact allowlist: ${relative}`);
    const file = path.resolve(snapshot, relative);
    ok(path.relative(snapshot, file) === relative, `Snapshot path resolution drifted: ${relative}`);
    const fileInfo = await lstat(file, { bigint: true });
    ok(fileInfo.isFile() && !fileInfo.isSymbolicLink() && fileInfo.nlink === 1n, `Snapshot file must be direct and unaliased: ${relative}`);
    ok(fileInfo.size <= BigInt(maximum), `Snapshot file exceeds byte cap: ${relative}`);
    const payload = await readFile(file);
    ok(payload.byteLength <= maximum, `Snapshot file exceeds byte cap after read: ${relative}`);
    return payload;
  }
  const checksumText = new TextDecoder("utf-8", { fatal: true }).decode(await readAllowed("checksums.sha256", MAX_CHECKSUM_BYTES));
  clean("checksums.sha256", checksumText);
  ok(checksumText.endsWith("\n"), "Source checksums must end with LF.");
  const rows = checksumText.trimEnd().split("\n");
  ok(rows.length === expectedPayloads.length, "Source checksum row count does not match the exact allowlist.");
  const parsedRows = rows.map((row) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    ok(match, `Invalid source checksum row: ${row}`);
    return { digest: match[1], relative: match[2] };
  });
  ok(new Set(parsedRows.map(({ relative }) => relative)).size === parsedRows.length, "Source checksum paths must be unique.");
  ok(JSON.stringify(parsedRows.map(({ relative }) => relative).sort()) === JSON.stringify(expectedPayloads), "Source checksum paths must exactly match the allowlist before payload access.");
  const covered = new Map();
  const coveredBytes = new Map();
  for (const { digest, relative } of parsedRows) {
    const payload = await readAllowed(relative);
    ok(sha(payload) === digest, `Source checksum mismatch: ${relative}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    clean(relative, text);
    covered.set(relative, text);
    coveredBytes.set(relative, payload);
  }
  ok(JSON.stringify([...covered.keys()].sort()) === JSON.stringify(expectedPayloads), "Source checksum coverage is incomplete.");

  const queryMap = new Map();
  for (const query of contract.rcsb.queries) {
    const repeats = [1, 2].map((repeat) => parseRcsbIds(covered.get(`raw/rcsb-${query.id}-${repeat}.json`), contract));
    ok(serialize(repeats[0]) === serialize(repeats[1]), `RCSB repeat disagreement in snapshot: ${query.id}`);
    ok(covered.get(`normalized/rcsb-${query.id}.txt`) === serialize(repeats[0]), `RCSB normalized file mismatch: ${query.id}`);
    queryMap.set(query.id, repeats[0]);
  }
  const apiRepeats = [1, 2].map((repeat) => parseGpcrdbApiIds(covered.get(`raw/gpcrdb-api-${repeat}.json`), contract));
  const htmlRepeats = [1, 2].map((repeat) => parseGpcrdbHtmlIds(covered.get(`raw/gpcrdb-html-${repeat}.html`), contract));
  ok(serialize(apiRepeats[0]) === serialize(apiRepeats[1]), "GPCRdb API repeats disagree in snapshot.");
  ok(serialize(htmlRepeats[0]) === serialize(htmlRepeats[1]), "GPCRdb HTML repeats disagree in snapshot.");
  const gpcrdbApi = apiRepeats[0], gpcrdbHtml = htmlRepeats[0];
  ok(covered.get("normalized/gpcrdb-api.txt") === serialize(gpcrdbApi), "GPCRdb API normalized file mismatch.");
  ok(covered.get("normalized/gpcrdb-html.txt") === serialize(gpcrdbHtml), "GPCRdb HTML normalized file mismatch.");
  const rcsbUnion = union([...queryMap.values()]);
  const intersection = intersect(rcsbUnion, gpcrdbApi);
  ok(covered.get("normalized/rcsb-union.txt") === serialize(rcsbUnion), "RCSB union normalized file mismatch.");
  ok(covered.get("normalized/rcsb-gpcrdb-intersection.txt") === serialize(intersection), "RCSB/GPCRdb intersection normalized file mismatch.");

  const manifest = parseMetadataJson("source snapshot manifest.json", covered.get("manifest.json"));
  ok(manifest.schemaVersion === "1.0.0" && manifest.studyId === contract.studyId && manifest.stage === contract.stage && manifest.sourceContract === CONTRACT && manifest.sourceContractSha256 === contractSha256, "Source manifest contract binding drifted.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) ok(manifest[field] === false, `Source manifest blocked-state field drifted: ${field}`);
  ok(manifest.formallyClearedGroupCount === 0 && manifest.sourceRecords.length === 12, "Source manifest improperly claims clearance or lacks repeated provenance.");
  const provenance = new Map();
  for (const record of manifest.sourceRecords) {
    const key = `${record.sourceId}\0${record.repeat}`;
    ok(!provenance.has(key), `Duplicate source provenance record: ${record.sourceId} repeat ${record.repeat}`);
    provenance.set(key, record);
  }
  function verifyRecord(record, { sourceId, repeat, rawFile, endpoint, method, normalizedValues, requestBodySha256 = undefined, queryId = undefined, term = undefined, allowedMediaTypes, historicalRedirect = undefined }) {
    ok(record && record.sourceId === sourceId && record.repeat === repeat && record.rawFile === rawFile, `Source provenance mapping drifted: ${sourceId} repeat ${repeat}`);
    if (queryId !== undefined) ok(record.queryId === queryId && record.term === term, `RCSB query provenance drifted: ${queryId} repeat ${repeat}`);
    if (requestBodySha256 !== undefined) ok(record.requestBodySha256 === requestBodySha256, `RCSB request-body digest drifted: ${queryId} repeat ${repeat}`);
    const exactEndpoint = exactCollectionEndpoint(endpoint);
    const exactRequest = record.requestedUrl === exactEndpoint && record.finalUrl === exactEndpoint;
    const frozenLegacyRequest = historicalRedirect !== undefined && record.requestedUrl === historicalRedirect.requestedUrl && record.finalUrl === historicalRedirect.finalUrl;
    ok((exactRequest || frozenLegacyRequest) && record.method === method && record.status === 200, `Source request provenance drifted: ${sourceId} repeat ${repeat}`);
    const requested = requireHttpsUrl(record.requestedUrl, `${sourceId} requested URL`);
    const final = requireHttpsUrl(record.finalUrl, `${sourceId} final URL`);
    ok((final.href === requested.href || frozenLegacyRequest) && contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !record.finalUrl.toLowerCase().includes(fragment.toLowerCase())), `Source final URL escaped its exact pinned endpoint: ${sourceId} repeat ${repeat}`);
    const mediaType = String(record.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
    ok(allowedMediaTypes.includes(mediaType), `Source provenance has forbidden content type: ${sourceId} repeat ${repeat}`);
    const payload = coveredBytes.get(rawFile);
    ok(record.bytes === payload.byteLength && record.sha256 === sha(payload), `Source raw-byte provenance drifted: ${rawFile}`);
    ok(JSON.stringify(record.normalized) === JSON.stringify(summary(normalizedValues)), `Source normalized provenance drifted: ${sourceId} repeat ${repeat}`);
    const started = Date.parse(record.startedUtc), completed = Date.parse(record.completedUtc);
    ok(Number.isFinite(started) && Number.isFinite(completed) && completed >= started, `Source request timestamps are invalid: ${sourceId} repeat ${repeat}`);
    ok(record.etag === null || typeof record.etag === "string", `Source ETag provenance is invalid: ${sourceId} repeat ${repeat}`);
    ok(record.lastModified === null || typeof record.lastModified === "string", `Source Last-Modified provenance is invalid: ${sourceId} repeat ${repeat}`);
  }
  for (const query of contract.rcsb.queries) {
    const body = `${canonical(requestBody(contract, query.term))}\n`;
    for (const repeat of [1, 2]) verifyRecord(provenance.get(`rcsb-${query.id}\0${repeat}`), {
      sourceId: `rcsb-${query.id}`, repeat, rawFile: `raw/rcsb-${query.id}-${repeat}.json`, endpoint: contract.rcsb.endpoint,
      method: "POST", normalizedValues: queryMap.get(query.id), requestBodySha256: sha(Buffer.from(body)), queryId: query.id, term: query.term,
      allowedMediaTypes: ["application/json"],
    });
  }
  for (const repeat of [1, 2]) {
    verifyRecord(provenance.get(`gpcrdb-api\0${repeat}`), { sourceId: "gpcrdb-api", repeat, rawFile: `raw/gpcrdb-api-${repeat}.json`, endpoint: contract.gpcrdb.apiEndpoint, method: "GET", normalizedValues: gpcrdbApi, allowedMediaTypes: ["application/json"] });
    verifyRecord(provenance.get(`gpcrdb-html\0${repeat}`), {
      sourceId: "gpcrdb-html", repeat, rawFile: `raw/gpcrdb-html-${repeat}.html`, endpoint: contract.gpcrdb.htmlEndpoint, method: "GET", normalizedValues: gpcrdbHtml,
      allowedMediaTypes: ["text/html", "application/xhtml+xml"],
      historicalRedirect: { requestedUrl: "https://gpcrdb.org/structure", finalUrl: "https://gpcrdb.org/structure/" },
    });
  }
  const observed = { rcsbUnion: summary(rcsbUnion), gpcrdbApi: summary(gpcrdbApi), gpcrdbHtml: summary(gpcrdbHtml), intersection: summary(intersection) };
  for (const key of Object.keys(observed)) ok(JSON.stringify(manifest.normalized[key]) === JSON.stringify(observed[key]), `Manifest normalized summary mismatch: ${key}`);
  for (const [queryId, values] of queryMap) ok(JSON.stringify(manifest.normalized.rcsbQueries?.[queryId]) === JSON.stringify(summary(values)), `Manifest normalized query summary mismatch: ${queryId}`);
  const onlyInApi = difference(gpcrdbApi, gpcrdbHtml), onlyInHtml = difference(gpcrdbHtml, gpcrdbApi);
  const crossCheck = !onlyInApi.length && !onlyInHtml.length;
  ok(manifest.gpcrdbCrossCheck.pass === crossCheck && manifest.gpcrdbCrossCheck.policy === contract.gpcrdb.crossCheckPolicy
    && JSON.stringify(manifest.gpcrdbCrossCheck.onlyInApi) === JSON.stringify(onlyInApi) && manifest.gpcrdbCrossCheck.onlyInApiSha256 === summary(onlyInApi).sha256
    && JSON.stringify(manifest.gpcrdbCrossCheck.onlyInHtml) === JSON.stringify(onlyInHtml) && manifest.gpcrdbCrossCheck.onlyInHtmlSha256 === summary(onlyInHtml).sha256,
  "GPCRdb cross-check ledger mismatch.");
  ok(manifest.status === (crossCheck ? "SOURCE_UNIVERSE_CAPTURED_BLOCKED_PENDING_DISPOSITIONS" : "SOURCE_UNIVERSE_CAPTURED_BLOCKED_SOURCE_CROSSCHECK_AND_PENDING_DISPOSITIONS"), "Source snapshot status drifted.");
  const collectionStarted = Date.parse(manifest.collectionStartedUtc), collectionCompleted = Date.parse(manifest.collectionCompletedUtc);
  ok(Number.isFinite(collectionStarted) && Number.isFinite(collectionCompleted) && collectionCompleted >= collectionStarted, "Source manifest collection timestamps are invalid.");
  ok(manifest.sourceRecords.every((record) => Date.parse(record.startedUtc) >= collectionStarted && Date.parse(record.completedUtc) <= collectionCompleted), "Source request timestamps fall outside the manifest collection interval.");
  const historical = manifest.historicalReferenceComparison;
  for (const query of contract.rcsb.queries) {
    const observedQuery = manifest.normalized.rcsbQueries[query.id];
    ok(historical.rcsbQueries?.[query.id]?.countMatches === (observedQuery.count === contract.historicalReferenceOnly.rcsbQueryCounts[query.id])
      && historical.rcsbQueries?.[query.id]?.digestMatches === (observedQuery.sha256 === contract.historicalReferenceOnly.rcsbQueryDigests[query.id]),
    `Historical query comparison drifted: ${query.id}`);
  }
  for (const [key, countField, digestField] of [["rcsbUnion", "rcsbUnionCount", "rcsbUnionDigest"], ["gpcrdbApi", "gpcrdbCount", "gpcrdbDigest"], ["intersection", "intersectionCount", "intersectionDigest"]]) {
    ok(historical[key]?.countMatches === (manifest.normalized[key].count === contract.historicalReferenceOnly[countField])
      && historical[key]?.digestMatches === (manifest.normalized[key].sha256 === contract.historicalReferenceOnly[digestField]),
    `Historical source comparison drifted: ${key}`);
  }

  const universeText = covered.get("source-universe.jsonl");
  const universe = universeText ? universeText.trimEnd().split("\n").map((line, index) => (
    parseMetadataJson(`source-universe.jsonl row ${index + 1}`, line)
  )) : [];
  ok(universeText === (universe.length ? `${universe.map(canonical).join("\n")}\n` : ""), "Source-universe JSONL is not canonical.");
  ok(JSON.stringify(universe.map((row) => row.pdbId)) === JSON.stringify(intersection), "Source-universe IDs drifted from the intersection.");
  const htmlSet = new Set(gpcrdbHtml);
  for (const row of universe) {
    ok(row.presentInGpcrdbApi === true && row.presentInGpcrdbHtml === htmlSet.has(row.pdbId), `${row.pdbId} GPCRdb membership drifted.`);
    ok(row.dispositionStatus === "PENDING_DISPOSITION" && row.nativeCoordinatesInspected === false, `${row.pdbId} improperly claims disposition or coordinate access.`);
    ok(JSON.stringify(row.rcsbQueryIds) === JSON.stringify([...queryMap].filter(([, ids]) => ids.includes(row.pdbId)).map(([id]) => id)), `${row.pdbId} query membership drifted.`);
  }
  return {
    status: manifest.status,
    rcsbQueryCounts: Object.fromEntries([...queryMap].map(([id, ids]) => [id, ids.length])),
    rcsbUnionCount: rcsbUnion.length, gpcrdbApiCount: gpcrdbApi.length, gpcrdbHtmlCount: gpcrdbHtml.length,
    intersectionCount: intersection.length, gpcrdbCrossCheckPass: crossCheck, pendingDispositionRows: universe.length,
    formallyClearedGroups: 0, targetFreezePermitted: false, nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false, executionAuthorized: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory, rootArg] = process.argv.slice(2);
  try {
    ok(["collect", "verify"].includes(command) && directory, "Usage: v3-source-universe.mjs collect|verify <directory> [repository-root]");
    const repositoryRoot = rootArg ? path.resolve(rootArg) : ROOT;
    const result = command === "collect"
      ? await collectSourceUniverse({ repositoryRoot, outputDirectory: path.resolve(directory) })
      : await verifySourceUniverse({ repositoryRoot, snapshotDirectory: path.resolve(directory) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
