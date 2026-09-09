import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HISTORICAL_SOURCE_INDEX_SHA256, validateSourceArchiveIndex, verifySourceArchiveObjects, verifyHistoricalSourceArchive, writeHistoricalSourceReceipt } from '../scripts/paper/verify-historical-source-archive.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARCHIVE = path.join(ROOT, 'validation/v0.5-engine-implementation-snapshot-v1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
const sourceBytes = Buffer.from('// synthetic source fixture; never executed\n');
const sourceDigest = sha(sourceBytes);
const excludedDigest = 'e'.repeat(64);

function indexFixture() {
  const attestation = (summary, files) => ({ summary, summarySha256: 'a'.repeat(64), sourceCommit: 'b'.repeat(40), implementationCombinedSha256: 'c'.repeat(64), files });
  return {
    schemaVersion: '1.0.0', status: 'frozen-supplemental-source-snapshot', purpose: 'Synthetic metadata boundary test', currentProductDependencyEnvironmentMatchesAttestedV05: false,
    attestations: {
      'public-regression': attestation('validation/synthetic-public/summary.json', { 'lib/synthetic.ts': sourceDigest, 'validation/mmcif-regression-manifest.v1.json': excludedDigest }),
      'dockq-regression-replay': attestation('validation/synthetic-replay/summary.json', { 'scripts/synthetic.mjs': sourceDigest, 'validation/dockq-development-pilot-v1/source-manifest.json': excludedDigest }),
    },
    executedDependencies: { synthetic: { objectsMustNotBeRead: true } },
  };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'confovhh-source-only-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'objects'));
  await writeFile(path.join(root, 'objects', sourceDigest), sourceBytes);
  // An unreadable/missing excluded target would fail any attempted byte access.
  await symlink(path.join(root, 'MUST-NOT-BE-OPENED'), path.join(root, 'objects', excludedDigest));
  const index = indexFixture();
  await writeFile(path.join(root, 'index.json'), jsonBytes(index));
  return { root, index, plan: validateSourceArchiveIndex(jsonBytes(index)) };
}

test('source-only verification retains exact mappings, duplicate counts and exclusions without accessing excluded objects', async t => {
  const { root, plan } = await fixture(t);
  const result = await verifySourceArchiveObjects(root, plan);
  assert.equal(result.sourceReferenceCount, 2);
  assert.equal(result.uniqueSourceObjectCount, 1);
  assert.equal(result.duplicateSourceReferenceCount, 1);
  assert.equal(result.uniqueSourceBytes, sourceBytes.length);
  assert.deepEqual(result.attestations.map(row => row.sources[0].logicalPath), ['lib/synthetic.ts', 'scripts/synthetic.mjs']);
  assert.ok(result.attestations.every(row => !row.combinedImplementationHashVerified && row.excludedMetadata.every(item => item.accessed === false)));
});

test('pinned entrypoint rejects an otherwise valid synthetic index and altered real index bytes', async t => {
  const { root } = await fixture(t);
  await assert.rejects(verifyHistoricalSourceArchive({ archiveRoot: root }), /Pinned historical source index/);
  const original = await readFile(path.join(ARCHIVE, 'index.json'));
  assert.equal(sha(original), HISTORICAL_SOURCE_INDEX_SHA256);
  await writeFile(path.join(root, 'index.json'), Buffer.concat([original, Buffer.from(' ')]));
  await assert.rejects(verifyHistoricalSourceArchive({ archiveRoot: root }), /Pinned historical source index/);
});

test('strict metadata parsing rejects duplicate keys, invalid UTF-8 and excessive bytes', () => {
  assert.throws(() => validateSourceArchiveIndex(Buffer.from('{"schemaVersion":"1","schemaVersion":"2"}')), /duplicate/i);
  assert.throws(() => validateSourceArchiveIndex(Buffer.from([0xff])), /encoded data|encoding/i);
  assert.throws(() => validateSourceArchiveIndex(Buffer.alloc(256 * 1024 + 1)), /byte limit/);
});

test('logical traversal, non-source paths and noncanonical digest references fail before object access', () => {
  for (const logical of ['lib/../secret.ts', 'lib//x.ts', '/lib/x.ts', 'lib/./x.ts', 'lib/x.pdb', 'validation/outcomes.json', 'scripts/native.cif']) {
    const index = indexFixture();
    index.attestations['public-regression'].files = { [logical]: sourceDigest };
    assert.throws(() => validateSourceArchiveIndex(jsonBytes(index)), /path|inventory|traversal/i);
  }
  for (const reference of ['../outside', sourceDigest.toUpperCase(), `${sourceDigest}/extra`, `objects/${sourceDigest}`, null, { sha256: sourceDigest }]) {
    const index = indexFixture();
    index.attestations['public-regression'].files['lib/synthetic.ts'] = reference;
    assert.throws(() => validateSourceArchiveIndex(jsonBytes(index)), /digest|match|string/i);
  }
});

