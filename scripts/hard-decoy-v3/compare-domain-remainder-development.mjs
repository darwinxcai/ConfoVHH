import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignGlobalAffine, evaluateFrozenVhhThreshold, numberVhhForLeakage } from "../hard-decoy/v3-vhh-sequence-pregraph.mjs";
import { alignGlobalAffineWithCoverage, evaluateFrozenReceptorThreshold } from "../hard-decoy/v3-receptor-tm-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASE = "validation/hard-decoy-holdout-v3";
const SCRIPT = "scripts/hard-decoy-v3/compare-domain-remainder-development.mjs";
const OUT = `${BASE}/domain-remainder-development-review-2026-09-04`;
const PINNED = {
  [`${BASE}/domain-remainder-2026-09-04/entries.jsonl`]: "6aa103cf88f5fb69874842da11ce5306a23429f7590a77210f892a40ef046017",
  [`${BASE}/domain-remainder-screen-2026-09-04/entity-screens.jsonl`]: "9e1acb6a7fe2dd2ddc76d43f1dc18a08577aa0b376ae4a4c23f900467f454fec",
  [`${BASE}/domain-remainder-screen-2026-09-04/sequence-screens.jsonl`]: "3a2db9aed20155ad2a944625fc4ca020c59d1d4b205ab9c521f8fd1682328499",
  [`${BASE}/vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl`]: "1c791d337d628a1de397eb33cfe5685d76953e169bfbf1077798365fa9fa8730",
  [`${BASE}/receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl`]: "0a120c9ac73ce5acbb33cb638d2fe396942cf6dff302d3a81e74a789af797b65",
  [`${BASE}/receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl`]: "ac6d733ec4658b17349b8ca63cc9a4fbf18ce9c761b7c9ed38fcd4854e8b15f3",
  [`${BASE}/vhh-sequence-contract-2026-08-29.json`]: "bc31adf14cf1222ebade348337facefb209c286c631f0da0bf640bd778b0688f",
  [`${BASE}/receptor-tm-contract-2026-08-30.json`]: "abd88bbae2d35fda28dc9339f80d91c65d95c4b9f844d74ddff7249090eea412",
  "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs": "5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb",
  "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs": "4316347ee87f6c945f3cb3ed8b3128bb3b2468ec5dfdb158d4e297119821fa6b",
  "node_modules/immunum/immunum.js": "a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00",
  "node_modules/immunum/immunum_bg.wasm": "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b",
};
const AUTHORITY = {
  formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false, directBinderRoleResolved: false,
  vhhIdentityEstablished: false, knownParentVariantIdentityEstablished: false, formalExclusionAuthority: false,
  wholeCensusAuthority: false, targetFreezePermitted: false, formallyClearedIndependentComponentCount: 0,
  nativeCoordinatesAccessed: false, nativePoseImagesAccessed: false, labelsAccessed: false, performanceOutputsAccessed: false,
};
const cmp = (a, b) => Buffer.from(String(a)).compare(Buffer.from(String(b)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function ok(value, message) { if (!value) throw new Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(cmp).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const lines = (rows) => rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
const unique = (values) => [...new Set(values)].sort(cmp);
const parseRows = (bytes) => String(bytes).trimEnd().split("\n").filter(Boolean).map(JSON.parse);
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));
const alignmentFields = ["alignmentScore", "identicalResidueColumns", "alignmentColumns", "gapColumns", "identity"];
const countBy = (rows, key) => Object.fromEntries(unique(rows.map((row) => row[key])).map((value) => [value, rows.filter((row) => row[key] === value).length]));

/** Preserve each window call. A changed boundary or segmentation is unresolved, never a negative. */
export function reproduceDomainCall(sequence, call) {
  ok(Number.isInteger(call.start) && Number.isInteger(call.end) && call.start >= 0 && call.end <= sequence.length && call.end > call.start, "Invalid retained domain interval");
  const domainSequence = sequence.slice(call.start, call.end);
  ok(sha(domainSequence) === call.sequenceSha256 && domainSequence.length === call.sequenceLength, "Retained domain sequence binding mismatch");
  const numbering = numberVhhForLeakage(domainSequence);
  const reproduced = numbering.numberingStatus === "NUMBERED"
    && numbering.queryStart === 0 && numbering.queryEnd === domainSequence.length - 1
    && numbering.frameworkSequenceSha256 === call.frameworkSequenceSha256
    && numbering.cdr3SequenceSha256 === call.cdr3SequenceSha256
    && numbering.frameworkLength === call.frameworkLength && numbering.cdr3Length === call.cdr3Length;
  return { domainSequence, domainSequenceSha256: sha(domainSequence), numbering,
    status: reproduced ? "REPRODUCED_COMPLETE_NUMBERING_SIGNAL_ONLY" : "UNRESOLVED_RENUMBERING_OR_BOUNDARY_DISAGREEMENT",
    reusableForThreshold: reproduced, formalNoEdgeAuthority: false };
}

/** Recognition comes only from resolved canonical GPCR profiles, not arbitrary UniProt overlap. */
export function canonicalReceptorSignals(entry, receptorProfiles) {
  const known = new Map();
  for (const row of receptorProfiles) {
    if (row.mappingStatus !== "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7") continue;
    ok(row.canonicalAccession && row.concatenatedTmSequence && sha(row.concatenatedTmSequence) === row.concatenatedTmSequenceSha256, "Canonical receptor profile digest mismatch");
    const prior = known.get(row.canonicalAccession);
    ok(!prior || prior.concatenatedTmSequenceSha256 === row.concatenatedTmSequenceSha256, "Conflicting canonical receptor profiles");
    known.set(row.canonicalAccession, row);
  }
  const signals = [], unrecognizedAnnotations = [];
  for (const entity of entry.polymerEntities) {
    const accessions = unique(entity.referenceSequences.filter((row) => row.databaseName === "UniProt").map((row) => row.databaseAccession));
    for (const accession of accessions) {
      if (known.has(accession)) signals.push({ entityId: entity.entityId, description: entity.description, accession, profile: known.get(accession), allEntityUniprotAccessions: accessions });
      else unrecognizedAnnotations.push({ entityId: entity.entityId, accession });
    }
  }
  return { signals, unrecognizedAnnotations, receptorEntityRoleAdjudicated: false, canonicalMappingComplete: false };
}

export function buildDevelopmentComparison({ entries, entityScreens, sequenceScreens, developmentVhh, developmentReceptors, canonicalProfiles, vhhContract, receptorContract }) {
  ok(developmentVhh.length === 18 && new Set(developmentVhh.map((row) => row.profileId)).size === 18, "Expected all 18 unique development VHH profiles");
  ok(developmentReceptors.length === 17 && new Set(developmentReceptors.map((row) => row.nodeId)).size === 17, "Expected all 17 unique development receptor nodes");
  const entryIndex = new Map(entries.map((row) => [row.pdbId, row]));
  ok(entryIndex.size === entries.length, "Duplicate entries");
  const sourceEntityCount = entries.reduce((sum, row) => sum + row.polymerEntities.length, 0);
  const screenIndex = new Map(entityScreens.map((row) => [`${row.pdbId}_${row.entityId}`, row]));
  ok(screenIndex.size === entityScreens.length && screenIndex.size === sourceEntityCount, "Entity screen accounting mismatch");
  const sequences = new Map(sequenceScreens.map((row) => [row.sequenceSha256, row]));
  ok(sequences.size === sequenceScreens.length, "Duplicate sequence screens");
  for (const entry of entries) for (const entity of entry.polymerEntities) {
    const screen = screenIndex.get(`${entry.pdbId}_${entity.entityId}`);
    ok(screen && entity.sequenceSha256 === screen.sequenceSha256 && sha(entity.sequence) === entity.sequenceSha256, "Metadata/screen entity sequence mismatch");
    ok(screen.numberedHeavyDomainCallCount === sequences.get(entity.sequenceSha256)?.heavyChainDomains.length, "Entity/domain screen accounting mismatch");
  }
  for (const profile of developmentVhh) {
    ok(sha(profile.fullSequence) === profile.fullSequenceSha256, "Development sequence digest mismatch");
    const numbered = numberVhhForLeakage(profile.fullSequence);
    for (const key of ["numberingStatus", "frameworkSequence", "cdr3Sequence", "queryStart", "queryEnd", "completeImgtRegionCoverage", "numberingSegmentationAgreement"])
      ok(numbered[key] === profile[key], `Frozen development profile did not reproduce: ${profile.profileId}:${key}`);
  }
  const selected = entityScreens.filter((row) => row.numberedHeavyDomainCallCount > 0).sort((a, b) => cmp(`${a.pdbId}_${a.entityId}`, `${b.pdbId}_${b.entityId}`));
  const domainProfiles = new Map(), calls = [], entityRows = [], vhhMatrix = [], domainMatrix = new Map(), receptorMatrix = [], receptorRows = [];
  const domainCache = new Map(), tmCache = new Map();
  for (const screen of selected) {
    const entry = entryIndex.get(screen.pdbId), entity = entry.polymerEntities.find((row) => row.entityId === screen.entityId);
    const sequenceScreen = sequences.get(entity.sequenceSha256), entityKey = `${screen.pdbId}_${screen.entityId}`;
    const thisCalls = [];
    for (const call of sequenceScreen.heavyChainDomains) {
      const key = `${entity.sequenceSha256}:${call.start}:${call.end}`;
      if (!domainCache.has(key)) domainCache.set(key, reproduceDomainCall(entity.sequence, call));
      const profile = domainCache.get(key), profileId = `${call.sequenceSha256}:${call.frameworkSequenceSha256}:${call.cdr3SequenceSha256}`;
      if (!domainProfiles.has(profileId)) domainProfiles.set(profileId, { profileId, ...profile });
      const otherCalls = sequenceScreen.heavyChainDomains.filter((other) => other !== call && other.start < call.end && other.end > call.start);
      const row = { callId: `${entityKey}:${call.start}:${call.end}`, entityKey, profileId, start: call.start, end: call.end,
        status: profile.status, overlappingAlternativeCount: otherCalls.length,
        isStrictlyContainedAlternative: otherCalls.some((other) => other.start <= call.start && other.end >= call.end && (other.start < call.start || other.end > call.end)),
        prefixLength: call.start, suffixLength: entity.sequenceLength - call.end,
        imgtCompleteMeansNonemptyRegionsNotCompleteBiologicalTermini: true };
      calls.push(row); thisCalls.push(row);
    }
    for (const reference of developmentVhh) {
      const compared = [];
      for (const call of thisCalls) {
        const profile = domainProfiles.get(call.profileId), pairId = `${call.profileId}|${reference.profileId}`;
        if (!domainMatrix.has(pairId)) {
          const a = profile.numbering, b = reference;
          const framework = profile.reusableForThreshold ? alignGlobalAffine(a.frameworkSequence, b.frameworkSequence, vhhContract.alignment) : null;
          const cdr3 = profile.reusableForThreshold ? alignGlobalAffine(a.cdr3Sequence, b.cdr3Sequence, vhhContract.alignment) : null;
          domainMatrix.set(pairId, { pairId, profileId: call.profileId, developmentProfileId: reference.profileId,
            status: profile.reusableForThreshold ? "COMPUTED_SEQUENCE_REVIEW_SIGNAL" : "UNRESOLVED_NUMBERING",
            framework: framework ? pick(framework, alignmentFields) : null, cdr3: cdr3 ? pick(cdr3, alignmentFields) : null,
            criterion: framework ? evaluateFrozenVhhThreshold({ framework, cdr3, cdr3LengthA: a.cdr3Length, cdr3LengthB: b.cdr3Length }, vhhContract.edgeCriterion) : null,
            exactNumberedDomainMatch: profile.domainSequence === b.fullSequence.slice(b.queryStart, b.queryEnd + 1),
            formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false });
        }
        const comparison = domainMatrix.get(pairId);
        compared.push({ callId: call.callId, comparisonId: pairId, thresholdSatisfied: comparison.criterion?.thresholdCriterionSatisfied ?? null, containedAlternative: call.isStrictlyContainedAlternative });
      }
      vhhMatrix.push({ pairId: `${entityKey}|${reference.profileId}`, entityKey, developmentProfileId: reference.profileId,
        exactFullEntityMatch: entity.sequenceSha256 === reference.fullSequenceSha256,
        status: compared.some((row) => row.thresholdSatisfied) ? "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED" : compared.some((row) => row.thresholdSatisfied === null) ? "UNRESOLVED_NUMBERING_REVIEW_REQUIRED" : "NO_THRESHOLD_SIGNAL_NOT_NO_EDGE",
        positiveOnlyOnContainedAlternative: compared.some((row) => row.thresholdSatisfied) && !compared.some((row) => row.thresholdSatisfied && !row.containedAlternative),
        callComparisons: compared, formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false });
    }
    const positives = vhhMatrix.filter((row) => row.entityKey === entityKey && row.status === "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED");
    entityRows.push({ entityKey, pdbId: screen.pdbId, entityId: screen.entityId, description: entity.description,
      fullSequenceLength: entity.sequenceLength, fullSequenceSha256: entity.sequenceSha256,
      callIds: thisCalls.map((row) => row.callId), positiveDevelopmentProfileIds: positives.map((row) => row.developmentProfileId),
      containedAlternativeOnlyPositiveProfileIds: positives.filter((row) => row.positiveOnlyOnContainedAlternative).map((row) => row.developmentProfileId),
      status: positives.length ? "POSITIVE_SEQUENCE_CRITERION_REVIEW_REQUIRED" : thisCalls.some((row) => row.status !== "REPRODUCED_COMPLETE_NUMBERING_SIGNAL_ONLY") ? "UNRESOLVED_NUMBERING_REVIEW_REQUIRED" : "NO_THRESHOLD_SIGNAL_NOT_NO_EDGE",
      lexicalAntibodySignal: screen.lexicalAntibodySignal, auxiliaryDescriptorSignal: screen.auxiliaryDescriptorSignal,
      possibleFusionOrAdditionalDomainSequence: screen.possibleFusionOrAdditionalDomainSequence,
      formatDescriptorSignal: /scfv|fab|heavy chain|light chain/iu.test(entity.description ?? ""),
      overlappingAlternativesRetained: sequenceScreen.overlappingDomainCalls, primaryCitation: entry.primaryCitation,
      ...AUTHORITY });
  }
  for (const pdbId of unique(selected.map((row) => row.pdbId))) {
    const entry = entryIndex.get(pdbId), resolution = canonicalReceptorSignals(entry, [...canonicalProfiles, ...developmentReceptors]);
    for (const reference of developmentReceptors) {
      const alternatives = resolution.signals.map((signal) => {
        const key = `${signal.profile.concatenatedTmSequenceSha256}|${reference.concatenatedTmSequenceSha256}`;
        if (!tmCache.has(key)) {
          const alignment = reference.mappingStatus === "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7" ? alignGlobalAffineWithCoverage(signal.profile.concatenatedTmSequence, reference.concatenatedTmSequence, receptorContract.alignment) : null;
          tmCache.set(key, { alignment, criterion: alignment ? evaluateFrozenReceptorThreshold(alignment, receptorContract.thresholds) : null });
        }
        const result = tmCache.get(key);
        return { entityId: signal.entityId, candidateCanonicalAccession: signal.accession,
          sourceCanonicalProfileId: signal.profile.nodeId, exactCanonicalAccessionMatch: signal.accession === reference.canonicalAccession,
          alignment: result.alignment, criterion: result.criterion };
      });
      receptorMatrix.push({ pairId: `${pdbId}|${reference.nodeId}`, pdbId, developmentNodeId: reference.nodeId,
        status: alternatives.some((row) => row.exactCanonicalAccessionMatch || row.criterion?.primaryThresholdSatisfied) ? "POSITIVE_CANONICAL_RECEPTOR_SIGNAL_ROLE_REVIEW_REQUIRED" : alternatives.length ? "NO_PRIMARY_SIGNAL_WITHIN_RECOGNIZED_ACCESSIONS_NOT_NO_EDGE" : "NO_RECOGNIZED_CANONICAL_PROFILE_UNRESOLVED",
        vetoOnlySensitivitySignal: alternatives.some((row) => row.exactCanonicalAccessionMatch || row.criterion?.sensitivityThresholdSatisfied),
        alternatives, receptorEntityRoleAdjudicated: false, formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false });
    }
    const pairs = receptorMatrix.filter((row) => row.pdbId === pdbId);
    receptorRows.push({ pdbId,
      recognizedCanonicalAnnotations: resolution.signals.map((row) => ({ entityId: row.entityId, description: row.description, accession: row.accession, canonicalProfileId: row.profile.nodeId, allEntityUniprotAccessions: row.allEntityUniprotAccessions })),
      unrecognizedUniprotAnnotationsNotAssumedReceptors: resolution.unrecognizedAnnotations,
      multipleRecognizedAccessionsRequireChimeraOrMultireceptorReview: unique(resolution.signals.map((row) => row.accession)).length > 1,
      positiveDevelopmentNodeIds: pairs.filter((row) => row.status.startsWith("POSITIVE_")).map((row) => row.developmentNodeId),
      vetoOnlySensitivityDevelopmentNodeIds: pairs.filter((row) => row.vetoOnlySensitivitySignal).map((row) => row.developmentNodeId),
      exactDevelopmentAccessionNodeIds: pairs.filter((row) => row.alternatives.some((alt) => alt.exactCanonicalAccessionMatch)).map((row) => row.developmentNodeId),
      canonicalMappingComplete: false, receptorEntityRoleAdjudicated: false, ...AUTHORITY });
  }
  // Second task: organize source-review work by exact full entity sequence. This is not a graph or component count.
  const queue = unique(entityRows.map((row) => row.fullSequenceSha256)).map((digest) => {
    const members = entityRows.filter((row) => row.fullSequenceSha256 === digest);
    const receptorContext = receptorRows.filter((row) => members.some((member) => member.pdbId === row.pdbId));
    const bibliography = new Map();
    for (const member of members) {
      const citation = member.primaryCitation;
      const key = citation?.doi ? `doi:${citation.doi.toLowerCase()}` : citation?.pmid ? `pmid:${citation.pmid}` : `unresolved:${member.pdbId}`;
      if (!bibliography.has(key)) bibliography.set(key, { key, citation, pdbIds: [] });
      bibliography.get(key).pdbIds.push(member.pdbId);
    }
    const positiveVhh = unique(members.flatMap((row) => row.positiveDevelopmentProfileIds));
    const positiveReceptor = unique(receptorContext.flatMap((row) => row.positiveDevelopmentNodeIds));
    const sensitivityReceptor = unique(receptorContext.flatMap((row) => row.vetoOnlySensitivityDevelopmentNodeIds));
    return { groupId: `exact-full-entity:${digest}`, fullEntitySequenceSha256: digest,
      groupingMeaning: "Exact deposited containing-entity sequence identity only; not VHH identity, publication equivalence, leakage component, or independence.",
      memberEntityKeys: members.map((row) => row.entityKey), pdbIds: unique(members.map((row) => row.pdbId)), descriptions: unique(members.map((row) => row.description)),
      positiveDevelopmentVhhProfileIds: positiveVhh, positiveDevelopmentReceptorNodeIds: positiveReceptor,
      vetoOnlySensitivityDevelopmentReceptorNodeIds: sensitivityReceptor,
      publicationsForSeparateSourceReview: [...bibliography.values()].sort((a, b) => cmp(a.key, b.key)).map((row) => ({ ...row, pdbIds: unique(row.pdbIds) })),
      queueCategory: positiveVhh.length ? "DEVELOPMENT_SEQUENCE_SIGNAL_REVIEW" : positiveReceptor.length ? "DEVELOPMENT_RECEPTOR_SIGNAL_REVIEW" : sensitivityReceptor.length ? "RECEPTOR_SENSITIVITY_VETO_REVIEW" : "NO_OBSERVED_DEVELOPMENT_SIGNAL_REMAINS_UNRESOLVED",
      needed: ["Source-confirmed binder identity and role", "Construct boundaries and format", "Known parent/variant provenance", "Canonical receptor entity adjudication", "Publication-family reconciliation", "Existing exposure review before eligibility"],
      ...AUTHORITY };
  });
  const profileRows = [...domainProfiles.values()].sort((a, b) => cmp(a.profileId, b.profileId));
  const comparisonRows = [...domainMatrix.values()].sort((a, b) => cmp(a.pairId, b.pairId));
  const summary = { schemaVersion: "1.0.0", status: "OFFLINE_DEVELOPMENT_REFERENCE_REVIEW_ONLY_TARGET_FREEZE_BLOCKED",
    sourceEntryCount: entries.length, sourcePolymerEntityCount: sourceEntityCount, selectedEntityCount: selected.length,
    selectedEntryCount: receptorRows.length, uniqueFullEntitySequenceCount: queue.length, retainedEntityDomainCallCount: calls.length,
    uniqueFullSequenceWindowCallCount: domainCache.size, uniqueDomainProfileCount: profileRows.length,
    overlappingAlternativeEntityCount: entityRows.filter((row) => row.overlappingAlternativesRetained).length,
    unresolvedDomainProfileCount: profileRows.filter((row) => !row.reusableForThreshold).length,
    reproducedDevelopmentVhhProfileCount: developmentVhh.length, developmentReceptorNodeCount: developmentReceptors.length,
    entityDevelopmentVhhPairCount: vhhMatrix.length, domainDevelopmentVhhPairCount: comparisonRows.length,
    representedEntityCallDevelopmentPairCount: vhhMatrix.reduce((sum, row) => sum + row.callComparisons.length, 0),
    entryDevelopmentReceptorPairCount: receptorMatrix.length, positiveVhhEntityCount: entityRows.filter((row) => row.positiveDevelopmentProfileIds.length).length,
    positiveVhhEntryCount: unique(entityRows.filter((row) => row.positiveDevelopmentProfileIds.length).map((row) => row.pdbId)).length,
    positiveReceptorEntryCount: receptorRows.filter((row) => row.positiveDevelopmentNodeIds.length).length,
    receptorSensitivityVetoEntryCount: receptorRows.filter((row) => row.vetoOnlySensitivityDevelopmentNodeIds.length).length,
    exactDevelopmentReceptorAccessionEntryCount: receptorRows.filter((row) => row.exactDevelopmentAccessionNodeIds.length).length,
    multipleRecognizedReceptorAccessionEntryCount: receptorRows.filter((row) => row.multipleRecognizedAccessionsRequireChimeraOrMultireceptorReview).length,
    noRecognizedCanonicalProfileEntryCount: receptorRows.filter((row) => row.recognizedCanonicalAnnotations.length === 0).length,
    containedAlternativeOnlyPositivePairCount: vhhMatrix.filter((row) => row.positiveOnlyOnContainedAlternative).length,
    entityStatusCounts: countBy(entityRows, "status"), queueCategoryCounts: countBy(queue, "queueCategory"), ...AUTHORITY };
  const commitments = Object.fromEntries([["entityDevelopmentVhh", vhhMatrix], ["domainDevelopmentVhh", comparisonRows], ["entryDevelopmentReceptor", receptorMatrix]].map(([key, rows]) => [key, { count: rows.length, sortedPairIdentifierStreamSha256: sha(`${rows.map((row) => row.pairId).sort(cmp).join("\n")}\n`) }]));
  ok(vhhMatrix.length === selected.length * developmentVhh.length && receptorMatrix.length === receptorRows.length * developmentReceptors.length && comparisonRows.length === profileRows.length * developmentVhh.length, "Incomplete development comparison pair space");
  return { summary, commitments, entityRows, calls, profileRows, comparisonRows, vhhMatrix, receptorRows, receptorMatrix, queue };
}

export async function buildDomainDevelopmentFiles({ repositoryRoot = ROOT } = {}) {
  const inputDigests = {}, data = new Map();
  for (const [relative, expected] of Object.entries(PINNED)) {
    const bytes = await readFile(path.join(repositoryRoot, relative));
    ok(sha(bytes) === expected, `Pinned input changed: ${relative}`);
    inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length }; data.set(relative, bytes);
  }
  for (const relative of [SCRIPT, "package-lock.json", "node_modules/immunum/package.json"]) {
    const bytes = await readFile(path.join(repositoryRoot, relative)); inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  const getRows = (relative) => parseRows(data.get(`${BASE}/${relative}`));
  const result = buildDevelopmentComparison({
    entries: getRows("domain-remainder-2026-09-04/entries.jsonl"), entityScreens: getRows("domain-remainder-screen-2026-09-04/entity-screens.jsonl"),
    sequenceScreens: getRows("domain-remainder-screen-2026-09-04/sequence-screens.jsonl"), developmentVhh: getRows("vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl"),
    developmentReceptors: getRows("receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl"), canonicalProfiles: getRows("receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl"),
    vhhContract: JSON.parse(data.get(`${BASE}/vhh-sequence-contract-2026-08-29.json`)), receptorContract: JSON.parse(data.get(`${BASE}/receptor-tm-contract-2026-08-30.json`)),
  });
  ok(result.summary.sourceEntryCount === 692 && result.summary.sourcePolymerEntityCount === 2424 && result.summary.selectedEntityCount === 374 && result.summary.selectedEntryCount === 345 && result.summary.reproducedDevelopmentVhhProfileCount === 18 && result.summary.developmentReceptorNodeCount === 17, "Pinned source scope changed");
  const files = new Map([
    ["summary.json", `${canonical(result.summary)}\n`], ["pair-space-commitments.json", `${canonical(result.commitments)}\n`],
    ["entity-review.jsonl", lines(result.entityRows)], ["domain-calls.jsonl", lines(result.calls)], ["domain-profiles.jsonl", lines(result.profileRows)],
    ["domain-development-vhh-matrix.jsonl", lines(result.comparisonRows)], ["entity-development-vhh-matrix.jsonl", lines(result.vhhMatrix)],
    ["receptor-review.jsonl", lines(result.receptorRows)], ["entry-development-receptor-matrix.jsonl", lines(result.receptorMatrix)], ["source-review-queue.jsonl", lines(result.queue)],
  ]);
  const s = result.summary;
  files.set("README.md", `# Domain-remainder development-reference review\n\nMetadata and sequence review only. Target freeze remains blocked; the whole-census independent-component upper bound remains unknown.\n\nAll ${s.selectedEntityCount} heavy-domain-positive entities in ${s.selectedEntryCount} of the 692 captured entries are accounted for. Their ${s.retainedEntityDomainCallCount} window calls are retained, including overlapping alternatives; these are not independent domains. All 18 frozen development VHH profiles reproduce, and all 17 development receptor nodes are compared.\n\n${s.positiveVhhEntityCount} entities have a positive frozen VHH sequence criterion; ${s.positiveReceptorEntryCount} entries have a positive canonical receptor annotation/TM signal. These counts are review signals and cannot establish direct binding, VHH format, ancestry, formal leakage edges, exclusions, eligibility, or independent components. A negative comparison is never a no-edge decision.\n\n## Methods and limits\n\nThe prior screen is hash-bound, not rediscovered. Every retained domain interval is extracted and renumbered using pinned immunum 1.3.0 IMGT heavy-chain numbering. Boundaries, framework and CDR3 digests must reproduce; disagreements remain unresolved. Nonempty IMGT regions do not prove complete biological termini. Overlapping contained alternatives remain explicit; any positives confined to them are flagged. Frozen global affine BLOSUM62 framework/CDR3 thresholds use integer arithmetic.\n\nReceptor accessions are recognized only through retained uniquely resolved canonical GPCRdb profiles. Arbitrary fusion annotations, including T4 lysozyme and BRIL, do not become receptor identities. Available canonical TM1–TM7 sequences use the frozen primary identity/coverage criterion and retain the 0.30 identity sensitivity criterion as a veto-only review signal. Every recognized alternative is retained, and missing profiles or multiple recognized accessions remain unresolved for entity/construct adjudication. Canonical sequence comparison does not establish deposited construct sequence identity.\n\nThe next offline task groups source review by ${s.uniqueFullEntitySequenceCount} exact containing-entity sequences, retaining every entry and distinct DOI/PMID identifier. These groups are not VHH identities, equivalent publications, or leakage components. Descriptor-based auxiliary/Fab/scFv signals organize review but never exclude an entry. All prior exposure caveats continue to apply; this package itself reads only the bound metadata/sequence inputs and no primary publications, native coordinates, pose images, labels or model outputs.\n\n## Reproduce\n\nFrom any checkout root with the pinned npm dependencies installed:\n\n\`node scripts/hard-decoy-v3/compare-domain-remainder-development.mjs verify --repository-root . --output-directory ${OUT}\`\n\nTo create a fresh copy, use \`collect\` with an empty output directory. The output is byte-deterministic, without timestamps or absolute workspace paths. Verification rebuilds every output and checks the exact file inventory, so missing pairs, extra files and edited input/output bytes fail. All files except checksums.sha256 are listed in that inventory; the manifest binds source, protocol contracts, existing algorithms and runtime dependency hashes.\n`);
  files.set("manifest.json", `${canonical({ schemaVersion: "1.0.0", inputDigests, coordinateConvention: "zero-based-start-inclusive-end-exclusive", resultSummary: "summary.json", deterministicOfflineReplay: true, files: [...files].map(([name, bytes]) => ({ name, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) })), authority: AUTHORITY })}\n`);
  files.set("checksums.sha256", [...files.keys()].sort(cmp).map((name) => `${sha(files.get(name))}  ${name}\n`).join(""));
  return { files, summary: result.summary };
}

export async function collectDomainDevelopmentReview({ repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUT) } = {}) {
  const result = await buildDomainDevelopmentFiles({ repositoryRoot });
  await mkdir(outputDirectory, { recursive: true });
  ok((await readdir(outputDirectory)).length === 0, "Collection requires an empty new directory");
  for (const [name, bytes] of result.files) await writeFile(path.join(outputDirectory, name), bytes, { flag: "wx" });
  return result.summary;
}

export async function verifyDomainDevelopmentReview({ repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, OUT) } = {}) {
  const result = await buildDomainDevelopmentFiles({ repositoryRoot });
  ok(canonical((await readdir(outputDirectory)).sort(cmp)) === canonical([...result.files.keys()].sort(cmp)), "Output file inventory mismatch");
  for (const [name, bytes] of result.files) ok((await readFile(path.join(outputDirectory, name))).equals(Buffer.from(bytes)), `Offline replay mismatch: ${name}`);
  return result.summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), mode = args.shift(), options = {};
  while (args.length) { const flag = args.shift(), value = args.shift(); ok(value && ["--repository-root", "--output-directory"].includes(flag), "Invalid CLI arguments"); options[flag === "--repository-root" ? "repositoryRoot" : "outputDirectory"] = path.resolve(value); }
  ok(["collect", "verify"].includes(mode), "Expected collect or verify");
  console.log(JSON.stringify(await (mode === "collect" ? collectDomainDevelopmentReview(options) : verifyDomainDevelopmentReview(options)), null, 2));
}
