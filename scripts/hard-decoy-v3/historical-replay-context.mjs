import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ARCHIVE = "validation/historical-dependencies/hard-decoy-v3/package-lock.json";
export const HISTORICAL_LOCK_SHA256 = "0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54";
const NUMBERING_FILES = {
  "package.json": "733c9d00636ec6b88ba3ff7584ecc2fb77380eb5d65750cdcacdd9214299b098",
  "immunum.js": "a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00",
  "immunum_bg.wasm": "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b",
  "README.md": "4af495e25be8dc56e59930813a31c67c5e0fae71f9bfd86facfe37d490ee9159",
};
const REPLAY_INPUTS = [
  "HARD_DECOY_PROTOCOL.md",
  "HARD_DECOY_PROTOCOL_V2.md",
  "HARD_DECOY_PROTOCOL_V3.md",
  "HARD_DECOY_PROTOCOL_V3_DRAFT.md",
  "LEAKAGE_COMPONENT_DEVELOPMENT_PROTOCOL.md",
  "scripts/hard-decoy",
  "scripts/hard-decoy-v3",
  "validation/hard-decoy-holdout-v2",
  "validation/hard-decoy-holdout-v3",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function directBytes(filename) {
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1,
    `Historical replay input must be one direct regular file: ${filename}`);
  return readFile(filename);
}

/**
 * Replays retained metadata against its archived lock input. This does not
 * install the old dependency closure or certify the current product as that
 * environment. The actually loaded numbering implementation is byte-checked.
 */
export async function createHistoricalReplayContext(repositoryRoot = ROOT) {
  const source = await realpath(repositoryRoot);
  assert.equal(source, path.resolve(repositoryRoot), "Replay source root cannot contain symlinked ancestors.");
  const lock = await directBytes(path.join(source, ARCHIVE));
  assert.equal(sha256(lock), HISTORICAL_LOCK_SHA256, "Archived historical dependency lock digest drifted.");
  const contract = JSON.parse(await directBytes(path.join(source,
    "validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json")));
  assert.equal(contract.numbering.packageLockSha256, HISTORICAL_LOCK_SHA256,
    "Historical lock no longer matches the unchanged numbering contract.");

  // Resolve from this module, exactly as the unchanged scientific imports do.
  const installed = path.dirname(createRequire(import.meta.url).resolve("immunum"));
  const numberedBytes = new Map();
  for (const [filename, expected] of Object.entries(NUMBERING_FILES)) {
    const bytes = await directBytes(path.join(installed, filename));
    assert.equal(sha256(bytes), expected, `Executed immunum bytes drifted: ${filename}`);
    numberedBytes.set(filename, bytes);
  }

  const snapshot = await realpath(await mkdtemp(path.join(os.tmpdir(), "confovhh-historical-replay-")));
  try {
    for (const relative of REPLAY_INPUTS) {
      const destination = path.join(snapshot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(source, relative), destination, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        filter: async (filename) => {
          const info = await lstat(filename);
          assert.ok(!info.isSymbolicLink() && (info.isDirectory() || (info.isFile() && info.nlink === 1)),
            `Historical replay refuses linked or special inputs: ${filename}`);
          return true;
        },
      });
    }
    await writeFile(path.join(snapshot, "package-lock.json"), lock, { flag: "wx" });
    await mkdir(path.join(snapshot, "node_modules/immunum"), { recursive: true });
    for (const [filename, bytes] of numberedBytes) {
      await writeFile(path.join(snapshot, "node_modules/immunum", filename), bytes, { flag: "wx" });
    }
    assert.equal(sha256(await directBytes(path.join(snapshot, "package-lock.json"))), HISTORICAL_LOCK_SHA256);
    return {
      root: snapshot,
      // These verifiers record their own paths relative to the replay root.
      // Load their byte-identical copies so that those bindings remain exact.
      importModule: (relative) => {
        assert.ok(/^scripts\/hard-decoy(?:-v3)?\/[A-Za-z0-9-]+\.mjs$/u.test(relative),
          "Historical replay module must be a copied scientific script.");
        return import(pathToFileURL(path.join(snapshot, relative)).href);
      },
      cleanup: () => rm(snapshot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(snapshot, { recursive: true, force: true });
    throw error;
  }
}
