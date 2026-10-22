import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const PACKAGE = "validation/hard-decoy-holdout-v3/prostanoid-role-adjudication-2026-09-06";
const INPUTS = {
  sourceReview: "validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05/source-review.json",
  allowedSections: "validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05/allowed-sections.json",
  developmentReview: "validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05/development-review.json",
  dp1Summary: "validation/hard-decoy-holdout-v3/dp1-receptor-followup-2026-09-05/summary.json",
  antiFabReview: "validation/hard-decoy-holdout-v3/auxiliary-remainder-source-review-2026-09-04/source-reviews.json",
  nb35Review: "validation/hard-decoy-holdout-v3/nb35-source-review-2026-09-04/source-reviews.json",
  historicalVhhProfiles: "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl",
};

const EXPECTED = {
  "8ZVZ": { paper: "dp1-pnas", candidate: "8ZVZ_5", section: "s12", role: "NB35_G_PROTEIN_STABILIZER", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "8ZW0": { paper: "dp1-pnas", candidate: "8ZW0_5", section: "s12", role: "NB35_G_PROTEIN_STABILIZER", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9AU0": { paper: "dp1-nature", candidate: "9AU0_4", section: "Sec17", role: "NB35_G_PROTEIN_STABILIZER", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9E9S": { paper: "dp1-nature", candidate: "9E9S_5", section: "Sec17", role: "NB35_G_PROTEIN_STABILIZER", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9EE5": { paper: "dp1-nature", candidate: "9EE5_2", section: "Sec16", role: "ANTI_FAB_FIDUCIAL_NANOBODY", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9EI5": { paper: "dp1-nature", candidate: "9EI5_3", section: "Sec16", role: "ANTI_FAB_FIDUCIAL_NANOBODY", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9EKH": { paper: "dp1-nature", candidate: "9EKH_3", section: "Sec16", role: "ANTI_FAB_FIDUCIAL_NANOBODY", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9JQY": { paper: "ep2-ep4", candidate: null, section: "Sec12", role: "CONVENTIONAL_FAB_NO_DEPOSITED_VHH_TARGET", disposition: "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE" },
  "9JQZ": { paper: "ep2-ep4", candidate: null, section: "Sec12", role: "CONVENTIONAL_FAB_NO_DEPOSITED_VHH_TARGET", disposition: "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE" },
  "9JRO": { paper: "ep2-ep4", candidate: "9JRO_3", section: "Sec11", role: "ANTI_FAB_FIDUCIAL_NANOBODY", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9JRT": { paper: "ep2-ep4", candidate: "9JRT_3", section: "Sec11", role: "ANTI_FAB_FIDUCIAL_NANOBODY", disposition: "EXCLUDE_AUXILIARY_BINDER" },
  "9UWD": { paper: "dp1-pnas", candidate: null, section: "s13", role: "NO_DEPOSITED_VHH_TARGET_IN_COMPLETE_ENTITY_INVENTORY", disposition: "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE" },
};

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stable = value => JSON.stringify(value, null, 2) + "\n";
const sorted = values => [...values].sort();
const sequence = entity => entity.entity_poly.pdbx_seq_one_letter_code_can.replace(/\s/gu, "");

async function readJson(root, relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function frozenEntity(root, review, pdbId, entityId) {
  const row = review.reviews.find(item => item.pdbId === pdbId);
  assert.ok(row, `${pdbId}: source-reviewed reference row missing`);
  const raw = await readJson(root, row.frozenMetadataPath);
  const entry = raw.data.entries.find(item => item.rcsb_id === pdbId);
  const entity = entry?.polymer_entities.find(item => item.rcsb_id === entityId);
  assert.ok(entity, `${entityId}: frozen reference entity missing`);
  return sequence(entity);
}

function inventoryEntity(entity) {
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

function sectionFor(allowed, paper, sectionId) {
  const section = allowed[paper].allowedMethods.find(item => item.sectionId === sectionId);
  assert.ok(section, `${paper}/${sectionId}: allowlisted Methods section missing`);
  return section;
}

function assertContains(section, patterns, message) {
  const text = section.paragraphs.join(" ");
  for (const pattern of patterns) assert.match(text, pattern, message);
}

async function generate(repositoryRoot = ROOT) {
  const [sourceReview, allowed, development, dp1, antiFab, nb35] = await Promise.all([
    readJson(repositoryRoot, INPUTS.sourceReview),
    readJson(repositoryRoot, INPUTS.allowedSections),
    readJson(repositoryRoot, INPUTS.developmentReview),
    readJson(repositoryRoot, INPUTS.dp1Summary),
    readJson(repositoryRoot, INPUTS.antiFabReview),
    readJson(repositoryRoot, INPUTS.nb35Review),
  ]);
  assert.deepEqual(sorted(sourceReview.entries.map(row => row.pdbId)), Object.keys(EXPECTED), "Source-review entry scope changed");

  const historicalProfiles = (await readFile(path.join(repositoryRoot, INPUTS.historicalVhhProfiles), "utf8"))
    .trimEnd().split("\n").map(line => JSON.parse(line));
  const historicalEp2 = historicalProfiles.find(row => row.pdbId === "8TB7" && row.entityId === "3");
  assert.ok(historicalEp2, "Historical 8TB7_3 VHH profile missing");

  const antiFabReference = await frozenEntity(repositoryRoot, antiFab, "6WW2", "6WW2_2");
  const antiFabSegment = antiFabReference.slice(2, 123);
  assert.equal(antiFabSegment.length, 121);
  assert.equal(sha(antiFabSegment), "494e4559fdc158a302540a71292f126e74024e664f073059b53b5fb234429884");

  const nb35Reference = await frozenEntity(repositoryRoot, nb35, "7FIM", "7FIM_1");
  const nb35Segment = nb35Reference.slice(2, 128);
  assert.equal(nb35Segment.length, 126);
  assert.equal(sha(nb35Segment), "fda5877b3a8dbedb01bb918cdb207cc90f3de83a7437151e00fd682d1c2438f3");

  const positive8qot = new Set(development.entityRows.filter(row => row.positiveDevelopmentProfileIds.length).map(row => row.entityKey));
  assert.deepEqual(sorted(positive8qot), ["9EE5_2", "9EI5_3", "9EKH_3", "9JRO_3", "9JRT_3"]);

  const rows = sourceReview.entries.map(entry => {
    const config = EXPECTED[entry.pdbId];
    assert.equal(entry.paper, config.paper, `${entry.pdbId}: publication group changed`);
    assert.equal(entry.primaryDepositionLinkVerified, true, `${entry.pdbId}: exact deposition link missing`);
    const source = allowed[config.paper];
    const section = sectionFor(allowed, config.paper, config.section);
    const candidate = config.candidate ? entry.polymers.find(entity => entity.rcsbId === config.candidate) : null;
    assert.equal(Boolean(candidate), Boolean(config.candidate), `${entry.pdbId}: candidate entity mismatch`);

    let roleEvidence;
    let sequenceRelationship = null;
    if (config.role === "ANTI_FAB_FIDUCIAL_NANOBODY") {
      assertContains(section, [/anti-Fab|Fab-stabilizing/iu, /nanobody|NbFab/iu], `${entry.pdbId}: anti-Fab nanobody source fact missing`);
      if (entry.pdbId.startsWith("9J")) {
        assert.equal(candidate.sequence, historicalEp2.fullSequence, `${entry.pdbId}: historical 8TB7_3 exact match changed`);
        sequenceRelationship = {
          classification: "EXACT_FULL_SEQUENCE_CONTEXT_ONLY",
          referenceEntity: "8TB7_3",
          candidateEntity: candidate.rcsbId,
          length: candidate.sequenceLength,
          sequenceSha256: candidate.sequenceSha256,
          roleProofBySequenceAlone: false,
        };
      } else {
        assert.equal(candidate.sequence, antiFabReference, `${entry.pdbId}: source-reviewed 6WW2 anti-Fab sequence changed`);
        sequenceRelationship = {
          classification: "EXACT_FULL_SEQUENCE_TO_SOURCE_REVIEWED_ANTI_FAB",
          referenceEntity: "6WW2_2",
          candidateEntity: candidate.rcsbId,
          length: candidate.sequenceLength,
          sequenceSha256: candidate.sequenceSha256,
          sharedSegmentLength: 121,
          sharedSegmentSha256: sha(antiFabSegment),
          roleProofBySequenceAlone: false,
        };
      }
      roleEvidence = "The entry-linked preparation identifies this entity's reagent class as an anti-Fab nanobody used with a Fab fiducial.";
    } else if (config.role === "NB35_G_PROTEIN_STABILIZER") {
      assertContains(section, [/DP1/iu, /Gs|Gα\s*s/iu, /Nb35/iu], `${entry.pdbId}: DP1/Gs/Nb35 sample fact missing`);
      const start = candidate.sequence.indexOf(nb35Segment);
      assert.ok(start >= 0 && candidate.sequence.indexOf(nb35Segment, start + 1) < 0, `${entry.pdbId}: source-reviewed Nb35 segment missing or nonunique`);
      sequenceRelationship = {
        classification: "EXACT_126_RESIDUE_SEGMENT_TO_SOURCE_REVIEWED_NB35",
        referenceEntity: "7FIM_1",
        candidateEntity: candidate.rcsbId,
        referenceStart1: 3,
        referenceEnd1: 128,
        candidateStart1: start + 1,
        candidateEnd1: start + 126,
        segmentSha256: sha(nb35Segment),
        roleProofBySequenceAlone: false,
      };
      roleEvidence = "The entry-linked preparation is DP1/Gs/Nb35; the exact sequence segment maps the deposited entity to independently source-reviewed Nb35 auxiliary-role authority.";
    } else if (config.role === "CONVENTIONAL_FAB_NO_DEPOSITED_VHH_TARGET") {
      assertContains(section, [/Fab001/iu, /heavy|Fab/iu], `${entry.pdbId}: conventional Fab source fact missing`);
      assert.equal(entry.polymers.length, 3, `${entry.pdbId}: complete three-polymer inventory changed`);
      assert.equal(entry.polymers.filter(entity => /heavy chain|light chain/iu.test(entity.description)).length, 2, `${entry.pdbId}: Fab heavy/light inventory changed`);
      roleEvidence = "The entry-linked preparation names conventional Fab001, and the complete retained inventory contains its heavy and light chains plus receptor, with no deposited single-domain target pair.";
    } else {
      assert.equal(entry.pdbId, "9UWD");
      assertContains(section, [/FabBRIL/iu, /NbFab/iu], "9UWD: experimental Fab/Nb preparation fact missing");
      assert.equal(entry.polymers.length, 1, "9UWD: complete single-polymer inventory changed");
      assert.match(entry.polymers[0].description, /Prostaglandin D2 receptor/iu, "9UWD: retained polymer is no longer the receptor");
      roleEvidence = "The source reports FabBRIL/NbFab in sample preparation, while the exact linked deposition's complete retained inventory has only the receptor polymer and therefore supplies no deposited receptor–VHH target pair.";
    }

    return {
      pdbId: entry.pdbId,
      paper: config.paper,
      primaryDoi: source.doi,
      primaryPmid: source.pmid,
      primaryDepositionLinkVerified: true,
      polymerEntityCount: entry.polymers.length,
      allPolymerEntities: entry.polymers.map(inventoryEntity),
      candidateEntity: candidate ? inventoryEntity(candidate) : null,
      roleClass: config.role,
      roleEvidence: {
        classification: "SOURCE_REPORTED_PREPARATION_FACT_PLUS_COMPLETE_DEPOSITION_INVENTORY",
        methodsSectionId: section.sectionId,
        methodsSectionTitle: section.title,
        assessment: roleEvidence,
        sequenceRelationship,
      },
      entryDisposition: config.disposition,
      dispositionReason: config.disposition === "EXCLUDE_AUXILIARY_BINDER"
        ? "The deposited VHH is a source-supported Fab- or G-protein-complex auxiliary reagent, not the direct receptor–VHH docking target required by v3."
        : "The exact linked deposition provides no deposited direct receptor–VHH target pair; experimental antibody absence outside the retained entity inventory is not claimed.",
      componentEffect: "NO_NEW_ELIGIBLE_COMPONENT",
      constructDiscrepanciesPreserved: true,
      masterDispositionLedgerRewritten: false,
      nativeCoordinatesInspected: false,
      nativeRelativePoseInspected: false,
      structuralContactTablesInspected: false,
      structuralResultsInspected: false,
      labelsAccessed: false,
      predictionOutputsAccessed: false,
      evidenceUrls: [`https://doi.org/${source.doi}`, `https://www.rcsb.org/structure/${entry.pdbId}`],
    };
  }).sort((a, b) => a.pdbId.localeCompare(b.pdbId));

  const review = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    reviewDate: "2026-09-06",
    scope: "Bounded source-and-inventory disposition review of the twelve retained prostanoid entries; not a whole-census bound or master-ledger rewrite.",
    evidenceBoundary: "Preparation Methods, exact deposition statements, complete retained polymer inventories, canonical/reference sequence evidence and prior source-reviewed auxiliary-role authorities only. No coordinates, poses, contacts, structural Results, labels or predictions.",
    authority: {
      boundedEntryDispositionAuthority: true,
      formalEligibilityAuthority: false,
      formalLeakageEdgeAuthority: false,
      formalNoEdgeAuthority: false,
      masterDispositionLedgerRewritten: false,
      wholeCensusDecisionMade: false,
      wholeCensusUpperBound: null,
      targetFreezePermitted: false,
    },
    retainedOverlapSignals: {
      sameDp1EntryPairCount: dp1.sameReceptorPairCount,
      crossPaperSameDp1EntryPairCount: dp1.crossPaperSameReceptorPairCount,
      primaryCrossReceptorAccessions: dp1.primaryCrossReceptorAccessions,
      sensitivityCrossReceptorAccessions: dp1.sensitivityCrossReceptorAccessions,
      graphAuthority: false,
      note: "Excluded entries add no eligible component; these receptor signals remain available for later global graph accounting and are not manually converted into edges here.",
    },
    unresolvedConstructItems: sourceReview.openItems,
    reviews: rows,
    summary: {
      reviewedEntryCount: 12,
      reviewedPolymerCount: rows.reduce((sum, row) => sum + row.polymerEntityCount, 0),
      entryAuxiliaryExclusionCount: rows.filter(row => row.entryDisposition === "EXCLUDE_AUXILIARY_BINDER").length,
      entryNoDirectTargetExclusionCount: rows.filter(row => row.entryDisposition === "EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE").length,
      boundedEntryExclusionCount: rows.length,
      entryDispositionPendingCount: 0,
      sourceGroupIndependentComponentIncrement: 0,
      newFormallyClearedIndependentComponents: 0,
      wholeCensusUpperBound: null,
      targetFreezePermitted: false,
    },
  };
  assert.deepEqual(review.summary, {
    reviewedEntryCount: 12,
    reviewedPolymerCount: 47,
    entryAuxiliaryExclusionCount: 9,
    entryNoDirectTargetExclusionCount: 3,
    boundedEntryExclusionCount: 12,
    entryDispositionPendingCount: 0,
    sourceGroupIndependentComponentIncrement: 0,
    newFormallyClearedIndependentComponents: 0,
    wholeCensusUpperBound: null,
    targetFreezePermitted: false,
  });
  return review;
}

async function inputManifest(repositoryRoot) {
  const inputs = [];
  for (const relative of Object.values(INPUTS)) {
    const bytes = await readFile(path.join(repositoryRoot, relative));
    inputs.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
  }
  return inputs;
}

function readme(review) {
  return `# Prostanoid binder-role and target-format adjudication\n\nStatus: **12 bounded entry exclusions supported; zero eligible-component increment; v3 freeze remains blocked.**\n\nThis packet converts the retained preparation Methods and complete polymer inventories from the EP2/EP4 and DP1 source reviews into entry-level dispositions without changing the historical 287-entry ledger. Nine entries contain source-supported auxiliary VHH reagents: EP2 and inactive DP1 use anti-Fab nanobodies, while active DP1 uses Nb35 with Gs. EP4 has a conventional Fab heavy/light pair rather than a deposited VHH target, and 9UWD's exact linked deposition contains only one receptor polymer despite the paper's FabBRIL/NbFab preparation. That bounded inventory fact does not claim that experimental antibodies were absent.\n\n| Disposition | Entries | Count |\n| --- | --- | ---: |\n| EXCLUDE_AUXILIARY_BINDER | 8ZVZ, 8ZW0, 9AU0, 9E9S, 9EE5, 9EI5, 9EKH, 9JRO, 9JRT | 9 |\n| EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE | 9JQY, 9JQZ, 9UWD | 3 |\n\nThe sequence checks are contextual, not role authority by themselves: EP2 Nb exactly matches historical 8TB7_3; the three inactive-DP1 anti-Fab nanobodies exactly match source-reviewed 6WW2_2; and all four active-DP1 Nb35 entities contain the same 126-residue segment as source-reviewed 7FIM_1. Entry-specific preparation text and exact deposition linkage supply the role/format evidence.\n\nAll ${review.summary.reviewedPolymerCount} retained polymers remain enumerated. The EP4 boundary discrepancy, DP1 tag/boundary discrepancies, EP2 fusion provenance, and 9UWD experimental-versus-deposited coverage discrepancy remain explicit. They do not create a direct deposited VHH target in these entries and therefore do not block the bounded exclusions. DP1 same-receptor and DP1–EP2/EP4 comparison signals remain graph-pending.\n\nNo independent eligible group is added or removed from the formally cleared count because none was cleared before this packet. No whole-census bound is asserted, the master disposition ledger is unchanged, prior exposure records remain applicable, and target freeze remains blocked.\n\nVerify deterministically with:\n\n\`\`\`bash\nnode scripts/hard-decoy-v3/adjudicate-prostanoid-roles.mjs verify\nnode --test tests/hard-decoy-v3-prostanoid-role-adjudication.test.mjs\n\`\`\`\n`;
}

export async function buildProstanoidRoleAdjudication(repositoryRoot = ROOT) {
  const review = await generate(repositoryRoot);
  const directory = path.join(repositoryRoot, PACKAGE);
  await mkdir(directory, { recursive: true });
  const manifest = {
    schemaVersion: "1.0.0",
    generatedBy: "scripts/hard-decoy-v3/adjudicate-prostanoid-roles.mjs",
    inputs: await inputManifest(repositoryRoot),
    outputSummary: review.summary,
  };
  const outputs = { "README.md": readme(review), "manifest.json": stable(manifest), "source-reviews.json": stable(review) };
  for (const [name, contents] of Object.entries(outputs)) await writeFile(path.join(directory, name), contents);
  const checksums = Object.entries(outputs).sort(([a], [b]) => a.localeCompare(b)).map(([name, contents]) => `${sha(contents)}  ${name}`).join("\n") + "\n";
  await writeFile(path.join(directory, "checksums.sha256"), checksums);
  return review.summary;
}

export async function verifyProstanoidRoleAdjudication(repositoryRoot = ROOT, suppliedReview) {
  const expected = await generate(repositoryRoot);
  const directory = path.join(repositoryRoot, PACKAGE);
  const actual = suppliedReview ?? await readJson(repositoryRoot, `${PACKAGE}/source-reviews.json`);
  assert.deepEqual(actual, expected, "Prostanoid role adjudication differs from deterministic source evidence");
  if (suppliedReview === undefined) {
    const manifest = await readJson(repositoryRoot, `${PACKAGE}/manifest.json`);
    assert.deepEqual(manifest.inputs, await inputManifest(repositoryRoot), "Input hash manifest changed");
    assert.deepEqual(manifest.outputSummary, expected.summary, "Manifest summary changed");
    const expectedNames = ["README.md", "manifest.json", "source-reviews.json"];
    const checksumText = await readFile(path.join(directory, "checksums.sha256"), "utf8");
    const seen = [];
    for (const line of checksumText.trimEnd().split("\n")) {
      const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
      assert.ok(match, "Malformed checksum line");
      assert.ok(expectedNames.includes(match[2]), `Unexpected checksummed file: ${match[2]}`);
      seen.push(match[2]);
      assert.equal(sha(await readFile(path.join(directory, match[2]))), match[1], `${match[2]} checksum mismatch`);
    }
    assert.deepEqual(sorted(seen), expectedNames, "Checksum coverage changed");
  }
  return { verified: true, ...expected.summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2] ?? "verify";
  const result = command === "build"
    ? await buildProstanoidRoleAdjudication()
    : command === "verify"
      ? await verifyProstanoidRoleAdjudication()
      : assert.fail(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
