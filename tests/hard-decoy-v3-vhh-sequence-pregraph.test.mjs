import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  alignGlobalAffine,
  collectVhhSequencePregraph,
  evaluateFrozenVhhThreshold,
  numberVhhForLeakage,
  verifyVhhSequencePregraph,
} from "../scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json");
const NANOBODY_SEQUENCE = "QVQLQESGGGLVQAGGSLRLSCAASGSIFSINTMGWYRQAPGKQRELVAAIHSGGSTNYANSVKGRFTISRDNAANTVYLQMNSLKPEDTAVYYCNVKDYGAVLYEYDYWGQGTQVTVSSHHHHHH";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function rewriteChecksum(snapshot, relative) {
  const checksumPath = path.join(snapshot, "checksums.sha256");
  const rows = (await readFile(checksumPath, "utf8")).trimEnd().split("\n");
  const digest = sha256(await readFile(path.join(snapshot, relative)));
  const replaced = rows.map((row) => row.endsWith(`  ${relative}`) ? `${digest}  ${relative}` : row);
  await writeFile(checksumPath, `${replaced.join("\n")}\n`);
}

test("the VHH sequence contract freezes numbering, alignment, thresholds, pair space, and non-authority", async () => {
  const contract = JSON.parse(await readFile(CONTRACT_PATH, "utf8"));
  assert.equal(contract.status, "VHH_SEQUENCE_PREGRAPH_RULE_FROZEN");
  assert.equal(contract.numbering.scheme, "IMGT");
  assert.equal(contract.numbering.engine, "immunum 1.2.0");
  assert.equal(contract.numbering.minimumEngineConfidence, 0.5);
  assert.equal(contract.alignment.algorithm, "global-Needleman-Wunsch-three-state-affine-gap");
  assert.equal(contract.alignment.substitutionMatrix, "BLOSUM62");
  assert.equal(contract.alignment.gapOpen, -10);
  assert.equal(contract.alignment.gapExtension, -1);
  assert.equal(contract.alignment.terminalGapPolicy, "penalize-identically-to-internal-gaps");
  assert.equal(contract.alignment.identityDenominator, "all-global-alignment-columns-including-gap-columns");
  assert.deepEqual(contract.alignment.stateTiePrecedence, ["M", "X", "Y"]);
  assert.deepEqual(contract.edgeCriterion.frameworkIdentityMinimum, { numerator: 9, denominator: 10 });
  assert.deepEqual(contract.edgeCriterion.cdr3IdentityMinimum, { numerator: 7, denominator: 10 });
  assert.equal(contract.edgeCriterion.maximumAbsoluteCdr3LengthDifference, 2);
  assert.equal(contract.pairSpace.allUnorderedPairs, 46056);
  assert.equal(contract.edgeCriterion.absenceOfThresholdMatchIsNotFormalNoEdgeEvidence, true);
  assert.equal(contract.edgeCriterion.possibleEdgeIsNotFormalLeakageAuthorityUntilRoleAdjudication, true);
  assert.equal(contract.integrity.formalLeakageGraphComplete, false);
  assert.equal(contract.integrity.formallyClearedGroupCount, 0);
  assert.equal(contract.integrity.targetFreezePermitted, false);
  assert.equal(contract.integrity.executionAuthorized, false);
});

test("the frozen affine alignment is symmetric in metrics, deterministic, and counts terminal gaps in identity", () => {
  const exact = alignGlobalAffine("QVQL", "QVQL");
  assert.equal(exact.alignmentScore, 18);
  assert.equal(exact.identicalResidueColumns, 4);
  assert.equal(exact.alignmentColumns, 4);
  assert.equal(exact.gapColumns, 0);
  assert.equal(exact.identity, 1);

  const terminalGap = alignGlobalAffine("A", "AA");
  assert.equal(terminalGap.alignmentScore, -6);
  assert.equal(terminalGap.identicalResidueColumns, 1);
  assert.equal(terminalGap.alignmentColumns, 2);
  assert.equal(terminalGap.gapColumns, 1);
  assert.equal(terminalGap.identity, 0.5);

  const forward = alignGlobalAffine("QVQLQESGGG", "QVQLQESGAG");
  const reverse = alignGlobalAffine("QVQLQESGAG", "QVQLQESGGG");
  assert.deepEqual(forward, reverse);
  for (let repeat = 0; repeat < 50; repeat += 1) assert.deepEqual(alignGlobalAffine("AAAA", "AAA"), alignGlobalAffine("AAAA", "AAA"));
});

