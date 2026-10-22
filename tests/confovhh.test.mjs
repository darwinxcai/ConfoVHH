import assert from "node:assert/strict";
import test from "node:test";

import { analyzeInterface, parsePdb, suggestChains } from "../lib/confovhh.ts";

function atomLine({ serial, atomName, residueName = "ALA", chain, residueNumber, x, y, z, element, bFactor = 85 }) {
  return [
    "ATOM  ",
    String(serial).padStart(5),
    " ",
    atomName.padStart(4),
    " ",
    residueName.padStart(3),
    " ",
    chain,
    String(residueNumber).padStart(4),
    "    ",
    x.toFixed(3).padStart(8),
    y.toFixed(3).padStart(8),
    z.toFixed(3).padStart(8),
    "  1.00",
    bFactor.toFixed(2).padStart(6),
    "          ",
    element.padStart(2),
  ].join("");
}

function chainLines(chain, residueCount, yForResidue) {
  const lines = [];
  let serial = chain === "A" ? 1 : 10_001;
  for (let residueNumber = 1; residueNumber <= residueCount; residueNumber += 1) {
    const x = residueNumber * 3.8;
    const y = yForResidue(residueNumber);
    lines.push(atomLine({
      serial: serial++, atomName: "N", chain, residueNumber,
      x: x - 1.15, y, z: 0, element: "N",
    }));
    lines.push(atomLine({
      serial: serial++, atomName: "CA", chain, residueNumber,
      x, y, z: 0, element: "C",
    }));
    lines.push(atomLine({
      serial: serial++, atomName: "O", chain, residueNumber,
      x: x + 1.15, y, z: 0, element: "O",
    }));
  }
  return lines;
}

function fixture({ near = true, clash = false } = {}) {
  return [
    "TITLE     SYNTHETIC GPCR VHH TEST",
    ...chainLines("A", 180, () => 0),
    ...chainLines("B", 100, (residueNumber) => {
      if (!near || residueNumber > 10) return 30;
      return clash && residueNumber === 1 ? 0.5 : 3.1;
    }),
    "END",
  ].join("\n");
}

test("parses protein chains and proposes the size-plausible assignment", () => {
  const structure = parsePdb(fixture());
  assert.equal(structure.chains.length, 2);
  assert.equal(structure.chains.find((chain) => chain.id === "A")?.residueCount, 180);
  assert.equal(structure.chains.find((chain) => chain.id === "B")?.residueCount, 100);
  assert.deepEqual(suggestChains(structure), { receptorChain: "A", vhhChain: "B" });
});

test("finds an interface with typed distance evidence and bounded labels", () => {
  const structure = parsePdb(fixture());
  const audit = analyzeInterface(structure, "A", "B", "plddt");
  assert.ok(audit.contactPairCount > 0);
  assert.ok(audit.receptorInterfaceResidues > 0);
  assert.ok(audit.vhhInterfaceResidues > 0);
  assert.ok(audit.polarContactProxyCount > 0);
  assert.ok(["supported", "mixed", "limited"].includes(audit.evidenceLevel));
  assert.equal(audit.interfaceConfidence, 85);
  assert.match(audit.rationale, /geometry|pose/i);
});

test("reports no assessable interface for separated chains and leaves B-factors uninterpreted", () => {
  const structure = parsePdb(fixture({ near: false }));
  const audit = analyzeInterface(structure, "A", "B", "none");
  assert.equal(audit.contactPairCount, 0);
  assert.equal(audit.evidenceLevel, "not-assessable");
  assert.equal(audit.interfaceConfidence, null);
});

test("rejects a same-chain audit", () => {
  const structure = parsePdb(fixture());
  assert.throws(
    () => analyzeInterface(structure, "A", "A", "none"),
    /two different chains/i,
  );
});

test("bars the top evidence band when a severe overlap is present", () => {
  const structure = parsePdb(fixture({ clash: true }));
  const audit = analyzeInterface(structure, "A", "B", "plddt");
  assert.ok(audit.severeClashCount > 0);
  assert.ok(audit.maximumOverlapAngstrom >= 0.6);
  assert.notEqual(audit.evidenceLevel, "supported");
});
