import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyReplacementReconciliation } from "../scripts/hard-decoy-v3/reconcile-replaced-census-entries.mjs";
const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "validation/hard-decoy-holdout-v3/gpcrdb-complement-replacements-2026-09-04");

test("removed-accession reconciliation replays all eight public metadata captures without double-counting replacements", async () => {
  const result = await verifyReplacementReconciliation({ repositoryRoot: ROOT, snapshotDirectory: SNAPSHOT });
  assert.equal(result.missingAccessionIdentityResolvedCount, 3);
  assert.equal(result.matchedHoldingsRepeats, 6);
  assert.equal(result.matchedMetadataRepeats, 2);
  assert.equal(result.replacementAlreadyCapturedCount, 2);
  assert.deepEqual(result.additionalDistinctMetadataAccessions, ["9J31"]);
  assert.equal(result.captured1426PlusDistinctReplacements, 1427);
  assert.equal(result.originalMissingEntryCountUnchanged, 3);
  assert.equal(result.originalMissingLedgerModified, false);
  assert.equal(result.broaderDiscoveryComplete, false);
  assert.equal(result.independentComponentsAdded, 0);
  assert.equal(result.wholeCensusComponentUpperBound, null);
});

test("replacement9J31 does not inherit the obsolete entry's preferred receptor chain", async () => {
  const entries = (await readFile(path.join(SNAPSHOT, "entries.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
  const newEntry = entries.find((entry) => entry.pdbId === "9J31");
  assert.equal(newEntry.replacementReceptorMappingAuthority, "NONE_NO_REPLACEMENT_GPCRDB_ROW");
  assert.equal(newEntry.obsoletePreferredChainInherited, false);
  assert.equal(newEntry.gpcrdb.preferredChain, null);
  assert.deepEqual(newEntry.receptorMapping.preferredAuthChainEntityIds, []);
  assert.equal(newEntry.dispositionStatus, "PENDING_DISPOSITION");
  assert.ok(entries.filter((entry) => entry.pdbId !== "9J31").every((entry) => entry.replacementReceptorMappingAuthority === "FROZEN_GPCRDB_METADATA_FOR_REPLACEMENT_ID"));
});

test("editing the alias ledger cannot manufacture a second unseen accession", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-replacements-"));
  try {
    await cp(SNAPSHOT, temporary, { recursive: true });
    const filename = path.join(temporary, "aliases.jsonl");
    const aliases = (await readFile(filename, "utf8")).trimEnd().split("\n").map(JSON.parse);
    aliases[0].replacementAlreadyInCaptured1426 = false;
    aliases[0].uniqueAccessionIncrementRelativeToCaptured1426 = 1;
    await writeFile(filename, aliases.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await assert.rejects(verifyReplacementReconciliation({ repositoryRoot: ROOT, snapshotDirectory: temporary }), /does not reconstruct: aliases.jsonl/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
