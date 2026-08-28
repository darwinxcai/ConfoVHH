import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

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

const stem = `confovhh-product-v${productVersion}`;
const sourceArchive = path.join(outputDirectory, `${stem}-source.tar.gz`);
const distArchive = path.join(outputDirectory, `${stem}-dist.tar.gz`);
const sbomFile = path.join(outputDirectory, `${stem}-sbom.cdx.json`);
const receiptFile = path.join(outputDirectory, `${stem}-provenance.json`);

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "confovhh-release-"));
try {
  const sourceCheck = path.join(temporaryDirectory, "source-check.tar.gz");
  const distCheck = path.join(temporaryDirectory, "dist-check.tar.gz");
  const archivePrefix = `ConfoVHH-product-v${productVersion}/`;
  await gzipCommandToFile("git", ["archive", "--format=tar", `--prefix=${archivePrefix}`, "HEAD"], sourceArchive, "source archive");
  await gzipCommandToFile("git", ["archive", "--format=tar", `--prefix=${archivePrefix}`, "HEAD"], sourceCheck, "source archive reproducibility check");
  if (await sha256File(sourceArchive) !== await sha256File(sourceCheck)) {
    throw new Error("The source archive was not byte-for-byte reproducible.");
  }

  const tarArgs = [
    "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--format=posix", "--pax-option=delete=atime,delete=ctime", "-cf", "-", "dist",
  ];
  await gzipCommandToFile("tar", tarArgs, distArchive, "production bundle archive");
  await gzipCommandToFile("tar", tarArgs, distCheck, "production bundle reproducibility check");
  if (await sha256File(distArchive) !== await sha256File(distCheck)) {
    throw new Error("The production bundle archive was not byte-for-byte reproducible.");
  }

  await commandToFile("npm", ["sbom", "--sbom-format", "cyclonedx"], sbomFile, "CycloneDX SBOM generation");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const scientificManifests = [
  "validation/dockq-development-pilot-v1/checksums.sha256",
  "validation/dockq-v0.5-regression-replay-v1/checksums.sha256",
  "validation/hard-decoy-holdout-v2/prelabel-census/checksums.sha256",
  "validation/v0.5-public-regression-attestation-v1/checksums.sha256",
];
const scientificArtifactDigests = Object.fromEntries(await Promise.all(
  scientificManifests.map(async (relative) => [relative, await sha256File(path.join(repositoryRoot, relative))]),
));
const releaseAssetDigests = Object.fromEntries(await Promise.all(
  [sourceArchive, distArchive, sbomFile].map(async (filename) => [path.basename(filename), await sha256File(filename)]),
));

const receipt = {
  schemaVersion: "1.0.0",
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
    sourceTreeBinding: "The hosted release is verified separately against this Git tree.",
  },
  scientificArtifactManifestSha256: scientificArtifactDigests,
  releaseAssetSha256: releaseAssetDigests,
  boundaries: {
    frozenScientificArtifactsModified: false,
    bindingValidated: false,
    candidateSelectionValidated: false,
    formalHardDecoyHoldoutEvaluated: false,
  },
};
await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

const checksummedFiles = [sourceArchive, distArchive, sbomFile, receiptFile];
const checksumLines = await Promise.all(checksummedFiles
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right), "en"))
  .map(async (filename) => `${await sha256File(filename)}  ${path.basename(filename)}`));
await writeFile(path.join(outputDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ productVersion, engineVersion, tag, commitSha, treeSha, outputDirectory })}\n`);
