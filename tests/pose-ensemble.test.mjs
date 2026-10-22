import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeSelectedGeometry,
  createPoseEnsembleExportReport,
  MAX_ENSEMBLE_POSES,
  POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION,
  jaccardIndex,
  matchEnsembleChains,
  poseEnsembleToCsv,
  summarizePoseEnsemble,
} from "../lib/pose-ensemble.ts";
import { analyzeInterface, CONFOVHH_VERSION } from "../lib/confovhh.ts";

function structure(
  receptorSequence = "A".repeat(32),
  vhhSequence = "C".repeat(32),
  receptorId = "A",
  vhhId = "B",
) {
  return {
    sourceFormat: "pdb",
    coordinateScope: "as-supplied",
    selectedModelId: "1",
    selectedAssembly: null,
    chains: [
      { id: receptorId, sequence: receptorSequence },
      { id: vhhId, sequence: vhhSequence },
    ],
  };
}

function fixtureSignature(id) {
  let value = 0;
  for (let index = 0; index < id.length; index += 1) {
    value += id.charCodeAt(index) * (index + 1);
  }
  return value;
}

function attestedStructure(id, pairs, {
  receptorSequence = "A".repeat(32),
  vhhSequence = "C".repeat(32),
  receptorChain = "A",
  vhhChain = "B",
  contactDistance,
} = {}) {
  const signature = fixtureSignature(id);
  const pairedReceptorByVhh = new Map();
  for (const [receptorOrder, vhhOrder] of pairs) {
    if (
      Number.isInteger(receptorOrder) && receptorOrder >= 1 && receptorOrder <= receptorSequence.length &&
      Number.isInteger(vhhOrder) && vhhOrder >= 1 && vhhOrder <= vhhSequence.length
    ) pairedReceptorByVhh.set(vhhOrder, receptorOrder);
  }
  let serial = 1;
  const makeResidues = (role, chainId, sequence) => [...sequence].map((oneLetter, index) => {
    const order = index + 1;
    const residueName = role === "receptor" ? "ALA" : "CYS";
    const receptorOrder = pairedReceptorByVhh.get(order);
    const distance = contactDistance ?? 3 + (signature % 8) * 0.12;
    const atom = {
      serial: serial++,
      name: "CA",
      residueName,
      chainId,
      residueNumber: order,
      insertionCode: "",
      residueKey: `${chainId}:${order}`,
      residueOrder: order,
      x: role === "receptor" ? order * 20 : (receptorOrder ?? order) * 20,
      y: role === "receptor" ? 0 : receptorOrder == null ? 1_000 : distance,
      z: role === "receptor" && order === sequence.length ? signature * 0.137 : 0,
      element: "C",
      bFactor: null,
    };
    return {
      key: atom.residueKey,
      chainId,
      name: residueName,
      number: order,
      insertionCode: "",
      order,
      oneLetter,
      labelSequenceId: order,
      authSequenceId: order,
      atoms: [atom],
    };
  });
  const receptorResidues = makeResidues("receptor", receptorChain, receptorSequence);
  const vhhResidues = makeResidues("vhh", vhhChain, vhhSequence);
  const makeChain = (chainId, sequence, residues, roleHint) => ({
    id: chainId,
    atomCount: residues.length,
    residueCount: residues.length,
    sequence,
    backboneCompleteness: 1,
    roleHint,
    residues,
  });
  const chains = [
    makeChain(receptorChain, receptorSequence, receptorResidues, "receptor-like"),
    makeChain(vhhChain, vhhSequence, vhhResidues, "VHH-like"),
  ];
  return {
    atoms: chains.flatMap((chain) => chain.residues.flatMap((residue) => residue.atoms)),
    chains,
    title: "Synthetic attested ensemble fixture",
    experimentalMethod: "THEORETICAL MODEL",
    modelCount: 1,
    ignoredAlternateLocations: 0,
    ignoredHydrogens: 0,
    duplicateAtomRecords: 0,
    malformedAtomRecords: 0,
    unsupportedResidueRecords: 0,
    zeroOccupancyAtomRecords: 0,
    residueNameConflicts: 0,
    sourceFormat: "pdb",
    coordinateScope: "as-supplied",
    selectedModelId: "1",
    availableModelIds: ["1"],
    availableAssemblies: [],
    selectedAssembly: null,
  };
}

