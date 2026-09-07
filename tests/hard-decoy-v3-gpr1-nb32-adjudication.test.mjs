import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyGpr1Nb32Adjudication } from "../scripts/hard-decoy-v3/adjudicate-gpr1-nb32.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = "validation/hard-decoy-holdout-v3/gpr1-nb32-entity-adjudication-2026-09-07";

test("all six Nb32 entities receive bounded auxiliary dispositions while entries remain pending", async () => {
  const result = await verifyGpr1Nb32Adjudication(ROOT);
  assert.equal(result.verified, true);
  assert.equal(result.reviewedEntryCount, 6);
  assert.equal(result.reviewedPolymerCount, 29);
  assert.equal(result.candidateAuxiliaryEntityDispositionCount, 6);
  assert.equal(result.wholeEntriesPendingCount, 6);
  assert.equal(result.independentEligibleComponentIncrement, 0);
  assert.equal(result.formallyClearedIndependentComponentCount, 0);
  assert.equal(result.targetFreezePermitted, false);
});

test("sequence identity cannot become sole role authority", async () => {
  const name = "entity-adjudications.json";
  const value = JSON.parse(await readFile(path.join(ROOT, PACKAGE, name), "utf8"));
  value.reviews[0].candidateRole.identityEvidence.roleProofBySequenceAlone = true;
  await assert.rejects(verifyGpr1Nb32Adjudication(ROOT, new Map([[name, `${JSON.stringify(value, null, 2)}\n`]])), /differs from deterministic source evidence/u);
});

test("candidate dispositions cannot become whole-entry, graph or freeze authority", async () => {
  const name = "entity-adjudications.json";
  const value = JSON.parse(await readFile(path.join(ROOT, PACKAGE, name), "utf8"));
  assert.ok(value.reviews.every(row => row.wholeEntryDisposition.startsWith("PENDING_") && !row.entryExclusionAuthority));
  assert.equal(value.authority.formalLeakageEdgeAuthority, false);
  assert.equal(value.authority.formalNoEdgeAuthority, false);
  assert.equal(value.summary.wholeEntryDispositionCount, 0);
  assert.equal(value.summary.wholeCensusUpperBound, null);

  value.authority.targetFreezePermitted = true;
  await assert.rejects(verifyGpr1Nb32Adjudication(ROOT, new Map([[name, `${JSON.stringify(value, null, 2)}\n`]])), /differs from deterministic source evidence/u);
});

test("newly exposed secondary prose is excluded from scientific authority", async () => {
  const name = "access-and-exposure.json";
  const value = JSON.parse(await readFile(path.join(ROOT, PACKAGE, name), "utf8"));
  assert.equal(value.sourceAccessUpdate.newPrimaryMethodsEvidenceRecovered, false);
  assert.equal(value.incident.nativeCoordinatesAccessed, false);
  assert.equal(value.incident.nativeRelativeReceptorVhhPoseInspected, false);
  assert.equal(value.incident.structuralContactTablesAccessed, false);
  assert.equal(value.effect.usedForCandidateEntityAdjudication, false);
  assert.equal(value.effect.cleanBlindClaimPermitted, false);

  value.effect.usedForCandidateEntityAdjudication = true;
  await assert.rejects(verifyGpr1Nb32Adjudication(ROOT, new Map([[name, `${JSON.stringify(value, null, 2)}\n`]])), /differs from deterministic source evidence/u);
});

test("verification rejects untracked package files", async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-gpr1-adjudication-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const inputDirectory = path.join(temporary, "validation/hard-decoy-holdout-v3/gpr1-nb32-source-review-2026-09-04");
  const outputDirectory = path.join(temporary, PACKAGE);
  await mkdir(inputDirectory, { recursive: true });
  await cp(path.join(ROOT, "validation/hard-decoy-holdout-v3/gpr1-nb32-source-review-2026-09-04/source-review.json"), path.join(inputDirectory, "source-review.json"));
  await cp(path.join(ROOT, PACKAGE), outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "untracked.txt"), "not allowed\n");
  await assert.rejects(verifyGpr1Nb32Adjudication(temporary), /Package file inventory changed/u);
});
