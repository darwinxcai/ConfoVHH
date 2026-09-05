#!/usr/bin/env node
/** Execute unchanged ConfoVHH production audits on the reviewed development corpus. */
import assert from "node:assert/strict";
import { appendFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPredictionRunManifest, predictionRunFileById } from "../../lib/prediction-run.ts";
import { executePredictionRunAuditJob, predictionRunPoseSummaryCsv, PREDICTION_RUN_PRODUCT_RELEASE } from "../../lib/prediction-run-jobs.ts";
import { executeParseCoordinateJob } from "../../lib/audit-jobs.ts";
import { POSE_RANKING_POLICY, rankPoses, scorePoseRanking } from "../../lib/pose-ranking.ts";
import { CONFOVHH_VERSION } from "../../lib/confovhh.ts";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";
import { auditCorpus, loadCorpus, sha256 } from "./gpcr-corpus.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ORDER = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const HASH = /^[0-9a-f]{64}$/;
const CLAIM_BOUNDARY = "Previously exposed, retrospectively chosen developmental GPCR predictions. Coordinate plausibility and within-job ranking/recurrence do not validate binding, native-pose recovery, or independent generalization. No weights, thresholds or ranking policy were fitted or changed.";

export function validatePlan(plan, corpus) {
  assert.equal(plan?.schemaVersion, "confovhh.gpcr-cognate-dockq.v1", "Wrong reviewed plan schema");
  assert.equal(plan.dataRole, "development", "Only development data may be audited here");
  assert.ok(Array.isArray(plan.jobs) && plan.jobs.length > 0 && plan.jobs.length <= 250, "Expected bounded nonempty model plan");
  const known = new Map(corpus.jobs.map((job) => [job.job, job]));
  const groups = new Map(); const records = new Set(); const digests = new Set();
  for (const model of plan.jobs) {
    const source = known.get(model.jobId);
    assert.ok(source?.category === "preliminary_cognate", `Unrecognized or noncognate job: ${model.jobId}`);
    assert.equal(model.referencePdb, source.reference, `Wrong reference for ${model.jobId}`);
    assert.equal(model.requestSha256, source.requestSha256, `Original request hash mismatch: ${model.jobId}`);
    assert.ok(Number.isInteger(model.modelIndex) && model.modelIndex >= 0 && model.modelIndex <= 4, "Invalid model index");
    const key = `${model.jobId}/model_${model.modelIndex}`;
    assert.ok(!records.has(key), `Duplicate model record: ${key}`); records.add(key);
    assert.ok(!digests.has(model.modelSha256), `Duplicate model SHA-256: ${key}`); digests.add(model.modelSha256);
    assert.equal(model.referenceReview?.status, "cognate-reference-reviewed", `Missing cognate reference review: ${key}`);
    assert.ok(typeof model.referenceReview.evidence === "string" && model.referenceReview.evidence.length > 20, `Missing review evidence: ${key}`);
    for (const role of ["model", "native", "request"]) {
      assert.ok(HASH.test(model[`${role}Sha256`]), `Invalid ${role} hash: ${key}`);
      assert.ok(typeof model[`${role}Path`] === "string" && model[`${role}Path`].length > 0, `Invalid ${role} path: ${key}`);
      assert.ok(!model[`${role}Path`].split(/[\\/]/).some((part) => /^hard-decoy-holdout-v/.test(part)), "Frozen holdout paths are forbidden");
    }
    assert.equal(path.basename(model.modelPath), `fold_${model.jobId.toLowerCase()}_model_${model.modelIndex}.cif`, `Wrong job/model filename: ${key}`);
    assert.equal(path.basename(model.requestPath), `fold_${model.jobId.toLowerCase()}_job_request.json`, `Wrong request filename: ${key}`);
    for (const selector of [model.modelChains, model.nativeChains]) {
      assert.ok(selector && /^[A-Za-z0-9]+$/.test(selector.receptor) && /^[A-Za-z0-9]+$/.test(selector.vhh) && selector.receptor !== selector.vhh, `Invalid reviewed chain selectors: ${key}`);
    }
    const group = groups.get(model.jobId) ?? [];
    if (group.length) {
      for (const key of ["referencePdb", "requestPath", "requestSha256", "nativePath", "nativeSha256"]) assert.equal(model[key], group[0][key], `Within-job identity mismatch: ${model.jobId}/${key}`);
      assert.deepEqual(model.modelChains, group[0].modelChains, `Within-job model chain mismatch: ${model.jobId}`);
      assert.deepEqual(model.nativeChains, group[0].nativeChains, `Within-job native chain mismatch: ${model.jobId}`);
    }
    group.push(model); groups.set(model.jobId, group);
  }
  for (const [job, group] of groups) {
    group.sort((a, b) => a.modelIndex - b.modelIndex);
    assert.deepEqual(group.map((m) => m.modelIndex), [0, 1, 2, 3, 4], `Partial five-model job: ${job}`);
  }
  return [...groups.entries()].sort(([a], [b]) => ORDER(a, b)).map(([job, models]) => ({ job, models, sourceIdentity: known.get(job) }));
}

