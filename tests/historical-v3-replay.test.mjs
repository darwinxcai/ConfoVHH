import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withHistoricalV3Replay } from "../scripts/replay-historical-v3.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARCHIVE = "scripts/historical-v3-replay";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function minimalFixture(callback) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "confovhh-replay-tamper-")));
  try {
    await cp(path.join(ROOT, ARCHIVE), path.join(temporary, ARCHIVE), { recursive: true });
    await cp(path.join(ROOT, "node_modules/immunum"), path.join(temporary, "node_modules/immunum"), { recursive: true });
    await callback(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("historical replay keeps the patched product lock separate and leaves the staged integration unchanged", async () => {
  const activeBefore = await readFile(path.join(ROOT, "package-lock.json"));
  let staged;
  await withHistoricalV3Replay(async (replay) => {
    staged = replay.repositoryRoot;
    assert.notEqual(staged, ROOT);
    const historicalLock = await readFile(path.join(staged, "package-lock.json"));
    assert.equal(sha256(historicalLock), "0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54");
    assert.equal(sha256(historicalLock), replay.historicalLockSha256);
    assert.notEqual(sha256(activeBefore), sha256(historicalLock), "The product must keep its patched dependency environment");
    assert.deepEqual(await readdir(path.join(staged, "node_modules")), ["immunum"]);
    assert.equal(JSON.parse(await readFile(path.join(staged, "node_modules/immunum/package.json"), "utf8")).version, "1.3.0");
    for (const outputDirectory of [ROOT, path.join(ROOT, "forbidden-output"), staged]) {
      await assert.rejects(replay.collectVhhSequencePregraph({ outputDirectory }), /outside the source and frozen replay roots/);
    }
    const result = await replay.verifyIntegrationIdempotence();
    assert.equal(result.stateSha256, "42e74ebebc373a852a50b472adf0db7666135eee07b68934f05835ca1987dba7");
    assert.equal(result.attestationSha256, "02d406cfd183cac0a913718d75bffdcd461c7e9ff435654fc320b7824ec07c88");
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.executionAuthorized, false);
    await replay.verifyIntegrity();
  });
  assert.deepEqual(await readFile(path.join(ROOT, "package-lock.json")), activeBefore);
  await assert.rejects(lstat(staged), { code: "ENOENT" });
});

test("historical replay rejects a changed archived lock even if its JSON remains valid", async () => minimalFixture(async (root) => {
  const manifest = JSON.parse(await readFile(path.join(root, ARCHIVE, "manifest.json"), "utf8"));
  const filename = path.join(root, manifest.files["package-lock.json"].source);
  const bytes = await readFile(filename, "utf8");
  await writeFile(filename, bytes.replace('"lockfileVersion": 3', '"lockfileVersion": 2'));
  await assert.rejects(withHistoricalV3Replay(() => assert.fail("Must not execute changed historical evidence"), { repositoryRoot: root }), /replay digest mismatch/);
}));

test("historical replay rejects an altered manifest rather than trusting substituted checksums", async () => minimalFixture(async (root) => {
  const filename = path.join(root, ARCHIVE, "manifest.json");
  await writeFile(filename, `${await readFile(filename, "utf8")}\n`);
  await assert.rejects(withHistoricalV3Replay(() => assert.fail("Must not execute an altered manifest"), { repositoryRoot: root }), /manifest digest mismatch/);
}));

test("historical replay rejects altered installed scientific code despite an unchanged package version", async () => minimalFixture(async (root) => {
  const filename = path.join(root, "node_modules/immunum/immunum.js");
  const bytes = await readFile(filename);
  bytes[0] ^= 1;
  await writeFile(filename, bytes);
  assert.equal(JSON.parse(await readFile(path.join(root, "node_modules/immunum/package.json"), "utf8")).version, "1.3.0");
  await assert.rejects(withHistoricalV3Replay(() => assert.fail("Must not run substituted numbering code"), { repositoryRoot: root }), /immunum.js: replay digest mismatch/);
}));

test("historical replay rejects added files and symbolic links in the scientific package", async () => minimalFixture(async (root) => {
  const added = path.join(root, "node_modules/immunum/extra.js");
  await writeFile(added, "export default 1;\n");
  await assert.rejects(withHistoricalV3Replay(() => {}, { repositoryRoot: root }), /file inventory differs/);
  await rm(added);
  const original = path.join(root, "node_modules/immunum/immunum.js");
  await rm(original);
  await symlink(path.join(ROOT, "node_modules/immunum/immunum.js"), original);
  await assert.rejects(withHistoricalV3Replay(() => {}, { repositoryRoot: root }), /inventory contains a symlink/);
}));

test("staged-source tampering is rejected before original code executes, and temporary files are removed on error", async () => {
  let staged;
  await assert.rejects(withHistoricalV3Replay(async (replay) => {
    staged = replay.repositoryRoot;
    const filename = path.join(staged, "scripts/hard-decoy-v3/verify-integration-state.mjs");
    await writeFile(filename, "throw new Error('substituted-code-executed');\n");
    await replay.verifyIntegrationState();
  }), /verify-integration-state.mjs: replay byte count mismatch/);
  await assert.rejects(lstat(staged), { code: "ENOENT" });
});

test("optional discovery replay rejects changed frozen inputs before running the screen", async () => {
  let staged;
  await assert.rejects(withHistoricalV3Replay(async (replay) => {
    staged = replay.repositoryRoot;
    const filename = path.join(staged, "validation/hard-decoy-holdout-v3/rcsb-recent-discovery-2026-09-04/entries.jsonl");
    const bytes = await readFile(filename);
    bytes[0] ^= 1;
    await writeFile(filename, bytes);
    await replay.verifyGpcrdbComplementScreen();
  }, { profile: "screen-recent" }), /entries.jsonl: replay digest mismatch/);
  await assert.rejects(lstat(staged), { code: "ENOENT" });
});
