import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAX_PREDICTION_RUN_FILES,
  MAX_PREDICTION_RUN_PAE_TOTAL_BYTES,
  createPredictionRunManifest,
  decodePredictionRunUtf8,
  normalizePredictionRunPath,
  predictionRunManifestForExport,
} from "../lib/prediction-run.ts";

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

function atomLine({ serial, atomName = "CA", chain = "A", residue = 1, x = 0, y = 0, z = 0 }) {
  return [
    "ATOM".padEnd(6), String(serial).padStart(5), " ", atomName.padStart(4), " ", "ALA", " ", chain,
    String(residue).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8), "  1.00", "80.00", "          C",
  ].join("");
}

function pdb(seed = 0) {
  return [
    "TITLE     PREDICTION RUN FIXTURE",
    atomLine({ serial: 1, chain: "A", residue: 1, x: seed, y: 0 }),
    atomLine({ serial: 2, chain: "A", residue: 2, x: seed + 3.8, y: 0 }),
    atomLine({ serial: 3, chain: "B", residue: 1, x: seed, y: 3.4 }),
    atomLine({ serial: 4, chain: "B", residue: 2, x: seed + 3.8, y: 3.4 }),
    "END",
  ].join("\n");
}

function cif(seed = 0) {
  return `data_run\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_alt_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.auth_asym_id\n_atom_site.label_seq_id\n_atom_site.auth_seq_id\n_atom_site.pdbx_PDB_ins_code\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.occupancy\n_atom_site.B_iso_or_equiv\nATOM 1 C CA . ALA A A 1 1 ? ${seed} 0 0 1 80\nATOM 2 C CA . ALA B B 1 1 ? ${seed} 3.4 0 1 80\n`;
}

function raw(path, text, { binary = false } = {}) {
  const bytes = Buffer.from(text);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: sha(bytes),
    text: binary ? null : text,
  };
}

function pae(n = 4) {
  return JSON.stringify({ pae: Array.from({ length: n }, (_, row) => (
    Array.from({ length: n }, (_, column) => row === column ? 0 : 4 + row + column)
  )), max_pae: 20 });
}

test("pairs AlphaFold Server coordinate and full-data JSON by exact model index", () => {
  const manifest = createPredictionRunManifest([
    raw("job/fold_beta_model_0.cif", cif()),
    raw("job/fold_beta_full_data_0.json", pae(2)),
    raw("job/fold_beta_summary_confidences_0.json", JSON.stringify({ ptm: 0.8 })),
  ]);
  assert.equal(manifest.poses.length, 1);
  assert.equal(manifest.poses[0].provider, "alphafold-server");
  assert.equal(manifest.poses[0].status, "ready");
  assert.equal(manifest.poses[0].associationBasis, "exact-native-key");
  assert.ok(manifest.poses[0].paeFileId);
  assert.ok(manifest.poses[0].confidenceFileId);
  assert.equal(manifest.files.find((file) => file.filename.includes("summary"))?.kind, "confidence-json");
});

test("pairs ColabFold scores with the complete anchored rank/model/seed tag", () => {
  const tag = "rank_001_alphafold2_multimer_v3_model_2_seed_007";
  const manifest = createPredictionRunManifest([
    raw(`screen_unrelaxed_${tag}.pdb`, pdb()),
    raw(`screen_scores_${tag}.json`, pae()),
  ]);
  assert.equal(manifest.poses[0].provider, "colabfold");
  assert.equal(manifest.poses[0].variant, "unrelaxed");
  assert.equal(manifest.poses[0].status, "ready");
});

test("strips the rightmost ColabFold role suffix when the user prefix contains native-looking text", () => {
  const prefixes = [
    "screen_unrelaxed_rank_001_previous",
    "screen_scores_rank_002_previous",
  ];
  const files = prefixes.flatMap((prefix, index) => {
    const tag = `rank_00${index + 1}_alphafold2_multimer_v3_model_1_seed_000`;
    return [
      raw(`${prefix}_unrelaxed_${tag}.pdb`, pdb(index)),
      raw(`${prefix}_scores_${tag}.json`, pae()),
    ];
  });
  const manifest = createPredictionRunManifest(files);
  assert.equal(manifest.poses.length, 2);
  assert.ok(manifest.poses.every((pose) => pose.status === "ready"));
});

test("does not confuse ColabFold rank 001 with rank 010", () => {
  const files = [1, 10].flatMap((rank, index) => {
    const digits = String(rank).padStart(3, "0");
    const tag = `rank_${digits}_alphafold2_multimer_v3_model_1_seed_000`;
    return [
      raw(`job_unrelaxed_${tag}.pdb`, pdb(index)),
      raw(`job_scores_${tag}.json`, pae()),
    ];
  });
  const manifest = createPredictionRunManifest(files);
  assert.equal(manifest.poses.length, 2);
  assert.ok(manifest.poses.every((pose) => pose.status === "ready"));
  assert.notEqual(manifest.poses[0].paeFileId, manifest.poses[1].paeFileId);
});

