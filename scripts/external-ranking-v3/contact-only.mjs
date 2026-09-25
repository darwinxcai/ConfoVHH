/** Experimental, byte-locked contact phase of the frozen audit. No SASA runs. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { check, exact, decomposeCdr, rejectOutcomeKeys } from './policy.mjs';

const SOURCE_SHA = '15f25a465e0c357a7a59c0e0d57b4e50aad76f16647dc02ab835613c33a51edf';
const START = 'export function analyzeInterface(';
const STOP = '  const interfaceConfidenceValues = confidenceMode === "plddt"';
export const CONTACT_FIELDS = Object.freeze(['contactPairCount', 'atomContactCount', 'paratopeProxyShare', 'cdr3ProxyShare', 'vhhNumbering', 'contacts']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const contactEvidenceDigest = object => sha(`${JSON.stringify(object)}\n`);

export function projectAuditContacts(audit) {
  const result = Object.fromEntries(CONTACT_FIELDS.map(key => [key, audit[key]]));
  result.vhhNumbering = Object.fromEntries(['status', 'scheme', 'engine', 'confidence', 'cdrLengths', 'error'].map(key => [key, audit.vhhNumbering[key]]));
  return result;
}

/** Source extraction is explicit; private scientific helpers/loop are unchanged. */
export function deriveContactModule(sourceBytes, engineRoot) {
  check(sha(sourceBytes) === SOURCE_SHA, 'Contact derivation requires exact frozen interface source');
  const source = sourceBytes.toString('utf8');
  check(source.split(START).length === 2 && source.split(STOP).length === 2, 'Contact extraction boundaries differ');
  const stop = source.indexOf(STOP), prefix = source.slice(0, stop);
  check(stop > source.indexOf(START), 'Contact extraction boundary order differs');
  let module = prefix.replace(START, 'export function analyzeContactOnly(');
  // A temporary module lives outside the frozen tree; resolve only its original
  // relative imports to that same verified tree. No scientific expressions change.
  module = module.replace(/from "(\.\/[^"\n]+)"/gu, (_, relative) => `from ${JSON.stringify(pathToFileURL(path.resolve(engineRoot, 'lib', relative)).href)}`);
  module += `  return { contactPairCount: contacts.length, atomContactCount, paratopeProxyShare, cdr3ProxyShare, vhhNumbering, contacts };\n}\n`;
  return { module, prefixSha256: sha(prefix), sourceSha256: sha(sourceBytes) };
}

export async function createContactOnlyEngine(engineRoot, lockPath) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  const lockBytes = await readFile(lockPath), lock = JSON.parse(lockBytes);
  for (const [relative, expected] of Object.entries(lock.files)) {
    const filename = path.resolve(engineRoot, relative);
    check(filename.startsWith(engineRoot+path.sep) && await realpath(filename) === filename, 'Indirect frozen contact dependency');
    const bytes = await readFile(filename);
    check(bytes.length === expected.bytes && sha(bytes) === expected.sha256, 'Frozen contact dependency differs: '+relative);
  }
  const resolved = createRequire(pathToFileURL(path.join(engineRoot, 'lib/vhh-numbering-v06.ts'))).resolve('immunum');
  check(resolved === path.join(engineRoot, 'node_modules/immunum/immunum.js') && await realpath(resolved) === resolved, 'Contact numbering resolution differs');
  const derived = deriveContactModule(await readFile(path.join(engineRoot, 'lib/confovhh.ts')), engineRoot);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'confovhh-contact-phase-'));
  let analyze;
  try {
    const filename = path.join(temporary, 'contact-phase.ts');
    await writeFile(filename, derived.module, { flag: 'wx' });
    analyze = (await import(pathToFileURL(filename))).analyzeContactOnly;
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const parser = (await import(pathToFileURL(path.join(engineRoot, 'lib/coordinate-parser.ts')))).parseCoordinateText;
  return { parse: parser, analyze: (structure, receptorChain, vhhChain) => projectAuditContacts(analyze(structure, receptorChain, vhhChain, 'none')),
    method: { schema: 'confovhh-frozen-contact-phase-method-v1', derivation: 'unchanged-frozen-source-prefix-before-interface-confidence-and-sasa-v1',
      engineLockSha256: sha(lockBytes), frozenInterfaceSourceSha256: derived.sourceSha256, scientificPrefixSha256: derived.prefixSha256,
      adapterSha256: sha(await readFile(new URL(import.meta.url))), contactCutoffAngstromInclusive: 4.5,
      maximumCandidateAtomPairs: 5000000, maximumUniqueResiduePairs: 50000, sasaExecuted: false,
      fullAuditAtomLimitApplied: false, fullAuditLimitsChanged: false, allParsedSelectedRoleAtomsRetained: true, additionalAtomTrimming: false } };
}

