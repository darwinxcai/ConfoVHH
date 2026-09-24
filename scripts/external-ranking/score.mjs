#!/usr/bin/env node
/** Development-only external-coordinate adapter. No reference or outcome input. */
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/frozen-source');
const LOCK = path.join(ROOT, 'validation/prospective-benchmark-v1/engine-lock.json');
const FORMULAS = path.join(ROOT, 'scripts/paper/graded-clash-selectors-v1.py');
export const ARMS = Object.freeze(['frozen-v06', 'burial-only', 'producer-score', 'clash-fraction-v1', 'overlap-burial-v1']);
const FEATURES = 'id setId generatorId coordinateSha256 evidenceTier burial shippedBurial contacts clashes overlapBurden producerScore'.split(' ');
const RADII = Object.freeze({ H: 1.2, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, SE: 1.9, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = n => typeof n === 'number' && Number.isFinite(n);
const check = (condition, reason) => { if (!condition) throw new Error(reason); };
const id = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(s);
const exact = (r, names) => check(r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).sort().join('|') === [...names].sort().join('|'), 'Unexpected or absent fields');
const json = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), { maximumCharacters: 8_000_000, maximumTokens: 1_000_000, maximumDepth: 32 });
const save = async (filename, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(filename, bytes, { flag: 'wx' });
  return sha(bytes);
};

function binding(record, score = false) {
  exact(record, score ? ['path', 'bytes', 'sha256', 'jsonPointer'] : ['path', 'bytes', 'sha256', 'format']);
  check(typeof record.path === 'string' && record.path.length > 0 && !path.isAbsolute(record.path) && !record.path.split(/[\\/]/u).includes('..'), 'Unsafe artifact path');
  check(Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= 8_000_000 && /^[a-f0-9]{64}$/u.test(record.sha256), 'Invalid artifact binding');
  if (score) {
    check(typeof record.jsonPointer === 'string' && (record.jsonPointer === '' || record.jsonPointer.startsWith('/')) && !/(?:dockq|[il]rmsd|fnat|native|reference|__proto__|constructor|prototype)/iu.test(record.jsonPointer), 'Unsupported or outcome-like score pointer');
  } else check(['pdb', 'mmcif'].includes(record.format), 'Unsupported coordinate format');
}

export function validateManifest(manifest) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  exact(manifest, ['schema', 'studyId', 'generators', 'sets', 'attempts']);
  check(manifest.schema === 'confovhh-external-development-input-v1' && id(manifest.studyId), 'Invalid manifest identity');
  check(Array.isArray(manifest.generators) && manifest.generators.length > 0 && manifest.generators.length <= 16, 'Invalid generators');
  const generators = new Map();
  for (const g of manifest.generators) {
    exact(g, ['id', 'scoreName', 'direction']);
    check(id(g.id) && !generators.has(g.id) && id(g.scoreName) && !/(?:dockq|[il]rmsd|fnat|native|reference)/iu.test(g.scoreName), 'Invalid generator or outcome-like producer score');
    check(['higher-better', 'lower-better'].includes(g.direction), 'Invalid producer score direction');
    generators.set(g.id, g);
  }
  check(Array.isArray(manifest.sets) && manifest.sets.length > 0 && manifest.sets.length <= 500, 'Invalid sets');
  const sets = new Map();
  for (const s of manifest.sets) {
    exact(s, ['id', 'receptorChain', 'vhhChain', 'selectedModelId']);
    check(id(s.id) && !sets.has(s.id) && [s.receptorChain, s.vhhChain, s.selectedModelId].every(id) && s.receptorChain !== s.vhhChain, 'Invalid set or role identity');
    sets.set(s.id, s);
  }
  check(Array.isArray(manifest.attempts) && manifest.attempts.length > 0 && manifest.attempts.length <= 5000, 'Invalid attempt inventory');
  const ids = new Set(), setGenerators = new Map();
  for (const a of manifest.attempts) {
    exact(a, ['id', 'setId', 'generatorId', 'status', 'reason', 'coordinate', 'producerScore']);
    check(id(a.id) && !ids.has(a.id) && sets.has(a.setId) && generators.has(a.generatorId), 'Duplicate or unknown attempt identity');
    ids.add(a.id);
    check(['generated', 'failed', 'not-run'].includes(a.status) && typeof a.reason === 'string', 'Invalid attempt status');
    check(a.status === 'generated' ? a.reason === '' : a.reason.trim() && a.coordinate === null && a.producerScore === null, 'Inconsistent attempt disposition');
    if (a.coordinate !== null) binding(a.coordinate);
    if (a.producerScore !== null) binding(a.producerScore, true);
    // A selection set cannot mix scores with different producer semantics.
    if (setGenerators.has(a.setId)) check(setGenerators.get(a.setId) === a.generatorId, 'Mixed generators within a selection set');
    setGenerators.set(a.setId, a.generatorId);
  }
  check(setGenerators.size === sets.size, 'Selection set without attempts');
  return { generators, sets };
}

