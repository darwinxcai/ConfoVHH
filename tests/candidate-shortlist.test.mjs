import assert from "node:assert/strict";
import test from "node:test";
import { candidateShortlistToCsv, createCandidateShortlistReport, normalizeCandidateDecision } from "../lib/candidate-shortlist.ts";

const pose = (id, filename, sha, rank) => ({
  id, isReference: rank === 1, provider: "boltz", poseKey: String(rank), variant: null,
  coordinate: { fileId: id, path: filename, filename, sha256: sha, bytes: 10 },
  chains: { receptor: "A", vhh: "B", mappingBasis: "unique-exact-sequence-propagation" },
  singleAudit: { audit: {
    evidenceLevel: "supported",
    contactPairCount: 12,
    severeClashCount: 0,
    auditAttestation: { resultFingerprint: `audit-${id}` },
  } },
  pae: {
    sha256: rank === 1 ? "c".repeat(64) : null,
    conservativeLargerDirectionMedianAngstrom: 4.2,
    contactPairShareAtOrBelow10Angstrom: 0.9,
  },
  topology: null,
});

const result = {
  schemaVersion: "1.0.0", productRelease: "0.9.0", engineVersion: "0.5.0", referenceCoordinateFileId: "p1",
  coordinateEnsemble: { poses: [{ sha256: "a".repeat(64), rank: 1 }, { sha256: "b".repeat(64), rank: 2 }] },
  poseAudits: [pose("p1", "pose1.cif", "a".repeat(64), 1), pose("p2", "pose2.cif", "b".repeat(64), 2)],
};

test("shortlist binds researcher decisions to audited pose provenance", () => {
  const report = createCandidateShortlistReport(
    result,
    { p1: { disposition: "advance", note: "order DNA" } },
    "2026-08-28T00:00:00.000Z",
    "fnv1a64-topology-v1:0123456789abcdef",
  );
  assert.deepEqual(report.counts, { unreviewed: 1, advance: 1, hold: 0, reject: 0 });
  assert.equal(report.rows[0].recurrenceRank, 1);
  assert.equal(report.rows[0].researcherNote, "order DNA");
  assert.equal(report.rows[0].paeSha256, "c".repeat(64));
  assert.deepEqual(report.source.evidenceBindings[0], {
    poseId: "p1",
    coordinateSha256: "a".repeat(64),
    auditResultFingerprint: "audit-p1",
    paeSha256: "c".repeat(64),
    topologyStatus: null,
  });
  assert.equal(report.source.topologyAnnotationFingerprint, "fnv1a64-topology-v1:0123456789abcdef");
  assert.match(report.interpretation, /researcher-authored/i);
});

test("decision normalization is bounded and fail-closed", () => {
  assert.deepEqual(normalizeCandidateDecision({ disposition: "invented", note: "a\u0000b" }), { disposition: "unreviewed", note: "ab" });
  assert.equal(normalizeCandidateDecision({ disposition: "hold", note: "x".repeat(900) }).note.length, 500);
  assert.throws(
    () => createCandidateShortlistReport(result, {}, "2026-08-28T00:00:00.000Z", "forged"),
    /fingerprint/i,
  );
});

test("shortlist CSV neutralizes spreadsheet formulas after leading whitespace and format characters", () => {
  const report = createCandidateShortlistReport(
    result,
    { p1: { disposition: "hold", note: " \u200B=HYPERLINK(1)" } },
    "2026-08-28T00:00:00.000Z",
    "fnv1a64-topology-v1:0123456789abcdef",
  );
  const csv = candidateShortlistToCsv(report);
  assert.match(csv, /"' =HYPERLINK\(1\)"/);
  assert.doesNotMatch(csv, /\u200B/u);
  const header = csv.split("\n")[0].split(",");
  for (const requiredBinding of [
    "product_release",
    "engine_version",
    "audit_schema_version",
    "reference_coordinate_file_id",
    "topology_annotation_fingerprint",
    "coordinate_sha256",
    "audit_result_fingerprint",
    "pae_sha256",
  ]) assert.ok(header.includes(requiredBinding), `missing CSV evidence binding ${requiredBinding}`);
  assert.match(csv, /"0\.9\.0","0\.5\.0","1\.0\.0","p1","fnv1a64-topology-v1:0123456789abcdef"/);
  assert.match(csv, /"audit-p1"/);
  assert.equal(csv.split("\n").length, 3);
});
