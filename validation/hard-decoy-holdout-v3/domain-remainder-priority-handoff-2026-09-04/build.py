"""Reproduce bounded metadata comparisons; no network or structural data access."""
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
ROOT = BASE.parents[1]
inputs = {}


def read(relative):
    path = BASE / relative
    data = path.read_bytes()
    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(data).hexdigest()
    return [json.loads(line) for line in data.decode().splitlines()]


sources = ['entry-metadata-snapshot-2026-08-29', 'gpcrdb-complement-metadata-2026-09-04',
           'gpcrdb-complement-replacements-2026-09-04', 'rcsb-recent-discovery-2026-09-04',
           'annotation-discovery-2026-09-04', 'annotation-additional-priority-review-2026-09-04/publication-closure',
           'domain-remainder-2026-09-04']
metadata = {name: read(f'{name}/entries.jsonl') for name in sources}
current = {row['pdbId']: row for row in metadata[sources[-1]]}
dev_profiles = read('vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl')
dev_receptors = read('receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl')
dev_nodes = read('development-metadata-snapshot-2026-08-29/development-nodes.jsonl')
screens = {r['sequenceSha256']: r for r in read('domain-remainder-screen-2026-09-04/sequence-screens.jsonl')}
assert len(dev_profiles) == 18 and len(dev_receptors) == len(dev_nodes) == 17

groups = [
    ('APJ_JN2419', 'P35414', [('9LQU', '1', '2'), ('9LQW', '2', '1'), ('9LQX', '2', '1'), ('9LR1', '5', '6'), ('9LR2', '3', '2')], False),
    ('GPR151_NB6', 'Q8TDV0', [('9W3K', '5', '4'), ('9W3L', '2', '1')], False),
    ('AT1R_AT118R_FUSION', 'P30556', [('9ZXC', '1', '1'), ('9ZXD', '1', '1')], True),
]
comparisons = []
for name, accession, members, fusion in groups:
    rows = []
    for pdb, candidate_id, receptor_id in members:
        entry = current[pdb]
        entities = {row['entityId']: row for row in entry['polymerEntities']}
        candidate, receptor = entities[candidate_id], entities[receptor_id]
        assert accession in {r['databaseAccession'] for r in receptor['referenceSequences'] if r['databaseName'] == 'UniProt'}
        sequence = candidate['sequence']
        assert hashlib.sha256(sequence.encode()).hexdigest() == candidate['sequenceSha256']
        match = screens[candidate['sequenceSha256']]
        same_accession = [r for r in dev_receptors if r['canonicalAccession'] == accession]
        development = []
        for profile in same_accession:
            node = next(r for r in dev_nodes if r['pdbId'] == profile['pdbId'])
            development.append({'pdbId': node['pdbId'], 'registryReceptor': node['registryReceptor'],
                                'canonicalAccession': profile['canonicalAccession'], 'canonicalMappingStatus': profile['mappingStatus'],
                                'depositedReceptorEntitySequenceSha256': node['receptor']['sequenceSha256'],
                                'exactDepositedReceptorContainingEntitySequenceMatch': node['receptor']['sequenceSha256'] == receptor['sequenceSha256'],
                                'candidateVhhSequences': [{'entityId': r['entityId'], 'description': r['description'], 'sequenceLength': r['sequenceLength'],
                                                          'sequenceSha256': r['sequenceSha256'], 'exactFullEntityMatch': r['sequenceSha256'] == candidate['sequenceSha256']}
                                                         for r in node['vhhMetadataCandidates']]})
        full_matches = [{'pdbId': r['pdbId'], 'entityId': r['entityId'], 'profileId': r['profileId']}
                        for r in dev_profiles if r['fullSequenceSha256'] == candidate['sequenceSha256']]
        rows.append({'pdbId': pdb, 'candidateEntityId': candidate_id, 'candidateDescription': candidate['description'],
                     'candidateContainingEntitySequenceLength': len(sequence), 'candidateContainingEntitySequenceSha256': candidate['sequenceSha256'],
                     'standaloneCandidateSequenceDeposited': not fusion, 'fullVhhSequenceBoundaryEstablished': False,
                     'receptorContainingEntityId': receptor_id, 'receptorContainingEntityDescription': receptor['description'],
                     'receptorContainingEntitySequenceLength': receptor['sequenceLength'], 'receptorContainingEntitySequenceSha256': receptor['sequenceSha256'],
                     'receptorSourceUniProtAccessions': [r['databaseAccession'] for r in receptor['referenceSequences'] if r['databaseName'] == 'UniProt'],
                     'candidateReceptorAccessionForReview': accession, 'primaryCitation': entry['primaryCitation'],
                     'exactDevelopmentFullCandidateEntityMatches': full_matches,
                     'exactDevelopmentNumberedDomainMatches': [r for r in match['referenceMatches'] if r['category'] == 'DEVELOPMENT_PROFILE'],
                     'developmentCanonicalReceptorAccessionMatches': development,
                     'numberedDomainCalls': [{k: r[k] for k in ['start', 'end', 'sequenceLength', 'sequenceSha256']} for r in match['heavyChainDomains']],
                     'depositedPolymerEntityCount': len(entities)})
    hashes = {r['candidateContainingEntitySequenceSha256'] for r in rows}
    assert len(hashes) == 1
    digest = next(iter(hashes))
    occurrences = [{'source': source, 'pdbId': entry['pdbId'], 'entityId': entity['entityId']}
                   for source, entries in metadata.items() for entry in entries for entity in entry['polymerEntities']
                   if entity['sequenceSha256'] == digest]
    comparisons.append({'groupId': name, 'groupMeaning': 'Selected metadata records sharing an exact deposited candidate-containing entity sequence; not a formal leakage component.',
                        'candidateReceptorAccessionForReview': accession, 'candidateAndReceptorInSameDepositedEntity': fusion,
                        'exactFullEntityOccurrencesAcrossBoundMetadata': occurrences, 'entries': rows,
                        'formatReviewComplete': False, 'constructReviewComplete': False, 'directBindingRoleEstablished': False,
                        'parentVariantReviewComplete': False, 'developmentAdjudicationComplete': False, 'formalIndependenceEstablished': False})

