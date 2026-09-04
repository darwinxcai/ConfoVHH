import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGpcrdbApiIds, serializeIdentifiers } from "../hard-decoy/v3-source-universe.mjs";
import { canonical, parseGraphqlResponse } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const OUTPUT = "validation/hard-decoy-holdout-v3/gpcrdb-recent-delta-2026-09-04";
const BASE = "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29";
const SOURCE_CONTRACT = "validation/hard-decoy-holdout-v3/prelabel-census-draft/source-query-contract.json";
const ENTRY_CONTRACT = "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json";
const GPCRDB = "https://gpcrdb.org/services/structure/";
const RCSB = "https://data.rcsb.org/graphql";
const CUTOFF = "2026-08-29T23:59:59.999Z";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows) => rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
const sorted = (values) => [...new Set(values)].sort();
const equal = (a, b) => canonical(a) === canonical(b);

async function inputs(root) {
  const paths = [SOURCE_CONTRACT, ENTRY_CONTRACT, `${BASE}/normalized/gpcrdb-api.txt`, `${BASE}/raw/gpcrdb-api-1.json`];
  const files = Object.fromEntries(await Promise.all(paths.map(async (name) => [name, await readFile(path.join(root, name), "utf8")])));
  const sourceContract = JSON.parse(files[SOURCE_CONTRACT]);
  const entryContract = JSON.parse(files[ENTRY_CONTRACT]);
  assert.equal(entryContract.rcsb.endpoint, RCSB);
  const queryPath = entryContract.rcsb.queryFile;
  files[queryPath] = await readFile(path.join(root, queryPath), "utf8");
  assert.equal(sha(files[queryPath]), entryContract.rcsb.querySha256, "Pinned metadata query changed");
  const baselineIds = parseGpcrdbApiIds(files[`${BASE}/raw/gpcrdb-api-1.json`], sourceContract);
  assert.equal(serializeIdentifiers(baselineIds), files[`${BASE}/normalized/gpcrdb-api.txt`]);
  return { sourceContract, entryContract, baselineIds, baselineRows: JSON.parse(files[`${BASE}/raw/gpcrdb-api-1.json`]), query: files[queryPath], inputDigests: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha(text)])) };
}

async function inventory(directory, prefix = "") {
  const out = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `Symlink in snapshot: ${name}`);
    if (entry.isDirectory()) out.push(...await inventory(directory, name));
    else { assert(entry.isFile(), `Non-file in snapshot: ${name}`); out.push(name); }
  }
  return out.sort();
}

async function capture({ endpoint, body, name, output, repeat, ids, fetchImpl, now }) {
  assert([GPCRDB, RCSB].includes(endpoint));
  const record = { endpoint, method: body === undefined ? "GET" : "POST", repeat, requestedIds: ids ?? null, requestBodySha256: body === undefined ? null : sha(body), startedAt: now(), finishedAt: null, status: null, finalUrl: null, redirected: null, headers: null, rawFile: name, responseByteCount: 0, responseSha256: null, bodyRepresentation: "fetch-decoded-response-bytes", error: null };
  let payload = Buffer.alloc(0);
  try {
    const response = await fetchImpl(endpoint, { method: record.method, body, redirect: "error", signal: AbortSignal.timeout(90000), headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), "user-agent": "ConfoVHH-metadata-recent-delta/1.0 (+https://github.com/darwinxcai/ConfoVHH)" } });
    record.status = response.status;
    record.finalUrl = response.url || endpoint;
    record.redirected = response.redirected;
    record.headers = Object.fromEntries(["date", "content-type", "content-length", "content-encoding", "etag", "last-modified"].map((key) => [key, response.headers.get(key)]));
    assert.equal(record.finalUrl, endpoint, "Unexpected response endpoint");
    assert.equal(response.redirected, false, "Redirected metadata response");
    assert(response.body, "Missing response body");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) { size += chunk.length; assert(size <= 16 * 1024 * 1024, "Metadata body exceeds 16 MiB"); chunks.push(chunk); }
    payload = Buffer.concat(chunks);
    assert(response.ok, `HTTP ${response.status}`);
    assert(/^application\/(?:json|[^;]+\+json)(?:;|$)/iu.test(record.headers["content-type"] ?? ""), "Non-JSON metadata response");
    new TextDecoder("utf8", { fatal: true }).decode(payload);
  } catch (error) { record.error = error.message; }
  record.finishedAt = now();
  record.responseByteCount = payload.length;
  record.responseSha256 = sha(payload);
  await writeFile(path.join(output, name), payload);
  return record;
}

