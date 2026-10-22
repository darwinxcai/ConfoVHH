#!/usr/bin/env python3
"""Extract exact Methods/deposition sections before any source prose is displayed."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
ALLOW = {
    'gpc2-primary-xml': {
        'Isolation of anti-GPC2 mouse mAbs',
        'Negative stain EM preparation of GPC2-CT3 Fab complex and data collection',
        'Data and code availability',
    },
    'mglur5-primary-xml': {
        'Purification of mGlu5 ECD',
        'Purification of Nb43 for signaling studies and crystallography',
        'Crystallization of the Apo ECD+Nb43 Complex and Data Collection',
        'Crystallization of the ECD in complex with Quisqualate and Nb43',
        'Data availability', 'Data Availability', 'Data Availability Statement',
    },
}


def text(node):
    return ' '.join(''.join(node.itertext()).split())


def extract():
    outputs = []
    for name, titles in ALLOW.items():
        source = ROOT / 'sources' / (name + '.body')
        data = source.read_bytes()
        root = ET.fromstring(data)
        expected_doi = {'gpc2-primary-xml': '10.1016/j.xcrm.2021.100297',
                        'mglur5-primary-xml': '10.1038/s41586-019-0881-4'}[name]
        assert any(text(node).lower() == expected_doi
                   for node in root.findall('./front/article-meta/article-id')
                   if node.get('pub-id-type') == 'doi')
        parents = {child: parent for parent in root.iter() for child in parent}
        paragraphs = []
        selected = []
        for section in root.iter('sec'):
            title = section.find('title')
            if title is None or text(title) not in titles:
                continue
            if not text(title).lower().startswith('data '):
                ancestor = parents.get(section)
                method_parent_found = False
                while ancestor is not None:
                    ancestor_title = ancestor.find('title')
                    if ancestor_title is not None and text(ancestor_title) in {'Methods', 'STAR★Methods'}:
                        method_parent_found = True
                    ancestor = parents.get(ancestor)
                assert method_parent_found, 'Selected preparation paragraph is outside Methods'
            if section.find('.//fig') is not None or section.find('.//table-wrap') is not None:
                raise RuntimeError('Selected section contains figure/table: ' + text(title))
            selected.append(text(title))
            paragraph_nodes = section.findall('p')
            if text(title) in {'Crystallization of the Apo ECD+Nb43 Complex and Data Collection',
                               'Crystallization of the ECD in complex with Quisqualate and Nb43'}:
                paragraph_nodes = paragraph_nodes[:1]
            for paragraph in paragraph_nodes:
                assert not any(node.tag in {'fig', 'table-wrap', 'caption', 'graphic', 'inline-graphic'}
                               for node in paragraph.iter())
                value = text(paragraph)
                full_hash = hashlib.sha256(value.encode()).hexdigest()
                if text(title) == 'Negative stain EM preparation of GPC2-CT3 Fab complex and data collection':
                    value = value.split('Data was collected using', 1)[0].rstrip()
                paragraphs.append({'sectionId': section.get('id'), 'sectionTitle': text(title),
                                   'paragraphText': value,
                                   'fullSourceParagraphSha256': full_hash,
                                   'paragraphTextSha256': hashlib.sha256(value.encode()).hexdigest()})
        if name == 'mglur5-primary-xml':
            footnote = root.find('.//fn[@id="FN5"]')
            assert footnote is not None
            paragraphs_in_note = footnote.findall('p')
            assert text(paragraphs_in_note[0]).lower().replace(' ', '') == 'dataavailability'
            value = text(paragraphs_in_note[1])
            assert value.startswith('All data generated or analyzed during this study')
            selected.append('Data availability (FN5)')
            paragraphs.append({'sectionId': 'FN5', 'sectionTitle': 'Data availability',
                               'paragraphText': value,
                               'fullSourceParagraphSha256': hashlib.sha256(value.encode()).hexdigest(),
                               'paragraphTextSha256': hashlib.sha256(value.encode()).hexdigest()})
        outputs.append({'sourceFile': source.relative_to(ROOT).as_posix(),
                        'sourceSha256': hashlib.sha256(data).hexdigest(),
                        'scope': 'Direct paragraphs of exact allowlisted construct/sample Methods and Data availability sections only; figures/tables rejected; no recursive article text.',
                        'selectedSectionTitles': selected, 'paragraphs': paragraphs})
    return outputs


if __name__ == '__main__':
    import sys
    output = ROOT / 'primary-excerpts.json'
    result = extract()
    if len(sys.argv) > 1 and sys.argv[1] == 'verify':
        assert json.loads(output.read_text()) == result
        print('Primary excerpt replay passed.')
    else:
        output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
