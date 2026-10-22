import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/receptor-tm-contract-2026-08-30.json";
const STATUS = "RECEPTOR_TM_PREGRAPH_COMPLETED_BLOCKED_PENDING_REMAINING_PRELABEL_ADJUDICATION";
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const NODE_ID = /^(?:candidate|development):[0-9][A-Z0-9]{3}$/u;
const UNIPROT_ACCESSION = /^[A-Z0-9]{6,10}$/u;
const GPCRDB_ENTRY = /^[a-z0-9][a-z0-9_-]*$/u;
const CANONICAL_AA = /^[ACDEFGHIKLMNPQRSTVWY]+$/u;
const TM_SEGMENTS = ["TM1", "TM2", "TM3", "TM4", "TM5", "TM6", "TM7"];
const COORDINATE = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult|annotationEpitopeEdge)$/iu;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 128 * 1024 * 1024;
const NEGATIVE_INFINITY = -1_000_000_000;
const STATE_M = 0;
const STATE_X = 1;
const STATE_Y = 2;
const NO_TRACE = 255;

const AMINO_ACIDS = "ARNDCQEGHILKMFPSTWYV";
const BLOSUM62_ROWS = [
  [4, -1, -2, -2, 0, -1, -1, 0, -2, -1, -1, -1, -1, -2, -1, 1, 0, -3, -2, 0],
  [-1, 5, 0, -2, -3, 1, 0, -2, 0, -3, -2, 2, -1, -3, -2, -1, -1, -3, -2, -3],
  [-2, 0, 6, 1, -3, 0, 0, 0, 1, -3, -3, 0, -2, -3, -2, 1, 0, -4, -2, -3],
  [-2, -2, 1, 6, -3, 0, 2, -1, -1, -3, -4, -1, -3, -3, -1, 0, -1, -4, -3, -3],
  [0, -3, -3, -3, 9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1],
  [-1, 1, 0, 0, -3, 5, 2, -2, 0, -3, -2, 1, 0, -3, -1, 0, -1, -2, -1, -2],
  [-1, 0, 0, 2, -4, 2, 5, -2, 0, -3, -3, 1, -2, -3, -1, 0, -1, -3, -2, -2],
  [0, -2, 0, -1, -3, -2, -2, 6, -2, -4, -4, -2, -3, -3, -2, 0, -2, -2, -3, -3],
  [-2, 0, 1, -1, -3, 0, 0, -2, 8, -3, -3, -1, -2, -1, -2, -1, -2, -2, 2, -3],
  [-1, -3, -3, -3, -1, -3, -3, -4, -3, 4, 2, -3, 1, 0, -3, -2, -1, -3, -1, 3],
  [-1, -2, -3, -4, -1, -2, -3, -4, -3, 2, 4, -2, 2, 0, -3, -2, -1, -2, -1, 1],
  [-1, 2, 0, -1, -3, 1, 1, -2, -1, -3, -2, 5, -1, -3, -1, 0, -1, -3, -2, -2],
  [-1, -1, -2, -3, -1, 0, -2, -3, -2, 1, 2, -1, 5, 0, -2, -1, -1, -1, -1, 1],
  [-2, -3, -3, -3, -2, -3, -3, -3, -1, 0, 0, -3, 0, 6, -4, -2, -2, 1, 3, -1],
  [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4, 7, -1, -1, -4, -3, -2],
  [1, -1, 1, 0, -1, 0, 0, 0, -1, -2, -2, 0, -1, -2, -1, 4, 1, -3, -2, -2],
  [0, -1, 0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1, 1, 5, -2, -2, 0],
  [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1, 1, -4, -3, -2, 11, 2, -3],
  [-2, -2, -2, -3, -2, -1, -2, -3, 2, -1, -1, -2, -1, 3, -3, -2, -2, 2, 7, -1],
  [0, -3, -3, -3, -1, -2, -2, -3, -3, 3, 1, -2, 1, -1, -2, -2, 0, -3, -1, 4],
];
const AMINO_ACID_INDEX = new Map(Array.from(AMINO_ACIDS, (aminoAcid, index) => [aminoAcid, index]));

function ok(value, message) {
  if (!value) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function byteSort(values) {
  return [...values].sort(byteCompare);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(byteCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJson(value) {
  return `${canonical(value)}\n`;
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
}

function uniqueStrings(values) {
  return byteSort([...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))]);
}

function clean(label, text) {
  ok(!text.includes("\0"), `NUL byte appeared in ${label}.`);
  ok(!COORDINATE.test(text), `Coordinate payload appeared in ${label}.`);
  ok(!OBSERVED_LABEL.test(text), `Observed holdout-label assignment appeared in ${label}.`);
}

function walk(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...trail, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    ok(!FORBIDDEN_KEYS.test(key), `Forbidden result field: ${[...trail, key].join(".")}`);
    walk(item, [...trail, key]);
  }
}

function parseJsonl(text, label) {
  clean(label, text);
  ok(text.length === 0 || text.endsWith("\n"), `${label} must be empty or end with LF.`);
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line, index) => {
    try {
      const parsed = JSON.parse(line);
      walk(parsed);
      return parsed;
    } catch (error) {
      throw new Error(`${label}:${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function safeRelative(relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  ok(relative.split("/").every((part) => part && part !== "." && part !== ".."), `${label} path is unsafe.`);
  return relative;
}

function safePath(root, relative, label) {
  safeRelative(relative, label);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped its root.`);
  return filename;
}

async function readDirect(root, relative, label, maximumBytes = MAX_NORMALIZED_BYTES) {
  const filename = safePath(root, relative, label);
  const info = await lstat(filename, { bigint: true });
  ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, `${label} must be one direct regular file.`);
  ok(await realpath(filename) === filename, `${label} path cannot contain symlinks.`);
  ok(info.size <= BigInt(maximumBytes), `${label} exceeds its byte cap.`);
  const bytes = await readFile(filename);
  ok(bytes.byteLength <= maximumBytes, `${label} changed beyond its byte cap.`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(label, text);
  return { filename, bytes, text, sha256: sha256(bytes) };
}

async function ensureParent(filename) {
  await mkdir(path.dirname(filename), { recursive: true });
}

async function writeBytes(filename, bytes) {
  await ensureParent(filename);
  await writeFile(filename, bytes);
}

async function writeText(filename, text) {
  clean(path.basename(filename), text);
  await writeBytes(filename, Buffer.from(text));
}

async function writeJson(filename, value) {
  walk(value);
  await writeText(filename, canonicalJson(value));
}

async function listFilesRecursive(root) {
  const result = [];
  async function visit(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => byteCompare(left.name, right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename, relative);
      else {
        ok(entry.isFile() && !entry.isSymbolicLink(), `Snapshot contains a non-regular path: ${relative}`);
        result.push(relative);
      }
    }
  }
  await visit(root, "");
  return result;
}

function substitutionScore(left, right) {
  const leftIndex = AMINO_ACID_INDEX.get(left);
  const rightIndex = AMINO_ACID_INDEX.get(right);
  ok(leftIndex !== undefined && rightIndex !== undefined, "BLOSUM62 received a noncanonical amino acid.");
  return BLOSUM62_ROWS[leftIndex][rightIndex];
}

function chooseState(candidates) {
  let best = NEGATIVE_INFINITY;
  let state = NO_TRACE;
  for (const [candidateState, candidateScore] of candidates) {
    if (candidateScore > best) {
      best = candidateScore;
      state = candidateState;
    }
  }
  return [best, state];
}

