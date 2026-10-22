import assert from "node:assert/strict";
import test from "node:test";

import { analyzeInterface, parsePdb } from "../lib/confovhh.ts";
import {
  TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY,
  analyzeAnnotatedFootprint,
  createTopologyAnnotation,
  evaluateAnnotatedFootprint,
  validateNormalizedTopologyAnnotation,
} from "../lib/topology-annotation.ts";

function atomLine({ serial, chain, residue, x, y }) {
  return [
    "ATOM".padEnd(6), String(serial).padStart(5), " ", " CA ", " ", "ALA", " ", chain,
    String(residue).padStart(4), "    ", x.toFixed(3).padStart(8), y.toFixed(3).padStart(8),
    "   0.000", "  1.00", "80.00", "          C",
  ].join("");
}

function fixture({ separated = false } = {}) {
  const lines = ["TITLE     USER ANNOTATED TOPOLOGY"];
  let serial = 1;
  for (const [chain, y] of [["R", 0], ["V", separated ? 80 : 3.4]]) {
    for (let residue = 1; residue <= 6; residue += 1) {
      lines.push(atomLine({ serial: serial++, chain, residue, x: residue * 3.8, y }));
    }
  }
  lines.push("END");
  const structure = parsePdb(lines.join("\n"));
  const audit = analyzeInterface(structure, "R", "V", "none");
  return { structure, audit };
}

function input(overrides = {}) {
  return {
    intendedSide: "extracellular",
    extracellularResidues: "R:1, R:2",
    intracellularResidues: "R:3",
    transmembraneResidues: "R:4",
    annotationSource: "GPCRdb mapping 2026-08-28",
    ...overrides,
  };
}

test("reports unique receptor-contact overlap across mutually exclusive supplied classes", () => {
  const { structure, audit } = fixture();
  const analysis = analyzeAnnotatedFootprint(structure, "R", audit, input());
  assert.equal(analysis.result.interfaceResidueCount, 6);
  assert.equal(analysis.result.extracellularContactResidueCount, 2);
  assert.equal(analysis.result.intracellularContactResidueCount, 1);
  assert.equal(analysis.result.transmembraneContactResidueCount, 1);
  assert.equal(analysis.result.otherOrUnannotatedContactResidueCount, 2);
  assert.equal(analysis.result.annotationCoverage, 4 / 6);
  assert.equal(analysis.result.sideEvaluableCoverage, 3 / 6);
  assert.equal(analysis.result.intendedSideShare, 2 / 3);
  assert.equal(analysis.result.status, "mixed-side-overlap");
});

test("uses neutral all, none, descriptive, and insufficient statuses", () => {
  const { structure, audit } = fixture();
  const all = analyzeAnnotatedFootprint(structure, "R", audit, input({
    extracellularResidues: "R:1 R:2 R:3 R:4 R:5 R:6",
    intracellularResidues: "",
    transmembraneResidues: "",
  }));
  assert.equal(all.result.status, "all-side-evaluable-overlap-on-intended-side");
  const none = analyzeAnnotatedFootprint(structure, "R", audit, input({
    extracellularResidues: "",
    intracellularResidues: "R:1 R:2",
    transmembraneResidues: "",
  }));
  assert.equal(none.result.status, "no-intended-side-overlap");
  const descriptive = analyzeAnnotatedFootprint(structure, "R", audit, input({ intendedSide: "unspecified" }));
  assert.equal(descriptive.result.status, "descriptive-only");
  const separated = fixture({ separated: true });
  const insufficient = analyzeAnnotatedFootprint(separated.structure, "R", separated.audit, input());
  assert.equal(insufficient.result.status, "insufficient-annotation");
  assert.equal(insufficient.result.annotationCoverage, null);
  assert.equal(insufficient.result.intendedSideShare, null);
});

test("fails closed when one mapped residue is assigned to multiple classes", () => {
  const { structure, audit } = fixture();
  assert.throws(() => createTopologyAnnotation(structure, "R", audit, input({
    extracellularResidues: "R:1 R:2",
    intracellularResidues: "R:2 R:3",
  })), /both extracellular and intracellular|mutually exclusive/i);
});

