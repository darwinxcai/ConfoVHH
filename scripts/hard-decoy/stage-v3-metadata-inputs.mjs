import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const COMMIT = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_TREE_BYTES = 32 * 1024 * 1024;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_PROFILE_BYTES = 32 * 1024 * 1024;

const SOURCE_SNAPSHOT_FILES = [
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/checksums.sha256",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/manifest.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/gpcrdb-api.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/gpcrdb-html.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-camelid.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-gpcrdb-intersection.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-megabody.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-nanobody.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-union.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-vhh.txt",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-api-1.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-api-2.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-html-1.html",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/gpcrdb-html-2.html",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-camelid-1.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-camelid-2.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-megabody-1.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-megabody-2.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-nanobody-1.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-nanobody-2.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-vhh-1.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/raw/rcsb-vhh-2.json",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/source-universe.jsonl",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/summary.md",
];

const ENTRY_SNAPSHOT_FILES = [
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/batch-plan.json",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/checksums.sha256",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entities.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/manifest.json",
  ...Array.from({ length: 12 }, (_, batch) => [1, 2].map((repeat) => `validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/raw/rcsb-entry-metadata-batch-${String(batch + 1).padStart(3, "0")}-repeat-${repeat}.json`)).flat(),
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/requests.jsonl",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/summary.json",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/summary.md",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/triage-signals.jsonl",
];

