#!/usr/bin/env python3
"""Reproduce metadata-only ADGRV1 sequence reconciliation without network access."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUTS = [
    'HARD_DECOY_PROTOCOL_V3.md',
    'validation/hard-decoy-holdout-v3/annotation-additional-priority-review-2026-09-04/source-reviews.json',
    'validation/hard-decoy-holdout-v3/annotation-additional-priority-review-2026-09-04/incidental-prose-exposure.json',
    'validation/hard-decoy-holdout-v3/annotation-additional-priority-review-2026-09-04/sources/9fte-preprint-api.json',
    'validation/hard-decoy-holdout-v3/annotation-additional-priority-review-2026-09-04/sources/9fte-primary-index-evidence.json',
    'validation/hard-decoy-holdout-v3/annotation-priority-review-2026-09-04/source-reviews.json',
    'validation/hard-decoy-holdout-v3/annotation-priority-review-2026-09-04/exposure-caveat.json',
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(name):
    return json.loads((HERE / 'sources' / (name + '.body')).read_text())


def exact_occurrences(sequence, fragment):
    return [i + 1 for i in range(len(sequence) - len(fragment) + 1)
            if sequence.startswith(fragment, i)]


def construct_comparison(deposited, record):
    canonical = record['sequence']['value']
    longest = next((n for n in range(min(len(deposited), len(canonical)), 0, -1)
                    if deposited[:n] in canonical), 0)
    starts = exact_occurrences(canonical, deposited[:longest]) if longest else []
    return {
        'accession': record['primaryAccession'],
        'organism': record['organism']['scientificName'],
        'taxonomyId': record['organism']['taxonId'],
        'canonicalLength': len(canonical),
        'canonicalSequenceSha256': digest(canonical.encode()),
        'maximalExactDepositedPrefixLength': longest,
        'maximalExactPrefixCanonicalRanges1Inclusive': [[start, start + longest - 1] for start in starts],
        'depositedRemainderAfterMaximalPrefix': deposited[longest:],
        'exactOccurrencesOfDepositedFirst415Residues': exact_occurrences(canonical, deposited[:415]),
        'exactOccurrencesOfCompleteDepositedSequence': exact_occurrences(canonical, deposited),
        'interpretationBoundary': 'Exact sequence observation only. No species-of-experiment, construct-design, direct-interface, eligibility or no-edge certification.',
    }


def build(repository):
    old = json.loads((repository / INPUTS[1]).read_text())
    receptor = next(review for review in old['reviews'] if review['pdbId'] == '9FTE')['polymerInventory'][0]
    sequence = receptor['sequence']
    assert len(sequence) == receptor['sequenceLength'] == 426
    assert digest(sequence.encode()) == receptor['sequenceSha256']
    mouse_single = read('uniprot-b8jje0')
    search = read('uniprot-mouse-adgrv1')
    mouse_records = {record['primaryAccession']: record for record in search['results']}
    assert mouse_single['sequence']['value'] == mouse_records['B8JJE0']['sequence']['value']
    comparisons = [construct_comparison(sequence, mouse_single),
                   construct_comparison(sequence, mouse_records['Q8VHN7']),
                   construct_comparison(sequence, read('uniprot-q8wxg9'))]
    assert comparisons[0]['maximalExactDepositedPrefixLength'] == 415
    assert comparisons[0]['maximalExactPrefixCanonicalRanges1Inclusive'] == [[5884, 6298]]
    assert comparisons[0]['depositedRemainderAfterMaximalPrefix'] == 'SGRHHHHHHHH'
    assert len(mouse_records['Q8VHN7']['sequence']['value']) == 6298
    assert mouse_records['Q8VHN7']['entryType'] == 'UniProtKB reviewed (Swiss-Prot)'
    reviewed_mouse_tail = mouse_records['Q8VHN7']['sequence']['value'][5883:6298]
    reviewed_mouse_differences = [
        {'depositedPosition1': i + 1, 'canonicalPosition1': 5884 + i,
         'depositedResidue': deposited, 'canonicalResidue': canonical}
        for i, (deposited, canonical) in enumerate(zip(sequence[:415], reviewed_mouse_tail))
        if deposited != canonical
    ]
    assert reviewed_mouse_differences == [
        {'depositedPosition1': 239, 'canonicalPosition1': 6122,
         'depositedResidue': 'R', 'canonicalResidue': 'G'}]
    assert comparisons[2]['exactOccurrencesOfDepositedFirst415Residues'] == []

    candidate = read('epmc-candidate-literal')
    records = candidate['resultList']['result']
    assert candidate['request']['queryString'] == 'EXT_ID:2026.03.05.709805 OR DOI:10.64898/2026.03.05.709805'
    assert len(records) == 1 and records[0]['doi'] == '10.64898/2026.03.05.709805'
    alternate = read('epmc-direct-record')['resultList']['result']
    assert len(alternate) == 1 and alternate[0]['id'] == records[0]['id'] == 'PPR1220841'
    primary = read('pdbe-publications-9fte')['9fte'][0]
    emdb_primary = read('emdb-50743')['crossreferences']['citation_list']['primary_citation']['citation_type']
    assert primary['doi'] is None and primary['type'] == 'U'
    assert emdb_primary['published'] is False
    crossref = read('crossref-preprint')['message']
    assert crossref['DOI'].lower() == records[0]['doi']

    old_lgr = json.loads((repository / INPUTS[5]).read_text())
    previous_9s38 = next(review for review in old_lgr['reviews'] if review['pdbId'] == '9S38')
    lgr_primary = read('pdbe-publications-9s38')['9s38'][0]
    assert lgr_primary['doi'] is None and lgr_primary['type'] == 'U'
    lgr_query = read('epmc-9s38')
    assert lgr_query['request']['queryString'] == '"9S38"'

    captures = []
    for filename in sorted((HERE / 'sources').glob('*.capture.json')):
        record = json.loads(filename.read_text())
        body = HERE / record['file']
        assert body.stat().st_size == record['bytes']
        assert digest(body.read_bytes()) == record['sha256']
        captures.append({key: record[key] for key in ('id', 'url', 'status', 'file', 'bytes', 'sha256')})

    return {
        'schemaVersion': '1.0.0',
        'studyId': 'confovhh-hard-decoy-holdout-v3',
        'scope': 'ADGRV1 species/construct sequence reconciliation and independent official publication routes; bounded LGR4 9S38 citation follow-up.',
        'inputDigests': {name: digest((repository / name).read_bytes()) for name in INPUTS},
        'sourceCaptures': captures,
        'receptorSequenceComparison': {
            'pdbId': '9FTE', 'entityId': receptor['entityId'],
            'depositedSequenceLength': len(sequence), 'depositedSequenceSha256': digest(sequence.encode()),
            'method': 'Exact, case-sensitive canonical-sequence substring matching; all maximal prefix occurrences retained; no alignment or structure interpretation.',
            'comparisons': comparisons,
            'mouseSingleRecordAndSearchSequenceAgreement': True,
            'reviewedMouseCanonicalTailComparison': {
                'accession': 'Q8VHN7', 'depositedRange1Inclusive': [1, 415],
                'canonicalRange1Inclusive': [5884, 6298], 'matches': 414,
                'differences': reviewed_mouse_differences,
                'method': 'Position-by-position comparison with the same-length canonical C-terminal 415 residues; no gaps or coordinate information.',
                'variationOriginEstablished': False,
            },
            'fact': 'Deposited receptor residues 1–415 exactly match mouse B8JJE0 residues 5884–6298. The deposited sequence then appends SGRHHHHHHHH. The corresponding reviewed mouse Q8VHN7 fragment differs at one position (deposited R239 versus canonical G6122). The 415-residue block is not an exact substring of the captured human Q8WXG9 canonical sequence.',
            'inference': 'The deposited sequence supports its mouse annotation and is inconsistent with an unchanged fragment of the captured human canonical sequence. This does not establish which species or construct the experiment actually used.',
            'unresolved': 'Primary construct Methods are unavailable, so the preprint significance statement describing human ADGRV1 remains unreconciled; the origin and intended role of the terminal suffix are unverified.',
        },
        'adgrv1Publication': {
            'candidateDoi': records[0]['doi'], 'europePmcId': records[0]['id'],
            'candidateConfirmedBy': ['bioRxiv metadata retained in prior package', 'Europe PMC DOI and record-ID queries', 'Crossref DOI metadata'],
            'europePmcAvailabilityMetadata': {key: records[0].get(key) for key in ('isOpenAccess', 'inPMC', 'hasPDF', 'fullTextUrlList')},
            'pdbePrimaryCitation': {key: primary[key] for key in ('doi', 'title', 'pubmed_id', 'type')},
            'emdbPrimaryCitation': {'title': emdb_primary['title'], 'published': emdb_primary['published'], 'journal': emdb_primary['journal']},
            'halDoiQueryResultCount': read('hal-preprint')['response']['numFound'],
            'halTitleQueryResultCount': read('hal-title')['response']['numFound'],
            'crossrefPublicDeliveryLinks': crossref.get('link', []),
            'exactPrimaryDepositionParagraphRetrieved': False,
            'primaryConstructMethodsRetrieved': False,
            'status': 'CANDIDATE_CORROBORATED_EXACT_PRIMARY_DEPOSITION_AND_CONSTRUCT_PENDING',
            'limitations': 'PDBj publication links and PDBe/EMDB primary metadata retain unpublished attribution. Europe PMC gives only a DOI destination and no PMC/PDF record. HAL queries returned zero records, not proof of absence. Crossref syndication denied access; advertised bioRxiv JATS remained rate limited. Prior primary-PDF search-index exact-accession signal is not upgraded to a retrieved primary deposition statement.',
        },
        'lgr4_9s38CitationFollowup': {
            'primaryCitation': {key: lgr_primary[key] for key in ('doi', 'title', 'pubmed_id', 'type')},
            'europePmcQuery': lgr_query['request']['queryString'],
            'queryResultCount': lgr_query['hitCount'],
            'queryResults': [{key: row.get(key) for key in ('id', 'source', 'doi', 'title')} for row in lgr_query['resultList']['result']],
            'queryRelevanceAssessment': 'All three returned titles concern unrelated historical genetics/public health or mental-health interventions; none establishes deposition linkage.',
            'priorExactSequenceLead': 'All three polymer sequences match 9S37 in the archived review; exact sequence relatedness does not prove publication attribution.',
            'priorStatus': previous_9s38['reviewStatus'],
            'status': 'UNPUBLISHED_METADATA_RECONFIRMED_PRIMARY_LINK_STILL_PENDING',
            'absenceOfPublicationEstablished': False,
        },
        'evidenceBoundary': {
            'formalExclusionAuthority': False, 'formalLeakageGraphAuthority': False,
            'formalNoEdgeAuthority': False, 'eligibleTargetsAdded': 0,
            'independentComponentsCleared': 0, 'targetFreezePermitted': False,
            'wholeCensusComponentUpperBound': None,
            'nativeCoordinatesInspected': False, 'structuralFiguresInspected': False,
            'contactTablesInspected': False, 'dockqLabelsAccessed': False,
            'performanceResultsAccessed': False,
            'newStructuralResultsOrCaptionProseRead': False,
            'priorExposureCaveatsRemainInForce': True,
            'exposureScopeFile': 'exposure-scope.json',
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['build', 'verify'])
    parser.add_argument('--repository-root', type=Path)
    args = parser.parse_args()
    repository = args.repository_root or next(
        (parent for parent in (HERE, *HERE.parents)
         if (parent / 'HARD_DECOY_PROTOCOL_V3.md').is_file()), Path.cwd())
    output = HERE / 'source-followup.json'
    result = build(repository.resolve())
    if args.mode == 'build':
        output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
        print('Built source-followup.json from immutable metadata and sequence inputs.')
    else:
        assert json.loads(output.read_text()) == result
        inventory = []
        for line in (HERE / 'checksums.sha256').read_text().splitlines():
            expected, name = line.split('  ', 1)
            assert digest((HERE / name).read_bytes()) == expected, name
            inventory.append(name)
        actual = sorted(path.relative_to(HERE).as_posix() for path in HERE.rglob('*')
                        if path.is_file() and path.name != 'checksums.sha256')
        assert sorted(inventory) == actual
        print(json.dumps({'verifiedFiles': len(inventory), 'captures': len(result['sourceCaptures']),
                          'receptorSequenceComparisons': 3, 'exactPrimaryDepositionLinksResolved': 0,
                          'eligibleTargetsAdded': 0, 'targetFreezePermitted': False}))


if __name__ == '__main__':
    main()
