import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeInterface,
  calculateBuriedSurfaceArea,
  classifyCoordinateProvenance,
  parsePaeJson,
  parsePdb,
  suggestChains,
  validateParsedPae,
} from "../lib/confovhh.ts";
import {
  canonicalizeSelectedGeometry,
  selectedGeometryFingerprint,
} from "../lib/pose-ensemble.ts";

const AA3 = {
  A: "ALA", C: "CYS", D: "ASP", E: "GLU", F: "PHE", G: "GLY", H: "HIS",
  I: "ILE", K: "LYS", L: "LEU", M: "MET", N: "ASN", P: "PRO", Q: "GLN",
  R: "ARG", S: "SER", T: "THR", V: "VAL", W: "TRP", Y: "TYR",
};

const VHH_SEQUENCE =
  "QVQLVQSGAEVKRPGSSVTVSCKASGGSFSTYALSWVRQAPGRGLEWMGGVIPLLTITNYAPRFQGRITITADRSTSTAYLELNSLRPEDTAVYYCAREGTTGKPIGAFAHWGQGTLVTVSS";

function atomLine({
  record = "ATOM",
  serial = 1,
  atomName = "CA",
  alternateLocation = "",
  residueName = "ALA",
  chain = "A",
  residueNumber = 1,
  insertionCode = "",
  x = 0,
  y = 0,
  z = 0,
  occupancy = 1,
  bFactor = 85,
  element = "C",
}) {
  return [
    record.padEnd(6),
    String(serial).padStart(5),
    " ",
    atomName.padStart(4),
    alternateLocation.slice(0, 1).padEnd(1),
    residueName.padStart(3),
    " ",
    chain.slice(0, 1),
    String(residueNumber).padStart(4),
    insertionCode.slice(0, 1).padEnd(1),
    "   ",
    x.toFixed(3).padStart(8),
    y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8),
    occupancy.toFixed(2).padStart(6),
    bFactor.toFixed(2).padStart(6),
    "          ",
    element.padStart(2),
  ].join("");
}

function atomLineWithRawCoordinates(options, x, y, z) {
  const fields = [x, y, z].map((value) => {
    assert.ok(value.length <= 8, `Raw PDB coordinate field is too long: ${value}`);
    return value.padStart(8);
  });
  const line = atomLine({ ...options, x: 0, y: 0, z: 0 });
  return `${line.slice(0, 30)}${fields.join("")}${line.slice(54)}`;
}

function replacePdbField(line, start, end, value) {
  assert.ok(value.length <= end - start);
  return `${line.slice(0, start)}${value.padStart(end - start)}${line.slice(end)}`;
}

function residueLines({
  chain,
  residueNumber,
  residueName = "ALA",
  x,
  y,
  z = 0,
  serialStart,
  bFactor = 85,
  onlyCa = false,
}) {
  if (onlyCa) return [atomLine({
    serial: serialStart, atomName: "CA", residueName, chain, residueNumber,
    x, y, z, element: "C", bFactor,
  })];
  return [
    atomLine({ serial: serialStart, atomName: "N", residueName, chain, residueNumber, x: x - 1.2, y, z, element: "N", bFactor }),
    atomLine({ serial: serialStart + 1, atomName: "CA", residueName, chain, residueNumber, x, y, z, element: "C", bFactor }),
    atomLine({ serial: serialStart + 2, atomName: "C", residueName, chain, residueNumber, x: x + 1.2, y, z, element: "C", bFactor }),
    atomLine({ serial: serialStart + 3, atomName: "O", residueName, chain, residueNumber, x: x + 2.1, y, z, element: "O", bFactor }),
  ];
}

function denseFixture({ onlyCa = false, bFactor = 85, exactOverlap = false } = {}) {
  const lines = [];
  let serial = 1;
  for (let index = 0; index < 180; index += 1) {
    const residue = residueLines({
      chain: "A", residueNumber: index + 1, x: index * 3.8, y: 0,
      serialStart: serial, onlyCa, bFactor,
    });
    serial += residue.length;
    lines.push(...residue);
  }
  for (let index = 0; index < VHH_SEQUENCE.length; index += 1) {
    const near = index < 20;
    const residue = residueLines({
      chain: "B", residueNumber: index + 1, residueName: AA3[VHH_SEQUENCE[index]],
      x: index * 3.8, y: near ? (exactOverlap && index === 0 ? 0 : 3.2) : 30,
      serialStart: serial, onlyCa, bFactor,
    });
    serial += residue.length;
    lines.push(...residue);
  }
  return lines.join("\n");
}

function twoAtomStructure(distance, receptor = { residueName: "ALA", atomName: "CA", element: "C" }, vhh = receptor) {
  return parsePdb([
    atomLine({ ...receptor, chain: "A", residueNumber: 1, x: 0, y: 0, z: 0, serial: 1 }),
    atomLine({ ...vhh, chain: "B", residueNumber: 1, x: distance, y: 0, z: 0, serial: 2 }),
  ].join("\n"));
}

test("parses polymeric HETATM MSE but excludes unrelated heteroatoms", () => {
  const structure = parsePdb([
    atomLine({ record: "HETATM", residueName: "MSE", atomName: "CA", element: "C" }),
    atomLine({ record: "HETATM", serial: 2, residueName: "HOH", atomName: "O", element: "O", residueNumber: 2 }),
  ].join("\n"));
  assert.equal(structure.chains[0].sequence, "M");
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.unsupportedResidueRecords, 0);
});

