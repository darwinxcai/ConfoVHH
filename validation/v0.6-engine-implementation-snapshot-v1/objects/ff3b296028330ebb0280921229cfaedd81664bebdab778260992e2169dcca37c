import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  analyzeInterface,
  CONFOVHH_VERSION,
  parsePdb,
  suggestChains,
} from "../lib/confovhh.ts";
import { downloadPublicCoordinate } from "./public-coordinate-download.mjs";

const PANEL = [
  { pdb: "3P0G", receptor: "A", vhh: "B", receptorName: "ADRB2", expectedContacts: 46, biopythonDeltaSasa: 1728.394165 },
  { pdb: "4MQS", receptor: "A", vhh: "B", receptorName: "CHRM2" },
  { pdb: "4XT1", receptor: "A", vhh: "C", receptorName: "US28", expectedContacts: 59, biopythonDeltaSasa: 2222.908872 },
  { pdb: "6DO1", receptor: "A", vhh: "C", receptorName: "AGTR1", expectedContacts: 60, biopythonDeltaSasa: 2246.608720 },
  { pdb: "6B73", receptor: "B", vhh: "C", receptorName: "OPRK1" },
  { pdb: "6RNK", receptor: "A", vhh: "B", receptorName: "SUCNR1" },
  { pdb: "6KNM", receptor: "B", vhh: "A", receptorName: "APLNR" },
  { pdb: "7YM8", receptor: "A", vhh: "D", receptorName: "ADRA1A" },
  { pdb: "8QOT", receptor: "A", vhh: "B", receptorName: "OPRM1" },
  { pdb: "8FCZ", receptor: "A", vhh: "C", receptorName: "RHO" },
  { pdb: "7L1V", receptor: "R", vhh: "S", receptorName: "HCRTR2" },
  { pdb: "6O3C", receptor: "A", vhh: "B", receptorName: "SMO" },
  { pdb: "8QW4", receptor: "A", vhh: "B", receptorName: "FZD3" },
  { pdb: "5JQH", receptor: "A", vhh: "C", receptorName: "ADRB2 inactive" },
  { pdb: "6VI4", receptor: "B", vhh: "C", receptorName: "OPRK1 inactive" },
  { pdb: "5C1M", receptor: "A", vhh: "B", receptorName: "OPRM1/Nb39", expectedContacts: 57, biopythonDeltaSasa: 2389.630672 },
  { pdb: "6IBL", receptor: "A", vhh: "C", receptorName: "ADRB1/Nb80", expectedContacts: 72, biopythonDeltaSasa: 2364.210811 },
];

