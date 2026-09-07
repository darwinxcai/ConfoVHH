import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/gcgr-nb32-role-adjudication-2026-09-07";
const INPUT = "validation/hard-decoy-holdout-v3/gpr1-nb32-source-review-2026-09-04/source-review.json";
const INPUT_SHA256 = "4d7d0d27b9c5189a34403fbdda0157d46432cfd2d04f69269abd6ac779b79439";
const PDB_IDS = ["8JRU", "8JRV"];
const NB32_IDS = ["8JRU_3", "8JRV_4"];
const ARRESTIN_SCFV_IDS = ["8JRU_2", "8JRV_3"];
const NB32_CORE_SHA256 = "6e4950ddc5187ddeca645f7135ee8748f8a15feef96ce96797b98e0d9e17a35e";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => `${JSON.stringify(value, null, 2)}\n`;

function entityRecord(entity) {
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
  assert.equal(sha(inputBytes), INPUT_SHA256, "Bound GPR1/Nb32 source review changed");
  const source = JSON.parse(inputBytes);
  const sourceFact = source.sourceReportedFacts.find(row => row.source === "10.1038/s41586-023-06420-x");
  assert.ok(sourceFact, "GCGR primary-source fact missing");
  assert.equal(sourceFact.section, "Methods and Data availability");
  assert.match(sourceFact.fact, /Nb32 is added/u);
  assert.match(sourceFact.fact, /identifies 8JRU and 8JRV/u);
  assert.match(sourceFact.fact, /beta-arrestin\/scFv30 expression fusion/u);
  assert.equal(source.publishedSequence.nb32Sha256, NB32_CORE_SHA256);

  const inventories = source.allPolymerInventories.filter(row => PDB_IDS.includes(row.pdbId));
  const nb32Rows = source.nb32SequenceComparisons.filter(row => PDB_IDS.includes(row.pdbId));
  assert.deepEqual(inventories.map(row => row.pdbId), PDB_IDS);
  assert.deepEqual(nb32Rows.map(row => row.entityId), NB32_IDS);
  assert.equal(inventories.reduce((sum, row) => sum + row.polymerEntityCount, 0), 7);

  const reviews = inventories.map((inventory, index) => {
    assert.equal(inventory.primaryCitation.doi, "10.1038/s41586-023-06420-x");
    assert.equal(inventory.primaryCitation.pmid, "37558880");
    const nb32 = nb32Rows[index];
    const candidate = inventory.allDepositedPolymerEntities.find(entity => entity.rcsbId === NB32_IDS[index]);
    const arrestinScfv = inventory.allDepositedPolymerEntities.find(entity => entity.rcsbId === ARRESTIN_SCFV_IDS[index]);
    assert.ok(candidate && arrestinScfv, `${inventory.pdbId}: expected reagent entities missing`);
    assert.equal(candidate.description, "Nanobody 32");
    assert.match(arrestinScfv.description, /Beta-arrestin 1 and single-chain fragment variable 30/u);
    assert.equal(nb32.comparisonClassification, "EXACT_PUBLISHED_NB32_SEQUENCE_SEGMENT");
    assert.equal(nb32.exactCoreLength, 114);
    assert.equal(nb32.coreStart1, 3);
    assert.equal(nb32.coreEnd1, 116);
    assert.equal(nb32.coreSequenceSha256, NB32_CORE_SHA256);
    assert.equal(nb32.prefix, "MA");
    assert.equal(nb32.suffix, "HHHHHHEPEA");
    assert.equal(nb32.wholeExpressionConstructIdentical, false);

    return {
      pdbId: inventory.pdbId,
      primaryDoi: inventory.primaryCitation.doi,
      primaryPmid: inventory.primaryCitation.pmid,
      primaryDepositionLinkVerified: true,
      polymerEntityCount: inventory.polymerEntityCount,
      allDepositedPolymerEntities: inventory.allDepositedPolymerEntities.map(entityRecord),
      vhhCandidate: entityRecord(candidate),
      roleEvidence: {
        classification: "PRIMARY_SAMPLE_METHODS_PLUS_NAMED_ENTITY_AND_EXACT_PUBLISHED_NB32_CORE",
        primarySampleFact: "The entry-linked primary preparation adds Nb32 to the GCGR/V2R-tail–arrestin sample and reports an arrestin/scFv30 expression fusion.",
        independentlySourceReviewedRole: "Nb32 recognizes beta-arrestin and is an auxiliary arrestin reagent.",
        identityEvidence: {
          metadataDescriptionMatchesNamedReagent: true,
          exactPublishedCoreLength: 114,
          exactPublishedCoreSha256: nb32.coreSequenceSha256,
          depositedPrefix: nb32.prefix,
          depositedSuffix: nb32.suffix,
          wholeExpressionConstructIdentical: false,
          roleProofBySequenceAlone: false,
        },
      },
      coPresentAntibodyFormat: {
        entity: entityRecord(arrestinScfv),
        classification: "SOURCE_REPORTED_BETA_ARRESTIN_SCFV30_EXPRESSION_FUSION_NOT_VHH_TARGET",
        directReceptorVhhTargetEstablished: false,
      },
      entryDisposition: "EXCLUDE_AUXILIARY_BINDER",
      dispositionReason: "The only deposited VHH candidate is source-supported auxiliary Nb32; the other antibody-format sequence is a source-reported beta-arrestin/scFv30 fusion rather than a deposited direct receptor–VHH target.",
      unresolvedConstructDiscrepancy: "The exact Nb32 core is established, but the primary Methods tag/cleavage description does not reconcile the complete deposited prefix and suffix.",
      componentEffect: "NO_NEW_ELIGIBLE_COMPONENT",
      masterDispositionLedgerRewritten: false,
      nativeCoordinatesInspected: false,
      nativeRelativePoseInspected: false,
      structuralContactTablesInspected: false,
      labelsAccessed: false,
      predictionOutputsAccessed: false,
    };
  });

  return {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    reviewDate: "2026-09-07",
    scope: "Bounded source-and-inventory disposition review of GCGR entries 8JRU and 8JRV; not a whole-census bound or master-ledger rewrite.",
    input: { path: INPUT, sha256: INPUT_SHA256 },
    evidenceBoundary: "Previously retained primary construct/sample Methods, exact deposition statement, complete polymer inventories and primary Nb32 role/sequence evidence only.",
    authority: {
      boundedEntryDispositionAuthority: true,
      formalEligibilityAuthority: false,
      formalLeakageEdgeAuthority: false,
      formalNoEdgeAuthority: false,
      masterDispositionLedgerRewritten: false,
      wholeCensusDecisionMade: false,
      targetFreezePermitted: false,
    },
    reviews,
    summary: {
      reviewedEntryCount: 2,
      reviewedPolymerCount: 7,
      entryAuxiliaryExclusionCount: 2,
      entryDispositionPendingCount: 0,
      eligibleTargetIncrement: 0,
      independentEligibleComponentIncrement: 0,
      formallyClearedIndependentComponentCount: 0,
      wholeCensusUpperBound: null,
      targetFreezePermitted: false,
    },
    unresolved: [
      "Nb32 tag and processing-history discrepancies remain explicit but do not change the bounded auxiliary role.",
      "Formal receptor, VHH and publication graph integration remains pending.",
      "This two-entry result is not a whole-census completeness or component bound.",
    ],
  };
}

