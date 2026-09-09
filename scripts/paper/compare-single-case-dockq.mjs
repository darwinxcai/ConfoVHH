// Descriptive reporting for one predeclared candidate pool; never a v3 evaluator.
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateImportedSingleAuditReport } from '../../lib/research-workspace.ts';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { extractProducerScoreSources } from './producer-score-sources.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(value);
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function strict(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  check(text.length <= 64_000_000, 'Input exceeds 64 MB');
  // Receipts embed exact report/source JSON strings including escaped newlines.
  // Validate a whitespace-normalized string-token view with the existing strict
  // duplicate-key/depth/number parser, then decode the unchanged original text.
  // Normalization can only collapse distinct keys (fail closed), never conceal
  // duplicate decoded keys. Embedded report/source bytes are never normalized.
  const view = text.replace(/"(?:[^"\\]|\\[\s\S])*"/gu, token => JSON.stringify(JSON.parse(token).replace(/[\n\r\t]/gu, ' ')));
  parseStrictJson(view, { maximumCharacters: 64_000_000, maximumTokens: 4_000_000, maximumDepth: 64 });
  return JSON.parse(text);
}
function keys(value, expected) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  check(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), 'Unexpected or missing input fields');
}
function rows(values, label) {
  check(Array.isArray(values) && values.length <= 200, `${label}: bounded array required`);
  const result = new Map();
  for (const row of values) { check(row && idValid(row.id) && !result.has(row.id), `${label}: invalid or duplicate ID`); result.set(row.id, row); }
  return result;
}
function membership(actual, expected, label) {
  check(actual.size === expected.size && [...actual.keys()].every(id => expected.has(id)), `${label}: exact candidate membership required`);
}
function reason(value, successful) {
  check(typeof value === 'string' && value.length <= 1000 && (successful ? value === '' : value.trim().length > 0), 'Success requires empty reason; failure requires a reason');
}

export const SINGLE_CASE_DOCKQ_POLICY = Object.freeze({
  schema: 'confovhh-single-case-dockq-policy-v1', selectionUnit: 'one-declared-joint-candidate-pool',
  ranking: 'consume-source-bound-comparisonFields-rankings-without-recomputing-scoring',
  tieRule: 'all-candidates-in-exact-lowest-integer-tier; uniform-selection-expectation',
  outcome: 'finite-DockQ-in-inclusive-range-0-to-1', positiveThreshold: 0.23,
  primary: 'mean-DockQ-of-complete-best-tied-tier', oracle: 'maximum-available-DockQ-with-all-exact-ties',
  missing: 'any-generated-candidate-without-successful-audit-or-DockQ-withholds-full-paired-comparison',
  confidenceMissing: 'existing-source-bound-export-withholds-paired-rankings',
  generationFailures: 'retain-in-planned-denominator; selection-conditional-on-generated-candidates',
  uncertainty: 'none; one-development-case', frozenV3Compatible: false,
});

