import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { analyzeInterface } from "../lib/confovhh.ts";
import { executeParseCoordinateJob } from "../lib/audit-jobs.ts";
import {
  createPredictionRunDossier,
  executePredictionRunAuditJob,
  extractNativePredictionPae,
  predictionRunPoseSummaryCsv,
} from "../lib/prediction-run-jobs.ts";
import {
  createPredictionRunManifest,
  predictionRunFileById,
} from "../lib/prediction-run.ts";
import { createTopologyAnnotation } from "../lib/topology-annotation.ts";

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

function atomLine({ serial, chain, residue, x, y, residueName = "ALA" }) {
  return [
    "ATOM".padEnd(6), String(serial).padStart(5), " ", " CA ", " ", residueName, " ", chain,
    String(residue).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    "   0.000", "  1.00", "80.00", "          C",
  ].join("");
}

function coordinate(vhhY = 3.4, shift = 0) {
  const lines = ["TITLE     PREDICTION RUN JOB"];
  let serial = 1;
  for (const [chain, y] of [["R", 0], ["V", vhhY]]) {
    for (let residue = 1; residue <= 4; residue += 1) {
      lines.push(atomLine({
        serial: serial++, chain, residue, x: residue * 3.8 + shift, y,
        residueName: chain === "R" ? "ALA" : "CYS",
      }));
    }
  }
  lines.push("END");
  return lines.join("\n");
}

function matrix(size, value = 4) {
  return Array.from({ length: size }, (_, row) => (
    Array.from({ length: size }, (_, column) => row === column ? 0 : value + ((row + column) % 3))
  ));
}

function source(id, path, text) {
  return {
    id,
    path,
    filename: path.split("/").at(-1),
    bytes: Buffer.byteLength(text),
    sha256: sha(text),
    text,
  };
}

function pose(id, coordinateSource, paeSource = null, overrides = {}) {
  return {
    id,
    provider: "colabfold",
    poseKey: JSON.stringify(["run", id]),
    variant: "unrelaxed",
    associationBasis: paeSource ? "exact-native-key" : "none",
    coordinate: coordinateSource,
    pae: paeSource,
    ...overrides,
  };
}

function job(poses, overrides = {}) {
  return {
    poses,
    referenceCoordinateFileId: poses[0].coordinate.id,
    referenceReceptorChain: "R",
    referenceVhhChain: "V",
    paeAssociationsAndOrderConfirmed: poses.some((entry) => entry.pae) ? true : false,
    topologyAnnotation: null,
    ...overrides,
  };
}

test("audits one coordinate pose with a researcher-confirmed square PAE matrix", () => {
  const coord = source("coord-1", "run/pose.pdb", coordinate());
  const pae = source("pae-1", "run/scores.json", JSON.stringify({ pae: matrix(8), max_pae: 10 }));
  const result = executePredictionRunAuditJob(job([pose("pose-1", coord, pae)]));
  assert.equal(result.counts.coordinateAccepted, 1);
  assert.equal(result.counts.paeAudited, 1);
  assert.equal(result.poseAudits[0].pae.status, "audited");
  assert.equal(result.poseAudits[0].pae.mapping.basis, "researcher-confirmed-complete-protein-order");
  assert.deepEqual(result.poseAudits[0].pae.mapping.sourceIndexMap, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.poseAudits[0].pae.orderConfirmedByResearcher, true);
  assert.ok(Number.isFinite(result.poseAudits[0].pae.conservativeLargerDirectionMedianAngstrom));
  assert.equal(result.coordinateEnsemble, null);
});

test("preserves raw-array PAE source format through the canonical per-pose report", () => {
  const coord = source("coord-raw", "run/raw.pdb", coordinate());
  const pae = source("pae-raw", "run/raw.json", JSON.stringify(matrix(8)));
  const result = executePredictionRunAuditJob(job([pose("pose-raw", coord, pae)]));
  assert.equal(result.poseAudits[0].pae.status, "audited");
  assert.equal(result.poseAudits[0].pae.sourceFormat, "raw matrix");
  assert.equal(result.poseAudits[0].singleAudit.pae.sourceFormat, "raw matrix");
});