export function alignGlobalAffineWithCoverage(leftSequence, rightSequence, options = {}) {
  ok(typeof leftSequence === "string" && CANONICAL_AA.test(leftSequence), "The left alignment sequence must use the canonical amino-acid alphabet.");
  ok(typeof rightSequence === "string" && CANONICAL_AA.test(rightSequence), "The right alignment sequence must use the canonical amino-acid alphabet.");
  const gapOpen = options.gapOpen ?? -10;
  const gapExtension = options.gapExtension ?? -1;
  ok(Number.isSafeInteger(gapOpen) && gapOpen < 0 && Number.isSafeInteger(gapExtension) && gapExtension <= 0, "Gap penalties must be frozen nonpositive safe integers.");

  const [sequenceA, sequenceB] = byteCompare(leftSequence, rightSequence) <= 0
    ? [leftSequence, rightSequence]
    : [rightSequence, leftSequence];
  const rows = sequenceA.length + 1;
  const columns = sequenceB.length + 1;
  const size = rows * columns;
  const matrixM = new Int32Array(size);
  const matrixX = new Int32Array(size);
  const matrixY = new Int32Array(size);
  matrixM.fill(NEGATIVE_INFINITY);
  matrixX.fill(NEGATIVE_INFINITY);
  matrixY.fill(NEGATIVE_INFINITY);
  const traceM = new Uint8Array(size);
  const traceX = new Uint8Array(size);
  const traceY = new Uint8Array(size);
  traceM.fill(NO_TRACE);
  traceX.fill(NO_TRACE);
  traceY.fill(NO_TRACE);
  const index = (row, column) => row * columns + column;
  matrixM[index(0, 0)] = 0;
  for (let row = 1; row < rows; row += 1) {
    const current = index(row, 0);
    matrixX[current] = gapOpen + (row - 1) * gapExtension;
    traceX[current] = row === 1 ? STATE_M : STATE_X;
  }
  for (let column = 1; column < columns; column += 1) {
    const current = index(0, column);
    matrixY[current] = gapOpen + (column - 1) * gapExtension;
    traceY[current] = column === 1 ? STATE_M : STATE_Y;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const current = index(row, column);
      const diagonal = index(row - 1, column - 1);
      const [diagonalBest, diagonalState] = chooseState([
        [STATE_M, matrixM[diagonal]],
        [STATE_X, matrixX[diagonal]],
        [STATE_Y, matrixY[diagonal]],
      ]);
      matrixM[current] = diagonalBest + substitutionScore(sequenceA[row - 1], sequenceB[column - 1]);
      traceM[current] = diagonalState;

      const above = index(row - 1, column);
      const [xBest, xState] = chooseState([
        [STATE_M, matrixM[above] + gapOpen],
        [STATE_X, matrixX[above] + gapExtension],
      ]);
      matrixX[current] = xBest;
      traceX[current] = xState;

      const previous = index(row, column - 1);
      const [yBest, yState] = chooseState([
        [STATE_M, matrixM[previous] + gapOpen],
        [STATE_Y, matrixY[previous] + gapExtension],
      ]);
      matrixY[current] = yBest;
      traceY[current] = yState;
    }
  }

  let row = sequenceA.length;
  let column = sequenceB.length;
  const terminal = index(row, column);
  const [alignmentScore, initialState] = chooseState([
    [STATE_M, matrixM[terminal]],
    [STATE_X, matrixX[terminal]],
    [STATE_Y, matrixY[terminal]],
  ]);
  let state = initialState;
  let identicalResidueColumns = 0;
  let alignedResiduePairColumns = 0;
  let alignmentColumns = 0;
  let gapColumns = 0;
  while (row > 0 || column > 0) {
    const current = index(row, column);
    if (state === STATE_M) {
      ok(row > 0 && column > 0, "The affine alignment traceback entered an impossible match state.");
      if (sequenceA[row - 1] === sequenceB[column - 1]) identicalResidueColumns += 1;
      alignedResiduePairColumns += 1;
      state = traceM[current];
      row -= 1;
      column -= 1;
      alignmentColumns += 1;
    } else if (state === STATE_X) {
      ok(row > 0, "The affine alignment traceback entered an impossible X-gap state.");
      state = traceX[current];
      row -= 1;
      alignmentColumns += 1;
      gapColumns += 1;
    } else if (state === STATE_Y) {
      ok(column > 0, "The affine alignment traceback entered an impossible Y-gap state.");
      state = traceY[current];
      column -= 1;
      alignmentColumns += 1;
      gapColumns += 1;
    } else {
      throw new Error("The affine alignment traceback encountered an invalid state.");
    }
  }
  ok(alignmentColumns > 0 && identicalResidueColumns <= alignedResiduePairColumns && alignedResiduePairColumns <= alignmentColumns, "The affine alignment produced invalid identity or coverage accounting.");
  return {
    algorithm: "global-Needleman-Wunsch-three-state-affine-gap",
    substitutionMatrix: "BLOSUM62",
    gapOpen,
    gapExtension,
    terminalGapsPenalized: true,
    stateTiePrecedence: ["M", "X", "Y"],
    sequencePairCanonicalizedBytewise: true,
    alignmentScore,
    identicalResidueColumns,
    alignedResiduePairColumns,
    alignmentColumns,
    gapColumns,
    sequenceLengthA: sequenceA.length,
    sequenceLengthB: sequenceB.length,
    identity: Number((identicalResidueColumns / alignmentColumns).toFixed(12)),
    coverageA: Number((alignedResiduePairColumns / sequenceA.length).toFixed(12)),
    coverageB: Number((alignedResiduePairColumns / sequenceB.length).toFixed(12)),
  };
}

export function evaluateFrozenReceptorThreshold(alignment, criterion = null) {
  ok(alignment && Number.isSafeInteger(alignment.identicalResidueColumns), "Alignment metrics are required.");
  const primary = criterion?.primaryIdentityMinimum ?? { numerator: 2, denominator: 5 };
  const sensitivity = criterion?.sensitivityIdentityMinimum ?? { numerator: 3, denominator: 10 };
  const coverage = criterion?.minimumCoverageEachSequence ?? { numerator: 4, denominator: 5 };
  const coverageASatisfied = alignment.alignedResiduePairColumns * coverage.denominator
    >= alignment.sequenceLengthA * coverage.numerator;
  const coverageBSatisfied = alignment.alignedResiduePairColumns * coverage.denominator
    >= alignment.sequenceLengthB * coverage.numerator;
  const primaryIdentitySatisfied = alignment.identicalResidueColumns * primary.denominator
    >= alignment.alignmentColumns * primary.numerator;
  const sensitivityIdentitySatisfied = alignment.identicalResidueColumns * sensitivity.denominator
    >= alignment.alignmentColumns * sensitivity.numerator;
  return {
    coverageASatisfied,
    coverageBSatisfied,
    bothCoverageSatisfied: coverageASatisfied && coverageBSatisfied,
    primaryIdentitySatisfied,
    sensitivityIdentitySatisfied,
    primaryThresholdSatisfied: primaryIdentitySatisfied && coverageASatisfied && coverageBSatisfied,
    sensitivityThresholdSatisfied: sensitivityIdentitySatisfied && coverageASatisfied && coverageBSatisfied,
  };
}

function boundedErrorMessage(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
  return text ? text.slice(0, 512) : null;
}

function validateContract(contract) {
  walk(contract);
  ok(contract.schemaVersion === "1.0.0", "Receptor TM contract schema drifted.");
  ok(contract.studyId === "confovhh-hard-decoy-holdout-v3", "Receptor TM contract study identity drifted.");
  ok(contract.status === "RECEPTOR_TM_PREGRAPH_RULE_FROZEN", "Receptor TM contract status drifted.");
  ok(contract.nodeUniverse.candidateNodeCount === 287 && contract.nodeUniverse.developmentNodeCount === 17 && contract.nodeUniverse.totalNodeCount === 304, "Receptor node-universe count drifted.");
  ok(contract.pairSpace.candidateCandidatePairs === 41041 && contract.pairSpace.candidateDevelopmentPairs === 4879 && contract.pairSpace.developmentDevelopmentPairs === 136 && contract.pairSpace.allUnorderedPairs === 46056, "Receptor pair-space count drifted.");
  ok(canonical(contract.tmExtraction.segments) === canonical(TM_SEGMENTS), "Frozen TM segment list drifted.");
  ok(contract.gpcrdb.captureCount === 2 && contract.gpcrdb.method === "GET", "GPCRdb capture policy drifted.");
  ok(contract.mapping.uniqueValidGpcrdbAccessionRequired === true && contract.mapping.zeroOrMultipleValidMappingsFailClosed === true, "Receptor mapping fail-closed policy drifted.");
  ok(contract.alignment.algorithm === "global-Needleman-Wunsch-three-state-affine-gap" && contract.alignment.substitutionMatrix === "BLOSUM62", "Receptor alignment algorithm drifted.");
  ok(contract.alignment.gapOpen === -10 && contract.alignment.gapExtension === -1, "Receptor affine-gap policy drifted.");
  ok(canonical(contract.alignment.stateTiePrecedence) === canonical(["M", "X", "Y"]), "Receptor tie policy drifted.");
  ok(canonical(contract.thresholds.primaryIdentityMinimum) === canonical({ numerator: 2, denominator: 5 }), "Primary receptor threshold drifted.");
  ok(canonical(contract.thresholds.sensitivityIdentityMinimum) === canonical({ numerator: 3, denominator: 10 }), "Sensitivity receptor threshold drifted.");
  ok(canonical(contract.thresholds.minimumCoverageEachSequence) === canonical({ numerator: 4, denominator: 5 }), "Receptor coverage threshold drifted.");
  ok(contract.integrity.formalLeakageGraphComplete === false && contract.integrity.formallyClearedGroupCount === 0 && contract.integrity.targetFreezePermitted === false && contract.integrity.executionAuthorized === false, "Receptor contract authority drifted.");
  return contract;
}

