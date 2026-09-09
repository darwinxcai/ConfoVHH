import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMglyrDevelopmentFiles, MGLYR_OUTPUT, runMglyrDevelopmentReview, selectMglyrInputs } from '../scripts/hard-decoy-v3/compare-mglyr-development.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = 'validation/hard-decoy-holdout-v3';
const readRows = async relative => (await readFile(path.join(ROOT, BASE, relative), 'utf8')).trimEnd().split('\n').map(JSON.parse);
const parseRows = text => text.trimEnd().split('\n').map(JSON.parse);
const input = async () => ({
  entries: await readRows('annotation-discovery-2026-09-04/entries.jsonl'),
  entityScreens: await readRows('annotation-screen-2026-09-04/entity-screens.jsonl'),
  sequenceScreens: await readRows('annotation-screen-2026-09-04/sequence-screens.jsonl'),
  sourceReview: JSON.parse(await readFile(path.join(ROOT, BASE, 'annotation-priority-review-2026-09-04/source-reviews.json'), 'utf8')),
});

test('saved mGlyR comparison replays all distinct candidate/development pairs with no scientific promotion', async () => {
  const summary = await runMglyrDevelopmentReview('verify');
  assert.equal(summary.sourceEntryCount, 2);
  assert.equal(summary.sourcePolymerEntityCount, 6);
  assert.equal(summary.reproducedDevelopmentVhhProfileCount, 18);
  assert.equal(summary.entityDevelopmentVhhPairCount, 36);
  assert.equal(summary.domainDevelopmentVhhPairCount, 18);
  assert.equal(summary.unresolvedDomainProfileCount, 0);
  assert.equal(summary.positiveVhhEntityCount, 0);
  assert.equal(summary.independentlyEligibleGroupsAdded, 0);
  for (const key of ['formalNoEdgeAuthority', 'formalLeakageEdgeAuthority', 'formalExclusionAuthority', 'targetFreezePermitted', 'independenceCertified', 'predictionAccuracyMeasured']) assert.equal(summary[key], false, key);
  assert.equal(summary.previousExposureCaveatsRemainActive, true);
  const matrix = await readRows(`${path.basename(MGLYR_OUTPUT)}/entity-development-vhh-matrix.jsonl`);
  assert.equal(new Set(matrix.map(row => row.pairId)).size, 36);
  for (const entityKey of ['9VOR_2', '9VOS_4']) assert.equal(matrix.filter(row => row.entityKey === entityKey).length, 18);
});

test('absent GPCRdb canonical profile stays unresolved in every receptor pair, never a negative match', async () => {
  const { files } = await buildMglyrDevelopmentFiles();
  const matrix = parseRows(files.get('entry-development-receptor-matrix.jsonl'));
  assert.equal(matrix.length, 34);
  assert.equal(new Set(matrix.map(row => row.pairId)).size, 34);
  for (const row of matrix) {
    assert.equal(row.status, 'NO_RECOGNIZED_CANONICAL_PROFILE_UNRESOLVED');
    assert.deepEqual(row.alternatives, []);
    assert.equal(row.formalNoEdgeAuthority, false);
  }
  const calls = parseRows(files.get('domain-calls.jsonl'));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.start, 21);
    assert.equal(call.end, 142);
    assert.equal(call.prefixLength, 21);
    assert.equal(call.suffixLength, 8);
  }
});

test('selection rejects missing/duplicate entries, polymer inventories and source deposition links', async () => {
  const original = await input();
  assert.equal(selectMglyrInputs(original).entityScreens.length, 6);
  const mutations = [
    x => { x.entries = x.entries.filter(row => row.pdbId !== '9VOS'); },
    x => { x.entries.push(x.entries.find(row => row.pdbId === '9VOR')); },
    x => { x.entries.find(row => row.pdbId === '9VOR').polymerEntities.pop(); },
    x => { x.sourceReview.reviews.find(row => row.pdbId === '9VOR').depositionLinkage.pdbIdExplicitlyNamed = false; },
    x => { x.sourceReview.reviews.find(row => row.pdbId === '9VOR').allFrozenPolymerEntities[0].sequenceSha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => selectMglyrInputs(changed));
  }
});

test('selection rejects substituted sequence bytes and duplicate or missing screen identities', async () => {
  const original = await input();
  const mutations = [
    x => { x.entries.find(row => row.pdbId === '9VOR').polymerEntities[1].sequence += 'A'; },
    x => { x.entityScreens = x.entityScreens.filter(row => !(row.pdbId === '9VOR' && row.entityId === '2')); },
    x => {
      const row = x.entityScreens.find(row => row.pdbId === '9VOR' && row.entityId === '2');
      Object.assign(row, x.entityScreens.find(row => row.pdbId === '9VOR' && row.entityId === '1'));
    },
    x => { x.sequenceScreens = x.sequenceScreens.filter(row => row.sequenceSha256 !== '4d18b2d2954bc60334d58cb9ef20a8bc36c3de841fdaa85074c4a0876775abbc'); },
    x => {
      const digest = x.entries.find(row => row.pdbId === '9VOR').polymerEntities[0].sequenceSha256;
      const existing = x.sequenceScreens.find(row => row.sequenceSha256 === digest);
      const nb20 = x.sequenceScreens.find(row => row.sequenceSha256 === '4d18b2d2954bc60334d58cb9ef20a8bc36c3de841fdaa85074c4a0876775abbc');
      Object.assign(existing, nb20);
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => selectMglyrInputs(changed));
  }
});

test('packet verification rejects removed comparison rows and unaccounted extra files; collection does not overwrite', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'confovhh-mglyr-replay-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const outputDirectory = path.join(temp, 'packet');
  await cp(path.join(ROOT, MGLYR_OUTPUT), outputDirectory, { recursive: true });
  await assert.rejects(runMglyrDevelopmentReview('collect', { outputDirectory }), /empty new directory/);
  const filename = path.join(outputDirectory, 'entity-development-vhh-matrix.jsonl');
  const original = await readFile(filename, 'utf8');
  await writeFile(filename, original.split('\n').slice(1).join('\n'));
  await assert.rejects(runMglyrDevelopmentReview('verify', { outputDirectory }), /Offline replay mismatch/);
  await writeFile(filename, original);
  await writeFile(path.join(outputDirectory, 'unaccounted.json'), '{}\n');
  await assert.rejects(runMglyrDevelopmentReview('verify', { outputDirectory }), /Output inventory changed/);
});

test('input hash drift, missing data and symlinked metadata fail before any scientific computation', async t => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'confovhh-mglyr-input-'));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const relative = `${BASE}/annotation-discovery-2026-09-04/entries.jsonl`;
  const filename = path.join(repositoryRoot, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await assert.rejects(buildMglyrDevelopmentFiles({ repositoryRoot }), /ENOENT/);
  await writeFile(filename, '{}\n');
  await assert.rejects(buildMglyrDevelopmentFiles({ repositoryRoot }), /Pinned input changed/);
  await rm(filename);
  await symlink(path.join(ROOT, relative), filename);
  await assert.rejects(buildMglyrDevelopmentFiles({ repositoryRoot }), /Symlink input forbidden/);
});
