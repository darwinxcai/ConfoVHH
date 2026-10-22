import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildOtherStrataSalvageReview, writeOtherStrataSalvageReview } from "../scripts/hard-decoy-v3/build-other-strata-salvage-review.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/other-strata-salvage-review-2026-09-04");

test("the conservative other-strata rule creates a 31-entry first-pass queue", async () => {
  const { queue, summary } = await buildOtherStrataSalvageReview(ROOT);
  assert.equal(queue.length, 31);
  assert.equal(summary.sourceOtherPendingEntryCount, 243);
  assert.equal(summary.selectedForSalvageReviewCount, 31);
  assert.equal(summary.unselectedStillPendingCount, 212);
  assert.deepEqual(summary.selectionCounts, {
    NO_VHH_LIKE_POLYMER_ENTITY_SIGNAL: 5,
    EXTRA_UNFLAGGED_VHH_LIKE_ENTITY_BEYOND_AUXILIARY_SIGNAL: 4,
    NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_ABSENT: 7,
    NO_AUXILIARY_LEXICAL_ENTITY_VHH_PRESENT_CONSTRUCT_SIGNAL_PRESENT: 15,
  });
});

test("the queue prioritizes seven rows without a direct development-pregraph signal", async () => {
  const { queue, summary } = await buildOtherStrataSalvageReview(ROOT);
  assert.equal(summary.directDevelopmentPregraphSignalCount, 24);
  assert.equal(summary.noDirectDevelopmentPregraphSignalCount, 7);
  assert.deepEqual(summary.noDirectDevelopmentPregraphSignalIds, ["8JRU", "8JRV", "8XGR", "9AXF", "7E6T", "8QJ2", "7E6U"]);
  assert.deepEqual(queue.slice(0, 7).map((row) => row.pdbId), summary.noDirectDevelopmentPregraphSignalIds);
  assert.deepEqual(summary.selectedExistingProvisionalCensusRepresentatives, ["7E6U", "8JXS", "8QJ2"]);
});

test("metadata and pregraph signals remain review-only", async () => {
  const { queue, summary, manifest, files } = await buildOtherStrataSalvageReview(ROOT);
  assert.equal(summary.formalDispositionsAssigned, false);
  assert.equal(summary.lexicalSignalsAreFormalExclusionAuthority, false);
  assert.equal(summary.pregraphSignalsAreFormalLeakageAuthority, false);
  assert.equal(summary.wholeCensusTerminalDecisionReached, false);
  assert.equal(manifest.formalDispositionsAssigned, false);
  assert.ok(queue.every((row) => row.formalDisposition === "PENDING_REQUIRED_METADATA"));
  assert.ok(queue.every((row) => row.lexicalSignalMayAutoExclude === false && row.pregraphSignalMayAutoExclude === false));
  assert.match(files["unselected-still-pending.jsonl"], /"formalDisposition":"PENDING_REQUIRED_METADATA"/u);
});

test("checked-in salvage-review artifacts are deterministic and checksummed", async () => {
  const generated = await writeOtherStrataSalvageReview(ROOT, OUTPUT);
  assert.equal(generated.output, OUTPUT);
  const checksums = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
});
