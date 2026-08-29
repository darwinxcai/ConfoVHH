import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { canonicalJson, parseStrictJson } from "./hard-decoy/oracle/canonical-json.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const productSource = await readFile(path.join(repositoryRoot, "lib", "research-workspace.ts"), "utf8");
const productVersion = productSource.match(/CONFOVHH_PRODUCT_RELEASE\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
if (!productVersion) throw new Error("Unable to read the researcher-facing product version.");

if (process.argv.includes("--print-product-version")) {
  process.stdout.write(`${productVersion}\n`);
  process.exit(0);
}

function git(...args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

const trackedChanges = git("status", "--porcelain", "--untracked-files=no");
if (trackedChanges) {
  throw new Error("Release artifacts require a clean tracked working tree.");
}
const committedProductSource = git("show", "HEAD:lib/research-workspace.ts");
const committedProductVersion = committedProductSource.match(/CONFOVHH_PRODUCT_RELEASE\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
if (committedProductVersion !== productVersion) {
  throw new Error("The working-tree product version does not match the checked-out commit.");
}

async function sha256File(filename) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filename), hash);
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createProductionBuildManifest(distDirectory, { commitSha, treeSha }) {
  const rootInfo = await lstat(distDirectory, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The production output must be one direct directory.");
  }

  const files = [];
  async function visit(directory, prefix = "") {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`The production output contains a symbolic link: ${relative}.`);
      }
      if (entry.isDirectory()) {
        await visit(filename, relative);
        continue;
      }
      const info = await lstat(filename, { bigint: true });
      if (!entry.isFile() || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
        throw new Error(`The production output contains a non-regular or aliased file: ${relative}.`);
      }
      const bytes = Number(info.size);
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new Error(`The production output contains an unsafe file size: ${relative}.`);
      }
      files.push({
        path: `dist/${relative}`,
        bytes,
        sha256: await sha256File(filename),
      });
    }
  }
  await visit(distDirectory);
  if (!files.length) throw new Error("The production output contains no regular files.");
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const totalBytes = files.reduce((total, entry) => total + entry.bytes, 0);
  if (!Number.isSafeInteger(totalBytes)) throw new Error("The production output byte total is unsafe.");
  const orderedFileRootSha256 = sha256(files
    .map((entry) => `${entry.sha256}  ${entry.bytes}  ${entry.path}\n`)
    .join(""));
  return {
    schemaVersion: "1.0.0",
    productVersion,
    source: { commitSha, treeSha },
    purpose: "Inspection and attestation of the exact CI-built production output without publishing its credential-bearing bytes.",
    securityBoundary: {
      deployable: false,
      productionBundleArchivePublished: false,
      perBuildFrameworkCredentialsPresentInRecordedBundle: true,
      perBuildFrameworkCredentialBytesPublished: false,
      freshVerifiedBuildRequiredForDeployment: true,
    },
    fileCount: files.length,
    totalBytes,
    orderedFileRootSha256,
    files,
  };
}

async function verifyChecksumManifest(relativeManifest) {
  const manifestPath = path.join(repositoryRoot, relativeManifest);
  const manifest = await readFile(manifestPath, "utf8");
  if (!manifest.endsWith("\n")) throw new Error(`${relativeManifest} must end with LF.`);
  const directory = path.dirname(manifestPath);
  const seen = new Set();
  let verifiedFiles = 0;
  for (const [index, row] of manifest.trimEnd().split("\n").entries()) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/u.exec(row);
    if (!match) throw new Error(`${relativeManifest}:${index + 1} has invalid checksum syntax.`);
    const [, expected, relative] = match;
    const parts = relative.split("/");
    if (path.isAbsolute(relative) || parts.some((part) => !part || part === "." || part === "..") || seen.has(relative)) {
      throw new Error(`${relativeManifest}:${index + 1} has an unsafe or duplicate path.`);
    }
    seen.add(relative);
    const filename = path.resolve(directory, relative);
    if (path.relative(directory, filename) !== relative) throw new Error(`${relativeManifest}:${index + 1} escapes its package.`);
    const info = await lstat(filename, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) throw new Error(`${relativeManifest}:${index + 1} does not identify one direct regular file.`);
    if (await sha256File(filename) !== expected) throw new Error(`${relativeManifest}:${index + 1} checksum mismatch for ${relative}.`);
    verifiedFiles += 1;
  }
  if (!verifiedFiles) throw new Error(`${relativeManifest} contains no checksum rows.`);
  return { manifest: relativeManifest, verifiedFiles };
}

