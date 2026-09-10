// Exact-byte report-to-feature bridge for the separately identified current product.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateImportedSingleAuditReport } from '../../lib/research-workspace.ts';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { exportCurrentProductRanks } from './export-current-product-ranks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPORT_LIMIT = 1_000_000;
const TOTAL_LIMIT = 64_000_000;
const REPORT_COUNT_LIMIT = 200;
const MANIFEST_LIMIT = 16_000_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const chainOrModel = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
function check(condition, message) { if (!condition) throw new Error(message); }
function keys(value, expected) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing manifest fields');
}

function validateManifest(input) {
  keys(input, ['schema', 'studyId', 'generators', 'attempts', 'reports']);
  check(input.schema === 'confovhh-audit-report-rank-input-v1' && identifier(input.studyId), 'Invalid manifest schema or study ID');
  check(Array.isArray(input.generators) && input.generators.length > 0 && input.generators.length <= 8, 'Invalid generator count');
  const generators = new Set();
  for (const row of input.generators) {
    keys(row, ['id', 'scoreName', 'direction']);
    check(identifier(row.id) && identifier(row.scoreName) && !generators.has(row.id), 'Invalid or duplicate generator');
    check(['higher-better', 'lower-better'].includes(row.direction), 'Invalid producer score direction');
    generators.add(row.id);
  }
  check(Array.isArray(input.attempts) && input.attempts.length > 0 && input.attempts.length <= 20_000, 'Invalid attempt count');
  const attempts = new Map();
  const targetGroups = new Map();
  for (const row of input.attempts) {
    keys(row, ['id', 'groupId', 'targetId', 'generatorId', 'status', 'reason']);
    check(identifier(row.id) && !attempts.has(row.id) && identifier(row.groupId) && identifier(row.targetId) && generators.has(row.generatorId), 'Invalid, duplicate or unknown attempt identity');
    check(['eligible', 'failed', 'ineligible'].includes(row.status), 'Invalid attempt status');
    check(typeof row.reason === 'string' && row.reason.length <= 1000 && (row.status === 'eligible' ? row.reason === '' : row.reason.trim().length > 0), 'Invalid attempt reason');
    if (targetGroups.has(row.targetId)) check(targetGroups.get(row.targetId) === row.groupId, 'Target appears in multiple groups');
    targetGroups.set(row.targetId, row.groupId);
    attempts.set(row.id, row);
  }
  check(Array.isArray(input.reports) && input.reports.length <= REPORT_COUNT_LIMIT, 'At most 200 reports are supported');
  const reports = new Map();
  for (const row of input.reports) {
    keys(row, ['id', 'reportSha256', 'coordinateSha256', 'coordinateBytes', 'receptorChain', 'vhhChain', 'selectedModelId', 'producerScore']);
    check(identifier(row.id) && !reports.has(row.id) && attempts.get(row.id)?.status === 'eligible', 'Unknown, duplicate or excluded report ID');
    check(digest(row.reportSha256) && digest(row.coordinateSha256), 'Invalid report or declared coordinate SHA-256');
    check(Number.isSafeInteger(row.coordinateBytes) && row.coordinateBytes >= 0, 'Invalid declared coordinate byte count');
    check(chainOrModel(row.receptorChain) && chainOrModel(row.vhhChain) && row.receptorChain !== row.vhhChain && chainOrModel(row.selectedModelId), 'Invalid declared chain or model selection');
    check(row.producerScore === null || (typeof row.producerScore === 'number' && Number.isFinite(row.producerScore)), 'Producer score must be finite or explicitly null');
    reports.set(row.id, row);
  }
  for (const row of attempts.values()) if (row.status === 'eligible') check(reports.has(row.id), 'Missing eligible report descriptor');
  return reports;
}

function strictJson(bytes, limit) {
  // Preserve BOM so the strict parser can reject it rather than silently removing it.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return parseStrictJson(text, { maximumCharacters: limit, maximumTokens: 1_000_000, maximumDepth: 32 });
}

async function sourceHashes() {
  const libEntries = await readdir(join(ROOT, 'lib'), { withFileTypes: true });
  const paths = libEntries.filter(entry => entry.name.endsWith('.ts')).map(entry => {
    check(entry.isFile() && !entry.isSymbolicLink(), `Non-regular library source: ${entry.name}`);
    return `lib/${entry.name}`;
  });
  paths.push('package-lock.json', 'scripts/paper/export-audit-report-ranks.mjs', 'scripts/paper/export-current-product-ranks.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs');
  const result = {};
  for (const path of paths.sort(compare)) {
    const location = join(ROOT, path);
    const stat = await lstat(location);
    check(stat.isFile() && !stat.isSymbolicLink(), `Non-regular source: ${path}`);
    result[path] = sha(await readFile(location));
  }
  return result;
}

