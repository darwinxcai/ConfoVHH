import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  createPredictionRunManifest,
  predictionRunFileById,
} from "../lib/prediction-run.ts";
import { executePredictionRunAuditJob } from "../lib/prediction-run-jobs.ts";

const ZENODO_BASE = "https://zenodo.org/api/records/17063524/files";
const AF3_COMMIT = "a7458d1d26a35154cbfc3e24ec197352079970df";
const AF3_BASE = `https://raw.githubusercontent.com/martinovein/AF3_MiniPAE/${AF3_COMMIT}/data/example/p06730_o60516`;

const colabfoldFiles = [
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_scores_rank_001_alphafold2_multimer_v3_model_2_seed_000.json", 1502786, "1c9fa562705472cfd4229804ad4f87653887c007959b3ce90b757ec0763c8ada"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_scores_rank_002_alphafold2_multimer_v3_model_5_seed_000.json", 1503317, "85c1ac6a160cbc9e3b9d9c1bcaea1a14c02359e8e80c44a52aea9194e4d2aa49"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_scores_rank_003_alphafold2_multimer_v3_model_4_seed_000.json", 1503831, "76ae199c56f161eecea1117d380183bddef1595b8b4b64c594491e744c7ada7d"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_scores_rank_004_alphafold2_multimer_v3_model_3_seed_000.json", 1504273, "59509b3535d91b57743da8f3c6489c70bca2ff6305f4e3e0a71ba2092c926812"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_scores_rank_005_alphafold2_multimer_v3_model_1_seed_000.json", 1505415, "b404fc2ce21ff4686807d54ab31d1cc2aeea80a216f3c74b0d1fa2250f536df9"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_unrelaxed_rank_001_alphafold2_multimer_v3_model_2_seed_000.pdb", 292977, "233c95582b324228e06b95968832ffacf2607373aa4c5af35b366479c61395be"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_unrelaxed_rank_002_alphafold2_multimer_v3_model_5_seed_000.pdb", 292977, "27831e19b2f64c32756cb6180c61b5c70ac76ce2c364ca3eafc6c0c588b4d2ac"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_unrelaxed_rank_003_alphafold2_multimer_v3_model_4_seed_000.pdb", 292977, "1f500a996f1b679132b2a25b58987606146c18759782c89f6213cf14a5a61fd5"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_unrelaxed_rank_004_alphafold2_multimer_v3_model_3_seed_000.pdb", 292977, "3cfc52f110dd46553a1cbceaa63319b450666f3fa2026744bec822c800aeb67e"],
  ["Dmelanogaster_CtBp_Prospero_EALSLVV_unrelaxed_rank_005_alphafold2_multimer_v3_model_1_seed_000.pdb", 292977, "559d34acca2eef8848f55ec3eab537fed1d36537caa028c4af84ace2703064a0"],
].map(([filename, bytes, sha256]) => ({
  filename,
  bytes,
  sha256,
  url: `${ZENODO_BASE}/${filename}/content`,
}));

const af3Files = [
  ["fold_p06730_o60516_full_data_0.json", 615688, "d61f5ff93bbf922e844abb3a3fa8e5afb58e9ded30d920487deb718e90dd0bf8"],
  ["fold_p06730_o60516_full_data_1.json", 615627, "2db99a90a29a28815f8b2bf9eb43f653f29586a691737293710d02b4be4ae7de"],
  ["fold_p06730_o60516_full_data_2.json", 615756, "b670435fafd741a08ddff003e203fe341c2d28c9a5403755f2e4632eed9109e7"],
  ["fold_p06730_o60516_full_data_3.json", 615828, "8754b2d06ccb0d3d44a337792aeec6321c2c07d4ec132a9d04de25a621d02e6f"],
  ["fold_p06730_o60516_full_data_4.json", 615937, "4f609c43030ca014015f620ad239c7701c156d647947a93745b24b676b66e3a0"],
  ["fold_p06730_o60516_job_request.json", 602, "e54a417c80e0d66729aebc248104b59a2cd595effff9ee29037dae9a3dd155f1"],
  ["fold_p06730_o60516_model_0.cif", 177886, "6843b9d1ce90b6257628e168382ee8fe584d973d59af11072a3d4bf4f2bb0cde"],
  ["fold_p06730_o60516_model_1.cif", 177886, "803b8d2ac1bad3a60824a40055d25d081eb1fe9840817f6c643b2edaa3fa34e4"],
  ["fold_p06730_o60516_model_2.cif", 177886, "2dacea436ebefd974bd3575f093b014f9bde36d493dc74b31350e5cd4bb792a0"],
  ["fold_p06730_o60516_model_3.cif", 177886, "76f23e887b68b0c3416138b332cb0e10ccc24156b3b23427a3e1900fb208eff3"],
  ["fold_p06730_o60516_model_4.cif", 177886, "025f2c17bb9811313d7c3bc18a0e6e79c5c591aac0d1f9a9c42cd69d776921d5"],
  ["fold_p06730_o60516_summary_confidences_0.json", 350, "9cd523928047b260d81edc74a021fa6ecac1f45c53c20b65b7c1007aec1e0f18"],
  ["fold_p06730_o60516_summary_confidences_1.json", 348, "8acc5d54a0d0c22c8f3efce366cacbbfe960197971ce26f360803d7527cd06ca"],
  ["fold_p06730_o60516_summary_confidences_2.json", 349, "519f6ec8aa27892fd2be0f35fba4b3afb791a337e927d0aac0901fddb2d4a246"],
  ["fold_p06730_o60516_summary_confidences_3.json", 350, "2069ed72aa5c7a71fb267fa4923467d811fbb91780eb8a969265b44f51b1c63e"],
  ["fold_p06730_o60516_summary_confidences_4.json", 350, "5d0949b25b33c3a9ec9022d5c4cca4afcb7c8d2c07f6e0f737f7e335606287a8"],
].map(([filename, bytes, sha256]) => ({ filename, bytes, sha256, url: `${AF3_BASE}/${filename}` }));

