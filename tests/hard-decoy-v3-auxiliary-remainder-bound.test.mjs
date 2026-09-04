import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAuxiliaryRemainderBound } from "../scripts/hard-decoy-v3/build-auxiliary-remainder-bound.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/auxiliary-remainder-bound-2026-09-04");
const built = await buildAuxiliaryRemainderBound(ROOT);

test("all 212 descriptor matches remain pending despite known reagent-role literature", () => {
  assert.deepEqual(built.summary.auxiliaryRoleCounts, {
    NB35_G_PROTEIN_STABILIZER: 196,
    SCFV16_G_PROTEIN_STABILIZER: 3,
    ANTI_FAB_FIDUCIAL_NANOBODY: 13,
  });
  assert.equal(built.mappings.length, 212);
  for (const row of built.mappings) {
    assert.equal(row.dispositionCode, "PENDING_REQUIRED_METADATA");
    assert.equal(row.independentComponentCountIncrementUpperBound, null);
    assert.equal(row.formalRoleAssignment, false);
    assert.equal(row.entrySpecificSourceReviewComplete, false);
    assert.equal(row.reagentSequenceIdentityVerified, false);
    assert.equal(Object.hasOwn(row, "publicSourcesReviewed"), false);
  }
});

test("29 exact-sequence groups partition the review queue without propagating exclusions", () => {
  const groups = built.sequenceReviewGroups;
  assert.equal(groups.length, 29);
  assert.deepEqual(groups.flatMap(g => g.entries.map(e => e.pdbId)).sort(), built.mappings.map(r => r.pdbId));
  assert.ok(groups.every(g => !g.identityToEstablishedReagentVerified && !g.formalExclusionAuthority));
});

test("historical sub-universe and descriptor scans cannot establish a terminal whole census", () => {
  const { summary, manifest } = built;
  assert.equal(summary.historicalSubUniverseEntryCount, 287);
  assert.equal(summary.broaderDiscoveryComplete, false);
  assert.equal(summary.sourceBackedAuxiliaryBinderExclusionCount, 0);
  assert.equal(summary.wholeCensusComponentUpperBound, null);
  assert.equal(summary.wholeCensusUpperBoundBelowRequiredMinimum, null);
  assert.equal(summary.wholeCensusTerminalDecisionReached, false);
  assert.equal(summary.formalProtocolStatus, "DRAFT");
  assert.equal(summary.targetFreezeGate, "BLOCKED");
  assert.equal(summary.absenceOfHiddenVhhEstablished, false);
  assert.equal(manifest.completedCensusCountBound, false);
  assert.equal(manifest.formalRoleAssignment, false);
  for (const field of ["oracleRequestFreezePermitted", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]) {
    assert.equal(summary[field], false);
  }
});

test("checked-in artifacts equal fresh reconstruction without rewriting expected files", async () => {
  for (const [name, content] of Object.entries(built.files)) {
    assert.equal(await readFile(path.join(OUTPUT, name), "utf8"), content, name);
  }
  const lines = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  const names = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/u.exec(line);
    assert.ok(match);
    names.push(match[2]);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
  assert.deepEqual(names.sort(), Object.keys(built.files).sort());
});

async function mutatedEntries(mutate, check) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "auxiliary-review-"));
  try {
    for (const relative of Object.keys(built.manifest.inputDigests)) {
      const destination = path.join(temp, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(ROOT, relative), destination);
    }
    const filename = path.join(temp, "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl");
    const rows = (await readFile(filename, "utf8")).trimEnd().split("\n").map(JSON.parse);
    mutate(rows.find(r => r.pdbId === "5UZ7"));
    await writeFile(filename, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    await check(temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("an unrecognized antibody descriptor fails instead of being auto-excluded", async () => {
  const entityId = built.mappings.find(r => r.pdbId === "5UZ7").frozenVhhLikeEntity.entityId;
  await mutatedEntries(entry => {
    entry.polymerEntities.find(e => e.entityId === entityId).description = "uncharacterized nanobody";
  }, async temp => {
    await assert.rejects(buildAuxiliaryRemainderBound(temp), /unrecognized auxiliary descriptor/u);
  });
});

test("an unflagged generic polymer never becomes proof of VHH absence", async () => {
  await mutatedEntries(entry => {
    entry.polymerEntities.push({ entityId: "999", description: "uncharacterized protein", sequenceLength: 125 });
  }, async temp => {
    const result = await buildAuxiliaryRemainderBound(temp);
    assert.equal(result.summary.absenceOfHiddenVhhEstablished, false);
    assert.equal(result.summary.wholeCensusComponentUpperBound, null);
    assert.equal(result.summary.sourceBackedAuxiliaryBinderExclusionCount, 0);
  });
});
