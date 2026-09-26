"""Generalized, released round-4 DockQ evaluation using unchanged fixed segments.

Preparation/source ranks are prediction-only. Both development and reserved
outcomes require an explicit release tied to the saved ranking seal. No metric
call occurs in references/preflight/seal. All planned failed attempts survive.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode=True
import prepare_predictions as p

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
METRIC_SHA='7a9116e549a599bcf479676724fb9dc5b9dddc3e8d9eae6c5b46e7f46bbc35e7'
OLD_REFERENCES_SHA='a7b197c0393462809792f9cf00eef01231c32932d5c53b07f0c9375c30e796b0'
NEW_REFERENCES_SHA='059c34d0d30f3ba9663d2ec7a4502e409ff312aea9c6b1f356ab1f74be254fc0'
NEW_ENROLLMENT_SHA='f43d145a873d2ccf6aeae8407fabc4596584bea9a82d8402c29f6d5361f096cb'
REQUEST_KEYS={'schema','evaluationRole','preparationReceipt','sourceRankingReceipt','sourceRankingVerifier','referenceInventory','finalSelectionFreeze','challengerRanks'}
TIMEOUT=600
check=p.check

def metric(root):
    path=root/'round4-benchmark/explicit_mmcif_metric.py';check(p.sha(path.read_bytes())==METRIC_SHA,'Explicit mmCIF metric helper changed')
    return p.module(path,'round4_frozen_explicit_mmcif_metric')
def implementation(root):
    return {'adapterSha256':p.sha(Path(__file__).read_bytes()),'preparation':p.implementation(root),'metric':metric(root).implementation(root),'perViewTimeoutSeconds':TIMEOUT}
def exact(x,keys):check(type(x)is dict and set(x)==set(keys),'Unexpected/missing artifact fields')
def utc(value):
    check(type(value)is str,'UTC timestamp required')
    result=dt.datetime.fromisoformat(value.replace('Z','+00:00'));check(result.utcoffset()==dt.timedelta(0),'Timestamp must be UTC');return result
def finite(value):return type(value) in (int,float) and math.isfinite(value)
def sealed_rows(inventory):
    return [{'id':r['id'],'setId':r['setId'],'generationArm':r['generationArm'],'seedBatch':r['seedBatch'],'seed':r['seed'],'producerStatus':r['status'],
             'coordinate':r['canonicalCoordinate'],'map':r['canonicalMap'],'viewReceipt':r['viewReceipt'],'unavailableReason':r['unavailableReason']} for r in inventory['rows']]
def verify_failure_disposition(root,row):
    # The unchanged preparation verifier authenticates failure status and absence
    # of coordinates. Add exact failure-report authentication at this boundary.
    if row['status'] in ('failed','interrupted'):
        receipt=p.strict(p.bound(root,row['generationReceipt']))
        check(row['rawInputIntegrity'] is None and row['unavailableReason']==receipt.get('reason','') and type(row['unavailableReason'])is str and row['unavailableReason'],'Failure reporting differs from authenticated producer receipt')

def reference_spec(root):
    oldpath=root/'round3-benchmark/outcome-tools/reference-inventory.json';newpath=root/'round4-benchmark/reference-view-inventory.json';enrollpath=root/'round4-benchmark/ENROLLMENT.freeze.json'
    for path,h in [(oldpath,OLD_REFERENCES_SHA),(newpath,NEW_REFERENCES_SHA),(enrollpath,NEW_ENROLLMENT_SHA)]:check(p.sha(path.read_bytes())==h,'Fixed reference qualification changed')
    old=p.strict(oldpath.read_bytes());new=p.strict(newpath.read_bytes());enroll=p.strict(enrollpath.read_bytes());targets=[]
    for t in old['targets']:
        targets.append({k:t[k] for k in ['id','predictionReceptorChains','predictionSelectedNb','views']})
    def expand(b):return {**b,'path':'round4-benchmark/'+b['path']}
    for t in enroll['targets']:
        rows=[v for v in new['views'] if v['targetId']==t['id']]
        views=[{'id':v['id'],'originalAuthReceptorChains':v['receptorAuthOrder'],'originalAuthSelectedNb':v['selectedNbAuth'],'coordinate':expand(v['view']),'viewReceipt':expand(v['receipt'])} for v in rows]
        targets.append({'id':t['id'],'predictionReceptorChains':t['receptorChains'],'predictionSelectedNb':t['selectedNb'],'views':views})
    check(len({t['id'] for t in targets})==len(targets),'Repeated reference target')
    return {'schema':'confovhh-round4-outcome-reference-inventory-v1','sources':[p.bind(root,x) for x in [oldpath,newpath,enrollpath]],'predictionSelectedNbFixed':True,'targets':targets}

def verify_references(root,binding,targets):
    refs=p.strict(p.bound(root,binding));check(refs==reference_spec(root),'Reference inventory differs from fixed source inventories')
    _,auth=p.old_modules(root);out={}
    for target in targets:
        matches=[t for t in refs['targets'] if t['id']==target['id']];check(len(matches)==1,'Target lacks exactly one fixed reference definition');t=matches[0]
        check(t['predictionReceptorChains']==target['receptorChains'] and t['predictionSelectedNb']==target['selectedNb'],'Prediction/native role contract differs')
        expected=4 if len(target['receptorChains'])==2 else 1
        check(len(t['views'])==expected and len({v['id'] for v in t['views']})==expected,'Incomplete fixed reference assignment roster')
        out[t['id']]=[]
        for v in t['views']:
            verified=auth.verify_view(root,v['coordinate'],v['viewReceipt'],v['originalAuthReceptorChains'],v['originalAuthSelectedNb'],'auth')
            out[t['id']].append({'id':v['id'],'coordinate':verified['coordinate'],'map':verified['map'],'viewReceipt':v['viewReceipt'],'source':verified['source']})
    return out

def rank_module(root,path):
    folder=str(path.parent)
    if folder not in sys.path:sys.path.insert(0,folder)
    return p.module(path,'round4_bound_source_rank_verifier')

def verify_final_freeze(root,binding,cohort,inventory,challengers):
    check(binding is not None,'Reserved evaluation requires final policy freeze')
    f=p.strict(p.bound(root,binding))
    exact(f,['schema','frozenAtUtc','allowedModelBindings','allowedGenerationPlanSha256','reservedEnrollment'])
    check(f['schema']=='confovhh-round4-final-policy-freeze-v1','Invalid final policy freeze')
    check(cohort['generationPlan']['sha256'] in f['allowedGenerationPlanSha256'],'Reserved generation plan not allowed by final policy freeze')
    check(f['reservedEnrollment']['sha256']==NEW_ENROLLMENT_SHA,'Reserved enrollment differs from accepted fixed set');enrollment=p.strict(p.bound(root,f['reservedEnrollment']))
    check({r['setId'] for r in inventory['rows']}=={t['id'] for t in enrollment['targets']},'Reserved targets differ from accepted enrollment')
    plan=p.strict(p.bound(root,cohort['generationPlan']));enrolled={t['id']:t for t in enrollment['targets']}
    check({t['id'] for t in plan['targets']}==set(enrolled),'Reserved producer target roster differs')
    for t in plan['targets']:
        expected=enrolled[t['id']]
        check(all(t[k]==expected[k] for k in ('receptorChains','selectedNb','contextChains','context')),'Reserved role/context differs from exact enrollment')
        check(t['chainSequenceSha256']=={s['id']:s['sequenceSha256'] for s in expected['sequenceChains']},'Reserved construct differs from exact enrollment')
    check(type(f['allowedGenerationPlanSha256'])is list and len(set(f['allowedGenerationPlanSha256']))==len(f['allowedGenerationPlanSha256']),'Repeated allowed generation plan')
    frozen=utc(f['frozenAtUtc'])
    for row in inventory['rows']:
        if row['generationReceipt']:
            rec=p.strict(p.bound(root,row['generationReceipt']));started=utc(rec['startedUtc'])
            check(frozen<=started,'Reserved prediction preceded final policy freeze')
    check(type(f['allowedModelBindings'])is list,'Invalid final challenger model roster')
    for b in f['allowedModelBindings']:p.bound(root,b)
    check(len({b['sha256'] for b in f['allowedModelBindings']})==len(f['allowedModelBindings']),'Repeated frozen challenger model')
    supplied=[p.strict(p.bound(root,b))['modelBinding'] for b in challengers]
    check(all(type(b)is dict for b in supplied) and len({b['sha256'] for b in supplied})==len(supplied),'Repeated/missing supplied challenger model')
    check({p.packed(b) for b in supplied}=={p.packed(b) for b in f['allowedModelBindings']},'Reserved challenger roster differs from exact final policy')
    return f

def preflight(root,request):
    """Identity/sequence/ranking verification only; never computes DockQ."""
    exact(request,REQUEST_KEYS);role=request['evaluationRole']
    check(request['schema']=='confovhh-round4-outcome-request-v1' and role in ('development','reserved'),'Unsupported outcome request')
    p.bound(root,request['sourceRankingVerifier']);path=root/request['sourceRankingVerifier']['path']
    check(path==root/'round4-ranking/prepare_features.py','Unexpected source ranking verifier')
    verifier=rank_module(root,path);table,saved,rank_receipt=verifier.verify_source_seal(root,request['sourceRankingReceipt'])
    check(rank_receipt['preparationReceipt']==request['preparationReceipt'] and rank_receipt['snapshot'] is False,'Outcomes require final complete prediction preparation')
    check(table['evaluationRole']==rank_receipt['evaluationRole']==('development' if role=='development' else 'reserved-evaluation'),'Ranking/outcome role differs')
    inv,prep=p.verify_preparation(root,request['preparationReceipt'])
    check(inv['snapshot'] is False and inv['evaluationRole']==role,'Snapshot or different cohort cannot enter outcome evaluation')
    cohort,plan,targets,_,_=p.verify_cohort(root,inv['cohort']);check(cohort['evaluationRole']==role,'Cohort role differs')
    fm={r['id']:r for r in table['rows']};check(len(fm)==len(inv['rows']) and set(fm)=={r['id'] for r in inv['rows']},'Ranked/prepared membership differs')
    for row in inv['rows']:
        verify_failure_disposition(root,row)
        feature=fm[row['id']];coordinate=row['canonicalCoordinate']
        check(feature['coordinateSha256']==(coordinate['sha256'] if coordinate else None),'Ranked coordinate differs from authenticated canonical view')
        check((feature['setId'],feature['generationArm'],feature['seedBatch'])==(row['setId'],row['generationArm'],row['seedBatch']),'Ranked pool identity differs')
        expected_status='failed' if row['status']=='interrupted' else row['status'];check(feature['producerStatus']==expected_status,'Ranked production status differs')
    # Challenger ordering is independently replayed from its saved model/table.
    check(type(request['challengerRanks'])is list and len({b['sha256'] for b in request['challengerRanks']})==len(request['challengerRanks']),'Repeated challenger rank artifact')
    check(rank_receipt['implementation']['round4-ranking/ranker.py']==p.sha((root/'round4-ranking/ranker.py').read_bytes()),'Source ranking did not bind challenger replay implementation')
    ranker=p.module(root/'round4-ranking/ranker.py','round4_frozen_ranker_for_outcomes')
    for b in request['challengerRanks']:
        ranked=p.strict(p.bound(root,b));exact(ranked,['schema','predictionTableDigest','ranks','modelBinding','outcomeInputs'])
        check(ranked['schema']=='confovhh-round4-saved-ranks-v1' and ranked['outcomeInputs']==[] and ranked['predictionTableDigest']==ranker.digest(table),'Challenger table identity differs')
        check(ranked['modelBinding'] is not None,'Source belongs in sourceRankingReceipt, not challenger list')
        model=p.strict(p.bound(root,ranked['modelBinding']));check(ranked['ranks']==ranker.rank(table['rows'],model),'Saved challenger ranks differ from fixed model')
    if role=='reserved':verify_final_freeze(root,request['finalSelectionFreeze'],cohort,inv,request['challengerRanks'])
    else:check(request['finalSelectionFreeze'] is None,'Development does not use reserved final freeze')
    references=verify_references(root,request['referenceInventory'],list(targets.values()))
    rows=sealed_rows(inv)
    return {'role':role,'cohort':inv['cohort'],'rows':rows,'references':references,'sourceRankingReceipt':request['sourceRankingReceipt'],'challengerRanks':request['challengerRanks'],'preparationReceipt':request['preparationReceipt']}

def seal(root,request_path,output):
    request_binding=p.bind(root,request_path);request=p.strict(p.bound(root,request_binding));verified=preflight(root,request)
    result={'schema':'confovhh-round4-outcome-ranking-seal-v1','sealedAtUtc':p.now(),'evaluationRole':verified['role'],'cohort':verified['cohort'],'request':request_binding,
            'outcomesComputed':False,'implementation':implementation(root),'sourceRankingReceipt':verified['sourceRankingReceipt'],'challengerRanks':verified['challengerRanks'],
            'plannedIds':[r['id'] for r in verified['rows']],'rows':verified['rows'],'references':verified['references']}
    p.save(output,result);return p.bind(root,output)

def make_request(root,role,preparation_path,source_path,reference_path,final_path,challenger_paths,output):
    result={'schema':'confovhh-round4-outcome-request-v1','evaluationRole':role,
            'preparationReceipt':p.bind(root,preparation_path),'sourceRankingReceipt':p.bind(root,source_path),
            'sourceRankingVerifier':p.bind(root,root/'round4-ranking/prepare_features.py'),'referenceInventory':p.bind(root,reference_path),
            'finalSelectionFreeze':p.bind(root,final_path) if final_path else None,
            'challengerRanks':[p.bind(root,path) for path in challenger_paths]}
    preflight(root,result);p.save(output,result);return p.bind(root,output)

def validate_release(root,release_binding,seal_binding,sealed,started):
    release=p.strict(p.bound(root,release_binding));exact(release,['schema','evaluationRole','rankingSealSha256','cohortSha256','releasedAtUtc','authorizeOutcomeEvaluation'])
    check(release['schema']=='confovhh-round4-outcome-release-v1' and release['evaluationRole']==sealed['evaluationRole'] and release['authorizeOutcomeEvaluation'] is True,'Outcome evaluation has not been explicitly released')
    check(release['rankingSealSha256']==seal_binding['sha256'] and release['cohortSha256']==sealed['cohort']['sha256'],'Release belongs to another ranking seal/cohort')
    times=[utc(v) for v in [sealed['sealedAtUtc'],release['releasedAtUtc'],started]]
    check(times==sorted(times),'Outcome release chronology differs')

def verify_seal(root,seal_binding,release_binding=None):
    sealed=p.strict(p.bound(root,seal_binding));exact(sealed,['schema','sealedAtUtc','evaluationRole','cohort','request','outcomesComputed','implementation','sourceRankingReceipt','challengerRanks','plannedIds','rows','references'])
    check(sealed['schema']=='confovhh-round4-outcome-ranking-seal-v1' and sealed['outcomesComputed'] is False,'Invalid ranking seal')
    check(sealed['implementation']==implementation(root),'Sealed outcome implementation changed')
    request=p.strict(p.bound(root,sealed['request']));exact(request,REQUEST_KEYS)
    check(request['evaluationRole']==sealed['evaluationRole'] and request['sourceRankingReceipt']==sealed['sourceRankingReceipt'] and request['challengerRanks']==sealed['challengerRanks'],'Seal/request ranks differ')
    check(sealed['plannedIds']==[r['id'] for r in sealed['rows']] and len(set(sealed['plannedIds']))==len(sealed['plannedIds']),'Seal membership differs')
    prep=p.strict(p.bound(root,request['preparationReceipt']));inventory=p.strict(p.bound(root,prep['inventory']));cohort=p.strict(p.bound(root,sealed['cohort']))
    check(prep['snapshot'] is inventory['snapshot'] is False and sealed['evaluationRole']==inventory['evaluationRole'],'Seal used incomplete or different-role preparation')
    check(prep['cohort']==inventory['cohort']==sealed['cohort'] and sealed['rows']==sealed_rows(inventory) and sorted(sealed['plannedIds'])==cohort['plannedIds'],'Seal differs from bound preparation/cohort')
    if release_binding is not None:validate_release(root,release_binding,seal_binding,sealed,p.now())
    return sealed,request

def worker(root,job):
    exact(job,['id','referenceId','seal','release']);check(job['release'] is not None,'Metric workers require release')
    sealed,request=verify_seal(root,job['seal'],job['release'])
    matches=[r for r in sealed['rows'] if r['id']==job['id']];check(len(matches)==1,'Metric worker outside fixed cohort');row=matches[0]
    refs=[r for r in sealed['references'][row['setId']] if r['id']==job['referenceId']];check(len(refs)==1 and row['coordinate'] is not None,'Metric worker outside fixed reference assignments');ref=refs[0]
    for b in [row['coordinate'],row['map'],ref['coordinate'],ref['map']]:p.bound(root,b)
    return metric(root).dockq_api(root/row['coordinate']['path'],root/ref['coordinate']['path'],p.strict(p.bound(root,row['map'])),p.strict(p.bound(root,ref['map'])),execution_root=root)

def evaluate_pose(root,row,references,seal_binding,release_binding):
    _,old=p.old_modules(root);results=[]
    if row['coordinate'] is None:
        aggregate={'status':'unavailable','DockQ':None,'reason':row['unavailableReason'],'maximizingReferenceIds':[]}
    else:
        for ref in references:
            job={'id':row['id'],'referenceId':ref['id'],'seal':seal_binding,'release':release_binding}
            try:
                run=subprocess.run([sys.executable,str(Path(__file__).resolve()),'worker','--artifacts',str(root)],input=json.dumps(job),capture_output=True,text=True,timeout=TIMEOUT+10)
                check(run.returncode==0,'Metric worker failed: '+run.stderr[-2000:]);value=p.strict(run.stdout)
            except Exception as exc:value={'status':'unavailable','DockQ':None,'reason':str(exc)}
            results.append({'id':ref['id'],'referenceSha256':ref['coordinate']['sha256'],**value})
        aggregate=old.combine_views([r['id'] for r in references],results)
    identity={k:row[k] for k in ['id','setId','generationArm','seedBatch','seed','producerStatus']};identity['coordinateSha256']=row['coordinate']['sha256'] if row['coordinate'] else None
    return {'schema':'confovhh-round4-dockq-pose-artifact-v1',**identity,'fixedReferenceViews':[{'id':r['id'],'coordinateSha256':r['coordinate']['sha256'],'mapSha256':r['map']['sha256']} for r in references],
            'predictionSelectedNbFixed':True,'chainMap':{'R':'R','V':'V'},'results':results,**aggregate}

def verify_correspondence(root,model,ref,result):
    """Reparse and independently replay fixed-segment alignment, without DockQ."""
    exact(result,['id','referenceSha256','status','DockQ','metrics','correspondence','correspondenceSha256','contextChainsIgnored','coordinatesUnchanged'])
    check(finite(result['DockQ']) and 0<=result['DockQ']<=1 and result['contextChainsIgnored'] is True and result['coordinatesUnchanged'] is True,'Invalid per-view outcome or geometry claims')
    check(type(result['metrics'])is dict and result['metrics']['DockQ']==result['DockQ'] and all(not isinstance(v,float) or math.isfinite(v) for v in result['metrics'].values()),'Nonfinite/different raw DockQ metrics')
    helper=metric(root);_,old=p.old_modules(root)
    structures=[helper.load_explicit_mmcif(root/x['coordinate']['path'],['R','V']) for x in (model,ref)]
    mappings=[p.strict(p.bound(root,x['map'])) for x in (model,ref)];expected={}
    for role in ['R','V']:
        groups=[old.runtime_segments(s[role],m,role) for s,m in zip(structures,mappings)]
        _,expected[role]=old.aligned_segments(*groups)
    check(result['correspondence']==expected and result['correspondenceSha256']==p.sha(p.packed(expected)),'Saved fixed-segment correspondence did not independently replay')

def evaluate(root,seal_path,release_path,output,workers):
    seal_binding=p.bind(root,seal_path);release_binding=p.bind(root,release_path);sealed,request=verify_seal(root,seal_binding,release_binding);started=p.now()
    verified=preflight(root,request)
    check(sealed['rows']==verified['rows'] and sealed['references']==verified['references'] and sealed['cohort']==verified['cohort'],'Sealed inputs differ from current authenticated inputs')
    check(1<=workers<=8,'Worker count outside fixed operational range');check(not output.exists() and output.is_relative_to(HERE),'New output directory under round4-outcomes required')
    output.mkdir(parents=True);(output/'artifacts').mkdir();artifacts=[];rows=[]
    def call(row):return evaluate_pose(root,row,sealed['references'][row['setId']],seal_binding,release_binding)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for artifact in pool.map(call,sealed['rows']):
            path=output/'artifacts'/(artifact['id']+'.json');p.save(path,artifact);artifacts.append(p.bind(root,path))
            rows.append({k:artifact[k] for k in ['id','setId','generationArm','seedBatch','seed','producerStatus','coordinateSha256','status','DockQ','reason']})
            print(json.dumps({'completed':len(rows),'planned':len(sealed['rows']),'id':artifact['id'],'status':artifact['status']}),flush=True)
    outcome={'schema':'confovhh-round4-outcome-map-v1','evaluationRole':sealed['evaluationRole'],'cohort':sealed['cohort'],'rows':rows};p.save(output/'outcome-map.json',outcome)
    receipt={'schema':'confovhh-round4-outcome-receipt-v1','evaluationRole':sealed['evaluationRole'],'startedAtUtc':started,'finishedAtUtc':p.now(),'rankingSeal':seal_binding,'release':release_binding,
             'request':sealed['request'],'outcomeMap':p.bind(root,output/'outcome-map.json'),'artifacts':artifacts,'implementation':implementation(root),'plannedCount':len(rows),
             'evaluatedCount':sum(r['status']=='evaluated' for r in rows),'unavailableCount':sum(r['status']=='unavailable' for r in rows),'allPlannedIdsRetained':True,
             'dimerAggregation':'exact max across all four fixed native views; any failed view makes the pose unavailable','explicitReleaseChecked':True}
    p.save(output/'receipt.json',receipt);verify_evaluation(root,p.bind(root,output/'receipt.json'));return p.bind(root,output/'receipt.json')

def verify_evaluation(root,receipt_binding):
    receipt=p.strict(p.bound(root,receipt_binding));exact(receipt,['schema','evaluationRole','startedAtUtc','finishedAtUtc','rankingSeal','release','request','outcomeMap','artifacts','implementation','plannedCount','evaluatedCount','unavailableCount','allPlannedIdsRetained','dimerAggregation','explicitReleaseChecked'])
    check(receipt['schema']=='confovhh-round4-outcome-receipt-v1' and receipt['implementation']==implementation(root),'Outcome receipt/implementation differs')
    sealed,request=verify_seal(root,receipt['rankingSeal'],receipt['release']);verified=preflight(root,request)
    check(verified['rows']==sealed['rows'] and verified['references']==sealed['references'],'Current input authentication differs')
    validate_release(root,receipt['release'],receipt['rankingSeal'],sealed,receipt['startedAtUtc'])
    check(receipt['request']==sealed['request'] and receipt['allPlannedIdsRetained'] is True and receipt['explicitReleaseChecked'] is True and utc(receipt['startedAtUtc'])<=utc(receipt['finishedAtUtc']),'Outcome receipt scope/chronology differs')
    check(receipt['dimerAggregation']=='exact max across all four fixed native views; any failed view makes the pose unavailable','Dimer aggregation policy differs')
    outcome=p.strict(p.bound(root,receipt['outcomeMap']));exact(outcome,['schema','evaluationRole','cohort','rows'])
    check(outcome['schema']=='confovhh-round4-outcome-map-v1' and outcome['evaluationRole']==receipt['evaluationRole']==sealed['evaluationRole'] and outcome['cohort']==sealed['cohort'],'Outcome cohort/role differs')
    check([r['id'] for r in outcome['rows']]==sealed['plannedIds'] and len(receipt['artifacts'])==len(outcome['rows'])==receipt['plannedCount'],'Output membership differs')
    _,old=p.old_modules(root)
    for row,model,binding in zip(outcome['rows'],sealed['rows'],receipt['artifacts']):
        exact(row,['id','setId','generationArm','seedBatch','seed','producerStatus','coordinateSha256','status','DockQ','reason'])
        artifact=p.strict(p.bound(root,binding));exact(artifact,list(row)+['schema','fixedReferenceViews','predictionSelectedNbFixed','chainMap','results','maximizingReferenceIds'])
        check(artifact['schema']=='confovhh-round4-dockq-pose-artifact-v1' and all(artifact[k]==v for k,v in row.items()),'Map/artifact differs')
        check(all(row[k]==model[k] for k in ['id','setId','generationArm','seedBatch','seed','producerStatus']),'Outcome identity differs')
        check(row['coordinateSha256']==(model['coordinate']['sha256'] if model['coordinate'] else None),'Outcome coordinate differs')
        refs=sealed['references'][row['setId']];descriptors=[{'id':r['id'],'coordinateSha256':r['coordinate']['sha256'],'mapSha256':r['map']['sha256']} for r in refs]
        check(artifact['fixedReferenceViews']==descriptors and artifact['predictionSelectedNbFixed'] is True and artifact['chainMap']=={'R':'R','V':'V'},'Fixed reference assignment differs')
        if model['coordinate'] is None:
            check(artifact['results']==[] and artifact['maximizingReferenceIds']==[] and row['status']=='unavailable' and row['DockQ'] is None and row['reason']==model['unavailableReason'] and row['reason'],'Unavailable prediction silently became an outcome')
        else:
            aggregate=old.combine_views([r['id'] for r in refs],artifact['results'])
            check(all(artifact[k]==v for k,v in aggregate.items()),'Fixed-view aggregate differs')
            for result,ref in zip(artifact['results'],refs):
                check(result['referenceSha256']==ref['coordinate']['sha256'],'Per-view reference differs')
                if result['status']=='evaluated':
                    verify_correspondence(root,model,ref,result)
                else:
                    exact(result,['id','referenceSha256','status','DockQ','reason']);check(result['status']=='unavailable' and result['DockQ'] is None and type(result['reason'])is str and result['reason'],'Unknown/silent per-view failure')
    check(receipt['evaluatedCount']==sum(r['status']=='evaluated' for r in outcome['rows']) and receipt['unavailableCount']==sum(r['status']=='unavailable' for r in outcome['rows']),'Outcome disposition totals differ')
    return outcome,receipt

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['references','request','preflight','seal','worker','evaluate','verify']);ap.add_argument('--artifacts',type=Path,default=ROOT);ap.add_argument('--request',type=Path);ap.add_argument('--seal',type=Path);ap.add_argument('--release',type=Path);ap.add_argument('--receipt',type=Path);ap.add_argument('--output',type=Path);ap.add_argument('--workers',type=int,default=4)
    ap.add_argument('--role',choices=['development','reserved']);ap.add_argument('--preparation',type=Path);ap.add_argument('--source-ranking',type=Path);ap.add_argument('--references',type=Path);ap.add_argument('--final-policy',type=Path);ap.add_argument('--challenger-ranks',type=Path,action='append',default=[]);args=ap.parse_args();root=args.artifacts.resolve()
    if args.command=='references':p.save(args.output.resolve(),reference_spec(root));print(json.dumps(p.bind(root,args.output.resolve())))
    elif args.command=='request':print(json.dumps(make_request(root,args.role,args.preparation.resolve(),args.source_ranking.resolve(),args.references.resolve(),args.final_policy.resolve() if args.final_policy else None,[x.resolve() for x in args.challenger_ranks],args.output.resolve())))
    elif args.command=='preflight':
        v=preflight(root,p.strict(args.request.read_bytes()));print(json.dumps({'status':'PASS','planned':len(v['rows']),'role':v['role']}))
    elif args.command=='seal':print(json.dumps(seal(root,args.request.resolve(),args.output.resolve())))
    elif args.command=='worker':print(json.dumps(worker(root,p.strict(sys.stdin.read())),allow_nan=False))
    elif args.command=='evaluate':print(json.dumps(evaluate(root,args.seal.resolve(),args.release.resolve(),args.output.resolve(),args.workers)))
    else:
        o,r=verify_evaluation(root,p.bind(root,args.receipt.resolve()));print(json.dumps({'status':'PASS','planned':len(o['rows']),'evaluated':r['evaluatedCount']}))

if __name__=='__main__':main()