async function boundBytes(base, record) {
  const filename = path.resolve(base, record.path);
  check(filename.startsWith(`${base}${path.sep}`) && await realpath(filename) === filename, 'Indirect or escaping artifact');
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size === record.bytes, 'Missing or changed artifact size');
  const bytes = await readFile(filename);
  check(bytes.length === record.bytes && sha(bytes) === record.sha256, 'Artifact hash mismatch');
  return bytes;
}

function pointerValue(object, pointer) {
  if (pointer === '') return object;
  let value = object;
  for (const token of pointer.slice(1).split('/')) {
    check(!/~(?:[^01]|$)/u.test(token), 'Invalid JSON pointer escape');
    const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~');
    check(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'Producer score pointer absent');
    value = value[key];
  }
  return value;
}

/** Brute-force geometry arithmetic, independent of engine contact traversal.
 * Parsing is shared deliberately; Python/raw-coordinate verification is separate.
 */
export function overlapCensus(structure, receptorChain, vhhChain) {
  const receptor = structure.chains.find(c => c.id === receptorChain);
  const vhh = structure.chains.find(c => c.id === vhhChain);
  check(receptor && vhh && receptorChain !== vhhChain, 'Selected chains absent or identical');
  const aa = receptor.residues.flatMap(r => r.atoms), bb = vhh.residues.flatMap(r => r.atoms);
  const pairs = new Map();
  let atomContacts = 0;
  const unknownElements = new Set();
  for (const a of [...aa, ...bb]) {
    check([a.x, a.y, a.z].every(finite), 'Nonfinite selected atom');
    if (!Object.hasOwn(RADII, a.element)) unknownElements.add(a.element);
  }
  for (const a of aa) for (const b of bb) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > 4.5) continue;
    atomContacts += 1;
    const key = `${a.residueKey}\u0000${b.residueKey}`;
    if (!pairs.has(key)) pairs.set(key, { receptorResidue: a.residueKey, vhhResidue: b.residueKey, positiveOverlap: 0 });
    const row = pairs.get(key);
    if (a.residueName === 'CYS' && b.residueName === 'CYS' && a.name === 'SG' && b.name === 'SG' && distance >= 1.8 && distance <= 2.3) continue;
    row.positiveOverlap = Math.max(row.positiveOverlap, (RADII[a.element] ?? 1.7) + (RADII[b.element] ?? 1.7) - distance);
  }
  const census = [...pairs.values()].sort((a, b) => a.receptorResidue.localeCompare(b.receptorResidue) || a.vhhResidue.localeCompare(b.vhhResidue));
  return { contacts: census.length, clashes: census.filter(r => r.positiveOverlap >= 0.6).length,
    overlapBurden: census.length ? census.reduce((sum, r) => sum + (r.positiveOverlap / 0.6) ** 2, 0) / census.length : null,
    maximumOverlap: census.reduce((max, r) => Math.max(max, r.positiveOverlap), 0), atomContacts,
    unknownElementsWithFrozenCarbonFallback: [...unknownElements].sort(), census,
    atomInventory: [...aa, ...bb].map(a => ({ chain: a.chainId, residue: a.residueKey, residueName: a.residueName, atomName: a.name, element: a.element, x: a.x, y: a.y, z: a.z })),
    validationScope: 'Brute-force arithmetic on engine-parsed selected atoms; not an independent raw-coordinate parser' };
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] === null) return 1;
    if (b[i] === null) return -1;
    return a[i] > b[i] ? -1 : 1;
  }
  return 0;
}

