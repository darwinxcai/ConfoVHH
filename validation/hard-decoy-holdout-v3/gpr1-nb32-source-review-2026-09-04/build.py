#!/usr/bin/env python3
"""Reproduce bounded source facts and sequence accounting without network access."""
import difflib
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BASE = 'validation/hard-decoy-holdout-v3/'
GPR_IDS = ['9UYH', '9UYI', '9UYJ', '9UYL', '9UYM', '9UYN']
SOURCE_FILES = {
    'gpr1': BASE + 'domain-remainder-2026-09-04/entries.jsonl',
    'gcgr': BASE + 'entry-metadata-snapshot-2026-08-29/entries.jsonl',
    'reference': BASE + 'global-text-discovery-2026-09-04/entries.jsonl',
}
QUEUE = BASE + 'domain-remainder-development-review-2026-09-04/source-review-queue.jsonl'
RECEPTOR_REVIEW = BASE + 'domain-remainder-development-review-2026-09-04/receptor-review.jsonl'


def check(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def text(node):
    return ' '.join(''.join(node.itertext()).split()) if node is not None else ''


def permitted_text(node):
    forbidden = {'fig', 'figure', 'caption', 'table', 'table-wrap', 'media', 'graphic', 'inline-graphic',
                 'supplementary-material', 'img', 'svg', 'video', 'audio'}
    check(not any(child.tag.rsplit('}', 1)[-1] in forbidden for child in node.iter()),
          'Selected prose contains forbidden figure/table/media elements')
    return text(node)


def read_json(path):
    return json.loads(path.read_text())


def encode(data):
    return (json.dumps(data, indent=2) + '\n').encode()


class HTMLTree(HTMLParser):
    """Parse retained PMC HTML; never emit unselected article text."""
    def __init__(self):
        super().__init__()
        self.root = ET.Element('root')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = ET.SubElement(self.stack[-1], tag, dict(attrs))
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, value):
        node = self.stack[-1]
        if len(node):
            node[-1].tail = (node[-1].tail or '') + value
        else:
            node.text = (node.text or '') + value


def extract_allowed():
    expected_dois = {
        'nb32_sensor_pmc12452856': '10.1073/pnas.2507384122',
        'nb32_gcgr_xml': '10.1038/s41586-023-06420-x',
        'nb32_original_pmc7108872': '10.1038/s41594-019-0330-y',
        'nb32_src_pmc13035853': '10.1038/s41467-026-69884-1',
    }
    rules = {
        'nb32_sensor_pmc12452856': ['General Reagents, Plasmids, and Cell Culture.'],
        'nb32_gcgr_xml': ['Construct cloning and protein expression', 'Expression and purification of Nb32', 'Purification of the glucagon–GCGR(V2RC)–βarr1 complex'],
        'nb32_original_pmc7108872': ['Purification of the T4L-β2V2R–βarr1–Fab30 Complex, Gs Protein, and Protein Stabilizers', 'Formation of the Megaplex', 'Data Availability'],
        'nb32_src_pmc13035853': ['Molecular biology', 'Protein expression and purification', 'Formation of SH3–βarr1 and Src–βarr1 complexes'],
    }
    output = {}
    for key, headings in rules.items():
        root = ET.fromstring((HERE / 'raw' / f'{key}.response').read_bytes())
        dois = [text(n) for n in root.findall('./front/article-meta/article-id') if n.get('pub-id-type') == 'doi']
        check(dois == [expected_dois[key]], 'Primary article DOI mismatch: ' + key)
        records = []
        if key == 'nb32_sensor_pmc12452856':
            for abstract in root.findall('./front/article-meta/abstract'):
                content = permitted_text(abstract)
                if 'nanobody32' in content:
                    records.append({'section': 'Abstract', 'text': content})
        for section in root.findall('./body/sec'):
            if text(section.find('title')) not in {'Methods', 'Materials and Methods'}:
                continue
            for subsection in section.findall('./sec'):
                heading = text(subsection.find('title'))
                if heading not in headings:
                    continue
                for paragraph in subsection.findall('./p'):
                    content = permitted_text(paragraph)
                    if re.search(r'Nb32|Ib32|Fab30|deposited', content, re.I):
                        records.append({'section': heading, 'text': content})
        for note in root.findall('.//notes'):
            if note.get('notes-type') == 'data-availability':
                records.append({'section': 'Data availability', 'text': permitted_text(note)})
        for section in root.findall('.//sec'):
            if text(section.find('title')).lower() == 'data availability':
                for paragraph in section.findall('./p'):
                    records.append({'section': 'Data availability', 'text': permitted_text(paragraph)})
        check(records, 'No permitted source sections found: ' + key)
        output[key] = records

    parser = HTMLTree()
    parser.feed((HERE / 'raw/nb32_pmc5347553_html.response').read_text())
    html_dois = [node.get('content') for node in parser.root.iter('meta') if node.get('name') == 'citation_doi']
    check(html_dois == ['10.1073/pnas.1701529114'], 'Primary PNAS HTML DOI mismatch')
    methods = [s for s in parser.root.iter('section') if s.get('id') == 'si1']
    check(len(methods) == 1 and text(methods[0].find('h2')) == 'Materials and Methods', 'PNAS Methods parent mismatch')
    records = []
    for section in methods[0].iter('section'):
        if section.get('id') not in {'si4', 'si5'}:
            continue
        for paragraph in section.findall('./p'):
            content = permitted_text(paragraph)
            if re.search(r'Nb32|Fab30', content):
                records.append({'sectionId': section.get('id'), 'text': content})
    check(len(records) == 2, 'PNAS selected Methods extraction mismatch')
    output['nb32_pmc5347553_html'] = records
    return output


