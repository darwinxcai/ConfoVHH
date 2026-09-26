"""Independent saved-fit audit including failed attempts and ranking abstentions.

Expected calculations never call the ranker's fitting, selection, rank or metric
functions. Ridge is checked by unordered pair differences and augmented lstsq.
The original completed-300 verifier and its receipts remain unchanged.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import artifacts as a

GRID=(.01,.1,1.,10.)
CONFIDENCE=('complex_plddt','iptm','complex_iplddt','log1p_complex_ipde')
INTERFACE=CONFIDENCE+('log1p_contact_pairs','cdr_share','unnumbered_share')
METRICS=('firstDockQ','firstAcceptableProbability','top5MeanDockQ','top5ExpectedAcceptableCount','bestCandidateGap')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def finite(value):return type(value) in (int,float) and math.isfinite(value)
def names(family):
    a.check(family in ('confidence','interface'),'Unknown family');return CONFIDENCE if family=='confidence' else INTERFACE
def pools(rows):
    result=defaultdict(list)
    for row in sorted(rows,key=lambda x:x['id']):result[row['poolId']].append(row)
    return dict(sorted(result.items()))
def weights(records,groups):
    tree=defaultdict(lambda:defaultdict(lambda:defaultdict(list)))
    for pool,rows in records.items():
        row=rows[0];tree[groups[row['setId']]][row['setId']][row['generationArm']].append(pool)
    result={}
    for targets in tree.values():
        for arms in targets.values():
            for batches in arms.values():
                for pool in batches:result[pool]=1/len(tree)/len(targets)/len(arms)/len(batches)
    return result
def close(expected,actual):
    a.check(finite(expected) and finite(actual) and math.isclose(expected,actual,rel_tol=2e-10,abs_tol=2e-11),'Independent numeric mismatch: '+str((expected,actual)))
def same(expected,actual):
    if isinstance(expected,dict):
        a.check(type(actual)is dict and set(actual)==set(expected),'Independent object fields differ')
        for key in expected:same(expected[key],actual[key])
    elif isinstance(expected,list):
        a.check(type(actual)is list and len(actual)==len(expected),'Independent list membership differs')
        for x,y in zip(expected,actual):same(x,y)
    elif type(expected)is float:close(expected,actual)
    else:a.check(type(actual)is type(expected) and actual==expected,'Independent scalar mismatch: '+str((expected,actual)))

def validate_inputs(rows,labels,groups):
    a.check(rows and len(rows)==len({x['id'] for x in rows}),'Empty/duplicate verification membership')
    a.check(set(labels)=={x['id'] for x in rows},'Independent outcome membership differs')
    a.check(set(groups)=={x['setId'] for x in rows},'Independent group membership differs')
    cells=set()
    for pool,rs in pools(rows).items():
        row=rs[0];cell=(row['setId'],row['generationArm'],row['seedBatch']);a.check(cell not in cells,'Repeated pool cell');cells.add(cell)
        for x in rs:
            a.check((x['setId'],x['generationArm'],x['seedBatch'],x['sourceDirection'],x['profile'])==(*cell,row['sourceDirection'],row['profile']),'Pool identity/profile differs')
    for row in rows:
        a.check(row['producerStatus'] in ('generated','failed','not-run') and row['sourceDirection'] in ('higher-better','lower-better'),'Invalid producer/source direction')
        a.check(row['sourceValue'] is None or finite(row['sourceValue']),'Nonfinite/Boolean source value')
        a.check(set(row['features'])==set(INTERFACE) and all(v is None or finite(v) for v in row['features'].values()),'Nonfinite/unknown feature')
        y=labels[row['id']]
        if row['producerStatus']=='generated':a.check(finite(y) and 0<=y<=1,'Generated outcome unavailable for fit verification')
        else:a.check(y is None,'Nonproduced attempt acquired outcome')

def source_reason(rows):
    produced=[x for x in rows if x['producerStatus']=='generated']
    if not produced:return 'no-produced-candidates'
    if any(x['sourceValue'] is None for x in produced):return 'produced-candidate-source-unavailable'
    return ''
def exclusion(rows,family,support=None):
    reason=source_reason(rows)
    if reason:return reason
    produced=[x for x in rows if x['producerStatus']=='generated']
    if any(x['profile']['scoreContext']!='pair-confidence' for x in produced):return 'unsupported-score-context'
    if support is not None and any(x['profile'] not in support for x in produced):return 'unsupported-producer-profile'
    if any(x['validityStatus']!='valid' for x in produced):return 'invalid-or-unavailable-input'
    if any(x['features'][k] is None for x in produced for k in names(family)):return 'optional-feature-unavailable'
    return ''
def eligible_groups(rows,groups,family):return {groups[rs[0]['setId']] for rs in pools(rows).values() if not exclusion(rs,family)}

def expected_ranks(rows,model=None):
    output=[]
    for pool,rs in pools(rows).items():
        reason=source_reason(rs);mode='abstained' if reason else 'source'
        if not reason and model is not None and model['kind']=='ridge':
            reason=exclusion(rs,model['family'],model['supportProfiles'])
            if not reason:mode='learned'
        scores={}
        if mode!='abstained':
            for row in rs:
                if row['producerStatus']!='generated':continue
                value=row['sourceValue']*(1 if row['sourceDirection']=='higher-better' else -1)
                if mode=='learned':value=float(np.asarray([row['features'][k] for k in names(model['family'])])/np.asarray(model['scales'])@np.asarray(model['coefficients']))
                a.check(finite(value),'Nonfinite independent prediction');scores[row['id']]=value
        ordered=sorted(scores.values(),reverse=True)
        for row in rs:
            score=scores.get(row['id']);positions=[i+1 for i,v in enumerate(ordered) if v==score] if score is not None else []
            produced=row['producerStatus']=='generated'
            output.append({'id':row['id'],'poolId':pool,'setId':row['setId'],'status':mode if produced else 'not-produced',
                           'reason':reason if produced else row['producerStatus'],'score':score,
                           'rankMin':min(positions) if positions else None,'rankMax':max(positions) if positions else None})
    return sorted(output,key=lambda x:x['id'])

def metric(rows,labels,groups,ranks):
    validate_inputs(rows,labels,groups)
    a.check(len(ranks)==len(rows) and {x['id'] for x in ranks}=={x['id'] for x in rows},'All planned rank rows required')
    ranked={x['id']:x for x in ranks};ps=pools(rows);ws=weights(ps,groups);output={}
    for pool,rs in ps.items():
        produced=[x for x in rs if x['producerStatus']=='generated'];ids=[x['id'] for x in produced];n=len(ids)
        available=bool(ids) and all(ranked[i]['score'] is not None for i in ids);base=rs[0]
        record={'poolId':pool,'setId':base['setId'],'groupId':groups[base['setId']],'generationArm':base['generationArm'],'seedBatch':base['seedBatch'],
                'plannedCount':len(rs),'producedCount':n,'outcomeCount':n,'selectionAvailable':available,
                'rankingMode':ranked[ids[0]]['status'] if ids else 'abstained',
                **{k:None for k in METRICS},'bestDockQ':max((labels[i] for i in ids),default=None)}
        if available:
            blocks=defaultdict(list)
            for i in ids:blocks[ranked[i]['score']].append(labels[i])
            ordered=sorted(blocks,reverse=True);first=blocks[ordered[0]];firstq=sum(first)/len(first);k=min(5,n);left=k;topq=topa=0.
            for score in ordered:
                block=blocks[score];take=min(left,len(block));topq+=take*sum(block)/len(block);topa+=take*sum(y>=.23 for y in block)/len(block);left-=take
                if not left:break
            record.update(firstDockQ=firstq,firstAcceptableProbability=sum(y>=.23 for y in first)/len(first),
                          top5MeanDockQ=topq/k,top5ExpectedAcceptableCount=topa,bestCandidateGap=record['bestDockQ']-firstq)
        output[pool]=record
    complete=all(x['selectionAvailable'] for x in output.values())
    aggregate={k:sum(ws[p]*x[k] for p,x in output.items()) if complete else None for k in METRICS}
    aggregate.update(plannedPools=len(ps),selectedPools=sum(x['selectionAvailable'] for x in output.values()),plannedAttempts=len(rows),
                     producedCandidates=sum(x['producerStatus']=='generated' for x in rows),biologicalGroups=len(set(groups.values())),complete=complete)
    return {'aggregate':aggregate,'pools':output,'poolWeights':ws}

def comparison(candidate,baseline):
    losses=[];rescues=[]
    for pool,record in candidate['pools'].items():
        other=baseline['pools'][pool];x=record['firstAcceptableProbability'];y=other['firstAcceptableProbability']
        if x is not None and y is not None:
            if x<y:losses.append(pool)
            if x>y:rescues.append(pool)
    ca=candidate['aggregate'];ba=baseline['aggregate'];gain=None if ca['firstDockQ'] is None or ba['firstDockQ'] is None else ca['firstDockQ']-ba['firstDockQ']
    coverage=ca['selectedPools']==ba['selectedPools']
    return {'firstDockQGain':gain,'acceptableLossPools':losses,'acceptableRescuePools':rescues,'coverageUnchanged':coverage,
            'exploratoryUsefulGainGatePassed':gain is not None and gain>=.02 and not losses and coverage}

def verify_model(model,rows,labels,groups,family,expected_lambda):
    subset={x['setId']:groups[x['setId']] for x in rows};expected_ids=sorted(x['id'] for x in rows)
    a.check(set(model)=={'schema','family','kind','featureNames','lambda','scales','coefficients','supportProfiles','trainingIds','trainingGroups','excludedTrainingPools','inputDigest'}
            and model['schema']=='confovhh-small-linear-ranker-v1','Model fields/schema differ')
    a.check(model['trainingIds']==expected_ids and model['trainingGroups']==sorted(set(subset.values())),'Model training membership/groups differ')
    a.check(model['family']==family and model['featureNames']==list(names(family)),'Model family/features differ')
    chosen={pool:rs for pool,rs in pools(rows).items() if not exclusion(rs,family)}
    excluded={pool:exclusion(rs,family) for pool,rs in pools(rows).items() if exclusion(rs,family)}
    if expected_lambda is None or not chosen:
        a.check(model['kind']=='source' and model['lambda'] is None and model['coefficients']==model['scales']==model['supportProfiles']==[],'Expected complete source fallback model')
        a.check(model['excludedTrainingPools']==({} if expected_lambda is None else excluded),'Source model training exclusions differ')
        a.check(model['inputDigest']==digest({'rows':rows,'groups':subset}),'Source model input digest differs')
        return
    a.check(model['kind']=='ridge' and finite(model['lambda']) and model['lambda']==expected_lambda,'Expected fixed ridge setting')
    a.check(model['excludedTrainingPools']==excluded,'Training-pool exclusion differs')
    a.check(model['inputDigest']==digest({'rows':rows,'labels':{x['id']:labels[x['id']] for x in rows},'groups':subset,'family':family,'lambda':expected_lambda}),'Ridge input digest differs')
    profiles={digest(row['profile']):row['profile'] for rs in chosen.values() for row in rs}
    a.check(model['supportProfiles']==[profiles[k] for k in sorted(profiles)],'Producer support changed')
    ws=weights(chosen,groups);matrix=[];response=[];d=len(names(family))
    for pool,rs in chosen.items():
        produced=[x for x in rs if x['producerStatus']=='generated'];n=len(produced);factor=math.sqrt(ws[pool])/n
        for i in range(n):
            for j in range(i):
                matrix.append([(produced[i]['features'][k]-produced[j]['features'][k])*factor for k in names(family)])
                response.append((labels[produced[i]['id']]-labels[produced[j]['id']])*factor)
    matrix=np.asarray(matrix).reshape((-1,d));response=np.asarray(response);scales=np.sqrt(np.sum(matrix*matrix,axis=0));scales[scales==0]=1
    np.testing.assert_allclose(scales,model['scales'],rtol=2e-10,atol=2e-11)
    design=np.vstack([matrix/scales,math.sqrt(expected_lambda)*np.eye(d)]);target=np.r_[response,np.zeros(d)]
    coefficient=np.linalg.lstsq(design,target,rcond=None)[0]
    np.testing.assert_allclose(coefficient,model['coefficients'],rtol=2e-9,atol=2e-11)

def verify_selection(trace,rows,labels,groups,family,seen,forced_outer_fallback=False):
    labels={x['id']:labels[x['id']] for x in rows}
    local={x['setId']:groups[x['setId']] for x in rows};support=eligible_groups(rows,groups,family)
    if forced_outer_fallback or len(support)<2:
        same({'reason':'insufficient-outer-supported-groups' if forced_outer_fallback else 'insufficient-inner-supported-groups','candidates':[]},trace);return None
    a.check(all(finite(x['lambda']) for x in trace['candidates']) and [x['lambda'] for x in trace['candidates']]==list(GRID),'Candidate grid/coverage differs')
    baseline=metric(rows,labels,local,expected_ranks(rows));candidates=[]
    for candidate in trace['candidates']:
        folds=candidate['folds'];a.check([f['heldOutGroup'] for f in folds]==sorted(set(local.values())),'Inner fold group membership differs');ranks=[]
        for fold in folds:
            held=fold['heldOutGroup'];train=[x for x in rows if groups[x['setId']]!=held];test=[x for x in rows if groups[x['setId']]==held]
            model=fold['model'];a.check(fold['trainingIds']==model['trainingIds'] and fold['trainingGroups']==model['trainingGroups'] and fold['modelDigest']==digest(model),'Inner model/fold binding differs')
            a.check(set(model['trainingIds']).isdisjoint(x['id'] for x in test),'Inner leakage')
            key=digest(model)
            if key not in seen:verify_model(model,train,labels,groups,family,candidate['lambda']);seen.add(key)
            ranks.extend(expected_ranks(test,model))
        result=metric(rows,labels,local,ranks);same(result,candidate['metrics']);cmp=comparison(result,baseline);same(cmp,candidate['comparison'])
        if cmp['firstDockQGain'] is not None and cmp['firstDockQGain']>0 and not cmp['acceptableLossPools'] and cmp['coverageUnchanged']:
            candidates.append((result['aggregate']['firstDockQ'],candidate['lambda']))
    selected=max(candidates)[1] if candidates else None
    a.check(trace['reason']==('source-selected' if selected is None else 'ridge-selected'),'Selection reason differs');return selected

def verify_family(nested,trace,model,rows,labels,groups,family,seen):
    validate_inputs(rows,labels,groups);group_ids=sorted(set(groups.values()));support=eligible_groups(rows,groups,family)
    a.check(nested['family']==family and [x['heldOutGroup'] for x in nested['folds']]==group_ids,'Outer group/family membership differs')
    expected=[]
    for fold in nested['folds']:
        held=fold['heldOutGroup'];train=[x for x in rows if groups[x['setId']]!=held];test=[x for x in rows if groups[x['setId']]==held]
        a.check(fold['heldOutIds']==sorted(x['id'] for x in test) and set(fold['model']['trainingIds']).isdisjoint(fold['heldOutIds']),'Outer membership/leakage differs')
        a.check(fold['trainingGroups']==sorted({groups[x['setId']] for x in train}),'Outer training groups differ')
        selected=verify_selection(fold['selection'],train,labels,groups,family,seen,len(support)<3)
        same(selected,fold['selectedLambda']);verify_model(fold['model'],train,labels,groups,family,selected)
        expected.extend(expected_ranks(test,fold['model']))
    expected=sorted(expected,key=lambda x:x['id']);same(expected,nested['ranks'])
    actual=metric(rows,labels,groups,expected);baseline=metric(rows,labels,groups,expected_ranks(rows))
    same(actual,nested['allPlanned']);same(baseline,nested['sourceBaseline']);same(comparison(actual,baseline),nested['allPlannedComparison'])
    pair=[x for x in rows if x['profile']['scoreContext']=='pair-confidence'];pg={x['setId']:groups[x['setId']] for x in pair};pl={x['id']:labels[x['id']] for x in pair};ids=set(pl)
    pair_actual=metric(pair,pl,pg,[x for x in expected if x['id'] in ids]);pair_baseline=metric(pair,pl,pg,expected_ranks(pair))
    same(pair_actual,nested['learnerSupported']);same(pair_baseline,nested['learnerSupportedBaseline']);same(comparison(pair_actual,pair_baseline),nested['learnerSupportedComparison'])
    a.check(nested['completeLearnerEligibleGroups']==sorted(support),'Eligible group minimum differs')
    selected=verify_selection(trace,rows,labels,groups,family,seen);a.check(selected==model['lambda'],'Final model setting differs');verify_model(model,rows,labels,groups,family,selected)
    return {'outerGroupsVerified':len(group_ids),'plannedRowsVerified':len(rows),'selectedPools':actual['aggregate']['selectedPools'],
            'plannedPools':actual['aggregate']['plannedPools'],'allPlannedFirstDockQ':actual['aggregate']['firstDockQ'],
            'pairScopeFirstDockQ':pair_actual['aggregate']['firstDockQ'],'finalSelectedLambda':selected,'finalKind':model['kind']}

def verify_fit(fit):
    fit=Path(fit).resolve();receipt=a.strict_json((fit/'receipt.json').read_bytes());freeze=a.strict_json((a.HERE/'IMPLEMENTATION-FREEZE-V2.json').read_bytes())
    a.check(receipt['implementation']==freeze['implementation'],'Fit implementation differs from frozen model')
    for name,h in freeze['implementation'].items():a.check(a.sha((a.HERE/name).read_bytes())==h,'Frozen model changed')
    documents={}
    expected_files={'summary.json'}|{f'{family}-{kind}.json' for family in ('confidence','interface') for kind in ('nested','final-selection','model')}
    a.check(set(receipt['files'])==expected_files and receipt['status']=='COMPLETE' and receipt['reservedOutcomesRead'] is False,'Fit receipt output/scope differs')
    for name,binding in receipt['files'].items():
        a.check(binding['path']==str((fit/name).relative_to(a.ROOT)),'Fit artifact redirected outside receipt directory')
        documents[name]=a.strict_json(a.bound(a.ROOT,binding))
    release=a.strict_json(a.bound(a.ROOT,receipt['release']));a.check(release['authorizeDevelopmentFit'] is True and release['evaluationRole']=='development','Fit lacks authorized development release')
    a.check(release['implementation']==freeze['implementation'] and release['protocol']==a.binding(a.ROOT,a.HERE/'PROTOCOL-DRAFT.md'),'Fit release implementation/protocol differs')
    _,qualified_binding=a.qualified_groups(a.ROOT);a.check(release['grouping']==qualified_binding,'Fit used unapproved biological grouping')
    table=a.strict_json(a.bound(a.ROOT,release['predictionTable']));labelrecord=a.strict_json(a.bound(a.ROOT,release['labels']))
    a.check(table['evaluationRole']==labelrecord['evaluationRole']=='development' and table['outcomeInputs']==[] and labelrecord['reservedOutcomesRead'] is False,'Reserved/outcome-contaminated inputs')
    a.check(labelrecord['predictionTableDigest']==digest(table),'Label table binding differs')
    a.check(table['groupingBinding']==qualified_binding,'Prediction grouping differs')
    rows=table['rows'];labels=labelrecord['labels'];grouprecord=a.strict_json(a.bound(a.ROOT,release['grouping']));groups={x['setId']:x['biologicalGroupId'] for x in grouprecord['sets']}
    a.check(receipt['planned']==len(rows) and release['plannedIds']==sorted(x['id'] for x in rows),'Planned fit membership differs')
    for b in table['inputBindings']+labelrecord['inputBindings']:a.bound(a.ROOT,b)
    seen=set();families={}
    for family in ('confidence','interface'):
        families[family]=verify_family(documents[family+'-nested.json'],documents[family+'-final-selection.json'],documents[family+'-model.json'],rows,labels,groups,family,seen)
    summary={'families':{family:{'selectedFinalLambda':families[family]['finalSelectedLambda'],'finalModelKind':families[family]['finalKind'],
             'nestedAllPlanned':documents[family+'-nested.json']['allPlannedComparison'],
             'nestedLearnerSupported':documents[family+'-nested.json']['learnerSupportedComparison']} for family in families},
             'candidateGate':'Exploratory >=0.02 nested supported first DockQ gain, no acceptable loss, unchanged selection coverage',
             'familyChoiceAfterOuterResultsIsExploratory':True,'productionDefaultChanged':False,'BoltzWeightsChanged':False,
             'allTrainingDataDevelopmentExposed':True,'reservedOutcomesRead':False}
    same(summary,documents['summary.json'])
    return {'schema':'confovhh-round4-independent-fit-verification-v2','status':'PASS','planned':len(rows),
            'fitReceipt':a.binding(a.ROOT,fit/'receipt.json'),'verifier':a.binding(a.ROOT,Path(__file__).resolve()),
            'uniqueInnerModelsChecked':len(seen),'families':families,'method':'Independent unordered-pair differences and augmented least squares; all planned rank rows, exact ties, abstentions, empty pools, group/target/arm/batch weights, missingness, fold membership and fixed-grid selection checked.',
            'reservedOutcomesRead':False,'rulesChanged':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--fit',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    report=verify_fit(args.fit);a.save(args.output,report);print({'status':'PASS','planned':report['planned'],'innerModels':report['uniqueInnerModelsChecked']})

if __name__=='__main__':main()