function pose(id, pairs, options = {}) {
  const parsed = attestedStructure(id, pairs, options);
  const audit = analyzeInterface(
    parsed,
    options.receptorChain ?? "A",
    options.vhhChain ?? "B",
    "none",
    null,
    false,
    canonicalizeSelectedGeometry(
      parsed,
      options.receptorChain ?? "A",
      options.vhhChain ?? "B",
    ),
  );
  if (options.evidenceLevel != null) audit.evidenceLevel = options.evidenceLevel;
  if (options.severeClashCount != null) audit.severeClashCount = options.severeClashCount;
  if (options.deltaSasaAngstrom2 != null) {
    audit.deltaSasaAngstrom2 = options.deltaSasaAngstrom2;
    audit.receptorBuriedSurfaceAreaAngstrom2 = options.deltaSasaAngstrom2 / 2;
    audit.vhhBuriedSurfaceAreaAngstrom2 = options.deltaSasaAngstrom2 / 2;
    audit.halfDeltaSasaInterfaceAreaAngstrom2 = options.deltaSasaAngstrom2 / 2;
  }
  return {
    id,
    filename: `${id}.pdb`,
    sha256: options.sha256,
    bytes: options.bytes,
    structure: parsed,
    audit,
  };
}

function exportableSummary(summary) {
  const snapshot = structuredClone(summary);
  snapshot.poses.forEach((entry, index) => {
    const digit = (index + 1).toString(16);
    entry.sha256 = digit.repeat(64);
    entry.bytes = 1_000 + index;
  });
  return snapshot;
}