test("classifies experimental methods without calling theoretical models experimental", () => {
  assert.equal(classifyCoordinateProvenance("X-RAY DIFFRACTION"), "experimental");
  assert.equal(classifyCoordinateProvenance("ELECTRON MICROSCOPY"), "experimental");
  assert.equal(classifyCoordinateProvenance("THEORETICAL MODEL"), "modeled");
  assert.equal(classifyCoordinateProvenance(null), "unknown");
  assert.equal(classifyCoordinateProvenance("OTHER"), "unknown");
});

test("selects the highest-occupancy alternate location, including B over A", () => {
  const structure = parsePdb([
    atomLine({ alternateLocation: "A", x: 1, occupancy: 0.45 }),
    atomLine({ serial: 2, alternateLocation: "B", x: 9, occupancy: 0.55 }),
  ].join("\n"));
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.atoms[0].x, 9);
  assert.equal(structure.ignoredAlternateLocations, 1);
});

test("selects one coherent alternate conformer for an entire residue", () => {
  const structure = parsePdb([
    atomLine({ atomName: "CA", alternateLocation: "A", x: 1, occupancy: 0.9, serial: 1 }),
    atomLine({ atomName: "CA", alternateLocation: "B", x: 9, occupancy: 0.1, serial: 2 }),
    atomLine({ atomName: "CB", alternateLocation: "A", x: 2, occupancy: 0.1, serial: 3 }),
    atomLine({ atomName: "CB", alternateLocation: "B", x: 10, occupancy: 0.9, serial: 4 }),
  ].join("\n"));
  assert.deepEqual(structure.atoms.map((atom) => atom.x), [1, 2]);
  assert.equal(structure.ignoredAlternateLocations, 2);
});

test("retains a residue represented only by alternate location B", () => {
  const structure = parsePdb(atomLine({ alternateLocation: "B", x: 4, occupancy: 0.7 }));
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.atoms[0].x, 4);
});

test("zero-occupancy-only residues do not create ghost sequence or PAE positions", () => {
  const structure = parsePdb([
    atomLine({ chain: "A", residueNumber: 1, occupancy: 0, serial: 1 }),
    atomLine({ chain: "A", residueNumber: 2, x: 0, serial: 2 }),
    atomLine({ chain: "B", residueNumber: 1, x: 3, serial: 3 }),
  ].join("\n"));
  assert.equal(structure.chains[0].residueCount, 1);
  assert.equal(structure.chains[0].residues[0].order, 1);
  assert.equal(structure.zeroOccupancyAtomRecords, 1);
  assert.doesNotThrow(() => parsePaeJson(JSON.stringify({ pae: [[0, 4], [5, 0]] }), structure));
});

test("negative occupancy records fail closed without creating ghost residues", () => {
  const structure = parsePdb([
    atomLine({ chain: "A", residueNumber: 1, occupancy: -0.25, serial: 1 }),
    atomLine({ chain: "A", residueNumber: 2, x: 0, serial: 2 }),
    atomLine({ chain: "B", residueNumber: 1, x: 3, serial: 3 }),
  ].join("\n"));
  assert.equal(structure.chains[0].residueCount, 1);
  assert.equal(structure.chains[0].residues[0].number, 2);
  assert.equal(structure.chains[0].residues[0].order, 1);
  assert.equal(structure.malformedAtomRecords, 1);
});

test("occupancy accepts the unit boundary and rejects values above one", () => {
  const structure = parsePdb([
    atomLine({ chain: "A", residueNumber: 1, occupancy: 1, serial: 1 }),
    atomLine({ chain: "A", residueNumber: 2, occupancy: 1.01, x: 4, serial: 2 }),
  ].join("\n"));
  assert.equal(structure.chains[0].residueCount, 1);
  assert.equal(structure.chains[0].residues[0].number, 1);
  assert.equal(structure.malformedAtomRecords, 1);
});

test("counts duplicate, malformed, zero-occupancy, and residue-name conflict records", () => {
  const valid = atomLine({ atomName: "CA" });
  const malformed = `${atomLine({ serial: 3, atomName: "N" }).slice(0, 30)}XXXXXXXX${atomLine({ serial: 3, atomName: "N" }).slice(38)}`;
  const structure = parsePdb([
    valid,
    atomLine({ serial: 2, atomName: "CA" }),
    malformed,
    atomLine({ serial: 4, atomName: "O", occupancy: 0 }),
    atomLine({ serial: 5, atomName: "C", residueName: "GLY" }),
    atomLine({ serial: 6, atomName: "CB", residueName: "UNK" }),
  ].join("\n"));
  assert.equal(structure.duplicateAtomRecords, 1);
  assert.equal(structure.malformedAtomRecords, 1);
  assert.equal(structure.zeroOccupancyAtomRecords, 1);
  assert.equal(structure.residueNameConflicts, 1);
  assert.equal(structure.unsupportedResidueRecords, 1);
});

test("defaults to the first actual model ID and permits explicit model selection", () => {
  const text = [
    "MODEL        5",
    atomLine({ x: 1 }),
    "ENDMDL",
    "MODEL        9",
    atomLine({ x: 20 }),
    "ENDMDL",
  ].join("\n");
  const structure = parsePdb(text);
  assert.equal(structure.modelCount, 2);
  assert.equal(structure.selectedModelId, "5");
  assert.deepEqual(structure.availableModelIds, ["5", "9"]);
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.atoms[0].x, 1);
  assert.equal(parsePdb(text, "9").atoms[0].x, 20);
  assert.throws(() => parsePdb(text, "2"), /not defined/);
  assert.throws(() => parsePdb(text.replace("MODEL        9", "MODEL        5")), /duplicate MODEL/);
});

