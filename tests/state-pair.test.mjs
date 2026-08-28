import assert from "node:assert/strict";
import test from "node:test";

import {
  STATE_PAIR_CLAIM_BOUNDARY,
  STATE_PAIR_SCHEMA_VERSION,
  createStatePairExportReport,
  matchStatePairChains,
  statePairToCsv,
  summarizeStatePair,
  validateStatePairExportSummary,
} from "../lib/state-pair.ts";
import { analyzeInterface, CONFOVHH_VERSION } from "../lib/confovhh.ts";
import { canonicalizeSelectedGeometry } from "../lib/geometry-fit.ts";

const RECEPTOR_SEQUENCE = "AAAA";
const VHH_SEQUENCE = "CCCC";
const DEFAULT_REFERENCE_PAIRS = [[1, 1], [2, 2], [3, 3]];
const DEFAULT_COMPARISON_PAIRS = [[2, 2], [3, 4], [4, 3]];

const RECEPTOR_POINTS = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 3, 0],
  [0, 0, 4],
];
const VHH_POINTS = [
  [8, 1, 1],
  [10, 2, 1],
  [9, 1, 4],
  [8, 5, 2],
];

function identity(point) {
  return [...point];
}

function rigidTransform([x, y, z]) {
  return [-y + 101.25, x - 48.5, z + 7.75];
}

function reflectTransform([x, y, z]) {
  return [-x + 20, y - 3, z + 9];
}

function makeChain(id, sequence, points, serialOffset, transform, yShift = 0) {
  const residueName = sequence[0] === "C" ? "CYS" : "ALA";
  const residues = [...sequence].map((oneLetter, index) => {
    const base = points[index] ?? [index * 1.5, 0, 0];
    const [x, y, z] = transform([base[0], base[1] + yShift, base[2]]);
    const residueKey = `${id}:${index + 1}`;
    return {
      key: residueKey,
      chainId: id,
      name: residueName,
      number: index + 1,
      insertionCode: "",
      order: index + 1,
      oneLetter,
      labelSequenceId: index + 1,
      authSequenceId: index + 1,
      atoms: [{
        serial: serialOffset + index + 1,
        name: "CA",
        residueName,
        chainId: id,
        residueNumber: index + 1,
        insertionCode: "",
        residueKey,
        residueOrder: index + 1,
        x,
        y,
        z,
        element: "C",
        bFactor: null,
      }],
    };
  });
  return {
    id,
    atomCount: residues.length,
    residueCount: residues.length,
    sequence,
    backboneCompleteness: 1,
    roleHint: sequence[0] === "C" ? "VHH-like" : "receptor-like",
    residues,
  };
}

