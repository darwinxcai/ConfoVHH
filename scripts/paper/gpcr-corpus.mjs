#!/usr/bin/env node
/** Development-only intake of the already reviewed GPCR handoff; no scoring or prediction. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseStrictJson } from "../hard-decoy/oracle/canonical-json.mjs";

export const DEFAULT_SOURCE = path.resolve(import.meta.dirname, "../../validation/gpcr-paper-development-2026-09-04/source");
export const EXPECTED = Object.freeze({ requests: 92, models: 460, modelsPerJob: 5, conditions: 31, preliminaryCognate: 250, noncognateControls: 60, receptorOnly: 150 });
const JOB_HEADER = "job,seed,n_chains,receptor_template_access,binder_template_access,max_template_date,msa_setting,receptor_templates,binder_templates,n_models,endpoint_call,samples_outward";
const MODEL_HEADER = "job,model,reference,templates,templates_receptor,templates_binder,template_cutoff,n_chains,tm3_tm6_A,residues,global_ca_rmsd_A,n_aligned,fnat,iRMSD,LRMSD,DockQ,iptm,ptm,ranking_score,fraction_disordered,has_clash,chain_pair_iptm_AB";
const REFERENCES = new Set(["3P0G", "5JQH", "4MQS", "5C1M", "3UON", "4DKL"]);
const ORDER = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const recordId = (job, model) => `${job}/model_${model}`;
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Small strict CSV reader: quoted fields supported; duplicate headings/ragged rows rejected. */
export function parseCsv(text, expectedHeader) {
  requireThat(typeof text === "string" && text.length <= 4 * 1024 * 1024 && !text.includes("\0"), "Invalid or oversized CSV");
  const rows = []; let row = []; let field = ""; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      requireThat(!field && !closed, "Malformed CSV quote"); quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field); field = ""; closed = false;
      if (c !== ",") {
        rows.push(row); row = [];
        if (c === "\r" && text[i + 1] === "\n") i += 1;
      }
    } else { requireThat(!closed, "Text after closing CSV quote"); field += c; }
  }
  requireThat(!quoted, "Unterminated CSV quote");
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  requireThat(headers?.join(",") === expectedHeader, "Unexpected CSV schema; legacy metrics must not be relabeled or extended");
  return rows.map((values, i) => {
    requireThat(values.length === headers.length, `Ragged CSV row ${i + 2}`);
    return Object.fromEntries(headers.map((key, j) => [key, values[j]]));
  });
}

async function readDirect(filename, maxBytes = 4 * 1024 * 1024) {
  const stat = await lstat(filename);
  requireThat(stat.isFile() && !stat.isSymbolicLink(), `Expected direct regular file: ${filename}`);
  requireThat(stat.size <= maxBytes, `File exceeds intake bound: ${filename}`);
  return readFile(filename);
}

export async function loadCorpus(source = DEFAULT_SOURCE) {
  const files = [];
  async function read(relative) {
    const bytes = await readDirect(path.join(source, relative));
    files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    return bytes.toString("utf8");
  }
  const jobs = parseCsv(await read("S1_job_manifest.csv"), JOB_HEADER);
  const models = parseCsv(await read("S2_per_model_metrics.csv"), MODEL_HEADER);
  const requests = [];
  const names = (await readdir(path.join(source, "S4_job_requests"))).sort(ORDER);
  requireThat(names.length === EXPECTED.requests && names.every((name) => /^fold_[a-z0-9_]+_job_request\.json$/.test(name)), "Expected exactly 92 original request JSON files");
  for (const name of names) {
    const relative = `S4_job_requests/${name}`;
    const values = parseStrictJson(await read(relative));
    requireThat(Array.isArray(values) && values.length === 1, `Request must contain exactly one job: ${name}`);
    requests.push({ request: values[0], sourcePath: relative, sha256: files.at(-1).sha256 });
  }
  return { jobs, models, requests, sourceFiles: files.sort((a, b) => ORDER(a.path, b.path)) };
}

function nonemptyInteger(value, label) {
  requireThat(/^(0|[1-9][0-9]*)$/.test(value), `Invalid integer ${label}`);
  return Number(value);
}

