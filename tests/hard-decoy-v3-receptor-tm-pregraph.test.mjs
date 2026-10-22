import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  alignGlobalAffineWithCoverage,
  evaluateFrozenReceptorThreshold,
  extractCanonicalTmProfile,
  parseProteinBody,
  resolveNodeReceptorProfile,
} from "../scripts/hard-decoy/v3-receptor-tm-pregraph.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "validation/hard-decoy-holdout-v3/receptor-tm-contract-2026-08-30.json");

function validProtein(accession = "P07550", entryName = "adrb2_human", sequence = "A".repeat(140)) {
  return {
    accession,
    entryName,
    canonicalAccession: accession,
    canonicalSequence: sequence,
    canonicalSequenceLength: sequence.length,
    canonicalSequenceSha256: "placeholder",
    mappingStatus: "VALID_CANONICAL_GPCRDB_ACCESSION",
    receptorClass: "Class A",
    family: "001_001_003_008",
    species: "Homo sapiens",
    source: "SWISSPROT",
  };
}

function syntheticResidues(sequence = "A".repeat(140)) {
  return Array.from(sequence, (aminoAcid, index) => ({
    sequence_number: index + 1,
    amino_acid: aminoAcid,
    protein_segment: `TM${Math.floor(index / 20) + 1}`,
    display_generic_number: `${Math.floor(index / 20) + 1}x${30 + (index % 20)}`,
  }));
}

test("the receptor TM contract freezes mapping, TM extraction, alignment, thresholds, and non-authority", async () => {
  const contract = JSON.parse(await readFile(CONTRACT_PATH, "utf8"));
  assert.equal(contract.status, "RECEPTOR_TM_PREGRAPH_RULE_FROZEN");
  assert.equal(contract.gpcrdb.captureCount, 2);
  assert.deepEqual(contract.tmExtraction.segments, ["TM1", "TM2", "TM3", "TM4", "TM5", "TM6", "TM7"]);
  assert.equal(contract.mapping.uniqueValidGpcrdbAccessionRequired, true);
  assert.equal(contract.mapping.zeroOrMultipleValidMappingsFailClosed, true);
  assert.equal(contract.alignment.algorithm, "global-Needleman-Wunsch-three-state-affine-gap");
  assert.equal(contract.alignment.substitutionMatrix, "BLOSUM62");
  assert.equal(contract.alignment.gapOpen, -10);
  assert.equal(contract.alignment.gapExtension, -1);
  assert.deepEqual(contract.thresholds.primaryIdentityMinimum, { numerator: 2, denominator: 5 });
  assert.deepEqual(contract.thresholds.sensitivityIdentityMinimum, { numerator: 3, denominator: 10 });
  assert.deepEqual(contract.thresholds.minimumCoverageEachSequence, { numerator: 4, denominator: 5 });
  assert.equal(contract.thresholds.sensitivityThresholdRole, "veto-only");
  assert.equal(contract.pairSpace.allUnorderedPairs, 46056);
  assert.equal(contract.integrity.formalLeakageGraphComplete, false);
  assert.equal(contract.integrity.formallyClearedGroupCount, 0);
  assert.equal(contract.integrity.targetFreezePermitted, false);
  assert.equal(contract.integrity.executionAuthorized, false);
});

test("global affine alignment is deterministic, symmetric in metrics, and counts gap columns in identity and coverage", () => {
  const exact = alignGlobalAffineWithCoverage("AAAA", "AAAA");
  assert.equal(exact.identicalResidueColumns, 4);
  assert.equal(exact.alignedResiduePairColumns, 4);
  assert.equal(exact.alignmentColumns, 4);
  assert.equal(exact.gapColumns, 0);
  assert.equal(exact.identity, 1);
  assert.equal(exact.coverageA, 1);
  assert.equal(exact.coverageB, 1);

  const terminalGap = alignGlobalAffineWithCoverage("A", "AA");
  assert.equal(terminalGap.identicalResidueColumns, 1);
  assert.equal(terminalGap.alignedResiduePairColumns, 1);
  assert.equal(terminalGap.alignmentColumns, 2);
  assert.equal(terminalGap.gapColumns, 1);
  assert.equal(terminalGap.identity, 0.5);
  assert.equal(terminalGap.coverageA, 1);
  assert.equal(terminalGap.coverageB, 0.5);

  const forward = alignGlobalAffineWithCoverage("ARNDCQEGHILK", "ARNDCQEGHVK");
  const reverse = alignGlobalAffineWithCoverage("ARNDCQEGHVK", "ARNDCQEGHILK");
  assert.deepEqual(forward, reverse);
});

test("the exact receptor thresholds include equality and keep the 30 percent analysis veto-only", () => {
  const equality = evaluateFrozenReceptorThreshold({
    identicalResidueColumns: 4,
    alignedResiduePairColumns: 8,
    alignmentColumns: 10,
    sequenceLengthA: 10,
    sequenceLengthB: 10,
  });
  assert.deepEqual(equality, {
    coverageASatisfied: true,
    coverageBSatisfied: true,
    bothCoverageSatisfied: true,
    primaryIdentitySatisfied: true,
    sensitivityIdentitySatisfied: true,
    primaryThresholdSatisfied: true,
    sensitivityThresholdSatisfied: true,
  });

  const sensitivityOnly = evaluateFrozenReceptorThreshold({
    identicalResidueColumns: 3,
    alignedResiduePairColumns: 8,
    alignmentColumns: 10,
    sequenceLengthA: 10,
    sequenceLengthB: 10,
  });
  assert.equal(sensitivityOnly.primaryThresholdSatisfied, false);
  assert.equal(sensitivityOnly.sensitivityThresholdSatisfied, true);

  const inadequateCoverage = evaluateFrozenReceptorThreshold({
    identicalResidueColumns: 8,
    alignedResiduePairColumns: 7,
    alignmentColumns: 10,
    sequenceLengthA: 10,
    sequenceLengthB: 10,
  });
  assert.equal(inadequateCoverage.primaryThresholdSatisfied, false);
  assert.equal(inadequateCoverage.sensitivityThresholdSatisfied, false);
});

