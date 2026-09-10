#!/usr/bin/env python3
"""Five declared post-outcome arms; selector consumes no reference outcomes."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import sys

ARMS = ('frozen-v06', 'burial-only', 'predictor-confidence',
        'clash-fraction-v1', 'overlap-burial-v1')
FIELDS = {'id', 'coordinateSha256', 'confidenceSha256', 'evidenceTier',
          'burial', 'contacts', 'clashes', 'overlapBurden', 'confidence'}
CASE = Path('validation/single-case-development-3p0g-2026-09-09')
PILOT = CASE / 'completed-pilot-execution03'
HERE = CASE / 'graded-clash-exploration-v1'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    with Path(path).open('x') as f:
        json.dump(data, f, indent=2, allow_nan=False)
        f.write('\n')


def finite(x):
    return type(x) in (int, float) and math.isfinite(x)


def rank(features):
    """Strict allowlist; no outcome access; failures retained per arm."""
    if any(set(r) != FIELDS for r in features):
        raise ValueError('Unexpected or absent selector fields')
    if len({r['id'] for r in features}) != len(features):
        raise ValueError('Duplicate candidate IDs')
    outputs = []
    for r in features:
        b, n, c, q, conf, tier = (r[k] for k in (
            'burial', 'contacts', 'clashes', 'overlapBurden', 'confidence', 'evidenceTier'))
        keys = {}
        if finite(b) and b >= 0:
            keys['burial-only'] = [b]
            if type(tier) is int and tier in (0, 1, 2):
                keys['frozen-v06'] = [tier, b]
            if type(n) is int and n > 0:
                if type(c) is int and 0 <= c <= n:
                    keys['clash-fraction-v1'] = [b * (1 - c / n)]
                if finite(q) and q >= 0:
                    keys['overlap-burial-v1'] = [b / (1 + q)]
        if finite(conf) and 0 <= conf <= 1:
            keys['predictor-confidence'] = [conf]
        for arm in ARMS:
            key = keys.get(arm)
            outputs.append(dict(id=r['id'], arm=arm, key=key, rank=None,
                                status='scored' if key is not None else 'unavailable',
                                reason='' if key is not None else 'Required feature missing or invalid'))
    for arm in ARMS:
        order = sorted({tuple(r['key']) for r in outputs
                        if r['arm'] == arm and r['key'] is not None}, reverse=True)
        for r in outputs:
            if r['arm'] == arm and r['key'] is not None:
                r['rank'] = order.index(tuple(r['key'])) + 1
    return outputs


def extract(repo, out):
    import numpy as np
    import Bio
    from Bio.PDB.MMCIF2Dict import MMCIF2Dict
    from Bio.SeqUtils import seq1
    pilot = repo / PILOT
    binding = read(pilot / 'reproduction/source-bound-input.json')
    replay = read(pilot / 'reproduction/source-bound-replay.json')['result']
    plan = read(repo / CASE / 'protocol.json')
    assert sha(repo / CASE / 'protocol.json') == '8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9'
    ids = plan['plannedCandidateIds']
    assert len(ids) == len(set(ids)) == 10
    bindings = {r['id']: r for r in binding['scoreSources']}
    assert set(bindings) == set(ids)
    radii = {'C': 1.7, 'N': 1.55, 'O': 1.52, 'S': 1.8, 'P': 1.8, 'SE': 1.9}
    features, census, sources = [], {}, []
    for name in ['reproduction/source-bound-input.json', 'reproduction/source-bound-replay.json']:
        sources.append(dict(path=str(PILOT / name), sha256=sha(pilot / name)))
    for id in ids:
        source = bindings[id]
        coord = pilot / 'reproduction/artifacts' / source['coordinatePath']
        conf = pilot / 'reproduction/artifacts' / source['source']['path']
        assert sha(coord) == source['coordinateSha256']
        assert sha(conf) == source['source']['sha256']
        assert conf.stat().st_size == source['source']['bytes']
        for path in (coord, conf):
            sources.append(dict(path=str(path.relative_to(repo)), sha256=sha(path)))
        d = MMCIF2Dict(str(coord))
        atoms = []
        for j, chain in enumerate(d['_atom_site.auth_asym_id']):
            if chain not in ('A', 'B'):
                continue
            assert d['_atom_site.label_asym_id'][j] == chain
            assert d['_atom_site.pdbx_PDB_model_num'][j] == '1'
            assert d['_atom_site.label_alt_id'][j] in ('.', '?')
            assert float(d['_atom_site.occupancy'][j]) == 1
            element = d['_atom_site.type_symbol'][j].upper()
            if element in ('H', 'D'):
                continue
            assert element in radii
            atoms.append(dict(chain=chain, res=int(d['_atom_site.auth_seq_id'][j]),
                              resname=d['_atom_site.label_comp_id'][j],
                              name=d['_atom_site.label_atom_id'][j], element=element,
                              xyz=[float(d['_atom_site.Cartn_' + k][j]) for k in 'xyz']))
        for protein in plan['case']['inputProteins']:
            ca = [a for a in atoms if a['chain'] == protein['chain'] and a['name'] == 'CA']
            assert [a['res'] for a in ca] == list(range(1, len(ca) + 1))
            assert ''.join(seq1(a['resname']) for a in ca) == protein['sequence']
        aa = [a for a in atoms if a['chain'] == 'A']
        bb = [a for a in atoms if a['chain'] == 'B']
        xyzb = np.array([a['xyz'] for a in bb])
        pairs = {}
        atom_contacts = 0
        for a in aa:
            distances = np.sqrt(np.sum((np.array(a['xyz']) - xyzb)**2, axis=1))
            for j in np.where(distances <= 4.5)[0]:
                b = bb[j]
                dist = float(distances[j])
                atom_contacts += 1
                key = (a['res'], b['res'])
                pairs.setdefault(key, 0.0)
                if (a['resname'] == b['resname'] == 'CYS' and
                    a['name'] == b['name'] == 'SG' and 1.8 <= dist <= 2.3):
                    continue
                overlap = radii[a['element']] + radii[b['element']] - dist
                pairs[key] = max(pairs[key], overlap)
        census[id] = [dict(receptorResidue=a, vhhResidue=b, positiveOverlap=o)
                      for (a, b), o in sorted(pairs.items())]
        n, c = len(pairs), sum(o >= .6 for o in pairs.values())
        q = sum((row['positiveOverlap'] / .6)**2 for row in census[id]) / n
        audit = json.loads(replay['coordinateExecution']['reports'][id])['audit']
        assert n == audit['contactPairCount'] and c == audit['severeClashCount']
        assert atom_contacts == audit['atomContactCount']
        features.append(dict(id=id, coordinateSha256=sha(coord), confidenceSha256=sha(conf),
                             evidenceTier={'supported': 2, 'mixed': 1, 'limited': 0,
                                           'not-assessable': 0}[audit['evidenceLevel']],
                             burial=audit['halfDeltaSasaInterfaceAreaAngstrom2'],
                             contacts=n, clashes=c, overlapBurden=q,
                             confidence=read(conf)['confidence_score']))
    save(out / 'features.json', features)
    save(out / 'coordinate-only-contact-overlaps.json', census)
    save(out / 'extraction-receipt.json', dict(status='PASS', sources=sources,
         candidateCount=10, chainRoles={'A': 'receptor', 'B': 'VHH'}, selectedModel='1',
         sequencesVerified=True, allModeledResiduesIncluded=True, experimentalReferenceRead=False,
         countsEqualFrozen=True, python=sys.version, numpy=np.__version__, biopython=Bio.__version__))


def evaluate(repo, feature_path, rank_path, out):
    ranks = read(rank_path)
    features = read(feature_path)
    assert ranks == rank(features), 'Stored ranks differ from outcome-free selector'
    outcome_path = repo / PILOT / 'original-evaluation/comparison-receipt.json'
    ledger = read(outcome_path)['report']['candidateLedger']
    outcomes = {r['id']: r['DockQ'] for r in ledger}
    assert len(ledger) == len(outcomes) == len(features) == 10
    assert set(outcomes) == {r['id'] for r in features}
    best = max(q for q in outcomes.values() if finite(q))
    summaries = []
    for arm in ARMS:
        selected = [r['id'] for r in ranks if r['arm'] == arm and r['rank'] == 1]
        qs = [outcomes[id] for id in selected if finite(outcomes[id])]
        mean = sum(qs) / len(qs) if selected and len(qs) == len(selected) else None
        summaries.append(dict(arm=arm, selected=selected, selectedDockQ=mean,
            selectedDockQMin=min(qs) if qs else None, selectedDockQMax=max(qs) if qs else None,
            missingSelectedDockQ=len(selected)-len(qs), selectedTieCount=len(selected),
            bestAvailableMinusSelected=best-mean if mean is not None else None,
            unscored=[r['id'] for r in ranks if r['arm'] == arm and r['rank'] is None]))
    baseline = next(r['selectedDockQ'] for r in summaries if r['arm'] == 'predictor-confidence')
    for r in summaries:
        r['selectedMinusConfidence'] = r['selectedDockQ'] - baseline if r['selectedDockQ'] is not None and baseline is not None else None
    by_id = {r['id']: r for r in features}
    rows = [dict(**r, **{k: v for k, v in by_id[r['id']].items() if k != 'id'},
                 DockQ=outcomes[r['id']]) for r in ranks]
    save(out / 'all-arm-candidate-results.json', rows)
    with (out / 'all-arm-candidate-results.csv').open('x') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows({**r, 'key': json.dumps(r['key'])} for r in rows)
    save(out / 'evaluation.json', dict(arms=summaries, bestAvailableDockQ=best,
         bestAvailableCandidates=[id for id, q in outcomes.items() if q == best],
         candidateCount=10, resultRows=len(rows),
         missingDockQ=[id for id, q in outcomes.items() if not finite(q)],
         featuresSha256=sha(feature_path), ranksSha256=sha(rank_path),
         outcomeSource=str(outcome_path.relative_to(repo)), outcomeSha256=sha(outcome_path),
         independentGroupCount=0, exposedDevelopmentCaseCount=1, newGpuGeneration=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('extract', 'rank', 'evaluate'))
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--features', type=Path)
    parser.add_argument('--ranks', type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.stage == 'extract':
        extract(args.repo, args.out)
    elif args.stage == 'rank':
        save(args.out / 'ranks.json', rank(read(args.features)))
        save(args.out / 'rank-receipt.json', dict(featuresSha256=sha(args.features),
             ranksSha256=sha(args.out / 'ranks.json'), selectorSha256=sha(__file__),
             outcomeInputs=[], arms=list(ARMS)))
    else:
        evaluate(args.repo, args.features, args.ranks, args.out)


if __name__ == '__main__':
    main()
