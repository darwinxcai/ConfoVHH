// Extract reported producer scores from exact supplied original-file bytes.
// Filename association is not authentication of a prediction run or its inputs.
import { createHash } from 'node:crypto';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const MAX_COUNT = 200;
const MAX_FILE = 1_000_000;
const MAX_TOTAL = 16_000_000;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(value);
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const order = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const AF3_DOC = 'https://github.com/google-deepmind/alphafold3/blob/main/docs/output.md';
const BOLTZ_DOC = 'https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md';
const definitions = [
  ['af3-ranking-score-v1', 'alphafold3', 'alphafold3-summary-confidences-v1', 'ranking_score', 'alphafold3-ranking-score', -100, 1.5, AF3_DOC],
  ['af3-iptm-v1', 'alphafold3', 'alphafold3-summary-confidences-v1', 'iptm', 'alphafold3-iptm', 0, 1, AF3_DOC],
  ['boltz-confidence-score-v1', 'boltz', 'boltz-confidence-v1', 'confidence_score', 'boltz-confidence-score', 0, 1, BOLTZ_DOC],
  ['boltz-iptm-v1', 'boltz', 'boltz-confidence-v1', 'iptm', 'boltz-iptm', 0, 1, BOLTZ_DOC],
];

/** Versioned extraction policies, not a claim about the producer's software version. */
export const PRODUCER_SCORE_EXTRACTORS = freeze(Object.fromEntries(definitions.map(
  ([id, provider, sourceSchema, field, scoreName, minimum, maximum, documentation]) => [id, {
    id, provider, sourceSchema, field, jsonPointer: `/${field}`, scoreName,
    direction: 'higher-better', minimum, maximum, documentation,
    documentationChecked: '2026-09-09',
    namingPolicy: provider === 'alphafold3' ? 'native-local-af3-same-directory-v1' : 'native-boltz-same-directory-v1',
    aggregation: 'none-read-reported-scalar',
    interpretation: field === 'iptm' ? 'reported-whole-complex-interface-confidence' : 'reported-producer-ranking-score',
  }],
)));

export function getProducerScorePolicy(extractor) {
  check(typeof extractor === 'string' && Object.hasOwn(PRODUCER_SCORE_EXTRACTORS, extractor), 'Unsupported producer score extractor');
  return PRODUCER_SCORE_EXTRACTORS[extractor];
}

function exactKeys(value, keys, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `Expected ${label} object`);
  check(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), `Unexpected or missing ${label} fields`);
}

function relativePath(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 1024, 'Invalid producer-relative path');
  check(!/^[A-Za-z]:|^[\\/]|[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), 'Producer paths must be plain relative POSIX paths');
  const segments = value.split('/');
  check(segments.every(part => part && part !== '.' && part !== '..' && part.length <= 255), 'Invalid producer path segment');
  return { directory: segments.slice(0, -1).join('/'), filename: segments.at(-1) };
}

function matchNames(descriptor, policy) {
  const coordinate = relativePath(descriptor.coordinatePath);
  let match, expectedFilename;
  if (policy.provider === 'alphafold3') {
    match = /^(.+)_model\.cif$/u.exec(coordinate.filename);
    check(match, 'Unsupported native local AF3 coordinate filename');
    expectedFilename = `${match[1]}_summary_confidences.json`;
  } else {
    match = /^(.+_model_[0-9]+)\.(?:cif|pdb)$/u.exec(coordinate.filename);
    check(match, 'Unsupported native Boltz coordinate filename');
    expectedFilename = `confidence_${match[1]}.json`;
  }
  const expectedPath = [coordinate.directory, expectedFilename].filter(Boolean).join('/');
  if (descriptor.source !== null) {
    relativePath(descriptor.source.path);
    check(descriptor.source.path === expectedPath, 'Producer source filename/directory does not match the coordinate model');
  }
  return { modelKey: match[1], expectedSourcePath: expectedPath };
}

