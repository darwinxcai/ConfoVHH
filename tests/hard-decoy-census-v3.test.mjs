import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyV3CensusContracts } from "../scripts/hard-decoy/verify-v3-census-contracts.mjs";
import { collectSourceUniverse, parseGpcrdbHtmlIds, verifySourceUniverse } from "../scripts/hard-decoy/v3-source-universe.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_DIRECTORY = path.join(ROOT, "validation/hard-decoy-holdout-v3/prelabel-census-draft");

function rcsbResponse(ids, extra = {}) {
  return JSON.stringify({ query_id: "fixture", result_type: "entry", total_count: ids.length, result_set: ids.map((identifier) => ({ identifier, score: 1 })), ...extra });
}
function gpcrdbResponse(ids, extraRow = null) {
  const rows = ids.map((pdb_code) => ({ pdb_code }));
  if (extraRow) rows.push(extraRow);
  return JSON.stringify(rows);
}
function gpcrdbHtml(ids) {
  const rows = ids.map((id) => ["family", "class", "receptor", "species", "method", "resolution", "state", `<a href=\"/structure/${id}\">${id}</a>`]
    .map((cell) => `<td>${cell}</td>`).join(""));
  return `<!doctype html><html><body><table><tbody>${rows.map((row) => `<tr>${row}</tr>`).join("")}</tbody></table></body></html>`;
}
function makeFixtureFetch({ queryRepeats = {}, apiRepeats = null, htmlRepeats = null, apiExtraRow = null } = {}) {
  const queries = {
    nanobody: [["1AAA", "2BBB"], ["1AAA", "2BBB"]],
    vhh: [["2BBB", "3CCC"], ["2BBB", "3CCC"]],
    camelid: [["4DDD"], ["4DDD"]],
    megabody: [["5EEE"], ["5EEE"]],
    ...queryRepeats,
  };
  const api = apiRepeats ?? [["2BBB", "4DDD", "9ZZZ"], ["2BBB", "4DDD", "9ZZZ"]];
  const html = htmlRepeats ?? [["2BBB", "4DDD", "9ZZZ"], ["2BBB", "4DDD", "9ZZZ"]];
  const counts = new Map();
  return async (url, options = {}) => {
    const key = `${options.method ?? "GET"} ${url}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    if (url.includes("search.rcsb.org")) {
      const term = JSON.parse(options.body).query.parameters.value;
      const id = term.toLowerCase();
      const occurrenceKey = `rcsb-${id}`;
      const occurrence = counts.get(occurrenceKey) ?? 0;
      counts.set(occurrenceKey, occurrence + 1);
      assert.ok(queries[id], `Unexpected RCSB fixture term: ${term}`);
      return new Response(rcsbResponse(queries[id][occurrence] ?? queries[id].at(-1)), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/services/structure/")) {
      return new Response(gpcrdbResponse(api[index] ?? api.at(-1), index === 0 ? apiExtraRow : null), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/structure/")) {
      return new Response(gpcrdbHtml(html[index] ?? html.at(-1)), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
}
async function temporarySnapshot(fetchImpl = makeFixtureFetch()) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-source-"));
  const output = path.join(temporary, "snapshot");
  const result = await collectSourceUniverse({
    repositoryRoot: ROOT,
    outputDirectory: output,
    fetchImpl,
    now: (() => { let second = 0; return () => `2026-08-29T00:00:${String(second++).padStart(2, "0")}Z`; })(),
  });
  return { temporary, output, result };
}
async function refreshChecksum(directory, relative) {
  const checksumPath = path.join(directory, "checksums.sha256");
  const digest = createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex");
  const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
  const next = rows.map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row);
  assert.equal(next.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(checksumPath, `${next.join("\n")}\n`);
}

test("the byte-preserved historical source-census contract is externally nonauthoritative and preserves the formal minimum", async () => {
  const result = await verifyV3CensusContracts(ROOT);
  assert.equal(result.status, "V3_CENSUS_IN_PROGRESS");
  assert.equal(result.advancementAuthority, false);
  assert.equal(result.annotationEpitopeEligibilityAuthority, false);
  assert.equal(result.selectedProtocol, "HARD_DECOY_PROTOCOL_V3.md");
  assert.equal(result.requiredIndependentGroups, 10);
  assert.equal(result.sourceRetrievalRepeats, 2);
  assert.equal(result.snapshotFileCount, 24);
  assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(result.dockqLabelsAccessed, false);
  assert.equal(result.executionAuthorized, false);
});

test("the metadata collector freezes repeated raw responses and a deterministic intersection", async () => {
  const { temporary, output, result } = await temporarySnapshot();
  try {
    assert.equal(result.status, "SOURCE_UNIVERSE_CAPTURED_BLOCKED_PENDING_DISPOSITIONS");
    assert.deepEqual(result.rcsbQueryCounts, { nanobody: 2, vhh: 2, camelid: 1, megabody: 1 });
    assert.equal(result.rcsbUnionCount, 5);
    assert.equal(result.gpcrdbApiCount, 3);
    assert.equal(result.gpcrdbHtmlCount, 3);
    assert.equal(result.intersectionCount, 2);
    assert.equal(result.pendingDispositionRows, 2);
    assert.equal(result.formallyClearedGroups, 0);
    assert.equal(result.targetFreezePermitted, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(await readFile(path.join(output, "normalized/rcsb-gpcrdb-intersection.txt"), "utf8"), "2BBB\n4DDD\n");
    const rows = (await readFile(path.join(output, "source-universe.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.pdbId), ["2BBB", "4DDD"]);
    assert.deepEqual(rows[0].rcsbQueryIds, ["nanobody", "vhh"]);
    assert.deepEqual(rows[1].rcsbQueryIds, ["camelid"]);
    assert.ok(rows.every((row) => row.dispositionStatus === "PENDING_DISPOSITION"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("the GPCRdb HTML parser uses the prespecified eighth table column", async () => {
  const contract = JSON.parse(await readFile(path.join(CONTRACT_DIRECTORY, "source-query-contract.json"), "utf8"));
  const html = `<table><tbody>
    <tr><td>1BAD</td><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td><a>7GOD</a></td></tr>
    <tr><td>2BAD</td><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td><a>8OK2</a></td></tr>
  </tbody></table>`;
  assert.deepEqual(parseGpcrdbHtmlIds(html, contract), ["7GOD", "8OK2"]);
});

test("normalized repeat disagreement fails before a source snapshot can be accepted", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-repeat-"));
  try {
    const fetchImpl = makeFixtureFetch({ queryRepeats: { nanobody: [["1AAA", "2BBB"], ["1AAA", "6FFF"]] } });
    await assert.rejects(() => collectSourceUniverse({ repositoryRoot: ROOT, outputDirectory: path.join(temporary, "snapshot"), fetchImpl }), /normalized repeat disagreement for query nanobody/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("an API/HTML inventory mismatch is preserved as a target-freeze blocker", async () => {
  const { temporary, output, result } = await temporarySnapshot(makeFixtureFetch({ htmlRepeats: [["2BBB", "4DDD"], ["2BBB", "4DDD"]] }));
  try {
    assert.equal(result.status, "SOURCE_UNIVERSE_CAPTURED_BLOCKED_SOURCE_CROSSCHECK_AND_PENDING_DISPOSITIONS");
    assert.equal(result.gpcrdbCrossCheckPass, false);
    assert.equal(result.targetFreezePermitted, false);
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.gpcrdbCrossCheck.onlyInApi, ["9ZZZ"]);
    assert.deepEqual(manifest.gpcrdbCrossCheck.onlyInHtml, []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("a source snapshot mutation cannot bypass checksum verification", async () => {
  const { temporary, output } = await temporarySnapshot();
  try {
    await writeFile(path.join(output, "normalized/rcsb-union.txt"), "1AAA\n2BBB\n3CCC\n4DDD\n6FFF\n");
    await assert.rejects(() => verifySourceUniverse({ repositoryRoot: ROOT, snapshotDirectory: output }), /Source checksum mismatch: normalized\/rcsb-union.txt/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("even a rechecksummed semantic mutation cannot authorize execution", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-contract-"));
  const fixtureRoot = path.join(temporary, "repo");
  const fixtureContract = path.join(fixtureRoot, "validation/hard-decoy-holdout-v3/prelabel-census-draft");
  try {
    await mkdir(path.dirname(fixtureContract), { recursive: true });
    await cp(CONTRACT_DIRECTORY, fixtureContract, { recursive: true });
    const statePath = path.join(fixtureContract, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.executionAuthorized = true;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await refreshChecksum(fixtureContract, "state.json");
    await assert.rejects(() => verifyV3CensusContracts(fixtureRoot), /must remain false: executionAuthorized/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("coordinate-like payloads are rejected even when hidden in otherwise parseable metadata", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-coordinate-"));
  try {
    const fetchImpl = makeFixtureFetch({ apiExtraRow: { pdb_code: "8HHH", note: "ATOM      1  CA  GLY A   1       0.000   0.000   0.000" } });
    await assert.rejects(() => collectSourceUniverse({ repositoryRoot: ROOT, outputDirectory: path.join(temporary, "snapshot"), fetchImpl }), /Coordinate payload appeared in raw\/gpcrdb-api-1.json/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
