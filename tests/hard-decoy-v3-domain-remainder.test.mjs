import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareDomainRemainderMetadata, collectDomainRemainderMetadata, verifyDomainRemainderMetadata } from "../scripts/hard-decoy-v3/capture-domain-remainder.mjs";
import { verifyGpcrdbComplementScreen } from "../scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "validation/hard-decoy-holdout-v3";
const KNOWN = ["entry-metadata-snapshot-2026-08-29", "gpcrdb-complement-metadata-2026-09-04", "gpcrdb-complement-replacements-2026-09-04", "rcsb-recent-discovery-2026-09-04", "annotation-discovery-2026-09-04", "annotation-additional-priority-review-2026-09-04/publication-closure"];
const temporary = async () => await mkdtemp(path.join(os.tmpdir(), "confovhh-domain-review-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rows = (bytes) => String(bytes).trimEnd().split("\n").filter(Boolean).map(JSON.parse);
function entry(id) {
  return {
    rcsb_id: id, struct: { title: `Synthetic metadata fixture ${id}` }, struct_keywords: { pdbx_keywords: null, text: null },
    exptl: null, rcsb_accession_info: { initial_release_date: "2026-01-01T00:00:00Z" }, rcsb_primary_citation: null,
    rcsb_entry_info: { experimental_method: null, polymer_entity_count: 1, resolution_combined: null },
    polymer_entities: [{
      rcsb_id: `${id}_1`, entity_poly: { pdbx_seq_one_letter_code_can: "ACDEFGHIKLMNPQRSTVWY", rcsb_entity_polymer_type: "Protein", type: "polypeptide(L)" },
      rcsb_polymer_entity: { pdbx_description: "Uncharacterized protein" },
      rcsb_polymer_entity_container_identifiers: { entity_id: "1", asym_ids: ["A"], auth_asym_ids: ["R"], reference_sequence_identifiers: null },
      rcsb_entity_source_organism: null,
    }],
  };
}
function fixtureFetch({ omit = null, disagree = false, stopAfter = Infinity, invalid = null } = {}) {
  let calls = 0;
  const counts = new Map();
  return {
    calls: () => calls,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls > stopAfter) throw new Error("simulated interruption");
      const ids = JSON.parse(options.body).variables.ids;
      const key = ids.join(",");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const entries = ids.filter((id) => id !== omit).map(entry).reverse();
      if (disagree && counts.get(key) === 2) entries[0].struct.title += " changed";
      if (invalid === "duplicate") entries.push(entries[0]);
      if (invalid === "unrequested") entries.push(entry("0ZZZ"));
      const payload = { data: { entries } };
      if (invalid === "graphql-error") payload.errors = [{ message: "Partial GraphQL failure" }];
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}
const collect = (directory, fake) => collectDomainRemainderMetadata({ repositoryRoot: ROOT, outputDirectory: directory, fetchImpl: fake.fetchImpl, delay: async () => {} });

test("domain remainder is the exact global domain-minus-metadata set, without an antibody predicate", async () => {
  const directory = await temporary();
  try {
    const result = await prepareDomainRemainderMetadata({ repositoryRoot: ROOT, outputDirectory: directory });
    const known = new Set();
    for (const source of KNOWN) for (const row of rows(await readFile(path.join(ROOT, BASE, source, "entries.jsonl")))) known.add(row.pdbId);
    const domain = (await readFile(path.join(ROOT, BASE, "annotation-discovery-2026-09-04/normalized/gpcr-ids.txt"), "utf8")).trimEnd().split("\n");
    const expected = domain.filter((id) => !known.has(id));
    assert.equal(known.size, 1971);
    assert.equal(domain.length, 2477);
    assert.equal(domain.filter((id) => known.has(id)).length, 1785);
    assert.equal(expected.length, 692);
    assert.equal(result.requestedEntries, 692);
    assert.equal(result.requests, 56);
    const identifiers = await readFile(path.join(directory, "identifiers.txt"));
    assert.equal(String(identifiers), `${expected.join("\n")}\n`);
    assert.equal(sha(identifiers), "c538e0919cdc3a2e5a2957e836b82eb846dbd24701a484a02f20c13aca920ca6");
    const plan = JSON.parse(await readFile(path.join(directory, "collection-plan.json")));
    assert.equal(plan.batchCount, 28);
    for (const repeat of [1, 2]) assert.deepEqual(plan.requests.filter((r) => r.repeat === repeat).flatMap((r) => r.requestedIds), expected);
    for (const request of plan.requests) assert.equal(sha(await readFile(path.join(directory, request.requestFile))), request.requestBodySha256);
    for (const source of KNOWN) assert.ok(plan.inputDigests[`${BASE}/${source}/entries.jsonl`]);
    assert.ok(plan.inputDigests["scripts/hard-decoy/v3-entry-metadata.mjs"]);
    await writeFile(path.join(directory, plan.requests[0].requestFile), "{}\n");
    await assert.rejects(collect(directory, fixtureFetch()), /immutable file drifted|request or input binding drifted/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("same-sized replacement of the upstream domain list is rejected by its pinned source digest", async () => {
  const directory = await temporary();
  try {
    const source = `${BASE}/annotation-discovery-2026-09-04/normalized/gpcr-ids.txt`;
    const ids = (await readFile(path.join(ROOT, source), "utf8")).trimEnd().split("\n");
    ids[0] = "0ZZZ";
    assert.equal(new Set(ids).size, 2477);
    await mkdir(path.dirname(path.join(directory, source)), { recursive: true });
    await writeFile(path.join(directory, source), `${ids.sort().join("\n")}\n`);
    await assert.rejects(prepareDomainRemainderMetadata({ repositoryRoot: directory, outputDirectory: path.join(directory, "output") }), /Pinned source input changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("verified checkpoints resume and retain every uncharacterized polymer without borrowed receptor mapping", async () => {
  const directory = await temporary();
  try {
    await assert.rejects(collect(directory, fixtureFetch({ stopAfter: 2 })), /simulated interruption/);
    const resumed = fixtureFetch();
    const summary = await collect(directory, resumed);
    assert.equal(resumed.calls(), 54);
    assert.equal(summary.capturedEntryCount, 692);
    assert.equal(summary.repeatedRawResponseCount, 56);
    assert.equal(summary.pendingDispositionRows, 692);
    assert.equal(summary.broaderDiscoveryComplete, false);
    assert.equal(summary.formallyClearedGroups, 0);
    assert.equal(summary.wholeCensusComponentUpperBound, null);
    assert.equal(summary.targetFreezeGate, "BLOCKED");
    const entries = rows(await readFile(path.join(directory, "entries.jsonl")));
    assert.equal(entries.length, 692);
    for (const row of entries) {
      assert.equal(row.polymerEntities.length, 1);
      assert.equal(row.polymerEntities[0].description, "Uncharacterized protein");
      assert(Object.values(row.gpcrdb).every((value) => value === null));
      assert.deepEqual(row.receptorMapping, { preferredAuthChainEntityIds: [], preferredLabelChainEntityIds: [] });
    }
    const replay = fixtureFetch();
    await collect(directory, replay);
    assert.equal(replay.calls(), 0);
    assert.deepEqual(await verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), summary);
    const changed = { ...summary, broaderDiscoveryComplete: true };
    await writeFile(path.join(directory, "summary.json"), JSON.stringify(changed));
    await assert.rejects(verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), /does not reconstruct: summary.json/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an entry missing from both repeats stays explicit and prevents metadata completeness", async () => {
  const directory = await temporary();
  try {
    await prepareDomainRemainderMetadata({ repositoryRoot: ROOT, outputDirectory: directory });
    const plan = JSON.parse(await readFile(path.join(directory, "collection-plan.json")));
    const omit = plan.requests[0].requestedIds[0];
    const summary = await collect(directory, fixtureFetch({ omit }));
    assert.equal(summary.capturedEntryCount, 691);
    assert.equal(summary.missingEntryCount, 1);
    assert.equal(summary.discoveryRouteMetadataCaptureComplete, false);
    assert.equal(summary.pendingDispositionRows, 692);
    const missing = rows(await readFile(path.join(directory, "missing-ids.jsonl")));
    assert.equal(missing.length, 1);
    assert.equal(missing[0].pdbId, omit);
    assert.equal(missing[0].dispositionStatus, "PENDING_REQUIRED_METADATA");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("repeat disagreement retains both bodies and cannot be resumed as a successful snapshot", async () => {
  const directory = await temporary();
  try {
    await assert.rejects(collect(directory, fixtureFetch({ disagree: true })), /repeat disagreement for batch 1/);
    for (const repeat of [1, 2]) assert.ok((await readFile(path.join(directory, `raw/batch-001-repeat-${repeat}.json`))).length);
    await assert.rejects(verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), /repeat disagreement for batch 1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("duplicate, unrequested, and partial-error GraphQL responses fail closed", async () => {
  for (const invalid of ["duplicate", "unrequested", "graphql-error"]) {
    const directory = await temporary();
    try {
      await assert.rejects(collect(directory, fixtureFetch({ invalid })), /unexpected or duplicate entry|GraphQL.*error|errors/iu);
      const capture = JSON.parse(await readFile(path.join(directory, "captures/batch-001-repeat-1.json")));
      assert.ok(capture.validationError, invalid);
      assert.ok((await readFile(path.join(directory, capture.rawFile))).length);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("transient failures remain auditable across an exhausted attempt and a later resumed retry", async () => {
  const directory = await temporary();
  try {
    let initialCalls = 0;
    await assert.rejects(collect(directory, { fetchImpl: async () => {
      initialCalls += 1;
      return new Response(JSON.stringify({ error: `first run failure ${initialCalls}` }), { status: 503, headers: { "content-type": "application/json" } });
    } }), /after three attempts/);
    assert.equal(initialCalls, 3);
    const normal = fixtureFetch();
    let failedAgain = false;
    const summary = await collect(directory, { fetchImpl: async (...args) => {
      if (!failedAgain) {
        failedAgain = true;
        return new Response(JSON.stringify({ error: "resumed run transient failure" }), { status: 503, headers: { "content-type": "application/json" } });
      }
      return await normal.fetchImpl(...args);
    } });
    assert.equal(summary.capturedEntryCount, 692);
    assert.equal(normal.calls(), 56);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json")));
    assert.equal(manifest.transientHttpResponses.length, 4);
    assert.deepEqual(await verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), summary);
    const captureFile = path.join(directory, "captures/batch-001-repeat-1.json");
    const capture = JSON.parse(await readFile(captureFile));
    capture.requestBodySha256 = "0".repeat(64);
    await writeFile(captureFile, JSON.stringify(capture));
    await assert.rejects(verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), /Capture request binding drifted/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("actual remainder capture and screen replay offline for all 692 entries and 2,424 polymers", { timeout: 120_000 }, async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Actual snapshot replay must not access the network"); });
  const inputDirectory = path.join(ROOT, BASE, "domain-remainder-2026-09-04");
  const outputDirectory = path.join(ROOT, BASE, "domain-remainder-screen-2026-09-04");
  const capture = await verifyDomainRemainderMetadata({ repositoryRoot: ROOT, snapshotDirectory: inputDirectory });
  assert.equal(capture.gpcrDomainEntryCount, 2477);
  assert.equal(capture.knownMetadataUnionEntryCount, 1971);
  assert.equal(capture.domainKnownOverlapEntryCount, 1785);
  assert.equal(capture.requestedEntryCount, 692);
  assert.equal(capture.capturedEntryCount, 692);
  assert.equal(capture.missingEntryCount, 0);
  assert.equal(capture.repeatedRawResponseCount, 56);
  assert.equal(capture.polymerEntityCount, 2424);
  assert.equal(capture.antibodyOrTaxonomyFilterApplied, false);
  assert.equal(capture.inheritedGpcrdbMapping, false);
  assert.equal(capture.discoveryRouteMetadataCaptureComplete, true);
  assert.equal(capture.routeScientificDispositionComplete, false);
  assert.equal(capture.formalProtocolStatus, "DRAFT");
  assert.equal(capture.targetFreezeGate, "BLOCKED");
  assert.equal(capture.formallyClearedGroups, 0);
  assert.equal(capture.wholeCensusComponentUpperBound, null);
  const screen = await verifyGpcrdbComplementScreen({ repositoryRoot: ROOT, inputDirectory, outputDirectory });
  assert.equal(screen.inputEntryCount, 692);
  assert.equal(screen.polymerEntityCount, 2424);
  assert.equal(screen.proteinOrUnknownTypeEntityCount, 2424);
  assert.equal(screen.nonProteinEntityCount, 0);
  assert.equal(screen.distinctPresentSequencesScreened, 673);
  assert.equal(screen.entitiesWithNumberedHeavyDomain, 374);
  assert.equal(screen.entriesWithNumberedHeavyDomain, 345);
  assert.equal(screen.entitiesWithNumberedHeavyDomain + screen.entitiesWithoutConfidentCompleteHeavyDomain, 2424);
  assert.equal(screen.sequenceScreenCoversEveryPresentProteinOrUnknownTypeEntity, true);
  assert.equal(screen.eligibleDirectVhhCount, null);
  assert.equal(screen.independentLeakageComponentCount, null);
  const entries = rows(await readFile(path.join(inputDirectory, "entries.jsonl")));
  const screened = rows(await readFile(path.join(outputDirectory, "entity-screens.jsonl")));
  assert.deepEqual(new Set(screened.map((row) => `${row.pdbId}_${row.entityId}`)), new Set(entries.flatMap((row) => row.polymerEntities.map((entity) => entity.rcsbId))));
  for (const result of [capture, screen]) for (const key of ["broaderDiscoveryComplete", "targetFreezePermitted", "executionAuthorized", "dockqLabelsAccessed", "performanceResultsAccessed"]) assert.equal(result[key], false, key);
  for (const key of ["vhhIdentityEstablished", "directBinderRoleResolved", "formalExclusionAuthority", "formalLeakageGraphAuthority", "formalNoEdgeAuthority", "wholeCensusAuthority", "absenceOfHiddenVhhEstablished", "nativeCoordinatesInspected"]) assert.equal(screen[key], false, key);
});
