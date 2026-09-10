#!/usr/bin/env python3
"""General target-independent evaluator for pinned Boltz mmCIF predictions.

score has no reference/outcome argument. evaluate is a separate post-freeze join.
All five formulas are imported unchanged from the preceding versioned module.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / 'validation/prospective-benchmark-v1'
ENGINE = ROOT / 'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/frozen-source'
FORMULAS = ROOT / 'scripts/paper/graded-clash-selectors-v1.py'
spec = importlib.util.spec_from_file_location('unchanged_selectors', FORMULAS)
formula = importlib.util.module_from_spec(spec)
spec.loader.exec_module(formula)
ARMS = formula.ARMS
PRIMARY = [(a, b) for a in ARMS[3:] for b in ('predictor-confidence', 'burial-only')]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_pairs(pairs):
    result = {}
    for k, v in pairs:
        require(k not in result, 'Duplicate JSON key: ' + k)
        result[k] = v
    return result


def load(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=strict_pairs,
                      parse_constant=lambda v: (_ for _ in ()).throw(ValueError('Nonfinite JSON: '+v)))


def save(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def keys(row, expected):
    require(isinstance(row, dict) and set(row) == set(expected.split()), 'Unexpected or absent fields')


def identity(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', value), 'Invalid ID')


def artifact(base, record):
    keys(record, 'path sha256 bytes')
    rel = Path(record['path'])
    require(not rel.is_absolute() and '..' not in rel.parts, 'Unsafe artifact path')
    p = base / rel
    require(p.resolve() == p.absolute() and p.is_file(), 'Absent or indirect artifact')
    require(type(record['bytes']) is int and 0 < record['bytes'] <= 8_000_000, 'Invalid size')
    require(p.stat().st_size == record['bytes'] and sha(p) == record['sha256'], 'Artifact hash/size mismatch')
    return p


def validate_plan(plan):
    keys(plan, 'schema studyId targets attempts')
    require(plan['schema'] == 'confovhh-prediction-only-benchmark-v1', 'Wrong schema')
    identity(plan['studyId'])
    require(isinstance(plan['targets'], list) and 0 < len(plan['targets']) <= 500, 'Invalid target inventory')
    targets = {}
    for t in plan['targets']:
        keys(t, 'id groupId receptorChain vhhChain receptorSequence vhhSequence')
        identity(t['id']); identity(t['groupId'])
        require(t['id'] not in targets, 'Duplicate target')
        for k in ('receptorChain', 'vhhChain'):
            identity(t[k])
        require(t['receptorChain'] != t['vhhChain'], 'Same role chains')
        for k in ('receptorSequence', 'vhhSequence'):
            require(isinstance(t[k], str) and re.fullmatch('[ACDEFGHIKLMNPQRSTVWY]+', t[k]), 'Noncanonical or empty sequence')
        targets[t['id']] = t
    require(isinstance(plan['attempts'], list) and 0 < len(plan['attempts']) <= 5000, 'Invalid attempt inventory')
    ids = set()
    for a in plan['attempts']:
        keys(a, 'id targetId status reason coordinate confidence')
        identity(a['id'])
        require(a['id'] not in ids and a['targetId'] in targets, 'Duplicate or unknown attempt')
        ids.add(a['id'])
        require(a['status'] in ('generated', 'failed', 'not-run'), 'Invalid attempt status')
        require(isinstance(a['reason'], str), 'Reason must be text')
        if a['status'] != 'generated':
            require(a['reason'].strip() and a['coordinate'] is None and a['confidence'] is None, 'Failure needs reason and no score input')
        else:
            require(a['reason'] == '' and isinstance(a['coordinate'], dict), 'Generated attempt needs coordinate')
    require({a['targetId'] for a in plan['attempts']} == set(targets), 'Target with no planned attempts')
    return targets


def geometry(coord, target):
    import numpy as np
    from Bio.PDB.MMCIF2Dict import MMCIF2Dict
    from Bio.SeqUtils import seq1
    d = MMCIF2Dict(str(coord))
    require(set(d['_atom_site.pdbx_PDB_model_num']) == {'1'}, 'Exactly model 1 required')
    radii = {'C': 1.7, 'N': 1.55, 'O': 1.52, 'S': 1.8, 'P': 1.8, 'SE': 1.9}
    role_chains = (target['receptorChain'], target['vhhChain'])
    atoms = []
    seen = set()
    for i, chain in enumerate(d['_atom_site.auth_asym_id']):
        if chain not in role_chains:
            continue
        require(d['_atom_site.label_asym_id'][i] == chain, 'Label/auth chain disagreement')
        require(d['_atom_site.label_alt_id'][i] in ('.', '?'), 'Alternate location unsupported')
        require(d['_atom_site.pdbx_PDB_ins_code'][i] in ('.', '?'), 'Insertion code unsupported')
        require(float(d['_atom_site.occupancy'][i]) == 1., 'Partial occupancy unsupported')
        element = d['_atom_site.type_symbol'][i].upper()
        if element in ('H', 'D'):
            continue
        require(element in radii, 'Unsupported heavy atom element')
        res = int(d['_atom_site.auth_seq_id'][i]); name = d['_atom_site.label_atom_id'][i]
        require(int(d['_atom_site.label_seq_id'][i]) == res, 'Label/auth residue disagreement')
        require((chain, res, name) not in seen, 'Duplicate atom')
        seen.add((chain, res, name))
        xyz = [float(d['_atom_site.Cartn_'+k][i]) for k in 'xyz']
        require(all(math.isfinite(x) for x in xyz), 'Nonfinite coordinate')
        atoms.append(dict(chain=chain, res=res, name=name, resname=d['_atom_site.label_comp_id'][i], element=element, xyz=xyz))
    for chain, seq in zip(role_chains, (target['receptorSequence'], target['vhhSequence'])):
        ca = sorted([a for a in atoms if a['chain'] == chain and a['name'] == 'CA'], key=lambda a: a['res'])
        require([a['res'] for a in ca] == list(range(1, len(seq)+1)), 'Missing, extra or renumbered CA residue')
        require(''.join(seq1(a['resname']) for a in ca) == seq, 'Prediction-input sequence/role mismatch')
    aa = [a for a in atoms if a['chain'] == role_chains[0]]
    bb = [a for a in atoms if a['chain'] == role_chains[1]]
    require(aa and bb and len(atoms) <= 12000, 'Unsupported atom count')
    xyzb = np.array([a['xyz'] for a in bb]); pairs = {}; atom_count = 0
    for a in aa:
        distances = np.sqrt(np.sum((np.array(a['xyz'])-xyzb)**2, axis=1))
        for j in np.where(distances <= 4.5)[0]:
            b = bb[j]; dist = float(distances[j]); atom_count += 1
            key = (a['res'], b['res']); pairs.setdefault(key, 0.)
            if a['resname'] == b['resname'] == 'CYS' and a['name'] == b['name'] == 'SG' and 1.8 <= dist <= 2.3:
                continue
            pairs[key] = max(pairs[key], radii[a['element']]+radii[b['element']]-dist)
    census = [dict(receptorResidue=a, vhhResidue=b, positiveOverlap=o) for (a,b),o in sorted(pairs.items())]
    return dict(contacts=len(pairs), clashes=sum(o >= .6 for o in pairs.values()),
                overlapBurden=sum((r['positiveOverlap']/.6)**2 for r in census)/len(pairs) if pairs else None,
                atomContacts=atom_count, census=census)


def verify_engine():
    lock = load(PACKAGE / 'engine-lock.json')
    for p, record in lock['files'].items():
        require((ENGINE/p).stat().st_size == record['bytes'] and sha(ENGINE/p) == record['sha256'], 'Frozen engine changed: '+p)
    require(sha(FORMULAS) == lock['fiveMethodModuleSha256'], 'Five-method implementation changed')


def score(plan_path, base, output, node):
    import numpy, Bio
    base = base.resolve()
    require(sys.version_info[:3] == (3,12,14) and numpy.__version__ == '1.26.4' and Bio.__version__ == '1.88', 'CPU dependency lock mismatch')
    plan = load(plan_path); targets = validate_plan(plan); verify_engine()
    require(subprocess.check_output([node,'--version'],text=True).strip() == 'v24.19.0', 'Node lock mismatch')
    output.mkdir(parents=True, exist_ok=False)
    save(output/'plan.json', plan)
    features = {}; ledger = []
    for attempt in plan['attempts']:
        id = attempt['id']; target = targets[attempt['targetId']]
        record = dict(id=id, targetId=target['id'], groupId=target['groupId'], producerStatus=attempt['status'],
                      status=attempt['status'], reason=attempt['reason'], confidenceStatus='not-applicable')
        if attempt['status'] == 'generated':
            folder = output/id; folder.mkdir()
            try:
                coord = artifact(base, attempt['coordinate']); g = geometry(coord, target)
                payload = dict(id=id, engine=str(ENGINE), coordinateBase64=base64.b64encode(coord.read_bytes()).decode(),
                               sha256=sha(coord), receptorChain=target['receptorChain'], vhhChain=target['vhhChain'])
                env = {k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH')}
                with (folder/'audit.stdout.json').open('xb') as stdout, (folder/'audit.stderr.log').open('xb') as stderr:
                    subprocess.run([node,str(ROOT/'scripts/benchmark/audit-frozen.mjs')], input=json.dumps(payload).encode(),
                                   stdout=stdout,stderr=stderr,timeout=900,check=True,env=env)
                audit = load(folder/'audit.stdout.json')['audit']
                require(g['contacts'] == audit['contactPairCount'] and g['clashes'] == audit['severeClashCount']
                        and g['atomContacts'] == audit['atomContactCount'], 'Frozen/independent geometry discrepancy')
                conf = None; conf_sha = None
                record['confidenceStatus'] = 'missing'
                if attempt['confidence'] is not None:
                    try:
                        cp = artifact(base, attempt['confidence']); conf_sha = sha(cp)
                        conf = load(cp)['confidence_score']
                        require(type(conf) in (float,int) and math.isfinite(conf) and 0 <= conf <= 1, 'Invalid confidence_score')
                        record['confidenceStatus'] = 'present'
                    except (ValueError, KeyError, OSError) as error:
                        conf = None; record['confidenceStatus'] = 'invalid: '+str(error)
                features[id] = dict(id=id, coordinateSha256=sha(coord), confidenceSha256=conf_sha,
                                    burial=audit['halfDeltaSasaInterfaceAreaAngstrom2'],
                                    evidenceTier={'supported':2,'mixed':1,'limited':0,'not-assessable':0}[audit['evidenceLevel']],
                                    contacts=g['contacts'], clashes=g['clashes'], overlapBurden=g['overlapBurden'], confidence=conf)
                save(folder/'overlaps.json', g)
                record.update(status='scored',reason='',warningEvidenceLevel=audit['evidenceLevel'])
            except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
                record.update(status='evaluation-failed', reason=type(error).__name__+': '+str(error))
            save(folder/'attempt.json', record)
        ledger.append(record)
    ranking = []
    for target in plan['targets']:
        pool = [features[a['id']] for a in ledger if a['targetId'] == target['id'] and a['id'] in features]
        raw = formula.rank(pool)
        for arm in ARMS:
            arm_rows = [r for r in raw if r['arm'] == arm]
            complete = bool(arm_rows) and all(r['rank'] is not None for r in arm_rows)
            ranking.append(dict(targetId=target['id'],groupId=target['groupId'],arm=arm,
                                status='ranked' if complete else 'abstain',
                                reason='' if complete else 'No valid pool or a required score is unavailable; no candidate dropped',
                                selected=[r['id'] for r in arm_rows if r['rank']==1] if complete else [], rows=arm_rows))
    save(output/'features.json',list(features.values()));save(output/'attempts.json',ledger);save(output/'ranks.json',ranking)
    save(output/'receipt.json',dict(schema='confovhh-general-score-receipt-v1',
         status='COMPLETE' if all(a['status']=='scored' for a in ledger) and all(r['status']=='ranked' for r in ranking) else 'RECORDED_WITH_FAILURES_OR_ABSTENTIONS',planSha256=sha(plan_path),
         canonicalSavedPlanSha256=sha(output/'plan.json'),featuresSha256=sha(output/'features.json'),
         attemptsSha256=sha(output/'attempts.json'),ranksSha256=sha(output/'ranks.json'),
         evaluatorSha256=sha(__file__),engineLockSha256=sha(PACKAGE/'engine-lock.json'),
         outcomeInputs=[],arms=list(ARMS),attemptCount=len(ledger),independenceCertified=False))


def binomial_tail(wins, n):
    return sum(math.comb(n,k) for k in range(wins,n+1))/2**n if n else None


def evaluate(score_dir, outcome_path, output):
    receipt = load(score_dir/'receipt.json')
    for name, field in [('plan','canonicalSavedPlanSha256'),('features','featuresSha256'),('attempts','attemptsSha256'),('ranks','ranksSha256')]:
        require(sha(score_dir/(name+'.json')) == receipt[field], 'Rank-stage artifact changed')
    plan = load(score_dir/'plan.json'); validate_plan(plan)
    attempts = load(score_dir/'attempts.json'); ranks = load(score_dir/'ranks.json')
    outcomes = load(outcome_path); keys(outcomes,'schema scoreReceiptSha256 rows')
    require(outcomes['schema']=='confovhh-separate-outcomes-v1' and outcomes['scoreReceiptSha256']==sha(score_dir/'receipt.json'), 'Unbound outcome join')
    by_id = {}
    for row in outcomes['rows']:
        keys(row,'id status DockQ reason')
        require(row['id'] not in by_id, 'Duplicate outcome')
        require(row['status'] in ('available','missing','failed'), 'Unknown outcome status')
        if row['status']=='available':
            require(type(row['DockQ']) in (int,float) and math.isfinite(row['DockQ']) and 0<=row['DockQ']<=1 and row['reason']=='', 'Invalid DockQ')
        else: require(row['DockQ'] is None and bool(row['reason']), 'Unavailable outcome requires reason')
        by_id[row['id']]=row
    require(set(by_id)=={a['id'] for a in attempts}, 'Every planned attempt needs an outcome disposition')
    rows=[]
    def summarize(ids):
        qs=[by_id[id]['DockQ'] for id in ids if by_id[id]['status']=='available']; missing=len(ids)-len(qs)
        return dict(selected=ids,missing=missing,mean=sum(qs)/len(ids) if ids and not missing else None,
                    minimum=min(qs) if qs else None,maximum=max(qs) if qs else None,
                    lower=sum(qs)/len(ids) if ids else 0.,upper=(sum(qs)+missing)/len(ids) if ids else 1.)
    for rank in ranks:
        rows.append(dict(targetId=rank['targetId'],groupId=rank['groupId'],arm=rank['arm'],status=rank['status'],**summarize(rank['selected'])))
    baselines=[]
    for t in plan['targets']:
        ids=[a['id'] for a in attempts if a['targetId']==t['id'] and a['status']=='scored']
        qs=[by_id[id]['DockQ'] for id in ids if by_id[id]['status']=='available']
        best=max(qs) if qs else None
        baselines.append(dict(targetId=t['id'],uniformRandom=summarize(ids),bestAvailable=best,
                              bestAvailableTies=[id for id in ids if by_id[id]['DockQ']==best] if best is not None else [],
                              oracleComplete=len(qs)==len(ids) and bool(ids)))
    comparisons=[]
    for a,b in PRIMARY:
        group_deltas={};bounds={}
        for t in plan['targets']:
            x=next(r for r in rows if r['targetId']==t['id'] and r['arm']==a)
            y=next(r for r in rows if r['targetId']==t['id'] and r['arm']==b)
            group_deltas.setdefault(t['groupId'],[]).append(x['mean']-y['mean'] if x['mean'] is not None and y['mean'] is not None else None)
            bounds.setdefault(t['groupId'],[]).append((x['lower']-y['upper'],x['upper']-y['lower']))
        groups=[dict(groupId=g,delta=sum(v)/len(v) if all(x is not None for x in v) else None,
                     lower=sum(x[0] for x in bounds[g])/len(v),upper=sum(x[1] for x in bounds[g])/len(v)) for g,v in sorted(group_deltas.items())]
        complete=all(g['delta'] is not None for g in groups)
        wins=sum(g['delta'] is not None and g['delta']>0 for g in groups)
        comparisons.append(dict(method=a,baseline=b,groups=groups,complete=complete,
            meanGroupDelta=sum(g['delta'] for g in groups)/len(groups) if complete else None,
            lower=sum(g['lower'] for g in groups)/len(groups),upper=sum(g['upper'] for g in groups)/len(groups),
            wins=wins,ties=sum(g['delta']==0 for g in groups),losses=sum(g['delta'] is not None and g['delta']<0 for g in groups),
            oneSidedWinP=binomial_tail(wins,len(groups)) if complete else None,holmP=None))
    if all(c['oneSidedWinP'] is not None for c in comparisons):
        previous=0.
        for i,c in enumerate(sorted(comparisons,key=lambda c:c['oneSidedWinP'])):
            previous=max(previous,min(1.,(len(comparisons)-i)*c['oneSidedWinP']));c['holmP']=previous
    output.mkdir(parents=True,exist_ok=False)
    save(output/'evaluation.json',dict(schema='confovhh-benchmark-evaluation-v1',selectionRows=rows,baselines=baselines,
         primaryComparisons=comparisons,attempts=attempts,outcomes=outcomes['rows'],
         scoreReceiptSha256=sha(score_dir/'receipt.json'),outcomesSha256=sha(outcome_path),
         analysisSha256=sha(__file__),independenceCertified=False,superiorityEstablished=False))


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='stage',required=True)
    s=sub.add_parser('score');s.add_argument('--plan',required=True,type=Path);s.add_argument('--artifacts',required=True,type=Path);s.add_argument('--node',required=True);s.add_argument('--output',required=True,type=Path)
    e=sub.add_parser('evaluate');e.add_argument('--scores',required=True,type=Path);e.add_argument('--outcomes',required=True,type=Path);e.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    if args.stage=='score':score(args.plan,args.artifacts.resolve(),args.output,args.node)
    else:evaluate(args.scores,args.outcomes,args.output)


if __name__=='__main__':main()
