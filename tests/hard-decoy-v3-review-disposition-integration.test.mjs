import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyReviewDispositionIntegration } from "../scripts/hard-decoy-v3/integrate-review-dispositions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = path.join(ROOT, "validation/hard-decoy-holdout-v3/review-disposition-integration-2026-09-07");
const parseJsonl = text => text.trimEnd().split("\n").map(line => JSON.parse(line));

test("the review overlay integrates current contract dispositions without opening the freeze", async () => {
  assert.deepEqual(await verifyReviewDispositionIntegration(ROOT), {
    verified: true,
    contractDispositionEntryCount: 66,
    historicalPendingRowsWithContractDispositionOverlay: 19,
    historicalRowsRemainingPendingIfOverlayApplied: 253,
    normalizationBacklogEntryCount: 6,
    entityOnlyAdjudicationCount: 6,
    conflictingEntryCount: 0,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  });
});

test("every integrated entry has one frozen contract code and no conflicting source review", async () => {
  const contract = JSON.parse(await readFile(path.join(ROOT, "validation/hard-decoy-holdout-v3/prelabel-census-draft/disposition-contract.json"), "utf8"));
  const rows = parseJsonl(await readFile(path.join(PACKAGE, "contract-dispositions.jsonl"), "utf8"));
  assert.equal(rows.length, 66);
  assert.equal(new Set(rows.map(row => row.pdbId)).size, rows.length);
  assert.ok(rows.every(row => Object.hasOwn(contract.dispositionCodes, row.dispositionCode)));
  assert.ok(rows.every(row => row.dispositionCode !== "PENDING_REQUIRED_METADATA"));
  assert.ok(rows.every(row => row.masterDispositionLedgerRewritten === false));
  assert.ok(rows.every(row => row.formalLeakageGraphAuthority === false && row.targetFreezePermitted === false));
  const corroborated = rows.filter(row => row.corroborationCount > 1);
  assert.deepEqual(corroborated.map(row => row.pdbId), ["8JRU", "8JRV"]);
  assert.ok(corroborated.every(row => new Set(row.dispositionSources.map(source => source.normalizedDisposition)).size === 1));
});

test("legacy normalization is explicit and unresolved component-collapse codes remain pending", async () => {
  const normalized = parseJsonl(await readFile(path.join(PACKAGE, "legacy-code-normalizations.jsonl"), "utf8"));
  const backlog = parseJsonl(await readFile(path.join(PACKAGE, "normalization-backlog.jsonl"), "utf8"));
  assert.equal(normalized.length, 16);
  assert.ok(normalized.every(row => row.sourceDisposition !== row.normalizedContractDisposition));
  assert.deepEqual(backlog.map(row => row.pdbId), ["8XT9", "8XUM", "9KGK", "9S38", "9VOS", "9W3K"]);
  assert.ok(backlog.every(row => row.normalizedContractDisposition === null));
});

test("candidate-entity exclusions cannot silently become whole-entry dispositions", async () => {
  const rows = parseJsonl(await readFile(path.join(PACKAGE, "entity-only-adjudications.jsonl"), "utf8"));
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.entityDisposition === "EXCLUDE_CANDIDATE_ENTITY_AUXILIARY_BINDER"));
  assert.ok(rows.every(row => row.entryExclusionAuthority === false));
  assert.ok(rows.every(row => row.excludedFromWholeEntryLedger === true));
  const contractRows = parseJsonl(await readFile(path.join(PACKAGE, "contract-dispositions.jsonl"), "utf8"));
  const contractIds = new Set(contractRows.map(row => row.pdbId));
  assert.ok(rows.every(row => !contractIds.has(row.pdbId)));
});

test("output mutation cannot grant count, graph or freeze authority", async () => {
  const name = "summary.json";
  const summary = JSON.parse(await readFile(path.join(PACKAGE, name), "utf8"));
  summary.formallyClearedIndependentComponentCount = 1;
  summary.formalLeakageGraphComplete = true;
  summary.targetFreezePermitted = true;
  await assert.rejects(
    verifyReviewDispositionIntegration(ROOT, new Map([[name, `${JSON.stringify(summary, null, 2)}\n`]])),
    /differs from deterministic evidence integration/u,
  );
});
