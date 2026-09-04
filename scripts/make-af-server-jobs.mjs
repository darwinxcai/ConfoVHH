#!/usr/bin/env node
/**
 * Build AlphaFold Server job JSON for the panel receptor–VHH pairs.
 *
 * Purpose: every pose ConfoVHH has been scored against so far was made by
 * rigidly perturbing a solved structure. That distribution is tidy in a way real
 * prediction output is not. To test the ranking on real prediction errors we
 * need real predictions, and this emits the job file that produces them.
 *
 * Two decisions here are load-bearing, and both are about not fooling ourselves:
 *
 *   useStructureTemplate: false
 *     The AlphaFold Server default is TRUE. Every one of these complexes is a
 *     solved PDB entry, so with templates on the model is handed the answer and
 *     returns a near-copy of it. That would produce a job that costs quota and
 *     measures nothing. Templates off does NOT remove memorisation — these
 *     entries are in the training data — but it removes the most direct route.
 *
 *   SEQRES, not observed residues
 *     The deposited coordinates omit disordered residues. Predicting only the
 *     observed subset would be predicting a different molecule. SEQRES is the
 *     construct that was actually crystallised.
 *
 * Sources are verified against the byte count and SHA-256 already frozen in the
 * v0.5 public regression attestation before any sequence is read, so the job
 * file is bound to the same structures the ranking study used.
 *
 * Usage:
 *   node scripts/make-af-server-jobs.mjs [--pdbs 3P0G,4MQS] [--out jobs.json]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPEC = path.join(ROOT, "validation", "panel-extension-v1", "study-spec.json");
const ATTESTATION = path.join(
  ROOT, "validation", "v0.5-public-regression-attestation-v1", "native-interfaces.json",
);
const WORK = path.join(ROOT, ".af-server-work");

const THREE_TO_ONE = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G",
  HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S",
  THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  // Common modified residues, mapped to their parent. AlphaFold Server accepts
  // only the 20 standard types, so anything else is dropped and counted.
  MSE: "M", SEP: "S", TPO: "T", PTR: "Y", CSO: "C", HYP: "P", MLY: "K", KCX: "K",
  CME: "C", CSD: "C", OCS: "C", PCA: "Q", FME: "M", M3L: "K", ALY: "K",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read SEQRES for one chain. SEQRES is the deposited construct sequence, which
 * is what a predictor should be given; ATOM records would silently drop every
 * disordered loop.
 */
function seqresFor(text, chainId) {
  const residues = [];
  let dropped = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("SEQRES")) continue;
    if (line[11] !== chainId) continue;
    for (const token of line.slice(19, 70).trim().split(/\s+/u)) {
      if (!token) continue;
      const single = THREE_TO_ONE[token];
      if (single) residues.push(single);
      else dropped += 1;
    }
  }
  return { sequence: residues.join(""), dropped };
}

const args = process.argv.slice(2);
const pdbIndex = args.indexOf("--pdbs");
const wanted = pdbIndex === -1
  ? null
  : new Set(args[pdbIndex + 1].split(",").map((value) => value.trim().toUpperCase()));
const outIndex = args.indexOf("--out");
const outPath = path.join(ROOT, outIndex === -1 ? "af-server-jobs.json" : args[outIndex + 1]);

const spec = JSON.parse(await readFile(SPEC, "utf8"));
const attested = new Map(
  JSON.parse(await readFile(ATTESTATION, "utf8")).results.map((row) => [row.pdb, row]),
);
const targets = spec.targets.filter((target) => !wanted || wanted.has(target.pdb));
assert.ok(targets.length, "No targets selected");

await mkdir(WORK, { recursive: true });
const jobs = [];
const report = [];

for (const target of targets) {
  const expected = attested.get(target.pdb);
  assert.ok(expected, `${target.pdb} is absent from the v0.5 attestation`);

  const cachePath = path.join(WORK, `${target.pdb}.pdb`);
  let bytes;
  try {
    bytes = await readFile(cachePath);
  } catch {
    const response = await fetch(`https://files.rcsb.org/download/${target.pdb}.pdb`);
    assert.ok(response.ok, `${target.pdb}: download failed with HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(cachePath, bytes);
  }
  assert.equal(bytes.byteLength, expected.sourceBytes, `${target.pdb}: byte count differs from the attestation`);
  assert.equal(sha256(bytes), expected.sourceSha256, `${target.pdb}: SHA-256 differs from the attestation`);

  const text = bytes.toString("utf8");
  const receptor = seqresFor(text, target.receptorChain);
  const vhh = seqresFor(text, target.vhhChain);
  assert.ok(receptor.sequence.length > 100, `${target.pdb}: receptor chain ${target.receptorChain} SEQRES looks too short (${receptor.sequence.length})`);
  assert.ok(vhh.sequence.length > 80, `${target.pdb}: VHH chain ${target.vhhChain} SEQRES looks too short (${vhh.sequence.length})`);

  jobs.push({
    name: `${target.pdb}_${target.receptorChain}${target.vhhChain}_notemplate`,
    modelSeeds: [],
    sequences: [
      { proteinChain: { sequence: receptor.sequence, count: 1, useStructureTemplate: false } },
      { proteinChain: { sequence: vhh.sequence, count: 1, useStructureTemplate: false } },
    ],
    dialect: "alphafoldserver",
    version: 1,
  });

  report.push({
    pdb: target.pdb,
    receptor: target.receptor,
    component: target.component,
    pilotReuse: target.pilotReuse,
    receptorChain: target.receptorChain,
    receptorResidues: receptor.sequence.length,
    vhhChain: target.vhhChain,
    vhhResidues: vhh.sequence.length,
    nonStandardResiduesDropped: receptor.dropped + vhh.dropped,
    totalResidues: receptor.sequence.length + vhh.sequence.length,
  });
}

await writeFile(outPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  wrote: path.relative(ROOT, outPath),
  jobs: jobs.length,
  templatesDisabled: true,
  sequenceSource: "SEQRES",
  sourcesVerifiedAgainstFrozenAttestation: true,
  targets: report,
}, null, 2)}\n`);
