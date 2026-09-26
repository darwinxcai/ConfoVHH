"""General round-4 prediction preparation; never opens native/outcome inputs.

The cohort binds its complete producer plan, rather than hardcoding a row count.
Round-3 canonicalization and full-input geometry checks are reused unchanged.
"""
from __future__ import annotations
import argparse
from collections import Counter
import datetime as dt
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
sys.dont_write_bytecode=True

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
OLD_PREP_SHA='c921848f7bec359e503b7b4433d66e0a5adf3b1d9abab807691c334b703655e5'
CANON_SHA='bcb509b7b77b058273254c09b7264d2716e0bd5e4d6506a30d41d6b6e1cc357c'
OLD_AUTH_SHA='0cc2694df73934935f4ffd0d371f90ff5417d0127c306279241e3996c9b55562'

def check(v,m):
    if not v:raise ValueError(m)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def packed(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def strict(raw):
    def pairs(items):
        d={}
        for k,v in items:check(k not in d,'Duplicate JSON field');d[k]=v
        return d
    def reject(v):raise ValueError('Nonfinite JSON constant: '+v)
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=reject)
def safe(root,rel):
    check(type(rel)is str and rel and not Path(rel).is_absolute() and '..' not in Path(rel).parts and '\\' not in rel,'Unsafe relative path')
    p=root/rel;check(p.resolve()==p and p.is_file() and not p.is_symlink(),'Missing/indirect artifact: '+rel);return p
def bind(root,p):
    p=Path(p);raw=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(raw),'sha256':sha(raw)}
def bound(root,b):
    check(type(b)is dict and set(b)=={'path','bytes','sha256'},'Malformed artifact binding')
    check(type(b['bytes'])is int and b['bytes']>=0 and type(b['sha256'])is str and re.fullmatch('[0-9a-f]{64}',b['sha256']),'Invalid artifact digest/size')
    p=safe(root,b['path']);raw=p.read_bytes();check(len(raw)==b['bytes'] and sha(raw)==b['sha256'],'Artifact identity changed: '+b['path']);return raw
def save(p,v):
    with p.open('xb') as f:f.write((json.dumps(v,indent=2,allow_nan=False)+'\n').encode())
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
def old_modules(root):
    p=root/'round3-control/prepare_prediction_scoring.py';c=root/'round3-benchmark/scoring-view/canonicalize_view.py';a=root/'round3-benchmark/outcome-tools/outcome_adapter.py'
    check(sha(p.read_bytes())==OLD_PREP_SHA and sha(c.read_bytes())==CANON_SHA and sha(a.read_bytes())==OLD_AUTH_SHA,'Frozen round-3 geometry/canonical/auth source differs')
    return module(p,'round4_pinned_prediction_preparation'),module(a,'round4_pinned_view_authentication')
def implementation(root):
    old_modules(root)
    return {'prepareScriptSha256':sha(Path(__file__).read_bytes()),'round3PreparationSha256':OLD_PREP_SHA,'canonicalizerSha256':CANON_SHA,'round3ViewAuthenticationSha256':OLD_AUTH_SHA}