test("requires one ColabFold relaxed/unrelaxed variant before reusing one score file", () => {
  const tag = "rank_001_alphafold2_multimer_v3_model_1_seed_000";
  const files = [
    raw(`job_unrelaxed_${tag}.pdb`, pdb()),
    raw(`job_relaxed_${tag}.pdb`, pdb(0.1)),
    raw(`job_scores_${tag}.json`, pae()),
  ];
  let manifest = createPredictionRunManifest(files);
  assert.ok(manifest.poses.every((pose) => pose.status === "needs-review"));
  const excluded = manifest.poses.find((pose) => pose.variant === "relaxed");
  manifest = createPredictionRunManifest(files, { [excluded.coordinateFileId]: { included: false } });
  assert.equal(manifest.poses.find((pose) => pose.variant === "unrelaxed")?.status, "ready");
  assert.equal(manifest.poses.find((pose) => pose.variant === "relaxed")?.status, "excluded");
});

test("pairs local AlphaFold 3 sample files only inside their relative directory", () => {
  const manifest = createPredictionRunManifest([
    raw("seed-1/sample-0/model_model.cif", cif()),
    raw("seed-1/sample-0/model_confidences.json", pae(2)),
    raw("seed-1/sample-0/model_summary_confidences.json", JSON.stringify({ ptm: 0.8 })),
    raw("seed-2/sample-0/model_model.cif", cif(1)),
    raw("seed-2/sample-0/model_confidences.json", pae(2)),
    raw("seed-2/sample-0/model_summary_confidences.json", JSON.stringify({ ptm: 0.7 })),
  ]);
  assert.equal(manifest.poses.length, 2);
  assert.ok(manifest.poses.every((pose) => pose.provider === "alphafold-local" && pose.status === "ready"));
  assert.ok(manifest.poses.every((pose) => pose.confidenceFileId));
  const pairedPaths = manifest.poses.map((pose) => manifest.files.find((file) => file.id === pose.paeFileId).directory);
  assert.deepEqual(pairedPaths.sort(), ["seed-1/sample-0", "seed-2/sample-0"]);
});

test("excludes the local AlphaFold 3 top-ranked copy by naming even when its bytes differ", () => {
  const files = [
    raw("hello_fold/hello_fold_model.cif", cif(0.25)),
    raw("hello_fold/hello_fold_confidences.json", pae(2)),
    raw("hello_fold/hello_fold_summary_confidences.json", JSON.stringify({ ptm: 0.9 })),
    raw("hello_fold/seed-1234_sample-0/hello_fold_seed-1234_sample-0_model.cif", cif()),
    raw("hello_fold/seed-1234_sample-0/hello_fold_seed-1234_sample-0_confidences.json", pae(2)),
    raw("hello_fold/seed-1234_sample-0/hello_fold_seed-1234_sample-0_summary_confidences.json", JSON.stringify({ ptm: 0.9 })),
  ];
  let manifest = createPredictionRunManifest(files);
  const root = manifest.poses.find((pose) => pose.variant === "top-ranked-alias");
  const sample = manifest.poses.find((pose) => pose.variant !== "top-ranked-alias");
  assert.equal(root?.status, "excluded");
  assert.equal(root?.included, false);
  assert.equal(sample?.status, "ready");
  assert.equal(manifest.totals.readyPoseCount, 1);

  manifest = createPredictionRunManifest(files, { [root.coordinateFileId]: { included: true } });
  assert.ok(manifest.poses.every((pose) => pose.status === "needs-review"));
  assert.ok(manifest.poses.every((pose) => pose.issues.some((issue) => /top-ranked copy/i.test(issue))));

  manifest = createPredictionRunManifest(files, {
    [root.coordinateFileId]: { included: true },
    [sample.coordinateFileId]: { included: false },
  });
  assert.equal(manifest.poses.find((pose) => pose.coordinateFileId === root.coordinateFileId)?.status, "ready");
});

test("recognizes Boltz confidence JSON and binary PAE without substituting confidence for PAE", () => {
  const manifest = createPredictionRunManifest([
    raw("predictions/job/job_model_0.cif", cif()),
    raw("predictions/job/confidence_job_model_0.json", JSON.stringify({ confidence_score: 0.7, complex_ipde: 0.4 })),
    raw("predictions/job/pae_job_model_0.npz", "NPZBYTES", { binary: true }),
  ]);
  assert.equal(manifest.files.find((file) => file.filename.startsWith("confidence_"))?.kind, "confidence-json");
  assert.equal(manifest.files.find((file) => file.filename.startsWith("pae_"))?.kind, "unsupported-pae");
  assert.equal(manifest.poses[0].paeFileId, null);
  assert.equal(manifest.poses[0].status, "needs-review");
  const coordinateOnly = createPredictionRunManifest(manifest.files.map((file) => ({
    path: file.path, bytes: file.bytes, sha256: file.sha256, text: file.text,
  })), { [manifest.poses[0].coordinateFileId]: { paeFileId: null } });
  assert.equal(coordinateOnly.poses[0].status, "ready");
});

