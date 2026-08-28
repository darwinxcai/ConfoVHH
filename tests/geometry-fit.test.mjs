import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeSelectedGeometry,
  GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM,
  GEOMETRY_DUPLICATE_RMSD_ANGSTROM,
  geometryFitIsDuplicate,
  selectedGeometryAtoms,
  selectedGeometryFit,
} from "../lib/geometry-fit.ts";

function structure(points, atomNames = points.map((_, index) => `X${index}`)) {
  const split = Math.max(1, Math.floor(points.length / 2));
  let serial = 1;
  const chains = [
    { id: "A", rolePoints: points.slice(0, split), names: atomNames.slice(0, split) },
    { id: "B", rolePoints: points.slice(split), names: atomNames.slice(split) },
  ].map(({ id, rolePoints, names }) => {
    const residues = rolePoints.map(([x, y, z], index) => {
      const atom = {
        serial: serial++, name: names[index], residueName: "ALA", chainId: id,
        residueNumber: index + 1, insertionCode: "", residueKey: `${id}:${index + 1}`,
        residueOrder: index + 1, x, y, z, element: "C", bFactor: null,
      };
      return {
        key: atom.residueKey, chainId: id, name: "ALA", number: index + 1,
        insertionCode: "", order: index + 1, oneLetter: "A", atoms: [atom],
      };
    });
    return {
      id, atomCount: residues.length, residueCount: residues.length,
      sequence: "A".repeat(residues.length), backboneCompleteness: 0,
      roleHint: id === "A" ? "receptor-like" : "VHH-like", residues,
    };
  });
  return {
    atoms: chains.flatMap((chain) => chain.residues.flatMap((residue) => residue.atoms)),
    chains, title: null, experimentalMethod: null, modelCount: 1,
    ignoredAlternateLocations: 0, ignoredHydrogens: 0, duplicateAtomRecords: 0,
    malformedAtomRecords: 0, unsupportedResidueRecords: 0, zeroOccupancyAtomRecords: 0,
    residueNameConflicts: 0, sourceFormat: "pdb", coordinateScope: "as-supplied",
    selectedModelId: "1", availableModelIds: ["1"], availableAssemblies: [], selectedAssembly: null,
  };
}