/** Pure arithmetic over supplied receipts. No coordinate execution or cloud provenance authentication. */
export function compareSingleCaseDockq(input) {
  input = structuredClone(input);
  keys(input, ['schema', 'studyId', 'plan', 'attempts', 'sourceBoundReceipt', 'dockq']);
  check(input.schema === 'confovhh-single-case-dockq-input-v1' && idValid(input.studyId), 'Invalid single-case schema or study ID');
  keys(input.plan, ['targetId', 'generatorId', 'plannedCandidateIds', 'referenceSha256']);
  const plan = input.plan;
  check(idValid(plan.targetId) && idValid(plan.generatorId) && hashValid(plan.referenceSha256), 'Invalid plan target, generator or reference identity');
  check(Array.isArray(plan.plannedCandidateIds) && plan.plannedCandidateIds.length > 0 && plan.plannedCandidateIds.length <= 200 && plan.plannedCandidateIds.every(idValid), 'Invalid planned candidate IDs');
  const planned = new Set(plan.plannedCandidateIds);
  check(planned.size === plan.plannedCandidateIds.length, 'Duplicate planned candidate ID');
  const attempts = rows(input.attempts, 'Attempts'); membership(attempts, planned, 'Attempts');
  for (const row of attempts.values()) {
    keys(row, ['id', 'generationStatus', 'auditStatus', 'reason', 'coordinateSha256']);
    check(['success', 'failed'].includes(row.generationStatus) && ['success', 'failed', 'not-run'].includes(row.auditStatus), 'Invalid generation or audit status');
    if (row.generationStatus === 'failed') check(row.auditStatus === 'not-run' && row.coordinateSha256 === null, 'Generation failure cannot carry coordinate or audit');
    else check(hashValid(row.coordinateSha256), 'Generated candidate needs coordinate SHA-256');
    reason(row.reason, row.generationStatus === 'success' && row.auditStatus === 'success');
  }
  const receipt = input.sourceBoundReceipt;
  check(receipt && hashValid(receipt.inputSha256), 'Source-bound input receipt identity required');
  const source = receipt.result;
  check(source?.schema === 'confovhh-source-bound-coordinate-export-v1' && source.studyId === input.studyId, 'Expected matching source-bound export');
  const fields = source.comparisonFields;
  check(fields && same(fields.generators, [plan.generatorId]), 'Exactly one declared generator is required');
  const sourceAttempts = rows(fields.attempts, 'Source attempts'); membership(sourceAttempts, planned, 'Source attempts');
  const groups = new Set();
  const audited = new Map();
  for (const [id, attempt] of sourceAttempts) {
    check(attempt.targetId === plan.targetId && attempt.generatorId === plan.generatorId && idValid(attempt.groupId), 'Source attempt target/generator/group mismatch');
    groups.add(attempt.groupId);
    check(['eligible', 'failed', 'ineligible'].includes(attempt.status), 'Invalid source attempt status');
    const auditSuccess = attempts.get(id).auditStatus === 'success';
    check(auditSuccess === (attempt.status === 'eligible'), 'Source eligibility must exactly match successful audit status');
    reason(attempt.reason, attempt.status === 'eligible');
    if (auditSuccess) audited.set(id, attempts.get(id));
  }
  check(groups.size === 1, 'One biological group is required');
  const execution = source.coordinateExecution;
  check(execution?.schema === 'confovhh-coordinate-rank-export-v1' && execution.studyId === input.studyId, 'Coordinate execution receipt required');
  check(same(fields.attempts, execution.comparisonFields.attempts) && same(fields.rankings, execution.comparisonFields.rankings) && same(fields.method, execution.comparisonFields.method), 'Source and coordinate rank fields disagree');
  const originalRanks = execution.reportRankExport.rankExport;
  check(same(fields.rankings, originalRanks.rankings) && same(fields.attempts, originalRanks.attempts), 'Source and original exported rank ledger disagree');
  check(fields.method.name === 'coordinate-executed-current-product' && fields.method.policySha256 === sha(canonicalJson(execution.provenance.policy)), 'Method policy binding mismatch');
  check(fields.baseline.name === 'source-bound-producer-confidence' && fields.baseline.policySha256 === sha(canonicalJson(source.provenance.policy)), 'Baseline policy binding mismatch');
  const descriptors = rows(execution.reportManifest.reports, 'Report descriptors'); membership(descriptors, audited, 'Reports');
  const executionBindings = rows(execution.provenance.executionBindings, 'Execution bindings'); membership(executionBindings, audited, 'Execution bindings');
  const extraction = source.scoreExtraction;
  const bindings = rows(extraction.bindings, 'Score bindings'); membership(bindings, audited, 'Score bindings');
  const scores = rows(extraction.scores, 'Extracted scores'); membership(scores, audited, 'Extracted scores');
  membership(new Map(Object.keys(execution.reports).map(id => [id, true])), audited, 'Report bytes');
  const scoreBytes = new Map(), scoreDescriptors = [];
  for (const [id, binding] of bindings) {
    const attempt = attempts.get(id), descriptor = descriptors.get(id), executed = executionBindings.get(id);
    check(binding.coordinateSha256 === attempt.coordinateSha256 && descriptor.coordinateSha256 === attempt.coordinateSha256 && executed.coordinateSha256 === attempt.coordinateSha256, 'Coordinate score/audit binding mismatch');
    const reportBytes = Buffer.from(execution.reports[id]);
    check(sha(reportBytes) === descriptor.reportSha256 && descriptor.reportSha256 === executed.reportSha256, 'Audit report byte binding mismatch');
    const report = validateImportedSingleAuditReport(strict(reportBytes));
    check(report.structure.sourceFileSha256 === attempt.coordinateSha256 && report.structure.sourceFileBytes === descriptor.coordinateBytes && descriptor.coordinateBytes === executed.coordinateBytes, 'Audit coordinate identity mismatch');
    check(report.structure.selectedModelId === descriptor.selectedModelId && descriptor.selectedModelId === executed.selectedModelId && report.structure.modelCount === 1, 'Audit selected-model binding mismatch');
    check(report.auditPolicy.confidenceMode === 'none' && report.auditPolicy.pae === 'omitted' && report.pae === null, 'Expected existing geometry-only audit policy');
    for (const [role, field] of [['receptor', 'receptorChain'], ['VHH', 'vhhChain']]) check(report.structure.selectedChains.find(chain => chain.role === role)?.id === descriptor[field], 'Audit chain-role binding mismatch');
    check(scores.get(id).value === binding.value && descriptor.producerScore === binding.value, 'Producer score binding mismatch');
    const sourceDescriptor = binding.sourcePath === null ? null : { path: binding.sourcePath, sha256: binding.sourceSha256, bytes: binding.sourceBytes };
    scoreDescriptors.push({ id, extractor: binding.extractor, coordinatePath: binding.coordinatePath, coordinateSha256: binding.coordinateSha256, source: sourceDescriptor });
    if (sourceDescriptor) { check(typeof source.provenance.sourceJson[id] === 'string', 'Original producer score JSON required'); scoreBytes.set(id, Buffer.from(source.provenance.sourceJson[id])); }
  }
  membership(new Map(Object.keys(source.provenance.sourceJson).map(id => [id, true])), scoreBytes, 'Producer JSON sources');
  const verifiedExtraction = extractProducerScoreSources(scoreDescriptors, scoreBytes);
  check(same([...verifiedExtraction.scores].sort(byId), [...scores.values()].sort(byId)) && same([...verifiedExtraction.bindings].sort(byId), [...bindings.values()].sort(byId)), 'Producer extraction receipt differs from exact source bytes');
  const missingConfidence = [...scores.values()].filter(row => row.value === null).map(row => row.id).sort();
  check(same([...source.provenance.missingScoreIds].sort(), missingConfidence), 'Missing-confidence inventory mismatch');
  check(source.status === (!audited.size ? 'no-eligible-candidates' : missingConfidence.length ? 'baseline-unavailable' : 'source-bound-ranks-complete'), 'Source-bound status disagrees with inventory');
  const rankings = rows(fields.rankings, 'Rankings');
  if (missingConfidence.length) check(rankings.size === 0, 'Missing confidence cannot have paired ranks');
  else membership(rankings, audited, 'Rankings');
  for (const row of rankings.values()) {
    keys(row, ['id', 'methodTier', 'baselineTier']);
    check([row.methodTier, row.baselineTier].every(value => Number.isSafeInteger(value) && value >= 0), 'Scientific tiers must be exact nonnegative integers');
  }
  const outcomes = rows(input.dockq, 'DockQ records');
  const successfulInputPairs = new Map();
  for (const row of outcomes.values()) {
    keys(row, ['id', 'status', 'coordinateSha256', 'referenceSha256', 'DockQ', 'reason']);
    check(attempts.get(row.id)?.generationStatus === 'success', 'DockQ record must belong to a generated planned candidate');
    check(row.coordinateSha256 === attempts.get(row.id).coordinateSha256 && row.referenceSha256 === plan.referenceSha256, 'DockQ coordinate/reference binding mismatch');
    check(['success', 'failed'].includes(row.status), 'Invalid DockQ status');
    check(row.status === 'success' ? typeof row.DockQ === 'number' && Number.isFinite(row.DockQ) && row.DockQ >= 0 && row.DockQ <= 1 : row.DockQ === null, 'Successful DockQ must be finite in [0,1]; failed DockQ must be null');
    reason(row.reason, row.status === 'success');
    if (row.status === 'success') {
      // One frozen mapping/configuration applies to this whole single-case pool.
      const pair = `${row.coordinateSha256}:${row.referenceSha256}`;
      check(!successfulInputPairs.has(pair) || successfulInputPairs.get(pair) === row.DockQ, 'Identical coordinate/reference inputs have conflicting DockQ values');
      successfulInputPairs.set(pair, row.DockQ);
    }
  }
  const failures = [], ledger = [];
  for (const id of plan.plannedCandidateIds) {
    const attempt = attempts.get(id), outcome = outcomes.get(id);
    if (attempt.generationStatus === 'failed') failures.push({ id, stage: 'generation', reason: attempt.reason });
    else {
      if (attempt.auditStatus !== 'success') failures.push({ id, stage: 'audit', reason: attempt.reason });
      if (!outcome || outcome.status === 'failed') failures.push({ id, stage: 'dockq', reason: outcome?.reason ?? 'No DockQ record supplied for generated candidate' });
    }
    if (missingConfidence.includes(id)) failures.push({ id, stage: 'confidence', reason: scores.get(id).missingReason });
    ledger.push({ ...attempt, producerScore: scores.get(id)?.value ?? null, methodTier: rankings.get(id)?.methodTier ?? null, baselineTier: rankings.get(id)?.baselineTier ?? null, dockqStatus: outcome?.status ?? 'not-recorded', DockQ: outcome?.DockQ ?? null });
  }
  const generated = ledger.filter(row => row.generationStatus === 'success');
  const scored = [...outcomes.values()].filter(row => row.status === 'success');
  const maxDockQ = scored.length ? Math.max(...scored.map(row => row.DockQ)) : null;
  const oracle = scored.length ? { candidateIds: scored.filter(row => row.DockQ === maxDockQ).map(row => row.id).sort(), DockQ: maxDockQ, availableCandidates: scored.length, completeGeneratedPool: scored.length === generated.length } : null;
  const blocked = failures.some(row => row.stage !== 'generation');
  const status = !generated.length ? 'no-eligible-candidates' : blocked ? 'incomplete-comparison-withheld' : 'descriptive-comparison-complete';
  const summarize = key => {
    const tier = Math.min(...[...rankings.values()].map(row => row[key]));
    const candidateIds = [...rankings.values()].filter(row => row[key] === tier).map(row => row.id).sort();
    const values = candidateIds.map(id => outcomes.get(id).DockQ);
    return { tier, candidateIds, tiedCandidates: candidateIds.length, meanDockQ: mean(values), minDockQ: Math.min(...values), maxDockQ: Math.max(...values), fractionAtLeast023: mean(values.map(value => Number(value >= 0.23))), regretToBestAvailable: maxDockQ - mean(values) };
  };
  const confo = status === 'descriptive-comparison-complete' ? summarize('methodTier') : null;
  const predictor = status === 'descriptive-comparison-complete' ? summarize('baselineTier') : null;
  return {
    schema: 'confovhh-single-case-dockq-report-v1', studyId: input.studyId, status, plan,
    method: fields.method, baseline: fields.baseline, policy: SINGLE_CASE_DOCKQ_POLICY,
    policySha256: sha(canonicalJson(SINGLE_CASE_DOCKQ_POLICY)),
    inventory: { planned: planned.size, generated: generated.length, audited: audited.size, scored: scored.length, generationFailures: failures.filter(row => row.stage === 'generation').length, auditFailures: failures.filter(row => row.stage === 'audit').length, dockqFailures: failures.filter(row => row.stage === 'dockq').length, confidenceFailures: missingConfidence.length },
    confo, predictor, bestAvailableOracle: oracle,
    difference: confo ? { meanDockQ: confo.meanDockQ - predictor.meanDockQ, fractionAtLeast023: confo.fractionAtLeast023 - predictor.fractionAtLeast023 } : null,
    failures, candidateLedger: ledger,
    provenance: { canonicalInputSha256: sha(canonicalJson(input)), sourceBoundInputSha256: receipt.inputSha256, suppliedSourceBoundReceiptSha256: sha(canonicalJson(receipt)) },
    uncertainty: { estimated: false, confidenceInterval: null, pValue: null },
    claims: { sourceReceiptBindingsChecked: true, originalCloudRunVerified: false, coordinateBytesReaudited: false, dockqExecutionVerified: false, preOutcomeFreezeVerified: false, independentValidation: false, frozenV3Compatible: false, scientificSuperiorityEstablished: false },
    limitations: ['One declared development case and joint candidate pool; repeated seeds are sampling runs, not independent biological comparisons.', 'Ranks are consumed from supplied bound receipts. Byte/hash consistency does not authenticate original prediction, audit or DockQ execution, chronology, completeness or biological roles.', 'Producer confidence describes the supplied whole complex and can include chains or ligands outside the receptor–VHH pair evaluated by DockQ.', 'Selection summaries are conditional on generated candidates; generation failures remain in planned accounting. Missing generated-candidate audit, confidence or DockQ blocks the full paired comparison.', 'Best available DockQ is an outcome-informed oracle, not a deployable selector. An incomplete available oracle does not establish the best candidate in the full generated pool.', 'No confidence intervals, significance tests, binding conclusions or general ranking-performance claims are made.'],
  };
}

