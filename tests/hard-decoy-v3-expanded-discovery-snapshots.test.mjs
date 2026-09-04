import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifyGpcrdbComplementMetadata } from "../scripts/hard-decoy-v3/gpcrdb-complement-metadata.mjs";
import { verifyGpcrdbComplementScreen } from "../scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs";
import { verifyRecentGpcrdbDelta } from "../scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs";
import { verifyRecentRcsbDiscovery } from "../scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs";
import { verifyReplacementReconciliation } from "../scripts/hard-decoy-v3/reconcile-replaced-census-entries.mjs";
import { reconstructPublicationDiscovery } from "../scripts/hard-decoy-v3/capture-publication-discovery.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const snapshot = (name) => path.join(ROOT, `validation/hard-decoy-holdout-v3/${name}-2026-09-04`);
const options = (name) => ({ repositoryRoot: ROOT, snapshotDirectory: snapshot(name) });
function offline(t) {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Snapshot replay must not access the network"); });
}
function assertFalseFields(summary, fields) {
  for (const field of fields) assert.equal(summary[field], false, field);
}
function assertBlocked(summary) {
  assert.equal(summary.formalProtocolStatus, "DRAFT");
  assert.equal(summary.targetFreezeGate, "BLOCKED");
  assert.equal(summary.broaderDiscoveryComplete, false);
}

