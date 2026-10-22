import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  analyzeInterface,
  calculateBuriedSurfaceArea,
  parsePaeJson,
  parsePdb,
  summarizeContactPae,
  suggestChains,
} from "../lib/confovhh.ts";
import {
  canonicalizeSelectedGeometry,
  geometryFitIsDuplicate,
  selectedGeometryFit,
} from "../lib/geometry-fit.ts";
import {
  expandOperationExpression,
  parseMmcif,
} from "../lib/mmcif.ts";
import {
  jaccardIndex,
  poseEnsembleToCsv,
  selectedCoordinateFingerprint,
  selectedGeometryFingerprint,
  summarizePoseEnsemble,
} from "../lib/pose-ensemble.ts";
import {
  statePairToCsv,
  summarizeStatePair,
} from "../lib/state-pair.ts";
import {
  auditContactsToCsv,
  filterAuditContacts,
} from "../lib/contact-explorer.ts";
import { createPaeCrossBlockSample } from "../lib/pae-visualization.ts";
import {
  createNotebookEntry,
  createNotebookExport,
  createWorkspaceBundle,
  parseNotebookExport,
  parseWorkspaceBundle,
  upsertNotebookEntry,
} from "../lib/research-workspace.ts";
import { analyzeIntendedFootprint } from "../lib/user-footprint.ts";
import { createSingleAuditExportReport } from "../lib/audit-export.ts";
import {
  createPredictionRunManifest,
  normalizePredictionRunPath,
  predictionRunFileById,
  predictionRunManifestForExport,
} from "../lib/prediction-run.ts";
import {
  createPredictionRunDossier,
  executePredictionRunAuditJob,
  extractNativePredictionPae,
  predictionRunPoseSummaryCsv,
} from "../lib/prediction-run-jobs.ts";
import {
  createTopologyAnnotation,
  evaluateAnnotatedFootprint,
} from "../lib/topology-annotation.ts";
import {
  canAcceptPredictionRunWorkerEvent,
  isCurrentPredictionRunWorkerEvent,
  nextPredictionRunGeneration,
  nextPredictionRunProgress,
} from "../lib/prediction-run-lifecycle.ts";

const INITIAL_SEED = 0x6d2b79f5;
let randomState = INITIAL_SEED;
let assertionCount = 0;

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
}

function integer(maximum) {
  return Math.floor(random() * maximum);
}

function choice(values) {
  return values[integer(values.length)];
}

function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}