function parseProteinBody(accession, httpStatus, text) {
  const base = {
    accession,
    httpStatus,
    mappingStatus: null,
    errorCode: null,
    entryName: null,
    canonicalAccession: null,
    canonicalSequence: null,
    canonicalSequenceLength: null,
    canonicalSequenceSha256: null,
    receptorClass: null,
    family: null,
    species: null,
    source: null,
  };
  if (httpStatus === 404) {
    return {
      ...base,
      mappingStatus: "NO_GPCRDB_ACCESSION_RECORD",
      errorCode: "HTTP_404",
    };
  }
  if (httpStatus !== 200) {
    return {
      ...base,
      mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE",
      errorCode: `HTTP_${httpStatus}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ...base,
      mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE",
      errorCode: "INVALID_JSON",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...base,
      mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE",
      errorCode: "NON_OBJECT_JSON",
    };
  }
  const sequence = typeof parsed.sequence === "string" ? parsed.sequence.trim().toUpperCase() : "";
  const entryName = typeof parsed.entry_name === "string" ? parsed.entry_name : "";
  const canonicalAccession = typeof parsed.accession === "string" ? parsed.accession.toUpperCase() : "";
  const family = typeof parsed.family === "string" ? parsed.family : "";
  const source = typeof parsed.source === "string" ? parsed.source : "";
  if (canonicalAccession !== accession) {
    return { ...base, mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE", errorCode: "ACCESSION_MISMATCH" };
  }
  if (!GPCRDB_ENTRY.test(entryName)) {
    return { ...base, mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE", errorCode: "INVALID_ENTRY_NAME" };
  }
  if (!CANONICAL_AA.test(sequence)) {
    return { ...base, mappingStatus: "INVALID_GPCRDB_ACCESSION_RESPONSE", errorCode: "NONCANONICAL_SEQUENCE" };
  }
  if (!family.startsWith("0")) {
    return { ...base, mappingStatus: "NON_GPCR_GPCRDB_RECORD", errorCode: "FAMILY_NOT_GPCR" };
  }
  if (source.toUpperCase() !== "SWISSPROT") {
    return { ...base, mappingStatus: "NONCANONICAL_GPCRDB_RECORD", errorCode: "SOURCE_NOT_SWISSPROT" };
  }
  return {
    ...base,
    mappingStatus: "VALID_CANONICAL_GPCRDB_ACCESSION",
    entryName,
    canonicalAccession,
    canonicalSequence: sequence,
    canonicalSequenceLength: sequence.length,
    canonicalSequenceSha256: sha256(Buffer.from(sequence)),
    receptorClass: typeof parsed.receptor_class === "string" ? parsed.receptor_class : null,
    family,
    species: typeof parsed.species === "string" ? parsed.species : null,
    source,
  };
}

export function extractCanonicalTmProfile(proteinRecord, residueRows) {
  const base = {
    entryName: proteinRecord.entryName,
    accession: proteinRecord.canonicalAccession,
    extractionStatus: "FAIL_CLOSED",
    failureCode: null,
    canonicalSequence: proteinRecord.canonicalSequence,
    canonicalSequenceLength: proteinRecord.canonicalSequenceLength,
    canonicalSequenceSha256: proteinRecord.canonicalSequenceSha256,
    tmSegments: null,
    concatenatedTmSequence: null,
    concatenatedTmSequenceLength: null,
    concatenatedTmSequenceSha256: null,
    allTmResiduesHaveGenericNumbers: false,
  };
  if (!Array.isArray(residueRows)) return { ...base, failureCode: "RESIDUES_RESPONSE_NOT_ARRAY" };
  const seen = new Set();
  const normalized = [];
  for (const row of residueRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ...base, failureCode: "INVALID_RESIDUE_ROW" };
    const sequenceNumber = row.sequence_number;
    const aminoAcid = typeof row.amino_acid === "string" ? row.amino_acid.toUpperCase() : "";
    const proteinSegment = typeof row.protein_segment === "string" ? row.protein_segment : null;
    const displayGenericNumber = typeof row.display_generic_number === "string" ? row.display_generic_number : null;
    if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > proteinRecord.canonicalSequence.length) {
      return { ...base, failureCode: "INVALID_RESIDUE_SEQUENCE_NUMBER" };
    }
    if (seen.has(sequenceNumber)) return { ...base, failureCode: "DUPLICATE_RESIDUE_SEQUENCE_NUMBER" };
    seen.add(sequenceNumber);
    if (!CANONICAL_AA.test(aminoAcid) || aminoAcid.length !== 1) return { ...base, failureCode: "INVALID_RESIDUE_AMINO_ACID" };
    if (proteinRecord.canonicalSequence[sequenceNumber - 1] !== aminoAcid) return { ...base, failureCode: "RESIDUE_CANONICAL_SEQUENCE_MISMATCH" };
    normalized.push({ sequenceNumber, aminoAcid, proteinSegment, displayGenericNumber });
  }
  normalized.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const tmSegments = [];
  let previousEnd = 0;
  for (const segment of TM_SEGMENTS) {
    const residues = normalized.filter((row) => row.proteinSegment === segment);
    if (residues.length === 0) return { ...base, failureCode: `EMPTY_${segment}` };
    const start = residues[0].sequenceNumber;
    const end = residues.at(-1).sequenceNumber;
    if (start <= previousEnd) return { ...base, failureCode: "NONMONOTONIC_TM_SEGMENT_ORDER" };
    for (let index = 1; index < residues.length; index += 1) {
      if (residues[index].sequenceNumber <= residues[index - 1].sequenceNumber) return { ...base, failureCode: "NONMONOTONIC_TM_RESIDUES" };
    }
    const sequence = residues.map((row) => row.aminoAcid).join("");
    tmSegments.push({
      segment,
      sequenceStart: start,
      sequenceEnd: end,
      residueCount: residues.length,
      sequence,
      sequenceSha256: sha256(Buffer.from(sequence)),
      genericNumbers: residues.map((row) => row.displayGenericNumber),
    });
    previousEnd = end;
  }
  const concatenatedTmSequence = tmSegments.map((segment) => segment.sequence).join("");
  if (!CANONICAL_AA.test(concatenatedTmSequence) || concatenatedTmSequence.length < 100 || concatenatedTmSequence.length > 350) {
    return { ...base, failureCode: "IMPLAUSIBLE_CONCATENATED_TM_LENGTH" };
  }
  return {
    ...base,
    extractionStatus: "RESOLVED_CANONICAL_TM1_TM7",
    failureCode: null,
    tmSegments,
    concatenatedTmSequence,
    concatenatedTmSequenceLength: concatenatedTmSequence.length,
    concatenatedTmSequenceSha256: sha256(Buffer.from(concatenatedTmSequence)),
    allTmResiduesHaveGenericNumbers: tmSegments.every((segment) => segment.genericNumbers.every((value) => typeof value === "string" && value.length > 0)),
  };
}

export function resolveNodeReceptorProfile(node, accessionRecords, tmProfiles) {
  ok(node && NODE_ID.test(node.nodeId), "Invalid node for receptor mapping.");
  const accessions = uniqueStrings(node.receptor?.uniprotAccessions ?? []);
  const base = {
    nodeId: node.nodeId,
    role: node.role,
    pdbId: node.pdbId,
    receptorEntityId: node.receptor?.entityId ?? null,
    sourceUniprotAccessions: accessions,
    mappingStatus: null,
    failureCode: null,
    canonicalAccession: null,
    gpcrdbEntryName: null,
    receptorClass: null,
    family: null,
    species: null,
    canonicalSequenceLength: null,
    canonicalSequenceSha256: null,
    tmSegments: null,
    concatenatedTmSequence: null,
    concatenatedTmSequenceLength: null,
    concatenatedTmSequenceSha256: null,
    allTmResiduesHaveGenericNumbers: false,
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
    targetEligibilityAuthority: false,
    nativeCoordinatesInspected: false,
  };
  const valid = accessions
    .map((accession) => accessionRecords.get(accession))
    .filter((record) => record?.mappingStatus === "VALID_CANONICAL_GPCRDB_ACCESSION");
  if (valid.length === 0) {
    return { ...base, mappingStatus: "FAIL_CLOSED_NO_VALID_GPCRDB_ACCESSION", failureCode: "NO_VALID_GPCRDB_ACCESSION" };
  }
  if (valid.length > 1) {
    return { ...base, mappingStatus: "FAIL_CLOSED_MULTIPLE_VALID_GPCRDB_ACCESSIONS", failureCode: "MULTIPLE_VALID_GPCRDB_ACCESSIONS" };
  }
  const protein = valid[0];
  const tm = tmProfiles.get(protein.entryName);
  if (!tm || tm.extractionStatus !== "RESOLVED_CANONICAL_TM1_TM7") {
    return {
      ...base,
      mappingStatus: "FAIL_CLOSED_CANONICAL_TM_PROFILE_UNAVAILABLE",
      failureCode: tm?.failureCode ?? "CANONICAL_TM_PROFILE_MISSING",
      canonicalAccession: protein.canonicalAccession,
      gpcrdbEntryName: protein.entryName,
      receptorClass: protein.receptorClass,
      family: protein.family,
      species: protein.species,
      canonicalSequenceLength: protein.canonicalSequenceLength,
      canonicalSequenceSha256: protein.canonicalSequenceSha256,
    };
  }
  return {
    ...base,
    mappingStatus: "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7",
    failureCode: null,
    canonicalAccession: protein.canonicalAccession,
    gpcrdbEntryName: protein.entryName,
    receptorClass: protein.receptorClass,
    family: protein.family,
    species: protein.species,
    canonicalSequenceLength: protein.canonicalSequenceLength,
    canonicalSequenceSha256: protein.canonicalSequenceSha256,
    tmSegments: tm.tmSegments,
    concatenatedTmSequence: tm.concatenatedTmSequence,
    concatenatedTmSequenceLength: tm.concatenatedTmSequenceLength,
    concatenatedTmSequenceSha256: tm.concatenatedTmSequenceSha256,
    allTmResiduesHaveGenericNumbers: tm.allTmResiduesHaveGenericNumbers,
  };
}

function semanticProteinRecord(record) {
  const {
    capture,
    endpoint,
    rawBodyPath,
    rawMetaPath,
    rawBodySha256,
    retrievedAtUtc,
    attempts,
    responseHeaders,
    ...semantic
  } = record;
  return semantic;
}

function semanticTmRecord(record) {
  const {
    capture,
    endpoint,
    rawBodyPath,
    rawMetaPath,
    rawBodySha256,
    retrievedAtUtc,
    attempts,
    responseHeaders,
    ...semantic
  } = record;
  return semantic;
}

async function fetchBound(url, contract) {
  ok(typeof url === "string" && contract.gpcrdb.allowedUrlPrefixes.some((prefix) => url.startsWith(prefix)), `URL is outside the frozen allowlist: ${url}`);
  const maximumAttempts = contract.gpcrdb.maximumAttempts;
  let lastError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), contract.gpcrdb.timeoutMilliseconds);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json,text/html;q=0.8,text/plain;q=0.5",
          "user-agent": contract.gpcrdb.userAgent,
        },
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      ok(bytes.byteLength <= MAX_RAW_BYTES, `Response exceeded the frozen byte cap: ${url}`);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      clean(`raw response ${url}`, text);
      const result = {
        url,
        status: response.status,
        statusText: response.statusText,
        bytes,
        text,
        sha256: sha256(bytes),
        attempts: attempt,
        retrievedAtUtc: new Date().toISOString(),
        headers: {
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        },
      };
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maximumAttempts) {
        lastError = new Error(`Transient HTTP ${response.status} for ${url}`);
      } else {
        return result;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maximumAttempts) await sleep(contract.gpcrdb.retryDelayMilliseconds * attempt);
  }
  throw new Error(`GPCRdb/source retrieval failed after ${maximumAttempts} attempts for ${url}: ${boundedErrorMessage(lastError)}`);
}

async function mapConcurrent(items, concurrency, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return result;
}

async function archiveResponse(outputRoot, relativeBase, response) {
  const bodyRelative = `${relativeBase}.body`;
  const metaRelative = `${relativeBase}.meta.json`;
  await writeBytes(path.join(outputRoot, bodyRelative), response.bytes);
  await writeJson(path.join(outputRoot, metaRelative), {
    endpoint: response.url,
    httpStatus: response.status,
    statusText: response.statusText,
    byteLength: response.bytes.byteLength,
    bodySha256: response.sha256,
    attempts: response.attempts,
    retrievedAtUtc: response.retrievedAtUtc,
    responseHeaders: response.headers,
  });
  return { bodyRelative, metaRelative };
}

async function loadInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const contractFile = await readDirect(root, CONTRACT_REL, "receptor TM contract", 2 * 1024 * 1024);
  const contract = validateContract(JSON.parse(contractFile.text));
  const protocolFile = await readDirect(root, contract.selectedProtocol.path, "selected v3 protocol", 4 * 1024 * 1024);
  ok(protocolFile.sha256 === contract.selectedProtocol.sha256, "Selected v3 protocol digest drifted.");
  const exactChecksums = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/checksums.sha256`, "exact-evidence pregraph checksums", 128 * 1024);
  ok(exactChecksums.sha256 === contract.nodeUniverse.checksumsSha256, "Exact-evidence checksums digest drifted.");
  const candidateFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.nodeUniverse.candidateNodeFile}`, "candidate node ledger");
  const developmentFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.nodeUniverse.developmentNodeFile}`, "development node ledger");
  ok(candidateFile.sha256 === contract.nodeUniverse.candidateNodeSha256, "Candidate node ledger digest drifted.");
  ok(developmentFile.sha256 === contract.nodeUniverse.developmentNodeSha256, "Development node ledger digest drifted.");
  const candidateNodes = parseJsonl(candidateFile.text, "candidate node ledger").sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const developmentNodes = parseJsonl(developmentFile.text, "development node ledger").sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  ok(candidateNodes.length === contract.nodeUniverse.candidateNodeCount && developmentNodes.length === contract.nodeUniverse.developmentNodeCount, "Receptor node count drifted.");
  const allNodes = [...candidateNodes, ...developmentNodes].sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  ok(allNodes.length === contract.nodeUniverse.totalNodeCount && new Set(allNodes.map((node) => node.nodeId)).size === allNodes.length, "Receptor node universe is incomplete or duplicated.");
  for (const node of allNodes) {
    ok(NODE_ID.test(node.nodeId) && PDB_ID.test(node.pdbId) && node.nodeId.endsWith(node.pdbId), `Invalid receptor node identity: ${node.nodeId}`);
    ok(Array.isArray(node.receptor?.uniprotAccessions), `${node.nodeId} lacks receptor UniProt accessions.`);
  }
  return {
    root,
    contract,
    contractFile,
    protocolFile,
    exactChecksums,
    candidateFile,
    developmentFile,
    candidateNodes,
    developmentNodes,
    allNodes,
  };
}

