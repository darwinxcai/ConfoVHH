import assert from "node:assert/strict";
import test from "node:test";

import { detectCoordinateFormat, parseCoordinateText } from "../lib/coordinate-parser.ts";
import { parsePaeJson } from "../lib/confovhh.ts";
import { expandOperationExpression, parseMmcif } from "../lib/mmcif.ts";

const ATOM_HEADERS = [
  "_atom_site.group_PDB",
  "_atom_site.id",
  "_atom_site.type_symbol",
  "_atom_site.label_atom_id",
  "_atom_site.label_alt_id",
  "_atom_site.label_comp_id",
  "_atom_site.label_asym_id",
  "_atom_site.label_seq_id",
  "_atom_site.auth_asym_id",
  "_atom_site.auth_seq_id",
  "_atom_site.pdbx_PDB_ins_code",
  "_atom_site.Cartn_x",
  "_atom_site.Cartn_y",
  "_atom_site.Cartn_z",
  "_atom_site.occupancy",
  "_atom_site.B_iso_or_equiv",
  "_atom_site.pdbx_PDB_model_num",
];

let nextAtomId = 1;
function atom({
  atomName = "CA",
  element = "C",
  residue = "ALA",
  labelAsym = "A",
  labelSeq = 1,
  authAsym = "R",
  authSeq = 1,
  insertion = "?",
  x = 0,
  y = 0,
  z = 0,
  occupancy = 1,
  b = 80,
  alt = ".",
  model = 1,
  group = "ATOM",
} = {}) {
  return [
    group, nextAtomId++, element, atomName, alt, residue, labelAsym, labelSeq,
    authAsym, authSeq, insertion, x, y, z, occupancy, b, model,
  ].join(" ");
}

function atomLoop(rows, headers = ATOM_HEADERS) {
  return ["loop_", ...headers, ...rows, "#"].join("\n");
}

function operationRow(id, matrix, vector) {
  return [id, ...matrix.flat(), ...vector].join(" ");
}

const OPERATION_HEADERS = [
  "_pdbx_struct_oper_list.id",
  "_pdbx_struct_oper_list.matrix[1][1]",
  "_pdbx_struct_oper_list.matrix[1][2]",
  "_pdbx_struct_oper_list.matrix[1][3]",
  "_pdbx_struct_oper_list.matrix[2][1]",
  "_pdbx_struct_oper_list.matrix[2][2]",
  "_pdbx_struct_oper_list.matrix[2][3]",
  "_pdbx_struct_oper_list.matrix[3][1]",
  "_pdbx_struct_oper_list.matrix[3][2]",
  "_pdbx_struct_oper_list.matrix[3][3]",
  "_pdbx_struct_oper_list.vector[1]",
  "_pdbx_struct_oper_list.vector[2]",
  "_pdbx_struct_oper_list.vector[3]",
];

function assemblyBlock({
  assemblyId = "1",
  generators = [{ expression: "1", asymIds: "A" }],
  operations = [operationRow("1", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0])],
} = {}) {
  return [
    "loop_",
    "_pdbx_struct_assembly.id",
    "_pdbx_struct_assembly.details",
    "_pdbx_struct_assembly.method_details",
    "_pdbx_struct_assembly.oligomeric_details",
    "_pdbx_struct_assembly.oligomeric_count",
    `${assemblyId} 'author defined' PISA dimeric 2`,
    "#",
    "loop_",
    "_pdbx_struct_assembly_gen.assembly_id",
    "_pdbx_struct_assembly_gen.oper_expression",
    "_pdbx_struct_assembly_gen.asym_id_list",
    ...generators.map((generator) => `${assemblyId} '${generator.expression}' '${generator.asymIds}'`),
    "#",
    "loop_",
    ...OPERATION_HEADERS,
    ...operations,
    "#",
  ].join("\n");
}

function cif(rows, extra = "") {
  return [
    "data_TEST",
    "_struct.title 'Synthetic # coordinate set'",
    "_exptl.method 'ELECTRON MICROSCOPY'",
    extra,
    atomLoop(rows),
  ].filter(Boolean).join("\n");
}

test("detects PDBx/mmCIF by extension or content", () => {
  assert.equal(detectCoordinateFormat(cif([atom()]), "model.dat"), "mmcif");
  assert.equal(detectCoordinateFormat("ATOM      1  CA  ALA A   1       0.000   0.000   0.000", "x.pdb"), "pdb");
  assert.equal(parseCoordinateText(cif([atom()]), "x.cif").sourceFormat, "mmcif");
});

