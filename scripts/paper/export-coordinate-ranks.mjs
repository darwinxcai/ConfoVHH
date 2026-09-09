// Execute the current product from supplied coordinate bytes before exporting ranks.
// No reference outcomes, network retrieval, eligibility clearance or frozen-v3 arm.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { lstat, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeInterface } from '../../lib/confovhh.ts';
import { parseCoordinateText } from '../../lib/coordinate-parser.ts';
import { canonicalizeSelectedGeometry } from '../../lib/geometry-fit.ts';
import { createSingleAuditExportReport } from '../../lib/audit-export.ts';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { exportAuditReportRanks } from './export-audit-report-ranks.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MAX_FILE = 8_000_000;
const MAX_TOTAL = 64_000_000;
const MAX_COUNT = 200;
const MAX_ATOMS = 12_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(value);
const nameValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const exactKeys = (value, expected) => {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing coordinate-manifest fields');
};
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
const strictJson = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), { maximumCharacters: MAX_FILE, maximumTokens: 1_000_000, maximumDepth: 32 });

function validate(manifest) {
  exactKeys(manifest, ['schema', 'studyId', 'generators', 'attempts', 'coordinates']);
  check(manifest.schema === 'confovhh-coordinate-rank-input-v1' && idValid(manifest.studyId), 'Invalid coordinate manifest');
  check(Array.isArray(manifest.generators) && manifest.generators.length > 0 && manifest.generators.length <= 8, 'Invalid generator inventory');
  const generators = new Set();
  for (const row of manifest.generators) {
    exactKeys(row, ['id', 'scoreName', 'direction']);
    check(idValid(row.id) && idValid(row.scoreName) && !generators.has(row.id), 'Invalid or duplicate generator');
    check(['higher-better', 'lower-better'].includes(row.direction), 'Invalid baseline direction');
    generators.add(row.id);
  }
  check(Array.isArray(manifest.attempts) && manifest.attempts.length > 0 && manifest.attempts.length <= 20_000, 'Invalid attempt inventory');
  const attempts = new Map(), groups = new Map();
  for (const row of manifest.attempts) {
    exactKeys(row, ['id', 'groupId', 'targetId', 'generatorId', 'status', 'reason']);
    check(idValid(row.id) && !attempts.has(row.id) && idValid(row.groupId) && idValid(row.targetId) && generators.has(row.generatorId), 'Invalid attempt identity');
    check(['eligible', 'failed', 'ineligible'].includes(row.status), 'Invalid attempt status');
    check(typeof row.reason === 'string' && row.reason.length <= 1000 && (row.status === 'eligible' ? row.reason === '' : row.reason.trim().length > 0), 'Invalid attempt reason');
    if (groups.has(row.targetId)) check(groups.get(row.targetId) === row.groupId, 'Target appears in multiple groups');
    groups.set(row.targetId, row.groupId);
    attempts.set(row.id, row);
  }
  check(Array.isArray(manifest.coordinates) && manifest.coordinates.length <= MAX_COUNT, 'Too many coordinate inputs');
  const descriptors = new Map();
  for (const row of manifest.coordinates) {
    exactKeys(row, ['id', 'format', 'coordinateSha256', 'coordinateBytes', 'receptorChain', 'vhhChain', 'selectedModelId', 'chainRolesConfirmed', 'producerScore']);
    check(idValid(row.id) && !descriptors.has(row.id) && attempts.get(row.id)?.status === 'eligible', 'Unknown, duplicate or excluded coordinate ID');
    check(['pdb', 'mmcif'].includes(row.format), 'Unsupported coordinate format');
    check(typeof row.coordinateSha256 === 'string' && /^[a-f0-9]{64}$/u.test(row.coordinateSha256), 'Invalid coordinate SHA-256');
    check(Number.isSafeInteger(row.coordinateBytes) && row.coordinateBytes > 0 && row.coordinateBytes <= MAX_FILE, 'Invalid coordinate byte count');
    check(nameValid(row.receptorChain) && nameValid(row.vhhChain) && row.receptorChain !== row.vhhChain && nameValid(row.selectedModelId), 'Invalid chain or model selection');
    check(row.chainRolesConfirmed === true, 'Declared chain roles must be explicitly confirmed');
    check(row.producerScore === null || (typeof row.producerScore === 'number' && Number.isFinite(row.producerScore)), 'Invalid producer score');
    descriptors.set(row.id, row);
  }
  for (const row of attempts.values()) if (row.status === 'eligible') check(descriptors.has(row.id), 'Missing eligible coordinate descriptor');
  return descriptors;
}

