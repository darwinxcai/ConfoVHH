import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeIntendedFootprint,
  observedFootprintIdentifiers,
  validateIntendedFootprintSummary,
} from "../lib/user-footprint.ts";

function residue(chainId, number, insertionCode, order, name = "ALA") {
  return {
    key: `${chainId}:${number}${insertionCode}`,
    chainId,
    name,
    number,
    insertionCode,
    order,
    oneLetter: "A",
    atoms: [],
  };
}

function structure() {
  const receptorResidues = [
    residue("R", 100, "", 1, "GLU"),
    residue("R", 101, "A", 2, "TYR"),
    residue("R", 102, "", 3, "ASP"),
  ];
  return {
    chains: [
      { id: "R", residueCount: 3, residues: receptorResidues },
      { id: "V", residueCount: 1, residues: [residue("V", 1, "", 1)] },
    ],
  };
}

const audit = {
  receptorChain: "R",
  receptorInterfaceKeys: ["R:100", "R:102"],
};

test("maps exact and selected-chain residue identifiers onto the observed footprint", () => {
  const summary = analyzeIntendedFootprint(
    structure(),
    "R",
    audit,
    "R:100, 101A; R:999 R:100",
  );
  assert.equal(summary.requestedCount, 3);
  assert.equal(summary.mappedCount, 2);
  assert.equal(summary.contactedCount, 1);
  assert.equal(summary.mappedContactShare, 0.5);
  assert.deepEqual(summary.unmapped, ["R:999"]);
  assert.deepEqual(summary.duplicateAliases, []);
  assert.deepEqual(summary.mapped.map((entry) => [entry.residueKey, entry.contacted]), [
    ["R:100", true],
    ["R:101A", false],
  ]);
  assert.equal(observedFootprintIdentifiers(summary), "R:100, R:102");
  assert.match(summary.interpretation, /not specificity/i);
  assert.doesNotThrow(() => validateIntendedFootprintSummary(summary, "R"));

  const tampered = structuredClone(summary);
  tampered.contactedCount += 1;
  assert.throws(() => validateIntendedFootprintSummary(tampered, "R"), /reconcile|invalid/i);
});

test("reports distinct aliases that map to one receptor residue without dropping requests", () => {
  const summary = analyzeIntendedFootprint(structure(), "R", audit, "R:100, 100, R:102");
  assert.equal(summary.requestedCount, 3);
  assert.equal(summary.mappedCount, 2);
  assert.equal(summary.contactedCount, 2);
  assert.deepEqual(summary.duplicateAliases, [{
    requestedIdentifier: "100",
    residueKey: "R:100",
    canonicalIdentifier: "R:100",
    canonicalRequestedIdentifier: "R:100",
  }]);
  assert.doesNotThrow(() => validateIntendedFootprintSummary(summary, "R"));

  const inconsistent = structuredClone(summary);
  inconsistent.mapped[0].contacted = false;
  assert.throws(() => validateIntendedFootprintSummary(inconsistent, "R"), /reconcile/i);
});

test("retains the complete observed footprint when no intended residues are supplied", () => {
  const summary = analyzeIntendedFootprint(structure(), "R", audit, "");
  assert.equal(summary.requestedCount, 0);
  assert.deepEqual(summary.duplicateAliases, []);
  assert.equal(summary.mappedContactShare, null);
  assert.deepEqual(summary.observedReceptorFootprint.map((entry) => entry.coordinateLabel), [
    "GLU R:100",
    "ASP R:102",
  ]);
});

test("copied canonical identifiers round-trip even when internal residue keys contain delimiters", () => {
  const source = structure();
  source.chains[0].id = "R,copy";
  source.chains[0].residues = source.chains[0].residues.map((entry) => ({
    ...entry,
    chainId: "R,copy",
    key: JSON.stringify(["R,copy", entry.number, entry.insertionCode, entry.order]),
  }));
  const contactedKey = source.chains[0].residues[0].key;
  const sourceAudit = { receptorChain: "R,copy", receptorInterfaceKeys: [contactedKey] };
  const first = analyzeIntendedFootprint(source, "R,copy", sourceAudit, "R%2Ccopy:100");
  const copied = observedFootprintIdentifiers(first);
  assert.equal(copied, "R%2Ccopy:100");
  const second = analyzeIntendedFootprint(source, "R,copy", sourceAudit, copied);
  assert.equal(second.mappedCount, 1);
  assert.equal(second.contactedCount, 1);
});

test("rejects mismatched audit chains and bounded-input violations", () => {
  assert.throws(
    () => analyzeIntendedFootprint(structure(), "R", { ...audit, receptorChain: "X" }, "R:100"),
    /does not match/i,
  );
  assert.throws(
    () => analyzeIntendedFootprint(structure(), "R", audit, "x".repeat(1_001)),
    /1,000-character/i,
  );
  assert.throws(
    () => analyzeIntendedFootprint(
      structure(),
      "R",
      audit,
      Array.from({ length: 201 }, (_, index) => String.fromCodePoint(0x1000 + index)).join(","),
    ),
    /200 unique/i,
  );
});
