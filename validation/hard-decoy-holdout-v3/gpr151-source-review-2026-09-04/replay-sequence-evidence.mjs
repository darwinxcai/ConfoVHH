import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  assert(["--repository-root", "--evidence-directory", "--output-directory", "--python"].includes(name), `Unknown option: ${name}`);
  assert(process.argv[index + 1] && !options.has(name), `Missing or repeated option: ${name}`);
  options.set(name, process.argv[index + 1]);
}
const repositoryRoot = path.resolve(options.get("--repository-root") ?? path.join(packageDirectory, "../../.."));
const evidenceDirectory = path.resolve(options.get("--evidence-directory") ?? path.join(packageDirectory, "sequence-evidence"));
const outputDirectory = options.has("--output-directory")
  ? path.resolve(options.get("--output-directory"))
  : await mkdtemp(path.join(os.tmpdir(), "confovhh-gpr151-replay-"));
await mkdir(outputDirectory, { recursive: true });
assert.equal((await readdir(outputDirectory)).length, 0, "Replay output directory must be empty.");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalRepositoryRoot = "/workspace/scratch/746bb3989941/ConfoVHH";
const originalOutputDirectory = "/tmp/confovhh-gpr151-sequence";
const expectedNb6 = JSON.parse(await readFile(path.join(evidenceDirectory, "nb6-local-comparison.json"), "utf8"));
const expectedReceptor = JSON.parse(await readFile(path.join(evidenceDirectory, "gpr151-receptor-comparison.json"), "utf8"));
const originalNode = await readFile(path.join(evidenceDirectory, "compare-nb6.mjs"), "utf8");
const originalPython = await readFile(path.join(evidenceDirectory, "compare-receptor.py"), "utf8");
assert.equal(sha(originalNode), expectedNb6.executionScript.sha256, "Archived NB6 collector source changed.");
const relocation = JSON.parse(await readFile(path.join(packageDirectory, "sequence-evidence-relocation.json"), "utf8"));
for (const filename of ["compare-nb6.mjs", "compare-receptor.py"]) {
  const bound = relocation.files.find((entry) => entry.retainedPath === `sequence-evidence/${filename}`);
  assert(bound, `Unbound archived source: ${filename}`);
  assert.equal(sha(await readFile(path.join(evidenceDirectory, filename))), bound.sha256);
}

// Verify every original scientific input before running the unchanged algorithms.
for (const input of expectedNb6.inputs) {
  const bytes = await readFile(path.join(repositoryRoot, input.path));
  assert.equal(bytes.length, input.bytes, `Input length changed: ${input.path}`);
  assert.equal(sha(bytes), input.sha256, `Input digest changed: ${input.path}`);
}
for (const input of expectedReceptor.sourceInputs) {
  const captured = input.path.startsWith(`${originalOutputDirectory}/`);
  const filename = captured ? path.basename(input.path) : input.path;
  const bytes = await readFile(path.join(captured ? evidenceDirectory : repositoryRoot, filename));
  assert.equal(sha(bytes), input.sha256, `Receptor input digest changed: ${input.path}`);
  if (captured) await copyFile(path.join(evidenceDirectory, filename), path.join(outputDirectory, filename));
}

