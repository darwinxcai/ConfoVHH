// Offline comparison of synthetic reviewer exports. This cannot establish who
// operated the browser, whether its role gate was observed, or biological validity.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImportedSingleAuditReport } from "../../lib/research-workspace.ts";
import { runReviewerDemo } from "./reviewer-demo.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CASES = ["near", "separated"];
const MAX_JSON_BYTES = 1_000_000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const USAGE = "Usage: node scripts/paper/verify-reviewer-exports.mjs --example=DIRECTORY --near=BROWSER_JSON --separated=BROWSER_JSON [--output=NEW_JSON]";

function parseBytes(bytes, label) {
  if (!(typeof bytes === "string" || bytes instanceof Uint8Array)) {
    throw new Error(`${label} must contain JSON text or bytes.`);
  }
  if (Buffer.byteLength(bytes) < 1 || Buffer.byteLength(bytes) > MAX_JSON_BYTES) {
    throw new Error(`${label} must contain 1–${MAX_JSON_BYTES} bytes.`);
  }
  try {
    const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON.`);
  }
}

function same(actual, expected, label) {
  if (Object.is(actual, expected)) return;
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object" || Array.isArray(actual) !== Array.isArray(expected)) {
    throw new Error(`${label} does not match the synthetic reference.`);
  }
  const keys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (keys.length !== actualKeys.length || keys.some((key, index) => key !== actualKeys[index])) {
    throw new Error(`${label} fields do not match the synthetic reference.`);
  }
  for (const key of keys) same(actual[key], expected[key], `${label}.${key}`);
}

async function currentSourceHashes(directory = "lib") {
  const hashes = {};
  for (const entry of await readdir(path.join(ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(hashes, await currentSourceHashes(relative));
    else if (entry.isFile() && entry.name.endsWith(".ts")) hashes[relative] = sha(await readFile(path.join(ROOT, relative)));
  }
  if (directory === "lib") {
    for (const relative of ["package-lock.json", "scripts/paper/reviewer-demo.mjs"]) {
      hashes[relative] = sha(await readFile(path.join(ROOT, relative)));
    }
  }
  return hashes;
}

/** Inputs are JSON bytes, with each report map keyed by near and separated. */
export async function verifyReviewerExports({ receiptBytes, generatedReportBytes, browserReportBytes }) {
  same(Object.keys(generatedReportBytes ?? {}).sort(), CASES, "Generated report inventory");
  same(Object.keys(browserReportBytes ?? {}).sort(), CASES, "Browser report inventory");
  const receipt = parseBytes(receiptBytes, "Generator receipt");
  const reference = runReviewerDemo();
  const sourceSha256 = await currentSourceHashes();
  // Compute expected identities locally; never follow paths supplied in a receipt.
  const artifactSha256 = Object.fromEntries(Object.entries(reference.artifacts).map(([name, bytes]) => [name, sha(bytes)]));
  if (typeof receipt?.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+$/.test(receipt.nodeVersion)) {
    throw new Error("Generator receipt requires a recorded Node version.");
  }
  same(receipt, {
    schemaVersion: "1.0.0", scope: "synthetic software demonstration only",
    nodeVersion: receipt.nodeVersion, sourceSha256, cases: reference.cases, artifactSha256,
    boundaries: { nativeOrPredictionDataRead: false, networkUsed: false, biologicalValidation: false, independentEligibleGroupsAdded: 0 },
  }, "Generator receipt");

  const cases = [];
  for (const name of CASES) {
    const generatedBytes = generatedReportBytes[name];
    const generated = validateImportedSingleAuditReport(parseBytes(generatedBytes, `${name} generated report`));
    const expected = JSON.parse(reference.artifacts[`synthetic-${name}.audit.json`]);
    same(sha(generatedBytes), artifactSha256[`synthetic-${name}.audit.json`], `${name} generated report SHA-256`);
    same(generated, expected, `${name} generated report`);
    const browserBytes = browserReportBytes[name];
    const browser = validateImportedSingleAuditReport(parseBytes(browserBytes, `${name} browser report`));
    // JSON whitespace/key order and export time are irrelevant; every source,
    // role, policy, missingness, diagnostic and measurement field must match.
    const { generatedAt: browserGeneratedAt, ...browserSemantic } = browser;
    const { generatedAt: expectedGeneratedAt, ...expectedSemantic } = expected;
    same(browserSemantic, expectedSemantic, `${name} browser report`);
    cases.push({
      name, coordinateSha256: expected.structure.sourceFileSha256,
      generatedReportSha256: sha(generatedBytes), browserReportSha256: sha(browserBytes),
      browserGeneratedAt, expectedGeneratedAt,
      residuePairs: browser.audit.contactPairCount, atomContacts: browser.audit.atomContactCount,
      productionImportValidation: true, semanticMatchExceptExportTimestamp: true,
      rolesConfirmedInReport: true, paeAbsent: true,
    });
  }
  return {
    schemaVersion: "1.0.0", scope: "synthetic reviewer export comparison only",
    nodeVersion: process.version, generatorReceiptSha256: sha(receiptBytes),
    verifierSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    sourceIdentitiesMatchCurrentCheckout: true, cases,
    boundaries: {
      nativeOrPredictionDataRead: false, networkUsed: false, biologicalValidation: false,
      independentEligibleGroupsAdded: 0, participantIdentityVerified: false,
      independentCompletionEstablished: false, browserRoleGateObserved: false,
    },
  };
}

async function readBounded(filename) {
  const info = await stat(filename);
  if (!info.isFile() || info.size < 1 || info.size > MAX_JSON_BYTES) {
    throw new Error(`Expected a JSON file containing 1–${MAX_JSON_BYTES} bytes: ${filename}`);
  }
  const bytes = await readFile(filename);
  parseBytes(bytes, filename);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      const match = /^--(example|near|separated|output)=(.+)$/.exec(arg);
      if (!match || Object.hasOwn(options, match[1])) throw new Error(USAGE);
      options[match[1]] = path.resolve(match[2]);
    }
    if (!["example", ...CASES].every(key => options[key])) throw new Error(USAGE);
    const receiptBytes = await readBounded(path.join(options.example, "receipt.json"));
    const generatedReportBytes = {};
    const browserReportBytes = {};
    for (const name of CASES) {
      generatedReportBytes[name] = await readBounded(path.join(options.example, `synthetic-${name}.audit.json`));
      browserReportBytes[name] = await readBounded(options[name]);
    }
    const verified = await verifyReviewerExports({ receiptBytes, generatedReportBytes, browserReportBytes });
    const json = `${JSON.stringify(verified, null, 2)}\n`;
    if (options.output) await writeFile(options.output, json, { flag: "wx" });
    process.stdout.write(json);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
