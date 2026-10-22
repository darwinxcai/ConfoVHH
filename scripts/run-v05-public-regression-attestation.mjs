import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT_DIRECTORY = path.join(
  ROOT,
  "validation",
  "v0.5-public-regression-attestation-v1",
);
const PUBLICATION_LOCK_PATH = path.join(
  ROOT,
  ".git",
  "confovhh-v05-public-attestation.lock",
);
const IMPLEMENTATION_FILES = [
  "lib/confovhh.ts",
  "lib/geometry-constants.ts",
  "lib/geometry-fit.ts",
  "lib/mmcif.ts",
  "lib/vhh-numbering.ts",
  "package.json",
  "package-lock.json",
  "scripts/benchmark-mmcif-assemblies.mjs",
  "scripts/benchmark-public-pdbs.mjs",
  "scripts/public-coordinate-download.mjs",
  "scripts/run-v05-public-regression-attestation.mjs",
  "validation/mmcif-regression-manifest.v1.json",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function committedFileBytes(sourceCommit, relative) {
  return execFileSync("git", ["show", `${sourceCommit}:${relative}`], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function implementationDigest(sourceCommit) {
  const combined = createHash("sha256");
  const files = {};
  for (const relative of IMPLEMENTATION_FILES) {
    const bytes = committedFileBytes(sourceCommit, relative);
    files[relative] = sha256(bytes);
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }
  return { combinedSha256: combined.digest("hex"), files };
}

async function installedPackageDigest(packageDirectory, expectedName, expectedVersion) {
  const packageRecord = JSON.parse(await readFile(
    path.join(packageDirectory, "package.json"),
    "utf8",
  ));
  assert.equal(packageRecord.name, expectedName);
  assert.equal(packageRecord.version, expectedVersion);
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
        continue;
      }
      assert.equal(entry.isFile(), true, `${expectedName}: unsupported package entry ${relative}`);
      const bytes = await readFile(absolute);
      files.push({ path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  await visit(packageDirectory);
  const combined = createHash("sha256");
  for (const entry of files) {
    combined.update(entry.path);
    combined.update("\0");
    combined.update(entry.sha256);
    combined.update("\0");
  }
  return {
    name: expectedName,
    version: expectedVersion,
    fileCount: files.length,
    combinedSha256: combined.digest("hex"),
    files,
  };
}

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertCleanSource() {
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  assert.equal(status, "", "Public regression attestation requires a clean source tree");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  return commit;
}

function runJson(script, cwd) {
  const output = execFileSync(process.execPath, [path.join(cwd, script)], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(output);
}

async function executeAtCommit(sourceCommit) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "confovhh-public-v05-"));
  const worktree = path.join(temporaryRoot, "worktree");
  try {
    execFileSync("git", ["worktree", "add", "--detach", worktree, sourceCommit], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 120_000,
    });
    await symlink(path.join(ROOT, "node_modules"), path.join(worktree, "node_modules"), "dir");
    const immunumBefore = await installedPackageDigest(
      path.join(worktree, "node_modules", "immunum"),
      "immunum",
      "1.2.0",
    );
    const results = {
      mmcifAndAssemblies: runJson("scripts/benchmark-mmcif-assemblies.mjs", worktree),
      nativeInterfaces: runJson("scripts/benchmark-public-pdbs.mjs", worktree),
    };
    const status = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: worktree, encoding: "utf8" },
    ).trim();
    assert.equal(status, "", "Executed public-regression worktree changed during the run");
    const immunumAfter = await installedPackageDigest(
      path.join(worktree, "node_modules", "immunum"),
      "immunum",
      "1.2.0",
    );
    assert.deepEqual(
      immunumAfter,
      immunumBefore,
      "Installed immunum distribution changed during public regressions",
    );
    return { results, executedDependencies: { immunum: immunumBefore } };
  } finally {
    if (await pathExists(worktree)) {
      execFileSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: ROOT,
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 120_000,
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validateResults(results) {
  const mmcif = results.mmcifAndAssemblies;
  assert.equal(mmcif.schemaVersion, "1.0.0");
  assert.equal(mmcif.softwareVersion, "0.5.0");
  assert.equal(mmcif.status, "executed");
  assert.equal(mmcif.nativeSerializationParity.structures, 17);
  assert.equal(mmcif.nativeSerializationParity.exactDiscreteMatches, 17);
  assert.equal(mmcif.nativeSerializationParity.deltaSasaParityToleranceAngstrom2, 1e-9);
  assert.equal(mmcif.depositedAssemblyOracle.structures, 5);
  assert.equal(mmcif.depositedAssemblyOracle.exactCountMatches, 5);
  assert.equal(mmcif.depositedAssemblyOracle.results.length, 5);
  for (const entry of mmcif.nativeSerializationParity.results) {
    assert.match(entry.pdbSourceSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.mmcifSourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.exactDiscreteSerializationParity, true);
    assert.ok(entry.deltaSasaAbsoluteDifferenceAngstrom2 <= 1e-9);
  }
  for (const entry of mmcif.depositedAssemblyOracle.results) {
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.officialAssemblySha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.maximumCoordinateErrorAngstrom <= 0.0011);
  }

  const native = results.nativeInterfaces;
  assert.equal(native.schemaVersion, "1.0.0");
  assert.equal(native.softwareVersion, "0.5.0");
  assert.equal(native.structures, 17);
  assert.equal(native.nativeInterfacesDetected, 17);
  assert.equal(native.wholeComplexTranslationsInvariant, 17);
  assert.equal(native.translatedDecoysRejected, 102);
  assert.equal(native.results.length, 17);
  for (const entry of native.results) {
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(entry.sourceBytes) && entry.sourceBytes > 0);
    assert.ok(entry.contactPairs > 0);
    assert.equal(entry.wholeComplexTranslationInvariant, true);
    assert.equal(entry.translatedControlsRejected, 6);
  }
  const nativeByPdb = new Map(native.results.map((entry) => [entry.pdb, entry]));
  for (const entry of mmcif.nativeSerializationParity.results) {
    const independentlyDownloaded = nativeByPdb.get(entry.pdb);
    assert.ok(independentlyDownloaded, `${entry.pdb}: missing native-panel PDB download`);
    assert.equal(
      independentlyDownloaded.sourceBytes,
      entry.pdbSourceBytes,
      `${entry.pdb}: independent PDB byte counts differ`,
    );
    assert.equal(
      independentlyDownloaded.sourceSha256,
      entry.pdbSourceSha256,
      `${entry.pdb}: independent PDB SHA-256 values differ`,
    );
  }
}

