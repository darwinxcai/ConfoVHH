import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { verifyDevelopmentMetadata } from "../scripts/hard-decoy/v3-development-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29");

test("the committed 17-structure development metadata archive independently replays and remains blocked", async () => {
  const result = await verifyDevelopmentMetadata({ repositoryRoot: ROOT, snapshotDirectory: SNAPSHOT });
  assert.equal(result.status, "DEVELOPMENT_METADATA_SNAPSHOT_VERIFIED_BLOCKED");
  assert.equal(result.registeredDevelopmentPdbCount, 17);
  assert.equal(result.allRegisteredPdbMetadataCaptured, true);
  assert.equal(result.formallyClearedGroupCount, 0);
  assert.equal(result.targetFreezePermitted, false);
  assert.equal(result.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(result.dockqLabelsAccessed, false);
  assert.equal(result.performanceResultsAccessed, false);
  assert.equal(result.executionAuthorized, false);
});
