import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDevelopmentComparison, canonicalReceptorSignals, reproduceDomainCall, verifyDomainDevelopmentReview } from "../scripts/hard-decoy-v3/compare-domain-remainder-development.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = path.join(ROOT, "validation/hard-decoy-holdout-v3");
const OUT = path.join(BASE, "domain-remainder-development-review-2026-09-04");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const rows = async (relative, directory = BASE) => String(await readFile(path.join(directory, relative))).trimEnd().split("\n").filter(Boolean).map(JSON.parse);
const inputs = {
  entries: await rows("domain-remainder-2026-09-04/entries.jsonl"),
  entityScreens: await rows("domain-remainder-screen-2026-09-04/entity-screens.jsonl"),
  sequenceScreens: await rows("domain-remainder-screen-2026-09-04/sequence-screens.jsonl"),
  developmentVhh: await rows("vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl"),
  developmentReceptors: await rows("receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl"),
  canonicalProfiles: await rows("receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl"),
  vhhContract: JSON.parse(await readFile(path.join(BASE, "vhh-sequence-contract-2026-08-29.json"))),
  receptorContract: JSON.parse(await readFile(path.join(BASE, "receptor-tm-contract-2026-08-30.json"))),
};

test("all positive metadata entities, every window alternative and every development reference are accounted for", async () => {
  const entities = await rows("entity-review.jsonl", OUT), calls = await rows("domain-calls.jsonl", OUT);
  const vh = await rows("entity-development-vhh-matrix.jsonl", OUT), receptor = await rows("entry-development-receptor-matrix.jsonl", OUT);
  const expected = inputs.entityScreens.filter((row) => row.numberedHeavyDomainCallCount > 0);
  assert.deepEqual(entities.map((row) => row.entityKey).sort(), expected.map((row) => `${row.pdbId}_${row.entityId}`).sort());
  assert.equal(entities.length, 374); assert.equal(new Set(entities.map((row) => row.pdbId)).size, 345);
  assert.equal(calls.length, 478); assert.equal(vh.length, 374 * 18); assert.equal(receptor.length, 345 * 17);
  assert.equal(vh.reduce((sum, row) => sum + row.callComparisons.length, 0), 478 * 18);
  assert.equal(new Set(vh.map((row) => row.pairId)).size, vh.length);
  assert.equal(new Set(receptor.map((row) => row.pairId)).size, receptor.length);
  for (const entity of entities) assert.deepEqual(vh.filter((row) => row.entityKey === entity.entityKey).map((row) => row.developmentProfileId).sort(), inputs.developmentVhh.map((row) => row.profileId).sort());
  assert.equal(calls.filter((row) => row.overlappingAlternativeCount > 0).length, 208);
});

test("NB6 and JN241 variants yield positive non-exact development signals without formal edge authority", async () => {
  const pairs = await rows("entity-development-vhh-matrix.jsonl", OUT), domains = await rows("domain-development-vhh-matrix.jsonl", OUT);
  for (const id of ["9W3K_5", "9W3L_2"]) {
    const pair = pairs.find((row) => row.entityKey === id && row.developmentProfileId === "development:6VI4#entity:2");
    assert.equal(pair.exactFullEntityMatch, false); assert.equal(pair.status, "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED");
    const comparison = domains.find((row) => row.pairId === pair.callComparisons[0].comparisonId);
    assert.equal(comparison.framework.identicalResidueColumns, 88); assert.equal(comparison.framework.alignmentColumns, 91);
    assert.equal(comparison.cdr3.identicalResidueColumns, 15); assert.equal(comparison.cdr3.alignmentColumns, 15);
    assert.equal(pair.formalLeakageEdgeAuthority, false); assert.equal(pair.formalNoEdgeAuthority, false);
  }
  const jn = pairs.find((row) => row.entityKey === "9LQU_1" && row.developmentProfileId === "development:6KNM#entity:2");
  assert.equal(jn.exactFullEntityMatch, false); assert.equal(jn.status, "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED");
});

test("unknown or auxiliary fusion accessions cannot become canonical receptor identities", () => {
  const fake = { polymerEntities: [{ entityId: "fusion", description: "T4 lysozyme / unknown receptor", referenceSequences: [{ databaseName: "UniProt", databaseAccession: "P00720" }] }] };
  assert.equal(canonicalReceptorSignals(fake, inputs.developmentReceptors).signals.length, 0);
  fake.polymerEntities[0].referenceSequences.push({ databaseName: "UniProt", databaseAccession: "P35414" });
  const result = canonicalReceptorSignals(fake, inputs.developmentReceptors);
  assert.deepEqual(result.signals.map((row) => row.accession), ["P35414"]);
  assert.equal(result.signals[0].profile.pdbId, "6KNM"); assert.notEqual(result.signals[0].profile.pdbId, "6O3C");
  assert.equal(result.canonicalMappingComplete, false); assert.equal(result.receptorEntityRoleAdjudicated, false);
  const dual = inputs.entries.find((row) => row.pdbId === "9LY2");
  assert.deepEqual(canonicalReceptorSignals(dual, inputs.canonicalProfiles).signals.map((row) => row.accession).sort(), ["P30518", "Q03431"]);
});