def load_entries(path, ids):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    selected = [r for r in rows if r['pdbId'] in ids]
    check(sorted(r['pdbId'] for r in selected) == sorted(ids), 'Selected entry inventory mismatch')
    for row in selected:
        entities = row['polymerEntities']
        check(len(entities) == row['polymerEntityCountReported'], 'Polymer count mismatch')
        check(len({e['rcsbId'] for e in entities}) == len(entities), 'Duplicate polymer identifier')
        for entity in entities:
            sequence = entity['sequence']
            check(entity['sequenceLength'] == len(sequence), 'Polymer length mismatch')
            check(entity['sequenceSha256'] == sha(sequence.encode()), 'Polymer sequence hash mismatch')
    return selected


def derive(excerpts):
    routes = read_json(HERE / 'source-routes.json')
    attempts = []
    for key, url in routes.items():
        metadata = read_json(HERE / 'raw' / f'{key}.metadata.json')
        check(metadata['key'] == key and metadata['url'] == url, 'Source route mismatch')
        if metadata.get('httpStatus') is not None:
            path = HERE / metadata['path']
            check(path.parent == HERE / 'raw', 'Unexpected raw response path')
            data = path.read_bytes()
            check(sha(data) == metadata['bodySha256'] and len(data) == metadata['size'], 'Source capture hash/size mismatch')
        else:
            check(metadata.get('transportError'), 'Missing transport error')
        attempts.append(metadata)
    bibliography = read_json(HERE / 'raw/gpr1_epmc.response')
    check(bibliography['request']['queryString'] == 'EXT_ID:41264711 AND SRC:MED', 'GPR1 bibliography query echo mismatch')
    paper = bibliography['resultList']['result']
    check(len(paper) == 1 and paper[0]['doi'] == '10.1126/science.adt8794' and paper[0]['id'] == '41264711', 'GPR1 citation mismatch')
    paper = paper[0]
    check(not paper.get('pmcid'), 'New article copy needs separate review')

    inputs = {path: sha((REPO / path).read_bytes()) for path in list(SOURCE_FILES.values()) + [QUEUE, RECEPTOR_REVIEW]}
    gpr = load_entries(REPO / SOURCE_FILES['gpr1'], GPR_IDS)
    gcgr = load_entries(REPO / SOURCE_FILES['gcgr'], ['8JRU', '8JRV'])
    reference = load_entries(REPO / SOURCE_FILES['reference'], ['6NI2', '9BT8', '9CX3'])
    all_entries = gpr + gcgr + reference
    expected_source_ids = {
        'nb32_gcgr_xml': ['8JRU', '8JRV'],
        'nb32_original_pmc7108872': ['6NI2'],
        'nb32_src_pmc13035853': ['9BT8', '9CX3'],
    }
    for source, ids in expected_source_ids.items():
        deposition = ' '.join(r['text'] for r in excerpts[source] if r['section'].lower() == 'data availability')
        check(all(identifier in deposition for identifier in ids), 'Primary reference deposition link incomplete: ' + source)
    receptor_rows = [json.loads(line) for line in (REPO / RECEPTOR_REVIEW).read_text().splitlines() if line]
    receptor_rows = [r for r in receptor_rows if r['pdbId'] in GPR_IDS]
    check(len(receptor_rows) == 6, 'Prior receptor review rows incomplete')
    check(all(any(a['accession'] == 'P46091' for a in r['unrecognizedUniprotAnnotationsNotAssumedReceptors'])
              for r in receptor_rows), 'Prior canonical GPR1 gap changed; revise interpretation')

    sequence_paragraphs = [r['text'] for r in excerpts['nb32_sensor_pmc12452856'] if r['section'] == 'General Reagents, Plasmids, and Cell Culture.']
    check(len(sequence_paragraphs) == 1, 'Sensor Methods sequence paragraph mismatch')
    found = re.findall(r'Amino acid sequence of HA-Ib32 is as mentioned below: ([A-Z]+)\.', sequence_paragraphs[0])
    check(len(found) == 1, 'Published HA-Ib32 sequence not unique')
    published = found[0]
    check(published.startswith('M') and published.endswith('YPYDVPDYA'), 'Published sensor terminal sequence mismatch')
    core = published[1:-9]
    check(len(core) == 114, 'Unexpected Nb32 sequence length')
    abstract = next(r['text'] for r in excerpts['nb32_sensor_pmc12452856'] if r['section'] == 'Abstract')
    check('βarr-recognizing nanobody (nanobody32)' in abstract, 'Primary source role wording absent')

    nb32_matches = []
    for row in all_entries:
        selected = [e for e in row['polymerEntities'] if core in e['sequence']]
        check(len(selected) == 1, 'Exactly one sequence-linked Nb32 expected per reviewed entry')
        entity = selected[0]
        sequence = entity['sequence']
        check(sequence.count(core) == 1, 'Ambiguous core occurrence')
        start = sequence.index(core)
        nb32_matches.append({
            'pdbId': row['pdbId'], 'entityId': entity['rcsbId'],
            'fullSequenceSha256': entity['sequenceSha256'], 'fullSequenceLength': len(sequence),
            'exactCoreLength': len(core), 'coreStart1': start + 1, 'coreEnd1': start + len(core),
            'prefix': sequence[:start], 'suffix': sequence[start + len(core):],
            'coreSequenceSha256': sha(core.encode()),
            'comparisonClassification': 'EXACT_PUBLISHED_NB32_SEQUENCE_SEGMENT',
            'wholeExpressionConstructIdentical': False,
            'sourceOrganismAnnotations': entity['sourceOrganisms'],
        })

    canonical = {}
    for name, accession in [('gpr1', 'P46091'), ('v2r', 'P30518')]:
        a = (HERE / 'raw' / f'{name}_canonical_repeat1.response').read_bytes()
        b = (HERE / 'raw' / f'{name}_canonical_repeat2.response').read_bytes()
        check(a == b, 'Canonical repeat disagreement')
        lines = a.decode().splitlines()
        check(lines[0].startswith('>sp|' + accession + '|'), 'Canonical accession mismatch')
        canonical[accession] = ''.join(lines[1:])
    check(len(canonical['P46091']) == 355 and len(canonical['P30518']) == 371, 'Canonical sequence length mismatch')
    gpr_core = canonical['P46091'][1:322]
    v2_tail = canonical['P30518'][342:371]
    constructs = []
    for row in gpr:
        receptor = [e for e in row['polymerEntities'] if any(r['databaseAccession'] == 'P46091' for r in e['referenceSequences'])]
        check(len(receptor) == 1, 'GPR1 entity not uniquely annotated')
        entity = receptor[0]
        sequence = entity['sequence']
        check(sequence.count(gpr_core[:39]) == 1, 'GPR1 sequence anchor not unique')
        start = sequence.index(gpr_core[:39])
        segment = sequence[start:start + len(gpr_core)]
        tail = sequence[start + len(gpr_core):]
        check(tail == v2_tail, 'Receptor terminal sequence does not match V2R 343–371')
        differences = [{'canonicalPosition1': n + 2, 'canonicalResidue': a, 'depositedResidue': b}
                       for n, (a, b) in enumerate(zip(gpr_core, segment)) if a != b]
        expected = [{'canonicalPosition1': 143, 'canonicalResidue': 'V', 'depositedResidue': 'C'}] if row['pdbId'] == '9UYN' else []
        check(differences == expected, 'Unreviewed GPR1 sequence difference')
        constructs.append({
            'pdbId': row['pdbId'], 'entityId': entity['rcsbId'], 'fullSequenceLength': len(sequence),
            'fullSequenceSha256': entity['sequenceSha256'], 'depositedPrefix': sequence[:start],
            'depositedPrefixLength': start, 'gpr1CanonicalAccession': 'P46091',
            'gpr1CanonicalStart1': 2, 'gpr1CanonicalEnd1': 322,
            'gpr1DepositedStart1': start + 1, 'gpr1DepositedEnd1': start + 321,
            'gpr1SequenceDifferences': differences,
            'terminalCanonicalAccession': 'P30518', 'terminalCanonicalStart1': 343,
            'terminalCanonicalEnd1': 371, 'terminalExactSequence': tail,
            'classification': 'COMPUTATIONAL_SEQUENCE_DECOMPOSITION_NOT_PRIMARY_EXPRESSION_CONSTRUCT_RECONCILIATION',
            'cleavageHistoryVerified': False, 'experimentalTagProvenanceVerified': False,
            'mutationPurposeVerified': False,
        })

    reference_entry = next(e for e in reference if e['pdbId'] == '6NI2')
    chain_sequences = {e['rcsbId']: e['sequence'] for e in reference_entry['polymerEntities']}
    scfv = []
    for row in gpr:
        entity = next(e for e in row['polymerEntities'] if e['description'] == 'Single-chain fragment variable 30 (scFv30)')
        sequence = entity['sequence']
        matches = []
        for reference_id in ['6NI2_4', '6NI2_3']:
            refseq = chain_sequences[reference_id]
            block = difflib.SequenceMatcher(None, refseq, sequence, autojunk=False).find_longest_match()
            check(block.size >= 100, 'Insufficient exact Fab30 chain segment')
            matches.append({'referenceEntityId': reference_id, 'referenceStart1': block.a + 1,
                            'referenceEnd1': block.a + block.size, 'candidateStart1': block.b + 1,
                            'candidateEnd1': block.b + block.size, 'exactLength': block.size,
                            'segmentSha256': sha(refseq[block.a:block.a + block.size].encode())})
        scfv.append({'pdbId': row['pdbId'], 'entityId': entity['rcsbId'], 'fullSequenceSha256': entity['sequenceSha256'],
                     'exactFab30ChainSegments': matches,
                     'classification': 'EXACT_FAB30_SEGMENT_FORMAT_INFERENCE_REQUIRES_GPR1_PRIMARY_METHODS',
                     'domainBoundariesExperimentallyVerified': False})

    inventory = []
    for row in all_entries:
        entities = []
        for entity in row['polymerEntities']:
            entities.append({k: entity[k] for k in ['rcsbId', 'entityId', 'description', 'labelAsymIds', 'authAsymIds', 'sequence', 'sequenceLength', 'sequenceSha256', 'referenceSequences', 'sourceOrganisms']})
        inventory.append({'pdbId': row['pdbId'], 'primaryCitation': row['primaryCitation'],
                          'polymerEntityCount': len(entities), 'allDepositedPolymerEntities': entities,
                          'primarySampleAccountingComplete': False if row['pdbId'] in GPR_IDS else None})

    return {
        'schemaVersion': '1.0.0', 'studyId': 'confovhh-hard-decoy-holdout-v3', 'reviewDate': '2026-09-04',
        'scope': 'Six GPR1 entries, all deposited polymers, and five source-linked Nb32 reference entries. No frozen decisions are modified.',
        'inputDigests': inputs, 'sourceAttempts': attempts,
        'gpr1Bibliography': {k: paper.get(k) for k in ['id', 'doi', 'pmcid', 'title', 'fullTextUrlList']},
        'sourceReportedFacts': [
            {'source': '10.1073/pnas.2507384122', 'section': 'Abstract', 'fact': 'The authors explicitly identify nanobody32 as recognizing beta-arrestins and describe an intracellular sensor derived from it.'},
            {'source': '10.1073/pnas.2507384122', 'section': 'Materials and Methods / General Reagents, Plasmids, and Cell Culture', 'fact': 'The complete HA-Ib32 amino-acid sequence is explicitly published.'},
            {'source': '10.1038/s41586-023-06420-x', 'section': 'Methods and Data availability', 'fact': 'Nb32 is added to the GCGR/V2R-tail–arrestin sample. The paper identifies 8JRU and 8JRV and reports a beta-arrestin/scFv30 expression fusion.'},
            {'source': '10.1038/s41594-019-0330-y', 'section': 'Methods and Data Availability', 'fact': 'Nb32 is used during megaplex preparation and 6NI2 is explicitly identified as an arrestin/V2-tail subcomplex deposition.'},
            {'source': '10.1038/s41467-026-69884-1', 'section': 'Methods / Formation of SH3–βarr1 and Src–βarr1 complexes', 'fact': 'The preparation combines Src/arrestin complexes with V2R phosphopeptide, Fab30 and Nb32.'},
        ],
        'roleInference': {
            'classification': 'SOURCE_SUPPORTED_AUXILIARY_BETA_ARRESTIN_REAGENT_ROLE_INFERENCE',
            'basis': 'The primary 2025 PNAS abstract identifies the target class, and its Methods sequence exactly matches all 114 Nb32 residues in each GPR1 candidate. Tagged full expression constructs differ.',
            'appliesTo': [m['entityId'] for m in nb32_matches if m['pdbId'] in GPR_IDS],
            'directGpr1BindingEvidenceEstablished': False,
            'physicalAbsenceOfIncidentalReceptorContactsEstablished': False,
            'gpr1PrimaryMethodsReviewed': False,
            'gpr1PrimaryDepositionStatementReviewed': False,
            'candidateEntityDisposition': 'AUXILIARY_ROLE_SUPPORTED_PENDING_ENTRY_PRIMARY_SOURCE',
            'entryDisposition': 'PENDING_REQUIRED_METADATA',
            'wholeEntryExclusionAuthority': False,
            'limitation': 'Reagent-family role is source supported; exact GPR1 sample provenance, scFv30 format and all source-only reagents still require the GPR1 primary Methods. Sequence matching does not establish universal receptor nonbinding.',
        },
        'publishedSequence': {'source': '10.1073/pnas.2507384122', 'haIb32Sequence': published,
                              'nb32Sequence': core, 'nb32Length': len(core), 'nb32Sha256': sha(core.encode())},
        'nb32SequenceComparisons': nb32_matches,
        'unresolvedReferenceConstructDiscrepancies': [{
            'pdbIds': ['8JRU', '8JRV'],
            'primarySource': '10.1038/s41586-023-06420-x',
            'section': 'Methods / Expression and purification of Nb32',
            'sourceReportedExpressionModules': 'C-terminal PreScission sequence LEVLFQGP and an eight-histidine tag; the Methods also describe protease cleavage.',
            'depositedSequenceObservation': 'Both deposited Nb32 sequences have MA before the identical 114-residue sequence and HHHHHHEPEA after it.',
            'status': 'EXACT_TAG_AND_PROCESSING_HISTORY_NOT_RECONCILED',
            'interpretation': 'The exact 114-residue reagent relationship is retained. The GCGR Methods do not reconcile the complete deposited Nb32 sequence, and no unreported tag swap or cleavage explanation is inferred.',
        }],
        'scfv30SequenceComparisons': scfv,
        'gpr1ConstructSequenceComparisons': constructs,
        'allPolymerInventories': inventory,
        'discoveryLimit': 'The prior receptor scan lacked a canonical GPR1 profile: P46091 was unrecognized while V2R P30518 was recognized. Its no-observed-development-signal category cannot establish GPR1 independence. This packet supplies a captured canonical GPR1 sequence without modifying the frozen scan.',
        'evidenceBoundary': {
            'sectionsRead': 'Primary abstracts, selected construct/expression/sample Methods and data availability only; bibliographic links for institutional pages. No paper Results or figure captions were read.',
            'abstractExposureCaveat': 'The GPR1 abstract contains qualitative receptor/arrestin state and interaction-pattern language. It was read under the abstract allowance; this is not a claim of complete prose blindness. No measured contacts, residue-pair assignments or native pose images were accessed.',
            'additionalProceduralReading': 'An exploratory extraction also displayed the PNAS sensor microscopy Methods. These concern optical measurement setup, not native complex pose or contact evidence.',
            'irrelevantSearchHits': 'PMC12055985 is an unrelated herpes-virus nanobody paper and was rejected after title-only inspection. PMC12820791 is commentary; PMC12733242 supplied no selected Nb32 Methods evidence. Their captured bodies were not used as role authority.',
            'nativeCoordinateFilesAccessed': False, 'nativePoseImagesAccessed': False,
            'nativeContactTablesAccessed': False, 'labelsAccessed': False, 'predictionOutputsAccessed': False,
        },
        'summary': {
            'gpr1EntryCount': len(gpr), 'gpr1PolymerEntityCount': sum(len(e['polymerEntities']) for e in gpr),
            'referenceEntryCount': len(gcgr) + len(reference),
            'totalInventoriedPolymerEntityCount': sum(len(e['polymerEntities']) for e in all_entries),
            'gpr1Nb32AuxiliaryRoleInferences': 6, 'gpr1PrimarySourceEntryClosures': 0,
            'entryExclusionsAdded': 0, 'eligibleTargetsAdded': 0, 'independentComponentsAdded': 0,
            'formalLeakageEdgesAdded': 0, 'formalNoEdgesAdded': 0,
            'targetFreezePermitted': False, 'wholeCensusComponentUpperBound': None,
        },
    }


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    check(mode in {'build', 'verify'}, 'Expected build or verify')
    excerpts = extract_allowed()
    report = derive(excerpts)
    products = {'allowed-excerpts.json': encode(excerpts), 'source-review.json': encode(report)}
    if mode == 'build':
        for name, data in products.items():
            check(not (HERE / name).exists(), 'Refusing to overwrite ' + name)
            (HERE / name).write_bytes(data)
    else:
        for name, data in products.items():
            check((HERE / name).read_bytes() == data, 'Offline replay differs: ' + name)
        names = set()
        for line in (HERE / 'checksums.sha256').read_text().splitlines():
            expected, name = line.split('  ', 1)
            check(name not in names and (HERE / name).resolve().is_relative_to(HERE), 'Invalid checksum path')
            names.add(name)
            check(sha((HERE / name).read_bytes()) == expected, 'Checksum mismatch: ' + name)
        actual = {str(p.relative_to(HERE)) for p in HERE.rglob('*') if p.is_file() and p.name != 'checksums.sha256' and '__pycache__' not in p.parts}
        check(names == actual, 'Checksum inventory mismatch')
    print(json.dumps({'mode': mode, **report['summary']}, indent=2))
