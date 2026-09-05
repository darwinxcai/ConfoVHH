import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compactAudit, prepareGroup, runAudits, validatePlan, verifyObservedRoles } from "../scripts/paper/audit-cognate-predictions.mjs";
import { auditCorpus, DEFAULT_SOURCE, loadCorpus, sha256 } from "../scripts/paper/gpcr-corpus.mjs";

const CORPUS = auditCorpus(await loadCorpus());
const ORIGINAL = CORPUS.jobs.find((job) => job.job === "3P0G_default_complex_seed1");

function plan(root = "/synthetic-test-files") {
  return {
    schemaVersion: "confovhh.gpcr-cognate-dockq.v1", dataRole: "development", expectedDockqVersion: "2.1.3",
    jobs: Array.from({ length: 5 }, (_, modelIndex) => ({
      jobId: ORIGINAL.job, modelIndex, referencePdb: "3P0G",
      requestPath: path.join(root, path.basename(ORIGINAL.requestPath)), requestSha256: ORIGINAL.requestSha256,
      modelPath: path.join(root, `fold_${ORIGINAL.job.toLowerCase()}_model_${modelIndex}.cif`), modelSha256: sha256(`synthetic ${modelIndex}`),
      nativePath: path.join(root, "3P0G.cif"), nativeSha256: sha256("synthetic native"),
      modelChains: { receptor: "B", vhh: "A" }, nativeChains: { receptor: "A", vhh: "B" },
      referenceReview: { status: "cognate-reference-reviewed", evidence: "Synthetic test fixture only; no scientific validation asserted." },
    })),
  };
}

async function withFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "confovhh-gpcr-audit-"));
  try {
    const value = plan(root);
    await copyFile(path.join(DEFAULT_SOURCE, ORIGINAL.requestPath), value.jobs[0].requestPath);
    await writeFile(value.jobs[0].nativePath, "synthetic native");
    for (const row of value.jobs) await writeFile(row.modelPath, `synthetic ${row.modelIndex}`);
    const planPath = path.join(root, "plan.json"); await writeFile(planPath, JSON.stringify(value));
    return await callback({ root, planPath, value });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("auditor validates reviewed cognate plans without depending on row order", () => {
  const value = plan(); value.jobs.reverse();
  const groups = validatePlan(value, CORPUS);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].models.map((row) => row.modelIndex), [0, 1, 2, 3, 4]);
});

test("auditor rejects controls, unreviewed references and wrong source request identities", () => {
  const control = plan(); control.jobs[0].jobId = "SWAP_3P0Grec_Nb60_seed1";
  assert.throws(() => validatePlan(control, CORPUS), /noncognate/);
  const unreviewed = plan(); unreviewed.jobs[0].referenceReview.status = "pending";
  assert.throws(() => validatePlan(unreviewed, CORPUS), /Missing cognate reference review/);
  const wrongRequest = plan(); wrongRequest.jobs[0].requestSha256 = sha256("different request");
  assert.throws(() => validatePlan(wrongRequest, CORPUS), /Original request hash mismatch/);
});

test("auditor rejects duplicate records, byte aliases, partial five-model jobs and wrong filenames", () => {
  const duplicate = plan(); duplicate.jobs[1] = structuredClone(duplicate.jobs[0]);
  assert.throws(() => validatePlan(duplicate, CORPUS), /Duplicate model record/);
  const alias = plan(); alias.jobs[1].modelSha256 = alias.jobs[0].modelSha256;
  assert.throws(() => validatePlan(alias, CORPUS), /Duplicate model SHA/);
  const missing = plan(); missing.jobs.pop();
  assert.throws(() => validatePlan(missing, CORPUS), /Partial five-model job/);
  const filename = plan(); filename.jobs[0].modelPath = "/wrong_model_0.cif";
  assert.throws(() => validatePlan(filename, CORPUS), /Wrong job\/model filename/);
});

test("auditor requires consistent reviewed receptor and VHH maps and excludes frozen data", () => {
  const selectors = plan(); selectors.jobs[1].modelChains = { receptor: "A", vhh: "B" };
  assert.throws(() => validatePlan(selectors, CORPUS), /Within-job model chain mismatch/);
  const native = plan(); native.jobs[1].nativeSha256 = sha256("other reference");
  assert.throws(() => validatePlan(native, CORPUS), /Within-job identity mismatch/);
  const frozen = plan(); frozen.jobs[0].nativePath = "/validation/hard-decoy-holdout-v3/unknown.cif";
  assert.throws(() => validatePlan(frozen, CORPUS), /Frozen holdout/);
});

test("a consistently swapped review map cannot bypass exact original receptor/VHH sequence checks", () => {
  const group = validatePlan(plan(), CORPUS)[0];
  const valid = { modelCount: 1, chains: [{ id: "B", sequence: "RECEPTOR" }, { id: "A", sequence: "VHH" }] };
  group.sourceIdentity = { ...group.sourceIdentity, receptorSequenceSha256: sha256("RECEPTOR"), binderSequenceSha256: sha256("VHH") };
  verifyObservedRoles(group, group.models[0], valid);
  const swapped = { ...group.models[0], modelChains: { receptor: "A", vhh: "B" } };
  assert.throws(() => verifyObservedRoles(group, swapped, valid), /Observed receptor sequence differs/);
  const mutated = { ...valid, chains: [{ id: "B", sequence: "RECEPTOR" }, { id: "A", sequence: "OTHER" }] };
  assert.throws(() => verifyObservedRoles(group, group.models[0], mutated), /Observed vhh sequence differs/);
});