function gpcrdbState(raw, records, sourceContract, baselineIds, baselineRows) {
  const repeats = [1, 2].map((repeat) => {
    const record = records.find((row) => row.endpoint === GPCRDB && row.repeat === repeat);
    if (!record || record.error) return { repeat, ids: null, rows: [], error: record?.error ?? "Missing request record" };
    try { return { repeat, ids: parseGpcrdbApiIds(raw.get(record.rawFile), sourceContract), rows: JSON.parse(raw.get(record.rawFile)), error: null }; }
    catch (error) { return { repeat, ids: null, rows: [], error: error.message }; }
  });
  const successful = repeats.filter((repeat) => repeat.ids !== null);
  const currentIds = sorted(successful.flatMap((repeat) => repeat.ids));
  const newIds = currentIds.filter((id) => !baselineIds.includes(id));
  const identifierRepeatAgreement = successful.length === 2 && equal(repeats[0].ids, repeats[1].ids);
  const maps = repeats.map((repeat) => new Map(repeat.rows.map((row) => [row.pdb_code, row])));
  const baseline = new Map(baselineRows.map((row) => [row.pdb_code, row]));
  const repeatMetadataChangedIds = identifierRepeatAgreement ? currentIds.filter((id) => !equal(maps[0].get(id), maps[1].get(id))) : [];
  const metadataChanges = currentIds.filter((id) => baseline.has(id)).flatMap((id) => repeats.filter((repeat) => repeat.ids?.includes(id)).filter((repeat) => !equal(baseline.get(id), maps[repeat.repeat - 1].get(id))).map((repeat) => ({ pdbId: id, repeat: repeat.repeat, changedFields: sorted([...Object.keys(baseline.get(id)), ...Object.keys(maps[repeat.repeat - 1].get(id))]).filter((key) => !equal(baseline.get(id)[key] ?? null, maps[repeat.repeat - 1].get(id)[key] ?? null)), baseline: baseline.get(id), current: maps[repeat.repeat - 1].get(id) })));
  return { repeats, maps, currentIds, newIds, identifierRepeatAgreement, repeatMetadataChangedIds, metadataChanges, removedIds: identifierRepeatAgreement ? baselineIds.filter((id) => !currentIds.includes(id)) : null };
}

