import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildGlobalTextQuery, collectGlobalTextDiscovery, verifyGlobalTextDiscovery, TEXT_QUERIES, parseGlobalTextPage, parseExternalMetadata } from "../scripts/hard-decoy-v3/capture-global-text-discovery.mjs";
import { restoreGlobalTextArtifacts } from "../scripts/hard-decoy-v3/restore-global-text-artifacts.mjs";
import { verifyGpcrdbComplementScreen } from "../scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs";
const ROOT = path.resolve(import.meta.dirname, "..");
const temporary = () => mkdtemp(path.join(os.tmpdir(), "confovhh-global-text-"));
const read = async (directory, name) => JSON.parse(await readFile(path.join(directory, name), "utf8"));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function entry(id) { return { rcsb_id: id, struct: { title: "Synthetic metadata" }, struct_keywords: { pdbx_keywords: null, text: null }, exptl: null, rcsb_accession_info: { initial_release_date: "2000-01-01T00:00:00Z" }, rcsb_primary_citation: null, rcsb_entry_info: { experimental_method: null, polymer_entity_count: 1, resolution_combined: null }, polymer_entities: [{ rcsb_id: `${id}_1`, entity_poly: { pdbx_seq_one_letter_code_can: "ACDEFGHIKLMNPQRSTVWY", rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)" }, rcsb_polymer_entity: { pdbx_description: "Uncharacterized protein" }, rcsb_polymer_entity_container_identifiers: { entity_id: "1", asym_ids: ["A"], auth_asym_ids: ["A"], reference_sequence_identifiers: null }, rcsb_entity_source_organism: null }] }; }
function fixture({ ids = ["0ZZZ"], failure = null, omit = false, disagree = false, truncate = false, phraseOnly = false, metadataError = null, titleWhitespace = false } = {}) {
  const calls = [], counts = new Map();
  return { calls, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); const key = options.body; counts.set(key, (counts.get(key) ?? 0) + 1); calls.push({ url, body });
    if (failure?.(body, counts.get(key))) return response({ error: "Temporary service failure" }, 503);
    if (url.includes("search.rcsb.org")) { const sourceIds = phraseOnly && body.query.parameters.value.startsWith('"') ? ["0ZZY", "0ZZZ"] : ids; const start = body.request_options.paginate.start; let page = sourceIds.slice(start, start + 500); if (truncate && page.length) page = page.slice(1); if (disagree && counts.get(key) === 2 && page.length) page = ["0ZZY"]; return response({ query_id: "fixture-query", result_type: "entry", total_count: sourceIds.length, result_set: page.map((identifier) => ({ identifier, score: 1 })) }); }
    const entities = omit ? [] : body.variables.ids.map(entry); if (titleWhitespace) entities.forEach((row) => { row.rcsb_primary_citation = { title: "A citation\nwith a line break", pdbx_database_id_PubMed: null, pdbx_database_id_DOI: null }; }); if (metadataError === "duplicate") entities.push(entities[0]); if (metadataError === "unrequested") entities.push(entry("0ZZX")); if (metadataError === "repeat" && counts.get(key) === 2) entities[0].struct.title = "Changed second capture"; const payload = { data: { entries: entities } }; if (metadataError === "graphql") payload.errors = [{ message: "Partial response" }]; return response(payload);
  } };
}
const collect = (directory, fake) => collectGlobalTextDiscovery({ repositoryRoot: ROOT, outputDirectory: directory, fetchImpl: fake.fetchImpl, delay: async () => {} });
const verify = (directory) => verifyGlobalTextDiscovery({ repositoryRoot: ROOT, snapshotDirectory: directory });

test("global text query has no release/domain/antibody/source filters and requires experimental entries", () => {
  for (const definition of TEXT_QUERIES) { const value = buildGlobalTextQuery(definition); assert.deepEqual(value.query, { type: "terminal", service: "full_text", parameters: { value: definition.value } }); assert.deepEqual(value.request_options.results_content_type, ["experimental"]); assert.equal(value.request_options.paginate.rows, 500); }
  assert.throws(() => buildGlobalTextQuery({ id: "post-hoc", value: "receptor" }));
  assert.throws(() => parseGlobalTextPage({ status: 200 }, JSON.stringify({ query_id: "x", result_type: "entry", total_count: 20001, result_set: [] })), /bounded coverage/);
});

test("all seven metadata inventories are bound; uncharacterized polymers and null GPCRdb mappings survive offline replay", async (t) => {
  const directory = await temporary();
  try {
    const fake = fixture(); const summary = await collect(directory, fake);
    assert.equal(summary.knownMetadataUnionEntryCount, 2663); assert.equal(summary.newEntryCount, 1); assert.equal(summary.polymerEntityCount, 1); assert.equal(summary.repeatedSearchResponseCount, 10); assert.equal(summary.repeatedMetadataResponseCount, 2);
    const plan = await read(directory, "discovery-plan.json"); assert.equal(plan.knownMetadataSources.length, 7); const manifest = await read(directory, "manifest.json"); assert.equal(manifest.discoveryPlanSha256, createHash("sha256").update(await readFile(path.join(directory, "discovery-plan.json"))).digest("hex")); assert.equal(manifest.continuationPlanSha256, undefined);
    const entry = JSON.parse((await readFile(path.join(directory, "entries.jsonl"), "utf8")).trim()); assert.equal(entry.polymerEntities[0].description, "Uncharacterized protein"); assert(Object.values(entry.gpcrdb).every((value) => value === null));
    assert.deepEqual(entry.receptorMapping, { preferredAuthChainEntityIds: [], preferredLabelChainEntityIds: [] });
    assert.equal(summary.wholeCensusComponentUpperBound, null); assert.equal(summary.broaderDiscoveryComplete, false); assert.equal(summary.targetFreezeGate, "BLOCKED");
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline only"); }); assert.deepEqual(await verify(directory), summary);
    const resumed = fixture(); assert.deepEqual(await collect(directory, resumed), summary); assert.equal(resumed.calls.length, 0);
    await writeFile(path.join(directory, "unrecorded.txt"), "unexpected"); await assert.rejects(verify(directory), /inventory differs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("full pagination coverage and repeated query agreement are mandatory", async () => {
  for (const mode of ["truncate", "disagree"]) { const directory = await temporary(); try { await assert.rejects(collect(directory, fixture({ [mode]: true })), mode === "truncate" ? /Truncated search page/ : /repeat disagreement/); } finally { await rm(directory, { recursive: true, force: true }); } }
  const directory = await temporary();
  try { const ids = Array.from({ length: 501 }, (_, i) => `0${i.toString(36).toUpperCase().padStart(3, "0")}`).sort(); const summary = await collect(directory, fixture({ ids })); assert.equal(summary.searchUnionEntryCount, 501); assert.equal(summary.repeatedSearchResponseCount, 20); assert.equal(summary.capturedEntryCount, 501); } finally { await rm(directory, { recursive: true, force: true }); }
});

test("resume preserves prior failures under increasing ordinals without repeating successful captures", async () => {
  const directory = await temporary();
  try {
    const target = (body) => body.query?.parameters?.value === "GPCR";
    await assert.rejects(collect(directory, fixture({ failure: target })), /HTTP 503/);
    const fake = fixture({ failure: (body, count) => target(body) && count === 1 }); const summary = await collect(directory, fake);
    assert.equal(summary.failedRequestAttemptCount, 4);
    const manifest = await read(directory, "manifest.json"); assert.equal(manifest.failedRequests.length, 4); assert.deepEqual(manifest.failedRequests.map((row) => row.failureRawFile), [1, 2, 3, 4].map((n) => `failures/text-1-repeat-1-page-001-attempt-${n}-body.json`));
    assert(fake.calls.length < 12); assert.deepEqual(await verify(directory), summary);
    const name = "captures/text-1-repeat-1-page-001.json", capture = await read(directory, name); capture.requestBodySha256 = "0".repeat(64); await writeFile(path.join(directory, name), JSON.stringify(capture)); await assert.rejects(verify(directory), /binding drifted/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing metadata prevents route completeness and changed derived claims fail replay", async () => {
  const directory = await temporary();
  try { const summary = await collect(directory, fixture({ omit: true })); assert.equal(summary.missingEntryCount, 1); assert.equal(summary.selectedMetadataScopeComplete, false); assert.equal(summary.formallyClearedGroups, 0); await writeFile(path.join(directory, "summary.json"), JSON.stringify({ ...summary, broaderDiscoveryComplete: true })); await assert.rejects(verify(directory), /does not reconstruct/); } finally { await rm(directory, { recursive: true, force: true }); }
});


test("phrase-only discoveries remain explicitly pending outside the predeclared metadata scope", async () => {
  const directory = await temporary();
  try { const fake = fixture({ phraseOnly: true }); const summary = await collect(directory, fake); assert.equal(summary.searchUnionEntryCount, 2); assert.equal(summary.newEntryCount, 1); assert.equal(summary.phraseOnlyNewEntriesPendingCount, 1); assert.equal(summary.selectedMetadataScopeComplete, true); assert.equal(summary.allQueryMetadataComplete, false); assert.equal(await readFile(path.join(directory, "phrase-only-pending-identifiers.txt"), "utf8"), "0ZZY\n"); assert(fake.calls.filter((row) => row.body.variables).every((row) => !row.body.variables.ids.includes("0ZZY"))); assert.equal(JSON.parse((await readFile(path.join(directory, "pending-metadata.jsonl"), "utf8")).trim()).status, "NOT_CAPTURED_PENDING"); assert.deepEqual(await verify(directory), summary); } finally { await rm(directory, { recursive: true, force: true }); }
});

test("duplicate, unrequested, partial-error or changed repeated metadata cannot establish capture completeness", async () => {
  for (const metadataError of ["duplicate", "unrequested", "graphql", "repeat"]) { const directory = await temporary(); try { await assert.rejects(collect(directory, fixture({ metadataError }))); } finally { await rm(directory, { recursive: true, force: true }); } }
});


test("external metadata whitespace adapter remains narrow and rejects duplicates before object collapse", () => {
  const payload = { data: { entries: [{ rcsb_id: "0ZZZ", rcsb_primary_citation: { title: "Title\nwith\twhitespace\rand literal \\n" } }] } };
  const result = parseExternalMetadata(JSON.stringify(payload)); assert.equal(result.normalized.data.entries[0].rcsb_primary_citation.title, "Title with whitespace and literal \\n"); assert.equal(result.adjustments[0].replacedControlCount, 3);
  const duplicate = '{"data":{"entries":[{"rcsb_id":"0ZZZ","rcsb_primary_citation":{"title":"A\\nB","title":"duplicate"}}]}}'; assert.throws(() => parseExternalMetadata(duplicate), /duplicate object key/);
  for (const [field, value] of [["rcsb_id", "0ZZZ\n"], ["sequence", "AAA\nAAA"], ["other", "\tbad"]]) { const row = { rcsb_id: "0ZZZ", [field]: value }; assert.throws(() => parseExternalMetadata(JSON.stringify({ data: { entries: [row] } })), /outside citation title/); }
  for (const title of ["Bidi\u202e", "Bell\u0007", "Nul\u0000"]) assert.throws(() => parseExternalMetadata(JSON.stringify({ data: { entries: [{ rcsb_id: "0ZZZ", rcsb_primary_citation: { title } }] } })));
  assert.throws(() => parseExternalMetadata('{"data":{"entries":[],"bad\\nkey":1}}'), /object key/);
  assert.throws(() => parseExternalMetadata('{"data":{"entries":[],"value":-0}}'), /negative-zero/);
});

test("normalized citation-title whitespace is digest-recorded and replays without changing scientific sequences", async () => {
  const directory = await temporary();
  try { const summary = await collect(directory, fixture({ titleWhitespace: true })); assert.equal(summary.citationTitlesWithEscapedWhitespaceNormalized, 1); assert.equal(JSON.parse((await readFile(path.join(directory, "citation-title-normalization.jsonl"), "utf8")).trim()).pdbId, "0ZZZ"); assert.deepEqual(await verify(directory), summary); } finally { await rm(directory, { recursive: true, force: true }); }
});


test("actual all-date metadata and complete polymer screen replay offline with separate source epochs", { timeout: 120_000 }, async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Actual evidence replay must stay offline"); });
  const base = path.join(ROOT, "validation/hard-decoy-holdout-v3"); const inputDirectory = path.join(base, "global-text-discovery-2026-09-04"); const outputDirectory = path.join(base, "global-text-screen-2026-09-04");
  await restoreGlobalTextArtifacts({ repositoryRoot: ROOT });
  const summary = await verify(inputDirectory);
  assert.equal(summary.searchUnionEntryCount, 17733); assert.equal(summary.selectedThreeTermEntryCount, 5461); assert.equal(summary.knownMetadataUnionEntryCount, 2663); assert.equal(summary.selectedThreeTermOverlapEntryCount, 2550); assert.equal(summary.capturedEntryCount, 2911); assert.equal(summary.missingEntryCount, 0); assert.equal(summary.polymerEntityCount, 20398); assert.equal(summary.phraseOnlyNewEntriesPendingCount, 12262); assert.equal(summary.repeatedSearchResponseCount, 164); assert.equal(summary.repeatedMetadataResponseCount, 234); assert.equal(summary.citationTitlesWithEscapedWhitespaceNormalized, 10); assert.equal(summary.failedRequestAttemptCount, 3); assert.equal(summary.selectedMetadataScopeComplete, true); assert.equal(summary.allQueryMetadataComplete, false);
  const manifest = await read(inputDirectory, "manifest.json"); const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(manifest.discoveryPlanSha256, sha(await readFile(path.join(inputDirectory, "discovery-plan.json")))); assert.equal(manifest.continuationPlanSha256, sha(await readFile(path.join(inputDirectory, "continuation-plan.json")))); assert.notEqual(manifest.discoveryPlanSha256, manifest.continuationPlanSha256);
  const finalizer = await read(inputDirectory, "provenance/finalization-code.json"); assert.equal(finalizer.adaptedCaptureScriptSha256, sha(await readFile(path.join(inputDirectory, "provenance/capture-generator-corrected.mjs")))); assert.equal(finalizer.finalizerScriptSha256, sha(await readFile(path.join(ROOT, "scripts/hard-decoy-v3/capture-global-text-discovery.mjs"))));
  const screen = await verifyGpcrdbComplementScreen({ repositoryRoot: ROOT, inputDirectory, outputDirectory });
  assert.equal(screen.inputEntryCount, 2911); assert.equal(screen.polymerEntityCount, 20398); assert.equal(screen.proteinOrUnknownTypeEntityCount, 19365); assert.equal(screen.nonProteinEntityCount, 1033); assert.equal(screen.distinctPresentSequencesScreened, 3787); assert.equal(screen.entitiesWithNumberedHeavyDomain, 170); assert.equal(screen.entriesWithNumberedHeavyDomain, 155); assert.equal(screen.sequenceScreenCoversEveryPresentProteinOrUnknownTypeEntity, true); assert.equal(screen.eligibleDirectVhhCount, null); assert.equal(screen.independentLeakageComponentCount, null);
  for (const result of [summary, screen]) for (const key of ["broaderDiscoveryComplete", "targetFreezePermitted", "executionAuthorized", "dockqLabelsAccessed", "performanceResultsAccessed"]) assert.equal(result[key], false);
  const entries = (await readFile(path.join(inputDirectory, "entries.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse); const screened = (await readFile(path.join(outputDirectory, "entity-screens.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse); assert.deepEqual(new Set(screened.map((row) => `${row.pdbId}_${row.entityId}`)), new Set(entries.flatMap((row) => row.polymerEntities.map((entity) => entity.rcsbId))));
});
