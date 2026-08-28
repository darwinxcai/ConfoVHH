import assert from "node:assert/strict";
import test from "node:test";

import {
  SINGLE_AUDIT_EXPORT_SCHEMA_VERSION,
  createSingleAuditExportReport,
} from "../lib/audit-export.ts";
import { CONFOVHH_VERSION, analyzeInterface } from "../lib/confovhh.ts";

const COORDINATE_SHA256 = "a".repeat(64);
const PAE_SHA256 = "b".repeat(64);

function atom({ serial, name, chainId, residueNumber, residueOrder, x, y, z, element }) {
  return {
    serial,
    name,
    residueName: "ALA",
    chainId,
    residueNumber,
    insertionCode: "",
    residueKey: `${chainId}:${residueNumber}`,
    residueOrder,
    x,
    y,
    z,
    element,
    bFactor: 82,
  };
}

function residue(chainId, number, order, origin, serialStart) {
  const atoms = [
    atom({ serial: serialStart, name: "N", chainId, residueNumber: number, residueOrder: order, x: origin[0], y: origin[1], z: origin[2], element: "N" }),
    atom({ serial: serialStart + 1, name: "CA", chainId, residueNumber: number, residueOrder: order, x: origin[0] + 1.2, y: origin[1] + 0.2, z: origin[2], element: "C" }),
    atom({ serial: serialStart + 2, name: "C", chainId, residueNumber: number, residueOrder: order, x: origin[0] + 2.1, y: origin[1] + 1.1, z: origin[2] + 0.3, element: "C" }),
    atom({ serial: serialStart + 3, name: "O", chainId, residueNumber: number, residueOrder: order, x: origin[0] + 1.8, y: origin[1] + 2.2, z: origin[2] + 0.7, element: "O" }),
  ];
  return {
    key: `${chainId}:${number}`,
    chainId,
    name: "ALA",
    number,
    insertionCode: "",
    order,
    oneLetter: "A",
    atoms,
    labelSequenceId: order,
    authSequenceId: number,
  };
}

function fixtureStructure() {
  const receptorResidues = [
    residue("R", 11, 1, [0, 0, 0], 1),
    residue("R", 12, 2, [3.7, 0.4, 0.2], 5),
  ];
  const vhhResidues = [
    residue("V", 101, 1, [0.5, 3.4, 1.1], 9),
    residue("V", 102, 2, [4.1, 3.7, 1.5], 13),
  ];
  const chains = [
    {
      id: "R",
      atomCount: 8,
      residueCount: 2,
      sequence: "AA",
      backboneCompleteness: 1,
      roleHint: "receptor-like",
      residues: receptorResidues,
      labelAsymId: "AR",
      authAsymId: "A",
    },
    {
      id: "V",
      atomCount: 8,
      residueCount: 2,
      sequence: "AA",
      backboneCompleteness: 1,
      roleHint: "VHH-like",
      residues: vhhResidues,
      labelAsymId: "BV",
      authAsymId: "B",
    },
  ];
  return {
    atoms: chains.flatMap((chain) => chain.residues.flatMap((entry) => entry.atoms)),
    chains,
    title: "Export fixture",
    experimentalMethod: "ELECTRON MICROSCOPY",
    modelCount: 2,
    ignoredAlternateLocations: 3,
    ignoredHydrogens: 4,
    duplicateAtomRecords: 5,
    malformedAtomRecords: 6,
    unsupportedResidueRecords: 7,
    zeroOccupancyAtomRecords: 8,
    residueNameConflicts: 9,
    sourceFormat: "mmcif",
    coordinateScope: "as-supplied",
    selectedModelId: "2",
    availableModelIds: ["1", "2"],
    availableAssemblies: [{
      id: "1",
      details: "author-defined assembly",
      methodDetails: null,
      oligomericDetails: "heterodimeric",
      oligomericCount: 2,
      generatorCount: 1,
      generators: [{ sourceRowIndex: 1, operationExpression: "1", labelAsymIds: ["AR", "BV"] }],
    }],
    selectedAssembly: null,
  };
}

