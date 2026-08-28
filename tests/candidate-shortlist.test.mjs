import assert from "node:assert/strict";
import test from "node:test";
import { candidateShortlistToCsv, createCandidateShortlistReport, normalizeCandidateDecision } from "../lib/candidate-shortlist.ts";

const pose = (id, filename, sha, rank) => ({
  id, isReference: rank === 1, provider: "boltz", poseKey: String(rank), variant: null,
  coordinate: { fileId: id, path: filename, filename, sha256: sha, bytes: 10 },
  chains: { receptor: "A", vhh: "B", mappingBasis: "unique-exact-sequence-propagation" },
  singleAudit: { audit: { evidenceLevel: "supported", contactPairCount: 12, severeClashCount: 0 } },
  pae: { conservativeLargerDirectionMedianAngstrom: 4.2, contactPairShareAtOrBelow10Angstrom: 0.9 },
  topology: null,
});

const result = {
  schemaVersion: "1.0.0", productRelease: "0.7.0", engineVersion: "0.5.0", referenceCoordinateFileId: "p1",
  coordinateEnsemble: { poses: [{ sha256: "a".repeat(64), rank: 1 }, { sha256: "b".repeat(64), rank: 2 }] },
  poseAudits: [pose("p1", "pose1.cif", "a".repeat(64), 1), pose("p2", "pose2.cif", "b".repeat(64), 2)],
};

test("shortlist binds researcher decisions to audited pose provenance", () => {
  const report = createCandidateShortlistReport(result, { p1: { disposition: "advance", note: "order DNA" } }, "2026-08-28T00:00:00.000Z");
  assert.deepEqual(report.counts, { unreviewed: 1, advance: 1, hold: 0, reject: 0 });
  assert.equal(report.rows[0].recurrenceRank, 1);
  assert.equal(report.rows[0].researcherNote, "order DNA");
  assert.match(report.interpretation, /researcher-authored/i);
});

test("decision normalization is bounded and fail-closed", () => {
  assert.deepEqual(normalizeCandidateDecision({ disposition: "invented", note: "a\u0000b" }), { disposition: "unreviewed", note: "ab" });
  assert.equal(normalizeCandidateDecision({ disposition: "hold", note: "x".repeat(900) }).note.length, 500);
});

test("shortlist CSV neutralizes spreadsheet formulas", () => {
  const report = createCandidateShortlistReport(result, { p1: { disposition: "hold", note: "=HYPERLINK(1)" } }, "2026-08-28T00:00:00.000Z");
  const csv = candidateShortlistToCsv(report);
  assert.match(csv, /"'=HYPERLINK\(1\)"/);
  assert.equal(csv.split("\n").length, 3);
});
