import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { analyzeInterface, CONFOVHH_VERSION, parsePdb } from "../lib/confovhh.ts";
import { parseMmcif } from "../lib/mmcif.ts";
import { downloadPublicCoordinate } from "./public-coordinate-download.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../validation/mmcif-regression-manifest.v1.json", import.meta.url),
  "utf8",
));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url) {
  return downloadPublicCoordinate(url, url);
}

function selectedChain(structure, id, label) {
  const chain = structure.chains.find((candidate) => candidate.id === id);
  assert.ok(chain, `${label}: missing chain ${id}`);
  return chain;
}

function matchMmcifChain(structure, authId, sequence, label) {
  const candidates = structure.chains.filter((chain) => (
    chain.authAsymId === authId && chain.sequence === sequence
  ));
  assert.equal(candidates.length, 1, `${label}: expected one auth ${authId} / sequence match`);
  return candidates[0];
}

function canonicalAtoms(chain) {
  return chain.residues.flatMap((residue) => [...residue.atoms]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((atom) => ({
      identity: `${residue.order}|${residue.name}|${atom.name}|${atom.element}`,
      x: atom.x,
      y: atom.y,
      z: atom.z,
    })));
}

function coordinateError(leftChain, rightChain) {
  if (
    leftChain.sequence !== rightChain.sequence ||
    leftChain.residueCount !== rightChain.residueCount ||
    leftChain.atomCount !== rightChain.atomCount
  ) return Number.POSITIVE_INFINITY;
  const left = canonicalAtoms(leftChain);
  const right = canonicalAtoms(rightChain);
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].identity !== right[index].identity) return Number.POSITIVE_INFINITY;
    maximum = Math.max(maximum, Math.hypot(
      left[index].x - right[index].x,
      left[index].y - right[index].y,
      left[index].z - right[index].z,
    ));
  }
  return maximum;
}

const nativeDownloads = new Map();
await Promise.all(manifest.nativePanel.flatMap((entry) => ["pdb", "cif"].map(async (format) => {
  const key = `${entry.pdb}.${format}`;
  nativeDownloads.set(key, await download(`https://files.rcsb.org/download/${key}`));
})));

const parityResults = [];
for (const entry of manifest.nativePanel) {
  const pdbBytes = nativeDownloads.get(`${entry.pdb}.pdb`);
  const cifBytes = nativeDownloads.get(`${entry.pdb}.cif`);
  assert.equal(cifBytes.byteLength, entry.cifBytes, `${entry.pdb}: archive revision drift (byte count)`);
  assert.equal(sha256(cifBytes), entry.cifSha256, `${entry.pdb}: archive revision drift (SHA-256)`);
  const pdb = parsePdb(pdbBytes.toString("utf8"));
  const cif = parseMmcif(cifBytes.toString("utf8"));
  assert.equal(cif.atoms.length, entry.proteinAtoms, `${entry.pdb}: mmCIF protein atom count`);
  assert.equal(cif.chains.reduce((sum, chain) => sum + chain.residueCount, 0), entry.proteinResidues, `${entry.pdb}: mmCIF protein residue count`);
  assert.equal(pdb.atoms.length, cif.atoms.length, `${entry.pdb}: PDB/mmCIF atom parity`);
  assert.equal(
    pdb.chains.reduce((sum, chain) => sum + chain.residueCount, 0),
    cif.chains.reduce((sum, chain) => sum + chain.residueCount, 0),
    `${entry.pdb}: PDB/mmCIF total protein-residue parity`,
  );

  const pdbReceptor = selectedChain(pdb, entry.receptor, entry.pdb);
  const pdbVhh = selectedChain(pdb, entry.vhh, entry.pdb);
  const cifReceptor = matchMmcifChain(cif, entry.receptor, pdbReceptor.sequence, `${entry.pdb} receptor`);
  const cifVhh = matchMmcifChain(cif, entry.vhh, pdbVhh.sequence, `${entry.pdb} VHH`);
  assert.equal(pdbReceptor.atomCount, cifReceptor.atomCount, `${entry.pdb}: receptor atom parity`);
  assert.equal(pdbVhh.atomCount, cifVhh.atomCount, `${entry.pdb}: VHH atom parity`);

  const pdbAudit = analyzeInterface(pdb, pdbReceptor.id, pdbVhh.id, "none");
  const cifAudit = analyzeInterface(cif, cifReceptor.id, cifVhh.id, "none");
  assert.equal(cifAudit.contactPairCount, pdbAudit.contactPairCount, `${entry.pdb}: contact parity`);
  assert.equal(cifAudit.contactPairCount, entry.contacts, `${entry.pdb}: frozen contact regression`);
  assert.equal(cifAudit.severeClashCount, pdbAudit.severeClashCount, `${entry.pdb}: clash parity`);
  assert.equal(cifAudit.evidenceLevel, pdbAudit.evidenceLevel, `${entry.pdb}: evidence parity`);
  assert.ok(
    Math.abs(cifAudit.deltaSasaAngstrom2 - pdbAudit.deltaSasaAngstrom2) <= 1e-9,
    `${entry.pdb}: PDB/mmCIF ΔSASA parity`,
  );
  assert.ok(
    Math.abs(cifAudit.deltaSasaAngstrom2 - entry.deltaSasa) <= 1e-6,
    `${entry.pdb}: frozen ΔSASA regression`,
  );
  parityResults.push({
    pdb: entry.pdb,
    pdbSourceBytes: pdbBytes.byteLength,
    pdbSourceSha256: sha256(pdbBytes),
    mmcifSourceBytes: cifBytes.byteLength,
    mmcifSourceSha256: sha256(cifBytes),
    pdbPair: `${pdbReceptor.id}:${pdbVhh.id}`,
    mmcifPair: `${cifReceptor.id}:${cifVhh.id}`,
    mmcifLabelAuth: [
      `${cifReceptor.labelAsymId}/${cifReceptor.authAsymId}`,
      `${cifVhh.labelAsymId}/${cifVhh.authAsymId}`,
    ],
    contacts: cifAudit.contactPairCount,
    proteinAtoms: cif.atoms.length,
    proteinResidues: cif.chains.reduce((sum, chain) => sum + chain.residueCount, 0),
    deltaSasaAngstrom2: cifAudit.deltaSasaAngstrom2,
    exactDiscreteSerializationParity: true,
    deltaSasaAbsoluteDifferenceAngstrom2: Math.abs(
      cifAudit.deltaSasaAngstrom2 - pdbAudit.deltaSasaAngstrom2,
    ),
  });
}

