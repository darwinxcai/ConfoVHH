import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildNoDirectSignalRoleAudit, writeNoDirectSignalRoleAudit } from "../scripts/hard-decoy-v3/build-no-direct-signal-role-audit.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/no-direct-signal-role-audit-2026-09-04");

test("five new-looking priority rows receive source-backed exclusion dispositions", async () => {
  const { exclusions, summary } = await buildNoDirectSignalRoleAudit(ROOT);
  assert.deepEqual(exclusions.map((row) => row.pdbId), ["7E6T", "8JRU", "8JRV", "8XGR", "9AXF"]);
  assert.equal(summary.sourceBackedExcludedEntryCount, 5);
  assert.equal(summary.sourceBackedAuxiliaryBinderExclusionCount, 4);
  assert.equal(summary.sourceBackedNoDirectInterfaceExclusionCount, 1);
  assert.ok(exclusions.every((row) => row.publicSourcesReviewed && row.evidenceUrls.length >= 2));
});

test("two remaining rows are already counted provisional representatives", async () => {
  const { existingRepresentatives, summary } = await buildNoDirectSignalRoleAudit(ROOT);
  assert.deepEqual(existingRepresentatives.map((row) => row.pdbId), ["7E6U", "8QJ2"]);
  assert.ok(existingRepresentatives.every((row) => row.independentComponentCountIncrementUpperBound === 0));
  assert.equal(summary.independentComponentCountIncrementUpperBoundFromReviewedSet, 0);
});

test("the bounded audit preserves whole-census and pre-oracle guardrails", async () => {
  const { exclusions, summary, manifest } = await buildNoDirectSignalRoleAudit(ROOT);
  assert.equal(summary.otherStrataRowsStillPendingAfterBoundedAudit, 238);
  assert.deepEqual(summary.stillPendingRowsAlreadyNamedInExistingCensus, ["7E6U", "8JXS", "8QJ2"]);
  assert.equal(summary.stillPendingRowsNotNamedInExistingCensusCount, 235);
  assert.equal(summary.wholeCensusTerminalDecisionReached, false);
  assert.equal(summary.targetFreezePermitted, false);
  assert.equal(summary.executionAuthorized, false);
  assert.equal(summary.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(manifest.partialAuditOnly, true);
  assert.equal(manifest.masterDispositionLedgerRewritten, false);
  assert.ok(exclusions.every((row) => row.directInterfaceEvidence.nativeCoordinatesInspected === false));
});

test("checked-in role-audit artifacts are deterministic and checksummed", async () => {
  const generated = await writeNoDirectSignalRoleAudit(ROOT, OUTPUT);
  assert.equal(generated.output, OUTPUT);
  const checksums = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
});
