import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = process.env.CONFOVHH_VHH_SNAPSHOT
  ? path.resolve(process.env.CONFOVHH_VHH_SNAPSHOT)
  : path.join(ROOT, "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29");

const MATRIX_FILES = [
  {
    relative: "candidate-candidate-vhh-matrix.jsonl",
    pairType: "CANDIDATE_CANDIDATE",
    summaryKey: "candidateCandidate",
  },
  {
    relative: "candidate-development-vhh-matrix.jsonl",
    pairType: "CANDIDATE_DEVELOPMENT",
    summaryKey: "candidateDevelopment",
  },
  {
    relative: "development-development-vhh-matrix.jsonl",
    pairType: "DEVELOPMENT_DEVELOPMENT",
    summaryKey: "developmentDevelopment",
  },
];

const FALSE_AUTHORITY_FIELDS = [
  "directBinderRolesResolved",
  "formalLeakageEdgeAuthority",
  "formalNoEdgeAuthority",
  "targetEligibilityAuthority",
  "nativeCoordinatesInspected",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function canonicalPair(left, right) {
  assert.notEqual(left, right, "A leakage pair cannot contain the same node twice.");
  return byteCompare(left, right) < 0 ? `${left}|${right}` : `${right}|${left}`;
}

function parseJsonl(text, label) {
  assert.ok(text.length === 0 || text.endsWith("\n"), `${label} must end with LF.`);
  return text.trim() ? text.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function sortedObject(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => byteCompare(left, right)));
}

async function readProfiles() {
  const files = ["candidate-vhh-profiles.jsonl", "development-vhh-profiles.jsonl"];
  const profiles = (await Promise.all(files.map(async (relative) => parseJsonl(
    await readFile(path.join(SNAPSHOT, relative), "utf8"),
    relative,
  )))).flat();
  const byId = new Map();
  const byNode = new Map();
  for (const profile of profiles) {
    assert.ok(!byId.has(profile.profileId), `Duplicate profile ID: ${profile.profileId}`);
    byId.set(profile.profileId, profile);
    if (!byNode.has(profile.nodeId)) byNode.set(profile.nodeId, []);
    byNode.get(profile.nodeId).push(profile);

    assert.equal(profile.fullSequence.length, profile.fullSequenceLength, `${profile.profileId} full-sequence length`);
    assert.equal(sha256(Buffer.from(profile.fullSequence)), profile.fullSequenceSha256, `${profile.profileId} full-sequence digest`);
    assert.equal(profile.directBinderIdentityResolved, false, `${profile.profileId} direct-binder authority`);
    assert.equal(profile.knownParentVariantIdentityResolved, false, `${profile.profileId} parent/variant authority`);
    assert.equal(profile.formalLeakageEdgeAuthority, false, `${profile.profileId} leakage-edge authority`);
    assert.equal(profile.formalNoEdgeAuthority, false, `${profile.profileId} no-edge authority`);
    assert.equal(profile.nativeCoordinatesInspected, false, `${profile.profileId} coordinate access`);

    if (profile.numberingStatus === "NUMBERED") {
      assert.equal(profile.numberingFailureCode, null, `${profile.profileId} numbering failure code`);
      assert.equal(profile.numberingFailureMessage, null, `${profile.profileId} numbering failure message`);
      assert.equal(profile.frameworkSequence.length, profile.frameworkLength, `${profile.profileId} framework length`);
      assert.equal(profile.cdr3Sequence.length, profile.cdr3Length, `${profile.profileId} CDR3 length`);
      assert.equal(sha256(Buffer.from(profile.frameworkSequence)), profile.frameworkSequenceSha256, `${profile.profileId} framework digest`);
      assert.equal(sha256(Buffer.from(profile.cdr3Sequence)), profile.cdr3SequenceSha256, `${profile.profileId} CDR3 digest`);
    } else {
      assert.equal(profile.numberingStatus, "UNAVAILABLE", `${profile.profileId} numbering status`);
      for (const field of [
        "frameworkSequence",
        "frameworkLength",
        "frameworkSequenceSha256",
        "cdr3Sequence",
        "cdr3Length",
        "cdr3SequenceSha256",
      ]) assert.equal(profile[field], null, `${profile.profileId} unavailable-numbering field ${field}`);
    }
  }
  return { profiles, byId, byNode };
}

function exactNodePairs(profiles, digestField) {
  const nodesByDigest = new Map();
  for (const profile of profiles) {
    const digest = profile[digestField];
    if (typeof digest !== "string") continue;
    if (!nodesByDigest.has(digest)) nodesByDigest.set(digest, new Set());
    nodesByDigest.get(digest).add(profile.nodeId);
  }
  const pairs = new Set();
  for (const nodeSet of nodesByDigest.values()) {
    const nodes = [...nodeSet].sort(byteCompare);
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        pairs.add(`${nodes[left]}|${nodes[right]}`);
      }
    }
  }
  return pairs;
}