async function verifyV05ImplementationSnapshotBinding() {
  const snapshotDirectory = path.join(
    repositoryRoot,
    "validation",
    "v0.5-engine-implementation-snapshot-v1",
  );
  const snapshotPath = path.join(snapshotDirectory, "index.json");
  const snapshot = parseStrictJson(await readFile(snapshotPath, "utf8"), {
    maximumCharacters: 4 * 1024 * 1024,
    maximumTokens: 250_000,
  });
  const bindings = {
    "public-regression": {
      summary: "validation/v0.5-public-regression-attestation-v1/summary.json",
      summarySha256: "7d1dee34fe98a1b01cc05f5ad984f57841f9b1f2f545861ebca5d9a3fc83c4da",
      sourceCommit: "5cb57617b54baa314513486885c402449f643406",
    },
    "dockq-regression-replay": {
      summary: "validation/dockq-v0.5-regression-replay-v1/summary.json",
      summarySha256: "50aedd70d049aa065e687e6bdfe2e62b914126d4634fb151b01bf73237508743",
      sourceCommit: "278ae1a74da133778fba5b17bc296a8e37f02e76",
    },
  };
  assert.deepEqual(Object.keys(snapshot.attestations).sort(), Object.keys(bindings).sort());
  const expectedObjects = new Set();
  for (const [id, binding] of Object.entries(bindings)) {
    const archived = snapshot.attestations[id];
    assert.equal(archived.summary, binding.summary);
    assert.equal(archived.summarySha256, binding.summarySha256);
    assert.equal(archived.sourceCommit, binding.sourceCommit);
    const summaryPath = path.join(repositoryRoot, binding.summary);
    assert.equal(await sha256File(summaryPath), binding.summarySha256);
    const summary = parseStrictJson(await readFile(summaryPath, "utf8"), {
      maximumCharacters: 32 * 1024 * 1024,
      maximumTokens: 2_000_000,
    });
    assert.equal(archived.sourceCommit, summary.sourceAttestation.gitCommit);
    assert.equal(
      archived.implementationCombinedSha256,
      summary.sourceAttestation.implementation.combinedSha256,
    );
    assert.deepEqual(archived.files, summary.sourceAttestation.implementation.files);
    const combined = createHash("sha256");
    for (const [relative, expected] of Object.entries(archived.files)) {
      assert.match(expected, /^[a-f0-9]{64}$/u);
      const objectPath = path.join(snapshotDirectory, "objects", expected);
      const bytes = await readFile(objectPath);
      assert.equal(sha256(bytes), expected);
      expectedObjects.add(expected);
      combined.update(relative);
      combined.update("\0");
      combined.update(bytes);
      combined.update("\0");
    }
    assert.equal(combined.digest("hex"), archived.implementationCombinedSha256);
  }

  const publicSummary = parseStrictJson(await readFile(
    path.join(repositoryRoot, bindings["public-regression"].summary),
    "utf8",
  ));
  const recordedImmunum = publicSummary.sourceAttestation.executedDependencies.immunum;
  const archivedImmunum = snapshot.executedDependencies.immunum;
  assert.equal(canonicalJson(archivedImmunum), canonicalJson({
    name: recordedImmunum.name,
    version: recordedImmunum.version,
    fileCount: recordedImmunum.fileCount,
    combinedSha256: recordedImmunum.combinedSha256,
    files: Object.fromEntries(recordedImmunum.files.map((entry) => [
      entry.path,
      { bytes: entry.bytes, sha256: entry.sha256 },
    ])),
  }));
  const dependencyCombined = createHash("sha256");
  for (const [relative, entry] of Object.entries(archivedImmunum.files)) {
    const objectPath = path.join(snapshotDirectory, "objects", entry.sha256);
    const bytes = await readFile(objectPath);
    assert.equal(bytes.byteLength, entry.bytes);
    assert.equal(sha256(bytes), entry.sha256);
    expectedObjects.add(entry.sha256);
    dependencyCombined.update(relative);
    dependencyCombined.update("\0");
    dependencyCombined.update(entry.sha256);
    dependencyCombined.update("\0");
  }
  assert.equal(dependencyCombined.digest("hex"), archivedImmunum.combinedSha256);

  const objectEntries = await readdir(path.join(snapshotDirectory, "objects"), {
    withFileTypes: true,
  });
  assert.ok(objectEntries.every((entry) => entry.isFile() && /^[a-f0-9]{64}$/u.test(entry.name)));
  assert.deepEqual(objectEntries.map((entry) => entry.name).sort(), [...expectedObjects].sort());
  return {
    attestations: Object.keys(bindings).length,
    referencedObjects: expectedObjects.size,
    publicSummarySha256: bindings["public-regression"].summarySha256,
    replaySummarySha256: bindings["dockq-regression-replay"].summarySha256,
  };
}

