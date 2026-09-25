#!/usr/bin/env node
/** Bound prediction inputs -> experimental source-first features and ranks. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { ARMS as V1_ARMS, rankFeatures } from '../external-ranking/score.mjs';
import { extractAuditFeature } from '../external-ranking-v2/score.mjs';
import { check, exact, finite, digest, rejectOutcomeKeys, validateInput, validateCalibration, assessValidity, invalidValidity, emptyCdr, decomposeCdr, rankSourceFirst } from './policy.mjs';
import { createContactOnlyEngine, projectAuditContacts, contactEvidenceDigest, validateContactEvidence } from './contact-only.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/frozen-source');
const LOCK = path.join(ROOT, 'validation/prospective-benchmark-v1/engine-lock.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  parseStrictJson(text, { maximumCharacters: 16_000_000, maximumTokens: 2_000_000, maximumDepth: 48 });
  return JSON.parse(text);
};
const saveBytes = async (filename, bytes) => { await writeFile(filename, bytes, { flag: 'wx' }); return sha(bytes); };
const save = (filename, object) => saveBytes(filename, Buffer.from(`${JSON.stringify(object, null, 2)}\n`));

async function boundBytes(root, binding) {
  check(typeof binding.path === 'string' && !path.isAbsolute(binding.path) && !binding.path.includes('\\') && !binding.path.split('/').includes('..') && digest(binding.sha256), 'Invalid bound path or digest');
  const filename = path.resolve(root, binding.path);
  check(filename.startsWith(`${root}${path.sep}`) && await realpath(filename) === filename, 'Indirect or escaping artifact');
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16_000_000 && (binding.bytes === undefined || binding.bytes === stat.size), 'Missing or changed bound artifact size');
  const raw = await readFile(filename);
  check(sha(raw) === binding.sha256, 'Bound artifact hash mismatch');
  return raw;
}

function pointerValue(object, pointer) {
  let current = object;
  if (pointer === '') return current;
  for (const encoded of pointer.slice(1).split('/')) {
    check(!/~(?:[^01]|$)/u.test(encoded), 'Invalid JSON pointer escape');
    const key = encoded.replace(/~1/gu, '/').replace(/~0/gu, '~');
    check(current !== null && typeof current === 'object' && Object.hasOwn(current, key), 'Source score pointer is absent');
    current = current[key];
  }
  return current;
}

/** Source recovery is deliberately independent of coordinate parsing success. */
async function recoverSource(attempt, generator, artifacts) {
  const source = { status: 'missing', rawValue: null, preferredValue: null, reason: '', binding: structuredClone(attempt.producerScore) };
  if (attempt.status !== 'generated') return { ...source, status: 'not-produced', reason: 'Source attempt did not produce a candidate' };
  if (attempt.producerScore === null) return { ...source, reason: 'No source-score binding supplied' };
  try {
    const object = decode(await boundBytes(artifacts, attempt.producerScore));
    rejectOutcomeKeys(object);
    const value = pointerValue(object, attempt.producerScore.jsonPointer);
    check(finite(value), 'Bound source score is not a finite number');
    return { ...source, status: 'present', rawValue: value, preferredValue: generator.direction === 'lower-better' ? -value : value };
  } catch (error) {
    return { ...source, status: 'invalid', reason: `${error.name}: ${error.message}` };
  }
}

async function verifiedParser(sourceReceipt) {
  const lockBytes = await readFile(LOCK), lock = decode(lockBytes);
  check(sourceReceipt.engineIdentity.lockSha256 === sha(lockBytes), 'Source frozen-engine lock differs');
  for (const [relative, binding] of Object.entries(lock.files)) {
    const filename = path.resolve(ENGINE, relative);
    check(filename.startsWith(`${ENGINE}${path.sep}`) && await realpath(filename) === filename, 'Indirect frozen engine file');
    const bytes = await readFile(filename);
    check(bytes.length === binding.bytes && sha(bytes) === binding.sha256, 'Frozen engine identity differs: '+relative);
  }
  const module = await import(pathToFileURL(path.join(ENGINE, 'lib/coordinate-parser.ts')));
  return { parse: module.parseCoordinateText, lockSha256: sha(lockBytes) };
}

