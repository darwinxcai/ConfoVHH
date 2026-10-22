import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, deriveTriage, parseGraphqlResponse } from "../hard-decoy/v3-entry-metadata.mjs";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const CENSUS = `${BASE}/gpcrdb-complement-metadata-2026-09-04`;
const FROZEN = `${BASE}/source-snapshot-2026-08-29`;
const CONTRACT = `${BASE}/entry-metadata-draft/entry-metadata-contract.json`;
const PAIRS = { "7EVW": "8YY8", "7XOX": "8IA7", "8ZFJ": "9J31" };
const LIMIT = 16 * 1024 * 1024;
const ok = (value, message) => { if (!value) throw new Error(message); };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (values) => values.length ? `${values.map(canonical).join("\n")}\n` : "";
const parse = (value) => parseStrictJson(String(value), { maximumCharacters: LIMIT, maximumTokens: 500_000, maximumDepth: 64 });
const rows = (value) => String(value).trimEnd().split("\n").filter(Boolean).map(parse);
const same = (a, b) => canonical(a) === canonical(b);
async function exists(filename) { try { await lstat(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function read(filename) {
  const info = await lstat(filename);
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= LIMIT, `Expected bounded direct regular file: ${filename}`);
  return await readFile(filename);
}
async function immutable(directory, name, value) {
  const filename = path.join(directory, name);
  await mkdir(path.dirname(filename), { recursive: true });
  if (await exists(filename)) ok((await read(filename)).equals(Buffer.from(value)), `Immutable reconciliation file drifted: ${name}`);
  else await writeFile(filename, value, { flag: "wx" });
}
async function context(repositoryRoot) {
  const root = path.resolve(repositoryRoot), inputDigests = {};
  const input = async (relative) => { const value = await read(path.join(root, relative)); inputDigests[relative] = sha(value); return value; };
  const frozenChecksums = await input(`${FROZEN}/checksums.sha256`);
  ok(sha(frozenChecksums) === "796aa0734da86791f8ccdef92c7de03da22bdafd7818a5c5e95d73b6b5d35ebc", "Frozen source checksum manifest changed.");
  const censusChecksums = await input(`${CENSUS}/checksums.sha256`);
  async function covered(directory, checksum, relative) {
    const name = `${directory}/${relative}`, bytes = await input(name);
    const matches = String(checksum).trimEnd().split("\n").filter((line) => line.endsWith(`  ${relative}`));
    ok(matches.length === 1 && matches[0] === `${sha(bytes)}  ${relative}`, `Source checksum mismatch: ${name}`);
    return bytes;
  }
  const frozenIds = new Set(String(await covered(FROZEN, frozenChecksums, "normalized/gpcrdb-api.txt")).trimEnd().split("\n"));
  const historicalIds = new Set(String(await covered(FROZEN, frozenChecksums, "normalized/rcsb-gpcrdb-intersection.txt")).trimEnd().split("\n"));
  const gpcrdb = parse(await covered(FROZEN, frozenChecksums, "raw/gpcrdb-api-1.json"));
  const current = rows(await covered(CENSUS, censusChecksums, "entries.jsonl"));
  const missing = rows(await covered(CENSUS, censusChecksums, "missing-ids.jsonl"));
  const censusSummary = parse(await covered(CENSUS, censusChecksums, "summary.json"));
  await covered(CENSUS, censusChecksums, "manifest.json");
  const currentIds = new Set(current.map((entry) => entry.pdbId));
  ok(frozenIds.size === 1716 && historicalIds.size === 287 && current.length === 1426 && currentIds.size === 1426, "Bound source inventory counts drifted.");
  ok(same(missing.map((entry) => entry.pdbId), Object.keys(PAIRS)) && missing.every((row) => row.dispositionStatus === "PENDING_REQUIRED_METADATA"), "Reconciliation is limited to the three observed missing accessions.");
  ok(censusSummary.missingEntryCount === 3 && censusSummary.capturedEntryCount === 1426 && censusSummary.broaderDiscoveryComplete === false, "Current census summary drifted.");
  const contract = parse(await input(CONTRACT));
  const queryBytes = await input(contract.rcsb.queryFile);
  ok(sha(queryBytes) === contract.rcsb.querySha256 && contract.rcsb.endpoint === "https://data.rcsb.org/graphql", "Frozen metadata query changed.");
  await input("scripts/hard-decoy/v3-entry-metadata.mjs");
  await input("scripts/hard-decoy/oracle/canonical-json.mjs");
  inputDigests["scripts/hard-decoy-v3/reconcile-replaced-census-entries.mjs"] = sha(await read(HERE));
  const replacementIds = [...new Set(Object.values(PAIRS))].sort();
  const gpcrdbMap = new Map();
  for (const id of replacementIds) {
    const matches = gpcrdb.filter((row) => row.pdb_code?.toUpperCase() === id);
    ok(matches.length <= 1, `Duplicate GPCRdb row for replacement ${id}`);
    gpcrdbMap.set(id, matches[0] ?? { pdb_code: id, preferred_chain: null });
  }
  const query = String(queryBytes);
  const graphqlUrl = `${contract.rcsb.endpoint}?query=${encodeURIComponent(query)}&variables=${encodeURIComponent(JSON.stringify({ ids: replacementIds }))}`;
  const requests = [];
  for (const originalId of Object.keys(PAIRS)) for (let repeat = 1; repeat <= 2; repeat += 1) {
    const stem = `holdings-${originalId}-repeat-${repeat}`;
    requests.push({ kind: "holdings", originalId, repeat, method: "GET", url: `https://data.rcsb.org/rest/v1/holdings/status/${originalId}`, rawFile: `raw/${stem}.json`, captureFile: `captures/${stem}.json` });
  }
  for (let repeat = 1; repeat <= 2; repeat += 1) requests.push({ kind: "replacement-metadata", replacementIds, repeat, method: "GET", url: graphqlUrl, rawFile: `raw/replacement-metadata-repeat-${repeat}.json`, captureFile: `captures/replacement-metadata-repeat-${repeat}.json` });
  const plan = { schemaVersion: "1.0.0", studyId: "confovhh-hard-decoy-holdout-v3", purpose: "RECONCILE_THREE_OBSERVED_MISSING_ACCESSIONS_ONLY", observedPairsToVerify: PAIRS, replacementIds, inputDigests, querySha256: sha(queryBytes), requests,
    originalMissingLedgerModified: false, obsoletePreferredChainInherited: false, broaderDiscoveryComplete: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED" };
  return { root, current, currentIds, frozenIds, historicalIds, gpcrdbMap, replacementIds, contract, plan };
}
function validateStatus(payload, request) {
  const data = parse(payload);
  ok(same(Object.keys(data).sort(), ["rcsb_id", "rcsb_repository_holdings_combined", "rcsb_repository_holdings_combined_entry_container_identifiers"]), "Holdings response has unexpected fields.");
  const holdings = data.rcsb_repository_holdings_combined, ids = data.rcsb_repository_holdings_combined_entry_container_identifiers;
  ok(same(Object.keys(holdings).sort(), ["id_code_replaced_by_latest", "status", "status_code"]) && same(Object.keys(ids).sort(), ["entry_id", "rcsb_id", "update_id"]), "Holdings response schema drifted.");
  ok(data.rcsb_id === request.originalId && ids.entry_id === request.originalId && ids.rcsb_id === request.originalId, "Holdings identifier mismatch.");
  ok(holdings.status === "REMOVED" && holdings.status_code === "OBS" && holdings.id_code_replaced_by_latest === PAIRS[request.originalId], `Observed replacement changed for ${request.originalId}; review before extending this reconciliation.`);
  ok(typeof ids.update_id === "string" && /^\d{4}_\d{2}$/u.test(ids.update_id), "Holdings update ID invalid.");
  return { originalId: request.originalId, replacementId: holdings.id_code_replaced_by_latest, status: holdings.status, statusCode: holdings.status_code, updateId: ids.update_id };
}
function normalizeMetadata(payload, ctx) {
  const text = String(payload);
  ok(!/(?:^|[\r\n"'])[ \t]*(?:ATOM {2}|HETATM).{20,}|_atom_site\.(?:group_PDB|Cartn_[xyz])/imu.test(text), "Coordinate payload forbidden.");
  ok(!/\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)/iu.test(text), "Holdout labels forbidden.");
  const sourceMap = new Map(ctx.replacementIds.map((pdbId) => [pdbId, { pdbId, rcsbQueryIds: ["C.2_RCSB_HOLDINGS_REPLACEMENT_RECONCILIATION"] }]));
  const entries = parseGraphqlResponse(text, { batchIndex: 1, ids: ctx.replacementIds }, sourceMap, ctx.gpcrdbMap, ctx.contract);
  return entries.map((entry) => ({ ...entry, replacementReceptorMappingAuthority: ctx.frozenIds.has(entry.pdbId) ? "FROZEN_GPCRDB_METADATA_FOR_REPLACEMENT_ID" : "NONE_NO_REPLACEMENT_GPCRDB_ROW", obsoletePreferredChainInherited: false }));
}
async function outputDirectory(ctx, directory, create) {
  const output = path.resolve(directory);
  ok(![ctx.root, path.join(ctx.root, BASE), path.join(ctx.root, CENSUS), path.join(ctx.root, FROZEN)].includes(output), "Use an isolated new reconciliation output directory.");
  if (create) await mkdir(output, { recursive: true });
  const info = await lstat(output);
  ok(info.isDirectory() && !info.isSymbolicLink(), "Output must be a direct directory.");
  return output;
}
async function readCapture(ctx, output, request) {
  const metadata = parse(await read(path.join(output, request.captureFile)));
  const bytes = await read(path.join(output, request.rawFile));
  ok(same(metadata.request, request) && metadata.finalUrl === request.url && metadata.httpStatus === 200 && metadata.rawSha256 === sha(bytes) && metadata.responseBytes === bytes.length, `Capture provenance mismatch: ${request.rawFile}`);
  ok(String(metadata.contentType).split(";")[0].trim().toLowerCase() === "application/json", `Capture media type mismatch: ${request.rawFile}`);
  ok(Number.isFinite(Date.parse(metadata.startedUtc)) && Number.isFinite(Date.parse(metadata.completedUtc)) && Date.parse(metadata.completedUtc) >= Date.parse(metadata.startedUtc), "Capture timestamp invalid.");
  const normalized = request.kind === "holdings" ? validateStatus(bytes, request) : normalizeMetadata(bytes, ctx);
  ok(metadata.normalizedSha256 === sha(canonical(normalized)), `Capture semantic digest mismatch: ${request.rawFile}`);
  return { metadata, normalized };
}
async function capture(ctx, output, request, fetchImpl, now) {
  if (await exists(path.join(output, request.captureFile))) return await readCapture(ctx, output, request);
  ok(!await exists(path.join(output, request.rawFile)), "Unfinished raw response is retained; cannot silently replace it.");
  const startedUtc = now();
  const response = await fetchImpl(request.url, { headers: { accept: "application/json", "user-agent": ctx.contract.rcsb.userAgent }, redirect: "error", signal: AbortSignal.timeout(60000) });
  ok(response.redirected !== true && (!response.url || response.url === request.url), "Response escaped the exact public metadata endpoint.");
  const reader = response.body?.getReader();
  ok(reader, "Metadata response body missing.");
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; ok(size <= LIMIT, "Metadata response exceeds size cap."); chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks);
  await immutable(output, request.rawFile, bytes);
  const metadata = { request, finalUrl: response.url || request.url, httpStatus: response.status, contentType: response.headers.get("content-type"), startedUtc, completedUtc: now(), responseBytes: bytes.length, rawSha256: sha(bytes), etag: response.headers.get("etag") };
  try {
    ok(response.status === 200 && String(metadata.contentType).split(";")[0].trim().toLowerCase() === "application/json", `Metadata response failed: HTTP ${response.status}`);
    const normalized = request.kind === "holdings" ? validateStatus(bytes, request) : normalizeMetadata(bytes, ctx);
    metadata.normalizedSha256 = sha(canonical(normalized));
  } catch (error) { metadata.validationError = error.message; await immutable(output, request.captureFile, json(metadata)); throw error; }
  await immutable(output, request.captureFile, json(metadata));
  return await readCapture(ctx, output, request);
}
async function derive(ctx, output) {
  const statuses = [], requests = [];
  for (const originalId of Object.keys(PAIRS)) {
    const repeats = [];
    for (const request of ctx.plan.requests.filter((r) => r.originalId === originalId)) {
      const result = await readCapture(ctx, output, request); requests.push(result.metadata); repeats.push(result.normalized);
    }
    ok(same(repeats[0], repeats[1]), `Holdings repeat disagreement: ${originalId}`);
    statuses.push(repeats[0]);
  }
  const metadataRepeats = [];
  for (const request of ctx.plan.requests.filter((r) => r.kind === "replacement-metadata")) {
    const result = await readCapture(ctx, output, request); requests.push(result.metadata); metadataRepeats.push(result.normalized);
  }
  ok(same(metadataRepeats[0], metadataRepeats[1]), "Replacement metadata semantic repeat disagreement.");
  const entries = metadataRepeats[0];
  const aliases = statuses.map((row) => ({ ...row, sourceAuthority: "RCSB_HOLDINGS_STATUS_TWO_MATCHING_CAPTURES", originalInFrozenGpcrdb: ctx.frozenIds.has(row.originalId), replacementInFrozenGpcrdb: ctx.frozenIds.has(row.replacementId), replacementInHistorical287: ctx.historicalIds.has(row.replacementId), replacementAlreadyInCaptured1426: ctx.currentIds.has(row.replacementId), uniqueAccessionIncrementRelativeToCaptured1426: ctx.currentIds.has(row.replacementId) ? 0 : 1,
    originalMissingLedgerPreserved: true, replacementIsSilentlyEligible: false, receptorChainMappingInheritedFromOriginal: false, formalDisposition: "PENDING_REQUIRED_METADATA", independentComponentIncrement: null }));
  const newIds = ctx.replacementIds.filter((id) => !ctx.currentIds.has(id) && !ctx.historicalIds.has(id));
  const summary = { schemaVersion: "1.0.0", status: "THREE_MISSING_ACCESSION_IDENTITIES_RECONCILED_SCIENTIFIC_REVIEW_PENDING", originalMissingAccessions: Object.keys(PAIRS), replacementAccessions: ctx.replacementIds, matchedHoldingsRepeats: 6, matchedMetadataRepeats: 2, missingAccessionIdentityResolvedCount: 3, replacementAlreadyCapturedCount: aliases.filter((a) => a.replacementAlreadyInCaptured1426).length, additionalDistinctMetadataAccessions: newIds, additionalDistinctMetadataAccessionCount: newIds.length, captured1426PlusDistinctReplacements: new Set([...ctx.currentIds, ...ctx.replacementIds]).size,
    originalMissingEntryCountUnchanged: 3, originalMissingLedgerModified: false, discoveryRouteMetadataCaptureComplete: false, scopedMissingIdentityReconciliationComplete: true, routeC2ScientificDispositionComplete: false, broaderDiscoveryComplete: false, formalProtocolStatus: "DRAFT", targetFreezeGate: "BLOCKED", independentComponentsAdded: 0, wholeCensusComponentUpperBound: null,
    targetFreezePermitted: false, executionAuthorized: false, nativeHoldoutCoordinatesAccessed: false, nativeRelativePosesInspected: false, dockqLabelsAccessed: false, performanceResultsAccessed: false };
  const files = new Map([["aliases.jsonl", jsonl(aliases)], ["entries.jsonl", jsonl(entries)], ["triage-signals.jsonl", jsonl(entries.map((entry) => deriveTriage(entry, ctx.contract)))], ["requests.jsonl", jsonl(requests)], ["summary.json", json(summary)],
    ["README.md", `# Reconciliation of three removed census accessions\n\nRCSB holdings status and replacement metadata were each retrieved twice. The verified links are 7EVW → 8YY8, 7XOX → 8IA7, and 8ZFJ → 9J31. The original missing-ID ledger remains unchanged.\n\n8YY8 and 8IA7 already appear in the captured 1,426 entries. Only 9J31 adds a distinct metadata accession; the union therefore has 1,427 distinct accessions. This is accession bookkeeping, not independent-component counting.\n\nReplacement metadata is normalized from its own responses. A frozen GPCRdb row is used only when it belongs to that replacement ID. The original accession's receptor chain is never inherited. For 9J31, receptor-chain assignment remains unresolved.\n\nThis package resolves the identities of three observed missing accessions. It does not complete the broader census, adjudicate direct VHH binding, certify independence, alter the target set, or authorize any freeze or execution. The protocol remains DRAFT/BLOCKED.\n`]]);
  files.set("manifest.json", json({ schemaVersion: "1.0.0", studyId: ctx.plan.studyId, collectionPlanSha256: sha(json(ctx.plan)), inputDigests: ctx.plan.inputDigests, outputDigests: Object.fromEntries([...files].map(([name, value]) => [name, sha(value)])), summary }));
  return { files, summary };
}
async function inventory(output, prefix = "") {
  const result = [];
  for (const item of await readdir(path.join(output, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    ok(!item.isSymbolicLink(), "Reconciliation contains a symlink.");
    if (item.isDirectory()) result.push(...await inventory(output, relative));
    else { ok(item.isFile(), "Reconciliation contains a nonregular file."); result.push(relative); }
  }
  return result.sort();
}
async function checksums(output, files) {
  const lines = [];
  for (const file of files.filter((f) => f !== "checksums.sha256").sort()) lines.push(`${sha(await read(path.join(output, file)))}  ${file}`);
  return `${lines.join("\n")}\n`;
}
export async function collectReplacementReconciliation({ repositoryRoot = ROOT, outputDirectory, fetchImpl = fetch, now = () => new Date().toISOString(), onProgress = () => {} }) {
  const ctx = await context(repositoryRoot), output = await outputDirectoryFor(ctx, outputDirectory, true);
  const existing = await readdir(output);
  ok(existing.length === 0 || existing.includes("collection-plan.json"), "Refusing nonempty unrelated output directory.");
  await immutable(output, "collection-plan.json", json(ctx.plan));
  for (const [index, request] of ctx.plan.requests.entries()) { await capture(ctx, output, request, fetchImpl, now); onProgress({ completed: index + 1, total: ctx.plan.requests.length }); }
  const result = await derive(ctx, output);
  for (const [name, value] of result.files) await immutable(output, name, value);
  await immutable(output, "checksums.sha256", await checksums(output, await inventory(output)));
  return await verifyReplacementReconciliation({ repositoryRoot, snapshotDirectory: output });
}
const outputDirectoryFor = outputDirectory;
export async function verifyReplacementReconciliation({ repositoryRoot = ROOT, snapshotDirectory }) {
  const ctx = await context(repositoryRoot), output = await outputDirectoryFor(ctx, snapshotDirectory, false);
  ok((await read(path.join(output, "collection-plan.json"))).toString() === json(ctx.plan), "Collection plan input/request bindings drifted.");
  const result = await derive(ctx, output);
  for (const [name, value] of result.files) ok((await read(path.join(output, name))).toString() === value, `Reconciliation artifact does not reconstruct: ${name}`);
  const expected = ["collection-plan.json", ...ctx.plan.requests.flatMap((r) => [r.rawFile, r.captureFile]), ...result.files.keys(), "checksums.sha256"].sort();
  ok(same(await inventory(output), expected), "Reconciliation file inventory drifted.");
  ok((await read(path.join(output, "checksums.sha256"))).toString() === await checksums(output, expected), "Reconciliation checksum replay failed.");
  return result.summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const [command, directory, root = ROOT] = process.argv.slice(2);
  try {
    ok(["collect", "verify"].includes(command) && directory, "Usage: reconcile-replaced-census-entries.mjs collect|verify <directory> [repository-root]");
    const result = command === "collect" ? await collectReplacementReconciliation({ repositoryRoot: path.resolve(root), outputDirectory: path.resolve(directory), onProgress: (p) => console.error(`Replacement captures ${p.completed}/${p.total}`) }) : await verifyReplacementReconciliation({ repositoryRoot: path.resolve(root), snapshotDirectory: path.resolve(directory) });
    console.log(json(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
