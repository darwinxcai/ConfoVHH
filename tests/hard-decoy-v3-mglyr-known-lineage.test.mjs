import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { deriveKnownNb20Lineage, reviewKnownNb20Lineage } from '../scripts/hard-decoy-v3/review-mglyr-known-lineage.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = 'validation/hard-decoy-holdout-v3/mglyr-source-resolution-2026-09-08/source-blocks.json';
const PACKET = 'validation/hard-decoy-holdout-v3/mglyr-known-lineage-2026-09-08/lineage.json';

test('Nb20 named derivative replays from exact retained Methods with explicit source numbering and limits', async () => {
  const receipt = await reviewKnownNb20Lineage();
  assert.deepEqual(receipt, JSON.parse(await readFile(path.join(ROOT, PACKET), 'utf8')));
  assert.equal(receipt.relationship.inferredDerivativeSequenceLength, 131);
  assert.deepEqual(receipt.relationship.inferredChangedPositions, [30, 32, 33, 34, 35, 54, 55, 57, 58, 59, 60, 61, 62]);
  assert.equal(receipt.relationship.derivativeName, 'Nb20*');
  assert.ok(Object.entries(receipt.authority).every(([key, value]) => key === 'independentEligibleGroupsAdded' ? value === 0 : value === false));
  assert.equal(receipt.interpretation.inferredDerivativeIsAnObservedExpressedConstruct, false);
});

test('changing the parent, mutation, source attribution or paragraph inventory cannot produce a lineage receipt', async () => {
  const source = JSON.parse(await readFile(path.join(ROOT, SOURCE), 'utf8'));
  for (const mutate of [
    value => { value.sourceDoi = '10.0000/unverified'; },
    value => { value.sourceResponseSha256 = '0'.repeat(64); },
    value => { value.paragraphs[0].text = value.paragraphs[0].text.replace('Nb20*', 'Nb99'); },
    value => { value.paragraphs[0].text = value.paragraphs[0].text.replace('GGAGAG', 'GGGGGG'); },
    value => { value.paragraphs[0].text = value.paragraphs[0].text.replace('MAEVQL', 'MTEVQL'); },
    value => { value.paragraphs.push(structuredClone(value.paragraphs[0])); },
    value => { value.paragraphs = value.paragraphs.slice(1); },
  ]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => deriveKnownNb20Lineage(Buffer.from(JSON.stringify(changed))));
  }
});

test('ambiguous duplicate-key JSON, invalid UTF-8 and oversized inputs are rejected', async () => {
  const bytes = await readFile(path.join(ROOT, SOURCE));
  assert.throws(() => deriveKnownNb20Lineage(Buffer.from(String(bytes).replace(/\{/, '{"sourceDoi":"10.0000/forged",'))));
  assert.throws(() => deriveKnownNb20Lineage(Buffer.from([0xff])));
  assert.throws(() => deriveKnownNb20Lineage(Buffer.alloc(65537)));
});
