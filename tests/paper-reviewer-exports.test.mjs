import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runReviewerDemo } from "../scripts/paper/reviewer-demo.mjs";
import { verifyReviewerExports } from "../scripts/paper/verify-reviewer-exports.mjs";
import { validateImportedSingleAuditReport } from "../lib/research-workspace.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/paper/verify-reviewer-exports.mjs");
const demo = runReviewerDemo();
const receiptBytes = execFileSync(process.execPath, ["scripts/paper/reviewer-demo.mjs"], { cwd: ROOT });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function inputs() {
  const generatedReportBytes = Object.fromEntries(["near", "separated"].map(name => [name, demo.artifacts[`synthetic-${name}.audit.json`]]));
  const browserReportBytes = Object.fromEntries(Object.entries(generatedReportBytes).map(([name, bytes]) => {
    const value = JSON.parse(bytes);
    value.generatedAt = "2026-09-08T12:34:56.789Z";
    return [name, JSON.stringify(Object.fromEntries(Object.entries(value).reverse()))];
  }));
  return { receiptBytes, generatedReportBytes, browserReportBytes };
}

function mutateReport(input, name, mutate) {
  const value = JSON.parse(input.browserReportBytes[name]);
  mutate(value);
  input.browserReportBytes[name] = JSON.stringify(value);
  return value;
}

test("reviewer exports match all semantics despite timestamp, JSON order and whitespace differences", async () => {
  const input = inputs();
  const original = JSON.stringify(input);
  const result = await verifyReviewerExports(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(result.sourceIdentitiesMatchCurrentCheckout, true);
  assert.deepEqual(result.cases.map(row => [row.residuePairs, row.atomContacts]), [[10, 90], [0, 0]]);
  assert.equal(result.cases[0].browserReportSha256, sha(input.browserReportBytes.near));
  assert.notEqual(result.cases[0].generatedReportSha256, result.cases[0].browserReportSha256);
  assert.equal(result.boundaries.biologicalValidation, false);
  assert.equal(result.boundaries.independentCompletionEstablished, false);
  assert.equal(result.boundaries.participantIdentityVerified, false);
  assert.equal(result.boundaries.browserRoleGateObserved, false);
  assert.equal(result.boundaries.independentEligibleGroupsAdded, 0);
});

test("valid reports for swapped or duplicated cases are rejected", async () => {
  for (const duplicated of [false, true]) {
    const input = inputs();
    const originalNear = input.browserReportBytes.near;
    input.browserReportBytes.near = input.browserReportBytes.separated;
    if (!duplicated) input.browserReportBytes.separated = originalNear;
    await assert.rejects(verifyReviewerExports(input), /near browser report/);
  }
});

test("production import rejects modified counts, invented PAE, policy drift and unconfirmed roles", async () => {
  for (const mutate of [
    report => { report.audit.contactPairCount += 1; },
    report => { report.audit.atomContactCount += 1; },
    report => { report.audit.interfacePaeMedianAngstrom = 0; },
    report => { report.pae = {}; },
    report => { report.auditPolicy.pae = "attached-with-user-confirmed-direction-and-residue-order"; },
    report => { report.auditPolicy.residueContactCutoffAngstrom = 5; },
    report => { report.structure.chainIdentityConfirmed = false; },
    report => { report.structure.selectedChains[0].role = "VHH"; report.structure.selectedChains[1].role = "receptor"; },
    report => { report.generatedAt = "not a timestamp"; },
  ]) {
    const input = inputs();
    mutateReport(input, "near", mutate);
    await assert.rejects(verifyReviewerExports(input));
  }
});

test("semantically valid but mismatched source identity and provenance fail comparison", async () => {
  for (const mutate of [
    report => { report.structure.sourceFileSha256 = "a".repeat(64); },
    report => { report.structure.sourceFileBytes += 1; },
    report => { report.structure.selectedCoordinateFingerprint = "fnv1a64-3dp:0000000000000000"; },
    report => { report.structure.parserDiagnostics.ignoredHydrogens += 1; },
    report => { report.file = "renamed-input.pdb"; },
  ]) {
    const input = inputs();
    const changed = mutateReport(input, "near", mutate);
    assert.doesNotThrow(() => validateImportedSingleAuditReport(changed));
    await assert.rejects(verifyReviewerExports(input), /near browser report/);
  }
});

test("reference tampering cannot be legitimized by editing generated reports or their receipt", async () => {
  for (const mutate of [
    receipt => { receipt.cases[0].residuePairs = 11; },
    receipt => { receipt.boundaries.biologicalValidation = true; },
    receipt => { receipt.sourceSha256["lib/confovhh.ts"] = "b".repeat(64); },
    receipt => { delete receipt.sourceSha256["lib/confovhh.ts"]; },
    receipt => { receipt.sourceSha256["../../outside"] = "b".repeat(64); },
    receipt => { receipt.artifactSha256["synthetic-near.audit.json"] = "c".repeat(64); },
  ]) {
    const input = inputs();
    const receipt = JSON.parse(input.receiptBytes);
    mutate(receipt);
    input.receiptBytes = JSON.stringify(receipt);
    await assert.rejects(verifyReviewerExports(input), /Generator receipt/);
  }
  const input = inputs();
  input.generatedReportBytes.near += "\n";
  await assert.rejects(verifyReviewerExports(input), /generated report SHA-256/);
});

test("missing cases, oversized JSON and invalid UTF-8 fail closed", async () => {
  const incomplete = inputs();
  delete incomplete.browserReportBytes.separated;
  await assert.rejects(verifyReviewerExports(incomplete), /Browser report inventory/);
  for (const badBytes of [Buffer.from([0xff]), " ".repeat(1_000_001), "{", "null"]) {
    const input = inputs();
    input.receiptBytes = badBytes;
    await assert.rejects(verifyReviewerExports(input));
  }
});

test("offline CLI preserves exports, writes a new verification receipt and refuses overwrite or ambiguous options", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "confovhh-reviewer-exports-"));
  try {
    const input = inputs();
    await writeFile(path.join(directory, "receipt.json"), input.receiptBytes);
    const args = [SCRIPT, `--example=${directory}`];
    for (const name of ["near", "separated"]) {
      await writeFile(path.join(directory, `synthetic-${name}.audit.json`), input.generatedReportBytes[name]);
      const filename = path.join(directory, `${name}-browser.json`);
      await writeFile(filename, input.browserReportBytes[name]);
      args.push(`--${name}=${filename}`);
    }
    const output = path.join(directory, "comparison.json");
    args.push(`--output=${output}`);
    const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const saved = await readFile(output, "utf8");
    assert.equal(saved, run.stdout);
    assert.equal(JSON.parse(saved).boundaries.independentCompletionEstablished, false);
    const overwrite = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
    assert.equal(overwrite.status, 1);
    assert.match(overwrite.stderr, /EEXIST/);
    assert.equal(await readFile(output, "utf8"), saved);
    assert.equal(await readFile(path.join(directory, "near-browser.json"), "utf8"), input.browserReportBytes.near);
    const duplicate = spawnSync(process.execPath, [...args, `--near=${directory}`], { cwd: ROOT, encoding: "utf8" });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /Usage:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
