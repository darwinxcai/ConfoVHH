import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildAuxiliaryRemainderBound, writeAuxiliaryRemainderBound } from "../scripts/hard-decoy-v3/build-auxiliary-remainder-bound.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "validation/hard-decoy-holdout-v3/auxiliary-remainder-bound-2026-09-04");

test("all 212 remainder rows map to source-backed auxiliary classes", async () => {
  const { authorities, mappings, summary } = await buildAuxiliaryRemainderBound(ROOT);
  assert.equal(authorities.length, 3);
  assert.equal(mappings.length, 212);
  assert.deepEqual(summary.auxiliaryRoleCounts, {
    NB35_G_PROTEIN_STABILIZER: 196,
    SCFV16_G_PROTEIN_STABILIZER: 3,
    ANTI_FAB_FIDUCIAL_NANOBODY: 13,
  });
  assert.ok(mappings.every((row) => row.dispositionCode === "EXCLUDE_AUXILIARY_BINDER"));
  assert.ok(mappings.every((row) => row.frozenVhhLikeEntity.soleApparentVhhLikeEntity));
  assert.ok(mappings.every((row) => row.frozenVhhLikeEntity.auxiliaryLexicalEntityMatch));
  assert.ok(mappings.every((row) => row.publicSourcesReviewed && row.evidenceUrls.length >= 3));
  assert.equal(summary.additionalAntibodyLikeEntityCount, 44);
  assert.equal(summary.additionalScfv16EntityCount, 16);
  assert.equal(summary.additionalFabChainEntityCount, 28);
  assert.ok(mappings.flatMap((row) => row.additionalAntibodyLikeEntities).every((entity) => entity.directReceptorVhhCandidate === false));
});

test("role-specific companion evidence is complete without native inspection", async () => {
  const { mappings } = await buildAuxiliaryRemainderBound(ROOT);
  const gProteinRows = mappings.filter((row) => row.roleClass !== "ANTI_FAB_FIDUCIAL_NANOBODY");
  const antiFabRows = mappings.filter((row) => row.roleClass === "ANTI_FAB_FIDUCIAL_NANOBODY");
  assert.equal(gProteinRows.length, 199);
  assert.equal(antiFabRows.length, 13);
  assert.ok(gProteinRows.every((row) => row.companionEvidence.gAlphaEntityIds.length > 0 && row.companionEvidence.gBetaEntityIds.length > 0));
  assert.ok(antiFabRows.every((row) => row.companionEvidence.fabHeavyEntityIds.length > 0 && row.companionEvidence.fabLightEntityIds.length > 0));
  assert.ok(mappings.every((row) => row.nativeCoordinatesInspected === false && row.nativeRelativePoseInspected === false));
});

test("the completed count bound terminates v3 below ten components", async () => {
  const { mappings, summary, manifest } = await buildAuxiliaryRemainderBound(ROOT);
  assert.ok(mappings.every((row) => row.independentComponentCountIncrementUpperBound === 0));
  assert.equal(summary.auxiliaryRemainderIndependentComponentIncrementUpperBound, 0);
  assert.equal(summary.priorPrioritizedFrontierUpperBound, 8);
  assert.equal(summary.wholeCensusComponentUpperBound, 8);
  assert.equal(summary.requiredIndependentComponentCount, 10);
  assert.equal(summary.componentDeficitAtUpperBound, 2);
  assert.equal(summary.wholeCensusUpperBoundBelowRequiredMinimum, true);
  assert.equal(summary.wholeCensusTerminalDecisionReached, true);
  assert.equal(summary.formalProtocolStatus, "TARGET_CENSUS_BLOCKED");
  assert.equal(manifest.completedCensusCountBound, true);
});

test("terminal status preserves all pre-label guardrails", async () => {
  const { summary, manifest } = await buildAuxiliaryRemainderBound(ROOT);
  assert.equal(summary.oracleRequestFreezePermitted, false);
  assert.equal(summary.targetFreezePermitted, false);
  assert.equal(summary.executionAuthorized, false);
  assert.equal(summary.nativeHoldoutCoordinatesAccessed, false);
  assert.equal(summary.nativeRelativePosesInspected, false);
  assert.equal(summary.dockqLabelsAccessed, false);
  assert.equal(summary.performanceResultsAccessed, false);
  assert.equal(manifest.masterDispositionLedgerRewritten, false);
});

test("checked-in terminal bound artifacts are deterministic and checksummed", async () => {
  const generated = await writeAuxiliaryRemainderBound(ROOT, OUTPUT);
  assert.equal(generated.output, OUTPUT);
  const checksums = (await readFile(path.join(OUTPUT, "checksums.sha256"), "utf8")).trimEnd().split("\n");
  for (const line of checksums) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    assert.ok(match);
    const bytes = await readFile(path.join(OUTPUT, match[2]));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
});
