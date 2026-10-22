import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "validation", "v0.5-engine-implementation-snapshot-v1");
const objects = path.join(output, "objects");

try {
  await access(output);
  throw new Error("Refusing to overwrite the existing v0.5 implementation snapshot.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const definitions = [
  {
    id: "public-regression",
    summary: "validation/v0.5-public-regression-attestation-v1/summary.json",
  },
  {
    id: "dockq-regression-replay",
    summary: "validation/dockq-v0.5-regression-replay-v1/summary.json",
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function historicalBytes(commit, relative) {
  return execFileSync("git", ["show", `${commit}:${relative}`], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
}

await mkdir(objects, { recursive: true });
const objectDigests = new Set();

async function retainObject(bytes, expected) {
  assert.equal(sha256(bytes), expected);
  if (!objectDigests.has(expected)) {
    await writeFile(path.join(objects, expected), bytes, { flag: "wx" });
    objectDigests.add(expected);
  }
}

const attestations = {};
let executedImmunum = null;

for (const definition of definitions) {
  const summaryBytes = await readFile(path.join(root, definition.summary));
  const summary = JSON.parse(summaryBytes.toString("utf8"));
  const source = summary.sourceAttestation;
  const files = {};
  const combined = createHash("sha256");
  for (const [relative, expected] of Object.entries(source.implementation.files)) {
    const bytes = historicalBytes(source.gitCommit, relative);
    await retainObject(bytes, expected);
    files[relative] = expected;
    combined.update(relative);
    combined.update("\0");
    combined.update(bytes);
    combined.update("\0");
  }
  assert.equal(combined.digest("hex"), source.implementation.combinedSha256);
  attestations[definition.id] = {
    summary: definition.summary,
    summarySha256: sha256(summaryBytes),
    sourceCommit: source.gitCommit,
    implementationCombinedSha256: source.implementation.combinedSha256,
    files,
  };

  const recorded = source.executedDependencies?.immunum;
  if (!recorded) continue;
  if (executedImmunum) {
    assert.equal(recorded.combinedSha256, executedImmunum.combinedSha256);
    continue;
  }
  const dependencyCombined = createHash("sha256");
  const dependencyFiles = {};
  for (const entry of recorded.files) {
    const bytes = await readFile(path.join(root, "node_modules", "immunum", entry.path));
    assert.equal(bytes.byteLength, entry.bytes);
    await retainObject(bytes, entry.sha256);
    dependencyFiles[entry.path] = {
      bytes: entry.bytes,
      sha256: entry.sha256,
    };
    dependencyCombined.update(entry.path);
    dependencyCombined.update("\0");
    dependencyCombined.update(entry.sha256);
    dependencyCombined.update("\0");
  }
  assert.equal(dependencyCombined.digest("hex"), recorded.combinedSha256);
  executedImmunum = {
    name: recorded.name,
    version: recorded.version,
    fileCount: recorded.fileCount,
    combinedSha256: recorded.combinedSha256,
    files: dependencyFiles,
  };
}

const index = {
  schemaVersion: "1.0.0",
  status: "frozen-supplemental-source-snapshot",
  purpose: "Preserve the exact implementation and executed immunum bytes bound by the unchanged v0.5 validation summaries after the researcher-facing product dependency environment advances.",
  currentProductDependencyEnvironmentMatchesAttestedV05: false,
  attestations,
  executedDependencies: { immunum: executedImmunum },
};

const readme = `# v0.5 engine implementation snapshot\n\nThis supplemental package preserves, without modifying either historical evidence package, the exact implementation objects and executed \`immunum 1.2.0\` bytes named by the v0.5 public-regression and DockQ replay attestations. Objects are content-addressed by SHA-256. \`index.json\` restores each original logical path and recomputes each unchanged combined implementation digest.\n\nThe current researcher-facing product uses a separately patched dependency environment. Therefore this archive proves the historical v0.5 execution environment; it does not claim that the live product lockfile is byte-identical to that environment. Current non-manifest scientific implementation files and executed immunum bytes are regression-checked separately.\n`;
await writeFile(path.join(output, "README.md"), readme, { flag: "wx" });
await writeFile(path.join(output, "index.json"), `${JSON.stringify(index, null, 2)}\n`, { flag: "wx" });

const covered = ["README.md", "index.json", ...[...objectDigests].sort().map((digest) => `objects/${digest}`)];
const checksums = [];
for (const relative of covered) {
  checksums.push(`${sha256(await readFile(path.join(output, relative)))}  ${relative}`);
}
await writeFile(path.join(output, "checksums.sha256"), `${checksums.join("\n")}\n`, { flag: "wx" });

process.stdout.write(`${JSON.stringify({ output, objects: objectDigests.size, files: covered.length })}\n`);
