import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreGlobalTextArtifacts } from "../scripts/hard-decoy-v3/restore-global-text-artifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "validation/hard-decoy-holdout-v3";
const STORAGE = `${BASE}/global-text-artifact-storage-2026-09-04`;
const TARGETS = [`${BASE}/global-text-discovery-2026-09-04/entries.jsonl`, `${BASE}/global-text-screen-2026-09-04/entity-screens.jsonl`];
const PACKETS = TARGETS.map((name) => path.dirname(name));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(full = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "confovhh-artifact-restore-"));
  await cp(path.join(ROOT, STORAGE), path.join(root, STORAGE), { recursive: true });
  for (const packet of PACKETS) {
    if (full) await cp(path.join(ROOT, packet), path.join(root, packet), { recursive: true, filter: (source) => !TARGETS.map((target) => path.join(ROOT, target)).includes(source) });
    else { await mkdir(path.join(root, packet), { recursive: true }); await cp(path.join(ROOT, packet, "checksums.sha256"), path.join(root, packet, "checksums.sha256")); }
  }
  return root;
}
async function inventory(directory, prefix = "") {
  const names = [];
  for (const item of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = path.posix.join(prefix, item.name); assert(!item.isSymbolicLink());
    if (item.isDirectory()) names.push(...await inventory(directory, name)); else { assert(item.isFile()); names.push(name); }
  }
  return names.sort();
}
async function absent(file) { await assert.rejects(lstat(file), { code: "ENOENT" }); }

test("a clean checkout restores exact large bytes and both original packet inventories offline", { timeout: 120_000 }, async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Artifact restoration must stay offline"); });
  const root = await fixture(true);
  try {
    for (const name of TARGETS) await absent(path.join(root, name));
    const result = await restoreGlobalTextArtifacts({ repositoryRoot: root });
    assert(result.files.every((row) => row.status === "RESTORED_EXACT_BYTES"));
    assert.deepEqual(result.files.map((row) => row.bytes), [22693263, 42079134]);
    for (const packet of PACKETS) {
      const directory = path.join(root, packet), expected = [];
      for (const line of (await readFile(path.join(directory, "checksums.sha256"), "utf8")).trimEnd().split("\n")) {
        const [digest, name] = line.split("  "); expected.push(name); assert.equal(sha(await readFile(path.join(directory, name))), digest, name);
      }
      assert.deepEqual(await inventory(directory), [...expected, "checksums.sha256"].sort());
    }
    const again = await restoreGlobalTextArtifacts({ repositoryRoot: root });
    assert(again.files.every((row) => row.status === "EXISTING_EXACT_BYTES_VERIFIED"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compressed tampering or an oversized archive fails before creating either destination", async () => {
  for (const mode of ["digest", "bound"]) {
    const root = await fixture();
    try {
      const archive = path.join(root, STORAGE, "entries.jsonl.gz");
      const bytes = mode === "bound" ? Buffer.alloc(8 * 1024 * 1024 + 1) : await readFile(archive);
      if (mode === "digest") bytes[20] ^= 1;
      await writeFile(archive, bytes);
      await assert.rejects(restoreGlobalTextArtifacts({ repositoryRoot: root }), mode === "bound" ? /bounded direct regular file/ : /Compressed digest mismatch/);
      for (const name of TARGETS) await absent(path.join(root, name));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("a mismatched existing artifact is preserved and prevents partial restoration", async () => {
  const root = await fixture();
  try {
    const file = path.join(root, TARGETS[1]), bytes = Buffer.from("user-provided differing file\n"); await writeFile(file, bytes);
    await assert.rejects(restoreGlobalTextArtifacts({ repositoryRoot: root }), /Existing artifact size mismatch; refusing overwrite/);
    assert.deepEqual(await readFile(file), bytes); await absent(path.join(root, TARGETS[0]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manifest scope/size edits and symlinked destinations cannot redirect restoration", async () => {
  for (const mode of ["path", "limit", "symlink"]) {
    const root = await fixture();
    try {
      if (mode === "symlink") await symlink(path.join(root, STORAGE, "entries.jsonl.gz"), path.join(root, TARGETS[0]));
      else {
        const file = path.join(root, STORAGE, "manifest.json"), manifest = JSON.parse(await readFile(file, "utf8"));
        if (mode === "path") manifest.files[0].path = "../../outside.jsonl"; else manifest.files[0].uncompressedBytes = Number.MAX_SAFE_INTEGER;
        await writeFile(file, JSON.stringify(manifest));
      }
      await assert.rejects(restoreGlobalTextArtifacts({ repositoryRoot: root }), mode === "symlink" ? /direct file/ : /manifest digest mismatch/);
      await absent(path.join(root, TARGETS[1]));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
