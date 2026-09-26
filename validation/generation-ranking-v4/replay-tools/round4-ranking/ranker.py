"""Small prediction-only linear ranker; labels enter fitting/evaluation separately.

No filesystem reads, feature selection, target-name inference or random splits.
"""
from __future__ import annotations
import hashlib
import json
import math
from collections import defaultdict
import numpy as np

CONFIDENCE = ('complex_plddt', 'iptm', 'complex_iplddt', 'log1p_complex_ipde')
INTERFACE = ('log1p_contact_pairs', 'cdr_share', 'unnumbered_share')
FEATURES = CONFIDENCE + INTERFACE
GRID = (0.01, 0.1, 1.0, 10.0)
PAIR_CONTEXT = 'pair-confidence'
ROW_KEYS = {'id','setId','poolId','generationArm','seedBatch','producerStatus',
            'sourceValue','sourceDirection','validityStatus','coordinateSha256','profile','features'}
PROFILE_KEYS = {'producerVersion','modelSha256','scoreContext','generationRegimeSha256'}

def check(condition, message):
    if not condition: raise ValueError(message)

def finite(x): return type(x) in (float,int) and math.isfinite(x)
def digest(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def names(family):
    check(family in ('confidence','interface'), 'Unknown model family')
    return CONFIDENCE if family == 'confidence' else FEATURES

def validate_rows(rows):
    check(type(rows) is list and rows, 'Nonempty prediction rows required')
    ids=set(); pools={}
    for r in rows:
        check(type(r) is dict and set(r)==ROW_KEYS, 'Prediction row has unexpected/missing fields (outcome injection forbidden)')
        for k in ('id','setId','poolId','generationArm','seedBatch'):
            check(type(r[k]) is str and r[k], 'Invalid prediction identity')
        check(r['id'] not in ids, 'Duplicate prediction ID'); ids.add(r['id'])
        check(r['producerStatus'] in ('generated','failed','not-run'), 'Invalid producer status')
        check(r['validityStatus'] in ('valid','invalid','unavailable'), 'Invalid validity status')
        check(r['sourceDirection'] in ('higher-better','lower-better'), 'Invalid source direction')
        check(r['sourceValue'] is None or finite(r['sourceValue']), 'Invalid source value')
        check(r['coordinateSha256'] is None or (type(r['coordinateSha256']) is str and len(r['coordinateSha256'])==64 and all(c in '0123456789abcdef' for c in r['coordinateSha256'])), 'Invalid coordinate digest')
        check(type(r['profile']) is dict and set(r['profile'])==PROFILE_KEYS, 'Invalid producer profile')
        check(all(type(v) is str and v for v in r['profile'].values()), 'Invalid producer profile value')
        check(type(r['features']) is dict and set(r['features'])==set(FEATURES), 'Unexpected inference feature')
        check(all(x is None or finite(x) for x in r['features'].values()), 'Nonfinite/boolean feature')
        for k in ('complex_plddt','iptm','complex_iplddt','cdr_share','unnumbered_share'):
            check(r['features'][k] is None or 0<=r['features'][k]<=1, 'Feature outside defined range')
        for k in ('log1p_complex_ipde','log1p_contact_pairs'):
            check(r['features'][k] is None or r['features'][k]>=0, 'Negative transformed feature')
        identity=(r['setId'],r['generationArm'],r['seedBatch'],r['sourceDirection'],digest(r['profile']))
        check(r['poolId'] not in pools or pools[r['poolId']]==identity,'Pool metadata differs')
        pools[r['poolId']]=identity
    return rows

def by_pool(rows):
    output=defaultdict(list)
    for r in sorted(rows,key=lambda x:x['id']): output[r['poolId']].append(r)
    return dict(sorted(output.items()))

def validate_groups(rows,groups):
    check(type(groups) is dict and set(groups)=={r['setId'] for r in rows}, 'Group map must cover exactly all target sets')
    check(all(type(g) is str and g for g in groups.values()), 'Invalid group ID')

def subset_groups(rows,groups): return {s:groups[s] for s in sorted({r['setId'] for r in rows})}

def pool_weights(rows,groups):
    """Equal group -> target -> generation arm -> seed batch (pool), never row count."""
    validate_groups(rows,groups); tree=defaultdict(lambda:defaultdict(lambda:defaultdict(dict)))
    for pool,rs in by_pool(rows).items():
        r=rs[0]; arm=tree[groups[r['setId']]][r['setId']][r['generationArm']]
        check(r['seedBatch'] not in arm, 'Two pools claim one target/arm/seed-batch cell')
        arm[r['seedBatch']]=pool
    weights={}
    for targets in tree.values():
        for arms in targets.values():
            for batches in arms.values():
                for pool in batches.values(): weights[pool]=1/len(tree)/len(targets)/len(arms)/len(batches)
    return weights

def validate_labels(rows,labels):
    check(type(labels) is dict and set(labels)=={r['id'] for r in rows}, 'Outcome membership differs')
    for r in rows:
        y=labels[r['id']]
        check(y is None or (finite(y) and 0<=y<=1), 'Invalid DockQ')
        if r['producerStatus']=='generated': check(y is not None, 'Produced candidate outcome unavailable; complete fitting/evaluation refused')
        else: check(y is None,'Nonproduced attempt must not have outcome')

def preferred(r): return r['sourceValue'] * (1 if r['sourceDirection']=='higher-better' else -1)

def source_reason(rs):
    eligible=[r for r in rs if r['producerStatus']=='generated']
    if not eligible: return 'no-produced-candidates'
    if any(r['sourceValue'] is None for r in eligible): return 'produced-candidate-source-unavailable'
    return ''

def learned_reason(rs,family,support=None):
    eligible=[r for r in rs if r['producerStatus']=='generated']
    if source_reason(rs): return source_reason(rs)
    if any(r['profile']['scoreContext']!=PAIR_CONTEXT for r in eligible): return 'unsupported-score-context'
    if support is not None and any(r['profile'] not in support for r in eligible): return 'unsupported-producer-profile'
    if any(r['validityStatus']!='valid' for r in eligible): return 'invalid-or-unavailable-input'
    if any(r['features'][k] is None for r in eligible for k in names(family)): return 'optional-feature-unavailable'
    return ''

def eligible_group_ids(rows,groups,family):
    return {groups[rs[0]['setId']] for rs in by_pool(rows).values() if not learned_reason(rs,family)}

def validate_model(model):
    common={'schema','family','kind','featureNames','lambda','scales','coefficients','supportProfiles',
            'trainingIds','trainingGroups','excludedTrainingPools','inputDigest'}
    check(type(model) is dict and set(model)==common, 'Invalid model fields')
    check(model['schema']=='confovhh-small-linear-ranker-v1','Invalid model schema')
    check(model['featureNames']==list(names(model['family'])),'Model feature contract differs')
    check(model['kind'] in ('source','ridge'),'Invalid model kind')
    d=len(model['featureNames'])
    if model['kind']=='ridge':
        check(model['lambda'] in GRID and type(model['lambda']) is not bool, 'Unfrozen ridge setting')
        check(len(model['scales'])==len(model['coefficients'])==d,'Model dimension differs')
        check(all(finite(v) and v>0 for v in model['scales']) and all(finite(v) for v in model['coefficients']),'Invalid fitted scalar')
    else: check(model['lambda'] is None and not model['scales'] and not model['coefficients'],'Invalid source fallback model')
    check(type(model['supportProfiles']) is list and all(type(p) is dict and set(p)==PROFILE_KEYS for p in model['supportProfiles']),'Invalid model support')
    return model

def source_model(family,rows,groups):
    return {'schema':'confovhh-small-linear-ranker-v1','family':family,'kind':'source','featureNames':list(names(family)),
            'lambda':None,'scales':[],'coefficients':[],'supportProfiles':[],
            'trainingIds':sorted(r['id'] for r in rows),'trainingGroups':sorted(set(groups.values())),
            'excludedTrainingPools':{},'inputDigest':digest({'rows':rows,'groups':groups})}

def fit_ridge(rows,labels,groups,family,lam):
    validate_rows(rows); validate_groups(rows,groups); validate_labels(rows,labels)
    check(type(lam) is not bool and lam in GRID,'Unfrozen lambda')
    kept=[];excluded={}
    for pool,rs in by_pool(rows).items():
        reason=learned_reason(rs,family)
        if reason: excluded[pool]=reason
        else: kept.extend(rs)
    model=source_model(family,rows,groups);model['excludedTrainingPools']=excluded
    if not kept: return model
    weights=pool_weights(kept,subset_groups(kept,groups)); xx=[];yy=[];ww=[]
    for pool,rs in by_pool(kept).items():
        rs=[r for r in rs if r['producerStatus']=='generated']
        x=np.asarray([[r['features'][k] for k in names(family)] for r in rs],dtype=float)
        y=np.asarray([labels[r['id']] for r in rs],dtype=float)
        centered=x-x.mean(axis=0)
        # Identical IEEE values are scientifically constant even when mean()
        # rounds their decimal representation by one ulp (for example 0.1).
        centered[:,np.all(x==x[0],axis=0)]=0.0
        centered_y=np.zeros_like(y) if np.all(y==y[0]) else y-y.mean()
        xx.extend(centered); yy.extend(centered_y); ww.extend([weights[pool]/len(rs)]*len(rs))
    x=np.asarray(xx);y=np.asarray(yy);w=np.asarray(ww)
    scales=np.sqrt(np.sum(w[:,None]*x*x,axis=0));scales[scales==0]=1
    z=x/scales
    beta=np.linalg.solve(z.T@(w[:,None]*z)+lam*np.eye(z.shape[1]),z.T@(w*y))
    model.update(kind='ridge',**{'lambda':lam},scales=scales.tolist(),coefficients=beta.tolist(),
                 supportProfiles=json.loads(json.dumps(sorted({digest(r['profile']):r['profile'] for r in kept}.values(),key=digest))))
    model['inputDigest']=digest({'rows':rows,'labels':labels,'groups':groups,'family':family,'lambda':lam})
    return validate_model(model)

def rank(rows,model=None):
    validate_rows(rows)
    if model is not None: validate_model(model)
    output=[]
    for pool,rs in by_pool(rows).items():
        eligible=[r for r in rs if r['producerStatus']=='generated']; reason=source_reason(rs)
        mode='abstained' if reason else 'source'; learned_failure=''
        if not reason and model is not None and model['kind']=='ridge':
            learned_failure=learned_reason(rs,model['family'],model['supportProfiles'])
            if not learned_failure: mode='learned'
        scores={}
        if mode!='abstained':
            for r in eligible:
                scores[r['id']]=float(np.dot(np.asarray([r['features'][k] for k in model['featureNames']])/model['scales'],model['coefficients'])) if mode=='learned' else preferred(r)
                check(finite(scores[r['id']]), 'Nonfinite prediction')
        ranks={};start=1
        for score in sorted(set(scores.values()),reverse=True):
            ids=sorted(i for i,v in scores.items() if v==score)
            for i in ids:ranks[i]=(start,start+len(ids)-1)
            start+=len(ids)
        for r in rs:
            output.append({'id':r['id'],'poolId':pool,'setId':r['setId'],
                           'status':'not-produced' if r['producerStatus']!='generated' else mode,
                           'reason':r['producerStatus'] if r['producerStatus']!='generated' else reason or learned_failure,
                           'score':scores.get(r['id']),'rankMin':ranks.get(r['id'],(None,None))[0],
                           'rankMax':ranks.get(r['id'],(None,None))[1]})
    return sorted(output,key=lambda x:x['id'])

def evaluate(rows,labels,groups,ranks):
    validate_rows(rows);validate_labels(rows,labels);validate_groups(rows,groups)
    check(len(ranks)==len(rows) and {r['id'] for r in ranks}=={r['id'] for r in rows}, 'Rank membership differs')
    ranked={r['id']:r for r in ranks}; reports={};weights=pool_weights(rows,groups)
    for row in rows:
        q=ranked[row['id']]
        check(set(q)=={'id','poolId','setId','status','reason','score','rankMin','rankMax'} and q['poolId']==row['poolId'] and q['setId']==row['setId'],'Rank fields/identity differ')
        if row['producerStatus']!='generated':
            check(q['status']=='not-produced' and q['score'] is None and q['rankMin'] is None and q['rankMax'] is None,'Nonproduced row ranked')
        elif q['rankMin'] is None:
            check(q['status']=='abstained' and q['score'] is None and q['rankMax'] is None,'Malformed abstention')
        else:
            check(q['status'] in ('source','learned') and type(q['rankMin']) is int and type(q['rankMax']) is int and 1<=q['rankMin']<=q['rankMax'],'Invalid rank position')
    for pool,rs in by_pool(rows).items():
        eligible=[r for r in rs if r['producerStatus']=='generated']; n=len(eligible)
        available=bool(n) and all(ranked[r['id']]['rankMin'] is not None for r in eligible)
        p={'poolId':pool,'setId':rs[0]['setId'],'groupId':groups[rs[0]['setId']],
           'generationArm':rs[0]['generationArm'],'seedBatch':rs[0]['seedBatch'],
           'plannedCount':len(rs),'producedCount':n,'outcomeCount':n,'selectionAvailable':available,
           'rankingMode':ranked[eligible[0]['id']]['status'] if n else 'abstained',
           'firstDockQ':None,'firstAcceptableProbability':None,'top5MeanDockQ':None,'top5ExpectedAcceptableCount':None,'bestDockQ':max((labels[r['id']] for r in eligible),default=None),'bestCandidateGap':None}
        if available:
            # Require consistent occupied rank slots; ties are not ID tie breaks.
            by_score=defaultdict(list)
            for r in eligible:
                q=ranked[r['id']];check(q['poolId']==pool and q['setId']==r['setId'] and finite(q['score']),'Invalid rank identity/score')
                by_score[q['score']].append(q)
            pos=1
            for score in sorted(by_score,reverse=True):
                block=by_score[score]
                check(all(q['rankMin']==pos and q['rankMax']==pos+len(block)-1 for q in block),'Invalid scientific tie ranks');pos+=len(block)
            firstq=firsta=topq=topa=0.0;k=min(5,n)
            for r in eligible:
                q=ranked[r['id']];lo=q['rankMin'];hi=q['rankMax'];t=hi-lo+1;y=labels[r['id']]
                first=(1/t if lo==1 else 0);window=max(0,min(hi,k)-lo+1)/t
                firstq+=first*y;firsta+=first*(y>=.23);topq+=window*y/k;topa+=window*(y>=.23)
            p.update(firstDockQ=firstq,firstAcceptableProbability=firsta,top5MeanDockQ=topq,top5ExpectedAcceptableCount=topa,bestCandidateGap=p['bestDockQ']-firstq)
        reports[pool]=p
    complete=all(p['selectionAvailable'] for p in reports.values());aggregate={}
    for k in ('firstDockQ','firstAcceptableProbability','top5MeanDockQ','top5ExpectedAcceptableCount','bestCandidateGap'):
        aggregate[k]=sum(weights[pool]*p[k] for pool,p in reports.items()) if complete else None
    aggregate.update(plannedPools=len(reports),selectedPools=sum(p['selectionAvailable'] for p in reports.values()),
                     plannedAttempts=len(rows),producedCandidates=sum(r['producerStatus']=='generated' for r in rows),
                     biologicalGroups=len(set(groups.values())),complete=complete)
    return {'aggregate':aggregate,'pools':reports,'poolWeights':weights}

def compare(candidate,baseline):
    check(set(candidate['pools'])==set(baseline['pools']), 'Comparison pools differ')
    losses=[];rescues=[]
    for pool,p in candidate['pools'].items():
        b=baseline['pools'][pool]
        if p['firstAcceptableProbability'] is not None and b['firstAcceptableProbability'] is not None:
            if p['firstAcceptableProbability']<b['firstAcceptableProbability']: losses.append(pool)
            if p['firstAcceptableProbability']>b['firstAcceptableProbability']: rescues.append(pool)
    a=candidate['aggregate'];b=baseline['aggregate'];gain=None if a['firstDockQ'] is None or b['firstDockQ'] is None else a['firstDockQ']-b['firstDockQ']
    return {'firstDockQGain':gain,'acceptableLossPools':losses,'acceptableRescuePools':rescues,
            'coverageUnchanged':a['selectedPools']==b['selectedPools'],
            'exploratoryUsefulGainGatePassed':gain is not None and gain>=.02 and not losses and a['selectedPools']==b['selectedPools']}

def select_setting(rows,labels,groups,family):
    """Inner group-held-out choice. Held-out rows never enter scales or coefficients."""
    validate_rows(rows);validate_labels(rows,labels);validate_groups(rows,groups);names(family)
    supported_groups=sorted(eligible_group_ids(rows,groups,family))
    base=evaluate(rows,labels,groups,rank(rows))
    if len(supported_groups)<2: return None,{'reason':'insufficient-inner-supported-groups','candidates':[]}
    candidates=[]
    for lam in GRID:
        predicted=[];folds=[]
        for g in sorted(set(groups.values())):
            train=[r for r in rows if groups[r['setId']]!=g];test=[r for r in rows if groups[r['setId']]==g]
            model=fit_ridge(train,{r['id']:labels[r['id']] for r in train},subset_groups(train,groups),family,lam)
            predicted.extend(rank(test,model));folds.append({'heldOutGroup':g,'trainingGroups':model['trainingGroups'],'trainingIds':model['trainingIds'],'modelDigest':digest(model),'model':model})
        metric=evaluate(rows,labels,groups,predicted);comparison=compare(metric,base)
        candidates.append({'lambda':lam,'metrics':metric,'comparison':comparison,'folds':folds})
    # Source remains selected unless the held-out objective strictly improves.
    eligible=[c for c in candidates if c['comparison']['firstDockQGain'] is not None and c['comparison']['firstDockQGain']>0 and not c['comparison']['acceptableLossPools'] and c['comparison']['coverageUnchanged']]
    selected=max(eligible,key=lambda c:(c['metrics']['aggregate']['firstDockQ'],c['lambda']))['lambda'] if eligible else None
    return selected,{'reason':'source-selected' if selected is None else 'ridge-selected','candidates':candidates}

def nested_validate(rows,labels,groups,family):
    validate_rows(rows);validate_labels(rows,labels);validate_groups(rows,groups)
    supported_group_ids=eligible_group_ids(rows,groups,family)
    folds=[];all_ranks=[]
    for g in sorted(set(groups.values())):
        train=[r for r in rows if groups[r['setId']]!=g];test=[r for r in rows if groups[r['setId']]==g]
        tg=subset_groups(train,groups);tl={r['id']:labels[r['id']] for r in train}
        if len(supported_group_ids)<3: selected=None;selection={'reason':'insufficient-outer-supported-groups','candidates':[]}
        else: selected,selection=select_setting(train,tl,tg,family)
        model=source_model(family,train,tg) if selected is None else fit_ridge(train,tl,tg,family,selected)
        rr=rank(test,model);all_ranks.extend(rr)
        folds.append({'heldOutGroup':g,'selectedLambda':selected,'trainingGroups':sorted(set(tg.values())),
                      'selection':selection,'model':model,'heldOutIds':sorted(r['id'] for r in test)})
    all_metrics=evaluate(rows,labels,groups,all_ranks);base=evaluate(rows,labels,groups,rank(rows))
    supported=[r for r in rows if r['profile']['scoreContext']==PAIR_CONTEXT]; sg=subset_groups(supported,groups);sl={r['id']:labels[r['id']] for r in supported};ids={r['id'] for r in supported}
    sm=evaluate(supported,sl,sg,[r for r in all_ranks if r['id'] in ids]);sb=evaluate(supported,sl,sg,rank(supported))
    return {'schema':'confovhh-nested-development-ranking-v1','family':family,'folds':folds,'ranks':sorted(all_ranks,key=lambda x:x['id']),
            'allPlanned':all_metrics,'sourceBaseline':base,'allPlannedComparison':compare(all_metrics,base),
            'learnerSupported':sm,'learnerSupportedBaseline':sb,'learnerSupportedComparison':compare(sm,sb),
            'completeLearnerEligibleGroups':sorted(supported_group_ids),
            'claims':{'allDevelopmentExposed':True,'unbiasedEstimateOfFamilySelection':False,'reservedOutcomesRead':False}}
