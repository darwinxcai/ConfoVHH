#!/usr/bin/env node
/** Fixed development selectors. Reads hash-bound prediction features only. */
import { createHash } from 'node:crypto';
import { readFile, realpath, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ARMS as ORIGINAL_ARMS, validateManifest, rankFeatures } from '../external-ranking/score.mjs';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

export const NEW_ARMS = Object.freeze(['hybrid-SG', 'G-paratope', 'G-polar', 'G-density', 'H-paratope', 'H-polar', 'H-density']);
export const ARMS = Object.freeze([...ORIGINAL_ARMS, ...NEW_ARMS]);
const WEIGHTS = Object.freeze({ 'hybrid-SG': { S: .5, G: .5 }, 'G-paratope': { G: .5, P: .5 }, 'G-polar': { G: .5, F: .5 }, 'G-density': { G: .5, D: .5 }, 'H-paratope': { S: .5, G: .25, P: .25 }, 'H-polar': { S: .5, G: .25, F: .25 }, 'H-density': { S: .5, G: .25, D: .25 } });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = n => typeof n === 'number' && Number.isFinite(n);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const exact = (object, keys) => check(object !== null && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join('|') === [...keys].sort().join('|'), 'Unexpected or absent fields');
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/u.test(s);
const decode = bytes => {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  // Strict parser rejects duplicates/nonfinite values; materialize ordinary JSON
  // objects so source replay compares values rather than parser prototypes.
  parseStrictJson(text, { maximumCharacters: 16_000_000, maximumTokens: 2_000_000, maximumDepth: 48 });
  return JSON.parse(text);
};
const save = async (filename, object) => {
  const bytes = Buffer.from(`${JSON.stringify(object, null, 2)}\n`);
  await writeFile(filename, bytes, { flag: 'wx' });
  return sha(bytes);
};

function rejectOutcomeKeys(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check(!/(?:dockq|(^|_)i?rmsd?$|(^|_)lrmsd?$|fnat|nativecontact|native_contact|groundtruth|ground_truth|__proto__|constructor|prototype)/iu.test(key), 'Outcome-like or unsafe input key');
    rejectOutcomeKeys(child);
  }
}

export function validateInput(input) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  exact(input, ['schema', 'studyId', 'sourceScoreReceipt']);
  check(input.schema === 'confovhh-external-development-input-v2' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(input.studyId), 'Invalid selector input identity');
  exact(input.sourceScoreReceipt, ['path', 'bytes', 'sha256']);
  const b = input.sourceScoreReceipt;
  check(typeof b.path === 'string' && b.path.length && !path.isAbsolute(b.path) && !b.path.split(/[\\/]/u).includes('..') && !b.path.includes('\\'), 'Unsafe receipt path');
  check(Number.isSafeInteger(b.bytes) && b.bytes > 0 && b.bytes <= 16_000_000 && digest(b.sha256), 'Invalid receipt binding');
}

/** Best = 1, worst = 0, average ordinal ranks for exact ties; singleton = .5. */
export function preferredPercentiles(values) {
  check(Array.isArray(values) && values.length > 0 && values.every(finite), 'Percentiles require a complete finite planned set');
  if (values.length === 1) return [.5];
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const result = Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && order[end].value === order[start].value) end += 1;
    const averageOrdinalRank = (start + 1 + end) / 2;
    for (let i = start; i < end; i += 1) result[order[i].index] = (order.length - averageOrdinalRank) / (order.length - 1);
    start = end;
  }
  return result;
}

const AUDIT_FIELDS = 'version confidenceMode receptorChain vhhChain evidenceLevel contactPairCount atomContactCount receptorInterfaceResidues vhhInterfaceResidues polarContactProxyCount saltBridgeProxyCount severeClashCount possibleInterchainDisulfideCount maximumOverlapAngstrom paratopeProxyShare cdr3ProxyShare interfaceConfidence interfaceConfidenceCoverage deltaSasaAngstrom2 receptorBuriedSurfaceAreaAngstrom2 vhhBuriedSurfaceAreaAngstrom2 halfDeltaSasaInterfaceAreaAngstrom2 interfacePaeMedianAngstrom interfacePaeP90Angstrom receptorFrameToVhhPaeMedianAngstrom vhhFrameToReceptorPaeMedianAngstrom receptorFrameToVhhPaeP90Angstrom vhhFrameToReceptorPaeP90Angstrom lowPaeContactShare paeFilename paeOrderConfirmed vhhNumbering contacts receptorInterfaceKeys vhhInterfaceKeys findings warnings methods rationale auditAttestation'.split(' ');
const EXTENDED_FIELDS = 'id setId generatorId coordinateSha256 sourceFeature sourceAuditSha256 vhhNumberingStatus paratopeProxyShare polarContactProxyCount polarContactProxyPerResiduePair nonclashingContactDensity missingReasons'.split(' ');