/** All bytes are snapshotted before asynchronous work. No supplied report/features are accepted. */
export async function exportCoordinateRanks(manifest, coordinateBytesById) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  manifest = structuredClone(manifest);
  const descriptors = validate(manifest);
  check(coordinateBytesById instanceof Map && coordinateBytesById.size === descriptors.size, 'Coordinate byte membership must exactly match descriptors');
  const coordinates = new Map();
  let totalBytes = 0;
  for (const [id, bytes] of coordinateBytesById) {
    check(descriptors.has(id), 'Unknown coordinate byte ID');
    check(bytes instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer), 'Coordinates require non-shared bytes');
    const descriptor = descriptors.get(id);
    check(bytes.length === descriptor.coordinateBytes && bytes.length <= MAX_FILE, `Coordinate byte count mismatch: ${id}`);
    totalBytes += bytes.length;
    check(totalBytes <= MAX_TOTAL, 'Coordinates exceed the combined 64 MB limit');
    const snapshot = Buffer.from(bytes);
    check(sha(snapshot) === descriptor.coordinateSha256, `Coordinate SHA-256 mismatch: ${id}`);
    coordinates.set(id, snapshot);
  }
  const resolvedEngine = createRequire(pathToFileURL(path.join(ROOT, 'lib/vhh-numbering-v06.ts'))).resolve('immunum');
  check(resolvedEngine === path.join(ROOT, 'node_modules/immunum/immunum.js') && await realpath(resolvedEngine) === resolvedEngine, 'Scientific module resolution differs from recorded dependency');
  const generatedAt = new Date().toISOString();
  const reports = new Map(), reportDescriptors = [], executionBindings = [];
  for (const descriptor of [...descriptors.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const bytes = coordinates.get(descriptor.id);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    check(!text.startsWith('\uFEFF') && !text.includes('\0'), 'Coordinate text must not contain BOM or NUL');
    const filename = `${descriptor.id}.${descriptor.format === 'pdb' ? 'pdb' : 'cif'}`;
    // Use the supplied model/asymmetric-unit coordinates only; never invent an assembly.
    const structure = parseCoordinateText(text, filename, { modelId: descriptor.selectedModelId });
    check(structure.atoms.length > 0 && structure.atoms.length <= MAX_ATOMS, 'Coordinate audit exceeds the 12,000-atom execution limit or is empty');
    check(structure.selectedModelId === descriptor.selectedModelId, 'Selected model changed during parsing');
    for (const chain of [descriptor.receptorChain, descriptor.vhhChain]) check(structure.chains.some(row => row.id === chain), `Selected chain absent: ${chain}`);
    const canonical = canonicalizeSelectedGeometry(structure, descriptor.receptorChain, descriptor.vhhChain);
    const audit = analyzeInterface(structure, descriptor.receptorChain, descriptor.vhhChain, 'none', null, false, canonical);
    const report = createSingleAuditExportReport({ filename, coordinateSha256: sha(bytes), coordinateBytes: bytes.length, structure, receptorChain: descriptor.receptorChain, vhhChain: descriptor.vhhChain, chainIdentityConfirmed: descriptor.chainRolesConfirmed, pae: null, paeSha256: null, paeOrderConfirmed: false, audit, generatedAt });
    const reportBytes = jsonBytes(report);
    reports.set(descriptor.id, reportBytes);
    reportDescriptors.push({ id: descriptor.id, reportSha256: sha(reportBytes), coordinateSha256: sha(bytes), coordinateBytes: bytes.length, receptorChain: descriptor.receptorChain, vhhChain: descriptor.vhhChain, selectedModelId: descriptor.selectedModelId, producerScore: descriptor.producerScore });
    executionBindings.push({ id: descriptor.id, format: descriptor.format, coordinateSha256: sha(bytes), coordinateBytes: bytes.length, selectedModelId: structure.selectedModelId, parsedAtomCount: structure.atoms.length, reportSha256: sha(reportBytes) });
  }
  const reportManifest = { schema: 'confovhh-audit-report-rank-input-v1', studyId: manifest.studyId, generators: manifest.generators, attempts: manifest.attempts, reports: reportDescriptors };
  const reportRankExport = await exportAuditReportRanks(reportManifest, reports);
  const executionSources = {};
  for (const relative of ['scripts/paper/export-coordinate-ranks.mjs', 'node_modules/immunum/package.json', 'node_modules/immunum/immunum.js', 'node_modules/immunum/immunum_bg.wasm']) {
    const location = path.join(ROOT, relative);
    const stat = await lstat(location);
    check(stat.isFile() && !stat.isSymbolicLink() && await realpath(location) === location, 'Execution identity requires direct source/dependency files');
    executionSources[relative] = sha(await readFile(location));
  }
  const policy = {
    schema: 'confovhh-coordinate-rank-policy-v1', reportRankPolicySha256: reportRankExport.comparisonFields.method.policySha256,
    sourceSha256: executionSources, runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    audit: { confidenceMode: 'none', pae: 'omitted', sasaFrame: 'canonical-selected-geometry', assembly: 'as-supplied', model: 'explicit-required', maxParsedAtoms: MAX_ATOMS },
    frozenV3Compatible: false,
  };
  return {
    schema: 'confovhh-coordinate-rank-export-v1', studyId: manifest.studyId,
    comparisonFields: { ...structuredClone(reportRankExport.comparisonFields), method: { name: 'coordinate-executed-current-product', policySha256: sha(canonicalJson(policy)) } },
    reportManifest, reports: Object.fromEntries([...reports].map(([id, bytes]) => [id, bytes.toString('utf8')])), reportRankExport,
    provenance: { canonicalManifestSha256: sha(canonicalJson(manifest)), policy, executionBindings, coordinateCount: coordinates.size, totalCoordinateBytes: totalBytes, generatedAt },
    claims: { exactCoordinateBytesVerified: true, currentAuditExecuted: coordinates.size > 0, ranksDerivedFromExecutedAudits: coordinates.size > 0, originalProducerExecutionVerified: false, biologicalRolesVerified: false, eligibilityVerified: false, independenceCertified: false, prelabelChronologyCertified: false, producerScoreSourcesVerified: false, frozenV3Compatible: false, completeExecutionClosureVerified: false, predictiveAccuracyMeasured: false },
    limitations: [
      'This records a new current-product execution; it does not authenticate an earlier report or original prediction run.',
      'Chain labels, eligible population, complete attempt inventory, grouping, producer scores and their direction are supplied declarations requiring separate evidence.',
      'Report timestamps describe this execution and change on replay; coordinate identities, audit semantics and scientific ties remain separately checkable.',
      'Method identity binds the current report pipeline, selected scientific dependency bytes and runtime version; it is not a complete executable/environment closure or a pre-outcome registration.',
      'The current product policy differs from frozen v3. No biological outcome, predictive accuracy, affinity or experimental binding is inferred.',
    ],
  };
}

