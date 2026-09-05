#!/usr/bin/env python3
"""Capture FZD3 primary XML and extract only explicitly allowed preparation sections.

Raw XML is archived without rendering it. No Results, figures, captions, tables,
structural determination/analysis Methods, coordinates or labels are extracted.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
DOI = '10.1038/s41467-024-51451-1'
PMCID = 'PMC11341715'
ROUTES = {
    'epmc-doi': 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1038/s41467-024-51451-1&format=json&resultType=core',
    'epmc-primary': 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11341715/fullTextXML',
}
ALLOWED_METHOD_TITLES = {'Discovery of the nanobodies', 'Protein expression'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def plain(node):
    return ' '.join(''.join(node.itertext()).split()) if node is not None else ''


def allowed_paragraphs(section):
    paragraphs = section.findall('./p')
    for paragraph in paragraphs:
        assert not any(child.tag in {'fig', 'table-wrap', 'table', 'caption', 'graphic', 'inline-graphic'}
                       for child in paragraph.iter()), 'Unexpected excluded element in allowlisted paragraph'
    return [plain(paragraph) for paragraph in paragraphs]


def capture(name, url):
    body = HERE / (name + '.body')
    provenance = HERE / (name + '.capture.json')
    if body.exists() or provenance.exists():
        raise SystemExit('Refusing to replace a retained capture: ' + name)
    request = urllib.request.Request(url, headers={'User-Agent': 'ConfoVHH-source-audit/1.0', 'Accept': 'application/xml,application/json;q=0.9,*/*;q=0.1'})
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read()
        record = {'id': name, 'requestedUrl': url, 'finalUrl': response.url,
                  'startedAtUtc': started, 'completedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'status': response.status, 'headers': dict(response.headers),
                  'bodyFile': body.name, 'bytes': len(data), 'sha256': sha(data),
                  'bodyRenderedToModel': False}
    body.write_bytes(data)
    write_json(provenance, record)
    print(json.dumps({key: record[key] for key in ('id', 'status', 'bytes', 'sha256')}))


def root():
    article = ET.fromstring((HERE / 'epmc-primary.body').read_bytes())
    doi = next((plain(x) for x in article.findall('./front/article-meta/article-id') if x.get('pub-id-type') == 'doi'), None)
    assert doi == DOI, ('Unexpected primary DOI', doi)
    return article


def extract():
    article = root()
    sections = []
    for methods in article.findall('./body/sec'):
        if plain(methods.find('title')) != 'Methods':
            continue
        for section in methods.findall('./sec'):
            title = plain(section.find('title'))
            if title not in ALLOWED_METHOD_TITLES:
                continue
            sections.append({'scope': 'sample/construct preparation Methods', 'sectionId': section.get('id'),
                             'title': title, 'paragraphs': allowed_paragraphs(section)})
    for section in article.findall('.//sec') + article.findall('.//notes'):
        if plain(section.find('title')) == 'Data availability':
            sections.append({'scope': 'deposition statement', 'sectionId': section.get('id'),
                             'title': 'Data availability', 'paragraphs': allowed_paragraphs(section)})
    result = {'doi': DOI, 'pmcid': PMCID, 'primaryXmlSha256': sha((HERE / 'epmc-primary.body').read_bytes()),
              'filter': {'exactTopLevelMethodsTitle': 'Methods', 'exactAllowedDirectChildTitles': sorted(ALLOWED_METHOD_TITLES),
                         'paragraphSelection': 'Direct p children only. No nested figure/table/caption text is rendered.',
                         'dataAvailabilitySelection': 'Direct p children of exact Data availability titled sec or notes element.',
                         'excluded': ['Results', 'figure captions', 'tables', 'structural determination/analysis Methods',
                                      'coordinates', 'native contact/orientation interpretations', 'DockQ/CAPRI labels'],
                         'abstractExtracted': False},
              'sections': sections}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['capture', 'method-titles', 'extract', 'verify'])
    args = parser.parse_args()
    if args.command == 'capture':
        for name, url in ROUTES.items():
            capture(name, url)
    elif args.command == 'method-titles':
        article = root()
        for section in article.findall('./body/sec'):
            if plain(section.find('title')) == 'Methods':
                print(json.dumps([{'id': child.get('id'), 'title': plain(child.find('title'))} for child in section.findall('./sec')]))
    elif args.command == 'extract':
        write_json(HERE / 'allowed-sections.json', extract())
        print(json.dumps({'extractedSections': len(extract()['sections'])}))
    else:
        for name in ROUTES:
            metadata = json.loads((HERE / (name + '.capture.json')).read_text())
            data = (HERE / metadata['bodyFile']).read_bytes()
            assert len(data) == metadata['bytes'] and sha(data) == metadata['sha256']
            assert metadata['requestedUrl'] == ROUTES[name]
        metadata = json.loads((HERE / 'epmc-doi.body').read_text())
        assert metadata['request']['queryString'] == 'DOI:' + DOI
        assert metadata['hitCount'] == 1
        assert metadata['resultList']['result'][0]['pmcid'] == PMCID
        expected = extract()
        assert json.loads((HERE / 'allowed-sections.json').read_text()) == expected
        assert [section['title'] for section in expected['sections']] == [
            'Discovery of the nanobodies', 'Protein expression', 'Data availability']
        assert '8Q7O' in expected['sections'][-1]['paragraphs'][0]
        inventory = HERE / 'checksums.sha256'
        if inventory.exists():
            indexed = {}
            for line in inventory.read_text().splitlines():
                checksum, name = line.split('  ', 1)
                assert name not in indexed
                indexed[name] = checksum
                assert sha((HERE / name).read_bytes()) == checksum, name
            actual = {p.name for p in HERE.iterdir() if p.is_file() and p.name != inventory.name}
            assert set(indexed) == actual, 'Checksum inventory is not exact'
        print('PASS: two retained captures and exact allowlisted-section replay')


if __name__ == '__main__':
    main()
