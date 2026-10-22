import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCanonicalTmProfile, alignGlobalAffineWithCoverage, evaluateFrozenReceptorThreshold } from "../hard-decoy/v3-receptor-tm-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASE = "validation/hard-decoy-holdout-v3/";
export const PACKET = BASE + "dp1-receptor-followup-2026-09-05";
const PREVIOUS = BASE + "prostanoid-source-review-2026-09-05/";
const IDS = ["8ZVZ", "8ZW0", "9AU0", "9E9S", "9EE5", "9EI5", "9EKH", "9UWD"];
const INPUTS = ["HARD_DECOY_PROTOCOL_V3.md", "scripts/hard-decoy-v3/review-dp1-receptor.mjs",
  "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs", PREVIOUS + "source-review.json",
  ...["Q13258", "P43116", "P35408"].map((a) => PREVIOUS + `sources/uniprot-${a}.body`),
  BASE + "receptor-tm-contract-2026-08-30.json",
  ...["development", "candidate"].map((n) => BASE + `receptor-tm-pregraph-2026-08-30/${n}-receptor-profiles.jsonl`)];
const AUTHORITY = { formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false, formalEligibilityAuthority: false,
  formalExclusionAuthority: false, newIndependentComponents: 0, wholeCensusUpperBound: null, targetFreezePermitted: false };
const sha = (data) => createHash("sha256").update(data).digest("hex");
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const rows = (file) => fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
const digest = (file) => { const data = fs.readFileSync(file); return { bytes: data.length, sha256: sha(data) }; };

export function extractVerifiedDp1(raw, residues, uniprot) {
  assert.equal(raw.accession, "Q13258", "Wrong GPCRdb accession");
  assert.equal(uniprot.primaryAccession, "Q13258", "Wrong independent canonical accession");
  assert.equal(raw.source.toUpperCase(), "SWISSPROT", "Noncanonical source");
  assert.match(raw.entry_name, /^[a-z0-9_-]+$/u);
  assert.ok(raw.family.startsWith("0"));
  assert.match(raw.sequence, /^[ACDEFGHIKLMNPQRSTVWY]+$/u);
  assert.equal(raw.sequence, uniprot.sequence.value, "GPCRdb and retained UniProt canonical sequences disagree");
  assert.equal(residues.length, raw.sequence.length, "Incomplete full canonical residue inventory");
  const positions = residues.map((r) => r.sequence_number).sort((a, b) => a - b);
  assert.deepEqual(positions, Array.from({ length: raw.sequence.length }, (_, i) => i + 1), "Duplicate or missing residue position");
  const protein = { entryName: raw.entry_name, canonicalAccession: raw.accession, canonicalSequence: raw.sequence,
    canonicalSequenceLength: raw.sequence.length, canonicalSequenceSha256: sha(raw.sequence) };
  const profile = extractCanonicalTmProfile(protein, residues);
  assert.equal(profile.extractionStatus, "RESOLVED_CANONICAL_TM1_TM7", profile.failureCode);
  assert.equal(profile.tmSegments.length, 7);
  for (const tm of profile.tmSegments) assert.equal(tm.residueCount, tm.sequenceEnd - tm.sequenceStart + 1, "Noncontiguous canonical TM segment");
  return { ...profile, family: raw.family, species: raw.species, ...AUTHORITY,
    canonicalReferenceOnly: true, depositedConstructMappingResolved: false };
}

export function compareProfiles(left, right, contract) {
  for (const profile of [left, right]) assert.equal(sha(profile.concatenatedTmSequence), profile.concatenatedTmSequenceSha256);
  const alignment = alignGlobalAffineWithCoverage(left.concatenatedTmSequence, right.concatenatedTmSequence, contract.alignment);
  const leftIsA = Buffer.from(left.concatenatedTmSequence).compare(Buffer.from(right.concatenatedTmSequence)) <= 0;
  const namedCoverage = { leftSequenceSha256: left.concatenatedTmSequenceSha256, rightSequenceSha256: right.concatenatedTmSequenceSha256,
    leftAlignmentSide: leftIsA ? "A" : "B", leftCoverage: leftIsA ? alignment.coverageA : alignment.coverageB,
    rightCoverage: leftIsA ? alignment.coverageB : alignment.coverageA };
  return { alignment, namedCoverage, criterion: evaluateFrozenReceptorThreshold(alignment, contract.thresholds), ...AUTHORITY };
}