/** Authenticate the in-file report bindings before consumers join labels. */
export function validateContactEvidence(features, reports, sourceManifest, sourceReceiptSha256, expectedMethod = null) {
  check(Array.isArray(reports), 'Standalone contact evidence must be an array');
  rejectOutcomeKeys(reports);
  const byId = new Map(), attempts = new Map(sourceManifest.attempts.map(a => [a.id, a])), sets = new Map(sourceManifest.sets.map(s => [s.id, s]));
  for (const report of reports) {
    exact(report, ['schema', 'id', 'setId', 'coordinateSha256', 'sourceScoreReceiptSha256', 'receptorChain', 'vhhChain', 'selectedModelId', 'fullAuditDisposition', 'method', 'status', 'reason', 'contact']);
    const attempt = attempts.get(report.id), set = attempt && sets.get(attempt.setId);
    check(attempt && !byId.has(report.id) && report.schema === 'confovhh-standalone-contact-evidence-v1' && report.setId === attempt.setId && report.coordinateSha256 === attempt.coordinate?.sha256 && report.sourceScoreReceiptSha256 === sourceReceiptSha256, 'Standalone contact identity differs');
    check(report.receptorChain === set.receptorChain && report.vhhChain === set.vhhChain && report.selectedModelId === set.selectedModelId, 'Standalone contact role/model differs');
    exact(report.fullAuditDisposition, ['status', 'sourceAttemptStatus', 'reason']);
    check(report.fullAuditDisposition.status === 'absent' && typeof report.fullAuditDisposition.reason === 'string', 'Standalone contact may not replace a present full audit');
    if (expectedMethod !== null) check(isDeepStrictEqual(report.method, expectedMethod), 'Standalone contact method differs');
    check(['computed', 'unavailable'].includes(report.status) && (report.status === 'computed' ? report.reason === '' && report.contact !== null : report.contact === null && typeof report.reason === 'string' && report.reason.length > 0), 'Standalone contact disposition differs');
    if (report.contact !== null) { exact(report.contact, CONTACT_FIELDS); decomposeCdr(report.contact); }
    byId.set(report.id, report);
  }
  for (const feature of features) {
    const evidence = feature.contactEvidence, report = byId.get(feature.id);
    if (evidence?.kind === 'standalone-contact') {
      check(report && evidence.sha256 === contactEvidenceDigest(report) && feature.sourceAuditSha256 === null && feature.validity.status === 'valid', 'Standalone contact feature lacks authenticated evidence');
      if (report.status === 'computed') {
        check(isDeepStrictEqual(feature.cdr, decomposeCdr(report.contact)) && feature.interface.contactPairCount === report.contact.contactPairCount && feature.interface.status === (report.contact.contactPairCount ? 'contacting' : 'no-contact'), 'Standalone contact feature differs from evidence');
      } else check(feature.cdr.status === 'unavailable' && feature.interface.status === 'unavailable' && feature.interface.contactPairCount === null, 'Unavailable standalone contact changed feature state');
    } else check(report === undefined, 'Unconsumed standalone contact report');
  }
  check(reports.every(r => features.some(f => f.id === r.id)), 'Standalone contact report has no planned feature');
}
