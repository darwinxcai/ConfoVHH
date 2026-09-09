import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMglyrReceptorFiles, extractVerifiedMglyr, MGLYR_CANONICAL_PACKET, runMglyrReceptorReview } from '../scripts/hard-decoy-v3/review-mglyr-receptor.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACKET = path.join(ROOT, MGLYR_CANONICAL_PACKET);
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const inputs = async () => ({
  protein: await json(path.join(PACKET, 'sources/protein-1-attempt-1.body')),
  residues: await json(path.join(PACKET, 'sources/residues-1-attempt-1.body')),
  uniprot: await json(path.join(ROOT, 'validation/hard-decoy-holdout-v3/annotation-priority-review-2026-09-04/raw/uniprot-q5t848-transmembrane.json')),
});
async function copyPacket(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'confovhh-mglyr-canonical-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'packet');
  await cp(PACKET, directory, { recursive: true });
  return directory;
}

test('new canonical packet reproduces complete repeated sequence, frozen TM extraction and all34 receptor pair rows', async () => {
  const summary = await runMglyrReceptorReview('verify');
  assert.equal(summary.canonicalLength, 1215);
  assert.equal(summary.tmLength, 208);
  assert.equal(summary.uniqueDevelopmentPairCount, 17);
  assert.equal(summary.entryDevelopmentPairCount, 34);
  assert.equal(summary.polymerCount, 6);
  assert.equal(summary.priorMissingReceptorProfileGapClosed, true);
  assert.deepEqual(summary.positiveDevelopmentNodes, []);
  assert.deepEqual(summary.sensitivityVetoDevelopmentNodes, []);
  for (const key of ['formalNoEdgeAuthority', 'formalLeakageEdgeAuthority', 'formalEligibilityAuthority', 'formalExclusionAuthority', 'targetFreezePermitted', 'predictionAccuracyMeasured', 'exposureClearanceGranted']) assert.equal(summary[key], false, key);
  assert.equal(summary.newIndependentComponents, 0);
  const pairs = await json(path.join(PACKET, 'entry-development-pairs.json'));
  assert.equal(new Set(pairs.map(row => row.pairId)).size, 34);
  for (const pdbId of ['9VOR', '9VOS']) assert.equal(pairs.filter(row => row.pdbId === pdbId).length, 17);
});

test('canonical identity checks reject wrong receptor, organism, source and independent sequence', async () => {
  const original = await inputs();
  const mutations = [
    x => { x.protein.accession = 'Q13258'; },
    x => { x.protein.entry_name = 'gp158_mouse'; },
    x => { x.protein.species = 'Mus musculus'; },
    x => { x.protein.source = 'TREMBL'; },
    x => { x.uniprot.organism.taxonId = 10090; },
    x => { x.uniprot.sequence.value += 'A'; },
    x => { x.protein.family = '001_001_001_001'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => extractVerifiedMglyr(changed.protein, changed.residues, changed.uniprot));
  }
});

test('canonical extraction rejects missing or duplicate positions, wrong aminoacids and absent TM segments', async () => {
  const original = await inputs();
  const mutations = [
    x => { x.residues.pop(); },
    x => { x.residues[0].sequence_number = x.residues[1].sequence_number; },
    x => { x.residues[0].amino_acid = x.residues[0].amino_acid === 'A' ? 'G' : 'A'; },
    x => { for (const row of x.residues) if (row.protein_segment === 'TM7') row.protein_segment = 'C-term'; },
    x => {
      const tm = x.residues.filter(row => row.protein_segment === 'TM1');
      tm[Math.floor(tm.length / 2)].protein_segment = 'ICL1';
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => extractVerifiedMglyr(changed.protein, changed.residues, changed.uniprot));
  }
});

test('repeated full canonical payloads must agree even if derived TM sequences are unchanged', async t => {
  const directory = await copyPacket(t);
  const stem = path.join(directory, 'sources/residues-2-attempt-1');
  const residues = await json(`${stem}.body`);
  residues[0].extraAnnotation = 'synthetic-repeat-disagreement';
  const body = Buffer.from(JSON.stringify(residues));
  const record = await json(`${stem}.json`);
  record.bytes = body.length; record.sha256 = createHash('sha256').update(body).digest('hex');
  await writeFile(`${stem}.body`, body); await writeFile(`${stem}.json`, `${JSON.stringify(record)}\n`);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Repeated canonical residue captures disagree/);
});

test('capture provenance rejects substituted endpoint URLs and raw byte drift', async t => {
  const directory = await copyPacket(t);
  const metadata = path.join(directory, 'sources/protein-1-attempt-1.json');
  const original = await readFile(metadata), record = JSON.parse(original);
  record.url = 'https://gpcrdb.org/services/protein/accession/Q13258/';
  await writeFile(metadata, `${JSON.stringify(record)}\n`);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Capture URL mismatch/);
  await writeFile(metadata, original);
  await writeFile(path.join(directory, 'sources/protein-1-attempt-1.body'), '{}\n');
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Capture body hash mismatch/);
});

test('relocated packet replays offline, rejects extra/missing outputs and refuses collection overwrite', async t => {
  const directory = await copyPacket(t);
  await runMglyrReceptorReview('verify', { directory });
  await assert.rejects(runMglyrReceptorReview('collect', { directory }), /EEXIST/);
  await writeFile(path.join(directory, 'unaccounted.json'), '{}\n');
  await assert.rejects(runMglyrReceptorReview('verify', { directory }), /Unexpected packet member/);
  await rm(path.join(directory, 'unaccounted.json'));
  await rm(path.join(directory, 'entry-development-pairs.json'));
  await assert.rejects(runMglyrReceptorReview('verify', { directory }), /Required packet member missing/);
});

test('unlisted files and directories fail name checks before payload access even with recomputed checksums', async t => {
  const directory = await copyPacket(t);
  const checksumPath = path.join(directory, 'checksums.sha256');
  const checksums = await readFile(checksumPath, 'utf8');
  const filename = path.join(directory, 'unlisted-payload.cif');
  const body = 'SYNTHETIC_UNREADABLE_SENTINEL';
  await writeFile(filename, body); await chmod(filename, 0);
  await writeFile(checksumPath, checksums + `${createHash('sha256').update(body).digest('hex')}  unlisted-payload.cif\n`);
  await assert.rejects(runMglyrReceptorReview('verify', { directory }), /Unexpected packet member: unlisted-payload.cif/);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Unexpected packet member: unlisted-payload.cif/);
  await chmod(filename, 0o600); await rm(filename); await writeFile(checksumPath, checksums);
  await mkdir(path.join(directory, 'unlisted-directory'));
  await writeFile(path.join(directory, 'unlisted-directory', 'payload'), body);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Unexpected packet member: unlisted-directory/);
  await rm(path.join(directory, 'unlisted-directory'), { recursive: true });
  await writeFile(path.join(directory, 'sources', 'unknown.body'), body);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Unexpected capture member: unknown.body/);
  await rm(path.join(directory, 'sources', 'unknown.body'));
  await writeFile(path.join(directory, 'sources', 'protein-1-attempt-2.body'), body);
  await assert.rejects(buildMglyrReceptorFiles({ directory }), /Unpaired capture member/);
});
