#!/usr/bin/env node
// Regenerate the deposition manifest for the retained application evidence.
//
// The manifest lists exactly which committed files a public archive must carry
// for the paper's "available inputs" gate, with their byte counts and SHA-256
// digests. It records what the repository already holds. It does not deposit
// anything, does not contact an archive, and does not assert that redistribution
// terms have been cleared: those remain author actions recorded in the manifest's
// `deposit` block.
//
// Usage:
//   node scripts/paper/build-deposition-manifest.mjs [--check]
//
// Without --check the manifest is written. With --check the regenerated content
// is compared against the committed file and a difference exits non-zero.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_PATH = path.join(REPOSITORY_ROOT, "paper", "submission-kit", "deposition-manifest.json");

export const MANIFEST_SCHEMA_VERSION = "confovhh-deposition-manifest-1.0.0";

/** Evidence trees the manuscript cites as its retained application inputs.
 *
 * Every entry must be tracked by git: an untracked file is a local artifact and
 * cannot be part of a deposit that a reviewer can reproduce from the repository.
 */
export const DEPOSITION_COMPONENTS = Object.freeze([
  Object.freeze({
    id: "paired-development-study",
    directory: "validation/gpcr-paper-development-2026-09-04",
    describes:
      "Reviewed inclusion, official DockQ 2.1.3 scores, unchanged ConfoVHH audits, endpoint reproduction, all 165 paired values, and the measured figure.",
  }),
  Object.freeze({
    id: "selection-audit",
    directory: "validation/gpcr-selection-development-2026-09-05",
    describes:
      "All 33 jobs, four comparison rules, original-score checks, ties, and the possible-outcome enumeration behind the selection result.",
  }),
  Object.freeze({
    id: "matched-templates",
    directory: "validation/gpcr-matched-template-development-2026-09-05",
    describes:
      "Coordinate-preserving matched receptor templates, their exclusions, masks, and conversion audit.",
  }),
  Object.freeze({
    id: "reviewer-demonstration",
    directory: "paper/evidence",
    describes:
      "Execution receipts for the offline synthetic reviewer demonstration described in the reviewer guide.",
  }),
]);

/** Files the deposit must NOT carry, whatever a directory scan finds.
 *
 * The independent hard-decoy holdout is unexposed by construction. Nothing under
 * it may enter a public deposit tied to this paper, and no scan is permitted to
 * add it silently.
 */
export const EXCLUDED_PREFIXES = Object.freeze([
  "validation/hard-decoy-holdout-v3/",
]);

function trackedFiles(directory) {
  const output = execFileSync("git", ["ls-files", "-z", "--", directory], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((entry) => entry.length > 0).sort();
}

async function describeFile(relativePath) {
  const bytes = await readFile(path.join(REPOSITORY_ROOT, relativePath));
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function buildManifest() {
  const components = [];
  for (const component of DEPOSITION_COMPONENTS) {
    const paths = trackedFiles(component.directory);
    if (paths.length === 0) {
      throw new Error(`${component.directory}: no tracked files; refusing to describe an empty component`);
    }
    for (const entry of paths) {
      const excluded = EXCLUDED_PREFIXES.find((prefix) => entry.startsWith(prefix));
      if (excluded) {
        throw new Error(`${entry}: matches the withheld prefix ${excluded} and must never enter a deposit`);
      }
    }
    const files = [];
    for (const entry of paths) files.push(await describeFile(entry));
    components.push({
      id: component.id,
      directory: component.directory,
      describes: component.describes,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
    });
  }

  const fileCount = components.reduce((sum, component) => sum + component.fileCount, 0);
  const totalBytes = components.reduce((sum, component) => sum + component.totalBytes, 0);

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: "scripts/paper/build-deposition-manifest.mjs",
    purpose:
      "Names the retained application evidence a public archive must carry so a reader can reproduce the reported summary-level results from a deposit rather than from this repository alone.",
    boundary:
      "These files are the retained subset. They do not include the 85 preliminary cognate model coordinates or the full per-model PAE matrices, which remain unavailable. Nothing from the independent hard-decoy holdout is listed, and no entry may ever be added from it.",
    fileCount,
    totalBytes,
    components,
    // Author-completed once a deposit exists. `submission-status.mjs` treats a
    // null field as an open gate; it never infers a deposit from this file.
    deposit: {
      archive: null,
      recordUrl: null,
      doi: null,
      license: null,
      redistributionTermsClearedBy: null,
      redistributionTermsClearedOn: null,
      depositedCommit: null,
      notes: null,
    },
  };
}

function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main() {
  const check = process.argv.includes("--check");
  const manifest = await buildManifest();

  if (!check) {
    // Preserve an existing author-completed deposit block across regeneration.
    try {
      const existing = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
      if (existing?.deposit && typeof existing.deposit === "object") {
        manifest.deposit = { ...manifest.deposit, ...existing.deposit };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await writeFile(MANIFEST_PATH, serialize(manifest));
    process.stdout.write(
      `Wrote ${path.relative(REPOSITORY_ROOT, MANIFEST_PATH)}: ` +
        `${manifest.fileCount} files, ${manifest.totalBytes} bytes across ${manifest.components.length} components.\n`,
    );
    return;
  }

  const committed = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  manifest.deposit = committed.deposit;
  if (serialize(manifest) !== serialize(committed)) {
    process.stderr.write(
      "Deposition manifest is stale: the listed evidence no longer matches the working tree.\n" +
        "Regenerate with: node scripts/paper/build-deposition-manifest.mjs\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Deposition manifest matches the working tree (${manifest.fileCount} files).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