test("keeps insertion-coded residues distinct", () => {
  const structure = parsePdb([
    atomLine({ residueNumber: 10, insertionCode: "A" }),
    atomLine({ serial: 2, residueNumber: 10, insertionCode: "B", x: 4 }),
  ].join("\n"));
  assert.equal(structure.chains[0].residueCount, 2);
  assert.notEqual(structure.chains[0].residues[0].key, structure.chains[0].residues[1].key);
});

test("audits a legal pipe chain identifier without corrupting residue-pair keys", () => {
  const structure = parsePdb([
    atomLine({ chain: "|", x: 0 }),
    atomLine({ serial: 2, chain: "B", x: 4 }),
  ].join("\n"));
  const audit = analyzeInterface(structure, "|", "B", "none");
  assert.equal(audit.contactPairCount, 1);
});

test("contact cutoff is inclusive at 4.5 Å and exclusive immediately above it", () => {
  assert.equal(analyzeInterface(twoAtomStructure(4.5), "A", "B", "none").contactPairCount, 1);
  assert.equal(analyzeInterface(twoAtomStructure(4.501), "A", "B", "none").contactPairCount, 0);
});

test("polar and salt proxies require physically non-overlapping lower distances", () => {
  const receptor = { residueName: "ASP", atomName: "OD1", element: "O" };
  const vhh = { residueName: "LYS", atomName: "NZ", element: "N" };
  const valid = analyzeInterface(twoAtomStructure(3, receptor, vhh), "A", "B", "none");
  assert.equal(valid.polarContactProxyCount, 1);
  assert.equal(valid.saltBridgeProxyCount, 1);
  const impossible = analyzeInterface(twoAtomStructure(1, receptor, vhh), "A", "B", "none");
  assert.equal(impossible.polarContactProxyCount, 0);
  assert.equal(impossible.saltBridgeProxyCount, 0);
  assert.ok(impossible.severeClashCount > 0);
});

test("recognizes a plausible interchain disulfide without calling it a noncovalent clash", () => {
  const cys = { residueName: "CYS", atomName: "SG", element: "S" };
  const audit = analyzeInterface(twoAtomStructure(2.05, cys, cys), "A", "B", "none");
  assert.equal(audit.possibleInterchainDisulfideCount, 1);
  assert.equal(audit.severeClashCount, 0);
  assert.ok(audit.contacts[0].contactTypes.includes("possible interchain disulfide"));
});

test("a C-alpha-only broad pose can never receive the top evidence band", () => {
  const audit = analyzeInterface(parsePdb(denseFixture({ onlyCa: true })), "A", "B", "plddt");
  assert.equal(audit.evidenceLevel, "limited");
  assert.equal(audit.findings.find((finding) => finding.label.includes("coordinate"))?.level, "limited");
});

test("pLDDT values outside 0–100 invalidate rather than inflate interface confidence", () => {
  const audit = analyzeInterface(parsePdb(denseFixture({ bFactor: 101 })), "A", "B", "plddt");
  assert.equal(audit.interfaceConfidence, null);
  assert.match(audit.warnings.join(" "), /outside 0–100/i);
  assert.notEqual(audit.evidenceLevel, "supported");
});

test("sparse pLDDT coverage cannot support a pose", () => {
  const structure = parsePdb(denseFixture());
  for (const chain of structure.chains) {
    for (const residue of chain.residues) {
      if (!(chain.id === "A" && residue.order === 1)) {
        for (const atom of residue.atoms) atom.bFactor = null;
      }
    }
  }
  const audit = analyzeInterface(structure, "A", "B", "plddt");
  assert.ok((audit.interfaceConfidenceCoverage ?? 1) < 0.1);
  assert.notEqual(audit.evidenceLevel, "supported");
  assert.equal(
    audit.findings.find((finding) => finding.label === "Reported coordinate confidence")?.level,
    "limited",
  );
});

test("one catastrophic overlap forces limited evidence even in a broad interface", () => {
  const audit = analyzeInterface(parsePdb(denseFixture({ exactOverlap: true })), "A", "B", "none");
  assert.ok(audit.maximumOverlapAngstrom >= 1.5);
  assert.equal(audit.evidenceLevel, "limited");
});

test("buried-area calculation is zero for separated atoms", () => {
  const structure = twoAtomStructure(7);
  const result = calculateBuriedSurfaceArea(
    structure.chains[0].residues[0].atoms,
    structure.chains[1].residues[0].atoms,
  );
  assert.deepEqual(result, { total: 0, receptor: 0, vhh: 0 });
});

test("two-sphere buried area agrees with the analytic spherical-cap result", () => {
  const distance = 4;
  const expandedRadius = 1.7 + 1.4;
  const expectedTotal = 4 * Math.PI * expandedRadius * (expandedRadius - distance / 2);
  const structure = twoAtomStructure(distance);
  const result = calculateBuriedSurfaceArea(
    structure.chains[0].residues[0].atoms,
    structure.chains[1].residues[0].atoms,
  );
  assert.ok(Math.abs(result.total - expectedTotal) / expectedTotal < 0.04);
  assert.ok(Math.abs(result.receptor - result.vhh) / result.total < 0.04);
});

test("SASA grid finds the narrow selenium occlusion across a former two-cell boundary", () => {
  const structure = twoAtomStructure(6.51);
  const left = [{
    ...structure.chains[0].residues[0].atoms[0],
    x: 6.49,
    element: "SE",
  }];
  const right = [{
    ...structure.chains[1].residues[0].atoms[0],
    x: 13,
    element: "SE",
  }];
  const expandedRadius = 1.9 + 1.4;
  const expectedTotal = 4 * Math.PI * expandedRadius * (expandedRadius - 6.51 / 2);
  const result = calculateBuriedSurfaceArea(left, right);
  assert.ok(result.total > 0);
  assert.ok(Math.abs(result.total - expectedTotal) / expectedTotal < 0.25);
});