function waitForProcess(child, label) {
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${code}.${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

async function gzipCommandToFile(command, args, destination, label) {
  const producer = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  const gzip = spawn("gzip", ["-n", "-9"], { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] });
  producer.stdout.pipe(gzip.stdin);
  await Promise.all([
    waitForProcess(producer, label),
    waitForProcess(gzip, `${label} compression`),
    pipeline(gzip.stdout, createWriteStream(destination)),
  ]);
}

async function commandToFile(command, args, destination, label) {
  const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  await Promise.all([
    waitForProcess(child, label),
    pipeline(child.stdout, createWriteStream(destination)),
  ]);
}

const packageManifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const engineVersion = packageManifest.version;
const citation = await readFile(path.join(repositoryRoot, "CITATION.cff"), "utf8");
const citationVersion = citation.match(/^version:\s*"?([^"\s]+)"?\s*$/m)?.[1];
if (citationVersion !== productVersion) {
  throw new Error(`CITATION.cff version ${citationVersion ?? "missing"} does not match product ${productVersion}.`);
}

const commitSha = git("rev-parse", "HEAD");
const treeSha = git("rev-parse", "HEAD^{tree}");
if (process.env.RELEASE_COMMIT_SHA && process.env.RELEASE_COMMIT_SHA !== commitSha) {
  throw new Error("RELEASE_COMMIT_SHA does not match the checked-out commit.");
}
if (process.env.RELEASE_TREE_SHA && process.env.RELEASE_TREE_SHA !== treeSha) {
  throw new Error("RELEASE_TREE_SHA does not match the checked-out tree.");
}

const tag = process.env.RELEASE_TAG || `product-v${productVersion}`;
if (tag !== `product-v${productVersion}`) throw new Error("The release tag does not match the product version.");
const outputDirectory = path.resolve(process.env.RELEASE_OUTPUT_DIRECTORY || path.join(repositoryRoot, "release-artifacts"));
await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length) {
  throw new Error("The release output directory must be empty to prevent stale assets from being published.");
}

