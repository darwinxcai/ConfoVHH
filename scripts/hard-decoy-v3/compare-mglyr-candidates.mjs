import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { alignGlobalAffine, evaluateFrozenVhhThreshold, numberVhhForLeakage } from '../hard-decoy/v3-vhh-sequence-pregraph.mjs';
import { alignGlobalAffineWithCoverage, evaluateFrozenReceptorThreshold } from '../hard-decoy/v3-receptor-tm-pregraph.mjs';
import { reproduceDomainCall } from './compare-domain-remainder-development.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'validation/hard-decoy-holdout-v3/';
const SCRIPT = 'scripts/hard-decoy-v3/compare-mglyr-candidates.mjs';
export const MGLYR_CANDIDATE_OUTPUT = `${BASE}mglyr-candidate-review-2026-09-08`;
const PINNED = {
  "validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl": "bb34bdf41e129997591516283b7cddbdee03014d6828b1531461ba0b68e6c19c",
  "validation/hard-decoy-holdout-v3/gpcrdb-complement-metadata-2026-09-04/entries.jsonl": "70c7c8a05533d2cae4841307ccc4083a7ddf136adf29e0137b97df548740630c",
  "validation/hard-decoy-holdout-v3/gpcrdb-complement-replacements-2026-09-04/entries.jsonl": "b0b26eb7776fa1eb53182cf7c23213417209b47a67afbc05621680bfe79457cd",
  "validation/hard-decoy-holdout-v3/rcsb-recent-discovery-2026-09-04/entries.jsonl": "4ae69b0921f20b2874783b84322f32c3213d842c10e8ed98e65b6c14f0a2e99f",
  "validation/hard-decoy-holdout-v3/annotation-discovery-2026-09-04/entries.jsonl": "ab4ebb4597948b973af33ae55763c0f8a65fcbfe66db3748d24478ec33a429df",
  "validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04/entries.jsonl": "fde2a0de338d34ea0e2baf56924b20bbc2de113b821a30af9c976b064d3a92d0",
  "validation/hard-decoy-holdout-v3/domain-remainder-2026-09-04/entries.jsonl": "6aa103cf88f5fb69874842da11ce5306a23429f7590a77210f892a40ef046017",
  "validation/hard-decoy-holdout-v3/annotation-additional-priority-review-2026-09-04/publication-closure/entries.jsonl": "2797e0201296be05b4e0673beffaaf5f94a5787713565c952ca075773487f4e2",
  "validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/metadata-entry.json": "8ad175b2902b7ef0407953cf4ab99bf25f5da110706b5c070ac7a4fe24ef8ae6",
  "validation/hard-decoy-holdout-v3/gpcrdb-complement-screen-2026-09-04/sequence-screens.jsonl": "2442b5731a35a422a4842e44678e468e56b5af3329f19ec6aaaab25dbb930a91",
  "validation/hard-decoy-holdout-v3/rcsb-recent-screen-2026-09-04/sequence-screens.jsonl": "6b7b1bc45c837b162041d250f9cee3e221126af399deffb5cc892ee9898638f8",
  "validation/hard-decoy-holdout-v3/annotation-screen-2026-09-04/sequence-screens.jsonl": "f7767c377cb6c9e74bdedc87c9133ec17adcf0bc3d552231148edd43cc8b6557",
  "validation/hard-decoy-holdout-v3/global-text-screen-2026-09-04/sequence-screens.jsonl": "473d3dcb13fe00a247c9f4be116537f14af797dfb091fa253a0840581d48d875",
  "validation/hard-decoy-holdout-v3/domain-remainder-screen-2026-09-04/sequence-screens.jsonl": "3a2db9aed20155ad2a944625fc4ca020c59d1d4b205ab9c521f8fd1682328499",
  "validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/sequence-screens.jsonl": "f58e3d3cf3c3d2e073b6f2eb7d9c5957b18bcc573fb0adc6dd460946a6ce4bea",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl": "58d435ce89bd45c997aa89f0816340c273d24f5474e2d38c2bd2c85fce3cc39d",
  "validation/hard-decoy-holdout-v3/receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl": "ac6d733ec4658b17349b8ca63cc9a4fbf18ce9c761b7c9ed38fcd4854e8b15f3",
  "validation/hard-decoy-holdout-v3/mglyr-development-review-2026-09-08/domain-profiles.jsonl": "9f5dcf0dae23605d1c272d09cdc653c5794266fcf1eb39f04c31f85196cd16d6",
  "validation/hard-decoy-holdout-v3/mglyr-canonical-capture-2026-09-08/profile.json": "fba61c5883453649ad9a3a9ee3e9a6ebbd311d94b0d728c23912e35dccb98359",
  "validation/hard-decoy-holdout-v3/dp1-receptor-followup-2026-09-05/profile.json": "596563e70f8832022beae02c0fc4bf19ed98956f2a38c315cb3484887ff01ad1",
  "validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/proposed-canonical-receptor-profile.json": "198d913cb0e4accc5616149d5aeb7c139b9d105b0be0a56fa60ab08e65906259",
  "validation/hard-decoy-holdout-v3/prostanoid-role-adjudication-2026-09-06/source-reviews.json": "96f082310dc08afc727e0770f901f81e85c4e70dfa6dc417593e101f371c7853",
  "validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json": "bc31adf14cf1222ebade348337facefb209c286c631f0da0bf640bd778b0688f",
  "validation/hard-decoy-holdout-v3/receptor-tm-contract-2026-08-30.json": "abd88bbae2d35fda28dc9339f80d91c65d95c4b9f844d74ddff7249090eea412",
  "scripts/hard-decoy-v3/compare-domain-remainder-development.mjs": "60a9448f4f42c21f87ff1d998eb0ee773570a9eeec9b065c9f9659e8b3cfd990",
  "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs": "5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb",
  "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs": "4316347ee87f6c945f3cb3ed8b3128bb3b2468ec5dfdb158d4e297119821fa6b",
  "scripts/hard-decoy/oracle/canonical-json.mjs": "6d60625e181d68671d98ec59258660f27799c83261ddaa197ae0a2e449730f5f",
  "node_modules/immunum/immunum.js": "a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00",
  "node_modules/immunum/immunum_bg.wasm": "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b",
  "HARD_DECOY_PROTOCOL_V3.md": "1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376"
};
const AUTHORITY = { formalLeakageEdgeAuthority: false, formalNoEdgeAuthority: false,
  independenceCertified: false, wholeCensusComplete: false, targetFreezePermitted: false,
  independentlyEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false };
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${canonicalJson(value)}\n`;
const jsonl = values => values.map(json).join('');
const unique = values => [...new Set(values)].sort();
const parse = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: 64000000, maximumTokens: 5000000, maximumDepth: 32 });
const parseRows = bytes => {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(value.endsWith('\n'), 'Missing JSONL terminator');
  return value.trimEnd().split('\n').map(line => parse(Buffer.from(line)));
};
const commitment = ids => ({ count: ids.length, uniqueCount: new Set(ids).size, sortedIdentifierStreamSha256: sha(`${[...ids].sort().join('\n')}\n`) });
const sourceAlias = source => source.replace(BASE, '').replace(/\/(?:entries|sequence-screens)\.jsonl$/, '').replace(/\/sequence-evidence\/(?:metadata-entry\.json)?$/, '');
const take = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));
const alignmentFields = ['alignmentScore', 'identicalResidueColumns', 'alignmentColumns', 'gapColumns', 'identity'];

async function boundRead(root, relative, expected) {
  assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && !['.', '..'].includes(part)), 'Unsafe relative path');
  const target = path.join(root, relative);
  assert.equal(await realpath(target), target, 'Symlink input forbidden');
  const info = await lstat(target, { bigint: true });
  assert.ok(info.isFile() && info.nlink === 1n && info.size <= 64000000n, 'Expected bounded regular file');
  const bytes = await readFile(target);
  assert.equal(BigInt(bytes.length), info.size, 'File changed while reading');
  if (expected) assert.equal(sha(bytes), expected, `Pinned input changed: ${relative}`);
  return bytes;
}

/** All supplied source rows are retained. This union is an enumerated metadata scope, never a census. */
export function buildCandidateComparison({ metadataSources, screenSources, frozenVhh, receptorProfiles, queryVhh, queryReceptor, vhhContract, receptorContract, retainedDispositions = [] }) {
  const sequences = new Map(), metadataInventory = [], annotations = new Map();
  assert.equal(new Set(metadataSources.map(row => row.source)).size, metadataSources.length, 'Duplicate metadata source');
  for (const { source, entries } of metadataSources) {
    assert.equal(new Set(entries.map(row => row.pdbId)).size, entries.length, 'Duplicate entry in metadata source');
    for (const entry of entries) {
      assert.equal(new Set(entry.polymerEntities.map(row => row.entityId)).size, entry.polymerEntities.length, 'Duplicate deposited entity');
      for (const entity of entry.polymerEntities) {
        assert.equal(sha(entity.sequence), entity.sequenceSha256, 'Metadata sequence digest mismatch');
        assert.equal(entity.sequence.length, entity.sequenceLength, 'Metadata sequence length mismatch');
        const rowId = `${sourceAlias(source)}#${entry.pdbId}_${entity.entityId}`;
        const member = { rowId, pdbId: entry.pdbId, entityId: entity.entityId, sequenceSha256: entity.sequenceSha256,
          retainedDispositionStatus: entry.dispositionStatus ?? null };
        metadataInventory.push(member);
        const prior = sequences.get(entity.sequenceSha256);
        if (prior) { assert.equal(prior.sequence, entity.sequence, 'Sequence digest collision'); prior.members.push(member); }
        else sequences.set(entity.sequenceSha256, { sequence: entity.sequence, members: [member] });
        for (const ref of entity.referenceSequences ?? []) if (ref.databaseName === 'UniProt') {
          if (!annotations.has(ref.databaseAccession)) annotations.set(ref.databaseAccession, new Set());
          annotations.get(ref.databaseAccession).add(`${entry.pdbId}_${entity.entityId}`);
        }
      }
    }
  }
  assert.equal(new Set(screenSources.map(row => row.source)).size, screenSources.length, 'Duplicate screen source');
  const domainProfiles = new Map(), candidateRows = [], screenAccounting = [], numberingCache = new Map();
  function number(sequence) {
    const key = sha(sequence);
    if (!numberingCache.has(key)) numberingCache.set(key, numberVhhForLeakage(sequence));
    return numberingCache.get(key);
  }
  function register(rowId, sequence, expected, sourceDetails, window = null) {
    let numbered = null, status = 'UNRESOLVED_SOURCE_SEQUENCE_UNAVAILABLE', profileId = null;
    if (sequence !== null) {
      if (window) {
        const result = reproduceDomainCall(sequence, window);
        numbered = result.numbering;
        sequence = result.domainSequence;
        status = result.reusableForThreshold ? 'COMPUTED_SEQUENCE_REVIEW_SIGNAL' : 'UNRESOLVED_NUMBERING_OR_BOUNDARY_DISAGREEMENT';
      } else {
        numbered = number(sequence);
        const reproduced = ['numberingStatus', 'frameworkSequence', 'cdr3Sequence', 'queryStart', 'queryEnd', 'completeImgtRegionCoverage', 'numberingSegmentationAgreement']
          .every(key => numbered[key] === expected[key]);
        status = reproduced && numbered.numberingStatus === 'NUMBERED' && numbered.completeImgtRegionCoverage && numbered.numberingSegmentationAgreement
          ? 'COMPUTED_SEQUENCE_REVIEW_SIGNAL' : 'UNRESOLVED_NUMBERING_OR_BOUNDARY_DISAGREEMENT';
      }
      profileId = `${sha(sequence)}:${numbered.frameworkSequenceSha256 ?? 'unresolved'}:${numbered.cdr3SequenceSha256 ?? 'unresolved'}`;
      if (!domainProfiles.has(profileId)) domainProfiles.set(profileId, { profileId, domainOrContainingSequenceSha256: sha(sequence), numbering: numbered, status });
      else assert.equal(domainProfiles.get(profileId).status, status, 'Conflicting profile reuse status');
    }
    candidateRows.push({ rowId, profileId, status, ...sourceDetails });
  }
  assert.equal(new Set(frozenVhh.map(row => row.profileId)).size, frozenVhh.length, 'Duplicate frozen VHH profile');
  for (const row of frozenVhh) {
    assert.equal(sha(row.fullSequence), row.fullSequenceSha256, 'Frozen VHH digest mismatch');
    register(`frozen-vhh:${row.profileId}`, row.fullSequence, row,
      { sourceKind: 'FROZEN_CANDIDATE_PROFILE', pdbIds: [row.pdbId], entityId: row.entityId,
        sourceFullSequenceSha256: row.fullSequenceSha256, retainedNumberingStatus: row.numberingStatus });
  }
  for (const { source, rows } of screenSources) {
    assert.equal(new Set(rows.map(row => row.sequenceSha256)).size, rows.length, 'Duplicate sequence screen');
    for (const row of rows) {
      const sequence = sequences.get(row.sequenceSha256);
      assert.ok(!sequence || sequence.sequence.length === row.sequenceLength, 'Screen sequence length mismatch');
      const rowId = `${sourceAlias(source)}#${row.sequenceSha256}`;
      const callIds = new Set();
      for (const call of row.heavyChainDomains) {
        const callId = `${rowId}:${call.start}:${call.end}`;
        assert.ok(!callIds.has(callId), 'Duplicate retained domain call'); callIds.add(callId);
        register(callId, sequence?.sequence ?? null, null,
          { sourceKind: 'ADDITIVE_RETAINED_DOMAIN_CALL', sourceFullSequenceSha256: row.sequenceSha256,
            pdbIds: unique(sequence?.members.map(member => member.pdbId) ?? []),
            metadataMemberIds: sequence?.members.map(member => member.rowId) ?? [],
            overlappingDomainCallsRetained: row.overlappingDomainCalls,
            start: call.start, end: call.end }, call);
      }
      screenAccounting.push({ rowId, domainCallIds: [...callIds].sort(),
        status: !sequence ? 'UNRESOLVED_SOURCE_SEQUENCE_UNAVAILABLE' : callIds.size ? 'RETAINED_CALLS_COMPARED' : 'NO_RETAINED_COMPLETE_DOMAIN_CALL_NOT_ABSENCE_PROOF',
        sourceSequenceAvailable: Boolean(sequence), screenedDomainAbsenceIsBiologicalAbsence: false });
    }
  }
  assert.equal(new Set(candidateRows.map(row => row.rowId)).size, candidateRows.length, 'Duplicate candidate row');
  assert.equal(sha(queryVhh.domainSequence), queryVhh.domainSequenceSha256, 'Query VHH digest mismatch');
  const queryNumbering = number(queryVhh.domainSequence);
  assert.equal(canonicalJson(queryNumbering), canonicalJson(queryVhh.numbering), 'Query numbering changed');
  assert.equal(queryNumbering.numberingStatus, 'NUMBERED', 'Query cannot be numbered');
  const domainPairs = [...domainProfiles.values()].sort((a, b) => a.profileId.localeCompare(b.profileId)).map(profile => {
    const canCompare = profile.status === 'COMPUTED_SEQUENCE_REVIEW_SIGNAL';
    const framework = canCompare ? alignGlobalAffine(queryNumbering.frameworkSequence, profile.numbering.frameworkSequence, vhhContract.alignment) : null;
    const cdr3 = canCompare ? alignGlobalAffine(queryNumbering.cdr3Sequence, profile.numbering.cdr3Sequence, vhhContract.alignment) : null;
    return { pairId: `Nb20|${profile.profileId}`, profileId: profile.profileId,
      framework: framework && take(framework, alignmentFields), cdr3: cdr3 && take(cdr3, alignmentFields),
      criterion: framework ? evaluateFrozenVhhThreshold({ framework, cdr3, cdr3LengthA: queryNumbering.cdr3Length, cdr3LengthB: profile.numbering.cdr3Length }, vhhContract.edgeCriterion) : null,
      status: canCompare ? 'COMPUTED_SEQUENCE_REVIEW_SIGNAL' : profile.status,
      exactFrameworkAndCdr3Match: canCompare ? queryNumbering.frameworkSequence === profile.numbering.frameworkSequence && queryNumbering.cdr3Sequence === profile.numbering.cdr3Sequence : null,
      ...AUTHORITY };
  });
  const domainIndex = new Map(domainPairs.map(row => [row.profileId, row]));
  const vhhPairs = candidateRows.map(row => {
    const compared = domainIndex.get(row.profileId);
    return { ...row, pairId: `Nb20|${row.rowId}`, domainPairId: compared?.pairId ?? null,
      thresholdSatisfied: compared?.criterion?.thresholdCriterionSatisfied ?? null,
      status: !compared?.criterion ? row.status : compared.criterion.thresholdCriterionSatisfied ? 'POSITIVE_SEQUENCE_SIGNAL_REVIEW_REQUIRED' : 'NO_THRESHOLD_SIGNAL_NOT_NO_EDGE',
      queryFamilyEntryIds: row.pdbIds.filter(id => ['9VOR', '9VOS'].includes(id)),
      ...AUTHORITY };
  });
  assert.equal(new Set(receptorProfiles.map(row => row.rowId)).size, receptorProfiles.length, 'Duplicate receptor profile row');
  function validateTm(profile) {
    assert.equal(sha(profile.concatenatedTmSequence), profile.concatenatedTmSequenceSha256, 'Receptor TM digest mismatch');
    assert.equal(profile.concatenatedTmSequence.length, profile.concatenatedTmSequenceLength, 'Receptor TM length mismatch');
    assert.deepEqual(profile.tmSegments.map(row => row.segment), ['TM1', 'TM2', 'TM3', 'TM4', 'TM5', 'TM6', 'TM7'], 'Receptor segment scope mismatch');
    assert.equal(profile.tmSegments.map(row => row.sequence).join(''), profile.concatenatedTmSequence, 'Receptor segment concatenation mismatch');
    for (const segment of profile.tmSegments) assert.equal(sha(segment.sequence), segment.sequenceSha256, 'Receptor segment digest mismatch');
  }
  validateTm(queryReceptor);
  const tmCache = new Map();
  const receptorPairs = receptorProfiles.map(row => {
    const p = row.profile, accession = p.canonicalAccession ?? p.accession ?? null;
    const canCompare = p.mappingStatus === 'RESOLVED_UNIQUE_CANONICAL_GPCRDB_TM1_TM7' || p.extractionStatus === 'RESOLVED_CANONICAL_TM1_TM7';
    let comparison = null;
    if (canCompare) {
      validateTm(p);
      const key = p.concatenatedTmSequenceSha256;
      if (!tmCache.has(key)) {
        const alignment = alignGlobalAffineWithCoverage(queryReceptor.concatenatedTmSequence, p.concatenatedTmSequence, receptorContract.alignment);
        tmCache.set(key, { alignment, criterion: evaluateFrozenReceptorThreshold(alignment, receptorContract.thresholds) });
      }
      comparison = tmCache.get(key);
    }
    return { pairId: `Q5T848|${row.rowId}`, rowId: row.rowId, canonicalAccession: accession,
      pdbId: p.pdbId ?? null, sourceKind: row.sourceKind, sourceMappingStatus: p.mappingStatus ?? p.extractionStatus,
      depositedConstructAssignmentEstablishedByThisComparison: false,
      proposedReferenceOnly: row.sourceKind === 'ADDITIVE_PROPOSED_M1_REFERENCE',
      status: !comparison ? 'UNRESOLVED_CANONICAL_PROFILE' : accession === 'Q5T848' || comparison.criterion.primaryThresholdSatisfied ? 'POSITIVE_CANONICAL_SEQUENCE_SIGNAL_REVIEW_REQUIRED' : 'NO_PRIMARY_THRESHOLD_SIGNAL_NOT_NO_EDGE',
      canonicalTmSequenceSha256: p.concatenatedTmSequenceSha256 ?? null,
      exactCanonicalAccessionMatch: accession === 'Q5T848', comparison, ...AUTHORITY };
  });
  const recognized = new Set(receptorProfiles.filter(row => row.profile.concatenatedTmSequence).map(row => row.profile.canonicalAccession ?? row.profile.accession));
  const missingAnnotations = [...annotations].filter(([accession]) => !recognized.has(accession)).sort(([a], [b]) => a.localeCompare(b)).map(([accession, members]) => ({ accession, entityIds: [...members].sort(),
    status: 'NO_PROFILE_IN_ENUMERATED_CANDIDATE_UNION', isAssumedReceptor: false, missingProfileIsNoEdge: false }));
  const summary = { schemaVersion: '1.0.0', status: 'BOUNDED_CANDIDATE_SEQUENCE_REVIEW_ONLY',
    metadataSourceCount: metadataSources.length, metadataPolymerSourceRowCount: metadataInventory.length,
    uniqueMetadataSequenceCount: sequences.size, frozenCandidateVhhProfileCount: frozenVhh.length,
    screenSourceCount: screenSources.length, retainedSequenceScreenRowCount: screenAccounting.length,
    retainedDomainCallRowCount: candidateRows.length - frozenVhh.length,
    noRetainedDomainCallRowCount: screenAccounting.filter(row => !row.domainCallIds.length).length,
    missingScreenSequenceRowCount: screenAccounting.filter(row => !row.sourceSequenceAvailable).length,
    candidateVhhPairCount: vhhPairs.length, uniqueCandidateProfilePairCount: domainPairs.length,
    unresolvedVhhPairCount: vhhPairs.filter(row => row.thresholdSatisfied === null).length,
    positiveVhhPairCount: vhhPairs.filter(row => row.thresholdSatisfied).length,
    positiveVhhPairsOutsideQueryFamilyCount: vhhPairs.filter(row => row.thresholdSatisfied && row.pdbIds.some(id => !['9VOR', '9VOS'].includes(id))).length,
    candidateReceptorPairCount: receptorPairs.length, uniqueComputedReceptorTmSequenceCount: tmCache.size,
    unresolvedReceptorPairCount: receptorPairs.filter(row => !row.comparison).length,
    exactCanonicalAccessionLinkCount: receptorPairs.filter(row => row.exactCanonicalAccessionMatch).length,
    primaryPositiveReceptorPairCount: receptorPairs.filter(row => row.comparison && (row.exactCanonicalAccessionMatch || row.comparison.criterion.primaryThresholdSatisfied)).length,
    primaryPositiveReceptorPairsOutsideQueryFamilyCount: receptorPairs.filter(row => !row.exactCanonicalAccessionMatch && row.comparison?.criterion.primaryThresholdSatisfied).length,
    sensitivityPositiveReceptorPairCount: receptorPairs.filter(row => row.comparison && (row.exactCanonicalAccessionMatch || row.comparison.criterion.sensitivityThresholdSatisfied)).length,
    unprofiledUniProtAnnotationCount: missingAnnotations.length, retainedDispositionRecordCount: retainedDispositions.length,
    ...AUTHORITY };
  const commitments = Object.fromEntries([['metadata', metadataInventory.map(row => row.rowId)], ['screenRows', screenAccounting.map(row => row.rowId)],
    ['candidateVhhPairs', vhhPairs.map(row => row.pairId)], ['uniqueProfilePairs', domainPairs.map(row => row.pairId)], ['candidateReceptorPairs', receptorPairs.map(row => row.pairId)]]
    .map(([key, ids]) => [key, commitment(ids)]));
  for (const [key, value] of Object.entries(commitments)) assert.equal(value.count, value.uniqueCount, `Duplicate ${key} identifier`);
  return { summary, commitments, metadataInventory, screenAccounting, candidateRows, domainPairs, vhhPairs, receptorPairs, missingAnnotations, retainedDispositions };
}