test("buried area is deterministic, partner-swap invariant, and translation invariant", () => {
  const structure = twoAtomStructure(4);
  const a = structure.chains[0].residues[0].atoms;
  const b = structure.chains[1].residues[0].atoms;
  const first = calculateBuriedSurfaceArea(a, b);
  const repeated = calculateBuriedSurfaceArea(a, b);
  const swapped = calculateBuriedSurfaceArea(b, a);
  const translatedA = a.map((atom) => ({ ...atom, x: atom.x + 33, y: atom.y - 12, z: atom.z + 5 }));
  const translatedB = b.map((atom) => ({ ...atom, x: atom.x + 33, y: atom.y - 12, z: atom.z + 5 }));
  const translated = calculateBuriedSurfaceArea(translatedA, translatedB);
  assert.deepEqual(first, repeated);
  assert.equal(first.total, swapped.total);
  assert.equal(first.receptor, swapped.vhh);
  assert.ok(Math.abs(first.total - translated.total) < 1e-9);
});

test("scientific audit results are invariant to atom rows reordered within fixed residues", () => {
  const groups = [];
  let serial = 1;
  for (const [chain, residueNumber, origin] of [
    ["A", 1, [0, 0, 0]],
    ["A", 2, [3.7, 0.4, 0.2]],
    ["B", 1, [0.5, 3.4, 1.1]],
    ["B", 2, [4.1, 3.7, 1.5]],
  ]) {
    const atoms = [
      ["N", 0, 0, 0, "N"],
      ["CA", 1.2, 0.2, 0, "C"],
      ["C", 2.1, 1.1, 0.3, "C"],
      ["O", 1.8, 2.2, 0.7, "O"],
      ["CB", 0.7, -0.8, 1.1, "C"],
    ].map(([atomName, x, y, z, element]) => atomLine({
      serial: serial++,
      atomName,
      chain,
      residueNumber,
      x: origin[0] + x,
      y: origin[1] + y,
      z: origin[2] + z,
      element,
      bFactor: 82,
    }));
    groups.push(atoms);
  }

  const auditRows = (reverseAtoms) => {
    const text = groups.flatMap((atoms) => (
      reverseAtoms ? [...atoms].reverse() : atoms
    )).join("\n");
    const structure = parsePdb(text);
    return analyzeInterface(
      structure,
      "A",
      "B",
      "none",
      null,
      false,
      canonicalizeSelectedGeometry(structure, "A", "B"),
    );
  };
  const sourceOrder = auditRows(false);
  const reversedWithinResidues = auditRows(true);
  assert.notEqual(
    sourceOrder.auditAttestation.inputFingerprint,
    reversedWithinResidues.auditAttestation.inputFingerprint,
  );
  assert.equal(
    sourceOrder.auditAttestation.resultFingerprint,
    reversedWithinResidues.auditAttestation.resultFingerprint,
  );
  const { auditAttestation: firstAttestation, ...firstScientificResult } = sourceOrder;
  const { auditAttestation: secondAttestation, ...secondScientificResult } = reversedWithinResidues;
  assert.ok(firstAttestation && secondAttestation);
  assert.deepEqual(firstScientificResult, secondScientificResult);
});

test("parses AlphaFold-list, pae-object, and raw PAE matrix formats", () => {
  const structure = twoAtomStructure(3);
  const matrix = [[0, 3], [12, 0]];
  const alphaFold = parsePaeJson(JSON.stringify([{ predicted_aligned_error: matrix, max_predicted_aligned_error: 31.75 }]), structure, "af.json");
  const generic = parsePaeJson(JSON.stringify({ pae: matrix, max_pae: 31.75 }), structure);
  const raw = parsePaeJson(JSON.stringify(matrix), structure);
  assert.equal(alphaFold.sourceFormat, "AlphaFold predicted_aligned_error");
  assert.equal(generic.sourceFormat, "pae matrix");
  assert.equal(raw.sourceFormat, "raw matrix");
  assert.deepEqual(Array.from(alphaFold.matrix), matrix.flat());
});

test("reports asymmetric PAE directions separately and uses their maximum as the conservative scalar", () => {
  const structure = twoAtomStructure(3);
  const pae = parsePaeJson(JSON.stringify({ pae: [[0, 3], [12, 0]] }), structure, "scores.json");
  const audit = analyzeInterface(structure, "A", "B", "none", pae, true);
  assert.equal(audit.receptorFrameToVhhPaeMedianAngstrom, 3);
  assert.equal(audit.vhhFrameToReceptorPaeMedianAngstrom, 12);
  assert.equal(audit.interfacePaeMedianAngstrom, 12);
  assert.equal(audit.paeFilename, "scores.json");
  assert.equal(audit.paeOrderConfirmed, true);
});

test("conservative PAE aggregates the worse direction per contact pair", () => {
  const structure = parsePdb([
    atomLine({ chain: "A", residueNumber: 1, x: 0, serial: 1 }),
    atomLine({ chain: "A", residueNumber: 2, x: 10, serial: 2 }),
    atomLine({ chain: "B", residueNumber: 1, x: 3, serial: 3 }),
    atomLine({ chain: "B", residueNumber: 2, x: 13, serial: 4 }),
  ].join("\n"));
  const matrix = Array.from({ length: 4 }, () => Array(4).fill(0));
  matrix[2][0] = 0;
  matrix[0][2] = 100;
  matrix[3][1] = 100;
  matrix[1][3] = 0;
  const pae = parsePaeJson(JSON.stringify({ pae: matrix }), structure);
  const audit = analyzeInterface(structure, "A", "B", "none", pae, true);
  assert.equal(audit.receptorFrameToVhhPaeMedianAngstrom, 50);
  assert.equal(audit.vhhFrameToReceptorPaeMedianAngstrom, 50);
  assert.equal(audit.interfacePaeMedianAngstrom, 100);
  assert.equal(audit.interfacePaeP90Angstrom, 100);
  assert.equal(audit.lowPaeContactShare, 0);
});

