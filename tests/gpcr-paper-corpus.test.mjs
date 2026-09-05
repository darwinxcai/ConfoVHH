import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditCorpus, eligibilityCsv, inventoryCoordinates, loadCorpus, parseCsv, sha256, writeReport } from "../scripts/paper/gpcr-corpus.mjs";

const SOURCE = await loadCorpus();
const fresh = () => structuredClone(SOURCE);
const report = () => auditCorpus(fresh());

async function withRaw(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "confovhh-gpcr-corpus-"));
  try { return await callback(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("development intake binds all 92 requests to 460 unique model records and separates reference eligibility", () => {
  const value = report();
  assert.deepEqual(value.counts, { jobs: 92, requests: 92, conditions: 31, modelRecords: 460, modelsPerJob: 5, preliminaryCognate: 250, noncognateControls: 60, receptorOnly: 150 });
  assert.equal(value.sourceFiles.length, 94);
  assert.equal(new Set(value.models.map((row) => row.recordId)).size, 460);
  assert.deepEqual(value.conditionSeedRosterException.observedSeeds, [1, 3]);
  assert.equal(value.conditionSeedRosterException.absentSeed, 2);
  assert.ok(value.models.filter((row) => row.category === "noncognate_control").every((row) => /^(SWAP|IRREL)_/.test(row.job)));
  const rawRows = new Map(SOURCE.models.map((row) => [`${row.job}/model_${row.model}`, row]));
  for (const row of value.models) assert.equal(row.legacyDockqLike, rawRows.get(row.recordId).DockQ === "" ? null : Number(rawRows.get(row.recordId).DockQ));
});

test("request chain roles preserve the original binder-first order and reversed-order rescue/controls", () => {
  const jobs = new Map(report().jobs.map((job) => [job.job, job]));
  const original = jobs.get("5JQH_default_complex_seed1");
  const rescue = jobs.get("RESCUE_5JQH_complex_cutoff_2011_01_01_seed1");
  const noT4L = jobs.get("5JQH_noT4L_default_complex_seed1");
  assert.equal(original.requestBinderIndex, 0);
  assert.equal(original.requestReceptorIndex, 1);
  assert.equal(rescue.requestBinderIndex, 1);
  assert.equal(rescue.requestReceptorIndex, 0);
  assert.equal(original.binderSequenceSha256, rescue.binderSequenceSha256);
  assert.equal(original.binderSequenceSha256, noT4L.binderSequenceSha256);
  assert.notEqual(original.receptorSequenceSha256, noT4L.receptorSequenceSha256);
  assert.equal(jobs.get("4MQS_default_complex_seed1").requestBinderIndex, 1);
});

test("rejects duplicate models and incomplete ledgers instead of accepting total-count-only evidence", () => {
  const duplicate = fresh(); duplicate.models[1] = structuredClone(duplicate.models[0]);
  assert.throws(() => auditCorpus(duplicate), /duplicate model record/);
  const missing = fresh(); missing.models.pop();
  assert.throws(() => auditCorpus(missing), /Expected 460/);
  const invalidIndex = fresh(); invalidIndex.models[0].model = "5";
  assert.throws(() => auditCorpus(invalidIndex), /Invalid or duplicate model/);
});

test("rejects wrong-job request filenames, seed metadata and cross-reference metric reassignment", () => {
  const wrongName = fresh(); wrongName.requests[0].request.name = "SWAP_3P0Grec_Nb60_seed9";
  assert.throws(() => auditCorpus(wrongName), /filename\/job mismatch/);
  const wrongSeed = fresh(); wrongSeed.requests[0].request.modelSeeds = ["9"];
  assert.throws(() => auditCorpus(wrongSeed), /seed mismatch/);
  const wrongReference = fresh(); wrongReference.models[0].reference = "5JQH";
  assert.throws(() => auditCorpus(wrongReference), /reference or chain mismatch/);
});

test("rejects a noncognate binder disguised as a cognate condition", () => {
  const value = fresh();
  const source = value.requests.find((r) => r.request.name === "SWAP_3P0Grec_Nb60_seed1");
  const target = value.requests.find((r) => r.request.name === "3P0G_noT4L_default_complex_seed1");
  target.request.sequences[0].proteinChain.sequence = source.request.sequences[1].proteinChain.sequence;
  assert.throws(() => auditCorpus(value), /Binder sequence\/cognate grouping mismatch/);
});

test("rejects within-condition receptor sequence drift and mismatched template policies", () => {
  const sequenceDrift = fresh();
  sequenceDrift.requests.find((r) => r.request.name === "3P0G_noT4L_default_complex_seed2").request.sequences[1].proteinChain.sequence += "A";
  assert.throws(() => auditCorpus(sequenceDrift), /identity differs between seeds/);
  const templateDrift = fresh();
  templateDrift.requests.find((r) => r.request.name === "3P0G_recOFF_nbON_complex_seed1").request.sequences[1].proteinChain.useStructureTemplate = true;
  assert.throws(() => auditCorpus(templateDrift), /Receptor template mismatch/);
});

test("legacy scores never become official DockQ, standard quality labels, or validation claims", () => {
  const value = report();
  assert.equal(value.legacyMetric.officialDockq, false);
  assert.equal(value.legacyMetric.standardQualityThresholdsApplicable, false);
  assert.ok(Object.values(value.claims).every((flag) => flag === false));
  assert.ok(value.models.every((row) => row.officialDockq === null && row.standardDockqLabel === null && row.officialScoringReady === false));
  const injected = fresh(); injected.models[0].officialDockq = 0.9;
  assert.throws(() => auditCorpus(injected), /legacy metrics must not be promoted/);
  const badMetric = fresh(); badMetric.models[0].DockQ = "NaN";
  assert.throws(() => auditCorpus(badMetric), /Invalid legacy/);
  const promotedCsv = "job,officialDockq\na,0.9\n";
  assert.throws(() => parseCsv(promotedCsv, "job,DockQ"), /legacy metrics must not be relabeled/);
  assert.match(eligibilityCsv(value).split("\n")[0], /legacyDockqLike,officialDockq,standardDockqLabel/);
});

test("raw inventory is opt-in and an empty directory cannot certify any model or job", async () => {
  const notRequested = await inventoryCoordinates(report());
  assert.equal(notRequested.coordinateInventory.rawRootSupplied, false);
  assert.equal(notRequested.coordinateInventory.associatedNonemptyFiles, 0);
  assert.equal(notRequested.coordinateInventory.missingOrNotRequested, 460);
  await withRaw(async (root) => {
    const value = await inventoryCoordinates(report(), root);
    assert.equal(value.coordinateInventory.jobsWithFiveNonemptyFiles, 0);
    assert.ok(value.models.every((row) => row.coordinateAvailability === "missing"));
    assert.equal(value.standardScoringHandoff.jobsReady, 0);
  });
});

test("partial and empty coordinate files remain explicit and hashes do not certify biological identity", async () => {
  await withRaw(async (root) => {
    const job = "3P0G_default_complex_seed1";
    const folder = path.join(root, job); await mkdir(folder);
    const name = `fold_${job.toLowerCase()}_model_0.cif`;
    const bytes = "test bytes: inventory only, not a valid structure";
    await writeFile(path.join(folder, name), bytes);
    await writeFile(path.join(folder, `fold_${job.toLowerCase()}_model_1.cif`), "");
    await writeFile(path.join(folder, "unmapped_model.cif"), "unmapped");
    const value = await inventoryCoordinates(report(), root);
    assert.equal(value.coordinateInventory.associatedNonemptyFiles, 1);
    assert.equal(value.coordinateInventory.associatedEmptyFiles, 1);
    assert.equal(value.coordinateInventory.unassociatedFiles, 1);
    assert.equal(value.coordinateInventory.jobsWithFiveNonemptyFiles, 0);
    const model = value.models.find((r) => r.recordId === `${job}/model_0`);
    assert.equal(model.coordinateFile.sha256, sha256(bytes));
    assert.equal(model.coordinateFile.path, `${job}/${name}`);
    assert.equal(model.coordinateAvailability, "present_unverified");
    assert.equal(model.officialScoringReady, false);
    assert.equal(value.standardScoringHandoff.jobsReady, 0);
  });
});

test("five nonempty filenames still require coordinate/reference identity review before scoring", async () => {
  await withRaw(async (root) => {
    const job = "SWAP_3P0Grec_Nb60_seed1";
    for (let i = 0; i < 5; i += 1) await writeFile(path.join(root, `fold_${job.toLowerCase()}_model_${i}.cif`), `inventory ${i}`);
    const value = await inventoryCoordinates(report(), root);
    assert.equal(value.coordinateInventory.jobsWithFiveNonemptyFiles, 1);
    assert.equal(value.coordinateInventory.noncognateControlFiles, 5);
    assert.equal(value.coordinateInventory.preliminaryCognateFiles, 0);
    assert.equal(value.claims.predictionCompletionVerified, false);
    assert.equal(value.standardScoringHandoff.jobsReady, 0);
  });
});

test("recovered request metadata must match the original request bytes", async () => {
  await withRaw(async (root) => {
    const original = SOURCE.requests.find((r) => r.request.name === "3P0G_default_complex_seed1");
    const filename = path.basename(original.sourcePath);
    await writeFile(path.join(root, filename), JSON.stringify([{ ...original.request, modelSeeds: ["99"] }]));
    await assert.rejects(() => inventoryCoordinates(report(), root), /Recovered request metadata\/hash mismatch/);
  });
});

test("ambiguous copies of the same job/model and symlink traversal fail closed", async () => {
  await withRaw(async (root) => {
    const name = "fold_3p0g_default_complex_seed1_model_0.cif";
    await mkdir(path.join(root, "copy"));
    await writeFile(path.join(root, name), "one");
    await writeFile(path.join(root, "copy", name), "two");
    await assert.rejects(() => inventoryCoordinates(report(), root), /Ambiguous duplicate coordinate association/);
    await rm(path.join(root, "copy"), { recursive: true });
    await symlink(path.join(root, name), path.join(root, "linked.cif"));
    await assert.rejects(() => inventoryCoordinates(report(), root), /Symlink not permitted/);
  });
});

test("frozen holdout trees are outside the permitted development inventory", async () => {
  await withRaw(async (root) => {
    await mkdir(path.join(root, "hard-decoy-holdout-v3"));
    await assert.rejects(() => inventoryCoordinates(report(), root), /Frozen holdout/);
  });
});

test("reports are deterministic under source order changes and across writes", async () => {
  const shuffled = fresh(); shuffled.jobs.reverse(); shuffled.models.reverse(); shuffled.requests.reverse();
  assert.deepEqual(auditCorpus(shuffled), report());
  await withRaw(async (root) => {
    const value = await inventoryCoordinates(report());
    await writeReport(value, path.join(root, "one"));
    await writeReport(value, path.join(root, "two"));
    for (const file of ["corpus-report.json", "model-eligibility.csv", "source-manifest.json"]) {
      assert.deepEqual(await readFile(path.join(root, "one", file)), await readFile(path.join(root, "two", file)));
    }
  });
});