function readCapture(directory, name, expectedUrl) {
  const successful = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const stem = path.join(directory, "sources", `${name}-attempt-${attempt}`);
    if (!fs.existsSync(stem + ".json")) continue;
    const meta = json(stem + ".json"), data = fs.readFileSync(stem + ".body");
    assert.equal(meta.url, expectedUrl);
    assert.equal(meta.sha256, sha(data)); assert.equal(meta.bytes, data.length);
    assert.equal(meta.captureScriptSha256, digest(path.join(directory, "capture.py")).sha256);
    assert.equal(meta.planSha256, digest(path.join(directory, "capture-plan.json")).sha256);
    if (meta.status === 200) successful.push(JSON.parse(data));
  }
  assert.equal(successful.length, 1, "Expected exactly one successful bounded capture");
  return successful[0];
}

export function buildDp1Review({ repositoryRoot = ROOT, directory = path.join(repositoryRoot, PACKET) } = {}) {
  const read = (name) => json(path.join(repositoryRoot, name));
  const plan = json(path.join(directory, "capture-plan.json"));
  assert.deepEqual(plan.accessions, ["Q13258"]); assert.equal(plan.captureCount, 2);
  const canonical = read(PREVIOUS + "sources/uniprot-Q13258.body");
  const profiles = [1, 2].map((repeat) => {
    const raw = readCapture(directory, `protein-${repeat}`, plan.proteinEndpoint);
    const residues = readCapture(directory, `residues-${repeat}`, plan.residuesEndpointTemplate.replace("{entry_name}", raw.entry_name));
    return extractVerifiedDp1(raw, residues, canonical);
  });
  assert.deepEqual(profiles[0], profiles[1], "Repeated canonical captures disagree");
  const profile = profiles[0];
  const contract = read(BASE + "receptor-tm-contract-2026-08-30.json");
  const development = rows(path.join(repositoryRoot, BASE + "receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl"));
  assert.equal(development.length, 17); assert.equal(new Set(development.map((r) => r.nodeId)).size, 17);
  const developmentPairs = development.map((reference) => {
    assert.equal(reference.mappingStatus, "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7");
    return { pairId: `Q13258|${reference.nodeId}`, referenceNode: reference.nodeId,
      referenceAccession: reference.canonicalAccession, ...compareProfiles(profile, reference, contract) };
  });
  const source = read(PREVIOUS + "source-review.json");
  const entries = source.entries.filter((e) => IDS.includes(e.pdbId));
  assert.deepEqual(entries.map((e) => e.pdbId).sort(), IDS);
  const accounting = entries.map((entry) => {
    const receptor = entry.polymers.filter((e) => e.referenceSequences.some((r) => r.databaseName === "UniProt" && r.databaseAccession === "Q13258"));
    assert.equal(receptor.length, 1, "Ambiguous receptor entity");
    return { pdbId: entry.pdbId, receptorEntityId: receptor[0].entityId, paper: entry.paper,
      polymerCount: entry.polymers.length, heavyDomainCallCount: entry.polymers.reduce((n, e) => n + e.numberedHeavyDomainCallCount, 0),
      canonicalReferenceAccession: "Q13258", depositedConstructResolved: false, ...AUTHORITY };
  });
  const entryDevelopmentPairs = accounting.flatMap((entry) => developmentPairs.map((pair) => ({
    pairId: `${entry.pdbId}|${pair.referenceNode}`, pdbId: entry.pdbId, canonicalComparisonId: pair.pairId,
    criterion: pair.criterion, conditionalOnReceptorAndConstructAdjudication: true, ...AUTHORITY })));
  assert.equal(entryDevelopmentPairs.length, 136);
  const candidates = rows(path.join(repositoryRoot, BASE + "receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl"));
  const crossReceptorPairs = ["P43116", "P35408"].map((accession) => {
    const references = candidates.filter((p) => p.canonicalAccession === accession);
    assert.ok(references.length);
    assert.equal(new Set(references.map((p) => p.concatenatedTmSequenceSha256)).size, 1);
    const reference = references[0], independent = read(PREVIOUS + `sources/uniprot-${accession}.body`);
    assert.equal(reference.mappingStatus, "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7");
    assert.equal(reference.canonicalSequenceSha256, sha(independent.sequence.value), "Retained comparison profile canonical sequence mismatch");
    return { pairId: `Q13258|${accession}`, referenceAccession: accession, referenceNodes: references.map((p) => p.nodeId),
      referenceProfileEpoch: "2026-08-30", dp1ProfileEpoch: "2026-09-05", ...compareProfiles(profile, reference, contract) };
  });
  const sameReceptorPairs = [];
  for (let i = 0; i < accounting.length; i++) for (let j = i + 1; j < accounting.length; j++) {
    const a = accounting[i], b = accounting[j];
    sameReceptorPairs.push({ pairId: `${a.pdbId}|${b.pdbId}`, left: a.pdbId, right: b.pdbId,
      canonicalAccession: "Q13258", sharedPrimaryPaper: a.paper === b.paper,
      exactDepositedSequenceIdentityClaim: false, independentComponentClaim: false, ...AUTHORITY });
  }
  assert.equal(sameReceptorPairs.length, 28);
  const summary = { status: "CANONICAL_RECEPTOR_REVIEW_ONLY_FREEZE_BLOCKED", entryCount: 8, polymerCount: 33,
    canonicalLength: profile.canonicalSequenceLength, tmLength: profile.concatenatedTmSequenceLength,
    repeatedCaptureAgreement: true, independentUniProtSequenceAgreement: true,
    uniqueDevelopmentPairCount: 17, entryDevelopmentPairCount: 136, crossReceptorPairCount: 2, sameReceptorPairCount: 28,
    crossPaperSameReceptorPairCount: sameReceptorPairs.filter((p) => !p.sharedPrimaryPaper).length,
    positiveDevelopmentNodes: developmentPairs.filter((p) => p.criterion.primaryThresholdSatisfied).map((p) => p.referenceNode),
    sensitivityVetoDevelopmentNodes: developmentPairs.filter((p) => p.criterion.sensitivityThresholdSatisfied).map((p) => p.referenceNode),
    primaryCrossReceptorAccessions: crossReceptorPairs.filter((p) => p.criterion.primaryThresholdSatisfied).map((p) => p.referenceAccession),
    sensitivityCrossReceptorAccessions: crossReceptorPairs.filter((p) => p.criterion.sensitivityThresholdSatisfied).map((p) => p.referenceAccession),
    receptorOnlyEntryIncluded: "9UWD", sourceConstructDiscrepanciesRemainUnresolved: true,
    nativeCoordinatesAccessed: false, nativePosesAccessed: false, labelsAccessed: false, predictionOutputsAccessed: false,
    priorExposureRecordsPreserved: true, ...AUTHORITY };
  const files = {
    "profile.json": encode(profile), "development-pairs.json": encode(developmentPairs),
    "entry-development-pairs.json": encode(entryDevelopmentPairs), "cross-receptor-pairs.json": encode(crossReceptorPairs),
    "same-receptor-pairs.json": encode(sameReceptorPairs), "entry-accounting.json": encode(accounting), "summary.json": encode(summary),
  };
  files["README.md"] = `# DP1 canonical receptor follow-up, 5 September 2026\n\nThis follows PR #45 without repeating its primary-source review. Four new GPCRdb responses capture Q13258 and its complete residue inventory twice. All 359 canonical positions are present, agree with the retained independent UniProt sequence, and yield ${summary.tmLength} TM1–TM7 residues using the unchanged frozen extractor. Raw bytes, timestamps, capture plan and source-code hashes are retained.\n\nThe new canonical profile closes the missing-reference limitation for the seven heavy-positive DP1 entries and additionally includes receptor-only **9UWD**, without treating absent heavy-domain calls as evidence of antibody absence. All eight entries and 33 polymers remain accounted for. We calculate all 17 unique development comparisons and explicitly map them to all **136 entry/reference pairs**. Primary development signals: ${summary.positiveDevelopmentNodes.join(", ") || "none"}. Veto-only sensitivity signals (including any primary signals): ${summary.sensitivityVetoDevelopmentNodes.join(", ") || "none"}. A nonmatch is not proof of independence.\n\n## Subsequent cross-publication and receptor review\n\nAll **28 unordered DP1 entry pairs** share the Q13258 annotation; **${summary.crossPaperSameReceptorPairCount} pairs cross the two primary publications**. This is canonical receptor evidence, not identity of engineered deposits or a formal component certificate. DP1 was also compared with the already retained EP2 and EP4 canonical profiles; these two comparisons were missing from the earlier review.\n\n| Comparison | Identical / alignment columns | Coverage, DP1 / reference | Primary criterion | Sensitivity criterion |\n| --- | --- | --- | --- | --- |\n${crossReceptorPairs.map((p) => `| DP1 / ${p.referenceAccession} | ${p.alignment.identicalResidueColumns} / ${p.alignment.alignmentColumns} | ${p.namedCoverage.leftCoverage} / ${p.namedCoverage.rightCoverage} | ${p.criterion.primaryThresholdSatisfied} | ${p.criterion.sensitivityThresholdSatisfied} |`).join("\n")}\n\nThe primary criterion is the unchanged 40% identity and 80% coverage on both sides; 30% identity is a veto-only sensitivity criterion, not an independently selected cutoff. Exact frozen rational comparisons, all alignment counts and gap metrics are retained. EP2/EP4 reference profiles retain their original 30 August epoch; their canonical sequence hashes match the 5 September UniProt captures. No deployed GPCRdb/source-commit equivalence is claimed.\n\n## Limits\n\nThese are **canonical-reference comparisons**, not a claim that an engineered deposited receptor has the same transmembrane sequence or experimental construct. All PR #45 range, tag, fusion, binder-role and 9UWD polymer-coverage discrepancies remain open. No frozen profile, protocol, ledger or formal graph is changed. New independent components: **zero**; whole-census upper bound: **unknown**; V3 remains **DRAFT/BLOCKED**. Prior exposure records remain applicable. No coordinates, poses, contact tables, Results, labels or prediction outputs were accessed.\n\nSources: [GPCRdb accession record](https://gpcrdb.org/services/protein/accession/Q13258/), [GPCRdb canonical residues](https://gpcrdb.org/services/residues/pd2r_human/), and the independently captured [UniProt Q13258 record](https://rest.uniprot.org/uniprotkb/Q13258.json) retained in the preceding source packet. GPCRdb data attribution and CC BY 4.0 license follow the frozen receptor snapshot's [legal notice](https://docs.gpcrdb.org/legal_notice.html).\n\n## Offline reproduction\n\nRun from the repository root:\n\n\`node scripts/hard-decoy-v3/review-dp1-receptor.mjs verify\`\n\nVerification rebuilds every result from the four retained responses and bound prior inputs, compares repeats and canonical sequences, checks all pair counts, and rejects changed/missing/extra files. It performs no network calls. Tests also exercise incomplete residue inventories, repeat disagreement, wrong accessions, sequence mutation, relocation and output tampering.\n\nNext: adjudicate the source-supported binder-role and canonical receptor/development relationships alongside the preserved construct/exposure discrepancies. The reviewed pair lists are inputs to that formal review, not completed eligibility decisions.\n`;
  return { files, summary };
}