function makeStructure({
  receptorSequence = RECEPTOR_SEQUENCE,
  vhhSequence = VHH_SEQUENCE,
  receptorId = "A",
  vhhId = "B",
  contactPairs = DEFAULT_REFERENCE_PAIRS,
  vhhShift = 0,
  transform = identity,
  title = "Synthetic paired-coordinate fixture",
  method = "THEORETICAL MODEL",
} = {}) {
  const distances = new Map(contactPairs.map((pair, index) => [
    `${pair[0]}:${pair[1]}`,
    pair[2] ?? 3 + index / 10,
  ]));
  let serial = 1;
  const edgePoint = (receptorOrder, vhhOrder) => {
    const edgeIndex = (receptorOrder - 1) * vhhSequence.length + vhhOrder - 1;
    return [edgeIndex * 30, (edgeIndex % 3) * 7, (edgeIndex % 5) * 11];
  };
  const makeEdgeAtom = ({ chainId, residueName, residueOrder, atomName, point }) => {
    const [x, y, z] = transform(point);
    return {
      serial: serial++,
      name: atomName,
      residueName,
      chainId,
      residueNumber: residueOrder,
      insertionCode: "",
      residueKey: `${chainId}:${residueOrder}`,
      residueOrder,
      x,
      y,
      z,
      element: "C",
      bFactor: null,
    };
  };
  const receptorResidues = [...receptorSequence].map((oneLetter, index) => {
    const order = index + 1;
    const atoms = [...vhhSequence].map((__, vhhIndex) => makeEdgeAtom({
      chainId: receptorId,
      residueName: "ALA",
      residueOrder: order,
      atomName: `E${vhhIndex + 1}`,
      point: edgePoint(order, vhhIndex + 1),
    }));
    if (order === receptorSequence.length) atoms.push(makeEdgeAtom({
      chainId: receptorId,
      residueName: "ALA",
      residueOrder: order,
      atomName: "MK",
      point: [-2_000, 0, 0],
    }));
    return {
      key: `${receptorId}:${order}`,
      chainId: receptorId,
      name: "ALA",
      number: order,
      insertionCode: "",
      order,
      oneLetter,
      labelSequenceId: order,
      authSequenceId: order,
      atoms,
    };
  });
  const vhhResidues = [...vhhSequence].map((oneLetter, index) => {
    const order = index + 1;
    const atoms = [...receptorSequence].map((__, receptorIndex) => {
      const receptorOrder = receptorIndex + 1;
      const origin = edgePoint(receptorOrder, order);
      const distance = distances.get(`${receptorOrder}:${order}`);
      return makeEdgeAtom({
        chainId: vhhId,
        residueName: "CYS",
        residueOrder: order,
        atomName: `E${receptorOrder}`,
        point: [origin[0], origin[1] + (distance ?? 10), origin[2]],
      });
    });
    if (order === vhhSequence.length) atoms.push(makeEdgeAtom({
      chainId: vhhId,
      residueName: "CYS",
      residueOrder: order,
      atomName: "MK",
      point: [2_000, 0, vhhShift],
    }));
    return {
      key: `${vhhId}:${order}`,
      chainId: vhhId,
      name: "CYS",
      number: order,
      insertionCode: "",
      order,
      oneLetter,
      labelSequenceId: order,
      authSequenceId: order,
      atoms,
    };
  });
  const makeEdgeChain = (id, sequence, residues, roleHint) => ({
    id,
    atomCount: residues.reduce((total, residue) => total + residue.atoms.length, 0),
    residueCount: residues.length,
    sequence,
    backboneCompleteness: 1,
    roleHint,
    residues,
  });
  const receptor = makeEdgeChain(receptorId, receptorSequence, receptorResidues, "receptor-like");
  const vhh = makeEdgeChain(vhhId, vhhSequence, vhhResidues, "VHH-like");
  return {
    atoms: [...receptor.residues, ...vhh.residues].flatMap((residue) => residue.atoms),
    chains: [receptor, vhh],
    title,
    experimentalMethod: method,
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

function makeAudit(structure, options = {}) {
  const receptorChain = structure.chains[0].id;
  const vhhChain = structure.chains[1].id;
  const audit = analyzeInterface(
    structure,
    receptorChain,
    vhhChain,
    "none",
    null,
    false,
    canonicalizeSelectedGeometry(structure, receptorChain, vhhChain),
  );
  const { methodOverrides = {}, ...auditOverrides } = options;
  Object.assign(audit, auditOverrides);
  Object.assign(audit.methods, methodOverrides);
  return audit;
}

function makeInput(id, structure, audit, options = {}) {
  const defaultSha256 = id === "reference" ? "a".repeat(64) : "b".repeat(64);
  return {
    id,
    filename: options.filename ?? `${id}.pdb`,
    sha256: options.sha256 === undefined ? defaultSha256 : options.sha256,
    bytes: options.bytes === undefined ? 1234 : options.bytes,
    label: options.label ?? null,
    structure,
    audit,
  };
}

function makePair({
  referencePairs = DEFAULT_REFERENCE_PAIRS,
  comparisonPairs = DEFAULT_COMPARISON_PAIRS,
  referenceStructure = null,
  comparisonStructure = null,
  referenceAuditOptions = {},
  comparisonAuditOptions = {},
  referenceOptions = {},
  comparisonOptions = {},
} = {}) {
  const resolvedReference = referenceStructure ?? makeStructure({ contactPairs: referencePairs });
  const resolvedComparison = comparisonStructure ?? makeStructure({
    receptorId: "R",
    vhhId: "V",
    contactPairs: comparisonPairs,
    vhhShift: 2,
  });
  const referenceAudit = makeAudit(resolvedReference, referenceAuditOptions);
  const comparisonAudit = makeAudit(resolvedComparison, comparisonAuditOptions);
  return [
    makeInput("reference", resolvedReference, referenceAudit, referenceOptions),
    makeInput("comparison", resolvedComparison, comparisonAudit, comparisonOptions),
  ];
}

function clone(value) {
  return structuredClone(value);
}

function expectedJaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return null;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function numericLeafPaths(value, path = [], result = [], active = new WeakSet()) {
  if (typeof value === "number") {
    result.push(path);
    return result;
  }
  if (value == null || typeof value !== "object" || active.has(value)) return result;
  active.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => numericLeafPaths(entry, [...path, index], result, active));
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      numericLeafPaths(entry, [...path, key], result, active);
    });
  }
  active.delete(value);
  return result;
}

function setPath(root, path, value) {
  let target = root;
  for (const segment of path.slice(0, -1)) target = target[segment];
  target[path.at(-1)] = value;
}

function assertBothStateExportsReject(summary, matcher = /./) {
  assert.throws(() => statePairToCsv(summary), matcher);
  assert.throws(() => createStatePairExportReport(summary), matcher);
}

test("exact observed sequences match across changed chain IDs", () => {
  const structure = makeStructure({ receptorId: "receptor-copy", vhhId: "vhh-copy" });
  assert.deepEqual(matchStatePairChains(structure, RECEPTOR_SEQUENCE, VHH_SEQUENCE), {
    receptorChain: "receptor-copy",
    vhhChain: "vhh-copy",
  });
});

test("exact sequence matching fails closed on mismatch and ambiguity", () => {
  assert.throws(
    () => matchStatePairChains(makeStructure({ receptorSequence: "AAAT" }), RECEPTOR_SEQUENCE, VHH_SEQUENCE),
    /does not contain exact observed/i,
  );
  const ambiguous = makeStructure({ receptorId: "R1", vhhId: "V1" });
  const secondReceptor = makeChain("R2", RECEPTOR_SEQUENCE, RECEPTOR_POINTS, 200, identity);
  const secondVhh = makeChain("V2", VHH_SEQUENCE, VHH_POINTS, 300, identity, 3);
  ambiguous.chains.push(secondReceptor, secondVhh);
  ambiguous.atoms.push(
    ...secondReceptor.residues.flatMap((residue) => residue.atoms),
    ...secondVhh.residues.flatMap((residue) => residue.atoms),
  );
  assert.throws(
    () => matchStatePairChains(ambiguous, RECEPTOR_SEQUENCE, VHH_SEQUENCE),
    /multiple indistinguishable/i,
  );
});

test("ambiguous matching exits without materializing a million-pair Cartesian product", () => {
  const structure = makeStructure({ receptorId: "R0", vhhId: "V0" });
  structure.chains = [
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `R${index}`, sequence: RECEPTOR_SEQUENCE })),
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `V${index}`, sequence: VHH_SEQUENCE })),
  ];
  assert.throws(
    () => matchStatePairChains(structure, RECEPTOR_SEQUENCE, VHH_SEQUENCE),
    /multiple indistinguishable/i,
  );
});

