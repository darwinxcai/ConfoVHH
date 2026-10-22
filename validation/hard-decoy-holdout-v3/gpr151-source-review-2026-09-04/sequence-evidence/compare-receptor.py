#!/usr/bin/env python3
"""Sequence-only replay; neither coordinates nor publication text is used."""
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path('/workspace/scratch/746bb3989941/ConfoVHH')
OUT = Path('/tmp/confovhh-gpr151-sequence')

def sha(b):
    return hashlib.sha256(b).hexdigest()

def read_jsonl(relative):
    p = ROOT / relative
    return [json.loads(line) for line in p.read_text().splitlines()]

def sequence_record(name, sequence):
    return {'id': name, 'sequence': sequence, 'length': len(sequence),
            'sequenceSha256': sha(sequence.encode())}

def align(a, b):
    # Global Needleman-Wunsch; linear gap penalty, deterministic traceback.
    # Equal scoring paths prefer diagonal, then a residue versus gap, then gap versus b.
    n, m = len(a), len(b)
    scores = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): scores[i][0] = -4 * i
    for j in range(1, m + 1): scores[0][j] = -4 * j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            scores[i][j] = max(scores[i-1][j-1] + (1 if a[i-1] == b[j-1] else -1),
                               scores[i-1][j] - 4, scores[i][j-1] - 4)
    i, j, aa, bb = n, m, [], []
    while i or j:
        if i and j and scores[i][j] == scores[i-1][j-1] + (1 if a[i-1] == b[j-1] else -1):
            aa.append(a[i-1]); bb.append(b[j-1]); i -= 1; j -= 1
        elif i and scores[i][j] == scores[i-1][j] - 4:
            aa.append(a[i-1]); bb.append('-'); i -= 1
        else:
            aa.append('-'); bb.append(b[j-1]); j -= 1
    return {'method': 'global Needleman-Wunsch', 'matchScore': 1,
            'mismatchScore': -1, 'linearGapScore': -4,
            'tieBreak': ['diagonal', 'gap in deposited', 'gap in canonical'],
            'score': scores[n][m], 'canonicalAligned': ''.join(reversed(aa)),
            'depositedAligned': ''.join(reversed(bb))}

entries_path = 'validation/hard-decoy-holdout-v3/domain-remainder-2026-09-04/entries.jsonl'
development_path = 'validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl'
entries = {row['pdbId']: row for row in read_jsonl(entries_path)}
development = {row['pdbId']: row for row in read_jsonl(development_path)}
u = json.loads((OUT / 'uniprot-Q8TDV0.json').read_bytes())
u2 = json.loads((OUT / 'uniprot-Q8TDV0-repeat-2.json').read_bytes())
assert u['sequence']['value'] == u2['sequence']['value']
canonical = u['sequence']['value']
records = []
for pdb, entity in [('9W3K', '4'), ('9W3L', '1')]:
    pe = next(p for p in entries[pdb]['polymerEntities'] if p['entityId'] == entity)
    record = sequence_record(pdb + '_' + entity, pe['sequence'])
    assert record['sequenceSha256'] == pe['sequenceSha256']
    records.append(record)
assert records[0]['sequence'] == records[1]['sequence']
deposited = records[0]['sequence']
kpe = next(p for p in development['6VI4']['polymerEntities'] if p['entityId'] == '1')
kor = kpe['sequence']
assert sha(kor.encode()) == kpe['sequenceSha256']
alignment = align(canonical, deposited)
assert '-' not in alignment['canonicalAligned'] + alignment['depositedAligned']
differences = [{'position1Based': i + 1, 'canonical': a, 'deposited': b,
                'change': a + str(i+1) + b}
               for i, (a, b) in enumerate(zip(canonical, deposited)) if a != b]
