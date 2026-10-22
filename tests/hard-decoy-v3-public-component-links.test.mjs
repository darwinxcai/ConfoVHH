import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build, writeOutputs } from "../scripts/hard-decoy-v3/build-public-component-links.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/public-component-links-2026-09-04");

test("six priority entries cannot add an independent component", async () => {
  const { links, summary } = await build(ROOT);
  assert.deepEqual(links.map((row) => row.pdbId), ["6N51", "7DGE", "7EPB", "8T7H", "8XFP", "8XFS"]);
  assert.equal(links.every((row) => row.conditionalComponentEdgeEstablished), true);
  assert.equal(links.every((row) => row.independentComponentCountIncrementUpperBound === 0), true);
  assert.equal(links.every((row) => row.formalDisposition === "PENDING_REQUIRED_METADATA"), true);
  assert.equal(summary.provisionalComponentCountAfterReview, 7);
  assert.equal(summary.newIndependentComponentUpperBoundFromReviewedEntries, 0);
  assert.equal(summary.formalClearedComponentCount, 0);
});

test("7EPB uses exact numbered framework and CDR3 evidence", async () => {
  const { links } = await build(ROOT);
  const row = links.find((item) => item.pdbId === "7EPB");
  const evidence = row.publicComponentRulesSatisfied.find((item) => item.rule === "VHH_IMGT_FRAMEWORK_CDR3_THRESHOLD");
  assert.equal(evidence.frameworkIdentity, 1);
  assert.equal(evidence.cdr3Identity, 1);
  assert.equal(evidence.cdr3LengthDifference, 0);
});

test("record remains pre-label and non-executable", async () => {
  const { links, summary, manifest } = await build(ROOT);
  assert.equal(links.every((row) => !row.nativeCoordinatesInspected && !row.targetFreezePermitted && !row.executionAuthorized), true);
  assert.equal(summary.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(summary.dockqLabelsAccessed, false);
  assert.equal(summary.performanceResultsAccessed, false);
  assert.equal(manifest.formalTargetDispositionsAssigned, false);
  assert.equal(manifest.executionAuthorized, false);
});

test("checked-in output is deterministic and checksummed", async () => {
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