export function deriveRecentDelta({ source, raw, records }) {
  const gp = gpcrdbState(raw, records, source.sourceContract, source.baselineIds, source.baselineRows);
  const rows = [];
  const normalized = [];
  for (const id of gp.newIds) {
    const attempts = [1, 2].map((repeat) => {
      const record = records.find((row) => row.endpoint === RCSB && row.repeat === repeat && row.requestedIds?.includes(id));
      if (!record || record.error) return { repeat, error: record?.error ?? "Missing request", entry: null };
      try {
        const parsed = parseStrictJson(raw.get(record.rawFile), { maximumCharacters: 16 * 1024 * 1024, maximumTokens: 500000, maximumDepth: 64 });
        assert(parsed && typeof parsed === "object" && !Array.isArray(parsed), "Invalid GraphQL envelope");
        assert(Object.keys(parsed).every((key) => ["data", "errors"].includes(key)), "Unexpected GraphQL envelope fields");
        assert(!parsed.errors?.length, `GraphQL errors: ${canonical(parsed.errors)}`);
        assert(Array.isArray(parsed.data?.entries), "Missing GraphQL entries");
        assert.deepEqual(Object.keys(parsed.data), ["entries"], "Unexpected GraphQL data fields");
        const returnedIds = parsed.data.entries.filter((entry) => entry !== null).map((entry) => entry.rcsb_id);
        assert(returnedIds.every((returnedId) => record.requestedIds.includes(returnedId)), "Unexpected returned entry");
        assert.equal(new Set(returnedIds).size, returnedIds.length, "Duplicate returned entry");
        const matches = parsed.data.entries.filter((entry) => entry?.rcsb_id === id);
        assert.equal(matches.length, 1, matches.length === 0 ? "Entry omitted from response" : "Duplicate entry in response");
        const gpcrdbRow = gp.maps[repeat - 1].get(id) ?? gp.maps[0].get(id) ?? gp.maps[1].get(id);
        const entry = parseGraphqlResponse(JSON.stringify({ data: { entries: matches } }), { batchIndex: 1, ids: [id] }, new Map([[id, { pdbId: id, rcsbQueryIds: [] }]]), new Map([[id, gpcrdbRow]]), source.entryContract)[0];
        return { repeat, error: null, entry };
      } catch (error) { return { repeat, error: error.message, entry: null }; }
    });
    const valid = attempts.every((attempt) => !attempt.error);
    const agreement = valid && equal(attempts[0].entry, attempts[1].entry);
    const entry = agreement ? attempts[0].entry : null;
    if (entry) normalized.push(entry);
    const releaseDate = entry?.releaseDate ?? null;
    const releaseClass = releaseDate === null || !Number.isFinite(Date.parse(releaseDate)) ? "RELEASE_DATE_UNRESOLVED" : Date.parse(releaseDate) > Date.parse(CUTOFF) ? "PDB_RELEASE_AFTER_2026_08_29" : "OLDER_PDB_ENTRY_NEW_TO_GPCRDB_INDEX";
    rows.push({ pdbId: id, status: !valid ? "RCSB_METADATA_UNRESOLVED" : !agreement ? "REPEAT_METADATA_DISAGREEMENT" : "REPEATED_METADATA_CAPTURE_COMPLETE", releaseDate, releaseClass, attempts: attempts.map(({ repeat, error }) => ({ repeat, error })), metadataOnly: true, formalDispositionAssigned: false });
  }
  const unresolved = rows.filter((row) => row.status !== "REPEATED_METADATA_CAPTURE_COMPLETE");
  const summary = {
    schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", route: "C4_GPCRDB_INDEX_DELTA_PARTIAL_COVERAGE", baselineDirectory: BASE, baselineReferenceDate: "2026-08-29", releaseCutoffInclusive: CUTOFF,
    baselineEntryCount: source.baselineIds.length, currentObservedEntryCount: gp.currentIds.length, newIndexEntryCount: gp.newIds.length,
    removedIndexEntryCount: gp.removedIds?.length ?? null, changedExistingMetadataEntryCount: new Set(gp.metadataChanges.map((row) => row.pdbId)).size,
    gpcrdbIdentifierRepeatAgreement: gp.identifierRepeatAgreement, gpcrdbMetadataRepeatAgreement: gp.identifierRepeatAgreement && gp.repeatMetadataChangedIds.length === 0,
    gpcrdbRepeatFailures: gp.repeats.filter((repeat) => repeat.error).map(({ repeat, error }) => ({ repeat, error })),
    newEntryMetadataCompleteCount: normalized.length, newEntryMetadataUnresolvedCount: unresolved.length,
    newlyReleasedPdbEntryCount: rows.filter((row) => row.releaseClass === "PDB_RELEASE_AFTER_2026_08_29").length,
    olderPdbEntryNewToIndexCount: rows.filter((row) => row.releaseClass === "OLDER_PDB_ENTRY_NEW_TO_GPCRDB_INDEX").length,
    releaseDateUnresolvedCount: rows.filter((row) => row.releaseClass === "RELEASE_DATE_UNRESOLVED").length,
    observedIndexDeltaCaptureComplete: gp.identifierRepeatAgreement && gp.repeatMetadataChangedIds.length === 0 && unresolved.length === 0,
    allRecentPublicGpcrEntriesCovered: false, broaderDiscoveryComplete: false, formalWholeCensusAuthority: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED",
    nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false, executionAuthorized: false,
    interpretation: "Two metadata-only GPCRdb inventory captures are compared with the archived 2026-08-29 inventory. New index membership is distinct from first PDB release. GPCRdb indexing can lag or omit public GPCR structures, so this route alone cannot complete recent-release discovery, establish absence of VHHs, or authorize a census bound or study freeze."
  };
  return { summary, files: { "normalized/current-gpcrdb-ids.txt": serializeIdentifiers(gp.currentIds), "normalized/new-index-ids.txt": serializeIdentifiers(gp.newIds), "normalized/removed-index-ids.txt": serializeIdentifiers(gp.removedIds ?? []), "normalized/repeat-metadata-disagreement-ids.txt": serializeIdentifiers(gp.repeatMetadataChangedIds), "metadata-changes.jsonl": jsonl(gp.metadataChanges), "new-entry-status.jsonl": jsonl(rows), "new-entries.jsonl": jsonl(normalized), "summary.json": json(summary) } };
}