function snapshotDescriptors(descriptors) {
  check(Array.isArray(descriptors) && descriptors.length <= MAX_COUNT, 'Invalid producer descriptor count (maximum 200)');
  // Canonical serialization refuses accessors and non-JSON data before cloning.
  const serialized = canonicalJson(descriptors);
  check(serialized.length <= MAX_FILE, 'Producer descriptors exceed the size limit');
  const snapshot = parseStrictJson(serialized, { maximumCharacters: MAX_FILE, maximumDepth: 16, maximumTokens: 20_000 });
  const ids = new Set(), paths = new Set(), sourcePaths = new Set();
  for (const descriptor of snapshot) {
    exactKeys(descriptor, ['id', 'extractor', 'coordinatePath', 'coordinateSha256', 'source'], 'producer descriptor');
    check(idValid(descriptor.id) && !ids.has(descriptor.id), 'Invalid or duplicate producer attempt ID');
    ids.add(descriptor.id);
    const policy = getProducerScorePolicy(descriptor.extractor);
    check(hashValid(descriptor.coordinateSha256), 'Invalid declared coordinate SHA-256');
    check(!paths.has(descriptor.coordinatePath), 'Duplicate declared coordinate path');
    paths.add(descriptor.coordinatePath);
    if (descriptor.source !== null) {
      exactKeys(descriptor.source, ['path', 'sha256', 'bytes'], 'producer source');
      check(hashValid(descriptor.source.sha256), 'Invalid producer source SHA-256');
      check(Number.isSafeInteger(descriptor.source.bytes) && descriptor.source.bytes > 0 && descriptor.source.bytes <= MAX_FILE, 'Invalid producer source byte count');
      check(!sourcePaths.has(descriptor.source.path), 'Duplicate declared producer source path');
      sourcePaths.add(descriptor.source.path);
    }
    matchNames(descriptor, policy);
  }
  return snapshot.sort(order);
}

function parseSource(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const document = parseStrictJson(text, { maximumCharacters: MAX_FILE, maximumDepth: 32, maximumTokens: 200_000 });
  check(document && typeof document === 'object' && !Array.isArray(document), 'Producer source must be a JSON object');
  return document;
}

function validateScalar(document, policy) {
  if (!Object.hasOwn(document, policy.field)) return { value: null, missingReason: 'missing-field' };
  const value = document[policy.field];
  if (value === null) return { value: null, missingReason: 'null-field' };
  check(typeof value === 'number' && Number.isFinite(value) && value >= policy.minimum && value <= policy.maximum,
    `Invalid ${policy.provider} ${policy.field}: expected a scalar in [${policy.minimum}, ${policy.maximum}]`);
  return { value, missingReason: null };
}

/**
 * descriptors: [{id, extractor, coordinatePath, coordinateSha256,
 *               source: null | {path, sha256, bytes}}].
 * sourceBytesById: Map containing exactly the IDs with non-null source records.
 * A null source is caller-declared unavailability, never a fabricated zero.
 * This function has no filesystem/network access and does not inspect coordinates.
 */