test("refuses PAE summaries until matrix residue order is explicitly confirmed", () => {
  const structure = twoAtomStructure(3);
  const pae = parsePaeJson(JSON.stringify({ pae: [[0, 3], [12, 0]] }), structure);
  assert.throws(
    () => analyzeInterface(structure, "A", "B", "none", pae),
    /confirm both.*row-aligned.*residue order/i,
  );
});

test("PAE parser fails closed on invalid JSON, shape, values, and coordinate mismatch", () => {
  const structure = twoAtomStructure(3);
  assert.throws(() => parsePaeJson("not json", structure), /valid JSON/i);
  assert.throws(() => parsePaeJson(JSON.stringify({ pae: [[0, 1], [1]] }), structure), /row 2/i);
  assert.throws(() => parsePaeJson(JSON.stringify({ pae: [[0, -1], [1, 0]] }), structure), /invalid/i);
  assert.throws(() => parsePaeJson(JSON.stringify({ pae: [[0, 1e100], [1e100, 0]] }), structure), /Float32 range/i);
  assert.throws(() => parsePaeJson(JSON.stringify({ pae: [[0, 1], [1, 0]], max_pae: 1e100 }), structure), /Float32 range/i);
  assert.throws(() => parsePaeJson(JSON.stringify({ pae: [[0]] }), structure), /does not match/i);
});

test("missing PAE remains explicitly unavailable", () => {
  const audit = analyzeInterface(twoAtomStructure(3), "A", "B", "none");
  assert.equal(audit.interfacePaeMedianAngstrom, null);
  assert.equal(audit.findings.find((finding) => finding.label === "Cross-chain PAE")?.level, "unavailable");
});

test("spatial-grid contact counts match a brute-force oracle across negative coordinates", () => {
  let seed = 1729;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const lines = [];
  const coordinates = { A: [], B: [] };
  let serial = 1;
  for (const chain of ["A", "B"]) {
    for (let index = 0; index < 35; index += 1) {
      const coordinate = {
        x: random() * 30 - 15,
        y: random() * 30 - 15,
        z: random() * 30 - 15,
      };
      coordinates[chain].push(coordinate);
      lines.push(atomLine({ serial: serial++, chain, residueNumber: index + 1, ...coordinate }));
    }
  }
  const brute = new Set();
  for (let a = 0; a < coordinates.A.length; a += 1) {
    for (let b = 0; b < coordinates.B.length; b += 1) {
      const left = coordinates.A[a];
      const right = coordinates.B[b];
      if (Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z) <= 4.5) {
        brute.add(`${a}:${b}`);
      }
    }
  }
  const audit = analyzeInterface(parsePdb(lines.join("\n")), "A", "B", "none");
  assert.equal(audit.contactPairCount, brute.size);
});

test("pair-aware chain suggestion prefers a contacting receptor–VHH pair", () => {
  const lines = [];
  let serial = 1;
  const addChain = (chain, count, y) => {
    for (let index = 0; index < count; index += 1) {
      lines.push(atomLine({ serial: serial++, chain, residueNumber: index + 1, x: index * 3.8, y }));
    }
  };
  addChain("A", 180, 0);
  addChain("B", 181, 50);
  addChain("C", 100, 3.5);
  addChain("D", 120, 80);
  assert.deepEqual(suggestChains(parsePdb(lines.join("\n"))), {
    receptorChain: "A",
    vhhChain: "C",
  });
});

test("chain suggestion remains deterministic across a 256-copy assembly-like structure", () => {
  const syntheticChain = (id, residueCount, roleHint, x) => {
    const residueKey = `${id}:1`;
    const atom = {
      serial: 1,
      name: "CA",
      residueName: "ALA",
      chainId: id,
      residueNumber: 1,
      insertionCode: "",
      residueKey,
      residueOrder: 1,
      x,
      y: 0,
      z: 0,
      element: "C",
      bFactor: null,
    };
    return {
      id,
      atomCount: 1,
      residueCount,
      sequence: "A".repeat(residueCount),
      backboneCompleteness: 0,
      roleHint,
      residues: [{
        key: residueKey,
        chainId: id,
        name: "ALA",
        number: 1,
        insertionCode: "",
        order: 1,
        oneLetter: "A",
        atoms: [atom],
      }],
    };
  };
  const receptors = Array.from({ length: 128 }, (_, index) => syntheticChain(
    `R${String(index).padStart(3, "0")}`,
    200,
    "receptor-like",
    index === 127 ? 1_000_000 : index * 1_000,
  ));
  const vhhs = Array.from({ length: 128 }, (_, index) => syntheticChain(
    `V${String(index).padStart(3, "0")}`,
    120,
    "VHH-like",
    index === 127 ? 1_000_004 : 500_000 + index * 1_000,
  ));
  const structure = { chains: [...receptors, ...vhhs] };
  assert.deepEqual(suggestChains(structure), {
    receptorChain: "R127",
    vhhChain: "V127",
  });
  assert.deepEqual(suggestChains(structure), {
    receptorChain: "R127",
    vhhChain: "V127",
  });
});

test("invalid chain assignments return clear errors", () => {
  const structure = twoAtomStructure(3);
  assert.throws(() => analyzeInterface(structure, "A", "A", "none"), /two different chains/i);
  assert.throws(() => analyzeInterface(structure, "A", "Z", "none"), /not present/i);
});

