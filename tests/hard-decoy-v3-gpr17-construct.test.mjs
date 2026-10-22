import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKET = path.join(ROOT, "validation/hard-decoy-holdout-v3/gpr17-construct-followup-2026-09-04");
const run = (packet) => execFileSync("python3", ["-B", path.join(packet, "build.py"), "verify", "--repository-root", ROOT, "--output-directory", packet], { encoding: "utf8", stdio: "pipe" });

test("GPR17 human exact matches and mouse disagreement replay without changing scientific gates", async () => {
  assert.equal(JSON.parse(run(PACKET)).verified, true);
  const report = JSON.parse(await readFile(path.join(PACKET, "sequence-audit.json"), "utf8"));
  assert.deepEqual(report.references.map((row) => row.comparison.minimumMismatchCount), [0, 23, 0]);
  assert.equal(report.allDepositedPolymerEntities.length, 5);
  assert.equal(report.entryDisposition, "PENDING_REQUIRED_METADATA");
  assert.equal(report.targetFreezeGate, "BLOCKED");
  assert.equal(report.independentComponentsAdded, 0);
  assert.equal(report.wholeCensusComponentUpperBound, null);
});

test("GPR17 relocated replay rejects an invented species match and additional unbound evidence", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-gpr17-"));
  try {
    await cp(PACKET, temporary, { recursive: true });
    assert.equal(JSON.parse(run(temporary)).verified, true);
    const file = path.join(temporary, "sequence-audit.json");
    const bytes = await readFile(file);
    const report = JSON.parse(bytes);
    report.references[1].comparison.minimumMismatchCount = 0;
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    assert.throws(() => run(temporary), /Replay mismatch/);
    await writeFile(file, bytes);
    await writeFile(path.join(temporary, "unbound-evidence.txt"), "unreviewed\n");
    assert.throws(() => run(temporary), /Exact file inventory mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
