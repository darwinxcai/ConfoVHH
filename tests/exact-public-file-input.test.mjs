import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readExactPublicFile } from "../scripts/fetch-exact-public-file.mjs";

// Synthetic bytes only. No altered coordinates, confidence or scientific labels.
const BODY = Buffer.from("synthetic immutable producer input\n");
const FILE = Object.freeze({
  filename: "synthetic.txt", bytes: BODY.length,
  sha256: createHash("sha256").update(BODY).digest("hex"),
});

async function directoryFor(t, body) {
  const directory = await mkdtemp(path.join(tmpdir(), "confovhh-exact-input-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (body != null) await writeFile(path.join(directory, FILE.filename), body);
  return directory;
}

test("explicit producer input has the same verified result as an exact download", async (t) => {
  const noFetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const directory = await directoryFor(t, BODY);
  assert.deepEqual(await readExactPublicFile(FILE, directory), {
    path: FILE.filename, bytes: FILE.bytes, sha256: FILE.sha256, text: BODY.toString(),
  });
  assert.equal(noFetch.mock.callCount(), 0);
});

test("a missing producer input fails without a network fallback", async (t) => {
  const noFetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const directory = await directoryFor(t);
  await assert.rejects(readExactPublicFile(FILE, directory), { code: "ENOENT" });
  assert.equal(noFetch.mock.callCount(), 0);
});

test("a truncated local producer input fails the original byte count", async (t) => {
  const directory = await directoryFor(t, BODY.subarray(0, -1));
  await assert.rejects(readExactPublicFile(FILE, directory), /byte count changed/u);
});

test("a same-length local corruption fails the original SHA-256", async (t) => {
  const changed = Buffer.from(BODY);
  changed[0] ^= 1;
  const directory = await directoryFor(t, changed);
  await assert.rejects(readExactPublicFile(FILE, directory), /SHA-256 changed/u);
});

test("invalid UTF-8 fails even when the exact length and hash match", async (t) => {
  const invalid = Buffer.from([0xff]);
  const directory = await directoryFor(t, invalid);
  const file = { ...FILE, bytes: invalid.length, sha256: createHash("sha256").update(invalid).digest("hex") };
  await assert.rejects(readExactPublicFile(file, directory), /encoded data was not valid/u);
});

test("local input filenames cannot escape the explicitly selected directory", async (t) => {
  const directory = await directoryFor(t, BODY);
  for (const filename of ["../synthetic.txt", "nested/synthetic.txt", "..\\synthetic.txt", "/synthetic.txt", ".", ".."]) {
    await assert.rejects(readExactPublicFile({ ...FILE, filename }, directory), /plain input filename required/u);
  }
  await assert.rejects(readExactPublicFile(FILE, ""), /input directory required/u);
});

test("regression CLI local-input mode fails missing inputs without calling fetch", async (t) => {
  const directory = await directoryFor(t);
  const preload = "globalThis.fetch = () => { throw new Error('Unexpected network request'); };";
  const result = spawnSync(process.execPath, [
    `--import=data:text/javascript,${encodeURIComponent(preload)}`,
    "scripts/validate-real-prediction-runs.mjs", `--input-dir=${directory}`,
    "--verify=validation/real-prediction-run-regression-v1.json", "--quiet",
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Verifying explicitly supplied producer inputs/u);
  assert.match(result.stderr, /ENOENT.*zenodo-17063524-colabfold-multimer/u);
  assert.doesNotMatch(result.stderr, /Unexpected network request/u);
  assert.doesNotMatch(result.stdout, /Real-run regression passed/u);
});