test("PDB parser rejects NUL text and malformed MODEL state before retaining coordinates", () => {
  assert.throws(() => parsePdb(`${atomLine({})}\u0000`), /NUL/i);
  assert.throws(
    () => parsePdb(["MODEL        1", "MODEL        2", "ENDMDL", "ENDMDL"].join("\n")),
    /nested MODEL|preceding ENDMDL/i,
  );
  assert.throws(() => parsePdb(["MODEL        1", atomLine({})].join("\n")), /closed by ENDMDL/i);
  assert.throws(() => parsePdb(["ENDMDL", atomLine({})].join("\n")), /without an open MODEL/i);
  assert.throws(
    () => parsePdb([atomLine({}), "MODEL        1", atomLine({}), "ENDMDL"].join("\n")),
    /mixes coordinate records outside MODEL blocks/i,
  );
  assert.throws(
    () => parsePdb(["MODEL        1", atomLine({}), "ENDMDL", atomLine({ serial: 2 })].join("\n")),
    /outside an explicit MODEL block/i,
  );
});

test("PDB parser accepts 100 coordinate models and rejects the 101st during pre-scan", () => {
  const models = Array.from({ length: 100 }, (_, index) => [
    `MODEL     ${String(index + 1).padStart(4)}`,
    atomLine({ serial: index + 1, x: index }),
    "ENDMDL",
  ].join("\n"));
  assert.equal(parsePdb(models.join("\n")).availableModelIds.length, 100);
  assert.throws(
    () => parsePdb(`${models.join("\n")}\nMODEL      101\nENDMDL`),
    /more than 100 coordinate models/i,
  );
});

test("PDB coordinate bounds fail closed across parsing, canonicalization, and audit", () => {
  const boundedText = [
    atomLineWithRawCoordinates(
      { serial: 1, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 1 },
      "1e+7", "0", "0",
    ),
    atomLineWithRawCoordinates(
      { serial: 2, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 1 },
      "-1e+7", "0", "0",
    ),
  ].join("\n");
  const bounded = parsePdb(boundedText);
  assert.deepEqual(bounded.atoms.map((atom) => atom.x), [10_000_000, -10_000_000]);
  const canonical = canonicalizeSelectedGeometry(bounded, "A", "B");
  canonical.atoms.forEach((atom) => {
    assert.ok([atom.x, atom.y, atom.z].every(Number.isFinite));
  });
  assert.equal(analyzeInterface(bounded, "A", "B", "none", null, false, canonical).contactPairCount, 0);

  for (const unsupported of ["1e+308", "-1e+308"]) {
    const text = [
      atomLine({ serial: 1, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 1 }),
      atomLineWithRawCoordinates(
        { serial: 2, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 1 },
        unsupported, "0", "0",
      ),
    ].join("\n");
    assert.throws(() => parsePdb(text), /outside ±10,000,000 Å/i);

    const injected = parsePdb(boundedText);
    injected.chains[0].residues[0].atoms[0].x = Number(unsupported);
    assert.throws(
      () => canonicalizeSelectedGeometry(injected, "A", "B"),
      /non-finite value or one outside ±10,000,000 Å/i,
    );
    assert.throws(
      () => analyzeInterface(injected, "A", "B", "none"),
      /non-finite coordinate or one outside ±10,000,000 Å/i,
    );
  }
});

test("PDB and PAE parsers reject oversized text before allocating parsed records", () => {
  const oversized = " ".repeat(16 * 1024 * 1024 + 1);
  assert.throws(() => parsePdb(oversized), /bounded browser parser size limit/i);
  const structure = twoAtomStructure(3);
  assert.throws(() => parsePaeJson(oversized, structure), /bounded browser parser size limit/i);
});

test("PAE structural preflight rejects empty-row and flat-entry bombs before JSON decoding", () => {
  const structure = twoAtomStructure(3);
  const emptyRowBomb = `[${"[],".repeat(100_000)}[]]`;
  assert.throws(
    () => parsePaeJson(emptyRowBomb, structure),
    /matrix-row-scale containers/i,
  );

  const flatEntryBomb = `{"pae":[${"0,".repeat(1_500 * 1_500 + 1_600)}0]}`;
  assert.throws(
    () => parsePaeJson(flatEntryBomb, structure),
    /bounded 1,500-residue matrix-entry limit/i,
  );
});

test("parsed PAE validation accepts 1,500 residues and rejects 1,501", () => {
  assert.doesNotThrow(() => validateParsedPae({
    matrix: new Float32Array(1_500 * 1_500),
    residueCount: 1_500,
    maxPaeAngstrom: 0,
    sourceFormat: "raw matrix",
    filename: "boundary.json",
  }));
  assert.throws(
    () => validateParsedPae({
      matrix: new Float32Array(),
      residueCount: 1_501,
      maxPaeAngstrom: 0,
      sourceFormat: "raw matrix",
      filename: "over-boundary.json",
    }),
    /from 1 to 1,?500/i,
  );
});

test("PDB rejects blank-line bombs before splitting them into millions of strings", () => {
  const blankLineBomb = `${"\n".repeat(500_001)}${atomLine({})}`;
  assert.throws(() => parsePdb(blankLineBomb), /bounded line-count limit/i);
});

test("PDB bounds unique heavy-atom candidate identities before materialization", () => {
  const lines = Array.from({ length: 60_001 }, (_, index) => atomLine({
    serial: index + 1,
    atomName: index.toString(36).padStart(4, "0").toUpperCase(),
    element: "C",
  }));
  assert.throws(
    () => parsePdb(lines.join("\n")),
    /more than 60,000 unique protein heavy-atom sites/i,
  );
});