test("the actual 1,429-entry complement capture replays offline with three missing IDs still explicit", { timeout: 120_000 }, async (t) => {
  offline(t);
  const result = await verifyGpcrdbComplementMetadata(options("gpcrdb-complement-metadata"));
  assert.equal(result.frozenGpcrdbEntryCount, 1716);
  assert.equal(result.historicalIntersectionEntryCount, 287);
  assert.equal(result.requestedEntryCount, 1429);
  assert.equal(result.capturedEntryCount, 1426);
  assert.equal(result.missingEntryCount, 3);
  assert.equal(result.capturedEntryCount + result.missingEntryCount, result.requestedEntryCount);
  assert.equal(result.repeatedRawResponseCount, 116);
  assert.equal(result.polymerEntityCount, 4826);
  assert.equal(result.pendingDispositionRows, 1429);
  assert.equal(result.formallyClearedGroups, 0);
  assert.equal(result.wholeCensusComponentUpperBound, null);
  assertFalseFields(result, ["discoveryRouteMetadataCaptureComplete", "routeC2ScientificDispositionComplete", "inventoryFreshnessClaimed", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
  assertBlocked(result);
});

test("both actual sequence-screen packages reconstruct every saved entity and retain non-authority", { timeout: 120_000 }, async (t) => {
  offline(t);
  const complement = await verifyGpcrdbComplementScreen({ repositoryRoot: ROOT, inputDirectory: snapshot("gpcrdb-complement-metadata"), outputDirectory: snapshot("gpcrdb-complement-screen") });
  assert.equal(complement.inputEntryCount, 1426);
  assert.equal(complement.polymerEntityCount, 4826);
  assert.equal(complement.distinctPresentSequencesScreened, 1375);
  assert.equal(complement.entitiesWithNumberedHeavyDomain, 663);
  assert.equal(complement.untaggedUnexposedSequencePositiveEntities, 3);
  const recent = await verifyGpcrdbComplementScreen({ repositoryRoot: ROOT, inputDirectory: snapshot("rcsb-recent-discovery"), outputDirectory: snapshot("rcsb-recent-screen") });
  assert.equal(recent.inputEntryCount, 112);
  assert.equal(recent.polymerEntityCount, 744);
  assert.equal(recent.proteinOrUnknownTypeEntityCount, 705);
  assert.equal(recent.nonProteinEntityCount, 39);
  assert.equal(recent.distinctPresentSequencesScreened, 279);
  assert.equal(recent.entitiesWithNumberedHeavyDomain, 11);
  assert.equal(recent.entriesWithNumberedHeavyDomain, 8);
  for (const result of [complement, recent]) {
    assert.equal(result.proteinOrUnknownTypeEntityCount + result.nonProteinEntityCount, result.polymerEntityCount);
    assert.equal(result.entitiesWithNumberedHeavyDomain + result.entitiesWithoutConfidentCompleteHeavyDomain, result.proteinOrUnknownTypeEntityCount);
    assert.equal(result.eligibleDirectVhhCount, null);
    assert.equal(result.independentLeakageComponentCount, null);
    assertFalseFields(result, ["vhhIdentityEstablished", "directBinderRoleResolved", "formalExclusionAuthority", "formalLeakageGraphAuthority", "formalNoEdgeAuthority", "wholeCensusAuthority", "absenceOfHiddenVhhEstablished", "broaderDiscoveryComplete", "targetFreezePermitted", "executionAuthorized", "nativeCoordinatesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
  }
});

test("actual recent discovery distinguishes an unchanged GPCRdb index from 112 RCSB candidates", { timeout: 120_000 }, async (t) => {
  offline(t);
  const index = await verifyRecentGpcrdbDelta(options("gpcrdb-recent-delta"));
  assert.equal(index.baselineEntryCount, 1716);
  assert.equal(index.currentObservedEntryCount, 1716);
  assert.equal(index.newIndexEntryCount, 0);
  assert.equal(index.observedIndexDeltaCaptureComplete, true);
  assert.equal(index.formalWholeCensusAuthority, false);
  const release = await verifyRecentRcsbDiscovery(options("rcsb-recent-discovery"));
  assert.equal(release.observedCandidateEntryCount, 112);
  assert.equal(release.repeatConfirmedMetadataEntryCount, 112);
  assert.equal(release.unresolvedMetadataEntryCount, 0);
  assert.equal(release.absentFromArchivedGpcrdbCount, 112);
  assert.equal(release.discoveryQueryCount, 10);
  assert.equal(release.repeatConfirmedDiscoveryQueries, 10);
  assert.equal(release.positiveControlsConfirmed, 4);
  assert.equal(release.specifiedQueriesComplete, true);
  assert.equal(release.schemaAndDomainAuthoritiesVerified, true);
  assert.equal(release.exhaustiveGpcrDomainCoverage, false);
  for (const result of [index, release]) {
    assertFalseFields(result, ["allRecentPublicGpcrEntriesCovered", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
    assertBlocked(result);
  }
});

test("actual replacement reconciliation adds one distinct accession rather than counting three aliases as new entries", { timeout: 120_000 }, async (t) => {
  offline(t);
  const result = await verifyReplacementReconciliation(options("gpcrdb-complement-replacements"));
  assert.deepEqual(result.originalMissingAccessions, ["7EVW", "7XOX", "8ZFJ"]);
  assert.deepEqual(result.replacementAccessions, ["8IA7", "8YY8", "9J31"]);
  assert.equal(result.missingAccessionIdentityResolvedCount, 3);
  assert.equal(result.replacementAlreadyCapturedCount, 2);
  assert.deepEqual(result.additionalDistinctMetadataAccessions, ["9J31"]);
  assert.equal(result.additionalDistinctMetadataAccessionCount, 1);
  assert.equal(result.captured1426PlusDistinctReplacements, 1427);
  assert.equal(result.originalMissingEntryCountUnchanged, 3);
  assert.equal(result.scopedMissingIdentityReconciliationComplete, true);
  assert.equal(result.independentComponentsAdded, 0);
  assert.equal(result.wholeCensusComponentUpperBound, null);
  assertFalseFields(result, ["originalMissingLedgerModified", "discoveryRouteMetadataCaptureComplete", "routeC2ScientificDispositionComplete", "targetFreezePermitted", "executionAuthorized", "nativeHoldoutCoordinatesAccessed", "nativeRelativePosesInspected", "dockqLabelsAccessed", "performanceResultsAccessed"]);
  assertBlocked(result);
});

test("actual publication queries reconstruct 24 bibliography records while source extraction stays pending", async (t) => {
  offline(t);
  const directory = snapshot("publication-first-discovery");
  const result = await reconstructPublicationDiscovery(directory);
  assert.deepEqual(result.summary.querySummaries.map((row) => row.resultCount), [13, 0, 1, 0, 10]);
  assert.equal(result.summary.uniquePublicationCount, 24);
  assert.equal(result.summary.selectedSourceQueryPaginationComplete, true);
  assertFalseFields(result.summary, ["primarySourceAccessionExtractionComplete", "targetFreezePermitted", "nativeCoordinatesInspected", "labelsAccessed"]);
  assertBlocked(result.summary);
  for (const [name, expected] of Object.entries(result.files)) assert.equal(await readFile(path.join(directory, name), "utf8"), expected, name);
});
