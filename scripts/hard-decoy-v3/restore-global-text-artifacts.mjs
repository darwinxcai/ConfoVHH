import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const STORAGE = `${BASE}/global-text-artifact-storage-2026-09-04`;
const MANIFEST_SHA256 = "0e7731ffe933acc7cb53c37de14319a3cf9abb19ce63dd757342b2a8bcd89921";
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ALLOWED = Object.freeze([
  [`${BASE}/global-text-discovery-2026-09-04/entries.jsonl`, "entries.jsonl.gz"],
  [`${BASE}/global-text-screen-2026-09-04/entity-screens.jsonl`, "entity-screens.jsonl.gz"],
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (file) => { try { return await lstat(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
async function parents(root, directory, create = false) {
  const relative = path.relative(root, directory);
  assert(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Path escapes repository root");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info = await exists(current);
    if (!info && create) { try { await mkdir(current); } catch (error) { if (error.code !== "EEXIST") throw error; } info = await lstat(current); }
    if (!info) continue;
    assert(info.isDirectory() && !info.isSymbolicLink(), `Parent must be a direct directory: ${current}`);
  }
}
async function boundedFile(root, file, maximumBytes) {
  await parents(root, path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile() && info.nlink === 1 && info.size <= maximumBytes, `Expected bounded direct regular file: ${file}`);
    const bytes = await handle.readFile();
    assert(bytes.length <= maximumBytes, `Read exceeded byte bound: ${file}`);
    return bytes;
  } finally { await handle.close(); }
}
export async function restoreGlobalTextArtifacts({ repositoryRoot = ROOT } = {}) {
  const root = path.resolve(repositoryRoot);
  assert.equal(await realpath(root), root, "Repository root must not contain symlinked ancestors");
  const info = await lstat(root); assert(info.isDirectory() && !info.isSymbolicLink());
  const manifestBytes = await boundedFile(root, path.join(root, STORAGE, "manifest.json"), 16 * 1024);
  assert.equal(sha(manifestBytes), MANIFEST_SHA256, "Storage manifest digest mismatch");
  const manifest = parseStrictJson(String(manifestBytes), { maximumCharacters: 16 * 1024, maximumDepth: 8, maximumTokens: 1000 });
  assert.equal(manifest.schemaVersion, "1.0.0"); assert.equal(manifest.compression, "gzip");
  assert.equal(manifest.maximumCompressedBytes, MAX_COMPRESSED_BYTES); assert.equal(manifest.maximumUncompressedBytes, MAX_UNCOMPRESSED_BYTES);
  assert.deepEqual(manifest.files.map((row) => [row.path, row.archive]), ALLOWED, "Only the two frozen artifact paths may be restored");
  const prepared = [];
  // Validate both archives and all existing destinations before writing either
  // file. A mismatched existing artifact must never be silently replaced.
  for (const row of manifest.files) {
    assert(Number.isSafeInteger(row.compressedBytes) && row.compressedBytes > 0 && row.compressedBytes <= MAX_COMPRESSED_BYTES);
    assert(Number.isSafeInteger(row.uncompressedBytes) && row.uncompressedBytes > 0 && row.uncompressedBytes <= MAX_UNCOMPRESSED_BYTES);
    assert(/^[a-f0-9]{64}$/u.test(row.compressedSha256) && /^[a-f0-9]{64}$/u.test(row.uncompressedSha256));
    const archive = await boundedFile(root, path.join(root, STORAGE, row.archive), MAX_COMPRESSED_BYTES);
    assert.equal(archive.length, row.compressedBytes, `Compressed size mismatch: ${row.archive}`);
    assert.equal(sha(archive), row.compressedSha256, `Compressed digest mismatch: ${row.archive}`);
    const destination = path.join(root, row.path);
    await parents(root, path.dirname(destination));
    const checksumBytes = await boundedFile(root, path.join(path.dirname(destination), "checksums.sha256"), 1024 * 1024);
    const checksums = new Map();
    for (const line of String(checksumBytes).trimEnd().split("\n")) {
      const match = /^([a-f0-9]{64})  ([^\r\n]+)$/u.exec(line); assert(match && !checksums.has(match[2]), "Invalid or duplicate canonical checksum row"); checksums.set(match[2], match[1]);
    }
    assert.equal(checksums.get(path.basename(destination)), row.uncompressedSha256, "Archive does not match the original canonical packet checksum");
    const existing = await exists(destination);
    if (existing) {
      assert(existing.isFile() && !existing.isSymbolicLink() && existing.nlink === 1, `Existing artifact must be a direct file: ${row.path}`);
      const bytes = await boundedFile(root, destination, MAX_UNCOMPRESSED_BYTES);
      assert.equal(bytes.length, row.uncompressedBytes, `Existing artifact size mismatch; refusing overwrite: ${row.path}`);
      assert.equal(sha(bytes), row.uncompressedSha256, `Existing artifact digest mismatch; refusing overwrite: ${row.path}`);
      prepared.push({ row, destination, bytes: null });
    } else {
      const bytes = gunzipSync(archive, { maxOutputLength: Math.min(row.uncompressedBytes, MAX_UNCOMPRESSED_BYTES) });
      assert.equal(bytes.length, row.uncompressedBytes, `Uncompressed size mismatch: ${row.path}`);
      assert.equal(sha(bytes), row.uncompressedSha256, `Uncompressed digest mismatch: ${row.path}`);
      prepared.push({ row, destination, bytes });
    }
  }
  for (const item of prepared) if (item.bytes) {
    await parents(root, path.dirname(item.destination), true);
    await writeFile(item.destination, item.bytes, { flag: "wx", mode: 0o644 });
  }
  return { status: "GLOBAL_TEXT_CANONICAL_ARTIFACTS_AVAILABLE", manifestSha256: MANIFEST_SHA256,
    files: prepared.map(({ row, bytes }) => ({ path: row.path, status: bytes ? "RESTORED_EXACT_BYTES" : "EXISTING_EXACT_BYTES_VERIFIED", bytes: row.uncompressedBytes, sha256: row.uncompressedSha256 })),
    networkAccessRequired: false, canonicalPacketChecksumsUnchanged: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try { assert(process.argv.length <= 3, "Usage: restore-global-text-artifacts.mjs [REPOSITORY_ROOT]"); console.log(JSON.stringify(await restoreGlobalTextArtifacts({ repositoryRoot: process.argv[2] ?? ROOT }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
