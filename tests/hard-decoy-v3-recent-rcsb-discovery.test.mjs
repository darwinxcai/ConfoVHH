import assert from "node:assert/strict";
import test from "node:test";
import { buildRecentSearchQuery, deriveRecentRcsbDiscovery, DOMAINS, parseRecentSearchPage, QUERY_DEFINITIONS, verifyRecentRcsbDiscovery } from "../scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs";

test("recent RCSB discovery replays exact archived queries and metadata", async () => {
  const result = await verifyRecentRcsbDiscovery();
  assert.equal(result.discoveryQueryCount, 10);
  assert.equal(result.allRecentPublicGpcrEntriesCovered, false);
  assert.equal(result.exhaustiveGpcrDomainCoverage, false);
  assert.equal(result.formalProtocolStatus, "DRAFT");
  assert.equal(result.targetFreezeGate, "BLOCKED");
});

test("recent date boundaries and experimental content remain in every discovery query", () => {
  for (const definition of QUERY_DEFINITIONS.filter((row) => row.kind.startsWith("recent-"))) {
    const body = buildRecentSearchQuery(definition, 100);
    assert.deepEqual(body.query.nodes.slice(0, 2).map((row) => row.parameters), [
      { attribute: "rcsb_accession_info.initial_release_date", operator: "greater_or_equal", value: "2026-08-30T00:00:00Z" },
      { attribute: "rcsb_accession_info.initial_release_date", operator: "less", value: "2026-09-05T00:00:00Z" },
    ]);
    assert.deepEqual(body.request_options.results_content_type, ["experimental"]);
    assert.deepEqual(body.request_options.paginate, { start: 100, rows: 100 });
  }
});

test("Pfam type and accession share a nested group and controls do not enter the recent route", () => {
  assert.deepEqual(DOMAINS.map((row) => row.accession), ["PF00001", "PF00002", "PF00003", "PF01534"]);
  for (const definition of QUERY_DEFINITIONS.filter((row) => row.kind === "recent-domain")) {
    const annotation = buildRecentSearchQuery(definition).query.nodes[2];
    assert.equal(annotation.logical_operator, "and");
    assert.deepEqual(annotation.nodes.map((row) => row.parameters.value), ["Pfam", definition.domain]);
  }
  for (const definition of QUERY_DEFINITIONS.filter((row) => row.kind === "domain-positive-control")) {
    const body = buildRecentSearchQuery(definition);
    assert.equal(body.query.nodes[0].parameters.attribute, "rcsb_id");
    assert.equal(body.query.nodes[0].parameters.value, definition.pdbId);
  }
});

test("only an empty HTTP 204 is interpreted as a zero-result page", () => {
  assert.deepEqual(parseRecentSearchPage({ status: 204, error: null }, ""), { ids: [], total: 0 });
  assert.throws(() => parseRecentSearchPage({ status: 503, error: "HTTP 503" }, ""), /503/u);
  assert.throws(() => parseRecentSearchPage({ status: 204, error: null }, "{}"));
  assert.throws(() => parseRecentSearchPage({ status: 200, error: null }, '{"query_id":"x","result_type":"entry","total_count":0,"total_count":1,"result_set":[]}'));
});

test("partial pagination preserves observed candidates while blocking completeness", () => {
  const definition = QUERY_DEFINITIONS.find((row) => row.kind === "recent-domain");
  const records = [1, 2].map((repeat) => ({ kind: "search", queryId: definition.id, repeat, start: 0, status: 200, error: null, rawFile: `page-${repeat}` }));
  const payload = JSON.stringify({ query_id: "partial", result_type: "entry", total_count: 2, result_set: [{ identifier: "5UZ7", score: 1 }] });
  const result = deriveRecentRcsbDiscovery({ source: { gpcrdbMap: new Map() }, records, raw: new Map(records.map((record) => [record.rawFile, payload])) });
  assert.equal(result.summary.observedCandidateEntryCount, 1);
  assert.equal(result.summary.unresolvedMetadataEntryCount, 1);
  assert.equal(result.summary.specifiedQueriesComplete, false);
  assert.equal(result.files["normalized/candidate-ids.txt"], "5UZ7\n");
  const route = JSON.parse(result.files["query-results.json"]).find((row) => row.id === definition.id);
  assert.equal(route.status, "UNRESOLVED");
  assert.match(route.repeats[0].error, /Truncated search page/u);
});

test("a control-only match never becomes a newly released candidate", () => {
  const definition = QUERY_DEFINITIONS.find((row) => row.kind === "domain-positive-control");
  const records = [1, 2].map((repeat) => ({ kind: "search", queryId: definition.id, repeat, start: 0, status: 200, error: null, rawFile: `control-${repeat}` }));
  const payload = JSON.stringify({ query_id: "control", result_type: "entry", total_count: 1, result_set: [{ identifier: definition.pdbId, score: 1 }] });
  const result = deriveRecentRcsbDiscovery({ source: { gpcrdbMap: new Map() }, records, raw: new Map(records.map((record) => [record.rawFile, payload])) });
  assert.equal(result.summary.positiveControlsConfirmed, 1);
  assert.equal(result.summary.observedCandidateEntryCount, 0);
  assert.equal(result.files["entries.jsonl"], "");
});
