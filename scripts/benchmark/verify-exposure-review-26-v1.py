#!/usr/bin/env python3
"""Verify bounded native eligibility evidence; never load predictions or scores."""
import argparse, gzip, hashlib, json, time
from collections import Counter
from pathlib import Path

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    start = time.monotonic()
    root = Path(__file__).resolve().parents[2]
    pkg = root / 'validation/exposure-review-26-v1'
    manifest = pkg / 'package-manifest.json'
    if manifest.exists():
        for binding in json.loads(manifest.read_text())['files']:
            bound = root / binding['path']
            assert bound.stat().st_size == binding['bytes'], binding['path']
            assert digest(bound) == binding['sha256'], binding['path']
    plan = json.loads((pkg / 'review-plan.json').read_text())
    decisions = json.loads((pkg / 'decisions.json').read_text())
    native = json.loads(gzip.decompress((pkg / 'native-inspection.json.gz').read_bytes()))
    ids = plan['fixedPdbOrder']
    assert ids == sorted(set(ids)) and len(ids) == 26
    assert [x['pdbId'] for x in decisions['entries']] == ids
    assert [x['pdbId'] for x in native] == ids
    assert Counter(x['decision'] for x in decisions['entries']) == {'excluded': 9, 'unresolved': 17}
    assert not json.loads((pkg / 'cleared-targets.json').read_text())['targets']
    assert digest(root / plan['rosterSource']) == plan['rosterSha256']
    for x in json.loads((pkg / 'reused-evidence.json').read_text()):
        assert digest(root / x['path']) == x['sha256'], x['path']
    records = {x['pdbId']: x for x in native}
    residue_count = 0
    for d, n in zip(decisions['entries'], native):
        assert not d['clearedIndependent'] and d['launchInputSeal'] is None
        assert d['remainingFacts'] and d['recoveryRoute'] and d['primarySourceIds']
        assert d['depositedSource']['sha256'] == n['sha256']
        entities = {x['entity_id']: x for x in n['polymers']}
        for e in entities.values():
            assert len(e['sequence']) == e['length']
            assert hashlib.sha256(e['sequence'].encode()).hexdigest() == e['sequenceSha256']
        for c in n['chains']:
            assert not c['sequenceMismatch'], (n['pdbId'], c['authorChain'])
            assert c['observedResidues'] == len(c['residueMapping'])
            assert len({r['labelResidue'] for r in c['residueMapping']}) == c['observedResidues']
            for r in c['residueMapping']:
                assert entities[c['entityId']]['sequence'][r['labelResidue']-1] == r['expected']
            residue_count += c['observedResidues']
        for a in n['categories']['_pdbx_struct_assembly_gen']:
            assert a['oper_expression'] == '1'
        ops = {x['id']: x for x in n['categories']['_pdbx_struct_oper_list']}
        for i in range(1, 4):
            assert float(ops['1'][f'vector[{i}]']) == 0
            for j in range(1, 4):
                assert float(ops['1'][f'matrix[{i}][{j}]']) == (1 if i == j else 0)
    seq = lambda p, e: next(x['sequence'] for x in records[p]['polymers'] if x['entity_id'] == e)
    for p in ['6N50','6N51','7DGE','8T7H','8TAO']:
        assert seq(p,'2') == seq('6N4Y','2')
    assert seq('7E9G','6')[:118] == seq('7EPB','2')[:118]
    assert seq('7E9G','6')[118:] == 'LEVLFQ'
    assert seq('7EPB','2')[118:] == 'GRPLEVLFQGPHHHHHHHH'
    assert [x['sequence'] for x in records['9S37']['polymers']] == [x['sequence'] for x in records['9S38']['polymers']]
    # Entity IDs are entry-specific: Nb20 is entity 2 in 9VOR, entity 4 in 9VOS.
    assert seq('9VOR','2') == seq('9VOS','4')
    assert next(x for x in decisions['entries'] if x['pdbId']=='9VOS')['depositedResolutionAngstrom'] == [4.3]
    independent_checks = []
    if args.raw:
        import numpy as np
        from Bio.PDB.MMCIF2Dict import MMCIF2Dict
        checks = [('6N4Y','A','F'),('6N4Y','A','G'),('6N50','A','E'),('7DGE','A','C'),
                  ('7E9G','R','E'),('7E9G','S','E'),('7TRK','R','H'),('7TRK','A','H'),
                  ('8IA8','A','S'),('8J23','A','F'),('8XT9','C','A'),('9KGK','A','B'),
                  ('9FTE','A','B'),('9VOR','A','C'),('9VOR','B','C')]
        for p in ids:
            assert digest(args.raw / (p+'.cif')) == records[p]['sha256'], p
        for p, a, b in checks:
            # Direct distance blocks: independent of the production KD-tree neighbor search.
            cif = MMCIF2Dict(str(args.raw / (p+'.cif')))
            atoms = {}
            for i, chain in enumerate(cif['_atom_site.auth_asym_id']):
                if chain not in (a,b) or cif['_atom_site.pdbx_PDB_model_num'][i] != '1':
                    continue
                resid = cif['_atom_site.label_seq_id'][i]
                if resid in ('.','?') or cif['_atom_site.type_symbol'][i] in ('H','D'):
                    continue
                occ = float(cif['_atom_site.occupancy'][i])
                if occ <= 0:
                    continue
                key = (chain, resid, cif['_atom_site.label_atom_id'][i])
                if key not in atoms or occ > atoms[key][0]:
                    atoms[key] = (occ, [float(cif['_atom_site.Cartn_'+v][i]) for v in 'xyz'])
            aa = [(int(k[1]),v[1]) for k,v in atoms.items() if k[0]==a]
            bb = [(int(k[1]),v[1]) for k,v in atoms.items() if k[0]==b]
            xa, xb = np.array([x[1] for x in aa]), np.array([x[1] for x in bb])
            contacts = set()
            for first in range(0,len(xa),128):
                delta=xa[first:first+128,None,:]-xb[None,:,:]
                rows,cols=np.where(np.sum(delta*delta,axis=2)<=4.5**2)
                contacts.update((aa[first+i][0],bb[j][0]) for i,j in zip(rows,cols))
            frozen=next(x for x in records[p]['pairContacts'] if set(x['authorChains'])=={a,b})
            expected={tuple(x) for x in frozen['contactResiduePairs']}
            if frozen['authorChains'] != [a,b]:
                expected={(j,i) for i,j in expected}
            assert contacts==expected, (p,a,b,len(contacts),len(expected))
            independent_checks.append({'pdbId':p,'authorChains':[a,b],'contactResiduePairs':len(contacts)})
    receipt={'status':'PASS','seconds':time.monotonic()-start,'entries':26,'observedResiduesChecked':residue_count,
             'counts':decisions['counts'],'rawHashesChecked':26 if args.raw else 0,
             'independentDenseContactChecks':independent_checks,'newGpuHours':0,'newPredictionOutcomesRead':0,
             'scope':'Native evidence identity and selected contact calculations; not a certificate of unresolved sample lineage or local-density quality.'}
    if args.receipt:
        args.receipt.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__':
    main()