export function extractProducerScoreSources(descriptors, sourceBytesById) {
  const snapshot = snapshotDescriptors(descriptors);
  const expected = new Map(snapshot.filter(row => row.source !== null).map(row => [row.id, row]));
  check(sourceBytesById instanceof Map && sourceBytesById.size === expected.size, 'Producer source byte membership must exactly match non-null descriptors');
  const sources = new Map();
  let totalBytes = 0;
  // Copy and verify every buffer before parsing any source or generating scores.
  for (const [id, bytes] of sourceBytesById) {
    check(expected.has(id), 'Unknown or declared-missing producer source byte ID');
    check(bytes instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer), 'Producer sources require non-shared bytes');
    const descriptor = expected.get(id);
    check(bytes.byteLength === descriptor.source.bytes && bytes.byteLength <= MAX_FILE, `Producer source byte count mismatch: ${id}`);
    totalBytes += bytes.byteLength;
    check(totalBytes <= MAX_TOTAL, 'Producer sources exceed the combined 16 MB limit');
    const copied = Buffer.from(bytes);
    check(sha(copied) === descriptor.source.sha256, `Producer source SHA-256 mismatch: ${id}`);
    sources.set(id, copied);
  }
  const scores = [], bindings = [];
  const missingness = { total: snapshot.length, available: 0, missingFile: 0, missingField: 0, nullField: 0 };
  for (const descriptor of snapshot) {
    const extractor = getProducerScorePolicy(descriptor.extractor);
    const naming = matchNames(descriptor, extractor);
    let result = { value: null, missingReason: 'missing-file' };
    if (descriptor.source !== null) {
      const document = parseSource(sources.get(descriptor.id));
      // Reject malformed supported fields even when another field is selected.
      for (const policy of Object.values(PRODUCER_SCORE_EXTRACTORS)) {
        if (policy.provider === extractor.provider) validateScalar(document, policy);
      }
      result = validateScalar(document, extractor);
    }
    const missingKey = { 'missing-file': 'missingFile', 'missing-field': 'missingField', 'null-field': 'nullField' }[result.missingReason];
    missingness[missingKey ?? 'available'] += 1;
    scores.push({ id: descriptor.id, scoreName: extractor.scoreName, direction: extractor.direction, ...result });
    bindings.push({
      id: descriptor.id, extractor: extractor.id, coordinatePath: descriptor.coordinatePath,
      coordinateSha256: descriptor.coordinateSha256, coordinateHashStatus: 'declared-not-verified-here',
      sourcePath: descriptor.source?.path ?? null, sourceSha256: descriptor.source?.sha256 ?? null,
      sourceBytes: descriptor.source?.bytes ?? null, sourceBytesVerified: descriptor.source !== null,
      ...naming, associationBasis: 'recognized-producer-filename-stem', jsonPointer: extractor.jsonPointer,
      value: result.value, missingReason: result.missingReason,
    });
  }
  const policy = {
    schema: 'confovhh-producer-score-policy-v1', extractors: PRODUCER_SCORE_EXTRACTORS,
    limits: { maxDescriptors: MAX_COUNT, maxSourceBytes: MAX_FILE, maxTotalSourceBytes: MAX_TOTAL, maxJsonDepth: 32, maxJsonTokens: 200_000 },
    parser: 'confovhh-strict-json-v1', knownSupportedFieldsValidated: true,
    absentFieldPolicy: 'explicit-null-with-reason', absentFilePolicy: 'caller-declared-source-null',
    coordinateBinding: 'declared-sha256-and-exact-relative-producer-filenames',
  };
  return {
    schema: 'confovhh-producer-score-extraction-v1', scores, bindings, missingness,
    policy: structuredClone(policy), policySha256: sha(canonicalJson(policy)),
    descriptorSha256: sha(canonicalJson(snapshot)), verifiedSourceCount: sources.size, totalSourceBytes: totalBytes,
    claims: { allSuppliedSourceBytesVerified: true, coordinateBytesVerified: false, originalProducerExecutionVerified: false,
      producerVersionVerified: false, originalSourceCompletenessVerified: false, predictiveAccuracyMeasured: false },
    limitations: [
      'Hashes identify the supplied bytes. They do not authenticate a producer run, its software version, inputs, chronology or original output completeness.',
      'Exact relative filename association links a declared coordinate file to a source file. It does not prove they originated in the same prediction run or select an internal coordinate MODEL.',
      'Coordinate hashes are retained declarations; the caller must independently verify coordinate bytes and permitted model selection.',
      'A null source records caller-declared unavailability; absent or null fields remain unavailable. No component recomputation, fallback, normalization, averaging or tie breaking is performed.',
      'AF3 extraction supports native local CIF naming only. Chain-pair ipTM, renamed exports, AF2/ColabFold ranking metadata and affinity scores are unsupported.',
      'Extractor versions identify the fixed field/range/naming policy; documentation links are supporting references and do not establish the supplied producer version.',
    ],
  };
}