test("bounds distinct mmCIF data names before retaining unbounded empty loops", () => {
  const loops = Array.from(
    { length: 20_001 },
    (_, index) => `loop_\n_x${index}.value\nstop_`,
  );
  assert.throws(
    () => parseMmcif(["data_NAMES", ...loops].join("\n")),
    /distinct data-name limit/i,
  );
});

test("bounds mmCIF block, data-name, chain, model, and operation identifiers", () => {
  assert.throws(
    () => parseMmcif(`data_${"A".repeat(513)}\n`),
    /data-block name exceeds.*identifier-length/i,
  );
  assert.throws(
    () => parseMmcif([
      "data_TEST",
      "loop_",
      `_${"x".repeat(512)}`,
      "stop_",
    ].join("\n")),
    /data name exceeds.*identifier-length/i,
  );
  assert.throws(
    () => parseMmcif(cif([atom({ labelAsym: "A".repeat(257) })])),
    /label asym ID exceeds.*identifier-length/i,
  );
  assert.throws(
    () => parseMmcif(cif([atom({ model: "M".repeat(257) })])),
    /model ID exceeds.*identifier-length/i,
  );
  assert.throws(
    () => parseMmcif(cif([atom({ labelAsym: "A\u202E" })])),
    /label asym ID contains.*invisible formatting/i,
  );
  assert.throws(
    () => expandOperationExpression("X".repeat(257)),
    /operation ID exceeds.*identifier-length/i,
  );
});

test("parses shuffled atom-site columns, quoted values, uncertainty notation, and EOF", () => {
  const headers = [...ATOM_HEADERS].reverse();
  const values = atom({ authAsym: "AA", authSeq: -2, insertion: "B", x: "1.25(4)" }).split(" ").reverse();
  const structure = parseMmcif([
    "data_TEST",
    "_struct.title",
    ";",
    "A multiline # title",
    "with two lines",
    ";",
    atomLoop([values.join(" ")], headers),
  ].join("\n").trimEnd());
  assert.equal(structure.title.includes("multiline # title"), true);
  assert.equal(structure.chains[0].id, "A");
  assert.equal(structure.chains[0].authAsymId, "AA");
  assert.equal(structure.chains[0].residues[0].number, -2);
  assert.equal(structure.chains[0].residues[0].insertionCode, "B");
  assert.equal(structure.atoms[0].x, 1.25);
});

test("preserves label/auth identity and avoids duplicate author-chain IDs", () => {
  const structure = parseMmcif(cif([
    atom({ labelAsym: "A", authAsym: "X", x: 0 }),
    atom({ labelAsym: "AA", authAsym: "X", x: 10 }),
    atom({ labelAsym: "B", authAsym: "Y", x: 20 }),
  ]));
  assert.deepEqual(structure.chains.map((chain) => chain.id), ["A", "AA", "B"]);
  assert.deepEqual(structure.chains.map((chain) => chain.labelAsymId), ["A", "AA", "B"]);
});

test("sorts observed residues by label sequence and selects the first encountered model ID", () => {
  const text = cif([
    atom({ labelSeq: 3, authSeq: 30, residue: "GLY", model: 5 }),
    atom({ labelSeq: 1, authSeq: 10, residue: "ALA", model: 5 }),
    atom({ labelSeq: 2, authSeq: 20, residue: "SER", model: 6 }),
  ]);
  const structure = parseMmcif(text);
  assert.equal(structure.selectedModelId, "5");
  assert.deepEqual(structure.availableModelIds, ["5", "6"]);
  assert.equal(structure.chains[0].sequence, "AG");
  assert.deepEqual(structure.chains[0].residues.map((residue) => residue.number), [10, 30]);
  const second = parseMmcif(text, { modelId: "6" });
  assert.equal(second.selectedModelId, "6");
  assert.equal(second.chains[0].sequence, "S");
  assert.throws(() => parseMmcif(text, { modelId: "9" }), /not defined/);
});

test("fails closed when one author residue mixes present and missing label sequence IDs", () => {
  assert.throws(
    () => parseMmcif(cif([
      atom({ atomName: "N", labelSeq: 7, authSeq: 42 }),
      atom({ atomName: "CA", labelSeq: "?", authSeq: 42 }),
    ])),
    /mixed or inconsistent label sequence IDs/i,
  );
  assert.throws(
    () => parseMmcif(cif([
      atom({ atomName: "N", labelSeq: 7, authSeq: 42 }),
      atom({ atomName: "CA", labelSeq: 8, authSeq: 42 }),
    ])),
    /mixed or inconsistent label sequence IDs/i,
  );
});