async function captureSourceDocumentation(inputs, outputRoot) {
  const records = [];
  for (const source of inputs.contract.sourceDocumentation) {
    const response = await fetchBound(source.url, inputs.contract);
    ok(response.status === 200, `Pinned source documentation returned HTTP ${response.status}: ${source.url}`);
    const contentType = response.headers.contentType ?? "";
    ok(contentType.toLowerCase().startsWith(source.expectedMediaType.toLowerCase()), `Pinned source documentation media type drifted for ${source.url}: ${contentType}`);
    const archived = await archiveResponse(outputRoot, `source/${source.fileStem}`, response);
    records.push({
      sourceId: source.sourceId,
      url: source.url,
      expectedMediaType: source.expectedMediaType,
      httpStatus: response.status,
      rawBodyPath: archived.bodyRelative,
      rawMetaPath: archived.metaRelative,
      rawBodySha256: response.sha256,
      byteLength: response.bytes.byteLength,
      retrievedAtUtc: response.retrievedAtUtc,
    });
  }
  return records;
}

async function captureGpcrdbPass(inputs, outputRoot, capture) {
  const accessions = byteSort([...new Set(inputs.allNodes.flatMap((node) => node.receptor.uniprotAccessions))]);
  ok(accessions.every((accession) => UNIPROT_ACCESSION.test(accession)), "Node universe contains a malformed UniProt accession.");
  const proteinRows = await mapConcurrent(accessions, inputs.contract.gpcrdb.requestConcurrency, async (accession) => {
    const endpoint = inputs.contract.gpcrdb.proteinByAccessionEndpoint.replace("{accession}", encodeURIComponent(accession));
    const response = await fetchBound(endpoint, inputs.contract);
    const archived = await archiveResponse(outputRoot, `raw/capture-${capture}/protein-accession/${accession}`, response);
    const parsed = parseProteinBody(accession, response.status, response.text);
    return {
      capture,
      endpoint,
      rawBodyPath: archived.bodyRelative,
      rawMetaPath: archived.metaRelative,
      rawBodySha256: response.sha256,
      retrievedAtUtc: response.retrievedAtUtc,
      attempts: response.attempts,
      responseHeaders: response.headers,
      ...parsed,
    };
  });
  const proteinMap = new Map(proteinRows.map((row) => [row.accession, row]));
  const entryNames = byteSort([...new Set(proteinRows
    .filter((row) => row.mappingStatus === "VALID_CANONICAL_GPCRDB_ACCESSION")
    .map((row) => row.entryName))]);
  const tmRows = await mapConcurrent(entryNames, inputs.contract.gpcrdb.requestConcurrency, async (entryName) => {
    const endpoint = inputs.contract.gpcrdb.residuesEndpoint.replace("{entry_name}", encodeURIComponent(entryName));
    const response = await fetchBound(endpoint, inputs.contract);
    const archived = await archiveResponse(outputRoot, `raw/capture-${capture}/residues/${entryName}`, response);
    const protein = proteinRows.find((row) => row.entryName === entryName && row.mappingStatus === "VALID_CANONICAL_GPCRDB_ACCESSION");
    let extraction;
    if (response.status !== 200) {
      extraction = {
        entryName,
        accession: protein.canonicalAccession,
        extractionStatus: "FAIL_CLOSED",
        failureCode: `HTTP_${response.status}`,
        canonicalSequence: protein.canonicalSequence,
        canonicalSequenceLength: protein.canonicalSequenceLength,
        canonicalSequenceSha256: protein.canonicalSequenceSha256,
        tmSegments: null,
        concatenatedTmSequence: null,
        concatenatedTmSequenceLength: null,
        concatenatedTmSequenceSha256: null,
        allTmResiduesHaveGenericNumbers: false,
      };
    } else {
      let rows;
      try {
        rows = JSON.parse(response.text);
      } catch {
        rows = null;
      }
      extraction = extractCanonicalTmProfile(protein, rows);
    }
    return {
      capture,
      endpoint,
      rawBodyPath: archived.bodyRelative,
      rawMetaPath: archived.metaRelative,
      rawBodySha256: response.sha256,
      retrievedAtUtc: response.retrievedAtUtc,
      attempts: response.attempts,
      responseHeaders: response.headers,
      ...extraction,
    };
  });
  const tmMap = new Map(tmRows.map((row) => [row.entryName, row]));
  const candidateProfiles = inputs.candidateNodes.map((node) => resolveNodeReceptorProfile(node, proteinMap, tmMap));
  const developmentProfiles = inputs.developmentNodes.map((node) => resolveNodeReceptorProfile(node, proteinMap, tmMap));
  return {
    accessions,
    proteinRows,
    tmRows,
    candidateProfiles,
    developmentProfiles,
  };
}