export async function buildMglyrCandidateFiles({ repositoryRoot = ROOT } = {}) {
  const root = path.resolve(repositoryRoot);
  assert.equal(await realpath(root), root, 'Repository root contains symlinks');
  const loaded = new Map(), inputDigests = {};
  for (const [relative, digest] of Object.entries(PINNED)) {
    const bytes = await boundRead(root, relative, digest); loaded.set(relative, bytes);
    inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  for (const relative of [SCRIPT, 'package-lock.json', 'node_modules/immunum/package.json']) {
    const bytes = await boundRead(root, relative); inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length };
  }
  const getRows = relative => parseRows(loaded.get(BASE + relative));
  const getJson = relative => parse(loaded.get(BASE + relative));
  const metadataSources = Object.keys(PINNED).filter(relative => relative.endsWith('/entries.jsonl')).map(source => ({ source, entries: parseRows(loaded.get(source)) }));
  const m1 = `${BASE}m1-nb1b4-source-review-2026-09-04/sequence-evidence/metadata-entry.json`;
  metadataSources.push({ source: m1, entries: [parse(loaded.get(m1))] });
  const screenSources = Object.keys(PINNED).filter(relative => relative.endsWith('/sequence-screens.jsonl')).map(source => ({ source, rows: parseRows(loaded.get(source)) }));
  const receptorProfiles = getRows('receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl').map(profile => ({ rowId: `frozen-receptor:${profile.nodeId}`, sourceKind: 'FROZEN_CANDIDATE_PROFILE', profile }));
  for (const [relative, sourceKind] of [['dp1-receptor-followup-2026-09-05/profile.json', 'ADDITIVE_DP1_CANONICAL_REFERENCE'], ['m1-nb1b4-source-review-2026-09-04/sequence-evidence/proposed-canonical-receptor-profile.json', 'ADDITIVE_PROPOSED_M1_REFERENCE'], ['mglyr-canonical-capture-2026-09-08/profile.json', 'QUERY_FAMILY_CANONICAL_REFERENCE']])
    receptorProfiles.push({ rowId: relative, sourceKind, profile: getJson(relative) });
  const retainedDispositions = getJson('prostanoid-role-adjudication-2026-09-06/source-reviews.json').reviews.map(row => take(row, ['pdbId', 'roleClass', 'entryDisposition', 'dispositionReason', 'componentEffect']));
  const queryRows = getRows('mglyr-development-review-2026-09-08/domain-profiles.jsonl'); assert.equal(queryRows.length, 1, 'Expected one Nb20 profile');
  const result = buildCandidateComparison({ metadataSources, screenSources,
    frozenVhh: getRows('vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl'), receptorProfiles,
    queryVhh: queryRows[0], queryReceptor: getJson('mglyr-canonical-capture-2026-09-08/profile.json'),
    vhhContract: getJson('vhh-sequence-contract-2026-08-29.json'), receptorContract: getJson('receptor-tm-contract-2026-08-30.json'), retainedDispositions });
  assert.equal(result.summary.frozenCandidateVhhProfileCount, 285);
  assert.equal(result.summary.candidateReceptorPairCount, 290);
  const files = new Map([['summary.json', json(result.summary)], ['pair-space-commitments.json', json(result.commitments)],
    ['source-inventory.json', json({ metadataSources: metadataSources.map(({ source, entries }) => ({ source, alias: sourceAlias(source), entryCount: entries.length, polymerSourceRowCount: entries.reduce((sum, entry) => sum + entry.polymerEntities.length, 0) })), screenSources: screenSources.map(({ source, rows }) => ({ source, alias: sourceAlias(source), screenRowCount: rows.length, retainedDomainCallCount: rows.reduce((sum, row) => sum + row.heavyChainDomains.length, 0) })), note: 'Every upstream metadata row is bound by input file digests and the complete row-identifier stream commitment; those upstream records are not duplicated here.' })], ['screen-accounting.jsonl', jsonl(result.screenAccounting)],
    ['domain-candidate-pairs.jsonl', jsonl(result.domainPairs)], ['candidate-vhh-pairs.jsonl', jsonl(result.vhhPairs)],
    ['candidate-receptor-pairs.jsonl', jsonl(result.receptorPairs)], ['unprofiled-annotations.jsonl', jsonl(result.missingAnnotations)],
    ['retained-prostanoid-dispositions.json', json(result.retainedDispositions)]]);
  files.set('README.md', `# GPR158/Nb20 bounded candidate comparison\n\nThis offline packet compares Nb20 against all 285 frozen candidate VHH profile rows and every retained domain call in six named screen inventories: GPCRdb complement, recent RCSB, annotation, global text, domain remainder and M1. Exact source hashes and every represented pair identifier are preserved. Sequence-only calls can also represent auxiliary binders, Fab domains or fused proteins; this is a search/review universe, not an eligible dataset.\n\nQ5T848 is compared against all 287 frozen candidate receptor rows plus the separately retained DP1, proposed M1 and query-family canonical profiles. The proposed M1 reference remains unassigned to its deposited construct. Missing or unnumbered profiles remain unresolved. UniProt annotations lacking a profile are enumerated without assuming they are receptors.\n\nThe query-family self comparisons (9VOR/9VOS) are intentionally retained. Repeated entries, sequences and source epochs are not independent components. Auxiliary prostanoid exclusions are copied unchanged and no disposition or formal graph is rewritten. Negative sequence signals establish neither absence nor unrelated ancestry. Other uncollected discovery identifiers and unrecognized domains remain outside the compared profile universe.\n\nAll 30,538 metadata source rows are bound by the input hashes and a complete sorted row-identifier commitment; source inventory counts and all comparison rows are retained without duplicating the upstream metadata snapshot.\n\nThe same frozen IMGT and alignment/threshold functions are used; no coordinates, relative poses, contact tables, reference labels, prediction outputs or article bodies are read. Parent/variant provenance, construct evidence, publication-family and exposure adjudication remain separate requirements. Cleared independent groups added: zero.\n\nRestore compressed metadata first with \`node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs\`, then verify with \`node scripts/hard-decoy-v3/compare-mglyr-candidates.mjs verify\`. Collection requires an empty output directory.\n`);
  files.set('manifest.json', json({ schemaVersion: '1.0.0', inputDigests, ...AUTHORITY,
    metadataOnly: true, primaryArticleBodiesAccessed: false, offlineReplay: true,
    files: [...files].map(([name, bytes]) => ({ name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })) }));
  files.set('checksums.sha256', [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${sha(bytes)}  ${name}\n`).join(''));
  return { files, summary: result.summary };
}

export async function runMglyrCandidateComparison(mode, { repositoryRoot = ROOT, outputDirectory = path.join(repositoryRoot, MGLYR_CANDIDATE_OUTPUT) } = {}) {
  assert.ok(['collect', 'verify'].includes(mode), 'Expected collect or verify');
  const result = await buildMglyrCandidateFiles({ repositoryRoot });
  const output = path.resolve(outputDirectory);
  if (mode === 'collect') await mkdir(output, { recursive: true });
  assert.equal(await realpath(output), output, 'Output directory contains symlinks');
  const inventory = await readdir(output);
  if (mode === 'collect') {
    assert.deepEqual(inventory, [], 'Collection requires empty output directory');
    for (const [name, bytes] of result.files) await writeFile(path.join(output, name), bytes, { flag: 'wx' });
  } else {
    assert.deepEqual(inventory.sort(), [...result.files.keys()].sort(), 'Output inventory differs');
    for (const [name, bytes] of result.files) assert.ok((await boundRead(output, name)).equals(Buffer.from(bytes)), `Offline replay mismatch: ${name}`);
  }
  return result.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), mode = args.shift(), options = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    assert.ok(value && ['--repository-root', '--output-directory'].includes(flag), 'Invalid CLI arguments');
    const key = flag === '--repository-root' ? 'repositoryRoot' : 'outputDirectory';
    assert.ok(!(key in options), 'Duplicate CLI argument'); options[key] = path.resolve(value);
  }
  console.log(JSON.stringify(await runMglyrCandidateComparison(mode, options), null, 2));
}
