import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractCanonicalTmProfile, alignGlobalAffineWithCoverage, evaluateFrozenReceptorThreshold } from '../hard-decoy/v3-receptor-tm-pregraph.mjs';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'validation/hard-decoy-holdout-v3';
export const MGLYR_CANONICAL_PACKET = `${BASE}/mglyr-canonical-capture-2026-09-08`;
const SCRIPT = 'scripts/hard-decoy-v3/review-mglyr-receptor.mjs';
const SOURCE_ROOT_FILES = ['capture.py', 'capture-plan.json', 'capture-run.json'];
const RESULT_FILES = ['profile.json', 'development-pairs.json', 'entry-development-pairs.json', 'entry-accounting.json', 'summary.json', 'README.md', 'manifest.json'];
const PINS = {
  'HARD_DECOY_PROTOCOL_V3.md': '1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376',
  'scripts/hard-decoy/v3-receptor-tm-pregraph.mjs': '4316347ee87f6c945f3cb3ed8b3128bb3b2468ec5dfdb158d4e297119821fa6b',
  [`${BASE}/receptor-tm-contract-2026-08-30.json`]: 'abd88bbae2d35fda28dc9339f80d91c65d95c4b9f844d74ddff7249090eea412',
  [`${BASE}/receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl`]: '0a120c9ac73ce5acbb33cb638d2fe396942cf6dff302d3a81e74a789af797b65',
  [`${BASE}/annotation-discovery-2026-09-04/entries.jsonl`]: 'ab4ebb4597948b973af33ae55763c0f8a65fcbfe66db3748d24478ec33a429df',
  [`${BASE}/annotation-priority-review-2026-09-04/source-reviews.json`]: '67765a9c985b84f73fe7fa36e16dd0068457cb56a10a2d20bcecff24f09e9c20',
  [`${BASE}/annotation-priority-review-2026-09-04/raw/uniprot-q5t848-transmembrane.json`]: 'd2012c113c366811fc7169234944b611ff2537909833bdc4bc438c1d07cf7e1f',
};
const AUTHORITY = { formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false, formalEligibilityAuthority: false,
  formalExclusionAuthority: false, newIndependentComponents: 0, wholeCensusUpperBound: null, targetFreezePermitted: false };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => `${canonicalJson(value)}\n`;
const parse = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 16000000, maximumTokens: 1000000, maximumDepth: 32 });
const parseRows = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd().split('\n').map(line => parse(Buffer.from(line)));

/** Enumerate names only before reading or hashing any packet payload. */
async function checkedPacketNames(directory, requireOutputs = false) {
  assert.equal(await realpath(directory), path.resolve(directory), 'Packet path cannot contain symlinks');
  const allowed = new Set([...SOURCE_ROOT_FILES, ...RESULT_FILES, 'checksums.sha256', 'sources']);
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(entry => entry.name);
  for (const entry of entries) {
    assert.ok(allowed.has(entry.name), `Unexpected packet member: ${entry.name}`);
    assert.ok(!entry.isSymbolicLink(), 'Packet symlink forbidden');
    assert.ok(entry.name === 'sources' ? entry.isDirectory() : entry.isFile(), `Invalid packet member type: ${entry.name}`);
  }
  for (const name of [...SOURCE_ROOT_FILES, 'sources', ...(requireOutputs ? [...RESULT_FILES, 'checksums.sha256'] : [])]) assert.ok(names.includes(name), `Required packet member missing: ${name}`);
  const sources = await readdir(path.join(directory, 'sources'), { withFileTypes: true });
  const sourceNames = new Set(sources.map(entry => entry.name));
  for (const entry of sources) {
    assert.match(entry.name, /^(?:protein|residues)-[12]-attempt-[12]\.(?:json|body)$/u, `Unexpected capture member: ${entry.name}`);
    assert.ok(entry.isFile() && !entry.isSymbolicLink(), `Invalid capture member type: ${entry.name}`);
    const other = entry.name.endsWith('.json') ? entry.name.replace(/\.json$/u, '.body') : entry.name.replace(/\.body$/u, '.json');
    assert.ok(sourceNames.has(other), `Unpaired capture member: ${entry.name}`);
  }
  for (const endpoint of ['protein', 'residues']) for (const repeat of [1, 2]) assert.ok(sourceNames.has(`${endpoint}-${repeat}-attempt-1.json`), 'Missing first endpoint/repeat attempt');
  return [...names.filter(name => name !== 'sources' && name !== 'checksums.sha256'), ...[...sourceNames].map(name => `sources/${name}`)].sort();
}

