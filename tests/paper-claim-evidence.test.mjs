import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { verifyClaimEvidenceManifest } from "../scripts/paper/verify-claim-evidence-manifest.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

async function manifest() {
  return JSON.parse(await readFile(path.join(ROOT, "paper/CLAIM_EVIDENCE.json"), "utf8"));
}

test("paper claims resolve to exact public evidence with explicit reproducibility limits", async () => {
  assert.deepEqual(await verifyClaimEvidenceManifest(ROOT), {
    verified: true,
    artifactCount: 14,
    claimCount: 7,
    unavailableInputCount: 4,
    status: "PARTIAL_PUBLIC_REPRODUCIBILITY",
    formalIndependentEligibleGroupCount: 0,
    targetFreezePermitted: false,
  });
});

test("claim promotion, missingness erasure and synthetic authority fail closed", async () => {
  const promoted = await manifest();
  promoted.boundaries.selectionSuperioritySupported = true;
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, promoted));

  const erased = await manifest();
  erased.unavailableInputs = erased.unavailableInputs.filter(row => row.id !== "full-pae-matrices");
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, erased));

  const synthetic = await manifest();
  synthetic.boundaries.syntheticValuesUsedAsStudyResults = true;
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, synthetic));
});

test("changed evidence digest, claim text and unknown artifact references fail", async () => {
  const digest = await manifest();
  digest.artifacts[0].sha256 = "0".repeat(64);
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, digest), /evidence hash changed/u);

  const text = await manifest();
  text.claims[0].text = "This claim does not occur in the manuscript text.";
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, text), /text is absent/u);

  const reference = await manifest();
  reference.claims[0].evidenceArtifactIds.push("unknown-artifact");
  await assert.rejects(verifyClaimEvidenceManifest(ROOT, reference), /unknown artifact/u);
});
