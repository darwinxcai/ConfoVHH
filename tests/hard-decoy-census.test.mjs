import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cp, link, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyCensus } from "../scripts/hard-decoy/verify-census.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CENSUS = path.join(REPOSITORY_ROOT, "validation/hard-decoy-holdout-v2/prelabel-census");

async function copyVerifierFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-census-"));
  const root = path.join(temporary, "repo");
  await mkdir(root, { recursive: true });
  await cp(path.join(REPOSITORY_ROOT, "validation"), path.join(root, "validation"), { recursive: true });
  await cp(path.join(REPOSITORY_ROOT, "scripts"), path.join(root, "scripts"), { recursive: true });
  await cp(path.join(REPOSITORY_ROOT, "HARD_DECOY_PROTOCOL.md"), path.join(root, "HARD_DECOY_PROTOCOL.md"));
  await cp(path.join(REPOSITORY_ROOT, "HARD_DECOY_PROTOCOL_V2.md"), path.join(root, "HARD_DECOY_PROTOCOL_V2.md"));
  return { temporary, root, census: path.join(root, "validation/hard-decoy-holdout-v2/prelabel-census") };
}

async function refreshFixtureChecksum(census, relative) {
  const manifestPath = path.join(census, "checksums.sha256");
  const digest = createHash("sha256").update(await readFile(path.join(census, relative))).digest("hex");
  const manifest = await readFile(manifestPath, "utf8");
  const rows = manifest.trimEnd().split("\n").map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row);
  assert.equal(rows.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(manifestPath, `${rows.join("\n")}\n`);
}

test("the hard-decoy v2 census fails closed before target freeze", async () => {
  const result = await verifyCensus(REPOSITORY_ROOT);
  assert.equal(result.status, "TARGET_CENSUS_BLOCKED");
  assert.equal(result.requiredIndependentGroups, 10);
  assert.equal(result.screenedProvisionalGroups, 7);
  assert.equal(result.frozenEligibleGroups, 0);
  assert.equal(result.holdoutReadyForApproval, false);
  assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(result.dockqLabelsAccessed, false);
  assert.equal(result.executionPermitted, false);
});

