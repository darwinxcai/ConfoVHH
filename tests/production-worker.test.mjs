import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function findUniqueWorkerAsset(pattern) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (pattern.test(entry.name)) matches.push(entryPath);
    }
  }
  await visit(path.join(root, "dist", "client"));
  assert.equal(matches.length, 1, `expected exactly one production ${pattern} worker asset`);
  return matches[0];
}

function minimalStructure() {
  const atom = (chainId, residueName, x) => ({
    serial: chainId === "A" ? 1 : 2,
    name: "CA",
    residueName,
    chainId,
    residueNumber: 1,
    insertionCode: "",
    residueKey: `${chainId}:1:`,
    residueOrder: 1,
    x,
    y: 0,
    z: 0,
    element: "C",
    bFactor: 85,
  });
  const atomA = atom("A", "ALA", 0);
  const atomB = atom("B", "GLY", 4);
  const residue = (record, oneLetter) => ({
    key: record.residueKey,
    chainId: record.chainId,
    name: record.residueName,
    number: 1,
    insertionCode: "",
    order: 1,
    oneLetter,
    atoms: [record],
  });
  const residueA = residue(atomA, "A");
  const residueB = residue(atomB, "G");
  return {
    atoms: [atomA, atomB],
    chains: [
      { id: "A", atomCount: 1, residueCount: 1, sequence: "A", backboneCompleteness: 0, roleHint: "other", residues: [residueA] },
      { id: "B", atomCount: 1, residueCount: 1, sequence: "G", backboneCompleteness: 0, roleHint: "other", residues: [residueB] },
    ],
    title: null,
    experimentalMethod: null,
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

test("production audit worker boots and completes the typed request protocol", async (context) => {
  const workerAsset = await findUniqueWorkerAsset(/^audit-worker-.*\.js$/);
  const assetUrl = pathToFileURL(workerAsset).href;
  const wrapper = `
    import { parentPort } from "node:worker_threads";
    globalThis.self = {
      postMessage: (message) => parentPort.postMessage(message),
      onmessage: null,
    };
    await import(${JSON.stringify(assetUrl)});
    parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
    parentPort.postMessage({ ready: true });
  `;
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`),
    { type: "module" },
  );
  context.after(() => worker.terminate());

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("production audit worker timed out")), 10_000);
    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.ready) {
        worker.postMessage({
          requestId: 7,
          type: "single",
          job: {
            structure: minimalStructure(),
            receptorChain: "A",
            vhhChain: "B",
            confidenceMode: "none",
            pae: null,
            paeOrderConfirmed: false,
          },
        });
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });
  });

  assert.equal(response.type, "single-result");
  assert.equal(response.requestId, 7);
  assert.equal(response.audit.contactPairCount, 1);
});

test("production worker parses mmCIF and reconstructs a declared assembly", async (context) => {
  const workerAsset = await findUniqueWorkerAsset(/^audit-worker-.*\.js$/);
  const assetUrl = pathToFileURL(workerAsset).href;
  const wrapper = `
    import { parentPort } from "node:worker_threads";
    globalThis.self = {
      postMessage: (message) => parentPort.postMessage(message),
      onmessage: null,
    };
    await import(${JSON.stringify(assetUrl)});
    parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
    parentPort.postMessage({ ready: true });
  `;
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`),
    { type: "module" },
  );
  context.after(() => worker.terminate());

  const cif = `data_X
loop_
_pdbx_struct_assembly.id
_pdbx_struct_assembly.details
1 'author defined'
loop_
_pdbx_struct_assembly_gen.assembly_id
_pdbx_struct_assembly_gen.oper_expression
_pdbx_struct_assembly_gen.asym_id_list
1 1 A,B
loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 1 0 0 0 1 0 0 0
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA ALA A 1 R 1 0 0 0
ATOM 2 C CA GLY B 1 N 1 4 0 0
#`;

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("production mmCIF parse timed out")), 10_000);
    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.ready) {
        worker.postMessage({
          requestId: 8,
          type: "parse-coordinate",
          job: { filename: "fixture.cif", text: cif, assemblyId: "1" },
        });
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });
  });

  assert.equal(response.type, "parse-result");
  assert.equal(response.requestId, 8);
  assert.equal(response.structure.sourceFormat, "mmcif");
  assert.equal(response.structure.coordinateScope, "deposited-assembly");
  assert.deepEqual(response.structure.chains.map((chain) => chain.id), ["mmcif-chain-0001", "mmcif-chain-0002"]);
});

test("production worker parses PAE into a transferable row-major Float32 matrix", async (context) => {
  const workerAsset = await findUniqueWorkerAsset(/^audit-worker-.*\.js$/);
  const assetUrl = pathToFileURL(workerAsset).href;
  const wrapper = `
    import { parentPort } from "node:worker_threads";
    globalThis.self = {
      postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
      onmessage: null,
    };
    await import(${JSON.stringify(assetUrl)});
    parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
    parentPort.postMessage({ ready: true });
  `;
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`),
    { type: "module" },
  );
  context.after(() => worker.terminate());

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("production PAE parse timed out")), 10_000);
    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.ready) {
        worker.postMessage({
          requestId: 9,
          type: "parse-pae",
          job: {
            filename: "pae.json",
            text: JSON.stringify([[0, 4], [7, 0]]),
            structure: minimalStructure(),
          },
        });
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });
  });

  assert.equal(response.type, "pae-result");
  assert.equal(response.requestId, 9);
  assert.equal(response.pae.residueCount, 2);
  assert.equal(response.pae.maxPaeAngstrom, 7);
  assert.ok(response.pae.matrix instanceof Float32Array);
  assert.deepEqual([...response.pae.matrix], [0, 4, 7, 0]);
  assert.equal(response.pae.matrix.byteLength, 16);
});