const assemblyResults = [];
for (const entry of manifest.assemblyGoldens) {
  const [sourceBytes, assemblyBytes] = await Promise.all([
    download(`https://files.rcsb.org/download/${entry.pdb}.cif`),
    download(`https://files.rcsb.org/download/${entry.pdb}-assembly${entry.assemblyId}.cif`),
  ]);
  assert.equal(sourceBytes.byteLength, entry.sourceBytes, `${entry.pdb}: source archive revision drift (bytes)`);
  assert.equal(sha256(sourceBytes), entry.sourceSha256, `${entry.pdb}: source archive revision drift (SHA-256)`);
  assert.equal(assemblyBytes.byteLength, entry.assemblyBytes, `${entry.pdb}: assembly archive revision drift (bytes)`);
  assert.equal(sha256(assemblyBytes), entry.assemblySha256, `${entry.pdb}: assembly archive revision drift (SHA-256)`);
  const generated = parseMmcif(sourceBytes.toString("utf8"), { assemblyId: entry.assemblyId });
  const official = parseMmcif(assemblyBytes.toString("utf8"));
  assert.equal(generated.atoms.length, entry.proteinAtoms, `${entry.pdb}: generated protein atoms`);
  assert.equal(generated.chains.length, entry.proteinChains, `${entry.pdb}: generated protein chains`);
  assert.equal(generated.chains.reduce((sum, chain) => sum + chain.residueCount, 0), entry.proteinResidues, `${entry.pdb}: generated protein residues`);
  assert.equal(official.atoms.length, generated.atoms.length, `${entry.pdb}: official assembly protein atoms`);
  const unmatched = new Set(official.chains.map((chain) => chain.id));
  let maximumCoordinateError = 0;
  for (const generatedChain of generated.chains) {
    const matches = official.chains
      .filter((chain) => unmatched.has(chain.id))
      .map((chain) => ({ chain, error: coordinateError(generatedChain, chain) }))
      .sort((left, right) => left.error - right.error);
    assert.ok(Number.isFinite(matches[0]?.error), `${entry.pdb}: no official chain matches ${generatedChain.id}`);
    unmatched.delete(matches[0].chain.id);
    maximumCoordinateError = Math.max(maximumCoordinateError, matches[0].error);
  }
  assert.equal(unmatched.size, 0, `${entry.pdb}: unmatched official protein chains`);
  assert.ok(maximumCoordinateError <= 0.0011, `${entry.pdb}: coordinate error ${maximumCoordinateError} Å`);
  assemblyResults.push({
    pdb: entry.pdb,
    assemblyId: entry.assemblyId,
    sourceBytes: sourceBytes.byteLength,
    sourceSha256: sha256(sourceBytes),
    officialAssemblyBytes: assemblyBytes.byteLength,
    officialAssemblySha256: sha256(assemblyBytes),
    proteinAtoms: generated.atoms.length,
    proteinChains: generated.chains.length,
    proteinResidues: generated.chains.reduce((sum, chain) => sum + chain.residueCount, 0),
    officialChainsMatched: generated.chains.length,
    maximumCoordinateErrorAngstrom: maximumCoordinateError,
  });
}

console.log(JSON.stringify({
  schemaVersion: "1.0.0",
  softwareVersion: CONFOVHH_VERSION,
  benchmarkId: manifest.benchmarkId,
  kind: "structural-regression-panel",
  status: "executed",
  nativeSerializationParity: {
    structures: parityResults.length,
    exactDiscreteMatches: parityResults.length,
    deltaSasaParityToleranceAngstrom2: 1e-9,
    frozenDeltaSasaToleranceAngstrom2: 1e-6,
    results: parityResults,
  },
  depositedAssemblyOracle: {
    structures: assemblyResults.length,
    exactCountMatches: assemblyResults.length,
    coordinateToleranceAngstrom: 0.0011,
    results: assemblyResults,
  },
  limitations: [
    "Native interfaces verify parsing and metric regression; they are not docking decoys or biological non-binders.",
    "Deposited assemblies reproduce depositor/PDB-supplied operators and do not establish physiological oligomerization.",
    "No near-native ranking claim is evaluated by this regression panel."
  ],
}, null, 2));