async function directRead(root, relative, expected) {
  assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe input path');
  const file = path.join(root, relative);
  assert.equal(await realpath(file), file, 'Symlink path forbidden');
  const info = await lstat(file, { bigint: true });
  assert.ok(info.isFile() && info.nlink === 1n && info.size <= 64000000n, 'Invalid bounded regular file');
  const bytes = await readFile(file);
  assert.equal(BigInt(bytes.length), info.size, 'File changed during read');
  if (expected) assert.equal(sha(bytes), expected, `Pinned input changed: ${relative}`);
  return bytes;
}

export function extractVerifiedMglyr(protein, residues, uniprot) {
  assert.equal(protein.accession, 'Q5T848', 'Wrong canonical accession');
  assert.equal(protein.entry_name, 'gp158_human', 'Wrong canonical entry');
  assert.equal(protein.species, 'Homo sapiens', 'Wrong canonical organism');
  assert.equal(protein.source, 'SWISSPROT', 'Wrong canonical source');
  assert.equal(uniprot.primaryAccession, 'Q5T848', 'Wrong independent accession');
  assert.equal(uniprot.organism.taxonId, 9606, 'Wrong independent organism');
  assert.equal(uniprot.organism.scientificName, 'Homo sapiens', 'Wrong independent species');
  assert.match(protein.family, /^004_[0-9_]+$/u, 'Unexpected GPR158 class-C family annotation');
  assert.match(protein.sequence, /^[ACDEFGHIKLMNPQRSTVWY]+$/u, 'Invalid canonical residues');
  assert.equal(protein.sequence, uniprot.sequence.value, 'GPCRdb/UniProt canonical sequence disagreement');
  assert.equal(protein.sequence.length, 1215, 'Unexpected retained canonical length');
  assert.ok(Array.isArray(residues), 'Invalid residue inventory');
  assert.equal(residues.length, protein.sequence.length, 'Incomplete full canonical inventory');
  assert.deepEqual(residues.map(row => row.sequence_number).sort((a, b) => a - b), Array.from({ length: protein.sequence.length }, (_, i) => i + 1), 'Missing or duplicate canonical position');
  for (const row of residues) assert.equal(row.amino_acid, protein.sequence[row.sequence_number - 1], 'Canonical residue identity mismatch');
  const profile = extractCanonicalTmProfile({ entryName: protein.entry_name, canonicalAccession: protein.accession,
    canonicalSequence: protein.sequence, canonicalSequenceLength: protein.sequence.length, canonicalSequenceSha256: sha(protein.sequence) }, residues);
  assert.equal(profile.extractionStatus, 'RESOLVED_CANONICAL_TM1_TM7', profile.failureCode);
  assert.equal(profile.tmSegments.length, 7);
  for (const tm of profile.tmSegments) assert.equal(tm.residueCount, tm.sequenceEnd - tm.sequenceStart + 1, 'Noncontiguous canonical TM segment');
  return { ...profile, family: protein.family, species: protein.species, residueNumberingScheme: protein.residue_numbering_scheme,
    canonicalReferenceOnly: true, depositedConstructMappingResolved: false, ...AUTHORITY };
}

