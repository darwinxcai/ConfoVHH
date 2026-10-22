import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SCREEN_POLICY, screenProteinSequence, screenEntries, writeGpcrdbComplementScreen, verifyGpcrdbComplementScreen } from "../scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs";
import { numberVhhForLeakage } from "../scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs";

// Already exposed development VHH 3P0G; synthetic chains below are software fixtures only.
const NB80 = "QVQLQESGGGLVQAGGSLRLSCAASGSIFSINTMGWYRQAPGKQRELVAAIHSGGSTNYANSVKGRFTISRDNAANTVYLQMNSLKPEDTAVYYCNVKDYGAVLYEYDYWGQGTQVTVSSHHHHHH";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function entity(sequence, overrides = {}) {
  return { entityId: "2", description: "synthetic protein", polymerType: "Protein", polymerTypeDetail: "polypeptide(L)", sequence, sequenceLength: sequence?.length ?? null, sequenceSha256: sequence ? sha256(sequence) : null, metadataSignals: { vhhLikeCandidate: false }, sourceOrganisms: [{ scientificName: "synthetic construct", taxonomyId: "32630" }], authAsymIds: ["B"], labelAsymIds: ["B"], referenceSequences: [], ...overrides };
}
function entry(entities, pdbId = "9ZZZ") {
  return { pdbId, title: "Synthetic metadata screening fixture", primaryCitation: { doi: null, pmid: null, title: null }, gpcrdb: { protein: "test_human", preferredChain: "A", class: "Class A" }, receptorMapping: { preferredAuthChainEntityIds: ["1"] }, polymerEntities: entities };
}
function developmentReference() {
  const numbering = numberVhhForLeakage(NB80);
  return [{ category: "DEVELOPMENT_PROFILE", rows: [{ pdbId: "3P0G", entityId: "2", profileId: "development:3P0G#entity:2", entityDescription: "Camelid Antibody Fragment", fullSequence: NB80, fullSequenceLength: NB80.length, fullSequenceSha256: sha256(NB80), ...numbering }] }];
}

test("generic synthetic descriptions cannot hide an exposed heavy variable domain", () => {
  const built = screenEntries([entry([entity(NB80)])]);
  assert.equal(built.summary.entitiesWithNumberedHeavyDomain, 1);
  assert.equal(built.summary.sequencePositiveEntitiesMissedByHistoricalDescriptorTaxonomyRule, 1);
  assert.equal(built.reviewQueue[0].priorityTier, 0);
  assert.equal(built.reviewQueue[0].lexicalAntibodySignal, false);
  assert.equal(built.reviewQueue[0].vhhIdentityEstablished, false);
  assert.equal(built.reviewQueue[0].directBinderRoleResolved, false);
  assert.equal(built.reviewQueue[0].formalExclusionAuthority, false);
  assert.equal(SCREEN_POLICY.heavyChainNumberingEstablishesVhhIdentity, false);
});

test("long multidomain fusions and noncanonical flanks retain positive sequence signals", () => {
  const domain = NB80.slice(0, -6);
  const prefix = "G".repeat(310);
  const spacer = "GSGGGGSGGGGS";
  const sequence = `${prefix}${domain}${spacer}${domain}${"A".repeat(280)}X`;
  const result = screenProteinSequence(sequence);
  assert.ok(result.heavyChainDomains.some((row) => row.start === prefix.length && row.end === prefix.length + domain.length));
  const second = prefix.length + domain.length + spacer.length;
  assert.ok(result.heavyChainDomains.some((row) => row.start === second && row.end === second + domain.length));
  assert.equal(result.noncanonicalResidueCount, 1);
  assert.ok(result.attemptedIntervalCount > 1);
  const built = screenEntries([entry([entity(sequence)])]);
  assert.equal(built.reviewQueue[0].possibleFusionOrAdditionalDomainSequence, true);
  assert.equal(built.reviewQueue[0].metadataSequenceReviewRequired, true);
  assert.equal(built.summary.eligibleDirectVhhCount, null);
});

test("Fab wording and a positive heavy-domain screen are never converted into VHH proof", () => {
  const built = screenEntries([entry([entity(NB80, { description: "Fab heavy chain", metadataSignals: { vhhLikeCandidate: false } })])]);
  assert.equal(built.reviewQueue[0].lexicalAntibodySignal, true);
  assert.equal(built.reviewQueue[0].priorityTier, 1);
  assert.equal(built.reviewQueue[0].vhhIdentityEstablished, false);
  assert.equal(built.summary.independentLeakageComponentCount, null);
  assert.equal(built.summary.wholeCensusAuthority, false);
});

test("numbered Fab, scFv and heavy-chain names are antibody signals without adjudicating format or role", () => {
  const descriptions = ["Fab3949 H", "Fab3949H", "FabH", "Fab7F38_heavy chain", "ScFv30", "IgGheavychain", "IGG HEAVY CHAIN", "CS-17 Heavy Chain", "Heavy chain of 4A03Fab"];
  const built = screenEntries([entry(descriptions.map((description, index) => entity(NB80, { entityId: String(index + 1), description })))]);
  assert.equal(built.summary.untaggedUnexposedSequencePositiveEntities, 0);
  assert.equal(built.summary.reviewPriorityCounts["1"], descriptions.length);
  assert.ok(built.reviewQueue.every((row) => row.lexicalAntibodySignal && !row.vhhIdentityEstablished && !row.formalExclusionAuthority));
  const unresolvedNames = ["Guanine nucleotide-binding protein G(I)/G(S)/G(O) subunit gamma-2", "scGV16", "SVF16"];
  const unresolved = screenEntries([entry(unresolvedNames.map((description, index) => entity(NB80, { entityId: String(index + 1), description })))]);
  assert.equal(unresolved.summary.untaggedUnexposedSequencePositiveEntities, unresolvedNames.length);
  assert.ok(unresolved.reviewQueue.every((row) => row.priorityTier === 0 && row.dispositionStatus === "PENDING_REQUIRED_METADATA"));
});

