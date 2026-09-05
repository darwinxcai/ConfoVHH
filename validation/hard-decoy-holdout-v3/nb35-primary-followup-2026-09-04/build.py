#!/usr/bin/env python3
"""Offline replay of bounded bibliographic linkage and frozen polymer inventory."""
import copy
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PACKET = Path(__file__).resolve().parent
REPOSITORY = PACKET.parents[2]
PRIOR = 'validation/hard-decoy-holdout-v3/nb35-source-review-2026-09-04/source-reviews.json'
TITLE = 'Endogenous ligand recognition and structural transition of a human PTH receptor.'
PTH_IDS = ['7VVJ', '7VVK', '7VVL', '7VVM', '7VVN', '7VVO']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


class CardParser(HTMLParser):
    """Only collect links and the title from one already bounded publication card."""
    def __init__(self):
        super().__init__()
        self.links = []
        self.in_heading = False
        self.title = []
        self.is_publication_card = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'article':
            self.is_publication_card = 'pub-card' in attrs.get('class', '').split()
        if tag == 'h3':
            self.in_heading = True
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])

    def handle_endtag(self, tag):
        if tag == 'h3':
            self.in_heading = False

    def handle_data(self, data):
        if self.in_heading:
            self.title.append(data)


def derive():
    prior_bytes = (REPOSITORY / PRIOR).read_bytes()
    prior = json.loads(prior_bytes)
    pending = [r for r in prior['reviews'] if not r['entrySourceReviewComplete']]
    require(len(pending) == 16, 'Unexpected historical pending set')
    require(sorted(r['pdbId'] for r in pending) == prior['summary']['pendingPdbIds'],
            'Historical pending identifiers mismatch')
    inputs = {PRIOR: digest(prior_bytes)}

    # Extract only a complete article.pub-card with the exact known paper title.
    # No surrounding publications, images, captions, or paper body are emitted.
    lab_raw = (PACKET / 'raw/pth_kato_lab.response').read_bytes()
    cards = re.findall(r'<article\b[^>]*>.*?</article>', lab_raw.decode(), re.S)
    matched = []
    for card in cards:
        parser = CardParser()
        parser.feed(card)
        title = ' '.join(''.join(parser.title).split())
        if title == TITLE:
            matched.append((parser, card))
    require(len(matched) == 1, 'Exact paper must occur in one bounded publication card')
    parser, card = matched[0]
    require(parser.is_publication_card, 'Matched article must have pub-card class')
    pdb_links = [u for u in parser.links if u.startswith('https://www.rcsb.org/structure/')]
    require(sorted(u.rsplit('/', 1)[-1] for u in pdb_links) == PTH_IDS,
            'Author-hosted PDB list differs from six historical entries')
    article_links = [u for u in parser.links if 'S1097276522006608' in u]
    require(len(article_links) == 1, 'Exact PII link must be present once')
    emdb_links = [u for u in parser.links if '/EMD-' in u]
    require(len(emdb_links) == 6, 'Unexpected map identifier list')
    require('<img' not in card.lower(), 'Do not extract a card with embedded images')

    source_attempts = []
    routes = load(PACKET / 'source-routes.json')
    for key, url in routes.items():
        metadata = load(PACKET / 'raw' / f'{key}.metadata.json')
        require(metadata['url'] == url and metadata['key'] == key, 'Route identity mismatch')
        if metadata.get('httpStatus') is not None:
            body_path = PACKET / metadata['path']
            require(body_path.parent == PACKET / 'raw', 'Response must be in packet raw directory')
            body = body_path.read_bytes()
            require(digest(body) == metadata['bodySha256'], 'Raw response hash mismatch')
            require(len(body) == metadata['size'], 'Raw response size mismatch')
        else:
            require(metadata.get('transportError'), 'No-status capture lacks transport error')
        source_attempts.append(metadata)

    bibliography = {}
    for name, pmid, doi in [('pth', '35932760', '10.1016/j.molcel.2022.07.003'),
                             ('amylin', '35324283', '10.1126/science.abm9609')]:
        result = load(PACKET / 'raw' / f'{name}_epmc.response')
        expected_query = f'EXT_ID:{pmid} AND SRC:MED'
        require(result['request']['queryString'] == expected_query, 'Europe PMC query echo mismatch')
        rows = result['resultList']['result']
        require(len(rows) == 1 and str(rows[0]['id']) == pmid and rows[0]['doi'] == doi,
                'Bibliography DOI/PMID mismatch')
        row = rows[0]
        bibliography[name] = {k: row.get(k) for k in ['id', 'doi', 'pmcid', 'title', 'fullTextUrlList']}
        require(not row.get('pmcid'), 'New PMC identifier requires source review')

    reviews = []
    all_polymer_count = 0
    for previous in pending:
        frozen_path = previous['frozenMetadataPath']
        frozen = (REPOSITORY / frozen_path).read_bytes()
        require(digest(frozen) == previous['frozenMetadataFileSha256'], 'Frozen source hash mismatch')
        inputs[frozen_path] = digest(frozen)
        entries = json.loads(frozen)['data']['entries']
        selected = [e for e in entries if e['rcsb_id'] == previous['pdbId']]
        require(len(selected) == 1, 'Frozen accession not unique')
        entities = selected[0]['polymer_entities']
        require(len(entities) == previous['frozenPolymerEntityCount'], 'Polymer count mismatch')
        require(len(entities) == len(previous['allFrozenPolymerEntities']), 'Historical inventory mismatch')
        indexed = {e['rcsb_id']: e for e in entities}
        require(set(indexed) == {e['rcsbEntityId'] for e in previous['allFrozenPolymerEntities']},
                'Polymer identifier inventory mismatch')
        for record in previous['allFrozenPolymerEntities']:
            entity = indexed[record['rcsbEntityId']]
            sequence = re.sub(r'\s', '', entity['entity_poly']['pdbx_seq_one_letter_code_can'])
            require(digest(sequence.encode()) == record['sequenceSha256'], 'Polymer sequence hash mismatch')
            require(len(sequence) == record['sequenceLength'], 'Polymer sequence length mismatch')
            ids = entity['rcsb_polymer_entity_container_identifiers']
            require(ids['entity_id'] == record['entityId'], 'Entity number mismatch')
            require(ids['asym_ids'] == record['asymIds'], 'Asymmetric chain identifiers mismatch')
            require(ids['auth_asym_ids'] == record['authAsymIds'], 'Author chain identifiers mismatch')
        all_polymer_count += len(entities)
        updated = copy.deepcopy(previous)
        updated['historicalReviewStatus'] = previous['reviewStatus']
        if previous['pdbId'] in PTH_IDS:
            updated['additionalDepositionEvidence'] = {
                'classification': 'AUTHOR_HOSTED_PUBLICATION_CARD_EXACT_PDB_LINK',
                'sourceUrl': routes['pth_kato_lab'],
                'sourceBodySha256': digest(lab_raw),
                'boundedCardSha256': digest(card.encode()),
                'paperTitle': TITLE,
                'paperLink': article_links[0],
                'pdbLink': f"https://www.rcsb.org/structure/{previous['pdbId']}",
                'pdbIdExplicitlyNamedInAuthorHostedCard': True,
                'pdbIdVerifiedInPrimaryArticleDepositionStatement': False,
                'complexToPdbMappingVerifiedFromMethods': False,
                'limitation': 'The author laboratory groups these identifiers under this exact publication. This is stronger than a citation field alone, but it is not the inaccessible primary paper deposition statement and supplies no sample composition or binder role.',
            }
        else:
            updated['additionalDepositionEvidence'] = None
        updated['inventoryReplay'] = {
            'allDepositedPolymerEntitiesChecked': True,
            'checkedPolymerEntityCount': len(entities),
            'basis': 'Exact frozen record identifier, sequence, length and chain comparison; prior metadata component labels are carried forward without new primary sample authority.',
        }
        updated['entryAssessment']['unresolvedDiscrepancies'] = [
            'PRIMARY_CONSTRUCT_AND_SAMPLE_METHODS_NOT_ACCESSIBLE',
            'PRIMARY_ARTICLE_COMPLETE_DEPOSITION_STATEMENT_NOT_ACCESSIBLE',
            'ENTRY_SPECIFIC_NB35_AUXILIARY_ROLE_NOT_SOURCE_CLEARED',
        ]
        require(updated['entryDisposition'] == 'PENDING_REQUIRED_METADATA', 'No new entry exclusion authorized')
        require(updated['candidateEntityDisposition'] == 'PENDING_REQUIRED_METADATA', 'No new candidate exclusion authorized')
        reviews.append(updated)
    require(all_polymer_count == 102, 'Unexpected total polymer inventory')
    return {
        'schemaVersion': '1.0.0',
        'studyId': 'confovhh-hard-decoy-holdout-v3',
        'reviewDate': '2026-09-04',
        'scope': 'Bounded new public access-route followup for the sixteen unresolved entries in the historical Nb35 source review. Historical and frozen records are not changed.',
        'inputDigests': inputs,
        'bibliography': bibliography,
        'authorHostedDepositionLink': {
            'source': routes['pth_kato_lab'], 'sourceBodySha256': digest(lab_raw),
            'boundedCardSha256': digest(card.encode()), 'title': TITLE,
            'articleLinks': article_links, 'pdbLinks': pdb_links,
            'emdbIdentifierLinks': emdb_links,
            'mapsDownloadedOrInspected': False,
        },
        'sourceAttempts': source_attempts,
        'reviews': reviews,
        'summary': {
            'pendingEntryCount': 16, 'frozenPolymerEntitiesReverified': all_polymer_count,
            'newAuthorHostedExactPdbLinks': 6, 'newPrimaryArticleDepositionStatements': 0,
            'newPrimaryMethodsReviews': 0, 'newSourceClearedAuxiliaryRoleCount': 0,
            'newEntryExclusions': 0, 'eligibleTargetCountAdded': 0,
            'independentComponentsAdded': 0, 'targetFreezePermitted': False,
            'wholeCensusComponentUpperBound': None, 'broaderDiscoveryComplete': False,
        },
        'evidenceBoundary': {
            'newModelVisibleScientificContent': 'Bibliographic metadata and author-hosted publication card identifiers. Full paper Methods could not be retrieved. Search responses were filtered to URL strings before model-visible output.',
            'exploratoryParserDisclosure': 'One early laboratory-page extraction was too broad and emitted surrounding publication bibliography entries and identifier links. It did not emit paper Results, figure captions, measured contacts, native pose descriptions, coordinate files or images. Final replay requires one exact-title article.pub-card and extracts title/links only.',
            'nativeCoordinatesInspected': False, 'nativeRelativePoseInspected': False,
            'structuralFiguresInspected': False, 'labelsAccessed': False,
            'predictionOutputsAccessed': False,
        },
    }


def encode(value):
    return (json.dumps(value, indent=2) + '\n').encode()


if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    require(action in {'build', 'verify'}, 'Expected build or verify')
    result = derive()
    output = PACKET / 'source-followup.json'
    if action == 'build':
        require(not output.exists(), 'Refusing to overwrite existing derived evidence')
        output.write_bytes(encode(result))
    else:
        require(output.read_bytes() == encode(result), 'Offline replay differs from retained evidence')
        inventory = set()
        for line in (PACKET / 'checksums.sha256').read_text().splitlines():
            expected, path = line.split('  ', 1)
            require(path not in inventory, 'Duplicate checksum path')
            inventory.add(path)
            require((PACKET / path).resolve().is_relative_to(PACKET), 'Unsafe checksum path')
            require(digest((PACKET / path).read_bytes()) == expected, 'Packet checksum mismatch: ' + path)
        actual = {str(p.relative_to(PACKET)) for p in PACKET.rglob('*') if p.is_file()
                  and p.name != 'checksums.sha256' and '__pycache__' not in p.parts}
        require(inventory == actual, 'Checksum inventory is not exact')
    print(json.dumps({'action': action, **result['summary']}, indent=2))