const DATASETS = [
  {
    id: "zenodo-17063524-colabfold-multimer",
    producer: "colabfold",
    sourceUrl: "https://zenodo.org/records/17063524",
    sourceRevision: "Zenodo record 17063524, version 2025-09-05",
    license: "CC-BY-4.0",
    biologicalContext: "Drosophila CtBP–Prospero peptide complex; not a GPCR–VHH complex.",
    validationPurpose: "Genuine PDB/two-decimal score-JSON intake, exact native pairing, full PAE, recurrence, and per-pose audit.",
    files: colabfoldFiles,
    referenceFilename: colabfoldFiles.find((file) => file.filename.includes("unrelaxed_rank_001"))?.filename,
    expected: { files: 10, coordinates: 5, pae: 5, ignored: 0, receptorLength: 476, partnerLength: 7, mapping: "researcher-confirmed-complete-protein-order" },
  },
  {
    id: "af3-minipae-p06730-o60516",
    producer: "alphafold-server",
    sourceUrl: `https://github.com/martinovein/AF3_MiniPAE/tree/${AF3_COMMIT}/data/example/p06730_o60516`,
    sourceRevision: AF3_COMMIT,
    license: "MIT repository; generated AlphaFold Server files redistributed by that repository.",
    biologicalContext: "P06730–O60516 protein complex; not a GPCR–VHH complex.",
    validationPurpose: "Genuine mmCIF/full-data JSON intake, exact model pairing, token-metadata PAE mapping, recurrence, and per-pose audit.",
    files: af3Files,
    referenceFilename: "fold_p06730_o60516_model_0.cif",
    expected: { files: 16, coordinates: 5, pae: 5, ignored: 6, receptorLength: 163, partnerLength: 100, mapping: "token-residue-metadata-verified" },
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return value == null ? null : Math.round(value * 1e6) / 1e6;
}

async function fetchExact(file) {
  const response = await fetch(file.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  assert.equal(response.ok, true, `${file.filename}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.byteLength, file.bytes, `${file.filename}: byte count changed`);
  assert.equal(sha256(bytes), file.sha256, `${file.filename}: SHA-256 changed`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { path: file.filename, bytes: bytes.byteLength, sha256: file.sha256, text };
}

async function mapConcurrent(values, limit, transform) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await transform(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function auditSource(file) {
  assert.ok(file?.text != null);
  return {
    id: file.id,
    path: file.path,
    filename: file.filename,
    bytes: file.bytes,
    sha256: file.sha256,
    text: file.text,
  };
}

async function runDataset(dataset) {
  const downloaded = await mapConcurrent(dataset.files, 4, fetchExact);
  const rawFiles = downloaded.map((file) => ({ ...file, path: `${dataset.id}/${file.path}` }));
  const manifest = createPredictionRunManifest(rawFiles);
  assert.equal(manifest.totals.fileCount, dataset.expected.files);
  assert.equal(manifest.totals.coordinateCount, dataset.expected.coordinates);
  assert.equal(manifest.totals.paeJsonCount, dataset.expected.pae);
  assert.equal(manifest.totals.ignoredOrUnsupportedFileCount, dataset.expected.ignored);
  assert.equal(manifest.totals.readyPoseCount, 5);
  assert.equal(manifest.totals.reviewPoseCount, 0);
  const selected = manifest.poses.filter((pose) => pose.included && pose.status === "ready");
  const poses = selected.map((pose) => {
    const coordinate = predictionRunFileById(manifest, pose.coordinateFileId);
    const pae = predictionRunFileById(manifest, pose.paeFileId);
    assert.ok(coordinate && pae);
    return {
      id: pose.id,
      provider: pose.provider,
      poseKey: pose.poseKey,
      variant: pose.variant,
      associationBasis: pose.associationBasis,
      coordinate: auditSource(coordinate),
      pae: auditSource(pae),
    };
  });
  const reference = poses.find((pose) => pose.coordinate.filename === dataset.referenceFilename);
  assert.ok(reference, `${dataset.id}: reference file is missing`);
  const progress = [];
  const result = executePredictionRunAuditJob({
    poses,
    referenceCoordinateFileId: reference.coordinate.id,
    referenceReceptorChain: "A",
    referenceVhhChain: "B",
    paeAssociationsAndOrderConfirmed: true,
    topologyAnnotation: null,
  }, (event) => progress.push(event));
  assert.equal(result.counts.coordinateAccepted, 5);
  assert.equal(result.counts.coordinateRejected, 0);
  assert.equal(result.counts.paeAudited, 5);
  assert.equal(result.counts.paeRejected, 0);
  assert.equal(result.coordinateEnsemble?.poseCount, 5);
  assert.equal(result.poseAudits[0].singleAudit.structure.selectedChains.find((chain) => chain.id === "A")?.residueCount, dataset.expected.receptorLength);
  assert.equal(result.poseAudits[0].singleAudit.structure.selectedChains.find((chain) => chain.id === "B")?.residueCount, dataset.expected.partnerLength);
  assert.ok(result.poseAudits.every((pose) => pose.pae.mapping?.basis === dataset.expected.mapping));
  assert.equal(progress.length, 15);

  return {
    id: dataset.id,
    producer: dataset.producer,
    sourceUrl: dataset.sourceUrl,
    sourceRevision: dataset.sourceRevision,
    license: dataset.license,
    biologicalContext: dataset.biologicalContext,
    validationPurpose: dataset.validationPurpose,
    domainBoundary: "This producer-compatibility control is not GPCR–VHH validation and is not used to estimate pose-ranking accuracy.",
    inputs: dataset.files.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })),
    manifest: manifest.totals,
    resultCounts: result.counts,
    progressEvents: progress.length,
    ensemble: {
      poseCount: result.coordinateEnsemble?.poseCount ?? null,
      acceptedRanks: result.coordinateEnsemble?.poses.map((pose) => ({
        filename: pose.filename,
        rank: pose.rank,
        triageGroup: pose.triageGroup,
      })).sort((left, right) => left.filename.localeCompare(right.filename)) ?? [],
    },
    poseAudits: result.poseAudits.map((pose) => ({
      filename: pose.coordinate.filename,
      chainMapping: pose.chains.mappingBasis,
      receptorChain: pose.chains.receptor,
      partnerChain: pose.chains.vhh,
      contactPairCount: pose.singleAudit.audit.contactPairCount,
      severeClashCount: pose.singleAudit.audit.severeClashCount,
      deltaSasaAngstrom2: rounded(pose.singleAudit.audit.deltaSasaAngstrom2),
      vhhNumberingStatus: pose.singleAudit.audit.vhhNumbering.status,
      paeStatus: pose.pae.status,
      paeMappingBasis: pose.pae.mapping?.basis ?? null,
      maxPaeAngstrom: rounded(pose.pae.maxPaeAngstrom),
      conservativeContactMedianPaeAngstrom: rounded(pose.pae.conservativeLargerDirectionMedianAngstrom),
      contactPairShareAtOrBelow10Angstrom: rounded(pose.pae.contactPairShareAtOrBelow10Angstrom),
    })).sort((left, right) => left.filename.localeCompare(right.filename)),
  };
}

const verificationArgument = process.argv.find((argument) => argument.startsWith("--verify="));
const quiet = process.argv.includes("--quiet");
const record = {
  schemaVersion: "real-prediction-run-regression-1.0.0",
  claimBoundary: "These checks establish deterministic compatibility with the exact public producer outputs listed here. They do not establish binding, affinity, specificity, GPCR membrane compatibility, VHH developability, state selectivity, or pose-ranking accuracy.",
  datasets: [],
};
for (const dataset of DATASETS) record.datasets.push(await runDataset(dataset));
if (verificationArgument) {
  const expected = JSON.parse(await readFile(verificationArgument.slice("--verify=".length), "utf8"));
  assert.deepEqual(record, expected, "Real-run regression drifted from its checked-in evidence record");
}
if (quiet) {
  const poses = record.datasets.reduce((sum, dataset) => sum + dataset.resultCounts.coordinateAccepted, 0);
  const pae = record.datasets.reduce((sum, dataset) => sum + dataset.resultCounts.paeAudited, 0);
  process.stdout.write(`Real-run regression passed: ${record.datasets.length} datasets, ${poses} poses, ${pae} PAE audits.\n`);
} else {
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}
