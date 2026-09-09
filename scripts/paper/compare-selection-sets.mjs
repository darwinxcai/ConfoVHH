import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const schema = 'confovhh-selection-sets-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function check(condition, message) { if (!condition) throw new Error(message); }
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
}
function keys(object, expected) {
  check(object && typeof object === 'object' && !Array.isArray(object), 'Expected object');
  check(Object.keys(object).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing fields');
}
function uniqueRows(rows, label, maximum, allowEmpty = true) {
  check(Array.isArray(rows) && rows.length <= maximum && (allowEmpty || rows.length > 0), `${label}: invalid row count`);
  const map = new Map();
  for (const row of rows) {
    check(row && identifier(row.id) && !map.has(row.id), `${label}: invalid or duplicate ID`);
    map.set(row.id, row);
  }
  return map;
}
function aggregate(rows) {
  return rows.length && rows.every(row => row.values) ? {
    method: mean(rows.map(row => row.values.method)),
    baseline: mean(rows.map(row => row.values.baseline)),
    delta: mean(rows.map(row => row.values.delta)),
  } : null;
}
function sorted(map) { return [...map].sort(([a], [b]) => compare(a, b)); }
function cellKey(targetId, generatorId, conditionId) {
  return JSON.stringify([targetId, generatorId, conditionId]);
}

/** Descriptive component only; this does not certify inventories, independence or label authorization. */
export function compareSelectionSets(input) {
  keys(input, ['schema', 'studyId', 'positiveOutcomeDefinition', 'method', 'baseline', 'targets', 'generators', 'selectionSets', 'attempts', 'rankings', 'outcomes']);
  check(input.schema === schema && identifier(input.studyId), 'Invalid schema or study ID');
  check(typeof input.positiveOutcomeDefinition === 'string' && input.positiveOutcomeDefinition.trim().length > 0 && input.positiveOutcomeDefinition.length <= 1000, 'Outcome definition required');
  for (const arm of [input.method, input.baseline]) {
    keys(arm, ['name', 'policySha256']);
    check(identifier(arm.name) && /^[a-f0-9]{64}$/.test(arm.policySha256), 'Invalid declared policy identity');
  }
  check(input.method.name !== input.baseline.name, 'Method and baseline names must differ');
  const targets = uniqueRows(input.targets, 'Targets', 1000, false);
  const generators = uniqueRows(input.generators, 'Generators', 8, false);
  const sets = uniqueRows(input.selectionSets, 'Selection sets', 10000);
  const attempts = uniqueRows(input.attempts, 'Attempts', 20000);
  const rankings = uniqueRows(input.rankings, 'Rankings', 20000);
  const outcomes = uniqueRows(input.outcomes, 'Outcomes', 20000);
  const groupTargets = new Map();
  for (const target of targets.values()) {
    keys(target, ['id', 'groupId']);
    check(identifier(target.groupId), 'Invalid target group');
    if (!groupTargets.has(target.groupId)) groupTargets.set(target.groupId, []);
    groupTargets.get(target.groupId).push(target.id);
  }
  check(groupTargets.size <= 200, 'Too many groups');
  for (const generator of generators.values()) {
    keys(generator, ['id', 'conditionIds']);
    check(Array.isArray(generator.conditionIds) && generator.conditionIds.length > 0 && generator.conditionIds.length <= 8 && generator.conditionIds.every(identifier) && new Set(generator.conditionIds).size === generator.conditionIds.length, 'Invalid declared generator conditions');
  }

  const cells = new Map();
  const rowsBySet = new Map();
  let plannedCandidates = 0;
  for (const set of sets.values()) {
    keys(set, ['id', 'targetId', 'generatorId', 'conditionId', 'seed', 'plannedCandidates']);
    check(targets.has(set.targetId) && generators.has(set.generatorId), 'Unknown selection-set target or generator');
    check(generators.get(set.generatorId).conditionIds.includes(set.conditionId), 'Unknown selection-set condition');
    check(set.seed === null || (Number.isSafeInteger(set.seed) && set.seed >= 0 && set.seed <= 0xffffffff), 'Seed must be null or a uint32');
    check(Number.isSafeInteger(set.plannedCandidates) && set.plannedCandidates > 0 && set.plannedCandidates <= 20000, 'Invalid planned candidate count');
    plannedCandidates += set.plannedCandidates;
    const key = cellKey(set.targetId, set.generatorId, set.conditionId);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(set.id);
    rowsBySet.set(set.id, []);
  }
  check(plannedCandidates <= 20000, 'Too many planned candidates');

  const statusCounts = { eligible: 0, failed: 0, ineligible: 0 };
  for (const row of attempts.values()) {
    keys(row, ['id', 'groupId', 'targetId', 'generatorId', 'selectionSetId', 'status', 'reason']);
    const set = sets.get(row.selectionSetId);
    check(set && row.targetId === set.targetId && row.generatorId === set.generatorId && row.groupId === targets.get(set.targetId).groupId, 'Attempt membership disagrees with the declared selection set or target group');
    check(Object.hasOwn(statusCounts, row.status), 'Invalid attempt status');
    check(typeof row.reason === 'string' && row.reason.length <= 1000 && (row.status === 'eligible' ? row.reason === '' : row.reason.trim().length > 0), 'Failed/ineligible attempts require a reason; eligible attempts require an empty reason');
    statusCounts[row.status]++;
    rowsBySet.get(set.id).push(row);
    if (row.status === 'eligible') {
      check(rankings.has(row.id) && outcomes.has(row.id), 'Every eligible attempt requires both ranks and a known outcome');
    } else {
      check(!rankings.has(row.id) && !outcomes.has(row.id), 'Excluded attempts cannot enter ranks or outcomes');
    }
  }
  for (const row of rankings.values()) {
    keys(row, ['id', 'methodTier', 'baselineTier']);
    check(attempts.get(row.id)?.status === 'eligible', 'Unknown ranking ID');
    check([row.methodTier, row.baselineTier].every(tier => Number.isSafeInteger(tier) && tier >= 0), 'Ranks must be nonnegative integer tiers; lower is better');
  }
  for (const row of outcomes.values()) {
    keys(row, ['id', 'positive']);
    check(attempts.get(row.id)?.status === 'eligible', 'Unknown outcome ID');
    check(row.positive === 0 || row.positive === 1, 'Outcome must be binary 0 or 1; unknown is not failure');
  }

  const selectionSets = sorted(sets).map(([, set]) => {
    const rows = rowsBySet.get(set.id);
    check(rows.length <= set.plannedCandidates, 'More attempts than planned for a selection set');
    const unrecorded = set.plannedCandidates - rows.length;
    const eligible = rows.filter(row => row.status === 'eligible');
    const positives = eligible.filter(row => outcomes.get(row.id).positive === 1).length;
    const top = key => {
      const tier = Math.min(...eligible.map(row => rankings.get(row.id)[key]));
      const tied = eligible.filter(row => rankings.get(row.id)[key] === tier);
      return { tier, tiedCandidates: tied.length, expectedSuccess: mean(tied.map(row => outcomes.get(row.id).positive)) };
    };
    const assessable = unrecorded === 0 && eligible.length > 0;
    const method = assessable ? top('methodTier') : null;
    const baseline = assessable ? top('baselineTier') : null;
    const groupId = targets.get(set.targetId).groupId;
    return {
      ...set, groupId,
      primaryWeight: 1 / groupTargets.size / groupTargets.get(groupId).length / generators.size / generators.get(set.generatorId).conditionIds.length / cells.get(cellKey(set.targetId, set.generatorId, set.conditionId)).length,
      recordedAttempts: rows.length, unrecordedAttempts: unrecorded, eligibleCandidates: eligible.length,
      failedAttempts: rows.filter(row => row.status === 'failed').length,
      ineligibleAttempts: rows.filter(row => row.status === 'ineligible').length,
      positives, mixedOutcomes: assessable ? positives > 0 && positives < eligible.length : null,
      status: unrecorded ? 'incomplete-attempt-inventory' : eligible.length ? 'assessable' : 'no-eligible-candidates',
      method, baseline,
      values: assessable ? { method: method.expectedSuccess, baseline: baseline.expectedSuccess, delta: method.expectedSuccess - baseline.expectedSuccess } : null,
    };
  });
  const setReports = new Map(selectionSets.map(set => [set.id, set]));
  const missingCells = [];
  const groups = sorted(groupTargets).map(([groupId, targetIds]) => {
    const targetReports = [...targetIds].sort(compare).map(targetId => {
      const generatorReports = sorted(generators).map(([generatorId, generator]) => {
        const conditions = [...generator.conditionIds].sort(compare).map(conditionId => {
          const selectionSetIds = [...(cells.get(cellKey(targetId, generatorId, conditionId)) ?? [])].sort(compare);
          if (!selectionSetIds.length) missingCells.push({ groupId, targetId, generatorId, conditionId });
          const rows = selectionSetIds.map(id => setReports.get(id));
          const values = aggregate(rows);
          return { conditionId, selectionSetIds, status: !rows.length ? 'missing-selection-sets' : values ? 'complete' : 'incomplete', values };
        });
        return { generatorId, conditions, values: aggregate(conditions) };
      });
      return { targetId, generators: generatorReports, values: aggregate(generatorReports) };
    });
    return { groupId, targets: targetReports, values: aggregate(targetReports) };
  });
  const primary = aggregate(groups);
  const mixed = selectionSets.filter(set => set.mixedOutcomes === true);
  const mixedWeight = mixed.reduce((sum, set) => sum + set.primaryWeight, 0);
  const mixedValues = primary && mixed.length ? Object.fromEntries(['method', 'baseline', 'delta'].map(key => [key, mixed.reduce((sum, set) => sum + set.primaryWeight * set.values[key], 0) / mixedWeight])) : null;
  return {
    schema: 'confovhh-selection-sets-report-v1', studyId: input.studyId,
    positiveOutcomeDefinition: input.positiveOutcomeDefinition,
    method: { ...input.method }, baseline: { ...input.baseline },
    status: primary ? 'descriptive-comparison-complete' : 'incomplete-no-aggregate',
    declaredGroupCount: groups.length, declaredTargetCount: targets.size, declaredGeneratorCount: generators.size,
    inventory: { selectionSets: sets.size, plannedCandidates, recordedAttempts: attempts.size, unrecordedAttempts: plannedCandidates - attempts.size, ...statusCounts, missingTargetGeneratorConditionCells: missingCells },
    attemptAccounting: sorted(attempts).map(([, row]) => ({ ...row })),
    weighting: 'equal groups; equal targets within group; equal generators within target; equal declared conditions within generator; equal selection sets within condition',
    selectionSets, groups, primary,
    mixedSecondary: {
      status: !primary ? 'incomplete-no-aggregate' : mixed.length ? 'descriptive-conditional-comparison-complete' : 'no-mixed-outcome-selection-sets',
      selectionSetIds: mixed.map(set => set.id), selectionSetCount: mixed.length,
      declaredGroupCount: new Set(mixed.map(set => set.groupId)).size,
      primaryWeightFraction: primary ? mixedWeight : null,
      weighting: 'retain each selection set\'s original primary weight, then normalize by total weight of mixed sets',
      values: mixedValues,
    },
    uncertainty: { method: 'not-estimated', deltaInterval: null },
    limitations: [
      'Inventories, policy identities, set boundaries and group assignments are supplied declarations, not certified provenance, completeness or independence.',
      'Every target is expected to have every declared generator and each of that generator\'s declared conditions; missing cells block aggregates.',
      'Top-1 success is conditional on the eligible common candidate pool in each selection set; failed attempts remain recorded but this is not scheduled-job yield.',
      'Any missing attempt or selection set, or a set with no eligible candidates, blocks primary and secondary aggregates. Unknown eligible outcomes reject.',
      'Expected success assumes uniform choice within the complete best tied tier. Candidate IDs never break scientific ties.',
      'Mixed-outcome analysis is secondary and conditional on this generator producing both positive and negative eligible candidates; all other sets remain in primary accounting.',
      'Repeated seeds, conditions and additional poses do not certify additional independent biological groups. No uncertainty interval, power claim or superiority decision is made.',
      'Hashes bind bytes and source identity; they do not establish pre-label freezing, blinded collection, authorized label access, training independence or external inventory completeness.',
      'This separate component does not alter or complete the historical v3 protocol, the earlier paired-selection evaluator, or any scientific claim.',
    ],
    claims: { independentGroupsCertified: false, completeV3Evaluation: false, scheduledJobYieldEstimated: false, nearNativeRankingValidated: false, bindingValidated: false, scientificSuperiorityEstablished: false },
  };
}

export async function runSelectionSetComparisonFile(inputPath, outputPath) {
  const bytes = await readFile(inputPath);
  check(bytes.length <= 16000000, 'Input exceeds 16 MB');
  const input = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 16000000, maximumTokens: 1000000, maximumDepth: 12 });
  const report = compareSelectionSets(input);
  const receipt = { inputSha256: sha256(bytes), evaluatorSha256: sha256(await readFile(new URL(import.meta.url))), strictJsonParserSha256: sha256(await readFile(new URL('../hard-decoy/oracle/canonical-json.mjs', import.meta.url))), nodeVersion: process.version, report };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 2 && args[0].startsWith('--input=') && args[1].startsWith('--output=') && args.every(arg => arg.split('=').slice(1).join('=').length > 0), 'Usage: node scripts/paper/compare-selection-sets.mjs --input=AUTHORIZED_INPUT.json --output=NEW_RECEIPT.json');
    const receipt = await runSelectionSetComparisonFile(args[0].slice(8), args[1].slice(9));
    process.stdout.write(`${receipt.report.status}; ${receipt.report.inventory.selectionSets} declared selection sets; no independence certificate\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