test("resolves fold-prefixed Boltz coordinates from companions, including a flattened upload", () => {
  for (const directory of ["", "predictions/fold_job"]) {
    const prefix = directory ? `${directory}/` : "";
    const manifest = createPredictionRunManifest([
      raw(`${prefix}fold_job_model_0.cif`, cif()),
      raw(`${prefix}confidence_fold_job_model_0.json`, JSON.stringify({ confidence_score: 0.7, ptm: 0.8 })),
      raw(`${prefix}pae_fold_job_model_0.npz`, "NPZBYTES", { binary: true }),
    ]);
    assert.equal(manifest.poses[0].provider, "boltz", directory);
    assert.ok(manifest.poses[0].confidenceFileId, directory);
    assert.ok(manifest.poses[0].unsupportedPaeFileId, directory);
  }
});

test("does not guess when fold-prefixed AlphaFold Server and Boltz companions conflict", () => {
  const manifest = createPredictionRunManifest([
    raw("fold_job_model_0.cif", cif()),
    raw("fold_job_full_data_0.json", pae(2)),
    raw("confidence_fold_job_model_0.json", JSON.stringify({ confidence_score: 0.7 })),
  ]);
  assert.equal(manifest.poses[0].provider, "unknown");
  assert.equal(manifest.poses[0].poseKey, null);
  assert.equal(manifest.poses[0].status, "needs-review");
  assert.ok(manifest.poses[0].issues.some((issue) => /conflicting AlphaFold Server and Boltz/i.test(issue)));
});

test("quarantines PAE matrices hidden under confidence and ranking filenames", () => {
  const manifest = createPredictionRunManifest([
    raw("predictions/job/job_model_0.cif", cif()),
    raw("predictions/job/confidence_job_model_0.json", JSON.stringify({ confidence_score: 0.7, pae: [[0]] })),
    raw("ranking_debug.json", JSON.stringify({ order: ["model_1"], pae: [[0]] })),
  ]);
  assert.ok(manifest.files.filter((file) => /confidence_|ranking_debug/.test(file.filename)).every((file) => file.kind === "rejected"));
  assert.equal(manifest.poses[0].paeFileId, null);
  assert.equal(manifest.poses[0].status, "needs-review");
  assert.ok(manifest.poses[0].issues.some((issue) => /quarantined/i.test(issue)));
});

test("manual PAE association is explicit and cannot be reused by included poses", () => {
  const files = [raw("one.pdb", pdb()), raw("two.pdb", pdb(2)), raw("scores.json", pae())];
  let manifest = createPredictionRunManifest(files);
  const [one, two] = manifest.poses;
  const paeId = manifest.files.find((file) => file.kind === "pae-json").id;
  manifest = createPredictionRunManifest(files, {
    [one.coordinateFileId]: { paeFileId: paeId },
    [two.coordinateFileId]: { paeFileId: paeId },
  });
  assert.ok(manifest.poses.every((pose) => pose.status === "needs-review"));
  assert.ok(manifest.poses.every((pose) => pose.issues.some((issue) => /cannot be attached to multiple/i.test(issue))));
});

test("identical coordinate aliases block recurrence until one is excluded", () => {
  const same = pdb();
  const files = [raw("sample/model.pdb", same), raw("winner/model.pdb", same)];
  let manifest = createPredictionRunManifest(files);
  assert.ok(manifest.poses.every((pose) => pose.status === "needs-review"));
  manifest = createPredictionRunManifest(files, {
    [manifest.poses[1].coordinateFileId]: { included: false },
  });
  assert.equal(manifest.poses.filter((pose) => pose.status === "ready").length, 1);
});

test("manifest is invariant to FileList order", () => {
  const files = [
    raw("job/fold_x_model_0.cif", cif()),
    raw("job/fold_x_full_data_0.json", pae(2)),
    raw("notes.json", JSON.stringify({ note: "kept" })),
  ];
  const left = predictionRunManifestForExport(createPredictionRunManifest(files));
  const right = predictionRunManifestForExport(createPredictionRunManifest([...files].reverse()));
  assert.deepEqual(left, right);
});

