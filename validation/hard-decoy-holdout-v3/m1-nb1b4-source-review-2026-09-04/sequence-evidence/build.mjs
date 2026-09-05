import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(HERE), "../../../..");
const BASE = "validation/hard-decoy-holdout-v3/";
const CAPTURE = `${BASE}m1-nb1b4-source-review-2026-09-04/source-capture/`;
const PINNED = {
  [`${CAPTURE}uniprot-P11229-repeat-1.json`]: "58ca178b55a9579fce440e61ee4c0dc0108f3f5c16e990983f9fec701dad8f2b",
  [`${CAPTURE}uniprot-P11229-repeat-2.json`]: "58ca178b55a9579fce440e61ee4c0dc0108f3f5c16e990983f9fec701dad8f2b",
  [`${CAPTURE}gpcrdb-P11229-repeat-1.json`]: "51686ddbfe9cfc21e4ec938ad94d383e5985597970b75bc27c812932da79c9f3",
  [`${CAPTURE}gpcrdb-P11229-repeat-2.json`]: "51686ddbfe9cfc21e4ec938ad94d383e5985597970b75bc27c812932da79c9f3",
  [`${CAPTURE}gpcrdb-acm1-residues-repeat-1.json`]: "b1d3cb63be7947bd8261e6c4b9dbb46011dabd02889d2ea58461209dce40432e",
  [`${CAPTURE}gpcrdb-acm1-residues-repeat-2.json`]: "b1d3cb63be7947bd8261e6c4b9dbb46011dabd02889d2ea58461209dce40432e",
  [`${BASE}global-text-discovery-2026-09-04/entries.jsonl`]: "fde2a0de338d34ea0e2baf56924b20bbc2de113b821a30af9c976b064d3a92d0",
  [`${BASE}global-text-screen-2026-09-04/entity-screens.jsonl`]: "ddf6eef4bbd5f16bac633f5049e52ec5541d3f3a0ccbc9d8cf27020a28b2a267",
  [`${BASE}global-text-screen-2026-09-04/sequence-screens.jsonl`]: "473d3dcb13fe00a247c9f4be116537f14af797dfb091fa253a0840581d48d875",
  [`${BASE}receptor-tm-pregraph-2026-08-30/canonical-receptors.jsonl`]: "ddf3e4084429387c0387b237781292652c582050fb959ebdbde2ff1ee8eab3ea",
  [`${BASE}receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl`]: "ac6d733ec4658b17349b8ca63cc9a4fbf18ce9c761b7c9ed38fcd4854e8b15f3",
  [`${BASE}receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl`]: "0a120c9ac73ce5acbb33cb638d2fe396942cf6dff302d3a81e74a789af797b65",
  [`${BASE}vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl`]: "1c791d337d628a1de397eb33cfe5685d76953e169bfbf1077798365fa9fa8730",
  [`${BASE}vhh-sequence-contract-2026-08-29.json`]: "bc31adf14cf1222ebade348337facefb209c286c631f0da0bf640bd778b0688f",
  [`${BASE}receptor-tm-contract-2026-08-30.json`]: "abd88bbae2d35fda28dc9339f80d91c65d95c4b9f844d74ddff7249090eea412",
  "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs": "5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb",
  "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs": "4316347ee87f6c945f3cb3ed8b3128bb3b2468ec5dfdb158d4e297119821fa6b",
  "node_modules/immunum/immunum.js": "a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00",
  "node_modules/immunum/immunum_bg.wasm": "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b",
  "node_modules/immunum/package.json": "733c9d00636ec6b88ba3ff7584ecc2fb77380eb5d65750cdcacdd9214299b098",
  "package-lock.json": "0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54",
};
const AUTHORITY = {
  directBinderRoleAdjudicated: false, vhhIdentityAdjudicated: false,
  knownParentVariantIdentityEstablished: false, formalLeakageEdgeAuthority: false,
  formalNoEdgeAuthority: false, formalExclusionAuthority: false,
  formallyClearedIndependentComponentCount: 0, wholeCensusAuthority: false,
  targetFreezePermitted: false, nativeCoordinatesAccessed: false,
  nativePoseImagesAccessed: false, observedLabelsAccessed: false,
  predictionOutputsAccessed: false, primaryPublicationsAccessedByThisSequenceAnalysis: false,
};
const sha = (x) => createHash("sha256").update(x).digest("hex");
const cmp = (a, b) => Buffer.from(String(a)).compare(Buffer.from(String(b)));
const canonical = (x) => Array.isArray(x) ? `[${x.map(canonical).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).sort(cmp).map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
const json = (x) => `${canonical(x)}\n`;
const jsonl = (x) => x.map(json).join("");
const parseRows = (bytes) => String(bytes).trimEnd().split("\n").filter(Boolean).map(JSON.parse);

/** Exact shared sequence blocks; this is not a biological construct-boundary assignment. */
function exactBlocks(canonicalSequence, depositedSequence, minimumLength = 8) {
  function partition(a0, a1, b0, b1) {
    let previous = new Uint32Array(b1 - b0 + 1), best = { length: 0, a: a0, b: b0 };
    for (let a = a0; a < a1; a++) {
      const next = new Uint32Array(b1 - b0 + 1);
      for (let b = b0; b < b1; b++) if (canonicalSequence[a] === depositedSequence[b]) {
        const length = previous[b - b0] + 1; next[b - b0 + 1] = length;
        const startA = a + 1 - length, startB = b + 1 - length;
        if (length > best.length || (length === best.length && (startA < best.a || (startA === best.a && startB < best.b)))) best = { length, a: startA, b: startB };
      }
      previous = next;
    }
    if (best.length < minimumLength) return [];
    const block = { canonicalStart: best.a, canonicalEnd: best.a + best.length,
      depositedStart: best.b, depositedEnd: best.b + best.length, length: best.length,
      sequence: canonicalSequence.slice(best.a, best.a + best.length) };
    assert.equal(block.sequence, depositedSequence.slice(block.depositedStart, block.depositedEnd));
    return [...partition(a0, block.canonicalStart, b0, block.depositedStart), block,
      ...partition(block.canonicalEnd, a1, block.depositedEnd, b1)];
  }
  const blocks = partition(0, canonicalSequence.length, 0, depositedSequence.length), intervening = [];
  let a = 0, b = 0;
  for (const block of [...blocks, { canonicalStart: canonicalSequence.length, canonicalEnd: canonicalSequence.length, depositedStart: depositedSequence.length, depositedEnd: depositedSequence.length }]) {
    if (a !== block.canonicalStart || b !== block.depositedStart) intervening.push({ canonicalStart: a, canonicalEnd: block.canonicalStart,
      depositedStart: b, depositedEnd: block.depositedStart, canonicalSequence: canonicalSequence.slice(a, block.canonicalStart),
      depositedSequence: depositedSequence.slice(b, block.depositedStart), interpretation: "Unassigned sequence between exact blocks; not an inferred biological insertion/deletion or mutation list." });
    a = block.canonicalEnd; b = block.depositedEnd;
  }
  return { algorithm: "Recursive longest exact common substring with order-preserving partitions; ties use earliest canonical then deposited start.", minimumExactBlockLength: minimumLength,
    coordinateConvention: "zero-based start-inclusive, end-exclusive", blocks, intervening };
}

export async function build({ repositoryRoot = DEFAULT_ROOT } = {}) {
  const inputDigests = {}, inputs = new Map();
  for (const [relative, expected] of Object.entries(PINNED)) {
    const bytes = await readFile(path.join(repositoryRoot, relative));
    assert.equal(sha(bytes), expected, `Pinned input changed: ${relative}`);
    inputDigests[relative] = { sha256: expected, bytes: bytes.length }; inputs.set(relative, bytes);
  }
  const { numberVhhForLeakage, alignGlobalAffine, evaluateFrozenVhhThreshold } = await import(pathToFileURL(path.join(repositoryRoot, "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs")).href);
  const { extractCanonicalTmProfile, alignGlobalAffineWithCoverage, evaluateFrozenReceptorThreshold } = await import(pathToFileURL(path.join(repositoryRoot, "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs")).href);
  const rows = (relative) => parseRows(inputs.get(`${BASE}${relative}`));
  const entryMatches = rows("global-text-discovery-2026-09-04/entries.jsonl").filter((e) => e.pdbId === "9UCP");
  assert.equal(entryMatches.length, 1);
  const entry = entryMatches[0];
  assert.equal(entry.polymerEntityCountReported, 3); assert.equal(entry.polymerEntities.length, 3);
  assert.equal(new Set(entry.polymerEntities.map((e) => e.entityId)).size, 3);
  const entityScreens = rows("global-text-screen-2026-09-04/entity-screens.jsonl").filter((e) => e.pdbId === "9UCP");
  assert.equal(entityScreens.length, 3);
  for (const entity of entry.polymerEntities) {
    assert.equal(entity.sequence.length, entity.sequenceLength); assert.equal(sha(entity.sequence), entity.sequenceSha256);
    const screen = entityScreens.filter((s) => s.entityId === entity.entityId);
    assert.equal(screen.length, 1); assert.equal(screen[0].sequenceSha256, entity.sequenceSha256);
    assert.equal(screen[0].sequenceLength, entity.sequenceLength);
  }
  const nb = entry.polymerEntities.find((e) => e.entityId === "3");
  const receptor = entry.polymerEntities.find((e) => e.entityId === "1");
  const selectedSequenceScreens = rows("global-text-screen-2026-09-04/sequence-screens.jsonl").filter((s) => entry.polymerEntities.some((e) => e.sequenceSha256 === s.sequenceSha256));
  assert.equal(selectedSequenceScreens.length, 3);
  const screen = selectedSequenceScreens.find((s) => s.sequenceSha256 === nb.sequenceSha256);
  assert.equal(screen.heavyChainDomains.length, 1);
  const call = screen.heavyChainDomains[0];
  const domain = nb.sequence.slice(call.start, call.end);
  assert.equal(sha(domain), call.sequenceSha256); assert.equal(domain.length, call.sequenceLength);
  const numbering = numberVhhForLeakage(domain);
  assert.equal(numbering.numberingStatus, "NUMBERED"); assert.equal(numbering.queryStart, 0); assert.equal(numbering.queryEnd, domain.length - 1);
  for (const field of ["frameworkSequenceSha256", "frameworkLength", "cdr3SequenceSha256", "cdr3Length", "completeImgtRegionCoverage", "numberingSegmentationAgreement"]) assert.equal(numbering[field], call[field], `Candidate numbering drift: ${field}`);
  assert.equal(numbering.completeImgtRegionCoverage, true); assert.equal(numbering.numberingSegmentationAgreement, true);
  const contract = JSON.parse(inputs.get(`${BASE}vhh-sequence-contract-2026-08-29.json`));
  const development = rows("vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl");
  assert.equal(development.length, 18); assert.equal(new Set(development.map((p) => p.profileId)).size, 18);
  const comparisons = development.map((ref) => {
    assert.equal(ref.fullSequence.length, ref.fullSequenceLength); assert.equal(sha(ref.fullSequence), ref.fullSequenceSha256);
    const repeated = numberVhhForLeakage(ref.fullSequence);
    for (const [field, value] of Object.entries(repeated)) assert.deepEqual(value, ref[field], `Frozen reference numbering drift: ${ref.profileId}:${field}`);
    assert.equal(repeated.numberingStatus, "NUMBERED"); assert.equal(repeated.completeImgtRegionCoverage, true); assert.equal(repeated.numberingSegmentationAgreement, true);
    const framework = alignGlobalAffine(numbering.frameworkSequence, repeated.frameworkSequence, contract.alignment);
    const cdr3 = alignGlobalAffine(numbering.cdr3Sequence, repeated.cdr3Sequence, contract.alignment);
    const criterion = evaluateFrozenVhhThreshold({ framework, cdr3, cdr3LengthA: numbering.cdr3Length, cdr3LengthB: repeated.cdr3Length }, contract.edgeCriterion);
    return { pairId: `9UCP_3|${ref.profileId}`, developmentProfileId: ref.profileId,
      referenceDescription: ref.entityDescription, framework, cdr3, criterion,
      exactFullEntitySequenceMatch: nb.sequenceSha256 === ref.fullSequenceSha256,
      exactNumberedDomainMatch: domain === ref.fullSequence.slice(ref.queryStart, ref.queryEnd + 1),
      status: criterion.thresholdCriterionSatisfied ? "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED" : "NO_THRESHOLD_SIGNAL_NOT_NO_EDGE", ...AUTHORITY };
  }).sort((a, b) => cmp(a.pairId, b.pairId));
  assert.equal(new Set(comparisons.map((p) => p.pairId)).size, 18);
  const canonicalSources = [
    ["canonical-receptors.jsonl", rows("receptor-tm-pregraph-2026-08-30/canonical-receptors.jsonl")],
    ["candidate-receptor-profiles.jsonl", rows("receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl")],
    ["development-receptor-profiles.jsonl", rows("receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl")],
  ];
  const availability = canonicalSources.map(([file, records]) => ({ file, recordCount: records.length,
    matchingRecordIds: records.filter((r) => (r.accession ?? r.canonicalAccession) === "P11229" || /^(?:acm1|chrm1|m1)_/u.test(r.entryName ?? r.gpcrdbEntryName ?? "")).map((r) => r.nodeId ?? r.accession) }));
  assert.equal(receptor.referenceSequences.length, 0);
  assert.ok(availability.every((s) => s.matchingRecordIds.length === 0), "New canonical M1 source needs separately reviewed mapping and comparison");
  const uniprot = JSON.parse(inputs.get(`${CAPTURE}uniprot-P11229-repeat-1.json`));
  const gpcrdb = JSON.parse(inputs.get(`${CAPTURE}gpcrdb-P11229-repeat-1.json`));
  const residues = JSON.parse(inputs.get(`${CAPTURE}gpcrdb-acm1-residues-repeat-1.json`));
  for (const prefix of ["uniprot-P11229", "gpcrdb-P11229", "gpcrdb-acm1-residues"]) assert.deepEqual(inputs.get(`${CAPTURE}${prefix}-repeat-1.json`), inputs.get(`${CAPTURE}${prefix}-repeat-2.json`));
  assert.equal(uniprot.primaryAccession, "P11229"); assert.equal(uniprot.uniProtkbId, "ACM1_HUMAN"); assert.equal(uniprot.organism.scientificName, "Homo sapiens");
  assert.equal(gpcrdb.accession, "P11229"); assert.equal(gpcrdb.entry_name, "acm1_human"); assert.equal(gpcrdb.species, "Homo sapiens");
  assert.equal(uniprot.sequence.value, gpcrdb.sequence); assert.equal(gpcrdb.sequence.length, 460);
  assert.equal(residues.length, 460); assert.equal(new Set(residues.map((r) => r.sequence_number)).size, 460);
  const tm = extractCanonicalTmProfile({ entryName: gpcrdb.entry_name, canonicalAccession: gpcrdb.accession,
    canonicalSequence: gpcrdb.sequence, canonicalSequenceLength: gpcrdb.sequence.length, canonicalSequenceSha256: sha(gpcrdb.sequence) }, residues);
  assert.equal(tm.extractionStatus, "RESOLVED_CANONICAL_TM1_TM7"); assert.equal(tm.allTmResiduesHaveGenericNumbers, true);
  const receptorContract = JSON.parse(inputs.get(`${BASE}receptor-tm-contract-2026-08-30.json`));
  const developmentReceptors = canonicalSources[2][1]; assert.equal(developmentReceptors.length, 17);
  const receptorComparisons = developmentReceptors.map((ref) => {
    assert.equal(ref.mappingStatus, "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7"); assert.equal(sha(ref.concatenatedTmSequence), ref.concatenatedTmSequenceSha256);
    const alignment = alignGlobalAffineWithCoverage(tm.concatenatedTmSequence, ref.concatenatedTmSequence, receptorContract.alignment);
    const criterion = evaluateFrozenReceptorThreshold(alignment, receptorContract.thresholds);
    return { pairId: `PROPOSED_REFERENCE:P11229|${ref.nodeId}`, developmentNodeId: ref.nodeId, developmentCanonicalAccession: ref.canonicalAccession,
      proposedCanonicalReferenceAccession: "P11229", proposedReferenceIsDepositedAccessionAssignment: false,
      exactCanonicalReferenceAccessionMatch: ref.canonicalAccession === "P11229", alignment, criterion,
      alignmentSequenceA: cmp(tm.concatenatedTmSequence, ref.concatenatedTmSequence) <= 0 ? "PROPOSED_M1_CANONICAL_REFERENCE" : ref.nodeId,
      alignmentSequenceB: cmp(tm.concatenatedTmSequence, ref.concatenatedTmSequence) <= 0 ? ref.nodeId : "PROPOSED_M1_CANONICAL_REFERENCE",
      conditionalPrimarySignal: ref.canonicalAccession === "P11229" || criterion.primaryThresholdSatisfied,
      conditionalVetoOnlySensitivitySignal: ref.canonicalAccession === "P11229" || criterion.sensitivityThresholdSatisfied,
      interpretation: "Canonical M1 reference comparison is conditional on unresolved deposited construct identity; not a formal candidate graph edge.", ...AUTHORITY };
  }).sort((a, b) => cmp(a.pairId, b.pairId));
  assert.equal(new Set(receptorComparisons.map((p) => p.pairId)).size, 17);
  const constructComparison = { pdbId: "9UCP", entityId: "1", proposedCanonicalReferenceAccession: "P11229",
    depositedSequence: receptor.sequence, depositedSequenceSha256: receptor.sequenceSha256,
    canonicalSequence: gpcrdb.sequence, canonicalSequenceSha256: sha(gpcrdb.sequence),
    sourceAgreement: "Independently captured UniProt and GPCRdb canonical sequence bytes agree; each source has two identical responses.",
    canonicalAssignmentToDepositedEntityAdjudicated: false,
    wholeConstructAlignment: alignGlobalAffineWithCoverage(gpcrdb.sequence, receptor.sequence, receptorContract.alignment),
    alignmentSequenceA: cmp(gpcrdb.sequence, receptor.sequence) <= 0 ? "PROPOSED_M1_CANONICAL_REFERENCE" : "9UCP_ENTITY_1",
    alignmentSequenceB: cmp(gpcrdb.sequence, receptor.sequence) <= 0 ? "9UCP_ENTITY_1" : "PROPOSED_M1_CANONICAL_REFERENCE",
    wholeConstructAlignmentUsedForLeakageCriterion: false,
    exactSharedBlocks: exactBlocks(gpcrdb.sequence, receptor.sequence), ...AUTHORITY };
  const relatedMetadata = rows("global-text-discovery-2026-09-04/entries.jsonl").filter((e) => ["9UAP", "9UAZ"].includes(e.pdbId));
  const allEntityScreens = rows("global-text-screen-2026-09-04/entity-screens.jsonl");
  const relatedCoverage = relatedMetadata.map((e) => ({ pdbId: e.pdbId, primaryCitation: e.primaryCitation,
    depositedPolymerEntityCount: e.polymerEntities.length, entities: e.polymerEntities.map((entity) => {
      const entityScreen = allEntityScreens.find((s) => s.pdbId === e.pdbId && s.entityId === entity.entityId); assert.ok(entityScreen);
      assert.equal(entity.sequenceSha256, entityScreen.sequenceSha256);
      return { entityId: entity.entityId, description: entity.description, sequenceLength: entity.sequenceLength,
        sequenceSha256: entity.sequenceSha256, numberedHeavyDomainCallCount: entityScreen.numberedHeavyDomainCallCount,
        sourcePublicationConstructReconciliationComplete: false, sequenceScreenFailureEstablishesAbsence: false };
    }), ...AUTHORITY }));
  const receptorStatus = { pdbId: "9UCP", entityId: receptor.entityId, depositedSequenceSha256: receptor.sequenceSha256,
    depositedSequenceLength: receptor.sequenceLength, retainedUniProtReferences: receptor.referenceSequences,
    sourceAvailabilityQuery: { accession: "P11229", entryNamePrefixes: ["acm1_", "chrm1_", "m1_"], purpose: "Locate a retained possible M1 reference only; does not assign a receptor accession to this construct." },
    retainedCanonicalSourceAvailability: availability, assignedCanonicalAccession: null,
    receptorCanonicalMappingStatus: "PROPOSED_M1_CANONICAL_REFERENCE_DEPOSITED_CONSTRUCT_ASSIGNMENT_UNADJUDICATED",
    newlyCapturedCanonicalReference: { accession: "P11229", entryName: "acm1_human", sequenceSha256: sha(gpcrdb.sequence), sequenceLength: 460, independentSequenceSourcesAgree: true, repeatCapturesAgree: true },
    depositedToCanonicalComparisonStatus: "COMPUTED_AGAINST_PROPOSED_REFERENCE_WITHOUT_CANONICAL_ASSIGNMENT",
    developmentReceptorTmComparisonStatus: "ALL_17_COMPARED_TO_PROPOSED_CANONICAL_REFERENCE_CONDITIONAL_REVIEW_ONLY",
    missingCanonicalProfileIsEvidenceOfAbsence: false,
    scope: "The three explicitly inventoried 2026-08-30 profile files contain no M1 reference; separately captured repeated UniProt/GPCRdb metadata now provides a proposed reference. No accession was assigned to the deposited entity.", ...AUTHORITY };
  const positives = comparisons.filter((p) => p.criterion.thresholdCriterionSatisfied).map((p) => p.developmentProfileId);
  const summary = { schemaVersion: "1.0.0", pdbId: "9UCP", candidateEntityId: "3", candidateDescription: nb.description,
    depositedNanobodyLength: nb.sequenceLength, numberedDomainLength: domain.length,
    frameworkLength: numbering.frameworkLength, cdr3Length: numbering.cdr3Length,
    developmentVhhProfilesReproduced: 18, developmentVhhPairsCompared: comparisons.length,
    positiveDevelopmentVhhProfiles: positives, exactFullEntityMatchCount: comparisons.filter((p) => p.exactFullEntitySequenceMatch).length,
    exactNumberedDomainMatchCount: comparisons.filter((p) => p.exactNumberedDomainMatch).length,
    receptorCanonicalMappingStatus: receptorStatus.receptorCanonicalMappingStatus,
    proposedCanonicalReceptorDevelopmentPairsCompared: receptorComparisons.length,
    conditionalPrimaryReceptorSignalNodes: receptorComparisons.filter((p) => p.conditionalPrimarySignal).map((p) => p.developmentNodeId),
    conditionalSensitivityReceptorSignalNodes: receptorComparisons.filter((p) => p.conditionalVetoOnlySensitivitySignal).map((p) => p.developmentNodeId),
    interpretation: positives.length ? "Positive frozen VHH sequence criterion requires independent role and parent/variant adjudication. Receptor reference comparisons remain conditional on construct identity."
      : "No frozen VHH threshold match among the 18 retained development profiles. The proposed canonical M1 reference has separately recorded conditional receptor similarity signals; independence and no leakage are not established.", ...AUTHORITY };
  const buildBytes = await readFile(HERE);
  const files = new Map([
    ["build.mjs", buildBytes], ["metadata-entry.json", json(entry)], ["entity-screens.jsonl", jsonl(entityScreens)],
    ["sequence-screens.jsonl", jsonl(selectedSequenceScreens)],
    ["nb1b4-profile.json", json({ pdbId: "9UCP", entityId: "3", fullSequence: nb.sequence, fullSequenceSha256: nb.sequenceSha256,
      retainedDomainCall: call, domainSequence: domain, numbering, ...AUTHORITY })],
    ["development-vhh-comparison.jsonl", jsonl(comparisons)], ["receptor-source-status.json", json(receptorStatus)], ["summary.json", json(summary)],
    ["proposed-canonical-receptor-profile.json", json({ ...tm, assignedToDepositedEntity: false, ...AUTHORITY })],
    ["deposited-receptor-comparison.json", json(constructComparison)], ["conditional-development-receptor-comparison.jsonl", jsonl(receptorComparisons)],
    ["related-entry-sequence-coverage.json", json(relatedCoverage)],
    ["source-inputs.json", json({ schemaVersion: "1.0.0", inputDigests, executedBuildScriptSha256: sha(buildBytes),
      pairSpace: { count: comparisons.length, sortedPairIdentifierStreamSha256: sha(`${comparisons.map((p) => p.pairId).join("\n")}\n`) },
      conditionalReceptorPairSpace: { count: receptorComparisons.length, sortedPairIdentifierStreamSha256: sha(`${receptorComparisons.map((p) => p.pairId).join("\n")}\n`) }, ...AUTHORITY })],
    ["README.md", `# 9UCP Nb1B4 sequence evidence\n\nThis deterministic offline comparison uses the retained metadata for three deposited entities and all 18 frozen development VHH profiles. The 122-residue Nb1B4 entity has ${numbering.frameworkLength} framework and ${numbering.cdr3Length} CDR3 residues in its complete numbered heavy-chain domain. ${positives.length} development profiles meet the frozen framework/CDR3 criterion. A negative comparison is not evidence of independence or no leakage. Sequence evidence does not establish direct receptor binding, VHH format or ancestry.\n\nThe 435-residue entity described as an M1 receptor/de novo protein has no retained UniProt reference. None of the explicitly checked 89 canonical records, 287 candidate profiles or 17 development receptor profiles supplies M1. Repeated independent UniProt and GPCRdb captures now provide the same 460-residue P11229/acm1_human canonical sequence and a complete TM1–TM7 profile. This is a proposed reference only; no accession was assigned to the deposited construct. The packet records whole-construct alignment metrics, exact shared sequence blocks and all 17 conditional development-receptor comparisons. The canonical M1 comparison cannot establish the deposited construct identity or a formal leakage edge. Exact shared blocks do not assign biological construct boundaries or mutations. Related 9UAP/9UAZ metadata remains available for source/deposition reconciliation; absent heavy-domain detection is not absence evidence.\n\nNo publications, coordinates, native pose images, observed labels or prediction outputs were opened by this sequence analysis. Parent publication review and prior exposure adjudication remain separate. Target freeze remains blocked.\n\nReproduce from any checkout containing the pinned inputs and dependencies:\n\n\`node validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/build.mjs verify --repository-root .\`\n\nUse \`collect --output-directory PATH\` to create a fresh copy. The executed script itself is inventoried. Every output is byte-deterministic, with no timestamps or absolute workspace paths. Verification checks every output and the exact file inventory. Input and dependency bytes are hash-bound before importing the numbering implementation.\n`],
  ]);
  files.set("checksums.sha256", [...files.keys()].sort(cmp).map((name) => `${sha(files.get(name))}  ${name}\n`).join(""));
  return { files, summary };
}