function fixturePae() {
  const matrix = new Float32Array(16);
  for (const receptorIndex of [0, 1]) {
    for (const vhhIndex of [2, 3]) {
      matrix[receptorIndex * 4 + vhhIndex] = 2;
      matrix[vhhIndex * 4 + receptorIndex] = 8;
    }
  }
  return {
    matrix,
    residueCount: 4,
    maxPaeAngstrom: 31.75,
    sourceFormat: "AlphaFold predicted_aligned_error",
    filename: "fixture_pae.json",
  };
}

function fixtureAudit(structure = fixtureStructure(), pae = fixturePae()) {
  return analyzeInterface(structure, "R", "V", "none", pae, pae != null);
}

function createReport(overrides = {}) {
  const structure = overrides.structure ?? fixtureStructure();
  const pae = overrides.pae === undefined ? fixturePae() : overrides.pae;
  const audit = overrides.audit ?? fixtureAudit(structure, pae);
  return createSingleAuditExportReport({
    filename: "fixture.cif",
    coordinateSha256: COORDINATE_SHA256,
    coordinateBytes: 12_345,
    structure,
    receptorChain: "R",
    vhhChain: "V",
    chainIdentityConfirmed: true,
    pae,
    paeSha256: PAE_SHA256,
    paeOrderConfirmed: true,
    audit,
    generatedAt: "2026-08-27T12:34:56.000Z",
    ...overrides,
  });
}

test("single-audit schema 1.2 exports source, parser, model, chain, PAE, and method provenance", () => {
  const report = createReport();

  assert.equal(SINGLE_AUDIT_EXPORT_SCHEMA_VERSION, "1.2.0");
  assert.equal(report.schemaVersion, "1.2.0");
  assert.equal(report.softwareVersion, CONFOVHH_VERSION);
  assert.equal(report.generatedAt, "2026-08-27T12:34:56.000Z");
  assert.equal(report.file, "fixture.cif");
  assert.equal(report.structure.sourceFileSha256, COORDINATE_SHA256);
  assert.equal(report.structure.sourceFileBytes, 12_345);
  assert.match(report.structure.selectedCoordinateFingerprint, /^fnv1a64-3dp:[0-9a-f]{16}$/);
  assert.match(report.structure.selectedGeometryFingerprint, /^fnv1a64-se3-2dp:[0-9a-f]{16}$/);
  assert.match(report.structure.fingerprintPolicy.decisionBoundary, /proper-rotation fit/i);
  assert.equal(report.structure.coordinateProvenance, "experimental");
  assert.equal(report.structure.modelCount, 2);
  assert.equal(report.structure.selectedModelId, "2");
  assert.deepEqual(report.structure.availableModelIds, ["1", "2"]);
  assert.equal(report.structure.availableAssemblies[0].id, "1");
  assert.deepEqual(report.structure.selectedChains.map((chain) => [chain.role, chain.id]), [
    ["receptor", "R"],
    ["VHH", "V"],
  ]);
  assert.equal(report.structure.selectedChains[1].labelAsymId, "BV");
  assert.equal(report.structure.parserDiagnostics.ignoredAlternateLocations, 3);
  assert.equal(report.structure.parserDiagnostics.zeroOccupancyAtomRecords, 8);
  assert.match(report.structure.parserDiagnostics.alternateLocationPolicy, /code-unit tie-breaks/);

  assert.equal(report.pae.sha256, PAE_SHA256);
  assert.equal(report.pae.matrixValuesExported, false);
  assert.deepEqual(report.pae.residueIndexMap.map((entry) => (
    [entry.matrixIndex, entry.chainId, entry.chainSequenceOrder, entry.authSequenceId]
  )), [
    [0, "R", 1, 11],
    [1, "R", 2, 12],
    [2, "V", 1, 101],
    [3, "V", 2, 102],
  ]);

  assert.equal(report.auditPolicy.sasaOrientation, "source-coordinate-frame");
  assert.equal(report.auditPolicy.sasaSpherePoints, 960);
  assert.equal(report.auditPolicy.sasaMaximumCandidateDistanceChecks, 25_000_000);
  assert.equal(report.auditPolicy.sasaMaximumOcclusionChecks, 250_000_000);
  assert.equal(report.auditPolicy.pae, "attached-with-user-confirmed-direction-and-residue-order");
  assert.equal(report.audit.version, CONFOVHH_VERSION);
  assert.equal(report.audit.receptorChain, "R");
  assert.equal(report.audit.receptorFrameToVhhPaeMedianAngstrom, 2);
  assert.equal(report.audit.vhhFrameToReceptorPaeMedianAngstrom, 8);
  assert.equal(report.audit.receptorFrameToVhhPaeP90Angstrom, 2);
  assert.equal(report.audit.vhhFrameToReceptorPaeP90Angstrom, 8);
  assert.equal(report.audit.interfacePaeMedianAngstrom, 8);
  assert.equal(report.audit.interfacePaeP90Angstrom, 8);
  assert.equal(report.audit.lowPaeContactShare, 1);
});