test("a skewed exact-boundary source remains valid after canonical centering", () => {
  const source = parsePdb([
    atomLineWithRawCoordinates(
      { serial: 1, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 1 },
      "-1e+7", "0", "0",
    ),
    atomLineWithRawCoordinates(
      { serial: 2, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 2 },
      "-1e+7", "0", "0",
    ),
    atomLineWithRawCoordinates(
      { serial: 3, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 1 },
      "-1e+7", "0", "0",
    ),
    atomLineWithRawCoordinates(
      { serial: 4, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 2 },
      "1e+7", "0", "0",
    ),
  ].join("\n"));
  const canonical = canonicalizeSelectedGeometry(source, "A", "B");
  assert.ok(Math.max(...canonical.atoms.map((atom) => Math.abs(atom.x))) > 10_000_000);
  assert.match(selectedGeometryFingerprint(source, "A", "B"), /^fnv1a64-se3-2dp:/);
  assert.doesNotThrow(() => analyzeInterface(source, "A", "B", "none", null, false, canonical));
});

test("PDB numeric fields reject nonblank junk suffixes instead of partial parsing", () => {
  const source = atomLine({
    serial: 1,
    atomName: "CA",
    residueName: "ALA",
    chain: "A",
    residueNumber: 1,
    x: 1,
    y: 2,
    z: 3,
    occupancy: 0.5,
    bFactor: 80,
  });
  const corruptions = [
    [22, 26, "1ABC"],
    [30, 38, "1.0BAD"],
    [38, 46, "-2XYZ"],
    [46, 54, "3.1oops"],
    [54, 60, "0.5BAD"],
    [60, 66, "8BAD"],
  ];
  for (const [start, end, value] of corruptions) {
    const parsed = parsePdb([
      replacePdbField(source, start, end, value),
      atomLine({ serial: 2, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 2 }),
      atomLine({ serial: 3, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 1, x: 3 }),
    ].join("\n"));
    assert.equal(parsed.malformedAtomRecords, 1, `${start}:${end}:${value}`);
    assert.equal(parsed.atoms.length, 2, `${start}:${end}:${value}`);
  }
});

test("blank and literal underscore PDB chain identifiers remain distinct", () => {
  const parsed = parsePdb([
    atomLine({ serial: 1, atomName: "CA", residueName: "ALA", chain: "", residueNumber: 1 }),
    atomLine({ serial: 2, atomName: "CA", residueName: "GLY", chain: "_", residueNumber: 1, x: 3 }),
  ].join("\n"));
  assert.deepEqual(parsed.chains.map((chain) => chain.id), ["pdb-chain-blank", "_"]);
  assert.equal(parsed.chains[0].sequence, "A");
  assert.equal(parsed.chains[1].sequence, "G");
});

test("blank PDB element fields infer selenium without treating it as sulfur", () => {
  const structure = parsePdb(atomLine({
    record: "HETATM",
    atomName: "SE",
    residueName: "MSE",
    element: "",
  }));
  assert.equal(structure.atoms[0].element, "SE");
});

test("iterative PDB duplicate selection handles 130,000 exact records without argument spreading", () => {
  const line = atomLine({ atomName: "CA", occupancy: 1 });
  const structure = parsePdb(Array.from({ length: 130_000 }, () => line).join("\n"));
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.duplicateAtomRecords, 129_999);
});

test("equal-occupancy coordinate-conflicting PDB duplicates fail closed", () => {
  assert.throws(
    () => parsePdb([
      atomLine({ atomName: "CA", x: 1, occupancy: 1, serial: 1 }),
      atomLine({ atomName: "CA", x: 2, occupancy: 1, serial: 2 }),
    ].join("\n")),
    /conflicting highest-occupancy duplicate/i,
  );
});

test("source-frame contacts retain the exact inclusive cutoff when SASA uses a separate frame", () => {
  const source = twoAtomStructure(4.5);
  const sasaFrame = canonicalizeSelectedGeometry(source, "A", "B");
  const audit = analyzeInterface(source, "A", "B", "none", null, false, sasaFrame);
  assert.equal(audit.contactPairCount, 1);
  assert.equal(audit.contacts[0].minimumDistance, 4.5);
  assert.equal(audit.methods.sasaOrientation, "deterministic-proper-signed-frame");
  assert.match(audit.methods.sasaFrameAlgorithm, /farthest-signed-frame-v1/);
  assert.throws(
    () => analyzeInterface(source, "A", "B", "none", null, false, structuredClone(source)),
    /not the verified deterministic ConfoVHH canonical frame/i,
  );
  const mismatched = canonicalizeSelectedGeometry(source, "A", "B");
  mismatched.chains[1].residues[0].atoms[0].name = "CB";
  assert.throws(
    () => analyzeInterface(source, "A", "B", "none", null, false, mismatched),
    /not the verified deterministic ConfoVHH canonical frame/i,
  );

  const otherSource = twoAtomStructure(6);
  const wrongSourceFrame = canonicalizeSelectedGeometry(otherSource, "A", "B");
  assert.throws(
    () => analyzeInterface(source, "A", "B", "none", null, false, wrongSourceFrame),
    /not the verified deterministic ConfoVHH canonical frame/i,
  );

  const mutatedFrame = canonicalizeSelectedGeometry(source, "A", "B");
  mutatedFrame.chains[1].residues[0].atoms[0].x += 0.001;
  assert.throws(
    () => analyzeInterface(source, "A", "B", "none", null, false, mutatedFrame),
    /not the verified deterministic ConfoVHH canonical frame/i,
  );
});

