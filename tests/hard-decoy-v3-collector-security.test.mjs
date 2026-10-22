import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectEntryMetadata, verifyEntryMetadataSnapshot } from "../scripts/hard-decoy/v3-entry-metadata.mjs";
import { collectSourceUniverse, verifySourceUniverse } from "../scripts/hard-decoy/v3-source-universe.mjs";
import { parseStrictJson } from "../scripts/hard-decoy/oracle/canonical-json.mjs";
import { verifyV3EntryMetadataContracts } from "../scripts/hard-decoy/verify-v3-entry-metadata-contracts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29";
const ENTRY = "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29";
const CONTRACT = "validation/hard-decoy-holdout-v3/prelabel-census-draft";
const ENTRY_CONTRACT = "validation/hard-decoy-holdout-v3/entry-metadata-draft";
const ATTESTATION = "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json";

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function response(payload, { contentType = "application/json", url = "", redirected = false } = {}) {
  const body = new Response(payload).body;
  return { ok: true, status: 200, redirected, url, headers: new Headers({ "content-type": contentType }), body };
}
function rcsbPayload(extra = {}) {
  return JSON.stringify({ query_id: "fixture", result_type: "entry", total_count: 1, result_set: [{ identifier: "1AAA", score: 1 }], ...extra });
}
function gpcrdbPayload() {
  return JSON.stringify([{ pdb_code: "1AAA" }]);
}
function gpcrdbHtml() {
  return "<table><tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td>g</td><td>1AAA</td></tr></table>";
}
function validSourceFetch() {
  return async (url) => {
    if (url.includes("search.rcsb.org")) return response(rcsbPayload());
    if (url.endsWith("/services/structure/")) return response(gpcrdbPayload());
    if (url.endsWith("/structure/")) return response(gpcrdbHtml(), { contentType: "text/html" });
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
}
async function refreshChecksum(directory, relative) {
  const checksumPath = path.join(directory, "checksums.sha256");
  const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
  const replacement = `${sha(await readFile(path.join(directory, relative)))}  ${relative}`;
  const updated = rows.map((row) => row.endsWith(`  ${relative}`) ? replacement : row);
  assert.equal(updated.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(checksumPath, `${updated.join("\n")}\n`);
}

test("collectors reject existing destinations without deleting caller data", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-existing-output-"));
  const sourceOutput = path.join(temporary, "source");
  const entryOutput = path.join(temporary, "entry");
  try {
    for (const output of [sourceOutput, entryOutput]) {
      await mkdir(output);
      await writeFile(path.join(output, "caller-owned.txt"), "preserve me\n");
    }
    await assert.rejects(() => collectSourceUniverse({ repositoryRoot: ROOT, outputDirectory: sourceOutput, fetchImpl: validSourceFetch() }), /EEXIST/);
    await assert.rejects(() => collectEntryMetadata({ repositoryRoot: ROOT, outputDirectory: entryOutput, fetchImpl: async () => { throw new Error("must not fetch"); } }), /EEXIST/);
    assert.equal(await readFile(path.join(sourceOutput, "caller-owned.txt"), "utf8"), "preserve me\n");
    assert.equal(await readFile(path.join(entryOutput, "caller-owned.txt"), "utf8"), "preserve me\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("source collection rejects cross-origin responses and non-JSON media types", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-response-policy-"));
  try {
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "cross-origin"),
      fetchImpl: async () => response(rcsbPayload(), { url: "https://attacker.invalid/query" }),
    }), /exact pinned endpoint/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "wrong-content-type"),
      fetchImpl: async () => response(rcsbPayload(), { contentType: "text/plain" }),
    }), /forbidden content type/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("recursive JSON keys and base64-wrapped coordinate records fail the blind boundary", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-recursive-blind-"));
  const encodedCoordinate = Buffer.from("ATOM      1  CA  GLY A   1       0.000   0.000   0.000").toString("base64").replace(/=+$/u, "");
  const encodedCoordinateJson = Buffer.from('{"nativePose":[[0,0,0]]}').toString("base64url").replace(/=+$/u, "");
  try {
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "forbidden-key"),
      fetchImpl: async () => response('{"query_id":"fixture","result_type":"entry","total_count":1,"result_set":[{"identifier":"1AAA","score":1}],"nested":{"coor\\u0064inates":[0,1,2]}}'),
    }), /Forbidden coordinate- or label-like JSON key/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "base64-coordinate"),
      fetchImpl: async () => response(rcsbPayload({ nested: { note: encodedCoordinate } })),
    }), /Coordinate payload appeared .* after base64 decoding/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "base64-coordinate-json"),
      fetchImpl: async () => response(rcsbPayload({ nested: { note: encodedCoordinateJson } })),
    }), /Forbidden coordinate- or label-like JSON key.*nativePose/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("collectors reject escaped-equivalent duplicate keys before overwritten metadata can be scanned", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-duplicate-collection-"));
  const sourcePayload = '{"query_id":{"coordinates":[[0,0,0]]},"query\\u005fid":"fixture","result_type":"entry","total_count":1,"result_set":[{"identifier":"1AAA","score":1}]}';
  const entryPayload = '{"data":{"entries":[{"struct":{"coordinates":[[0,0,0]]}}]},"d\\u0061ta":{"entries":[]}}';
  try {
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "source"),
      fetchImpl: async () => response(sourcePayload),
    }), /duplicate object key "query_id"/);
    await assert.rejects(() => collectEntryMetadata({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "entry"),
      fetchImpl: async () => response(entryPayload),
      delay: async () => {},
    }), /duplicate object key "data"/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("replay rejects rechecksummed raw responses whose duplicate keys overwrite forbidden metadata", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-duplicate-replay-"));
  const sourceSnapshot = path.join(temporary, "source");
  const entrySnapshot = path.join(temporary, "entry");
  try {
    await cp(path.join(ROOT, SOURCE), sourceSnapshot, { recursive: true });
    const sourceRaw = "raw/rcsb-nanobody-1.json";
    const sourcePath = path.join(sourceSnapshot, sourceRaw);
    const sourceText = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, sourceText.replace(/^\{/u, '{"query_id":{"coordinates":[[0,0,0]]},'));
    await refreshChecksum(sourceSnapshot, sourceRaw);
    await assert.rejects(() => verifySourceUniverse({ repositoryRoot: ROOT, snapshotDirectory: sourceSnapshot }), /duplicate object key "query_id"/);

    await cp(path.join(ROOT, ENTRY), entrySnapshot, { recursive: true });
    const entryRaw = "raw/rcsb-entry-metadata-batch-001-repeat-1.json";
    const entryPath = path.join(entrySnapshot, entryRaw);
    const entryText = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entryText.replace(/^\{/u, '{"data":{"entries":[{"struct":{"coordinates":[[0,0,0]]}}]},'));
    await refreshChecksum(entrySnapshot, entryRaw);
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: entrySnapshot }), /duplicate object key "data"/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("strict parsing preserves all 34 frozen metadata response values", async () => {
  const sourceRaw = path.join(ROOT, SOURCE, "raw");
  const entryRaw = path.join(ROOT, ENTRY, "raw");
  const sourceFiles = (await readdir(sourceRaw)).filter((file) => file.endsWith(".json")).sort();
  const entryFiles = (await readdir(entryRaw)).filter((file) => file.endsWith(".json")).sort();
  assert.equal(sourceFiles.length + entryFiles.length, 34);
  for (const [directory, files] of [[sourceRaw, sourceFiles], [entryRaw, entryFiles]]) {
    for (const file of files) {
      const payload = await readFile(path.join(directory, file), "utf8");
      const strict = parseStrictJson(payload, {
        maximumCharacters: 16 * 1024 * 1024,
        maximumTokens: 500_000,
        maximumDepth: 64,
      });
      assert.equal(JSON.stringify(strict), JSON.stringify(JSON.parse(payload)), file);
    }
  }
});