block = deposited[221:252]
kstart = kor.find(block)
assert kstart >= 0
longest = difflib.SequenceMatcher(None, deposited, kor, autojunk=False).find_longest_match()
canonical_block = canonical[221:252]
report = {
    'schemaVersion': 1,
    'scope': 'Sequence and deposited metadata only; primary-paper Methods, coordinates, contacts and images not inspected.',
    'sourceInputs': [
        {'path': relative, 'sha256': sha((ROOT / relative).read_bytes())}
        for relative in [entries_path, development_path]
    ] + [{'path': str(OUT / name), 'sha256': sha((OUT / name).read_bytes())}
         for name in ['uniprot-Q8TDV0.json', 'uniprot-Q8TDV0-repeat-2.json',
                      'uniprot-request.json', 'uniprot-request-repeat-2.json']],
    'canonicalMetadata': {'accession': u['primaryAccession'], 'entryType': u['entryType'],
                          'entryAudit': u.get('entryAudit'), 'organism': u['organism'],
                          'url': 'https://rest.uniprot.org/uniprotkb/Q8TDV0.json'},
    'canonical': sequence_record('UniProt:Q8TDV0', canonical),
    'depositedReceptors': records,
    'depositedReceptorSequencesIdentical': True,
    'canonicalAlignment': alignment,
    'differenceCount': len(differences),
    'identityCount': len(canonical) - len(differences),
    'identityDenominator': len(canonical),
    'differences': differences,
    'terminalAdditionsOrDeletionsRelativeToCanonical': [],
    'terminalInterpretationLimit': 'No deposited sequence additions/deletions in this comparison does not establish absence of expression or purification tags in the experimental construct.',
    'developmentReference': sequence_record('6VI4_1', kor),
    'changedBlockDevelopmentMatch': {
        'depositedStart1Based': 222, 'depositedEnd1Based': 252,
        'depositedSequence': block, 'depositedBlockSha256': sha(block.encode()),
        'canonicalSequenceAtSamePositions': canonical_block,
        'canonicalBlockSha256': sha(canonical_block.encode()),
        'differentPositionsCount': sum(a != b for a, b in zip(block, canonical_block)),
        'length': len(block), 'developmentStart1Based': kstart + 1,
        'developmentEnd1Based': kstart + len(block), 'developmentExactMatch': True,
        'interpretation': 'An exact sequence segment match to an exposed development receptor. It supports an engineered KOR-segment interpretation, but sequence comparison alone does not establish construct design, donor provenance, binding mechanism, or a formal leakage edge.'
    },
    'longestExactSharedSubstringWithDevelopmentReceptor': {
        'depositedStart1Based': longest.a + 1,
        'depositedEnd1Based': longest.a + longest.size,
        'developmentStart1Based': longest.b + 1,
        'developmentEnd1Based': longest.b + longest.size,
        'sequence': deposited[longest.a:longest.a + longest.size], 'length': longest.size
    },
    'isolatedChangesOutsideBlock': [d for d in differences if not 222 <= d['position1Based'] <= 252],
    'canonicalTopologyAnnotation': [f for f in u.get('features', [])
         if f['type'] in ['Transmembrane', 'Topological domain']
         and f['location']['start']['value'] <= 253 and f['location']['end']['value'] >= 222],
    'canonicalTopologyInterpretationLimit': 'UniProt sequence-based topology annotations (ECO:0000255), not inspection of either deposited structure.',
    'nativeCoordinatesInspected': False, 'publicationMethodsInspected': False,
    'formalEligibilityAuthority': False, 'formalLeakageEdgeAuthority': False,
    'formalIndependentComponentGainAuthority': False
}
(OUT / 'gpr151-receptor-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
for pdb in ['9W3K', '9W3L']:
    (OUT / (pdb + '-deposited-metadata.json')).write_text(json.dumps(entries[pdb], indent=2) + '\n')
(OUT / '6VI4-deposited-receptor-sequence.json').write_text(json.dumps(kpe, indent=2) + '\n')
print(json.dumps({'output': str(OUT / 'gpr151-receptor-comparison.json'),
                  'differences': len(differences), 'gaps': 0, 'blockLength': len(block),
                  'blockDifferencesFromCanonical': sum(a != b for a, b in zip(block, canonical_block)),
                  'developmentExactMatch': True}))
