#!/usr/bin/env node
// Prediction-only bridge: every candidate gap invokes the actual frozen policy.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { rankSourceFirst, exact, check } from '../../ConfoVHH/scripts/external-ranking-v3/policy.mjs';
import { parseStrictJson } from '../../ConfoVHH/scripts/hard-decoy/oracle/canonical-json.mjs';

const GROUPS = { dev_6knm: 'APLNR-JN241', dev_8qot: 'OPRM1-NbE', dev_8th3: 'AGTR1-AT118', dev_8th4: 'AGTR1-AT118' };
export const GRID = Object.freeze([0, .002, .005, .01, .02]);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function generateGrid(request) {
  exact(request, ['bundles', 'frozenAtUtc']);
  check(Array.isArray(request.bundles) && request.bundles.length > 0, 'Missing development bundles');
  const seen = new Set(), baselines = [], ids = new Set();
  for (const bundle of request.bundles) {
    exact(bundle, ['input', 'sourceManifest', 'features', 'calibrations']);
    check(bundle.input.evaluationRole === 'development' && bundle.input.producerProfiles.length === 1 && Object.keys(bundle.calibrations).length === 0, 'Only uncalibrated development bundles are allowed');
    for (const policy of bundle.input.setPolicies) {
      check(Object.hasOwn(GROUPS, policy.setId) && policy.biologicalGroupId === GROUPS[policy.setId] && !seen.has(policy.setId), 'Outside development enrollment or changed lineage');
      seen.add(policy.setId);
      check(bundle.sourceManifest.attempts.filter(a => a.setId === policy.setId).length === 25, 'Each development set must retain all 25 attempts');
    }
    for (const attempt of bundle.sourceManifest.attempts) { check(!ids.has(attempt.id), 'Duplicate attempt across bundles'); ids.add(attempt.id); }
    baselines.push(rankSourceFirst(bundle));
  }
  check(isDeepStrictEqual([...seen].sort(), Object.keys(GROUPS).sort()) && ids.size === 100, 'Calibration requires exactly the four fresh development sets');
  const evidenceSha256 = sha(request), rows = [];
  for (const gap of GRID) {
    const ranks = [], blocks = [];
    for (const original of request.bundles) {
      const bundle = structuredClone(original), profile = bundle.input.producerProfiles[0], generator = bundle.sourceManifest.generators[0];
      check(profile.calibration === null && profile.scoreProvenance !== null && profile.version !== 'unknown', 'Calibration requires known bound producer identity');
      const record = { schema: 'confovhh-source-gap-freeze-v1', calibrationId: 'development-trial-'+String(gap), generatorId: generator.id,
        producerVersion: profile.version, scoreContext: profile.scoreContext, scoreName: generator.scoreName, direction: generator.direction,
        maximumPreferredScoreGap: gap, developmentGroupIds: [...new Set(Object.values(GROUPS))].sort(),
        selectionRule: 'development-selected-tolerance-not-confidence-uncertainty', frozenAtUtc: request.frozenAtUtc, evidenceSha256 };
      profile.calibration = { path: 'internal-development-trial.json', bytes: Buffer.byteLength(JSON.stringify(record)), sha256: sha(record) };
      bundle.calibrations = { [generator.id]: record };
      const result = rankSourceFirst(bundle); ranks.push(...result.ranks); blocks.push(...result.blocks);
    }
    rows.push({ gap, ranks: ranks.sort((a,b) => (a.setId+'|'+a.arm).localeCompare(b.setId+'|'+b.arm)), blocks });
  }
  return { schema: 'confovhh-development-prediction-gap-grid-v1', grid: GRID, requestSha256: evidenceSha256, baselines, rows,
    outcomeInputs: [], policy: 'Calls rankSourceFirst for every gap; no candidate order or eligibility is reconstructed by this bridge' };
}

if (process.argv[1]?.endsWith('generate_grid.mjs')) {
  const raw = readFileSync(0, 'utf8'); parseStrictJson(raw, { maximumCharacters: 16_000_000, maximumTokens: 2_000_000, maximumDepth: 48 });
  process.stdout.write(JSON.stringify(generateGrid(JSON.parse(raw)))+'\n');
}
