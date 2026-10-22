import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { PACKET, buildDp1Review, extractVerifiedDp1, runDp1Review } from "../scripts/hard-decoy-v3/review-dp1-receptor.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, PACKET);
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const canonical = () => JSON.parse(fs.readFileSync(path.join(ROOT, "validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05/sources/uniprot-Q13258.body"), "utf8"));
const raw = () => read("sources/protein-1-attempt-1.body");
const residues = () => read("sources/residues-1-attempt-1.body");

test("DP1 packet replays all 136 entry comparisons including receptor-only 9UWD", () => {
  const summary = runDp1Review("verify");
  assert.equal(summary.tmLength, 237);
  assert.equal(summary.entryDevelopmentPairCount, 136);
  assert.equal(summary.receptorOnlyEntryIncluded, "9UWD");
  assert.equal(summary.newIndependentComponents, 0);
  const accounting = read("entry-accounting.json");
  const isolated = accounting.find((e) => e.pdbId === "9UWD");
  assert.equal(isolated.polymerCount, 1); assert.equal(isolated.heavyDomainCallCount, 0);
  assert.equal(accounting.reduce((n, e) => n + e.polymerCount, 0), 33);
});

test("all 28 same-DP1 pairs retain 15 cross-paper links without component claims", () => {
  const pairs = read("same-receptor-pairs.json");
  assert.equal(pairs.length, 28); assert.equal(new Set(pairs.map((p) => p.pairId)).size, 28);
  assert.equal(pairs.filter((p) => !p.sharedPrimaryPaper).length, 15);
  assert.ok(pairs.every((p) => !p.independentComponentClaim && !p.exactDepositedSequenceIdentityClaim));
});

test("DP1 to EP2 primary signal and EP4 sensitivity-only signal remain distinct", () => {
  const pairs = read("cross-receptor-pairs.json");
  const ep2 = pairs.find((p) => p.referenceAccession === "P43116");
  const ep4 = pairs.find((p) => p.referenceAccession === "P35408");
  assert.equal(ep2.criterion.primaryThresholdSatisfied, true);
  assert.equal(ep4.criterion.primaryThresholdSatisfied, false);
  assert.equal(ep4.criterion.sensitivityThresholdSatisfied, true);
  assert.ok(pairs.every((p) => !p.formalLeakageEdgeAuthority && !p.formalNoEdgeAuthority));
});

test("canonical extraction rejects incorrect accessions and independent sequence disagreement", () => {
  assert.throws(() => extractVerifiedDp1({ ...raw(), accession: "P43116" }, residues(), canonical()), /accession/);
  const altered = raw(); altered.sequence = "X" + altered.sequence.slice(1);
  assert.throws(() => extractVerifiedDp1(altered, residues(), canonical()));
  const independent = canonical(); independent.sequence.value = "A" + independent.sequence.value.slice(1);
  assert.throws(() => extractVerifiedDp1(raw(), residues(), independent), /disagree/);
});

test("named DP1 coverage follows its sequence after the frozen aligner canonicalizes pair order", () => {
  const pairs = read("cross-receptor-pairs.json");
  const ep4 = pairs.find((p) => p.referenceAccession === "P35408");
  assert.equal(ep4.alignment.sequenceLengthA, 227);
  assert.equal(ep4.namedCoverage.leftAlignmentSide, "B");
  assert.equal(ep4.namedCoverage.leftCoverage, Number((221 / 237).toFixed(12)));
  assert.equal(ep4.namedCoverage.rightCoverage, Number((221 / 227).toFixed(12)));
  assert.equal(ep4.namedCoverage.leftSequenceSha256, read("profile.json").concatenatedTmSequenceSha256);
});

test("complete residue inventory rejects missing, duplicate and mismatched residues", () => {
  const missing = residues().slice(1);
  assert.throws(() => extractVerifiedDp1(raw(), missing, canonical()), /Incomplete/);
  const duplicate = residues(); duplicate[1] = duplicate[0];
  assert.throws(() => extractVerifiedDp1(raw(), duplicate, canonical()), /Duplicate or missing/);
  const changed = residues(); changed[50].amino_acid = changed[50].amino_acid === "A" ? "C" : "A";
  assert.throws(() => extractVerifiedDp1(raw(), changed, canonical()), /MISMATCH/);
});

test("canonical extraction rejects absent TM7 even with a complete full-sequence inventory", () => {
  const changed = residues(); for (const r of changed) if (r.protein_segment === "TM7") r.protein_segment = "C-term";
  assert.throws(() => extractVerifiedDp1(raw(), changed, canonical()), /EMPTY_TM7/);
});

test("repeat disagreement fails even when modified source checksums are internally consistent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dp1-repeat-"));
  try {
    fs.cpSync(DIR, temp, { recursive: true });
    const bodyPath = path.join(temp, "sources/residues-2-attempt-1.body");
    const body = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
    const row = body.find((r) => r.protein_segment === "TM1");
    row.display_generic_number = "synthetic-repeat-disagreement";
    const data = JSON.stringify(body); fs.writeFileSync(bodyPath, data);
    const metaPath = path.join(temp, "sources/residues-2-attempt-1.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.sha256 = createHash("sha256").update(data).digest("hex"); meta.bytes = Buffer.byteLength(data);
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    assert.throws(() => buildDp1Review({ repositoryRoot: ROOT, directory: temp }), /Repeated canonical captures disagree/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("relocated packet verifies and rejects extra files and incomplete pair matrices", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dp1-relocated-"));
  try {
    fs.cpSync(DIR, temp, { recursive: true });
    assert.equal(runDp1Review("verify", { repositoryRoot: ROOT, directory: temp }).entryCount, 8);
    fs.writeFileSync(path.join(temp, "extra.txt"), "canary");
    assert.throws(() => runDp1Review("verify", { repositoryRoot: ROOT, directory: temp }), /inventory mismatch/);
    fs.rmSync(path.join(temp, "extra.txt"));
    fs.writeFileSync(path.join(temp, "sources/checksums.sha256"), "nested inventory canary");
    assert.throws(() => runDp1Review("verify", { repositoryRoot: ROOT, directory: temp }), /inventory mismatch/);
    fs.rmSync(path.join(temp, "sources/checksums.sha256"));
    fs.writeFileSync(path.join(temp, "entry-development-pairs.json"), "[]\n");
    assert.throws(() => runDp1Review("verify", { repositoryRoot: ROOT, directory: temp }), /inventory mismatch/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
