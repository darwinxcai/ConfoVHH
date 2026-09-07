import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/gpr1-nb32-entity-adjudication-2026-09-07";
const INPUT = "validation/hard-decoy-holdout-v3/gpr1-nb32-source-review-2026-09-04/source-review.json";
const INPUT_SHA256 = "4d7d0d27b9c5189a34403fbdda0157d46432cfd2d04f69269abd6ac779b79439";
const PDB_IDS = ["9UYH", "9UYI", "9UYJ", "9UYL", "9UYM", "9UYN"];
const EXPECTED_NB32 = ["9UYH_3", "9UYI_3", "9UYJ_2", "9UYL_4", "9UYM_2", "9UYN_3"];
const EXPECTED_SCFV30 = ["9UYH_5", "9UYI_5", "9UYJ_5", "9UYL_5", "9UYM_3", "9UYN_4"];
const NB32_CORE_SHA256 = "6e4950ddc5187ddeca645f7135ee8748f8a15feef96ce96797b98e0d9e17a35e";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => `${JSON.stringify(value, null, 2)}\n`;

function retainedEntity(entity) {
  return {
    rcsbId: entity.rcsbId,
    entityId: entity.entityId,
    description: entity.description,
    labelAsymIds: entity.labelAsymIds,
    authAsymIds: entity.authAsymIds,
    sequenceLength: entity.sequenceLength,
    sequenceSha256: entity.sequenceSha256,
    referenceSequences: entity.referenceSequences,
  };
}