export function verifyObservedRoles(group, model, structure) {
  assert.equal(structure.modelCount, 1, `Expected one coordinate model: ${group.job}`);
  for (const role of ["receptor", "vhh"]) {
    const selected = structure.chains.find((chain) => chain.id === model.modelChains[role]);
    assert.ok(selected, `Reviewed ${role} model chain is absent: ${group.job}`);
    const key = role === "receptor" ? "receptorSequenceSha256" : "binderSequenceSha256";
    assert.equal(sha256(selected.sequence), group.sourceIdentity[key], `Observed ${role} sequence differs from the pinned request role: ${group.job}`);
  }
}

async function readVerified(filename, expectedSha256, maximumBytes = 12 * 1024 * 1024) {
  const stat = await lstat(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximumBytes, `Invalid/bounded source file: ${filename}`);
  const bytes = await readFile(filename);
  assert.equal(sha256(bytes), expectedSha256, `Source SHA-256 mismatch: ${filename}`);
  return bytes;
}

function resolved(filename, dataRoot) {
  return path.isAbsolute(filename) ? filename : path.resolve(dataRoot, filename);
}

export async function prepareGroup(group, dataRoot) {
  const first = group.models[0];
  await readVerified(resolved(first.requestPath, dataRoot), first.requestSha256);
  await readVerified(resolved(first.nativePath, dataRoot), first.nativeSha256);
  const raw = [];
  for (const model of group.models) {
    const bytes = await readVerified(resolved(model.modelPath, dataRoot), model.modelSha256);
    raw.push({ path: `${group.job}/${path.basename(model.modelPath)}`, bytes: bytes.length, sha256: model.modelSha256, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
  }
  const modelDirectory = path.dirname(resolved(first.modelPath, dataRoot));
  const names = (await readdir(modelDirectory)).sort(ORDER);
  const paeFiles = names.filter((name) => name.startsWith(`fold_${group.job.toLowerCase()}_full_data_`) && name.endsWith(".json"));
  assert.equal(paeFiles.length, 0, `PAE source present for ${group.job}; coordinate-only recipe needs separately reviewed handling`);
  const ignoredSummaryFiles = [];
  for (const name of names.filter((name) => name.startsWith(`fold_${group.job.toLowerCase()}_summary_confidences_`) && name.endsWith(".json"))) {
    const filename = path.join(modelDirectory, name); const stat = await lstat(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, `Invalid/bounded summary file: ${filename}`);
    const bytes = await readFile(filename);
    ignoredSummaryFiles.push({ filename: name, bytes: bytes.length, sha256: sha256(bytes), usedAsPae: false, usedInRanking: false });
  }
  for (let i = 0; i < raw.length; i += 1) {
    const structure = executeParseCoordinateJob({ filename: path.basename(raw[i].path), text: raw[i].text });
    verifyObservedRoles(group, group.models[i], structure);
  }
  const initialManifest = createPredictionRunManifest(raw);
  // Use the product's explicit coordinate-only choice after confirming no full-data PAE exists.
  const overrides = Object.fromEntries(initialManifest.poses.map((pose) => [pose.coordinateFileId, { paeFileId: null, included: true }]));
  const manifest = createPredictionRunManifest(raw, overrides);
  assert.equal(manifest.totals.coordinateCount, 5, `Five coordinate files required: ${group.job}`);
  assert.equal(manifest.totals.readyPoseCount, 5, `All five coordinate files must be ready: ${group.job}`);
  assert.equal(manifest.totals.paeJsonCount, 0, "Summary confidence must not become a PAE matrix");
  const poses = manifest.poses.filter((pose) => pose.included && pose.status === "ready").map((pose) => {
    const coordinate = predictionRunFileById(manifest, pose.coordinateFileId);
    return {
      id: pose.id, provider: pose.provider, poseKey: pose.poseKey, variant: pose.variant, associationBasis: "none",
      coordinate: { id: coordinate.id, path: coordinate.path, filename: coordinate.filename, bytes: coordinate.bytes, sha256: coordinate.sha256, text: coordinate.text }, pae: null,
    };
  });
  const reference = poses.find((pose) => pose.coordinate.sha256 === first.modelSha256);
  assert.ok(reference, "Explicit model-0 reference is missing");
  return {
    job: { poses, referenceCoordinateFileId: reference.coordinate.id, referenceReceptorChain: first.modelChains.receptor, referenceVhhChain: first.modelChains.vhh, paeAssociationsAndOrderConfirmed: false, topologyAnnotation: null },
    ignoredSummaryFiles, manifestTotals: manifest.totals,
  };
}

export function compactAudit(group, result) {
  assert.equal(result.counts.selected, 5);
  assert.equal(result.counts.coordinateAccepted, 5, `Not all coordinates audited for ${group.job}: ${JSON.stringify(result.coordinateRejected)}`);
  assert.equal(result.counts.coordinateRejected, 0, `Rejected coordinates for ${group.job}`);
  assert.equal(result.counts.paeNotProvided, 5);
  assert.equal(result.counts.paeAudited, 0);
  assert.equal(result.counts.paeRejected, 0);
  const rankings = new Map(rankPoses(result.poseAudits.map((pose) => ({ poseId: pose.id, pose })), (entry) => scorePoseRanking(entry.pose.singleAudit.audit)).map((entry) => [entry.poseId, entry]));
  const recurrence = new Map(result.coordinateEnsemble?.poses.map((pose) => [pose.sha256, pose]) ?? []);
  const source = new Map(group.models.map((model) => [model.modelSha256, model]));
  const records = result.poseAudits.map((pose) => {
    const model = source.get(pose.coordinate.sha256);
    assert.ok(model, "Audit result has an unrecognized model hash");
    assert.equal(pose.chains.receptor, model.modelChains.receptor, "Production receptor mapping differs from reviewed model map");
    assert.equal(pose.chains.vhh, model.modelChains.vhh, "Production VHH mapping differs from reviewed model map");
    const audit = pose.singleAudit.audit; const ranking = rankings.get(pose.id); const ensemble = recurrence.get(model.modelSha256);
    assert.ok(ensemble, "Missing recurrence record for audited coordinate");
    return {
      schemaVersion: "confovhh.gpcr-development-pose-audit.v1", job: group.job, modelIndex: model.modelIndex, reference: model.referencePdb,
      modelSha256: model.modelSha256, requestSha256: model.requestSha256, nativeSha256: model.nativeSha256,
      productRelease: result.productRelease, engineVersion: result.engineVersion, rankingPolicyVersion: POSE_RANKING_POLICY.version,
      chains: pose.chains, evidenceLevel: audit.evidenceLevel, evidenceRank: ranking.evidenceRank, evidenceTier: ranking.evidence.evidenceTier,
      assessability: ranking.evidence.assessability, rankingCautions: ranking.evidence.cautions,
      interfaceBurialAngstrom2: audit.halfDeltaSasaInterfaceAreaAngstrom2, deltaSasaAngstrom2: audit.deltaSasaAngstrom2,
      contactPairCount: audit.contactPairCount, severeClashCount: audit.severeClashCount, maximumOverlapAngstrom: audit.maximumOverlapAngstrom,
      receptorInterfaceResidues: audit.receptorInterfaceResidues, vhhInterfaceResidues: audit.vhhInterfaceResidues,
      cdrContactShare: audit.paratopeProxyShare, cdr3ContactShare: audit.cdr3ProxyShare, numberingStatus: audit.vhhNumbering.status,
      paeStatus: pose.pae.status, paeSource: null, topologyStatus: null,
      recurrenceRank: ensemble.rank, ensembleConsensus: ensemble.ensembleConsensus, contactPairConsensus: ensemble.contactPairConsensus,
      receptorEpitopeConsensus: ensemble.receptorEpitopeConsensus, vhhParatopeConsensus: ensemble.vhhParatopeConsensus,
      recurrentContactShare: ensemble.recurrentContactShare, recurrenceComparisonCount: ensemble.comparisonCount,
      auditAttestation: audit.auditAttestation,
    };
  }).sort((a, b) => a.modelIndex - b.modelIndex);
  assert.deepEqual(records.map((row) => row.modelIndex), [0, 1, 2, 3, 4]);
  return records;
}

async function moduleProvenance() {
  const files = [];
  async function walk(relative) {
    for (const name of (await readdir(path.join(ROOT, relative))).sort(ORDER)) {
      const next = path.join(relative, name); const stat = await lstat(path.join(ROOT, next));
      if (stat.isDirectory()) await walk(next);
      else if (name.endsWith(".ts")) files.push(next);
    }
  }
  await walk("lib");
  files.push("scripts/paper/audit-cognate-predictions.mjs", "scripts/paper/gpcr-corpus.mjs", "scripts/hard-decoy/oracle/canonical-json.mjs", "node_modules/immunum/package.json", "node_modules/immunum/immunum.js", "node_modules/immunum/immunum_bg.wasm");
  const hashes = [];
  for (const filename of files.sort(ORDER)) { const bytes = await readFile(path.join(ROOT, filename)); hashes.push({ path: filename.split(path.sep).join("/"), bytes: bytes.length, sha256: sha256(bytes) }); }
  const immunum = parseStrictJson(await readFile(path.join(ROOT, "node_modules/immunum/package.json"), "utf8"));
  return { nodeVersion: process.version, productRelease: PREDICTION_RUN_PRODUCT_RELEASE, coordinateEngineVersion: CONFOVHH_VERSION, immunumVersion: immunum.version, rankingPolicy: POSE_RANKING_POLICY, inventoryScope: "All lib TypeScript sources plus this runner, intake/parser helpers, and installed immunum JS/WASM distribution; inventory does not claim every module was executed.", files: hashes };
}

export async function runAudits({ planPath, out, dataRoot = path.dirname(planPath), onlyJob = null, onProgress = (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`) }) {
  const bytes = await readFile(planPath); const plan = parseStrictJson(bytes.toString("utf8"));
  const corpus = auditCorpus(await loadCorpus());
  const groups = validatePlan(plan, corpus);
  const selected = onlyJob ? groups.filter((group) => group.job === onlyJob) : groups;
  assert.ok(selected.length > 0, "Selected job is absent from reviewed plan");
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out); // Existing outputs, including incomplete ones, must never be overwritten.
  const summary = {
    schemaVersion: "confovhh.gpcr-development-audit-run.v1", state: "running", claimBoundary: CLAIM_BOUNDARY,
    executionPlanSha256: sha256(bytes), planModels: plan.jobs.length, planJobs: groups.length,
    selectedModels: selected.length * 5, selectedJobs: selected.length, completedModels: 0, completedJobs: 0,
    paeAudited: 0, paeNotProvided: 0, productionRankingUnchanged: true, sourceConfidenceUsedInRanking: false,
    rawCoordinatesIncluded: false, rawMatricesIncluded: false, biologicalValidation: false, independentHoldout: false,
    methods: { referencePose: "Explicit model 0 within each submitted seed job; not the experimental native structure", nativeCoordinates: "SHA-256 checked against the reviewed scoring plan; never passed to ConfoVHH analysis", modelRoleVerification: "Each parsed receptor and VHH observed sequence must exactly match the independently pinned original request role sequence SHA-256", rankingScope: "Five same-request models within each job only", cdrContactShare: "Production paratopeProxyShare: fraction of residue-contact pairs assigned to IMGT CDR1/2/3; null for no contacts or unavailable numbering", pae: "Absent AF Server full-data matrices; summary confidence JSON is hashed for inventory only and never substituted", topology: "No membrane/topology annotation supplied" },
    implementation: await moduleProvenance(), jobs: [],
  };
  await writeFile(path.join(out, "audit-summary.json"), json(summary));
  await writeFile(path.join(out, "pose-audits.jsonl"), "");
  await mkdir(path.join(out, "job-csv"));
  const started = performance.now();
  try {
    for (const group of selected) {
      const jobStarted = performance.now();
      const prepared = await prepareGroup(group, dataRoot);
      const result = executePredictionRunAuditJob(prepared.job);
      const compact = compactAudit(group, result);
      await appendFile(path.join(out, "pose-audits.jsonl"), compact.map((row) => JSON.stringify(row)).join("\n") + "\n");
      await writeFile(path.join(out, "job-csv", `${group.job}.csv`), predictionRunPoseSummaryCsv(result) + "\n");
      summary.completedModels += compact.length; summary.completedJobs += 1; summary.paeNotProvided += result.counts.paeNotProvided;
      summary.jobs.push({ job: group.job, counts: result.counts, manifestTotals: prepared.manifestTotals, ignoredSummaryFiles: prepared.ignoredSummaryFiles, recurrenceMethods: result.coordinateEnsemble.methods, geometryAuditMethods: result.poseAudits[0].singleAudit.audit.methods });
      await writeFile(path.join(out, "audit-summary.json"), json(summary));
      onProgress({ job: group.job, completedJobs: summary.completedJobs, totalJobs: selected.length, completedModels: summary.completedModels, elapsedSeconds: Math.round((performance.now() - started) / 10) / 100, jobSeconds: Math.round((performance.now() - jobStarted) / 10) / 100 });
    }
    assert.equal(summary.completedModels, summary.selectedModels);
    assert.deepEqual(await moduleProvenance(), summary.implementation, "Implementation bytes changed during audit");
    summary.implementationVerifiedAfterRun = true;
    summary.outputFiles = [];
    for (const filename of ["pose-audits.jsonl", ...selected.map((group) => `job-csv/${group.job}.csv`)].sort(ORDER)) {
      const outputBytes = await readFile(path.join(out, filename));
      summary.outputFiles.push({ path: filename, bytes: outputBytes.length, sha256: sha256(outputBytes) });
    }
    const receipt = json({ schemaVersion: "confovhh.gpcr-audit-output-files.v1", scope: "Completed pose JSONL and per-job production CSV; summary and this manifest are excluded to avoid circular hashes", files: summary.outputFiles });
    await writeFile(path.join(out, "output-manifest.json"), receipt);
    summary.outputSha256 = { "pose-audits.jsonl": summary.outputFiles.find((file) => file.path === "pose-audits.jsonl").sha256, "output-manifest.json": sha256(receipt) };
    summary.state = "CONFO_VHH_DEVELOPMENT_AUDIT_OK";
    await writeFile(path.join(out, "audit-summary.json"), json(summary));
    return summary;
  } catch (error) {
    summary.state = "failed"; summary.error = String(error.message ?? error);
    await writeFile(path.join(out, "audit-summary.json"), json(summary));
    throw error;
  }
}

async function main() {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--(plan|out|data-root|job)=(.+)$/);
    assert.ok(match && !options[match[1]], `Invalid/repeated argument: ${arg}`); options[match[1]] = match[2];
  }
  assert.ok(options.plan && options.out, "Provide --plan=reviewed-plan.json and a fresh --out=directory");
  const result = await runAudits({ planPath: path.resolve(options.plan), out: path.resolve(options.out), dataRoot: options["data-root"] ? path.resolve(options["data-root"]) : path.dirname(path.resolve(options.plan)), onlyJob: options.job ?? null });
  process.stdout.write(`${JSON.stringify({ state: result.state, jobs: result.completedJobs, models: result.completedModels, paeNotProvided: result.paeNotProvided })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