test("extracts AF3 full-data PAE while ignoring its extra contact-probability matrix", () => {
  const coord = source("coord-af3", "run/fold_job_model_0.pdb", coordinate());
  const full = JSON.stringify({
    pae: matrix(8, 5),
    contact_probs: matrix(8, 0.5),
    atom_plddts: Array(100).fill(90),
    token_chain_ids: ["R", "R", "R", "R", "V", "V", "V", "V"],
    max_pae: 12,
  });
  const pae = source("pae-af3", "run/fold_job_full_data_0.json", full);
  const result = executePredictionRunAuditJob(job([pose("pose-af3", coord, pae, { provider: "alphafold-server" })]));
  assert.equal(result.poseAudits[0].pae.status, "audited");
  assert.equal(result.poseAudits[0].pae.mapping.basis, "researcher-confirmed-token-chain-and-within-chain-order");
  assert.equal(result.poseAudits[0].pae.mapping.originalTokenCount, 8);
});

test("subsets a token PAE matrix only through an exact protein-residue token map", () => {
  const coord = source("coord-token", "run/model_model.pdb", coordinate());
  const tokenChains = ["R", "R", "R", "R", "V", "V", "V", "V", "L"];
  const tokenResidues = [1, 2, 3, 4, 1, 2, 3, 4, 1];
  const pae = source("pae-token", "run/model_confidences.json", JSON.stringify({
    pae: matrix(9, 6),
    token_chain_ids: tokenChains,
    token_res_ids: tokenResidues,
    max_pae: 12,
  }));
  const result = executePredictionRunAuditJob(job([pose("pose-token", coord, pae)]));
  assert.equal(result.poseAudits[0].pae.status, "audited");
  assert.equal(result.poseAudits[0].pae.mapping.originalTokenCount, 9);
  assert.equal(result.poseAudits[0].pae.mapping.proteinResidueCount, 8);
  assert.deepEqual(result.poseAudits[0].pae.mapping.sourceIndexMap, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("quarantines unused token metadata that aliases a parsed protein chain", () => {
  const coord = source("coord-known-extra", "run/known-extra.pdb", coordinate());
  const pae = source("pae-known-extra", "run/known-extra.json", JSON.stringify({
    pae: matrix(9, 6),
    token_chain_ids: ["R", "R", "R", "R", "V", "V", "V", "V", "R"],
    token_res_ids: [1, 2, 3, 4, 1, 2, 3, 4, 999],
    max_pae: 12,
  }));
  const result = executePredictionRunAuditJob(job([pose("known-extra", coord, pae)]));
  assert.equal(result.poseAudits[0].pae.status, "rejected");
  assert.match(result.poseAudits[0].pae.reason, /unused token assigned to a parsed protein chain/i);
});

test("quarantines extra-token PAE without residue metadata and keeps coordinate audit explicit", () => {
  const coord = source("coord-extra", "run/pose.pdb", coordinate());
  const pae = source("pae-extra", "run/scores.json", JSON.stringify({
    pae: matrix(9),
    token_chain_ids: ["R", "R", "R", "R", "V", "V", "V", "V", "L"],
  }));
  const result = executePredictionRunAuditJob(job([pose("pose-extra", coord, pae)]));
  assert.equal(result.counts.coordinateAccepted, 1);
  assert.equal(result.counts.paeRejected, 1);
  assert.equal(result.poseAudits[0].pae.status, "rejected");
  assert.match(result.poseAudits[0].pae.reason, /require token_res_ids/i);
  assert.equal(result.poseAudits[0].singleAudit.audit.interfacePaeMedianAngstrom, null);
  assert.equal(result.poseAudits[0].pae.orderConfirmedByResearcher, true);
});

test("quarantines ragged, negative, nonfinite, understated-max, and dimension-mismatched PAE", () => {
  const payloads = [
    { pae: [[0, 1], [1]] },
    { pae: [[0, -1], [1, 0]] },
    { pae: [[0, 5], [5, 0]], max_pae: 4 },
    { pae: matrix(7) },
  ];
  for (const [index, payload] of payloads.entries()) {
    const coord = source(`coord-${index}`, `run/pose-${index}.pdb`, coordinate());
    const pae = source(`pae-${index}`, `run/scores-${index}.json`, JSON.stringify(payload));
    const result = executePredictionRunAuditJob(job([pose(`pose-${index}`, coord, pae)]));
    assert.equal(result.poseAudits[0].pae.status, "rejected", String(index));
    assert.ok(result.poseAudits[0].pae.reason, String(index));
  }
  const nonfiniteText = '{"pae":[[0,1e400],[1,0]]}';
  const nonfinite = executePredictionRunAuditJob(job([pose(
    "pose-nonfinite",
    source("coord-nonfinite", "run/nonfinite.pdb", coordinate()),
    source("pae-nonfinite", "run/nonfinite.json", nonfiniteText),
  )]));
  assert.equal(nonfinite.poseAudits[0].pae.status, "rejected");
});

test("accepts only sub-centiangstrom producer rounding between max_pae and serialized matrix", () => {
  // Public ColabFold-multimer output DOI 10.5281/zenodo.17063524 serializes
  // max_pae=31.6875 while its two-decimal matrix contains 31.69.
  const coord = source("coord-rounded-max", "run/rounded.pdb", coordinate());
  const roundedMatrix = matrix(8);
  roundedMatrix[0][1] = 31.69;
  roundedMatrix[1][0] = 31.69;
  const accepted = source("pae-rounded-max", "run/rounded.json", JSON.stringify({
    pae: roundedMatrix,
    max_pae: 31.6875,
  }));
  const acceptedResult = executePredictionRunAuditJob(job([pose("rounded-max", coord, accepted)]));
  assert.equal(acceptedResult.poseAudits[0].pae.status, "audited");
  assert.ok(Math.abs(acceptedResult.poseAudits[0].pae.maxPaeAngstrom - 31.69) < 1e-5);

  const rejected = source("pae-understated-max", "run/understated.json", JSON.stringify({
    pae: matrix(8),
    max_pae: 5.98,
  }));
  const rejectedResult = executePredictionRunAuditJob(job([pose("understated-max", coord, rejected)]));
  assert.equal(rejectedResult.poseAudits[0].pae.status, "rejected");
  assert.match(rejectedResult.poseAudits[0].pae.reason, /smaller than an observed matrix value/i);
});

test("requires explicit PAE association and axis confirmation before scientific work", () => {
  const coord = source("coord-confirm", "run/pose.pdb", coordinate());
  const pae = source("pae-confirm", "run/scores.json", JSON.stringify({ pae: matrix(8) }));
  assert.throws(() => executePredictionRunAuditJob(job([pose("pose-confirm", coord, pae)], {
    paeAssociationsAndOrderConfirmed: false,
  })), /Confirm that every selected PAE/i);
});

test("runs coordinate-only recurrence first and joins retained poses by SHA-256", () => {
  const reference = source("coord-ref", "run/reference.pdb", coordinate(3.4));
  const candidate = source("coord-candidate", "run/candidate.pdb", coordinate(4.2));
  const result = executePredictionRunAuditJob(job([
    pose("reference", reference),
    pose("candidate", candidate),
  ]));
  assert.equal(result.counts.selected, 2);
  assert.equal(result.counts.coordinateAccepted, 2);
  assert.equal(result.coordinateEnsemble.poseCount, 2);
  assert.equal(result.poseAudits.filter((entry) => entry.isReference).length, 1);
  assert.ok(result.poseAudits.every((entry) => entry.pae.status === "not-provided"));
  assert.ok(result.coordinateEnsemble.poses.every((entry) => entry.interfacePaeMedianAngstrom == null));
});

test("records rather than hides duplicate-geometry and incompatible candidate rejection", () => {
  const reference = source("coord-ref", "run/reference.pdb", coordinate());
  const duplicate = source("coord-dup", "run/duplicate.pdb", coordinate(3.4, 20));
  const result = executePredictionRunAuditJob(job([
    pose("reference", reference),
    pose("duplicate", duplicate),
  ]));
  assert.equal(result.counts.coordinateAccepted, 1);
  assert.equal(result.counts.coordinateRejected, 1);
  assert.match(result.coordinateRejected[0].reason, /duplicate|geometry/i);
});

test("evaluates user-annotated receptor footprint per retained exact-sequence pose", () => {
  const coordinateText = coordinate();
  const coord = source("coord-topology", "run/pose.pdb", coordinateText);
  const structure = executeParseCoordinateJob({ filename: coord.filename, text: coordinateText });
  const audit = analyzeInterface(structure, "R", "V", "none");
  const annotation = createTopologyAnnotation(structure, "R", audit, {
    intendedSide: "extracellular",
    extracellularResidues: "R:1 R:2",
    intracellularResidues: "R:3",
    transmembraneResidues: "R:4",
    annotationSource: "fixture",
  });
  const result = executePredictionRunAuditJob(job([pose("pose-topology", coord)], { topologyAnnotation: annotation }));
  assert.equal(result.counts.topologyEvaluated, 1);
  assert.equal(result.poseAudits[0].topology.extracellularContactResidueCount, 2);
  assert.equal(result.poseAudits[0].topology.intracellularContactResidueCount, 1);
  assert.equal(result.poseAudits[0].topology.transmembraneContactResidueCount, 1);
  assert.match(result.poseAudits[0].topology.claimBoundary, /does not infer or validate a membrane plane/i);
});

test("reports monotonic phase-local progress and one terminal audit per accepted pose", () => {
  const poses = [
    pose("reference", source("coord-progress-1", "run/reference.pdb", coordinate(3.4))),
    pose("candidate", source("coord-progress-2", "run/candidate.pdb", coordinate(4.2))),
  ];
  const events = [];
  const result = executePredictionRunAuditJob(job(poses), (progress) => events.push(progress));
  for (const phase of ["coordinate-recurrence", "per-pose-audit"]) {
    const phaseEvents = events.filter((event) => event.phase === phase);
    for (let index = 1; index < phaseEvents.length; index += 1) {
      assert.ok(phaseEvents[index].completed >= phaseEvents[index - 1].completed);
    }
    assert.ok(phaseEvents.every((event) => event.completed <= event.total));
  }
  const terminalCoordinateIndex = events.findIndex((event) => (
    event.phase === "coordinate-recurrence" && event.completed === event.total
  ));
  const firstPerPoseIndex = events.findIndex((event) => event.phase === "per-pose-audit");
  assert.ok(terminalCoordinateIndex >= 0, "coordinate recurrence must emit terminal progress");
  assert.ok(firstPerPoseIndex > terminalCoordinateIndex, "per-pose audit cannot begin before terminal coordinate progress");
  assert.equal(events.filter((event) => event.phase === "per-pose-audit" && event.completed === event.total).length, 1);
  assert.equal(result.poseAudits.length, 2);
});

test("creates a no-raw-source dossier bound to the resolved manifest and pose reports", () => {
  const coordinateText = coordinate();
  const paeText = JSON.stringify({ pae: matrix(8), max_pae: 10 });
  const raw = [
    { path: "pose.pdb", bytes: Buffer.byteLength(coordinateText), sha256: sha(coordinateText), text: coordinateText },
    { path: "scores.json", bytes: Buffer.byteLength(paeText), sha256: sha(paeText), text: paeText },
  ];
  let manifest = createPredictionRunManifest(raw);
  const coordinateRecord = manifest.files.find((file) => file.kind === "coordinate");
  const paeRecord = manifest.files.find((file) => file.kind === "pae-json");
  manifest = createPredictionRunManifest(raw, { [coordinateRecord.id]: { paeFileId: paeRecord.id } });
  const coordinateFile = predictionRunFileById(manifest, coordinateRecord.id);
  const paeFile = predictionRunFileById(manifest, paeRecord.id);
  const makeSource = (file) => ({
    id: file.id, path: file.path, filename: file.filename, bytes: file.bytes, sha256: file.sha256, text: file.text,
  });
  const result = executePredictionRunAuditJob(job([pose(
    manifest.poses[0].id,
    makeSource(coordinateFile),
    makeSource(paeFile),
    {
      provider: manifest.poses[0].provider,
      poseKey: manifest.poses[0].poseKey,
      variant: manifest.poses[0].variant,
      associationBasis: "explicit",
    },
  )], { referenceCoordinateFileId: coordinateRecord.id }));
  const dossier = createPredictionRunDossier(manifest, result, null, "2026-08-28T12:34:56.000Z");
  const serialized = JSON.stringify(dossier);
  assert.equal(dossier.privacy.rawCoordinateTextIncluded, false);
  assert.equal(dossier.privacy.paeMatricesIncluded, false);
  assert.equal(dossier.privacy.selectedProteinSequencesIncluded, true);
  assert.equal(dossier.privacy.residueContactTablesIncluded, true);
  assert.equal(dossier.privacy.researcherDecisionsIncluded, false);
  assert.doesNotMatch(serialized, /"text"\s*:/);
  assert.doesNotMatch(serialized, /ATOM\s+1/);
  assert.doesNotMatch(serialized, /"matrix"\s*:/);
  assert.equal(dossier.result.poseAudits[0].coordinate.sha256, coordinateRecord.sha256);
  assert.equal(dossier.result.poseAudits[0].pae.sha256, paeRecord.sha256);

  const mutations = [
    (copy) => { copy.result.schemaVersion = "9.0.0"; },
    (copy) => { copy.result.claimBoundary = "Binding validated"; },
    (copy) => { copy.result.counts.paeAudited += 1; },
    (copy) => { copy.result.poseAudits[0].coordinate.path = "forged/pose.pdb"; },
    (copy) => { copy.result.poseAudits[0].pae.sha256 = "f".repeat(64); },
    (copy) => { copy.result.poseAudits[0].pae.bytes += 1; },
    (copy) => { copy.result.poseAudits[0].singleAudit.structure.sourceFileSha256 = "e".repeat(64); },
    (copy) => { copy.result.poseAudits[0].pae.conservativeLargerDirectionMedianAngstrom += 1; },
    (copy) => { copy.result.poseAudits[0].coordinate.extra = true; },
    (copy) => { copy.result.poseAudits[0].chains.extra = true; },
    (copy) => { copy.result.poseAudits[0].pae.extra = true; },
    (copy) => { copy.result.poseAudits[0].pae.interpretation = "Binding confirmed"; },
    (copy) => { copy.result.poseAudits[0].pae.sourceFormat = "raw matrix"; },
    (copy) => { copy.result.poseAudits[0].pae.maxPaeAngstrom += 1; },
    (copy) => { copy.result.poseAudits[0].pae.mapping.proteinResidueCount += 1; },
    (copy) => { copy.result.poseAudits[0].pae.mapping.sourceIndexMap = [1, 0, 2, 3, 4, 5, 6, 7]; },
    (copy) => { copy.result.poseAudits[0].pae.mapping.extra = true; },
  ];
  for (const mutate of mutations) {
    const copy = { manifest: structuredClone(manifest), result: structuredClone(result) };
    mutate(copy);
    assert.throws(
      () => createPredictionRunDossier(copy.manifest, copy.result, null, "2026-08-28T12:34:56.000Z"),
      /invalid|inconsistent|provenance|reconcile|counts|boundary|version|manifest|attestation|unsupported|interpretation|identity/i,
    );
  }
});

test("CSV neutralizes formula-like source text after leading whitespace and preserves directional field names", () => {
  const coord = source("coord-csv", "run/pose.pdb", coordinate());
  const result = executePredictionRunAuditJob(job([pose("  =HYPERLINK", coord)]));
  const csv = predictionRunPoseSummaryCsv(result);
  assert.match(csv, /receptor_aligned_vhh_evaluated_median_angstrom/);
  assert.match(csv, /vhh_aligned_receptor_evaluated_median_angstrom/);
  assert.match(csv, /"'  =HYPERLINK"/);
});

test("rejects duplicate selected coordinate digests before recurrence", () => {
  const text = coordinate();
  const one = source("coord-one", "run/one.pdb", text);
  const two = source("coord-two", "run/two.pdb", text);
  assert.throws(() => executePredictionRunAuditJob(job([
    pose("one", one), pose("two", two),
  ])), /identical SHA-256/i);
});

test("enforces declared UTF-8 byte provenance and explicit reference identity", () => {
  const coord = source("coord-bytes", "run/pose.pdb", coordinate());
  const wrongBytes = structuredClone(coord);
  wrongBytes.bytes += 1;
  assert.throws(() => executePredictionRunAuditJob(job([pose("bytes", wrongBytes)])), /byte count does not match/i);
  assert.throws(() => executePredictionRunAuditJob(job([pose("ref", coord)], {
    referenceCoordinateFileId: "missing",
  })), /not included/i);
});

test("validates the complete worker-facing prediction-run job envelope before parsing", () => {
  const one = source("coord-input-one", "run/one.pdb", coordinate());
  const two = source("coord-input-two", "run/two.pdb", coordinate(4.2));
  const cases = [
    [job([pose("bad-provider", one, null, { provider: "invented" })]), /provider is unsupported/i],
    [job([pose("bad-association", one, null, { associationBasis: "unresolved" })]), /association basis/i],
    [job([pose("undefined-key", one, null, { poseKey: undefined })]), /pose key/i],
    [job([pose("undefined-variant", one, null, { variant: undefined })]), /pose variant/i],
    [job([pose("false-pae", one, false)]), /PAE source must be an object or null/i],
    [job([pose("zero-pae", one, 0)]), /PAE source must be an object or null/i],
    [job([pose("empty-pae", one, "")]), /PAE source must be an object or null/i],
    [job([pose("undefined-pae", one, null, { pae: undefined })]), /PAE source must be an object or null/i],
    [{ ...job([pose("extra-job", one)]), extra: true }, /unsupported fields/i],
    [job([
      pose("one", one),
      pose("two", { ...two, id: one.id }),
    ]), /unique file ownership/i],
    [job([pose("same-chain", one)], {
      referenceVhhChain: "R",
    }), /must be distinct/i],
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(() => executePredictionRunAuditJob(candidate), pattern);
  }
});

test("requires unique exact per-pose PAE ownership", () => {
  const paeText = JSON.stringify({ pae: matrix(8), max_pae: 10 });
  const firstPae = source("pae-one", "run/one.json", paeText);
  assert.throws(() => executePredictionRunAuditJob(job([
    pose("one", source("coord-one-pae", "run/one.pdb", coordinate()), firstPae),
    pose("two", source("coord-two-pae", "run/two.pdb", coordinate(4.2)), firstPae),
  ])), /unique per-pose ownership/i);
});

test("validates native PAE source metadata on the direct worker path", () => {
  const coordinateText = coordinate();
  const structure = executeParseCoordinateJob({ filename: "pose.pdb", text: coordinateText });
  const pae = source("pae-direct", "run/direct.json", JSON.stringify({ pae: matrix(8) }));
  assert.throws(() => extractNativePredictionPae({ ...pae, bytes: pae.bytes + 1 }, structure), /byte count does not match/i);
  assert.throws(() => extractNativePredictionPae({ ...pae, filename: "other.json" }, structure), /filename must match/i);
});
