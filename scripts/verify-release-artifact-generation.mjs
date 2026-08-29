import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./hard-decoy/oracle/canonical-json.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const generator = path.join(repositoryRoot, "scripts", "create-release-artifacts.mjs");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertExactRecord(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value);
  }
}

const commitSha = run("git", ["rev-parse", "HEAD"]);
const treeSha = run("git", ["rev-parse", "HEAD^{tree}"]);
const productVersion = run(process.execPath, [generator, "--print-product-version"]);
const stem = `confovhh-product-v${productVersion}`;
const temporary = await mkdtemp(path.join(tmpdir(), "confovhh-release-smoke-"));
const outputDirectory = path.join(temporary, "artifacts");
const staleDirectory = path.join(temporary, "stale-artifacts");
const releaseEnvironment = {
  ...process.env,
  RELEASE_TAG: `product-v${productVersion}`,
  RELEASE_COMMIT_SHA: commitSha,
  RELEASE_TREE_SHA: treeSha,
  RELEASE_SITE_URL: "https://confovhh.darwin-cai.chatgpt.site",
};

try {
  const generated = spawnSync(process.execPath, [generator], {
    cwd: repositoryRoot,
    env: { ...releaseEnvironment, RELEASE_OUTPUT_DIRECTORY: outputDirectory },
    encoding: "utf8",
  });
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const expectedFiles = [
    "SHA256SUMS",
    `${stem}-production-build-manifest.json`,
    `${stem}-provenance.json`,
    `${stem}-sbom.cdx.json`,
    `${stem}-source.tar.gz`,
  ].sort();
  const actualFiles = (await readdir(outputDirectory)).sort();
  assert.deepEqual(actualFiles, expectedFiles);
  assert.ok(actualFiles.every((filename) => !filename.endsWith("-dist.tar.gz")));
  for (const filename of actualFiles) {
    const info = await lstat(path.join(outputDirectory, filename), { bigint: true });
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n);
  }

  run("sha256sum", ["--check", "SHA256SUMS"], { cwd: outputDirectory });
  const checksumRows = (await readFile(path.join(outputDirectory, "SHA256SUMS"), "utf8"))
    .trimEnd()
    .split("\n");
  assert.equal(checksumRows.length, 4);
  assert.ok(checksumRows.every((row) => !row.includes("-dist.tar.gz")));

  const manifestFilename = `${stem}-production-build-manifest.json`;
  const manifest = parseStrictJson(
    await readFile(path.join(outputDirectory, manifestFilename), "utf8"),
    { maximumCharacters: 8 * 1024 * 1024, maximumTokens: 500_000 },
  );
  assert.equal(manifest.schemaVersion, "1.0.0");
  assertExactRecord(manifest.source, { commitSha, treeSha });
  assertExactRecord(manifest.securityBoundary, {
    deployable: false,
    productionBundleArchivePublished: false,
    perBuildFrameworkCredentialsPresentInRecordedBundle: true,
    perBuildFrameworkCredentialBytesPublished: false,
    freshVerifiedBuildRequiredForDeployment: true,
  });
  assert.ok(Number.isSafeInteger(manifest.fileCount) && manifest.fileCount > 0);
  assert.equal(manifest.fileCount, manifest.files.length);
  assert.equal(
    manifest.totalBytes,
    manifest.files.reduce((total, entry) => total + entry.bytes, 0),
  );
  const paths = manifest.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort((left, right) => left.localeCompare(right, "en")));
  assert.equal(new Set(paths).size, paths.length);
  for (const entry of manifest.files) {
    assert.ok(entry.path.startsWith("dist/") && !entry.path.includes("\\"));
    assert.ok(entry.path.split("/").every((part) => part && part !== "." && part !== ".."));
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.equal(
    manifest.orderedFileRootSha256,
    sha256(manifest.files
      .map((entry) => `${entry.sha256}  ${entry.bytes}  ${entry.path}\n`)
      .join("")),
  );

  const receipt = parseStrictJson(
    await readFile(path.join(outputDirectory, `${stem}-provenance.json`), "utf8"),
    { maximumCharacters: 8 * 1024 * 1024, maximumTokens: 500_000 },
  );
  assert.equal(receipt.schemaVersion, "1.2.0");
  assert.equal(receipt.source.commitSha, commitSha);
  assert.equal(receipt.source.treeSha, treeSha);
  assertExactRecord(receipt.productionBuildManifest, {
    asset: manifestFilename,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    orderedFileRootSha256: manifest.orderedFileRootSha256,
  });
  assert.deepEqual(Object.keys(receipt.releaseAssetSha256).sort(), [
    manifestFilename,
    `${stem}-sbom.cdx.json`,
    `${stem}-source.tar.gz`,
  ].sort());
  assert.equal(receipt.boundaries.productionBundleManifestDeterministicForExactBundle, true);
  assert.equal(receipt.boundaries.productionBundleArchivePublished, false);
  assert.equal(receipt.boundaries.productionBundleCredentialBearingBytesPublished, false);
  assert.equal(receipt.boundaries.productionBuildManifestSafeForDeployment, false);
  assert.equal(receipt.boundaries.freshProductionBuildRequiredForDeployment, true);
  assert.equal(receipt.boundaries.independentProductionCompilationReproducibilityVerified, false);
  assert.equal(receipt.boundaries.independentProductionCompilationReproducibilityClaimed, false);

  await mkdir(staleDirectory);
  await writeFile(path.join(staleDirectory, `${stem}-dist.tar.gz`), "must-not-publish\n");
  const rejected = spawnSync(process.execPath, [generator], {
    cwd: repositoryRoot,
    env: { ...releaseEnvironment, RELEASE_OUTPUT_DIRECTORY: staleDirectory },
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stderr}\n${rejected.stdout}`, /release output directory must be empty/u);

  process.stdout.write(
    `Release artifact smoke passed: ${actualFiles.length} assets, ${manifest.fileCount} hashed production files, no production bundle archive.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