async function main() {
  assert.equal(
    OUTPUT_DIRECTORY,
    path.join(ROOT, "validation", "v0.5-public-regression-attestation-v1"),
  );
  assert.equal(await pathExists(OUTPUT_DIRECTORY), false, "Refusing to overwrite public attestation");
  const packageRecord = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageRecord.version, "0.5.0");
  assert.equal(packageRecord.engines.node, ">=22.18.0");
  const sourceCommit = assertCleanSource();
  const startedAt = new Date().toISOString();
  const execution = await executeAtCommit(sourceCommit);
  const { results } = execution;
  validateResults(results);
  const implementation = implementationDigest(sourceCommit);

  assert.equal(assertCleanSource(), sourceCommit, "Source changed during public regressions");
  assert.equal(await pathExists(OUTPUT_DIRECTORY), false, "Refusing to overwrite public attestation");
  const summary = {
    schemaVersion: "1.0.0",
    attestationId: "confovhh-v0.5-public-structural-regressions-v1",
    status: "executed-current-release-regression",
    dataRole: "regression",
    runStartedAt: startedAt,
    runCompletedAt: new Date().toISOString(),
    sourceAttestation: {
      gitCommit: sourceCommit,
      workingTreeDirtyAtStart: false,
      nodeVersion: process.versions.node,
      minimumNodeVersion: "22.18.0",
      implementation,
      executedDependencies: execution.executedDependencies,
    },
    accounting: {
      pdbMmcifSerializationPairs: 17,
      depositedAssemblyOracles: 5,
      nativeInterfaces: 17,
      wholeComplexTranslationChecks: 17,
      farTranslationControls: 102,
    },
    claimFlags: {
      bindingValidated: false,
      affinityValidated: false,
      specificityValidated: false,
      functionalStateValidated: false,
      stateSelectivityValidated: false,
      membraneCompatibilityValidated: false,
      formalHoldoutEvaluated: false,
      nearNativeRankingValidated: false,
    },
    limitations: [
      "These are coordinate/parser regression exercises, not binding or nonbinding experiments.",
      "The far translations are obvious geometry controls, not realistic docking negatives.",
      "Native interfaces do not validate near-native ranking or conformational-state selectivity.",
      "Deposited assembly agreement does not establish physiological oligomerization.",
    ],
  };

  const outputs = {
    "mmcif-and-assemblies.json": `${JSON.stringify(results.mmcifAndAssemblies, null, 2)}\n`,
    "native-interfaces.json": `${JSON.stringify(results.nativeInterfaces, null, 2)}\n`,
    "summary.json": `${JSON.stringify(summary, null, 2)}\n`,
  };
  const checksumText = `${Object.entries(outputs).map(([filename, value]) => (
    `${sha256(value)}  ${filename}`
  )).join("\n")}\n`;
  const staging = await mkdtemp(
    path.join(ROOT, "validation", ".v05-public-attestation-staging-"),
  );
  let published = false;
  try {
    for (const [filename, value] of Object.entries(outputs)) {
      await writeFile(path.join(staging, filename), value, "utf8");
      assert.equal(sha256(await readFile(path.join(staging, filename))), sha256(value));
    }
    await writeFile(path.join(staging, "checksums.sha256"), checksumText, "utf8");
    assert.equal(await pathExists(OUTPUT_DIRECTORY), false);
    await rename(staging, OUTPUT_DIRECTORY);
    published = true;
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    attestationId: summary.attestationId,
    status: summary.status,
    sourceCommit,
    accounting: summary.accounting,
    claimFlags: summary.claimFlags,
  }, null, 2));
}

let publicationLock;
try {
  try {
    publicationLock = await open(PUBLICATION_LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "Another public attestation holds the exclusive publication lock. " +
        "If no run is active, inspect and remove the stale repository lock file.",
      );
    }
    throw error;
  }
  await main();
} finally {
  if (publicationLock) {
    await publicationLock.close();
    await unlink(PUBLICATION_LOCK_PATH).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
