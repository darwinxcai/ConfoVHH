import assert from "node:assert/strict";
import test from "node:test";

import {
  IMGT_NUMBERING_ENGINE_V06,
  VHH_NUMBERING_V06_POLICY,
  numberVhhSequenceV06,
  validateImgtSegmentationAgreementV06,
} from "../lib/vhh-numbering-v06.ts";

const CANONICAL =
  "QVQLVQSGAEVKRPGSSVTVSCKASGGSFSTYALSWVRQAPGRGLEWMGGVIPLLTITNYAPRFQGRITITADRSTSTAYLELNSLRPEDTAVYYCAREGTTGKPIGAFAHWGQGTLVTVSS";

const NB35_SEQUENCE =
  "QVQLQESGGGLVQPGGSLRLSCAASGFTFSNYKMNWVRQAPGKGLEWVSDISQSGASISYTGSVKGRFTISRDNAKNTLYLQMNSLKPEDTAVYYCARCPAPFTRDCFDVTSTTYAYRGQGTQVTVSSHHHHHHEPEA";

const REGION_TO_SEGMENT = {
  "FR1-IMGT": "fr1",
  "CDR1-IMGT": "cdr1",
  "FR2-IMGT": "fr2",
  "CDR2-IMGT": "cdr2",
  "FR3-IMGT": "fr3",
  "CDR3-IMGT": "cdr3",
  "FR4-IMGT": "fr4",
};

function sequenceForRegion(annotation, region) {
  return annotation.residues
    .filter((residue) => residue.region === region)
    .map((residue) => residue.aminoAcid)
    .join("");
}

function segmentPayload(annotation) {
  return Object.fromEntries(Object.entries(REGION_TO_SEGMENT).map(([region, segment]) => [
    segment,
    sequenceForRegion(annotation, region),
  ]));
}

test("the v0.6 candidate freezes the corrected engine and strict fail-closed policy", () => {
  assert.equal(IMGT_NUMBERING_ENGINE_V06, "immunum 1.3.0");
  assert.deepEqual(VHH_NUMBERING_V06_POLICY, {
    version: "0.6.0-candidate.1",
    status: "development-candidate-not-integrated",
    scheme: "IMGT",
    engine: "immunum 1.3.0",
    minimumEngineConfidence: 0.5,
    completeSevenRegionCoverageRequired: true,
    numberingSegmentationAgreementRequired: true,
  });
});

test("the v0.6 candidate assigns complete, independently cross-checked IMGT regions", () => {
  const annotation = numberVhhSequenceV06(CANONICAL);
  assert.equal(annotation.status, "numbered");
  assert.equal(annotation.engine, "immunum 1.3.0");
  assert.equal(annotation.detectedChain, "H");
  assert.ok(annotation.confidence >= 0.5 && annotation.confidence <= 1);
  assert.equal(annotation.completeImgtRegionCoverage, true);
  assert.equal(annotation.numberingSegmentationAgreement, true);
  assert.equal(sequenceForRegion(annotation, "CDR1-IMGT"), "GGSFSTYA");
  assert.equal(sequenceForRegion(annotation, "CDR2-IMGT"), "VIPLLTIT");
  assert.equal(sequenceForRegion(annotation, "CDR3-IMGT"), "AREGTTGKPIGAFAH");
  assert.deepEqual(annotation.cdrLengths, { cdr1: 8, cdr2: 8, cdr3: 15 });
  for (const region of Object.keys(REGION_TO_SEGMENT)) {
    assert.ok(sequenceForRegion(annotation, region).length > 0, region);
  }
});

test("the corrected v0.6 candidate preserves the complete Nb35 21-residue CDR3", () => {
  const annotation = numberVhhSequenceV06(NB35_SEQUENCE);
  assert.equal(annotation.status, "numbered");
  assert.equal(annotation.engine, "immunum 1.3.0");
  assert.equal(
    sequenceForRegion(annotation, "CDR3-IMGT"),
    "ARCPAPFTRDCFDVTSTTYAY",
  );
  assert.equal(annotation.cdrLengths?.cdr3, 21);
  assert.equal(annotation.completeImgtRegionCoverage, true);
  assert.equal(annotation.numberingSegmentationAgreement, true);
  assert.ok((annotation.queryEnd ?? NB35_SEQUENCE.length) < NB35_SEQUENCE.length - 1);
});

test("the independent segmentation check fails closed on incomplete or disagreeing regions", () => {
  const annotation = numberVhhSequenceV06(CANONICAL);
  assert.equal(annotation.status, "numbered");
  const segments = segmentPayload(annotation);

  const incomplete = validateImgtSegmentationAgreementV06(
    annotation.residues,
    { ...segments, fr4: "" },
  );
  assert.equal(incomplete.completeImgtRegionCoverage, false);
  assert.equal(incomplete.numberingSegmentationAgreement, false);
  assert.equal(incomplete.cdrLengths, null);
  assert.match(incomplete.error ?? "", /nonempty FR1, CDR1, FR2, CDR2, FR3, CDR3, and FR4/i);

  const disagreeing = validateImgtSegmentationAgreementV06(
    annotation.residues,
    { ...segments, cdr3: `${segments.cdr3}A` },
  );
  assert.equal(disagreeing.completeImgtRegionCoverage, true);
  assert.equal(disagreeing.numberingSegmentationAgreement, false);
  assert.equal(disagreeing.cdrLengths, null);
  assert.match(disagreeing.error ?? "", /disagree/i);
});

test("the v0.6 candidate excludes terminal tags from all numbered regions", () => {
  const annotation = numberVhhSequenceV06(`HHHHHH${CANONICAL}GG`);
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

test("the v0.6 candidate normalizes case, rejects invalid input, and is deterministic", () => {
  const first = numberVhhSequenceV06(CANONICAL.toLowerCase());
  const second = numberVhhSequenceV06(CANONICAL);
  assert.deepEqual(first, second);

  const invalid = numberVhhSequenceV06(`${CANONICAL.slice(0, 20)}*${CANONICAL.slice(21)}`);
  assert.equal(invalid.status, "unavailable");
  assert.equal(invalid.completeImgtRegionCoverage, false);
  assert.equal(invalid.numberingSegmentationAgreement, false);
  assert.equal(invalid.cdrLengths, null);
  assert.match(invalid.error ?? "", /valid protein sequence/i);

  const lowComplexity = numberVhhSequenceV06("A".repeat(120));
  assert.equal(lowComplexity.status, "unavailable");
  assert.equal(lowComplexity.cdrLengths, null);
  assert.ok(lowComplexity.residues.every((residue) => residue.imgtPosition == null));
});
