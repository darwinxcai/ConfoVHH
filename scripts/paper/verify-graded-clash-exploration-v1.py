#!/usr/bin/env python3
"""Independent arithmetic and integrity checks; no GPU or new target access."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CASE = ROOT / 'validation/single-case-development-3p0g-2026-09-09'
PACKAGE = CASE / 'graded-clash-exploration-v1'
RESULTS = PACKAGE / 'results'


def load(p):
    return json.loads(p.read_text())


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    manifest_path = PACKAGE / 'evidence-manifest-v1.json'
    if manifest_path.exists():
        for record in load(manifest_path)['artifacts']:
            path = ROOT / record['path']
            assert path.stat().st_size == record['bytes'] and sha(path) == record['sha256'], record['path']
    freeze = load(PACKAGE / 'freeze-v1.json')
    for row in freeze['artifacts']:
        path = ROOT / row['path']
        assert path.stat().st_size == row['bytes'] and sha(path) == row['sha256'], row['path']
    for row in load(RESULTS / 'extraction-receipt.json')['sources']:
        assert sha(ROOT / row['path']) == row['sha256'], row['path']
    features = load(RESULTS / 'features.json')
    census = load(RESULTS / 'coordinate-only-contact-overlaps.json')
    ranks = load(RESULTS / 'ranks.json')
    receipt = load(RESULTS / 'rank-receipt.json')
    evaluation = load(RESULTS / 'evaluation.json')
    assert sha(RESULTS / 'features.json') == receipt['featuresSha256'] == evaluation['featuresSha256']
    assert sha(RESULTS / 'ranks.json') == receipt['ranksSha256'] == evaluation['ranksSha256']
    assert sha(ROOT / 'scripts/paper/graded-clash-selectors-v1.py') == receipt['selectorSha256']
    assert receipt['outcomeInputs'] == [] and receipt['arms'] == freeze['arms']
    assert sha(ROOT / evaluation['outcomeSource']) == evaluation['outcomeSha256']
    original = {r['id']: r for r in load(CASE / 'completed-pilot-execution03/reproduction/candidate-table.json')}
    ids = {f'seed{s}_model_{i}' for s in (1, 2) for i in range(5)}
    assert len(features) == len(original) == 10 and {r['id'] for r in features} == ids
    assert len(ranks) == 50 and {(r['id'], r['arm']) for r in ranks} == {(id, arm) for id in ids for arm in freeze['arms']}
    keys = {}
    for row in features:
        assert set(row) == {'id', 'coordinateSha256', 'confidenceSha256', 'evidenceTier',
                            'burial', 'contacts', 'clashes', 'overlapBurden', 'confidence'}
        id = row['id']; old = original[id]; pairs = census[id]
        assert len({(p['receptorResidue'], p['vhhResidue']) for p in pairs}) == len(pairs) == row['contacts'] == old['contactPairCount']
        assert sum(p['positiveOverlap'] >= .6 for p in pairs) == row['clashes'] == old['severeClashCount']
        q = math.fsum((p['positiveOverlap']/.6)**2 for p in pairs) / len(pairs)
        assert math.isclose(q, row['overlapBurden'], rel_tol=1e-14)
        for new, oldkey in [('coordinateSha256','coordinateSha256'), ('confidenceSha256','confidenceSha256'),
                            ('burial','halfDeltaSasaInterfaceAreaAngstrom2'), ('evidenceTier','evidenceTier'), ('confidence','confidence')]:
            assert row[new] == old[oldkey]
        b = row['burial']
        keys[id] = {'frozen-v06':[row['evidenceTier'],b], 'burial-only':[b],
                    'predictor-confidence':[row['confidence']],
                    'clash-fraction-v1':[b*(1-row['clashes']/row['contacts'])],
                    'overlap-burial-v1':[b/(1+row['overlapBurden'])]}
    for r in ranks:
        key = keys[r['id']][r['arm']]
        assert key == r['key'] and r['status'] == 'scored' and r['reason'] == ''
        higher = {tuple(k[r['arm']]) for k in keys.values() if k[r['arm']] > key}
        assert r['rank'] == 1 + len(higher)
        if r['arm'] == 'frozen-v06':
            assert r['rank'] == original[r['id']]['confoRank']
    for row in load(RESULTS / 'all-arm-candidate-results.json'):
        assert row['DockQ'] == original[row['id']]['DockQ']
        assert row['key'] == keys[row['id']][row['arm']]
    assert len(load(RESULTS / 'all-arm-candidate-results.json')) == 50
    for arm in evaluation['arms']:
        selected = [r['id'] for r in ranks if r['arm'] == arm['arm'] and r['rank'] == 1]
        assert arm['selected'] == selected
        assert arm['selectedDockQ'] == sum(original[id]['DockQ'] for id in selected)/len(selected)
        assert arm['missingSelectedDockQ'] == 0 and arm['unscored'] == []
        assert len({tuple(r['key']) for r in ranks if r['arm'] == arm['arm']}) == 10
    assert {r['arm'] for r in evaluation['arms']} == set(freeze['arms'])
    assert evaluation['missingDockQ'] == [] and evaluation['independentGroupCount'] == 0
    old_check = subprocess.run([sys.executable, str(ROOT/'scripts/paper/verify-single-case-pilot-evidence.py')], check=True, capture_output=True, text=True)
    print(json.dumps(dict(status='PASS', declaredArms=5, extraVariants=0, candidateRows=50,
                         originalRanksMatch=True, referenceFreeFeatureSchema=True,
                         overlapCensusArithmeticVerified=True, noNewGpuGeneration=True,
                         originalEvidence=json.loads(old_check.stdout)), indent=2))


if __name__ == '__main__':
    main()
