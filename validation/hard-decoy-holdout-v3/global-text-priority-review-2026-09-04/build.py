#!/usr/bin/env python3
"""Offline, portable review of four global-text metadata priorities."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
PREFIX = 'validation/hard-decoy-holdout-v3/'
INPUTS = [
    'HARD_DECOY_PROTOCOL_V3.md',
    PREFIX + 'global-text-discovery-2026-09-04/manifest.json',
    PREFIX + 'global-text-discovery-2026-09-04/entries.jsonl',
    PREFIX + 'global-text-screen-2026-09-04/manifest.json',
    PREFIX + 'global-text-screen-2026-09-04/entity-screens.jsonl',
    PREFIX + 'global-text-screen-2026-09-04/sequence-screens.jsonl',
    PREFIX + 'global-text-screen-2026-09-04/review-queue.jsonl',
    PREFIX + 'development-metadata-snapshot-2026-08-29/development-nodes.jsonl',
    PREFIX + 'development-metadata-snapshot-2026-08-29/entities.jsonl',
]
TARGETS = {'6N4Y', '6N50', '7T62', '8Q7O'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def read_lines(path):
    return [json.loads(line) for line in path.open()]


def canonical_comparison(entry):
    accession = {'6N4Y': 'P41594', '6N50': 'P41594', '7T62': 'Q8N158', '8Q7O': 'Q9NPG1'}[entry['pdbId']]
    record = read_json(HERE / 'sources' / ('uniprot-' + accession.lower() + '.body'))
    assert record['primaryAccession'] == accession
    canonical = record['sequence']['value']
    entity = next(entity for entity in entry['polymerEntities'] if any(
        item['databaseAccession'] == accession for item in entity['referenceSequences']))
    sequence = entity['sequence']
    canonical_start, canonical_end, prefix_length = {
        '6N4Y': (21, 571, 37), '6N50': (21, 571, 37),
        '7T62': (19, 579, 0), '8Q7O': (26, 138, 3),
    }[entry['pdbId']]
    fragment = canonical[canonical_start - 1:canonical_end]
    assert sequence[prefix_length:prefix_length + len(fragment)] == fragment
    assert len(fragment) == canonical_end - canonical_start + 1
    transmembranes = []
    for feature in record.get('features', []):
        if feature['type'] != 'Transmembrane':
            continue
        start, end = feature['location']['start']['value'], feature['location']['end']['value']
        tm_sequence = canonical[start - 1:end]
        transmembranes.append({'canonicalRange1Inclusive': [start, end],
                              'description': feature.get('description'),
                              'sequenceSha256': sha(tm_sequence.encode()),
                              'completeCanonicalSegmentPresentAsExactSubstring': tm_sequence in sequence})
    if entry['pdbId'] != '7T62':
        assert len(transmembranes) == 7
        assert not any(item['completeCanonicalSegmentPresentAsExactSubstring'] for item in transmembranes)
        assert canonical_end < min(item['canonicalRange1Inclusive'][0] for item in transmembranes)
    else:
        assert any('glypican family' in text['value'] for comment in record.get('comments', [])
                   if comment['commentType'] == 'SIMILARITY' for text in comment.get('texts', []))
    return {'receptorEntityId': entity['entityId'], 'canonicalAccession': accession,
            'canonicalLength': len(canonical), 'canonicalSequenceSha256': sha(canonical.encode()),
            'exactCanonicalRange1Inclusive': [canonical_start, canonical_end],
            'exactDepositedRange1Inclusive': [prefix_length + 1, prefix_length + len(fragment)],
            'exactFragmentLength': len(fragment), 'exactFragmentSha256': sha(fragment.encode()),
            'depositedPrefixOutsideCanonicalFragment': sequence[:prefix_length],
            'depositedSuffixOutsideCanonicalFragment': sequence[prefix_length + len(fragment):],
            'transmembraneAnnotationComparisons': transmembranes,
            'boundary': 'Canonical sequence and annotation comparison only; no resolved-coordinate or native-interface claim.'}


def build(repository):
    entries = [entry for entry in read_lines(repository / INPUTS[2]) if entry['pdbId'] in TARGETS]
    assert {entry['pdbId'] for entry in entries} == TARGETS
    screens = {(row['pdbId'], row['entityId']): row for row in read_lines(repository / INPUTS[4])
               if row['pdbId'] in TARGETS}
    nodes = read_lines(repository / INPUTS[7])
    development_entities = read_lines(repository / INPUTS[8])
    assert len(nodes) == 17
    excerpts = read_json(HERE / 'primary-excerpts.json')
    gpc2_deposition = next(item for item in excerpts[0]['paragraphs']
                          if 'D_1000256119' in item['paragraphText'])
    entry_metadata = read_json(HERE / 'sources/gpc2-7t62-core.body')
    assert entry_metadata['entry']['id'] == '7T62'
    assert {'database_code': 'D_1000256119', 'database_id': 'WWPDB'} in entry_metadata['database_2']
    mglur_deposition = next(item for item in excerpts[1]['paragraphs'] if item['sectionId'] == 'FN5')
    assert all(accession in mglur_deposition['paragraphText'] for accession in ['6N4Y', '6N50'])
    fzd = read_json(HERE / 'fzd3-source/allowed-sections.json')
    fzd_deposition = next(section for section in fzd['sections'] if section['title'] == 'Data availability')
    assert '8Q7O' in fzd_deposition['paragraphs'][0]
    reviews = []
    for entry in entries:
        assert len(entry['polymerEntities']) == entry['polymerEntityCountReported'] == 2
        inventory = []
        for entity in entry['polymerEntities']:
            assert len(entity['sequence']) == entity['sequenceLength']
            assert sha(entity['sequence'].encode()) == entity['sequenceSha256']
            screen = screens[(entry['pdbId'], entity['entityId'])]
            assert screen['sequenceSha256'] == entity['sequenceSha256']
            inventory.append({**entity, 'screenSummary': {key: screen[key] for key in (
                'status', 'priorityTier', 'numberedHeavyDomainCallCount', 'referenceMatchCount',
                'developmentSequenceMatch', 'priorSequenceExposure')}})
        comparison = canonical_comparison(entry)
        accessions = {item['databaseAccession'] for entity in entry['polymerEntities']
                      for item in entity['referenceSequences'] if item['databaseName'] == 'UniProt'}
        sequences = {entity['sequenceSha256'] for entity in entry['polymerEntities']}
        development = {
            'referenceNodeCount': len(nodes),
            'exactReceptorAccessionMatches': [node['pdbId'] for node in nodes
                                             if accessions.intersection(node['receptor'].get('uniprotAccessions', []))],
            'exactPublicationDoiMatches': [node['pdbId'] for node in nodes
                                          if (node['publication'].get('doi') or '').lower() == entry['primaryCitation']['doi'].lower()],
            'exactFullPolymerSequenceMatches': [{'pdbId': row['pdbId'], 'entityId': row['entityId'],
                                                'sequenceSha256': row['sequenceSha256']}
                                               for row in development_entities if row['sequenceSha256'] in sequences],
            'noMatchDoesNotEstablishNoEdge': True, 'formalLeakageGraphComplete': False,
        }
        if entry['pdbId'] == '7T62':
            source_facts = [
                'Primary Methods identify CT3 as a mouse monoclonal antibody selected through hybridoma generation, and prepare its antigen-binding fragment with a Fab preparation kit.',
                'Separately prepared GPC2 and CT3 Fab were mixed at 1:1 molar ratio for a negative-stain EM sample.',
                'Primary Data and code availability names wwPDB deposition D_1000256119; captured RCSB database_2 assigns that exact deposition identifier to 7T62.',
                'UniProt Q8N158 annotates glypican-family membership and a GPI-anchor site; the entire deposited receptor sequence equals canonical residues 19–579.',
            ]
            status = 'PRIMARY_MOUSE_FAB_AND_GLYPICAN_TARGET_SUPPORTED'
            unresolved = ['The single 433-residue deposited CT3 entity must not be interpreted as an experimentally demonstrated single-chain VHH or as proof of a particular Fab chain topology.',
                          'The primary GPC2 preparation paragraph does not define the complete experimental GPC2 expression construct; native geometry remains uninspected.']
        elif entry['pdbId'] == '8Q7O':
            source_facts = [
                'Primary Data availability explicitly identifies 8Q7O as FZD3 cysteine-rich domain with Nb8; 8QW4 is a distinct Nb9-containing deposition.',
                'Construct Methods specify human FZD3 CRD residues 26–138 and coexpression of tagged CRD with untagged Nb8; purification uses 3C protease and EndoF1.',
                'The deposited receptor exactly contains canonical Q9NPG1 residues 26–138, with terminal sequence retained separately. The annotated TM1–TM7 segments are outside this receptor fragment.',
            ]
            status = 'PRIMARY_CRD_NANOBODY_SAMPLE_SUPPORTED_ALIAS_AND_RESIDUAL_TAG_PROVENANCE_PENDING'
            unresolved = ['Primary Nb8 versus deposited Nanobody 14478 requires exact binder alias/sequence reconciliation.',
                          'Methods describe precursor tags and cleavage, but do not explicitly state the complete deposited post-cleavage terminal sequence.',
                          'An extracellular-domain sample is not a full seven-transmembrane receptor input; no formal eligibility or exclusion follows automatically.']
        else:
            source_facts = [
                'Primary Data availability explicitly maps 6N4Y to mGlu5 ECD plus Nb43 and 6N50 to ECD plus Nb43 and L-quisqualate.',
                'Primary ECD Methods specify human mGlu5 residues 21–569 followed by a hexahistidine tag and describe removal of that tag with carboxypeptidases.',
                'Nb43 was expressed as a SUMO precursor, followed by ULP1 removal of the His-SUMO tag and separate purification; the ECD and Nb43 were subsequently combined.',
                'Both deposited receptor sequences instead contain a 37-residue prefix, canonical P41594 residues 21–571 and an eight-histidine suffix. They therefore do not directly reproduce the stated purified ECD construct.',
                'All seven captured canonical TM segment sequences are outside the matched extracellular fragment and absent as complete exact substrings from either deposited receptor.',
            ]
            status = 'PRIMARY_ECD_NB43_SAMPLE_SUPPORTED_EXPERIMENTAL_DEPOSITED_CONSTRUCT_DISCREPANCY'
            unresolved = ['Reconcile the deposited prefix, two additional canonical residues and retained eight-histidine suffix with Methods residues 21–569 and tag removal.',
                          'The two entries have identical deposited receptor and Nb43 sequences and share a publication; they are not two newly certified independent components.',
                          'The limited source-heading/model-building exposure in exposure-scope.json requires adjudication; no clean-blind claim is made.']
        reviews.append({'pdbId': entry['pdbId'], 'title': entry['title'],
                        'primaryCitation': entry['primaryCitation'], 'polymerInventory': inventory,
                        'allPolymerInventoryComplete': True, 'canonicalSequenceComparison': comparison,
                        'sourceFacts': source_facts, 'status': status, 'unresolved': unresolved,
                        'developmentMetadataComparison': development,
                        'formalExclusionAuthority': False, 'formalLeakageGraphAuthority': False,
                        'formalNoEdgeAuthority': False, 'targetFreezePermitted': False})
    mglur = [row for row in reviews if row['pdbId'] in {'6N4Y', '6N50'}]
    assert [[entity['sequenceSha256'] for entity in row['polymerInventory']] for row in mglur][0] == [
        entity['sequenceSha256'] for entity in mglur[1]['polymerInventory']]
    captures = []
    for path in sorted((HERE / 'sources').glob('*.capture.json')):
        record = read_json(path)
        body = HERE / record['file']
        assert sha(body.read_bytes()) == record['sha256'] and body.stat().st_size == record['bytes']
        captures.append({key: record[key] for key in ('id', 'url', 'status', 'file', 'bytes', 'sha256')})
    return {'schemaVersion': '1.0.0', 'studyId': 'confovhh-hard-decoy-holdout-v3',
            'scope': 'Four entries prioritized by global receptor-text metadata/sequence screening; three primary publications.',
            'inputDigests': {name: sha((repository / name).read_bytes()) for name in INPUTS},
            'primaryExcerptFile': 'primary-excerpts.json', 'fzd3SourceFile': 'fzd3-source/source-facts.json',
            'sourceCaptures': captures, 'additionalFzd3Captures': 2,
            'exactDepositionLinks': [
                {'pdbId': '7T62', 'method': 'Primary wwPDB deposition identifier joined to RCSB database_2',
                 'wwpdbId': 'D_1000256119', 'primaryParagraphSha256': gpc2_deposition['paragraphTextSha256']},
                {'pdbId': '8Q7O', 'method': 'Exact PDB accession in primary Data availability',
                 'primaryParagraphSha256': sha(fzd_deposition['paragraphs'][0].encode())},
                *[{'pdbId': pdb_id, 'method': 'Exact PDB accession in primary Data availability',
                   'primaryParagraphSha256': mglur_deposition['paragraphTextSha256']} for pdb_id in ['6N4Y', '6N50']],
            ],
            'reviews': reviews,
            'summary': {'reviewedEntries': 4, 'primaryPublicationCount': 3, 'inventoriedPolymerEntities': 8,
                        'primaryDepositionLinksVerified': 4, 'newEligibleTargets': 0,
                        'newIndependentComponentsCertified': 0, 'wholeCensusComponentUpperBound': None,
                        'targetFreezePermitted': False},
            'evidenceBoundary': {'nativeCoordinatesInspected': False, 'structuralImagesInspected': False,
                                 'contactTablesInspected': False, 'dockqLabelsAccessed': False,
                                 'predictionPerformanceOutputsAccessed': False,
                                 'incidentalSourceProseExposure': True, 'exposureScopeFile': 'exposure-scope.json',
                                 'formalExclusionAuthority': False, 'formalLeakageGraphAuthority': False,
                                 'formalNoEdgeAuthority': False, 'absenceOfHiddenVhhEstablished': False}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['build', 'verify'])
    parser.add_argument('--repository-root', type=Path)
    args = parser.parse_args()
    repository = args.repository_root or next((parent for parent in (HERE, *HERE.parents)
                                               if (parent / 'HARD_DECOY_PROTOCOL_V3.md').is_file()), Path.cwd())
    output = HERE / 'source-reviews.json'
    result = build(repository.resolve())
    if args.mode == 'build':
        output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps(result['summary']))
    else:
        assert read_json(output) == result
        subprocess.run([sys.executable, '-B', str(HERE / 'extract_primary.py'), 'verify'], check=True)
        subprocess.run([sys.executable, '-B', str(HERE / 'fzd3-source/capture_extract.py'), 'verify'], check=True)
        files = {}
        for line in (HERE / 'checksums.sha256').read_text().splitlines():
            expected, name = line.split('  ', 1)
            assert name not in files and sha((HERE / name).read_bytes()) == expected, name
            files[name] = expected
        actual = {path.relative_to(HERE).as_posix() for path in HERE.rglob('*')
                  if path.is_file() and path != HERE / 'checksums.sha256'}
        assert set(files) == actual
        print(json.dumps({'verifiedFiles': len(files), **result['summary']}))


if __name__ == '__main__':
    main()