export async function collectRecentGpcrdbDelta({ repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUTPUT), fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const source = await inputs(repositoryRoot);
  await mkdir(outputDirectory, { recursive: false });
  await mkdir(path.join(outputDirectory, "raw"));
  await mkdir(path.join(outputDirectory, "normalized"));
  const records = [];
  const raw = new Map();
  for (const repeat of [1, 2]) {
    const record = await capture({ endpoint: GPCRDB, name: `raw/gpcrdb-api-${repeat}.json`, output: outputDirectory, repeat, fetchImpl, now });
    records.push(record); raw.set(record.rawFile, await readFile(path.join(outputDirectory, record.rawFile), "utf8"));
    await writeFile(path.join(outputDirectory, "response-records.json"), json(records));
  }
  const gp = gpcrdbState(raw, records, source.sourceContract, source.baselineIds, source.baselineRows);
  for (let offset = 0; offset < gp.newIds.length; offset += 25) {
    const ids = gp.newIds.slice(offset, offset + 25);
    const body = `${JSON.stringify({ query: source.query, variables: { ids } })}\n`;
    for (const repeat of [1, 2]) {
      const record = await capture({ endpoint: RCSB, body, name: `raw/rcsb-new-batch-${String(offset / 25 + 1).padStart(3, "0")}-${repeat}.json`, output: outputDirectory, repeat, ids, fetchImpl, now });
      records.push(record); raw.set(record.rawFile, await readFile(path.join(outputDirectory, record.rawFile), "utf8"));
      await writeFile(path.join(outputDirectory, "response-records.json"), json(records));
    }
  }
  const built = deriveRecentDelta({ source, raw, records });
  for (const [name, text] of Object.entries(built.files)) await writeFile(path.join(outputDirectory, name), text);
  await writeFile(path.join(outputDirectory, "manifest.json"), json({ schemaVersion: "1.0.0", createdAt: now(), inputDigests: source.inputDigests, generatorScript: path.relative(repositoryRoot, HERE), generatorScriptSha256: sha(await readFile(HERE)), gpcrdbEndpoint: GPCRDB, rcsbEndpoint: RCSB, requestRepeatCount: 2, networkRequests: records.length }));
  const s = built.summary;
  await writeFile(path.join(outputDirectory, "README.md"), `# GPCRdb recent inventory delta\n\nThis metadata-only package compares two current captures of [GPCRdb's structure inventory](${GPCRDB}) with the immutable 2026-08-29 snapshot.\n\n- Archived inventory: ${s.baselineEntryCount} entries. Current observed inventory: ${s.currentObservedEntryCount}.\n- New index entries: ${s.newIndexEntryCount}; removed entries: ${s.removedIndexEntryCount ?? "unresolved"}; existing entries with metadata changes: ${s.changedExistingMetadataEntryCount}.\n- First PDB release after 2026-08-29: ${s.newlyReleasedPdbEntryCount}; older PDB entries newly indexed: ${s.olderPdbEntryNewToIndexCount}; unresolved release dates: ${s.releaseDateUnresolvedCount}.\n- New entries with repeat-confirmed RCSB metadata: ${s.newEntryMetadataCompleteCount}; unresolved: ${s.newEntryMetadataUnresolvedCount}.\n- Both inventory identifier sets agree: ${s.gpcrdbIdentifierRepeatAgreement}; both full inventory metadata sets agree: ${s.gpcrdbMetadataRepeatAgreement}.\n\nRaw files preserve exact bytes returned by fetch after transport decoding. Response records retain request times, server dates, HTTP status, selected headers, request and response SHA-256 values, and failures. RCSB requests use the existing pinned metadata query with polymer sequences, chain identifiers and publication metadata. No coordinate files, rendered structures, relative poses or holdout labels were requested.\n\nThis is a partial recent-release discovery route. An unchanged GPCRdb index is not evidence that no new public GPCR structures exist: indexing can lag or omit entries. New index membership is not itself a new PDB release. An independent RCSB release-date/receptor search and the other reconstruction routes remain required. No target eligibility or exclusion is assigned here; the protocol remains DRAFT and its target-freeze gate remains BLOCKED.\n\nThe release cutoff means the end of 2026-08-29 UTC, not the precise retrieval instant of the historical inventory. Changed existing metadata and removals are retained separately and do not rewrite the old snapshot. If a capture fails or its identifier sets disagree, the removed-ID file is empty and the summary marks its count unresolved; it must not be interpreted as zero removals.\n\nReplay without network access:\n\n\`\`\`sh\nnode scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs verify\n\`\`\`\n\nA future collection requires a new, nonexistent output directory:\n\n\`\`\`sh\nnode scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs collect /absolute/path/to/new-snapshot\n\`\`\`\n`);
  const names = await inventory(outputDirectory);
  await writeFile(path.join(outputDirectory, "checksums.sha256"), (await Promise.all(names.map(async (name) => `${sha(await readFile(path.join(outputDirectory, name)))}  ${name}`))).join("\n") + "\n");
  return built.summary;
}