export function extractAuditFeature(attempt, sourceFeature, report, auditSha256) {
  const result = { id: attempt.id, setId: attempt.setId, generatorId: attempt.generatorId, coordinateSha256: sourceFeature?.coordinateSha256 ?? null,
    sourceFeature: sourceFeature === null ? null : structuredClone(sourceFeature), sourceAuditSha256: auditSha256, vhhNumberingStatus: null,
    paratopeProxyShare: null, polarContactProxyCount: null, polarContactProxyPerResiduePair: null, nonclashingContactDensity: null,
    missingReasons: { P: '', F: '', D: '' } };
  if (sourceFeature === null) {
    check(report === null && auditSha256 === null, 'Audit without scored source feature');
    for (const key of ['P', 'F', 'D']) result.missingReasons[key] = 'Source candidate was not scored';
    return result;
  }
  check(report !== null && digest(auditSha256), 'Scored candidate requires a bound audit');
  rejectOutcomeKeys(report);
  exact(report, ['schemaVersion', 'softwareVersion', 'generatedAt', 'file', 'structure', 'pae', 'auditPolicy', 'audit']);
  exact(report.audit, AUDIT_FIELDS);
  const audit = report.audit, b = sourceFeature.burial, n = sourceFeature.contacts, c = sourceFeature.clashes;
  check(sourceFeature.id === attempt.id && sourceFeature.setId === attempt.setId && sourceFeature.generatorId === attempt.generatorId, 'Source feature identity mismatch');
  check(report.structure.sourceFileSha256 === sourceFeature.coordinateSha256 && sourceFeature.coordinateSha256 === attempt.coordinate?.sha256, 'Audit coordinate identity mismatch');
  check(audit.contactPairCount === n && audit.severeClashCount === c && audit.halfDeltaSasaInterfaceAreaAngstrom2 === b, 'Audit N/C/B differs from sealed source feature');
  exact(audit.vhhNumbering, ['status', 'scheme', 'engine', 'confidence', 'cdrLengths', 'error']);
  result.vhhNumberingStatus = audit.vhhNumbering.status;
  result.polarContactProxyCount = finite(audit.polarContactProxyCount) ? audit.polarContactProxyCount : null;
  if (audit.vhhNumbering.status === 'numbered' && finite(audit.paratopeProxyShare) && audit.paratopeProxyShare >= 0 && audit.paratopeProxyShare <= 1) result.paratopeProxyShare = audit.paratopeProxyShare;
  else result.missingReasons.P = 'IMGT-numbered paratope proxy is unavailable or invalid';
  if (Number.isSafeInteger(n) && n > 0 && Number.isSafeInteger(audit.polarContactProxyCount) && audit.polarContactProxyCount >= 0) result.polarContactProxyPerResiduePair = audit.polarContactProxyCount / n;
  else result.missingReasons.F = 'Positive residue-pair contact count and nonnegative integer polar proxy count required';
  if (finite(b) && b > 0 && Number.isSafeInteger(n) && n > 0 && Number.isSafeInteger(c) && c >= 0 && c <= n) result.nonclashingContactDensity = (n - c) / b;
  else result.missingReasons.D = 'Positive burial and contact count with valid severe clash count required';
  return result;
}

function validateExtended(feature, attempt, sourceFeature) {
  exact(feature, EXTENDED_FIELDS);
  exact(feature.missingReasons, ['P', 'F', 'D']);
  rejectOutcomeKeys(feature);
  check(feature.id === attempt.id && feature.setId === attempt.setId && feature.generatorId === attempt.generatorId && isDeepStrictEqual(feature.sourceFeature, sourceFeature), 'Extended feature source identity mismatch');
  check(feature.coordinateSha256 === (sourceFeature?.coordinateSha256 ?? null), 'Extended coordinate identity mismatch');
  check(feature.sourceAuditSha256 === null ? sourceFeature === null : digest(feature.sourceAuditSha256) && sourceFeature !== null, 'Missing audit digest');
  for (const [component, field] of [['P', 'paratopeProxyShare'], ['F', 'polarContactProxyPerResiduePair'], ['D', 'nonclashingContactDensity']]) {
    check(feature[field] === null || finite(feature[field]) && feature[field] >= 0, 'Invalid extended feature scalar');
    check(typeof feature.missingReasons[component] === 'string' && (feature[field] === null ? feature.missingReasons[component].length > 0 : feature.missingReasons[component] === ''), 'Feature missingness reason mismatch');
  }
  check(feature.paratopeProxyShare === null || feature.vhhNumberingStatus === 'numbered' && feature.paratopeProxyShare <= 1, 'Paratope proxy requires valid numbering');
  check(feature.polarContactProxyCount === null || Number.isSafeInteger(feature.polarContactProxyCount) && feature.polarContactProxyCount >= 0, 'Invalid polar proxy count');
  if (feature.polarContactProxyPerResiduePair !== null) check(sourceFeature.contacts > 0 && feature.polarContactProxyPerResiduePair === feature.polarContactProxyCount / sourceFeature.contacts, 'Polar proxy formula changed');
  if (feature.nonclashingContactDensity !== null) check(sourceFeature.burial > 0 && sourceFeature.contacts > 0 && feature.nonclashingContactDensity === (sourceFeature.contacts - sourceFeature.clashes) / sourceFeature.burial, 'Density formula changed');
}

