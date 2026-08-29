import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyDispositionSeed, writeDispositionSeed } from "../scripts/hard-decoy/v3-disposition-seed.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TRIAGE = path.join(ROOT, "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/triage-signals.jsonl");
const DEVELOPMENT = path.join(ROOT, "validation/hard-decoy-holdout-v2/prelabel-census/development-registry.json");

function parseJsonl(text) {
  return text.trimEnd().split("\n").map(JSON.parse);
}

async function generateTemporarySeed() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-disposition-seed-"));
  const output = path.join(temporary, "snapshot");
  const result = await writeDispositionSeed({ repositoryRoot: ROOT, outputDirectory: output });
  return { temporary, output, result };
}

async function refreshChecksum(snapshot, relative) {
  const filename = path.join(snapshot, relative);
  const digest = createHash("sha256").update(await readFile(filename)).digest("hex");
  const manifest = await readFile(path.join(snapshot, "checksums.sha256"), "utf8");
  const rows = manifest.trimEnd().split("\n").map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row);
  assert.equal(rows.filter((row) => row.endsWith(`  ${relative}`)).length, 1);
  await writeFile(path.join(snapshot, "checksums.sha256"), `${rows.join("\n")}\n`);
}

test("metadata-only disposition seed covers all 287 source entries without promoting targets", async () => {
  const { temporary, output, result } = await generateTemporarySeed();
  try {
    assert.equal(result.sourceEntryCount, 287);
    assert.equal(result.dispositionRowCount, 287);
    assert.equal(result.resolvedDispositionRowCount, result.exactDevelopmentExclusionCount);
    assert.equal(result.pendingDispositionRowCount + result.resolvedDispositionRowCount, 287);
    assert.ok(result.exactDevelopmentExclusionCount > 0);
    assert.equal(result.provisionalDirectTargetCount, 0);
    assert.equal(result.formallyClearedGroupCount, 0);
    assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(result.dockqLabelsAccessed, false);
    assert.equal(result.executionAuthorized, false);

    const rows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    assert.equal(rows.length, 287);
    assert.equal(new Set(rows.map((row) => row.pdbId)).size, 287);
    assert.deepEqual(rows.map((row) => row.pdbId), [...rows.map((row) => row.pdbId)].sort());
    assert.ok(rows.every((row) => row.nativeCoordinatesInspected === false));
    assert.ok(rows.every((row) => ["EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE", "PENDING_REQUIRED_METADATA"].includes(row.dispositionCode)));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("only exact development-PDB reuse is automatically resolved", async () => {
  const { temporary, output } = await generateTemporarySeed();
  try {
    const rows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    const byId = new Map(rows.map((row) => [row.pdbId, row]));
    const development = JSON.parse(await readFile(DEVELOPMENT, "utf8"));
    const developmentIds = new Set(development.developmentGpcrVhhStructures.map((row) => row.pdbId));
    const present = [...developmentIds].filter((id) => byId.has(id));
    assert.ok(present.length > 0);
    for (const id of present) {
      const row = byId.get(id);
      assert.equal(row.dispositionCode, "EXCLUDE_RECEPTOR_CLUSTER_LEAKAGE");
      assert.equal(row.receptorClusterStatus, "FAIL");
      assert.equal(row.directReceptorVhhEvidence, "UNRESOLVED");
      assert.equal(row.constructEvidence, "UNRESOLVED");
    }
    for (const row of rows) {
      if (developmentIds.has(row.pdbId)) continue;
      assert.equal(row.dispositionCode, "PENDING_REQUIRED_METADATA");
      assert.equal(row.receptorClusterStatus, "UNRESOLVED");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("direct-target metadata review strata do not become scientific dispositions", async () => {
  const { temporary, output } = await generateTemporarySeed();
  try {
    const rows = parseJsonl(await readFile(path.join(output, "entry-dispositions.jsonl"), "utf8"));
    const byId = new Map(rows.map((row) => [row.pdbId, row]));
    const development = JSON.parse(await readFile(DEVELOPMENT, "utf8"));
    const developmentIds = new Set(development.developmentGpcrVhhStructures.map((row) => row.pdbId));
    const triage = parseJsonl(await readFile(TRIAGE, "utf8"));
    const directNonDevelopment = triage.filter((row) => row.reviewStratum === "DIRECT_TARGET_CANDIDATE_REVIEW" && !developmentIds.has(row.pdbId));
    assert.ok(directNonDevelopment.length > 0);
    for (const signal of directNonDevelopment) {
      assert.equal(byId.get(signal.pdbId).dispositionCode, "PENDING_REQUIRED_METADATA");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("disposition seed generation is byte-for-byte deterministic", async () => {
  const first = await generateTemporarySeed();
  const second = await generateTemporarySeed();
  try {
    for (const name of ["README.md", "checksums.sha256", "entry-dispositions.jsonl", "manifest.json", "summary.json"]) {
      assert.deepEqual(await readFile(path.join(first.output, name)), await readFile(path.join(second.output, name)));
    }
  } finally {
    await rm(first.temporary, { recursive: true, force: true });
    await rm(second.temporary, { recursive: true, force: true });
  }
});

test("a rechecksummed label injection still fails closed", async () => {
  const { temporary, output } = await generateTemporarySeed();
  try {
    const filename = path.join(output, "entry-dispositions.jsonl");
    const rows = parseJsonl(await readFile(filename, "utf8"));
    rows[0].dispositionReason = "DockQ=0.42 must never appear in a pre-label disposition ledger.";
    await writeFile(filename, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await refreshChecksum(output, "entry-dispositions.jsonl");
    await assert.rejects(
      () => verifyDispositionSeed({ repositoryRoot: ROOT, snapshotDirectory: output }),
      /Observed holdout-label assignment|snapshot drifted/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