test("bounds deposited-assembly asym-ID lists before splitting them", () => {
  const tooManyAsymIds = Array.from({ length: 513 }, (_, index) => `A${index}`).join(",");
  assert.throws(
    () => parseMmcif(cif([atom()], assemblyBlock({
      generators: [{ expression: "1", asymIds: tooManyAsymIds }],
    }))),
    /more than 512 label asym IDs/i,
  );
});

test("applies coherent residue-level alternate-location selection and occupancy guards", () => {
  const structure = parseMmcif(cif([
    atom({ atomName: "CA", alt: "A", occupancy: 0.4, x: 1 }),
    atom({ atomName: "CB", alt: "A", occupancy: 0.4, x: 2 }),
    atom({ atomName: "CA", alt: "B", occupancy: 0.7, x: 11 }),
    atom({ atomName: "CB", alt: "B", occupancy: 0.7, x: 12 }),
    atom({ atomName: "N", alt: ".", occupancy: 1, x: 0 }),
    atom({ atomName: "O", alt: ".", occupancy: 0, x: 0 }),
    atom({ atomName: "C", alt: ".", occupancy: 1.2, x: 0 }),
  ]));
  assert.deepEqual(structure.atoms.map((record) => record.name).sort(), ["CA", "CB", "N"]);
  assert.deepEqual(structure.atoms.filter((record) => record.name !== "N").map((record) => record.x), [11, 12]);
  assert.equal(structure.ignoredAlternateLocations, 2);
  assert.equal(structure.zeroOccupancyAtomRecords, 1);
  assert.equal(structure.malformedAtomRecords, 1);
});

test("distinguishes quoted missing-value symbols from unquoted missing values", () => {
  const row = atom({ authAsym: "'.'" });
  const structure = parseMmcif(cif([row]));
  assert.equal(structure.chains[0].authAsymId, ".");
  assert.equal(structure.chains[0].id, "A");
});

test("expands lists, numeric ranges, and Cartesian products without evaluation", () => {
  assert.deepEqual(expandOperationExpression("(1-3,7)(X0,X1)"), [
    ["1", "X0"], ["1", "X1"], ["2", "X0"], ["2", "X1"],
    ["3", "X0"], ["3", "X1"], ["7", "X0"], ["7", "X1"],
  ]);
  assert.throws(() => expandOperationExpression("(3-1)"), /Descending/);
  assert.throws(() => expandOperationExpression("(1,,2)"), /Malformed/);
  assert.throws(() => expandOperationExpression("(1)(2"), /Unclosed/);
});

test("reconstructs an identity deposited assembly with unique chain instances", () => {
  const text = cif([
    atom({ labelAsym: "A", authAsym: "R", x: 1 }),
    atom({ labelAsym: "B", authAsym: "N", x: 5 }),
  ], assemblyBlock({ generators: [{ expression: "1", asymIds: "A,B" }] }));
  const supplied = parseMmcif(text);
  const assembly = parseMmcif(text, { assemblyId: "1" });
  assert.equal(supplied.coordinateScope, "as-supplied");
  assert.equal(assembly.coordinateScope, "deposited-assembly");
  assert.deepEqual(assembly.chains.map((chain) => chain.id), ["mmcif-chain-0001", "mmcif-chain-0002"]);
  assert.equal(new Set(assembly.chains.flatMap((chain) => chain.residues.map((residue) => residue.key))).size, 2);
  assert.deepEqual(assembly.atoms.map((record) => record.x), supplied.atoms.map((record) => record.x));
  assert.throws(() => parsePaeJson("[[0,1],[1,0]]", assembly), /cannot be mapped onto generated assembly/);
});

test("uses label asym IDs exactly and creates multiple copies deterministically", () => {
  const operations = [
    operationRow("1", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]),
    operationRow("2", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [10, 0, 0]),
  ];
  const text = cif([
    atom({ labelAsym: "A", authAsym: "X", x: 1 }),
    atom({ labelAsym: "AA", authAsym: "X", x: 50 }),
  ], assemblyBlock({ generators: [{ expression: "(1,2)", asymIds: "A" }], operations }));
  const structure = parseMmcif(text, { assemblyId: "1" });
  assert.deepEqual(structure.chains.map((chain) => chain.id), ["mmcif-chain-0001", "mmcif-chain-0002"]);
  assert.deepEqual(structure.atoms.map((record) => record.x), [1, 11]);
  assert.deepEqual(structure.chains.map((chain) => chain.labelAsymId), ["A", "A"]);
});