test("GPCRdb protein records require exact accession, canonical sequence, GPCR family, and SWISSPROT source", () => {
  const valid = parseProteinBody("P07550", 200, JSON.stringify({
    entry_name: "adrb2_human",
    accession: "P07550",
    sequence: "A".repeat(140),
    receptor_class: "Class A",
    family: "001_001_003_008",
    species: "Homo sapiens",
    source: "SWISSPROT",
  }));
  assert.equal(valid.mappingStatus, "VALID_CANONICAL_GPCRDB_ACCESSION");
  assert.equal(valid.entryName, "adrb2_human");
  assert.equal(valid.canonicalSequenceLength, 140);

  assert.equal(parseProteinBody("P00720", 404, "{}").mappingStatus, "NO_GPCRDB_ACCESSION_RECORD");
  assert.equal(parseProteinBody("P07550", 200, JSON.stringify({
    entry_name: "adrb2_human",
    accession: "P99999",
    sequence: "A".repeat(140),
    family: "001",
    source: "SWISSPROT",
  })).errorCode, "ACCESSION_MISMATCH");
  assert.equal(parseProteinBody("P07550", 200, JSON.stringify({
    entry_name: "adrb2_human",
    accession: "P07550",
    sequence: "A".repeat(140),
    family: "001",
    source: "TREMBL",
  })).errorCode, "SOURCE_NOT_SWISSPROT");
});

test("canonical TM extraction requires all seven ordered segments and exact canonical-sequence mapping", () => {
  const sequence = "ACDEFGHIKLMNPQRSTVWY".repeat(7);
  const protein = validProtein("P07550", "adrb2_human", sequence);
  protein.canonicalSequenceSha256 = "not-rechecked-by-pure-extractor";
  const extracted = extractCanonicalTmProfile(protein, syntheticResidues(sequence));
  assert.equal(extracted.extractionStatus, "RESOLVED_CANONICAL_TM1_TM7");
  assert.equal(extracted.tmSegments.length, 7);
  assert.deepEqual(extracted.tmSegments.map((segment) => segment.residueCount), [20, 20, 20, 20, 20, 20, 20]);
  assert.equal(extracted.concatenatedTmSequence, sequence);
  assert.equal(extracted.concatenatedTmSequenceLength, 140);
  assert.equal(extracted.allTmResiduesHaveGenericNumbers, true);

  const missingTm7 = syntheticResidues(sequence).filter((row) => row.protein_segment !== "TM7");
  assert.equal(extractCanonicalTmProfile(protein, missingTm7).failureCode, "EMPTY_TM7");

  const mismatch = syntheticResidues(sequence);
  mismatch[0] = { ...mismatch[0], amino_acid: "Y" };
  assert.equal(extractCanonicalTmProfile(protein, mismatch).failureCode, "RESIDUE_CANONICAL_SEQUENCE_MISMATCH");
});

test("a fused construct resolves only through one unique valid GPCRdb accession and otherwise fails closed", () => {
  const node = {
    nodeId: "candidate:3P0G",
    role: "CANDIDATE_SOURCE_ENTRY",
    pdbId: "3P0G",
    receptor: {
      entityId: "1",
      uniprotAccessions: ["P00720", "P07550"],
    },
  };
  const protein = validProtein();
  const tm = extractCanonicalTmProfile(protein, syntheticResidues());
  const oneValid = new Map([
    ["P00720", { accession: "P00720", mappingStatus: "NO_GPCRDB_ACCESSION_RECORD" }],
    ["P07550", protein],
  ]);
  const resolved = resolveNodeReceptorProfile(node, oneValid, new Map([["adrb2_human", tm]]));
  assert.equal(resolved.mappingStatus, "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7");
  assert.equal(resolved.canonicalAccession, "P07550");
  assert.equal(resolved.formalLeakageEdgeAuthority, false);
  assert.equal(resolved.formalNoEdgeAuthority, false);
  assert.equal(resolved.targetEligibilityAuthority, false);
  assert.equal(resolved.nativeCoordinatesInspected, false);

  const second = validProtein("P00720", "fake_human");
  const ambiguous = resolveNodeReceptorProfile(
    node,
    new Map([["P00720", second], ["P07550", protein]]),
    new Map([["adrb2_human", tm], ["fake_human", tm]]),
  );
  assert.equal(ambiguous.mappingStatus, "FAIL_CLOSED_MULTIPLE_VALID_GPCRDB_ACCESSIONS");

  const absent = resolveNodeReceptorProfile(
    node,
    new Map([["P00720", { mappingStatus: "NO_GPCRDB_ACCESSION_RECORD" }], ["P07550", { mappingStatus: "NO_GPCRDB_ACCESSION_RECORD" }]]),
    new Map(),
  );
  assert.equal(absent.mappingStatus, "FAIL_CLOSED_NO_VALID_GPCRDB_ACCESSION");
});
