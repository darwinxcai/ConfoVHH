import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateGeneratorReadiness, verifyGeneratorReadiness } from "../scripts/hard-decoy-v3/verify-generator-readiness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const READINESS_PATH = path.join(ROOT, "validation/hard-decoy-holdout-v3/generator-readiness-2026-09-04/readiness.json");
const GENERATORS_PATH = path.join(ROOT, "validation/hard-decoy-holdout-v2/prelabel-census/generator-contracts.json");
const RECEPTOR_DIRECTORY = path.join(ROOT, "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30");

async function fixture() {
  const [readiness, generatorContracts, receptorManifest, receptorSummary] = await Promise.all([
    readFile(READINESS_PATH, "utf8").then(JSON.parse),
    readFile(GENERATORS_PATH, "utf8").then(JSON.parse),
    readFile(path.join(RECEPTOR_DIRECTORY, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(RECEPTOR_DIRECTORY, "summary.json"), "utf8").then(JSON.parse),
  ]);
  return { readiness, context: { generatorContracts, receptorManifest, receptorSummary } };
}

test("the recovered generator-readiness package verifies without regenerating frozen artifacts", async () => {
  const readiness = await verifyGeneratorReadiness(ROOT);
  assert.equal(readiness.completedCheckpoint.canonicalReceptorTmPregraphComplete, true);
  assert.equal(readiness.completedCheckpoint.canonicalReceptorTmPregraphMustNotBeRegenerated, true);
  assert.equal(readiness.msaPreparation.retrievalAuthorized, false);
  assert.equal(readiness.targetState.exactTargetManifestFrozen, false);
});

test("per-chain MSA retrieval cannot authorize the configured paired mode", async () => {
  const { readiness, context } = await fixture();
  const drifted = structuredClone(readiness);
  drifted.msaPreparation.historicalV2PolicyAssessment.sufficientForConfiguredUnpairedPairedMode = true;
  assert.throws(
    () => validateGeneratorReadiness(drifted, context),
    /per-chain-only policy cannot authorize paired MSA retrieval/,
  );
});

test("missing parameter and environment hashes remain hard blockers", async () => {
  const { readiness, context } = await fixture();
  const drifted = structuredClone(readiness);
  drifted.generatorAssets.colabfold.parameterArchiveSha256 = "a".repeat(64);
  assert.throws(
    () => validateGeneratorReadiness(drifted, context),
    /Unverified AlphaFold parameter hashes must remain unresolved/,
  );

  const prematurelyAuthorized = structuredClone(readiness);
  prematurelyAuthorized.msaPreparation.retrievalAuthorized = true;
  assert.throws(
    () => validateGeneratorReadiness(prematurelyAuthorized, context),
    /MSA retrieval was prematurely authorized/,
  );
});