test("export strips decoded coordinate and PAE source text", () => {
  const manifest = createPredictionRunManifest([raw("pose.pdb", pdb())]);
  const exported = predictionRunManifestForExport(manifest);
  assert.ok(exported.files.every((file) => !("text" in file)));
  assert.doesNotMatch(JSON.stringify(exported), /PREDICTION RUN FIXTURE/);
});

test("rejects disguised coordinate content and malformed native PAE JSON", () => {
  assert.throws(() => createPredictionRunManifest([raw("pose.pdb", JSON.stringify({ hello: "world" }))]), /No supported text PDB/i);
  const manifest = createPredictionRunManifest([
    raw("fold_x_model_0.cif", cif()),
    raw("fold_x_full_data_0.json", JSON.stringify({ contact_probs: [[1]] })),
  ]);
  assert.equal(manifest.files.find((file) => file.filename.endsWith("full_data_0.json"))?.kind, "rejected");
  assert.equal(manifest.poses[0].status, "needs-review");
});

test("generic coordinate-only inputs remain explicitly visible and ready", () => {
  const manifest = createPredictionRunManifest([raw("candidate.pdb", pdb())]);
  assert.equal(manifest.poses[0].status, "ready");
  assert.equal(manifest.poses[0].associationBasis, "none");
  assert.equal(manifest.poses[0].paeFileId, null);
});

test("path validation rejects traversal, absolute, control, bidi, empty, and collisions", () => {
  for (const path of ["../x.pdb", "/x.pdb", "C:\\x.pdb", "a//x.pdb", "a/./x.pdb", "x\u0000.pdb", "x\u202epdb"]) {
    assert.throws(() => normalizePredictionRunPath(path), /path|control|relative|directory/i, path);
  }
  assert.equal(normalizePredictionRunPath("run\\pose.pdb"), "run/pose.pdb");
  assert.throws(() => createPredictionRunManifest([
    raw("Run/Pose.pdb", pdb()),
    raw("run/pose.PDB", pdb(1)),
  ]), /collid/i);
});

test("enforces file-count and digest integrity boundaries", () => {
  const tooMany = Array.from({ length: MAX_PREDICTION_RUN_FILES + 1 }, (_, index) => raw(`file-${index}.txt`, "x"));
  assert.throws(() => createPredictionRunManifest(tooMany), /at most/i);
  const invalidDigest = raw("pose.pdb", pdb());
  invalidDigest.sha256 = "nope";
  assert.throws(() => createPredictionRunManifest([invalidDigest]), /SHA-256/i);
  const wrongBytes = raw("wrong-bytes.pdb", pdb());
  wrongBytes.bytes += 1;
  assert.throws(() => createPredictionRunManifest([wrongBytes]), /byte count does not match/i);
});

test("rejects UTF-8 BOM inputs before manifest classification", () => {
  const withBom = (text) => Uint8Array.from(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(text),
  ])).buffer;
  assert.throws(() => decodePredictionRunUtf8(withBom(pdb()), "pose.pdb"), /byte-order mark|BOM-free/i);
  assert.throws(() => decodePredictionRunUtf8(withBom(pae()), "scores.json"), /byte-order mark|BOM-free/i);
  assert.equal(decodePredictionRunUtf8(Uint8Array.from(Buffer.from(pdb())).buffer, "pose.pdb"), pdb());
  assert.throws(() => createPredictionRunManifest([raw("bom.pdb", `\uFEFF${pdb()}`)]), /byte-order mark|BOM-free/i);
  assert.throws(() => createPredictionRunManifest([
    raw("fold_bom_model_0.cif", cif()),
    raw("fold_bom_full_data_0.json", `\uFEFF${pae(2)}`),
  ]), /byte-order mark|BOM-free/i);
});

test("blocks ready PAE selections above the shared 48 MiB aggregate audit limit", () => {
  const basePae = pae(2);
  const perFileBytes = Math.floor(MAX_PREDICTION_RUN_PAE_TOTAL_BYTES / 4) + 1_024;
  const paddedPae = `${basePae}${" ".repeat(perFileBytes - Buffer.byteLength(basePae))}`;
  const files = Array.from({ length: 4 }, (_, index) => [
    raw(`run/fold_job_model_${index}.cif`, cif(index)),
    raw(`run/fold_job_full_data_${index}.json`, paddedPae),
  ]).flat();
  let manifest = createPredictionRunManifest(files);
  assert.ok(manifest.poses.every((pose) => pose.status === "needs-review"));
  assert.ok(manifest.poses.every((pose) => pose.issues.some((issue) => /48 MiB aggregate audit limit/i.test(issue))));

  manifest = createPredictionRunManifest(files, {
    [manifest.poses[0].coordinateFileId]: { paeFileId: null },
  });
  assert.ok(manifest.poses.every((pose) => pose.status === "ready"));
  assert.equal(manifest.poses.filter((pose) => pose.paeFileId != null).length, 3);
});