const stem = `confovhh-product-v${productVersion}`;
const sourceArchive = path.join(outputDirectory, `${stem}-source.tar.gz`);
const productionBuildManifestFile = path.join(outputDirectory, `${stem}-production-build-manifest.json`);
const sbomFile = path.join(outputDirectory, `${stem}-sbom.cdx.json`);
const receiptFile = path.join(outputDirectory, `${stem}-provenance.json`);

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "confovhh-release-"));
let productionBuildManifest = null;
try {
  const sourceCheck = path.join(temporaryDirectory, "source-check.tar.gz");
  const archivePrefix = `ConfoVHH-product-v${productVersion}/`;
  await gzipCommandToFile("git", ["archive", "--format=tar", `--prefix=${archivePrefix}`, "HEAD"], sourceArchive, "source archive");
  await gzipCommandToFile("git", ["archive", "--format=tar", `--prefix=${archivePrefix}`, "HEAD"], sourceCheck, "source archive reproducibility check");
  if (await sha256File(sourceArchive) !== await sha256File(sourceCheck)) {
    throw new Error("Normalized packaging of the exact Git commit was not byte-for-byte deterministic.");
  }

  productionBuildManifest = await createProductionBuildManifest(
    path.join(repositoryRoot, "dist"),
    { commitSha, treeSha },
  );
  const productionBuildManifestCheck = await createProductionBuildManifest(
    path.join(repositoryRoot, "dist"),
    { commitSha, treeSha },
  );
  if (canonicalJson(productionBuildManifest) !== canonicalJson(productionBuildManifestCheck)) {
    throw new Error("The exact production-bundle manifest was not deterministic.");
  }
  await writeFile(
    productionBuildManifestFile,
    `${JSON.stringify(productionBuildManifest, null, 2)}\n`,
    "utf8",
  );

  await commandToFile("npm", ["sbom", "--sbom-format", "cyclonedx"], sbomFile, "CycloneDX SBOM generation");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
if (!productionBuildManifest) {
  throw new Error("The production-build manifest was not generated.");
}

const scientificManifests = [
  "validation/dockq-development-pilot-v1/checksums.sha256",
  "validation/dockq-v0.5-regression-replay-v1/checksums.sha256",
  "validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256",
  "validation/hard-decoy-holdout-v3/census-audit-2026-08-29/checksums.sha256",
  "validation/hard-decoy-holdout-v3/design-record/checksums.sha256",
  "validation/hard-decoy-holdout-v3/entry-metadata-draft/checksums.sha256",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/checksums.sha256",
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29-replay-054318Z/checksums.sha256",
  "validation/hard-decoy-holdout-v3/prelabel-census-draft/checksums.sha256",
  "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/checksums.sha256",
  "validation/v0.5-public-regression-attestation-v1/checksums.sha256",
  "validation/v0.5-engine-implementation-snapshot-v1/checksums.sha256",
];
const scientificStandaloneArtifacts = [
  "validation/hard-decoy-holdout-v3/INTEGRATION_STATE_2026-08-29.json",
  "validation/hard-decoy-holdout-v3/ENTRY_METADATA_SNAPSHOT_ATTESTATION_2026-08-29.json",
  "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json",
  "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_IMPORT_RECEIPT_2026-08-29.json",
  "validation/hard-decoy-holdout-v3/source-licenses-2026-08-29.json",
];
const scientificChecksumVerification = await Promise.all(scientificManifests.map(verifyChecksumManifest));
const v05ImplementationSnapshotBinding = await verifyV05ImplementationSnapshotBinding();
const scientificArtifactDigests = Object.fromEntries(await Promise.all(
  [...scientificManifests, ...scientificStandaloneArtifacts]
    .map(async (relative) => [relative, await sha256File(path.join(repositoryRoot, relative))]),
));
const releaseAssetDigests = Object.fromEntries(await Promise.all(
  [sourceArchive, productionBuildManifestFile, sbomFile]
    .map(async (filename) => [path.basename(filename), await sha256File(filename)]),
));

const receipt = {
  schemaVersion: "1.2.0",
  generatedAt: new Date().toISOString(),
  product: {
    name: "ConfoVHH",
    productVersion,
    scientificEngineVersion: engineVersion,
    tag,
  },
  source: {
    repository: "https://github.com/darwinxcai/ConfoVHH",
    commitSha,
    treeSha,
    rootPackageLockSha256: await sha256File(path.join(repositoryRoot, "package-lock.json")),
    qaPackageLockSha256: await sha256File(path.join(repositoryRoot, "qa", "package-lock.json")),
    securityAuditSha256: await sha256File(path.join(repositoryRoot, "SECURITY_AUDIT.md")),
  },
  continuousIntegration: {
    runId: process.env.RELEASE_CI_RUN_ID || null,
    runUrl: process.env.RELEASE_CI_RUN_URL || null,
  },
  runtime: {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
  },
  deployment: {
    publicUrl: process.env.RELEASE_SITE_URL || "https://confovhh.darwin-cai.chatgpt.site",
    sourceTreeBinding: "The hosted release is a separate fresh build from this Git tree and never reuses a published production bundle.",
  },
  scientificArtifactManifestSha256: scientificArtifactDigests,
  scientificChecksumVerification: {
    status: "passed",
    manifests: scientificChecksumVerification,
    verifiedManifestCount: scientificChecksumVerification.length,
    verifiedFileCount: scientificChecksumVerification.reduce((total, entry) => total + entry.verifiedFiles, 0),
  },
  v05ImplementationSnapshotBinding: {
    status: "passed",
    ...v05ImplementationSnapshotBinding,
  },
  productionBuildManifest: {
    asset: path.basename(productionBuildManifestFile),
    fileCount: productionBuildManifest.fileCount,
    totalBytes: productionBuildManifest.totalBytes,
    orderedFileRootSha256: productionBuildManifest.orderedFileRootSha256,
  },
  releaseAssetSha256: releaseAssetDigests,
  boundaries: {
    frozenScientificArtifactChecksumsVerified:
      scientificChecksumVerification.length === scientificManifests.length,
    dependencyEnvironmentMatchesAttestedV05: false,
    checksumManifestsVerified: true,
    sourceArchivePackagingDeterministicForExactCommit: true,
    productionBundleManifestDeterministicForExactBundle: true,
    productionBundleArchivePublished: false,
    productionBundleCredentialBearingBytesPublished: false,
    productionBuildManifestSafeForDeployment: false,
    freshProductionBuildRequiredForDeployment: true,
    independentProductionCompilationReproducibilityVerified: false,
    independentProductionCompilationReproducibilityClaimed: false,
    bindingValidated: false,
    candidateSelectionValidated: false,
    formalHardDecoyHoldoutEvaluated: false,
    oracleRequestFrozen: false,
    oracleExecuted: false,
    developmentEvaluationExecuted: false,
  },
};
await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

const checksummedFiles = [sourceArchive, productionBuildManifestFile, sbomFile, receiptFile];
const checksumLines = await Promise.all(checksummedFiles
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right), "en"))
  .map(async (filename) => `${await sha256File(filename)}  ${path.basename(filename)}`));
await writeFile(path.join(outputDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ productVersion, engineVersion, tag, commitSha, treeSha, outputDirectory })}\n`);
