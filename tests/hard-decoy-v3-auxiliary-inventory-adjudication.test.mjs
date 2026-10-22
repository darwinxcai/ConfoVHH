import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyAuxiliaryInventoryAdjudication } from "../scripts/hard-decoy-v3/adjudicate-auxiliary-inventory-remainders.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REVIEW = path.join(ROOT, "validation/hard-decoy-holdout-v3/auxiliary-inventory-adjudication-2026-09-07/source-reviews.json");

async function review() {
  return JSON.parse(await readFile(REVIEW, "utf8"));
}

test("four complete inventories now support bounded auxiliary-binder exclusions", async () => {
  assert.deepEqual(await verifyAuxiliaryInventoryAdjudication(ROOT), {
    verified: true,
    reviewedEntryCount: 4,
    reviewedPolymerCount: 18,
    entryAuxiliaryExclusionCount: 4,
    independentEligibleComponentIncrement: 0,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  });
});

test("all deposited polymers remain accounted for without inventing source-only chains", async () => {
  const value = await review();
  assert.deepEqual(value.reviews.map(row => row.pdbId), ["8JBG", "8XVJ", "8XVK", "8XVL"]);
  assert.deepEqual(value.reviews.map(row => row.polymerEntityCount), [6, 4, 4, 4]);
  assert.ok(value.reviews.every(row => row.allDepositedPolymerEntities.length === row.polymerEntityCount));
  assert.ok(value.reviews.every(row => row.sourceOnlyAntibodyReagents.every(reagent => reagent.presentAsSeparateFrozenEntity === false)));
  assert.ok(value.reviews.every(row => row.entryDisposition === "EXCLUDE_AUXILIARY_BINDER"));
});

test("NK3R and ETA antibody-format evidence stays distinct", async () => {
  const value = await review();
  const nkb = value.reviews[0];
  assert.equal(nkb.roleEvidence.classification, "SCFV16_G_PROTEIN_STABILIZER");
  assert.equal(nkb.reviewedAuxiliaryEntity.sequenceLength, 304);
  assert.equal(nkb.otherDepositedAntibodyEntities.length, 0);
  for (const eta of value.reviews.slice(1)) {
    assert.equal(eta.roleEvidence.classification, "ANTI_FAB_FIDUCIAL_NANOBODY");
    assert.equal(eta.otherDepositedAntibodyEntities.length, 2);
    assert.deepEqual(eta.sourceOnlyAntibodyReagents.map(reagent => reagent.name), ["Fab301"]);
  }
});

test("bounded inventory conclusions cannot gain formal graph, count or freeze authority", async () => {
  const name = "source-reviews.json";
  const value = await review();
  assert.equal(value.authority.formalLeakageGraphAuthority, false);
  assert.equal(value.authority.masterDispositionLedgerRewritten, false);
  assert.equal(value.summary.formallyClearedIndependentComponentCount, 0);
  assert.equal(value.summary.wholeCensusUpperBound, null);
  value.authority.formalLeakageGraphAuthority = true;
  value.summary.formallyClearedIndependentComponentCount = 1;
  value.summary.targetFreezePermitted = true;
  await assert.rejects(
    verifyAuxiliaryInventoryAdjudication(ROOT, new Map([[name, `${JSON.stringify(value, null, 2)}\n`]])),
    /differs from deterministic source evidence/u,
  );
});