control = next(r for r in dev_receptors if r['pdbId'] == '6O3C')
assert control['canonicalAccession'] == 'P56726'
data = {'schemaVersion': '1.0.0', 'studyId': 'confovhh-hard-decoy-holdout-v3', 'reviewDate': '2026-09-04',
        'scope': 'Exact metadata accession and sequence comparisons for nine selected entries; no new primary-literature review or structural access.',
        'inputDigests': dict(sorted(inputs.items())), 'developmentReceptorNodesCompared': len(dev_receptors),
        'developmentVhhProfilesCompared': len(dev_profiles), 'comparisons': comparisons,
        'developmentReferenceCorrection': {'pdbId': '6O3C', 'canonicalReceptorAccession': 'P56726', 'receptor': 'Smoothened', 'isApjDevelopmentReference': False},
        'limitations': ['A same canonical receptor accession signals a development relationship requiring formal adjudication; deposited constructs may differ.',
                        'No exact full-sequence or accession match does not establish absence of a development, family, parent-variant, or other leakage relationship.',
                        'Full fused-entity identity is not full VHH identity; numbering intervals are sequence-screen calls, not source-confirmed construct boundaries.',
                        'Binder names, short sequence length, and co-deposition do not establish VHH format, direct receptor binding, native construct eligibility, or independence.'],
        'formalLeakageGraphAuthority': False, 'entryDispositionsChanged': 0, 'newIndependentComponentCount': None,
        'nativeCoordinatesInspected': False, 'structureImagesInspected': False, 'holdoutLabelsAccessed': False,
        'targetFreezePermitted': False, 'broaderDiscoveryComplete': False}
content = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
assert len(sys.argv) == 2 and sys.argv[1] in ['build', 'verify']
if sys.argv[1] == 'build':
    (HERE / 'comparisons.json').write_text(content)
else:
    assert (HERE / 'comparisons.json').read_text() == content, 'Comparison packet does not reproduce'
print(json.dumps({'groups': len(comparisons), 'entries': sum(len(r['entries']) for r in comparisons), 'status': 'METADATA_COMPARISONS_ONLY'}))