function compareCaptureSemantics(first, second) {
  ok(canonical(first.accessions) === canonical(second.accessions), "Repeated GPCRdb accession universes disagree.");
  ok(canonical(first.proteinRows.map(semanticProteinRecord)) === canonical(second.proteinRows.map(semanticProteinRecord)), "Repeated GPCRdb accession captures disagree after normalization.");
  ok(canonical(first.tmRows.map(semanticTmRecord)) === canonical(second.tmRows.map(semanticTmRecord)), "Repeated GPCRdb residue/TM captures disagree after normalization.");
  ok(canonical(first.candidateProfiles) === canonical(second.candidateProfiles), "Repeated candidate receptor profiles disagree.");
  ok(canonical(first.developmentProfiles) === canonical(second.developmentProfiles), "Repeated development receptor profiles disagree.");
}

function alignmentSummary(result) {
  return {
    alignmentScore: result.alignmentScore,
    identicalResidueColumns: result.identicalResidueColumns,
    alignedResiduePairColumns: result.alignedResiduePairColumns,
    alignmentColumns: result.alignmentColumns,
    gapColumns: result.gapColumns,
    sequenceLengthA: result.sequenceLengthA,
    sequenceLengthB: result.sequenceLengthB,
    identity: result.identity,
    coverageA: result.coverageA,
    coverageB: result.coverageB,
  };
}

function cachedAlignment(sequenceA, sequenceB, cache, contract) {
  const ordered = byteCompare(sequenceA, sequenceB) <= 0 ? [sequenceA, sequenceB] : [sequenceB, sequenceA];
  const key = `${ordered[0]}\n${ordered[1]}`;
  if (!cache.has(key)) {
    cache.set(key, alignGlobalAffineWithCoverage(ordered[0], ordered[1], {
      gapOpen: contract.alignment.gapOpen,
      gapExtension: contract.alignment.gapExtension,
    }));
  }
  return cache.get(key);
}

function compareProfiles(profileA, profileB, cache, contract) {
  const base = {
    pairId: `${profileA.nodeId}|${profileB.nodeId}`,
    nodeA: profileA.nodeId,
    nodeB: profileB.nodeId,
    pairType: profileA.role === "CANDIDATE_SOURCE_ENTRY"
      ? (profileB.role === "CANDIDATE_SOURCE_ENTRY" ? "CANDIDATE_CANDIDATE" : "CANDIDATE_DEVELOPMENT")
      : "DEVELOPMENT_DEVELOPMENT",
    evaluationStatus: "FAIL_CLOSED_RECEPTOR_MAPPING_OR_TM_PROFILE",
    canonicalAccessionA: profileA.canonicalAccession,
    canonicalAccessionB: profileB.canonicalAccession,
    exactCanonicalAccessionMatch: false,
    tmSequenceSha256A: profileA.concatenatedTmSequenceSha256,
    tmSequenceSha256B: profileB.concatenatedTmSequenceSha256,
    alignment: null,
    coverageASatisfied: false,
    coverageBSatisfied: false,
    bothCoverageSatisfied: false,
    primaryIdentitySatisfied: false,
    sensitivityIdentitySatisfied: false,
    primaryThresholdSatisfied: false,
    sensitivityThresholdSatisfied: false,
    possiblePrimaryReceptorSequenceLeakageEdge: false,
    vetoOnlySensitivityEdge: false,
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
  };
  if (profileA.mappingStatus !== "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7"
    || profileB.mappingStatus !== "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7") return base;
  const alignment = cachedAlignment(profileA.concatenatedTmSequence, profileB.concatenatedTmSequence, cache, contract);
  const decision = evaluateFrozenReceptorThreshold(alignment, {
    primaryIdentityMinimum: contract.thresholds.primaryIdentityMinimum,
    sensitivityIdentityMinimum: contract.thresholds.sensitivityIdentityMinimum,
    minimumCoverageEachSequence: contract.thresholds.minimumCoverageEachSequence,
  });
  const exactCanonicalAccessionMatch = profileA.canonicalAccession === profileB.canonicalAccession;
  const primaryEdge = exactCanonicalAccessionMatch || decision.primaryThresholdSatisfied;
  const sensitivityEdge = exactCanonicalAccessionMatch || decision.sensitivityThresholdSatisfied;
  return {
    ...base,
    evaluationStatus: primaryEdge
      ? "POSSIBLE_PRIMARY_RECEPTOR_SEQUENCE_LEAKAGE_EDGE"
      : "NO_PRIMARY_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY",
    exactCanonicalAccessionMatch,
    alignment: alignmentSummary(alignment),
    ...decision,
    possiblePrimaryReceptorSequenceLeakageEdge: primaryEdge,
    vetoOnlySensitivityEdge: sensitivityEdge,
  };
}

function pairCommitment(pairIds) {
  const sorted = byteSort(pairIds);
  const text = sorted.length ? `${sorted.join("\n")}\n` : "";
  return { count: sorted.length, sha256: sha256(Buffer.from(text)) };
}

class UnionFind {
  constructor(nodeIds) {
    this.parent = new Map(nodeIds.map((nodeId) => [nodeId, nodeId]));
  }

  find(nodeId) {
    const parent = this.parent.get(nodeId);
    ok(parent, `Unknown union-find node: ${nodeId}`);
    if (parent !== nodeId) this.parent.set(nodeId, this.find(parent));
    return this.parent.get(nodeId);
  }

  union(left, right) {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);
    if (rootLeft === rootRight) return;
    if (byteCompare(rootLeft, rootRight) < 0) this.parent.set(rootRight, rootLeft);
    else this.parent.set(rootLeft, rootRight);
  }
}

function buildComponents(allProfiles, pairRows, edgeField, mode) {
  const nodeIds = allProfiles.map((profile) => profile.nodeId);
  const nodeMap = new Map(allProfiles.map((profile) => [profile.nodeId, profile]));
  const unionFind = new UnionFind(nodeIds);
  const edges = pairRows.filter((row) => row[edgeField]);
  for (const row of edges) unionFind.union(row.nodeA, row.nodeB);
  const grouped = new Map();
  for (const nodeId of nodeIds) {
    const root = unionFind.find(nodeId);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(nodeId);
  }
  return [...grouped.values()].map((membersUnsorted) => {
    const members = byteSort(membersUnsorted);
    const memberSet = new Set(members);
    const candidateNodeCount = members.filter((nodeId) => nodeMap.get(nodeId).role === "CANDIDATE_SOURCE_ENTRY").length;
    const developmentNodeCount = members.length - candidateNodeCount;
    return {
      componentId: sha256(Buffer.from(`${members.join("\n")}\n`)),
      mode,
      nodeIds: members,
      nodeCount: members.length,
      candidateNodeCount,
      developmentNodeCount,
      edgeCount: edges.filter((row) => memberSet.has(row.nodeA) && memberSet.has(row.nodeB)).length,
      connectedToDevelopment: developmentNodeCount > 0,
      formalLeakageComponent: false,
      formalTargetEligibilityAuthority: false,
    };
  }).sort((left, right) => byteCompare(left.componentId, right.componentId));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => byteCompare(left, right)));
}

function candidateConnectivity(candidateProfiles, components) {
  const connected = new Set(components
    .filter((component) => component.connectedToDevelopment)
    .flatMap((component) => component.nodeIds.filter((nodeId) => nodeId.startsWith("candidate:"))));
  return candidateProfiles.filter((profile) => connected.has(profile.nodeId)).length;
}