test("composes noncommuting operations in wwPDB expression order", () => {
  const translate = operationRow("T", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [10, 0, 0]);
  const rotate = operationRow("R", [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [0, 0, 0]);
  const text = cif([
    atom({ x: 1, y: 0, z: 0 }),
  ], assemblyBlock({ generators: [{ expression: "(T)(R)", asymIds: "A" }], operations: [translate, rotate] }));
  const structure = parseMmcif(text, { assemblyId: "1" });
  assert.ok(Math.abs(structure.atoms[0].x - 10) < 1e-12);
  assert.ok(Math.abs(structure.atoms[0].y - 1) < 1e-12);
  assert.deepEqual(structure.chains[0].assemblyOperationIds, ["T", "R"]);
  assert.deepEqual(structure.chains[0].assemblyTransform, [[0, -1, 0, 10], [1, 0, 0, 0], [0, 0, 1, 0]]);
});

test("unions multiple assembly generator rows", () => {
  const text = cif([
    atom({ labelAsym: "A", authAsym: "A" }),
    atom({ labelAsym: "B", authAsym: "B" }),
  ], assemblyBlock({
    generators: [{ expression: "1", asymIds: "A" }, { expression: "1", asymIds: "B" }],
  }));
  const structure = parseMmcif(text, { assemblyId: "1" });
  assert.equal(structure.chains.length, 2);
  assert.equal(structure.selectedAssembly.generatorCount, 2);
});

test("fails closed for missing operators, unknown asym IDs, and invalid transforms", () => {
  const baseRows = [atom({ labelAsym: "A" })];
  const missing = cif(baseRows, assemblyBlock({ generators: [{ expression: "9", asymIds: "A" }] }));
  assert.throws(() => parseMmcif(missing, { assemblyId: "1" }), /missing operation/);
  const unknown = cif(baseRows, assemblyBlock({ generators: [{ expression: "1", asymIds: "Z" }] }));
  assert.throws(() => parseMmcif(unknown, { assemblyId: "1" }), /unknown label asym ID/);
  const scale = operationRow("1", [[2, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]);
  const invalid = cif(baseRows, assemblyBlock({ operations: [scale] }));
  assert.throws(() => parseMmcif(invalid, { assemblyId: "1" }), /proper rigid-body transform/);
  const duplicateOps = cif(baseRows, assemblyBlock({ operations: [
    operationRow("1", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]),
    operationRow("1", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0]),
  ] }));
  assert.throws(() => parseMmcif(duplicateOps, { assemblyId: "1" }), /operation ID.*more than once/);
  const duplicateGenerator = cif(baseRows, assemblyBlock({ generators: [
    { expression: "1", asymIds: "A" }, { expression: "1", asymIds: "A" },
  ] }));
  assert.throws(() => parseMmcif(duplicateGenerator, { assemblyId: "1" }), /same label asym ID and operation tuple/);
  const malformedGenerator = cif(baseRows, assemblyBlock()).replace("1 '1' 'A'", "1 ? 'A'");
  assert.throws(() => parseMmcif(malformedGenerator), /generator row 1 is missing/);
});

test("rejects malformed loops, multiple data blocks, and save frames", () => {
  assert.throws(() => parseMmcif("data_X\nloop_\n_atom_site.id\n_atom_site.Cartn_x\n1"), /incomplete row/);
  assert.throws(() => parseMmcif(`${cif([atom()])}\ndata_SECOND`), /multiple mmCIF data blocks/);
  assert.throws(() => parseMmcif(`data_X\nsave_demo\n${atomLoop([atom()])}`), /save frames/);
  assert.throws(() => parseMmcif("data_X\nloop_\n_test.a\n_test.b\none data_SECOND\n#"), /control token inside an incomplete row/);
  assert.throws(() => parseMmcif("data_X\n_struct.title first\n_struct.title second"), /defined more than once/);
  assert.throws(() => parseMmcif("data_X\nloop_\n_atom_site.id\n_atom_site.id\n1 2"), /duplicate item name/);
  assert.throws(() => parseMmcif(atomLoop([atom()])), /inside a named data block/);
  assert.throws(() => parseMmcif("data_\n"), /nonempty name/);
  assert.throws(() => parseMmcif(`_struct.title outside\ndata_X\n${atomLoop([atom()])}`), /inside a named data block/);
});