function legacyNumber(value, label) {
  if (value === "") return null;
  requireThat(/^(?:0|1)(?:\.\d+)?$/.test(value), `Invalid legacy DockQ-like metric: ${label}`);
  const number = Number(value);
  requireThat(Number.isFinite(number) && number >= 0 && number <= 1, `Legacy metric out of range: ${label}`);
  return number;
}

// Explicit role order in these supplied requests, not a length-based chain guess.
function requestRoleIndices(name, chainCount, reference) {
  if (chainCount === 1) return { requestReceptorIndex: 0, requestBinderIndex: null };
  const binderFirst = ["3P0G", "5JQH"].includes(reference) && !/^(RESCUE|SWAP|IRREL)_/.test(name);
  return { requestReceptorIndex: binderFirst ? 1 : 0, requestBinderIndex: binderFirst ? 0 : 1 };
}

/** Bind CSV records to requests; "preliminary" never means experimentally verified cognacy. */
export function auditCorpus(corpus) {
  const { jobs, models, requests } = corpus;
  for (const [rows, header] of [[jobs, JOB_HEADER], [models, MODEL_HEADER]]) {
    const keys = header.split(",").sort(ORDER).join(",");
    requireThat(rows.every((row) => Object.keys(row).sort(ORDER).join(",") === keys), "Unexpected source row schema; legacy metrics must not be promoted to official labels");
  }
  requireThat(jobs.length === EXPECTED.requests && requests.length === EXPECTED.requests, "Expected 92 jobs and requests");
  requireThat(models.length === EXPECTED.models, "Expected 460 model records");
  const requestByName = new Map();
  for (const entry of requests) {
    const q = entry.request;
    requireThat(q && typeof q.name === "string" && !requestByName.has(q.name), "Invalid or duplicate request name");
    requireThat(entry.sourcePath === `S4_job_requests/fold_${q.name.toLowerCase()}_job_request.json`, `Request filename/job mismatch: ${q.name}`);
    requireThat(q.dialect === "alphafoldserver" && q.version === 3, `Unexpected request dialect/version: ${q.name}`);
    requireThat(Array.isArray(q.sequences) && [1, 2].includes(q.sequences.length), `Unexpected request chain count: ${q.name}`);
    for (const entry of q.sequences) {
      const chain = entry.proteinChain;
      requireThat(Object.keys(entry).length === 1 && chain?.count === 1 && /^[ACDEFGHIKLMNPQRSTVWY]+$/.test(chain.sequence), `Invalid protein request: ${q.name}`);
      requireThat(typeof chain.useStructureTemplate === "boolean", `Missing template policy: ${q.name}`);
    }
    requestByName.set(q.name, entry);
  }
  const anchors = new Map(["3P0G", "5JQH", "4MQS", "5C1M"].map((reference) => {
    const anchor = requestByName.get(`${reference}_default_complex_seed1`);
    requireThat(anchor?.request.sequences.length === 2, `Missing development binder anchor for ${reference}`);
    const roles = requestRoleIndices(anchor.request.name, 2, reference);
    return [reference, sha256(anchor.request.sequences[roles.requestBinderIndex].proteinChain.sequence)];
  }));
  const jobMap = new Map(); const conditionGroups = new Map();
  for (const job of jobs) {
    requireThat(!jobMap.has(job.job), `Duplicate manifest job: ${job.job}`);
    const entry = requestByName.get(job.job);
    requireThat(entry, `Manifest job lacks a matching request: ${job.job}`);
    const q = entry.request;
    const match = job.job.match(/^(.*)_seed([123])$/);
    requireThat(match && match[2] === job.seed && Array.isArray(q.modelSeeds) && q.modelSeeds.length === 1 && String(q.modelSeeds[0]) === job.seed, `Job/request seed mismatch: ${job.job}`);
    const reference = job.job.match(/(?:^|_)(3P0G|5JQH|4MQS|5C1M|3UON|4DKL)/)?.[1];
    requireThat(REFERENCES.has(reference), `Unrecognized reference in job name: ${job.job}`);
    const chainCount = nonemptyInteger(job.n_chains, job.job);
    requireThat(chainCount === q.sequences.length && job.n_models === "5", `Request/manifest chain or model count mismatch: ${job.job}`);
    const roles = requestRoleIndices(job.job, chainCount, reference);
    const receptor = q.sequences[roles.requestReceptorIndex].proteinChain;
    const binder = roles.requestBinderIndex === null ? undefined : q.sequences[roles.requestBinderIndex].proteinChain;
    requireThat(job.receptor_template_access === (receptor.useStructureTemplate ? "on" : "off"), `Receptor template mismatch: ${job.job}`);
    requireThat(job.binder_template_access === (binder ? (binder.useStructureTemplate ? "on" : "off") : "—"), `Binder template mismatch: ${job.job}`);
    requireThat(job.max_template_date === (receptor.maxTemplateDate ?? ""), `Template date mismatch: ${job.job}`);
    if (binder) requireThat((binder.maxTemplateDate ?? "") === job.max_template_date, `Binder template date mismatch: ${job.job}`);
    const receptorSequenceSha256 = sha256(receptor.sequence);
    const binderSequenceSha256 = binder ? sha256(binder.sequence) : null;
    const control = /^(SWAP|IRREL)_/.test(job.job);
    requireThat(!control || chainCount === 2, `Noncognate control must have two chains: ${job.job}`);
    const category = chainCount === 1 ? "receptor_only" : control ? "noncognate_control" : "preliminary_cognate";
    if (binder) {
      requireThat(anchors.has(reference), `Missing binder anchor: ${job.job}`);
      requireThat(control ? binderSequenceSha256 !== anchors.get(reference) : binderSequenceSha256 === anchors.get(reference), `Binder sequence/cognate grouping mismatch: ${job.job}`);
    }
    const identity = { job: job.job, condition: match[1], seed: Number(job.seed), reference, chainCount, category, ...roles, receptorSequenceSha256, binderSequenceSha256, requestPath: entry.sourcePath, requestSha256: entry.sha256 };
    jobMap.set(job.job, { source: job, identity, modelIndices: new Set() });
    const conditionIdentity = JSON.stringify([reference, category, receptorSequenceSha256, binderSequenceSha256, job.receptor_template_access, job.binder_template_access, job.max_template_date]);
    const prior = conditionGroups.get(match[1]);
    requireThat(!prior || prior.identity === conditionIdentity, `Sequence/template identity differs between seeds: ${match[1]}`);
    conditionGroups.set(match[1], { identity: conditionIdentity, seeds: [...(prior?.seeds ?? []), Number(job.seed)].sort() });
  }
  requireThat(conditionGroups.size === EXPECTED.conditions, "Expected 31 conditions");
  for (const [condition, group] of conditionGroups) {
    // The handoff really lacks seed 2 for this condition; do not invent it.
    const expected = condition === "5JQH_no_templates_complex" ? [1, 3] : [1, 2, 3];
    requireThat(JSON.stringify(group.seeds) === JSON.stringify(expected), `Unexpected condition seed roster: ${condition}`);
  }
  const records = models.map((model) => {
    const job = jobMap.get(model.job);
    requireThat(job, `Metric row has unknown job: ${model.job}`);
    const index = nonemptyInteger(model.model, model.job);
    requireThat(index < EXPECTED.modelsPerJob && !job.modelIndices.has(index), `Invalid or duplicate model record: ${recordId(model.job, index)}`);
    job.modelIndices.add(index);
    requireThat(model.reference === job.identity.reference && model.n_chains === job.source.n_chains, `Model/request reference or chain mismatch: ${model.job}`);
    requireThat(model.template_cutoff === job.source.max_template_date, `Model/request cutoff mismatch: ${model.job}`);
    const q = requestByName.get(model.job).request;
    requireThat(model.templates_receptor === String(q.sequences[job.identity.requestReceptorIndex].proteinChain.useStructureTemplate).replace(/^./, (c) => c.toUpperCase()), `Metric receptor template mismatch: ${model.job}`);
    const binderPolicy = job.identity.requestBinderIndex === null ? undefined : q.sequences[job.identity.requestBinderIndex].proteinChain.useStructureTemplate;
    requireThat(model.templates_binder === (binderPolicy === undefined ? "" : binderPolicy ? "True" : "False"), `Metric binder template mismatch: ${model.job}`);
    const legacyDockqLike = legacyNumber(model.DockQ, recordId(model.job, index));
    requireThat((job.identity.chainCount === 1) === (legacyDockqLike === null), `Unexpected presence/absence of legacy interface metric: ${model.job}`);
    return { recordId: recordId(model.job, index), job: model.job, modelIndex: index, reference: model.reference, category: job.identity.category, legacyDockqLike, officialDockq: null, standardDockqLabel: null, coordinateAvailability: "not_requested", coordinateFile: null, officialScoringReady: false };
  }).sort((a, b) => ORDER(a.recordId, b.recordId));
  for (const [job, value] of jobMap) requireThat(value.modelIndices.size === 5, `Missing/partial model records for job: ${job}`);
  const counts = { preliminaryCognate: records.filter((r) => r.category === "preliminary_cognate").length, noncognateControls: records.filter((r) => r.category === "noncognate_control").length, receptorOnly: records.filter((r) => r.category === "receptor_only").length };
  for (const [key, value] of Object.entries(counts)) requireThat(value === EXPECTED[key], `Unexpected ${key} count: ${value}`);
  return {
    schema: "confovhh.gpcr-development-corpus.v1",
    scope: "Previously reviewed development data; excluded from frozen holdout and confirmatory validation.",
    legacyMetric: { sourceColumn: "DockQ", exportedAs: "legacyDockqLike", implementation: "Nonstandard handoff calculation with C-alpha RMSDs and a modified interface definition", officialDockq: false, standardQualityThresholdsApplicable: false },
    claims: { independentHoldout: false, bindingValidated: false, rankingValidated: false, stateSelectivityValidated: false, cognateReferenceVerified: false, predictionCompletionVerified: false },
    counts: { jobs: jobs.length, requests: requests.length, conditions: conditionGroups.size, modelRecords: records.length, modelsPerJob: 5, ...counts },
    conditionSeedRosterException: { condition: "5JQH_no_templates_complex", observedSeeds: [1, 3], absentSeed: 2, absentSeedExecutionStatus: "not established from supplied records" },
    sourceFiles: corpus.sourceFiles,
    jobs: [...jobMap.values()].map((value) => value.identity).sort((a, b) => ORDER(a.job, b.job)),
    models: records,
  };
}