function buildPregraph(inputs, capture) {
  const candidateProfiles = capture.candidateProfiles.sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const developmentProfiles = capture.developmentProfiles.sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const allProfiles = [...candidateProfiles, ...developmentProfiles].sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const cache = new Map();
  const pairRows = [];
  for (let left = 0; left < allProfiles.length; left += 1) {
    for (let right = left + 1; right < allProfiles.length; right += 1) {
      pairRows.push(compareProfiles(allProfiles[left], allProfiles[right], cache, inputs.contract));
    }
  }
  pairRows.sort((left, right) => byteCompare(left.pairId, right.pairId));
  ok(pairRows.length === inputs.contract.pairSpace.allUnorderedPairs && new Set(pairRows.map((row) => row.pairId)).size === pairRows.length, "Complete receptor pair space drifted.");
  const candidateCandidate = pairRows.filter((row) => row.pairType === "CANDIDATE_CANDIDATE");
  const candidateDevelopment = pairRows.filter((row) => row.pairType === "CANDIDATE_DEVELOPMENT");
  const developmentDevelopment = pairRows.filter((row) => row.pairType === "DEVELOPMENT_DEVELOPMENT");
  ok(candidateCandidate.length === inputs.contract.pairSpace.candidateCandidatePairs, "Candidate-candidate receptor pair count drifted.");
  ok(candidateDevelopment.length === inputs.contract.pairSpace.candidateDevelopmentPairs, "Candidate-development receptor pair count drifted.");
  ok(developmentDevelopment.length === inputs.contract.pairSpace.developmentDevelopmentPairs, "Development-development receptor pair count drifted.");

  const pairSpaceCommitments = {
    schemaVersion: "1.0.0",
    serialization: "bytewise-sorted-canonical-nodeA-pipe-nodeB-with-terminal-LF",
    candidateCandidate: pairCommitment(candidateCandidate.map((row) => row.pairId)),
    candidateDevelopment: pairCommitment(candidateDevelopment.map((row) => row.pairId)),
    developmentDevelopment: pairCommitment(developmentDevelopment.map((row) => row.pairId)),
    allUnorderedPairs: pairCommitment(pairRows.map((row) => row.pairId)),
    completeNodePairRowsStored: true,
    absenceOfPrimaryThresholdMatchIsNotNoEdgeEvidence: true,
    sensitivityEdgesAreVetoOnly: true,
    formalLeakageGraphAuthority: false,
  };
  for (const key of ["candidateCandidate", "candidateDevelopment", "developmentDevelopment", "allUnorderedPairs"]) {
    ok(pairSpaceCommitments[key].sha256 === inputs.contract.pairSpace.commitments[key], `Receptor ${key} pair-space commitment drifted.`);
  }

  const primaryComponents = buildComponents(allProfiles, pairRows, "possiblePrimaryReceptorSequenceLeakageEdge", "PRIMARY_CANONICAL_TM1_TM7_IDENTITY_0.40_COVERAGE_0.80");
  const sensitivityComponents = buildComponents(allProfiles, pairRows, "vetoOnlySensitivityEdge", "VETO_ONLY_CANONICAL_TM1_TM7_IDENTITY_0.30_COVERAGE_0.80");
  const resolvedCandidateProfiles = candidateProfiles.filter((profile) => profile.mappingStatus === "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7").length;
  const resolvedDevelopmentProfiles = developmentProfiles.filter((profile) => profile.mappingStatus === "RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7").length;
  const summary = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    status: STATUS,
    candidateNodeCount: candidateProfiles.length,
    developmentNodeCount: developmentProfiles.length,
    totalNodeCount: allProfiles.length,
    uniqueSourceUniprotAccessionCount: capture.accessions.length,
    validCanonicalGpcrdbAccessionCount: capture.proteinRows.filter((row) => row.mappingStatus === "VALID_CANONICAL_GPCRDB_ACCESSION").length,
    uniqueResolvedGpcrdbEntryCount: capture.tmRows.filter((row) => row.extractionStatus === "RESOLVED_CANONICAL_TM1_TM7").length,
    resolvedCandidateProfileCount: resolvedCandidateProfiles,
    resolvedDevelopmentProfileCount: resolvedDevelopmentProfiles,
    failClosedCandidateProfileCount: candidateProfiles.length - resolvedCandidateProfiles,
    failClosedDevelopmentProfileCount: developmentProfiles.length - resolvedDevelopmentProfiles,
    nodeMappingStatusCounts: countBy(allProfiles, "mappingStatus"),
    pairSpace: {
      candidateCandidate: candidateCandidate.length,
      candidateDevelopment: candidateDevelopment.length,
      developmentDevelopment: developmentDevelopment.length,
      allUnorderedPairs: pairRows.length,
    },
    pairEvaluationStatusCounts: countBy(pairRows, "evaluationStatus"),
    primaryEdgePairCounts: {
      candidateCandidate: candidateCandidate.filter((row) => row.possiblePrimaryReceptorSequenceLeakageEdge).length,
      candidateDevelopment: candidateDevelopment.filter((row) => row.possiblePrimaryReceptorSequenceLeakageEdge).length,
      developmentDevelopment: developmentDevelopment.filter((row) => row.possiblePrimaryReceptorSequenceLeakageEdge).length,
      all: pairRows.filter((row) => row.possiblePrimaryReceptorSequenceLeakageEdge).length,
    },
    sensitivityEdgePairCounts: {
      candidateCandidate: candidateCandidate.filter((row) => row.vetoOnlySensitivityEdge).length,
      candidateDevelopment: candidateDevelopment.filter((row) => row.vetoOnlySensitivityEdge).length,
      developmentDevelopment: developmentDevelopment.filter((row) => row.vetoOnlySensitivityEdge).length,
      all: pairRows.filter((row) => row.vetoOnlySensitivityEdge).length,
    },
    exactCanonicalAccessionMatchPairCount: pairRows.filter((row) => row.exactCanonicalAccessionMatch).length,
    alignmentCacheEntryCount: cache.size,
    primaryComponentCount: primaryComponents.length,
    sensitivityComponentCount: sensitivityComponents.length,
    candidateNodesConnectedToDevelopmentPrimary: candidateConnectivity(candidateProfiles, primaryComponents),
    candidateNodesConnectedToDevelopmentSensitivity: candidateConnectivity(candidateProfiles, sensitivityComponents),
    normalizedRepeatedCaptureAgreement: true,
    primarySequenceComponentsAreNotBiologicalFamilyClaims: true,
    sensitivityEdgesAreVetoOnly: true,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    nativeEpitopesAccessed: false,
    dockqLabelsAccessed: false,
    confovhhHoldoutScoresAccessed: false,
    performanceResultsAccessed: false,
  };
  return {
    candidateProfiles,
    developmentProfiles,
    allProfiles,
    pairRows,
    primaryComponents,
    sensitivityComponents,
    pairSpaceCommitments,
    summary,
  };
}

function accessionProbeRows(first, second) {
  return first.proteinRows.map((row, index) => ({
    accession: row.accession,
    capture1HttpStatus: row.httpStatus,
    capture2HttpStatus: second.proteinRows[index].httpStatus,
    normalizedMappingStatus: row.mappingStatus,
    normalizedErrorCode: row.errorCode,
    entryName: row.entryName,
    canonicalSequenceSha256: row.canonicalSequenceSha256,
    capture1RawBodyPath: row.rawBodyPath,
    capture1RawBodySha256: row.rawBodySha256,
    capture2RawBodyPath: second.proteinRows[index].rawBodyPath,
    capture2RawBodySha256: second.proteinRows[index].rawBodySha256,
    normalizedCaptureAgreement: canonical(semanticProteinRecord(row)) === canonical(semanticProteinRecord(second.proteinRows[index])),
  }));
}

function canonicalReceptorRows(first, second) {
  return first.tmRows.map((row, index) => ({
    entryName: row.entryName,
    accession: row.accession,
    extractionStatus: row.extractionStatus,
    failureCode: row.failureCode,
    canonicalSequenceLength: row.canonicalSequenceLength,
    canonicalSequenceSha256: row.canonicalSequenceSha256,
    tmSegments: row.tmSegments,
    concatenatedTmSequence: row.concatenatedTmSequence,
    concatenatedTmSequenceLength: row.concatenatedTmSequenceLength,
    concatenatedTmSequenceSha256: row.concatenatedTmSequenceSha256,
    allTmResiduesHaveGenericNumbers: row.allTmResiduesHaveGenericNumbers,
    capture1RawBodyPath: row.rawBodyPath,
    capture1RawBodySha256: row.rawBodySha256,
    capture2RawBodyPath: second.tmRows[index].rawBodyPath,
    capture2RawBodySha256: second.tmRows[index].rawBodySha256,
    normalizedCaptureAgreement: canonical(semanticTmRecord(row)) === canonical(semanticTmRecord(second.tmRows[index])),
  }));
}

