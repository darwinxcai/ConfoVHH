import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT = "validation/hard-decoy-holdout-v3/prelabel-census-draft/source-query-contract.json";
const COORD = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;

function ok(value, message) { if (!value) throw new Error(message); }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function clean(name, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${name}.`);
  ok(!COORD.test(text), `Coordinate payload appeared in ${name}.`);
  ok(!LABEL.test(text), `Observed holdout-label assignment appeared in ${name}.`);
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

export function normalizeIdentifiers(values, pattern = "^[0-9][A-Z0-9]{3}$") {
  const regex = new RegExp(pattern, "u");
  return sorted(values.map((value) => String(value ?? "").trim().toUpperCase()).filter((value) => regex.test(value)));
}
export function serializeIdentifiers(values) { return serialize(values); }
export function parseRcsbIds(text, contract) {
  const json = JSON.parse(text);
  ok(Array.isArray(json.result_set), "RCSB response lacks result_set.");
  return normalizeIdentifiers(json.result_set.map((row) => row?.identifier), contract.normalization.identifierPattern);
}
export function parseGpcrdbApiIds(text, contract) {
  const json = JSON.parse(text);
  const rows = Array.isArray(json) ? json : json?.results;
  ok(Array.isArray(rows), "GPCRdb API response is not an array.");
  return normalizeIdentifiers(rows.map((row) => row?.[contract.gpcrdb.pdbCodeField]), contract.normalization.identifierPattern);
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
  const text = await readFile(path.join(root, CONTRACT), "utf8");
  clean(CONTRACT, text);
  const contract = JSON.parse(text);
  ok(contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.stage === "V3_CENSUS_IN_PROGRESS", "Unexpected v3 source contract.");
  ok(contract.retrieval.repeatCount === 2 && contract.snapshot.requiredFiles.length === 24, "V3 source contract is not frozen as expected.");
  return { contract, digest: sha(Buffer.from(text)) };
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
async function fetchOne({ url, method, headers, body, contract, fetchImpl, now }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), contract.retrieval.timeoutMilliseconds);
  const startedUtc = now();
  try {
    const response = await fetchImpl(url, { method, headers, body, redirect: "follow", signal: controller.signal });
    ok(response.ok, `${method} ${url} returned HTTP ${response.status}.`);
    const payload = await bytes(response, contract.retrieval.maximumResponseBytes);
    const finalUrl = response.url || url;
    ok(contract.blindBoundary.forbiddenUrlFragments.every((fragment) => !finalUrl.toLowerCase().includes(fragment.toLowerCase())), `Retrieval redirected to a forbidden URL class: ${finalUrl}`);
    return { payload, record: {
      requestedUrl: url, finalUrl, method, startedUtc, completedUtc: now(), status: response.status,
      contentType: response.headers.get("content-type"), etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"), bytes: payload.byteLength, sha256: sha(payload),
    } };
  } finally { clearTimeout(timer); }
}
async function put(root, relative, value) {
  const file = path.resolve(root, relative);
  ok(path.relative(root, file) && !path.relative(root, file).startsWith(".."), `Unsafe snapshot path: ${relative}`);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  clean(relative, new TextDecoder("utf-8", { fatal: true }).decode(payload));
  await writeFile(file, payload, { flag: "wx" });
}
async function files(root, current = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) result.push(...await files(root, relative));
    else result.push(relative);
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
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const { contract, digest: contractSha256 } = await loadContract(root);
  const collectionStartedUtc = now();
  const sourceRecords = [];
  const queries = new Map();

  for (const query of contract.rcsb.queries) {
    const repeats = [];
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      const body = `${canonical(requestBody(contract, query.term))}\n`;
      const response = await fetchOne({ url: contract.rcsb.endpoint, method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": contract.retrieval.userAgent }, body, contract, fetchImpl, now });
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
      const response = await fetchOne({ url: endpoint, method: "GET", headers: { accept, "user-agent": contract.retrieval.userAgent }, contract, fetchImpl, now });
      const rawFile = `raw/${sourceId}-${repeat}.${extension}`;
      await put(output, rawFile, response.payload);
      const ids = parser(new TextDecoder("utf-8", { fatal: true }).decode(response.payload), contract);
      repeats.push(ids);
      sourceRecords.push({ sourceId, repeat, rawFile, ...response.record, normalized: summary(ids) });
    }
    ok(serialize(repeats[0]) === serialize(repeats[1]), `${sourceId === "gpcrdb-api" ? "GPCRdb API" : "GPCRdb HTML"} normalized repeat disagreement.`);
    return repeats[0];
  }

  const gpcrdbApi = await repeated("gpcrdb-api", contract.gpcrdb.apiEndpoint, "application/json", parseGpcrdbApiIds, "json");
  const gpcrdbHtml = await repeated("gpcrdb-html", contract.gpcrdb.htmlEndpoint, "text/html,application/xhtml+xml", parseGpcrdbHtmlIds, "html");
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
  const checksumText = await readFile(path.join(snapshot, "checksums.sha256"), "utf8");
  clean("checksums.sha256", checksumText);
  const rows = checksumText.trimEnd().split("\n");
  const covered = new Map();
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    ok(match && !covered.has(match[2]), `Invalid or duplicate source checksum row: ${row}`);
    const fileInfo = await lstat(path.join(snapshot, match[2]), { bigint: true });
    ok(fileInfo.isFile() && !fileInfo.isSymbolicLink() && fileInfo.nlink === 1n, `Snapshot file must be direct and unaliased: ${match[2]}`);
    const payload = await readFile(path.join(snapshot, match[2]));
    ok(payload.byteLength <= contract.retrieval.maximumResponseBytes, `Snapshot file exceeds byte cap: ${match[2]}`);
    ok(sha(payload) === match[1], `Source checksum mismatch: ${match[2]}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    clean(match[2], text);
    covered.set(match[2], text);
  }
  ok(JSON.stringify([...covered.keys()].sort()) === JSON.stringify(expected.filter((file) => file !== "checksums.sha256")), "Source checksum coverage is incomplete.");

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

  const manifest = JSON.parse(covered.get("manifest.json"));
  ok(manifest.studyId === contract.studyId && manifest.stage === contract.stage && manifest.sourceContractSha256 === contractSha256, "Source manifest contract binding drifted.");
  for (const field of ["dispositionLedgerComplete", "leakageGraphComplete", "exactFrozenTargetSetExists", "targetFreezePermitted", "prelabelSealCreated", "userApproved", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) ok(manifest[field] === false, `Source manifest blocked-state field drifted: ${field}`);
  ok(manifest.formallyClearedGroupCount === 0 && manifest.sourceRecords.length === 12, "Source manifest improperly claims clearance or lacks repeated provenance.");
  const observed = { rcsbUnion: summary(rcsbUnion), gpcrdbApi: summary(gpcrdbApi), gpcrdbHtml: summary(gpcrdbHtml), intersection: summary(intersection) };
  for (const key of Object.keys(observed)) ok(JSON.stringify(manifest.normalized[key]) === JSON.stringify(observed[key]), `Manifest normalized summary mismatch: ${key}`);
  const onlyInApi = difference(gpcrdbApi, gpcrdbHtml), onlyInHtml = difference(gpcrdbHtml, gpcrdbApi);
  const crossCheck = !onlyInApi.length && !onlyInHtml.length;
  ok(manifest.gpcrdbCrossCheck.pass === crossCheck && JSON.stringify(manifest.gpcrdbCrossCheck.onlyInApi) === JSON.stringify(onlyInApi) && JSON.stringify(manifest.gpcrdbCrossCheck.onlyInHtml) === JSON.stringify(onlyInHtml), "GPCRdb cross-check ledger mismatch.");
  ok(manifest.status === (crossCheck ? "SOURCE_UNIVERSE_CAPTURED_BLOCKED_PENDING_DISPOSITIONS" : "SOURCE_UNIVERSE_CAPTURED_BLOCKED_SOURCE_CROSSCHECK_AND_PENDING_DISPOSITIONS"), "Source snapshot status drifted.");

  const universeText = covered.get("source-universe.jsonl");
  const universe = universeText ? universeText.trimEnd().split("\n").map(JSON.parse) : [];
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