function csvColumnCount(row) {
  let columns = 1;
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '"') {
      if (quoted && row[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (row[index] === "," && !quoted) columns += 1;
  }
  return columns;
}

test("Jaccard similarity handles partial, disjoint, and empty sets explicitly", () => {
  assert.equal(jaccardIndex(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
  assert.equal(jaccardIndex(new Set(["a"]), new Set(["b"])), 0);
  assert.equal(jaccardIndex(new Set(), new Set(["b"])), 0);
  assert.equal(jaccardIndex(new Set(), new Set()), null);
});

test("identical contacting poses receive complete consensus", () => {
  const summary = summarizePoseEnsemble([
    pose("a", [[1, 1], [2, 2]]),
    pose("b", [[1, 1], [2, 2]]),
  ]);
  assert.deepEqual(summary.poses.map((entry) => entry.ensembleConsensus), [1, 1]);
  assert.deepEqual(summary.poses.map((entry) => entry.recurrentContactShare), [1, 1]);
  assert.deepEqual(summary.pairwiseConsensus, [[1, 1], [1, 1]]);
});

test("a reproduced pose cluster ranks above an isolated contact pattern", () => {
  const summary = summarizePoseEnsemble([
    pose("cluster-1", [[1, 1], [2, 2], [3, 3]]),
    pose("cluster-2", [[1, 1], [2, 2], [3, 3]]),
    pose("cluster-3", [[1, 1], [2, 2], [4, 4]]),
    pose("outlier", [[8, 8], [9, 9], [10, 10]]),
  ]);
  assert.equal(summary.poses.at(-1).id, "outlier");
  assert.ok(summary.poses[0].ensembleConsensus > summary.poses.at(-1).ensembleConsensus);
});

test("recurrence order is not overridden by a weaker coordinate-evidence band", () => {
  const supportedIsolated = Array.from({ length: 18 }, (_, index) => [index + 1, index + 1]);
  const recurringMixed = Array.from({ length: 8 }, (_, index) => [index + 20, index + 20]);
  const summary = summarizePoseEnsemble([
    pose("coherent", supportedIsolated),
    pose("review-1", recurringMixed),
    pose("review-2", recurringMixed),
  ]);
  assert.equal(summary.poses[0].id, "review-1");
  assert.equal(summary.poses[0].triageGroup, "review");
  assert.equal(summary.poses.at(-1).id, "coherent");
  assert.match(summary.methods.ranking, /consensus first/i);
  assert.match(summary.warnings.join(" "), /canonical-anchor switch/i);
});

test("consensus ties use clash burden then stable ID, never ΔSASA", () => {
  const summary = summarizePoseEnsemble([
    pose("z-high-sasa", [[1, 1], [2, 2]], { contactDistance: 0.1 }),
    pose("b-low-sasa", [[1, 1], [2, 2]], { contactDistance: 4.2 }),
    pose("a-high-sasa", [[1, 1], [2, 2]], { contactDistance: 3.0 }),
  ]);
  assert.deepEqual(summary.poses.map((entry) => entry.id), [
    "a-high-sasa", "b-low-sasa", "z-high-sasa",
  ]);
  assert.deepEqual(summary.poses.map((entry) => entry.rank), [1, 1, 3]);
  assert.match(summary.methods.ranking, /display order only/i);
});

test("ensemble results are invariant to upload order", () => {
  const inputs = [
    pose("a", [[1, 1], [2, 2]]),
    pose("b", [[1, 1], [2, 3]]),
    pose("c", [[9, 9]]),
  ];
  const forward = summarizePoseEnsemble(inputs).poses;
  const reverse = summarizePoseEnsemble([...inputs].reverse()).poses;
  assert.deepEqual(
    forward.map(({ id, rank, ensembleConsensus }) => ({ id, rank, ensembleConsensus })),
    reverse.map(({ id, rank, ensembleConsensus }) => ({ id, rank, ensembleConsensus })),
  );
  const summary = summarizePoseEnsemble([...inputs].reverse());
  assert.deepEqual(summary.pairwisePoseIds, summary.poses.map((entry) => entry.id));
  assert.equal(summary.pairwiseConsensus.length, summary.pairwisePoseIds.length);
  summary.pairwiseConsensus.forEach((row, index) => assert.equal(row[index], 1));
});

test("recurrence serialization is exactly stable across many upload permutations", () => {
  const inputs = Array.from({ length: 12 }, (_, index) => pose(
    `pose-${String(index).padStart(2, "0")}`,
    Array.from({ length: 7 }, (__, contactIndex) => [
      (index * 3 + contactIndex * 5) % 17 + 1,
      (index * 7 + contactIndex * 2) % 19 + 1,
    ]),
  ));
  const normalize = (summary) => Object.fromEntries(summary.poses.map((entry) => [entry.id, {
    contactPairConsensus: entry.contactPairConsensus,
    receptorEpitopeConsensus: entry.receptorEpitopeConsensus,
    vhhParatopeConsensus: entry.vhhParatopeConsensus,
    ensembleConsensus: entry.ensembleConsensus,
    recurrentContactShare: entry.recurrentContactShare,
  }]));
  const expected = normalize(summarizePoseEnsemble(inputs));
  let state = 0x5eed1234;
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const shuffled = [...inputs];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const swapIndex = state % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    assert.deepEqual(normalize(summarizePoseEnsemble(shuffled)), expected);
  }
});

test("recurrent-contact share uses contacts present in at least half the ensemble", () => {
  const summary = summarizePoseEnsemble([
    pose("a", [[1, 1], [2, 2]]),
    pose("b", [[1, 1], [3, 3]]),
    pose("c", [[1, 1], [4, 4]]),
    pose("d", [[5, 5]]),
  ]);
  const a = summary.poses.find((entry) => entry.id === "a");
  const d = summary.poses.find((entry) => entry.id === "d");
  assert.equal(a.recurrentContactShare, 0.5);
  assert.equal(d.recurrentContactShare, 0);
});

test("poses with no interfaces do not gain artificial consensus", () => {
  const summary = summarizePoseEnsemble([pose("a", []), pose("b", [])]);
  assert.equal(summary.poses[0].ensembleConsensus, null);
  assert.equal(summary.poses[0].recurrentContactShare, null);
  assert.equal(summary.pairwiseConsensus[0][1], null);
});

test("exact receptor and VHH sequence mismatches fail closed", () => {
  assert.throws(
    () => summarizePoseEnsemble([
      pose("reference", [[1, 1]]),
      pose("changed", [[1, 1]], { receptorSequence: "AAAT" }),
    ]),
    /do not match the reference pose/i,
  );
});

test("exact sequence matches with incompatible selected atom inventories fail closed", () => {
  const incompleteStructure = attestedStructure("missing-sidechain", [[1, 1], [2, 2]]);
  const removedAtom = incompleteStructure.chains[1].residues.at(-1).atoms.pop();
  assert.ok(removedAtom);
  incompleteStructure.chains[1].atomCount -= 1;
  incompleteStructure.atoms = incompleteStructure.atoms.filter((atom) => atom !== removedAtom);
  const incompleteAudit = analyzeInterface(
    incompleteStructure,
    "A",
    "B",
    "none",
    null,
    false,
    canonicalizeSelectedGeometry(incompleteStructure, "A", "B"),
  );
  assert.throws(
    () => summarizePoseEnsemble([
      pose("inventory-reference", [[1, 1], [2, 2]]),
      {
        id: "inventory-incomplete",
        filename: "inventory-incomplete.pdb",
        structure: incompleteStructure,
        audit: incompleteAudit,
      },
    ]),
    /atom inventory is incompatible/i,
  );
});

test("duplicate identifiers and unsupported ensemble sizes are rejected", () => {
  assert.throws(
    () => summarizePoseEnsemble([pose("same", [[1, 1]]), pose("same", [[1, 1]])]),
    /unique identifier/i,
  );
  assert.throws(() => summarizePoseEnsemble([pose("only", [[1, 1]])]), /at least two/i);
  assert.throws(
    () => summarizePoseEnsemble(Array.from(
      { length: MAX_ENSEMBLE_POSES + 1 },
      (_, index) => pose(String(index), [[index, index]]),
    )),
    /at most/i,
  );
  const first = pose("one", [[1, 1]]);
  const second = pose("two", [[2, 2]]);
  first.sha256 = "d".repeat(64);
  second.sha256 = "d".repeat(64);
  assert.equal(summarizePoseEnsemble([first, second]).poseCount, 2);
});

test("chain matching supports changed chain IDs when both sequences match exactly", () => {
  const matched = matchEnsembleChains(structure("AAAA", "CCCC", "R", "V"), "AAAA", "CCCC");
  assert.deepEqual(matched, { receptorChain: "R", vhhChain: "V" });
  assert.throws(
    () => matchEnsembleChains(structure("AAAT", "CCCC", "R", "V"), "AAAA", "CCCC"),
    /does not contain exact observed/i,
  );
});

test("chain matching rejects duplicate exact-sequence copies instead of selecting by interface geometry", () => {
  const duplicated = structure("AAAA", "CCCC", "R1", "V1");
  duplicated.chains.push(
    { id: "R2", sequence: "AAAA" },
    { id: "V2", sequence: "CCCC" },
  );
  assert.throws(
    () => matchEnsembleChains(duplicated, "AAAA", "CCCC"),
    /multiple indistinguishable receptor–VHH copies/i,
  );
});

test("chain matching rejects a million ambiguous pairs without allocating a Cartesian product", () => {
  const parsed = { chains: [] };
  for (let index = 0; index < 1_000; index += 1) {
    parsed.chains.push({ id: `R${index}`, sequence: "AAAA" });
    parsed.chains.push({ id: `V${index}`, sequence: "CCCC" });
  }
  assert.throws(
    () => matchEnsembleChains(parsed, "AAAA", "CCCC"),
    /multiple indistinguishable receptor–VHH copies/i,
  );
});

test("CSV export preserves scientific values and escapes filenames", () => {
  const input = pose("a", [[1, 1], [2, 2]]);
  const expectedDeltaSasa = String(input.audit.deltaSasaAngstrom2);
  input.filename = "=pose,seed-1.pdb";
  const csv = poseEnsembleToCsv(exportableSummary(summarizePoseEnsemble([
    input,
    pose("b", [[1, 1], [2, 2]]),
  ])));
  assert.match(csv, /"'=pose,seed-1\.pdb"/);
  assert.match(csv, /interface_pae_median_angstrom/);
  assert.match(csv, /schema_version,software_version,rank/);
  assert.match(csv, /receptor_assembly_generator_row_index/);
  assert.match(csv, /receptor_transform_3x4_json/);
  assert.match(csv, /vhh_transform_3x4_json/);
  assert.match(csv, /pdb,as-supplied,1/);
  assert.match(csv, /is_reference/);
  assert.match(csv, /true/);
  assert.ok(csv.includes(expectedDeltaSasa));
  input.filename = "pose\rseed.pdb";
  const carriageReturnCsv = poseEnsembleToCsv(exportableSummary(summarizePoseEnsemble([
    input,
    pose("c", [[1, 1], [2, 2]]),
  ])));
  assert.match(carriageReturnCsv, /pose\\rseed\.pdb/);
  input.filename = " \uFEFF =HYPERLINK(\"https://example.invalid\")\u0000.pdb";
  const formulaCsv = poseEnsembleToCsv(exportableSummary(summarizePoseEnsemble([
    input,
    pose("formula-safe", [[1, 1], [2, 2]]),
  ])));
  assert.match(formulaCsv, /'  =HYPERLINK/);
  assert.doesNotMatch(formulaCsv, /\uFEFF/u);
  assert.match(formulaCsv, /\\u0000\.pdb/);
  input.filename = "\u0085\u200B+SUM(1,1)\u2028seed.pdb";
  const unicodeControlCsv = poseEnsembleToCsv(exportableSummary(summarizePoseEnsemble([
    input,
    pose("unicode-safe", [[1, 1], [2, 2]]),
  ])));
  assert.match(unicodeControlCsv, /'\\u0085\+SUM\(1,1\)\\u2028seed\.pdb/);
  assert.doesNotMatch(unicodeControlCsv.replaceAll("\n", ""), /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);

  const fixedWidth = poseEnsembleToCsv(exportableSummary(summarizePoseEnsemble([
    pose("width-a", [[1, 1]]),
    pose("width-b", [[2, 2]]),
  ]))).split("\n").map(csvColumnCount);
  assert.ok(fixedWidth.every((width) => width === fixedWidth[0]));
  assert.match(csv, /sasa_frame_algorithm/);
  assert.match(csv, /residue_contact_cutoff_angstrom/);
  assert.match(csv, /ranking_method,consensus_method,claim_boundary,confidence_mode,pae_context/);
  assert.match(csv, /reproducibility within the uploaded ensemble/);
  assert.match(csv, /,none,omitted,/);
});

test("JSON report preserves the reference, coordinate-only policy, and exclusions", () => {
  const summary = exportableSummary(summarizePoseEnsemble([
    pose("reference", [[1, 1]]),
    pose("candidate", [[1, 1]]),
  ]));
  const report = createPoseEnsembleExportReport(
    summary,
    "Coordinate-only; no PAE or pLDDT.",
    [{ filename: "bad.pdb", sha256: "E".repeat(64), bytes: 99, reason: "Sequence mismatch." }],
    "2026-08-27T00:00:00.000Z",
  );
  assert.equal(report.referencePoseId, "reference");
  assert.equal(report.schemaVersion, POSE_ENSEMBLE_EXPORT_SCHEMA_VERSION);
  assert.equal(report.softwareVersion, CONFOVHH_VERSION);
  assert.equal(report.auditPolicy.sasaSpherePoints, 960);
  assert.equal(report.auditPolicy.sasaMaximumCandidateDistanceChecks, 25_000_000);
  assert.equal(report.auditPolicy.sasaMaximumOcclusionChecks, 250_000_000);
  assert.equal(report.auditPolicy.sasaOrientation, "deterministic-proper-signed-frame");
  assert.match(report.auditPolicy.fingerprint, /^fnv1a64-audit-policy:[a-f0-9]{16}$/);
  assert.equal(report.summary.poses.find((entry) => entry.id === "reference").isReference, true);
  assert.match(report.comparisonMode, /no PAE/i);
  assert.deepEqual(report.rejected, [{
    filename: "bad.pdb",
    sha256: "e".repeat(64),
    bytes: 99,
    reason: "Sequence mismatch.",
  }]);
  assert.equal(report.generatedAt, "2026-08-27T00:00:00.000Z");
});

test("ensemble export validates rejected records, timestamps, provenance, and snapshots", () => {
  const raw = summarizePoseEnsemble([
    pose("raw-a", [[1, 1]]),
    pose("raw-b", [[2, 2]]),
  ]);
  assert.throws(
    () => createPoseEnsembleExportReport(raw, "Coordinate-only.", []),
    /requires a source SHA-256 digest/i,
  );

  const summary = exportableSummary(raw);
  for (const [rejected, expected] of [
    [[{ filename: "bad.pdb", sha256: "bad", bytes: 1, reason: "bad" }], /64-character hexadecimal/],
    [[{ filename: "", sha256: "f".repeat(64), bytes: 1, reason: "bad" }], /non-empty filename/],
    [[{ filename: "bad.pdb", sha256: "f".repeat(64), bytes: -1, reason: "bad" }], /byte count/],
    [[{ filename: "bad.pdb", sha256: "f".repeat(64), bytes: 1, reason: "" }], /non-empty reason/],
  ]) assert.throws(
    () => createPoseEnsembleExportReport(summary, "Coordinate-only.", rejected),
    expected,
  );
  assert.throws(
    () => createPoseEnsembleExportReport(summary, "", []),
    /comparisonMode/,
  );
  assert.throws(
    () => createPoseEnsembleExportReport(summary, "Coordinate-only.", [], "2026-02-30T00:00:00.000Z"),
    /valid UTC ISO 8601 timestamp/i,
  );

  const report = createPoseEnsembleExportReport(
    summary,
    "Coordinate-only.",
    [],
    "2026-08-27T00:00:00.000Z",
  );
  summary.poses[0].receptorChain.assemblyOperationIds.push("mutated");
  summary.auditPolicy.cdrAnnotation = "mutated";
  assert.doesNotMatch(JSON.stringify(report), /mutated/);
});

test("JSON and CSV share strict ensemble-summary integrity validation", () => {
  const makeSummary = () => exportableSummary(summarizePoseEnsemble([
    pose("shared-a", [[1, 1], [2, 2]]),
    pose("shared-b", [[1, 1], [3, 3]]),
    pose("shared-c", [[8, 8]]),
  ]));
  const rejectBoth = (mutate, expected) => {
    const summary = makeSummary();
    mutate(summary);
    assert.throws(() => poseEnsembleToCsv(summary), expected);
    assert.throws(
      () => createPoseEnsembleExportReport(summary, "Coordinate-only.", []),
      expected,
    );
  };

  for (const [mutate, expected] of [
    [(summary) => { summary.version = "0.4.9"; }, /current ConfoVHH software version/i],
    [(summary) => { summary.auditPolicy.fingerprint = "fnv1a64-audit-policy:0000000000000000"; }, /fingerprint/i],
    [(summary) => { summary.auditPolicy.sasaRadii = "invented"; }, /current fixed ConfoVHH methods\.sasaRadii/i],
    [(summary) => { summary.methods.ranking = "identifier first"; }, /methods\.ranking/i],
    [(summary) => { summary.extra = Number.POSITIVE_INFINITY; }, /finite numbers only/i],
    [(summary) => { summary.poseCount += 1; }, /poseCount does not reconcile/i],
    [(summary) => { summary.poses[1].id = summary.poses[0].id; }, /unique identifier/i],
    [(summary) => { summary.referencePoseId = "missing"; }, /exactly one reference|reference pose flag/i],
    [(summary) => { summary.poses.find((entry) => !entry.isReference).isReference = true; }, /reference pose flag/i],
    [(summary) => { summary.poses[0].sha256 = "bad"; }, /64-character hexadecimal/i],
    [(summary) => { summary.poses[0].bytes = -1; }, /source byte count/i],
    [(summary) => { summary.poses[0].coordinateFingerprint = "unverified"; }, /source-coordinate fingerprint/i],
    [(summary) => { summary.poses[0].geometryFingerprint = "unverified"; }, /canonical geometry fingerprint/i],
    [(summary) => { summary.poses[0].ensembleConsensus = 2; }, /consensus values/i],
    [(summary) => { summary.poses[0].ensembleConsensus = 0.123456789; }, /does not reconcile with its component means/i],
    [(summary) => { summary.poses[0].severeClashCount = summary.poses[0].contactPairCount + 1; }, /counts are inconsistent/i],
    [(summary) => { summary.poses[0].comparisonCount = 0; }, /comparisonCount/i],
    [(summary) => { summary.poses[0].interfacePaeMedianAngstrom = 3; }, /requires interface PAE to be null/i],
    [(summary) => {
      summary.poses[0].triageGroup = summary.poses[0].triageGroup === "coherent"
        ? "review"
        : "coherent";
    }, /does not reconcile with its evidence level/i],
    [(summary) => { summary.poses[0].rank = summary.poseCount; }, /competition ranks|deterministic/i],
    [(summary) => { summary.pairwisePoseIds.reverse(); }, /pairwise pose identifiers/i],
    [(summary) => { summary.pairwiseConsensus.pop(); }, /square poseCount matrix/i],
    [(summary) => { summary.pairwiseConsensus[0][0] = 0; }, /diagonal values/i],
    [(summary) => {
      summary.pairwiseConsensus[0][1] = 0.123456789;
      summary.pairwiseConsensus[1][0] = 0.987654321;
    }, /must be symmetric/i],
    [(summary) => {
      summary.pairwiseConsensus[0][1] = 2;
      summary.pairwiseConsensus[1][0] = 2;
    }, /within \[0, 1\]/i],
  ]) rejectBoth(mutate, expected);
});

test("competition-rank ties are validated independently from stable display order", () => {
  const summary = exportableSummary(summarizePoseEnsemble([
    pose("tie-c", [[1, 1], [2, 2]], { contactDistance: 3 }),
    pose("tie-a", [[1, 1], [2, 2]], { contactDistance: 3 }),
    pose("tie-b", [[1, 1], [2, 2]], { contactDistance: 3 }),
  ]));
  assert.deepEqual(summary.poses.map((entry) => entry.id), ["tie-a", "tie-b", "tie-c"]);
  assert.deepEqual(summary.poses.map((entry) => entry.rank), [1, 1, 1]);
  summary.poses[1].rank = 2;
  assert.throws(() => poseEnsembleToCsv(summary), /competition ranks/i);
});

test("accepted and rejected ensemble provenance share the twelve-record cap", () => {
  const summary = exportableSummary(summarizePoseEnsemble([
    pose("cap-a", [[1, 1]]),
    pose("cap-b", [[2, 2]]),
  ]));
  const rejected = Array.from({ length: 11 }, (_, index) => ({
    filename: `rejected-${index}.pdb`,
    sha256: (index % 16).toString(16).repeat(64),
    bytes: index,
    reason: "Rejected fixture.",
  }));
  assert.throws(
    () => createPoseEnsembleExportReport(summary, "Coordinate-only.", rejected),
    /accepted and rejected pose provenance together/i,
  );
});

test("ensemble summary rejects coordinate-policy drift and incomplete methods", () => {
  const changed = pose("changed", [[1, 1]]);
  changed.audit.methods = { ...changed.audit.methods, sasaSpherePoints: 480 };
  assert.throws(
    () => summarizePoseEnsemble([pose("reference-policy", [[1, 1]]), changed]),
    /current fixed ConfoVHH methods\.sasaSpherePoints policy/i,
  );
  const incomplete = pose("incomplete", [[1, 1]]);
  delete incomplete.audit.methods.sasaMaximumOcclusionChecks;
  assert.throws(
    () => summarizePoseEnsemble([pose("reference-complete", [[1, 1]]), incomplete]),
    /complete positive finite methods\.sasaMaximumOcclusionChecks/i,
  );
  const pae = pose("pae", [[1, 1]]);
  pae.audit.paeFilename = "scores.json";
  assert.throws(
    () => summarizePoseEnsemble([pose("reference-no-pae", [[1, 1]]), pae]),
    /coordinate-only audits/i,
  );
  const inventedAlgorithmA = pose("invented-a", [[1, 1]]);
  const inventedAlgorithmB = pose("invented-b", [[2, 2]]);
  inventedAlgorithmA.audit.methods.sasaFrameAlgorithm = "fake-canonical-v99";
  inventedAlgorithmB.audit.methods.sasaFrameAlgorithm = "fake-canonical-v99";
  assert.throws(
    () => summarizePoseEnsemble([inventedAlgorithmA, inventedAlgorithmB]),
    /current verified canonical SASA frame algorithm/i,
  );
  const staleA = pose("stale-a", [[1, 1]]);
  const staleB = pose("stale-b", [[2, 2]]);
  staleA.audit.version = "0.4.9";
  staleB.audit.version = "0.4.9";
  assert.throws(
    () => summarizePoseEnsemble([staleA, staleB]),
    /current ConfoVHH software version/i,
  );
  const contactConfidence = pose("contact-confidence", [[1, 1]]);
  contactConfidence.audit.contacts[0].receptorConfidence = 91;
  assert.throws(
    () => summarizePoseEnsemble([pose("reference-no-confidence", [[1, 1]]), contactConfidence]),
    /per-contact confidence must be omitted/i,
  );
});

test("ensemble summary requires exact current method descriptions even when every pose drifts together", () => {
  for (const [field, value] of [
    ["sasaRadii", "Invented radii table."],
    ["cdrAnnotation", "Invented loop annotation."],
    ["paeSummary", "Invented PAE omission policy."],
  ]) {
    const first = pose(`method-${field}-a`, [[1, 1]]);
    const second = pose(`method-${field}-b`, [[2, 2]]);
    first.audit.methods[field] = value;
    second.audit.methods[field] = value;
    assert.throws(
      () => summarizePoseEnsemble([first, second]),
      new RegExp(`current fixed ConfoVHH methods\\.${field} policy`, "i"),
    );
  }
});

test("ensemble summary rejects an audit after a selected coordinate mutates", () => {
  const reference = pose("attested-reference", [[1, 1], [2, 2]]);
  const changed = pose("attested-changed", [[1, 1], [2, 2]]);
  changed.structure.chains[1].residues[0].atoms[0].y += 100;
  assert.throws(
    () => summarizePoseEnsemble([reference, changed]),
    /audit input attestation does not match/i,
  );
});

test("ensemble summary rejects nonfinite metrics and inconsistent contact records", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const invalid = pose(`nonfinite-${String(value)}`, [[1, 1]], { deltaSasaAngstrom2: value });
    assert.throws(
      () => summarizePoseEnsemble([pose("finite-reference", [[1, 1]]), invalid]),
      /ΔSASA must be finite and non-negative/i,
    );
  }
  const inconsistent = pose("inconsistent", [[1, 1]]);
  inconsistent.audit.contactPairCount = 2;
  assert.throws(
    () => summarizePoseEnsemble([pose("consistent", [[1, 1]]), inconsistent]),
    /atomContactCount cannot be smaller than contactPairCount|reconcile with contactPairCount/i,
  );
  const duplicate = pose("duplicate-contact", [[1, 1]]);
  duplicate.audit.contacts.push(structuredClone(duplicate.audit.contacts[0]));
  duplicate.audit.contactPairCount += 1;
  duplicate.audit.atomContactCount += 1;
  assert.throws(
    () => summarizePoseEnsemble([pose("unique-contact", [[1, 1]]), duplicate]),
    /duplicate receptor–VHH contact records/i,
  );
});

test("ensemble summary rejects invalid input provenance and contact domains", () => {
  for (const mutate of [
    (entry) => { entry.id = ""; },
    (entry) => { entry.filename = ""; },
    (entry) => { entry.bytes = -1; },
    (entry) => { entry.bytes = Number.MAX_SAFE_INTEGER + 1; },
    (entry) => { entry.audit.contacts[0].receptorResidueOrder = 999; },
    (entry) => { entry.audit.contacts[0].minimumDistance = Number.POSITIVE_INFINITY; },
  ]) {
    const invalid = pose("invalid-domain", [[1, 1]]);
    mutate(invalid);
    assert.throws(
      () => summarizePoseEnsemble([pose("valid-domain", [[1, 1]]), invalid]),
      /identifier|filename|byte count|residue orders|minimum distances/i,
    );
  }
  const invalidSha = pose("invalid-sha", [[1, 1]], { sha256: "not-a-digest" });
  assert.throws(
    () => summarizePoseEnsemble([pose("sha-reference", [[1, 1]]), invalidSha]),
    /64-character hexadecimal SHA-256/i,
  );

  const uppercase = summarizePoseEnsemble([
    pose("upper-a", [[1, 1]], { sha256: "A".repeat(64) }),
    pose("upper-b", [[2, 2]], { sha256: "B".repeat(64) }),
  ]);
  assert.deepEqual(
    uppercase.poses.map((entry) => entry.sha256).sort(),
    ["a".repeat(64), "b".repeat(64)],
  );
});
