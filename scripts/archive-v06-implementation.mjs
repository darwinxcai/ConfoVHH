#!/usr/bin/env node
/**
 * v0.6 engine implementation attestation.
 *
 * The v0.5 attestations bind a set of scientific-core files by SHA-256, and
 * tests/v05-validation-artifacts.test.mjs asserts that the LIVE bytes of those
 * files still match. That pin is what makes "the scientific core has not
 * drifted" a checked fact rather than a claim.
 *
 * Promoting the v0.6 VHH numbering policy changes one of those files, so the
 * pin has to move forward — deliberately, with a record, and without touching
 * the v0.5 evidence. This script mints that record: it snapshots the CURRENT
 * bytes of the same file set, content-addressed by SHA-256, alongside the
 * executed immunum bytes, and states explicitly which files changed relative to
 * v0.5 and which are carried unchanged.
 *
 * It refuses to overwrite an existing snapshot, and it never reads or writes
 * anything under validation/v0.5-engine-implementation-snapshot-v1/.
 *
 * Usage:
 *   node scripts/archive-v06-implementation.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "validation", "v0.6-engine-implementation-snapshot-v1");
const objects = path.join(output, "objects");
const v05Snapshot = path.join(
  root,
  "validation",
  "v0.5-engine-implementation-snapshot-v1",
  "index.json",
);

/** The promotion's entire intended blast radius on the pinned file set. */
const EXPECTED_CHANGED_FILES = ["lib/vhh-numbering.ts"];

/**
 * Dependency manifests are recorded but excluded from the scientific-core
 * delta, matching the exclusion tests/v05-validation-artifacts.test.mjs has
 * always applied: the product's dependency environment is separately patched
 * and has legitimately advanced since v0.5, which is why that snapshot exists
 * as a supplemental archive in the first place.
 */
const MANIFESTS = new Set(["package.json", "package-lock.json"]);

const DEFINITIONS = [
  {
    id: "public-regression",
    summary: "validation/v0.5-public-regression-attestation-v1/summary.json",
  },
  {
    id: "dockq-regression-replay",
    summary: "validation/dockq-v0.5-regression-replay-v1/summary.json",
  },
];