test("exact development full-sequence and domain matches flag exposure without excluding", () => {
  const entries = [entry([entity(NB80)]), entry([entity(`GG${NB80.slice(0, -6)}GG`) ], "9ZZY")];
  const built = screenEntries(entries, developmentReference());
  assert.equal(built.summary.sequencePositiveEntitiesMatchingDevelopment, 2);
  for (const row of built.reviewQueue) {
    assert.equal(row.priorityTier, 2);
    assert.equal(row.priorSequenceExposure, true);
    assert.equal(row.developmentSequenceMatch, true);
    assert.equal(row.formalLeakageGraphAuthority, false);
    assert.equal(row.formalExclusionAuthority, false);
    assert.equal(row.dispositionStatus, "PENDING_REQUIRED_METADATA");
  }
  const original = built.sequenceScreens.find((row) => row.sequenceSha256 === sha256(NB80));
  assert.ok(original.referenceMatches.some((match) => match.matchType === "EXACT_FULL_ENTITY_SEQUENCE"));
  const trimmed = built.sequenceScreens.find((row) => row.sequenceSha256 !== sha256(NB80));
  assert.ok(trimmed.referenceMatches.some((match) => match.matchType === "EXACT_NUMBERED_HEAVY_DOMAIN_SEQUENCE"));
  assert.ok(trimmed.referenceMatches.every((match) => match.matchType !== "EXACT_FULL_ENTITY_SEQUENCE"));
});

test("missing, noncanonical and unnumbered sequences stay unresolved, with every polymer retained", () => {
  const built = screenEntries([entry([
    entity(null), entity("AXXXA", { entityId: "3" }), entity("A".repeat(140), { entityId: "4" }),
    entity("ACGU", { entityId: "5", polymerType: "RNA", polymerTypeDetail: "polyribonucleotide" }),
  ])]);
  assert.equal(built.entityScreens.length, 4);
  assert.equal(built.summary.nonProteinEntityCount, 1);
  assert.equal(built.summary.entitiesRequiringMissingNoncanonicalOrEngineErrorReview, 2);
  assert.equal(built.summary.entitiesWithoutConfidentCompleteHeavyDomain, 3);
  assert.equal(built.reviewQueue.length, 2);
  assert.ok(built.entityScreens.every((row) => row.formalExclusionAuthority === false && row.absenceOfHiddenVhhEstablished === false));
  assert.equal(built.summary.targetFreezePermitted, false);
});

test("distinct sequence cache preserves separate entities and rejects corrupted metadata hashes", () => {
  const fixtures = [entry([entity(NB80)]), entry([entity(NB80)], "9ZZY")];
  const built = screenEntries(fixtures);
  assert.equal(built.summary.distinctPresentSequencesScreened, 1);
  assert.equal(built.summary.entitiesWithNumberedHeavyDomain, 2);
  assert.deepEqual(screenEntries(fixtures.toReversed()), built);
  assert.throws(() => screenEntries([entry([entity(NB80, { sequenceSha256: "0".repeat(64) })])]), /Sequence hash\/length mismatch/u);
  assert.throws(() => screenEntries([entry([entity(NB80), entity(NB80)])]), /duplicate entity/u);
});

test("artifact verification reconstructs independently and detects tampering without overwriting", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-complement-screen-"));
  const inputDirectory = path.join(temporary, "input");
  const outputDirectory = path.join(temporary, "output");
  try {
    await mkdir(inputDirectory);
    await writeFile(path.join(inputDirectory, "entries.jsonl"), `${JSON.stringify(entry([entity(NB80)]))}\n`);
    for (const name of ["manifest.json", "summary.json"]) await writeFile(path.join(inputDirectory, name), "{}\n");
    const checksumRows = [];
    for (const name of ["entries.jsonl", "manifest.json", "summary.json"]) checksumRows.push(`${sha256(await readFile(path.join(inputDirectory, name)))}  ${name}`);
    await writeFile(path.join(inputDirectory, "checksums.sha256"), `${checksumRows.join("\n")}\n`);
    const options = { inputDirectory, outputDirectory };
    const written = await writeGpcrdbComplementScreen(options);
    assert.deepEqual(await verifyGpcrdbComplementScreen(options), written);
    const manifest = JSON.parse(await readFile(path.join(outputDirectory, "manifest.json"), "utf8"));
    assert.match(manifest.inputDigests["node_modules/immunum/immunum_bg.wasm"], /^[a-f0-9]{64}$/u);
    assert.equal(manifest.policy.negativeScreenEstablishesAbsence, false);
    await writeFile(path.join(outputDirectory, "summary.json"), "{\"wholeCensusAuthority\":true}\n");
    await assert.rejects(verifyGpcrdbComplementScreen(options), /Screen artifact mismatch: summary.json/u);
    assert.equal(await readFile(path.join(outputDirectory, "summary.json"), "utf8"), "{\"wholeCensusAuthority\":true}\n");
    await assert.rejects(writeGpcrdbComplementScreen(options), /new or empty/u);
    await writeFile(path.join(inputDirectory, "entries.jsonl"), `${JSON.stringify({ ...entry([entity(NB80)]), dockqScore: 0.5 })}\n`);
    await assert.rejects(verifyGpcrdbComplementScreen(options), /Forbidden result field/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
