// Current-product coordinates plus fixed, exact-byte producer confidence extraction.
// No reference labels, scientific eligibility decision or historical-policy migration.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { exportCoordinateRanks } from './export-coordinate-ranks.mjs';
import { extractProducerScoreSources, getProducerScorePolicy } from './producer-score-sources.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MAX_FILE = 8_000_000, MAX_TOTAL = 64_000_000, MAX_FILES = 400;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(value);
function keys(value, expected) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing source-bound fields');
}
function safeRelative(value) {
  check(typeof value === 'string' && value.length <= 512 && value.split('/').every(safeId), 'Artifact paths must contain safe relative segments');
  return value;
}
function validate(manifest) {
  keys(manifest, ['schema', 'studyId', 'generators', 'attempts', 'coordinates', 'scoreSources']);
  check(manifest.schema === 'confovhh-source-bound-coordinate-input-v1' && safeId(manifest.studyId), 'Invalid source-bound input');
  check(Array.isArray(manifest.generators) && manifest.generators.length > 0 && manifest.generators.length <= 8, 'Invalid generator inventory');
  const generators = new Map();
  for (const row of manifest.generators) {
    keys(row, ['id', 'extractor']);
    check(safeId(row.id) && !generators.has(row.id), 'Invalid or duplicate generator');
    const policy = getProducerScorePolicy(row.extractor);
    generators.set(row.id, { id: row.id, scoreName: policy.scoreName, direction: policy.direction, extractor: row.extractor });
  }
  check(Array.isArray(manifest.attempts) && manifest.attempts.length > 0 && manifest.attempts.length <= 20_000, 'Invalid attempt inventory');
  const attempts = new Map();
  for (const row of manifest.attempts) {
    keys(row, ['id', 'groupId', 'targetId', 'generatorId', 'status', 'reason']);
    check(safeId(row.id) && !attempts.has(row.id) && generators.has(row.generatorId), 'Unknown or duplicate attempt');
    attempts.set(row.id, row);
  }
  check(Array.isArray(manifest.coordinates) && manifest.coordinates.length <= 200 && Array.isArray(manifest.scoreSources), 'Invalid source inventory');
  const coordinates = new Map(), sources = new Map(), paths = new Set();
  for (const row of manifest.coordinates) {
    keys(row, ['id', 'format', 'coordinateSha256', 'coordinateBytes', 'receptorChain', 'vhhChain', 'selectedModelId', 'chainRolesConfirmed']);
    check(safeId(row.id) && !coordinates.has(row.id) && attempts.get(row.id)?.status === 'eligible', 'Unknown, duplicate or excluded coordinate');
    coordinates.set(row.id, row);
  }
  const addPath = value => { safeRelative(value); check(!paths.has(value), 'Each artifact path must belong to one attempt and role'); paths.add(value); };
  for (const row of manifest.scoreSources) {
    keys(row, ['id', 'extractor', 'coordinatePath', 'coordinateSha256', 'source']);
    const coordinate = coordinates.get(row.id), attempt = attempts.get(row.id);
    check(coordinate && !sources.has(row.id), 'Unknown or duplicate score source');
    check(row.extractor === generators.get(attempt.generatorId).extractor, 'Score extractor differs from declared generator baseline');
    check(row.coordinateSha256 === coordinate.coordinateSha256, 'Score source coordinate binding differs');
    check(row.coordinatePath.endsWith(coordinate.format === 'pdb' ? '.pdb' : '.cif'), 'Coordinate format differs from producer artifact filename');
    addPath(row.coordinatePath);
    if (row.source !== null) { keys(row.source, ['path', 'sha256', 'bytes']); addPath(row.source.path); }
    sources.set(row.id, row);
  }
  check(sources.size === coordinates.size, 'Every coordinate needs an explicit score-source status');
  for (const attempt of attempts.values()) if (attempt.status === 'eligible') check(coordinates.has(attempt.id), 'Missing eligible coordinate');
  return { generators, coordinates, sources, paths };
}
function snapshot(map, label) {
  check(map instanceof Map && map.size <= 200, `${label} must be a bounded Map`);
  const captured = new Map();
  let total = 0;
  for (const [id, bytes] of map) {
    check(bytes instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer), `${label} require non-shared bytes`);
    check(bytes.length > 0 && bytes.length <= MAX_FILE, `${label} file exceeds limit`);
    total += bytes.length; check(total <= MAX_TOTAL, `${label} exceed total byte limit`);
    captured.set(id, Buffer.from(bytes));
  }
  return captured;
}

