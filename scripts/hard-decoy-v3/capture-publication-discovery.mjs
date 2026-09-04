import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ENDPOINT = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PHRASES = ["GPCR nanobody", "GPCR VHH", "G protein-coupled receptor nanobody", "extracellular GPCR nanobody", "conformation-selective nanobody"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const jsonl = rows => rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PLAN = "validation/hard-decoy-holdout-v3/CENSUS_RECONSTRUCTION_PLAN.md";

function queryUrl(phrase, cursor) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ query: `"${phrase}"`, format: "json", resultType: "lite", pageSize: "1000", cursorMark: cursor });
  return url.href;
}

function verifyEcho(data, phrase, cursor) {
  assert.deepEqual({ queryString: data.request?.queryString, cursorMark: data.request?.cursorMark, pageSize: data.request?.pageSize, resultType: data.request?.resultType }, { queryString: `"${phrase}"`, cursorMark: cursor, pageSize: 1000, resultType: "lite" }, "Response does not echo the requested phrase/page");
  assert.equal(data.request.synonym, false, "Unexpected synonym expansion");
  assert.equal(data.request.sort, "", "Unexpected result sorting");
}

async function capture(directory) {
  await mkdir(directory, { recursive: false });
  await mkdir(path.join(directory, "raw"));
  const manifest = { schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", discoveryRoute: "C.3_PUBLICATION_FIRST_EUROPE_PMC_PHRASE_QUERIES", collectorSha256: sha(await readFile(HERE)), reconstructionPlanSha256: sha(await readFile(path.join(ROOT, PLAN))), startedUtc: new Date().toISOString(), phrases: PHRASES, requests: [] };
  for (const [index, phrase] of PHRASES.entries()) {
    let cursor = "*";
    let retrieved = 0;
    for (let page = 1; page <= 20; page += 1) {
      const url = queryUrl(phrase, cursor);
      const startedUtc = new Date().toISOString();
      const response = await fetch(url, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `Query ${index + 1}, page ${page} failed`);
      assert.equal(response.url, url, "Unexpected endpoint redirect");
      assert.match(response.headers.get("content-type") ?? "", /^application\/json(?:;|$)/u);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) { size += chunk.byteLength; assert.ok(size <= 8 * 1024 * 1024, "Bibliographic response exceeds byte cap"); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks);
      const data = JSON.parse(bytes.toString("utf8"));
      assert.ok(Number.isSafeInteger(data.hitCount) && Array.isArray(data.resultList?.result), "Unexpected bibliography response");
      verifyEcho(data, phrase, cursor);
      const rawFile = `raw/query-${index + 1}-page-${page}.json`;
      await writeFile(path.join(directory, rawFile), bytes, { flag: "wx" });
      manifest.requests.push({ queryId: index + 1, phrase, page, cursor, url, method: "GET", startedUtc, completedUtc: new Date().toISOString(), status: response.status, contentType: response.headers.get("content-type"), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), rawFile, bytes: bytes.length, sha256: sha(bytes), reportedHitCount: data.hitCount });
      await writeFile(path.join(directory, "capture-progress.json"), json(manifest));
      retrieved += data.resultList.result.length;
      if (retrieved >= data.hitCount) break;
      assert.ok(data.nextCursorMark && data.nextCursorMark !== cursor && data.resultList.result.length, "Pagination stopped before reported hit count");
      assert.ok(page < 20, "Bibliographic page cap reached; collection remains incomplete");
      cursor = data.nextCursorMark;
    }
  }
  manifest.completedUtc = new Date().toISOString();
  await writeFile(path.join(directory, "manifest.json"), json(manifest), { flag: "wx" });
  return manifest;
}

