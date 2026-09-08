// Source bytes only. Never imports/executes archived files or reads result objects.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HISTORICAL_SOURCE_INDEX_SHA256 = 'd98f7766e660248d03771e3678bec5bfaf33da2072d45e034eb2e0596bf3b1e5';
const ARCHIVE = 'validation/v0.5-engine-implementation-snapshot-v1';
const ATTESTATIONS = ['public-regression', 'dockq-regression-replay'];
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SOURCE = /^(?:(?:lib\/[A-Za-z0-9_./-]+\.ts)|(?:scripts\/[A-Za-z0-9_./-]+\.(?:mjs|py))|package(?:-lock)?\.json)$/u;
const EXCLUDED = new Set([
  'validation/mmcif-regression-manifest.v1.json',
  'validation/dockq-development-pilot-v1/pilot-spec.json',
  'validation/dockq-development-pilot-v1/source-manifest.json',
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function exactKeys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unexpected keys`);
}
function safePath(value) {
  assert.ok(typeof value === 'string' && value.length <= 240 && /^[A-Za-z0-9_.\/-]+$/u.test(value), 'Invalid logical path');
  assert.ok(value.split('/').every(part => part && part !== '.' && part !== '..'), 'Noncanonical logical path or traversal');
  assert.equal(path.posix.normalize(value), value, 'Noncanonical logical path');
}

/** Pure structural validation; this function alone does not verify the pinned index. */
export function validateSourceArchiveIndex(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength <= 256 * 1024, 'Index exceeds byte limit');
  const index = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 256 * 1024, maximumTokens: 20000, maximumDepth: 12 });
  exactKeys(index, ['schemaVersion', 'status', 'purpose', 'currentProductDependencyEnvironmentMatchesAttestedV05', 'attestations', 'executedDependencies'], 'index');
  assert.equal(index.schemaVersion, '1.0.0');
  assert.equal(index.status, 'frozen-supplemental-source-snapshot');
  assert.equal(index.currentProductDependencyEnvironmentMatchesAttestedV05, false);
  assert.ok(typeof index.purpose === 'string');
  exactKeys(index.attestations, ATTESTATIONS, 'attestations');
  const plan = [];
  for (const id of ATTESTATIONS) {
    const attestation = index.attestations[id];
    exactKeys(attestation, ['summary', 'summarySha256', 'sourceCommit', 'implementationCombinedSha256', 'files'], id);
    safePath(attestation.summary);
    assert.ok(attestation.summary.startsWith('validation/') && attestation.summary.endsWith('/summary.json'));
    assert.match(attestation.summarySha256, SHA256);
    assert.match(attestation.sourceCommit, COMMIT);
    assert.match(attestation.implementationCombinedSha256, SHA256);
    assert.ok(attestation.files && typeof attestation.files === 'object' && !Array.isArray(attestation.files));
    assert.ok(Object.keys(attestation.files).length > 0 && Object.keys(attestation.files).length <= 100);
    const sources = [];
    const excludedMetadata = [];
    for (const [logicalPath, digest] of Object.entries(attestation.files).sort(([a], [b]) => compare(a, b))) {
      safePath(logicalPath);
      assert.match(digest, SHA256, 'Noncanonical object digest reference');
      assert.ok(SOURCE.test(logicalPath) || EXCLUDED.has(logicalPath), 'Logical path is outside source/explicit metadata inventory');
      const row = { logicalPath, sha256: digest, objectPath: `objects/${digest}` };
      if (EXCLUDED.has(logicalPath)) excludedMetadata.push({ ...row, accessed: false });
      else sources.push(row);
    }
    assert.ok(sources.length > 0);
    plan.push({ id, declaredSourceCommit: attestation.sourceCommit, declaredCombinedImplementationSha256: attestation.implementationCombinedSha256, combinedImplementationHashVerified: false, sources, excludedMetadata });
  }
  return plan;
}

async function directDirectory(directory) {
  const absolute = path.resolve(directory);
  assert.equal(await realpath(absolute), absolute, 'Symlink directory path forbidden');
  const info = await lstat(absolute);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Direct directory required');
  return absolute;
}

async function boundedDirectBytes(filename, maximumBytes) {
  const parent = await directDirectory(path.dirname(filename));
  const absolute = path.join(parent, path.basename(filename));
  const before = await lstat(absolute);
  assert.ok(before.isFile() && !before.isSymbolicLink(), 'Direct regular file required; symlinks forbidden');
  assert.ok(before.size > 0 && before.size <= maximumBytes, 'File byte limit exceeded');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    assert.equal(opened.ino, before.ino, 'File identity changed');
    assert.equal(opened.dev, before.dev, 'File device changed');
    assert.equal(opened.size, before.size, 'File byte size changed');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    assert.equal(length, before.size, 'File byte count mismatch');
    const after = await handle.stat();
    assert.equal(after.size, before.size, 'File byte size changed');
    assert.equal(after.mtimeMs, before.mtimeMs, 'File changed during reading');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

/** Lower-level byte check for a structurally validated plan; no execution authority. */
export async function verifySourceArchiveObjects(archiveRoot, validatedPlan) {
  const plan = structuredClone(validatedPlan);
  const archive = await directDirectory(archiveRoot);
  await directDirectory(path.join(archive, 'objects'));
  assert.ok(Array.isArray(plan) && plan.length === 2);
  assert.deepEqual(plan.map(row => row.id), ATTESTATIONS);
  const verified = new Map();
  const attestations = [];
  for (const attestation of plan) {
    exactKeys(attestation, ['id', 'declaredSourceCommit', 'declaredCombinedImplementationSha256', 'combinedImplementationHashVerified', 'sources', 'excludedMetadata'], 'attestation plan');
    assert.match(attestation.declaredSourceCommit, COMMIT);
    assert.match(attestation.declaredCombinedImplementationSha256, SHA256);
    assert.equal(attestation.combinedImplementationHashVerified, false, 'Combined implementation hash must remain unverified');
    assert.ok(Array.isArray(attestation.excludedMetadata) && attestation.excludedMetadata.length <= EXCLUDED.size);
    const excludedPaths = new Set();
    const excludedMetadata = [];
    for (const excluded of attestation.excludedMetadata) {
      exactKeys(excluded, ['logicalPath', 'sha256', 'objectPath', 'accessed'], 'excluded metadata reference');
      safePath(excluded.logicalPath);
      assert.ok(EXCLUDED.has(excluded.logicalPath), 'Unknown excluded metadata path');
      assert.ok(!excludedPaths.has(excluded.logicalPath), 'Duplicate excluded metadata reference');
      excludedPaths.add(excluded.logicalPath);
      assert.match(excluded.sha256, SHA256, 'Noncanonical excluded digest reference');
      assert.equal(excluded.objectPath, `objects/${excluded.sha256}`, 'Noncanonical excluded object path');
      assert.equal(excluded.accessed, false, 'Excluded metadata must remain unaccessed');
      excludedMetadata.push({ logicalPath: excluded.logicalPath, sha256: excluded.sha256, objectPath: excluded.objectPath, accessed: false });
    }
    assert.ok(Array.isArray(attestation.sources) && attestation.sources.length > 0 && attestation.sources.length <= 100);
    const sources = [];
    const logicalPaths = new Set();
    for (const source of attestation.sources) {
      exactKeys(source, ['logicalPath', 'sha256', 'objectPath'], 'source reference');
      safePath(source.logicalPath);
      assert.ok(SOURCE.test(source.logicalPath) && !EXCLUDED.has(source.logicalPath), 'Only allowlisted sources may be read');
      assert.ok(!logicalPaths.has(source.logicalPath), 'Duplicate logical source reference');
      logicalPaths.add(source.logicalPath);
      assert.match(source.sha256, SHA256, 'Noncanonical object digest reference');
      assert.equal(source.objectPath, `objects/${source.sha256}`, 'Noncanonical object path');
      if (!verified.has(source.sha256)) {
        const bytes = await boundedDirectBytes(path.join(archive, source.objectPath), 16 * 1024 * 1024);
        assert.equal(sha(bytes), source.sha256, `Source object SHA-256 mismatch: ${source.logicalPath}`);
        verified.set(source.sha256, bytes.length);
      }
      sources.push({ ...source, bytes: verified.get(source.sha256), sha256Verified: true });
    }
    attestations.push({
      id: attestation.id,
      declaredSourceCommit: attestation.declaredSourceCommit,
      declaredCombinedImplementationSha256: attestation.declaredCombinedImplementationSha256,
      combinedImplementationHashVerified: false,
      sources,
      excludedMetadata,
    });
  }
  const sourceReferenceCount = attestations.reduce((sum, row) => sum + row.sources.length, 0);
  return { attestations, sourceReferenceCount, uniqueSourceObjectCount: verified.size, duplicateSourceReferenceCount: sourceReferenceCount - verified.size, uniqueSourceBytes: [...verified.values()].reduce((a, b) => a + b, 0) };
}

export async function verifyHistoricalSourceArchive({ archiveRoot = path.join(ROOT, ARCHIVE) } = {}) {
  const archive = await directDirectory(archiveRoot);
  const indexBytes = await boundedDirectBytes(path.join(archive, 'index.json'), 256 * 1024);
  assert.equal(sha(indexBytes), HISTORICAL_SOURCE_INDEX_SHA256, 'Pinned historical source index SHA-256 mismatch');
  const plan = validateSourceArchiveIndex(indexBytes);
  const verified = await verifySourceArchiveObjects(archive, plan);
  return {
    schema: 'confovhh-historical-source-only-verification-v1',
    status: 'PINNED_SOURCE_OBJECTS_VERIFIED',
    archiveLogicalPath: ARCHIVE,
    indexSha256: HISTORICAL_SOURCE_INDEX_SHA256,
    exactPinnedIndexVerified: true,
    ...verified,
    excludedMetadataReferenceCount: plan.reduce((sum, row) => sum + row.excludedMetadata.length, 0),
    boundaries: { fullClosureVerified: false, exactFrozenCommitTreeEquivalenceEstablished: false, executionVerified: false, scientificAuthority: false, archivedSourcesExecuted: false, excludedMetadataObjectsAccessed: false, dependencyObjectsAccessed: false, historicalSummaryFilesAccessed: false, networkUsed: false },
    limitations: [
      'Verifies only allowlisted source object bytes bound by the pinned archive index; declared combined implementation hashes include excluded metadata and are not recomputed.',
      'Recorded source commits are declarations. No equivalence to the frozen v3 commit 04c6bda2289157dd294c290609f6052aa0ef9195 or tree 1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9 is established.',
      'Executed-dependency metadata in the pinned index is not independently validated; dependency objects, historical summaries and excluded validation metadata objects are not read.',
      'Source byte availability does not establish historical execution, rank policy equivalence, candidate eligibility, independence or predictive performance.',
    ],
  };
}

export async function writeHistoricalSourceReceipt(outputPath, options = {}) {
  const result = await verifyHistoricalSourceArchive(options);
  const sourceSha256 = {};
  for (const relative of ['scripts/paper/verify-historical-source-archive.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs']) {
    sourceSha256[relative] = sha(await boundedDirectBytes(path.join(ROOT, relative), 1024 * 1024));
  }
  const receipt = { capturedAt: new Date().toISOString(), nodeVersion: process.version, sourceSha256, result };
  const absolute = path.resolve(outputPath);
  await directDirectory(path.dirname(absolute));
  await writeFile(absolute, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      const match = /^--(archive|output)=(.+)$/u.exec(arg);
      assert.ok(match && !Object.hasOwn(options, match[1]), 'Expected unique --output=NEW.json and optional --archive=DIRECTORY');
      options[match[1]] = match[2];
    }
    assert.ok(options.output, 'Required --output=NEW.json');
    const receipt = await writeHistoricalSourceReceipt(options.output, options.archive ? { archiveRoot: options.archive } : {});
    process.stdout.write(`${receipt.result.sourceReferenceCount} source references; ${receipt.result.uniqueSourceObjectCount} unique objects verified; complete closure and frozen-tree equivalence remain unverified\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
