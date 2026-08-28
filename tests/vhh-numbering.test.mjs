import assert from "node:assert/strict";
import test from "node:test";

import { imgtRegion, numberVhhSequence } from "../lib/vhh-numbering.ts";

// Public VHH example used by the pinned immunum project documentation:
// https://github.com/ENPICOM/immunum
const CANONICAL =
  "QVQLVQSGAEVKRPGSSVTVSCKASGGSFSTYALSWVRQAPGRGLEWMGGVIPLLTITNYAPRFQGRITITADRSTSTAYLELNSLRPEDTAVYYCAREGTTGKPIGAFAHWGQGTLVTVSS";

function sequenceForRegion(annotation, region) {
  return annotation.residues
    .filter((residue) => residue.region === region)
    .map((residue) => residue.aminoAcid)
    .join("");
}

test("assigns formal IMGT-scheme positions and expected CDR segments", () => {
  const annotation = numberVhhSequence(CANONICAL);
  assert.equal(annotation.status, "numbered");
  assert.equal(annotation.detectedChain, "H");
  assert.ok(annotation.confidence >= 0.5 && annotation.confidence <= 1);
  assert.equal(sequenceForRegion(annotation, "CDR1-IMGT"), "GGSFSTYA");
  assert.equal(sequenceForRegion(annotation, "CDR2-IMGT"), "VIPLLTIT");
  assert.equal(sequenceForRegion(annotation, "CDR3-IMGT"), "AREGTTGKPIGAFAH");
  assert.deepEqual(annotation.cdrLengths, { cdr1: 8, cdr2: 8, cdr3: 15 });
});

test("maps every IMGT FR/CDR boundary exactly", () => {
  const expected = new Map([
    ["26", "FR1-IMGT"], ["27", "CDR1-IMGT"], ["38", "CDR1-IMGT"],
    ["39", "FR2-IMGT"], ["55", "FR2-IMGT"], ["56", "CDR2-IMGT"],
    ["65", "CDR2-IMGT"], ["66", "FR3-IMGT"], ["104", "FR3-IMGT"],
    ["105", "CDR3-IMGT"], ["117", "CDR3-IMGT"], ["118", "FR4-IMGT"],
    ["128", "FR4-IMGT"],
  ]);
  for (const [position, region] of expected) assert.equal(imgtRegion(position), region);
  assert.equal(imgtRegion("111A"), "CDR3-IMGT");
  assert.equal(imgtRegion("129"), "Outside numbered V-domain");
  assert.equal(imgtRegion(null), "Outside numbered V-domain");
});

test("leaves terminal tags outside the numbered V-domain", () => {
  const annotation = numberVhhSequence(`HHHHHH${CANONICAL}GG`);
  assert.equal(annotation.status, "numbered");
  assert.equal(annotation.queryStart, 6);
  assert.equal(annotation.queryEnd, 6 + CANONICAL.length - 1);
  assert.ok(annotation.residues.slice(0, 6).every(
    (residue) => residue.region === "Outside numbered V-domain",
  ));
  assert.ok(annotation.residues.slice(-2).every(
    (residue) => residue.region === "Outside numbered V-domain",
  ));
});

test("retains long-CDR3 IMGT insertion labels instead of treating them as raw offsets", () => {
  // Public ANARCI compatibility example from issue #14 (May 2021):
  // https://github.com/oxpig/ANARCI/issues/14
  const sequence =
    "EVQLVESGGGLVQPGGSLRLSCAASGIILDYYPIGWFRQAPGKEREGVAFITNSDDSTIYTNYADSVKGRFTISRDKNSLYLQMNSLRAEDTAVYYCSSKASFLIGKDDQGIDAGEYDYWGQGTMVTVSS";
  const annotation = numberVhhSequence(sequence);
  assert.equal(annotation.status, "numbered");
  const cdr3Positions = annotation.residues
    .filter((residue) => residue.region === "CDR3-IMGT")
    .map((residue) => residue.imgtPosition);
  assert.ok(cdr3Positions.some((position) => /[A-Z]$/.test(position ?? "")));
  assert.ok((annotation.cdrLengths?.cdr3 ?? 0) > 13);
});

test("normalizes lowercase sequence input", () => {
  const annotation = numberVhhSequence(CANONICAL.toLowerCase());
  assert.equal(annotation.status, "numbered");
  assert.equal(annotation.residues[0].aminoAcid, "Q");
});

test("fails closed for a low-complexity non-antibody chain", () => {
  const annotation = numberVhhSequence("A".repeat(120));
  assert.equal(annotation.status, "unavailable");
  assert.equal(annotation.confidence, null);
  assert.equal(annotation.cdrLengths, null);
  assert.ok(annotation.residues.every((residue) => residue.imgtPosition == null));
});

test("rejects characters outside the supported protein alphabet", () => {
  const annotation = numberVhhSequence(`${CANONICAL.slice(0, 20)}*${CANONICAL.slice(21)}`);
  assert.equal(annotation.status, "unavailable");
  assert.match(annotation.error ?? "", /valid protein sequence/i);
});

test("numbering is deterministic across repeated calls", () => {
  const first = numberVhhSequence(CANONICAL);
  const second = numberVhhSequence(CANONICAL);
  assert.deepEqual(first, second);
});