async function derive(repositoryRoot = ROOT) {
  const inputBytes = await readFile(path.join(repositoryRoot, INPUT));
  assert.equal(sha(inputBytes), INPUT_SHA256, "GPR1 source review changed");
  const source = JSON.parse(inputBytes);
  assert.equal(source.summary.gpr1EntryCount, 6);
  assert.equal(source.summary.gpr1PolymerEntityCount, 29);
  assert.equal(source.summary.gpr1Nb32AuxiliaryRoleInferences, 6);
  assert.equal(source.roleInference.gpr1PrimaryMethodsReviewed, false);
  assert.equal(source.roleInference.gpr1PrimaryDepositionStatementReviewed, false);
  assert.equal(source.roleInference.wholeEntryExclusionAuthority, false);
  assert.equal(source.publishedSequence.nb32Sha256, NB32_CORE_SHA256);
  assert.equal(source.publishedSequence.nb32Length, 114);

  const inventories = source.allPolymerInventories.filter(row => PDB_IDS.includes(row.pdbId));
  assert.deepEqual(inventories.map(row => row.pdbId), PDB_IDS);
  assert.equal(inventories.reduce((sum, row) => sum + row.polymerEntityCount, 0), 29);
  assert.ok(inventories.every(row => row.primarySampleAccountingComplete === false));

  const nb32Rows = source.nb32SequenceComparisons.filter(row => PDB_IDS.includes(row.pdbId));
  const scfvRows = source.scfv30SequenceComparisons.filter(row => PDB_IDS.includes(row.pdbId));
  assert.deepEqual(nb32Rows.map(row => row.entityId), EXPECTED_NB32);
  assert.deepEqual(scfvRows.map(row => row.entityId), EXPECTED_SCFV30);

  const reviews = inventories.map((inventory, index) => {
    const nb32 = nb32Rows[index];
    const scfv = scfvRows[index];
    const candidate = inventory.allDepositedPolymerEntities.find(entity => entity.rcsbId === nb32.entityId);
    const coPresent = inventory.allDepositedPolymerEntities.find(entity => entity.rcsbId === scfv.entityId);
    assert.ok(candidate && coPresent, `${inventory.pdbId}: expected antibody-format entities missing`);
    assert.equal(candidate.description, "Nanobody 32");
    assert.equal(coPresent.description, "Single-chain fragment variable 30 (scFv30)");
    assert.equal(nb32.comparisonClassification, "EXACT_PUBLISHED_NB32_SEQUENCE_SEGMENT");
    assert.equal(nb32.exactCoreLength, 114);
    assert.equal(nb32.coreStart1, 1);
    assert.equal(nb32.coreEnd1, 114);
    assert.equal(nb32.coreSequenceSha256, NB32_CORE_SHA256);
    assert.equal(nb32.suffix, "HHHHHH");
    assert.equal(nb32.wholeExpressionConstructIdentical, false);
    assert.equal(scfv.classification, "EXACT_FAB30_SEGMENT_FORMAT_INFERENCE_REQUIRES_GPR1_PRIMARY_METHODS");
    assert.equal(scfv.domainBoundariesExperimentallyVerified, false);

    return {
      pdbId: inventory.pdbId,
      completeDepositedPolymerEntityCount: inventory.polymerEntityCount,
      allDepositedPolymerEntities: inventory.allDepositedPolymerEntities.map(retainedEntity),
      candidateEntity: retainedEntity(candidate),
      candidateRole: {
        classification: "SOURCE_SUPPORTED_AUXILIARY_BETA_ARRESTIN_REAGENT",
        primaryRoleSourceDoi: "10.1073/pnas.2507384122",
        sourceFact: "The primary source identifies nanobody32 as recognizing beta-arrestins and publishes its sequence.",
        identityEvidence: {
          metadataDescriptionMatchesNamedReagent: true,
          exactPublishedCoreLength: nb32.exactCoreLength,
          exactPublishedCoreSha256: nb32.coreSequenceSha256,
          depositedSuffix: nb32.suffix,
          completeExpressionConstructIdentical: false,
          roleProofBySequenceAlone: false,
        },
      },
      candidateEntityDisposition: "EXCLUDE_CANDIDATE_ENTITY_AUXILIARY_BINDER",
      wholeEntryDisposition: "PENDING_PRIMARY_SAMPLE_AND_COPRESENT_BINDER_RECONCILIATION",
      coPresentScfv30: {
        entity: retainedEntity(coPresent),
        relationship: scfv.classification,
        experimentallyVerifiedDomainBoundaries: false,
        directReceptorBindingRoleResolved: false,
      },
      primaryGpr1MethodsReviewed: false,
      primaryGpr1DepositionStatementReviewed: false,
      primarySampleAccountingComplete: false,
      entryExclusionAuthority: false,
      eligibleTargetAuthority: false,
      formalGraphAuthority: false,
      formalNoEdgeAuthority: false,
    };
  });

  const adjudication = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    reviewDate: "2026-09-07",
    scope: "Bounded candidate-entity adjudication for deposited Nb32 in six GPR1 entries; not a whole-entry disposition or whole-census decision.",
    input: { path: INPUT, sha256: INPUT_SHA256 },
    evidenceBoundary: "Previously retained primary Nb32 abstract/Methods facts, exact published-sequence comparisons and complete deposited polymer inventories only. The 7 September access search and exposed secondary prose are not scientific authority.",
    authority: {
      boundedCandidateEntityDispositionAuthority: true,
      wholeEntryDispositionAuthority: false,
      formalEligibilityAuthority: false,
      formalLeakageEdgeAuthority: false,
      formalNoEdgeAuthority: false,
      masterDispositionLedgerRewritten: false,
      wholeCensusDecisionMade: false,
      targetFreezePermitted: false,
    },
    reviews,
    summary: {
      reviewedEntryCount: reviews.length,
      reviewedPolymerCount: reviews.reduce((sum, row) => sum + row.completeDepositedPolymerEntityCount, 0),
      candidateAuxiliaryEntityDispositionCount: reviews.length,
      wholeEntryDispositionCount: 0,
      wholeEntriesPendingCount: reviews.length,
      eligibleTargetIncrement: 0,
      independentEligibleComponentIncrement: 0,
      formallyClearedIndependentComponentCount: 0,
      wholeCensusUpperBound: null,
      targetFreezePermitted: false,
    },
    unresolved: [
      "Exact primary GPR1 sample Methods remain unavailable through the reviewed route.",
      "The co-present scFv30 preparation and direct-binding role remain unresolved.",
      "Expression/deposition tag and construct-history discrepancies remain open.",
      "The six GPR1 entries require exposure adjudication and formal publication/receptor/VHH graph review.",
    ],
  };

  const accessAndExposure = {
    schemaVersion: "1.0.0",
    reviewDate: "2026-09-07",
    sourceAccessUpdate: {
      targetDoi: "10.1126/science.adt8794",
      primaryArticleUrl: "https://www.science.org/doi/10.1126/science.adt8794",
      primaryArticleDirectFetchOutcome: "HTTP_403_FORBIDDEN",
      indexedPrimaryPageObserved: true,
      indexedPrimaryPageFactsUsedForAdjudication: false,
      directSupplementRecovered: false,
      newPrimaryMethodsEvidenceRecovered: false,
      blockerChanged: false,
    },
    incident: {
      classification: "INCIDENTAL_SECONDARY_STRUCTURAL_PROSE_IN_SEARCH_OUTPUT",
      trigger: "A targeted public-source query returned secondary-review snippets containing structural material beyond the requested preparation and deposition facts.",
      affectedPdbIds: PDB_IDS,
      exposedCategories: [
        "GPR1 construct and mutation narrative",
        "engineered crosslink residue-pair narrative",
        "qualitative native-complex and ligand-contact narrative",
        "structural figure-caption prose",
      ],
      exactRestrictedProseCopiedIntoRecord: false,
      actualNativeReceptorVhhResidueContactAssignmentsRead: false,
      nativeCoordinatesAccessed: false,
      nativeRelativeReceptorVhhPoseInspected: false,
      structuralImagesRendered: false,
      structuralContactTablesAccessed: false,
      dockqCapriLabelsAccessed: false,
      predictionOutputsAccessed: false,
      benchmarkPerformanceResultsAccessed: false,
    },
    effect: {
      cleanBlindClaimPermitted: false,
      formalExposureClearanceGranted: false,
      scientificDispositionChangedByIncident: false,
      usedForCandidateEntityAdjudication: false,
      usedForEligibility: false,
      usedForGraphDecision: false,
      independentEligibleComponentCountChanged: false,
      targetFreezePermitted: false,
    },
  };
  return { adjudication, accessAndExposure };
}

