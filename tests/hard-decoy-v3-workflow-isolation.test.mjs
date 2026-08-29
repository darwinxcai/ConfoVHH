import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROFILES,
  createReceipt,
  gitBlobSha1,
  serializeReceipt,
  verifyStagedInputs,
} from "../scripts/hard-decoy/stage-v3-metadata-inputs.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPOSITORY = "owner/repository";
const COMMIT = "a".repeat(40);
const WORKFLOWS = [
  ".github/workflows/hard-decoy-v3-metadata.yml",
  ".github/workflows/hard-decoy-v3-entry-metadata.yml",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteSort(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function directoriesFor(paths) {
  const directories = new Set([""]);
  for (const relative of paths) {
    let directory = path.posix.dirname(relative);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return [...directories].sort((left, right) => right.split("/").length - left.split("/").length || Buffer.from(left).compare(Buffer.from(right)));
}

async function makeLocalStage(profile = "source-universe") {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-isolated-stage-"));
  const outputDirectory = path.join(temporary, "inputs");
  const receiptPath = path.join(temporary, "receipt.json");
  await mkdir(outputDirectory);
  const records = [];
  for (const relative of PROFILES[profile]) {
    const source = path.join(ROOT, ...relative.split("/"));
    const destination = path.join(outputDirectory, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const bytes = await readFile(destination);
    records.push({ path: relative, gitBlobSha1: gitBlobSha1(bytes), sha256: sha256(bytes), bytes: bytes.byteLength });
    await chmod(destination, 0o444);
  }
  const receipt = createReceipt(profile, REPOSITORY, COMMIT, records);
  await writeFile(receiptPath, serializeReceipt(receipt), { flag: "wx", mode: 0o444 });
  await chmod(receiptPath, 0o444);
  for (const directory of directoriesFor(PROFILES[profile])) {
    await chmod(directory ? path.join(outputDirectory, ...directory.split("/")) : outputDirectory, 0o555);
  }
  return { temporary, outputDirectory, receiptPath, receipt, profile };
}

async function makeWritable(target) {
  let info;
  try { info = await lstat(target); } catch { return; }
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(target, 0o755);
    for (const entry of await readdir(target)) await makeWritable(path.join(target, entry));
  } else {
    await chmod(target, 0o644);
  }
}

async function dispose(fixture) {
  await makeWritable(fixture.temporary);
  await rm(fixture.temporary, { recursive: true, force: true });
}

async function rewriteReceipt(fixture, mutate) {
  await chmod(fixture.receiptPath, 0o644);
  const next = structuredClone(fixture.receipt);
  mutate(next);
  await writeFile(fixture.receiptPath, serializeReceipt(next));
  await chmod(fixture.receiptPath, 0o444);
}

test("metadata-only profiles are exact, closed, and exclude evaluation artifacts", async () => {
  assert.equal(PROFILES["source-universe"].length, 33);
  assert.equal(PROFILES["entry-metadata"].length, 67);
  for (const [profile, paths] of Object.entries(PROFILES)) {
    assert.deepEqual(paths, byteSort(paths), `${profile} ordering`);
    assert.equal(new Set(paths).size, paths.length, `${profile} uniqueness`);
    for (const relative of paths) {
      assert.doesNotMatch(relative, /(?:^|[/_.-])(?:coordinate|coordinates|candidate|candidates|pose|poses|dockq|capri|label|labels|evaluation)(?:$|[/_.-])/iu);
      assert.doesNotMatch(relative, /^validation\/dockq-/u);
      const info = await lstat(path.join(ROOT, ...relative.split("/")), { bigint: true });
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${profile}: ${relative}`);
    }
  }
});

test("every relative module import is present in the same isolated profile", async () => {
  for (const [profile, paths] of Object.entries(PROFILES)) {
    const set = new Set(paths);
    for (const relative of paths.filter((item) => item.endsWith(".mjs"))) {
      const source = await readFile(path.join(ROOT, ...relative.split("/")), "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/gu)) {
        const specifier = match[1];
        if (specifier.startsWith("node:")) continue;
        assert.ok(specifier.startsWith("."), `${profile} has a non-Node bare import in ${relative}: ${specifier}`);
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
        assert.ok(set.has(resolved), `${profile} omits import ${resolved} required by ${relative}`);
      }
    }
  }
});

test("metadata workflows never checkout or mount broader project/evaluation closures", async () => {
  const stagerSha = sha256(await readFile(path.join(ROOT, "scripts/hard-decoy/stage-v3-metadata-inputs.mjs")));
  for (const relative of WORKFLOWS) {
    const workflow = await readFile(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(workflow, /actions\/checkout|git\s+(?:clone|fetch)|sparse-checkout|(?:tar|zip)\s|\bnpm\b|package(?:-lock)?\.json|node_modules/iu);
    assert.doesNotMatch(workflow, /verify-(?:integration-state|design-record)|hard-decoy-(?:oracle|v3-request|v3-design|v3-integration-state)\.test/iu);
    assert.doesNotMatch(workflow, /Independently replay/iu);
    assert.match(workflow, /runs-on: ubuntu-24\.04/u);
    assert.match(workflow, /node-version: 22\.18\.0/u);
    assert.match(workflow, new RegExp(`STAGER_SHA256: ${stagerSha}`, "u"));
    assert.match(workflow, /api\.github\.com\/repos\/\$\{process\.env\.GITHUB_REPOSITORY\}\/contents\/scripts\/hard-decoy\/stage-v3-metadata-inputs\.mjs\?ref=\$\{process\.env\.GITHUB_SHA\}/u);
    assert.match(workflow, /test -z .*GITHUB_WORKSPACE/u);
    assert.match(workflow, /test ! -e .*\.git/u);
    assert.match(workflow, /if-no-files-found: error/u);
    assert.match(workflow, /github\.run_id.*github\.run_attempt/u);
    const actions = [...workflow.matchAll(/uses:\s*([^\s#]+)/gu)].map((match) => match[1]);
    assert.deepEqual(actions.sort(), [
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    ].sort());
    const tokenLines = workflow.split("\n").filter((line) => line.includes("GITHUB_TOKEN"));
    assert.equal(tokenLines.length, 2);
    assert.ok(tokenLines.every((line) => !line.includes("Verify exact read-only staged inputs")));
    const tokenInterpolations = [...workflow.matchAll(/\$\{\{\s*github\.token\s*\}\}/gu)];
    assert.equal(tokenInterpolations.length, 1);
    const bootstrapOffset = workflow.indexOf("name: Bootstrap and materialize exact metadata inputs");
    const verificationOffset = workflow.indexOf("name: Verify exact read-only staged inputs");
    assert.ok(bootstrapOffset >= 0 && verificationOffset > bootstrapOffset);
    assert.ok(tokenInterpolations[0].index > bootstrapOffset && tokenInterpolations[0].index < verificationOffset);
    const uploadedPaths = [...workflow.matchAll(/^\s{12}(\$\{\{ runner\.temp \}\}\/[^\n]+)$/gmu)].map((match) => match[1]);
    assert.equal(uploadedPaths.length, 2);
    assert.ok(uploadedPaths.every((item) => item !== "." && !item.includes("github.workspace")));
  }
});

test("stager source is standalone and has no repository-shell or manifest-driven path mechanism", async () => {
  const source = await readFile(path.join(ROOT, "scripts/hard-decoy/stage-v3-metadata-inputs.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|execFile|spawn\s*\(|package(?:-lock)?\.json|node_modules/iu);
  assert.doesNotMatch(source, /readFile\([^\n]*(?:checksums|manifest)[^\n]*\).*PROFILES/iu);
  assert.match(source, /Object\.freeze\(\{[\s\S]*"entry-metadata"[\s\S]*"source-universe"/u);
});

test("the exact read-only staged tree and receipt verify", async () => {
  const fixture = await makeLocalStage();
  try {
    const result = await verifyStagedInputs({
      profile: fixture.profile,
      repository: REPOSITORY,
      commit: COMMIT,
      outputDirectory: fixture.outputDirectory,
      receiptPath: fixture.receiptPath,
    });
    assert.equal(result.fileCount, 33);
    assert.equal(result.orderedRootSha256, fixture.receipt.orderedRootSha256);
  } finally { await dispose(fixture); }
});

test("staged-input verification rejects extra, missing, mutated, symlinked, hardlinked, or writable files", async (t) => {
  const cases = [
    ["extra", async (fixture) => {
      await chmod(fixture.outputDirectory, 0o755);
      await writeFile(path.join(fixture.outputDirectory, "extra.txt"), "extra\n");
      await chmod(path.join(fixture.outputDirectory, "extra.txt"), 0o444);
      await chmod(fixture.outputDirectory, 0o555);
    }, /exact profile allowlist/],
    ["missing", async (fixture) => {
      const target = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][0].split("/"));
      await chmod(path.dirname(target), 0o755);
      await unlink(target);
      await chmod(path.dirname(target), 0o555);
    }, /exact profile allowlist/],
    ["mutated", async (fixture) => {
      const target = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][0].split("/"));
      await chmod(target, 0o644);
      await writeFile(target, "mutated\n");
      await chmod(target, 0o444);
    }, /differs from its receipt/],
    ["symlinked", async (fixture) => {
      const target = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][0].split("/"));
      const source = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][1].split("/"));
      await chmod(path.dirname(target), 0o755);
      await unlink(target);
      await symlink(source, target);
      await chmod(path.dirname(target), 0o555);
    }, /symlink/],
    ["hardlinked", async (fixture) => {
      const target = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][0].split("/"));
      const source = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][1].split("/"));
      await chmod(path.dirname(target), 0o755);
      await unlink(target);
      await link(source, target);
      await chmod(path.dirname(target), 0o555);
    }, /unalias|direct/],
    ["writable", async (fixture) => {
      const target = path.join(fixture.outputDirectory, ...PROFILES[fixture.profile][0].split("/"));
      await chmod(target, 0o644);
    }, /writable/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, async () => {
      const fixture = await makeLocalStage();
      try {
        await mutate(fixture);
        await assert.rejects(() => verifyStagedInputs({
          profile: fixture.profile,
          repository: REPOSITORY,
          commit: COMMIT,
          outputDirectory: fixture.outputDirectory,
          receiptPath: fixture.receiptPath,
        }), pattern);
      } finally { await dispose(fixture); }
    });
  }
});

test("staged-input verification rejects receipt identity and aggregate-root drift", async () => {
  const fixture = await makeLocalStage();
  try {
    await assert.rejects(() => verifyStagedInputs({ profile: fixture.profile, repository: REPOSITORY, commit: "b".repeat(40), outputDirectory: fixture.outputDirectory, receiptPath: fixture.receiptPath }), /identity drifted/);
    await assert.rejects(() => verifyStagedInputs({ profile: fixture.profile, repository: "other/repository", commit: COMMIT, outputDirectory: fixture.outputDirectory, receiptPath: fixture.receiptPath }), /identity drifted/);
    await rewriteReceipt(fixture, (receipt) => { receipt.orderedRootSha256 = "0".repeat(64); });
    await assert.rejects(() => verifyStagedInputs({ profile: fixture.profile, repository: REPOSITORY, commit: COMMIT, outputDirectory: fixture.outputDirectory, receiptPath: fixture.receiptPath }), /aggregate binding drifted/);
  } finally { await dispose(fixture); }
});

test("staged-input verification rejects hostile receipt and root filesystem states", async () => {
  const cases = [
    ["escaped-equivalent duplicate receipt key", async (fixture) => {
      await chmod(fixture.receiptPath, 0o644);
      const text = await readFile(fixture.receiptPath, "utf8");
      await writeFile(fixture.receiptPath, `${text.slice(0, -2)},"\\u0070rofile":"${fixture.profile}"}\n`);
      await chmod(fixture.receiptPath, 0o444);
    }, /duplicate object key/],
    ["writable receipt", async (fixture) => {
      await chmod(fixture.receiptPath, 0o644);
    }, /read-only unaliased regular file/],
    ["symlinked receipt", async (fixture) => {
      const target = path.join(fixture.temporary, "receipt-target.json");
      await copyFile(fixture.receiptPath, target);
      await chmod(target, 0o444);
      await unlink(fixture.receiptPath);
      await symlink(target, fixture.receiptPath);
    }, /symlinked ancestor/],
    ["hardlinked receipt", async (fixture) => {
      const alias = path.join(fixture.temporary, "receipt-alias.json");
      await link(fixture.receiptPath, alias);
    }, /read-only unaliased regular file/],
    ["writable staged root", async (fixture) => {
      await chmod(fixture.outputDirectory, 0o755);
    }, /read-only direct directory/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const fixture = await makeLocalStage();
    try {
      await mutate(fixture);
      await assert.rejects(() => verifyStagedInputs({
        profile: fixture.profile,
        repository: REPOSITORY,
        commit: COMMIT,
        outputDirectory: fixture.outputDirectory,
        receiptPath: fixture.receiptPath,
      }), pattern, name);
    } finally { await dispose(fixture); }
  }
});
