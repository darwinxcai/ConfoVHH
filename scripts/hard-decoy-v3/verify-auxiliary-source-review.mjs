import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const SNAPSHOT = "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29";
const REVIEW = "validation/hard-decoy-holdout-v3/auxiliary-remainder-source-review-2026-09-04/source-reviews.json";
const EXPECTED_IDS = "6WW2 7SK5 7SK7 7TUY 8J9O 8JBF 8JBG 8JBH 8JH7 8JHC 8XVJ 8XVK 8XVL 9D3E 9D3G 9IYA".split(" ");
const PENDING = ["8JBG", "8XVJ", "8XVK", "8XVL"];
const SCFV = ["8JBF", "8JBG", "8JBH"];
const SHARED_SHA = "494e4559fdc158a302540a71292f126e74024e664f073059b53b5fb234429884";
const SCFV_SHA = "2745d56c0420310e2806bc4336eff46f3e470cee362d0f4bd526759831ae43a1";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sorted = values => [...values].sort();
const eq = (actual, expected, message) => assert.deepEqual(actual, expected, message);

function entityRecord(entity) {
  const ids = entity.rcsb_polymer_entity_container_identifiers;
  const sequence = entity.entity_poly.pdbx_seq_one_letter_code_can.replace(/\s/gu, "");
  return {
    rcsbEntityId: entity.rcsb_id,
    entityId: ids.entity_id,
    description: entity.rcsb_polymer_entity.pdbx_description,
    asymIds: ids.asym_ids,
    authAsymIds: ids.auth_asym_ids,
    sequenceLength: sequence.length,
    sequenceSha256: sha(sequence),
  };
}

function noCensusAuthority(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["wholeCensusDecisionMade", "wholeCensusTerminalDecisionReached", "completedCensusCountBound", "targetFreezePermitted", "oracleRequestFreezePermitted", "executionAuthorized", "broaderDiscoveryComplete"].includes(key)) {
      eq(item, false, `${key} cannot gain authority from this bounded review`);
    }
    if (key === "wholeCensusComponentUpperBound") eq(item, null, "A bounded source review cannot set a whole-census bound");
    if (["status", "formalProtocolStatus"].includes(key)) assert.notEqual(item, "TARGET_CENSUS_BLOCKED", "A bounded review cannot terminate the census");
    noCensusAuthority(item);
  }
}