/** Only explicit raw roots are searched. Matching names are proposals, never identity proof. */
export async function inventoryCoordinates(report, rawDirectory) {
  const result = structuredClone(report);
  const coordinateFiles = []; const associated = new Map(); const requestFiles = [];
  const expectedNames = new Map(result.models.flatMap((r) => ["cif", "pdb", "cif.gz", "pdb.gz"].map((extension) => [`fold_${r.job.toLowerCase()}_model_${r.modelIndex}.${extension}`, r.recordId])));
  const expectedRequests = new Map(result.jobs.map((job) => [path.basename(job.requestPath), job]));
  if (rawDirectory) {
    const raw = await realpath(rawDirectory);
    requireThat(!raw.split(path.sep).some((part) => /^hard-decoy-holdout-v/.test(part)), "Frozen holdout directories are outside this development intake");
    let visited = 0;
    async function walk(relative = "") {
      const directory = path.join(raw, relative);
      for (const name of (await readdir(directory)).sort(ORDER)) {
        if (name.startsWith(".")) continue;
        requireThat(!/^hard-decoy-holdout-v/.test(name), "Frozen holdout directories are outside this development intake");
        visited += 1; requireThat(visited <= 4096, "Raw inventory exceeds 4096 entries");
        const next = path.join(relative, name); const absolute = path.join(raw, next); const stat = await lstat(absolute);
        requireThat(!stat.isSymbolicLink(), `Symlink not permitted in raw inventory: ${next}`);
        if (stat.isDirectory()) { await walk(next); continue; }
        requireThat(stat.isFile(), `Unexpected raw file type: ${next}`);
        const request = expectedRequests.get(name);
        if (request) {
          const bytes = await readDirect(absolute);
          const digest = sha256(bytes);
          requireThat(digest === request.requestSha256, `Recovered request metadata/hash mismatch for ${request.job}`);
          requireThat(!requestFiles.some((file) => file.job === request.job), `Ambiguous duplicate recovered request for ${request.job}`);
          requestFiles.push({ path: next.split(path.sep).join("/"), job: request.job, bytes: bytes.length, sha256: digest, originalRequestBytesVerified: true });
        }
        if (!/\.(?:pdb|cif)(?:\.gz)?$/i.test(name)) continue;
        const bytes = await readDirect(absolute, 64 * 1024 * 1024);
        const id = expectedNames.get(name) ?? null;
        requireThat(!id || !associated.has(id), `Ambiguous duplicate coordinate association for ${id}`);
        const file = { path: next.split(path.sep).join("/"), bytes: bytes.length, sha256: sha256(bytes), proposedRecordId: id, identityVerified: false, compressed: name.endsWith(".gz"), status: bytes.length ? "present_unverified" : "empty" };
        coordinateFiles.push(file);
        if (id) associated.set(id, file);
      }
    }
    await walk();
    for (const model of result.models) {
      const file = associated.get(model.recordId);
      model.coordinateAvailability = file?.status ?? "missing";
      model.coordinateFile = file ? { path: file.path, sha256: file.sha256, bytes: file.bytes } : null;
    }
  }
  coordinateFiles.sort((a, b) => ORDER(a.path, b.path));
  requestFiles.sort((a, b) => ORDER(a.path, b.path));
  const available = result.models.filter((r) => r.coordinateAvailability === "present_unverified");
  result.coordinateInventory = {
    rawRootSupplied: Boolean(rawDirectory), filenameAssociationIsIdentityProof: false, files: coordinateFiles, requestFiles,
    associatedNonemptyFiles: available.length, associatedEmptyFiles: result.models.filter((r) => r.coordinateAvailability === "empty").length,
    preliminaryCognateFiles: available.filter((r) => r.category === "preliminary_cognate").length,
    noncognateControlFiles: available.filter((r) => r.category === "noncognate_control").length,
    receptorOnlyFiles: available.filter((r) => r.category === "receptor_only").length,
    unassociatedFiles: coordinateFiles.filter((f) => !f.proposedRecordId).length,
    missingOrNotRequested: result.models.filter((r) => ["missing", "not_requested"].includes(r.coordinateAvailability)).length,
    jobsWithFiveNonemptyFiles: result.jobs.filter((j) => available.filter((r) => r.job === j.job).length === 5).length,
    scopeNote: "Hashes attest inventoried bytes only. Coordinates were not parsed, chain identity was not checked, and neither retained predictions nor successful predictor completion are inferred.",
  };
  result.standardScoringHandoff = {
    schema: "confovhh.gpcr-cognate-dockq.v1", state: "blocked_pending_reviewed_coordinate_reference_mapping", jobsReady: 0,
    preliminaryCognateRecords: 250,
    requirements: ["Original model coordinates bound to exact job/model/request identity", "Exact cognate experimental reference coordinates and SHA-256", "Reviewed receptor/binder chain and residue mapping, construct/truncation coverage, and reference provenance", "Official DockQ version/distribution/environment hashes and retained per-record outputs", "Separate SWAP/IRREL controls; do not assign cross-binder DockQ correctness labels"],
  };
  return result;
}