export async function verifyRecentGpcrdbDelta({ repositoryRoot = ROOT, snapshotDirectory = path.join(repositoryRoot, OUTPUT) } = {}) {
  const source = await inputs(repositoryRoot);
  const names = (await inventory(snapshotDirectory)).filter((name) => name !== "checksums.sha256");
  const checksums = (await readFile(path.join(snapshotDirectory, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  assert.equal(checksums.length, names.length);
  for (let index = 0; index < names.length; index++) assert.equal(checksums[index], `${sha(await readFile(path.join(snapshotDirectory, names[index])))}  ${names[index]}`, `Checksum or inventory mismatch: ${names[index]}`);
  const manifest = JSON.parse(await readFile(path.join(snapshotDirectory, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.inputDigests, source.inputDigests);
  assert.equal(manifest.generatorScriptSha256, sha(await readFile(HERE)));
  const records = JSON.parse(await readFile(path.join(snapshotDirectory, "response-records.json"), "utf8"));
  assert.equal(manifest.networkRequests, records.length);
  const raw = new Map();
  const seen = new Set();
  for (const record of records) {
    assert([GPCRDB, RCSB].includes(record.endpoint));
    assert([1, 2].includes(record.repeat));
    assert(/^raw\/[a-z0-9-]+\.json$/u.test(record.rawFile));
    assert(!seen.has(record.rawFile)); seen.add(record.rawFile);
    const bytes = await readFile(path.join(snapshotDirectory, record.rawFile));
    assert.equal(sha(bytes), record.responseSha256); assert.equal(bytes.length, record.responseByteCount);
    assert(Number.isFinite(Date.parse(record.startedAt)) && Number.isFinite(Date.parse(record.finishedAt)));
    assert(Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
    if (record.endpoint === GPCRDB) { assert.equal(record.method, "GET"); assert.equal(record.requestBodySha256, null); }
    else { assert.equal(record.method, "POST"); assert.equal(record.requestBodySha256, sha(`${JSON.stringify({ query: source.query, variables: { ids: record.requestedIds } })}\n`)); }
    if (!record.error) { assert(record.status >= 200 && record.status <= 299); assert.equal(record.finalUrl, record.endpoint); assert.equal(record.redirected, false); }
    raw.set(record.rawFile, bytes.toString("utf8"));
  }
  assert.deepEqual([...seen].sort(), names.filter((name) => name.startsWith("raw/")));
  const built = deriveRecentDelta({ source, raw, records });
  for (const [name, text] of Object.entries(built.files)) assert.equal(await readFile(path.join(snapshotDirectory, name), "utf8"), text, `Replay mismatch: ${name}`);
  return built.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory] = process.argv.slice(2);
  const run = command === "collect" ? () => collectRecentGpcrdbDelta({ outputDirectory: directory ? path.resolve(directory) : path.join(ROOT, OUTPUT) }) : command === "verify" ? () => verifyRecentGpcrdbDelta({ snapshotDirectory: directory ? path.resolve(directory) : path.join(ROOT, OUTPUT) }) : null;
  if (!run) { console.error("Usage: node scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs <collect|verify> [directory]"); process.exitCode = 1; }
  else run().then((result) => console.log(json(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