async function outputDigest(filename) {
  const bytes = await readFile(filename);
  return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function captureAndGenerate({ repositoryRoot = ROOT, outputDirectory }) {
  const inputs = await loadInputs(repositoryRoot);
  const outputRoot = path.resolve(outputDirectory);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const sourceDocumentation = await captureSourceDocumentation(inputs, outputRoot);
  const first = await captureGpcrdbPass(inputs, outputRoot, 1);
  const second = await captureGpcrdbPass(inputs, outputRoot, 2);
  compareCaptureSemantics(first, second);
  const built = buildPregraph(inputs, first);

  const normalizedFiles = {
    "accession-probes.jsonl": jsonl(accessionProbeRows(first, second)),
    "canonical-receptors.jsonl": jsonl(canonicalReceptorRows(first, second)),
    "candidate-receptor-profiles.jsonl": jsonl(built.candidateProfiles),
    "development-receptor-profiles.jsonl": jsonl(built.developmentProfiles),
    "receptor-pair-matrix.jsonl": jsonl(built.pairRows),
    "primary-components.jsonl": jsonl(built.primaryComponents),
    "sensitivity-components.jsonl": jsonl(built.sensitivityComponents),
    "pair-space-commitments.json": canonicalJson(built.pairSpaceCommitments),
    "summary.json": canonicalJson(built.summary),
  };
  for (const [relative, text] of Object.entries(normalizedFiles)) await writeText(path.join(outputRoot, relative), text);

  const license = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    recordedDateUtc: inputs.contract.snapshotDateUtc,
    dataSource: {
      name: "GPCRdb",
      licenseSpdx: "CC-BY-4.0",
      licenseEvidenceUrl: inputs.contract.license.dataLicenseEvidenceUrl,
      attribution: inputs.contract.license.dataAttribution,
      changes: "Exact API responses are archived; canonical receptor and TM1-TM7 sequence records, pairwise alignments, threshold decisions, and components are derived and checksummed.",
    },
    sourceCodeDocumentation: {
      repository: inputs.contract.gpcrdb.sourceRepository,
      commit: inputs.contract.gpcrdb.sourceCommit,
      licenseSpdx: "Apache-2.0",
      licensePath: inputs.contract.license.sourceCodeLicensePath,
      purpose: "Endpoint-route and response-field provenance only; this does not prove the deployed service runs the pinned commit.",
    },
  };
  await writeJson(path.join(outputRoot, "source-license.json"), license);
  const readme = `# ConfoVHH hard-decoy v3 canonical receptor TM1-TM7 pregraph

Status: **${STATUS}**.

This metadata-only snapshot maps every frozen candidate and development node through the GPCRdb accession endpoint, requires one unique canonical SWISSPROT GPCR record, extracts canonical TM1 through TM7 from the GPCRdb residue endpoint, and serializes every unordered node pair.

The primary possible-leakage rule is identical canonical receptor accession or global TM1-TM7 identity >=0.40 at >=0.80 coverage of each sequence. A >=0.30 identity threshold at the same coverage is retained only as a conservative veto sensitivity. Equality creates an edge.

A missing, invalid, or multiply mapped receptor profile produces FAIL_CLOSED. Absence of a primary threshold match is not formal NO_EDGE evidence. Components are sequence-evidence components, not biological receptor-family claims or benchmark-independent groups.

Two complete GPCRdb captures must agree after normalization. Raw responses, source documentation, normalized records, pair matrices, manifests, and checksums are preserved. No native coordinates, relative poses, native epitopes, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results are accessed. Target freeze and execution remain unauthorized.
`;
  await writeText(path.join(outputRoot, "README.md"), readme);

  const normalizedOutputs = {};
  for (const relative of [...Object.keys(normalizedFiles), "source-license.json", "README.md"]) {
    normalizedOutputs[relative] = await outputDigest(path.join(outputRoot, relative));
  }
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-hard-decoy-holdout-v3",
    stage: "V3_METADATA_PREPARATION",
    status: STATUS,
    snapshotDateUtc: inputs.contract.snapshotDateUtc,
    contractPath: CONTRACT_REL,
    generatorScript: path.relative(inputs.root, HERE).split(path.sep).join("/"),
    inputDigests: {
      contract: inputs.contractFile.sha256,
      selectedProtocol: inputs.protocolFile.sha256,
      exactPregraphChecksums: inputs.exactChecksums.sha256,
      candidateNodeLedger: inputs.candidateFile.sha256,
      developmentNodeLedger: inputs.developmentFile.sha256,
      generatorScript: sha256(await readFile(HERE)),
    },
    sourceDocumentation,
    gpcrdbCapture: {
      captureCount: 2,
      uniqueAccessionCount: first.accessions.length,
      capture1ProteinResponseCount: first.proteinRows.length,
      capture2ProteinResponseCount: second.proteinRows.length,
      capture1ResidueResponseCount: first.tmRows.length,
      capture2ResidueResponseCount: second.tmRows.length,
      normalizedCaptureAgreement: true,
    },
    normalizedOutputs,
    pairSpaceCommitments: built.pairSpaceCommitments,
    summary: built.summary,
    sequenceEvidencePregraphOnly: true,
    primarySequenceComponentsAreNotBiologicalFamilyClaims: true,
    sensitivityEdgesAreVetoOnly: true,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    nativeEpitopesAccessed: false,
    dockqLabelsAccessed: false,
    confovhhHoldoutScoresAccessed: false,
    performanceResultsAccessed: false,
  };
  await writeJson(path.join(outputRoot, "manifest.json"), manifest);

  const files = (await listFilesRecursive(outputRoot)).filter((relative) => relative !== "checksums.sha256");
  const checksumRows = [];
  for (const relative of files) checksumRows.push(`${sha256(await readFile(path.join(outputRoot, relative)))}  ${relative}`);
  await writeText(path.join(outputRoot, "checksums.sha256"), `${checksumRows.join("\n")}\n`);

  return { ...built.summary, outputDirectory: outputRoot };
}

async function verifyChecksums(snapshotRoot) {
  const checksumFile = await readDirect(snapshotRoot, "checksums.sha256", "receptor TM snapshot checksums", 4 * 1024 * 1024);
  ok(checksumFile.text.endsWith("\n"), "Receptor TM checksums must end with LF.");
  const rows = checksumFile.text.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(row);
    ok(match, `Invalid receptor TM checksum row ${index + 1}.`);
    safeRelative(match[2], `checksum row ${index + 1}`);
    return { digest: match[1], relative: match[2] };
  });
  ok(new Set(rows.map((row) => row.relative)).size === rows.length, "Receptor TM checksum paths are duplicated.");
  const actual = (await listFilesRecursive(snapshotRoot)).filter((relative) => relative !== "checksums.sha256");
  ok(canonical(byteSort(rows.map((row) => row.relative))) === canonical(byteSort(actual)), "Receptor TM checksum inventory is incomplete.");
  for (const row of rows) {
    const file = await readDirect(snapshotRoot, row.relative, `snapshot file ${row.relative}`, MAX_NORMALIZED_BYTES);
    ok(file.sha256 === row.digest, `Receptor TM snapshot digest mismatch: ${row.relative}`);
  }
  return checksumFile.sha256;
}

function profileMap(rows) {
  const map = new Map();
  for (const row of rows) {
    ok(NODE_ID.test(row.nodeId) && !map.has(row.nodeId), `Invalid or duplicate receptor profile: ${row.nodeId}`);
    map.set(row.nodeId, row);
  }
  return map;
}