test("probe-expanded burial is reported without inventing a 4.5 Å residue contact", () => {
  const structure = twoAtomStructure(5.5);
  const audit = analyzeInterface(structure, "A", "B", "none");
  const finding = audit.findings.find((entry) => entry.label === "Buried solvent-accessible area");
  assert.equal(audit.contactPairCount, 0);
  assert.ok(audit.deltaSasaAngstrom2 > 0);
  assert.doesNotMatch(finding.evidence, /No cross-chain burial was detected/i);
  assert.match(finding.evidence, /despite no residue pair within the 4.5 Å contact cutoff/i);
  assert.match(audit.warnings.join(" "), /source coordinate orientation.*rotation/i);
});

test("interface audit caps unique residue-pair allocation at 50,000", () => {
  const makeChain = (id, count) => {
    const residues = Array.from({ length: count }, (_, index) => {
      const key = `${id}:${index + 1}`;
      const atom = {
        serial: index + 1,
        name: "CA",
        residueName: "ALA",
        chainId: id,
        residueNumber: index + 1,
        insertionCode: "",
        residueKey: key,
        residueOrder: index + 1,
        x: 0,
        y: 0,
        z: 0,
        element: "C",
        bFactor: null,
      };
      return {
        key,
        chainId: id,
        name: "ALA",
        number: index + 1,
        insertionCode: "",
        order: index + 1,
        oneLetter: "A",
        atoms: [atom],
      };
    });
    return {
      id,
      atomCount: count,
      residueCount: count,
      sequence: "A".repeat(count),
      backboneCompleteness: 0,
      roleHint: id === "A" ? "receptor-like" : "other",
      residues,
    };
  };
  assert.throws(
    () => analyzeInterface({ chains: [makeChain("A", 225), makeChain("B", 225)] }, "A", "B", "none"),
    /more than 50,000 unique contacting residue pairs/i,
  );
});

test("SASA preflights candidate-distance and occlusion work independently", () => {
  const makeAtoms = (count, chainId, x) => Array.from({ length: count }, (_, index) => ({
    serial: index + 1,
    name: "CA",
    residueName: "ALA",
    chainId,
    residueNumber: index + 1,
    insertionCode: "",
    residueKey: `${chainId}:${index + 1}`,
    residueOrder: index + 1,
    x,
    y: 0,
    z: 0,
    element: "C",
    bFactor: null,
  }));
  assert.throws(
    () => calculateBuriedSurfaceArea(makeAtoms(3_000, "A", 0), makeAtoms(3_000, "B", 6.5)),
    /25 million SASA candidate-distance checks/i,
  );
  assert.throws(
    () => calculateBuriedSurfaceArea(makeAtoms(370, "A", 0), makeAtoms(370, "B", 0)),
    /250 million.*occlusion checks/i,
  );
});

test("chain suggestion falls back deterministically beyond bounded pair and atom scans", () => {
  const makeChain = (id, residueCount, roleHint, atomCount = 1) => {
    const residues = Array.from({ length: atomCount }, (_, index) => {
      const key = `${id}:${index + 1}`;
      const atom = {
        serial: index + 1,
        name: "CA",
        residueName: "ALA",
        chainId: id,
        residueNumber: index + 1,
        insertionCode: "",
        residueKey: key,
        residueOrder: index + 1,
        x: 0,
        y: 0,
        z: 0,
        element: "C",
        bFactor: null,
      };
      return { key, chainId: id, name: "ALA", number: index + 1, insertionCode: "", order: index + 1, oneLetter: "A", atoms: [atom] };
    });
    return { id, atomCount, residueCount, sequence: "A".repeat(residueCount), backboneCompleteness: 0, roleHint, residues };
  };
  const tooManyNearPairs = {
    chains: [
      ...Array.from({ length: 65 }, (_, index) => makeChain(`R${String(index).padStart(2, "0")}`, 200, "receptor-like")),
      ...Array.from({ length: 65 }, (_, index) => makeChain(`V${String(index).padStart(2, "0")}`, 120, "VHH-like")),
    ],
  };
  assert.deepEqual(suggestChains(tooManyNearPairs), { receptorChain: "R00", vhhChain: "V00" });
  const tooManyAtomComparisons = {
    chains: [
      makeChain("R", 200, "receptor-like", 501),
      makeChain("V", 120, "VHH-like", 501),
    ],
  };
  assert.deepEqual(suggestChains(tooManyAtomComparisons), { receptorChain: "R", vhhChain: "V" });
});

test("directional PAE regression preserves a 7/9 Å asymmetry", () => {
  const structure = twoAtomStructure(3);
  const pae = parsePaeJson(JSON.stringify({ pae: [[0, 7], [9, 0]] }), structure);
  const audit = analyzeInterface(structure, "A", "B", "none", pae, true);
  assert.equal(audit.receptorFrameToVhhPaeMedianAngstrom, 7);
  assert.equal(audit.vhhFrameToReceptorPaeMedianAngstrom, 9);
  assert.equal(audit.interfacePaeMedianAngstrom, 9);
});
test("split SASA frames do not perturb a source-frame contact exactly at 4.5 Å", () => {
  const source = parsePdb([
    atomLine({ serial: 1, atomName: "CA", residueName: "ALA", chain: "A", residueNumber: 1, x: 0, y: 0, z: 0 }),
    atomLine({ serial: 2, atomName: "CA", residueName: "GLY", chain: "B", residueNumber: 1, x: 4.5, y: 0, z: 0 }),
  ].join("\n"));
  const canonical = canonicalizeSelectedGeometry(source, "A", "B");
  const audit = analyzeInterface(source, "A", "B", "none", null, false, canonical);
  assert.equal(audit.contactPairCount, 1);
  assert.equal(audit.contacts[0].minimumDistance, 4.5);
});
