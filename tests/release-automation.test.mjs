import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("scientific-engine manifests remain byte-identical to both v0.5 attestations", async () => {
  const packageJson = await source("package.json");
  const packageLock = await source("package-lock.json");
  const expected = {
    "package.json": "6e7c0814725b86eaa002a3c3f73782cfbe05f1531ff7a8ffbc1a0190f157a3d2",
    "package-lock.json": "db0745c4e082d041054a8735ae5926a302fab313fba487316ed56559c9335f81",
  };
  assert.equal(sha256(packageJson), expected["package.json"]);
  assert.equal(sha256(packageLock), expected["package-lock.json"]);
  for (const summaryPath of [
    "validation/v0.5-public-regression-attestation-v1/summary.json",
    "validation/dockq-v0.5-regression-replay-v1/summary.json",
  ]) {
    const summary = JSON.parse(await source(summaryPath));
    assert.equal(summary.sourceAttestation.implementation.files["package.json"], expected["package.json"]);
    assert.equal(summary.sourceAttestation.implementation.files["package-lock.json"], expected["package-lock.json"]);
  }
});

test("CI and release workflows use full-SHA official actions and separated assurance gates", async () => {
  const ci = await source(".github/workflows/ci.yml");
  const release = await source(".github/workflows/release.yml");
  const workflows = `${ci}\n${release}`;
  const actionReferences = [...workflows.matchAll(/^\s*uses:\s*(\S+)/gmu)].map((match) => match[1]);
  assert.ok(actionReferences.length >= 8);
  for (const reference of actionReferences) {
    assert.match(reference, /^actions\/(?:checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflows, /uses:\s*[^\s]+@v\d/u);
  for (const gate of ["core-release-gate", "core-coverage", "chromium-acceptance", "public-producer-regression"]) {
    assert.match(ci, new RegExp(`^  ${gate}:`, "m"));
  }
  assert.match(release, /workflow_run:/);
  assert.match(release, /head_branch == 'main'/);
  assert.match(release, /git rev-parse origin\/main/);
  assert.match(release, /gh release view "\$\{tag\}"/);
  assert.match(release, /valid_release=true/);
  assert.match(release, /already has a published GitHub Release[\s\S]*publish_required=false/);
  assert.match(release, /points to \$\{tagged_commit\} but has no valid published GitHub Release/);
  assert.match(release, /steps\.release\.outputs\.publish_required == 'true'/);
  assert.equal([...release.matchAll(/gh release view/gmu)].length, 1);
  assert.doesNotMatch(release, /npm\s+(?:publish|pack)/u);
});

test("isolated QA and release artifacts preserve product/engine separation", async () => {
  const qaPackage = JSON.parse(await source("qa/package.json"));
  assert.deepEqual(qaPackage.devDependencies, {
    "@axe-core/playwright": "4.13.0",
    "@playwright/test": "1.62.1",
    c8: "12.0.0",
  });
  const releaseScript = await source("scripts/create-release-artifacts.mjs");
  assert.match(releaseScript, /product-v\$\{productVersion\}/);
  assert.match(releaseScript, /scientificEngineVersion: engineVersion/);
  assert.match(releaseScript, /rootPackageLockSha256/);
  assert.match(releaseScript, /securityAuditSha256/);
  assert.match(releaseScript, /scientificArtifactManifestSha256/);
  assert.match(releaseScript, /candidateSelectionValidated: false/);
  assert.match(releaseScript, /formalHardDecoyHoldoutEvaluated: false/);
  assert.doesNotMatch(releaseScript, /npm[^\n]*(?:publish|pack)/u);
});