function replaceOnce(source, oldText, newText) {
  assert.equal(source.split(oldText).length, 2, `Expected one relocation anchor: ${oldText}`);
  return source.replace(oldText, newText);
}
let nodeSource = originalNode;
for (const relative of ["scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs", "node_modules/immunum/immunum.js"]) {
  nodeSource = replaceOnce(nodeSource, `'${originalRepositoryRoot}/${relative}'`, JSON.stringify(pathToFileURL(path.join(repositoryRoot, relative)).href));
}
nodeSource = replaceOnce(nodeSource, `const root='${originalRepositoryRoot}';`, `const root=${JSON.stringify(repositoryRoot)};`);
for (const filename of ["compare-nb6.mjs", "nb6-local-comparison.json"]) {
  const oldLiteral = `'${originalOutputDirectory}/${filename}'`;
  assert(nodeSource.includes(oldLiteral), `Missing output relocation anchor: ${filename}`);
  nodeSource = nodeSource.replaceAll(oldLiteral, JSON.stringify(path.join(outputDirectory, filename)));
}
nodeSource = "globalThis.fetch = () => { throw new Error('Offline replay cannot fetch network data.'); };\n" + nodeSource;
let pythonSource = replaceOnce(originalPython, `ROOT = Path('${originalRepositoryRoot}')`, `ROOT = Path(${JSON.stringify(repositoryRoot)})`);
pythonSource = replaceOnce(pythonSource, `OUT = Path('${originalOutputDirectory}')`, `OUT = Path(${JSON.stringify(outputDirectory)})`);
assert(!nodeSource.includes(`'${originalRepositoryRoot}`) && !nodeSource.includes(`'${originalOutputDirectory}`), "Unresolved Node runtime path.");
assert(!pythonSource.includes(`Path('${originalRepositoryRoot}')`) && !pythonSource.includes(`Path('${originalOutputDirectory}')`), "Unresolved Python runtime path.");
await writeFile(path.join(outputDirectory, "compare-nb6.mjs"), nodeSource);
await writeFile(path.join(outputDirectory, "compare-receptor.py"), pythonSource);
execFileSync(options.get("--python") ?? "python3", [path.join(outputDirectory, "compare-receptor.py")], { cwd: outputDirectory, maxBuffer: 1024 * 1024 });
execFileSync(process.execPath, [path.join(outputDirectory, "compare-nb6.mjs")], { cwd: outputDirectory, maxBuffer: 1024 * 1024 });

function normalizedNb6(value) {
  const copy = structuredClone(value);
  delete copy.createdAt;
  delete copy.repositoryRoot;
  delete copy.executionScript;
  return copy;
}
function normalizedReceptor(value, runtimeDirectory) {
  const copy = structuredClone(value);
  for (const input of copy.sourceInputs) {
    if (input.path.startsWith(`${runtimeDirectory}/`)) input.path = `sequence-evidence/${path.basename(input.path)}`;
  }
  return copy;
}
const actualNb6 = JSON.parse(await readFile(path.join(outputDirectory, "nb6-local-comparison.json"), "utf8"));
const actualReceptor = JSON.parse(await readFile(path.join(outputDirectory, "gpr151-receptor-comparison.json"), "utf8"));
assert.deepEqual(normalizedNb6(actualNb6), normalizedNb6(expectedNb6), "NB6 scientific replay differs.");
assert.deepEqual(normalizedReceptor(actualReceptor, outputDirectory), normalizedReceptor(expectedReceptor, originalOutputDirectory), "Receptor scientific replay differs.");
for (const filename of ["9W3K-deposited-metadata.json", "9W3L-deposited-metadata.json", "6VI4-deposited-receptor-sequence.json"]) {
  assert.deepEqual(await readFile(path.join(outputDirectory, filename)), await readFile(path.join(evidenceDirectory, filename)), `Inventory replay differs: ${filename}`);
}
const report = {
  status: "OFFLINE_SCIENTIFIC_REPLAY_MATCHED",
  repositoryRoot,
  evidenceDirectory,
  outputDirectory,
  originalCollectorSourcesPreserved: true,
  originalNodeSourceSha256: sha(originalNode),
  originalPythonSourceSha256: sha(originalPython),
  replayNodeSourceSha256: sha(nodeSource),
  replayPythonSourceSha256: sha(pythonSource),
  excludedRuntimeFields: ["nb6.createdAt", "nb6.repositoryRoot", "nb6.executionScript"],
  normalizedRuntimeFields: ["receptor.sourceInputs[].path: original/replay output-directory prefixes map to sequence-evidence/"],
  scientificInputsAndDigestFieldsCompared: true,
  completeScientificOutputsCompared: true,
  exactAdditionalInventoryOutputsCompared: 3,
  developmentProfilesReproduced: 18,
  targetFreezePermitted: false,
};
await writeFile(path.join(outputDirectory, "replay-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