function notEqual(actual, expected, message) {
  assertionCount += 1;
  assert.notEqual(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}

function throws(fn, pattern, message) {
  assertionCount += 1;
  assert.throws(fn, pattern, message);
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = integer(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function axisAngle(axis, angle) {
  let [x, y, z] = axis;
  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const remainder = 1 - cosine;
  return [
    [
      remainder * x * x + cosine,
      remainder * x * y - sine * z,
      remainder * x * z + sine * y,
    ],
    [
      remainder * x * y + sine * z,
      remainder * y * y + cosine,
      remainder * y * z - sine * x,
    ],
    [
      remainder * x * z - sine * y,
      remainder * y * z + sine * x,
      remainder * z * z + cosine,
    ],
  ];
}

function transformPoints(points, rotation, translation) {
  return points.map(([x, y, z]) => [
    rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z + translation[0],
    rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z + translation[1],
    rotation[2][0] * x + rotation[2][1] * y + rotation[2][2] * z + translation[2],
  ]);
}

function makeStructure(points, options = {}) {
  const split = options.split ?? Math.max(1, Math.floor(points.length / 2));
  const chainIds = options.chainIds ?? ["A", "B"];
  let serial = 1;
  const chains = [points.slice(0, split), points.slice(split)].map((chainPoints, chainIndex) => {
    const chainId = chainIds[chainIndex];
    const residues = chainPoints.map(([x, y, z], index) => {
      const flatIndex = chainIndex === 0 ? index : split + index;
      const residueName = chainIndex === 0 ? "ALA" : "CYS";
      const atom = {
        serial: serial++,
        name: options.atomNames?.[flatIndex] ?? "CA",
        residueName,
        chainId,
        residueNumber: index + 1,
        insertionCode: "",
        residueKey: `${chainId}:${index + 1}`,
        residueOrder: index + 1,
        x,
        y,
        z,
        element: options.elements?.[flatIndex] ?? "C",
        bFactor: null,
      };
      return {
        key: atom.residueKey,
        chainId,
        name: residueName,
        number: index + 1,
        insertionCode: "",
        order: index + 1,
        oneLetter: chainIndex === 0 ? "A" : "C",
        labelSequenceId: index + 1,
        authSequenceId: index + 1,
        atoms: [atom],
      };
    });
    return {
      id: chainId,
      atomCount: residues.length,
      residueCount: residues.length,
      sequence: (chainIndex === 0 ? "A" : "C").repeat(residues.length),
      backboneCompleteness: 0,
      roleHint: chainIndex === 0 ? "receptor-like" : "VHH-like",
      residues,
    };
  });
  return {
    atoms: chains.flatMap((chain) => chain.residues.flatMap((residue) => residue.atoms)),
    chains,
    title: options.title ?? null,
    experimentalMethod: options.experimentalMethod ?? null,
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

function atomLine({
  serial = 1,
  atomName = "CA",
  residueName = "ALA",
  chain = "A",
  residueNumber = 1,
  x = 0,
  y = 0,
  z = 0,
  occupancy = 1,
  bFactor = 80,
  element = "C",
  alternateLocation = "",
  insertionCode = "",
} = {}) {
  return [
    "ATOM".padEnd(6),
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
    Number(x).toFixed(3).padStart(8),
    Number(y).toFixed(3).padStart(8),
    Number(z).toFixed(3).padStart(8),
    Number(occupancy).toFixed(2).padStart(6),
    Number(bFactor).toFixed(2).padStart(6),
    "          ",
    element.padStart(2),
  ].join("");
}

function simpleCif(fields) {
  const entries = Object.entries(fields);
  return `data_validation\nloop_\n${entries.map(([name]) => name).join("\n")}\n${entries.map(([, value]) => value).join(" ")}\n`;
}

const CIF_ATOM_FIELDS = {
  "_atom_site.group_PDB": "ATOM",
  "_atom_site.id": "1",
  "_atom_site.type_symbol": "C",
  "_atom_site.label_atom_id": "CA",
  "_atom_site.label_alt_id": ".",
  "_atom_site.label_comp_id": "ALA",
  "_atom_site.label_asym_id": "A",
  "_atom_site.auth_asym_id": "A",
  "_atom_site.label_seq_id": "1",
  "_atom_site.auth_seq_id": "1",
  "_atom_site.pdbx_PDB_ins_code": "?",
  "_atom_site.Cartn_x": "1.25",
  "_atom_site.Cartn_y": "-2.5",
  "_atom_site.Cartn_z": "3.75",
  "_atom_site.occupancy": "1",
  "_atom_site.B_iso_or_equiv": "80",
  "_atom_site.pdbx_PDB_model_num": "1",
};

function attestedStructure(id, pairs, geometryMarker) {
  const receptorSequence = "A".repeat(12);
  const vhhSequence = "C".repeat(12);
  const receptorForVhh = new Map(pairs.map(([receptorOrder, vhhOrder]) => [vhhOrder, receptorOrder]));
  let serial = 1;
  const makeResidues = (role, chainId, sequence) => [...sequence].map((oneLetter, index) => {
    const order = index + 1;
    const pairedReceptor = receptorForVhh.get(order);
    const residueName = role === "receptor" ? "ALA" : "CYS";
    const atom = {
      serial: serial++,
      name: "CA",
      residueName,
      chainId,
      residueNumber: order,
      insertionCode: "",
      residueKey: `${chainId}:${order}`,
      residueOrder: order,
      x: role === "receptor" ? order * 20 : (pairedReceptor ?? order) * 20,
      y: role === "receptor" ? 0 : pairedReceptor == null ? 1_000 + geometryMarker : 3.2,
      z: role === "receptor" && order === sequence.length ? geometryMarker : 0,
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
  const receptorResidues = makeResidues("receptor", "A", receptorSequence);
  const vhhResidues = makeResidues("vhh", "B", vhhSequence);
  const chains = [
    {
      id: "A",
      atomCount: receptorResidues.length,
      residueCount: receptorResidues.length,
      sequence: receptorSequence,
      backboneCompleteness: 0,
      roleHint: "receptor-like",
      residues: receptorResidues,
    },
    {
      id: "B",
      atomCount: vhhResidues.length,
      residueCount: vhhResidues.length,
      sequence: vhhSequence,
      backboneCompleteness: 0,
      roleHint: "VHH-like",
      residues: vhhResidues,
    },
  ];
  return {
    atoms: chains.flatMap((chain) => chain.residues.flatMap((residue) => residue.atoms)),
    chains,
    title: `Synthetic adversarial fixture ${id}`,
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

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function predictionCoordinate(seed = 0, title = "PREDICTION RUN ADVERSARIAL FIXTURE") {
  return [
    `TITLE     ${title}`,
    atomLine({ serial: 1, chain: "A", residueNumber: 1, x: seed, y: 0, residueName: "ALA" }),
    atomLine({ serial: 2, chain: "A", residueNumber: 2, x: seed + 3.8, y: 0, residueName: "ALA" }),
    atomLine({ serial: 3, chain: "B", residueNumber: 1, x: seed, y: 3.4, residueName: "CYS" }),
    atomLine({ serial: 4, chain: "B", residueNumber: 2, x: seed + 3.8, y: 3.4, residueName: "CYS" }),
    "END",
  ].join("\n");
}

function predictionMatrix(size = 4, salt = 0) {
  return Array.from({ length: size }, (_, row) => (
    Array.from({ length: size }, (_, column) => (
      row === column ? 0 : 1 + ((row * 7 + column * 11 + salt) % 29)
    ))
  ));
}

function predictionPaeText(size = 4, salt = 0, extras = {}) {
  return JSON.stringify({
    pae: predictionMatrix(size, salt),
    max_pae: 30,
    ...extras,
  });
}

function predictionRaw(path, text, options = {}) {
  const byteSource = options.byteSource ?? text;
  const bytes = Buffer.from(byteSource);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    text: options.binary ? null : text,
  };
}

function predictionAuditSource(id, path, text) {
  const bytes = Buffer.from(text);
  return {
    id,
    path,
    filename: path.split("/").at(-1),
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    text,
  };
}

function predictionAuditPose(id, coordinate, pae = null, overrides = {}) {
  return {
    id,
    provider: "colabfold",
    poseKey: JSON.stringify(["adversarial", id]),
    variant: "unrelaxed",
    associationBasis: pae == null ? "none" : "exact-native-key",
    coordinate,
    pae,
    ...overrides,
  };
}

function realPose(id, pairs, geometryMarker, filename = `${id}.pdb`) {
  const structure = attestedStructure(id, pairs, geometryMarker);
  const audit = analyzeInterface(
    structure,
    "A",
    "B",
    "none",
    null,
    false,
    canonicalizeSelectedGeometry(structure, "A", "B"),
  );
  return {
    id,
    filename,
    sha256: digest(id),
    bytes: 1_000 + Math.round(geometryMarker * 10),
    structure,
    audit,
  };
}

function atomForSasa(index, x, y, z, element) {
  return {
    serial: index + 1,
    name: `X${index}`,
    residueName: "ALA",
    chainId: "A",
    residueNumber: index + 1,
    insertionCode: "",
    residueKey: `A:${index + 1}`,
    residueOrder: index + 1,
    x,
    y,
    z,
    element,
    bFactor: null,
  };
}

function parseCsv(text) {
  const rows = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      rows.at(-1).push(field);
      field = "";
    } else if (character === "\n") {
      rows.at(-1).push(field);
      rows.push([]);
      field = "";
    } else if (character === "\r") {
      throw new Error("CSV output contains an unescaped carriage return.");
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV output contains an unterminated quoted field.");
  rows.at(-1).push(field);
  return rows;
}

function escapedUnsafeText(value) {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`;
  });
}

function safeCsvFilename(value) {
  const formulaLike = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[=+\-@]/u.test(value);
  const escaped = escapedUnsafeText(value);
  return formulaLike ? `'${escaped}` : escaped;
}

function safeCsvFilenameWithDroppedFormatCharacters(value) {
  const formulaLike = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[=+\-@]/u.test(value);
  const escaped = escapedUnsafeText(value.replace(/\p{Cf}/gu, ""));
  return formulaLike ? `'${escaped}` : escaped;
}

const results = [];

async function suite(name, fn) {
  const started = performance.now();
  const assertionsBefore = assertionCount;
  try {
    const details = await fn();
    results.push({
      name,
      status: "PASS",
      assertions: assertionCount - assertionsBefore,
      milliseconds: +(performance.now() - started).toFixed(1),
      ...details,
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      assertions: assertionCount - assertionsBefore,
      milliseconds: +(performance.now() - started).toFixed(1),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

await suite("proper rigid fits survive randomized rotations and translations", () => {
  let worstRmsd = 0;
  let worstMaximumDeviation = 0;
  for (let trial = 0; trial < 2_000; trial += 1) {
    const count = 8 + integer(24);
    const points = Array.from({ length: count }, () => [
      random() * 80 - 40,
      random() * 80 - 40,
      random() * 80 - 40,
    ]);
    const rotation = axisAngle(
      [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
      random() * Math.PI * 2,
    );
    const scale = choice([1, 10, 1_000, 1_000_000]);
    const translation = [
      random() * scale - scale / 2,
      random() * scale - scale / 2,
      random() * scale - scale / 2,
    ];
    const fit = selectedGeometryFit(
      makeStructure(points),
      "A",
      "B",
      makeStructure(transformPoints(points, rotation, translation)),
      "A",
      "B",
    );
    ok(fit != null, `trial ${trial}: rigid fit unexpectedly unavailable`);
    ok(Number.isFinite(fit.rmsdAngstrom), `trial ${trial}: non-finite RMSD`);
    ok(Number.isFinite(fit.maximumDeviationAngstrom), `trial ${trial}: non-finite maximum deviation`);
    equal(geometryFitIsDuplicate(fit), true, `trial ${trial}: rigid transform was not a duplicate`);
    worstRmsd = Math.max(worstRmsd, fit.rmsdAngstrom);
    worstMaximumDeviation = Math.max(worstMaximumDeviation, fit.maximumDeviationAngstrom);
  }
  return { cases: 2_000, worstRmsd, worstMaximumDeviation };
});

await suite("reflections remain distinct in fits and signed fingerprints", () => {
  let smallestRmsd = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < 500; trial += 1) {
    const points = Array.from({ length: 10 + integer(18) }, () => [
      random() * 30 - 15,
      random() * 30 - 15,
      random() * 30 - 15,
    ]);
    const reflected = points.map(([x, y, z]) => [-x + 17, y - 9, z + 3]);
    const first = makeStructure(points);
    const second = makeStructure(reflected);
    const fit = selectedGeometryFit(first, "A", "B", second, "A", "B");
    ok(fit != null, `trial ${trial}: reflection fit unexpectedly unavailable`);
    equal(geometryFitIsDuplicate(fit), false, `trial ${trial}: reflection treated as a duplicate`);
    notEqual(
      selectedGeometryFingerprint(first, "A", "B"),
      selectedGeometryFingerprint(second, "A", "B"),
      `trial ${trial}: reflection lost by the signed geometry fingerprint`,
    );
    smallestRmsd = Math.min(smallestRmsd, fit.rmsdAngstrom);
  }
  return { cases: 500, smallestRmsd };
});

await suite("geometry and source-coordinate fingerprints have their intended invariants", () => {
  for (let trial = 0; trial < 1_000; trial += 1) {
    const points = Array.from({ length: 10 + integer(16) }, () => [
      random() * 30 - 15,
      random() * 30 - 15,
      random() * 30 - 15,
    ]);
    const rotation = axisAngle(
      [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
      random() * Math.PI * 2,
    );
    const translation = [
      random() * 200_000 - 100_000,
      random() * 200_000 - 100_000,
      random() * 200_000 - 100_000,
    ];
    const source = makeStructure(points);
    const moved = makeStructure(transformPoints(points, rotation, translation));
    equal(
      selectedGeometryFingerprint(source, "A", "B"),
      selectedGeometryFingerprint(moved, "A", "B"),
      `trial ${trial}: SE(3)-invariant fingerprint changed`,
    );
    equal(
      selectedCoordinateFingerprint(source, "A", "B"),
      selectedCoordinateFingerprint(source, "A", "B"),
      `trial ${trial}: source-coordinate fingerprint was not deterministic`,
    );
    const shifted = makeStructure(points.map(([x, y, z]) => [x + 0.002, y, z]));
    notEqual(
      selectedCoordinateFingerprint(source, "A", "B"),
      selectedCoordinateFingerprint(shifted, "A", "B"),
      `trial ${trial}: 0.002 Å source-frame shift was not represented`,
    );
  }
  return { cases: 1_000 };
});

await suite("contact cutoff and spatial grid agree with direct distance oracles", () => {
  let boundaryCases = 0;
  for (let trial = 0; trial < 1_000; trial += 1) {
    const delta = choice([-1e-6, 0, 1e-6]);
    const origin = [random() * 100_000 - 50_000, random() * 100_000 - 50_000, random() * 100_000 - 50_000];
    const direction = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1];
    const length = Math.hypot(...direction) || 1;
    const unit = direction.map((value) => value / length);
    const points = [origin, origin.map((value, index) => value + unit[index] * (4.5 + delta))];
    const observedDistance = Math.hypot(...points[1].map((value, index) => value - origin[index]));
    const audit = analyzeInterface(makeStructure(points, { split: 1 }), "A", "B", "none");
    equal(
      audit.contactPairCount,
      observedDistance <= 4.5 ? 1 : 0,
      `trial ${trial}: cutoff disagreement at ${observedDistance}`,
    );
    boundaryCases += 1;
  }
  equal(
    analyzeInterface(makeStructure([[0, 0, 0], [4.5, 0, 0]], { split: 1 }), "A", "B", "none").contactPairCount,
    1,
    "the exact axial 4.5 Å boundary must be inclusive",
  );

  for (let trial = 0; trial < 200; trial += 1) {
    const receptorCount = 4 + integer(16);
    const vhhCount = 4 + integer(16);
    const points = Array.from({ length: receptorCount + vhhCount }, () => [
      random() * 40 - 20,
      random() * 40 - 20,
      random() * 40 - 20,
    ]);
    const expected = [];
    for (let receptor = 0; receptor < receptorCount; receptor += 1) {
      for (let vhh = 0; vhh < vhhCount; vhh += 1) {
        const distance = Math.hypot(...points[receptor].map(
          (value, axis) => value - points[receptorCount + vhh][axis],
        ));
        if (distance <= 4.5) expected.push(`${receptor + 1}:${vhh + 1}`);
      }
    }
    const audit = analyzeInterface(
      makeStructure(points, { split: receptorCount }),
      "A",
      "B",
      "none",
    );
    const observed = audit.contacts
      .map((contact) => `${contact.receptorResidueOrder}:${contact.vhhResidueOrder}`)
      .sort();
    deepEqual(observed, expected.sort(), `trial ${trial}: grid/oracle contact mismatch`);
  }
  return { cases: boundaryCases + 1 + 200 };
});

await suite("approximate SASA is translation- and side-swap-invariant", () => {
  let worstAbsoluteError = 0;
  for (let trial = 0; trial < 150; trial += 1) {
    const receptor = Array.from({ length: 1 + integer(7) }, (_, index) => atomForSasa(
      index,
      random() * 10,
      random() * 10,
      random() * 10,
      choice(["C", "N", "O", "S", "SE"]),
    ));
    const vhh = Array.from({ length: 1 + integer(7) }, (_, index) => atomForSasa(
      index + 100,
      random() * 10,
      random() * 10,
      random() * 10,
      choice(["C", "N", "O", "S", "SE"]),
    ));
    const base = calculateBuriedSurfaceArea(receptor, vhh);
    const translation = [random() * 100_000, random() * 100_000, random() * 100_000];
    const moved = (atoms) => atoms.map((atom) => ({
      ...atom,
      x: atom.x + translation[0],
      y: atom.y + translation[1],
      z: atom.z + translation[2],
    }));
    const translated = calculateBuriedSurfaceArea(moved(receptor), moved(vhh));
    const swapped = calculateBuriedSurfaceArea(vhh, receptor);
    const error = Math.max(
      Math.abs(base.total - translated.total),
      Math.abs(base.total - swapped.total),
      Math.abs(base.receptor - swapped.vhh),
      Math.abs(base.vhh - swapped.receptor),
    );
    worstAbsoluteError = Math.max(worstAbsoluteError, error);
    ok(error < 1e-6, `trial ${trial}: SASA invariance error ${error}`);
  }
  return { cases: 150, worstAbsoluteError };
});

await suite("PDB fixed-column mutation fuzz fails safely", () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,+-Ee?/\\'\"_#;()\t\r";
  let accepted = 0;
  let rejected = 0;
  for (let trial = 0; trial < 20_000; trial += 1) {
    let line = atomLine({ x: 1, y: 2, z: 3 });
    const edits = 1 + integer(10);
    for (let edit = 0; edit < edits; edit += 1) {
      const index = integer(Math.max(1, line.length));
      if (random() < 0.12) line = line.slice(0, index) + line.slice(index + 1);
      else line = line.slice(0, index) + characters[integer(characters.length)] + line.slice(index + 1);
    }
    try {
      const parsed = parsePdb(`${line}\n${atomLine({ serial: 2, residueNumber: 2, x: 4 })}`);
      for (const atom of parsed.atoms) {
        ok(Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z), `trial ${trial}: non-finite PDB coordinate`);
        ok(
          Math.max(Math.abs(atom.x), Math.abs(atom.y), Math.abs(atom.z)) <= 10_000_000,
          `trial ${trial}: unbounded PDB coordinate`,
        );
      }
      accepted += 1;
    } catch (error) {
      ok(error instanceof Error, `trial ${trial}: parser threw a non-Error value`);
      rejected += 1;
    }
  }
  throws(() => parsePdb(`${atomLine()}\u0000`), /NUL/i);
  return { cases: 20_001, accepted, rejected };
});

await suite("mmCIF token streams and assembly expressions fuzz safely", () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,+-Ee?/\\'\"_#;()\t\r";
  const controls = [
    "loop_", "stop_", "global_", "save_x", "save_", "data_x", "data_y",
    "_atom_site.Cartn_x", "_x.y", "?", ".", "ATOM", "1", "NaN", "Infinity",
    "'quoted value'", "\"double\"",
  ];
  const randomText = (length) => Array.from({ length }, () => characters[integer(characters.length)]).join("");
  let accepted = 0;
  let rejected = 0;
  for (let trial = 0; trial < 10_000; trial += 1) {
    const tokens = ["data_fuzz"];
    const count = 1 + integer(50);
    for (let index = 0; index < count; index += 1) {
      tokens.push(random() < 0.7 ? choice(controls) : randomText(1 + integer(18)));
    }
    try {
      const parsed = parseMmcif(tokens.join(choice([" ", "\n", "\t", "\r\n"])));
      for (const atom of parsed.atoms) {
        ok(Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z), `trial ${trial}: non-finite mmCIF coordinate`);
        ok(
          Math.max(Math.abs(atom.x), Math.abs(atom.y), Math.abs(atom.z)) <= 10_000_000,
          `trial ${trial}: unbounded mmCIF coordinate`,
        );
      }
      accepted += 1;
    } catch (error) {
      ok(error instanceof Error, `trial ${trial}: mmCIF parser threw a non-Error value`);
      rejected += 1;
    }
  }

  const grammar = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ,-() ";
  for (let trial = 0; trial < 20_000; trial += 1) {
    const expression = Array.from(
      { length: 1 + integer(80) },
      () => grammar[integer(grammar.length)],
    ).join("");
    try {
      const tuples = expandOperationExpression(expression);
      ok(tuples.length <= 512, `trial ${trial}: assembly expansion exceeded 512 tuples`);
      for (const tuple of tuples) {
        ok(tuple.length <= 8, `trial ${trial}: assembly expression exceeded eight factors`);
        for (const identifier of tuple) {
          ok(typeof identifier === "string" && identifier.length > 0, `trial ${trial}: invalid operation identifier`);
        }
      }
    } catch (error) {
      ok(error instanceof Error, `trial ${trial}: expression parser threw a non-Error value`);
    }
  }
  return { cases: 30_000, mmcifAccepted: accepted, mmcifRejected: rejected };
});

await suite("valid mmCIF column permutations and operation ranges have exact oracles", () => {
  const entries = Object.entries(CIF_ATOM_FIELDS);
  for (let trial = 0; trial < 500; trial += 1) {
    const permuted = shuffle(entries);
    const parsed = parseMmcif(simpleCif(Object.fromEntries(permuted)));
    equal(parsed.atoms.length, 1, `trial ${trial}: permuted mmCIF lost its atom`);
    equal(parsed.atoms[0].x, 1.25, `trial ${trial}: permuted mmCIF changed x`);
    equal(parsed.atoms[0].y, -2.5, `trial ${trial}: permuted mmCIF changed y`);
    equal(parsed.atoms[0].z, 3.75, `trial ${trial}: permuted mmCIF changed z`);
  }
  for (let trial = 0; trial < 2_000; trial += 1) {
    const firstStart = 1 + integer(8);
    const firstEnd = firstStart + integer(8);
    const secondStart = 20 + integer(8);
    const secondEnd = secondStart + integer(8);
    const expression = `(${firstStart}-${firstEnd})(${secondStart}-${secondEnd})`;
    const expected = [];
    for (let first = firstStart; first <= firstEnd; first += 1) {
      for (let second = secondStart; second <= secondEnd; second += 1) {
        expected.push([String(first), String(second)]);
      }
    }
    deepEqual(expandOperationExpression(expression), expected, `trial ${trial}: Cartesian expansion mismatch`);
  }
  throws(() => expandOperationExpression("(1-513)"), /expansion limit|beyond 512/i);
  throws(() => expandOperationExpression("1".repeat(4_097)), /length/i);
  return { cases: 2_502 };
});

await suite("PAE matrix fuzz rejects nonfinite, negative, and malformed shapes", () => {
  let valid = 0;
  let rejected = 0;
  for (let trial = 0; trial < 500; trial += 1) {
    const size = 1 + integer(24);
    const rows = Array.from(
      { length: size },
      () => Array.from({ length: size }, () => random() * 50),
    );
    const structure = {
      coordinateScope: "as-supplied",
      chains: [{ residueCount: size, residues: Array.from({ length: size }, () => ({})) }],
    };
    const parsed = parsePaeJson(JSON.stringify({ pae: rows, max_pae: 50 }), structure);
    equal(parsed.residueCount, size, `trial ${trial}: PAE dimension changed`);
    ok(parsed.matrix.every(Number.isFinite), `trial ${trial}: parsed PAE contains non-finite values`);
    valid += 1;
  }
  const invalidValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, "3", null, {}, []];
  for (let trial = 0; trial < 1_000; trial += 1) {
    const size = 1 + integer(10);
    const rows = Array.from(
      { length: size },
      () => Array.from({ length: size }, () => random() * 10),
    );
    if (random() < 0.5) rows[integer(size)][integer(size)] = choice(invalidValues);
    else rows[integer(size)].push(3);
    const structure = {
      coordinateScope: "as-supplied",
      chains: [{ residueCount: size, residues: Array.from({ length: size }, () => ({})) }],
    };
    throws(() => parsePaeJson(JSON.stringify({ pae: rows }), structure), Error, `trial ${trial}: malformed PAE was accepted`);
    rejected += 1;
  }
  return { cases: 1_500, valid, rejected };
});

await suite("exact parser ceilings accept the boundary and reject the next item", () => {
  const pdbLines = [];
  let serial = 1;
  for (let residue = 1; residue <= 7_500; residue += 1) {
    for (let atomIndex = 0; atomIndex < 8; atomIndex += 1) {
      pdbLines.push(atomLine({
        serial: serial++,
        atomName: `C${atomIndex.toString(36).padStart(3, "0")}`,
        residueNumber: residue,
        x: residue * 0.01,
        y: atomIndex * 0.01,
      }));
    }
  }
  const exactPdb = pdbLines.join("\n");
  const parsedPdb = parsePdb(exactPdb);
  equal(parsedPdb.atoms.length, 60_000, "PDB did not accept the exact 60,000-heavy-atom ceiling");
  throws(
    () => parsePdb(`${exactPdb}\n${atomLine({ serial, atomName: "C008", residueNumber: 7_501 })}`),
    /more than 60,000 unique protein heavy-atom sites|more than 60,000 protein heavy atoms/i,
  );

  const cifHeaders = [
    "_atom_site.group_PDB", "_atom_site.id", "_atom_site.type_symbol",
    "_atom_site.label_atom_id", "_atom_site.label_comp_id", "_atom_site.label_asym_id",
    "_atom_site.auth_asym_id", "_atom_site.label_seq_id", "_atom_site.auth_seq_id",
    "_atom_site.Cartn_x", "_atom_site.Cartn_y", "_atom_site.Cartn_z",
    "_atom_site.occupancy", "_atom_site.pdbx_PDB_model_num",
  ];
  const cifLines = ["data_large", "loop_", ...cifHeaders];
  for (let index = 0; index < 60_000; index += 1) {
    const residue = Math.floor(index / 8) + 1;
    const atomIndex = index % 8;
    cifLines.push(
      `ATOM ${index + 1} C C${atomIndex.toString(36).padStart(3, "0")} ALA A A ${residue} ${residue} ` +
      `${(residue * 0.01).toFixed(3)} ${(atomIndex * 0.01).toFixed(3)} 0 1 1`,
    );
  }
  const exactCif = cifLines.join("\n");
  const parsedCif = parseMmcif(exactCif);
  equal(parsedCif.atoms.length, 60_000, "mmCIF did not accept the exact 60,000-heavy-atom ceiling");
  throws(
    () => parseMmcif(`${exactCif}\nATOM 60001 C C008 ALA A A 7501 7501 75.010 0.080 0 1 1`),
    /more than 60,000 unique protein heavy-atom sites|beyond 60,000 protein heavy atoms/i,
  );

  const paeSize = 1_500;
  const paeRow = `[${"0,".repeat(paeSize - 1)}0]`;
  const exactPaeText = `{"pae":[${`${paeRow},`.repeat(paeSize - 1)}${paeRow}],"max_pae":0}`;
  const paeStructure = {
    coordinateScope: "as-supplied",
    chains: [{ residueCount: paeSize, residues: Array.from({ length: paeSize }, () => ({})) }],
  };
  const parsedPae = parsePaeJson(exactPaeText, paeStructure, "exact-1500.json");
  equal(parsedPae.residueCount, 1_500, "PAE did not accept the exact 1,500-residue ceiling");
  equal(parsedPae.matrix.length, 2_250_000, "PAE exact-ceiling matrix was not square");
  const excessivePaeRows = `{"pae":[${"[],".repeat(1_500)}[]]}`;
  throws(
    () => parsePaeJson(excessivePaeRows, {
      coordinateScope: "as-supplied",
      chains: [{ residueCount: 1_501, residues: Array.from({ length: 1_501 }, () => ({})) }],
    }),
    /above 1,500|more than 1,500/i,
  );

  const models = [];
  for (let model = 1; model <= 100; model += 1) {
    models.push(`MODEL     ${String(model).padStart(4)}\n${atomLine()}\nENDMDL`);
  }
  equal(parsePdb(models.join("\n")).availableModelIds.length, 100, "PDB did not accept exactly 100 models");
  throws(
    () => parsePdb(`${models.join("\n")}\nMODEL      101\nENDMDL`),
    /more than 100 coordinate models/i,
  );
  return {
    cases: 120_000 + 2_250_000 + 1_501 + 201,
    pdbBytes: exactPdb.length,
    mmcifBytes: exactCif.length,
    paeJsonBytes: exactPaeText.length,
  };
});

await suite("line, container, size, metadata, and identifier bombs fail before unbounded work", () => {
  const exactLineBoundary = `${"\n".repeat(500_000)}${atomLine()}`;
  equal(parsePdb(exactLineBoundary).atoms.length, 1, "PDB rejected the exact 500,000-line-break boundary");
  throws(
    () => parsePdb(`${"\n".repeat(500_001)}${atomLine()}`),
    /bounded line-count limit/i,
  );

  const millionEmptyRows = `{"pae":[${"[],".repeat(999_999)}[]]}`;
  throws(
    () => parsePaeJson(millionEmptyRows, {
      coordinateScope: "as-supplied",
      chains: [{ residueCount: 1, residues: [{}] }],
    }),
    /matrix-row-scale containers|more than 1,500/i,
  );

  const oversized = " ".repeat(16 * 1024 * 1024 + 1);
  throws(() => parsePdb(oversized), /size limit/i);
  throws(() => parseMmcif(oversized), /size limit/i);
  throws(
    () => parsePaeJson(oversized, {
      coordinateScope: "as-supplied",
      chains: [{ residueCount: 1, residues: [{}] }],
    }),
    /size limit/i,
  );

  throws(() => parseMmcif(`data_${"x".repeat(513)}`), /data-block name.*identifier-length/i);
  throws(
    () => parseMmcif(`data_x\n_${"x".repeat(512)} 1`),
    /data name.*identifier-length/i,
  );
  throws(
    () => parseMmcif(simpleCif({ ...CIF_ATOM_FIELDS, "_atom_site.label_asym_id": "A".repeat(257) })),
    /identifier-length limit of 256/i,
  );
  throws(
    () => parseMmcif(simpleCif({ ...CIF_ATOM_FIELDS, "_atom_site.label_atom_id": "C".repeat(65) })),
    /identifier-length limit of 64/i,
  );
  throws(
    () => parseMmcif(simpleCif(CIF_ATOM_FIELDS), { assemblyId: "A".repeat(257) }),
    /identifier-length limit of 256/i,
  );

  const scalarBomb = ["data_scalar_bomb"];
  for (let index = 0; index <= 20_000; index += 1) scalarBomb.push(`_bomb.item_${index} 1`);
  throws(() => parseMmcif(scalarBomb.join("\n")), /distinct data-name limit|scalar-item limit/i);

  const loopHeaders = Array.from({ length: 257 }, (_, index) => `_bomb.item_${index}`);
  throws(
    () => parseMmcif(`data_loop_bomb\nloop_\n${loopHeaders.join("\n")}\n${loopHeaders.map(() => "1").join(" ")}`),
    /exceeds 256 columns/i,
  );

  const denseA = Array.from({ length: 5_100 }, (_, index) => atomForSasa(index, index * 0.0001, 0, 0, "C"));
  const denseB = Array.from({ length: 5_100 }, (_, index) => atomForSasa(index + 10_000, index * 0.0001, 0.001, 0, "C"));
  throws(
    () => calculateBuriedSurfaceArea(denseA, denseB),
    /candidate-distance checks|candidate-distance budget/i,
  );
  return { cases: 14, millionRowBombBytes: millionEmptyRows.length };
});

const ensembleFixtures = [
  realPose("pose-a", [[1, 1], [2, 2], [3, 3], [4, 4]], 1.2),
  realPose("pose-b", [[1, 1], [2, 2], [3, 3], [5, 5]], 2.8),
  realPose("pose-c", [[1, 1], [2, 2], [3, 3], [6, 6]], 4.4),
  realPose("pose-d", [[1, 1], [2, 2], [7, 7]], 6.0),
  realPose("pose-e", [[8, 8], [9, 9], [10, 10]], 7.6),
  realPose("pose-f", [[1, 1], [2, 2], [3, 3], [4, 4]], 9.2),
];

await suite("ensemble summaries are invariant across seeded upload permutations", () => {
  const baseline = summarizePoseEnsemble(ensembleFixtures).poses.map((pose) => ({
    id: pose.id,
    rank: pose.rank,
    contactPairConsensus: pose.contactPairConsensus,
    receptorEpitopeConsensus: pose.receptorEpitopeConsensus,
    vhhParatopeConsensus: pose.vhhParatopeConsensus,
    ensembleConsensus: pose.ensembleConsensus,
    recurrentContactShare: pose.recurrentContactShare,
  }));
  for (let trial = 0; trial < 500; trial += 1) {
    const observed = summarizePoseEnsemble(shuffle(ensembleFixtures)).poses.map((pose) => ({
      id: pose.id,
      rank: pose.rank,
      contactPairConsensus: pose.contactPairConsensus,
      receptorEpitopeConsensus: pose.receptorEpitopeConsensus,
      vhhParatopeConsensus: pose.vhhParatopeConsensus,
      ensembleConsensus: pose.ensembleConsensus,
      recurrentContactShare: pose.recurrentContactShare,
    }));
    deepEqual(observed, baseline, `trial ${trial}: upload order changed the ensemble result`);
  }
  return { cases: 500, posesPerCase: ensembleFixtures.length };
});

await suite("Jaccard properties hold over randomized sets", () => {
  for (let trial = 0; trial < 25_000; trial += 1) {
    const first = new Set();
    const second = new Set();
    for (let value = 0; value < 32; value += 1) {
      if (random() < 0.3) first.add(String(value));
      if (random() < 0.3) second.add(String(value));
    }
    const observed = jaccardIndex(first, second);
    equal(observed, jaccardIndex(second, first), `trial ${trial}: Jaccard was asymmetric`);
    if (!first.size && !second.size) {
      equal(observed, null, `trial ${trial}: two empty sets were not null`);
    } else {
      const intersection = [...first].filter((value) => second.has(value)).length;
      const union = new Set([...first, ...second]).size;
      equal(observed, intersection / union, `trial ${trial}: Jaccard oracle mismatch`);
      ok(observed >= 0 && observed <= 1, `trial ${trial}: Jaccard outside [0,1]`);
    }
  }
  return { cases: 25_000 };
});

await suite("state-pair reversal preserves overlaps and negates signed deltas", () => {
  for (let trial = 0; trial < 200; trial += 1) {
    let firstIndex = integer(ensembleFixtures.length);
    let secondIndex = integer(ensembleFixtures.length - 1);
    if (secondIndex >= firstIndex) secondIndex += 1;
    const first = { ...ensembleFixtures[firstIndex], label: choice(["neutral", "active", "inactive"]) };
    const second = { ...ensembleFixtures[secondIndex], label: choice(["neutral", "active", "inactive"]) };
    const forward = summarizeStatePair(first, second);
    const reverse = summarizeStatePair(second, first);
    deepEqual(reverse.similarity, forward.similarity, `trial ${trial}: reversal changed overlap metrics`);
    for (const key of Object.keys(forward.deltas)) {
      const forwardValue = forward.deltas[key];
      const reverseValue = reverse.deltas[key];
      if (forwardValue == null) equal(reverseValue, null, `trial ${trial}: ${key} nullness changed`);
      else ok(Math.abs(forwardValue + reverseValue) < 1e-9, `trial ${trial}: ${key} did not negate`);
    }
    equal(
      forward.contacts.shared.length + forward.contacts.referenceOnly.length,
      forward.reference.audit.contactPairCount,
      `trial ${trial}: reference contact partition did not reconcile`,
    );
    equal(
      forward.contacts.shared.length + forward.contacts.comparisonOnly.length,
      forward.comparison.audit.contactPairCount,
      `trial ${trial}: comparison contact partition did not reconcile`,
    );
  }
  return { cases: 400 };
});

await suite("CSV exports neutralize formula prefixes, controls, separators, and format characters", () => {
  const payloads = [
    "=1+1", "+SUM(A1)", "-2+3", "@SUM(1)", " =1", "\t=1", "\r=1", "\n=1",
    "\uFEFF=1", "\u200B=1", "\u2060+1", "\u202A@1", "\u0000=1", "\u001f-1",
    "name\u2028part", "name\u2029part", "name\u200Bpart", "comma,name", "quote\"name",
  ];
  for (const payload of payloads) {
    const expectedFilenames = new Set([
      safeCsvFilename(payload),
      safeCsvFilenameWithDroppedFormatCharacters(payload),
    ]);
    const first = { ...ensembleFixtures[0], filename: payload };
    const second = ensembleFixtures[1];
    const ensembleRows = parseCsv(poseEnsembleToCsv(summarizePoseEnsemble([first, second])));
    const ensembleFilenameIndex = ensembleRows[0].indexOf("filename");
    ok(ensembleFilenameIndex >= 0, "ensemble CSV omitted its filename column");
    for (const row of ensembleRows) equal(row.length, ensembleRows[0].length, "ensemble CSV row width changed");
    const ensembleFilenames = ensembleRows.slice(1).map((row) => row[ensembleFilenameIndex]);
    ok(
      ensembleFilenames.some((filename) => expectedFilenames.has(filename)),
      `ensemble CSV did not safely preserve ${JSON.stringify(payload)}; observed ${JSON.stringify(ensembleFilenames)}`,
    );

    const reference = { ...ensembleFixtures[2], filename: payload, label: "active" };
    const comparison = { ...ensembleFixtures[3], label: "inactive" };
    const stateRows = parseCsv(statePairToCsv(summarizeStatePair(reference, comparison)));
    const stateFilenameIndex = stateRows[0].indexOf("filename");
    ok(stateFilenameIndex >= 0, "state CSV omitted its filename column");
    for (const row of stateRows) equal(row.length, stateRows[0].length, "state CSV row width changed");
    const stateFilenames = stateRows.slice(1).map((row) => row[stateFilenameIndex]);
    ok(
      stateFilenames.some((filename) => expectedFilenames.has(filename)),
      `state CSV did not safely preserve ${JSON.stringify(payload)}; observed ${JSON.stringify(stateFilenames)}`,
    );

    for (const [kind, rows] of [["ensemble", ensembleRows], ["state", stateRows]]) {
      for (const row of rows) {
        for (const cell of row) {
          ok(
            !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(cell),
            `${kind} CSV retained a raw control/format/separator character for ${JSON.stringify(payload)}`,
          );
        }
      }
    }
  }
  return { cases: payloads.length * 2, payloads: payloads.length };
});

await suite("attestations reject stale coordinates and coherently shaped result tampering", () => {
  const mutations = [
    ["contactPairCount", (pose) => { pose.audit.contactPairCount += 1; }],
    ["atomContactCount", (pose) => { pose.audit.atomContactCount += 1; }],
    ["deltaSasaAngstrom2", (pose) => {
      pose.audit.deltaSasaAngstrom2 += 2;
      pose.audit.receptorBuriedSurfaceAreaAngstrom2 += 1;
      pose.audit.vhhBuriedSurfaceAreaAngstrom2 += 1;
      pose.audit.halfDeltaSasaInterfaceAreaAngstrom2 += 1;
    }],
    ["method description", (pose) => { pose.audit.methods.sasaRadii += " tampered"; }],
    ["finding text", (pose) => { pose.audit.findings[0].evidence += " tampered"; }],
    ["contact label", (pose) => {
      if (pose.audit.contacts.length) pose.audit.contacts[0].receptorResidue += " tampered";
    }],
    ["source coordinate", (pose) => {
      pose.structure.chains[0].residues[0].atoms[0].x += 0.5;
      pose.structure.atoms[0].x += 0.5;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const tampered = structuredClone(ensembleFixtures[0]);
    mutate(tampered);
    throws(
      () => summarizePoseEnsemble([tampered, ensembleFixtures[1]]),
      Error,
      `${label} tampering was accepted`,
    );
  }
  const sourceFrame = attestedStructure("source-frame", [[1, 1], [2, 2]], 12.4);
  const sourceAudit = analyzeInterface(sourceFrame, "A", "B", "none");
  throws(
    () => summarizePoseEnsemble([
      {
        id: "source-frame",
        filename: "source-frame.pdb",
        sha256: digest("source-frame"),
        bytes: 1_124,
        structure: sourceFrame,
        audit: sourceAudit,
      },
      ensembleFixtures[1],
    ]),
    /canonical SASA frame|deterministic/i,
  );
  return { cases: mutations.length + 1 };
});

await suite("product contact filters and CSV remain deterministic across randomized ledgers", () => {
  const evidenceTypes = [
    "severe vdW overlap",
    "potential polar contact",
    "salt-bridge proxy",
    "possible interchain disulfide",
    "close contact",
  ];
  const regions = ["CDR1-IMGT", "CDR2-IMGT", "CDR3-IMGT", "FR1-IMGT", "Unnumbered"];
  const evidenceFilters = [
    ["all", null],
    ["severe-overlap", "severe vdW overlap"],
    ["polar", "potential polar contact"],
    ["salt-bridge", "salt-bridge proxy"],
    ["disulfide", "possible interchain disulfide"],
    ["close-contact", "close contact"],
  ];
  let contactCases = 0;
  for (let trial = 0; trial < 5_000; trial += 1) {
    const count = 1 + integer(40);
    const contacts = Array.from({ length: count }, (_, index) => {
      const evidence = evidenceTypes[(index + trial) % evidenceTypes.length];
      const region = regions[(index * 3 + trial) % regions.length];
      return {
        receptorResidue: `ALA R:${index + 1}`,
        receptorResidueName: "ALA",
        receptorResidueOrder: index + 1,
        vhhResidue: `SER V:${count - index}`,
        vhhResidueName: "SER",
        vhhResidueOrder: count - index,
        vhhImgtPosition: String(count - index),
        vhhRegion: region,
        minimumDistance: 1 + random() * 3.5,
        contactTypes: [evidence],
        receptorConfidence: null,
        vhhConfidence: null,
      };
    });
    const [evidence, expectedType] = choice(evidenceFilters);
    const regionFilter = choice(["all", "CDR1-IMGT", "CDR2-IMGT", "CDR3-IMGT", "framework", "Unnumbered"]);
    const sort = choice(["distance", "receptor-order", "vhh-order"]);
    const observed = filterAuditContacts(contacts, { query: "", evidence, region: regionFilter, sort });
    const expected = contacts.filter((contact) => {
      const evidenceMatch = expectedType == null || contact.contactTypes.includes(expectedType);
      const regionMatch = regionFilter === "all" ||
        (regionFilter === "framework" ? contact.vhhRegion.startsWith("FR") : contact.vhhRegion === regionFilter);
      return evidenceMatch && regionMatch;
    });
    const comparator = sort === "receptor-order"
      ? (left, right) => left.receptorResidueOrder - right.receptorResidueOrder || left.vhhResidueOrder - right.vhhResidueOrder
      : sort === "vhh-order"
        ? (left, right) => left.vhhResidueOrder - right.vhhResidueOrder || left.receptorResidueOrder - right.receptorResidueOrder
        : (left, right) => left.minimumDistance - right.minimumDistance || left.receptorResidueOrder - right.receptorResidueOrder || left.vhhResidueOrder - right.vhhResidueOrder;
    expected.sort(comparator);
    deepEqual(
      observed.map((contact) => [contact.receptorResidueOrder, contact.vhhResidueOrder]),
      expected.map((contact) => [contact.receptorResidueOrder, contact.vhhResidueOrder]),
      `trial ${trial}: filtered contact ledger diverged from independent oracle`,
    );
    const csv = auditContactsToCsv(observed);
    equal(csv.split("\r\n").length, observed.length + 1, `trial ${trial}: contact CSV row count drifted`);
    ok(!/[\p{Cf}\p{Zl}\p{Zp}]/u.test(csv), `trial ${trial}: contact CSV retained an invisible formatter`);
    contactCases += count;
  }
  return { cases: contactCases, trials: 5_000 };
});

await suite("directional PAE display bins match an independent randomized oracle", () => {
  let sampledCells = 0;
  for (let trial = 0; trial < 2_000; trial += 1) {
    const ballastCount = integer(4);
    const receptorCount = 1 + integer(12);
    const vhhCount = 1 + integer(12);
    const residueCount = ballastCount + receptorCount + vhhCount;
    const matrix = new Float32Array(residueCount * residueCount);
    let maximum = 0;
    for (let index = 0; index < matrix.length; index += 1) {
      matrix[index] = random() * 35;
      maximum = Math.max(maximum, matrix[index]);
    }
    const structure = {
      chains: [
        ...(ballastCount ? [{ id: "X", residueCount: ballastCount }] : []),
        { id: "R", residueCount: receptorCount },
        { id: "V", residueCount: vhhCount },
      ],
    };
    const pae = {
      matrix,
      residueCount,
      maxPaeAngstrom: maximum,
      sourceFormat: "raw matrix",
      filename: "random.json",
    };
    const maximumColumns = 1 + integer(vhhCount);
    const maximumRows = 1 + integer(receptorCount);
    const sample = createPaeCrossBlockSample(
      pae,
      structure,
      "R",
      "V",
      maximumColumns,
      maximumRows,
    );
    for (let y = 0; y < sample.height; y += 1) {
      const receptorStart = Math.floor(y * receptorCount / sample.height);
      const receptorEnd = Math.max(receptorStart + 1, Math.floor((y + 1) * receptorCount / sample.height));
      for (let x = 0; x < sample.width; x += 1) {
        const vhhStart = Math.floor(x * vhhCount / sample.width);
        const vhhEnd = Math.max(vhhStart + 1, Math.floor((x + 1) * vhhCount / sample.width));
        let forward = 0;
        let reverse = 0;
        let count = 0;
        for (let receptor = receptorStart; receptor < receptorEnd; receptor += 1) {
          for (let vhh = vhhStart; vhh < vhhEnd; vhh += 1) {
            forward += matrix[(ballastCount + receptor) * residueCount + ballastCount + receptorCount + vhh];
            reverse += matrix[(ballastCount + receptorCount + vhh) * residueCount + ballastCount + receptor];
            count += 1;
          }
        }
        const output = y * sample.width + x;
        ok(Math.abs(sample.receptorFrameToVhh[output] - forward / count) <= 2e-6, `trial ${trial}: forward PAE bin drifted`);
        ok(Math.abs(sample.vhhFrameToReceptor[output] - reverse / count) <= 2e-6, `trial ${trial}: reverse PAE bin drifted`);
        sampledCells += 2;
      }
    }
  }
  return { cases: sampledCells, trials: 2_000 };
});

await suite("user-defined receptor footprints map exactly under randomized inventories", () => {
  let identifiers = 0;
  for (let trial = 0; trial < 5_000; trial += 1) {
    const residueCount = 1 + integer(80);
    const residues = Array.from({ length: residueCount }, (_, index) => ({
      key: `R:${index + 1}`,
      chainId: "R",
      name: "ALA",
      number: index + 1,
      insertionCode: "",
      order: index + 1,
      oneLetter: "A",
      atoms: [],
    }));
    const contacted = new Set(residues.filter(() => random() < 0.35).map((residue) => residue.key));
    const requested = [];
    const expectedMapped = new Set();
    const expectedContacted = new Set();
    const requestCount = integer(Math.min(30, residueCount) + 1);
    for (let index = 0; index < requestCount; index += 1) {
      if (random() < 0.8) {
        const residue = choice(residues);
        const token = random() < 0.5 ? residue.key : String(residue.number);
        requested.push(token);
        expectedMapped.add(residue.key);
        if (contacted.has(residue.key)) expectedContacted.add(residue.key);
      } else {
        requested.push(`R:${residueCount + 1 + integer(100)}`);
      }
    }
    const summary = analyzeIntendedFootprint(
      { chains: [{ id: "R", residueCount, residues }] },
      "R",
      { receptorChain: "R", receptorInterfaceKeys: [...contacted] },
      requested.join(","),
    );
    equal(summary.mappedCount, expectedMapped.size, `trial ${trial}: mapped intended-footprint count drifted`);
    equal(summary.contactedCount, expectedContacted.size, `trial ${trial}: contacted intended-footprint count drifted`);
    deepEqual(
      summary.observedReceptorFootprint.map((entry) => entry.residueKey),
      residues.filter((residue) => contacted.has(residue.key)).map((residue) => residue.key),
      `trial ${trial}: observed receptor footprint changed order or membership`,
    );
    ok(/not specificity/i.test(summary.interpretation), `trial ${trial}: footprint claim boundary disappeared`);
    identifiers += requested.length;
  }
  return { cases: identifiers, trials: 5_000 };
});

await suite("notebook and dossier product records round-trip without scientific input persistence", () => {
  const pose = realPose("product-record", [[1, 1], [2, 2], [3, 3]], 13.7);
  let notebook = [];
  for (let trial = 0; trial < 1_000; trial += 1) {
    const coordinateSha256 = digest(`product-record-${trial}`);
    const workflow = {
      paeAttached: false,
      ensemblePoseCount: 1,
      pairedContextCompared: false,
    };
    const context = {
      studyName: `Study ${trial}`,
      receptorName: "ADRB2",
      candidateId: `VHH-${trial}`,
      coordinateContext: trial % 2 ? "comparison" : "reference",
      intendedFootprint: "",
      notes: "Derived-summary adversarial round-trip.",
    };
    const savedAt = new Date(Date.UTC(2026, 7, 27) + trial).toISOString();
    const singleAuditReport = createSingleAuditExportReport({
      filename: `candidate-${trial}.pdb`,
      coordinateSha256,
      coordinateBytes: pose.bytes,
      structure: pose.structure,
      receptorChain: "A",
      vhhChain: "B",
      chainIdentityConfirmed: true,
      pae: null,
      paeSha256: null,
      paeOrderConfirmed: false,
      audit: pose.audit,
      generatedAt: savedAt,
    });
    const entry = createNotebookEntry({ singleAuditReport, context, workflow, savedAt });
    notebook = upsertNotebookEntry(notebook, entry);
    ok(notebook.length <= 40, `trial ${trial}: notebook exceeded its record cap`);
    ok(!JSON.stringify(entry).includes('"rawCoordinatesAutomaticallyCopied":true'), `trial ${trial}: notebook claimed automatic raw-coordinate persistence`);
    const notebookExport = createNotebookExport(notebook, savedAt);
    deepEqual(parseNotebookExport(JSON.stringify(notebookExport)), notebook, `trial ${trial}: notebook round-trip drifted`);

    const bundle = createWorkspaceBundle({
      context,
      singleAuditReport,
      generatedAt: savedAt,
    });
    deepEqual(parseWorkspaceBundle(JSON.stringify(bundle)), bundle, `trial ${trial}: workspace dossier round-trip drifted`);
  }
  return { cases: 2_000, trials: 1_000 };
});

await suite("chain suggestions are independent of top-level chain order", () => {
  for (let trial = 0; trial < 100; trial += 1) {
    const points = [];
    for (let index = 0; index < 40; index += 1) points.push([index, 0, 0]);
    for (let index = 0; index < 25; index += 1) points.push([index, 3, 0]);
    const structure = makeStructure(points, { split: 40 });
    const expected = suggestChains(structure);
    const reordered = { ...structure, chains: shuffle(structure.chains) };
    deepEqual(suggestChains(reordered), expected, `trial ${trial}: chain ordering changed suggestion`);
  }
  return { cases: 100 };
});

await suite("prediction-run manifests are invariant across seeded FileList permutations", () => {
  const files = [];
  for (let model = 0; model < 4; model += 1) {
    const prefix = `bundle-${model}/fold_candidate_${model}`;
    files.push(
      predictionRaw(`${prefix}_model_0.pdb`, predictionCoordinate(model, `MODEL ${model}`)),
      predictionRaw(`${prefix}_full_data_0.json`, predictionPaeText(4, model)),
      predictionRaw(
        `${prefix}_summary_confidences_0.json`,
        JSON.stringify({ ptm: 0.7 + model * 0.01, ranking_confidence: 0.8 }),
      ),
    );
  }
  const baseline = predictionRunManifestForExport(createPredictionRunManifest(files));
  equal(baseline.files.length, 12, "prediction-run permutation fixture did not retain twelve files");
  equal(baseline.poses.length, 4, "prediction-run permutation fixture did not retain four poses");
  for (let trial = 0; trial < 20_000; trial += 1) {
    const actual = predictionRunManifestForExport(createPredictionRunManifest(shuffle(files)));
    deepEqual(actual, baseline, `trial ${trial}: upload order changed the canonical run manifest`);
  }
  return { cases: 240_000, trials: 20_000, filesPerTrial: files.length };
});

await suite("prediction-run path normalization rejects hostile and colliding names deterministically", () => {
  for (let trial = 0; trial < 40_000; trial += 1) {
    equal(
      normalizePredictionRunPath(`run-${trial}\\seed\\pose-${trial}.pdb`),
      `run-${trial}/seed/pose-${trial}.pdb`,
      `trial ${trial}: safe relative path normalization drifted`,
    );
  }
  const hostile = [
    (trial) => `../pose-${trial}.pdb`,
    (trial) => `/absolute-${trial}.pdb`,
    (trial) => `C:\\absolute-${trial}.pdb`,
    (trial) => `run-${trial}//pose.pdb`,
    (trial) => `run-${trial}/./pose.pdb`,
    (trial) => `run-${trial}/pose\u0000.pdb`,
    (trial) => `run-${trial}/pose\u202epdb`,
    (trial) => `run-${trial}/${"x".repeat(256)}.pdb`,
  ];
  for (let trial = 0; trial < 50_000; trial += 1) {
    throws(
      () => normalizePredictionRunPath(hostile[trial % hostile.length](trial)),
      Error,
      `trial ${trial}: hostile prediction-run path was accepted`,
    );
  }
  const coordinate = predictionCoordinate();
  for (let trial = 0; trial < 10_000; trial += 1) {
    throws(
      () => createPredictionRunManifest([
        predictionRaw(`Run-${trial}/Pose.pdb`, coordinate),
        predictionRaw(`run-${trial}/pose.PDB`, `${coordinate}\nREMARK collision ${trial}`),
      ]),
      /duplicate|collid/i,
      `trial ${trial}: normalization-colliding paths were accepted`,
    );
  }
  return { cases: 100_000, safe: 40_000, hostile: 50_000, collisions: 10_000 };
});

await suite("prediction-run content sniffing rejects disguises, binary PAE, and polyglot-like inputs", () => {
  const base = predictionRaw("base/reference.pdb", predictionCoordinate());
  const cases = [
    () => ({ probe: predictionRaw("probe/second.pdb", predictionCoordinate(2)), expected: "coordinate" }),
    () => ({ probe: predictionRaw("probe/disguised.pdb", "{\"pae\":[[0]]}"), expected: "rejected" }),
    () => ({ probe: predictionRaw("probe/scores.json", predictionPaeText()), expected: "pae-json" }),
    () => ({ probe: predictionRaw("probe/truncated.json", "{\"pae\":[[0]]"), expected: "rejected" }),
    () => ({ probe: predictionRaw("probe/confidence_probe_model_0.json", "{\"confidence_score\":0.8}"), expected: "confidence-json" }),
    () => ({ probe: predictionRaw("probe/ranking_debug.json", "{\"order\":[\"model_1\"]}"), expected: "ranking-metadata" }),
    () => ({
      probe: predictionRaw("predictions/probe/pae_probe_model_0.npz", null, { binary: true, byteSource: "PK\\x03\\x04NPZ" }),
      expected: "unsupported-pae",
    }),
    () => ({ probe: predictionRaw("probe/unknown.txt", "ATOM      1"), expected: "unsupported" }),
    () => ({ probe: predictionRaw("probe/disguised.cif", "data_x\n{\"pae\":[[0]]}"), expected: "rejected" }),
    () => ({ probe: predictionRaw("probe/auxiliary.json", "{\"notes\":\"ATOM data_ pae\"}"), expected: "auxiliary-json" }),
  ];
  for (let trial = 0; trial < 50_000; trial += 1) {
    const { probe, expected } = cases[trial % cases.length]();
    const manifest = createPredictionRunManifest([base, probe]);
    const record = manifest.files.find((file) => file.path === probe.path);
    equal(record?.kind, expected, `trial ${trial}: content classification changed for ${probe.path}`);
  }
  return { cases: 50_000, categories: cases.length };
});

await suite("native prediction pairing agrees with an independent exact-key graph oracle", () => {
  let poseCases = 0;
  for (let trial = 0; trial < 10_000; trial += 1) {
    const files = [];
    const expectedPaeCounts = [];
    for (let poseIndex = 0; poseIndex < 5; poseIndex += 1) {
      const name = `case_${trial}_${poseIndex}`;
      const directory = `run-${trial % 17}`;
      files.push(predictionRaw(
        `${directory}/fold_${name}_model_0.pdb`,
        predictionCoordinate(poseIndex, `PAIR ${trial} ${poseIndex}`),
      ));
      const paeCount = integer(2);
      expectedPaeCounts.push(paeCount);
      if (paeCount >= 1) {
        files.push(predictionRaw(
          `${directory}/fold_${name}_full_data_0.json`,
          predictionPaeText(4, trial + poseIndex),
        ));
      }
    }
    const manifest = createPredictionRunManifest(shuffle(files));
    for (const pose of manifest.poses) {
      const coordinate = manifest.files.find((file) => file.id === pose.coordinateFileId);
      const match = /case_\d+_(\d+)_model_0/iu.exec(coordinate?.filename ?? "");
      const expectedCount = match == null ? -1 : expectedPaeCounts[Number(match[1])];
      ok(
        expectedCount === 1
          ? pose.status === "ready" && pose.associationBasis === "exact-native-key" && pose.paeFileId != null
          : pose.status === "needs-review" && pose.associationBasis === "unresolved" && pose.paeFileId == null,
        `trial ${trial}: exact-key graph oracle disagreed for ${coordinate?.filename}`,
      );
      poseCases += 1;
    }
  }
  equal(poseCases, 50_000, "pairing graph suite did not exercise the planned pose count");
  return { cases: poseCases, trials: 10_000, posesPerTrial: 5 };
});

await suite("prediction PAE JSON fuzz rejects structural bombs before scientific attachment", () => {
  const structure = parsePdb(predictionCoordinate());
  const baseCoordinate = predictionRaw("base/reference.pdb", predictionCoordinate());
  const deepBomb = `${'{"x":'.repeat(129)}0${"}".repeat(129)}`;
  const validPae = predictionPaeText(4, 3);
  const validPredicted = JSON.stringify({
    predicted_aligned_error: predictionMatrix(4, 5),
    max_predicted_aligned_error: 30,
  });
  const malformedManifestPayloads = ["{\"pae\":[[0]]", deepBomb];
  const invalidAttachmentPayloads = [
    JSON.stringify({ pae: [[0, 1], [1]] }),
    JSON.stringify({ pae: [[0, -1], [1, 0]] }),
    JSON.stringify({ pae: predictionMatrix(4), predicted_aligned_error: predictionMatrix(4) }),
    predictionPaeText(3),
  ];
  for (let trial = 0; trial < 80_000; trial += 1) {
    const category = trial % 8;
    if (category < 2) {
      const text = category === 0 ? validPae : validPredicted;
      const extracted = extractNativePredictionPae(
        predictionAuditSource(`valid-${trial}`, `run/valid-${trial}.json`, text),
        structure,
      );
      equal(extracted.pae.residueCount, 4, `trial ${trial}: valid native PAE dimension drifted`);
      continue;
    }
    if (category < 4) {
      const probe = predictionRaw(
        `probe/malformed-${trial}.json`,
        malformedManifestPayloads[category - 2],
      );
      const manifest = createPredictionRunManifest([baseCoordinate, probe]);
      equal(
        manifest.files.find((file) => file.path === probe.path)?.kind,
        "rejected",
        `trial ${trial}: malformed JSON passed the bounded manifest scan`,
      );
      continue;
    }
    const text = invalidAttachmentPayloads[category - 4];
    throws(
      () => extractNativePredictionPae(
        predictionAuditSource(`invalid-${trial}`, `run/invalid-${trial}.json`, text),
        structure,
      ),
      Error,
      `trial ${trial}: malformed PAE attachment was accepted`,
    );
  }
  return { cases: 80_000, categories: 8 };
});

await suite("native PAE token metadata maps exact, permuted, manual, and conflicting orders", () => {
  const structure = parsePdb(predictionCoordinate());
  const expectedChains = ["A", "A", "B", "B"];
  const expectedResidues = [1, 2, 1, 2];
  for (let trial = 0; trial < 75_000; trial += 1) {
    const matrix = predictionMatrix(4, trial);
    let text;
    if (trial < 20_000) {
      text = JSON.stringify({
        pae: matrix,
        max_pae: 30,
        token_chain_ids: expectedChains,
        token_res_ids: expectedResidues,
      });
      const extracted = extractNativePredictionPae(
        predictionAuditSource(`identity-${trial}`, `run/identity-${trial}.json`, text),
        structure,
      );
      equal(extracted.mapping.basis, "token-residue-metadata-verified", `trial ${trial}: exact token metadata was not verified`);
      deepEqual(extracted.mapping.sourceIndexMap, [0, 1, 2, 3], `trial ${trial}: exact token order changed`);
      continue;
    }
    if (trial < 40_000) {
      const permutation = shuffle([0, 1, 2, 3]);
      const tokenChains = permutation.map((index) => expectedChains[index]);
      const tokenResidues = permutation.map((index) => expectedResidues[index]);
      text = JSON.stringify({
        pae: matrix,
        max_pae: 30,
        token_chain_ids: tokenChains,
        token_res_ids: tokenResidues,
      });
      const extracted = extractNativePredictionPae(
        predictionAuditSource(`permuted-${trial}`, `run/permuted-${trial}.json`, text),
        structure,
      );
      const expectedMap = [0, 1, 2, 3].map((index) => permutation.indexOf(index));
      deepEqual(extracted.mapping.sourceIndexMap, expectedMap, `trial ${trial}: token permutation mapping drifted`);
      equal(
        extracted.pae.matrix[0],
        Math.fround(matrix[expectedMap[0]][expectedMap[0]]),
        `trial ${trial}: token-remapped PAE matrix did not follow its verified axes`,
      );
      continue;
    }
    if (trial < 60_000) {
      text = JSON.stringify({ pae: matrix, max_pae: 30 });
      const extracted = extractNativePredictionPae(
        predictionAuditSource(`manual-${trial}`, `run/manual-${trial}.json`, text),
        structure,
      );
      equal(
        extracted.mapping.basis,
        "researcher-confirmed-complete-protein-order",
        `trial ${trial}: dimension-only PAE was mislabeled as metadata-verified`,
      );
      continue;
    }
    text = JSON.stringify({
      pae: matrix,
      max_pae: 30,
      token_chain_ids: ["A", "A", "A", "A"],
      token_res_ids: [1, 1, 1, 1],
    });
    throws(
      () => extractNativePredictionPae(
        predictionAuditSource(`conflict-${trial}`, `run/conflict-${trial}.json`, text),
        structure,
      ),
      /map uniquely|conflicts/i,
      `trial ${trial}: conflicting equal-dimension token metadata was accepted`,
    );
  }
  return {
    cases: 75_000,
    exact: 20_000,
    permuted: 20_000,
    researcherConfirmed: 20_000,
    rejected: 15_000,
  };
});

await suite("directional per-pose PAE summaries obey transpose and joint-order metamorphisms", () => {
  const structure = parsePdb(predictionCoordinate());
  const audit = analyzeInterface(structure, "A", "B", "none");
  ok(audit.contacts.length > 0, "directional PAE fixture has no coordinate-defined contacts");
  const chainPermutation = [2, 3, 0, 1];
  const swappedStructure = { ...structure, chains: [...structure.chains].reverse() };
  const makePae = (matrix) => ({
    matrix,
    residueCount: 4,
    maxPaeAngstrom: 60,
    sourceFormat: "pae matrix",
    filename: "metamorphic.json",
  });
  for (let trial = 0; trial < 50_000; trial += 1) {
    const matrix = new Float32Array(16);
    for (let index = 0; index < matrix.length; index += 1) {
      matrix[index] = Math.fround((integer(5_000) + index * 17) / 100);
    }
    const base = summarizeContactPae(structure, "A", "B", audit.contacts, makePae(matrix));
    ok(
      base.receptorFrameToVhhPaeMedianAngstrom != null &&
      base.vhhFrameToReceptorPaeMedianAngstrom != null &&
      base.interfacePaeMedianAngstrom != null,
      `trial ${trial}: base directional PAE summary is incomplete`,
    );

    const transposed = new Float32Array(16);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        transposed[row * 4 + column] = matrix[column * 4 + row];
      }
    }
    const transposeSummary = summarizeContactPae(
      structure,
      "A",
      "B",
      audit.contacts,
      makePae(transposed),
    );
    deepEqual(
      {
        forward: transposeSummary.receptorFrameToVhhPaeMedianAngstrom,
        reverse: transposeSummary.vhhFrameToReceptorPaeMedianAngstrom,
        conservative: transposeSummary.interfacePaeMedianAngstrom,
      },
      {
        forward: base.vhhFrameToReceptorPaeMedianAngstrom,
        reverse: base.receptorFrameToVhhPaeMedianAngstrom,
        conservative: base.interfacePaeMedianAngstrom,
      },
      `trial ${trial}: transposition did not swap directional PAE while preserving conservative PAE`,
    );

    const reversedContacts = summarizeContactPae(
      structure,
      "A",
      "B",
      [...audit.contacts].reverse(),
      makePae(matrix),
    );
    deepEqual(reversedContacts, base, `trial ${trial}: contact-ledger order changed directional PAE`);

    const permutedMatrix = new Float32Array(16);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        permutedMatrix[row * 4 + column] = matrix[
          chainPermutation[row] * 4 + chainPermutation[column]
        ];
      }
    }
    const jointPermutation = summarizeContactPae(
      swappedStructure,
      "A",
      "B",
      audit.contacts,
      makePae(permutedMatrix),
    );
    deepEqual(jointPermutation, base, `trial ${trial}: joint chain/PAE permutation changed the summary`);
  }
  return { cases: 200_000, trials: 50_000, metamorphismsPerTrial: 4 };
});

await suite("prediction-run digest mutation invalidates only dependent manifest identities", () => {
  const firstCoordinate = predictionCoordinate(0, "LOCALITY FIRST");
  const secondCoordinate = predictionCoordinate(2, "LOCALITY SECOND");
  const firstPae = predictionPaeText(4, 1);
  const secondPae = predictionPaeText(4, 2);
  const baseFiles = [
    predictionRaw("run/fold_first_model_0.pdb", firstCoordinate),
    predictionRaw("run/fold_first_full_data_0.json", firstPae),
    predictionRaw("run/fold_second_model_0.pdb", secondCoordinate),
    predictionRaw("run/fold_second_full_data_0.json", secondPae),
  ];
  const baseline = createPredictionRunManifest(baseFiles);
  const baselineFirst = baseline.files.find((file) => file.path === "run/fold_first_model_0.pdb");
  const baselineSecond = baseline.files.find((file) => file.path === "run/fold_second_model_0.pdb");
  const baselineFirstPose = baseline.poses.find((pose) => pose.coordinateFileId === baselineFirst.id);
  const baselineSecondPose = baseline.poses.find((pose) => pose.coordinateFileId === baselineSecond.id);
  for (let trial = 0; trial < 10_000; trial += 1) {
    const changedText = `${firstCoordinate}\nREMARK digest-locality-${trial}`;
    const changed = createPredictionRunManifest([
      predictionRaw("run/fold_first_model_0.pdb", changedText),
      ...baseFiles.slice(1),
    ]);
    const changedFirst = changed.files.find((file) => file.path === "run/fold_first_model_0.pdb");
    const unchangedSecond = changed.files.find((file) => file.path === "run/fold_second_model_0.pdb");
    const changedFirstPose = changed.poses.find((pose) => pose.coordinateFileId === changedFirst.id);
    const unchangedSecondPose = changed.poses.find((pose) => pose.coordinateFileId === unchangedSecond.id);
    notEqual(changedFirst.id, baselineFirst.id, `trial ${trial}: changed bytes reused a stale coordinate identity`);
    equal(unchangedSecond.id, baselineSecond.id, `trial ${trial}: unrelated coordinate identity changed`);
    equal(changedFirstPose.paeFileId, baselineFirstPose.paeFileId, `trial ${trial}: filename-key PAE association drifted`);
    equal(unchangedSecondPose.paeFileId, baselineSecondPose.paeFileId, `trial ${trial}: unrelated PAE association changed`);
    ok(
      predictionRunManifestForExport(changed).files.every((file) => !("text" in file)),
      `trial ${trial}: exported mutation ledger retained decoded source text`,
    );
  }
  return { cases: 50_000, trials: 10_000, localityChecksPerTrial: 5 };
});

await suite("production prediction-run progress guards match an independent lifecycle oracle", () => {
  const oracleProgress = (previous, candidate) => {
    const valid = candidate != null && typeof candidate === "object" && !Array.isArray(candidate) &&
      (candidate.phase === "coordinate-recurrence" || candidate.phase === "per-pose-audit") &&
      Number.isSafeInteger(candidate.completed) && candidate.completed >= 0 &&
      Number.isSafeInteger(candidate.total) && candidate.total >= 1 &&
      candidate.completed <= candidate.total &&
      typeof candidate.filename === "string" && candidate.filename.length > 0 &&
      candidate.filename.length <= 1_024 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(candidate.filename);
    if (!valid) return previous;
    if (previous != null) {
      if (previous.phase === "per-pose-audit" && candidate.phase === "coordinate-recurrence") return previous;
      if (
        previous.phase === "coordinate-recurrence" && candidate.phase === "per-pose-audit" &&
        previous.completed !== previous.total
      ) return previous;
      if (
        previous.phase === candidate.phase &&
        (previous.total !== candidate.total || candidate.completed < previous.completed)
      ) return previous;
    }
    return { ...candidate };
  };
  let eventCases = 0;
  for (let trace = 0; trace < 50_000; trace += 1) {
    let generation = nextPredictionRunGeneration(0);
    let requestId = trace + 1;
    let productionProgress = null;
    let expectedProgress = null;
    for (let step = 0; step < 40; step += 1) {
      if (integer(20) === 0) {
        generation = nextPredictionRunGeneration(generation);
        requestId += 1;
        productionProgress = null;
        expectedProgress = null;
      }
      const phase = expectedProgress?.phase ?? "coordinate-recurrence";
      const total = expectedProgress?.total ?? 1 + integer(12);
      const completed = expectedProgress?.completed ?? 0;
      const category = integer(8);
      let candidate;
      if (category === 0) {
        candidate = { phase, completed: Math.min(total, completed + integer(3)), total, filename: `pose-${step}.pdb` };
      } else if (category === 1) {
        candidate = { phase, completed: Math.max(0, completed - 1), total, filename: `regressive-${step}.pdb` };
      } else if (category === 2) {
        candidate = { phase, completed, total: total + 1, filename: `drift-${step}.pdb` };
      } else if (category === 3) {
        candidate = { phase: "per-pose-audit", completed: 0, total: 1 + integer(12), filename: `phase-${step}.pdb` };
      } else if (category === 4) {
        candidate = { phase: "coordinate-recurrence", completed: 0, total: 1 + integer(12), filename: `reverse-${step}.pdb` };
      } else if (category === 5) {
        candidate = { phase, completed, total, filename: `bad\n${step}.pdb` };
      } else if (category === 6) {
        candidate = { phase, completed: total + 1, total, filename: `overflow-${step}.pdb` };
      } else {
        candidate = { phase, completed, total, filename: `duplicate-${step}.pdb` };
      }
      const eventGeneration = integer(5) ? generation : Math.max(0, generation - 1);
      const eventRequestId = integer(5) ? requestId : requestId + 1;
      const productionCurrent = isCurrentPredictionRunWorkerEvent(
        generation,
        eventGeneration,
        requestId,
        eventRequestId,
      );
      const oracleCurrent = generation === eventGeneration && requestId === eventRequestId;
      if (productionCurrent) productionProgress = nextPredictionRunProgress(productionProgress, candidate);
      if (oracleCurrent) expectedProgress = oracleProgress(expectedProgress, candidate);
      ok(
        productionCurrent === oracleCurrent &&
        JSON.stringify(productionProgress) === JSON.stringify(expectedProgress),
        `trace ${trace}, event ${step}: production lifecycle guard diverged from its independent oracle`,
      );
      eventCases += 1;
    }
  }
  equal(eventCases, 2_000_000, "progress lifecycle suite did not execute the planned event count");
  return { cases: eventCases, traces: 50_000, eventsPerTrace: 40 };
});

await suite("cancel, replacement, timeout, and late-result traces cannot commit stale generations", () => {
  let eventCases = 0;
  for (let trace = 0; trace < 50_000; trace += 1) {
    let currentGeneration = nextPredictionRunGeneration(0);
    let newestGeneration = currentGeneration;
    let nextRequestId = 1;
    let committedGeneration = 0;
    const requests = new Map([[1, {
      requestId: nextRequestId,
      status: "active",
      progress: 0,
      terminalTransitions: 0,
    }]]);
    for (let step = 0; step < 30; step += 1) {
      const previousCommit = committedGeneration;
      let commitPermitted = false;
      const action = integer(6);
      if (action === 0) {
        const current = requests.get(currentGeneration);
        if (current?.status === "active") {
          current.status = "canceled";
          current.terminalTransitions += 1;
        }
        newestGeneration = nextPredictionRunGeneration(newestGeneration);
        currentGeneration = newestGeneration;
        nextRequestId += 1;
        requests.set(currentGeneration, {
          requestId: nextRequestId,
          status: "active",
          progress: 0,
          terminalTransitions: 0,
        });
      }
      const token = 1 + integer(newestGeneration);
      const eventRequest = requests.get(token);
      const eventRequestId = eventRequest == null || integer(5) === 0
        ? nextRequestId + 1
        : eventRequest.requestId;
      const currentRequestId = requests.get(currentGeneration)?.requestId ?? nextRequestId;
      const operationFinished = requests.get(currentGeneration)?.status !== "active";
      const productionCurrent = canAcceptPredictionRunWorkerEvent(
        currentGeneration,
        token,
        currentRequestId,
        eventRequestId,
        operationFinished,
      );
      const oracleCurrent = token === currentGeneration && eventRequestId === currentRequestId && !operationFinished;
      if (action === 1) {
        const request = requests.get(token);
        if (request?.status === "active" && productionCurrent) {
          request.progress += 1;
        }
      } else if (action === 2) {
        const request = requests.get(token);
        if (request?.status === "active" && productionCurrent) {
          request.status = "resolved";
          request.terminalTransitions += 1;
          committedGeneration = token;
          commitPermitted = true;
        }
      } else if (action === 3) {
        const current = requests.get(currentGeneration);
        if (current?.status === "active") {
          current.status = "canceled";
          current.terminalTransitions += 1;
        }
      } else if (action === 4) {
        const current = requests.get(currentGeneration);
        if (current?.status === "active") {
          current.status = "timed-out";
          current.terminalTransitions += 1;
        }
      } else {
        // A late worker error or message-decode failure is deliberately a
        // non-committing terminal notification under the production guard.
        const request = requests.get(token);
        if (request?.status === "active" && !oracleCurrent && productionCurrent) {
          throw new Error(`trace ${trace}: a stale generation remained active`);
        }
      }
      const nonCurrentActive = [...requests.entries()].some(([generation, request]) => (
        generation !== currentGeneration && request.status === "active"
      ));
      const duplicateTerminal = [...requests.values()].some((request) => request.terminalTransitions > 1);
      ok(
        productionCurrent === oracleCurrent &&
        !nonCurrentActive &&
        !duplicateTerminal &&
        committedGeneration <= currentGeneration &&
        (committedGeneration === previousCommit || commitPermitted) &&
        (!commitPermitted || committedGeneration === currentGeneration),
        `trace ${trace}, event ${step}: stale generation committed or terminalized twice`,
      );
      eventCases += 1;
    }
  }
  equal(eventCases, 1_500_000, "cancellation suite did not execute the planned event count");
  return { cases: eventCases, traces: 50_000, eventsPerTrace: 30 };
});

await suite("user topology overlap matches an independent randomized residue-set oracle", () => {
  const topologyStructure = attestedStructure(
    "topology-adversarial",
    Array.from({ length: 12 }, (_, index) => [index + 1, index + 1]),
    17.5,
  );
  const topologyAudit = analyzeInterface(topologyStructure, "A", "B", "none");
  const sides = ["unspecified", "extracellular", "intracellular"];
  for (let trial = 0; trial < 100_000; trial += 1) {
    const extracellularOrders = [];
    const intracellularOrders = [];
    const transmembraneOrders = [];
    const interfaceOrders = [];
    for (let order = 1; order <= 12; order += 1) {
      const assignment = integer(4);
      if (assignment === 1) extracellularOrders.push(order);
      else if (assignment === 2) intracellularOrders.push(order);
      else if (assignment === 3) transmembraneOrders.push(order);
      if (random() < 0.55) interfaceOrders.push(order);
    }
    const intendedSide = sides[integer(sides.length)];
    const annotation = createTopologyAnnotation(topologyStructure, "A", topologyAudit, {
      intendedSide,
      extracellularResidues: extracellularOrders.map((order) => `A:${order}`).join(" "),
      intracellularResidues: intracellularOrders.map((order) => `A:${order}`).join(" "),
      transmembraneResidues: transmembraneOrders.map((order) => `A:${order}`).join(" "),
      annotationSource: "Adversarial supplied labels",
    });
    const result = evaluateAnnotatedFootprint(annotation, interfaceOrders);
    const contacts = new Set(interfaceOrders);
    const overlap = (orders) => orders.filter((order) => contacts.has(order)).length;
    const extracellularCount = overlap(extracellularOrders);
    const intracellularCount = overlap(intracellularOrders);
    const transmembraneCount = overlap(transmembraneOrders);
    const annotatedCount = extracellularCount + intracellularCount + transmembraneCount;
    const sideEvaluableCount = extracellularCount + intracellularCount;
    const intendedCount = intendedSide === "extracellular"
      ? extracellularCount
      : intendedSide === "intracellular"
        ? intracellularCount
        : null;
    const expectedStatus = !interfaceOrders.length || !sideEvaluableCount
      ? "insufficient-annotation"
      : intendedSide === "unspecified"
        ? "descriptive-only"
        : intendedCount === sideEvaluableCount
          ? "all-side-evaluable-overlap-on-intended-side"
          : intendedCount === 0
            ? "no-intended-side-overlap"
            : "mixed-side-overlap";
    ok(
      result.status === expectedStatus &&
      result.interfaceResidueCount === interfaceOrders.length &&
      result.extracellularContactResidueCount === extracellularCount &&
      result.intracellularContactResidueCount === intracellularCount &&
      result.transmembraneContactResidueCount === transmembraneCount &&
      result.otherOrUnannotatedContactResidueCount === interfaceOrders.length - annotatedCount &&
      result.annotationCoverage === (interfaceOrders.length ? annotatedCount / interfaceOrders.length : null) &&
      result.sideEvaluableCoverage === (interfaceOrders.length ? sideEvaluableCount / interfaceOrders.length : null) &&
      result.intendedSideShare === (
        intendedCount == null || !sideEvaluableCount ? null : intendedCount / sideEvaluableCount
      ) &&
      /does not infer or validate a membrane plane/i.test(result.claimBoundary),
      `trial ${trial}: supplied-topology overlap diverged from the independent set oracle`,
    );
  }
  return { cases: 100_000, residueUniverse: 12 };
});

await suite("prediction-run dossier provenance and CSV privacy survive hostile mutations", () => {
  const coordinateText = predictionCoordinate(0, "DOSSIER ADVERSARIAL");
  const rawFiles = [predictionRaw("run/candidate.pdb", coordinateText)];
  const manifest = createPredictionRunManifest(rawFiles);
  const manifestPose = manifest.poses[0];
  const coordinateRecord = predictionRunFileById(manifest, manifestPose.coordinateFileId);
  const coordinateSource = {
    id: coordinateRecord.id,
    path: coordinateRecord.path,
    filename: coordinateRecord.filename,
    bytes: coordinateRecord.bytes,
    sha256: coordinateRecord.sha256,
    text: coordinateRecord.text,
  };
  const result = executePredictionRunAuditJob({
    poses: [predictionAuditPose(manifestPose.id, coordinateSource, null, {
      provider: manifestPose.provider,
      poseKey: manifestPose.poseKey,
      variant: manifestPose.variant,
      associationBasis: manifestPose.associationBasis,
    })],
    referenceCoordinateFileId: coordinateRecord.id,
    referenceReceptorChain: "A",
    referenceVhhChain: "B",
    paeAssociationsAndOrderConfirmed: false,
    topologyAnnotation: null,
  });
  const generatedAt = "2026-08-28T12:34:56.000Z";
  const dossier = createPredictionRunDossier(manifest, result, null, generatedAt);
  const serializedDossier = JSON.stringify(dossier);
  ok(!/"text"\s*:|"matrix"\s*:/u.test(serializedDossier), "canonical prediction-run dossier leaked raw source data");
  equal(dossier.privacy.rawCoordinateTextIncluded, false, "dossier privacy flag drifted");
  equal(dossier.privacy.paeMatricesIncluded, false, "dossier PAE privacy flag drifted");
  equal(dossier.privacy.selectedProteinSequencesIncluded, true, "dossier sequence disclosure drifted");
  equal(dossier.privacy.residueContactTablesIncluded, true, "dossier contact-table disclosure drifted");
  equal(dossier.privacy.researcherDecisionsIncluded, false, "dossier decision disclosure drifted");

  for (let trial = 0; trial < 25_000; trial += 1) {
    const category = trial % 5;
    let mutatedManifest = manifest;
    let mutatedResult = result;
    if (category === 0 || category === 1) {
      const poseAudit = result.poseAudits[0];
      mutatedResult = {
        ...result,
        poseAudits: [{
          ...poseAudit,
          coordinate: {
            ...poseAudit.coordinate,
            ...(category === 0
              ? { sha256: digest(`tampered-${trial}`) }
              : { bytes: poseAudit.coordinate.bytes + 1 }),
          },
        }],
      };
    } else if (category === 2) {
      mutatedResult = { ...result, referenceCoordinateFileId: `missing-${trial}` };
    } else {
      mutatedManifest = {
        ...manifest,
        poses: [{
          ...manifest.poses[0],
          ...(category === 3 ? { status: "needs-review" } : { included: false }),
        }],
      };
    }
    throws(
      () => createPredictionRunDossier(mutatedManifest, mutatedResult, null, generatedAt),
      /reference|ready|included|provenance|manifest/i,
      `trial ${trial}: tampered dossier provenance was accepted`,
    );
  }

  const formulaPrefixes = ["=", "+", "-", "@", "\t", "\r", " \u200b=", "\u00a0+"];
  const basePose = result.poseAudits[0];
  for (let trial = 0; trial < 75_000; trial += 1) {
    const payload = `${formulaPrefixes[trial % formulaPrefixes.length]}FORMULA(${trial}),\"quoted\"`;
    const normalizedPayload = payload.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      if (/\p{Cf}/u.test(character)) return "";
      return "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0");
    });
    const formulaLike = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[=+\-@]/u.test(payload);
    const expectedPayload = (formulaLike ? "'" : "") + normalizedPayload;
    const hostileResult = {
      ...result,
      coordinateEnsemble: null,
      poseAudits: [{
        ...basePose,
        id: payload,
        coordinate: { ...basePose.coordinate, filename: payload },
      }],
    };
    const csv = predictionRunPoseSummaryCsv(hostileResult);
    const rows = parseCsv(csv);
    ok(
      rows.length === 2 && rows[1][0] === expectedPayload && rows[1][1] === expectedPayload,
      `trial ${trial}: CSV formula or separator payload was not neutralized exactly`,
    );
  }
  return { cases: 100_000, provenanceMutations: 25_000, csvPayloads: 75_000 };
});

const elapsed = results.reduce((sum, result) => sum + result.milliseconds, 0);
const summary = {
  suites: results.length,
  passed: results.filter((result) => result.status === "PASS").length,
  failed: results.filter((result) => result.status === "FAIL").length,
  cases: results.reduce((sum, result) => sum + (result.cases ?? 0), 0),
  assertions: assertionCount,
  milliseconds: +elapsed.toFixed(1),
};

console.log(JSON.stringify({
  tool: "ConfoVHH product v0.9 adversarial validation",
  schemaVersion: "1.0.0",
  seed: `0x${INITIAL_SEED.toString(16)}`,
  node: process.version,
  results,
  summary,
}, null, 2));

if (summary.failed > 0) process.exitCode = 1;