function inventory(directory) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name); assert.ok(!e.isSymbolicLink(), "Symlink in packet");
    return e.isDirectory() ? walk(p) : [p];
  });
  return walk(directory).filter((p) => p !== path.join(directory, "checksums.sha256")).sort().map((p) => `${digest(p).sha256}  ${path.relative(directory, p)}\n`).join("");
}

export function runDp1Review(mode, { repositoryRoot = ROOT, directory = path.join(repositoryRoot, PACKET) } = {}) {
  assert.ok(["collect", "verify"].includes(mode));
  const inputBindings = Object.fromEntries(INPUTS.map((name) => [name, digest(path.join(repositoryRoot, name))]));
  let manifest;
  if (mode === "verify") {
    assert.equal(fs.readFileSync(path.join(directory, "checksums.sha256"), "utf8"), inventory(directory), "Packet inventory mismatch");
    manifest = json(path.join(directory, "manifest.json")); assert.deepEqual(manifest.inputBindings, inputBindings, "Input binding mismatch");
  }
  const { files, summary } = buildDp1Review({ repositoryRoot, directory });
  const outputs = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: sha(content) }]));
  if (mode === "collect") {
    assert.ok(!fs.existsSync(path.join(directory, "manifest.json")), "Refusing to overwrite packet");
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, { flag: "wx" });
    fs.writeFileSync(path.join(directory, "manifest.json"), encode({ inputBindings, outputs, authority: AUTHORITY }), { flag: "wx" });
    fs.writeFileSync(path.join(directory, "checksums.sha256"), inventory(directory), { flag: "wx" });
  } else {
    assert.deepEqual(manifest.outputs, outputs); assert.deepEqual(manifest.authority, AUTHORITY);
    for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(directory, name), "utf8"), content, `Replay mismatch: ${name}`);
  }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(encode(runDp1Review(process.argv[2])));
}