test("candidate sequence records are internally hash-consistent and partial source provenance is explicit", async () => {
  const rows = (await readFile(path.join(CENSUS, "target-census.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map((row) => row.provisionalGroupId)).size, 7);
  assert.ok(rows.every((row) => row.receptor.constructSequence.length === row.receptor.constructSequenceLength));
  assert.ok(rows.every((row) => row.vhh.constructSequence.length === row.vhh.constructSequenceLength));
  assert.ok(rows.every((row) => row.sourceArtifacts.length === 3));
  assert.ok(rows.every((row) => row.sourceArtifacts.every((source) => source.license === "CC0-1.0")));
});

test("the scientific preorder preserves ties and excludes display hashes", async () => {
  const scoring = JSON.parse(await readFile(path.join(CENSUS, "scoring-contract.json"), "utf8"));
  assert.equal(scoring.displayFieldsMayBreakScientificTies, false);
  assert.equal(scoring.scientificTiePolicy, "identical-complete-quantized-tuples-remain-tied");
  assert.ok(scoring.scientificPreorder.every((field) => !/sha256|hash|poseId|attemptId/iu.test(field.field)));
  assert.deepEqual(
    scoring.scientificPreorder.filter((field) => field.quantization != null).map((field) => [field.field, field.quantization]),
    [["maximumVdwOverlapAngstrom", 0.01], ["deltaSasaAngstromSquared", 1]],
  );
});

test("public census ledgers contain no holdout label fields", async () => {
  for (const filename of ["target-census.jsonl", "exclusion-ledger.jsonl", "vhh-lineage-census.jsonl"]) {
    const rows = (await readFile(path.join(CENSUS, filename), "utf8")).trim().split("\n").map(JSON.parse);
    for (const row of rows) {
      const serialized = JSON.stringify(row);
      assert.doesNotMatch(serialized, /"(?:dockq|capri|fnat|irmsd|lrmsd)"\s*:/iu);
      assert.doesNotMatch(serialized, /(?:native-vault|label-vault|candidate-vault)/iu);
    }
  }
});

test("a changed historical artifact invalidates the census lock", async () => {
  const { temporary, root } = await copyVerifierFixture();
  try {
    const fixture = path.join(root, "HARD_DECOY_PROTOCOL.md");
    await writeFile(fixture, "tampered\n");
    await assert.rejects(() => verifyCensus(root), /Historical artifact changed/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an unlisted package file invalidates exact checksum coverage", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    await writeFile(path.join(census, "unlisted-result.json"), "{}\n");
    await assert.rejects(() => verifyCensus(root), /exact public-file allowlist/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a symlinked package entry fails before content verification", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const readme = path.join(census, "README.md");
    await unlink(readme);
    await symlink("census-summary.json", readme);
    await assert.rejects(() => verifyCensus(root), /direct regular file/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("coordinate text in an allowlisted public artifact fails closed", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    await writeFile(path.join(census, "README.md"), "ATOM      1  CA  GLY A   1       0.000   0.000   0.000\n");
    await refreshFixtureChecksum(census, "README.md");
    await assert.rejects(() => verifyCensus(root), /Coordinate text/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("summary and attestation access states cannot diverge", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const summaryPath = path.join(census, "census-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.dockqLabelsAccessed = true;
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await refreshFixtureChecksum(census, "census-summary.json");
    await assert.rejects(() => verifyCensus(root), /blocked-state field drifted: dockqLabelsAccessed/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a hardlinked package entry fails before digest verification", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const readme = path.join(census, "README.md");
    await unlink(readme);
    await link(path.join(census, "census-summary.json"), readme);
    await assert.rejects(() => verifyCensus(root), /direct regular file|alias the same inode/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a symlinked census directory is rejected", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const moved = `${census}-real`;
    await rename(census, moved);
    await symlink(path.basename(moved), census);
    await assert.rejects(() => verifyCensus(root), /direct directory/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a content mutation cannot bypass mandatory checksum verification", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    await writeFile(path.join(census, "README.md"), "benign but unattested mutation\n");
    await assert.rejects(() => verifyCensus(root), /Checksum mismatch: README.md/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("same-size in-place mutation during verification cannot produce a pass", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  let child;
  try {
    const readmePath = path.join(census, "README.md");
    const padded = `${await readFile(readmePath, "utf8")}${" ".repeat(3 * 1024 * 1024)}`;
    await writeFile(readmePath, padded);
    await refreshFixtureChecksum(census, "README.md");
    child = spawn(process.execPath, [
      "-e",
      "const fs=require('node:fs');const p=process.argv[1];const f=fs.openSync(p,'r+');process.send('ready');const b=Buffer.alloc(1);const end=Date.now()+1000;let i=0;while(Date.now()<end){b[0]=i++%2?65:66;fs.writeSync(f,b,0,1,2048);}fs.closeSync(f);",
      readmePath,
    ], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const exitPromise = once(child, "exit");
    await once(child, "message");
    await assert.rejects(() => verifyCensus(root), /Checksum mismatch|metadata changed|bytes changed/);
    await exitPromise;
    child = undefined;
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a missing allowlisted file invalidates the package inventory", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    await unlink(path.join(census, "README.md"));
    await assert.rejects(() => verifyCensus(root), /exact public-file allowlist/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a missing checksum row invalidates complete package coverage", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const manifestPath = path.join(census, "checksums.sha256");
    const rows = (await readFile(manifestPath, "utf8")).trimEnd().split("\n");
    await writeFile(manifestPath, `${rows.slice(1).join("\n")}\n`);
    await assert.rejects(() => verifyCensus(root), /cover every package file/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("embedded PDB and mmCIF coordinate strings are rejected after valid rechecksumming", async () => {
  for (const payload of [
    "ATOM      1  CA  GLY A   1       0.000   0.000   0.000",
    "data_hidden\nloop_\n_atom_site.Cartn_x\n0.0",
  ]) {
    const { temporary, root, census } = await copyVerifierFixture();
    try {
      const specPath = path.join(census, "benchmark-spec.json");
      const spec = JSON.parse(await readFile(specPath, "utf8"));
      spec.embeddedPayload = payload;
      await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
      await refreshFixtureChecksum(census, "benchmark-spec.json");
      await assert.rejects(() => verifyCensus(root), /coordinate text/i);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

test("observed label fields cannot hide in general or endpoint contracts", async () => {
  for (const [relative, mutate] of [
    ["benchmark-spec.json", (record) => { record.observedHoldout = { dockqScore: 0.42 }; }],
    ["endpoint-contract.json", (record) => { record.results = [{ dockq: 0.42 }]; }],
  ]) {
    const { temporary, root, census } = await copyVerifierFixture();
    try {
      const filename = path.join(census, relative);
      const record = JSON.parse(await readFile(filename, "utf8"));
      mutate(record);
      await writeFile(filename, `${JSON.stringify(record, null, 2)}\n`);
      await refreshFixtureChecksum(census, relative);
      await assert.rejects(() => verifyCensus(root), /Forbidden result field|Forbidden payload container/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

test("an escaping protocol path fails before repository evidence access", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const specPath = path.join(census, "benchmark-spec.json");
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    spec.protocol = "../HARD_DECOY_PROTOCOL_V2.md";
    await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    await refreshFixtureChecksum(census, "benchmark-spec.json");
    await assert.rejects(() => verifyCensus(root), /Unexpected version 2 protocol path/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a frozen-eligible target is incompatible with the blocked state", async () => {
  const { temporary, root, census } = await copyVerifierFixture();
  try {
    const targetPath = path.join(census, "target-census.jsonl");
    const targets = (await readFile(targetPath, "utf8")).trimEnd().split("\n").map(JSON.parse);
    targets[0].frozenEligible = true;
    await writeFile(targetPath, `${targets.map((target) => JSON.stringify(target)).join("\n")}\n`);
    await refreshFixtureChecksum(census, "target-census.jsonl");
    await assert.rejects(() => verifyCensus(root), /cannot claim cleared or final groups/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