test("the exact frozen VHH threshold includes equality and fails each conjunct independently", () => {
  const boundary = evaluateFrozenVhhThreshold({
    framework: { identicalResidueColumns: 9, alignmentColumns: 10 },
    cdr3: { identicalResidueColumns: 7, alignmentColumns: 10 },
    cdr3LengthA: 12,
    cdr3LengthB: 14,
  });
  assert.deepEqual(boundary, {
    frameworkIdentitySatisfied: true,
    cdr3IdentitySatisfied: true,
    cdr3LengthSatisfied: true,
    cdr3LengthDifference: 2,
    thresholdCriterionSatisfied: true,
  });
  assert.equal(evaluateFrozenVhhThreshold({
    framework: { identicalResidueColumns: 8, alignmentColumns: 10 },
    cdr3: { identicalResidueColumns: 7, alignmentColumns: 10 },
    cdr3LengthA: 12,
    cdr3LengthB: 14,
  }).thresholdCriterionSatisfied, false);
  assert.equal(evaluateFrozenVhhThreshold({
    framework: { identicalResidueColumns: 9, alignmentColumns: 10 },
    cdr3: { identicalResidueColumns: 6, alignmentColumns: 10 },
    cdr3LengthA: 12,
    cdr3LengthB: 14,
  }).thresholdCriterionSatisfied, false);
  assert.equal(evaluateFrozenVhhThreshold({
    framework: { identicalResidueColumns: 9, alignmentColumns: 10 },
    cdr3: { identicalResidueColumns: 7, alignmentColumns: 10 },
    cdr3LengthA: 12,
    cdr3LengthB: 15,
  }).thresholdCriterionSatisfied, false);
});

test("the pinned IMGT engine deterministically extracts framework and CDR3 while excluding the terminal tag", () => {
  const first = numberVhhForLeakage(NANOBODY_SEQUENCE);
  const second = numberVhhForLeakage(NANOBODY_SEQUENCE.toLowerCase());
  assert.deepEqual(first, second);
  assert.equal(first.numberingStatus, "NUMBERED");
  assert.equal(first.numberingScheme, "IMGT");
  assert.equal(first.numberingEngine, "immunum 1.2.0");
  assert.equal(first.detectedChain, "H");
  assert.ok(first.frameworkLength > 70);
  assert.ok(first.cdr3Length > 0);
  assert.ok(!first.frameworkSequence.endsWith("HHHHHH"));
  assert.ok(!first.cdr3Sequence.endsWith("HHHHHH"));

  const invalid = numberVhhForLeakage("QVQLX");
  assert.equal(invalid.numberingStatus, "UNAVAILABLE");
  assert.equal(invalid.numberingFailureCode, "NONCANONICAL_OR_EMPTY_SEQUENCE");
  assert.equal(invalid.frameworkSequence, null);
  assert.equal(invalid.cdr3Sequence, null);
});

test("the complete VHH sequence pregraph regenerates, reconciles exact evidence, and fails closed under mutation", { timeout: 600_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "confovhh-vhh-sequence-pregraph-"));
  const snapshot = path.join(temporary, "snapshot");
  try {
    const collected = await collectVhhSequencePregraph({ repositoryRoot: ROOT, outputDirectory: snapshot });
    assert.equal(collected.status, "VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION");
    assert.equal(collected.candidateNodeCount, 287);
    assert.equal(collected.developmentNodeCount, 17);
    assert.equal(collected.totalNodeCount, 304);
    assert.equal(collected.allUnorderedPairCount, 46056);
    assert.equal(collected.exactFullSequenceEvidencePairCount, 2023);
    assert.equal(collected.formallyClearedGroupCount, 0);
    assert.equal(collected.targetFreezePermitted, false);
    assert.equal(collected.executionAuthorized, false);
    assert.equal(collected.nativeHoldoutCoordinatesAccessed, false);
    assert.equal(collected.dockqLabelsAccessed, false);

    const verified = await verifyVhhSequencePregraph({ repositoryRoot: ROOT, snapshotDirectory: snapshot });
    const collectedSummary = { ...collected };
    delete collectedSummary.outputDirectory;
    assert.deepEqual(verified, collectedSummary);

    const summaryPath = path.join(snapshot, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.observed = "DockQ: 0.42";
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await rewriteChecksum(snapshot, "summary.json");
    await assert.rejects(
      verifyVhhSequencePregraph({ repositoryRoot: ROOT, snapshotDirectory: snapshot }),
      /Observed holdout-label assignment|Forbidden result field/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