def verify_cohort(root,cohort_binding):
    cohort=strict(bound(root,cohort_binding))
    check(set(cohort)=={'schema','evaluationRole','generationRoot','generationPlan','generationFreeze','generationImplementation','rawRoot','plannedIds','seedBatch','outcomeInputs'},'Cohort fields differ')
    check(cohort['schema']=='confovhh-round4-prediction-cohort-v1' and cohort['evaluationRole'] in ('development','reserved') and cohort['outcomeInputs']==[],'Invalid outcome-free cohort role')
    for k in ('generationRoot','rawRoot'):
        v=cohort[k];check(type(v)is str and v and not Path(v).is_absolute() and '..' not in Path(v).parts,'Unsafe cohort root')
    groot=root/cohort['generationRoot'];check(groot.resolve()==groot,'Indirect generation root')
    plan=strict(bound(root,cohort['generationPlan']));freeze=strict(bound(root,cohort['generationFreeze']));bound(root,cohort['generationImplementation'])
    check((root/cohort['generationPlan']['path']).parent==groot and Path(cohort['generationImplementation']['path']).parent==Path(cohort['generationRoot']),'Generation binding root differs')
    check(freeze['planSha256']==cohort['generationPlan']['sha256'],'Producer freeze/plan differs')
    for b in freeze['files']:bound(groot,b)
    check(any(b['path']=='run_batch.py' and b['sha256']==cohort['generationImplementation']['sha256'] for b in freeze['files']),'Producer verifier not frozen')
    check(plan['sourceCommit']=='b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc','Unsupported model source')
    check(next(b['sha256'] for b in plan['modelHashes'] if b['path']=='cache/boltz2_conf.ckpt')=='090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1','Unsupported model checkpoint')
    check(plan['nativeCoordinateInputs']==[] and not any(plan['settings'][k] for k in ['templates','restraints','use_potentials','use_msa_server']),'Forbidden generation dependency')
    targets={t['id']:t for t in plan['targets']};arms={a['id']:a for a in plan['arms']}
    check(len(targets)==len(plan['targets']) and len(arms)==len(plan['arms']),'Duplicate target/arm')
    ids=[j['jobId'] for j in plan['jobs']]
    check(len(ids)==len(set(ids))==plan['plannedAttempts'] and cohort['plannedIds']==sorted(ids),'Planned membership differs')
    combinations={(j['targetId'],j['armId'],j['seed']) for j in plan['jobs']}
    check(len(combinations)==len(ids) and all(t in targets and a in arms and s in plan['settings']['seeds'] for t,a,s in combinations),'Invalid/repeated planned target/arm/seed')
    if cohort['evaluationRole']=='development':
        check(combinations=={(t,a,s) for t in targets for a in arms for s in plan['settings']['seeds']},'Incomplete development target/arm/seed grid')
    else:
        # Reserved studies may add the selected alternative only to supported
        # pair contexts. Exact frozen jobs remain authoritative for other arms.
        check({(t,'baseline',s) for t in targets for s in plan['settings']['seeds']}<=combinations,'Reserved baseline coverage incomplete')
    prep,_=old_modules(root);sequences={}
    for t in targets.values():
        raw=bound(groot,t['input']);document=prep.sequence_document(raw);seqs={}
        check(set(document)<={'version','sequences'},'Unexpected generation input properties')
        for entity in document['sequences']:
            check(set(entity)=={'protein'},'Only declared protein input entities accepted');protein=entity['protein']
            check(set(protein)=={'id','sequence'},'Unexpected protein generation input properties')
            for chain in protein['id'] if type(protein['id'])is list else [protein['id']]:
                check(chain not in seqs,'Repeated input chain');seqs[chain]=protein['sequence']
        check(set(seqs)==set(t['receptorChains']+[t['selectedNb']]+t['contextChains']),'Declared roles do not partition input chains')
        check({c:sha(s.encode()) for c,s in seqs.items()}==t['chainSequenceSha256'],'Exact launch sequence digest differs')
        for b in t['capturedFiles']:bound(groot,b)
        sequences[t['id']]=seqs
    for j in plan['jobs']:
        t=targets[j['targetId']];a=arms[j['armId']];z={k:v for k,v in j.items() if k!='jobSpecificationSha256'}
        check(sha(packed({'job':z,'input':t['input'],'capturedFiles':t['capturedFiles'],'arm':a}))==j['jobSpecificationSha256'],'Planned job specification differs')
        check(j['jobId']==f"{j['targetId']}__{j['armId']}__seed{j['seed']:02d}",'Planned job naming differs')
    runner=module(root/cohort['generationImplementation']['path'],'round4_bound_generation_runner')
    plan['_sha256']=cohort['generationPlan']['sha256']
    return cohort,plan,targets,sequences,runner

def create_cohort(root,generation_root,raw_root,role,output):
    groot=Path(generation_root).resolve();check(groot.is_relative_to(root),'Generation root outside execution root')
    p=groot/'batch-plan.json';plan=strict(p.read_bytes());seeds=plan['settings']['seeds']
    c={'schema':'confovhh-round4-prediction-cohort-v1','evaluationRole':role,'generationRoot':str(groot.relative_to(root)),
       'generationPlan':bind(root,p),'generationFreeze':bind(root,groot/'GENERATION-FREEZE.json'),'generationImplementation':bind(root,groot/'run_batch.py'),
       'rawRoot':str(Path(raw_root).resolve().relative_to(root)),'plannedIds':sorted(j['jobId'] for j in plan['jobs']),
       'seedBatch':'seeds-'+','.join(map(str,seeds)),'outcomeInputs':[]}
    save(output,c);verify_cohort(root,bind(root,output));return c