/** Verifies frozen metadata and recorded evidence consistency; does not independently adjudicate publication prose. */
export async function verifyAuxiliarySourceReview(repositoryRoot = ROOT, reviewObject) {
  if (reviewObject === undefined) {
    const directory = path.join(repositoryRoot, path.dirname(REVIEW));
    const checksumText = await readFile(path.join(directory, "checksums.sha256"), "utf8");
    const names = [];
    for (const line of checksumText.trimEnd().split("\n")) {
      const match = /^([a-f0-9]{64})  (README\.md|source-reviews\.json)$/u.exec(line);
      assert.ok(match, "Unexpected source-review checksum line");
      names.push(match[2]);
      eq(sha(await readFile(path.join(directory, match[2]))), match[1], `${match[2]}: source-review checksum mismatch`);
    }
    eq(sorted(names), ["README.md", "source-reviews.json"], "Source-review checksum file coverage drift");
  }
  const review = reviewObject ?? JSON.parse(await readFile(path.join(repositoryRoot, REVIEW), "utf8"));
  eq(review.studyId, "confovhh-hard-decoy-holdout-v3", "Unexpected study");
  eq(review.schemaVersion, "1.0.0", "Unexpected review schema");
  eq(sorted(review.reviews.map(row => row.pdbId)), EXPECTED_IDS, "The bounded 16-entry review inventory changed");
  noCensusAuthority(review);
  const sources = new Map(review.sources.map(source => [source.sourceId, source]));
  eq(sources.size, review.sources.length, "Duplicate publication source ID");
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, SNAPSHOT, "manifest.json"), "utf8"));
  const rawRequests = new Map(manifest.requests.map(request => [`${SNAPSHOT}/${request.rawFile}`, request]));
  const rawCache = new Map();
  const entitySequences = new Map();

  for (const row of review.reviews) {
    const request = rawRequests.get(row.frozenMetadataPath);
    assert.ok(request && request.requestedIds.includes(row.pdbId), `${row.pdbId}: raw metadata path is not in its frozen request`);
    eq(row.frozenMetadataFileSha256, request.sha256, `${row.pdbId}: frozen raw metadata hash differs from capture manifest`);
    if (!rawCache.has(row.frozenMetadataPath)) {
      const bytes = await readFile(path.join(repositoryRoot, row.frozenMetadataPath));
      eq(sha(bytes), request.sha256, `${row.pdbId}: raw metadata bytes changed`);
      rawCache.set(row.frozenMetadataPath, JSON.parse(bytes));
    }
    const matches = rawCache.get(row.frozenMetadataPath).data.entries.filter(entry => entry.rcsb_id === row.pdbId);
    eq(matches.length, 1, `${row.pdbId}: raw entry missing or duplicated`);
    const entry = matches[0];
    eq(row.frozenPrimaryCitation, entry.rcsb_primary_citation, `${row.pdbId}: frozen citation drift`);
    eq(row.frozenEntryTitle, entry.struct.title, `${row.pdbId}: frozen title drift`);
    eq(row.frozenPolymerEntityCount, entry.rcsb_entry_info.polymer_entity_count, `${row.pdbId}: polymer count drift`);
    eq(entry.polymer_entities.length, row.frozenPolymerEntityCount, `${row.pdbId}: incomplete raw polymer inventory`);
    const expectedEntities = entry.polymer_entities.map(entityRecord).sort((a, b) => a.rcsbEntityId.localeCompare(b.rcsbEntityId));
    eq([...row.allFrozenPolymerEntities].sort((a, b) => a.rcsbEntityId.localeCompare(b.rcsbEntityId)), expectedEntities, `${row.pdbId}: frozen entity inventory, IDs, chains, or sequence evidence changed`);
    const candidate = expectedEntities.find(entity => entity.rcsbEntityId === row.candidateEntity.rcsbEntityId);
    eq(row.candidateEntity, candidate, `${row.pdbId}: candidate does not match the frozen entity`);
    assert.ok(candidate, `${row.pdbId}: missing candidate`);
    for (const entity of entry.polymer_entities) entitySequences.set(entity.rcsb_id, entity.entity_poly.pdbx_seq_one_letter_code_can.replace(/\s/gu, ""));

    const source = sources.get(row.candidateRoleEvidence.sourceId);
    assert.ok(source, `${row.pdbId}: missing primary role source`);
    eq(source.doi.toLowerCase(), entry.rcsb_primary_citation.pdbx_database_id_DOI.toLowerCase(), `${row.pdbId}: role source DOI differs from frozen citation`);
    eq(row.candidateRoleEvidence.classification, "SOURCE_REPORTED_FACT", `${row.pdbId}: role evidence classification drift`);
    eq(row.candidateRoleEvidence.section, source.roleEvidence.section, `${row.pdbId}: role evidence section drift`);
    assert.ok(typeof row.candidateRoleEvidence.claim === "string" && row.candidateRoleEvidence.claim.length > 0, `${row.pdbId}: role evidence claim missing`);
    eq(row.depositionLinkage.sourceId, source.sourceId, `${row.pdbId}: deposition source differs from role source`);
    eq(row.depositionLinkage.pdbIdExplicitlyNamed, true, `${row.pdbId}: exact deposition linkage absent`);
    eq(row.depositionLinkage.frozenCandidateRcsbEntityId, candidate.rcsbEntityId, `${row.pdbId}: deposition entity mismatch`);
    eq(row.depositionLinkage.section, source.depositionEvidence.section, `${row.pdbId}: deposition section drift`);
    assert.ok(Object.hasOwn(source.depositionEvidence.pdbIdToComplex, row.pdbId), `${row.pdbId}: source does not name this deposition`);
    eq(row.depositionLinkage.sourceComplexLabel, source.depositionEvidence.pdbIdToComplex[row.pdbId], `${row.pdbId}: deposition label drift`);
    assert.ok(row.evidenceUrls.includes(`https://www.rcsb.org/structure/${row.pdbId}`), `${row.pdbId}: missing deposition URL`);
    assert.ok(source.evidenceUrls.length > 0 && source.evidenceUrls.every(url => row.evidenceUrls.includes(url)), `${row.pdbId}: primary source URLs are missing`);

    const others = row.otherAntibodyEntities;
    eq(new Set(others.map(entity => entity.rcsbEntityId)).size, others.length, `${row.pdbId}: duplicate other-antibody entity`);
    for (const other of others) {
      const { sourceSupportedFormat, formatEvidenceSourceId, ...identity } = other;
      assert.notEqual(other.rcsbEntityId, candidate.rcsbEntityId, `${row.pdbId}: primary candidate repeated as another antibody`);
      eq(identity, expectedEntities.find(entity => entity.rcsbEntityId === other.rcsbEntityId), `${row.pdbId}: other-antibody sequence or identity drift`);
      eq(sourceSupportedFormat, "FAB_HEAVY_OR_LIGHT_CHAIN", `${row.pdbId}: unreviewed antibody format`);
      eq(formatEvidenceSourceId, source.sourceId, `${row.pdbId}: antibody format source drift`);
    }
    const expectedOtherIds = expectedEntities.filter(entity => entity.rcsbEntityId !== candidate.rcsbEntityId && /fab|antibody|nanobody|vhh|scfv/iu.test(entity.description)).map(entity => entity.rcsbEntityId);
    eq(sorted(others.map(entity => entity.rcsbEntityId)), sorted(expectedOtherIds), `${row.pdbId}: named antibody inventory omitted`);
    for (const reagent of row.sourceOnlyAntibodyReagents) {
      eq(reagent.sourceId, source.sourceId, `${row.pdbId}: source-only reagent provenance drift`);
      eq(reagent.presentAsSeparateFrozenEntity, false, `${row.pdbId}: source-only reagent is asserted deposited`);
    }
    const pending = PENDING.includes(row.pdbId);
    eq(row.entryDisposition, pending ? "PENDING_REQUIRED_METADATA" : "EXCLUDE_AUXILIARY_BINDER", `${row.pdbId}: premature exclusion or disposition drift`);
    eq(row.entrySourceReviewComplete, !pending, `${row.pdbId}: source review completion drift`);
    eq(row.reviewStatus, pending ? "ENTITY_AUXILIARY_ROLE_SOURCE_REVIEWED_ENTRY_PENDING" : "ENTRY_AUXILIARY_EXCLUSION_SOURCE_REVIEWED", `${row.pdbId}: review status drift`);
    eq(row.candidateEntityDisposition, "EXCLUDE_AUXILIARY_BINDER", `${row.pdbId}: candidate-level role disposition drift`);
    eq(row.entryAssessment.unresolvedDiscrepancies.length > 0, pending, `${row.pdbId}: unresolved discrepancy was lost or ignored`);
    for (const flag of ["nativeCoordinatesInspected", "nativeRelativePoseInspected", "structuralFiguresInspected", "labelsAccessed", "targetFreezePermitted"]) eq(row[flag], false, `${row.pdbId}: ${flag} boundary changed`);
  }

  const reference = entitySequences.get("6WW2_2");
  const segment = reference.slice(2, 123);
  eq(segment.length, 121, "Anti-Fab reference segment length changed");
  eq(sha(segment), SHARED_SHA, "Anti-Fab reference segment changed");
  for (const row of review.reviews) {
    const sequence = entitySequences.get(row.candidateEntity.rcsbEntityId);
    const evidence = row.sequenceIdentityEvidence;
    if (SCFV.includes(row.pdbId)) {
      eq(row.candidateRoleClass, "SCFV16_G_PROTEIN_STABILIZER", `${row.pdbId}: scFv role drift`);
      eq(evidence.classification, "SEQUENCE_AND_SOURCE_IDENTITY_REVIEW", `${row.pdbId}: scFv sequence evidence type drift`);
      eq(evidence.exactFrozenSequenceGroupPdbIds, SCFV, `${row.pdbId}: scFv sequence group drift`);
      eq(evidence.sequenceSha256, SCFV_SHA, `${row.pdbId}: scFv sequence evidence drift`);
      eq(sha(sequence), SCFV_SHA, `${row.pdbId}: scFv frozen sequence mismatch`);
      eq(evidence.referenceReagentSourceId, "SCFV16_ORIGIN_2018", `${row.pdbId}: scFv reagent-source drift`);
      eq(sources.get(evidence.referenceReagentSourceId)?.doi, "10.1038/s41467-018-06002-w", "scFv reagent-source DOI drift");
      eq(evidence.referenceReagentSequenceIdentityClaimed, false, `${row.pdbId}: unsupported 2018 construct sequence identity`);
    } else {
      eq(row.candidateRoleClass, "ANTI_FAB_FIDUCIAL_NANOBODY", `${row.pdbId}: anti-Fab role drift`);
      eq(evidence.classification, "EXACT_SHARED_SEQUENCE_SEGMENT", `${row.pdbId}: anti-Fab evidence type drift`);
      eq(evidence.referenceRcsbEntityId, "6WW2_2", `${row.pdbId}: anti-Fab reference entity drift`);
      eq(evidence.referenceSourceId, "FZD5_2020", `${row.pdbId}: anti-Fab reference source drift`);
      eq([evidence.referenceStart1, evidence.referenceEnd1, evidence.segmentLength], [3, 123, 121], `${row.pdbId}: anti-Fab reference boundaries drift`);
      eq(evidence.segmentSha256, SHARED_SHA, `${row.pdbId}: anti-Fab segment hash drift`);
      const start = sequence.indexOf(segment);
      assert.ok(start >= 0 && sequence.indexOf(segment, start + 1) === -1, `${row.pdbId}: anti-Fab shared segment missing or nonunique`);
      eq([evidence.candidateStart1, evidence.candidateEnd1], [start + 1, start + 121], `${row.pdbId}: anti-Fab candidate boundaries drift`);
      eq(evidence.candidatePrefix, sequence.slice(0, start), `${row.pdbId}: anti-Fab prefix drift`);
      eq(evidence.candidateSuffix, sequence.slice(start + 121), `${row.pdbId}: anti-Fab suffix drift`);
      eq(evidence.internalDifferencesWithinSharedSegment, 0, `${row.pdbId}: anti-Fab segment differences drift`);
    }
  }
  eq(review.summary, {
    reviewedEntryCount: 16, candidateEntityAuxiliaryRoleSupportedCount: 16,
    entryAuxiliaryExclusionCount: 12, entryPendingInventoryReconciliationCount: 4,
    pendingPdbIds: PENDING, sourceReviewedAntiFabEntryCount: 13, sourceReviewedScfv16EntryCount: 3,
    wholeCensusDecisionMade: false, targetFreezePermitted: false,
  }, "Bounded summary or pending-entry accounting drift");
  return { verified: true, ...review.summary, rawMetadataFileCount: rawCache.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  process.stdout.write(`${JSON.stringify(await verifyAuxiliarySourceReview())}\n`);
}