async function readCapture(directory, name, url, plan, bindings) {
  const successes = [];
  for (let attempt = 1; attempt <= plan.attemptsPerEndpoint; attempt++) {
    const stem = `sources/${name}-attempt-${attempt}`;
    let recordBytes;
    try { recordBytes = await directRead(directory, `${stem}.json`); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const record = parse(recordBytes), body = await directRead(directory, `${stem}.body`);
    assert.equal(record.url, url, 'Capture URL mismatch');
    assert.equal(record.sha256, sha(body), 'Capture body hash mismatch');
    assert.equal(record.bytes, body.length, 'Capture body size mismatch');
    assert.ok(body.length <= plan.maximumResponseBytes, 'Capture response exceeds bound');
    assert.equal(record.captureScriptSha256, bindings.captureScriptSha256, 'Capture script binding mismatch');
    assert.equal(record.planSha256, bindings.planSha256, 'Capture plan binding mismatch');
    for (const field of ['startedUtc', 'finishedUtc']) assert.ok(typeof record[field] === 'string' && Number.isFinite(Date.parse(record[field])), 'Invalid capture timestamp');
    assert.ok(Date.parse(record.finishedUtc) >= Date.parse(record.startedUtc), 'Capture timestamp order');
    if (record.status === 200) {
      assert.equal(record.finalUrl, url, 'Redirected capture forbidden');
      assert.match(record.contentType, /^application\/json\b/u, 'Expected JSON response');
      successes.push(parse(body));
    }
  }
  assert.equal(successes.length, 1, 'Expected one successful capture per endpoint/repeat');
  return successes[0];
}

export async function buildMglyrReceptorFiles({ repositoryRoot = ROOT, directory = path.join(repositoryRoot, MGLYR_CANONICAL_PACKET) } = {}) {
  const root = path.resolve(repositoryRoot), packet = path.resolve(directory), loaded = new Map(), inputBindings = {};
  assert.equal(await realpath(root), root); assert.equal(await realpath(packet), packet);
  await checkedPacketNames(packet);
  for (const [relative, expected] of Object.entries(PINS)) {
    const bytes = await directRead(root, relative, expected); loaded.set(relative, bytes);
    inputBindings[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  for (const relative of [SCRIPT, 'scripts/hard-decoy/oracle/canonical-json.mjs']) {
    const bytes = await directRead(root, relative); inputBindings[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  const planBytes = await directRead(packet, 'capture-plan.json'), plan = parse(planBytes);
  assert.equal(plan.accession, 'Q5T848'); assert.equal(plan.species, 'Homo sapiens'); assert.equal(plan.captureCount, 2);
  assert.equal(plan.proteinEndpoint, 'https://gpcrdb.org/services/protein/accession/Q5T848/');
  assert.equal(plan.residuesEndpointTemplate, 'https://gpcrdb.org/services/residues/{entry_name}/');
  assert.deepEqual(plan.allowedHosts, ['gpcrdb.org']); assert.equal(plan.redirectsAllowed, false);
  assert.equal(plan.maximumResponseBytes, 8388608); assert.equal(plan.attemptsPerEndpoint, 2);
  assert.deepEqual(plan.retryStatuses, [429, 502, 503, 504]);
  const captureBindings = { planSha256: sha(planBytes), captureScriptSha256: sha(await directRead(packet, 'capture.py')) };
  const run = parse(await directRead(packet, 'capture-run.json'));
  assert.equal(run.completedRepeats, 2); assert.equal(run.status, 'CAPTURE_COMPLETE_PENDING_OFFLINE_SCHEMA_AND_TM_VERIFICATION');
  const uniprot = parse(loaded.get(`${BASE}/annotation-priority-review-2026-09-04/raw/uniprot-q5t848-transmembrane.json`));
  const profiles = [], proteins = [], residueInventories = [];
  for (const repeat of [1, 2]) {
    const protein = await readCapture(packet, `protein-${repeat}`, plan.proteinEndpoint, plan, captureBindings);
    assert.equal(protein.entry_name, 'gp158_human');
    const residues = await readCapture(packet, `residues-${repeat}`, plan.residuesEndpointTemplate.replace('{entry_name}', protein.entry_name), plan, captureBindings);
    profiles.push(extractVerifiedMglyr(protein, residues, uniprot)); proteins.push(protein); residueInventories.push(residues);
  }
  assert.deepEqual(proteins[0], proteins[1], 'Repeated canonical protein captures disagree');
  assert.deepEqual(residueInventories[0], residueInventories[1], 'Repeated canonical residue captures disagree');
  assert.deepEqual(profiles[0], profiles[1], 'Repeated canonical profiles disagree');
  const profile = profiles[0];
  const contract = parse(loaded.get(`${BASE}/receptor-tm-contract-2026-08-30.json`));
  const references = parseRows(loaded.get(`${BASE}/receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl`));
  assert.equal(references.length, 17); assert.equal(new Set(references.map(row => row.nodeId)).size, 17);
  const pairs = references.map(reference => {
    assert.equal(reference.mappingStatus, 'RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7');
    assert.equal(sha(reference.concatenatedTmSequence), reference.concatenatedTmSequenceSha256);
    const alignment = alignGlobalAffineWithCoverage(profile.concatenatedTmSequence, reference.concatenatedTmSequence, contract.alignment);
    const candidateIsA = Buffer.from(profile.concatenatedTmSequence).compare(Buffer.from(reference.concatenatedTmSequence)) <= 0;
    return { pairId: `Q5T848|${reference.nodeId}`, referenceNode: reference.nodeId, referenceAccession: reference.canonicalAccession,
      alignment, candidateAlignmentSide: candidateIsA ? 'A' : 'B', candidateCoverage: candidateIsA ? alignment.coverageA : alignment.coverageB,
      referenceCoverage: candidateIsA ? alignment.coverageB : alignment.coverageA,
      criterion: evaluateFrozenReceptorThreshold(alignment, contract.thresholds), ...AUTHORITY };
  });
  const metadata = parseRows(loaded.get(`${BASE}/annotation-discovery-2026-09-04/entries.jsonl`)).filter(row => ['9VOR', '9VOS'].includes(row.pdbId));
  assert.deepEqual(metadata.map(row => row.pdbId).sort(), ['9VOR', '9VOS']);
  const reviewed = parse(loaded.get(`${BASE}/annotation-priority-review-2026-09-04/source-reviews.json`));
  const accounting = metadata.map(entry => {
    const review = reviewed.reviews.find(row => row.pdbId === entry.pdbId);
    assert.equal(review.receptorAccession, 'Q5T848'); assert.equal(review.depositionLinkage.pdbIdExplicitlyNamed, true);
    const receptor = entry.polymerEntities.filter(entity => entity.referenceSequences.some(ref => ref.databaseName === 'UniProt' && ref.databaseAccession === 'Q5T848'));
    assert.equal(receptor.length, 1); assert.equal(receptor[0].entityId, review.receptorEntityId);
    assert.equal(entry.polymerEntities.length, entry.polymerEntityCountReported);
    return { pdbId: entry.pdbId, receptorEntityId: receptor[0].entityId, canonicalAccession: 'Q5T848',
      depositedReceptorSequenceSha256: receptor[0].sequenceSha256, polymerCount: entry.polymerEntities.length,
      primaryDoi: review.resolvedPrimaryCitation.doi, depositedConstructResolved: false, ...AUTHORITY };
  });
  assert.equal(accounting.reduce((n, row) => n + row.polymerCount, 0), 6);
  const entryPairs = accounting.flatMap(entry => pairs.map(pair => ({ pairId: `${entry.pdbId}|${pair.referenceNode}`, pdbId: entry.pdbId,
    canonicalComparisonId: pair.pairId, criterion: pair.criterion, conditionalOnReceptorAndConstructAdjudication: true, ...AUTHORITY })));
  assert.equal(entryPairs.length, 34); assert.equal(new Set(entryPairs.map(row => row.pairId)).size, 34);
  const summary = { status: 'CANONICAL_RECEPTOR_REVIEW_ONLY_FREEZE_BLOCKED', entryCount: 2, polymerCount: 6,
    canonicalLength: profile.canonicalSequenceLength, tmLength: profile.concatenatedTmSequenceLength,
    repeatedCaptureAgreement: true, independentUniProtSequenceAgreement: true, uniqueDevelopmentPairCount: 17, entryDevelopmentPairCount: 34,
    positiveDevelopmentNodes: pairs.filter(row => row.criterion.primaryThresholdSatisfied).map(row => row.referenceNode),
    sensitivityVetoDevelopmentNodes: pairs.filter(row => row.criterion.sensitivityThresholdSatisfied).map(row => row.referenceNode),
    previousMissingProfilePacket: `${BASE}/mglyr-development-review-2026-09-08`, previousPacketPreserved: true,
    priorMissingReceptorProfileGapClosed: true, exactExpressedConstructProvenanceResolved: false, globalGraphComplete: false,
    exposureClearanceGranted: false, priorExposureCaveatsRemainActive: true, nativeCoordinatesAccessed: false,
    nativePosesAccessed: false, contactTablesAccessed: false, labelsAccessed: false, predictionOutputsAccessed: false,
    articleBodiesAccessed: false, predictionAccuracyMeasured: false, ...AUTHORITY };
  summary.retainedCaptureScriptScope = 'Historical execution provenance only; edited plans require reviewed collector enforcement before future requests.';
  const files = new Map([['profile.json', encode(profile)], ['development-pairs.json', encode(pairs)], ['entry-development-pairs.json', encode(entryPairs)],
    ['entry-accounting.json', encode(accounting)], ['summary.json', encode(summary)]]);
  files.set('README.md', `# GPR158/mGlyR canonical receptor follow-up\n\nFour fresh GPCRdb canonical metadata responses retain Q5T848 and all 1,215 residue positions twice. The repeated protein/residue objects agree, and the sequence matches the independently retained human UniProt record exactly. The unchanged frozen GPCRdb extractor yields ${summary.tmLength} TM1–TM7 residues. No coordinate, structure or article endpoint was requested. Raw bytes, UTC request dates, exact URLs, capture plan and code hashes are retained.\n\nThis closes the missing-canonical-profile limitation in the preceding mGlyR/Nb20 packet. All 17 unique development receptor comparisons are represented by all 34 entry/reference rows for 9VOR/9VOS; all six deposited polymers remain accounted for. Primary threshold signals: ${summary.positiveDevelopmentNodes.join(', ') || 'none'}. Veto-only sensitivity signals, including any primary signals: ${summary.sensitivityVetoDevelopmentNodes.join(', ') || 'none'}. These are canonical sequence review signals. Negative comparisons cannot certify independence or a formal no-edge decision.\n\nThe frozen primary criterion uses 40% identity and 80% coverage on both sequences; 30% identity is the existing veto-only sensitivity criterion. The earlier reference profiles retain their original epoch. Canonical sequence agreement does not establish exact experimental construct, tag or resolved-coordinate identity. Cryo-EM preparation provenance, known-parent relationships, candidate-to-candidate/global graph review and existing exposure adjudication remain open. No formal graph, disposition, eligibility or frozen profile changes. New independent groups: zero; predictive accuracy remains unmeasured.\n\nSources: [GPCRdb Q5T848](https://gpcrdb.org/services/protein/accession/Q5T848/), [canonical residue annotations](https://gpcrdb.org/services/residues/gp158_human/) and the earlier retained [UniProt record](https://rest.uniprot.org/uniprotkb/Q5T848.json). GPCRdb data are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as stated in its [legal notice](https://docs.gpcrdb.org/legal_notice.html). The canonical TM extraction, profiles and sequence comparisons are transformations of the retained GPCRdb metadata.\n\nOffline verification: \`node scripts/hard-decoy-v3/review-mglyr-receptor.mjs verify\`. Every output and source/dependency binding, repeat agreement and complete pair inventory is replayed. Unlisted files, folders, symlinks and unpaired capture names fail before packet payloads are read or hashed. No network calls occur during verification.\n\nThe retained capture.py records the actual historical execution and has not been rewritten. Its protein request trusts the plan's proteinEndpoint field; it is not a general safe collector for edited plans. This packet's exact URLs and plan are checked by the offline verifier. Future recapture requires a reviewed collector with enforced endpoint restrictions or exact approved plan/script pins.\n`);
  files.set('manifest.json', encode({ inputBindings, captureBindings, outputs: Object.fromEntries([...files].map(([name, value]) => [name, { sha256: sha(value), bytes: Buffer.byteLength(value) }])), authority: AUTHORITY }));
  return { files, summary };
}

async function inventory(directory) {
  const names = await checkedPacketNames(directory);
  const result = [];
  for (const name of names) result.push(`${sha(await directRead(directory, name))}  ${name}\n`);
  return result.sort();
}

export async function runMglyrReceptorReview(mode, { repositoryRoot = ROOT, directory = path.join(repositoryRoot, MGLYR_CANONICAL_PACKET) } = {}) {
  assert.ok(['collect', 'verify'].includes(mode), 'Expected collect or verify');
  const packet = path.resolve(directory);
  await checkedPacketNames(packet, mode === 'verify');
  if (mode === 'verify') assert.equal((await directRead(packet, 'checksums.sha256')).toString(), (await inventory(packet)).join(''), 'Packet checksum inventory mismatch');
  const result = await buildMglyrReceptorFiles({ repositoryRoot, directory: packet });
  for (const [name, bytes] of result.files) {
    if (mode === 'collect') await writeFile(path.join(packet, name), bytes, { flag: 'wx' });
    else assert.equal((await directRead(packet, name)).toString(), bytes, `Offline replay mismatch: ${name}`);
  }
  if (mode === 'collect') await writeFile(path.join(packet, 'checksums.sha256'), (await inventory(packet)).join(''), { flag: 'wx' });
  return result.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Expected collect or verify');
  console.log(JSON.stringify(await runMglyrReceptorReview(process.argv[2]), null, 2));
}