export async function run(mode, { repositoryRoot = DEFAULT_ROOT, outputDirectory = path.dirname(HERE) } = {}) {
  assert.ok(["collect", "verify"].includes(mode), "Expected collect or verify");
  const result = await build({ repositoryRoot });
  if (mode === "collect") {
    await mkdir(outputDirectory, { recursive: true });
    for (const name of await readdir(outputDirectory)) {
      assert.equal(name, "build.mjs", "Collection requires an empty directory or the unchanged executed build script only");
      assert.deepEqual(await readFile(path.join(outputDirectory, name)), result.files.get(name));
    }
    for (const [name, bytes] of result.files) {
      if (name === "build.mjs" && (await readdir(outputDirectory)).includes(name)) continue;
      await writeFile(path.join(outputDirectory, name), bytes, { flag: "wx" });
    }
  } else {
    assert.deepEqual((await readdir(outputDirectory)).sort(cmp), [...result.files.keys()].sort(cmp), "Exact output inventory mismatch");
    for (const [name, bytes] of result.files) assert.deepEqual(await readFile(path.join(outputDirectory, name)), Buffer.from(bytes), `Replay mismatch: ${name}`);
  }
  return result.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const args = process.argv.slice(2), mode = args.shift(), options = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    assert.ok(["--repository-root", "--output-directory"].includes(flag) && value, "Invalid CLI argument");
    options[flag === "--repository-root" ? "repositoryRoot" : "outputDirectory"] = path.resolve(value);
  }
  console.log(JSON.stringify(await run(mode, options), null, 2));
}