test('missing, truncated and same-size tampered source objects fail closed', async t => {
  const { root, plan } = await fixture(t);
  const filename = path.join(root, 'objects', sourceDigest);
  await rm(filename);
  await assert.rejects(verifySourceArchiveObjects(root, plan), /ENOENT/);
  await writeFile(filename, sourceBytes.subarray(0, sourceBytes.length - 1));
  await assert.rejects(verifySourceArchiveObjects(root, plan), /SHA-256 mismatch/);
  await writeFile(filename, Buffer.alloc(sourceBytes.length, 65));
  await assert.rejects(verifySourceArchiveObjects(root, plan), /SHA-256 mismatch/);
});

test('lower-level plans reject forged authority and malformed declarations without echoing claims', async t => {
  const { root, plan } = await fixture(t);
  for (const mutate of [
    value => { value[0].combinedImplementationHashVerified = true; },
    value => { value[0].scientificAuthority = true; },
    value => { value[0].declaredSourceCommit = '../commit'; },
    value => { value[0].declaredCombinedImplementationSha256 = 'not-a-digest'; },
    value => { value[0].excludedMetadata[0].accessed = true; },
    value => { value[0].excludedMetadata[0].objectPath = 'objects/../secret'; },
    value => { value[0].excludedMetadata[0].logicalPath = 'validation/unknown.json'; },
    value => { value[0].excludedMetadata[0].scientificAuthority = true; },
  ]) {
    const forged = structuredClone(plan);
    mutate(forged);
    await assert.rejects(verifySourceArchiveObjects(root, forged));
  }
  const result = await verifySourceArchiveObjects(root, plan);
  assert.ok(result.attestations.every(row => row.combinedImplementationHashVerified === false && !Object.hasOwn(row, 'scientificAuthority')));
});

test('source symlinks, directory symlinks and noncanonical object paths are rejected', async t => {
  const { root, plan } = await fixture(t);
  const altered = structuredClone(plan);
  altered[0].sources[0].objectPath = `objects/../${sourceDigest}`;
  await assert.rejects(verifySourceArchiveObjects(root, altered), /Noncanonical object path/);
  const objectPath = path.join(root, 'objects', sourceDigest);
  await rm(objectPath);
  await writeFile(path.join(root, 'actual-source'), sourceBytes);
  await symlink(path.join(root, 'actual-source'), objectPath);
  await assert.rejects(verifySourceArchiveObjects(root, plan), /symlinks forbidden/);
  const alias = `${root}-alias`;
  t.after(() => rm(alias, { force: true }));
  await symlink(root, alias, 'dir');
  await assert.rejects(verifySourceArchiveObjects(alias, plan), /Symlink directory/);
});

test('retained pinned archive and saved capture replay source bytes only with restricted authority', async () => {
  const result = await verifyHistoricalSourceArchive();
  assert.equal(result.sourceReferenceCount, 29);
  assert.equal(result.excludedMetadataReferenceCount, 3);
  assert.equal(result.sourceReferenceCount, result.uniqueSourceObjectCount + result.duplicateSourceReferenceCount);
  assert.ok(Object.values(result.boundaries).every(value => value === false));
  assert.ok(result.attestations.every(row => row.combinedImplementationHashVerified === false));
  const receipt = JSON.parse(await readFile(path.join(ROOT, 'paper/evidence/historical-source-recovery-2026-09-08/receipt.json'), 'utf8'));
  assert.deepEqual(receipt.result, result);
  for (const [relative, digest] of Object.entries(receipt.sourceSha256)) {
    assert.ok(['scripts/paper/verify-historical-source-archive.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs'].includes(relative));
    assert.equal(sha(await readFile(path.join(ROOT, relative))), digest);
  }
  assert.equal(Object.keys(receipt.sourceSha256).length, 2);
});

test('receipt output is new-file-only and CLI rejects duplicate and unknown options', async t => {
  const { root } = await fixture(t);
  const output = path.join(root, 'receipt.json');
  await writeHistoricalSourceReceipt(output);
  const original = await readFile(output);
  await assert.rejects(writeHistoricalSourceReceipt(output), /EEXIST/);
  assert.deepEqual(await readFile(output), original);
  for (const args of [[], ['--output=x', '--output=y'], ['--output=x', '--network=true']]) {
    const result = spawnSync(process.execPath, ['scripts/paper/verify-historical-source-archive.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Required|Expected unique/);
  }
});