function validateLedger(ledger, manifest, features) {
  check(Array.isArray(ledger) && ledger.length === manifest.attempts.length && new Set(ledger.map(a => a.id)).size === ledger.length, 'Attempt ledger membership mismatch');
  const planned = new Map(manifest.attempts.map(a => [a.id, a]));
  const featureIds = new Set(features.map(f => f.id));
  for (const a of ledger) {
    exact(a, ['id', 'setId', 'generatorId', 'producerStatus', 'status', 'reason', 'producerScoreStatus', 'producerScoreReason']);
    check(['scored', 'evaluation-failed', 'failed', 'not-run'].includes(a.status), 'Invalid attempt status');
    const attempt = planned.get(a.id);
    check(attempt && a.setId === attempt.setId && a.generatorId === attempt.generatorId && a.producerStatus === attempt.status, 'Attempt ledger identity mismatch');
    check((a.status === 'scored') === featureIds.has(a.id), 'Attempt ledger and source feature membership disagree');
    check(attempt.status === 'generated' ? ['scored', 'evaluation-failed'].includes(a.status) : a.status === attempt.status, 'Attempt ledger disposition mismatch');
  }
}

/** Original five arms are checked against their original function, then copied. */
export function rankExperimental(data) {
  exact(data, ['sourceManifest', 'sourceFeatures', 'sourceAttempts', 'sourceRanks', 'features']);
  const { sourceManifest, sourceFeatures, sourceAttempts, sourceRanks, features } = data;
  validateManifest(sourceManifest); validateLedger(sourceAttempts, sourceManifest, sourceFeatures);
  rejectOutcomeKeys(sourceFeatures); rejectOutcomeKeys(sourceRanks);
  const expectedOld = rankFeatures(sourceFeatures, sourceManifest, sourceAttempts);
  check(isDeepStrictEqual(sourceRanks, expectedOld), 'Original five saved rankings differ from unchanged selector');
  check(features.length === sourceManifest.attempts.length && new Set(features.map(f => f.id)).size === features.length, 'Extended feature membership mismatch');
  const featureMap = new Map(features.map(f => [f.id, f]));
  for (const attempt of sourceManifest.attempts) {
    const original = sourceFeatures.find(f => f.id === attempt.id) ?? null;
    check(featureMap.has(attempt.id), 'Missing planned extended feature');
    validateExtended(featureMap.get(attempt.id), attempt, original);
  }
  const ranks = structuredClone(sourceRanks), percentiles = [];
  for (const set of [...sourceManifest.sets].sort((a, b) => a.id.localeCompare(b.id))) {
    const attempts = sourceManifest.attempts.filter(a => a.setId === set.id).sort((a, b) => a.id.localeCompare(b.id));
    const old = arm => sourceRanks.find(r => r.setId === set.id && r.arm === arm);
    const componentValues = {
      S: attempts.map(a => old('producer-score').rows.find(r => r.id === a.id).key?.[0] ?? null),
      G: attempts.map(a => old('overlap-burial-v1').rows.find(r => r.id === a.id).key?.[0] ?? null),
      P: attempts.map(a => featureMap.get(a.id).paratopeProxyShare),
      F: attempts.map(a => featureMap.get(a.id).polarContactProxyPerResiduePair),
      D: attempts.map(a => featureMap.get(a.id).nonclashingContactDensity),
    };
    const values = {};
    for (const [component, rawValues] of Object.entries(componentValues)) {
      const complete = rawValues.every(finite);
      values[component] = complete ? preferredPercentiles(rawValues) : null;
      percentiles.push({ setId: set.id, component, status: complete ? 'complete' : 'unavailable',
        reason: complete ? '' : 'At least one planned candidate lacks this component; no subset normalization',
        rows: attempts.map((a, i) => ({ id: a.id, value: rawValues[i], percentile: values[component]?.[i] ?? null })) });
    }
    for (const arm of NEW_ARMS) {
      const missing = Object.keys(WEIGHTS[arm]).filter(component => values[component] === null);
      const complete = missing.length === 0;
      const reason = complete ? '' : `Required component unavailable across complete planned set: ${missing.join(', ')}; whole arm abstains`;
      const rows = attempts.map((a, i) => ({ id: a.id, key: complete ? [Object.entries(WEIGHTS[arm]).reduce((sum, [component, weight]) => sum + weight * values[component][i], 0)] : null,
        rank: null, status: complete ? 'scored' : 'unavailable', reason }));
      if (complete) {
        const ordered = [...rows].sort((a, b) => b.key[0] - a.key[0]);
        let rank = 0, previous = null;
        for (const row of ordered) { if (previous === null || previous !== row.key[0]) rank += 1; row.rank = rank; previous = row.key[0]; }
      }
      ranks.push({ setId: set.id, arm, scoreName: arm, direction: 'higher-better', status: complete ? 'ranked' : 'abstain', reason,
        selected: complete ? rows.filter(r => r.rank === 1).map(r => r.id) : [], rows });
    }
  }
  return { ranks, percentiles };
}