test("paired summary reports signed comparison-minus-reference deltas and three Jaccards", () => {
  const [reference, comparison] = makePair({
    referencePairs: [[1, 1, 3.2], [2, 2, 3.5], [3, 3, 4.2]],
    comparisonPairs: [[2, 2, 1.0], [3, 4, 3.0], [4, 3, 3.4]],
  });
  const summary = summarizeStatePair(reference, comparison);
  for (const field of [
    "contactPairCount", "atomContactCount", "severeClashCount", "maximumOverlapAngstrom",
    "deltaSasaAngstrom2", "halfDeltaSasaInterfaceAreaAngstrom2",
  ]) {
    assert.equal(summary.deltas[field], comparison.audit[field] - reference.audit[field]);
  }
  assert.notEqual(summary.deltas.severeClashCount, 0);
  assert.notEqual(summary.deltas.deltaSasaAngstrom2, 0);
  assert.equal(summary.deltas.paratopeProxyShare, null);
  assert.equal(summary.deltas.cdr3ProxyShare, null);
  assert.equal(summary.similarity.contactPairs, 1 / 5);
  assert.equal(summary.similarity.receptorEpitope, 1 / 2);
  assert.equal(summary.similarity.vhhParatope, 1 / 2);
  assert.match(summary.methods.comparisonDirection, /comparison minus reference/i);
});

test("contact partitions retain shared and condition-only residue records", () => {
  const [reference, comparison] = makePair();
  const summary = summarizeStatePair(reference, comparison);
  assert.deepEqual(summary.contacts.shared.map((entry) => entry.key), ["2:2"]);
  assert.deepEqual(summary.contacts.referenceOnly.map((entry) => entry.key), ["1:1", "3:3"]);
  assert.deepEqual(summary.contacts.comparisonOnly.map((entry) => entry.key), ["3:4", "4:3"]);
  const shared = summary.contacts.shared[0];
  assert.equal(shared.receptorResidueOrder, 2);
  assert.equal(shared.vhhResidueOrder, 2);
  assert.ok(Math.abs(shared.referenceMinimumDistanceAngstrom - 3.1) < 1e-12);
  assert.ok(Math.abs(shared.comparisonMinimumDistanceAngstrom - 3) < 1e-12);
  assert.ok(Math.abs(shared.minimumDistanceDeltaAngstrom + 0.1) < 1e-12);
  assert.equal(summary.contacts.referenceOnly[0].comparison, null);
  assert.equal(summary.contacts.comparisonOnly[0].reference, null);
});

test("reversing the pair negates signed deltas, preserves similarity, and swaps exclusive contacts", () => {
  const [reference, comparison] = makePair();
  const forward = summarizeStatePair(reference, comparison);
  const reverse = summarizeStatePair(comparison, reference);
  assert.ok(Math.abs(reverse.deltas.deltaSasaAngstrom2 + forward.deltas.deltaSasaAngstrom2) < 1e-12);
  assert.equal(reverse.deltas.severeClashCount + forward.deltas.severeClashCount, 0);
  assert.deepEqual(reverse.similarity, forward.similarity);
  assert.deepEqual(
    reverse.contacts.referenceOnly.map((entry) => entry.key),
    forward.contacts.comparisonOnly.map((entry) => entry.key),
  );
  assert.deepEqual(
    reverse.contacts.comparisonOnly.map((entry) => entry.key),
    forward.contacts.referenceOnly.map((entry) => entry.key),
  );
});

test("two empty contact footprints report null overlap rather than artificial agreement", () => {
  const [reference, comparison] = makePair({ referencePairs: [], comparisonPairs: [] });
  const summary = summarizeStatePair(reference, comparison);
  assert.deepEqual(summary.similarity, {
    contactPairs: null,
    receptorEpitope: null,
    vhhParatope: null,
  });
  assert.deepEqual(summary.contacts, { shared: [], referenceOnly: [], comparisonOnly: [] });
});

test("one empty footprint and one nonempty footprint report zero overlap", () => {
  const [reference, comparison] = makePair({ referencePairs: [], comparisonPairs: [[1, 1]] });
  const summary = summarizeStatePair(reference, comparison);
  assert.deepEqual(summary.similarity, {
    contactPairs: 0,
    receptorEpitope: 0,
    vhhParatope: 0,
  });
});

test("Jaccard and contact partitions satisfy seeded set properties", () => {
  let state = 0x51a7e;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const universe = [
    [1, 1], [1, 2], [1, 3], [1, 4],
    [2, 1], [2, 2], [2, 3], [2, 4],
    [3, 1], [3, 2], [3, 3], [3, 4],
    [4, 1], [4, 2], [4, 3], [4, 4],
  ];
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const referencePairs = universe.filter(() => random() < 0.35);
    const comparisonPairs = universe.filter(() => random() < 0.35);
    const [reference, comparison] = makePair({ referencePairs, comparisonPairs });
    const summary = summarizeStatePair(reference, comparison);
    const referenceKeys = referencePairs.map(([r, v]) => `${r}:${v}`);
    const comparisonKeys = comparisonPairs.map(([r, v]) => `${r}:${v}`);
    assert.equal(summary.similarity.contactPairs, expectedJaccard(referenceKeys, comparisonKeys));
    assert.equal(
      summary.contacts.shared.length + summary.contacts.referenceOnly.length,
      referencePairs.length,
    );
    assert.equal(
      summary.contacts.shared.length + summary.contacts.comparisonOnly.length,
      comparisonPairs.length,
    );
    assert.equal(
      summary.contacts.shared.length + summary.contacts.referenceOnly.length +
        summary.contacts.comparisonOnly.length,
      new Set([...referenceKeys, ...comparisonKeys]).size,
    );
  }
});