function readme(adjudication) {
  return `# GPR1/Nb32 bounded candidate-entity adjudication\n\nStatus: **six deposited Nb32 candidate entities receive bounded auxiliary-role dispositions; all six whole entries remain pending.**\n\nThe retained primary Nb32 source identifies nanobody32 as a beta-arrestin-recognizing reagent and publishes its 114-residue sequence. Each GPR1 entry contains an entity named Nanobody 32 with that exact 114-residue core followed by six histidines. The source fact, named metadata identity and exact sequence relationship jointly support \`EXCLUDE_CANDIDATE_ENTITY_AUXILIARY_BINDER\` for those six entities. Sequence identity alone is explicitly not role authority.\n\nAll ${adjudication.summary.reviewedPolymerCount} deposited polymers remain accounted for. Every entry also contains scFv30, whose retained sequence has exact Fab30 segment relationships but whose GPR1 experimental preparation and direct-binding role remain unreviewed. Consequently no whole-entry exclusion or eligible-target decision is issued.\n\nA fresh direct request to the Science article remained HTTP 403. Indexed snippets were not promoted to Methods evidence. The same narrowly targeted search incidentally displayed secondary structural prose; \`access-and-exposure.json\` records categories without copying the prose. No coordinates, receptor–VHH relative poses, structural images, structural contact tables, actual native receptor–VHH residue-contact assignments, labels or predictions were accessed.\n\nThe master ledger and formal graph are unchanged. New eligible targets and independent components: **zero**. Formally cleared independent components remain **zero**; the whole-census upper bound remains unknown; target freeze remains blocked.\n\nVerify offline with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/adjudicate-gpr1-nb32.mjs verify\nnode --test tests/hard-decoy-v3-gpr1-nb32-adjudication.test.mjs\n\`\`\`\n`;
}

async function expectedFiles(repositoryRoot = ROOT) {
  const { adjudication, accessAndExposure } = await derive(repositoryRoot);
  const files = new Map([
    ["entity-adjudications.json", stable(adjudication)],
    ["access-and-exposure.json", stable(accessAndExposure)],
    ["manifest.json", stable({
      schemaVersion: "1.0.0",
      package: PACKAGE,
      input: adjudication.input,
      outputFiles: ["README.md", "access-and-exposure.json", "entity-adjudications.json", "manifest.json"],
      deterministicOfflineReplay: true,
      networkAccessRequiredForVerification: false,
    })],
  ]);
  files.set("README.md", readme(adjudication));
  const ordered = [...files].sort(([a], [b]) => a.localeCompare(b));
  const checksums = ordered.map(([name, bytes]) => `${sha(bytes)}  ${name}\n`).join("");
  return new Map([...ordered, ["checksums.sha256", checksums]]);
}

export async function buildGpr1Nb32Adjudication(repositoryRoot = ROOT) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes, { flag: "wx" });
  return { built: true, output, fileCount: files.size };
}

export async function verifyGpr1Nb32Adjudication(repositoryRoot = ROOT, overrides = new Map()) {
  const expected = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  assert.deepEqual((await readdir(output)).sort(), [...expected.keys()].sort(), "Package file inventory changed");
  for (const [name, bytes] of expected) {
    const filename = path.join(output, name);
    const info = await lstat(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `${name} must be one direct regular file`);
    const actual = overrides.has(name) ? overrides.get(name) : await readFile(filename, "utf8");
    assert.equal(actual, bytes, `${name} differs from deterministic source evidence`);
  }
  return {
    verified: true,
    reviewedEntryCount: 6,
    reviewedPolymerCount: 29,
    candidateAuxiliaryEntityDispositionCount: 6,
    wholeEntriesPendingCount: 6,
    independentEligibleComponentIncrement: 0,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2] ?? "verify";
  const result = command === "build" ? await buildGpr1Nb32Adjudication() : await verifyGpr1Nb32Adjudication();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
