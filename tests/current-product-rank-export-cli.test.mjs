import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { exportCurrentProductRanks } from '../scripts/paper/export-current-product-ranks.mjs';
import { comparePairedSelection } from '../scripts/paper/compare-paired-selection.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = 'scripts/paper/export-current-product-ranks.mjs';
const SOURCES = [SCRIPT, 'lib/pose-ranking.ts', 'lib/pose-evidence-v06.ts', 'scripts/hard-decoy/oracle/canonical-json.mjs'];
const fixture = {
  schema: 'confovhh-current-product-rank-input-v1', studyId: 'SYNTHETIC-CLI',
  generators: [{ id: 'synthetic-gen', scoreName: 'synthetic-score', direction: 'higher-better' }],
  attempts: [{ id: 'synthetic-pose', groupId: 'synthetic-group', targetId: 'synthetic-target', generatorId: 'synthetic-gen', status: 'eligible', reason: '' }],
  features: [{ id: 'synthetic-pose', auditArtifactSha256: 'a'.repeat(64), producerScore: 0.5, audit: { evidenceLevel: 'limited', contactPairCount: 8, receptorInterfaceResidues: 4, vhhInterfaceResidues: 4, halfDeltaSasaInterfaceAreaAngstrom2: 100, severeClashCount: 0, maximumOverlapAngstrom: 0, imgtNumberingStatus: null } }],
};

test('rank-export CLI binds source, rejects source drift and ambiguous inputs, and preserves prior outputs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rank-export-cli-'));
  try {
    for (const filename of SOURCES) {
      await mkdir(path.dirname(path.join(directory, filename)), { recursive: true });
      await copyFile(path.join(ROOT, filename), path.join(directory, filename));
    }
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'receipt.json');
    const run = (...args) => spawnSync(process.execPath, [path.join(directory, SCRIPT), ...args], { encoding: 'utf8', timeout: 15000 });
    await writeFile(input, JSON.stringify(fixture));
    const success = run(`--input=${input}`, `--output=${output}`);
    assert.equal(success.status, 0, success.stderr);
    const original = await readFile(output, 'utf8');
    const receipt = JSON.parse(original);
    assert.equal(receipt.result.status, 'rank-export-complete');
    assert.deepEqual(receipt.result.rankings, [{ id: 'synthetic-pose', methodTier: 0, baselineTier: 0 }]);
    assert.match(receipt.inputSha256, /^[a-f0-9]{64}$/);
    assert.equal(run(`--input=${input}`, `--output=${output}`).status, 1);
    assert.equal(await readFile(output, 'utf8'), original);
    assert.equal(run(`--input=${input}`, `--output=${output}`, '--outcomes=forbidden.json').status, 1);

    await writeFile(input, JSON.stringify(fixture).replace('"producerScore":0.5', '"producerScore":0,"producerScore":0.5'));
    assert.equal(run(`--input=${input}`, `--output=${path.join(directory, 'duplicate.json')}`).status, 1);
    await writeFile(input, Buffer.from([0xff]));
    assert.equal(run(`--input=${input}`, `--output=${path.join(directory, 'invalid.json')}`).status, 1);

    await writeFile(input, JSON.stringify(fixture));
    await writeFile(path.join(directory, 'lib/pose-evidence-v06.ts'), '\n// synthetic source-drift control\n', { flag: 'a' });
    const drift = run(`--input=${input}`, `--output=${path.join(directory, 'drift.json')}`);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /Pinned current-product source mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preserved synthetic product export and paired comparison replay as one bound workflow', async () => {
  const directory = path.join(ROOT, 'paper/evidence/current-product-rank-synthetic-2026-09-08');
  const read = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const inputBytes = await readFile(path.join(directory, 'input.json'));
  const rankReceipt = await read('rank-receipt.json');
  assert.equal(rankReceipt.inputSha256, digest(inputBytes));
  assert.deepEqual(rankReceipt.result, await exportCurrentProductRanks(JSON.parse(inputBytes)));
  const labels = await read('synthetic-outcomes.json');
  const comparisonBytes = await readFile(path.join(directory, 'comparison-input.json'));
  const comparison = JSON.parse(comparisonBytes);
  assert.deepEqual(comparison.outcomes, labels.rows);
  assert.equal(comparison.positiveOutcomeDefinition, labels.positiveOutcomeDefinition);
  for (const key of ['studyId', 'method', 'baseline', 'generators', 'attempts', 'rankings']) assert.deepEqual(comparison[key], rankReceipt.result[key]);
  const receipt = await read('comparison-receipt.json');
  assert.equal(receipt.inputSha256, digest(comparisonBytes));
  assert.equal(receipt.evaluatorSha256, digest(await readFile(path.join(ROOT, 'scripts/paper/compare-paired-selection.mjs'))));
  assert.equal(receipt.strictJsonParserSha256, digest(await readFile(path.join(ROOT, 'scripts/hard-decoy/oracle/canonical-json.mjs'))));
  assert.deepEqual(receipt.report, comparePairedSelection(comparison));
  assert.equal(receipt.report.macro.method, 2 / 3);
  assert.equal(receipt.report.macro.baseline, 1 / 2);
  assert.equal(receipt.report.uncertainty.deltaInterval, null);
});
