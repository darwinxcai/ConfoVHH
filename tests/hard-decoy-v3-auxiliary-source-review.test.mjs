import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyAuxiliarySourceReview } from "../scripts/hard-decoy-v3/verify-auxiliary-source-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW = JSON.parse(await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v3/auxiliary-remainder-source-review-2026-09-04/source-reviews.json"), "utf8"));

test("source review verifies all 16 complete frozen inventories while retaining four discrepancies", async () => {
  const result = await verifyAuxiliarySourceReview(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.entryAuxiliaryExclusionCount, 12);
  assert.deepEqual(result.pendingPdbIds, ["8JBG", "8XVJ", "8XVK", "8XVL"]);
  assert.equal(result.wholeCensusDecisionMade, false);
});

test("inventory omission cannot survive comparison with the frozen raw snapshot", async () => {
  const changed = structuredClone(REVIEW);
  changed.reviews[0].allFrozenPolymerEntities.pop();
  await assert.rejects(verifyAuxiliarySourceReview(ROOT, changed), /frozen entity inventory/u);
});

test("anti-Fab boundaries and scFv identity evidence must agree with frozen sequence bytes", async () => {
  const antiFab = structuredClone(REVIEW);
  antiFab.reviews[0].sequenceIdentityEvidence.candidateStart1 += 1;
  await assert.rejects(verifyAuxiliarySourceReview(ROOT, antiFab), /anti-Fab candidate boundaries/u);
  const scfv = structuredClone(REVIEW);
  scfv.reviews.find(row => row.pdbId === "8JBF").sequenceIdentityEvidence.sequenceSha256 = "0".repeat(64);
  await assert.rejects(verifyAuxiliarySourceReview(ROOT, scfv), /scFv sequence evidence drift/u);
});

test("unresolved source-deposition discrepancies cannot become exclusions or whole-census authority", async () => {
  const changed = structuredClone(REVIEW);
  const unresolved = changed.reviews.find(row => row.pdbId === "8JBG");
  unresolved.entryDisposition = "EXCLUDE_AUXILIARY_BINDER";
  unresolved.entrySourceReviewComplete = true;
  unresolved.entryAssessment.unresolvedDiscrepancies = [];
  await assert.rejects(verifyAuxiliarySourceReview(ROOT, changed), /premature exclusion/u);
  const terminal = structuredClone(REVIEW);
  terminal.summary.wholeCensusDecisionMade = true;
  await assert.rejects(verifyAuxiliarySourceReview(ROOT, terminal), /cannot gain authority/u);
});
