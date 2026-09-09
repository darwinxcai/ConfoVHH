import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const schema = 'confovhh-paired-selection-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function check(condition, message) { if (!condition) throw new Error(message); }
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
}
function keys(object, required) {
  check(object && typeof object === 'object' && !Array.isArray(object), 'Expected object');
  check(Object.keys(object).sort().join('|') === [...required].sort().join('|'), 'Unexpected or missing fields');
}
function uniqueRows(rows, label) {
  check(Array.isArray(rows) && rows.length <= 20000, `${label}: invalid row count`);
  const map = new Map();
  for (const row of rows) {
    check(row && identifier(row.id) && !map.has(row.id), `${label}: invalid or duplicate ID`);
    map.set(row.id, row);
  }
  return map;
}
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Metric component only. Caller must separately authorize data access and certify grouping. */
export function comparePairedSelection(input, options = {}) {
  keys(input, ['schema', 'studyId', 'positiveOutcomeDefinition', 'method', 'baseline', 'generators', 'attempts', 'rankings', 'outcomes']);
  check(input.schema === schema && identifier(input.studyId), 'Invalid schema or study ID');
  check(typeof input.positiveOutcomeDefinition === 'string' && input.positiveOutcomeDefinition.trim().length > 0 && input.positiveOutcomeDefinition.length <= 1000, 'Outcome definition required');
  for (const arm of [input.method, input.baseline]) {
    keys(arm, ['name', 'policySha256']);
    check(identifier(arm.name) && /^[a-f0-9]{64}$/.test(arm.policySha256), 'Invalid declared policy identity');
  }
  check(input.method.name !== input.baseline.name, 'Method and baseline names must differ');
  check(Array.isArray(input.generators) && input.generators.length > 0 && input.generators.length <= 8 && input.generators.every(identifier) && new Set(input.generators).size === input.generators.length, 'Invalid generators');
  check(Object.keys(options).every(key => ['seed', 'bootstrapReplicates'].includes(key)), 'Unknown option');
  const { seed = 20260908, bootstrapReplicates = 10000 } = options;
  check(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff, 'Seed must be a nonzero uint32');
  check(Number.isInteger(bootstrapReplicates) && bootstrapReplicates >= 1000 && bootstrapReplicates <= 50000, 'Bootstrap replicates must be 1000..50000');
  const attempts = uniqueRows(input.attempts, 'Attempts');
  const rankings = uniqueRows(input.rankings, 'Rankings');
  const outcomes = uniqueRows(input.outcomes, 'Outcomes');
  check(attempts.size > 0, 'Empty attempt inventory');
  const targets = new Map();
  const statusCounts = { eligible: 0, failed: 0, ineligible: 0 };
  for (const row of attempts.values()) {
    keys(row, ['id', 'groupId', 'targetId', 'generatorId', 'status', 'reason']);
    check(identifier(row.groupId) && identifier(row.targetId) && input.generators.includes(row.generatorId), 'Invalid grouping or generator');
    check(Object.hasOwn(statusCounts, row.status), 'Invalid attempt status');
    check(typeof row.reason === 'string' && row.reason.length <= 1000 && (row.status === 'eligible' ? row.reason === '' : row.reason.trim().length > 0), 'Failed/ineligible attempts require a reason; eligible attempts require an empty reason');
    statusCounts[row.status]++;
    if (!targets.has(row.targetId)) targets.set(row.targetId, { groupId: row.groupId, strata: new Map(input.generators.map(g => [g, []])) });
    const target = targets.get(row.targetId);
    check(target.groupId === row.groupId, 'A target cannot belong to multiple groups');
    target.strata.get(row.generatorId).push(row);
    if (row.status === 'eligible') {
      check(rankings.has(row.id) && outcomes.has(row.id), 'Every eligible attempt requires both ranks and an outcome');
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
    check(row.positive === 0 || row.positive === 1, 'Outcome must be binary 0 or 1');
  }
  const strata = [];
  const groupTargets = new Map();
  for (const [targetId, target] of [...targets].sort(([a], [b]) => compare(a, b))) {
    const values = [];
    for (const [generatorId, rows] of [...target.strata].sort(([a], [b]) => compare(a, b))) {
      const eligible = rows.filter(row => row.status === 'eligible');
      const positives = eligible.filter(row => outcomes.get(row.id).positive === 1).length;
      const top = key => {
        const best = Math.min(...eligible.map(row => rankings.get(row.id)[key]));
        const tied = eligible.filter(row => rankings.get(row.id)[key] === best);
        return { tiedCandidates: tied.length, expectedSuccess: mean(tied.map(row => outcomes.get(row.id).positive)) };
      };
      const method = eligible.length ? top('methodTier') : null;
      const baseline = eligible.length ? top('baselineTier') : null;
      const delta = method ? method.expectedSuccess - baseline.expectedSuccess : null;
      strata.push({ groupId: target.groupId, targetId, generatorId, attempted: rows.length, eligible: eligible.length, positives, mixedOutcomes: positives > 0 && positives < eligible.length, status: eligible.length ? 'assessable' : rows.length ? 'no-eligible-candidates' : 'missing-generator-attempts', method, baseline, delta });
      values.push(method ? { method: method.expectedSuccess, baseline: baseline.expectedSuccess, delta } : null);
    }
    if (!groupTargets.has(target.groupId)) groupTargets.set(target.groupId, []);
    groupTargets.get(target.groupId).push({ targetId, values: values.every(Boolean) ? { method: mean(values.map(v => v.method)), baseline: mean(values.map(v => v.baseline)), delta: mean(values.map(v => v.delta)) } : null });
  }
  check(groupTargets.size <= 200 && targets.size <= 1000, 'Too many groups or targets');
  check(bootstrapReplicates * groupTargets.size * Math.max(...[...groupTargets.values()].map(rows => rows.length)) <= 20000000, 'Bootstrap work budget exceeded');
  const groups = [...groupTargets].sort(([a], [b]) => compare(a, b)).map(([groupId, rows]) => ({ groupId, targets: rows, values: rows.every(r => r.values) ? { method: mean(rows.map(r => r.values.method)), baseline: mean(rows.map(r => r.values.baseline)), delta: mean(rows.map(r => r.values.delta)) } : null }));
  const complete = groups.every(group => group.values);
  const macro = complete ? { method: mean(groups.map(g => g.values.method)), baseline: mean(groups.map(g => g.values.baseline)), delta: mean(groups.map(g => g.values.delta)) } : null;
  let interval = null;
  if (complete && groups.length >= 2) {
    const random = rng(seed);
    const deltas = [];
    for (let replicate = 0; replicate < bootstrapReplicates; replicate++) {
      const sampledGroups = [];
      for (let index = 0; index < groups.length; index++) {
        const group = groups[Math.floor(random() * groups.length)];
        const sampledTargets = [];
        for (let t = 0; t < group.targets.length; t++) sampledTargets.push(group.targets[Math.floor(random() * group.targets.length)].values.delta);
        sampledGroups.push(mean(sampledTargets));
      }
      deltas.push(mean(sampledGroups));
    }
    deltas.sort((a, b) => a - b);
    interval = [quantile(deltas, 0.025), quantile(deltas, 0.975)];
  }
  return {
    schema: 'confovhh-paired-selection-report-v1', studyId: input.studyId,
    positiveOutcomeDefinition: input.positiveOutcomeDefinition,
    method: { ...input.method }, baseline: { ...input.baseline },
    status: complete ? 'descriptive-comparison-complete' : 'incomplete-no-aggregate',
    attemptCounts: statusCounts, declaredGroupCount: groups.length,
    mixedOutcomeStrata: strata.filter(s => s.mixedOutcomes).length,
    declaredGroupsWithMixedOutcomeStrata: new Set(strata.filter(s => s.mixedOutcomes).map(s => s.groupId)).size,
    strata, groups, macro,
    uncertainty: { method: 'paired-group-then-target-percentile-bootstrap', confidenceLevel: 0.95, seed, bootstrapReplicates: interval ? bootstrapReplicates : 0, deltaInterval: interval, generatorAndPoseResampling: false },
    leaveOneGroupOut: complete && groups.length >= 2 ? groups.map(g => ({ omittedGroupId: g.groupId, delta: mean(groups.filter(other => other !== g).map(other => other.values.delta)) })) : [],
    limitations: [
      'Group identities and policy hashes are supplied declarations, not certified independence or verified policy execution.',
      'Input integrity does not establish pre-label freezing, complete source-population capture, blinded collection, or authorized label access.',
      'Expected top-1 success assumes uniform random choice within the best tied tier. Candidate IDs never break scientific ties.',
      'Bootstrap uncertainty is conditional on representative independent groups and exchangeable targets within groups; it does not cover grouping, selection, training overlap, or missing-population bias.',
      'A degenerate interval is possible and is not proof of certainty. Small group counts support limited generalization.',
      'One paired baseline and one endpoint are evaluated; no multiplicity-adjusted superiority decision or full v3 endpoint evaluation is performed.',
      ...(!complete ? ['Missing eligible strata block the aggregate; they are not silently dropped or assigned zero success.'] : []),
      ...(groups.length < 10 ? ['Fewer than ten declared groups; this does not meet the v3 independent-group minimum.'] : []),
    ],
    claims: { independentGroupsCertified: false, completeV3Evaluation: false, nearNativeRankingValidated: false, bindingValidated: false, scientificSuperiorityEstablished: false },
  };
}

export async function runComparisonFile(inputPath, outputPath) {
  const bytes = await readFile(inputPath);
  check(bytes.length <= 16000000, 'Input exceeds 16 MB');
  const input = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 16000000, maximumTokens: 1000000, maximumDepth: 12 });
  const report = comparePairedSelection(input);
  const receipt = { inputSha256: sha256(bytes), evaluatorSha256: sha256(await readFile(new URL(import.meta.url))), strictJsonParserSha256: sha256(await readFile(new URL('../hard-decoy/oracle/canonical-json.mjs', import.meta.url))), nodeVersion: process.version, report };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 2 && args[0].startsWith('--input=') && args[1].startsWith('--output=') && args.every(arg => arg.split('=').slice(1).join('=').length > 0), 'Usage: node scripts/paper/compare-paired-selection.mjs --input=AUTHORIZED_INPUT.json --output=NEW_RECEIPT.json');
    const receipt = await runComparisonFile(args[0].slice(8), args[1].slice(9));
    process.stdout.write(`${receipt.report.status}; ${receipt.report.declaredGroupCount} declared groups; no independence certificate\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
