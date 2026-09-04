import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ANNOTATION_QUERIES, buildAnnotationQuery, intersectAnnotationResults, parseAnnotationSearchPage, verifyAnnotationDiscovery } from "../scripts/hard-decoy-v3/capture-annotation-discovery.mjs";
const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/annotation-discovery-2026-09-04");

test("annotation route uses global separate entry queries with source-lineage strings", () => {
  const requests = ANNOTATION_QUERIES.map((definition) => buildAnnotationQuery(definition));
  assert(requests.every((query) => query.return_type === "entry"));
  assert(!JSON.stringify(requests).includes("initial_release_date"));
  const taxonomy = requests[6].query.parameters;
  assert.equal(taxonomy.attribute, "rcsb_entity_source_organism.taxonomy_lineage.id");
  assert.equal(taxonomy.value, "9835");
  assert(!JSON.stringify(requests).includes("host_organism"));
});

test("entry intersection retains camelid controls even when immunoglobulin Pfam annotations are absent", () => {
  const queries = [
    { id: "gpcr-pf00001", group: "gpcr", ids: ["3P0G", "3SN6"] },
    { id: "ig-pf07686", group: "immunoglobulin", ids: ["1A14"] },
    { id: "camelid-lineage-id", group: "camelid", ids: ["3P0G", "3SN6"] },
    { id: "camelid-lineage-name", group: "camelid", ids: ["3P0G", "3SN6"] },
  ];
  const result = intersectAnnotationResults(queries);
  assert.deepEqual(result.intersectionIds, ["3P0G", "3SN6"]);
  assert.deepEqual(result.gpcrIgIds, []);
  assert.equal(result.positiveControl.inImmunoglobulinSet, false);
  assert.equal(result.positiveControl.inCamelidSet, true);
  assert.throws(() => intersectAnnotationResults(queries.map((row) => ({ ...row, ids: [] }))), /positive control was not recovered/);
});

test("search parser rejects unexpected fields and unsorted or repeated entry IDs", () => {
  const response = { query_id: "control", result_type: "entry", total_count: 2, result_set: [{ identifier: "3P0G", score: 1 }, { identifier: "3SN6", score: 1 }] };
  assert.deepEqual(parseAnnotationSearchPage(200, JSON.stringify(response)).ids, ["3P0G", "3SN6"]);
  assert.throws(() => parseAnnotationSearchPage(200, JSON.stringify({ ...response, coordinates: [] })));
  assert.throws(() => parseAnnotationSearchPage(200, JSON.stringify({ ...response, result_set: response.result_set.toReversed() })));
  assert.throws(() => parseAnnotationSearchPage(200, JSON.stringify({ ...response, result_set: [response.result_set[0], response.result_set[0]] })));
  assert.deepEqual(parseAnnotationSearchPage(204, ""), { ids: [], total: 0 });
});

test("archived global annotation discovery replays without promoting annotation hits to eligible components", async () => {
  const result = await verifyAnnotationDiscovery({ repositoryRoot: ROOT, snapshotDirectory: SNAPSHOT });
  assert.equal(result.releaseDateRestriction, null);
  assert.equal(result.repeatedQueryCount, 8);
  assert.equal(result.specifiedQueriesComplete, true);
  assert.equal(result.taxonomyIdNameAgreement, true);
  assert.equal(result.positiveControl.inFinalIntersection, true);
  assert.equal(result.broaderDiscoveryComplete, false);
  assert.equal(result.independentComponentsAdded, 0);
  assert.equal(result.wholeCensusComponentUpperBound, null);
  assert.equal(result.targetFreezeGate, "BLOCKED");
  assert(result.vhhAnnotationSensitivity.some((row) => row.inCombinedIntersection && !row.inImmunoglobulinDomainSet));
});

test("replay rejects extra unplanned snapshot files even when core results are unchanged", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-annotation-"));
  try {
    await cp(SNAPSHOT, temporary, { recursive: true });
    await writeFile(path.join(temporary, "extra-authority.json"), "{}\n");
    await assert.rejects(verifyAnnotationDiscovery({ repositoryRoot: ROOT, snapshotDirectory: temporary }), /Unexpected snapshot files/);
    await rm(path.join(temporary, "extra-authority.json"));
    const file = path.join(temporary, "candidate-status.jsonl");
    const candidates = (await readFile(file, "utf8")).trimEnd().split("\n").map(JSON.parse);
    candidates[0].independentComponentIncrement = 1;
    await writeFile(file, candidates.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await assert.rejects(verifyAnnotationDiscovery({ repositoryRoot: ROOT, snapshotDirectory: temporary }), /Artifact does not reconstruct/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
