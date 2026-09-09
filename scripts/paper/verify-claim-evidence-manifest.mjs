import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const MANIFEST = "paper/CLAIM_EVIDENCE.json";
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_PATH = /^(?:paper|scripts|tests|validation)\/[A-Za-z0-9._/-]+$/u;
const EVIDENCE_CLASSES = new Set(["RETROSPECTIVE_DEVELOPMENT", "SYNTHETIC_SOFTWARE_VERIFICATION"]);
const ACCESS_CLASSES = new Set(["PUBLIC_REPOSITORY", "PUBLIC_REPOSITORY_DERIVED_RESULT", "PUBLIC_REPOSITORY_SYNTHETIC"]);

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function normalizedText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

async function directRegularFile(repositoryRoot, relative) {
  assert.match(relative, SAFE_PATH, `unsafe repository path: ${relative}`);
  assert.ok(!relative.split("/").includes(".."), `path traversal not permitted: ${relative}`);
  const root = await realpath(repositoryRoot);
  const absolute = path.join(root, relative);
  const info = await lstat(absolute);
  assert.ok(info.isFile() && !info.isSymbolicLink(), `evidence must be a direct regular file: ${relative}`);
  assert.equal(await realpath(absolute), absolute, `evidence path resolves elsewhere: ${relative}`);
  return absolute;
}

export async function verifyClaimEvidenceManifest(repositoryRoot = ROOT, supplied = null) {
  const manifestPath = await directRegularFile(repositoryRoot, MANIFEST);
  const manifest = supplied ?? JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.status, "PARTIAL_PUBLIC_REPRODUCIBILITY");
  assert.equal(manifest.reviewedBaselineCommit, "9aeadb8185a02da4e67967d9fbe12b1503d02e96");
  assert.ok(typeof manifest.scope === "string" && manifest.scope.includes("not an independent efficacy result"));
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0);
  assert.ok(Array.isArray(manifest.claims) && manifest.claims.length > 0);
  assert.ok(Array.isArray(manifest.unavailableInputs) && manifest.unavailableInputs.length > 0);

  unique(manifest.artifacts.map(row => row.id), "artifact IDs");
  unique(manifest.artifacts.map(row => row.path), "artifact paths");
  unique(manifest.claims.map(row => row.id), "claim IDs");
  unique(manifest.unavailableInputs.map(row => row.id), "unavailable-input IDs");

  const artifactIds = new Set(manifest.artifacts.map(row => row.id));
  for (const artifact of manifest.artifacts) {
    assert.ok(typeof artifact.id === "string" && /^[a-z0-9-]+$/u.test(artifact.id));
    assert.match(artifact.sha256, SHA256);
    assert.ok(ACCESS_CLASSES.has(artifact.access), `unknown access class: ${artifact.access}`);
    assert.ok(typeof artifact.role === "string" && artifact.role.length >= 20);
    const bytes = await readFile(await directRegularFile(repositoryRoot, artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `evidence hash changed: ${artifact.path}`);
  }

  const referenced = new Set();
  for (const claim of manifest.claims) {
    assert.ok(typeof claim.id === "string" && /^[a-z0-9-]+$/u.test(claim.id));
    assert.ok(EVIDENCE_CLASSES.has(claim.evidenceClass), `unknown evidence class: ${claim.evidenceClass}`);
    assert.ok(typeof claim.reproducibility === "string" && claim.reproducibility.length > 0);
    assert.ok(typeof claim.interpretation === "string" && claim.interpretation.length >= 20);
    assert.ok(Array.isArray(claim.evidenceArtifactIds) && claim.evidenceArtifactIds.length > 0);
    unique(claim.evidenceArtifactIds, `${claim.id} artifact references`);
    for (const id of claim.evidenceArtifactIds) {
      assert.ok(artifactIds.has(id), `${claim.id} references unknown artifact ${id}`);
      referenced.add(id);
    }
    assert.ok(typeof claim.text === "string" && claim.text.length >= 20);
    const manuscript = await readFile(await directRegularFile(repositoryRoot, claim.manuscript), "utf8");
    assert.ok(normalizedText(manuscript).includes(normalizedText(claim.text)), `${claim.id} text is absent from ${claim.manuscript}`);
  }
  assert.deepEqual([...artifactIds].filter(id => !referenced.has(id)), [], "every artifact must support at least one claim");

  const unavailableIds = new Set(manifest.unavailableInputs.map(row => row.id));
  assert.ok(unavailableIds.has("retained-original-coordinate-confidence-archives"));
  assert.ok(unavailableIds.has("missing-preliminary-cognate-coordinates"));
  assert.ok(unavailableIds.has("full-pae-matrices"));
  assert.ok(unavailableIds.has("independent-user-completion"));
  for (const unavailable of manifest.unavailableInputs) {
    assert.ok(typeof unavailable.effect === "string" && unavailable.effect.length >= 30);
  }
  assert.equal(manifest.unavailableInputs.find(row => row.id === "missing-preliminary-cognate-coordinates").count, 85);
  assert.deepEqual(manifest.boundaries, {
    nativeHoldoutArtifactsAccessedToCreateManifest: false,
    predictionOutputsAccessedToCreateManifest: false,
    newScientificAnalysisPerformed: false,
    syntheticValuesUsedAsStudyResults: false,
    selectionSuperioritySupported: false,
    formalIndependentEligibleGroupCount: 0,
    targetFreezePermitted: false,
    wholeCensusBoundEstablished: false,
  });
  return {
    verified: true,
    artifactCount: manifest.artifacts.length,
    claimCount: manifest.claims.length,
    unavailableInputCount: manifest.unavailableInputs.length,
    status: manifest.status,
    formalIndependentEligibleGroupCount: manifest.boundaries.formalIndependentEligibleGroupCount,
    targetFreezePermitted: manifest.boundaries.targetFreezePermitted,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  process.stdout.write(`${JSON.stringify(await verifyClaimEvidenceManifest(), null, 2)}\n`);
}