test("exact observed receptor and VHH sequence mismatches fail closed", () => {
  const [reference, comparison] = makePair({
    comparisonStructure: makeStructure({
      receptorSequence: "AAAT",
      receptorId: "R",
      vhhId: "V",
      vhhShift: 2,
    }),
  });
  assert.throws(() => summarizeStatePair(reference, comparison), /does not contain exact observed/i);
});

test("the comparison audit must use the unique exact-sequence chain assignment", () => {
  const comparisonStructure = makeStructure({ receptorId: "R-good", vhhId: "V", vhhShift: 2 });
  const wrong = makeChain("R-wrong", "AAAT", RECEPTOR_POINTS, 300, identity);
  comparisonStructure.chains.push(wrong);
  comparisonStructure.atoms.push(...wrong.residues.flatMap((residue) => residue.atoms));
  const [reference, comparison] = makePair({ comparisonStructure });
  comparison.audit.receptorChain = "R-wrong";
  assert.throws(() => summarizeStatePair(reference, comparison), /audited chain assignment/i);
});

test("global proper rotation and translation duplicates are rejected", () => {
  const [reference, comparison] = makePair({
    comparisonStructure: makeStructure({ receptorId: "R", vhhId: "V", transform: rigidTransform }),
  });
  assert.throws(() => summarizeStatePair(reference, comparison), /duplicate selected receptor–VHH geometries/i);
});

test("sub-threshold coordinate noise remains a rejected duplicate", () => {
  const comparisonStructure = makeStructure({ receptorId: "R", vhhId: "V" });
  comparisonStructure.chains[1].residues[3].atoms[0].x += 0.001;
  comparisonStructure.atoms = comparisonStructure.chains.flatMap((chain) =>
    chain.residues.flatMap((residue) => residue.atoms));
  const [reference, comparison] = makePair({ comparisonStructure });
  assert.throws(() => summarizeStatePair(reference, comparison), /duplicate selected receptor–VHH geometries/i);
});

test("a reflected chiral coordinate set is not collapsed by the proper-rotation fit", () => {
  const [reference, comparison] = makePair({
    comparisonStructure: makeStructure({ receptorId: "R", vhhId: "V", transform: reflectTransform }),
  });
  const summary = summarizeStatePair(reference, comparison);
  assert.ok(summary.selectedGeometryFit.rmsdAngstrom > 0.02);
  assert.ok(summary.selectedGeometryFit.maximumDeviationAngstrom > 0.05);
  assert.match(summary.methods.duplicateDetection, /reflections are not treated as duplicates/i);
});

test("incompatible selected atom identities fail before comparison", () => {
  const comparisonStructure = makeStructure({ receptorId: "R", vhhId: "V", vhhShift: 2 });
  comparisonStructure.chains[0].residues[0].atoms[0].name = "CB";
  const [reference, comparison] = makePair({ comparisonStructure });
  assert.throws(() => summarizeStatePair(reference, comparison), /cannot be paired exactly/i);
});

test("labels are optional user context and do not alter any calculation", () => {
  const [unlabeledReference, unlabeledComparison] = makePair();
  const unlabeled = summarizeStatePair(unlabeledReference, unlabeledComparison);
  const [labeledReference, labeledComparison] = makePair({
    referenceOptions: { label: "inactive" },
    comparisonOptions: { label: "active" },
  });
  const labeled = summarizeStatePair(labeledReference, labeledComparison);
  assert.equal(unlabeled.reference.label, null);
  assert.equal(unlabeled.reference.labelSource, null);
  assert.equal(labeled.reference.label, "inactive");
  assert.equal(labeled.reference.labelSource, "user");
  assert.equal(labeled.comparison.label, "active");
  assert.deepEqual(labeled.deltas, unlabeled.deltas);
  assert.deepEqual(labeled.similarity, unlabeled.similarity);
  assert.match(labeled.methods.labels, /do not establish/i);
  assert.match(labeled.warnings.join(" "), /never inferred/i);
  assert.match(labeled.warnings.join(" "), /canonical-anchor switch/i);
});

test("unsupported runtime labels fail closed", () => {
  const [reference, comparison] = makePair();
  comparison.label = "agonist-bound";
  assert.throws(() => summarizeStatePair(reference, comparison), /label must be neutral, active, inactive/i);
});

test("pLDDT and every PAE path are excluded from coordinate-only paired audits", () => {
  const variants = [
    (audit) => { audit.confidenceMode = "plddt"; audit.interfaceConfidence = 88; audit.interfaceConfidenceCoverage = 1; },
    (audit) => { audit.paeFilename = "pae.json"; audit.paeOrderConfirmed = true; },
    (audit) => { audit.interfacePaeMedianAngstrom = 4.5; },
    (audit) => { audit.receptorFrameToVhhPaeP90Angstrom = 8; },
    (audit) => { audit.lowPaeContactShare = 0.9; },
    (audit) => { audit.contacts[0].vhhConfidence = 92; },
  ];
  for (const mutate of variants) {
    const [reference, comparison] = makePair();
    mutate(comparison.audit);
    assert.throws(() => summarizeStatePair(reference, comparison), /coordinate-only|PAE|confidence/i);
  }
});