function expectedMatrixStatus(possibleEdge, attemptedCount, unresolvedCount) {
  if (possibleEdge) return "POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED";
  if (attemptedCount === 0 || unresolvedCount > 0) return "FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE";
  return "NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY";
}

function assertEvaluation(evaluation, profilesById, pairId) {
  const profileA = profilesById.get(evaluation.profileA);
  const profileB = profilesById.get(evaluation.profileB);
  assert.ok(profileA && profileB, `${pairId} references an unknown VHH profile.`);
  assert.notEqual(profileA.nodeId, profileB.nodeId, `${pairId} contains a within-node profile comparison.`);
  assert.equal(canonicalPair(profileA.nodeId, profileB.nodeId), pairId, `${pairId} profile/node binding`);
  assert.equal(evaluation.fullSequenceSha256A, profileA.fullSequenceSha256, `${pairId} profile A full-sequence digest`);
  assert.equal(evaluation.fullSequenceSha256B, profileB.fullSequenceSha256, `${pairId} profile B full-sequence digest`);
  assert.equal(
    evaluation.exactFullSequenceMatch,
    profileA.fullSequenceSha256 === profileB.fullSequenceSha256,
    `${pairId} exact full-sequence decision`,
  );
  assert.equal(evaluation.directBinderRolesResolved, false, `${pairId} direct-binder authority`);
  assert.equal(evaluation.formalLeakageEdgeAuthority, false, `${pairId} evaluation leakage authority`);
  assert.equal(evaluation.knownParentVariantEvidence, "NOT_ASSESSED_SOURCE_BACKED_REVIEW_REQUIRED", `${pairId} parent/variant state`);

  const evaluable = profileA.numberingStatus === "NUMBERED" && profileB.numberingStatus === "NUMBERED";
  assert.equal(evaluation.evaluationStatus, evaluable ? "EVALUABLE" : "UNRESOLVED_NUMBERING", `${pairId} evaluation status`);
  if (!evaluable) {
    for (const field of ["framework", "cdr3", "cdr3LengthDifference"]) {
      assert.equal(evaluation[field], null, `${pairId} unresolved evaluation field ${field}`);
    }
    for (const field of [
      "frameworkIdentitySatisfied",
      "cdr3IdentitySatisfied",
      "cdr3LengthSatisfied",
      "thresholdCriterionSatisfied",
      "possibleMetadataSequenceLeakageEdge",
    ]) assert.equal(evaluation[field], false, `${pairId} unresolved decision field ${field}`);
    return { exactFull: evaluation.exactFullSequenceMatch, exactCdr3: false, threshold: false, unresolved: true };
  }

  assert.equal(evaluation.cdr3LengthA, profileA.cdr3Length, `${pairId} CDR3 length A`);
  assert.equal(evaluation.cdr3LengthB, profileB.cdr3Length, `${pairId} CDR3 length B`);
  assert.equal(evaluation.cdr3LengthDifference, Math.abs(profileA.cdr3Length - profileB.cdr3Length), `${pairId} CDR3 length difference`);
  const frameworkSatisfied = evaluation.framework.identicalResidueColumns * 10 >= evaluation.framework.alignmentColumns * 9;
  const cdr3Satisfied = evaluation.cdr3.identicalResidueColumns * 10 >= evaluation.cdr3.alignmentColumns * 7;
  const cdr3LengthSatisfied = evaluation.cdr3LengthDifference <= 2;
  const threshold = frameworkSatisfied && cdr3Satisfied && cdr3LengthSatisfied;
  assert.equal(evaluation.frameworkIdentitySatisfied, frameworkSatisfied, `${pairId} framework threshold`);
  assert.equal(evaluation.cdr3IdentitySatisfied, cdr3Satisfied, `${pairId} CDR3 threshold`);
  assert.equal(evaluation.cdr3LengthSatisfied, cdr3LengthSatisfied, `${pairId} CDR3 length threshold`);
  assert.equal(evaluation.thresholdCriterionSatisfied, threshold, `${pairId} composite threshold`);
  assert.equal(evaluation.possibleMetadataSequenceLeakageEdge, threshold, `${pairId} evaluation possible-edge state`);

  const exactCdr3 = profileA.cdr3SequenceSha256 === profileB.cdr3SequenceSha256;
  assert.equal(evaluation.cdr3.identity === 1, exactCdr3, `${pairId} exact-CDR3 identity audit`);
  return { exactFull: evaluation.exactFullSequenceMatch, exactCdr3, threshold, unresolved: false };
}