/** reportBytesById is a Map from safe attempt IDs to Uint8Array/Buffer JSON bytes. */
export async function exportAuditReportRanks(manifest, reportBytesById) {
  // Caller mutations after return of this Promise cannot alter the observed input.
  manifest = structuredClone(manifest);
  const descriptors = validateManifest(manifest);
  check(reportBytesById instanceof Map, 'Report bytes must be supplied as a Map');
  check(reportBytesById.size === descriptors.size, 'Report byte membership must exactly match eligible descriptors');
  const snapshots = new Map();
  let totalBytes = 0;
  for (const [id, bytes] of reportBytesById) {
    check(descriptors.has(id), 'Unknown or excluded report bytes');
    check(bytes instanceof Uint8Array && !(typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer), 'Report bytes must be a non-shared Uint8Array or Buffer');
    check(bytes.byteLength > 0 && bytes.byteLength <= REPORT_LIMIT, 'Report exceeds 1 MB or is empty');
    totalBytes += bytes.byteLength;
    check(totalBytes <= TOTAL_LIMIT, 'Reports exceed the combined 64 MB limit');
    snapshots.set(id, Buffer.from(bytes));
  }

  const features = [];
  const reportBindings = [];
  let auditPolicy = null;
  let policyJson = null;
  for (const descriptor of [...descriptors.values()].sort((a, b) => compare(a.id, b.id))) {
    const bytes = snapshots.get(descriptor.id);
    check(bytes, 'Missing eligible report bytes');
    check(sha(bytes) === descriptor.reportSha256, `Report SHA-256 mismatch: ${descriptor.id}`);
    const report = validateImportedSingleAuditReport(strictJson(bytes, REPORT_LIMIT));
    check(report.audit.version === report.softwareVersion, 'Audit and report software versions differ');
    check(report.auditPolicy.confidenceMode === 'none' && report.auditPolicy.pae === 'omitted' && report.pae === null, 'Geometry-only reports require confidenceMode none and PAE omitted');
    const thisPolicy = canonicalJson(report.auditPolicy);
    if (policyJson === null) { policyJson = thisPolicy; auditPolicy = structuredClone(report.auditPolicy); }
    else check(thisPolicy === policyJson, 'Mixed full audit policy values are not permitted');
    const structure = report.structure;
    check(structure.sourceFileSha256 === descriptor.coordinateSha256 && structure.sourceFileBytes === descriptor.coordinateBytes, `Declared coordinate identity does not match report: ${descriptor.id}`);
    check(structure.selectedModelId === descriptor.selectedModelId, `Declared selected model does not match report: ${descriptor.id}`);
    const receptor = structure.selectedChains.find(chain => chain.role === 'receptor');
    const vhh = structure.selectedChains.find(chain => chain.role === 'VHH');
    check(receptor.id === descriptor.receptorChain && vhh.id === descriptor.vhhChain, `Declared chain roles do not match report: ${descriptor.id}`);
    const audit = report.audit;
    const extracted = Object.fromEntries(['evidenceLevel', 'contactPairCount', 'receptorInterfaceResidues', 'vhhInterfaceResidues', 'halfDeltaSasaInterfaceAreaAngstrom2', 'severeClashCount', 'maximumOverlapAngstrom'].map(field => [field, audit[field]]));
    extracted.imgtNumberingStatus = audit.vhhNumbering.status;
    features.push({ id: descriptor.id, auditArtifactSha256: descriptor.reportSha256, producerScore: descriptor.producerScore, audit: extracted });
    reportBindings.push({ id: descriptor.id, reportSha256: descriptor.reportSha256, reportBytes: bytes.length, softwareVersion: report.softwareVersion, declaredCoordinateSha256: descriptor.coordinateSha256, declaredCoordinateBytes: descriptor.coordinateBytes, receptorChain: descriptor.receptorChain, vhhChain: descriptor.vhhChain, selectedModelId: descriptor.selectedModelId, extractedFeaturesSha256: sha(canonicalJson(extracted)) });
  }
  const rankExport = await exportCurrentProductRanks({ schema: 'confovhh-current-product-rank-input-v1', studyId: manifest.studyId, generators: manifest.generators, attempts: manifest.attempts, features });
  const sourceSha256 = await sourceHashes();
  const auditPolicySha256 = policyJson === null ? null : sha(policyJson);
  const pipelinePolicy = {
    schema: 'confovhh-audit-report-rank-pipeline-policy-v1',
    featureRankMethodPolicySha256: rankExport.method.policySha256,
    auditPolicySha256, sourceSha256,
    extraction: {
      reportValidator: 'validateImportedSingleAuditReport',
      directAuditFields: ['evidenceLevel', 'contactPairCount', 'receptorInterfaceResidues', 'vhhInterfaceResidues', 'halfDeltaSasaInterfaceAreaAngstrom2', 'severeClashCount', 'maximumOverlapAngstrom'],
      imgtNumberingStatus: 'audit.vhhNumbering.status',
      reportBytes: 'Exact declared SHA-256, strict UTF-8 JSON and production schema validation required.',
      sourceIdentity: 'Declared source hash, byte count, chain roles and selected model must match report declarations; source bytes not verified.',
    },
    confidenceRule: 'confidenceMode none; PAE omitted; one identical full auditPolicy across reports',
    frozenV3Compatible: false,
  };
  const comparisonFields = {
    method: { name: 'audit-report-bound-current-product', policySha256: sha(canonicalJson(pipelinePolicy)) },
    baseline: structuredClone(rankExport.baseline),
    generators: structuredClone(rankExport.generators),
    attempts: structuredClone(rankExport.attempts),
    rankings: structuredClone(rankExport.rankings),
  };
  return {
    schema: 'confovhh-audit-report-rank-export-v1', studyId: manifest.studyId, rankExport, comparisonFields,
    provenance: { canonicalManifestSha256: sha(canonicalJson(manifest)), auditPolicy, auditPolicySha256, pipelinePolicy, sourceSha256, reportBindings, reportCount: reportBindings.length, totalReportBytes: totalBytes, sourceScope: 'All top-level lib/*.ts files, package-lock.json, this bridge, the current-product adapter and strict JSON parser; bytes identified, not historical execution authenticated.' },
    claims: { exactReportBytesVerified: true, reportSchemaValidated: true, featuresExtractedFromReports: true, declaredSourceIdentityConsistent: true, originalAuditExecutionVerified: false, coordinateBytesVerified: false, biologicalRolesVerified: false, censusIndependenceCertified: false, prelabelFreezeCertified: false, producerScoreSourcesVerified: false, frozenV3Compatible: false, biologicalValidation: false },
    limitations: [
      'Report hashes bind the supplied bytes and their extracted rank features; hashes do not authenticate a report author, original audit execution or truth of its contents.',
      'Coordinate hashes, byte counts, chain roles and selected models are cross-checked declarations only. No coordinate bytes are opened or re-audited by this bridge.',
      'The production import validator checks report schema and internal consistency; this is not independent verification of geometry or biological receptor/VHH identity.',
      'One identical full geometry-only audit policy is required; absent report strata are preserved in the attempt inventory, not inferred successful.',
      'Producer scores, eligible population, biological roles, grouping, chronology and scientific outcomes require separately authorized evidence and review.',
      'This bridge executes the current-product rank policy only, which differs from the frozen v3 preorder. No predictive accuracy or biological validation is established.',
    ],
  };
}