test("fixed contact, clash, SASA, and budget policies fail closed on drift", () => {
  const variants = [
    ["residueContactCutoffAngstrom", 5],
    ["polarProxyCutoffAngstrom", 3.6],
    ["saltBridgeProxyCutoffAngstrom", 4.1],
    ["severeClashOverlapAngstrom", 0.7],
    ["sasaProbeRadiusAngstrom", 1.5],
    ["sasaSpherePoints", 480],
    ["sasaMaximumCandidateDistanceChecks", 24_999_999],
    ["sasaMaximumOcclusionChecks", 249_999_999],
  ];
  for (const [field, value] of variants) {
    const [reference, comparison] = makePair();
    comparison.audit.methods[field] = value;
    assert.throws(() => summarizeStatePair(reference, comparison), /fixed coordinate-only re-audit policy/i);
  }
});

test("exact method descriptions fail closed even when both audits drift together", () => {
  for (const [field, value] of [
    ["sasaRadii", "Different radii table."],
    ["cdrAnnotation", "Different CDR annotation policy."],
    ["paeSummary", "Different PAE omission provenance."],
  ]) {
    const [reference, comparison] = makePair();
    reference.audit.methods[field] = value;
    comparison.audit.methods[field] = value;
    assert.throws(
      () => summarizeStatePair(reference, comparison),
      /current fixed coordinate-only re-audit policy/i,
    );
  }
});