test("raw fingerprint changes under a whole-complex proper rotation and translation while the SE(3) fingerprint is stable", () => {
  const original = fixtureStructure();
  const translated = structuredClone(original);
  for (const atomRecord of translated.atoms) {
    const sourceX = atomRecord.x;
    const sourceY = atomRecord.y;
    atomRecord.x = -sourceY + 1234.5;
    atomRecord.y = sourceX - 987.25;
    atomRecord.z += 456.75;
  }
  // ParsedStructure intentionally shares AtomRecord object identities between
  // structure.atoms and residue.atoms; restore that invariant in this fixture.
  const translatedBySerial = new Map(translated.atoms.map((entry) => [entry.serial, entry]));
  for (const chain of translated.chains) {
    for (const entry of chain.residues) {
      entry.atoms = entry.atoms.map((candidate) => translatedBySerial.get(candidate.serial));
    }
  }

  const first = createReport({ structure: original });
  const second = createReport({ structure: translated });
  assert.notEqual(
    first.structure.selectedCoordinateFingerprint,
    second.structure.selectedCoordinateFingerprint,
  );
  assert.equal(
    first.structure.selectedGeometryFingerprint,
    second.structure.selectedGeometryFingerprint,
  );
});

test("deposited-assembly export retains selected assembly and generated chain provenance", () => {
  const structure = fixtureStructure();
  structure.coordinateScope = "deposited-assembly";
  structure.selectedAssembly = {
    id: "1",
    details: "author-defined assembly",
    generatorCount: 1,
    generatedChainCount: 2,
    generatedProteinHeavyAtomCount: 16,
    generatedOperationCount: 1,
    skippedNonProteinLabelAsymIds: ["L"],
    materializationPolicy: "Protein heavy atoms only.",
    generators: [{
      sourceRowIndex: 1,
      operationExpression: "1",
      labelAsymIds: ["AR", "BV"],
      expandedOperationTuples: [["1"]],
    }],
  };
  structure.chains[1].assemblyCopyIndex = 1;
  structure.chains[1].assemblyGeneratorRowIndex = 1;
  structure.chains[1].assemblyOperationIds = ["1"];
  structure.chains[1].assemblyTransform = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];

  const report = createReport({
    structure,
    pae: null,
    paeSha256: null,
    paeOrderConfirmed: false,
  });
  assert.equal(report.structure.selectedAssembly.id, "1");
  assert.equal(report.structure.selectedChains[1].assemblyGeneratorRowIndex, 1);
  assert.deepEqual(report.structure.selectedChains[1].assemblyOperationIds, ["1"]);
  assert.match(report.structure.assemblyPolicy, /physiological relevance was not inferred/);
  assert.equal(report.pae, null);
  assert.equal(report.auditPolicy.pae, "omitted");
});

