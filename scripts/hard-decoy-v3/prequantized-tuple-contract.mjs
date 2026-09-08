import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStableFile, sha256 } from '../hard-decoy/oracle/secure-io.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT_PATH = 'validation/hard-decoy-holdout-v2/prelabel-census/scoring-contract.json';
const CONTRACT_SHA256 = '88c144fa7708901c910cea2f8ba000352f2d8f4ce0cb07d4084f6e26948b2698';
const FIELDS = Object.freeze([
  'evidenceBandOrdinal',
  'severeClashResiduePairCount',
  'maximumVdwOverlapBin',
  'imgtNumberingAvailable',
  'cdrContactShare',
  'interfaceResiduePairCount',
  'deltaSasaBin',
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// This is a representation check, not an engine-output or eligibility check.
// Bin integers are supplied by the caller; no rounding operation is performed.
function validateTuple(input) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'Tuple must be one plain object.');
  check(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null, 'Tuple must be one plain object.');
  const keys = Reflect.ownKeys(input);
  check(keys.length === FIELDS.length && keys.every((key) => FIELDS.includes(key)), 'Tuple must contain exactly the seven prequantized fields, without display identifiers or raw measurements.');
  const tuple = {};
  for (const field of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    check(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `Tuple field ${field} must be an enumerable data property.`);
    tuple[field] = descriptor.value;
  }
  check(Number.isInteger(tuple.evidenceBandOrdinal) && tuple.evidenceBandOrdinal >= 0 && tuple.evidenceBandOrdinal <= 3, 'Evidence ordinal must be an integer from zero through three.');
  for (const field of ['severeClashResiduePairCount', 'interfaceResiduePairCount']) {
    check(Number.isSafeInteger(tuple[field]) && tuple[field] >= 0, `${field} must be a nonnegative safe integer.`);
  }
  for (const field of ['maximumVdwOverlapBin', 'deltaSasaBin']) {
    check(Number.isSafeInteger(tuple[field]), `${field} must be a supplied safe integer bin index; raw feature quantization is unavailable.`);
  }
  check(typeof tuple.imgtNumberingAvailable === 'boolean', 'IMGT availability must be a boolean.');
  check(tuple.cdrContactShare === null || (typeof tuple.cdrContactShare === 'number' && Number.isFinite(tuple.cdrContactShare) && tuple.cdrContactShare >= 0 && tuple.cdrContactShare <= 1), 'CDR contact share must be null or one finite fraction from zero through one.');
  return Object.freeze(tuple);
}

function ascending(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuples(leftInput, rightInput) {
  const left = validateTuple(leftInput);
  const right = validateTuple(rightInput);
  // Explicit comparisons avoid integer subtraction overflow and never use IDs.
  return ascending(right.evidenceBandOrdinal, left.evidenceBandOrdinal)
    || ascending(left.severeClashResiduePairCount, right.severeClashResiduePairCount)
    || ascending(left.maximumVdwOverlapBin, right.maximumVdwOverlapBin)
    || ascending(right.imgtNumberingAvailable, left.imgtNumberingAvailable)
    || (left.cdrContactShare === null
      ? (right.cdrContactShare === null ? 0 : 1)
      : right.cdrContactShare === null ? -1 : ascending(right.cdrContactShare, left.cdrContactShare))
    || ascending(right.interfaceResiduePairCount, left.interfaceResiduePairCount)
    || ascending(right.deltaSasaBin, left.deltaSasaBin);
}

/**
 * Load the exact frozen contract before exposing its partial tuple comparator.
 * This does not load an engine, quantize features, or permit benchmark execution.
 * repositoryRoot exists for isolated integrity tests, not contract substitution.
 */
export async function loadPrequantizedTupleContract({ repositoryRoot = ROOT } = {}) {
  check(typeof repositoryRoot === 'string' && repositoryRoot.length > 0, 'Repository root must be a path.');
  const bytes = await readStableFile(path.join(repositoryRoot, CONTRACT_PATH), { maximumBytes: 64 * 1024 });
  check(sha256(bytes) === CONTRACT_SHA256, 'Frozen scoring contract identity mismatch.');
  const contract = JSON.parse(bytes.toString('utf8'));
  const fieldMapping = Object.freeze(FIELDS.map((inputField, index) => Object.freeze({
    inputField,
    contractField: contract.scientificPreorder[index].field,
    direction: contract.scientificPreorder[index].direction,
    quantizationUnit: contract.scientificPreorder[index].quantization ?? null,
  })));
  return Object.freeze({
    status: 'PARTIAL_PREQUANTIZED_CONTRACT_UTILITY',
    contractPath: CONTRACT_PATH,
    contractSha256: CONTRACT_SHA256,
    declaredEngineCommit: contract.engine.commit,
    declaredEngineTree: contract.engine.tree,
    fieldMapping,
    boundary: Object.freeze({
      frozenEngineVerified: false,
      rawFeatureQuantizationImplemented: false,
      upstreamBinAssignmentVerified: false,
      executionPermitted: false,
      eligibilityVerified: false,
      independentGroupsVerified: false,
      predictiveAccuracyEstablished: false,
    }),
    validateTuple,
    compareTuples,
  });
}
