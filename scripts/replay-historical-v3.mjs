#!/usr/bin/env node
/** Replay frozen v3 evidence without restoring vulnerable product dependencies. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "..");
const MANIFEST_PATH = "scripts/historical-v3-replay/manifest.json";
const MANIFEST_SHA256 = "36c4841813d7e4961309312eb3f14e8f6bd0942c866fd278ba3e430cfa6eecdc";
const runFile = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function within(root, relative) {
  requireValue(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative)
    && relative.split("/").every((part) => part && part !== "." && part !== ".."), `Unsafe replay path: ${relative}`);
  return path.join(root, relative);
}

async function exactBytes(root, relative, expected) {
  const filename = within(root, relative);
  const info = await lstat(filename);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
    && await realpath(filename) === filename, `${relative}: replay input must be a direct regular file`);
  requireValue(info.size === expected.bytes, `${relative}: replay byte count mismatch`);
  const bytes = await readFile(filename);
  requireValue(bytes.byteLength === expected.bytes && sha256(bytes) === expected.sha256, `${relative}: replay digest mismatch`);
  return bytes;
}

async function inventory(root, relative = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    requireValue(!entry.isSymbolicLink(), `${next}: replay inventory contains a symlink`);
    if (entry.isDirectory()) result.push(...await inventory(root, next));
    else {
      requireValue(entry.isFile(), `${next}: replay inventory contains a non-file`);
      result.push(next);
    }
  }
  return result.sort();
}

async function readManifest(root) {
  const filename = within(root, MANIFEST_PATH);
  const info = await lstat(filename);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
    && await realpath(filename) === filename && info.size < 256 * 1024, "Replay manifest must be a bounded direct file");
  const bytes = await readFile(filename);
  requireValue(sha256(bytes) === MANIFEST_SHA256, "Historical replay manifest digest mismatch");
  return JSON.parse(bytes.toString("utf8"));
}

async function installedImmunum(root, manifest) {
  const relative = "node_modules/immunum";
  const expected = manifest.immunum;
  requireValue(JSON.stringify(await inventory(within(root, relative))) === JSON.stringify(Object.keys(expected.files).sort()),
    "Installed immunum file inventory differs from the frozen scientific engine");
  const files = new Map();
  const combined = createHash("sha256");
  for (const [name, record] of Object.entries(expected.files).sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))) {
    const bytes = await exactBytes(root, `${relative}/${name}`, record);
    files.set(`${relative}/${name}`, bytes);
    combined.update(name).update("\0").update(record.sha256).update("\0");
  }
  requireValue(combined.digest("hex") === expected.combinedSha256, "Installed immunum combined digest mismatch");
  const pkg = JSON.parse(files.get(`${relative}/package.json`).toString("utf8"));
  requireValue(pkg.version === "1.3.0" && pkg.version === expected.version, "Historical replay requires the exact immunum 1.3.0 engine");
  return files;
}

/**
 * Copy only an explicit, checksummed historical input set into a private temporary
 * root. The current package lock is never read as historical evidence or changed.
 * Only the byte-identical installed scientific engine is copied; npm is never run
 * against the archived lock. Original generators retain their original paths and
 * bytes, so every existing provenance and scientific assertion still executes.
 */
export async function withHistoricalV3Replay(callback, { repositoryRoot = ROOT } = {}) {
  const source = path.resolve(repositoryRoot);
  requireValue(await realpath(source) === source, "Replay source root cannot contain symlinked ancestors");
  const manifest = await readManifest(source);
  // Check the small archived objects and scientific engine before copying data.
  for (const [relative, record] of Object.entries(manifest.files)) {
    if (record.source !== relative) await exactBytes(source, record.source, record);
  }
  const engine = await installedImmunum(source, manifest);
  const parent = await realpath(os.tmpdir());
  const staged = await mkdtemp(path.join(parent, "confovhh-historical-v3-"));
  const expected = new Map(Object.entries(manifest.files).map(([relative, record]) => [relative, record]));
  for (const [relative, record] of Object.entries(manifest.immunum.files)) expected.set(`node_modules/immunum/${relative}`, record);
  async function verifyIntegrity() {
    requireValue(JSON.stringify(await inventory(staged)) === JSON.stringify([...expected.keys()].sort()), "Historical replay inventory changed");
    for (const [relative, record] of expected) await exactBytes(staged, relative, record);
  }
  async function load(relative) {
    await verifyIntegrity();
    return import(pathToFileURL(within(staged, relative)).href);
  }
  try {
    for (const [relative, record] of Object.entries(manifest.files)) {
      const bytes = await exactBytes(source, record.source, record);
      const destination = within(staged, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx" });
    }
    for (const [relative, bytes] of engine) {
      const destination = within(staged, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx" });
    }
    await verifyIntegrity();
    const replay = {
      repositoryRoot: staged,
      historicalLockSha256: manifest.historicalLockSha256,
      verifyIntegrity,
      async verifyIntegrationState() {
        const original = await load("scripts/hard-decoy-v3/verify-integration-state.mjs");
        return original.verifyIntegrationState(staged);
      },
      async verifyVhhSequencePregraph({ snapshotDirectory } = {}) {
        const original = await load("scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs");
        return original.verifyVhhSequencePregraph({ repositoryRoot: staged,
          snapshotDirectory: snapshotDirectory ?? path.join(staged, "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29") });
      },
      async collectVhhSequencePregraph({ outputDirectory }) {
        const output = path.resolve(outputDirectory);
        requireValue([staged, source].every((root) => output !== root && !output.startsWith(`${root}${path.sep}`)),
          "Generate test outputs outside the source and frozen replay roots");
        const original = await load("scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs");
        return original.collectVhhSequencePregraph({ repositoryRoot: staged, outputDirectory });
      },
      async verifyIntegrationIdempotence() {
        await verifyIntegrity();
        const { stdout } = await runFile(process.execPath, [path.join(staged, "scripts/hard-decoy-v3/integrate-vhh-sequence-state.mjs")],
          { cwd: staged, maxBuffer: 1024 * 1024 });
        await verifyIntegrity();
        return JSON.parse(stdout);
      },
    };
    const result = await callback(replay);
    await verifyIntegrity();
    return result;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try {
    const command = process.argv[2] ?? "integration";
    const methods = { integration: "verifyIntegrationState", vhh: "verifyVhhSequencePregraph", idempotence: "verifyIntegrationIdempotence" };
    requireValue(Object.hasOwn(methods, command), "Usage: node scripts/replay-historical-v3.mjs [integration|vhh|idempotence]");
    console.log(JSON.stringify(await withHistoricalV3Replay((replay) => replay[methods[command]]()), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