export async function exportSourceBoundCoordinateRanks(manifest, coordinateBytesById, scoreBytesById) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  manifest = structuredClone(manifest);
  const { generators } = validate(manifest);
  // Capture both mutable byte maps and declarations before the first await.
  const coordinates = snapshot(coordinateBytesById, 'Coordinates'), scoreBytes = snapshot(scoreBytesById, 'Producer scores');
  const extracted = extractProducerScoreSources(manifest.scoreSources, scoreBytes);
  const scoreById = new Map(extracted.scores.map(row => [row.id, row]));
  const coordinateManifest = {
    schema: 'confovhh-coordinate-rank-input-v1', studyId: manifest.studyId,
    generators: [...generators.values()].map(({ id, scoreName, direction }) => ({ id, scoreName, direction })),
    attempts: manifest.attempts,
    coordinates: manifest.coordinates.map(row => ({ ...row, producerScore: scoreById.get(row.id).value })),
  };
  const coordinateExecution = await exportCoordinateRanks(coordinateManifest, coordinates);
  for (const json of Object.values(coordinateExecution.reports)) {
    check(JSON.parse(json).structure.modelCount === 1, 'Producer-file confidence requires a single coordinate MODEL; internal model-score mapping is unsupported');
  }
  const sourceSha256 = {};
  for (const relative of ['scripts/paper/export-source-bound-coordinate-ranks.mjs', 'scripts/paper/producer-score-sources.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs']) {
    const location = path.join(ROOT, relative);
    check((await lstat(location)).isFile() && await realpath(location) === location, 'Source identity requires regular direct files');
    sourceSha256[relative] = sha(await readFile(location));
  }
  const policy = {
    schema: 'confovhh-source-bound-baseline-policy-v1', sourceSha256,
    rankBaselinePolicySha256: coordinateExecution.comparisonFields.baseline.policySha256,
    generators: manifest.generators, extraction: extracted.policy,
    missing: 'No score substitution; any missing eligible score withholds paired ranks.',
    association: 'Exact coordinate hash and required producer filename convention; original producer execution is not authenticated.',
  };
  const missing = extracted.scores.filter(row => row.value === null);
  return {
    schema: 'confovhh-source-bound-coordinate-export-v1', studyId: manifest.studyId,
    status: manifest.coordinates.length === 0 ? 'no-eligible-candidates' : missing.length ? 'baseline-unavailable' : 'source-bound-ranks-complete',
    comparisonFields: { ...structuredClone(coordinateExecution.comparisonFields), baseline: { name: 'source-bound-producer-confidence', policySha256: sha(canonicalJson(policy)) } },
    scoreExtraction: extracted, coordinateExecution,
    provenance: { canonicalManifestSha256: sha(canonicalJson(manifest)), policy, sourceJson: Object.fromEntries([...scoreBytes].map(([id, bytes]) => [id, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)])), missingScoreIds: missing.map(row => row.id) },
    claims: { exactCoordinateBytesVerified: true, availableProducerScoreBytesVerified: true, scoresExtractedWithoutCallerNumericOverrides: true, allEligibleProducerScoresAvailable: missing.length === 0, originalProducerExecutionVerified: false, biologicalRolesVerified: false, eligibilityVerified: false, independenceCertified: false, prelabelChronologyCertified: false, completeExecutionClosureVerified: false, predictiveAccuracyMeasured: false, frozenV3Compatible: false },
    limitations: [
      'Available scores are extracted from exact supplied file bytes using fixed producer fields and directions. This does not authenticate the producer, its version, its run or the truth of supplied files.',
      'The API verifies declared filename conventions; the CLI additionally reads those relative paths. Exactly one coordinate MODEL is required. Matching filenames and hashes do not establish the historical coordinate/score association.',
      'Whole-complex producer scores are baselines for the supplied model, not receptor-VHH-specific uncertainty or binding probabilities.',
      'The existing coordinate executor retains its lower-level provenance claims; this wrapper adds source-byte extraction without rewriting that receipt.',
      'Selection units remain target-by-generator in this rank export. Separate jobs/conditions require a separately declared selection-set analysis; pooling them changes the question.',
      'Eligibility, complete planned population, independent grouping, predictor training overlap and separate outcome evidence still require a study protocol.',
    ],
  };
}

