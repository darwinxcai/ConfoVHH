"""Report authenticated frozen ranks; never choose rules or recompute features."""
from __future__ import annotations
import argparse
import collections
import csv
import datetime as dt
from fractions import Fraction
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write_json(path,value):
    with path.open('x') as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n')

def comparison(source,policy):
    """Marginal probability changes; no artificial independent tie draws."""
    q0,q1=source['firstChoiceDockQ'],policy['firstChoiceDockQ']
    p0,p1=source['firstChoiceAcceptableProbability'],policy['firstChoiceAcceptableProbability']
    delta=None if p0 is None or p1 is None else p1-p0
    return {'sourceFirstChoiceDockQ':q0,'policyFirstChoiceDockQ':q1,
            'firstChoiceDockQChange':None if q0 is None or q1 is None else q1-q0,
            'sourceAcceptableProbability':p0,'policyAcceptableProbability':p1,
            'acceptableProbabilityChange':delta,
            'acceptableProbabilityDecrease':None if delta is None else max(-delta,0),
            'acceptableProbabilityIncrease':None if delta is None else max(delta,0),
            'firstChoiceIdsChanged':source['selected']['ids']!=policy['selected']['ids']}

def macro(rows,membership,fields):
    """Equal groups, equal sets inside each group, with explicit missingness."""
    assert len(rows)==len(membership)==len({r['setId'] for r in rows})
    by_set={r['setId']:r for r in rows};assert set(by_set)==set(membership)
    groups=collections.defaultdict(list)
    for set_id,group in membership.items():groups[group].append(set_id)
    out=[]
    for group,sets in sorted(groups.items()):
        item={'group':group,'sets':sorted(sets),'means':{},'unavailableSets':{}}
        for field in fields:
            absent=[s for s in sets if by_set[s][field] is None]
            item['unavailableSets'][field]=absent
            item['means'][field]=None if absent else sum(by_set[s][field] for s in sets)/len(sets)
        out.append(item)
    means={field:None if any(g['means'][field] is None for g in out) else sum(g['means'][field] for g in out)/len(out) for field in fields}
    return {'groupCount':len(out),'setCount':len(rows),'groups':out,'equalGroupMeans':means}

def compact_metric(metric):
    top5=metric['practicalWindows']['top5'] if metric['practicalWindows'] else None
    c=metric['coverage'];p=metric['pools']['allPlanned']
    return {'setId':metric['setId'],'arm':metric['arm'],'status':metric['status'],
            'planned':c['plannedCount'],'produced':c['producedCount'],'inputValid':c['validInputCount'],
            'policyEligible':c['eligibleCount'],'selectionAvailable':c['selectionAvailable'],
            'firstChoiceDockQ':metric['firstChoiceDockQ'],
            'firstChoiceAcceptableProbability':metric['firstChoiceAcceptableProbability'],
            'top5MeanDockQ':top5['meanDockQ'] if top5 else None,
            'top5AcceptableCount':top5['correctCountsByThreshold']['0.23'] if top5 and top5['correctCountsByThreshold'] else None,
            'allPlannedOutcomesAvailable':p['complete'],
            'acceptablePoseCount':p['correctCountsByThreshold']['0.23'] if p['correctCountsByThreshold'] else None,
            'selectedIds':metric['selected']['ids'],'interfaceSupport':metric['interfaceSupport']['status']}

def independent_first_choice(metric,values):
    ids=metric['selected']['ids']
    if not ids:return {'checked':False,'reason':'selection unavailable'}
    if any(values[i] is None for i in ids):return {'checked':False,'reason':'required outcome unavailable'}
    mean=sum((Fraction(str(values[i])) for i in ids),Fraction())/len(ids)
    success=Fraction(sum(Fraction(str(values[i]))>=Fraction('0.23') for i in ids),len(ids))
    assert abs(float(mean)-metric['firstChoiceDockQ'])<=1e-12
    assert abs(float(success)-metric['firstChoiceAcceptableProbability'])<=1e-12
    return {'checked':True,'selectedCount':len(ids),'exactMean':str(mean),'exactAcceptableProbability':str(success)}