test("surfaces unmapped identifiers without inferring wild-type or generic numbering", () => {
  const { structure, audit } = fixture();
  const annotation = createTopologyAnnotation(structure, "R", audit, input({
    extracellularResidues: "R:1, 7.53, R:999",
  }));
  assert.deepEqual(annotation.extracellular.unmapped.sort(), ["7.53", "R:999"]);
  assert.deepEqual(annotation.extracellularOrders, [1]);
  const changed = createTopologyAnnotation(structure, "R", audit, input({
    extracellularResidues: "R:1, 7.53, R:998",
  }));
  assert.notEqual(annotation.annotationFingerprint, changed.annotationFingerprint);
});

test("validates the complete normalized annotation trust boundary", () => {
  const { structure, audit } = fixture();
  const annotation = createTopologyAnnotation(structure, "R", audit, input());
  assert.doesNotThrow(() => validateNormalizedTopologyAnnotation(annotation, {
    receptorChain: "R",
    receptorSequence: structure.chains.find((chain) => chain.id === "R").sequence,
  }));
  for (const mutate of [
    (value) => { value.membraneCompatibilityAssessed = true; },
    (value) => { value.claimBoundary = "Membrane compatible"; },
    (value) => { value.extracellularOrders = [999]; },
    (value) => { value.intracellularOrders = [...value.intracellularOrders, value.extracellularOrders[0]]; },
    (value) => { value.annotationFingerprint = "fnv1a64-topology-v1:0000000000000000"; },
  ]) {
    const corrupted = structuredClone(annotation);
    mutate(corrupted);
    assert.throws(() => validateNormalizedTopologyAnnotation(corrupted), /invalid|inconsistent|fingerprint|mutually exclusive|boundary/i);
  }
});

test("propagates a reference annotation only by receptor sequence order", () => {
  const { structure, audit } = fixture();
  const annotation = createTopologyAnnotation(structure, "R", audit, input());
  const result = evaluateAnnotatedFootprint(annotation, [1, 2, 4, 6]);
  assert.equal(result.extracellularContactResidueCount, 2);
  assert.equal(result.intracellularContactResidueCount, 0);
  assert.equal(result.transmembraneContactResidueCount, 1);
  assert.equal(result.otherOrUnannotatedContactResidueCount, 1);
  assert.equal(result.intendedSideShare, 1);
});

test("rejects invalid or duplicate observed interface orders", () => {
  const { structure, audit } = fixture();
  const annotation = createTopologyAnnotation(structure, "R", audit, input());
  assert.throws(() => evaluateAnnotatedFootprint(annotation, [1, 1]), /duplicates/i);
  assert.throws(() => evaluateAnnotatedFootprint(annotation, [0]), /positive/i);
  assert.throws(() => evaluateAnnotatedFootprint(annotation, [1.5]), /positive/i);
});

test("normalizes bounded annotation source and produces deterministic fingerprints", () => {
  const { structure, audit } = fixture();
  const first = createTopologyAnnotation(structure, "R", audit, input({ annotationSource: "  GPCRdb\u200b  v1\n" }));
  const second = createTopologyAnnotation(structure, "R", audit, input({ annotationSource: "GPCRdb v1" }));
  assert.equal(first.annotationSource, "GPCRdb v1");
  assert.equal(first.annotationFingerprint, second.annotationFingerprint);
  assert.match(first.annotationFingerprint, /^fnv1a64-topology-v1:[0-9a-f]{16}$/);
});

test("exports explicit negative inference flags and the fixed claim boundary", () => {
  const { structure, audit } = fixture();
  const annotation = createTopologyAnnotation(structure, "R", audit, input());
  assert.equal(annotation.topologyInferencePerformed, false);
  assert.equal(annotation.membranePlaneUsed, false);
  assert.equal(annotation.membraneCompatibilityAssessed, false);
  assert.equal(annotation.claimBoundary, TOPOLOGY_ANNOTATION_CLAIM_BOUNDARY);
  assert.match(annotation.claimBoundary, /does not infer or validate a membrane plane/i);
  assert.doesNotMatch(JSON.stringify(annotation), /active-compatible|membrane-compatible|binding score/i);
});
