import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Annotator } from "immunum";

import { verifyExactEvidencePregraph } from "./v3-exact-evidence-pregraph.mjs";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const CONTRACT_REL = "validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json";
const STATUS = "VHH_SEQUENCE_PREGRAPH_COMPLETED_BLOCKED_PENDING_DIRECT_ROLE_AND_PARENT_ADJUDICATION";
const SHA256 = /^[a-f0-9]{64}$/u;
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const NODE_ID = /^(?:candidate|development):[0-9][A-Z0-9]{3}$/u;
const PROFILE_ID = /^(?:candidate|development):[0-9][A-Z0-9]{3}#entity:[A-Za-z0-9._-]+$/u;
const CANONICAL_AA = /^[ACDEFGHIKLMNPQRSTVWY]+$/u;
const COORDINATE = /(?:^|[\r\n"'`])[ \t]*(?:ATOM {2}|HETATM).{20,}|(?:^|[\r\n"'`])[ \t]*_atom_site\.(?:group_PDB|Cartn_[xyz])\b/imu;
const OBSERVED_LABEL = /\b(?:DockQ|Fnat|iRMSD|LRMSD)\s*(?:=|:)\s*(?:\d+(?:\.\d+)?|\.\d+)\b|\bCAPRI(?:Class|Label)?\s*(?:=|:)\s*(?:incorrect|acceptable|medium|high)\b/iu;
const FORBIDDEN_KEYS = /^(?:dockq|dockqScore|capri|capriClass|fnat|irmsd|lrmsd|nativeCoordinates|nativeInterfaceResidues|confovhhScore|performanceResult|annotationEpitopeEdge)$/iu;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 96 * 1024 * 1024;
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
  [0, -3, -3, -3, -1, -2, -2, -3, -3, 3, 1, -2, 1, -1, -2, -2, 0, -3, -1, 4]
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

function uniqueStrings(values) {
  return byteSort([...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]);
}

function jsonl(rows) {
  return rows.length ? `${rows.map(canonical).join("\n")}\n` : "";
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

function safePath(root, relative, label) {
  ok(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is unsafe.`);
  const filename = path.resolve(root, relative);
  const containment = path.relative(root, filename);
  ok(containment && containment !== ".." && !containment.startsWith(`..${path.sep}`) && !path.isAbsolute(containment), `${label} escaped its root.`);
  return filename;
}

async function readDirect(root, relative, label, maximumBytes = MAX_FILE_BYTES) {
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

function mapUnique(rows, key, label, pattern = null) {
  const map = new Map();
  for (const row of rows) {
    const id = row?.[key];
    ok(typeof id === "string" && (!pattern || pattern.test(id)), `${label} contains an invalid ${key}.`);
    ok(!map.has(id), `${label} contains duplicate ${key}: ${id}`);
    map.set(id, row);
  }
  return map;
}

function imgtRegion(position) {
  if (typeof position !== "string" || !position) return "OUTSIDE";
  const numeric = Number.parseInt(position, 10);
  if (!Number.isFinite(numeric)) return "OUTSIDE";
  if (numeric >= 1 && numeric <= 26) return "FR1-IMGT";
  if (numeric >= 27 && numeric <= 38) return "CDR1-IMGT";
  if (numeric >= 39 && numeric <= 55) return "FR2-IMGT";
  if (numeric >= 56 && numeric <= 65) return "CDR2-IMGT";
  if (numeric >= 66 && numeric <= 104) return "FR3-IMGT";
  if (numeric >= 105 && numeric <= 117) return "CDR3-IMGT";
  if (numeric >= 118 && numeric <= 128) return "FR4-IMGT";
  return "OUTSIDE";
}

function boundedErrorMessage(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
  return text ? text.slice(0, 512) : null;
}

export function numberVhhForLeakage(sequence, options = {}) {
  const engine = options.engine ?? "immunum 1.3.0";
  const scheme = options.scheme ?? "IMGT";
  const minimumConfidence = options.minimumConfidence ?? 0.5;
  const normalized = typeof sequence === "string" ? sequence.trim().toUpperCase() : "";
  const base = {
    numberingStatus: "UNAVAILABLE",
    numberingFailureCode: null,
    numberingFailureMessage: null,
    numberingScheme: scheme,
    numberingEngine: engine,
    detectedChain: null,
    confidence: null,
    queryStart: null,
    queryEnd: null,
    frameworkSequence: null,
    frameworkLength: null,
    frameworkSequenceSha256: null,
    cdr3Sequence: null,
    cdr3Length: null,
    cdr3SequenceSha256: null,
    imgtRegionLengths: null,
    completeImgtRegionCoverage: false,
    numberingSegmentationAgreement: false,
  };
  if (!normalized || !CANONICAL_AA.test(normalized)) {
    return {
      ...base,
      numberingFailureCode: "NONCANONICAL_OR_EMPTY_SEQUENCE",
      numberingFailureMessage: "The frozen VHH leakage matrix accepts only the 20 canonical amino acids.",
    };
  }

  let annotator = null;
  try {
    annotator = new Annotator(["H"], "imgt", minimumConfidence);
    const result = annotator.number(normalized);
    if (result.error || result.chain !== "H" || result.confidence == null || result.query_start == null || result.query_end == null || !result.numbering) {
      return {
        ...base,
        numberingFailureCode: "NO_CONFIDENT_HEAVY_CHAIN_V_DOMAIN",
        numberingFailureMessage: boundedErrorMessage(result.error) ?? "No antibody heavy-chain V-domain was recognized at the frozen confidence threshold.",
      };
    }
    const entries = Array.from(result.numbering.entries());
    const expectedLength = result.query_end - result.query_start + 1;
    if (entries.length !== expectedLength || expectedLength <= 0) {
      return {
        ...base,
        numberingFailureCode: "INCONSISTENT_NUMBERING_LENGTH",
        numberingFailureMessage: "The numbering engine returned an inconsistent sequence mapping.",
      };
    }

    const requiredRegions = ["FR1-IMGT", "CDR1-IMGT", "FR2-IMGT", "CDR2-IMGT", "FR3-IMGT", "CDR3-IMGT", "FR4-IMGT"];
    const residuesByRegion = Object.fromEntries(requiredRegions.map((region) => [region, []]));
    for (let offset = 0; offset < entries.length; offset += 1) {
      const [position, aminoAcid] = entries[offset];
      const sequenceIndex = result.query_start + offset;
      if (normalized[sequenceIndex] !== aminoAcid || !CANONICAL_AA.test(aminoAcid)) {
        return {
          ...base,
          numberingFailureCode: "NUMBERING_SEQUENCE_MAP_MISMATCH",
          numberingFailureMessage: "The numbered residues did not map exactly to the source sequence.",
        };
      }
      const region = imgtRegion(position);
      if (residuesByRegion[region]) residuesByRegion[region].push(aminoAcid);
    }
    const mapSegments = {
      fr1: residuesByRegion["FR1-IMGT"].join(""),
      cdr1: residuesByRegion["CDR1-IMGT"].join(""),
      fr2: residuesByRegion["FR2-IMGT"].join(""),
      cdr2: residuesByRegion["CDR2-IMGT"].join(""),
      fr3: residuesByRegion["FR3-IMGT"].join(""),
      cdr3: residuesByRegion["CDR3-IMGT"].join(""),
      fr4: residuesByRegion["FR4-IMGT"].join(""),
    };
    const segmented = annotator.segment(normalized);
    if (segmented.error) {
      return {
        ...base,
        numberingFailureCode: "NUMBERING_SEGMENTATION_ERROR",
        numberingFailureMessage: boundedErrorMessage(segmented.error) ?? "The pinned numbering engine could not segment the V-domain.",
      };
    }
    const requiredSegmentNames = ["fr1", "cdr1", "fr2", "cdr2", "fr3", "cdr3", "fr4"];
    if (requiredSegmentNames.some((name) => typeof segmented[name] !== "string" || segmented[name].length === 0 || mapSegments[name].length === 0)) {
      return {
        ...base,
        numberingFailureCode: "INCOMPLETE_IMGT_V_DOMAIN",
        numberingFailureMessage: "IMGT numbering must yield nonempty FR1, CDR1, FR2, CDR2, FR3, CDR3, and FR4 regions.",
      };
    }
    if (requiredSegmentNames.some((name) => segmented[name] !== mapSegments[name])) {
      return {
        ...base,
        numberingFailureCode: "NUMBERING_SEGMENTATION_MISMATCH",
        numberingFailureMessage: "Number-map-derived and segment-derived IMGT regions disagree.",
      };
    }
    const frameworkSequence = [segmented.fr1, segmented.fr2, segmented.fr3, segmented.fr4].join("");
    const cdr3Sequence = segmented.cdr3;
    const imgtRegionLengths = {
      "FR1-IMGT": segmented.fr1.length,
      "CDR1-IMGT": segmented.cdr1.length,
      "FR2-IMGT": segmented.fr2.length,
      "CDR2-IMGT": segmented.cdr2.length,
      "FR3-IMGT": segmented.fr3.length,
      "CDR3-IMGT": segmented.cdr3.length,
      "FR4-IMGT": segmented.fr4.length,
    };
    return {
      ...base,
      numberingStatus: "NUMBERED",
      numberingFailureCode: null,
      numberingFailureMessage: null,
      detectedChain: result.chain,
      confidence: result.confidence,
      queryStart: result.query_start,
      queryEnd: result.query_end,
      frameworkSequence,
      frameworkLength: frameworkSequence.length,
      frameworkSequenceSha256: sha256(Buffer.from(frameworkSequence)),
      cdr3Sequence,
      cdr3Length: cdr3Sequence.length,
      cdr3SequenceSha256: sha256(Buffer.from(cdr3Sequence)),
      imgtRegionLengths,
      completeImgtRegionCoverage: true,
      numberingSegmentationAgreement: true,
    };
  } catch (error) {
    return {
      ...base,
      numberingFailureCode: "NUMBERING_ENGINE_ERROR",
      numberingFailureMessage: boundedErrorMessage(error instanceof Error ? error.message : String(error)) ?? "The IMGT numbering engine failed.",
    };
  } finally {
    annotator?.free();
  }
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

export function alignGlobalAffine(leftSequence, rightSequence, options = {}) {
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
  let alignmentColumns = 0;
  let gapColumns = 0;
  while (row > 0 || column > 0) {
    const current = index(row, column);
    if (state === STATE_M) {
      ok(row > 0 && column > 0, "The affine alignment traceback entered an impossible match state.");
      if (sequenceA[row - 1] === sequenceB[column - 1]) identicalResidueColumns += 1;
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
  ok(alignmentColumns > 0 && identicalResidueColumns <= alignmentColumns, "The affine alignment produced invalid identity accounting.");
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
    alignmentColumns,
    gapColumns,
    identity: Number((identicalResidueColumns / alignmentColumns).toFixed(12)),
  };
}

export function evaluateFrozenVhhThreshold({ framework, cdr3, cdr3LengthA, cdr3LengthB }, criterion = null) {
  ok(framework && cdr3, "Framework and CDR3 alignment metrics are required.");
  const frameworkNumerator = criterion?.frameworkIdentityMinimum?.numerator ?? 9;
  const frameworkDenominator = criterion?.frameworkIdentityMinimum?.denominator ?? 10;
  const cdr3Numerator = criterion?.cdr3IdentityMinimum?.numerator ?? 7;
  const cdr3Denominator = criterion?.cdr3IdentityMinimum?.denominator ?? 10;
  const maximumLengthDifference = criterion?.maximumAbsoluteCdr3LengthDifference ?? 2;
  const cdr3LengthDifference = Math.abs(cdr3LengthA - cdr3LengthB);
  const frameworkIdentitySatisfied = framework.identicalResidueColumns * frameworkDenominator
    >= framework.alignmentColumns * frameworkNumerator;
  const cdr3IdentitySatisfied = cdr3.identicalResidueColumns * cdr3Denominator
    >= cdr3.alignmentColumns * cdr3Numerator;
  const cdr3LengthSatisfied = cdr3LengthDifference <= maximumLengthDifference;
  return {
    frameworkIdentitySatisfied,
    cdr3IdentitySatisfied,
    cdr3LengthSatisfied,
    cdr3LengthDifference,
    thresholdCriterionSatisfied: frameworkIdentitySatisfied && cdr3IdentitySatisfied && cdr3LengthSatisfied,
  };
}

function alignmentSummary(result) {
  return {
    alignmentScore: result.alignmentScore,
    identicalResidueColumns: result.identicalResidueColumns,
    alignmentColumns: result.alignmentColumns,
    gapColumns: result.gapColumns,
    identity: result.identity,
  };
}

function cachedAlignment(sequenceA, sequenceB, cache, contract) {
  const ordered = byteCompare(sequenceA, sequenceB) <= 0 ? [sequenceA, sequenceB] : [sequenceB, sequenceA];
  const key = `${ordered[0]}\n${ordered[1]}`;
  if (!cache.has(key)) {
    cache.set(key, alignGlobalAffine(ordered[0], ordered[1], {
      gapOpen: contract.alignment.gapOpen,
      gapExtension: contract.alignment.gapExtension,
    }));
  }
  return cache.get(key);
}

function profileSort(left, right) {
  return byteCompare(left.profileId, right.profileId);
}

function buildProfile(node, metadataCandidate, entity, contract) {
  ok(NODE_ID.test(node.nodeId) && PDB_ID.test(node.pdbId), `Invalid source node: ${node.nodeId}`);
  ok(entity && entity.entityId === metadataCandidate.entityId, `${node.nodeId} metadata candidate entity is unresolved: ${metadataCandidate.entityId}`);
  const sequence = entity.sequence;
  ok(typeof sequence === "string" && sequence.length > 0, `${node.nodeId} entity ${entity.entityId} lacks a sequence.`);
  ok(sequence === sequence.trim().toUpperCase(), `${node.nodeId} entity ${entity.entityId} sequence is not normalized.`);
  const sequenceSha256 = sha256(Buffer.from(sequence));
  ok(sequenceSha256 === entity.sequenceSha256 && sequenceSha256 === metadataCandidate.sequenceSha256, `${node.nodeId} entity ${entity.entityId} sequence digest drifted.`);
  ok(sequence.length === entity.sequenceLength && sequence.length === metadataCandidate.sequenceLength, `${node.nodeId} entity ${entity.entityId} sequence length drifted.`);
  const numbering = numberVhhForLeakage(sequence, {
    engine: contract.numbering.engine,
    scheme: contract.numbering.scheme,
    minimumConfidence: contract.numbering.minimumEngineConfidence,
  });
  const profileId = `${node.nodeId}#entity:${metadataCandidate.entityId}`;
  ok(PROFILE_ID.test(profileId), `Invalid VHH profile ID: ${profileId}`);
  return {
    profileId,
    nodeId: node.nodeId,
    nodeRole: node.role,
    pdbId: node.pdbId,
    entityId: metadataCandidate.entityId,
    entityDescription: metadataCandidate.description ?? entity.description ?? null,
    authAsymIds: uniqueStrings(metadataCandidate.authAsymIds ?? entity.authAsymIds ?? []),
    labelAsymIds: uniqueStrings(metadataCandidate.labelAsymIds ?? entity.labelAsymIds ?? []),
    fullSequence: sequence,
    fullSequenceLength: sequence.length,
    fullSequenceSha256: sequenceSha256,
    ...numbering,
    directBinderIdentityResolved: false,
    knownParentVariantIdentityResolved: false,
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function validateProfile(profile, contract) {
  ok(PROFILE_ID.test(profile.profileId) && NODE_ID.test(profile.nodeId) && PDB_ID.test(profile.pdbId), `Invalid VHH profile identity: ${profile.profileId}`);
  ok(profile.profileId.startsWith(`${profile.nodeId}#entity:`), `${profile.profileId} is not bound to its node.`);
  ok(profile.fullSequenceLength === profile.fullSequence.length && sha256(Buffer.from(profile.fullSequence)) === profile.fullSequenceSha256, `${profile.profileId} full-sequence accounting drifted.`);
  ok(profile.numberingScheme === contract.numbering.scheme && profile.numberingEngine === contract.numbering.engine, `${profile.profileId} numbering provenance drifted.`);
  const requiredRegions = contract.numbering.requiredImgtRegions;
  ok(canonical(requiredRegions) === canonical(["FR1-IMGT", "CDR1-IMGT", "FR2-IMGT", "CDR2-IMGT", "FR3-IMGT", "CDR3-IMGT", "FR4-IMGT"]), `${profile.profileId} required IMGT-region contract drifted.`);
  if (profile.numberingStatus === "NUMBERED") {
    ok(profile.numberingFailureCode === null && profile.numberingFailureMessage === null, `${profile.profileId} reports a failure despite successful numbering.`);
    ok(profile.completeImgtRegionCoverage === true && profile.numberingSegmentationAgreement === true, `${profile.profileId} lacks complete independently cross-checked IMGT regions.`);
    ok(profile.imgtRegionLengths && typeof profile.imgtRegionLengths === "object" && !Array.isArray(profile.imgtRegionLengths), `${profile.profileId} lacks IMGT region-length evidence.`);
    for (const region of requiredRegions) ok(Number.isSafeInteger(profile.imgtRegionLengths[region]) && profile.imgtRegionLengths[region] > 0, `${profile.profileId} has an invalid or empty IMGT region: ${region}`);
    ok(CANONICAL_AA.test(profile.frameworkSequence) && CANONICAL_AA.test(profile.cdr3Sequence), `${profile.profileId} emitted a noncanonical numbered region.`);
    ok(profile.frameworkLength === profile.frameworkSequence.length && profile.cdr3Length === profile.cdr3Sequence.length, `${profile.profileId} numbered-region lengths drifted.`);
    const expectedFrameworkLength = ["FR1-IMGT", "FR2-IMGT", "FR3-IMGT", "FR4-IMGT"].reduce((sum, region) => sum + profile.imgtRegionLengths[region], 0);
    ok(profile.frameworkLength === expectedFrameworkLength && profile.cdr3Length === profile.imgtRegionLengths["CDR3-IMGT"], `${profile.profileId} IMGT region accounting drifted.`);
    ok(sha256(Buffer.from(profile.frameworkSequence)) === profile.frameworkSequenceSha256, `${profile.profileId} framework digest drifted.`);
    ok(sha256(Buffer.from(profile.cdr3Sequence)) === profile.cdr3SequenceSha256, `${profile.profileId} CDR3 digest drifted.`);
  } else {
    ok(profile.numberingStatus === "UNAVAILABLE" && typeof profile.numberingFailureCode === "string", `${profile.profileId} has an invalid numbering state.`);
    for (const field of ["frameworkSequence", "frameworkLength", "frameworkSequenceSha256", "cdr3Sequence", "cdr3Length", "cdr3SequenceSha256", "imgtRegionLengths"]) {
      ok(profile[field] === null, `${profile.profileId} retains numbered-region data despite unavailable numbering: ${field}`);
    }
    ok(profile.completeImgtRegionCoverage === false && profile.numberingSegmentationAgreement === false, `${profile.profileId} unavailable numbering improperly claims complete region coverage.`);
  }
  for (const field of ["directBinderIdentityResolved", "knownParentVariantIdentityResolved", "formalLeakageEdgeAuthority", "formalNoEdgeAuthority", "nativeCoordinatesInspected"]) {
    ok(profile[field] === false, `${profile.profileId} authority/access field must remain false: ${field}`);
  }
}

function evaluateProfilePair(profileA, profileB, caches, contract) {
  ok(byteCompare(profileA.profileId, profileB.profileId) !== 0, "A VHH profile cannot be compared with itself across one node pair.");
  const exactFullSequenceMatch = profileA.fullSequenceSha256 === profileB.fullSequenceSha256;
  const base = {
    profileA: profileA.profileId,
    profileB: profileB.profileId,
    fullSequenceSha256A: profileA.fullSequenceSha256,
    fullSequenceSha256B: profileB.fullSequenceSha256,
    exactFullSequenceMatch,
    evaluationStatus: "UNRESOLVED_NUMBERING",
    framework: null,
    cdr3: null,
    cdr3LengthA: profileA.cdr3Length,
    cdr3LengthB: profileB.cdr3Length,
    cdr3LengthDifference: null,
    frameworkIdentitySatisfied: false,
    cdr3IdentitySatisfied: false,
    cdr3LengthSatisfied: false,
    thresholdCriterionSatisfied: false,
    possibleMetadataSequenceLeakageEdge: false,
    directBinderRolesResolved: false,
    knownParentVariantEvidence: "NOT_ASSESSED_SOURCE_BACKED_REVIEW_REQUIRED",
    formalLeakageEdgeAuthority: false,
  };
  if (profileA.numberingStatus !== "NUMBERED" || profileB.numberingStatus !== "NUMBERED") return base;
  const framework = cachedAlignment(profileA.frameworkSequence, profileB.frameworkSequence, caches.framework, contract);
  const cdr3 = cachedAlignment(profileA.cdr3Sequence, profileB.cdr3Sequence, caches.cdr3, contract);
  const decision = evaluateFrozenVhhThreshold({
    framework,
    cdr3,
    cdr3LengthA: profileA.cdr3Length,
    cdr3LengthB: profileB.cdr3Length,
  }, contract.edgeCriterion);
  return {
    ...base,
    evaluationStatus: "EVALUABLE",
    framework: alignmentSummary(framework),
    cdr3: alignmentSummary(cdr3),
    cdr3LengthDifference: decision.cdr3LengthDifference,
    frameworkIdentitySatisfied: decision.frameworkIdentitySatisfied,
    cdr3IdentitySatisfied: decision.cdr3IdentitySatisfied,
    cdr3LengthSatisfied: decision.cdr3LengthSatisfied,
    thresholdCriterionSatisfied: decision.thresholdCriterionSatisfied,
    possibleMetadataSequenceLeakageEdge: decision.thresholdCriterionSatisfied,
  };
}

function compareIdentityDescending(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftCross = left.identicalResidueColumns * right.alignmentColumns;
  const rightCross = right.identicalResidueColumns * left.alignmentColumns;
  if (leftCross === rightCross) return 0;
  return rightCross > leftCross ? 1 : -1;
}

function compareEvaluationQuality(left, right) {
  const frameworkComparison = compareIdentityDescending(left.framework, right.framework);
  if (frameworkComparison !== 0) return frameworkComparison;
  const cdr3Comparison = compareIdentityDescending(left.cdr3, right.cdr3);
  if (cdr3Comparison !== 0) return cdr3Comparison;
  const leftLength = left.cdr3LengthDifference ?? Number.POSITIVE_INFINITY;
  const rightLength = right.cdr3LengthDifference ?? Number.POSITIVE_INFINITY;
  if (leftLength !== rightLength) return leftLength - rightLength;
  const leftFrameworkScore = left.framework?.alignmentScore ?? NEGATIVE_INFINITY;
  const rightFrameworkScore = right.framework?.alignmentScore ?? NEGATIVE_INFINITY;
  if (leftFrameworkScore !== rightFrameworkScore) return rightFrameworkScore - leftFrameworkScore;
  const leftCdr3Score = left.cdr3?.alignmentScore ?? NEGATIVE_INFINITY;
  const rightCdr3Score = right.cdr3?.alignmentScore ?? NEGATIVE_INFINITY;
  if (leftCdr3Score !== rightCdr3Score) return rightCdr3Score - leftCdr3Score;
  return byteCompare(`${left.profileA}|${left.profileB}`, `${right.profileA}|${right.profileB}`);
}

function compareNodePair(nodeA, nodeB, profilesByNode, caches, contract, pairType) {
  ok(byteCompare(nodeA.nodeId, nodeB.nodeId) < 0, `Node pair is not canonical: ${nodeA.nodeId}, ${nodeB.nodeId}`);
  const profilesA = profilesByNode.get(nodeA.nodeId) ?? [];
  const profilesB = profilesByNode.get(nodeB.nodeId) ?? [];
  const evaluations = [];
  for (const profileA of profilesA) {
    for (const profileB of profilesB) evaluations.push(evaluateProfilePair(profileA, profileB, caches, contract));
  }
  evaluations.sort((left, right) => byteCompare(`${left.profileA}|${left.profileB}`, `${right.profileA}|${right.profileB}`));
  const evaluableProfilePairCount = evaluations.filter((row) => row.evaluationStatus === "EVALUABLE").length;
  const unresolvedProfilePairCount = evaluations.length - evaluableProfilePairCount;
  const thresholdMatchProfilePairCount = evaluations.filter((row) => row.thresholdCriterionSatisfied).length;
  const exactFullSequenceMatchProfilePairCount = evaluations.filter((row) => row.exactFullSequenceMatch).length;
  const possibleEdge = thresholdMatchProfilePairCount > 0;
  const matrixStatus = possibleEdge
    ? "POSSIBLE_METADATA_SEQUENCE_LEAKAGE_EDGE_ROLE_UNRESOLVED"
    : evaluations.length === 0 || unresolvedProfilePairCount > 0
      ? "FAIL_CLOSED_MISSING_OR_UNNUMBERABLE_METADATA_PROFILE"
      : "NO_THRESHOLD_MATCH_NO_FORMAL_NO_EDGE_AUTHORITY";
  const bestEvaluation = evaluations.length > 0 ? [...evaluations].sort(compareEvaluationQuality)[0] : null;
  return {
    pairId: `${nodeA.nodeId}|${nodeB.nodeId}`,
    pairType,
    nodeA: nodeA.nodeId,
    nodeB: nodeB.nodeId,
    metadataProfileCountA: profilesA.length,
    metadataProfileCountB: profilesB.length,
    attemptedProfilePairCount: evaluations.length,
    evaluableProfilePairCount,
    unresolvedProfilePairCount,
    exactFullSequenceMatchProfilePairCount,
    thresholdMatchProfilePairCount,
    allMetadataProfilePairsEvaluable: evaluations.length > 0 && unresolvedProfilePairCount === 0,
    profilePairEvaluations: evaluations,
    bestReviewProfilePair: bestEvaluation ? `${bestEvaluation.profileA}|${bestEvaluation.profileB}` : null,
    matrixStatus,
    possibleMetadataSequenceLeakageEdge: possibleEdge,
    directBinderRolesResolved: false,
    knownParentVariantEvidence: "NOT_ASSESSED_SOURCE_BACKED_REVIEW_REQUIRED",
    formalLeakageEdgeStatus: "UNRESOLVED",
    formalNoEdgeStatus: "NOT_ESTABLISHED",
    formalLeakageEdgeAuthority: false,
    formalNoEdgeAuthority: false,
    targetEligibilityAuthority: false,
    nativeCoordinatesInspected: false,
  };
}

function canonicalPair(left, right) {
  return byteCompare(left.nodeId, right.nodeId) < 0 ? [left, right] : [right, left];
}

function enumerateSame(nodes, profilesByNode, caches, contract, pairType) {
  const rows = [];
  const pairIds = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const [left, right] = canonicalPair(nodes[leftIndex], nodes[rightIndex]);
      const row = compareNodePair(left, right, profilesByNode, caches, contract, pairType);
      rows.push(row);
      pairIds.push(row.pairId);
    }
  }
  rows.sort((left, right) => byteCompare(left.pairId, right.pairId));
  return { rows, pairIds: byteSort(pairIds) };
}

function enumerateCross(candidateNodes, developmentNodes, profilesByNode, caches, contract) {
  const rows = [];
  const pairIds = [];
  for (const candidate of candidateNodes) {
    for (const development of developmentNodes) {
      const [left, right] = canonicalPair(candidate, development);
      const row = compareNodePair(left, right, profilesByNode, caches, contract, "CANDIDATE_DEVELOPMENT");
      rows.push(row);
      pairIds.push(row.pairId);
    }
  }
  rows.sort((left, right) => byteCompare(left.pairId, right.pairId));
  return { rows, pairIds: byteSort(pairIds) };
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

function thresholdComponents(nodes, matrixRows) {
  const nodeIds = nodes.map((node) => node.nodeId);
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const unionFind = new UnionFind(nodeIds);
  const edgeRows = matrixRows.filter((row) => row.possibleMetadataSequenceLeakageEdge);
  for (const row of edgeRows) unionFind.union(row.nodeA, row.nodeB);
  const grouped = new Map();
  for (const nodeId of nodeIds) {
    const root = unionFind.find(nodeId);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(nodeId);
  }
  const result = [];
  for (const memberIds of grouped.values()) {
    const members = byteSort(memberIds);
    const memberSet = new Set(members);
    const internalEdges = edgeRows.filter((row) => memberSet.has(row.nodeA) && memberSet.has(row.nodeB));
    const candidateNodeCount = members.filter((nodeId) => nodeMap.get(nodeId).role === "CANDIDATE_SOURCE_ENTRY").length;
    const developmentNodeCount = members.length - candidateNodeCount;
    result.push({
      componentId: sha256(Buffer.from(`${members.join("\n")}\n`)),
      pregraphMode: "FROZEN_IMGT_FRAMEWORK_AND_CDR3_METADATA_THRESHOLD",
      nodeIds: members,
      nodeCount: members.length,
      candidateNodeCount,
      developmentNodeCount,
      possibleMetadataSequenceEdgeCount: internalEdges.length,
      connectedToDevelopment: developmentNodeCount > 0,
      directBinderRolesResolved: false,
      knownParentVariantEvidenceComplete: false,
      formalLeakageComponent: false,
      formalTargetEligibilityAuthority: false,
    });
  }
  return result.sort((left, right) => byteCompare(left.componentId, right.componentId));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => byteCompare(left, right)));
}

function candidateConnectivity(candidateNodes, components) {
  const connected = new Set(components
    .filter((component) => component.connectedToDevelopment)
    .flatMap((component) => component.nodeIds.filter((nodeId) => nodeId.startsWith("candidate:"))));
  return candidateNodes.filter((node) => connected.has(node.nodeId)).length;
}

function exactVhhEvidencePairSet(evidenceRows, evidenceTypes) {
  const allowed = new Set(evidenceTypes);
  return new Set(evidenceRows
    .filter((row) => (row.evidenceTypes ?? []).some((type) => allowed.has(type)))
    .map((row) => row.pairId));
}

async function readInputs(repositoryRoot = ROOT) {
  const root = await realpath(repositoryRoot);
  ok(root === path.resolve(repositoryRoot), "Repository root cannot contain symlinked ancestors.");
  const contractFile = await readDirect(root, CONTRACT_REL, "VHH sequence contract", 2 * 1024 * 1024);
  const contract = JSON.parse(contractFile.text);
  walk(contract);
  ok(contract.schemaVersion === "1.1.0" && contract.studyId === "confovhh-hard-decoy-holdout-v3" && contract.status === "VHH_SEQUENCE_PREGRAPH_RULE_FROZEN", "VHH sequence contract identity drifted.");
  ok(contract.numbering.engine === "immunum 1.3.0" && contract.numbering.scheme === "IMGT" && contract.numbering.minimumEngineConfidence === 0.5, "Frozen VHH numbering policy drifted.");
  ok(contract.numbering.completeImgtRegionCoverageRequired === true && contract.numbering.numberingSegmentationAgreementRequired === true, "Frozen IMGT completeness policy drifted.");
  ok(contract.numbering.packageLockPath === "package-lock.json" && SHA256.test(contract.numbering.packageLockSha256), "Frozen numbering dependency-lock binding drifted.");
  ok(typeof contract.numbering.correctionRecordPath === "string" && SHA256.test(contract.numbering.correctionRecordSha256), "Frozen numbering correction-record binding drifted.");
  ok(contract.alignment.algorithm === "global-Needleman-Wunsch-three-state-affine-gap" && contract.alignment.substitutionMatrix === "BLOSUM62" && contract.alignment.gapOpen === -10 && contract.alignment.gapExtension === -1, "Frozen VHH alignment policy drifted.");
  ok(contract.alignment.terminalGapPolicy === "penalize-identically-to-internal-gaps" && contract.alignment.identityDenominator === "all-global-alignment-columns-including-gap-columns", "Frozen terminal-gap or identity policy drifted.");
  ok(canonical(contract.alignment.stateTiePrecedence) === canonical(["M", "X", "Y"]), "Frozen alignment tie policy drifted.");
  ok(contract.edgeCriterion.frameworkIdentityMinimum.numerator === 9 && contract.edgeCriterion.frameworkIdentityMinimum.denominator === 10, "Framework threshold drifted.");
  ok(contract.edgeCriterion.cdr3IdentityMinimum.numerator === 7 && contract.edgeCriterion.cdr3IdentityMinimum.denominator === 10 && contract.edgeCriterion.maximumAbsoluteCdr3LengthDifference === 2, "CDR3 threshold drifted.");
  ok(contract.edgeCriterion.absenceOfThresholdMatchIsNotFormalNoEdgeEvidence && contract.edgeCriterion.possibleEdgeIsNotFormalLeakageAuthorityUntilRoleAdjudication, "VHH pair authority boundary drifted.");
  ok(contract.integrity.formalLeakageGraphComplete === false && contract.integrity.formallyClearedGroupCount === 0 && contract.integrity.targetFreezePermitted === false && contract.integrity.executionAuthorized === false, "VHH sequence contract authority drifted.");

  const dependencyLockFile = await readDirect(root, contract.numbering.packageLockPath, "pinned dependency lock", 2 * 1024 * 1024);
  ok(dependencyLockFile.sha256 === contract.numbering.packageLockSha256, "Pinned dependency lock digest drifted.");
  const correctionRecordFile = await readDirect(root, contract.numbering.correctionRecordPath, "VHH numbering correction record", 512 * 1024);
  ok(correctionRecordFile.sha256 === contract.numbering.correctionRecordSha256, "VHH numbering correction-record digest drifted.");

  const exactSnapshotDirectory = path.join(root, contract.nodeUniverse.snapshotDirectory);
  await verifyExactEvidencePregraph({ repositoryRoot: root, snapshotDirectory: exactSnapshotDirectory });

  const protocolFile = await readDirect(root, contract.selectedProtocol.path, "selected v3 protocol", 4 * 1024 * 1024);
  const exactChecksumsFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/checksums.sha256`, "exact pregraph checksums", 128 * 1024);
  const candidateNodesFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.nodeUniverse.candidateNodeFile}`, "candidate nodes");
  const developmentNodesFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.nodeUniverse.developmentNodeFile}`, "development nodes");
  const candidateEntriesFile = await readDirect(root, contract.sequenceInputs.candidateEntryMetadataPath, "candidate entry metadata");
  const developmentEntitiesFile = await readDirect(root, contract.sequenceInputs.developmentEntityPath, "development entity metadata");
  const candidateCandidateEvidenceFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.exactEvidenceReconciliation.candidateCandidateFile}`, "candidate-candidate exact evidence");
  const candidateDevelopmentEvidenceFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.exactEvidenceReconciliation.candidateDevelopmentFile}`, "candidate-development exact evidence");
  const developmentDevelopmentEvidenceFile = await readDirect(root, `${contract.nodeUniverse.snapshotDirectory}/${contract.exactEvidenceReconciliation.developmentDevelopmentFile}`, "development-development exact evidence");
  for (const [observed, expected, label] of [
    [protocolFile.sha256, contract.selectedProtocol.sha256, "selected protocol"],
    [exactChecksumsFile.sha256, contract.nodeUniverse.checksumsSha256, "exact pregraph checksums"],
    [candidateNodesFile.sha256, contract.nodeUniverse.candidateNodeSha256, "candidate node ledger"],
    [developmentNodesFile.sha256, contract.nodeUniverse.developmentNodeSha256, "development node ledger"],
    [candidateEntriesFile.sha256, contract.sequenceInputs.candidateEntryMetadataSha256, "candidate entry metadata"],
    [developmentEntitiesFile.sha256, contract.sequenceInputs.developmentEntitySha256, "development entity metadata"],
    [candidateCandidateEvidenceFile.sha256, contract.exactEvidenceReconciliation.candidateCandidateSha256, "candidate-candidate evidence"],
    [candidateDevelopmentEvidenceFile.sha256, contract.exactEvidenceReconciliation.candidateDevelopmentSha256, "candidate-development evidence"],
    [developmentDevelopmentEvidenceFile.sha256, contract.exactEvidenceReconciliation.developmentDevelopmentSha256, "development-development evidence"],
  ]) ok(observed === expected, `${label} digest drifted.`);

  const candidateNodes = parseJsonl(candidateNodesFile.text, "candidate nodes").sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const developmentNodes = parseJsonl(developmentNodesFile.text, "development nodes").sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  const candidateEntries = parseJsonl(candidateEntriesFile.text, "candidate entry metadata");
  const developmentEntities = parseJsonl(developmentEntitiesFile.text, "development entity metadata");
  const evidenceRows = [
    ...parseJsonl(candidateCandidateEvidenceFile.text, "candidate-candidate exact evidence"),
    ...parseJsonl(candidateDevelopmentEvidenceFile.text, "candidate-development exact evidence"),
    ...parseJsonl(developmentDevelopmentEvidenceFile.text, "development-development exact evidence"),
  ];
  ok(candidateNodes.length === contract.nodeUniverse.candidateNodeCount && developmentNodes.length === contract.nodeUniverse.developmentNodeCount, "VHH node-universe counts drifted.");
  ok(candidateNodes.length + developmentNodes.length === contract.nodeUniverse.totalNodeCount, "VHH total node count drifted.");
  const allNodes = [...candidateNodes, ...developmentNodes].sort((left, right) => byteCompare(left.nodeId, right.nodeId));
  ok(new Set(allNodes.map((node) => node.nodeId)).size === allNodes.length, "VHH node IDs are duplicated.");
  for (const node of allNodes) {
    ok(NODE_ID.test(node.nodeId) && PDB_ID.test(node.pdbId) && node.nodeId.endsWith(node.pdbId), `Invalid VHH node identity: ${node.nodeId}`);
    ok(Array.isArray(node.vhhMetadataCandidates), `${node.nodeId} lacks a frozen VHH metadata-candidate array.`);
    ok(node.directReceptorVhhEvidence === "UNRESOLVED", `${node.nodeId} improperly resolves direct VHH identity.`);
  }

  const candidateEntryMap = mapUnique(candidateEntries, "pdbId", "candidate entry metadata", PDB_ID);
  const developmentEntityMap = new Map();
  for (const entity of developmentEntities) {
    ok(PDB_ID.test(entity.pdbId) && typeof entity.entityId === "string", "Development entity identity is invalid.");
    const key = `${entity.pdbId}|${entity.entityId}`;
    ok(!developmentEntityMap.has(key), `Duplicate development entity: ${key}`);
    developmentEntityMap.set(key, entity);
  }

  const candidateProfiles = [];
  for (const node of candidateNodes) {
    const entry = candidateEntryMap.get(node.pdbId);
    ok(entry, `Candidate node is absent from entry metadata: ${node.pdbId}`);
    const entityMap = new Map((entry.polymerEntities ?? []).map((entity) => [entity.entityId, entity]));
    for (const metadataCandidate of node.vhhMetadataCandidates) {
      candidateProfiles.push(buildProfile(node, metadataCandidate, entityMap.get(metadataCandidate.entityId), contract));
    }
  }
  const developmentProfiles = [];
  for (const node of developmentNodes) {
    for (const metadataCandidate of node.vhhMetadataCandidates) {
      developmentProfiles.push(buildProfile(node, metadataCandidate, developmentEntityMap.get(`${node.pdbId}|${metadataCandidate.entityId}`), contract));
    }
  }
  candidateProfiles.sort(profileSort);
  developmentProfiles.sort(profileSort);
  [...candidateProfiles, ...developmentProfiles].forEach((profile) => validateProfile(profile, contract));
  ok(new Set([...candidateProfiles, ...developmentProfiles].map((profile) => profile.profileId)).size === candidateProfiles.length + developmentProfiles.length, "VHH profile IDs are duplicated.");

  const exactEvidencePairs = exactVhhEvidencePairSet(evidenceRows, contract.exactEvidenceReconciliation.evidenceTypes);
  ok(exactEvidencePairs.size === contract.exactEvidenceReconciliation.expectedExactOrRoleAmbiguousVhhSequencePairCount, "Exact VHH-sequence evidence pair count drifted.");

  return {
    root,
    contract,
    candidateNodes,
    developmentNodes,
    allNodes,
    candidateProfiles,
    developmentProfiles,
    exactEvidencePairs,
    inputDigests: {
      contract: contractFile.sha256,
      dependencyPackageLock: dependencyLockFile.sha256,
      numberingCorrectionRecord: correctionRecordFile.sha256,
      selectedProtocol: protocolFile.sha256,
      exactPregraphChecksums: exactChecksumsFile.sha256,
      candidateNodeLedger: candidateNodesFile.sha256,
      developmentNodeLedger: developmentNodesFile.sha256,
      candidateEntryMetadata: candidateEntriesFile.sha256,
      developmentEntityMetadata: developmentEntitiesFile.sha256,
      candidateCandidateEvidence: candidateCandidateEvidenceFile.sha256,
      candidateDevelopmentEvidence: candidateDevelopmentEvidenceFile.sha256,
      developmentDevelopmentEvidence: developmentDevelopmentEvidenceFile.sha256,
      generatorScript: sha256(await readFile(HERE)),
    },
  };
}

function buildMatrix(inputs) {
  const profilesByNode = new Map(inputs.allNodes.map((node) => [node.nodeId, []]));
  for (const profile of [...inputs.candidateProfiles, ...inputs.developmentProfiles]) profilesByNode.get(profile.nodeId).push(profile);
  for (const profiles of profilesByNode.values()) profiles.sort(profileSort);
  const caches = { framework: new Map(), cdr3: new Map() };
  const candidateCandidate = enumerateSame(inputs.candidateNodes, profilesByNode, caches, inputs.contract, "CANDIDATE_CANDIDATE");
  const candidateDevelopment = enumerateCross(inputs.candidateNodes, inputs.developmentNodes, profilesByNode, caches, inputs.contract);
  const developmentDevelopment = enumerateSame(inputs.developmentNodes, profilesByNode, caches, inputs.contract, "DEVELOPMENT_DEVELOPMENT");
  ok(candidateCandidate.rows.length === inputs.contract.pairSpace.candidateCandidatePairs, "Candidate-candidate VHH pair count drifted.");
  ok(candidateDevelopment.rows.length === inputs.contract.pairSpace.candidateDevelopmentPairs, "Candidate-development VHH pair count drifted.");
  ok(developmentDevelopment.rows.length === inputs.contract.pairSpace.developmentDevelopmentPairs, "Development-development VHH pair count drifted.");
  const allRows = [...candidateCandidate.rows, ...candidateDevelopment.rows, ...developmentDevelopment.rows]
    .sort((left, right) => byteCompare(left.pairId, right.pairId));
  const allPairIds = byteSort([...candidateCandidate.pairIds, ...candidateDevelopment.pairIds, ...developmentDevelopment.pairIds]);
  ok(allRows.length === inputs.contract.pairSpace.allUnorderedPairs && new Set(allPairIds).size === allPairIds.length, "Complete VHH unordered pair space drifted.");

  const matrixExactPairs = new Set(allRows.filter((row) => row.exactFullSequenceMatchProfilePairCount > 0).map((row) => row.pairId));
  ok(matrixExactPairs.size === inputs.exactEvidencePairs.size, "VHH exact-sequence matrix/evidence pair count disagrees.");
  ok([...inputs.exactEvidencePairs].every((pairId) => matrixExactPairs.has(pairId)) && [...matrixExactPairs].every((pairId) => inputs.exactEvidencePairs.has(pairId)), "VHH exact-sequence matrix does not exactly reconcile the frozen exact-evidence pregraph.");

  const pairSpaceCommitments = {
    schemaVersion: "1.0.0",
    serialization: "bytewise-sorted-canonical-nodeA-pipe-nodeB-with-terminal-LF",
    candidateCandidate: pairCommitment(candidateCandidate.pairIds),
    candidateDevelopment: pairCommitment(candidateDevelopment.pairIds),
    developmentDevelopment: pairCommitment(developmentDevelopment.pairIds),
    allUnorderedPairs: pairCommitment(allPairIds),
    completeNodePairRowsStored: true,
    absenceOfThresholdMatchIsNotNoEdgeEvidence: true,
    formalLeakageGraphAuthority: false,
  };
  const expectedCommitments = inputs.contract.pairSpace.commitments;
  if (expectedCommitments) {
    for (const key of ["candidateCandidate", "candidateDevelopment", "developmentDevelopment", "allUnorderedPairs"]) {
      ok(pairSpaceCommitments[key].sha256 === expectedCommitments[key], `VHH ${key} pair-space commitment drifted.`);
    }
  }

  const components = thresholdComponents(inputs.allNodes, allRows);
  const candidateNodesWithNoMetadataProfile = inputs.candidateNodes.filter((node) => (profilesByNode.get(node.nodeId) ?? []).length === 0).length;
  const developmentNodesWithNoMetadataProfile = inputs.developmentNodes.filter((node) => (profilesByNode.get(node.nodeId) ?? []).length === 0).length;
  const candidateNodesWithAllProfilesNumbered = inputs.candidateNodes.filter((node) => {
    const profiles = profilesByNode.get(node.nodeId) ?? [];
    return profiles.length > 0 && profiles.every((profile) => profile.numberingStatus === "NUMBERED");
  }).length;
  const developmentNodesWithAllProfilesNumbered = inputs.developmentNodes.filter((node) => {
    const profiles = profilesByNode.get(node.nodeId) ?? [];
    return profiles.length > 0 && profiles.every((profile) => profile.numberingStatus === "NUMBERED");
  }).length;
  const thresholdByType = {
    candidateCandidate: candidateCandidate.rows.filter((row) => row.possibleMetadataSequenceLeakageEdge).length,
    candidateDevelopment: candidateDevelopment.rows.filter((row) => row.possibleMetadataSequenceLeakageEdge).length,
    developmentDevelopment: developmentDevelopment.rows.filter((row) => row.possibleMetadataSequenceLeakageEdge).length,
  };
  thresholdByType.all = thresholdByType.candidateCandidate + thresholdByType.candidateDevelopment + thresholdByType.developmentDevelopment;
  const summary = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    status: STATUS,
    candidateNodeCount: inputs.candidateNodes.length,
    developmentNodeCount: inputs.developmentNodes.length,
    totalNodeCount: inputs.allNodes.length,
    candidateMetadataProfileCount: inputs.candidateProfiles.length,
    developmentMetadataProfileCount: inputs.developmentProfiles.length,
    totalMetadataProfileCount: inputs.candidateProfiles.length + inputs.developmentProfiles.length,
    numberedProfileCount: [...inputs.candidateProfiles, ...inputs.developmentProfiles].filter((profile) => profile.numberingStatus === "NUMBERED").length,
    unavailableProfileCount: [...inputs.candidateProfiles, ...inputs.developmentProfiles].filter((profile) => profile.numberingStatus !== "NUMBERED").length,
    numberingFailureCodeCounts: countBy([...inputs.candidateProfiles, ...inputs.developmentProfiles].filter((profile) => profile.numberingStatus !== "NUMBERED"), "numberingFailureCode"),
    candidateNodesWithNoMetadataProfile,
    developmentNodesWithNoMetadataProfile,
    candidateNodesWithAllProfilesNumbered,
    developmentNodesWithAllProfilesNumbered,
    pairSpace: {
      candidateCandidate: candidateCandidate.rows.length,
      candidateDevelopment: candidateDevelopment.rows.length,
      developmentDevelopment: developmentDevelopment.rows.length,
      allUnorderedPairs: allRows.length,
    },
    matrixStatusCounts: countBy(allRows, "matrixStatus"),
    possibleMetadataSequenceEdgePairCounts: thresholdByType,
    exactFullSequenceEvidencePairCount: matrixExactPairs.size,
    exactEvidencePregraphReconciled: true,
    frameworkAlignmentCacheEntryCount: caches.framework.size,
    cdr3AlignmentCacheEntryCount: caches.cdr3.size,
    thresholdPregraphComponentCount: components.length,
    candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge: candidateConnectivity(inputs.candidateNodes, components),
    directBinderRolesResolved: false,
    knownParentVariantEvidenceComplete: false,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    exactFrozenTargetSetExists: false,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    confovhhHoldoutScoresAccessed: false,
    performanceResultsAccessed: false,
  };
  return {
    candidateCandidate,
    candidateDevelopment,
    developmentDevelopment,
    allRows,
    components,
    pairSpaceCommitments,
    summary,
  };
}

function outputPayloads(inputs, built) {
  const candidateProfilesText = jsonl(inputs.candidateProfiles);
  const developmentProfilesText = jsonl(inputs.developmentProfiles);
  const candidateCandidateText = jsonl(built.candidateCandidate.rows);
  const candidateDevelopmentText = jsonl(built.candidateDevelopment.rows);
  const developmentDevelopmentText = jsonl(built.developmentDevelopment.rows);
  const componentsText = jsonl(built.components);
  const pairSpaceText = `${JSON.stringify(built.pairSpaceCommitments, null, 2)}\n`;
  const summaryText = `${JSON.stringify(built.summary, null, 2)}\n`;
  const readmeText = [
    "# ConfoVHH hard-decoy v3 VHH sequence pregraph",
    "",
    `Status: **${STATUS}**`,
    "",
    `- Frozen candidate nodes: ${built.summary.candidateNodeCount}`,
    `- Frozen development-exposure nodes: ${built.summary.developmentNodeCount}`,
    `- Retained VHH-like metadata profiles: ${built.summary.totalMetadataProfileCount}`,
    `- Successfully IMGT-numbered profiles: ${built.summary.numberedProfileCount}`,
    `- Complete unordered node-pair rows: ${built.summary.pairSpace.allUnorderedPairs}`,
    `- Node pairs meeting the frozen metadata sequence threshold: ${built.summary.possibleMetadataSequenceEdgePairCounts.all}`,
    `- Exact sequence-evidence pairs reconciled to the prior pregraph: ${built.summary.exactFullSequenceEvidencePairCount}`,
    `- Candidate nodes connected to development by a possible metadata sequence edge: ${built.summary.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge}`,
    "",
    "Every frozen VHH-like metadata candidate was retained. Each canonical sequence was numbered with the pinned IMGT engine, frameworks and CDR3s were globally aligned with the frozen BLOSUM62 affine-gap policy, and all 46,056 unordered node pairs were serialized. Threshold decisions use exact integer cross-multiplication rather than rounded display identities.",
    "",
    "This is a conservative sequence evidence pregraph, not the formal leakage graph. A metadata entity is not assumed to be the receptor-contacting VHH. A threshold match therefore creates a possible leakage edge pending direct-role adjudication; absence of a match does not establish NO_EDGE. Source-backed parent or variant relationships remain a separate required veto and were not inferred from names or sequence similarity.",
    "",
    "No native coordinates, native relative poses, native epitopes, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results were accessed. No target was promoted, frozen, or executed.",
    "",
  ].join("\n");
  const base = {
    "README.md": readmeText,
    "candidate-candidate-vhh-matrix.jsonl": candidateCandidateText,
    "candidate-development-vhh-matrix.jsonl": candidateDevelopmentText,
    "candidate-vhh-profiles.jsonl": candidateProfilesText,
    "development-development-vhh-matrix.jsonl": developmentDevelopmentText,
    "development-vhh-profiles.jsonl": developmentProfilesText,
    "pair-space-commitments.json": pairSpaceText,
    "summary.json": summaryText,
    "threshold-pregraph-components.jsonl": componentsText,
  };
  const normalizedOutputs = Object.fromEntries(Object.entries(base).map(([relative, text]) => [relative, {
    bytes: Buffer.byteLength(text),
    sha256: sha256(Buffer.from(text)),
  }]));
  const manifest = {
    schemaVersion: "1.0.0",
    studyId: inputs.contract.studyId,
    stage: "V3_METADATA_PREPARATION",
    status: STATUS,
    snapshotDateUtc: inputs.contract.snapshotDateUtc,
    contractPath: CONTRACT_REL,
    generatorScript: path.relative(inputs.root, HERE).split(path.sep).join("/"),
    inputDigests: inputs.inputDigests,
    normalizedOutputs,
    pairSpaceCommitments: built.pairSpaceCommitments,
    summary: built.summary,
    sequenceEvidencePregraphOnly: true,
    directBinderRolesResolved: false,
    knownParentVariantEvidenceComplete: false,
    formalLeakageGraphComplete: false,
    dispositionLedgerComplete: false,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    nativeRelativePosesInspected: false,
    dockqLabelsAccessed: false,
    confovhhHoldoutScoresAccessed: false,
    performanceResultsAccessed: false,
  };
  return { ...base, "manifest.json": `${JSON.stringify(manifest, null, 2)}\n` };
}

async function put(root, relative, value) {
  const filename = safePath(root, relative, `output ${relative}`);
  await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  clean(relative, text);
  await writeFile(filename, bytes, { flag: "wx" });
}

async function listFiles(root, current = "", result = []) {
  for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    ok(!entry.isSymbolicLink(), `VHH sequence inventory contains a symlink: ${relative}`);
    if (entry.isDirectory()) await listFiles(root, relative, result);
    else result.push(relative);
    ok(result.length <= MAX_FILES, `VHH sequence inventory exceeded the ${MAX_FILES}-file cap.`);
  }
  return byteSort(result);
}

function assertAuthorityBoundary(record, label) {
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
  ]) ok(record[field] === false, `${label} authority/access field must remain false: ${field}`);
  ok(record.formallyClearedGroupCount === 0, `${label} cannot claim formally cleared groups.`);
}

export async function collectVhhSequencePregraph({ repositoryRoot = ROOT, outputDirectory } = {}) {
  ok(outputDirectory, "A VHH sequence output directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const output = path.resolve(outputDirectory);
  ok(await realpath(path.dirname(output)) === path.resolve(path.dirname(output)), "VHH sequence output parent contains symlinked ancestors.");
  await mkdir(output, { recursive: false });
  const built = buildMatrix(inputs);
  const payloads = outputPayloads(inputs, built);
  const expectedWithoutChecksums = byteSort(inputs.contract.output.requiredFiles.filter((file) => file !== "checksums.sha256"));
  ok(canonical(Object.keys(payloads).sort(byteCompare)) === canonical(expectedWithoutChecksums), "VHH sequence output payload inventory drifted.");
  for (const relative of expectedWithoutChecksums) await put(output, relative, payloads[relative]);
  ok(canonical(await listFiles(output)) === canonical(expectedWithoutChecksums), "VHH sequence output inventory drifted before checksumming.");
  const checksumRows = await Promise.all(expectedWithoutChecksums.map(async (relative) => `${sha256(await readFile(path.join(output, relative)))}  ${relative}`));
  await put(output, "checksums.sha256", `${checksumRows.join("\n")}\n`);
  return { ...await verifyVhhSequencePregraph({ repositoryRoot: inputs.root, snapshotDirectory: output }), outputDirectory: output };
}

export async function verifyVhhSequencePregraph({ repositoryRoot = ROOT, snapshotDirectory } = {}) {
  ok(snapshotDirectory, "A VHH sequence snapshot directory is required.");
  const inputs = await readInputs(repositoryRoot);
  const snapshot = await realpath(snapshotDirectory);
  ok(snapshot === path.resolve(snapshotDirectory), "VHH sequence snapshot path contains symlinked ancestors.");
  const expected = byteSort(inputs.contract.output.requiredFiles);
  ok(canonical(await listFiles(snapshot)) === canonical(expected), "VHH sequence snapshot does not match its exact file allowlist.");
  const checksumFile = await readDirect(snapshot, "checksums.sha256", "VHH sequence checksums", 128 * 1024);
  ok(checksumFile.text.endsWith("\n"), "VHH sequence checksums must end with LF.");
  const checksumRows = checksumFile.text.trimEnd().split("\n").map((row, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(row);
    ok(match, `VHH sequence checksum row ${index + 1} is invalid.`);
    return { digest: match[1], relative: match[2] };
  });
  const payloadFiles = expected.filter((file) => file !== "checksums.sha256");
  ok(canonical(checksumRows.map((row) => row.relative)) === canonical(payloadFiles) && new Set(checksumRows.map((row) => row.relative)).size === payloadFiles.length, "VHH sequence checksum coverage drifted.");
  const observed = new Map();
  for (const row of checksumRows) {
    const file = await readDirect(snapshot, row.relative, `VHH sequence ${row.relative}`);
    ok(file.sha256 === row.digest, `VHH sequence checksum mismatch: ${row.relative}`);
    observed.set(row.relative, file.text);
  }
  const expectedPayloads = outputPayloads(inputs, buildMatrix(inputs));
  for (const relative of payloadFiles) ok(observed.get(relative) === expectedPayloads[relative], `VHH sequence snapshot is not reproducible: ${relative}`);
  const summary = JSON.parse(observed.get("summary.json"));
  const manifest = JSON.parse(observed.get("manifest.json"));
  walk(summary);
  walk(manifest);
  assertAuthorityBoundary(summary, "VHH sequence summary");
  assertAuthorityBoundary(manifest, "VHH sequence manifest");
  ok(summary.pairSpace.allUnorderedPairs === inputs.contract.pairSpace.allUnorderedPairs, "VHH sequence summary pair-space count drifted.");
  ok(summary.exactEvidencePregraphReconciled === true && summary.exactFullSequenceEvidencePairCount === inputs.contract.exactEvidenceReconciliation.expectedExactOrRoleAmbiguousVhhSequencePairCount, "VHH exact-evidence reconciliation drifted.");
  return {
    status: summary.status,
    candidateNodeCount: summary.candidateNodeCount,
    developmentNodeCount: summary.developmentNodeCount,
    totalNodeCount: summary.totalNodeCount,
    totalMetadataProfileCount: summary.totalMetadataProfileCount,
    numberedProfileCount: summary.numberedProfileCount,
    unavailableProfileCount: summary.unavailableProfileCount,
    allUnorderedPairCount: summary.pairSpace.allUnorderedPairs,
    possibleMetadataSequenceEdgePairCount: summary.possibleMetadataSequenceEdgePairCounts.all,
    candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge: summary.candidateNodesConnectedToDevelopmentByPossibleMetadataSequenceEdge,
    thresholdPregraphComponentCount: summary.thresholdPregraphComponentCount,
    exactFullSequenceEvidencePairCount: summary.exactFullSequenceEvidencePairCount,
    formallyClearedGroupCount: 0,
    targetFreezePermitted: false,
    executionAuthorized: false,
    nativeHoldoutCoordinatesAccessed: false,
    dockqLabelsAccessed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const command = process.argv[2];
  const output = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(ROOT, "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29");
  try {
    if (command === "generate") {
      await rm(output, { recursive: true, force: true });
      console.log(JSON.stringify(await collectVhhSequencePregraph({ outputDirectory: output }), null, 2));
    } else if (command === "verify") {
      console.log(JSON.stringify(await verifyVhhSequencePregraph({ snapshotDirectory: output }), null, 2));
    } else {
      throw new Error("Usage: node scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs <generate|verify> [snapshot-directory]");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