test("single-audit export rejects incomplete or mismatched PAE provenance", () => {
  assert.throws(
    () => createReport({ paeSha256: null }),
    /PAE requires its source SHA-256 digest/,
  );
  assert.throws(
    () => createReport({ paeOrderConfirmed: false }),
    /residue order must be explicitly confirmed/,
  );
  assert.throws(
    () => createReport({ paeOrderConfirmed: "yes" }),
    /residue order must be explicitly confirmed/i,
  );
  assert.throws(
    () => createReport({ pae: { ...fixturePae(), residueCount: 3 } }),
    /PAE matrix.*(?:no longer matches|square Float32 array)|residue count no longer matches/i,
  );
  assert.throws(
    () => createReport({
      pae: { ...fixturePae(), matrix: new Float32Array(15) },
    }),
    /PAE matrix.*(?:no longer matches|square Float32 array)/i,
  );
  assert.throws(
    () => createReport({
      pae: { ...fixturePae(), filename: null },
    }),
    /non-empty source filename/i,
  );
  const nonfinite = fixturePae();
  nonfinite.matrix[2] = Number.NaN;
  assert.throws(() => createReport({ pae: nonfinite }), /invalid value at flat index/i);
  const understated = fixturePae();
  understated.maxPaeAngstrom = 7;
  assert.throws(() => createReport({ pae: understated }), /maximum is smaller/i);
  assert.throws(
    () => createReport({ coordinateSha256: "not-a-digest" }),
    /64-character hexadecimal SHA-256/,
  );
  assert.throws(
    () => createReport({
      audit: { ...fixtureAudit(), paeFilename: "different.json" },
    }),
    /PAE filename does not match/,
  );
  assert.throws(
    () => createReport({
      audit: { ...fixtureAudit(), paeOrderConfirmed: false },
    }),
    /audit and export must both record explicit PAE residue-order confirmation/i,
  );
  assert.throws(
    () => createReport({
      audit: { ...fixtureAudit(), interfacePaeMedianAngstrom: 0 },
    }),
    /interfacePaeMedianAngstrom value does not match/,
  );
  assert.throws(
    () => createReport({
      pae: null,
      paeSha256: null,
      paeOrderConfirmed: false,
      audit: fixtureAudit(),
    }),
    /records attached PAE provenance/,
  );
});

test("single-audit export requires confirmed chains and a canonical UTC timestamp", () => {
  assert.throws(
    () => createReport({ chainIdentityConfirmed: false }),
    /chain identities must be explicitly confirmed/i,
  );
  assert.throws(
    () => createReport({ chainIdentityConfirmed: "yes" }),
    /chain identities must be explicitly confirmed/i,
  );
  assert.throws(
    () => createReport({ generatedAt: "August 27, 2026" }),
    /valid UTC ISO 8601 timestamp/,
  );
  assert.throws(
    () => createReport({ generatedAt: "2026-02-30T00:00:00.000Z" }),
    /valid UTC ISO 8601 timestamp/,
  );
  assert.throws(
    () => createReport({ filename: "model\u202Efdp.cif" }),
    /filename without control or invisible formatting/i,
  );
});

test("single-audit export normalizes accepted uppercase source digests", () => {
  const report = createReport({
    coordinateSha256: COORDINATE_SHA256.toUpperCase(),
    paeSha256: PAE_SHA256.toUpperCase(),
  });
  assert.equal(report.structure.sourceFileSha256, COORDINATE_SHA256);
  assert.equal(report.pae.sha256, PAE_SHA256);
});

