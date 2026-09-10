// Explicit current-product adapter. Never substitutes for the frozen v3 arm.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { POSE_RANKING_POLICY, scorePoseRanking } from '../../lib/pose-ranking.ts';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = new URL('../../', import.meta.url);
const PINNED_SOURCES = Object.freeze({
  'lib/pose-ranking.ts': '6f0be122edcf7e6e8a70ea0f562dc0e1aa14dff4adf19b2bf2f67794711d0911',
  'lib/pose-evidence-v06.ts': '83bbc4c48c22eadfdf2a8a288a9a46e05315feccba80279915e74b5c469742bc',
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function check(condition, message) { if (!condition) throw new Error(message); }
function keys(object, required) {
  check(object && typeof object === 'object' && !Array.isArray(object), 'Expected object');
  check(Object.keys(object).sort().join('|') === [...required].sort().join('|'), 'Unexpected or missing fields');
}
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableCount = value => value === null || (Number.isSafeInteger(value) && value >= 0);
const nullableMeasurement = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const nullableText = value => value === null || (typeof value === 'string' && value.length <= 120);
const AUDIT_FIELDS = ['evidenceLevel', 'contactPairCount', 'receptorInterfaceResidues', 'vhhInterfaceResidues', 'halfDeltaSasaInterfaceAreaAngstrom2', 'severeClashCount', 'maximumOverlapAngstrom', 'imgtNumberingStatus'];

function productCompare(a, b) {
  if (a.evidenceTier !== b.evidenceTier) return compare(b.evidenceTier, a.evidenceTier);
  // This is the product's secondary ordering, with its null-at-bottom policy.
  if (a.burialScore === b.burialScore) return 0;
  if (a.burialScore === null) return 1;
  if (b.burialScore === null) return -1;
  return compare(b.burialScore, a.burialScore);
}

function denseTiers(rows, comparator) {
  const ordered = [...rows].sort((a, b) => comparator(a, b) || compare(a.id, b.id));
  const tiers = new Map();
  let tier = 0;
  for (let i = 0; i < ordered.length; i++) {
    // IDs order serialization only. A scientific tie changes no tier.
    if (i > 0 && comparator(ordered[i - 1], ordered[i]) !== 0) tier++;
    tiers.set(ordered[i].id, tier);
  }
  return tiers;
}

export async function exportCurrentProductRanks(input) {
  // Validation, ranking and provenance must observe one snapshot across awaits.
  input = structuredClone(input);
  keys(input, ['schema', 'studyId', 'generators', 'attempts', 'features']);
  check(input.schema === 'confovhh-current-product-rank-input-v1' && id(input.studyId), 'Invalid schema or study ID');
  check(Array.isArray(input.generators) && input.generators.length > 0 && input.generators.length <= 8, 'Invalid generator count');
  const generators = new Map();
  for (const generator of input.generators) {
    keys(generator, ['id', 'scoreName', 'direction']);
    check(id(generator.id) && id(generator.scoreName) && !generators.has(generator.id), 'Invalid or duplicate generator');
    check(['higher-better', 'lower-better'].includes(generator.direction), 'Producer score direction must be declared');
    generators.set(generator.id, { ...generator });
  }
  check(Array.isArray(input.attempts) && input.attempts.length > 0 && input.attempts.length <= 20000, 'Invalid attempt count');
  check(Array.isArray(input.features) && input.features.length <= 20000, 'Invalid feature count');
  const attempts = new Map();
  const targetGroups = new Map();
  for (const attempt of input.attempts) {
    keys(attempt, ['id', 'groupId', 'targetId', 'generatorId', 'status', 'reason']);
    check(id(attempt.id) && !attempts.has(attempt.id) && id(attempt.groupId) && id(attempt.targetId) && generators.has(attempt.generatorId), 'Invalid, duplicate or unknown attempt identity');
    check(['eligible', 'failed', 'ineligible'].includes(attempt.status), 'Invalid attempt status');
    check(typeof attempt.reason === 'string' && attempt.reason.length <= 1000 && (attempt.status === 'eligible' ? attempt.reason === '' : attempt.reason.trim().length > 0), 'Invalid attempt reason');
    if (targetGroups.has(attempt.targetId)) check(targetGroups.get(attempt.targetId) === attempt.groupId, 'Target appears in multiple groups');
    targetGroups.set(attempt.targetId, attempt.groupId);
    attempts.set(attempt.id, { ...attempt });
  }
  const features = new Map();
  for (const feature of input.features) {
    keys(feature, ['id', 'auditArtifactSha256', 'producerScore', 'audit']);
    check(id(feature.id) && !features.has(feature.id) && attempts.get(feature.id)?.status === 'eligible', 'Unknown, duplicate or excluded feature ID');
    check(digest(feature.auditArtifactSha256), 'Invalid declared audit artifact hash');
    check(feature.producerScore === null || (typeof feature.producerScore === 'number' && Number.isFinite(feature.producerScore)), 'Producer score must be finite or explicitly null');
    keys(feature.audit, AUDIT_FIELDS);
    for (const key of ['contactPairCount', 'receptorInterfaceResidues', 'vhhInterfaceResidues', 'severeClashCount']) check(nullableCount(feature.audit[key]), `Invalid ${key}`);
    for (const key of ['halfDeltaSasaInterfaceAreaAngstrom2', 'maximumOverlapAngstrom']) check(nullableMeasurement(feature.audit[key]), `Invalid ${key}`);
    for (const key of ['evidenceLevel', 'imgtNumberingStatus']) check(nullableText(feature.audit[key]), `Invalid ${key}`);
    features.set(feature.id, feature);
  }
  for (const attempt of attempts.values()) if (attempt.status === 'eligible') check(features.has(attempt.id), 'Missing eligible audit features');

  const sourceSha256 = {};
  for (const [filename, expected] of Object.entries(PINNED_SOURCES)) {
    const observed = sha(await readFile(new URL(filename, ROOT)));
    check(observed === expected, `Pinned current-product source mismatch: ${filename}`);
    sourceSha256[filename] = observed;
  }
  for (const filename of ['scripts/paper/export-current-product-ranks.mjs', 'scripts/hard-decoy/oracle/canonical-json.mjs']) sourceSha256[filename] = sha(await readFile(new URL(filename, ROOT)));
  const sortedGenerators = [...generators.values()].sort((a, b) => compare(a.id, b.id));
  const methodPolicy = { adapter: 'current-product-scientific-ties-v1', productPolicy: structuredClone(POSE_RANKING_POLICY), sourceSha256, tieRule: 'equal-evidenceTier-and-exact-burialScore-remain-tied', groupScope: 'within-target-and-generator', quantization: 'none', frozenV3Compatible: false };
  const baselinePolicy = { adapter: 'declared-producer-score-order-v1', generators: sortedGenerators, missingScore: 'entire-comparison-unavailable', tieRule: 'equal-raw-scores-remain-tied', percentileValuesComputed: false, adapterSha256: sourceSha256['scripts/paper/export-current-product-ranks.mjs'] };

  const strata = new Map();
  for (const feature of features.values()) {
    const attempt = attempts.get(feature.id);
    const key = `${attempt.targetId}/${attempt.generatorId}`;
    if (!strata.has(key)) strata.set(key, []);
    const scored = scorePoseRanking(feature.audit);
    strata.get(key).push({ id: feature.id, evidenceTier: scored.evidenceTier, burialScore: scored.burialScore, producerScore: feature.producerScore, generatorId: attempt.generatorId });
  }
  const methodRanks = [];
  const rankings = [];
  const missingProducerScoreIds = [...features.values()].filter(row => row.producerScore === null).map(row => row.id).sort(compare);
  for (const rows of strata.values()) {
    const methodTiers = denseTiers(rows, productCompare);
    let baselineTiers;
    if (!missingProducerScoreIds.length) {
      const direction = generators.get(rows[0].generatorId).direction;
      baselineTiers = denseTiers(rows, (a, b) => direction === 'higher-better' ? compare(b.producerScore, a.producerScore) : compare(a.producerScore, b.producerScore));
    }
    for (const row of rows) {
      methodRanks.push({ id: row.id, methodTier: methodTiers.get(row.id), evidenceTier: row.evidenceTier, burialScore: row.burialScore });
      if (baselineTiers) rankings.push({ id: row.id, methodTier: methodTiers.get(row.id), baselineTier: baselineTiers.get(row.id) });
    }
  }
  methodRanks.sort((a, b) => compare(a.id, b.id)); rankings.sort((a, b) => compare(a.id, b.id));
  return {
    schema: 'confovhh-current-product-rank-export-v1', studyId: input.studyId,
    method: { name: 'current-product-scientific-ties', policySha256: sha(canonicalJson(methodPolicy)) },
    baseline: { name: 'declared-producer-score-order', policySha256: sha(canonicalJson(baselinePolicy)) },
    generators: sortedGenerators.map(g => g.id), attempts: [...attempts.values()].sort((a, b) => compare(a.id, b.id)),
    rankings, methodRanks, missingProducerScoreIds,
    status: missingProducerScoreIds.length ? 'baseline-unavailable' : 'rank-export-complete',
    provenance: { sourceSha256, methodPolicy, baselinePolicy, canonicalInputSha256: sha(canonicalJson(input)), declaredAuditArtifactSha256: Object.fromEntries([...features.values()].sort((a, b) => compare(a.id, b.id)).map(row => [row.id, row.auditArtifactSha256])) },
    claims: { frozenV3Compatible: false, independenceCertified: false, sourceAuditsVerified: false, prelabelFreezeCertified: false, biologicalValidation: false },
    limitations: [
      'Verifies current-product feature-to-rank transformation only; upstream audit values, source artifact hashes, roles, eligible population and grouping remain unverified declarations.',
      'No complete audit engine, coordinate parser, historical frozen engine or outcome evaluator is executed by this adapter.',
      'The current-product policy differs from the frozen v3 scientific preorder and cannot replace that arm.',
      'Dense scientific ties replace unique UI display ranks; no ID or artifact hash breaks a scientific tie.',
      'Producer score names and directions must be justified and frozen externally; no cross-generator raw-score comparison is performed.',
      'An exported rank ledger alone proves neither pre-label chronology nor independent data collection; empty eligible strata remain for the downstream evaluator to block.',
    ],
  };
}

export async function runCurrentProductRankExport(inputPath, outputPath) {
  const bytes = await readFile(inputPath);
  check(bytes.length <= 16000000, 'Input exceeds 16 MB');
  const input = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 16000000, maximumTokens: 1000000, maximumDepth: 12 });
  const result = await exportCurrentProductRanks(input);
  const receipt = { inputSha256: sha(bytes), nodeVersion: process.version, result };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 2 && args[0].startsWith('--input=') && args[1].startsWith('--output=') && args[0].length > 8 && args[1].length > 9, 'Usage: node scripts/paper/export-current-product-ranks.mjs --input=AUTHORIZED_FEATURES.json --output=NEW_RECEIPT.json');
    const receipt = await runCurrentProductRankExport(args[0].slice(8), args[1].slice(9));
    process.stdout.write(`${receipt.result.status}; current product only; frozen v3 incompatible\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
