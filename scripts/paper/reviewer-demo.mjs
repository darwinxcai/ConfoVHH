// An offline, generated example. No native structures, prediction outputs,
// labels, external datasets, or network services are read by this script.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeInterface, parsePdb } from "../../lib/confovhh.ts";
import { createSingleAuditExportReport } from "../../lib/audit-export.ts";
import { validateImportedSingleAuditReport } from "../../lib/research-workspace.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const GENERATED_AT = "2026-09-08T00:00:00.000Z";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function syntheticPdb(separation) {
  const lines = ["TITLE     SYNTHETIC SOFTWARE EXAMPLE - NOT A PROTEIN MODEL"];
  const atoms = [];
  for (const [chain, y] of [["R", 0], ["V", separation]]) {
    for (let residue = 1; residue <= 4; residue++) {
      for (const [name, dx, dy, z, element] of [
        ["N", -1.1, 0, 0, "N"], ["CA", 0, 0, 0, "C"],
        ["C", 1.1, 0, 0.2, "C"], ["O", 1.4, 0.7, 0.4, "O"],
      ]) {
        const atom = { chain, residue, x: residue * 3.8 + dx, y: y + dy, z };
        atoms.push(atom);
        lines.push([
          "ATOM  ", String(atoms.length).padStart(5), " ", name.padStart(4),
          " ALA ", chain, String(residue).padStart(4), "    ",
          ...[atom.x, atom.y, atom.z].map(value => value.toFixed(3).padStart(8)),
          "  1.00", "80.00", "          ", element.padStart(2),
        ].join(""));
      }
    }
  }
  return { pdb: `${lines.join("\n")}\nEND\n`, atoms };
}

// Exhaustive distance enumeration is independent of the production spatial grid.
function contactOracle(atoms) {
  const pairs = new Set();
  let atomContacts = 0;
  for (const r of atoms.filter(a => a.chain === "R")) {
    for (const v of atoms.filter(a => a.chain === "V")) {
      if (Math.hypot(r.x - v.x, r.y - v.y, r.z - v.z) <= 4.5) {
        atomContacts++;
        pairs.add(`${r.residue}:${v.residue}`);
      }
    }
  }
  return { residuePairs: pairs.size, atomContacts };
}

export function runReviewerDemo() {
  const artifacts = {};
  const cases = [];
  for (const [name, separation] of [["near", 3.4], ["separated", 100]]) {
    const { pdb, atoms } = syntheticPdb(separation);
    const structure = parsePdb(pdb);
    const audit = analyzeInterface(structure, "R", "V", "none", null, false);
    const expected = contactOracle(atoms);
    assert.equal(structure.atoms.length, 32);
    assert.equal(audit.contactPairCount, expected.residuePairs);
    assert.equal(audit.atomContactCount, expected.atomContacts);
    assert.equal(audit.interfacePaeMedianAngstrom, null);
    const report = createSingleAuditExportReport({
      filename: `synthetic-${name}.pdb`, coordinateSha256: sha(pdb),
      coordinateBytes: Buffer.byteLength(pdb), structure,
      receptorChain: "R", vhhChain: "V", chainIdentityConfirmed: true,
      pae: null, paeSha256: null, paeOrderConfirmed: false, audit,
      generatedAt: GENERATED_AT,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    assert.deepEqual(validateImportedSingleAuditReport(JSON.parse(json)), report);
    const tampered = JSON.parse(json);
    tampered.audit.contactPairCount += 1;
    assert.throws(() => validateImportedSingleAuditReport(tampered));
    artifacts[`synthetic-${name}.pdb`] = pdb;
    artifacts[`synthetic-${name}.audit.json`] = json;
    cases.push({ name, coordinateSha256: sha(pdb), ...expected, exportRoundTrip: true, tamperedResultRejected: true });
  }
  assert.ok(cases[0].residuePairs > 0);
  assert.equal(cases[1].residuePairs, 0);
  return { artifacts, cases };
}

async function sourceHashes(directory = "lib") {
  const records = {};
  for (const entry of (await readdir(path.join(ROOT, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(records, await sourceHashes(relative));
    else if (entry.isFile() && entry.name.endsWith(".ts")) records[relative] = sha(await readFile(path.join(ROOT, relative)));
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || args[0].startsWith("--output=")), "Usage: node scripts/paper/reviewer-demo.mjs [--output=NEW_DIRECTORY]");
  const { artifacts, cases } = runReviewerDemo();
  const sourceSha256 = await sourceHashes();
  for (const relative of ["package-lock.json", "scripts/paper/reviewer-demo.mjs"]) sourceSha256[relative] = sha(await readFile(path.join(ROOT, relative)));
  const receipt = {
    schemaVersion: "1.0.0", scope: "synthetic software demonstration only",
    nodeVersion: process.version, sourceSha256, cases,
    artifactSha256: Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, sha(bytes)])),
    boundaries: { nativeOrPredictionDataRead: false, networkUsed: false, biologicalValidation: false, independentEligibleGroupsAdded: 0 },
  };
  if (args.length) {
    const destination = path.resolve(args[0].slice("--output=".length));
    await mkdir(destination); // Require a new directory; never overwrite a review.
    for (const [name, bytes] of Object.entries(artifacts)) await writeFile(path.join(destination, name), bytes, { flag: "wx" });
    await writeFile(path.join(destination, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