test("single-audit export rejects incomplete or internally inconsistent audits", () => {
  const incomplete = fixtureAudit();
  delete incomplete.rationale;
  assert.throws(
    () => createReport({ audit: incomplete }),
    /non-empty evidence rationale/,
  );

  const inconsistent = fixtureAudit();
  inconsistent.contactPairCount += 1;
  assert.throws(
    () => createReport({ audit: inconsistent }),
    /contact records do not reconcile/,
  );

  const fabricatedKey = fixtureAudit();
  fabricatedKey.receptorInterfaceKeys[0] = "fabricated:key";
  assert.throws(
    () => createReport({ audit: fabricatedKey }),
    /interface-key inventories do not reconcile/,
  );

  const driftedMethod = fixtureAudit();
  driftedMethod.methods.sasaRadii = `${driftedMethod.methods.sasaRadii} modified`;
  assert.throws(
    () => createReport({ audit: driftedMethod }),
    /sasaRadii.*current fixed audit policy/i,
  );

  const mislabeledResidue = fixtureAudit();
  mislabeledResidue.contacts[0].receptorResidue = "ALA R:999";
  assert.throws(
    () => createReport({ audit: mislabeledResidue }),
    /residue labels and names must match/i,
  );

  const inventedContactType = fixtureAudit();
  inventedContactType.contacts[0].contactTypes = ["looks convincing"];
  assert.throws(
    () => createReport({ audit: inventedContactType }),
    /named contact types/i,
  );
});

test("single-audit export rejects a stale audit after coordinate mutation", () => {
  const original = fixtureStructure();
  const audit = fixtureAudit(original, fixturePae());
  const moved = fixtureStructure();
  for (const residue of moved.chains[1].residues) {
    for (const atomRecord of residue.atoms) atomRecord.y += 50;
  }
  assert.throws(
    () => createReport({ structure: moved, audit }),
    /input attestation does not match/i,
  );
});

test("single-audit export is a deep provenance snapshot", () => {
  const structure = fixtureStructure();
  structure.chains[1].assemblyTransform = [[1, 0, 0, 1], [0, 1, 0, 2], [0, 0, 1, 3]];
  const audit = fixtureAudit(structure, fixturePae());
  const report = createReport({ structure, audit });

  structure.chains[1].assemblyTransform[0][3] = 999;
  structure.availableAssemblies[0].generators[0].labelAsymIds[0] = "MUTATED";
  audit.methods.sasaRadii = "mutated";

  assert.equal(report.structure.selectedChains[1].assemblyTransform[0][3], 1);
  assert.equal(report.structure.availableAssemblies[0].generators[0].labelAsymIds[0], "AR");
  assert.notEqual(report.audit.methods.sasaRadii, "mutated");
});

test("single-audit export never silently serializes non-finite metadata as null", () => {
  const structure = fixtureStructure();
  structure.availableAssemblies[0].oligomericCount = Number.NaN;
  const audit = fixtureAudit(structure, fixturePae());
  assert.throws(
    () => createReport({ structure, audit }),
    /non-finite number.*exported faithfully/i,
  );
});

test("single-audit export rejects impossible parser, model, and assembly provenance", () => {
  for (const [mutate, expected] of [
    [(structure) => { structure.sourceFormat = "invented"; }, /source format is invalid/i],
    [(structure) => { structure.coordinateScope = "invented"; }, /coordinate scope is invalid/i],
    [(structure) => { structure.availableModelIds = ["1"]; }, /coordinate-model provenance/i],
    [(structure) => { structure.malformedAtomRecords = -1; }, /parser-accounting field/i],
    [(structure) => {
      structure.coordinateScope = "deposited-assembly";
      structure.selectedAssembly = null;
    }, /coordinate scope and deposited-assembly provenance/i],
  ]) {
    const structure = fixtureStructure();
    mutate(structure);
    const audit = fixtureAudit(structure, fixturePae());
    assert.throws(() => createReport({ structure, audit }), expected);
  }
});