async function rederiveCaptureFromRaw(snapshotRoot, manifest, captureNumber) {
  const accessionRows = parseJsonl((await readDirect(snapshotRoot, "accession-probes.jsonl", "accession probes")).text, "accession probes");
  const proteinRows = [];
  for (const row of accessionRows) {
    const bodyPath = row[`capture${captureNumber}RawBodyPath`];
    const body = await readDirect(snapshotRoot, bodyPath, `${bodyPath} raw body`, MAX_RAW_BYTES);
    ok(body.sha256 === row[`capture${captureNumber}RawBodySha256`], `${bodyPath} digest disagrees with accession probe.`);
    const metaPath = bodyPath.replace(/\.body$/u, ".meta.json");
    const meta = JSON.parse((await readDirect(snapshotRoot, metaPath, `${metaPath} metadata`, 256 * 1024)).text);
    ok(meta.bodySha256 === body.sha256 && meta.endpoint.includes(`/protein/accession/${row.accession}/`), `${row.accession} raw metadata drifted.`);
    proteinRows.push({
      capture: captureNumber,
      endpoint: meta.endpoint,
      rawBodyPath: bodyPath,
      rawMetaPath: metaPath,
      rawBodySha256: body.sha256,
      retrievedAtUtc: meta.retrievedAtUtc,
      attempts: meta.attempts,
      responseHeaders: meta.responseHeaders,
      ...parseProteinBody(row.accession, meta.httpStatus, body.text),
    });
  }
  const proteinMap = new Map(proteinRows.map((row) => [row.accession, row]));
  const canonicalRows = parseJsonl((await readDirect(snapshotRoot, "canonical-receptors.jsonl", "canonical receptors")).text, "canonical receptors");
  const tmRows = [];
  for (const row of canonicalRows) {
    const bodyPath = row[`capture${captureNumber}RawBodyPath`];
    const body = await readDirect(snapshotRoot, bodyPath, `${bodyPath} raw body`, MAX_RAW_BYTES);
    ok(body.sha256 === row[`capture${captureNumber}RawBodySha256`], `${bodyPath} digest disagrees with canonical receptor record.`);
    const metaPath = bodyPath.replace(/\.body$/u, ".meta.json");
    const meta = JSON.parse((await readDirect(snapshotRoot, metaPath, `${metaPath} metadata`, 256 * 1024)).text);
    const protein = proteinRows.find((candidate) => candidate.entryName === row.entryName && candidate.mappingStatus === "VALID_CANONICAL_GPCRDB_ACCESSION");
    ok(protein, `Canonical receptor lacks a valid accession record: ${row.entryName}`);
    let residueRows = null;
    if (meta.httpStatus === 200) {
      try {
        residueRows = JSON.parse(body.text);
      } catch {
        residueRows = null;
      }
    }
    const extraction = meta.httpStatus === 200
      ? extractCanonicalTmProfile(protein, residueRows)
      : {
        entryName: protein.entryName,
        accession: protein.canonicalAccession,
        extractionStatus: "FAIL_CLOSED",
        failureCode: `HTTP_${meta.httpStatus}`,
        canonicalSequence: protein.canonicalSequence,
        canonicalSequenceLength: protein.canonicalSequenceLength,
        canonicalSequenceSha256: protein.canonicalSequenceSha256,
        tmSegments: null,
        concatenatedTmSequence: null,
        concatenatedTmSequenceLength: null,
        concatenatedTmSequenceSha256: null,
        allTmResiduesHaveGenericNumbers: false,
      };
    tmRows.push({
      capture: captureNumber,
      endpoint: meta.endpoint,
      rawBodyPath: bodyPath,
      rawMetaPath: metaPath,
      rawBodySha256: body.sha256,
      retrievedAtUtc: meta.retrievedAtUtc,
      attempts: meta.attempts,
      responseHeaders: meta.responseHeaders,
      ...extraction,
    });
  }
  tmRows.sort((left, right) => byteCompare(left.entryName, right.entryName));
  return {
    accessions: accessionRows.map((row) => row.accession),
    proteinRows,
    tmRows,
    proteinMap,
    tmMap: new Map(tmRows.map((row) => [row.entryName, row])),
  };
}

async function verifyReceptorTmPregraph({ repositoryRoot = ROOT, snapshotDirectory }) {
  const inputs = await loadInputs(repositoryRoot);
  const snapshotRoot = await realpath(snapshotDirectory);
  ok(snapshotRoot === path.resolve(snapshotDirectory), "Receptor TM snapshot path cannot contain symlinked ancestors.");
  const checksumsSha256 = await verifyChecksums(snapshotRoot);
  const manifestFile = await readDirect(snapshotRoot, "manifest.json", "receptor TM manifest", 4 * 1024 * 1024);
  const summaryFile = await readDirect(snapshotRoot, "summary.json", "receptor TM summary", 2 * 1024 * 1024);
  const manifest = JSON.parse(manifestFile.text);
  const summary = JSON.parse(summaryFile.text);
  walk(manifest);
  walk(summary);
  ok(manifest.status === STATUS && summary.status === STATUS, "Receptor TM snapshot status drifted.");
  ok(manifest.inputDigests.contract === inputs.contractFile.sha256 && manifest.inputDigests.selectedProtocol === inputs.protocolFile.sha256, "Receptor TM manifest input digest drifted.");
  ok(manifest.gpcrdbCapture.captureCount === 2 && manifest.gpcrdbCapture.normalizedCaptureAgreement === true, "Receptor TM repeated-capture contract drifted.");
  const first = await rederiveCaptureFromRaw(snapshotRoot, manifest, 1);
  const second = await rederiveCaptureFromRaw(snapshotRoot, manifest, 2);
  compareCaptureSemantics(first, second);

  const candidateRows = parseJsonl((await readDirect(snapshotRoot, "candidate-receptor-profiles.jsonl", "candidate receptor profiles")).text, "candidate receptor profiles");
  const developmentRows = parseJsonl((await readDirect(snapshotRoot, "development-receptor-profiles.jsonl", "development receptor profiles")).text, "development receptor profiles");
  const candidateProfiles = inputs.candidateNodes.map((node) => resolveNodeReceptorProfile(node, first.proteinMap, first.tmMap));
  const developmentProfiles = inputs.developmentNodes.map((node) => resolveNodeReceptorProfile(node, first.proteinMap, first.tmMap));
  ok(canonical(candidateProfiles) === canonical(candidateRows), "Candidate receptor profiles do not rederive from raw capture.");
  ok(canonical(developmentProfiles) === canonical(developmentRows), "Development receptor profiles do not rederive from raw capture.");

  const rebuilt = buildPregraph(inputs, {
    accessions: first.accessions,
    proteinRows: first.proteinRows,
    tmRows: first.tmRows,
    candidateProfiles,
    developmentProfiles,
  });
  const pairFile = await readDirect(snapshotRoot, "receptor-pair-matrix.jsonl", "receptor pair matrix", MAX_NORMALIZED_BYTES);
  const primaryFile = await readDirect(snapshotRoot, "primary-components.jsonl", "primary receptor components", 16 * 1024 * 1024);
  const sensitivityFile = await readDirect(snapshotRoot, "sensitivity-components.jsonl", "sensitivity receptor components", 16 * 1024 * 1024);
  const commitmentsFile = await readDirect(snapshotRoot, "pair-space-commitments.json", "receptor pair-space commitments", 2 * 1024 * 1024);
  ok(pairFile.text === jsonl(rebuilt.pairRows), "Complete receptor pair matrix does not independently regenerate.");
  ok(primaryFile.text === jsonl(rebuilt.primaryComponents), "Primary receptor components do not independently regenerate.");
  ok(sensitivityFile.text === jsonl(rebuilt.sensitivityComponents), "Sensitivity receptor components do not independently regenerate.");
  ok(commitmentsFile.text === canonicalJson(rebuilt.pairSpaceCommitments), "Receptor pair-space commitments do not independently regenerate.");
  ok(summaryFile.text === canonicalJson(rebuilt.summary), "Receptor TM summary does not independently regenerate.");

  const allProfiles = [...candidateRows, ...developmentRows];
  profileMap(allProfiles);
  for (const profile of allProfiles) {
    for (const field of ["formalLeakageEdgeAuthority", "formalNoEdgeAuthority", "targetEligibilityAuthority", "nativeCoordinatesInspected"]) {
      ok(profile[field] === false, `${profile.nodeId} authority/access field must remain false: ${field}`);
    }
  }
  for (const field of [
    "formalLeakageGraphComplete",
    "dispositionLedgerComplete",
    "exactFrozenTargetSetExists",
    "targetFreezePermitted",
    "executionAuthorized",
    "nativeHoldoutCoordinatesAccessed",
    "nativeRelativePosesInspected",
    "nativeEpitopesAccessed",
    "dockqLabelsAccessed",
    "confovhhHoldoutScoresAccessed",
    "performanceResultsAccessed",
  ]) ok(summary[field] === false, `Receptor TM summary authority/access field must remain false: ${field}`);
  ok(summary.formallyClearedGroupCount === 0, "Receptor TM snapshot cannot clear benchmark groups.");

  return {
    ...rebuilt.summary,
    checksumsSha256,
    manifestSha256: manifestFile.sha256,
    summarySha256: summaryFile.sha256,
  };
}

const command = process.argv[2];
if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  try {
    if (command === "capture") {
      const output = process.argv[3];
      ok(output, "Usage: node scripts/hard-decoy/v3-receptor-tm-pregraph.mjs capture <output-directory>");
      console.log(JSON.stringify(await captureAndGenerate({ outputDirectory: path.resolve(output) }), null, 2));
    } else if (command === "verify") {
      const snapshot = process.argv[3];
      ok(snapshot, "Usage: node scripts/hard-decoy/v3-receptor-tm-pregraph.mjs verify <snapshot-directory>");
      console.log(JSON.stringify(await verifyReceptorTmPregraph({ snapshotDirectory: path.resolve(snapshot) }), null, 2));
    } else {
      throw new Error("Usage: node scripts/hard-decoy/v3-receptor-tm-pregraph.mjs <capture|verify> <directory>");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export {
  STATUS,
  captureAndGenerate,
  parseProteinBody,
  verifyReceptorTmPregraph,
};