def prepare(root,cohort_path,output,snapshot=False):
    root=Path(root).resolve();cohort_binding=bind(root,Path(cohort_path).resolve());cohort,plan,targets,sequences,runner=verify_cohort(root,cohort_binding)
    check(not output.exists() and output.is_relative_to(HERE),'Preparation output must be new, within round4-outcomes')
    prep,auth=old_modules(root);rawroot=root/cohort['rawRoot'];completed=[]
    # Authenticate every available producer receipt before creating the snapshot.
    for job in plan['jobs']:
        dest=rawroot/job['jobId'];rec=runner.previous(root/cohort['generationRoot'],dest,job,plan) if (dest/'receipt.json').exists() else None
        completed.append((job,dest,rec))
    check(snapshot or all(rec is not None for _,_,rec in completed),'Final preparation requires terminal receipt for every planned attempt')
    output.mkdir(parents=True);viewsdir=HERE/'scoring-views';viewsdir.mkdir(exist_ok=True);rows=[]
    for job,dest,rec in completed:
        status=rec['status'] if rec else 'not-run';t=targets[job['targetId']]
        row={'id':job['jobId'],'setId':job['targetId'],'generationArm':job['armId'],'seed':job['seed'],'seedBatch':cohort['seedBatch'],
             'status':status,'generationReceipt':bind(root,dest/'receipt.json') if rec else None,'rawCoordinate':None,'sourceConfidence':None,
             'geometryStatus':'not-produced','viewReceipt':None,'canonicalCoordinate':None,'canonicalMap':None,'rawInputIntegrity':None,
             'unavailableReason':rec.get('reason','') if rec else 'No terminal generation receipt in this prediction snapshot'}
        if status=='generated':
            raw=safe(root,str((dest/rec['coordinate']).relative_to(root)));conf=safe(root,str((dest/rec['source_confidence']).relative_to(root)))
            row['rawCoordinate']=bind(root,raw);row['sourceConfidence']=bind(root,conf);row['geometryStatus']='invalid'
            view=viewsdir/(job['jobId']+'.cif');sidecars=[view,view.with_suffix('.receipt.json'),view.with_suffix('.mapping.json')]
            try:
                integrity=prep.verify_raw_geometry(raw,t,sequences[t['id']]);row['rawInputIntegrity']=integrity
                check(integrity['modelIds']==['1'],'Exactly one complete prediction model 1 required')
            except (ValueError,KeyError,TypeError,AssertionError,UnicodeError) as exc:
                row['unavailableReason']=f'{type(exc).__name__}: {exc}';row['rawInputIntegrity']=getattr(exc,'report',row['rawInputIntegrity'])
            else:
                # Cache corruption/partial canonicalization is a preparation error,
                # never a manufactured invalid-input classification.
                if not any(p.exists() for p in sidecars):prep.canonicalizer().canonicalize_view(raw,view,t['receptorChains'],t['selectedNb'],chain_namespace='label')
                check(all(p.exists() for p in sidecars),'Partial canonicalization retained; no silent overwrite')
                prep.verify_canonical_view(root,raw,view,t)
                auth.verify_view(root,bind(root,view),bind(root,view.with_suffix('.receipt.json')),t['receptorChains'],t['selectedNb'],'label')
                row.update(geometryStatus='canonicalized',viewReceipt=bind(root,view.with_suffix('.receipt.json')),canonicalCoordinate=bind(root,view),canonicalMap=bind(root,view.with_suffix('.mapping.json')),unavailableReason='')
        check(row['geometryStatus']=='canonicalized' or bool(row['unavailableReason']),'Unavailable view must have explicit reason')
        rows.append(row)
    inventory={'schema':'confovhh-round4-prediction-view-inventory-v1','evaluationRole':cohort['evaluationRole'],'snapshot':snapshot,'cohort':cohort_binding,'rows':rows}
    save(output/'prediction-view-inventory.json',inventory)
    receipt={'schema':'confovhh-round4-prediction-preparation-receipt-v1','createdUtc':now(),'evaluationRole':cohort['evaluationRole'],'snapshot':snapshot,
             'cohort':cohort_binding,'inventory':bind(root,output/'prediction-view-inventory.json'),'implementation':implementation(root),'plannedCount':len(rows),
             'statusCounts':dict(Counter(r['status'] for r in rows)),'geometryCounts':dict(Counter(r['geometryStatus'] for r in rows)),'referenceInputs':[],'outcomeInputs':[]}
    save(output/'preparation-receipt.json',receipt);return receipt

