import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build, writeOutputs } from "../scripts/hard-decoy-v3/build-direct-stratum-bound.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/direct-stratum-bound-2026-09-04");

test("the 29-entry direct-looking stratum adds at most two components", async () => {
  const { assessments, directAssessments, transitiveAssessments, summary } = await build(ROOT);
  assert.equal(assessments.reduce((sum, row) => sum + row.entryCount, 0), 29);
  assert.equal(directAssessments.length, 19);
  assert.deepEqual(transitiveAssessments.map((row) => row.pdbIds), [["7UL3"], ["9B9Y", "9B9Z", "9BA0"]]);
  assert.equal(summary.directLookingEntryIncrementUpperBound, 2);
  assert.equal(summary.existingPlusDirectLookingUpperBound, 9);
  assert.equal(summary.directLookingStratumAloneCanMeetMinimum, false);
});

test("the bound does not overstate whole-census completion", async () => {
  const { summary, manifest } = await build(ROOT);
  assert.equal(summary.otherPendingNondevelopmentRowCount, 243);
  assert.deepEqual(summary.otherPendingRowsAlreadyNamedInExistingCensus, ["7E6U", "8JXS", "8QJ2"]);
  assert.equal(summary.otherPendingRowsNotNamedInExistingCensusCount, 240);
  assert.equal(summary.minimumAdditionalComponentsRequiredFromOtherPendingRows, 1);
  assert.equal(summary.wholeCensusTerminalDecisionReached, false);
  assert.equal(manifest.formalTargetDispositionsAssigned, false);
  assert.equal(summary.targetFreezePermitted, false);
  assert.equal(summary.executionAuthorized, false);
});

test("checked-in direct-stratum record is deterministic and checksummed", async () => {
  const generated = await writeOutputs(ROOT);
  assert.equal(generated.output, OUTPUT);
  const checksums = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
});