export function eligibilityCsv(report) {
  const fields = ["recordId", "job", "modelIndex", "reference", "category", "legacyDockqLike", "officialDockq", "standardDockqLabel", "coordinateAvailability", "officialScoringReady"];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [fields.join(","), ...report.models.map((row) => fields.map((key) => cell(row[key])).join(","))].join("\n") + "\n";
}

export async function writeReport(report, out) {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "corpus-report.json"), jsonText(report));
  await writeFile(path.join(out, "model-eligibility.csv"), eligibilityCsv(report));
  await writeFile(path.join(out, "source-manifest.json"), jsonText({ schema: "confovhh.gpcr-development-source.v1", files: report.sourceFiles }));
}

async function main() {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--(source|out|raw)=(.+)$/);
    requireThat(match && !options[match[1]], `Expected unique --source=, --out=, or --raw= arguments: ${arg}`);
    options[match[1]] = match[2];
  }
  const report = await inventoryCoordinates(auditCorpus(await loadCorpus(options.source ?? DEFAULT_SOURCE)), options.raw);
  if (options.out) await writeReport(report, options.out);
  process.stdout.write(`${JSON.stringify({ state: "DEVELOPMENT_CORPUS_INTAKE_OK", ...report.counts, coordinateFiles: report.coordinateInventory.associatedNonemptyFiles, officialScoringJobsReady: 0 })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
