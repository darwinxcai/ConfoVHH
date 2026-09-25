#!/usr/bin/env node
/** Saved prediction-only contact/rank replay; no outcome file is accepted. */
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { check, assessValidity, rankSourceFirst } from './policy.mjs';
import { createContactOnlyEngine, validateContactEvidence } from './contact-only.mjs';
const REPO = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(REPO, 'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/frozen-source');
const LOCK = path.join(REPO, 'validation/prospective-benchmark-v1/engine-lock.json');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const decode = raw => { const text = raw.toString('utf8'); parseStrictJson(text, { maximumCharacters: 32000000, maximumTokens: 4000000, maximumDepth: 48 }); return JSON.parse(text); };
const FILES = ['manifest.json','source-score-receipt.json','source-manifest.json','source-features.json','source-attempts.json','source-ranks.json','features.json','attempts.json','ranks.json','blocks.json','calibrations.json','contact-evidence.json'].sort();
async function bound(root, binding) {
  check(typeof binding.path === 'string' && !path.isAbsolute(binding.path) && !binding.path.includes('\\') && !binding.path.split('/').includes('..'), 'Invalid contact replay bound path');
  const filename = path.resolve(root, binding.path); check(filename.startsWith(root+path.sep) && await realpath(filename) === filename, 'Indirect contact replay input');
  const bytes = await readFile(filename); check(bytes.length <= 32000000 && sha(bytes) === binding.sha256 && (binding.bytes === undefined || binding.bytes === bytes.length), 'Contact replay input binding differs'); return bytes;
}

export async function verifySavedContacts(artifactRoot, receiptPath) {
  const root = await realpath(artifactRoot), receiptFile = await realpath(receiptPath), folder = path.dirname(receiptFile), receipt = decode(await readFile(receiptFile));
  check(receipt.schema === 'confovhh-source-first-receipt-v3' && isDeepStrictEqual(Object.keys(receipt.files).sort(), FILES) && isDeepStrictEqual(receipt.outcomeInputs, []), 'Contact replay requires complete prediction-only v3 inventory');
  const data = {};
  for (const name of FILES) data[name] = decode(await bound(folder, { path: name, sha256: receipt.files[name] }));
  for (const name of ['score.mjs','policy.mjs','contact-only.mjs']) check(receipt.implementation['scripts/external-ranking-v3/'+name] === sha(await readFile(path.join(import.meta.dirname, name))), 'Saved contact implementation differs');
  const engine = await createContactOnlyEngine(ENGINE, LOCK);
  check(isDeepStrictEqual(receipt.contactMethod, engine.method), 'Saved contact method identity differs');
  check(receipt.sourceScoreReceiptSha256 === receipt.files['source-score-receipt.json'], 'Saved source receipt binding differs');
  const reports = data['contact-evidence.json'], features = data['features.json'], manifest = data['source-manifest.json'], input = data['manifest.json'];
  validateContactEvidence(features, reports, manifest, receipt.sourceScoreReceiptSha256, engine.method);
  const attempts = new Map(manifest.attempts.map(a => [a.id,a])), sets = new Map(manifest.sets.map(s => [s.id,s])), policies = new Map(input.setPolicies.map(s => [s.setId,s]));
  const sourceLedger = new Map(data['source-attempts.json'].map(a => [a.id,a])), featureMap = new Map(features.map(f => [f.id,f]));
  for (const report of reports) {
    const attempt = attempts.get(report.id), set = sets.get(attempt.setId), old = sourceLedger.get(report.id);
    check(!Object.hasOwn(data['source-score-receipt.json'].artifactHashes, report.id+'/audit.json'), 'Standalone replay attempted to replace a bound full audit');
    check(report.fullAuditDisposition.sourceAttemptStatus === old.status && report.fullAuditDisposition.reason === old.reason, 'Standalone replay original full-audit disposition differs');
    const raw = await bound(root, attempt.coordinate), structure = engine.parse(raw.toString('utf8'), `${attempt.id}.${attempt.coordinate.format === 'pdb' ? 'pdb' : 'cif'}`, { modelId: set.selectedModelId });
    const validity = assessValidity(structure, set, policies.get(set.id));
    check(validity.status === 'valid' && isDeepStrictEqual(validity, featureMap.get(report.id).validity), 'Standalone replay coordinate validity differs');
    let contact = null, reason = '';
    try { contact = engine.analyze(structure, set.receptorChain, set.vhhChain); } catch (error) { reason = `${error.name}: ${error.message}`; }
    check(isDeepStrictEqual(contact, report.contact) && reason === report.reason && report.status === (contact === null ? 'unavailable' : 'computed'), 'Standalone contact does not replay from bound coordinates');
  }
  const ranked = rankSourceFirst({ input, sourceManifest: manifest, features, calibrations: data['calibrations.json'] });
  check(isDeepStrictEqual(ranked.ranks, data['ranks.json']) && isDeepStrictEqual(ranked.blocks, data['blocks.json']), 'Saved ranking differs from authenticated contact features');
  check(receipt.standaloneContactEvidenceCount === reports.length && receipt.standaloneContactComputedCount === reports.filter(r => r.status === 'computed').length, 'Standalone receipt count differs');
  return { schema: 'confovhh-saved-contact-replay-v1', savedReceiptSha256: sha(await readFile(receiptFile)), plannedCount: features.length,
    standaloneReportsVerified: reports.length, standaloneReportsRecomputed: reports.length, savedRanksAndBlocksExact: true, outcomeInputs: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--method') console.log(JSON.stringify((await createContactOnlyEngine(ENGINE, LOCK)).method));
    else { check(args.length === 4 && args[0] === '--artifacts' && args[2] === '--receipt', 'Usage: verify-contact-evidence.mjs --artifacts ROOT --receipt SAVED_RECEIPT'); console.log(JSON.stringify(await verifySavedContacts(args[1], args[3]))); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