test("consumes uncommon whitespace without hanging and bounds transformed coordinates", () => {
  assert.throws(() => parseMmcif(`\f\v\u00a0data_X`), /No readable protein/);
  const hugeA = operationRow("A", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1e308, 0, 0]);
  const hugeB = operationRow("B", [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1e308, 0, 0]);
  const text = cif([atom()], assemblyBlock({
    generators: [{ expression: "(A)(B)", asymIds: "A" }],
    operations: [hugeA, hugeB],
  }));
  assert.throws(() => parseMmcif(text, { assemblyId: "1" }), /non-finite|implausibly large/);
  assert.throws(() => parseMmcif(cif([atom({ x: "0x10" })])), /No readable protein/);
  assert.throws(() => expandOperationExpression("(1)".repeat(9)), /at most 8/);
  assert.throws(() => parseMmcif("data_X\u0000"), /NUL characters/);
});

test("canonicalizes equivalent label sequence integers into one residue site", () => {
  const structure = parseMmcif(cif([
    atom({ atomName: "CA", labelSeq: "1", x: 1 }),
    atom({ atomName: "N", labelSeq: "+1", x: 2 }),
  ]));
  assert.equal(structure.chains[0].residueCount, 1);
  assert.deepEqual(structure.atoms.map((record) => record.name).sort(), ["CA", "N"]);
  assert.equal(parseMmcif(cif([
    atom({ atomName: "CA", labelSeq: 2, authSeq: 2 }),
    atom({ atomName: "N", labelSeq: "bogus", authSeq: 3 }),
  ])).malformedAtomRecords, 1);
});

test("fails closed on input-order-dependent residue microheterogeneity", () => {
  const text = cif([
    atom({ residue: "ALA", alt: "A", occupancy: 0.1 }),
    atom({ residue: "CYS", alt: "B", occupancy: 0.9 }),
  ]);
  assert.throws(() => parseMmcif(text), /Microheterogeneous residue identities/);
});

test("parses 128 deterministic atom-site column permutations identically", () => {
  const baseRows = [
    atom({ atomName: "N", element: "N", residue: "ALA", labelSeq: 1, authSeq: 11, x: -1.25, y: 2.5, z: 3.75 }),
    atom({ atomName: "CA", element: "C", residue: "ALA", labelSeq: 1, authSeq: 11, x: 0, y: 2.75, z: 4 }),
    atom({ atomName: "N", element: "N", residue: "GLY", labelSeq: 2, authSeq: 12, x: 1.5, y: -2, z: 4.25 }),
    atom({ atomName: "CA", element: "C", residue: "GLY", labelSeq: 2, authSeq: 12, x: 2.25, y: -1.5, z: 4.5 }),
  ].map((row) => row.split(" "));

  for (let seed = 1; seed <= 128; seed += 1) {
    let state = seed;
    const random = () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const permutation = ATOM_HEADERS.map((_, index) => index);
    for (let index = permutation.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [permutation[index], permutation[other]] = [permutation[other], permutation[index]];
    }
    const separator = seed % 3 === 0 ? "\t" : seed % 3 === 1 ? " " : "  ";
    const newline = seed % 2 ? "\n" : "\r\n";
    const text = [
      "data_PERMUTED",
      "loop_",
      ...permutation.map((index) => ATOM_HEADERS[index]),
      "# deterministic row permutation",
      ...baseRows.map((values) => permutation.map((index) => values[index]).join(separator)),
      "#",
    ].join(newline);
    const structure = parseMmcif(text);
    assert.equal(structure.atoms.length, 4, `seed ${seed}`);
    assert.equal(structure.chains[0].sequence, "AG", `seed ${seed}`);
    assert.deepEqual(
      structure.atoms.map((record) => [record.name, record.residueNumber, record.x, record.y, record.z]),
      [
        ["N", 11, -1.25, 2.5, 3.75],
        ["CA", 11, 0, 2.75, 4],
        ["N", 12, 1.5, -2, 4.25],
        ["CA", 12, 2.25, -1.5, 4.5],
      ],
      `seed ${seed}`,
    );
  }
});