export async function reconstructPublicationDiscovery(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.collectorSha256, sha(await readFile(HERE)), "Collector source hash changed");
  assert.equal(manifest.reconstructionPlanSha256, sha(await readFile(path.join(ROOT, PLAN))), "Discovery plan changed");
  assert.deepEqual(manifest.phrases, PHRASES);
  const publications = new Map();
  const querySummaries = [];
  for (const [index, phrase] of PHRASES.entries()) {
    const records = manifest.requests.filter(row => row.queryId === index + 1);
    assert.ok(records.length > 0, "Missing prespecified phrase query");
    const seen = new Set();
    let cursor = "*";
    let expectedCount;
    for (const [pageIndex, record] of records.entries()) {
      assert.equal(record.phrase, phrase);
      assert.equal(record.page, pageIndex + 1);
      assert.equal(record.rawFile, `raw/query-${index + 1}-page-${pageIndex + 1}.json`);
      assert.equal(record.url, queryUrl(phrase, cursor));
      assert.equal(record.method, "GET");
      assert.equal(record.status, 200);
      assert.match(record.contentType, /^application\/json(?:;|$)/u);
      const bytes = await readFile(path.join(directory, record.rawFile));
      assert.equal(bytes.length, record.bytes);
      assert.equal(sha(bytes), record.sha256);
      const data = JSON.parse(bytes.toString("utf8"));
      verifyEcho(data, phrase, cursor);
      expectedCount ??= data.hitCount;
      assert.equal(data.hitCount, expectedCount, "Result total drifted across pages");
      assert.equal(record.reportedHitCount, expectedCount);
      for (const row of data.resultList.result) {
        assert.ok(typeof row.source === "string" && typeof row.id === "string", "Publication lacks stable source ID");
        const key = `${row.source}:${row.id}`;
        assert.ok(!seen.has(key), "Query pagination repeated a publication");
        seen.add(key);
        if (!publications.has(key)) publications.set(key, { sourceId: key, pmid: row.pmid ?? null, pmcid: row.pmcid ?? null, doi: row.doi ?? null, title: row.title ?? null, firstPublicationDate: row.firstPublicationDate ?? null, publicationTypes: row.pubType ?? null, queryIds: [], sourceUrl: row.pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${row.pmcid}/` : `https://europepmc.org/article/${row.source}/${row.id}`, hasTextMinedPdbAccessionSignal: (row.tmAccessionTypeList?.accessionType ?? []).includes("pdb"), entryAccessionExtractionStatus: "PENDING_PRIMARY_SOURCE_REVIEW", formalDisposition: "PENDING_REQUIRED_METADATA" });
        publications.get(key).queryIds.push(index + 1);
      }
      cursor = data.nextCursorMark;
    }
    assert.equal(seen.size, expectedCount, "Incomplete query pagination");
    querySummaries.push({ queryId: index + 1, phrase, resultCount: seen.size, pages: records.length, retrievedAllReportedResults: true });
  }
  const rows = [...publications.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const summary = { schemaVersion: "1.0.0", studyId: manifest.studyId, discoveryRoute: manifest.discoveryRoute, querySummaries, uniquePublicationCount: rows.length, recordsWithPdbTextMiningSignal: rows.filter(row => row.hasTextMinedPdbAccessionSignal).length, selectedSourceQueryPaginationComplete: true, primarySourceAccessionExtractionComplete: false, broaderDiscoveryComplete: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", targetFreezePermitted: false, nativeCoordinatesInspected: false, labelsAccessed: false, interpretation: "All reported Europe PMC results for the five prespecified quoted phrases were retrieved. This is a dated bibliography, not an exhaustive literature census, an entry disposition ledger, or evidence of new independent components. Index coverage, phrase terminology, source duplication, reviews, and off-topic records require assessment. Exact PDB accession extraction and entry-specific role review remain pending." };
  return { manifest, files: { "publications.jsonl": jsonl(rows), "summary.json": json(summary) }, summary };
}

async function run(command, directory) {
  if (command === "collect") {
    await capture(directory);
    const result = await reconstructPublicationDiscovery(directory);
    for (const [name, content] of Object.entries(result.files)) await writeFile(path.join(directory, name), content, { flag: "wx" });
    await writeFile(path.join(directory, "README.md"), "# Prespecified publication-first bibliography\n\n" + result.summary.interpretation + "\n\nRaw responses contain bibliographic metadata only. Each query is bound to its exact URL, page, timestamp, HTTP metadata, byte count and SHA-256. Only the returned source's reported result pagination is complete. No article figures, coordinates or labels were retrieved.\n\nRun `node scripts/hard-decoy-v3/capture-publication-discovery.mjs verify <this-directory>` to replay query totals, deduplication and file hashes.\n", { flag: "wx" });
    const names = ["README.md", "capture-progress.json", "manifest.json", ...Object.keys(result.files), ...result.manifest.requests.map(row => row.rawFile)].sort();
    await writeFile(path.join(directory, "checksums.sha256"), (await Promise.all(names.map(async name => `${sha(await readFile(path.join(directory, name)))}  ${name}\n`))).join(""), { flag: "wx" });
  }
  const result = await reconstructPublicationDiscovery(directory);
  for (const [name, expected] of Object.entries(result.files)) assert.equal(await readFile(path.join(directory, name), "utf8"), expected, `${name} differs from raw evidence`);
  const expectedNames = ["README.md", "capture-progress.json", "manifest.json", ...Object.keys(result.files), ...result.manifest.requests.map(row => row.rawFile)].sort();
  const names = [];
  for (const line of (await readFile(path.join(directory, "checksums.sha256"), "utf8")).trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9./-]+)$/u.exec(line);
    assert.ok(match && expectedNames.includes(match[2]), "Unexpected checksum path");
    names.push(match[2]);
    assert.equal(sha(await readFile(path.join(directory, match[2]))), match[1]);
  }
  assert.deepEqual(names.sort(), expectedNames);
  assert.deepEqual((await readdir(path.join(directory, "raw"))).sort(), result.manifest.requests.map(row => row.rawFile.slice(4)).sort());
  return result.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory] = process.argv.slice(2);
  assert.ok(["collect", "verify"].includes(command) && directory && process.argv.length === 4, "Usage: capture-publication-discovery.mjs collect|verify <new-directory>");
  console.log(JSON.stringify(await run(command, path.resolve(directory))));
}
