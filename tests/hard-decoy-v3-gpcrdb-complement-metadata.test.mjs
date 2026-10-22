import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareGpcrdbComplementMetadata, collectGpcrdbComplementMetadata, verifyGpcrdbComplementMetadata } from "../scripts/hard-decoy-v3/gpcrdb-complement-metadata.mjs";
const ROOT = path.resolve(import.meta.dirname, "..");
const temporary = async () => await mkdtemp(path.join(os.tmpdir(), "confovhh-c2-"));
function entry(id) {
  return { rcsb_id: id, struct: { title: `Synthetic metadata fixture ${id}` }, struct_keywords: { pdbx_keywords: null, text: null },
    exptl: null, rcsb_accession_info: { initial_release_date: "2026-01-01T00:00:00Z" }, rcsb_primary_citation: null,
    rcsb_entry_info: { experimental_method: null, polymer_entity_count: 0, resolution_combined: null }, polymer_entities: [] };
}
function fixtureFetch({ omit = null, disagree = false, stopAfter = Infinity } = {}) {
  let calls = 0;
  const counts = new Map();
  const fetchImpl = async (_url, options) => {
    calls += 1;
    if (calls > stopAfter) throw new Error("simulated interruption");
    const ids = JSON.parse(options.body).variables.ids;
    const key = ids.join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const entries = ids.filter((id) => id !== omit).map(entry).reverse();
    if (disagree && counts.get(key) === 2) entries[0].struct.title += " changed";
    return new Response(JSON.stringify({ data: { entries } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls: () => calls };
}
const collect = (directory, fake) => collectGpcrdbComplementMetadata({ repositoryRoot: ROOT, outputDirectory: directory, fetchImpl: fake.fetchImpl, delay: async () => {} });

test("C.2 plan derives exactly the 1,429-ID complement and binds every request", async () => {
  const directory = await temporary();
  try {
    const result = await prepareGpcrdbComplementMetadata({ repositoryRoot: ROOT, outputDirectory: directory });
    assert.equal(result.requestedEntries, 1429);
    assert.equal(result.requests, 116);
    const plan = JSON.parse(await readFile(path.join(directory, "collection-plan.json")));
    assert.equal(plan.batchCount, 58);
    assert.equal(plan.broaderDiscoveryComplete, false);
    assert.ok(plan.inputDigests["scripts/hard-decoy/v3-entry-metadata.mjs"]);
    const historical = new Set((await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v3/source-snapshot-2026-08-29/normalized/rcsb-gpcrdb-intersection.txt"), "utf8")).trim().split("\n"));
    assert.ok(plan.requests.every((request) => request.requestedIds.every((id) => !historical.has(id))));
    const request = path.join(directory, plan.requests[0].requestFile);
    await writeFile(request, (await readFile(request, "utf8")).replace("3P0G", "9ZZZ") + " ");
    await assert.rejects(collect(directory, fixtureFetch()), /immutable file drifted|request or input binding drifted/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("verified capture checkpoints resume without refetching, while snapshot replay remains non-dispositive", async () => {
  const directory = await temporary();
  try {
    const interrupted = fixtureFetch({ stopAfter: 2 });
    await assert.rejects(collect(directory, interrupted), /simulated interruption/);
    const resumed = fixtureFetch();
    const summary = await collect(directory, resumed);
    assert.equal(resumed.calls(), 114);
    assert.equal(summary.capturedEntryCount, 1429);
    assert.equal(summary.repeatedRawResponseCount, 116);
    assert.equal(summary.discoveryRouteMetadataCaptureComplete, true);
    assert.equal(summary.broaderDiscoveryComplete, false);
    assert.equal(summary.routeC2ScientificDispositionComplete, false);
    assert.equal(summary.formallyClearedGroups, 0);
    assert.equal(summary.wholeCensusComponentUpperBound, null);
    assert.equal(summary.targetFreezeGate, "BLOCKED");
    assert.equal(summary.pendingDispositionRows, 1429);
    assert.deepEqual(await verifyGpcrdbComplementMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), summary);
    const replay = fixtureFetch();
    await collect(directory, replay);
    assert.equal(replay.calls(), 0);
    const target = path.join(directory, "summary.json");
    const tampered = JSON.parse(await readFile(target));
    tampered.broaderDiscoveryComplete = true;
    await writeFile(target, JSON.stringify(tampered));
    await assert.rejects(verifyGpcrdbComplementMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), /does not reconstruct: summary.json/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an omitted entry is preserved in the missing-ID ledger and blocks metadata completeness", async () => {
  const directory = await temporary();
  try {
    await prepareGpcrdbComplementMetadata({ repositoryRoot: ROOT, outputDirectory: directory });
    const plan = JSON.parse(await readFile(path.join(directory, "collection-plan.json")));
    const omit = plan.requests[0].requestedIds[0];
    const summary = await collect(directory, fixtureFetch({ omit }));
    assert.equal(summary.capturedEntryCount, 1428);
    assert.equal(summary.missingEntryCount, 1);
    assert.equal(summary.discoveryRouteMetadataCaptureComplete, false);
    assert.equal(summary.pendingDispositionRows, 1429);
    const missing = JSON.parse((await readFile(path.join(directory, "missing-ids.jsonl"), "utf8")).trim());
    assert.equal(missing.pdbId, omit);
    assert.equal(missing.dispositionStatus, "PENDING_REQUIRED_METADATA");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("semantic repeat disagreement fails closed while retaining raw responses", async () => {
  const directory = await temporary();
  try {
    await assert.rejects(collect(directory, fixtureFetch({ disagree: true })), /repeat disagreement for batch 1/);
    assert.ok((await readFile(path.join(directory, "raw/batch-001-repeat-1.json"))).length > 0);
    assert.ok((await readFile(path.join(directory, "raw/batch-001-repeat-2.json"))).length > 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a transient HTTP failure is archived before retry and included in verification", async () => {
  const directory = await temporary();
  try {
    const normal = fixtureFetch();
    let first = true;
    const retrying = { fetchImpl: async (...args) => {
      if (first) { first = false; return new Response(JSON.stringify({ error: "synthetic temporary failure" }), { status: 503, headers: { "content-type": "application/json" } }); }
      return await normal.fetchImpl(...args);
    } };
    const summary = await collect(directory, retrying);
    assert.equal(summary.capturedEntryCount, 1429);
    assert.equal(normal.calls(), 116);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json")));
    assert.equal(manifest.transientHttpResponses.length, 1);
    assert.equal(manifest.transientHttpResponses[0].status, 503);
    assert.ok((await readFile(path.join(directory, manifest.transientHttpResponses[0].rawFile))).length > 0);
    assert.deepEqual(await verifyGpcrdbComplementMetadata({ repositoryRoot: ROOT, snapshotDirectory: directory }), summary);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