function sortedProfile(paths) {
  const sorted = [...paths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (new Set(sorted).size !== sorted.length) throw new Error("Metadata staging profile contains duplicate paths.");
  for (const item of sorted) {
    if (item !== path.posix.normalize(item) || path.posix.isAbsolute(item) || item.startsWith("../") || item.includes("\0")) {
      throw new Error(`Unsafe metadata staging path: ${item}`);
    }
  }
  return Object.freeze(sorted);
}

export const PROFILES = Object.freeze({
  "entry-metadata": sortedProfile([
    "scripts/hard-decoy/oracle/canonical-json.mjs",
    "scripts/hard-decoy/v3-entry-metadata.mjs",
    "scripts/hard-decoy/v3-source-universe.mjs",
    "scripts/hard-decoy/verify-v3-entry-metadata-contracts.mjs",
    "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json",
    ...ENTRY_SNAPSHOT_FILES,
    "validation/hard-decoy-holdout-v3/entry-metadata-draft/README.md",
    "validation/hard-decoy-holdout-v3/entry-metadata-draft/checksums.sha256",
    "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json",
    "validation/hard-decoy-holdout-v3/entry-metadata-draft/rcsb-entry-metadata.graphql",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/source-query-contract.json",
    ...SOURCE_SNAPSHOT_FILES,
  ]),
  "source-universe": sortedProfile([
    "scripts/hard-decoy/oracle/canonical-json.mjs",
    "scripts/hard-decoy/v3-source-universe.mjs",
    "scripts/hard-decoy/verify-v3-census-contracts.mjs",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/README.md",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/annotation-epitope-ontology.json",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/checksums.sha256",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/source-query-contract.json",
    "validation/hard-decoy-holdout-v3/prelabel-census-draft/state.json",
    ...SOURCE_SNAPSHOT_FILES,
  ]),
});

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobSha1(bytes) {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function serializeReceipt(receipt) {
  return `${canonicalJson(receipt)}\n`;
}

function parseStrictJson(text, maximumCharacters) {
  ok(typeof text === "string" && text.length > 0 && text.length <= maximumCharacters, "JSON input violates the character limit.");
  ok(!text.includes("\0") && text.charCodeAt(0) !== 0xfeff, "JSON input contains a forbidden prefix or NUL.");
  let index = 0;
  let tokens = 0;
  const whitespace = () => { while (index < text.length && /[\x20\x09\x0a\x0d]/u.test(text[index])) index += 1; };
  const stringValue = () => {
    ok(text[index] === '"', `Expected JSON string at byte ${index}.`);
    const start = index++;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        let result;
        try { result = JSON.parse(text.slice(start, index)); } catch { throw new Error(`Malformed JSON string at byte ${start}.`); }
        ok(!/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(result), "JSON string contains a forbidden control character.");
        return result;
      }
      if (code === 0x5c) {
        index += 1;
        ok(index < text.length, "Unterminated JSON escape.");
        if (text[index] === "u") {
          ok(/^[a-fA-F0-9]{4}$/u.test(text.slice(index + 1, index + 5)), "Invalid JSON Unicode escape.");
          index += 5;
        } else {
          ok(/["\\/bfnrt]/u.test(text[index]), "Invalid JSON string escape.");
          index += 1;
        }
      } else {
        ok(code >= 0x20, "Unescaped JSON control character.");
        index += 1;
      }
    }
    throw new Error("Unterminated JSON string.");
  };
  const value = (depth = 0) => {
    ok(depth <= 64, "JSON nesting exceeds the limit.");
    tokens += 1;
    ok(tokens <= 2_000_000, "JSON token count exceeds the limit.");
    whitespace();
    if (text[index] === '"') return stringValue();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const object = Object.create(null);
      const keys = new Set();
      if (text[index] === "}") { index += 1; return object; }
      while (index < text.length) {
        whitespace();
        const key = stringValue();
        ok(!keys.has(key), `JSON contains duplicate object key ${JSON.stringify(key)}.`);
        keys.add(key);
        whitespace();
        ok(text[index] === ":", `Expected JSON colon at byte ${index}.`);
        index += 1;
        object[key] = value(depth + 1);
        whitespace();
        if (text[index] === "}") { index += 1; return object; }
        ok(text[index] === ",", `Expected JSON comma at byte ${index}.`);
        index += 1;
      }
      throw new Error("Unterminated JSON object.");
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      const array = [];
      if (text[index] === "]") { index += 1; return array; }
      while (index < text.length) {
        array.push(value(depth + 1));
        whitespace();
        if (text[index] === "]") { index += 1; return array; }
        ok(text[index] === ",", `Expected JSON comma at byte ${index}.`);
        index += 1;
      }
      throw new Error("Unterminated JSON array.");
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    ok(match, `Unexpected JSON token at byte ${index}.`);
    index += match[0].length;
    const number = Number(match[0]);
    ok(Number.isFinite(number) && !Object.is(number, -0) && (!Number.isInteger(number) || Number.isSafeInteger(number)), "JSON number is noncanonical.");
    return number;
  };
  const parsed = value();
  whitespace();
  ok(index === text.length, `JSON has trailing bytes at byte ${index}.`);
  return parsed;
}

function validateIdentity(profile, repository, commit) {
  ok(Object.hasOwn(PROFILES, profile), `Unknown metadata staging profile: ${profile}`);
  ok(REPOSITORY.test(repository), "Repository must be an exact owner/name pair.");
  ok(COMMIT.test(commit), "Commit must be an exact lowercase 40-hex object ID.");
}

function validateText(relative, bytes) {
  ok(bytes.byteLength <= MAX_BLOB_BYTES, `${relative} exceeds the per-file staging cap.`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  ok(!text.includes("\0") && text.charCodeAt(0) !== 0xfeff, `${relative} contains a forbidden prefix or NUL.`);
}

async function readResponseBounded(response, maximum, label) {
  ok(response.ok && response.body, `${label} failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  ok(!Number.isFinite(declared) || declared <= maximum, `${label} exceeds its declared byte cap.`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    ok(total <= maximum, `${label} exceeds its streamed byte cap.`);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function githubFetch(url, token, accept, maximum, label) {
  const parsed = new URL(url);
  ok(parsed.protocol === "https:" && parsed.hostname === "api.github.com", `${label} escaped api.github.com.`);
  const response = await fetch(parsed, {
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      "user-agent": "confovhh-v3-metadata-stager/1",
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  return readResponseBounded(response, maximum, label);
}

export function orderedRootSha256(records) {
  const rows = [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
    .map((record) => `${record.path}\0${record.gitBlobSha1}\0${record.sha256}\0${record.bytes}\n`).join("");
  return sha256(Buffer.from(rows));
}

export function createReceipt(profile, repository, commit, records) {
  validateIdentity(profile, repository, commit);
  const files = [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  ok(JSON.stringify(files.map(({ path: relative }) => relative)) === JSON.stringify(PROFILES[profile]), "Receipt records do not match the exact profile allowlist.");
  const totalBytes = files.reduce((sum, record) => sum + record.bytes, 0);
  ok(Number.isSafeInteger(totalBytes) && totalBytes <= MAX_PROFILE_BYTES, "Receipt aggregate byte count exceeds the profile cap.");
  return {
    schemaVersion: "1.0.0",
    profile,
    repository,
    commit,
    fileCount: files.length,
    totalBytes,
    orderedRootSha256: orderedRootSha256(files),
    files,
  };
}

async function writeExclusive(file, bytes) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function directoriesFor(paths) {
  const directories = new Set([""]);
  for (const relative of paths) {
    let directory = path.posix.dirname(relative);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return [...directories].sort((left, right) => right.split("/").length - left.split("/").length || Buffer.from(left).compare(Buffer.from(right)));
}

async function requireSafeNewTargets(outputDirectory, receiptPath) {
  const output = path.resolve(outputDirectory);
  const receipt = path.resolve(receiptPath);
  ok(output !== path.parse(output).root && receipt !== path.parse(receipt).root, "Staging targets cannot be filesystem roots.");
  const receiptRelative = path.relative(output, receipt);
  ok(receiptRelative.startsWith("..") && !path.isAbsolute(receiptRelative), "The staging receipt must remain outside the staged tree.");
  for (const target of [output, receipt]) {
    try { await lstat(target); throw new Error(`Staging target already exists: ${target}`); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const parent = path.dirname(target);
    ok(await realpath(parent) === path.resolve(parent), `Staging target parent contains a symlink: ${parent}`);
  }
  return { output, receipt };
}

export async function stageMetadataInputs({ profile, repository, commit, outputDirectory, receiptPath, token = process.env.GITHUB_TOKEN } = {}) {
  validateIdentity(profile, repository, commit);
  ok(typeof token === "string" && token.length >= 20, "GITHUB_TOKEN is required only for the staging operation.");
  const { output, receipt } = await requireSafeNewTargets(outputDirectory, receiptPath);
  const treeUrl = `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`;
  const treeBytes = await githubFetch(treeUrl, token, "application/vnd.github+json", MAX_TREE_BYTES, "Git tree request");
  const treeText = new TextDecoder("utf-8", { fatal: true }).decode(treeBytes);
  const tree = parseStrictJson(treeText, MAX_TREE_BYTES);
  ok(tree && typeof tree === "object" && !Array.isArray(tree) && tree.truncated === false && Array.isArray(tree.tree), "Git tree response is incomplete or malformed.");
  const entries = new Map();
  for (const item of tree.tree) {
    if (!item || typeof item !== "object" || typeof item.path !== "string") continue;
    ok(!entries.has(item.path), `Git tree repeats path: ${item.path}`);
    entries.set(item.path, item);
  }
  const selected = PROFILES[profile].map((relative) => {
    const item = entries.get(relative);
    ok(item && item.type === "blob" && item.mode === "100644" && /^[a-f0-9]{40}$/u.test(item.sha), `Profile path is not one direct regular Git blob: ${relative}`);
    return { relative, gitSha: item.sha };
  });

  await mkdir(output, { recursive: false, mode: 0o700 });
  const records = [];
  let totalBytes = 0;
  for (const { relative, gitSha } of selected) {
    const blobUrl = `https://api.github.com/repos/${repository}/git/blobs/${gitSha}`;
    const bytes = await githubFetch(blobUrl, token, "application/vnd.github.raw+json", MAX_BLOB_BYTES, `Git blob ${relative}`);
    ok(gitBlobSha1(bytes) === gitSha, `Git blob object ID mismatch: ${relative}`);
    validateText(relative, bytes);
    totalBytes += bytes.byteLength;
    ok(totalBytes <= MAX_PROFILE_BYTES, "Staged metadata inputs exceed the aggregate byte cap.");
    const destination = path.join(output, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeExclusive(destination, bytes);
    await chmod(destination, 0o444);
    records.push({ path: relative, gitBlobSha1: gitSha, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  const receiptObject = createReceipt(profile, repository, commit, records);
  await writeExclusive(receipt, Buffer.from(serializeReceipt(receiptObject)));
  await chmod(receipt, 0o444);
  for (const directory of directoriesFor(PROFILES[profile])) await chmod(directory ? path.join(output, ...directory.split("/")) : output, 0o555);
  return receiptObject;
}

async function walkReadOnly(directory, prefix = "", files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    const info = await lstat(absolute, { bigint: true });
    ok(!info.isSymbolicLink(), `Staged input contains a symlink: ${relative}`);
    ok((Number(info.mode) & 0o222) === 0, `Staged input remains writable: ${relative}`);
    if (info.isDirectory()) await walkReadOnly(absolute, relative, files);
    else {
      ok(info.isFile() && info.nlink === 1n, `Staged input is not one direct unaliased regular file: ${relative}`);
      files.push(relative);
    }
  }
  return files;
}

export async function verifyStagedInputs({ profile, repository, commit, outputDirectory, receiptPath } = {}) {
  validateIdentity(profile, repository, commit);
  const output = path.resolve(outputDirectory);
  const receiptFile = path.resolve(receiptPath);
  ok(await realpath(output) === output, "Staged root contains a symlinked ancestor.");
  ok(await realpath(receiptFile) === receiptFile, "Staging receipt contains a symlinked ancestor.");
  const rootInfo = await lstat(output, { bigint: true });
  const receiptInfo = await lstat(receiptFile, { bigint: true });
  ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && (Number(rootInfo.mode) & 0o222) === 0, "Staged root must be one read-only direct directory.");
  ok(receiptInfo.isFile() && !receiptInfo.isSymbolicLink() && receiptInfo.nlink === 1n && (Number(receiptInfo.mode) & 0o222) === 0, "Staging receipt must be one read-only unaliased regular file.");
  const receiptText = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(receiptFile));
  const parsed = parseStrictJson(receiptText, 2 * 1024 * 1024);
  ok(`${canonicalJson(parsed)}\n` === receiptText, "Staging receipt is not exact canonical JSON with terminal LF.");
  ok(JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(["commit", "fileCount", "files", "orderedRootSha256", "profile", "repository", "schemaVersion", "totalBytes"].sort()), "Staging receipt fields drifted.");
  ok(parsed.schemaVersion === "1.0.0" && parsed.profile === profile && parsed.repository === repository && parsed.commit === commit, "Staging receipt identity drifted.");
  const actualPaths = (await walkReadOnly(output)).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  ok(JSON.stringify(actualPaths) === JSON.stringify(PROFILES[profile]), "Staged tree differs from the exact profile allowlist.");
  ok(Array.isArray(parsed.files) && parsed.files.length === PROFILES[profile].length && parsed.fileCount === parsed.files.length, "Staging receipt file count drifted.");
  ok(JSON.stringify(parsed.files.map(({ path: relative }) => relative)) === JSON.stringify(PROFILES[profile]), "Staging receipt paths drifted from the exact profile.");
  const records = [];
  for (const expected of parsed.files) {
    ok(JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(["bytes", "gitBlobSha1", "path", "sha256"].sort()), `Staging receipt file fields drifted: ${expected.path}`);
    ok(/^[a-f0-9]{40}$/u.test(expected.gitBlobSha1) && /^[a-f0-9]{64}$/u.test(expected.sha256) && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0, `Staging receipt digest or length is invalid: ${expected.path}`);
    const bytes = await readFile(path.join(output, ...expected.path.split("/")));
    validateText(expected.path, bytes);
    const actual = { path: expected.path, gitBlobSha1: gitBlobSha1(bytes), sha256: sha256(bytes), bytes: bytes.byteLength };
    ok(actual.path === expected.path && actual.gitBlobSha1 === expected.gitBlobSha1 && actual.sha256 === expected.sha256 && actual.bytes === expected.bytes, `Staged file differs from its receipt: ${expected.path}`);
    records.push(actual);
  }
  const reconstructed = createReceipt(profile, repository, commit, records);
  ok(canonicalJson(reconstructed) === canonicalJson(parsed), "Staging receipt aggregate binding drifted.");
  return { profile, repository, commit, fileCount: records.length, totalBytes: reconstructed.totalBytes, orderedRootSha256: reconstructed.orderedRootSha256 };
}

async function main() {
  const [command, profile, repository, commit, outputDirectory, receiptPath] = process.argv.slice(2);
  ok(["stage", "verify"].includes(command) && profile && repository && commit && outputDirectory && receiptPath && process.argv.length === 8, "Usage: stage-v3-metadata-inputs.mjs <stage|verify> <profile> <owner/repo> <40-hex-commit> <output-directory> <receipt-path>");
  const result = command === "stage"
    ? await stageMetadataInputs({ profile, repository, commit, outputDirectory, receiptPath })
    : await verifyStagedInputs({ profile, repository, commit, outputDirectory, receiptPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
