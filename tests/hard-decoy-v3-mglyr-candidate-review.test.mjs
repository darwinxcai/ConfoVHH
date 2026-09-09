import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCandidateComparison, buildMglyrCandidateFiles, runMglyrCandidateComparison, MGLYR_CANDIDATE_OUTPUT } from '../scripts/hard-decoy-v3/compare-mglyr-candidates.mjs';
import { numberVhhForLeakage } from '../scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = path.join(ROOT, 'validation/hard-decoy-holdout-v3');
const sha = value => createHash('sha256').update(value).digest('hex');
const load = async relative => JSON.parse(await readFile(path.join(BASE, relative), 'utf8'));
const queryVhh = JSON.parse((await readFile(path.join(BASE, 'mglyr-development-review-2026-09-08/domain-profiles.jsonl'), 'utf8')).trim());
const queryReceptor = await load('mglyr-canonical-capture-2026-09-08/profile.json');
const vhhContract = await load('vhh-sequence-contract-2026-08-29.json');
const receptorContract = await load('receptor-tm-contract-2026-08-30.json');
function fixture() {
  const sequence = queryVhh.domainSequence, n = numberVhhForLeakage(sequence);
  const call = { start: 0, end: sequence.length, sequenceSha256: sha(sequence), sequenceLength: sequence.length,
    frameworkSequenceSha256: n.frameworkSequenceSha256, cdr3SequenceSha256: n.cdr3SequenceSha256,
    frameworkLength: n.frameworkLength, cdr3Length: n.cdr3Length };
  return { queryVhh: structuredClone(queryVhh), queryReceptor: structuredClone(queryReceptor), vhhContract, receptorContract,
    frozenVhh: [{ ...n, profileId: 'candidate:SYN1#entity:2', pdbId: 'SYN1', entityId: '2', fullSequence: sequence, fullSequenceSha256: sha(sequence) }],
    metadataSources: [{ source: 'synthetic-metadata', entries: [{ pdbId: 'SYN1', dispositionStatus: 'EXCLUDED_AUXILIARY', polymerEntities: [
      { entityId: '2', sequence, sequenceLength: sequence.length, sequenceSha256: sha(sequence), referenceSequences: [{ databaseName: 'UniProt', databaseAccession: 'UNKNOWN' }] } ] }] }],
    screenSources: [{ source: 'synthetic-screen', rows: [{ sequenceSha256: sha(sequence), sequenceLength: sequence.length, heavyChainDomains: [call], overlappingDomainCalls: false }] }],
    receptorProfiles: [{ rowId: 'same-canonical', sourceKind: 'SYNTHETIC_SOURCE', profile: structuredClone(queryReceptor) }],
    retainedDispositions: [{ pdbId: 'SYN1', roleClass: 'AUXILIARY', entryDisposition: 'EXCLUDED_AUXILIARY' }] };
}

test('candidate comparison retains complete source/pair accounting and never grants eligibility', () => {
  const result = buildCandidateComparison(fixture());
  assert.equal(result.summary.candidateVhhPairCount, 2);
  assert.equal(result.summary.uniqueCandidateProfilePairCount, 1);
  assert.equal(result.summary.positiveVhhPairCount, 2);
  assert.equal(result.summary.primaryPositiveReceptorPairCount, 1);
  assert.equal(result.summary.independentlyEligibleGroupsAdded, 0);
  assert.equal(result.summary.independenceCertified, false);
  assert.equal(result.summary.wholeCensusComplete, false);
  assert.equal(result.retainedDispositions[0].entryDisposition, 'EXCLUDED_AUXILIARY');
  assert.equal(result.metadataInventory[0].retainedDispositionStatus, 'EXCLUDED_AUXILIARY');
  assert.equal(result.missingAnnotations[0].isAssumedReceptor, false);
  for (const c of Object.values(result.commitments)) assert.equal(c.count, c.uniqueCount);
  for (const row of [...result.vhhPairs, ...result.receptorPairs]) {
    assert.equal(row.formalLeakageEdgeAuthority, false); assert.equal(row.formalNoEdgeAuthority, false);
  }
});

test('unavailable source sequence is an unresolved pair and no-call screens are not absence proof', () => {
  const input = fixture(); input.metadataSources = [];
  let result = buildCandidateComparison(input);
  assert.equal(result.summary.missingScreenSequenceRowCount, 1);
  assert.equal(result.summary.unresolvedVhhPairCount, 1);
  assert.equal(result.vhhPairs[1].thresholdSatisfied, null);
  assert.equal(result.vhhPairs[1].domainPairId, null);
  input.screenSources[0].rows[0].heavyChainDomains = [];
  result = buildCandidateComparison(input);
  assert.equal(result.summary.noRetainedDomainCallRowCount, 1);
  assert.equal(result.screenAccounting[0].screenedDomainAbsenceIsBiologicalAbsence, false);
  assert.equal(result.summary.candidateVhhPairCount, 1);
});

test('changed retained numbering cannot become a negative threshold comparison', () => {
  const input = fixture(); input.screenSources = [];
  input.frozenVhh[0].frameworkSequence = 'A';
  const result = buildCandidateComparison(input);
  assert.equal(result.summary.unresolvedVhhPairCount, 1);
  assert.equal(result.vhhPairs[0].thresholdSatisfied, null);
  assert.match(result.vhhPairs[0].status, /^UNRESOLVED/);
  assert.equal(result.domainPairs[0].framework, null);
});

