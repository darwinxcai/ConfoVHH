"""Frozen new-900 generation comparison; pure analysis plus release-gated I/O."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import numpy as np
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
ARMS=('baseline','broader','msa1024')
THRESHOLD=Fraction(23,100)
MIN_GAIN=Fraction(1,50)
BOOTSTRAP_SEED=20260925
BOOTSTRAP_RESAMPLES=10000
FREEZE_FILES=(
    'round4-analysis/analyze_generation.py','round4-analysis/test_analyze_generation.py','round4-analysis/README.md',
    'round4-planning/ANALYSIS-DECISIONS.md','round4-planning/ANALYSIS-DECISIONS-FREEZE.json',
    'round4-ranking/ranker.py','round4-ranking/prepare_features.py','round4-ranking/artifacts.py',
    'round4-ranking/contact_features.mjs','round4-ranking/IMPLEMENTATION-FREEZE-V2.json','round4-ranking/FEATURE-ADAPTER-FREEZE.json',
    'round4-outcomes/outcome_adapter.py','round4-outcomes/prepare_predictions.py',
    'round4-benchmark/explicit_mmcif_metric.py','round3-control/prepare_prediction_scoring.py',
    'round3-benchmark/scoring-view/canonicalize_view.py','round3-benchmark/outcome-tools/outcome_adapter.py',
    'ConfoVHH/scripts/external-ranking-v3/contact-only.mjs','ConfoVHH/scripts/external-ranking-v3/policy.mjs',
    'ConfoVHH/scripts/hard-decoy/oracle/canonical-json.mjs','ConfoVHH/validation/prospective-benchmark-v1/engine-lock.json',
    'round4-generation/bundle/run_batch.py','round4-generation/bundle/GENERATION-FREEZE.json')

def check(v,message):
    if not v:raise ValueError(message)
def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
ranker=module(ROOT/'round4-ranking/ranker.py','round4_generation_pinned_ranker')
def rational(value):return Fraction(str(value))
def mean(values):
    return sum(values,Fraction())/len(values) if values and all(v is not None for v in values) else None
def serialized(value):
    if isinstance(value,Fraction):return float(value)
    if isinstance(value,dict):return {k:serialized(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [serialized(v) for v in value]
    return value
def source_pool(rows,labels,ranks,timings):
    produced=[r for r in rows if r['producerStatus']=='generated'];n=len(produced);planned=len(rows)
    evaluable=[r for r in produced if labels[r['id']] is not None]
    outcomes_complete=len(evaluable)==n
    qs={r['id']:rational(labels[r['id']]) for r in evaluable}
    acceptable=sum(q>=THRESHOLD for q in qs.values())
    available=bool(n) and all(ranks[r['id']]['rankMin'] is not None for r in produced)
    best=max(qs.values(),default=None)
    counts=Counter(r['producerStatus'] for r in rows)
    elapsed=[timings[r['id']] for r in rows if r['producerStatus']!='not-run']
    p=dict(plannedCount=planned,attemptedCount=counts['generated']+counts['failed'],generatedCount=n,
           failedCount=counts['failed'],notRunCount=counts['not-run'],
           validCount=sum(r['validityStatus']=='valid' for r in produced),evaluableCount=len(evaluable),
           unavailableOutcomeCount=n-len(evaluable),outcomesComplete=outcomes_complete,
           knownAcceptableCount=acceptable,
           acceptableAvailable=True if acceptable else False if outcomes_complete else None,
           acceptablePerPlanned=Fraction(acceptable,planned) if outcomes_complete else None,
           acceptablePerPlannedBounds=[Fraction(acceptable,planned),Fraction(acceptable+n-len(evaluable),planned)],
           bestAvailableDockQ=best,bestCompleteDockQ=best if outcomes_complete else None,
           selectionAvailable=available,firstDockQ=None,firstAcceptableProbability=None,
           top5MeanDockQ=None,top5ExpectedAcceptableCount=None,top5SlotCount=min(5,n),
           bestCandidateGap=None,availableBestCandidateGap=None,
           elapsedSecondsKnown=sum((rational(x) for x in elapsed if x is not None),Fraction()),
           elapsedSecondsComplete=None if any(x is None for x in elapsed) else sum((rational(x) for x in elapsed),Fraction()),
           elapsedAttemptsKnown=sum(x is not None for x in elapsed))
    if available:
        first=[r for r in produced if ranks[r['id']]['rankMin']==1]
        top=[r for r in produced if ranks[r['id']]['rankMin']<=min(5,n)]
        if all(r['id'] in qs for r in first):
            p['firstDockQ']=mean([qs[r['id']] for r in first])
            p['firstAcceptableProbability']=Fraction(sum(qs[r['id']]>=THRESHOLD for r in first),len(first))
            p['availableBestCandidateGap']=best-p['firstDockQ']
            if outcomes_complete:p['bestCandidateGap']=p['availableBestCandidateGap']
        if all(r['id'] in qs for r in top):
            qsum=asum=Fraction();k=min(5,n)
            for r in top:
                z=ranks[r['id']];w=Fraction(min(z['rankMax'],k)-z['rankMin']+1,z['rankMax']-z['rankMin']+1)
                qsum+=w*qs[r['id']];asum+=w*(qs[r['id']]>=THRESHOLD)
            p['top5MeanDockQ']=qsum/k;p['top5ExpectedAcceptableCount']=asum
    return p

METRICS=('acceptablePerPlanned','bestAvailableDockQ','bestCompleteDockQ','firstDockQ',
         'firstAcceptableProbability','top5MeanDockQ','top5ExpectedAcceptableCount','bestCandidateGap')
def group_metrics(pools):
    tree=defaultdict(list)
    for p in pools:tree[p['biologicalGroupId']].append(p)
    # Every arm/scope contains exactly one seed batch per target, verified upstream.
    return {g:{k:mean([p[k] for p in pp]) for k in METRICS} for g,pp in sorted(tree.items())}
def aggregate(pools):
    gm=group_metrics(pools)
    result={k:mean([m[k] for m in gm.values()]) for k in METRICS}
    countkeys=('plannedCount','attemptedCount','generatedCount','failedCount','notRunCount','validCount','evaluableCount','unavailableOutcomeCount','knownAcceptableCount','elapsedAttemptsKnown')
    result.update({k:sum(p[k] for p in pools) for k in countkeys})
    result.update(biologicalGroupCount=len(gm),poolCount=len(pools),selectedPoolCount=sum(p['selectionAvailable'] for p in pools),
                  acceptableAvailablePoolCount=sum(p['acceptableAvailable'] is True for p in pools),
                  acceptableAvailabilityUnknownPoolCount=sum(p['acceptableAvailable'] is None for p in pools),
                  outcomesComplete=all(p['outcomesComplete'] for p in pools),
                  elapsedSecondsKnown=sum((p['elapsedSecondsKnown'] for p in pools),Fraction()),
                  elapsedSecondsComplete=sum((p['elapsedSecondsComplete'] for p in pools),Fraction()) if all(p['elapsedSecondsComplete'] is not None for p in pools) else None)
    return dict(aggregate=result,biologicalGroups=gm,weighting='equal biological group, then equal target within group')

def bootstrap(differences):
    missing=[g for g,v in differences.items() if v is None]
    if missing or len(differences)<2:return dict(status='unavailable',reason='incomplete group metrics' if missing else 'fewer than two groups',missingGroups=missing)
    ordered=sorted(differences);values=np.array([float(differences[g]) for g in ordered],dtype=float)
    rng=np.random.Generator(np.random.PCG64(BOOTSTRAP_SEED))
    indices=rng.integers(0,len(ordered),size=(BOOTSTRAP_RESAMPLES,len(ordered)),dtype=np.int64)
    samples=values[indices].mean(axis=1);low,high=np.quantile(samples,[.025,.975],method='linear')
    return dict(status='descriptive',confidence=.95,percentileInterval=[float(low),float(high)],resamples=BOOTSTRAP_RESAMPLES,
                rng='numpy.random.PCG64',seed=BOOTSTRAP_SEED,resamplingUnit='whole biological group',
                groups=ordered,drawIndicesSha256=hashlib.sha256(indices.astype('<i8').tobytes()).hexdigest())

def compare(candidate,baseline):
    check(set(candidate)==set(baseline),'Comparison target membership differs')
    first_deltas={};losses=[];increases=[];coverage=[]
    for tid,p in candidate.items():
        b=baseline[tid]
        if p['selectionAvailable']!=b['selectionAvailable']:coverage.append(tid)
        if p['firstAcceptableProbability'] is not None and b['firstAcceptableProbability'] is not None:
            d=p['firstAcceptableProbability']-b['firstAcceptableProbability']
            if d<0:losses.append(dict(setId=tid,decrease=-d))
            if d>0:increases.append(dict(setId=tid,increase=d))
        first_deltas[tid]={k:(p[k]-b[k] if p[k] is not None and b[k] is not None else None) for k in METRICS}
    ca=aggregate(list(candidate.values()));ba=aggregate(list(baseline.values()))
    group_deltas={g:{k:(ca['biologicalGroups'][g][k]-ba['biologicalGroups'][g][k] if ca['biologicalGroups'][g][k] is not None and ba['biologicalGroups'][g][k] is not None else None) for k in METRICS} for g in ca['biologicalGroups']}
    metrics={k:mean([x[k] for x in group_deltas.values()]) for k in METRICS}
    return dict(equalGroupMeanDifference=metrics,perTargetDifferences=first_deltas,perGroupDifferences=group_deltas,
                acceptableFirstProbabilityDecreases=losses,acceptableFirstProbabilityIncreases=increases,
                selectionCoverageUnchanged=not coverage,coverageChangedTargets=coverage,
                allGeneratedOutcomesAvailable=ca['aggregate']['outcomesComplete'] and ba['aggregate']['outcomesComplete'],
                descriptiveBootstrap={k:bootstrap({g:x[k] for g,x in group_deltas.items()}) for k in METRICS})

def validate(rows,labels,saved_ranks,grouping,plan,timings):
    ranker.validate_rows(rows)
    check([a['id'] for a in plan['arms']]==list(ARMS),'Fixed three-arm order changed')
    check(len(rows)==len(plan['jobs'])==plan['plannedAttempts']==900,'New 900 attempts required; old 300 cannot be pooled')
    check(plan['evaluationRole']=='development' and plan['settings']['seeds']==list(range(25,50)),'Wrong generation role/seed batch')
    jobs={j['jobId']:j for j in plan['jobs']};check(len(jobs)==900,'Duplicate planned job')
    ids={r['id'] for r in rows};check(ids==set(jobs)==set(labels)==set(timings),'Attempt/label/timing membership differs')
    check(saved_ranks==ranker.rank(rows),'Saved source ranks differ from unchanged source policy')
    groups={s['setId']:s for s in grouping['sets']}
    check(len(groups)==12 and {r['setId'] for r in rows}==set(groups),'Grouping/target coverage differs')
    check(len({g['biologicalGroupId'] for g in groups.values()})==11,'Qualified group count changed')
    check(sum(g['learnerEligibleContext'] for g in groups.values())==9 and len({g['biologicalGroupId'] for g in groups.values() if g['learnerEligibleContext']})==8,'Pair scope changed')
    check(len({r['seedBatch'] for r in rows})==1,'Multiple seed batches forbidden')
    cells=Counter()
    for r in rows:
        j=jobs[r['id']];check((r['setId'],r['generationArm'])==(j['targetId'],j['armId']),'Planned row arm/target differs')
        check(j['seed'] in range(25,50),'Unexpected seed')
        check(r['poolId']==r['setId']+'::'+r['generationArm']+'::'+r['seedBatch'],'Pool identity changed')
        cells[(r['setId'],r['generationArm'])]+=1
        y=labels[r['id']];check(y is None or (ranker.finite(y) and 0<=y<=1),'Invalid outcome')
        if r['producerStatus']!='generated':check(y is None,'Nonproduced attempt cannot have outcome')
        tm=timings[r['id']];check(tm is None or (ranker.finite(tm) and tm>=0),'Invalid elapsed time')
        if r['producerStatus']=='not-run':check(tm is None,'Not-run attempt has runtime')
    check(set(cells)=={(t,a) for t in groups for a in ARMS} and set(cells.values())=={25},'Not every target/arm has 25 attempts')
    return groups

def analyze(rows,labels,saved_ranks,grouping,plan,timings):
    groups=validate(rows,labels,saved_ranks,grouping,plan,timings);ranks={r['id']:r for r in saved_ranks}
    pools=[]
    for pool,rr in ranker.by_pool(rows).items():
        t=groups[rr[0]['setId']];p=source_pool(rr,labels,ranks,timings)
        p.update(poolId=pool,setId=t['setId'],biologicalGroupId=t['biologicalGroupId'],context=t['context'],learnerEligibleContext=t['learnerEligibleContext'],generationArm=rr[0]['generationArm'],seedBatch=rr[0]['seedBatch'])
        pools.append(p)
    scopes={'primary-pair':lambda p:p['learnerEligibleContext'],'all-contexts':lambda p:True,
            'full-dimer-context':lambda p:p['context']=='two-receptors-two-Nbs',
            'helix-context':lambda p:p['context']=='receptor-Nb-G11-helix',
            'CASR-exploratory':lambda p:p['setId']=='CASR_NB2D11',
            'dimer-without-CASR':lambda p:p['context']=='two-receptors-two-Nbs' and p['setId']!='CASR_NB2D11'}
    reports={}
    for name,predicate in scopes.items():
        arms={a:{p['setId']:p for p in pools if p['generationArm']==a and predicate(p)} for a in ARMS}
        reports[name]=dict(arms={a:aggregate(list(pp.values())) for a,pp in arms.items()},
                           comparisons={a:compare(arms[a],arms['baseline']) for a in ARMS[1:]})
    primary=reports['primary-pair']['comparisons'];gates={}
    for a,c in primary.items():
        gain=c['equalGroupMeanDifference']['firstDockQ']
        checks=dict(usefulGain=gain is not None and gain>=MIN_GAIN,noAcceptableFirstLoss=not c['acceptableFirstProbabilityDecreases'],
                    selectionCoverageUnchanged=c['selectionCoverageUnchanged'],allGeneratedOutcomesAvailable=c['allGeneratedOutcomesAvailable'])
        gates[a]=dict(passes=all(checks.values()),checks=checks,meanFirstDockQGain=gain)
    passed=[a for a in ARMS[1:] if gates[a]['passes']]
    selected=max(passed,key=lambda a:(gates[a]['meanFirstDockQGain'],-ARMS.index(a))) if passed else 'baseline'
    result=dict(schema='confovhh-round4-generation-comparison-v1',analysisRole='exploratory-development-new-900-only',
                plannedAttempts=900,old300Included=False,pools=pools,scopes=reports,
                pairGenerationDecision=dict(selectedArm=selected,candidates=gates,scope='primary-pair only; other contexts retain baseline',
                    gate='equal-group first DockQ gain >=0.02; no acceptable-first probability loss in any pair target; unchanged coverage; complete generated outcomes',
                    exactObjectiveTiePreference=list(ARMS),productionPromotion=False),
                missingness='No missing DockQ is zero-filled. Available best uses evaluable candidates only; complete-best/gap require complete produced outcomes. A selected tie block must be fully labeled. Incomplete decision comparisons fail the gate.',
                methods=dict(acceptableThreshold='0.23',decisionArithmetic='exact fractions of serialized decimal values; exact rational tie probabilities; convert to float only for output',bootstrap='95% percentile linear quantile, PCG64 seed20260925, 10000 whole-group paired resamples; no pose/arm resampling',timing='sum actual recorded per-attempt wall time; missing timing remains explicit; not GPU-only runtime or serial elapsed makespan'),
                noGeneralSuperiorityClaim=True)
    return serialized(result)

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def strict(path):
    def pairs(items):
        d={}
        for k,v in items:check(k not in d,'Duplicate JSON key');d[k]=v
        return d
    def reject(x):raise ValueError('Nonfinite JSON constant')
    return json.loads(Path(path).read_text(),object_pairs_hook=pairs,parse_constant=reject)
def binding(path,root=ROOT):
    p=Path(path);return dict(path=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=sha(p))
def bound(root,b):
    check(type(b)is dict and set(b)=={'path','bytes','sha256'},'Bad file binding')
    rel=b['path'];check(type(rel)is str and rel and not Path(rel).is_absolute() and '..' not in Path(rel).parts and '\\' not in rel,'Unsafe file path')
    p=root/rel;check(p.resolve()==p and p.is_file() and not p.is_symlink(),'Indirect/missing file')
    check(type(b['bytes'])is int and p.stat().st_size==b['bytes'] and sha(p)==b['sha256'],'Artifact changed: '+rel);return p
def validate_release(root,release):
    keys={'schema','evaluationRole','authorizeNewDevelopmentAnalysis','analysisFreeze','sourceRankingReceipt','outcomeReceipt','generationPlan','grouping'}
    check(set(release)==keys and release['schema']=='confovhh-round4-generation-analysis-release-v1','Wrong analysis release')
    check(release['evaluationRole']=='development' and release['authorizeNewDevelopmentAnalysis'] is True,'New-label analysis not authorized')
    # Verify method and scope before opening any prediction or outcome artifact.
    freeze_path=bound(root,release['analysisFreeze']);check(freeze_path==HERE/'ANALYZER-FREEZE.json','Wrong analyzer freeze path')
    freeze=strict(freeze_path);check(freeze['schema']=='confovhh-round4-generation-analyzer-freeze-v1' and freeze['newLabelsReadAtFreeze'] is False,'Wrong method freeze')
    check(len(freeze['files'])==len(FREEZE_FILES) and {b['path'] for b in freeze['files']}==set(FREEZE_FILES),'Incomplete or unexpected method binding roster')
    for b in freeze['files']:bound(root,b)
    check(freeze['numpyVersion']==np.__version__,'Bootstrap NumPy runtime differs')
    check(release['generationPlan']==freeze['generationPlan'] and release['grouping']==freeze['grouping'],'Frozen panel binding differs')
    check(freeze['generationPlan']['path']=='round4-generation/bundle/batch-plan.json' and freeze['grouping']['path']=='round4-benchmark/development-group-map.json','Wrong fixed panel/group map path')
    return freeze

def join_outcomes(prediction_rows,prepared_rows,outcome_rows):
    pred={r['id']:r for r in prediction_rows};prepared={r['id']:r for r in prepared_rows}
    check(len(pred)==len(prediction_rows)==len(prepared)==len(prepared_rows)==len(outcome_rows)==900,'Prepared/outcome attempt membership differs')
    check({r['id'] for r in outcome_rows}==set(pred)==set(prepared),'Outcome attempt IDs differ')
    labels={}
    for q in outcome_rows:
        r=pred[q['id']];p=prepared[q['id']]
        check(all(q[k]==r[k] for k in ['id','setId','generationArm','seedBatch','coordinateSha256']),'Outcome/prediction identity mismatch')
        check(q['seed']==p['seed'] and q['producerStatus']==p['status'],'Outcome/preparation attempt mismatch')
        check(('failed' if q['producerStatus']=='interrupted' else q['producerStatus'])==r['producerStatus'],'Producer status normalization differs')
        check(q['status'] in ('evaluated','unavailable') and ((q['DockQ'] is not None)==(q['status']=='evaluated')),'Outcome status/value mismatch')
        labels[q['id']]=q['DockQ']
    return labels

def execute(release_path,output):
    root=ROOT.resolve();release_path=Path(release_path).resolve();output=Path(output).resolve()
    check(release_path.is_relative_to(HERE) and output.is_relative_to(HERE) and not output.exists(),'Release/output must be under round4-analysis; output must be new')
    release=strict(release_path);freeze=validate_release(root,release)
    plan=strict(bound(root,release['generationPlan']));grouping=strict(bound(root,release['grouping']))
    for d in ['round4-ranking','round4-outcomes']:sys.path.insert(0,str(root/d))
    features=module(root/'round4-ranking/prepare_features.py','generation_analysis_features')
    outcome_adapter=module(root/'round4-outcomes/outcome_adapter.py','generation_analysis_outcomes')
    table,saved,source=features.verify_source_seal(root,release['sourceRankingReceipt'])
    check(source['snapshot'] is False and source['plannedCount']==900 and source['evaluationRole']=='development','Final complete new900 source seal required')
    check(table['origin']=='round4-frozen-generation-plan' and table['groupingBinding']==release['grouping'],'Wrong table origin/grouping')
    prep=features.prep_module(root);inventory,pr=prep.verify_preparation(root,source['preparationReceipt'])
    cohort,verified_plan,targets,sequences,runner=prep.verify_cohort(root,inventory['cohort'])
    check(cohort['generationPlan']==release['generationPlan'] and cohort['evaluationRole']=='development','Cohort plan/role differs')
    outcome,or_=outcome_adapter.verify_evaluation(root,release['outcomeReceipt'])
    check(outcome['evaluationRole']=='development' and outcome['cohort']==inventory['cohort'],'Outcome/source cohort differs')
    request=strict(bound(root,or_['request']))
    check(request['sourceRankingReceipt']==release['sourceRankingReceipt'] and request['preparationReceipt']==source['preparationReceipt'],'Outcome source/preparation seal differs')
    labels=join_outcomes(table['rows'],inventory['rows'],outcome['rows']);timings={};timing_bindings=[]
    for p in inventory['rows']:
        ident=p['id']
        if p['generationReceipt'] is None:timings[ident]=None
        else:
            rec=strict(bound(root,p['generationReceipt']));check(rec['jobId']==ident,'Timing attempt differs')
            elapsed=rec.get('elapsedSeconds');check(rec.get('elapsed_seconds',elapsed)==elapsed,'Timing aliases differ')
            timings[ident]=elapsed;timing_bindings.append(p['generationReceipt'])
    result=analyze(table['rows'],labels,saved['ranks'],grouping,plan,timings)
    output.mkdir(parents=True)
    for name,value in [('comparison.json',result),('timing-bindings.json',timing_bindings)]:
        with (output/name).open('x') as f:json.dump(value,f,indent=2,allow_nan=False);f.write('\n')
    (output/'REPORT.md').write_text(render_report(result))
    receipt=dict(schema='confovhh-round4-generation-analysis-receipt-v1',status='COMPLETE',release=binding(release_path),
        analysisFreeze=release['analysisFreeze'],sourceRankingReceipt=release['sourceRankingReceipt'],outcomeReceipt=release['outcomeReceipt'],
        generationPlan=release['generationPlan'],grouping=release['grouping'],files=[binding(output/f) for f in ['comparison.json','timing-bindings.json','REPORT.md']],
        planned=900,old300Included=False,reservedOutcomesRead=False,sourceRanksRecomputedAndVerified=True,outcomesAuthenticated=True)
    with (output/'receipt.json').open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
    return binding(output/'receipt.json')

def render_report(result):
    def number(v):return 'unavailable' if v is None else f'{v:.4f}'
    scope=result['scopes']['primary-pair'];decision=result['pairGenerationDecision']
    lines=['# New 900-attempt generation comparison','',
        'This exploratory comparison uses the newly generated seed batch only: twelve cases, three arms, and 25 planned attempts per case and arm. The earlier 300 predictions are excluded.',
        '',f"The prespecified pair-context gate retains/selects **{decision['selectedArm']}**. The primary nine cases represent eight qualified biological groups. Other contexts retain baseline. This is not a general superiority or production-promotion claim.",'',
        '| Arm | Generated / planned | Valid | Evaluable | First-choice DockQ | Acceptable-first probability | Best available DockQ |',
        '|---|---:|---:|---:|---:|---:|---:|']
    for arm in ARMS:
        x=scope['arms'][arm]['aggregate'];lines.append(f"| {arm} | {x['generatedCount']} / {x['plannedCount']} | {x['validCount']} | {x['evaluableCount']} | {number(x['firstDockQ'])} | {number(x['firstAcceptableProbability'])} | {number(x['bestAvailableDockQ'])} |")
    lines+=['','Means give equal weight to biological groups and then to target cases within each group. Scientific score ties are averaged. Detailed JSON retains all 36 pools, every group difference, first/top-five summaries, best-candidate gaps, failures, missing outcomes, wall-time completeness, and descriptive whole-group bootstrap intervals.',
        '','| Alternative | First-choice gain | Acceptable-first losses | Coverage unchanged | Complete outcomes | Passes gate |',
        '|---|---:|---:|---|---|---|']
    for arm in ARMS[1:]:
        x=scope['comparisons'][arm];g=decision['candidates'][arm]
        lines.append(f"| {arm} | {number(g['meanFirstDockQGain'])} | {len(x['acceptableFirstProbabilityDecreases'])} | {x['selectionCoverageUnchanged']} | {x['allGeneratedOutcomesAvailable']} | {g['passes']} |")
    lines+=['','Full-context, helix, dimer, dimer-without-CASR, and low-resolution exploratory CASR results are reported separately in comparison.json. No missing quality value is replaced with zero. Available best describes only evaluated candidates. One additional reserved learner-eligible group will remain insufficient for a broad superiority claim.','']
    return '\n'.join(lines)

def main():
    p=argparse.ArgumentParser();p.add_argument('--release',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    print(json.dumps(execute(a.release,a.output)))
if __name__=='__main__':main()