test("nonempty IMGT regions do not discard contained truncated alternatives or imply complete termini", async () => {
  const sequenceScreen = inputs.sequenceScreens.find((row) => row.overlappingDomainCalls);
  const entity = inputs.entries.flatMap((row) => row.polymerEntities).find((row) => row.sequenceSha256 === sequenceScreen.sequenceSha256);
  for (const call of sequenceScreen.heavyChainDomains) {
    const result = reproduceDomainCall(entity.sequence, call);
    assert.equal(result.reusableForThreshold, true);
  }
  const calls = await rows("domain-calls.jsonl", OUT);
  assert.ok(calls.some((row) => row.isStrictlyContainedAlternative));
  assert.ok(calls.every((row) => row.imgtCompleteMeansNonemptyRegionsNotCompleteBiologicalTermini));
  const call = structuredClone(sequenceScreen.heavyChainDomains[0]); call.end -= 1;
  assert.throws(() => reproduceDomainCall(entity.sequence, call), /binding mismatch/);
  call.sequenceLength -= 1; call.sequenceSha256 = sha(entity.sequence.slice(call.start, call.end));
  const shortened = reproduceDomainCall(entity.sequence, call);
  assert.equal(shortened.reusableForThreshold, false); assert.equal(shortened.formalNoEdgeAuthority, false);
});

test("dropped development references, duplicate entities and substituted source sequences fail closed", () => {
  assert.throws(() => buildDevelopmentComparison({ ...inputs, developmentVhh: inputs.developmentVhh.slice(1) }), /18 unique/);
  assert.throws(() => buildDevelopmentComparison({ ...inputs, developmentReceptors: inputs.developmentReceptors.slice(1) }), /17 unique/);
  assert.throws(() => buildDevelopmentComparison({ ...inputs, entityScreens: [inputs.entityScreens[0], ...inputs.entityScreens.slice(0, -1)] }), /accounting mismatch/);
  const entries = structuredClone(inputs.entries); entries[0].polymerEntities[0].sequence += "A";
  assert.throws(() => buildDevelopmentComparison({ ...inputs, entries }), /sequence mismatch/);
});

test("source queue retains every containing entity and publications while sensitivity vetoes stay visible", async () => {
  const queue = await rows("source-review-queue.jsonl", OUT), entities = await rows("entity-review.jsonl", OUT);
  assert.equal(queue.length, 99);
  assert.deepEqual(queue.flatMap((row) => row.memberEntityKeys).sort(), entities.map((row) => row.entityKey).sort());
  for (const group of queue) {
    assert.equal(group.formallyClearedIndependentComponentCount, 0); assert.equal(group.formalExclusionAuthority, false);
    assert.deepEqual([...new Set(group.publicationsForSeparateSourceReview.flatMap((row) => row.pdbIds))].sort(), group.pdbIds);
    if (group.vetoOnlySensitivityDevelopmentReceptorNodeIds.length) assert.notEqual(group.queueCategory, "NO_OBSERVED_DEVELOPMENT_SIGNAL_REMAINS_UNRESOLVED");
  }
});

test("committed comparison package replays byte-for-byte with networking disabled", async () => {
  const previous = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Network forbidden in this offline review"); };
  try {
    const result = await verifyDomainDevelopmentReview({ repositoryRoot: ROOT, outputDirectory: OUT });
    assert.equal(result.positiveVhhEntityCount, 19); assert.equal(result.positiveReceptorEntryCount, 42);
    assert.equal(result.unresolvedDomainProfileCount, 0); assert.equal(result.containedAlternativeOnlyPositivePairCount, 0);
    assert.equal(result.targetFreezePermitted, false);
  } finally { globalThis.fetch = previous; }
});

test("verification rejects additional untracked results before claiming a complete inventory", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-domain-development-"));
  try {
    await writeFile(path.join(temporary, "unlisted-result.json"), "{}\n");
    await assert.rejects(verifyDomainDevelopmentReview({ repositoryRoot: ROOT, outputDirectory: temporary }), /inventory mismatch/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