function validateSourceLedger(sourceManifest, features, ledger) {
  const planned = new Map(sourceManifest.attempts.map(a => [a.id, a]));
  check(ledger.length === planned.size && new Set(ledger.map(a => a.id)).size === ledger.length, 'Source attempt ledger membership differs');
  const featureIds = new Set(features.map(f => f.id));
  for (const row of ledger) {
    exact(row, ['id', 'setId', 'generatorId', 'producerStatus', 'status', 'reason', 'producerScoreStatus', 'producerScoreReason']);
    const attempt = planned.get(row.id);
    check(attempt && attempt.setId === row.setId && attempt.generatorId === row.generatorId && attempt.status === row.producerStatus, 'Source ledger identity differs');
    check((row.status === 'scored') === featureIds.has(row.id), 'Source feature/scored ledger membership differs');
  }
}

export async function scoreSourceFirst(input, artifactRoot, outputDir) {
  input = structuredClone(input); validateInput(input);
  const base = await realpath(artifactRoot);
  const sourceReceiptRaw = await boundBytes(base, input.sourceScoreReceipt), sourceReceipt = decode(sourceReceiptRaw);
  exact(sourceReceipt, ['schema', 'studyId', 'status', 'manifestSha256', 'featuresSha256', 'attemptsSha256', 'ranksSha256', 'artifactHashes', 'adapterSha256', 'engineIdentity', 'runtime', 'arms', 'attemptCount', 'scoredCount', 'outcomeInputs', 'claims', 'policies']);
  check(sourceReceipt.schema === 'confovhh-external-development-score-receipt-v1' && sourceReceipt.studyId === input.studyId && isDeepStrictEqual(sourceReceipt.arms, V1_ARMS) && isDeepStrictEqual(sourceReceipt.outcomeInputs, []), 'Source receipt identity/arms/input isolation differs');
  const oldAdapterSha256 = sha(await readFile(new URL('../external-ranking/score.mjs', import.meta.url)));
  check(oldAdapterSha256 === sourceReceipt.adapterSha256, 'Current original adapter differs from source receipt');
  const sourceRoot = path.dirname(path.resolve(base, input.sourceScoreReceipt.path));
  const sourceRaw = {}, data = {};
  for (const [filename, field] of [['manifest.json', 'manifestSha256'], ['features.json', 'featuresSha256'], ['attempts.json', 'attemptsSha256'], ['ranks.json', 'ranksSha256']]) {
    sourceRaw[filename] = await boundBytes(sourceRoot, { path: filename, sha256: sourceReceipt[field] });
    data[filename] = decode(sourceRaw[filename]);
  }
  const manifest = data['manifest.json'], oldFeatures = data['features.json'], oldAttempts = data['attempts.json'];
  const { profiles, sets: policies } = validateInput(input, manifest);
  validateSourceLedger(manifest, oldFeatures, oldAttempts);
  rejectOutcomeKeys(oldFeatures); rejectOutcomeKeys(data['ranks.json']);
  check(sourceReceipt.attemptCount === manifest.attempts.length && sourceReceipt.scoredCount === oldFeatures.length && isDeepStrictEqual(data['ranks.json'], rankFeatures(oldFeatures, manifest, oldAttempts)), 'Original source ranks or inventory differ');
  const audits = new Map();
  for (const [relative, expectedSha256] of Object.entries(sourceReceipt.artifactHashes)) {
    check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\/(?:audit|overlaps|execution|attempt)\.json$/u.test(relative), 'Unexpected source artifact kind');
    const raw = await boundBytes(sourceRoot, { path: relative, sha256: expectedSha256 });
    if (relative.endsWith('/audit.json')) audits.set(relative, decode(raw));
  }
  const generators = new Map(manifest.generators.map(g => [g.id, g])), sets = new Map(manifest.sets.map(s => [s.id, s]));
  const calibrations = {};
  for (const profile of profiles.values()) {
    // Provenance is identity evidence only; its fields never enter ranking.
    if (profile.scoreProvenance !== null) await boundBytes(base, profile.scoreProvenance);
    if (profile.calibration !== null) {
      const record = decode(await boundBytes(base, profile.calibration));
      calibrations[profile.generatorId] = validateCalibration(record, profile, generators.get(profile.generatorId), input);
    }
  }
  const parser = await verifiedParser(sourceReceipt), featureMap = new Map(oldFeatures.map(f => [f.id, f]));
  const contactEngine = await createContactOnlyEngine(ENGINE, LOCK), sourceLedger = new Map(oldAttempts.map(a => [a.id, a]));
  const features = [], contactReports = [];
  for (const attempt of [...manifest.attempts].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const generator = generators.get(attempt.generatorId), set = sets.get(attempt.setId), policy = policies.get(attempt.setId);
    const source = await recoverSource(attempt, generator, base);
    const old = featureMap.get(attempt.id) ?? null;
    if (source.status === 'present' && old?.producerScore !== null && old?.producerScore !== undefined) check(source.rawValue === old.producerScore, 'Recovered source differs from sealed finite source score');
    let validity, structure;
    if (attempt.status !== 'generated') validity = invalidValidity('not-produced', attempt.reason, 'not-produced');
    else if (attempt.coordinate === null) validity = invalidValidity('coordinate-binding-absent');
    else {
      let coordinate;
      try { coordinate = await boundBytes(base, attempt.coordinate); }
      catch (error) { validity = invalidValidity('coordinate-binding-unavailable-or-invalid', `${error.name}: ${error.message}`); }
      if (coordinate !== undefined) {
        try {
          structure = parser.parse(new TextDecoder('utf-8', { fatal: true }).decode(coordinate), `${attempt.id}.${attempt.coordinate.format === 'pdb' ? 'pdb' : 'cif'}`, { modelId: set.selectedModelId });
          validity = assessValidity(structure, set, policy);
        } catch (error) { validity = invalidValidity('unparseable-coordinate-or-model', `${error.name}: ${error.message}`); }
      }
    }
    const auditPath = `${attempt.id}/audit.json`, report = audits.get(auditPath), auditSha256 = report ? sourceReceipt.artifactHashes[auditPath] : null;
    let contactEvidence = report ? { kind: 'full-audit', sha256: auditSha256 } : null;
    let cdr = emptyCdr('No bound scoring audit is available');
    let interfaceState = { status: validity.status === 'not-produced' ? 'not-produced' : validity.status === 'invalid' ? 'invalid-input' : 'unavailable', contactPairCount: null };
    if (old !== null) check(report !== undefined, 'Scored source feature lacks a bound audit');
    if (report !== undefined) {
      check(report.audit.receptorChain === set.receptorChain && report.audit.vhhChain === set.vhhChain, 'Source audit chain-role identity differs');
      check(report.structure.sourceFileSha256 === attempt.coordinate?.sha256 && report.structure.selectedModelId === set.selectedModelId, 'Source audit coordinate/model identity differs');
      if (old !== null) extractAuditFeature(attempt, old, report, auditSha256);
      if (validity.status === 'valid') {
        check(isDeepStrictEqual(contactEngine.analyze(structure, set.receptorChain, set.vhhChain), projectAuditContacts(report.audit)), 'Frozen contact phase differs from authoritative full audit');
        cdr = decomposeCdr(report.audit);
        interfaceState = { status: report.audit.contactPairCount > 0 ? 'contacting' : 'no-contact', contactPairCount: report.audit.contactPairCount };
      } else cdr = emptyCdr('Invalid coordinate input; optional CDR data is not applied');
    } else if (validity.status === 'valid') {
      const prior = sourceLedger.get(attempt.id);
      const evidence = { schema: 'confovhh-standalone-contact-evidence-v1', id: attempt.id, setId: attempt.setId, coordinateSha256: attempt.coordinate.sha256,
        sourceScoreReceiptSha256: sha(sourceReceiptRaw), receptorChain: set.receptorChain, vhhChain: set.vhhChain, selectedModelId: set.selectedModelId,
        fullAuditDisposition: { status: 'absent', sourceAttemptStatus: prior.status, reason: prior.reason }, method: contactEngine.method, status: 'unavailable', reason: '', contact: null };
      try { evidence.contact = contactEngine.analyze(structure, set.receptorChain, set.vhhChain); evidence.status = 'computed'; }
      catch (error) { evidence.reason = `${error.name}: ${error.message}`; }
      if (evidence.status === 'computed') {
        cdr = decomposeCdr(evidence.contact);
        interfaceState = { status: evidence.contact.contactPairCount > 0 ? 'contacting' : 'no-contact', contactPairCount: evidence.contact.contactPairCount };
      } else cdr = emptyCdr('Standalone frozen contact phase unavailable: '+evidence.reason);
      contactReports.push(evidence); contactEvidence = { kind: 'standalone-contact', sha256: contactEvidenceDigest(evidence) };
    }
    features.push({ id: attempt.id, setId: attempt.setId, generatorId: attempt.generatorId, producerStatus: attempt.status,
      coordinateSha256: attempt.coordinate?.sha256 ?? null, sourceAuditSha256: auditSha256, contactEvidence, source, validity, interface: interfaceState, cdr });
  }
  validateContactEvidence(features, contactReports, manifest, sha(sourceReceiptRaw), contactEngine.method);
  const { arms, ranks, blocks } = rankSourceFirst({ input, sourceManifest: manifest, features, calibrations });
  const attempts = features.map(f => ({ id: f.id, setId: f.setId, generatorId: f.generatorId, producerStatus: f.producerStatus, sourceStatus: f.source.status,
    validityStatus: f.validity.status, interfaceStatus: f.interface.status, optionalCdrStatus: f.cdr.status, sourceReason: f.source.reason, validityReasonCodes: f.validity.reasonCodes }));
  await mkdir(outputDir, { recursive: false });
  const files = {};
  files['manifest.json'] = await save(path.join(outputDir, 'manifest.json'), input);
  files['source-score-receipt.json'] = await saveBytes(path.join(outputDir, 'source-score-receipt.json'), sourceReceiptRaw);
  for (const [name, raw] of Object.entries(sourceRaw)) files['source-'+name] = await saveBytes(path.join(outputDir, 'source-'+name), raw);
  for (const [name, object] of Object.entries({ 'features.json': features, 'attempts.json': attempts, 'ranks.json': ranks, 'blocks.json': blocks, 'calibrations.json': calibrations, 'contact-evidence.json': contactReports })) files[name] = await save(path.join(outputDir, name), object);
  const implementation = {};
  for (const relative of ['scripts/external-ranking-v3/score.mjs', 'scripts/external-ranking-v3/policy.mjs', 'scripts/external-ranking-v3/contact-only.mjs', 'scripts/external-ranking-v2/score.mjs', 'scripts/external-ranking/score.mjs']) implementation[relative] = sha(await readFile(path.join(ROOT, relative)));
  const receipt = { schema: 'confovhh-source-first-receipt-v3', studyId: input.studyId, evaluationRole: input.evaluationRole,
    status: ranks.every(r => r.status === 'ranked') ? 'COMPLETE' : 'COMPLETE_WITH_EXPLICIT_SELECTION_ABSTENTIONS',
    files, sourceScoreReceiptSha256: sha(sourceReceiptRaw), sourceManifestSha256: sourceReceipt.manifestSha256, sourceRanksSha256: sourceReceipt.ranksSha256,
    implementation, frozenParserLockSha256: parser.lockSha256, arms, plannedCount: features.length,
    sourceAvailableCount: features.filter(f => f.source.status === 'present').length, validInputCount: features.filter(f => f.validity.status === 'valid').length,
    invalidInputCount: features.filter(f => f.validity.status === 'invalid').length,
    sourceRecoveredWithoutV1CoordinateFeatureCount: features.filter(f => !featureMap.has(f.id) && f.source.status === 'present').length,
    standaloneContactEvidenceCount: contactReports.length, standaloneContactComputedCount: contactReports.filter(r => r.status === 'computed').length, contactMethod: contactEngine.method,
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch }, outcomeInputs: [],
    claims: { experimentalOnly: true, productionDefaultChanged: false, weightsFittedHere: false, tolerancesSelectedHere: false, calibrationEvidenceOutcomesOpened: false,
      noContactIsNotInputCorruption: true, missingOptionalFeaturesFallBackToSource: true, allPlannedAttemptsRetained: true, roleBiologyInferredFromNumbering: false },
    policies: { validity: 'Prediction-side parse/identity/finite-coordinate integrity; diagnostic backbone distances never reject, including virtual-chain joins',
      exactFloor: 'Always present; optional CDR only breaks complete source-score tie blocks', calibratedTolerance: 'Separately bound development-selected producer/version/context tolerance; not calibrated confidence uncertainty',
      optionalMissingness: 'Preserve entire block source ordering when any member lacks optional CDR data', allNoContact: 'Preserve source ranking with explicit unsupported interface metadata',
      missingSource: 'Selection abstains for any eligible missing source; source-validity excludes invalid candidates transparently before checking source completeness',
      cdrConfound: 'P includes all interface contacts in denominator; CDR/framework/unnumbered components are exposed and only P is used' } };
  await save(path.join(outputDir, 'receipt.json'), receipt);
  return { receipt, features, attempts, ranks, blocks, calibrations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 6 && args[0] === '--input' && args[2] === '--artifacts' && args[4] === '--output', 'Usage: score.mjs --input INPUT.json --artifacts DIRECTORY --output NEW_DIRECTORY');
    process.stdout.write(`${JSON.stringify((await scoreSourceFirst(decode(await readFile(args[1])), args[3], args[5])).receipt)}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