test("contact records are range-checked, unique, and reconciled with summary counts", () => {
  {
    const [reference, comparison] = makePair();
    comparison.audit.contacts.push(clone(comparison.audit.contacts[0]));
    comparison.audit.contactPairCount += 1;
    assert.throws(() => summarizeStatePair(reference, comparison), /duplicate residue-contact pair/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.audit.contacts[0].vhhResidueOrder = 999;
    assert.throws(() => summarizeStatePair(reference, comparison), /invalid observed-sequence order/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.audit.contactPairCount += 1;
    assert.throws(() => summarizeStatePair(reference, comparison), /contactPairCount does not match/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.audit.receptorInterfaceResidues += 1;
    assert.throws(() => summarizeStatePair(reference, comparison), /receptorInterfaceResidues does not match/i);
  }
});

test("nonfinite, inconsistent, and out-of-domain audit metrics are rejected", () => {
  const variants = [
    (audit) => { audit.deltaSasaAngstrom2 = Number.NaN; },
    (audit) => { audit.severeClashCount = 1.5; },
    (audit) => { audit.paratopeProxyShare = 1.01; },
    (audit) => { audit.halfDeltaSasaInterfaceAreaAngstrom2 += 1; },
    (audit) => { audit.receptorBuriedSurfaceAreaAngstrom2 += 1; },
    (audit) => { audit.contacts[0].minimumDistance = Number.POSITIVE_INFINITY; },
    (audit) => { audit.contacts[0].minimumDistance = 4.500_001; },
  ];
  for (const mutate of variants) {
    const [reference, comparison] = makePair();
    mutate(comparison.audit);
    assert.throws(() => summarizeStatePair(reference, comparison), /finite|integer|0–1|inconsistent|do not sum|at or below/i);
  }
});

test("audit software versions, input identifiers, byte counts, and filenames are validated", () => {
  {
    const [reference, comparison] = makePair({ comparisonAuditOptions: { version: "0.5.1" } });
    assert.throws(() => summarizeStatePair(reference, comparison), /same ConfoVHH software version/i);
  }
  {
    const [reference, comparison] = makePair({
      referenceAuditOptions: { version: "0.4.9" },
      comparisonAuditOptions: { version: "0.4.9" },
    });
    assert.throws(() => summarizeStatePair(reference, comparison), /current ConfoVHH software version/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.id = reference.id;
    assert.throws(() => summarizeStatePair(reference, comparison), /distinct, non-empty identifiers/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.bytes = -1;
    assert.throws(() => summarizeStatePair(reference, comparison), /byte count/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.filename = "";
    assert.throws(() => summarizeStatePair(reference, comparison), /non-empty filename/i);
  }
  {
    const [reference, comparison] = makePair();
    comparison.sha256 = "not-a-digest";
    assert.throws(() => summarizeStatePair(reference, comparison), /64-character hexadecimal SHA-256/i);
  }
});

test("full coordinate, parser, assembly, and chain-instance provenance is retained", () => {
  const comparisonStructure = makeStructure({
    receptorId: "R[assembly-1]",
    vhhId: "V[assembly-1]",
    vhhShift: 2,
    method: "ELECTRON MICROSCOPY",
  });
  comparisonStructure.coordinateScope = "deposited-assembly";
  comparisonStructure.ignoredAlternateLocations = 7;
  comparisonStructure.duplicateAtomRecords = 3;
  comparisonStructure.availableAssemblies = [{
    id: "1",
    details: "test assembly",
    methodDetails: null,
    oligomericDetails: "dimeric",
    oligomericCount: 2,
    generatorCount: 1,
    generators: [{ sourceRowIndex: 1, operationExpression: "1", labelAsymIds: ["R", "V"] }],
  }];
  comparisonStructure.selectedAssembly = {
    id: "1",
    details: "test assembly",
    generatorCount: 1,
    generatedChainCount: 2,
    generatedProteinHeavyAtomCount: 8,
    generatedOperationCount: 1,
    skippedNonProteinLabelAsymIds: [],
    materializationPolicy: "test",
    generators: [{
      sourceRowIndex: 1,
      operationExpression: "1",
      labelAsymIds: ["R", "V"],
      expandedOperationTuples: [["1"]],
    }],
  };
  comparisonStructure.chains[0].labelAsymId = "R";
  comparisonStructure.chains[0].authAsymId = "A";
  comparisonStructure.chains[0].assemblyCopyIndex = 1;
  comparisonStructure.chains[0].assemblyGeneratorRowIndex = 1;
  comparisonStructure.chains[0].assemblyOperationIds = ["1"];
  comparisonStructure.chains[0].assemblyTransform = [
    [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0],
  ];
  const [reference, comparison] = makePair({ comparisonStructure });
  const summary = summarizeStatePair(reference, comparison);
  assert.equal(summary.comparison.coordinateProvenance, "experimental");
  assert.equal(summary.comparison.coordinateScope, "deposited-assembly");
  assert.equal(summary.comparison.selectedAssemblyId, "1");
  assert.equal(summary.comparison.selectedAssembly.generatedChainCount, 2);
  assert.equal(summary.comparison.availableAssemblies[0].oligomericCount, 2);
  assert.equal(summary.comparison.parserAccounting.ignoredAlternateLocations, 7);
  assert.equal(summary.comparison.parserAccounting.duplicateAtomRecords, 3);
  assert.equal(summary.comparison.receptorChain.labelAsymId, "R");
  assert.equal(summary.comparison.receptorChain.authAsymId, "A");
  assert.deepEqual(summary.comparison.receptorChain.assemblyOperationIds, ["1"]);
  assert.equal(summary.comparison.receptorChain.observedSequence, RECEPTOR_SEQUENCE);
  assert.equal(summary.comparison.receptorChain.observedSequenceLength, 4);
  assert.match(summary.comparison.coordinateFingerprint, /^fnv1a64-/i);
  assert.ok(summary.comparison.geometryFingerprint.length > 8);
});

test("JSON export uses schema 1.2 and preserves policy, fit, labels, provenance, and claim boundary", () => {
  const [reference, comparison] = makePair({
    referenceOptions: { label: "inactive" },
    comparisonOptions: { label: "active" },
  });
  const summary = summarizeStatePair(reference, comparison);
  const report = createStatePairExportReport(
    summary,
    "Paired source-frame contacts with canonical-clone-only SASA; PAE and pLDDT omitted.",
    "2026-08-27T12:34:56.000Z",
  );
  assert.equal(report.schemaVersion, "1.2.0");
  assert.equal(report.summary.schemaVersion, STATE_PAIR_SCHEMA_VERSION);
  assert.equal(report.softwareVersion, CONFOVHH_VERSION);
  assert.equal(report.generatedAt, "2026-08-27T12:34:56.000Z");
  assert.equal(report.summary.reference.label, "inactive");
  assert.equal(report.summary.comparison.label, "active");
  assert.equal(report.auditPolicy.sasaMaximumCandidateDistanceChecks, 25_000_000);
  assert.equal(report.auditPolicy.sasaMaximumOcclusionChecks, 250_000_000);
  assert.equal(report.auditPolicy.sasaOrientation, "deterministic-proper-signed-frame");
  assert.match(report.auditPolicy.sasaFrameAlgorithm, /farthest-signed-frame-v1/);
  assert.ok(Number.isFinite(report.summary.selectedGeometryFit.rmsdAngstrom));
  assert.match(report.comparisonMode, /PAE and pLDDT omitted/i);
  assert.match(report.claimBoundary, /no claim of binding/i);
  assert.throws(
    () => createStatePairExportReport(summary, "", "2026-08-27T00:00:00.000Z"),
    /comparisonMode/i,
  );
  assert.throws(() => createStatePairExportReport(summary, "mode", "not-a-date"), /valid UTC ISO 8601 timestamp/i);
  assert.throws(
    () => createStatePairExportReport(summary, "mode", "2026-02-30T00:00:00.000Z"),
    /valid UTC ISO 8601 timestamp/i,
  );
});

test("long-form CSV has fixed-width rows, metric/contact records, policy budgets, and safe text", () => {
  const [reference, comparison] = makePair({
    referenceOptions: {
      filename: " =HYPERLINK(\"https://invalid\"),reference\n\u0001\u202e.pdb",
      label: "inactive",
    },
    comparisonOptions: {
      filename: "\u200b\u2060\u0085+SUM(1,1)\u2028@comparison\tfile.pdb",
      label: "active",
    },
  });
  const summary = summarizeStatePair(reference, comparison);
  const csv = statePairToCsv(summary);
  const rows = parseCsv(csv);
  assert.ok(rows.length > 20);
  assert.equal(rows[0].length, 66);
  rows.forEach((row) => assert.equal(row.length, rows[0].length));
  assert.ok(csv.includes("\n"), "LF remains the deliberate CSV record separator");
  for (const cell of rows.flat()) {
    assert.doesNotMatch(cell, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  }
  assert.match(csv, /' =HYPERLINK/);
  assert.match(csv, /'\\u200b\\u2060\\u0085\+SUM\(1,1\)\\u2028@comparison\\tfile\.pdb/);
  assert.match(csv, /\\n\\u0001\\u202e\.pdb/);
  assert.match(csv, /sasa_maximum_candidate_distance_checks/);
  assert.match(csv, /sasa_maximum_occlusion_checks/);
  assert.match(csv, /cdr_annotation/);
  assert.match(csv, /pae_summary/);
  assert.match(csv, /sasa_frame_algorithm/);
  assert.match(csv, /condition_label_source/);
  assert.match(csv, /coordinate_provenance/);
  assert.match(csv, /coordinate_fingerprint/);
  assert.match(csv, /geometry_fingerprint/);
  assert.match(csv, /claim_boundary/);
  assert.match(csv, /residue_contact_cutoff_angstrom/);
  assert.match(csv, /polar_proxy_cutoff_angstrom/);
  assert.match(csv, /salt_bridge_proxy_cutoff_angstrom/);
  assert.match(csv, /severe_clash_overlap_angstrom/);
  assert.match(csv, /sasa_probe_radius_angstrom/);
  assert.match(csv, /contact_definition_method/);
  assert.match(csv, /residue_mapping_method/);
  assert.match(csv, /jaccard_method/);
  assert.match(csv, /duplicate_detection_method/);
  assert.match(csv, /25000000/);
  assert.match(csv, /250000000/);
  const header = rows[0];
  const recordTypeIndex = header.indexOf("record_type");
  const metricIndex = header.indexOf("metric");
  const membershipIndex = header.indexOf("contact_membership");
  const labelSourceIndex = header.indexOf("condition_label_source");
  const claimBoundaryIndex = header.indexOf("claim_boundary");
  const coordinateFingerprintIndex = header.indexOf("coordinate_fingerprint");
  const geometryFingerprintIndex = header.indexOf("geometry_fingerprint");
  const conditionRows = rows.filter((row) => row[recordTypeIndex] === "condition_provenance");
  assert.equal(conditionRows.length, 2);
  assert.deepEqual(conditionRows.map((row) => row[labelSourceIndex]), ["user", "user"]);
  conditionRows.forEach((row) => {
    assert.match(row[coordinateFingerprintIndex], /^fnv1a64-3dp:/);
    assert.match(row[geometryFingerprintIndex], /^fnv1a64-se3-2dp:/);
  });
  rows.slice(1).forEach((row) => assert.equal(row[claimBoundaryIndex], STATE_PAIR_CLAIM_BOUNDARY));
  assert.equal(rows.filter((row) => row[recordTypeIndex] === "metric").length, 15);
  assert.equal(rows.filter((row) => row[recordTypeIndex] === "similarity").length, 3);
  assert.equal(rows.filter((row) => row[recordTypeIndex] === "contact").length, 5);
  assert.ok(rows.some((row) => row[metricIndex] === "deltaSasaAngstrom2"));
  assert.ok(rows.some((row) => row[membershipIndex] === "shared"));
  assert.ok(rows.some((row) => row[membershipIndex] === "reference_only"));
  assert.ok(rows.some((row) => row[membershipIndex] === "comparison_only"));
});

test("summary generation is deterministic and does not mutate either input", () => {
  const [reference, comparison] = makePair();
  const beforeReference = JSON.stringify(reference);
  const beforeComparison = JSON.stringify(comparison);
  const first = summarizeStatePair(reference, comparison);
  const second = summarizeStatePair(reference, comparison);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(reference), beforeReference);
  assert.equal(JSON.stringify(comparison), beforeComparison);
});

test("summary provenance is a stable snapshot rather than a live view of mutable inputs", () => {
  const [reference, comparison] = makePair();
  const expectedContactTypes = [...reference.audit.contacts[0].contactTypes];
  const expectedWarnings = [...reference.audit.warnings];
  const summary = summarizeStatePair(reference, comparison);
  reference.audit.contacts[0].contactTypes.push("mutated-after-summary");
  reference.audit.warnings.push("mutated-after-summary");
  reference.structure.availableModelIds.push("later-model");
  reference.structure.chains[0].assemblyOperationIds = ["later-operation"];
  assert.deepEqual(summary.reference.audit.contacts[0].contactTypes, expectedContactTypes);
  assert.deepEqual(summary.reference.audit.warnings, expectedWarnings);
  assert.deepEqual(summary.reference.availableModelIds, ["1"]);
  assert.deepEqual(summary.reference.receptorChain.assemblyOperationIds, []);
  assert.deepEqual(
    summary.contacts.referenceOnly[0].reference.contactTypes,
    expectedContactTypes,
  );
});

test("state summary rejects an audit after a selected coordinate mutates", () => {
  const [reference, comparison] = makePair();
  comparison.structure.chains[1].residues[0].atoms[0].y += 100;
  assert.throws(
    () => summarizeStatePair(reference, comparison),
    /audit input attestation does not match/i,
  );
});

test("state summaries verify supplied fingerprints and normalize uppercase SHA-256", () => {
  const [reference, comparison] = makePair({
    referenceOptions: { sha256: "A".repeat(64) },
    comparisonOptions: { sha256: "B".repeat(64) },
  });
  const summary = summarizeStatePair(reference, comparison);
  assert.equal(summary.reference.sha256, "a".repeat(64));
  assert.equal(summary.comparison.sha256, "b".repeat(64));

  const mismatched = makePair();
  mismatched[1].coordinateFingerprint = "fnv1a64-3dp:0000000000000000";
  assert.throws(
    () => summarizeStatePair(...mismatched),
    /supplied coordinate fingerprint does not match/i,
  );
});

test("state export requires complete source provenance and is an immutable snapshot", () => {
  const [reference, comparison] = makePair();
  const summary = summarizeStatePair(reference, comparison);
  const report = createStatePairExportReport(
    summary,
    "Coordinate-only paired comparison.",
    "2026-08-27T12:34:56.000Z",
  );
  summary.reference.audit.contacts[0].contactTypes.push("mutated-after-export");
  summary.auditPolicy.cdrAnnotation = "mutated-after-export";
  assert.doesNotMatch(JSON.stringify(report), /mutated-after-export/);

  const missing = summarizeStatePair(...makePair({
    referenceOptions: { sha256: null },
  }));
  assert.throws(
    () => createStatePairExportReport(missing),
    /requires a source SHA-256 digest/i,
  );
  assert.throws(
    () => statePairToCsv(missing),
    /requires a source SHA-256 digest/i,
  );
});

test("the shared JSON/CSV validator rejects every recursively nonfinite numeric leaf", () => {
  const summary = summarizeStatePair(...makePair({
    referenceOptions: { label: "inactive" },
    comparisonOptions: { label: "active" },
  }));
  const paths = numericLeafPaths(summary);
  assert.ok(paths.length >= 100, `expected broad numeric coverage, observed ${paths.length} leaves`);
  let assertions = 0;
  for (const path of paths) {
    for (const nonfinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const mutated = clone(summary);
      setPath(mutated, path, nonfinite);
      assertBothStateExportsReject(mutated, /non-finite number/i);
      assertions += 2;
    }
  }
  assert.ok(assertions >= 600, `expected at least 600 nonfinite export assertions, observed ${assertions}`);
});

test("the shared JSON/CSV validator rejects provenance, policy, delta, overlap, contact, and attestation drift", () => {
  const baseline = summarizeStatePair(...makePair({
    referenceOptions: { label: "inactive" },
    comparisonOptions: { label: "active" },
  }));
  const cases = [
    ["schema", (summary) => { summary.schemaVersion = "1.1.0"; }],
    ["software version", (summary) => { summary.version = "0.4.9"; }],
    ["noncanonical digest", (summary) => { summary.reference.sha256 = "A".repeat(64); }],
    ["byte count", (summary) => { summary.comparison.bytes = 1.5; }],
    ["coordinate fingerprint", (summary) => { summary.reference.coordinateFingerprint = "bad"; }],
    ["geometry fingerprint", (summary) => { summary.comparison.geometryFingerprint = "bad"; }],
    ["source format", (summary) => { summary.reference.sourceFormat = "invented"; }],
    ["coordinate scope", (summary) => {
      summary.reference.coordinateScope = "deposited-assembly";
    }],
    ["label source", (summary) => { summary.reference.labelSource = null; }],
    ["coordinate provenance", (summary) => { summary.reference.coordinateProvenance = "experimental"; }],
    ["selected model", (summary) => { summary.comparison.selectedModelId = "absent"; }],
    ["selected assembly", (summary) => { summary.reference.selectedAssemblyId = "missing"; }],
    ["sequence length", (summary) => { summary.receptorSequenceLength += 1; }],
    ["condition/audit count", (summary) => { summary.reference.contactPairCount += 1; }],
    ["cutoff", (summary) => { summary.auditPolicy.residueContactCutoffAngstrom = 5; }],
    ["policy fingerprint", (summary) => { summary.auditPolicy.fingerprint += "-drift"; }],
    ["method", (summary) => { summary.methods.contactDefinition = "mutated"; }],
    ["claim warning", (summary) => { summary.warnings.pop(); }],
    ["signed delta", (summary) => { summary.deltas.contactPairCount += 1; }],
    ["Jaccard", (summary) => { summary.similarity.contactPairs = 0.987; }],
    ["contact partition", (summary) => { summary.contacts.shared[0].key = "1:999"; }],
    ["duplicate geometry", (summary) => {
      summary.selectedGeometryFit.rmsdAngstrom = 0;
      summary.selectedGeometryFit.maximumDeviationAngstrom = 0;
    }],
    ["impossible geometry fit", (summary) => {
      summary.selectedGeometryFit.rmsdAngstrom = 2;
      summary.selectedGeometryFit.maximumDeviationAngstrom = 1;
    }],
    ["contact residue name", (summary) => {
      summary.reference.audit.contacts[0].receptorResidueName = "GLY";
    }],
    ["contact display label", (summary) => {
      summary.reference.audit.contacts[0].receptorResidue = "forged-label";
    }],
    ["contact vocabulary", (summary) => {
      summary.reference.audit.contacts[0].contactTypes = ["forged-contact-type"];
    }],
    ["contact map distance", (summary) => {
      summary.comparison.audit.contacts[0].minimumDistance += 0.01;
    }],
    ["interface keys", (summary) => {
      summary.reference.audit.receptorInterfaceKeys[0] = "forged-key";
    }],
    ["audit attestation", (summary) => {
      summary.comparison.audit.auditAttestation.resultFingerprint =
        "fnv1a32x2-audit-result:0000000000000000";
    }],
  ];
  for (const [name, mutate] of cases) {
    const mutated = clone(baseline);
    mutate(mutated);
    assert.doesNotThrow(() => JSON.stringify(mutated), `${name} fixture should remain serializable`);
    assertBothStateExportsReject(mutated);
  }
});

test("all signed deltas, Jaccards, and contact partitions are independently rederived at both export gates", () => {
  const baseline = summarizeStatePair(...makePair());
  for (const key of Object.keys(baseline.deltas)) {
    const mutated = clone(baseline);
    mutated.deltas[key] = mutated.deltas[key] == null ? 0 : mutated.deltas[key] + 1;
    assertBothStateExportsReject(mutated, /signed delta/i);
  }
  for (const key of Object.keys(baseline.similarity)) {
    const mutated = clone(baseline);
    mutated.similarity[key] = mutated.similarity[key] === 0.123 ? 0.456 : 0.123;
    assertBothStateExportsReject(mutated, /Jaccard/i);
  }
  for (const group of ["shared", "referenceOnly", "comparisonOnly"]) {
    const mutated = clone(baseline);
    mutated.contacts[group][0].minimumDistanceDeltaAngstrom = 123;
    assertBothStateExportsReject(mutated, /contact partitions/i);
  }
});

test("validateStatePairExportSummary returns a detached, fully validated snapshot", () => {
  const summary = summarizeStatePair(...makePair());
  const validated = validateStatePairExportSummary(summary);
  assert.deepEqual(validated, summary);
  summary.reference.filename = "mutated-after-validation.pdb";
  summary.contacts.shared[0].key = "mutated-after-validation";
  assert.notEqual(validated.reference.filename, summary.reference.filename);
  assert.notEqual(validated.contacts.shared[0].key, summary.contacts.shared[0].key);
});