def verify_preparation(root,receipt_binding):
    root=Path(root).resolve();r=strict(bound(root,receipt_binding));check(r['schema']=='confovhh-round4-prediction-preparation-receipt-v1' and r['implementation']==implementation(root),'Preparation implementation changed')
    check(set(r)=={'schema','createdUtc','evaluationRole','snapshot','cohort','inventory','implementation','plannedCount','statusCounts','geometryCounts','referenceInputs','outcomeInputs'},'Unexpected preparation receipt field')
    check(r['referenceInputs']==r['outcomeInputs']==[],'Preparation may not consume native/outcomes')
    c,plan,targets,sequences,runner=verify_cohort(root,r['cohort']);inv=strict(bound(root,r['inventory']))
    check(set(inv)=={'schema','evaluationRole','snapshot','cohort','rows'} and inv['schema']=='confovhh-round4-prediction-view-inventory-v1' and type(inv['snapshot'])is bool,'Invalid prediction inventory')
    check(inv['cohort']==r['cohort'] and inv['evaluationRole']==r['evaluationRole']==c['evaluationRole'] and inv['snapshot']==r['snapshot'],'Preparation role/cohort differs')
    rows=inv['rows'];check(len(rows)==r['plannedCount']==len(plan['jobs']) and [x['id'] for x in rows]==[j['jobId'] for j in plan['jobs']],'Canonical inventory membership/order differs')
    check(dict(Counter(x['status'] for x in rows))==r['statusCounts'] and dict(Counter(x['geometryStatus'] for x in rows))==r['geometryCounts'],'Preparation counts differ')
    prep,auth=old_modules(root)
    for row,job in zip(rows,plan['jobs']):
        check(set(row)=={'id','setId','generationArm','seed','seedBatch','status','generationReceipt','rawCoordinate','sourceConfidence','geometryStatus','viewReceipt','canonicalCoordinate','canonicalMap','rawInputIntegrity','unavailableReason'},'Unexpected prediction row field')
        check((row['setId'],row['generationArm'],row['seed'],row['seedBatch'])==(job['targetId'],job['armId'],job['seed'],c['seedBatch']),'Row identity differs')
        dest=root/c['rawRoot']/row['id'];t=targets[row['setId']]
        if row['status']=='not-run':
            check(r['snapshot'] and row['generationReceipt'] is None and row['geometryStatus']=='not-produced' and row['unavailableReason'] and all(row[k] is None for k in ['rawCoordinate','sourceConfidence','viewReceipt','canonicalCoordinate','canonicalMap','rawInputIntegrity']),'Invalid missing row');continue
        bound(root,row['generationReceipt']);check(row['generationReceipt']==bind(root,dest/'receipt.json'),'Generation receipt points elsewhere')
        rec=runner.previous(root/c['generationRoot'],dest,job,plan);check(rec['status']==row['status'],'Producer disposition differs')
        if row['status']!='generated':
            check(row['geometryStatus']=='not-produced' and all(row[k] is None for k in ['rawCoordinate','sourceConfidence','viewReceipt','canonicalCoordinate','canonicalMap']),'Failed generation acquired a coordinate');continue
        check(row['rawCoordinate']==bind(root,dest/rec['coordinate']) and row['sourceConfidence']==bind(root,dest/rec['source_confidence']),'Generated source coordinate/confidence identity differs')
        if row['geometryStatus']=='canonicalized':
            integrity=prep.verify_raw_geometry(root/row['rawCoordinate']['path'],t,sequences[t['id']]);check(integrity==row['rawInputIntegrity'] and integrity['modelIds']==['1'],'Original geometry evidence differs')
            bound(root,row['canonicalMap']);result=auth.verify_view(root,row['canonicalCoordinate'],row['viewReceipt'],t['receptorChains'],t['selectedNb'],'label')
            check(result['source']==row['rawCoordinate'] and result['map']==row['canonicalMap'],'Canonical source/map differs')
        else:
            check(row['geometryStatus']=='invalid' and row['unavailableReason'] and all(row[k] is None for k in ['viewReceipt','canonicalCoordinate','canonicalMap']),'Invalid geometry view silently usable')
            observed=None;error=''
            try:
                observed=prep.verify_raw_geometry(root/row['rawCoordinate']['path'],t,sequences[t['id']]);check(observed['modelIds']==['1'],'Exactly one complete prediction model 1 required')
            except (ValueError,KeyError,TypeError,AssertionError,UnicodeError) as exc:
                error=f'{type(exc).__name__}: {exc}';observed=getattr(exc,'report',observed)
            check(error and error==row['unavailableReason'] and observed==row['rawInputIntegrity'],'Invalid geometry classification did not independently reproduce')
    return inv,r

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['cohort','prepare','verify']);ap.add_argument('--artifacts',type=Path,default=ROOT);ap.add_argument('--generation-root',type=Path);ap.add_argument('--raw-root',type=Path);ap.add_argument('--role',choices=['development','reserved'],default='development');ap.add_argument('--cohort',type=Path);ap.add_argument('--receipt',type=Path);ap.add_argument('--output',type=Path);ap.add_argument('--snapshot',action='store_true');args=ap.parse_args();root=args.artifacts.resolve()
    if args.command=='cohort':
        result=create_cohort(root,args.generation_root,args.raw_root,args.role,args.output.resolve());print(json.dumps({'status':'PASS','planned':len(result['plannedIds']),'cohort':bind(root,args.output.resolve())}))
    elif args.command=='prepare':
        result=prepare(root,args.cohort,args.output.resolve(),args.snapshot);print(json.dumps({'status':'PASS','planned':result['plannedCount'],'counts':result['statusCounts'],'geometry':result['geometryCounts'],'receipt':bind(root,args.output.resolve()/'preparation-receipt.json')}))
    else:
        inv,r=verify_preparation(root,bind(root,args.receipt.resolve()));print(json.dumps({'status':'PASS','planned':len(inv['rows']),'geometry':r['geometryCounts']}))

if __name__=='__main__':main()
