import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/auxiliary-inventory-adjudication-2026-09-07";
const INPUT = "validation/hard-decoy-holdout-v3/auxiliary-remainder-source-review-2026-09-04/source-reviews.json";
const INPUT_SHA256 = "17e89335abe2b1539b515b3171c15efd4f532801db2e4c1a36f4515e7e6c4a5a";
const PDB_IDS = ["8JBG", "8XVJ", "8XVK", "8XVL"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => `${JSON.stringify(value, null, 2)}\n`;

async function readInput(root) {
  const filename = path.resolve(root, INPUT);
  const info = await lstat(filename, { bigint: true });
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, "Input must be one direct regular file");
  assert.equal(await realpath(filename), filename, "Input path cannot contain symlinks");
  assert.ok(info.size < 16n * 1024n * 1024n, "Input exceeds its byte cap");
  const bytes = await readFile(filename);
  assert.equal(sha(bytes), INPUT_SHA256, "Bound auxiliary source review changed");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function entity(entity) {
  return {
    rcsbEntityId: entity.rcsbEntityId,
    entityId: entity.entityId,
    description: entity.description,
    asymIds: entity.asymIds,
    authAsymIds: entity.authAsymIds,
    sequenceLength: entity.sequenceLength,
    sequenceSha256: entity.sequenceSha256,
  };
}

async function derive(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  assert.equal(root, path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors");
  const source = await readInput(root);
  assert.equal(source.summary.reviewedEntryCount, 16);
  assert.equal(source.summary.entryPendingInventoryReconciliationCount, 4);
  assert.deepEqual(source.summary.pendingPdbIds, PDB_IDS);
  const selected = source.reviews.filter(row => PDB_IDS.includes(row.pdbId));
  assert.deepEqual(selected.map(row => row.pdbId), PDB_IDS);

  const reviews = selected.map(row => {
    assert.equal(row.entryDisposition, "PENDING_REQUIRED_METADATA");
    assert.equal(row.candidateEntityDisposition, "EXCLUDE_AUXILIARY_BINDER");
    assert.equal(row.depositionLinkage.pdbIdExplicitlyNamed, true);
    assert.equal(row.allFrozenPolymerEntities.length, row.frozenPolymerEntityCount);
    assert.equal(row.nativeCoordinatesInspected, false);
    assert.equal(row.nativeRelativePoseInspected, false);
    assert.equal(row.labelsAccessed, false);
    assert.equal(row.targetFreezePermitted, false);
    const depositedIds = new Set(row.allFrozenPolymerEntities.map(item => item.rcsbEntityId));
    assert.equal(depositedIds.size, row.frozenPolymerEntityCount);
    assert.ok(depositedIds.has(row.candidateEntity.rcsbEntityId));
    const sourceOnly = row.sourceOnlyAntibodyReagents.map(reagent => ({ ...reagent }));
    assert.ok(sourceOnly.every(reagent => reagent.presentAsSeparateFrozenEntity === false));

    const isNkb = row.pdbId === "8JBG";
    if (isNkb) {
      assert.equal(row.candidateRoleClass, "SCFV16_G_PROTEIN_STABILIZER");
      assert.equal(row.candidateEntity.description, "ScFv16 nanobody");
      assert.equal(row.candidateEntity.sequenceLength, 304);
      assert.equal(row.otherAntibodyEntities.length, 0);
      assert.deepEqual(sourceOnly.map(reagent => reagent.name), ["Nb35"]);
    } else {
      assert.equal(row.candidateRoleClass, "ANTI_FAB_FIDUCIAL_NANOBODY");
      assert.equal(row.candidateEntity.description, "anti-Fab Nanobody");
      assert.equal(row.otherAntibodyEntities.length, 2);
      assert.ok(row.otherAntibodyEntities.every(item => item.sourceSupportedFormat === "FAB_HEAVY_OR_LIGHT_CHAIN"));
      assert.deepEqual(sourceOnly.map(reagent => reagent.name), ["Fab301"]);
    }

    return {
      pdbId: row.pdbId,
      primaryCitation: row.frozenPrimaryCitation,
      primaryDepositionLinkVerified: true,
      depositionLinkage: row.depositionLinkage,
      polymerEntityCount: row.frozenPolymerEntityCount,
      allDepositedPolymerEntities: row.allFrozenPolymerEntities.map(entity),
      reviewedAuxiliaryEntity: entity(row.candidateEntity),
      roleEvidence: {
        classification: row.candidateRoleClass,
        sourceEvidence: row.candidateRoleEvidence,
        sequenceIdentityAloneUsedAsRoleProof: false,
      },
      otherDepositedAntibodyEntities: row.otherAntibodyEntities.map(entity),
      sourceOnlyAntibodyReagents: sourceOnly,
      preservedInventoryDiscrepancies: row.entryAssessment.unresolvedDiscrepancies,
      inventoryAdjudication: isNkb
        ? "The complete six-polymer deposition contains only the source-reviewed scFv16 G-protein stabilizer as an antibody-format entity; source-reported modeled Nb35 is not a separate deposited target."
        : "The complete four-polymer deposition contains one source-reviewed anti-Fab nanobody and conventional Fab heavy/light chains; source-reported Fab301 is not a separate deposited VHH target.",
      entryDisposition: "EXCLUDE_AUXILIARY_BINDER",
      dispositionReason: "Every deposited VHH or antibody-format candidate is source-supported as an auxiliary stabilization/fiducial reagent or a conventional Fab; no deposited direct receptor-binding VHH target remains after complete inventory accounting.",
      componentEffect: "NO_NEW_ELIGIBLE_COMPONENT",
      masterDispositionLedgerRewritten: false,
      formalLeakageGraphAuthority: false,
      formalNoEdgeAuthority: false,
      nativeCoordinatesInspected: false,
      nativeRelativePoseInspected: false,
      structuralContactTablesInspected: false,
      labelsAccessed: false,
      predictionOutputsAccessed: false,
      targetFreezePermitted: false,
    };
  });

  return {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    reviewDate: "2026-09-07",
    scope: "Bounded complete-inventory adjudication of 8JBG, 8XVJ, 8XVK and 8XVL; not a whole-census decision.",
    input: { path: INPUT, sha256: INPUT_SHA256 },
    authority: {
      boundedEntryDispositionAuthority: true,
      formalEligibilityAuthority: false,
      formalLeakageGraphAuthority: false,
      formalNoEdgeAuthority: false,
      masterDispositionLedgerRewritten: false,
      wholeCensusDecisionMade: false,
      targetFreezePermitted: false,
    },
    reviews,
    summary: {
      reviewedEntryCount: reviews.length,
      reviewedPolymerCount: reviews.reduce((total, row) => total + row.polymerEntityCount, 0),
      entryAuxiliaryExclusionCount: reviews.length,
      entryDispositionPendingCount: 0,
      eligibleTargetIncrement: 0,
      independentEligibleComponentIncrement: 0,
      formallyClearedIndependentComponentCount: 0,
      wholeCensusUpperBound: null,
      targetFreezePermitted: false,
    },
    unresolved: [
      "The source-to-deposition naming discrepancies remain explicit; they do not create a deposited direct receptor-binding VHH target.",
      "Formal receptor, VHH and publication graph integration remains pending.",
      "This four-entry review is not a whole-census completeness or component bound.",
    ],
  };
}

function readme() {
  return `# Auxiliary-inventory bounded adjudication\n\nStatus: **8JBG, 8XVJ, 8XVK and 8XVL receive bounded auxiliary-binder exclusions; zero eligible-component increment.**\n\nThe retained primary-source review already establishes the role of every deposited VHH or antibody-format candidate. This follow-up checks those roles against each complete deposited polymer inventory rather than treating a source-only reagent name as another deposited chain.\n\n8JBG contains six polymers. Its only deposited antibody-format entity is source-reviewed scFv16, a G-protein-complex stabilizer; the paper's modeled Nb35 is not a separate deposited entity. Each ETA entry contains four polymers: one source-reviewed anti-Fab nanobody, conventional Fab heavy/light chains, and receptor construct. Source-reported Fab301 is not a separate deposited VHH entity. These facts support \`EXCLUDE_AUXILIARY_BINDER\` for all four entries.\n\nThe Nb35/Fab301 source-to-deposition naming discrepancies remain explicit. They do not establish reagent absence, but they also cannot manufacture a deposited direct receptor-binding VHH target. No master ledger or formal graph is rewritten. No coordinates, relative poses, structural contact tables, labels, prediction outputs or performance results were accessed. Formally cleared independent components remain zero and target freeze remains blocked.\n\nVerify offline with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/adjudicate-auxiliary-inventory-remainders.mjs verify\nnode --test tests/hard-decoy-v3-auxiliary-inventory-adjudication.test.mjs\n\`\`\`\n`;
}

async function expectedFiles(repositoryRoot = ROOT) {
  const review = await derive(repositoryRoot);
  const files = new Map([
    ["source-reviews.json", stable(review)],
    ["README.md", readme()],
    ["manifest.json", stable({
      schemaVersion: "1.0.0",
      package: PACKAGE,
      input: review.input,
      deterministicOfflineReplay: true,
      networkAccessRequiredForVerification: false,
      outputFiles: ["README.md", "manifest.json", "source-reviews.json"],
    })],
  ]);
  const ordered = [...files].sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)));
  files.set("checksums.sha256", ordered.map(([name, bytes]) => `${sha(bytes)}  ${name}\n`).join(""));
  return files;
}