export function renderSingleCaseDockqMarkdown(report) {
  const number = value => value === null ? 'Unavailable' : value.toFixed(6);
  const row = (label, value) => value ? `| ${label} | ${value.candidateIds.join(', ')} | ${value.tiedCandidates} | ${number(value.meanDockQ)} | ${number(value.minDockQ)}–${number(value.maxDockQ)} | ${number(value.fractionAtLeast023)} | ${number(value.regretToBestAvailable)} |` : `| ${label} | Comparison withheld | — | — | — | — | — |`;
  const lines = [`${report.studyId}: ${report.status}`, '', 'One declared development case; no confidence interval or significance test.', '', '| Selector | All selected IDs | Ties | Mean DockQ | Min–max DockQ | Fraction ≥0.23 | Regret to best |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |', row('ConfoVHH', report.confo), row('Predictor confidence', report.predictor)];
  const oracle = report.bestAvailableOracle;
  lines.push(row(`Best available candidate (DockQ oracle)${oracle && !oracle.completeGeneratedPool ? ' — incomplete outcomes' : ''}`, oracle ? { candidateIds: oracle.candidateIds, tiedCandidates: oracle.candidateIds.length, meanDockQ: oracle.DockQ, minDockQ: oracle.DockQ, maxDockQ: oracle.DockQ, fractionAtLeast023: Number(oracle.DockQ >= 0.23), regretToBestAvailable: 0 } : null));
  lines.push('', oracle ? `Best available DockQ oracle: ${oracle.candidateIds.join(', ')}; DockQ ${number(oracle.DockQ)}; ${oracle.completeGeneratedPool ? 'complete' : 'incomplete'} generated-pool outcomes.` : 'Best available DockQ oracle: unavailable.');
  if (report.difference) lines.push(`ConfoVHH minus predictor mean DockQ: ${number(report.difference.meanDockQ)}.`);
  lines.push('', `Candidates: ${report.inventory.planned} planned; ${report.inventory.generated} generated; ${report.inventory.audited} audited; ${report.inventory.scored} DockQ-scored.`, `Failures: generation ${report.inventory.generationFailures}; audit ${report.inventory.auditFailures}; DockQ ${report.inventory.dockqFailures}; confidence ${report.inventory.confidenceFailures}.`, '', 'Predictor confidence describes the whole submitted complex and can include chains or ligands outside the receptor–VHH pair evaluated by DockQ.');
  if (report.failures.length) { lines.push('', '| Candidate | Failure stage | Reason |', '| --- | --- | --- |'); for (const failure of report.failures) lines.push(`| ${failure.id} | ${failure.stage} | ${failure.reason.replaceAll('|', '\\|').replace(/[\r\n]/gu, ' ')} |`); }
  return `${lines.join('\n')}\n`;
}