function readme(review) {
  return `# GCGR/Nb32 bounded role adjudication\n\nStatus: **8JRU and 8JRV receive bounded auxiliary-binder exclusions; zero eligible-component increment.**\n\nThe exact entry-linked primary source identifies both deposits, reports a beta-arrestin/scFv30 expression fusion, and adds Nb32 to the GCGR/V2R-tail–arrestin preparation. The only deposited VHH candidate in each complete inventory is explicitly named Nanobody 32 and contains the exact independently source-reviewed 114-residue Nb32 core. These combined facts support \`EXCLUDE_AUXILIARY_BINDER\` for both entries. Sequence identity alone is not role authority.\n\nAll ${review.summary.reviewedPolymerCount} deposited polymers are retained. The scFv30-containing entity is source-reported as a beta-arrestin fusion, not a deposited direct receptor–VHH target. The mismatch between the primary tag/cleavage description and the complete deposited Nb32 termini remains explicit; it does not alter the exact core or auxiliary role.\n\nNo master ledger or formal graph is rewritten. No coordinates, relative poses, structural Results, contact tables, labels or prediction outputs were accessed. New eligible targets and independent components: **zero**. Formally cleared independent components remain **zero**; no whole-census bound is asserted; target freeze remains blocked.\n\nVerify offline with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/adjudicate-gcgr-nb32.mjs verify\nnode --test tests/hard-decoy-v3-gcgr-nb32-adjudication.test.mjs\n\`\`\`\n`;
}

async function expectedFiles(repositoryRoot = ROOT) {
  const review = await derive(repositoryRoot);
  const files = new Map([
    ["source-reviews.json", stable(review)],
    ["manifest.json", stable({
      schemaVersion: "1.0.0",
      package: PACKAGE,
      input: review.input,
      outputFiles: ["README.md", "manifest.json", "source-reviews.json"],
      deterministicOfflineReplay: true,
      networkAccessRequiredForVerification: false,
    })],
    ["README.md", readme(review)],
  ]);
  const ordered = [...files].sort(([a], [b]) => a.localeCompare(b));
  return new Map([...ordered, ["checksums.sha256", ordered.map(([name, bytes]) => `${sha(bytes)}  ${name}\n`).join("")]]);
}

export async function buildGcgrNb32Adjudication(repositoryRoot = ROOT) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes, { flag: "wx" });
  return { built: true, output, fileCount: files.size };
}

export async function verifyGcgrNb32Adjudication(repositoryRoot = ROOT, overrides = new Map()) {
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
    reviewedEntryCount: 2,
    reviewedPolymerCount: 7,
    entryAuxiliaryExclusionCount: 2,
    independentEligibleComponentIncrement: 0,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2] ?? "verify";
  const result = command === "build" ? await buildGcgrNb32Adjudication() : await verifyGcgrNb32Adjudication();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