async function boundedFile(filename) {
  const absolute = path.resolve(filename), parent = path.dirname(absolute);
  check(await realpath(parent) === parent, 'Input ancestors must not be symlinks');
  const before = await lstat(absolute);
  check(before.isFile() && !before.isSymbolicLink(), 'Expected a regular input file');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.dev === before.dev && stat.ino === before.ino && stat.size > 0 && stat.size <= MAX_FILE, 'Invalid or changed bounded input');
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    check(count === stat.size, 'Input changed during read');
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}

export async function runCoordinateRankExport(inputPath, coordinateDirectory, outputPath) {
  // Refuse an existing output before any coordinate audit is performed.
  try { await lstat(outputPath); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const input = await boundedFile(inputPath), manifest = strictJson(input), descriptors = validate(manifest);
  const directory = path.resolve(coordinateDirectory);
  check(await realpath(directory) === directory, 'Coordinate directory must not contain symlinks');
  const entries = await readdir(directory, { withFileTypes: true });
  const names = new Map([...descriptors.values()].map(row => [`${row.id}.${row.format === 'pdb' ? 'pdb' : 'cif'}`, row.id]));
  check(entries.length === names.size && entries.every(entry => names.has(entry.name) && entry.isFile() && !entry.isSymbolicLink()), 'Coordinate directory must contain exactly the declared regular files');
  const coordinates = new Map();
  let total = 0;
  for (const [name, id] of names) {
    const bytes = await boundedFile(path.join(directory, name));
    total += bytes.length;
    check(total <= MAX_TOTAL, 'Coordinates exceed combined byte limit');
    coordinates.set(id, bytes);
  }
  const result = await exportCoordinateRanks(manifest, coordinates);
  const receipt = { inputSha256: sha(input), result };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 3 && args[0].startsWith('--input=') && args[0].length > 8 && args[1].startsWith('--coordinates=') && args[1].length > 14 && args[2].startsWith('--output=') && args[2].length > 9, 'Usage: node scripts/paper/export-coordinate-ranks.mjs --input=MANIFEST.json --coordinates=AUTHORIZED_DIRECTORY --output=NEW_RECEIPT.json');
    const receipt = await runCoordinateRankExport(args[0].slice(8), args[1].slice(14), args[2].slice(9));
    console.log(`${receipt.result.provenance.coordinateCount} coordinate inputs re-audited; predictive accuracy not measured`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