test("changed model bytes stop before production analysis", async () => {
  await withFixture(async ({ value }) => {
    await writeFile(value.jobs[3].modelPath, "changed model bytes");
    await assert.rejects(() => prepareGroup(validatePlan(value, CORPUS)[0], "/"), /Source SHA-256 mismatch/);
  });
});

test("full-data PAE cannot be silently ignored or replaced with summary confidence", async () => {
  await withFixture(async ({ root, value }) => {
    await writeFile(path.join(root, `fold_${ORIGINAL.job.toLowerCase()}_full_data_0.json`), "{}");
    await assert.rejects(() => prepareGroup(validatePlan(value, CORPUS)[0], "/"), /PAE source present/);
  });
});

test("failed audit preserves a failed receipt and refuses to reuse its output directory", async () => {
  await withFixture(async ({ root, planPath }) => {
    const out = path.join(root, "output");
    await assert.rejects(() => runAudits({ planPath, out, onProgress() {} }), /No supported text|PDBx|mmCIF|coordinate|atom|data block|cif/i);
    const summary = JSON.parse(await readFile(path.join(out, "audit-summary.json"), "utf8"));
    assert.equal(summary.state, "failed");
    assert.equal(summary.completedModels, 0);
    assert.equal(summary.paeAudited, 0);
    await assert.rejects(() => runAudits({ planPath, out, onProgress() {} }), /EEXIST/);
    assert.equal(JSON.parse(await readFile(path.join(out, "audit-summary.json"), "utf8")).state, "failed");
  });
});

function syntheticResult(group) {
  const poseAudits = group.models.map((model, i) => ({
    id: `pose-${i}`, coordinate: { sha256: model.modelSha256 }, chains: { receptor: "B", vhh: "A", mappingBasis: i ? "unique-exact-sequence-propagation" : "researcher-confirmed-reference" },
    singleAudit: { rawCoordinateText: "MUST NOT EXPORT", audit: {
      evidenceLevel: i === 0 ? "supported" : "mixed", contactPairCount: 20, receptorInterfaceResidues: 10, vhhInterfaceResidues: 8,
      halfDeltaSasaInterfaceAreaAngstrom2: 500 + i * 100, deltaSasaAngstrom2: 1000 + i * 200, severeClashCount: 0, maximumOverlapAngstrom: 0.1,
      paratopeProxyShare: 0.75, cdr3ProxyShare: 0.25, vhhNumbering: { status: "numbered" }, auditAttestation: { resultFingerprint: `test-${i}` },
      contacts: [{ nativeUnneededContent: "MUST NOT EXPORT" }],
    } }, pae: { status: "not-provided", matrix: [[999]] },
  }));
  return {
    productRelease: "0.9.1", engineVersion: "0.5.0",
    counts: { selected: 5, coordinateAccepted: 5, coordinateRejected: 0, paeNotProvided: 5, paeAudited: 0, paeRejected: 0 },
    coordinateRejected: [], poseAudits,
    coordinateEnsemble: { poses: group.models.map((model, i) => ({ sha256: model.modelSha256, rank: i + 1, ensembleConsensus: 0.5, contactPairConsensus: 0.4, receptorEpitopeConsensus: 0.6, vhhParatopeConsensus: 0.5, recurrentContactShare: 0.4, comparisonCount: 4 })) },
  };
}

test("compact exports use unchanged tier-first ranking and preserve source hash and recurrence identity", () => {
  const group = validatePlan(plan(), CORPUS)[0]; const result = syntheticResult(group);
  const rows = compactAudit(group, result);
  assert.equal(rows[0].evidenceRank, 1, "Large mixed-tier burial cannot outrank supported tier");
  assert.equal(rows[4].evidenceRank, 2);
  assert.equal(rows[0].modelSha256, group.models[0].modelSha256);
  assert.equal(rows[0].cdrContactShare, 0.75);
  assert.equal(rows[0].cdr3ContactShare, 0.25);
  assert.equal(rows[0].paeStatus, "not-provided");
  assert.equal(rows[4].recurrenceRank, 5);
  assert.equal(rows[0].recurrenceComparisonCount, 4);
  assert.doesNotMatch(JSON.stringify(rows), /MUST NOT EXPORT|matrix|rawCoordinateText|nativeUnneededContent/);
});

test("partial production results or chain-map disagreements cannot produce successful exports", () => {
  const group = validatePlan(plan(), CORPUS)[0];
  const partial = syntheticResult(group); partial.counts.coordinateAccepted = 4;
  assert.throws(() => compactAudit(group, partial), /Not all coordinates audited/);
  const wrongChains = syntheticResult(group); wrongChains.poseAudits[1].chains = { receptor: "A", vhh: "B" };
  assert.throws(() => compactAudit(group, wrongChains), /Production receptor mapping differs/);
  const duplicate = syntheticResult(group); duplicate.poseAudits[1] = duplicate.poseAudits[0];
  assert.throws(() => compactAudit(group, duplicate), /Expected values to be strictly deep-equal/);
});