def run(args):
    root=args.artifacts.resolve();out=args.output.resolve()
    adapter=module('authenticated_round3_outcomes',root/'round3-benchmark/outcome-tools/outcome_adapter.py')
    ev=module('frozen_v3_evaluator',root/'ConfoVHH/scripts/external-ranking-v3/evaluate.py')
    legacy=module('legacy_saved_rank_evaluator',root/'ConfoVHH/scripts/external-ranking-v2/evaluate_saved.py')
    outcome_binding=adapter.binding(root,args.outcomes.resolve())
    outcomes,authentication,outcome_receipt=adapter.verify_evaluation(root,outcome_binding)
    request=adapter.strict_json(adapter.bound(root,outcome_receipt['request']))
    values={r['id']:r['DockQ'] for r in outcomes['rows']}
    metrics=[];physical=[];membership={};independent=[];v1_failure_counts=collections.Counter()
    for ranked_binding in request['rankingReceipts']:
        receipt=adapter.strict_json(adapter.bound(root,ranked_binding))
        folder=(root/ranked_binding['path']).parent
        data={name:adapter.strict_json((folder/name).read_bytes()) for name in receipt['files']}
        source=data['source-manifest.json'];attempts=source['attempts']
        for policy in data['manifest.json']['setPolicies']:
            membership[policy['setId']]=policy['biologicalGroupId']
        for record in data['ranks.json']:
            ids=[a['id'] for a in attempts if a['setId']==record['setId']]
            result=ev.evaluate_record(record,values,ids);metrics.append(result)
            independent.append({'setId':record['setId'],'arm':record['arm'],**independent_first_choice(result,values)})
        for record in data['source-ranks.json']:
            if record['arm']!='frozen-v06':continue
            item=legacy.summarize_saved(record,values);physical.append(legacy.metric_row(item))
        for attempt in data['source-attempts.json']:
            if attempt['producerStatus']=='generated' and attempt['status']!='scored':
                v1_failure_counts[attempt['reason']]+=1
    compact=[compact_metric(m) for m in metrics]
    bykey={(m['setId'],m['arm']):m for m in metrics};assert len(bykey)==len(metrics)
    contrasts=[]
    for row in compact:
        comp=comparison(bykey[row['setId'],'source-only'],bykey[row['setId'],row['arm']])
        contrasts.append({'setId':row['setId'],'arm':row['arm'],**comp})
    bycontrast={(r['setId'],r['arm']):r for r in contrasts}
    specs=adapter.strict_json((root/'round3-control/REPORTING-SPEC.json').read_bytes())
    tie_spec=adapter.strict_json((root/'round3-control/REPORTING-TIE-CLARIFICATION.json').read_bytes())
    strata=[]
    fields=['firstChoiceDockQ','firstChoiceAcceptableProbability','top5MeanDockQ','top5AcceptableCount',
            'firstChoiceDockQChange','acceptableProbabilityChange','acceptableProbabilityDecrease','acceptableProbabilityIncrease']
    arms=sorted({r['arm'] for r in compact})
    for stratum in specs['fixedStrata']:
        sets=set(stratum['sets'])
        if not sets&set(membership):continue
        assert sets<=set(membership),'Partial predeclared stratum'
        members={s:membership[s] for s in sets};assert len(set(members.values()))==stratum['groups']
        for arm in arms:
            rows=[{**r,**bycontrast[r['setId'],arm]} for r in compact if r['arm']==arm and r['setId'] in sets]
            strata.append({'stratum':stratum['id'],'arm':arm,**macro(rows,members,fields),
                           'selectionAvailableSets':sum(r['selectionAvailable'] for r in rows),
                           'setsWithAcceptableProbabilityDecrease':[r['setId'] for r in rows if r['acceptableProbabilityDecrease'] is not None and r['acceptableProbabilityDecrease']>0],
                           'setsWithAcceptableProbabilityIncrease':[r['setId'] for r in rows if r['acceptableProbabilityIncrease'] is not None and r['acceptableProbabilityIncrease']>0]})
    set_quality=[]
    for set_id in sorted(membership):
        selected=[r for r in outcomes['rows'] if r['setId']==set_id]
        known=[r['DockQ'] for r in selected if r['DockQ'] is not None]
        any_acceptable=any(v>=.23 for v in known)
        set_quality.append({'setId':set_id,'group':membership[set_id],'planned':len(selected),'outcomesAvailable':len(known),
                            'acceptableCountKnown':sum(v>=.23 for v in known),
                            'containsAcceptable':True if any_acceptable else False if len(known)==len(selected) else None,
                            'bestKnownDockQ':max(known) if known else None})
    out.mkdir(parents=True,exist_ok=False)
    files={'metrics.json':metrics,'compact-metrics.json':compact,'comparisons.json':contrasts,'strata.json':strata,
           'set-quality.json':set_quality,'unchanged-physical-comparator.json':physical,'independent-first-choice-checks.json':independent}
    for name,value in files.items():write_json(out/name,value)
    for name,rows in [('metrics.csv',compact),('comparisons.csv',contrasts),('set-quality.csv',set_quality),('unchanged-physical-comparator.csv',physical)]:
        with (out/name).open('x',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader()
            for row in rows:writer.writerow({k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in row.items()})
    receipt={'schema':'confovhh-round3-frozen-report-evaluation-v1','completedAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
             'evaluationRole':outcomes['evaluationRole'],'outcomeReceipt':outcome_binding,'rankingReceipts':request['rankingReceipts'],
             'reportingSpecificationSha256':sha(root/'round3-control/REPORTING-SPEC.json'),
             'tieClarificationSha256':sha(root/'round3-control/REPORTING-TIE-CLARIFICATION.json'),
             'implementation':{str(p.relative_to(root)):sha(p) for p in [Path(__file__).resolve(),root/'ConfoVHH/scripts/external-ranking-v3/evaluate.py',root/'ConfoVHH/scripts/external-ranking-v2/evaluate_saved.py',root/'round3-benchmark/outcome-tools/outcome_adapter.py']},
             'planned':len(values),'sets':len(membership),'biologicalGroups':len(set(membership.values())),
             'outcomesAvailable':sum(v is not None for v in values.values()),'arms':arms,
             'physicalAuditUnavailableReasons':dict(v1_failure_counts),
             'files':{p.name:sha(p) for p in sorted(out.iterdir()) if p.is_file()},
             'claims':{'featuresOrRanksRecomputed':False,'weightsOrRulesSelected':False,'productionChanged':False,
                       'pairedTieDrawCouplingAssumed':False,'missingValuesReplacedByZero':False}}
    write_json(out/'receipt.json',receipt)
    print(json.dumps({'role':outcomes['evaluationRole'],'planned':len(values),'evaluated':receipt['outcomesAvailable'],
                      'sets':len(membership),'reportReceiptSha256':sha(out/'receipt.json')}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,default=ROOT)
    p.add_argument('--outcomes',type=Path,required=True,help='Authenticated outcome adapter receipt.json')
    p.add_argument('--output',type=Path,required=True);run(p.parse_args())