async function verifiedBytes(root, relative, expectedDigest, expectedBytes = null) {
  check(typeof relative === 'string' && relative.length && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).includes('..') && !relative.includes('\\') && digest(expectedDigest), 'Invalid bound artifact path or digest');
  const filename = path.resolve(root, relative);
  check(filename.startsWith(`${root}${path.sep}`) && await realpath(filename) === filename, 'Indirect or escaping artifact');
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16_000_000 && (expectedBytes === null || stat.size === expectedBytes), 'Changed artifact size');
  const bytes = await readFile(filename);
  check(sha(bytes) === expectedDigest && (expectedBytes === null || bytes.length === expectedBytes), 'Artifact hash mismatch');
  return bytes;
}

export async function scoreExperimental(input, artifactRoot, outputDir) {
  input = structuredClone(input); validateInput(input);
  const base = await realpath(artifactRoot);
  const sourceBytes = await verifiedBytes(base, input.sourceScoreReceipt.path, input.sourceScoreReceipt.sha256, input.sourceScoreReceipt.bytes);
  const source = decode(sourceBytes), sourceRoot = path.dirname(path.resolve(base, input.sourceScoreReceipt.path));
  exact(source, ['schema', 'studyId', 'status', 'manifestSha256', 'featuresSha256', 'attemptsSha256', 'ranksSha256', 'artifactHashes', 'adapterSha256', 'engineIdentity', 'runtime', 'arms', 'attemptCount', 'scoredCount', 'outcomeInputs', 'claims', 'policies']);
  check(source.schema === 'confovhh-external-development-score-receipt-v1' && source.studyId === input.studyId && isDeepStrictEqual(source.arms, ORIGINAL_ARMS) && isDeepStrictEqual(source.outcomeInputs, []), 'Source receipt identity, arms or outcome isolation mismatch');
  const originalAdapterSha256 = sha(await readFile(new URL('../external-ranking/score.mjs', import.meta.url)));
  check(originalAdapterSha256 === source.adapterSha256, 'Current original adapter differs from source receipt');
  const inputs = {};
  for (const [filename, field] of [['manifest.json', 'manifestSha256'], ['features.json', 'featuresSha256'], ['attempts.json', 'attemptsSha256'], ['ranks.json', 'ranksSha256']]) inputs[filename] = decode(await verifiedBytes(sourceRoot, filename, source[field]));
  const sourceManifest = inputs['manifest.json'], sourceFeatures = inputs['features.json'], sourceAttempts = inputs['attempts.json'], sourceRanks = inputs['ranks.json'];
  validateManifest(sourceManifest); validateLedger(sourceAttempts, sourceManifest, sourceFeatures);
  check(sourceManifest.studyId === input.studyId && source.attemptCount === sourceManifest.attempts.length && source.scoredCount === sourceFeatures.length, 'Source inventory mismatch');
  check(isDeepStrictEqual(sourceRanks, rankFeatures(sourceFeatures, sourceManifest, sourceAttempts)), 'Source saved ranks do not replay exactly');
  const artifacts = {};
  for (const [relative, hash] of Object.entries(source.artifactHashes)) {
    check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\/(?:audit|overlaps|execution|attempt)\.json$/u.test(relative), 'Unexpected source artifact kind');
    // Hash all bound provenance. Parse only the prediction audit needed for new features.
    const bytes = await verifiedBytes(sourceRoot, relative, hash);
    if (relative.endsWith('/audit.json')) artifacts[relative] = decode(bytes);
  }
  const features = [...sourceManifest.attempts].sort((a, b) => a.id.localeCompare(b.id)).map(attempt => {
    const feature = sourceFeatures.find(f => f.id === attempt.id) ?? null, relative = `${attempt.id}/audit.json`;
    if (feature === null) return extractAuditFeature(attempt, null, null, null);
    const report = artifacts[relative];
    check(report !== undefined, 'Scored candidate audit absent from source receipt');
    const set = sourceManifest.sets.find(s => s.id === attempt.setId);
    check(report.audit.receptorChain === set.receptorChain && report.audit.vhhChain === set.vhhChain, 'Audit chain roles differ from manifest');
    return extractAuditFeature(attempt, feature, report, source.artifactHashes[relative]);
  });
  const { ranks, percentiles } = rankExperimental({ sourceManifest, sourceFeatures, sourceAttempts, sourceRanks, features });
  await mkdir(outputDir, { recursive: false });
  const manifestSha256 = await save(path.join(outputDir, 'manifest.json'), input);
  const sourceManifestSha256 = await save(path.join(outputDir, 'source-manifest.json'), sourceManifest);
  const sourceFeaturesSha256 = await save(path.join(outputDir, 'source-features.json'), sourceFeatures);
  const sourceRanksSha256 = await save(path.join(outputDir, 'source-ranks.json'), sourceRanks);
  const sourceScoreReceiptSha256 = await save(path.join(outputDir, 'source-score-receipt.json'), source);
  check(sourceManifestSha256 === source.manifestSha256 && sourceFeaturesSha256 === source.featuresSha256 && sourceRanksSha256 === source.ranksSha256 && sourceScoreReceiptSha256 === input.sourceScoreReceipt.sha256, 'Source canonical bytes differ; receipt copying must preserve original serialization');
  const featuresSha256 = await save(path.join(outputDir, 'features.json'), features);
  const attemptsSha256 = await save(path.join(outputDir, 'attempts.json'), sourceAttempts);
  const ranksSha256 = await save(path.join(outputDir, 'ranks.json'), ranks);
  const percentilesSha256 = await save(path.join(outputDir, 'percentiles.json'), percentiles);
  const receipt = { schema: 'confovhh-external-development-score-receipt-v2', studyId: input.studyId,
    status: ranks.every(r => r.status === 'ranked') ? 'COMPLETE' : 'RECORDED_WITH_FAILURES_OR_ABSTENTIONS',
    manifestSha256, featuresSha256, attemptsSha256, ranksSha256, percentilesSha256,
    sourceScoreReceiptSha256, sourceManifestSha256, sourceFeaturesSha256, sourceRanksSha256,
    adapterSha256: sha(await readFile(new URL(import.meta.url))), originalAdapterSha256,
    arms: ARMS, attemptCount: source.attemptCount, scoredCount: source.scoredCount, outcomeInputs: [],
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    claims: { developmentOnly: true, independentValidation: false, productionScoringChanged: false, referenceUsedForRanking: false, sourceProducerExecutionAuthenticated: false },
    policies: { originalFiveArms: 'Copied unchanged after exact original-selector replay', percentile: '(n-averageOrdinalRank)/(n-1); exact ties average; singleton .5',
      sourceDirection: 'Already oriented higher-better by original producer-score key', missingScore: 'Whole arm/set abstention; no dropped rows or subset normalization', scientificTieRule: 'Exact numeric keys; IDs serialize only; complete top tie retained',
      P: 'paratopeProxyShare only when vhhNumbering.status equals numbered', F: 'polarContactProxyCount/N; distance proxy intensity per residue pair, not hydrogen-bond energy or bounded fraction', D: '(N-C)/B with B>0 and N>0',
      weights: WEIGHTS, fittedWeights: false, thresholdSweeps: false } };
  await save(path.join(outputDir, 'receipt.json'), receipt);
  return { receipt, features, attempts: sourceAttempts, ranks, percentiles };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 6 && args[0] === '--input' && args[2] === '--artifacts' && args[4] === '--output', 'Usage: score.mjs --input manifest.json --artifacts DIRECTORY --output NEW_DIRECTORY');
    process.stdout.write(`${JSON.stringify((await scoreExperimental(decode(await readFile(args[1])), args[3], args[5])).receipt)}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