export async function runSingleCaseDockqFile(inputPath, outputPath) {
  // Reserve neither outcome nor markdown path by overwriting an existing file.
  check(outputPath.endsWith('.json'), 'Output must end with .json');
  const markdownPath = outputPath.slice(0, -5) + '.md';
  for (const filename of [outputPath, markdownPath]) { try { await lstat(filename); throw new Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const bytes = await readFile(inputPath); check(bytes.length <= 64_000_000, 'Input exceeds 64 MB');
  const report = compareSingleCaseDockq(strict(bytes));
  const receipt = { inputSha256: sha(bytes), evaluatorSha256: sha(await readFile(new URL(import.meta.url))), strictJsonParserSha256: sha(await readFile(new URL('../hard-decoy/oracle/canonical-json.mjs', import.meta.url))), nodeVersion: process.version, report };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await writeFile(markdownPath, renderSingleCaseDockqMarkdown(report), { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 2 && args[0].startsWith('--input=') && args[0].length > 8 && args[1].startsWith('--output=') && args[1].length > 9, 'Usage: node scripts/paper/compare-single-case-dockq.mjs --input=INPUT.json --output=NEW_RECEIPT.json');
    const receipt = await runSingleCaseDockqFile(args[0].slice(8), args[1].slice(9));
    process.stdout.write(renderSingleCaseDockqMarkdown(receipt.report));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