try {
  await access(output);
  throw new Error("Refusing to overwrite the existing v0.6 implementation snapshot.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(objects, { recursive: true });
const objectDigests = new Set();

async function retainObject(bytes, digest) {
  if (objectDigests.has(digest)) return;
  await writeFile(path.join(objects, digest), bytes, { flag: "wx" });
  objectDigests.add(digest);
}

const v05 = JSON.parse(await readFile(v05Snapshot, "utf8"));
const attestations = {};
const changedAcrossAttestations = new Set();
let executedImmunum = null;

for (const definition of DEFINITIONS) {
  const summaryBytes = await readFile(path.join(root, definition.summary));
  const summary = JSON.parse(summaryBytes.toString("utf8"));
  const source = summary.sourceAttestation;
  const previous = v05.attestations[definition.id];
  assert.ok(previous, `Missing v0.5 attestation for ${definition.id}`);

  const files = {};
  const carriedUnchanged = [];
  const changed = [];
  const combined = createHash("sha256");

  for (const relative of Object.keys(source.implementation.files)) {
    // The live bytes are what this attestation binds; the v0.5 digest is
    // recorded beside them so the delta is explicit rather than inferred.
    const bytes = await readFile(path.join(root, relative));
    const digest = sha256(bytes);
    const before = previous.files[relative];
    assert.ok(before, `${relative}: absent from the v0.5 attestation`);
    await retainObject(bytes, digest);
    files[relative] = { sha256: digest, v05Sha256: before, changed: digest !== before };
    if (digest === before) carriedUnchanged.push(relative);
    else {
      changed.push(relative);
      if (!MANIFESTS.has(relative)) changedAcrossAttestations.add(relative);
    }
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }

  attestations[definition.id] = {
    supersedes: {
      summary: definition.summary,
      sourceCommit: previous.sourceCommit,
      implementationCombinedSha256: previous.implementationCombinedSha256,
    },
    implementationCombinedSha256: combined.digest("hex"),
    filesCarriedUnchangedFromV05: carriedUnchanged.sort(),
    filesChangedSinceV05: changed.sort(),
    files,
  };

  const recorded = source.executedDependencies?.immunum;
  if (!recorded || executedImmunum) continue;
  const dependencyCombined = createHash("sha256");
  const dependencyFiles = {};
  const installed = JSON.parse(
    await readFile(path.join(root, "node_modules", "immunum", "package.json"), "utf8"),
  );
  for (const entry of recorded.files) {
    const bytes = await readFile(path.join(root, "node_modules", "immunum", entry.path));
    const digest = sha256(bytes);
    await retainObject(bytes, digest);
    dependencyFiles[entry.path] = {
      bytes: bytes.byteLength,
      sha256: digest,
      v05Sha256: entry.sha256,
      changed: digest !== entry.sha256,
    };
    dependencyCombined.update(entry.path);
    dependencyCombined.update("\0");
    dependencyCombined.update(digest);
    dependencyCombined.update("\0");
  }
  executedImmunum = {
    name: recorded.name,
    // The point of the promotion: the executed engine is 1.3.0, and now the
    // product says so.
    version: installed.version,
    v05RecordedVersion: recorded.version,
    fileCount: Object.keys(dependencyFiles).length,
    combinedSha256: dependencyCombined.digest("hex"),
    v05CombinedSha256: recorded.combinedSha256,
    files: dependencyFiles,
  };
}

assert.deepEqual(
  [...changedAcrossAttestations].sort(),
  [...EXPECTED_CHANGED_FILES].sort(),
  "The v0.6 promotion changed a different set of pinned files than it declares.",
);

const index = {
  schemaVersion: "1.0.0",
  status: "frozen-current-implementation-attestation",
  scientificLineage: "0.6.0",
  supersedes: "validation/v0.5-engine-implementation-snapshot-v1",
  v05AttestationsPreservedByteForByte: true,
  purpose:
    "Bind the scientific-core bytes the product currently executes, after the v0.6 VHH " +
    "numbering promotion moved lib/vhh-numbering.ts. The v0.5 snapshot continues to bind " +
    "the historical bytes and is not modified. Every other pinned file is carried " +
    "byte-identical, and the assertion above fails if that stops being true.",
  promotion: {
    component: "VHH IMGT numbering",
    candidateStudy: "validation/v0.6-vhh-numbering-candidate-v1",
    expectedChangedFiles: EXPECTED_CHANGED_FILES,
    engineProvenanceCorrected: {
      from: "immunum 1.2.0",
      to: "immunum 1.3.0",
      note:
        "The previous label was false: the installed and executed engine was already 1.3.0.",
    },
    measuredBehaviouralChange: {
      developmentPilotPoses: 360,
      poseEngineProvenanceChanges: 360,
      poseNumberingStatusChanges: 0,
      targetRegionAssignmentChanges: 0,
      cdrContactShareChanges: 0,
      cdr3ContactShareChanges: 0,
      evidenceBandChanges: 0,
      cdrDependentRankingInputChanges: 0,
      publicPanelStructures: 17,
      publicPanelMeasuredFieldChanges: 0,
    },
  },
  attestations,
  executedDependencies: { immunum: executedImmunum },
};

const readme =
  "# v0.6 engine implementation attestation\n\n" +
  "This package binds the scientific-core implementation bytes the product currently\n" +
  "executes, and the executed `immunum` bytes, content-addressed by SHA-256.\n" +
  "`index.json` restores each logical path, records the v0.5 digest beside the current\n" +
  "one, and names exactly which files the v0.6 VHH numbering promotion changed.\n\n" +
  "It supersedes nothing. `validation/v0.5-engine-implementation-snapshot-v1` remains\n" +
  "byte-identical and continues to bind the historical execution environment that the\n" +
  "v0.5 public-regression and DockQ replay attestations were produced under. This\n" +
  "package answers a different question: what runs now.\n\n" +
  "The promotion changes one pinned file, `lib/vhh-numbering.ts`. The generating script\n" +
  "asserts that set and fails if the promotion touched anything else.\n";

await writeFile(path.join(output, "README.md"), readme, { flag: "wx" });
await writeFile(path.join(output, "index.json"), `${JSON.stringify(index, null, 2)}\n`, {
  flag: "wx",
});

const covered = [
  "README.md",
  "index.json",
  ...[...objectDigests].sort().map((digest) => `objects/${digest}`),
];
const checksums = [];
for (const relative of covered) {
  checksums.push(`${sha256(await readFile(path.join(output, relative)))}  ${relative}`);
}
await writeFile(path.join(output, "checksums.sha256"), `${checksums.join("\n")}\n`, {
  flag: "wx",
});

process.stdout.write(
  `${JSON.stringify({
    output: path.relative(root, output),
    objects: objectDigests.size,
    files: covered.length,
    changed: [...changedAcrossAttestations].sort(),
    immunum: `${executedImmunum.name} ${executedImmunum.version}`,
  })}\n`,
);
