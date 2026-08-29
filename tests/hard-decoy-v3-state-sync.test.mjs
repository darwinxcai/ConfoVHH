import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyV3CensusContracts } from "../scripts/hard-decoy/verify-v3-census-contracts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/prelabel-census-draft";
const SOURCE_ATTESTATION_REL = "validation/hard-decoy-holdout-v3/SOURCE_SNAPSHOT_ATTESTATION_2026-08-29.json";
const ENTRY_ATTESTATION_REL = "validation/hard-decoy-holdout-v3/ENTRY_METADATA_SNAPSHOT_ATTESTATION_2026-08-29.json";

async function copyStateFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-v3-state-sync-"));
  const root = path.join(temporary, "repo");
  await mkdir(path.join(root, "validation/hard-decoy-holdout-v3"), { recursive: true });
  await cp(path.join(ROOT, CONTRACT_REL), path.join(root, CONTRACT_REL), { recursive: true });
  await cp(path.join(ROOT, SOURCE_ATTESTATION_REL), path.join(root, SOURCE_ATTESTATION_REL));
  await cp(path.join(ROOT, ENTRY_ATTESTATION_REL), path.join(root, ENTRY_ATTESTATION_REL));
  return { temporary, root };
}

test("v3 state acknowledges archived source and entry metadata without overstating scientific clearance", async () => {
  const result = await verifyV3CensusContracts(ROOT);
  assert.equal(result.sourceUniverseFrozen, true);
  assert.equal(result.sourceUniverseIntersectionCount, 287);
  assert.equal(result.entryMetadataArchived, true);
  assert.equal(result.entryMetadataEntryCount, 287);
  assert.equal(result.entryMetadataPolymerEntityCount, 1401);
  assert.deepEqual(result.entryMetadataReviewStrata, {
    DIRECT_TARGET_CANDIDATE_REVIEW: 39,
    AUXILIARY_OR_CONSTRUCT_REVIEW: 242,
    METADATA_RESOLUTION_REQUIRED: 6,
  });
  assert.equal(result.dispositionRowsRequired, 287);
  assert.equal(result.dispositionRowsCompleted, 0);
  assert.equal(result.formallyClearedGroups, 0);
  assert.ok(!result.openBlockers.includes("source-universe-reconstruction"));
  assert.ok(result.openBlockers.includes("exhaustive-entry-dispositions"));
  assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(result.dockqLabelsAccessed, false);
  assert.equal(result.executionAuthorized, false);
});

test("archived source and entry-metadata attestations are pinned by SHA-256", async () => {
  for (const [relative, marker] of [
    [SOURCE_ATTESTATION_REL, "Source snapshot attestation checksum mismatch"],
    [ENTRY_ATTESTATION_REL, "Entry-metadata snapshot attestation checksum mismatch"],
  ]) {
    const { temporary, root } = await copyStateFixture();
    try {
      const filename = path.join(root, relative);
      const record = JSON.parse(await readFile(filename, "utf8"));
      record.tampered = true;
      await writeFile(filename, `${JSON.stringify(record, null, 2)}\n`);
      await assert.rejects(() => verifyV3CensusContracts(root), new RegExp(marker));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});