test("source response schemas reject unknown coordinate-shaped fields and incomplete result pages", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-source-schema-"));
  try {
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "unknown-field"),
      fetchImpl: async () => response(rcsbPayload({ positions: [[0, 0, 0], [1, 1, 1]] })),
    }), /RCSB response contains unexpected fields: positions/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "incomplete-page"),
      fetchImpl: async () => response(rcsbPayload({ total_count: 2 })),
    }), /RCSB response is incomplete/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "duplicate-row"),
      fetchImpl: async () => response(JSON.stringify({ query_id: "fixture", result_type: "entry", total_count: 2, result_set: [{ identifier: "1AAA", score: 1 }, { identifier: "1AAA", score: 0.5 }] })),
    }), /duplicate identifiers/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("source collection forbids redirects and requires the exact contracted endpoint", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-source-redirect-"));
  try {
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "redirected"),
      fetchImpl: async () => response(rcsbPayload(), { url: "https://search.rcsb.org/alternate", redirected: true }),
    }), /redirects are forbidden/);
    await assert.rejects(() => collectSourceUniverse({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "same-origin-other-path"),
      fetchImpl: async () => response(rcsbPayload(), { url: "https://search.rcsb.org/alternate" }),
    }), /exact pinned endpoint/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("entry-metadata retrieval enforces its pinned origin, JSON media type, and recursive blind boundary", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-entry-response-policy-"));
  try {
    await assert.rejects(() => collectEntryMetadata({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "cross-origin"),
      fetchImpl: async () => response('{"data":{"entries":[]}}', { url: "https://attacker.invalid/graphql" }),
      delay: async () => {},
    }), /exact pinned endpoint/);
    await assert.rejects(() => collectEntryMetadata({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "wrong-content-type"),
      fetchImpl: async () => response('{"data":{"entries":[]}}', { contentType: "text/html" }),
      delay: async () => {},
    }), /forbidden content type/);
    await assert.rejects(() => collectEntryMetadata({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "forbidden-key"),
      fetchImpl: async () => response('{"data":{"entries":[]},"extensions":{"Cartn_x":0}}'),
      delay: async () => {},
    }), /Forbidden coordinate- or label-like JSON key/);
    await assert.rejects(() => collectEntryMetadata({
      repositoryRoot: ROOT,
      outputDirectory: path.join(temporary, "unknown-coordinate-shape"),
      fetchImpl: async () => response('{"data":{"entries":[]},"positions":[[0,0,0],[1,1,1]]}'),
      delay: async () => {},
    }), /contains unexpected fields: positions/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("source checksum paths are matched to the exact allowlist before payload replay", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-checksum-path-"));
  const snapshot = path.join(temporary, "snapshot");
  try {
    await collectSourceUniverse({ repositoryRoot: ROOT, outputDirectory: snapshot, fetchImpl: validSourceFetch() });
    const checksumPath = path.join(snapshot, "checksums.sha256");
    const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
    rows[0] = `${"0".repeat(64)}  ../outside`;
    await writeFile(checksumPath, `${rows.join("\n")}\n`);
    await assert.rejects(() => verifySourceUniverse({ repositoryRoot: ROOT, snapshotDirectory: snapshot }), /exactly match the allowlist before payload access/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("entry contracts fully replay the frozen source universe before consuming GPCRdb", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-source-binding-"));
  const fixtureRoot = path.join(temporary, "repo");
  try {
    await mkdir(path.join(fixtureRoot, "validation/hard-decoy-holdout-v3"), { recursive: true });
    await cp(path.join(ROOT, CONTRACT), path.join(fixtureRoot, CONTRACT), { recursive: true });
    await cp(path.join(ROOT, ENTRY_CONTRACT), path.join(fixtureRoot, ENTRY_CONTRACT), { recursive: true });
    await cp(path.join(ROOT, SOURCE), path.join(fixtureRoot, SOURCE), { recursive: true });
    await cp(path.join(ROOT, ATTESTATION), path.join(fixtureRoot, ATTESTATION));
    const gpcrdb = path.join(fixtureRoot, SOURCE, "raw/gpcrdb-api-1.json");
    await writeFile(gpcrdb, `${await readFile(gpcrdb, "utf8")} `);
    await assert.rejects(() => verifyV3EntryMetadataContracts(fixtureRoot), /Source checksum mismatch: raw\/gpcrdb-api-1.json/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rechecksummed request-ledger remapping is rejected against the frozen batch plan", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-request-map-"));
  const snapshot = path.join(temporary, "snapshot");
  try {
    await cp(path.join(ROOT, ENTRY), snapshot, { recursive: true });
    const requestPath = path.join(snapshot, "requests.jsonl");
    const requests = (await readFile(requestPath, "utf8")).trimEnd().split("\n").map(JSON.parse);
    [requests[0].requestedIds[0], requests[0].requestedIds[1]] = [requests[0].requestedIds[1], requests[0].requestedIds[0]];
    const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
        : JSON.stringify(value);
    await writeFile(requestPath, `${requests.map(canonical).join("\n")}\n`);
    const manifestPath = path.join(snapshot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.requests = requests;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await refreshChecksum(snapshot, "requests.jsonl");
    await refreshChecksum(snapshot, "manifest.json");
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: snapshot }), /request mapping drifted/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("entry checksum traversal syntax is rejected without resolving attacker paths", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-entry-checksum-"));
  const snapshot = path.join(temporary, "snapshot");
  try {
    await cp(path.join(ROOT, ENTRY), snapshot, { recursive: true });
    const checksumPath = path.join(snapshot, "checksums.sha256");
    const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
    rows[0] = `${"0".repeat(64)}  ../outside`;
    await writeFile(checksumPath, `${rows.join("\n")}\n`);
    await assert.rejects(() => verifyEntryMetadataSnapshot({ repositoryRoot: ROOT, snapshotDirectory: snapshot }), /exactly match the allowlist before payload access/);
    assert.deepEqual((await readdir(temporary)).sort(), ["snapshot"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