async function rejectSymlinkAncestors(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'Input path requires real directories without symlinks');
  }
  return absolute;
}

async function boundedFile(path, limit) {
  await rejectSymlinkAncestors(dirname(path));
  const beforeOpen = await lstat(path);
  check(beforeOpen.isFile() && !beforeOpen.isSymbolicLink(), 'Input must be a regular file without symlinks');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.dev === beforeOpen.dev && stat.ino === beforeOpen.ino, 'Input identity changed before bounded read');
    check(stat.isFile() && stat.size > 0 && stat.size <= limit, `Input must be a nonempty regular file no larger than ${limit} bytes`);
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let position = 0;
    while (position < bytes.length) {
      const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    check(position === stat.size, 'Input file size changed during bounded read');
    return bytes.subarray(0, position);
  } finally { await handle.close(); }
}

export async function runAuditReportRankExport(inputPath, reportsDirectory, outputPath) {
  const inputBytes = await boundedFile(resolve(inputPath), MANIFEST_LIMIT);
  const manifest = strictJson(inputBytes, MANIFEST_LIMIT);
  const descriptors = validateManifest(manifest);
  const directory = await rejectSymlinkAncestors(reportsDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const expectedNames = new Set([...descriptors.keys()].map(id => `${id}.json`));
  check(entries.length === expectedNames.size && entries.every(entry => expectedNames.has(entry.name) && entry.isFile() && !entry.isSymbolicLink()), 'Reports directory must contain exactly the declared regular JSON files');
  const reportBytes = new Map();
  let totalBytes = 0;
  for (const id of [...descriptors.keys()].sort(compare)) {
    const bytes = await boundedFile(join(directory, `${id}.json`), REPORT_LIMIT);
    totalBytes += bytes.length;
    check(totalBytes <= TOTAL_LIMIT, 'Reports exceed the combined 64 MB limit');
    reportBytes.set(id, bytes);
  }
  const result = await exportAuditReportRanks(manifest, reportBytes);
  const receipt = { inputSha256: sha(inputBytes), nodeVersion: process.version, result };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 3 && args[0].startsWith('--input=') && args[0].length > 8 && args[1].startsWith('--reports=') && args[1].length > 10 && args[2].startsWith('--output=') && args[2].length > 9, 'Usage: node scripts/paper/export-audit-report-ranks.mjs --input=MANIFEST.json --reports=AUTHORIZED_REPORTS_DIRECTORY --output=NEW_RECEIPT.json');
    const receipt = await runAuditReportRankExport(args[0].slice(8), args[1].slice(10), args[2].slice(9));
    process.stdout.write(`${receipt.result.rankExport.status}; ${receipt.result.provenance.reportCount} report byte records verified; geometry-only current product\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