export async function buildAuxiliaryInventoryAdjudication(repositoryRoot = ROOT) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(output, name), bytes, { flag: "wx" });
  return { built: true, output, fileCount: files.size };
}

export async function verifyAuxiliaryInventoryAdjudication(repositoryRoot = ROOT, overrides = new Map()) {
  const files = await expectedFiles(repositoryRoot);
  const output = path.join(repositoryRoot, PACKAGE);
  assert.deepEqual((await readdir(output)).sort(), [...files.keys()].sort(), "Package file inventory changed");
  for (const [name, expected] of files) {
    const filename = path.join(output, name);
    const info = await lstat(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, `${name} must be one direct regular file`);
    const actual = overrides.has(name) ? overrides.get(name) : await readFile(filename, "utf8");
    assert.equal(actual, expected, `${name} differs from deterministic source evidence`);
  }
  const review = await derive(repositoryRoot);
  return {
    verified: true,
    reviewedEntryCount: review.summary.reviewedEntryCount,
    reviewedPolymerCount: review.summary.reviewedPolymerCount,
    entryAuxiliaryExclusionCount: review.summary.entryAuxiliaryExclusionCount,
    independentEligibleComponentIncrement: 0,
    formallyClearedIndependentComponentCount: 0,
    targetFreezePermitted: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2] ?? "verify";
  const result = command === "build" ? await buildAuxiliaryInventoryAdjudication() : await verifyAuxiliaryInventoryAdjudication();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