test("operation-expression expansion matches 100 deterministic Cartesian-product oracles", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const leftStart = seed % 7 + 1;
    const leftEnd = leftStart + seed % 4;
    const right = [`X${seed % 5}`, `Y${seed % 9}`];
    const expression = `(${leftStart}-${leftEnd})(${right.join(",")})`;
    const expected = [];
    for (let value = leftStart; value <= leftEnd; value += 1) {
      for (const symbol of right) expected.push([String(value), symbol]);
    }
    assert.deepEqual(expandOperationExpression(expression), expected, `seed ${seed}`);
  }
  assert.throws(() => expandOperationExpression("(1-513)"), /expansion limit|more than 512|beyond 512/);
  assert.throws(() => expandOperationExpression("(1-23)(1-23)"), /beyond 512/);
});

test("deposited-assembly descriptors accept exactly 256 IDs and reject the 257th during retention", () => {
  const assemblyCatalog = (count) => [
    "loop_",
    "_pdbx_struct_assembly.id",
    "_pdbx_struct_assembly.details",
    "_pdbx_struct_assembly.method_details",
    "_pdbx_struct_assembly.oligomeric_details",
    "_pdbx_struct_assembly.oligomeric_count",
    ...Array.from({ length: count }, (_, index) => `${index + 1} author PISA monomeric 1`),
    "#",
    "loop_",
    "_pdbx_struct_assembly_gen.assembly_id",
    "_pdbx_struct_assembly_gen.oper_expression",
    "_pdbx_struct_assembly_gen.asym_id_list",
    ...Array.from({ length: count }, (_, index) => `${index + 1} 1 A`),
    "#",
  ].join("\n");
  const accepted = parseMmcif(cif([atom()], assemblyCatalog(256)));
  assert.equal(accepted.availableAssemblies.length, 256);
  assert.equal(accepted.availableAssemblies[255].generators[0].sourceRowIndex, 256);
  assert.throws(() => parseMmcif(cif([atom()], assemblyCatalog(257))), /more than 256 deposited assemblies/i);
});

test("as-supplied mmCIF parsing accepts 256 protein chains and rejects the 257th", () => {
  const rows = Array.from({ length: 257 }, (_, index) => atom({
    labelAsym: `CHAIN_${String(index).padStart(3, "0")}`,
    authAsym: `AUTH_${String(index).padStart(3, "0")}`,
    authSeq: index + 1,
    labelSeq: 1,
    x: index,
  }));
  assert.equal(parseMmcif(cif(rows.slice(0, 256))).chains.length, 256);
  assert.throws(() => parseMmcif(cif(rows)), /more than 256 parsed protein chains/i);
});

test("assembly-operation numeric ranges reject unsafe integer endpoints", () => {
  assert.throws(
    () => expandOperationExpression("(9007199254740992-9007199254740993)"),
    /safe-integer range/i,
  );
});

test("mmCIF materialized residue keys encode tuples without delimiter collisions", () => {
  const structure = parseMmcif(cif([
    atom({ labelAsym: "A:1", authAsym: "X", authSeq: 2, labelSeq: 1, insertion: "?", x: 0 }),
    atom({ labelAsym: "A", authAsym: "Y", authSeq: 1, labelSeq: 1, insertion: "2:", x: 4 }),
  ]));
  assert.equal(structure.chains.length, 2);
  assert.notEqual(structure.chains[0].residues[0].key, structure.chains[1].residues[0].key);
  assert.deepEqual(structure.chains.map((chain) => JSON.parse(chain.residues[0].key)[0]), ["A:1", "A"]);
});

test("iterative mmCIF duplicate selection handles 130,000 exact candidates", () => {
  const repeated = atom({ atomName: "CA", occupancy: 1 }).split(" ");
  const idColumn = ATOM_HEADERS.indexOf("_atom_site.id");
  const rows = Array.from({ length: 130_000 }, (_, index) => {
    const values = [...repeated];
    values[idColumn] = String(index + 1);
    return values.join(" ");
  });
  const structure = parseMmcif(cif(rows));
  assert.equal(structure.atoms.length, 1);
  assert.equal(structure.duplicateAtomRecords, 129_999);
});

test("equal-occupancy coordinate-conflicting mmCIF duplicates fail closed", () => {
  assert.throws(
    () => parseMmcif(cif([
      atom({ atomName: "CA", occupancy: 1, x: 1 }),
      atom({ atomName: "CA", occupancy: 1, x: 2 }),
    ])),
    /conflicting highest-occupancy duplicate/i,
  );
});