async function downloadPdb(pdb) {
  const url = `https://files.rcsb.org/download/${pdb}.pdb`;
  return downloadPublicCoordinate(url, pdb);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const DECOY_TRANSLATIONS = [
  [1_000, 0, 0],
  [-1_000, 0, 0],
  [0, 1_000, 0],
  [0, -1_000, 0],
  [0, 0, 1_000],
  [0, 0, -1_000],
];

function translatedDecoy(structure, vhhChainId, [dx, dy, dz]) {
  const decoy = structuredClone(structure);
  const chain = decoy.chains.find((candidate) => candidate.id === vhhChainId);
  assert.ok(chain, `Missing ${vhhChainId} while creating decoy`);
  for (const residue of chain.residues) {
    for (const atom of residue.atoms) {
      atom.x += dx;
      atom.y += dy;
      atom.z += dz;
    }
  }
  return decoy;
}

function translatedComplex(structure, [dx, dy, dz]) {
  const translated = structuredClone(structure);
  for (const chain of translated.chains) {
    for (const residue of chain.residues) {
      for (const atom of residue.atoms) {
        atom.x += dx;
        atom.y += dy;
        atom.z += dz;
      }
    }
  }
  return translated;
}

const downloads = new Map();
await Promise.all(PANEL.map(async ({ pdb }) => {
  if (!downloads.has(pdb)) downloads.set(pdb, downloadPdb(pdb));
}));

const results = [];
for (const specification of PANEL) {
  const sourceBytes = await downloads.get(specification.pdb);
  const text = sourceBytes.toString("utf8");
  const structure = parsePdb(text);
  const available = new Set(structure.chains.map((chain) => chain.id));
  assert.ok(available.has(specification.receptor), `${specification.pdb}: missing receptor chain ${specification.receptor}`);
  assert.ok(available.has(specification.vhh), `${specification.pdb}: missing VHH chain ${specification.vhh}`);

  const started = performance.now();
  const audit = analyzeInterface(
    structure,
    specification.receptor,
    specification.vhh,
    "none",
  );
  const runtimeMs = performance.now() - started;
  assert.ok(audit.contactPairCount >= 15, `${specification.pdb}: unexpectedly narrow native interface`);
  assert.ok(audit.deltaSasaAngstrom2 >= 500, `${specification.pdb}: unexpectedly low native ΔSASA`);
  assert.notEqual(audit.evidenceLevel, "not-assessable", `${specification.pdb}: native interface not detected`);

  if (specification.expectedContacts != null) {
    assert.equal(audit.contactPairCount, specification.expectedContacts, `${specification.pdb}: 4.5 Å contact regression`);
  }
  if (specification.biopythonDeltaSasa != null) {
    const relativeError = Math.abs(
      audit.deltaSasaAngstrom2 - specification.biopythonDeltaSasa,
    ) / specification.biopythonDeltaSasa;
    assert.ok(relativeError <= 0.015, `${specification.pdb}: ΔSASA differs from Biopython by ${(relativeError * 100).toFixed(2)}%`);
  }

  const translatedNative = analyzeInterface(
    translatedComplex(structure, [137, -251, 89]),
    specification.receptor,
    specification.vhh,
    "none",
  );
  assert.equal(
    translatedNative.contactPairCount,
    audit.contactPairCount,
    `${specification.pdb}: whole-complex translation changed contact count`,
  );
  assert.ok(
    Math.abs(translatedNative.deltaSasaAngstrom2 - audit.deltaSasaAngstrom2) <= 1e-6,
    `${specification.pdb}: whole-complex translation changed ΔSASA`,
  );

  const decoys = DECOY_TRANSLATIONS.map((translation) => analyzeInterface(
    translatedDecoy(structure, specification.vhh, translation),
    specification.receptor,
    specification.vhh,
    "none",
  ));
  for (const [index, decoy] of decoys.entries()) {
    const axis = DECOY_TRANSLATIONS[index].join(",");
    assert.equal(decoy.contactPairCount, 0, `${specification.pdb}: translated decoy ${axis} retained contacts`);
    assert.equal(decoy.deltaSasaAngstrom2, 0, `${specification.pdb}: translated decoy ${axis} retained burial`);
  }

  results.push({
    pdb: specification.pdb,
    sourceBytes: sourceBytes.byteLength,
    sourceSha256: sha256(sourceBytes),
    receptor: specification.receptorName,
    pair: `${specification.receptor}:${specification.vhh}`,
    contactPairs: audit.contactPairCount,
    deltaSasaAngstrom2: Number(audit.deltaSasaAngstrom2.toFixed(1)),
    interfaceAreaAngstrom2: Number(audit.halfDeltaSasaInterfaceAreaAngstrom2.toFixed(1)),
    severeClashPairs: audit.severeClashCount,
    imgtNumbering: audit.vhhNumbering.status,
    evidenceBand: audit.evidenceLevel,
    wholeComplexTranslationInvariant: true,
    translatedControlsRejected: decoys.length,
    runtimeMs: Math.round(runtimeMs),
  });
}

const sixIbl = parsePdb((await downloads.get("6IBL")).toString("utf8"));
const suggestion = suggestChains(sixIbl);
assert.ok(
  (suggestion.receptorChain === "A" && suggestion.vhhChain === "C") ||
  (suggestion.receptorChain === "B" && suggestion.vhhChain === "D"),
  `6IBL: pair-aware suggestion chose ${suggestion.receptorChain}:${suggestion.vhhChain}`,
);

console.log(JSON.stringify({
  schemaVersion: "1.0.0",
  softwareVersion: CONFOVHH_VERSION,
  benchmark: "ConfoVHH public GPCR–VHH structural panel",
  structures: results.length,
  nativeInterfacesDetected: results.filter((result) => result.contactPairs > 0).length,
  wholeComplexTranslationsInvariant: results.filter((result) => result.wholeComplexTranslationInvariant).length,
  translatedDecoysRejected: results.reduce((sum, result) => sum + result.translatedControlsRejected, 0),
  translatedDecoysPerStructure: DECOY_TRANSLATIONS.length,
  independentDeltaSasaRegressions: PANEL.filter((entry) => entry.biopythonDeltaSasa != null).length,
  results,
}, null, 2));