async function auditMatrix({ relative, pairType, summaryKey }, profilesById, profilesByNode) {
  const pairIds = [];
  const pairIdSet = new Set();
  const exactFullPairs = new Set();
  const exactCdr3Pairs = new Set();
  const matrixStatusCounts = {};
  let possibleEdgeCount = 0;
  let rowCount = 0;
  const input = createReadStream(path.join(SNAPSHOT, relative), { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    rowCount += 1;
    const row = JSON.parse(line);
    assert.equal(row.pairType, pairType, `${row.pairId} pair type`);
    assert.equal(row.pairId, canonicalPair(row.nodeA, row.nodeB), `${row.pairId} canonical node order`);
    assert.ok(!pairIdSet.has(row.pairId), `Duplicate pair row: ${row.pairId}`);
    pairIdSet.add(row.pairId);
    pairIds.push(row.pairId);
    assert.equal(row.metadataProfileCountA, (profilesByNode.get(row.nodeA) ?? []).length, `${row.pairId} profile count A`);
    assert.equal(row.metadataProfileCountB, (profilesByNode.get(row.nodeB) ?? []).length, `${row.pairId} profile count B`);
    assert.equal(row.attemptedProfilePairCount, row.profilePairEvaluations.length, `${row.pairId} attempted profile-pair count`);

    let exactFullCount = 0;
    let thresholdCount = 0;
    let unresolvedCount = 0;
    let exactCdr3 = false;
    const evaluationIds = new Set();
    for (const evaluation of row.profilePairEvaluations) {
      const evaluationId = `${evaluation.profileA}|${evaluation.profileB}`;
      assert.ok(!evaluationIds.has(evaluationId), `${row.pairId} duplicates profile comparison ${evaluationId}`);
      evaluationIds.add(evaluationId);
      const audited = assertEvaluation(evaluation, profilesById, row.pairId);
      if (audited.exactFull) exactFullCount += 1;
      if (audited.exactCdr3) exactCdr3 = true;
      if (audited.threshold) thresholdCount += 1;
      if (audited.unresolved) unresolvedCount += 1;
    }

    assert.equal(row.exactFullSequenceMatchProfilePairCount, exactFullCount, `${row.pairId} exact full-sequence count`);
    assert.equal(row.thresholdMatchProfilePairCount, thresholdCount, `${row.pairId} threshold-match count`);
    assert.equal(row.unresolvedProfilePairCount, unresolvedCount, `${row.pairId} unresolved profile-pair count`);
    assert.equal(row.evaluableProfilePairCount, row.attemptedProfilePairCount - unresolvedCount, `${row.pairId} evaluable profile-pair count`);
    assert.equal(row.allMetadataProfilePairsEvaluable, row.attemptedProfilePairCount > 0 && unresolvedCount === 0, `${row.pairId} all-evaluable state`);
    const possibleEdge = thresholdCount > 0;
    assert.equal(row.possibleMetadataSequenceLeakageEdge, possibleEdge, `${row.pairId} possible-edge state`);
    assert.equal(row.matrixStatus, expectedMatrixStatus(possibleEdge, row.attemptedProfilePairCount, unresolvedCount), `${row.pairId} matrix status`);
    assert.equal(row.formalLeakageEdgeStatus, "UNRESOLVED", `${row.pairId} formal leakage status`);
    assert.equal(row.formalNoEdgeStatus, "NOT_ESTABLISHED", `${row.pairId} formal no-edge status`);
    assert.equal(row.knownParentVariantEvidence, "NOT_ASSESSED_SOURCE_BACKED_REVIEW_REQUIRED", `${row.pairId} parent/variant state`);
    for (const field of FALSE_AUTHORITY_FIELDS) assert.equal(row[field], false, `${row.pairId} authority/access field ${field}`);
    if (row.bestReviewProfilePair === null) assert.equal(row.attemptedProfilePairCount, 0, `${row.pairId} missing best-review pair`);
    else assert.ok(evaluationIds.has(row.bestReviewProfilePair), `${row.pairId} best-review pair is not one of its evaluations.`);

    if (exactFullCount > 0) exactFullPairs.add(row.pairId);
    if (exactCdr3) exactCdr3Pairs.add(row.pairId);
    if (possibleEdge) possibleEdgeCount += 1;
    increment(matrixStatusCounts, row.matrixStatus);
  }
  assert.equal(rowCount, pairIds.length, `${relative} row accounting`);
  return {
    summaryKey,
    rowCount,
    pairIds,
    pairIdSet,
    exactFullPairs,
    exactCdr3Pairs,
    possibleEdgeCount,
    matrixStatusCounts,
  };
}

test("the committed VHH matrix independently replays pair identity, sequence reuse, thresholds, summaries, and non-authority", { timeout: 180_000 }, async () => {
  const summary = JSON.parse(await readFile(path.join(SNAPSHOT, "summary.json"), "utf8"));
  const commitments = JSON.parse(await readFile(path.join(SNAPSHOT, "pair-space-commitments.json"), "utf8"));
  const { profiles, byId, byNode } = await readProfiles();
  assert.equal(profiles.length, summary.totalMetadataProfileCount, "Total VHH profile count");
  assert.equal(profiles.filter((profile) => profile.numberingStatus === "NUMBERED").length, summary.numberedProfileCount, "Numbered VHH profile count");
  assert.equal(profiles.filter((profile) => profile.numberingStatus !== "NUMBERED").length, summary.unavailableProfileCount, "Unavailable VHH profile count");

  const expectedExactFullPairs = exactNodePairs(profiles, "fullSequenceSha256");
  const expectedExactCdr3Pairs = exactNodePairs(profiles, "cdr3SequenceSha256");
  const audits = [];
  for (const descriptor of MATRIX_FILES) audits.push(await auditMatrix(descriptor, byId, byNode));

  const allPairIds = [];
  const allPairSet = new Set();
  const observedExactFullPairs = new Set();
  const observedExactCdr3Pairs = new Set();
  const matrixStatusCounts = {};
  let possibleEdgeCount = 0;
  for (const audit of audits) {
    assert.equal(audit.rowCount, summary.pairSpace[audit.summaryKey], `${audit.summaryKey} summary pair count`);
    assert.equal(audit.rowCount, commitments[audit.summaryKey].count, `${audit.summaryKey} commitment pair count`);
    assert.equal(
      sha256(Buffer.from(`${[...audit.pairIds].sort(byteCompare).join("\n")}\n`)),
      commitments[audit.summaryKey].sha256,
      `${audit.summaryKey} pair-space digest`,
    );
    assert.equal(audit.possibleEdgeCount, summary.possibleMetadataSequenceEdgePairCounts[audit.summaryKey], `${audit.summaryKey} possible-edge count`);
    for (const pairId of audit.pairIds) {
      assert.ok(!allPairSet.has(pairId), `Pair appears in multiple matrix ledgers: ${pairId}`);
      allPairSet.add(pairId);
      allPairIds.push(pairId);
    }
    for (const pairId of audit.exactFullPairs) observedExactFullPairs.add(pairId);
    for (const pairId of audit.exactCdr3Pairs) observedExactCdr3Pairs.add(pairId);
    for (const [status, count] of Object.entries(audit.matrixStatusCounts)) matrixStatusCounts[status] = (matrixStatusCounts[status] ?? 0) + count;
    possibleEdgeCount += audit.possibleEdgeCount;
  }

  assert.equal(allPairIds.length, summary.pairSpace.allUnorderedPairs, "Complete unordered pair count");
  assert.equal(allPairIds.length, commitments.allUnorderedPairs.count, "Committed unordered pair count");
  assert.equal(
    sha256(Buffer.from(`${[...allPairIds].sort(byteCompare).join("\n")}\n`)),
    commitments.allUnorderedPairs.sha256,
    "Complete unordered pair-space digest",
  );
  assert.equal(possibleEdgeCount, summary.possibleMetadataSequenceEdgePairCounts.all, "Total possible metadata-sequence edges");
  assert.deepEqual(sortedObject(matrixStatusCounts), summary.matrixStatusCounts, "Matrix-status summary reconciliation");
  assert.deepEqual(observedExactFullPairs, expectedExactFullPairs, "Exact full-sequence pair set");
  assert.deepEqual(observedExactCdr3Pairs, expectedExactCdr3Pairs, "Exact CDR3 pair set");
  assert.equal(observedExactFullPairs.size, summary.exactFullSequenceEvidencePairCount, "Exact full-sequence summary count");
  assert.ok(observedExactCdr3Pairs.size > 0, "The snapshot should expose at least one exact-CDR3 relationship for audit.");
  assert.equal(commitments.completeNodePairRowsStored, true);
  assert.equal(commitments.absenceOfThresholdMatchIsNotNoEdgeEvidence, true);
  assert.equal(commitments.formalLeakageGraphAuthority, false);
  for (const field of [
    "directBinderRolesResolved",
    "knownParentVariantEvidenceComplete",
    "formalLeakageGraphComplete",
    "dispositionLedgerComplete",
    "targetFreezePermitted",
    "executionAuthorized",
    "nativeHoldoutCoordinatesAccessed",
    "nativeRelativePosesInspected",
    "dockqLabelsAccessed",
    "confovhhHoldoutScoresAccessed",
    "performanceResultsAccessed",
  ]) assert.equal(summary[field], false, `Summary authority/access field ${field}`);
  assert.equal(summary.formallyClearedGroupCount, 0);
});