async function boundedFile(filename) {
  const absolute = path.resolve(filename);
  check(await realpath(path.dirname(absolute)) === path.dirname(absolute), 'Artifact ancestors must not be symlinks');
  const before = await lstat(absolute);
  check(before.isFile() && !before.isSymbolicLink(), 'Expected regular artifact file');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.dev === before.dev && stat.ino === before.ino && stat.size > 0 && stat.size <= MAX_FILE, 'Invalid bounded artifact identity');
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    check(count === stat.size, 'Artifact changed while reading');
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}
async function checkInventory(directory, expected) {
  check(await realpath(directory) === directory, 'Artifact root must not contain symlinks');
  const expectedDirs = new Set();
  for (const name of expected) {
    const parts = name.split('/');
    for (let count = 1; count < parts.length; count++) expectedDirs.add(parts.slice(0, count).join('/'));
  }
  let count = 0;
  async function visit(prefix) {
    for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      check(!entry.isSymbolicLink(), 'Symlinked artifacts are not permitted');
      if (entry.isDirectory()) { check(expectedDirs.has(relative), 'Unexpected artifact directory'); await visit(relative); }
      else { check(entry.isFile() && expected.has(relative), 'Unexpected or nonregular artifact file'); count++; check(count <= MAX_FILES, 'Too many artifact files'); }
    }
  }
  await visit('');
  check(count === expected.size, 'Artifact directory must contain exactly the declared files');
}
export async function runSourceBoundCoordinateRanks(inputPath, artifactDirectory, outputPath) {
  try { await lstat(outputPath); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const input = await boundedFile(inputPath);
  const manifest = parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input), { maximumCharacters: MAX_FILE, maximumTokens: 1_000_000, maximumDepth: 32 });
  const { sources, paths } = validate(manifest), directory = path.resolve(artifactDirectory);
  await checkInventory(directory, paths);
  const coordinates = new Map(), scores = new Map();
  let total = 0;
  for (const row of sources.values()) {
    const coordinate = await boundedFile(path.join(directory, row.coordinatePath));
    total += coordinate.length; coordinates.set(row.id, coordinate);
    if (row.source !== null) { const score = await boundedFile(path.join(directory, row.source.path)); total += score.length; scores.set(row.id, score); }
    check(total <= MAX_TOTAL, 'Artifacts exceed combined 64 MB limit');
  }
  const result = await exportSourceBoundCoordinateRanks(manifest, coordinates, scores);
  const receipt = { inputSha256: sha(input), result };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 3 && args[0].startsWith('--input=') && args[0].length > 8 && args[1].startsWith('--artifacts=') && args[1].length > 12 && args[2].startsWith('--output=') && args[2].length > 9, 'Usage: node scripts/paper/export-source-bound-coordinate-ranks.mjs --input=MANIFEST.json --artifacts=AUTHORIZED_DIRECTORY --output=NEW_RECEIPT.json');
    const receipt = await runSourceBoundCoordinateRanks(args[0].slice(8), args[1].slice(12), args[2].slice(9));
    console.log(`${receipt.result.status}; predictive accuracy not measured`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