function axisAngle(axis, angle) {
  const length = Math.hypot(...axis);
  const [x, y, z] = axis.map((value) => value / length);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function transform(points, rotation, translation) {
  return points.map(([x, y, z]) => [
    rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z + translation[0],
    rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z + translation[1],
    rotation[2][0] * x + rotation[2][1] * y + rotation[2][2] * z + translation[2],
  ]);
}

const basePoints = [
  [-3, -1, 0], [2, -2, 1], [4, 0.5, -1], [-1, 3, 2],
  [0, -1, 4], [1, 2, -3], [-2, 1, -2], [3, 2, 2],
];

test("proper rotations and translations are near-duplicates", () => {
  const reference = structure(basePoints);
  const candidate = structure(transform(
    basePoints,
    axisAngle([1, 2, -3], 1.234),
    [9_000_000, -9_000_000, 7_500_000],
  ));
  const fit = selectedGeometryFit(reference, "A", "B", candidate, "A", "B");
  assert.ok(fit);
  assert.ok(fit.rmsdAngstrom < 1e-7, String(fit.rmsdAngstrom));
  assert.ok(fit.maximumDeviationAngstrom < 1e-6, String(fit.maximumDeviationAngstrom));
  assert.equal(geometryFitIsDuplicate(fit), true);
});

test("proper-rotation fit keeps reflections distinct", () => {
  const reference = structure(basePoints);
  const reflected = structure(basePoints.map(([x, y, z]) => [-x, y, z]));
  const fit = selectedGeometryFit(reference, "A", "B", reflected, "A", "B");
  assert.ok(fit);
  assert.equal(geometryFitIsDuplicate(fit), false);
  assert.ok(
    fit.rmsdAngstrom > GEOMETRY_DUPLICATE_RMSD_ANGSTROM ||
      fit.maximumDeviationAngstrom > GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM,
  );
});

test("0.001 Å serialization drift remains a duplicate", () => {
  const reference = structure(basePoints);
  const drifted = structure(basePoints.map(([x, y, z], index) => [
    x + (index % 2 ? 0.001 : -0.001), y, z,
  ]));
  assert.equal(
    geometryFitIsDuplicate(selectedGeometryFit(reference, "A", "B", drifted, "A", "B")),
    true,
  );
});

test("maximum-deviation guard prevents a local outlier from being diluted", () => {
  const points = Array.from({ length: 100 }, (_, index) => [
    Math.cos(index) * (2 + index / 50),
    Math.sin(index) * (2 + index / 70),
    index / 25,
  ]);
  const changed = points.map((point) => [...point]);
  changed[93][2] += 0.1;
  const fit = selectedGeometryFit(structure(points), "A", "B", structure(changed), "A", "B");
  assert.ok(fit);
  assert.ok(fit.rmsdAngstrom < GEOMETRY_DUPLICATE_RMSD_ANGSTROM);
  assert.ok(fit.maximumDeviationAngstrom > GEOMETRY_DUPLICATE_MAX_DEVIATION_ANGSTROM);
  assert.equal(geometryFitIsDuplicate(fit), false);
});

test("atom inventory mismatch returns null", () => {
  const reference = structure(basePoints);
  const candidate = structure(basePoints, basePoints.map((_, index) => (
    index === 3 ? "DIFFERENT" : `X${index}`
  )));
  assert.equal(selectedGeometryFit(reference, "A", "B", candidate, "A", "B"), null);
});

test("JSON tuple atom identities remain unambiguous", () => {
  const parsed = structure(basePoints, ["A:B", "A\u0000B", "A,B", "[A]", "A|B", "A/B", "A B", "A\tB"]);
  const selected = selectedGeometryAtoms(parsed, "A", "B");
  assert.equal(new Set(selected.map((entry) => entry.id)).size, basePoints.length);
  selected.forEach((entry) => assert.deepEqual(JSON.parse(entry.id), entry.identity));
});

test("coincident and collinear selections canonicalize without throwing", () => {
  const coincident = canonicalizeSelectedGeometry(
    structure(Array.from({ length: 8 }, () => [3, -7, 11])),
    "A",
    "B",
  );
  coincident.atoms.forEach((atom) => {
    assert.ok(Math.abs(atom.x) < 1e-12);
    assert.ok(Math.abs(atom.y) < 1e-12);
    assert.ok(Math.abs(atom.z) < 1e-12);
  });
  const collinearPoints = Array.from({ length: 8 }, (_, index) => [index - 4, 0, 0]);
  const rotated = transform(collinearPoints, axisAngle([2, 3, 4], 0.73), [5e6, -7e6, 9e6]);
  const first = canonicalizeSelectedGeometry(structure(collinearPoints), "A", "B");
  const second = canonicalizeSelectedGeometry(structure(rotated), "A", "B");
  first.atoms.forEach((atom, index) => {
    assert.ok(Math.abs(atom.x - second.atoms[index].x) < 1e-7);
    assert.ok(Math.abs(atom.y - second.atoms[index].y) < 1e-7);
    assert.ok(Math.abs(atom.z - second.atoms[index].z) < 1e-7);
  });
});

test("canonicalization clones only the selected receptor and VHH, not ballast chains", () => {
  const source = structure(basePoints);
  const ballastResidues = Array.from({ length: 10_000 }, (_, index) => {
    const residueKey = `BALLAST:${index + 1}`;
    const atom = {
      serial: source.atoms.length + index + 1,
      name: "CA",
      residueName: "ALA",
      chainId: "BALLAST",
      residueNumber: index + 1,
      insertionCode: "",
      residueKey,
      residueOrder: index + 1,
      x: index,
      y: 100,
      z: -100,
      element: "C",
      bFactor: null,
    };
    return {
      key: residueKey,
      chainId: "BALLAST",
      name: "ALA",
      number: index + 1,
      insertionCode: "",
      order: index + 1,
      oneLetter: "A",
      atoms: [atom],
    };
  });
  const ballast = {
    id: "BALLAST",
    atomCount: ballastResidues.length,
    residueCount: ballastResidues.length,
    sequence: "A".repeat(ballastResidues.length),
    backboneCompleteness: 0,
    roleHint: "other",
    residues: ballastResidues,
  };
  source.chains.push(ballast);
  source.atoms.push(...ballastResidues.map((residue) => residue.atoms[0]));

  const expected = canonicalizeSelectedGeometry(structure(basePoints), "A", "B");
  const observed = canonicalizeSelectedGeometry(source, "A", "B");
  assert.deepEqual(observed.chains.map((chain) => chain.id), ["A", "B"]);
  assert.equal(observed.atoms.length, basePoints.length);
  assert.equal(
    observed.chains.reduce((sum, chain) => sum + chain.atomCount, 0),
    basePoints.length,
  );
  assert.deepEqual(
    observed.atoms.map(({ x, y, z }) => [x, y, z]),
    expected.atoms.map(({ x, y, z }) => [x, y, z]),
  );
  const nestedAtoms = observed.chains.flatMap(
    (chain) => chain.residues.flatMap((residue) => residue.atoms),
  );
  observed.atoms.forEach((atom, index) => assert.equal(atom, nestedAtoms[index]));
  assert.notEqual(observed.atoms[0], source.atoms[0]);
});

test("canonical anchor ties stay deterministic under 1,000 rigid transforms", () => {
  const tied = [
    [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
  ];
  const baseline = canonicalizeSelectedGeometry(structure(tied), "A", "B").atoms;
  let seed = 0x51f15e;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const rotation = axisAngle(
      [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
      random() * Math.PI * 2,
    );
    const sign = iteration % 2 ? 1 : -1;
    const translated = transform(tied, rotation, [sign * 9e6, -sign * 8e6, sign * 7e6]);
    const observed = canonicalizeSelectedGeometry(structure(translated), "A", "B").atoms;
    for (let atomIndex = 0; atomIndex < baseline.length; atomIndex += 1) {
      assert.ok(Math.abs(baseline[atomIndex].x - observed[atomIndex].x) < 2e-7);
      assert.ok(Math.abs(baseline[atomIndex].y - observed[atomIndex].y) < 2e-7);
      assert.ok(Math.abs(baseline[atomIndex].z - observed[atomIndex].z) < 2e-7);
    }
  }
});