/** Scientific ties remain tied. IDs only serialize rows; all attempts retained. */
export function rankFeatures(features, manifest, attempts) {
  const { generators } = validateManifest(manifest);
  const byId = new Map();
  for (const f of features) {
    exact(f, FEATURES);
    check(!byId.has(f.id), 'Duplicate feature ID');
    const attempt = manifest.attempts.find(a => a.id === f.id);
    check(attempt && attempt.setId === f.setId && attempt.generatorId === f.generatorId, 'Feature identity disagreement');
    byId.set(f.id, f);
  }
  check(attempts.length === manifest.attempts.length && new Set(attempts.map(a => a.id)).size === attempts.length && attempts.every(a => manifest.attempts.some(m => m.id === a.id)), 'Attempt ledger membership mismatch');
  const outputs = [];
  for (const set of [...manifest.sets].sort((a, b) => a.id.localeCompare(b.id))) for (const arm of ARMS) {
    const rows = manifest.attempts.filter(a => a.setId === set.id).map(a => {
      const failure = attempts.find(r => r.id === a.id);
      const f = failure?.status === 'scored' ? byId.get(a.id) : null;
      let key = null;
      if (f) {
        const b = f.burial, n = f.contacts, c = f.clashes, q = f.overlapBurden;
        if (arm === 'frozen-v06' && Number.isInteger(f.evidenceTier) && [0, 1, 2].includes(f.evidenceTier) && (f.shippedBurial === null || finite(f.shippedBurial) && f.shippedBurial >= 0)) key = [f.evidenceTier, f.shippedBurial];
        if (finite(b) && b >= 0) {
          if (arm === 'burial-only') key = [b];
          if (Number.isInteger(n) && n > 0) {
            if (arm === 'clash-fraction-v1' && Number.isInteger(c) && c >= 0 && c <= n) key = [b * (1 - c / n)];
            if (arm === 'overlap-burial-v1' && finite(q) && q >= 0) key = [b / (1 + q)];
          }
        }
        if (arm === 'producer-score' && finite(f.producerScore)) key = [f.producerScore * (generators.get(a.generatorId).direction === 'lower-better' ? -1 : 1)];
      }
      return { id: a.id, key, rank: null, status: key === null ? 'unavailable' : 'scored', reason: key === null ? (arm === 'producer-score' ? failure?.producerScoreReason : '') || failure?.reason || 'Required feature missing or invalid' : '' };
    });
    const ordered = rows.filter(r => r.key !== null).sort((a, b) => compareKeys(a.key, b.key));
    let rank = 0, previous = null;
    for (const row of ordered) {
      if (previous === null || compareKeys(previous, row.key) !== 0) rank += 1;
      row.rank = rank; previous = row.key;
    }
    const complete = rows.every(r => r.key !== null);
    const g = generators.get(manifest.attempts.find(a => a.setId === set.id).generatorId);
    outputs.push({ setId: set.id, arm, scoreName: arm === 'producer-score' ? g.scoreName : arm,
      direction: arm === 'producer-score' ? g.direction : 'higher-better', status: complete ? 'ranked' : 'abstain',
      reason: complete ? '' : 'At least one planned candidate lacks this score; no candidate is silently removed',
      selected: complete ? rows.filter(r => r.rank === 1).map(r => r.id).sort() : [],
      rows: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return outputs;
}

async function verifiedEngine() {
  const lockBytes = await readFile(LOCK), lock = json(lockBytes);
  for (const [relative, record] of Object.entries(lock.files)) {
    const filename = path.join(ENGINE, relative), bytes = await readFile(filename);
    check(await realpath(filename) === filename && bytes.length === record.bytes && sha(bytes) === record.sha256, `Frozen engine identity mismatch: ${relative}`);
  }
  check(sha(await readFile(FORMULAS)) === lock.fiveMethodModuleSha256, 'Historical five-method implementation changed');
  return { lockSha256: sha(lockBytes), fileCount: Object.keys(lock.files).length, fiveMethodModuleSha256: lock.fiveMethodModuleSha256 };
}

export async function scoreExternalManifest(manifest, artifactRoot, outputDir) {
  manifest = structuredClone(manifest);
  const { sets } = validateManifest(manifest);
  const engineIdentity = await verifiedEngine();
  const { exportCoordinateRanks } = await import(pathToFileURL(path.join(ENGINE, 'scripts/paper/export-coordinate-ranks.mjs')));
  const { parseCoordinateText } = await import(pathToFileURL(path.join(ENGINE, 'lib/coordinate-parser.ts')));
  const { scorePoseRanking } = await import(pathToFileURL(path.join(ENGINE, 'lib/pose-ranking.ts')));
  const base = await realpath(artifactRoot);
  await mkdir(outputDir, { recursive: false });
  const planSha256 = await save(path.join(outputDir, 'manifest.json'), manifest);
  const features = [], attempts = [], artifactHashes = {};
  for (const a of [...manifest.attempts].sort((x, y) => x.id.localeCompare(y.id))) {
    const set = sets.get(a.setId);
    const row = { id: a.id, setId: a.setId, generatorId: a.generatorId, producerStatus: a.status, status: a.status, reason: a.reason, producerScoreStatus: 'not-applicable', producerScoreReason: '' };
    if (a.status === 'generated') {
      const dir = path.join(outputDir, a.id);
      await mkdir(dir);
      try {
        check(a.coordinate !== null, 'Coordinate binding missing');
        const bytes = await boundBytes(base, a.coordinate);
        const descriptor = { id: a.id, format: a.coordinate.format, coordinateSha256: a.coordinate.sha256, coordinateBytes: bytes.length, receptorChain: set.receptorChain, vhhChain: set.vhhChain, selectedModelId: set.selectedModelId, chainRolesConfirmed: true, producerScore: null };
        const internal = { schema: 'confovhh-coordinate-rank-input-v1', studyId: manifest.studyId, generators: [{ id: a.generatorId, scoreName: 'unused', direction: 'higher-better' }], attempts: [{ id: a.id, groupId: 'development', targetId: a.setId, generatorId: a.generatorId, status: 'eligible', reason: '' }], coordinates: [descriptor] };
        const result = await exportCoordinateRanks(internal, new Map([[a.id, bytes]]));
        const report = json(Buffer.from(result.reports[a.id]));
        const structure = parseCoordinateText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), `${a.id}.${a.coordinate.format === 'pdb' ? 'pdb' : 'cif'}`, { modelId: set.selectedModelId });
        const g = overlapCensus(structure, set.receptorChain, set.vhhChain), audit = report.audit;
        check(g.contacts === audit.contactPairCount && g.clashes === audit.severeClashCount && g.atomContacts === audit.atomContactCount && Math.abs(g.maximumOverlap - audit.maximumOverlapAngstrom) <= 1e-12, 'Brute-force / frozen-engine geometry discrepancy');
        let producerScore = null;
        row.producerScoreStatus = 'missing';
        row.producerScoreReason = 'No producer score binding';
        if (a.producerScore !== null) {
          try {
            producerScore = pointerValue(json(await boundBytes(base, a.producerScore)), a.producerScore.jsonPointer);
            check(finite(producerScore), 'Producer score is not finite numeric');
            row.producerScoreStatus = 'present'; row.producerScoreReason = '';
          } catch (error) {
            producerScore = null; row.producerScoreStatus = 'invalid'; row.producerScoreReason = error.message;
          }
        }
        const shipped = scorePoseRanking(audit);
        const feature = { id: a.id, setId: a.setId, generatorId: a.generatorId, coordinateSha256: a.coordinate.sha256, evidenceTier: shipped.evidenceTier, burial: audit.halfDeltaSasaInterfaceAreaAngstrom2, shippedBurial: shipped.burialScore, contacts: g.contacts, clashes: g.clashes, overlapBurden: g.overlapBurden, producerScore };
        artifactHashes[`${a.id}/audit.json`] = await save(path.join(dir, 'audit.json'), report);
        artifactHashes[`${a.id}/overlaps.json`] = await save(path.join(dir, 'overlaps.json'), g);
        artifactHashes[`${a.id}/execution.json`] = await save(path.join(dir, 'execution.json'), { provenance: result.provenance, claims: result.claims, parserInventory: { selectedModelId: structure.selectedModelId, availableModelIds: structure.availableModelIds, ignoredAlternateLocations: structure.ignoredAlternateLocations, ignoredHydrogens: structure.ignoredHydrogens, duplicateAtomRecords: structure.duplicateAtomRecords, malformedAtomRecords: structure.malformedAtomRecords, zeroOccupancyAtomRecords: structure.zeroOccupancyAtomRecords, selectedChains: structure.chains.filter(c => [set.receptorChain, set.vhhChain].includes(c.id)).map(c => ({ id: c.id, sequence: c.sequence, atomCount: c.atomCount, residueCount: c.residueCount })) } });
        features.push(feature);
        row.status = 'scored'; row.reason = '';
      } catch (error) { row.status = 'evaluation-failed'; row.reason = `${error.name}: ${error.message}`; }
      artifactHashes[`${a.id}/attempt.json`] = await save(path.join(dir, 'attempt.json'), row);
    }
    attempts.push(row);
  }
  const ranks = rankFeatures(features, manifest, attempts);
  const featuresSha256 = await save(path.join(outputDir, 'features.json'), features);
  const attemptsSha256 = await save(path.join(outputDir, 'attempts.json'), attempts);
  const ranksSha256 = await save(path.join(outputDir, 'ranks.json'), ranks);
  const receipt = { schema: 'confovhh-external-development-score-receipt-v1', studyId: manifest.studyId,
    status: attempts.every(r => r.status === 'scored') && ranks.every(r => r.status === 'ranked') ? 'COMPLETE' : 'RECORDED_WITH_FAILURES_OR_ABSTENTIONS',
    manifestSha256: planSha256, featuresSha256, attemptsSha256, ranksSha256, artifactHashes,
    adapterSha256: sha(await readFile(new URL(import.meta.url))), engineIdentity,
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch },
    arms: ARMS, attemptCount: attempts.length, scoredCount: features.length, outcomeInputs: [],
    claims: { developmentOnly: true, independentValidation: false, productionScoringChanged: false, sourceProducerExecutionAuthenticated: false, referenceUsedForRanking: false, independentRawParserValidation: false },
    policies: { allModeledSelectedChainResidues: true, sourceCoordinatesChanged: false, scientificTieRule: 'exact keys; uniform selection over complete top tie', missingScore: 'whole arm abstains within selection set', atomInventory: 'frozen parser; separate raw-coordinate crosscheck required', unchangedFormulaKeys: { clashFraction: 'B*(1-C/N)', overlapBurial: 'B/(1+Q)', Q: 'mean((maxPositivePairOverlap/0.6)^2)' }, externalProducerScore: 'hash-bound JSON scalar, explicitly named/directed; not historical Boltz confidence unless source is Boltz confidence_score' } };
  await save(path.join(outputDir, 'receipt.json'), receipt);
  return { receipt, features, attempts, ranks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 6 && args[0] === '--manifest' && args[2] === '--artifacts' && args[4] === '--output', 'Usage: score.mjs --manifest manifest.json --artifacts directory --output NEW_DIRECTORY');
    const result = await scoreExternalManifest(json(await readFile(args[1])), args[3], args[5]);
    process.stdout.write(`${JSON.stringify(result.receipt)}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
