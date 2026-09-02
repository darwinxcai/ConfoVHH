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

function workflowJob(workflow, jobId) {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow job is missing: ${jobId}`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-z][a-z0-9-]*:\n/u);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

test("archived scientific-engine manifests remain byte-identical to both v0.5 attestations", async () => {
  const snapshot = JSON.parse(await source("validation/v0.5-engine-implementation-snapshot-v1/index.json"));
  const expected = {
    "package.json": "6e7c0814725b86eaa002a3c3f73782cfbe05f1531ff7a8ffbc1a0190f157a3d2",
    "package-lock.json": "db0745c4e082d041054a8735ae5926a302fab313fba487316ed56559c9335f81",
  };
  for (const [relative, digest] of Object.entries(expected)) {
    assert.equal(snapshot.attestations["public-regression"].files[relative], digest);
    assert.equal(snapshot.attestations["dockq-regression-replay"].files[relative], digest);
    assert.equal(
      sha256(await readFile(path.join(root, "validation", "v0.5-engine-implementation-snapshot-v1", "objects", digest))),
      digest,
    );
    assert.notEqual(sha256(await readFile(path.join(root, relative))), digest);
  }
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
  const metadata = await source(".github/workflows/hard-decoy-v3-metadata.yml");
  const entryMetadata = await source(".github/workflows/hard-decoy-v3-entry-metadata.yml");
  const workflows = `${ci}\n${release}\n${metadata}\n${entryMetadata}`;
  const actionReferences = [...workflows.matchAll(/^\s*uses:\s*(\S+)/gmu)].map((match) => match[1]);
  assert.ok(actionReferences.length >= 8);
  for (const reference of actionReferences) {
    assert.match(reference, /^actions\/(?:checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflows, /uses:\s*[^\s]+@v\d/u);
  for (const gate of ["core-release-gate", "core-coverage", "chromium-acceptance", "public-producer-regression"]) {
    assert.match(ci, new RegExp(`^  ${gate}:`, "m"));
  }
  const coreReleaseGate = workflowJob(ci, "core-release-gate");
  for (const command of [
    /^\s*run: npm ci\s*$/mu,
    /^\s*npm ls --all\s*$/mu,
    /^\s*node scripts\/audit-advisories\.mjs\s*$/mu,
    /^\s*npm audit --omit=dev --audit-level=moderate\s*$/mu,
    /^\s*run: npm run test:release\s*$/mu,
  ]) {
    assert.match(coreReleaseGate, command);
  }

  const coverageGate = workflowJob(ci, "core-coverage");
  assert.match(coverageGate, /^\s*npm ci\s*$/mu);
  assert.match(coverageGate, /^\s*npm ci --prefix qa\s*$/mu);
  assert.match(coverageGate, /^\s*run: npm audit --prefix qa --audit-level=moderate\s*$/mu);

  const browserGate = workflowJob(ci, "chromium-acceptance");
  assert.match(browserGate, /^\s*npm ci\s*$/mu);
  assert.match(browserGate, /^\s*npm ci --prefix qa\s*$/mu);
  assert.match(browserGate, /^\s*run: \.\/qa\/node_modules\/\.bin\/playwright install --with-deps chromium\s*$/mu);
  assert.match(browserGate, /^\s*run: npm run build\s*$/mu);
  assert.match(browserGate, /^\s*run: npm --prefix qa test\s*$/mu);

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
  const releaseGate = workflowJob(release, "publish");
  for (const command of [
    /^\s*run: npm ci\s*$/mu,
    /^\s*npm ls --all\s*$/mu,
    /^\s*node scripts\/audit-advisories\.mjs\s*$/mu,
    /^\s*npm audit --omit=dev --audit-level=moderate\s*$/mu,
    /^\s*run: npm run test:release\s*$/mu,
  ]) {
    assert.match(releaseGate, command);
  }
  for (const workflow of [metadata, entryMetadata]) {
    assert.doesNotMatch(workflow, /actions\/checkout|verify-integration-state\.mjs|verify-design-record\.mjs/);
    assert.match(workflow, /stage-v3-metadata-inputs\.mjs/);
    assert.match(workflow, /runs-on: ubuntu-24\.04/);
    assert.match(workflow, /node-version: 22\.18\.0/);
    assert.match(workflow, /if: success\(\)/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.doesNotMatch(workflow, /if: always\(\)/);
  }
});

test("Dependabot monitors root, QA, and GitHub Actions dependency domains", async () => {
  const dependabot = await source(".github/dependabot.yml");
  assert.match(
    dependabot,
    /package-ecosystem: github-actions\n\s+directory: \/\n\s+schedule:\n\s+interval: weekly/u,
  );
  assert.match(
    dependabot,
    /package-ecosystem: npm\n\s+directory: \/\n\s+schedule:\n\s+interval: weekly/u,
  );
  assert.match(
    dependabot,
    /coupled-runtime-build:[\s\S]*?"react-server-dom-webpack"[\s\S]*?"vinext"[\s\S]*?"vite"/u,
  );
  assert.match(
    dependabot,
    /package-ecosystem: npm\n\s+directory: \/qa\n\s+schedule:\n\s+interval: monthly/u,
  );
});

test("isolated QA and release artifacts preserve product/engine separation", async () => {
  const rootPackage = JSON.parse(await source("package.json"));
  assert.match(rootPackage.scripts["test:release"], /test:release-artifacts/u);
  assert.equal(
    rootPackage.scripts["test:release-artifacts"],
    "node scripts/verify-release-artifact-generation.mjs",
  );
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
  assert.match(releaseScript, /hard-decoy-holdout-v3\/design-record\/checksums\.sha256/);
  assert.match(releaseScript, /hard-decoy-holdout-v3\/prelabel-census-draft\/checksums\.sha256/);
  assert.match(releaseScript, /hard-decoy-holdout-v3\/source-snapshot-2026-08-29\/checksums\.sha256/);
  assert.match(releaseScript, /hard-decoy-holdout-v3\/entry-metadata-draft\/checksums\.sha256/);
  assert.match(releaseScript, /hard-decoy-holdout-v3\/entry-metadata-snapshot-2026-08-29\/checksums\.sha256/);
  assert.match(releaseScript, /hard-decoy-holdout-v3\/entry-metadata-snapshot-2026-08-29-replay-054318Z\/checksums\.sha256/);
  assert.match(releaseScript, /ENTRY_METADATA_SNAPSHOT_ATTESTATION_2026-08-29\.json/);
  assert.match(releaseScript, /SOURCE_SNAPSHOT_ATTESTATION_2026-08-29\.json/);
  assert.match(releaseScript, /SOURCE_SNAPSHOT_IMPORT_RECEIPT_2026-08-29\.json/);
  assert.match(releaseScript, /INTEGRATION_STATE_2026-08-29\.json/);
  assert.match(releaseScript, /source-licenses-2026-08-29\.json/);
  assert.match(releaseScript, /verifyChecksumManifest/);
  assert.match(releaseScript, /checksumManifestsVerified: true/);
  assert.match(releaseScript, /sourceArchivePackagingDeterministicForExactCommit: true/);
  assert.match(releaseScript, /productionBundleManifestDeterministicForExactBundle: true/);
  assert.match(releaseScript, /productionBundleArchivePublished: false/);
  assert.match(releaseScript, /productionBundleCredentialBearingBytesPublished: false/);
  assert.match(releaseScript, /productionBuildManifestSafeForDeployment: false/);
  assert.match(releaseScript, /freshProductionBuildRequiredForDeployment: true/);
  assert.match(releaseScript, /independentProductionCompilationReproducibilityVerified: false/);
  assert.match(releaseScript, /independentProductionCompilationReproducibilityClaimed: false/);
  assert.match(releaseScript, /candidateSelectionValidated: false/);
  assert.match(releaseScript, /formalHardDecoyHoldoutEvaluated: false/);
  assert.match(releaseScript, /oracleRequestFrozen: false/);
  assert.match(releaseScript, /oracleExecuted: false/);
  assert.match(releaseScript, /developmentEvaluationExecuted: false/);
  assert.match(releaseScript, /release output directory must be empty/);
  assert.doesNotMatch(releaseScript, /-dist\.tar\.gz|const distArchive/u);
  assert.doesNotMatch(releaseScript, /npm[^\n]*(?:publish|pack)/u);
});