test('unresolved receptor rows remain in the pair space and proposed references stay conditional', () => {
  const input = fixture();
  input.receptorProfiles.push({ rowId: 'unresolved', sourceKind: 'FROZEN_CANDIDATE_PROFILE', profile: { mappingStatus: 'FAIL_CLOSED_NO_VALID_GPCRDB_ACCESSION', pdbId: 'SYN2' } });
  input.receptorProfiles[0].sourceKind = 'ADDITIVE_PROPOSED_M1_REFERENCE';
  const result = buildCandidateComparison(input);
  assert.equal(result.receptorPairs.length, 2);
  assert.equal(result.summary.unresolvedReceptorPairCount, 1);
  assert.equal(result.receptorPairs[1].comparison, null);
  assert.equal(result.receptorPairs[0].proposedReferenceOnly, true);
  assert.equal(result.receptorPairs[0].depositedConstructAssignmentEstablishedByThisComparison, false);
});

test('unresolved query accession link is not counted as a computed receptor sequence signal', () => {
  const input = fixture();
  input.receptorProfiles = [{ rowId: 'unresolved-q5t848', sourceKind: 'FROZEN_CANDIDATE_PROFILE', profile: {
    mappingStatus: 'FAIL_CLOSED_MULTIPLE_VALID_GPCRDB_ACCESSIONS', canonicalAccession: 'Q5T848' } }];
  const result = buildCandidateComparison(input);
  assert.equal(result.summary.exactCanonicalAccessionLinkCount, 1);
  assert.equal(result.summary.unresolvedReceptorPairCount, 1);
  assert.equal(result.summary.primaryPositiveReceptorPairCount, 0);
  assert.equal(result.summary.sensitivityPositiveReceptorPairCount, 0);
  assert.equal(result.receptorPairs[0].comparison, null);
  assert.equal(result.receptorPairs[0].status, 'UNRESOLVED_CANONICAL_PROFILE');
});

test('duplicate source rows and mutated sequence, region and TM bindings fail closed', () => {
  const changes = [
    input => input.metadataSources.push(structuredClone(input.metadataSources[0])),
    input => input.screenSources.push(structuredClone(input.screenSources[0])),
    input => input.frozenVhh.push(structuredClone(input.frozenVhh[0])),
    input => input.receptorProfiles.push(structuredClone(input.receptorProfiles[0])),
    input => input.screenSources[0].rows.push(structuredClone(input.screenSources[0].rows[0])),
    input => input.screenSources[0].rows[0].heavyChainDomains.push(structuredClone(input.screenSources[0].rows[0].heavyChainDomains[0])),
    input => { input.metadataSources[0].entries[0].polymerEntities[0].sequence += 'A'; },
    input => { input.screenSources[0].rows[0].heavyChainDomains[0].start = -1; },
    input => { input.queryVhh.domainSequence += 'A'; },
    input => { input.queryReceptor.tmSegments[0].sequence += 'A'; },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => buildCandidateComparison(input)); }
});

test('retained pair receipt exactly replays with all negative and unresolved rows', async () => {
  const summary = await runMglyrCandidateComparison('verify');
  assert.deepEqual({ frozen: summary.frozenCandidateVhhProfileCount, calls: summary.retainedDomainCallRowCount, screens: summary.retainedSequenceScreenRowCount,
    vhh: summary.candidateVhhPairCount, unresolvedVhh: summary.unresolvedVhhPairCount, receptors: summary.candidateReceptorPairCount, unresolvedReceptors: summary.unresolvedReceptorPairCount },
  { frozen: 285, calls: 467, screens: 6357, vhh: 752, unresolvedVhh: 1, receptors: 290, unresolvedReceptors: 22 });
  assert.equal(summary.positiveVhhPairsOutsideQueryFamilyCount, 0);
  assert.equal(summary.primaryPositiveReceptorPairsOutsideQueryFamilyCount, 0);
  assert.equal(summary.independentlyEligibleGroupsAdded, 0);
  const rows = (await readFile(path.join(ROOT, MGLYR_CANDIDATE_OUTPUT, 'candidate-vhh-pairs.jsonl'), 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(rows.filter(row => row.thresholdSatisfied).map(row => row.pdbIds), [['9VOR', '9VOS']]);
  assert.deepEqual(rows.filter(row => row.thresholdSatisfied === null).map(row => row.pdbIds), [['8E0G']]);
});

test('source pin drift and symlink roots are rejected before a packet is written', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mglyr-candidate-pins-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const first = path.join(temporary, 'validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29');
  await mkdir(first, { recursive: true }); await writeFile(path.join(first, 'entries.jsonl'), '{}\n');
  await assert.rejects(buildMglyrCandidateFiles({ repositoryRoot: temporary }), /Pinned input changed/);
  const linked = `${temporary}-link`; await symlink(temporary, linked); t.after(() => rm(linked, { force: true }));
  await assert.rejects(buildMglyrCandidateFiles({ repositoryRoot: linked }), /root contains symlinks/);
});
