import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_PATH, validateMglyrSourceBundle, verifyMglyrSourceResolution } from '../scripts/hard-decoy-v3/verify-mglyr-source-resolution.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async name => JSON.parse(await readFile(path.join(ROOT, BUNDLE_PATH, name), 'utf8'));
async function bundle() {
  return { blocks: await read('source-blocks.json'), provenance: await read('source-provenance.json'), attempts: await read('retrieval-attempts.json'), review: await read('source-review.json') };
}
async function copyEvidence() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'confovhh-mglyr-source-'));
  const review = await read('source-review.json');
  const names = ['source-blocks.json', 'source-provenance.json', 'retrieval-attempts.json', 'source-review.json', 'checksums.sha256'].map(n => `${BUNDLE_PATH}/${n}`);
  for (const filename of [...names, ...Object.keys(review.priorInputSha256)]) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await copyFile(path.join(ROOT, filename), path.join(root, filename));
  }
  return root;
}

test('retained Methods replay preserves source attribution and zero scientific authority', async () => {
  assert.deepEqual(await verifyMglyrSourceResolution(), {
    status: 'SOURCE_INTEGRITY_VERIFIED', selectedMethodsParagraphs: 5,
    sourceReportedDiscoveryRouteEstablished: true, exactCryoEmConstructsReconciled: 0,
    independentEligibleGroupsAdded: 0, targetFreezePermitted: false,
    scientificIndependenceCertified: false,
  });
});

test('a result paragraph cannot be added to the preparation allowlist', async () => {
  const value = await bundle();
  value.blocks.paragraphs.push({ ...value.blocks.paragraphs[0], id: 'Results.p0', sectionId: 'Results' });
  assert.throws(() => validateMglyrSourceBundle(value), /inventory drift/u);
});

test('changing paragraph wording and recomputing its supplied hash still fails the pinned selector', async () => {
  const value = await bundle();
  const paragraph = value.blocks.paragraphs[0];
  paragraph.text = 'Synthetic replacement claiming complete ancestry clearance.';
  paragraph.textSha256 = createHash('sha256').update(paragraph.text).digest('hex');
  assert.throws(() => validateMglyrSourceBundle(value), /inventory drift/u);
});

test('the reported immune origin cannot become cryo-EM construct or independence clearance', async () => {
  for (const [key, replacement] of [
    ['exactCryoEmReceptorConstructEstablished', true], ['exactCryoEmNb20TagEstablished', true],
    ['completeBinderAncestryAdjudicated', true], ['independenceCertified', true],
    ['targetFreezePermitted', true], ['newIndependentEligibleGroups', 1],
  ]) {
    const value = await bundle(); value.review.resolution[key] = replacement;
    assert.throws(() => validateMglyrSourceBundle(value), /cannot acquire/u);
  }
});

test('a source fact cannot be reassigned to an unrelated preparation paragraph', async () => {
  const value = await bundle();
  value.review.evidence.find(f => f.id === 'immune-origin').paragraphIds = ['Sec15.p0'];
  assert.throws(() => validateMglyrSourceBundle(value), /mapping drift/u);
});

test('supplement PDF provenance cannot be replaced by a successful HTTP response containing HTML', async () => {
  const value = await bundle();
  const request = value.attempts.requests.find(r => r.name === value.attempts.supplement2026.apiRequestName);
  request.isZip = false;
  assert.throws(() => validateMglyrSourceBundle(value));
});

test('changed prior construct evidence is detected without opening unrelated inputs', async () => {
  const root = await copyEvidence();
  try {
    const review = await read('source-review.json');
    const filename = Object.keys(review.priorInputSha256)[0];
    await writeFile(path.join(root, filename), '{}\n');
    await assert.rejects(verifyMglyrSourceResolution(root), /immutable prior evidence changed/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a symlink cannot redirect a retained paragraph file', async () => {
  const root = await copyEvidence();
  try {
    const target = path.join(root, BUNDLE_PATH, 'source-blocks.json');
    await unlink(target);
    await symlink(path.join(ROOT, BUNDLE_PATH, 'source-blocks.json'), target);
    await assert.rejects(verifyMglyrSourceResolution(root), /bounded regular file/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('checksum inventory rejects an unapproved file before opening it', async () => {
  const root = await copyEvidence();
  try {
    const manifest = path.join(root, BUNDLE_PATH, 'checksums.sha256');
    await writeFile(manifest, `${await readFile(manifest, 'utf8')}${'0'.repeat(64)}  unauthorized-results.json\n`);
    await assert.rejects(verifyMglyrSourceResolution(root), /Unexpected checksum file inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('review wording, source locators, supplement identity and prior pins cannot be rewritten', async () => {
  const mutate = [
    value => { value.review.evidence[0].statement = 'Invented statement claiming complete ancestry clearance.'; },
    value => { value.review.interpretations[0].statement = 'Invented interpretation claiming an eligible independent case.'; },
    value => { value.blocks.sourceUrl = value.provenance.response.url = 'https://example.invalid/unrelated-source'; },
    value => { value.attempts.supplement2026.selectedMember = 'unrelated-document.pdf'; },
    value => { value.review.priorInputSha256[Object.keys(value.review.priorInputSha256)[0]] = '0'.repeat(64); },
  ];
  for (const change of mutate) {
    const value = await bundle(); change(value);
    assert.throws(() => validateMglyrSourceBundle(value), /reviewed payload identity changed/u);
  }
});

test('rewriting both narrative and local checksum still fails the fixed reviewed identity', async () => {
  const root = await copyEvidence();
  try {
    const filename = path.join(root, BUNDLE_PATH, 'source-review.json');
    const review = JSON.parse(await readFile(filename, 'utf8'));
    review.evidence[0].statement = 'Synthetic forged source claim.';
    const bytes = JSON.stringify(review, null, 2) + '\n';
    await writeFile(filename, bytes);
    const manifest = path.join(root, BUNDLE_PATH, 'checksums.sha256');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await writeFile(manifest, (await readFile(manifest, 'utf8')).replace(/^[a-f0-9]{64}  source-review\.json$/mu, `${checksum}  source-review.json`));
    await assert.rejects(verifyMglyrSourceResolution(root), /reviewed payload identity changed/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
