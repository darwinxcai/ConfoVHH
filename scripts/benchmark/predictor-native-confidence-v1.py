#!/usr/bin/env python3
"""Separate exploratory native-confidence baseline. Never changes frozen scoring."""
import argparse,csv,hashlib,json,math,sys,time,zipfile
from datetime import datetime,timezone
from decimal import Decimal
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'validation/exploratory-predictor-native-confidence-v1'
OLD=ROOT/'validation/benchmark-eligibility-resolution-v1/retrospective-replay'
FIELDS={'AlphaFold Server':'ranking_score','Boltz 2.2.1':'confidence_score'}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pairs(items):
 d={}
 for k,v in items:
  if k in d:raise ValueError('Duplicate JSON key: '+k)
  d[k]=v
 return d
def load(p,decimal=False):return json.loads(Path(p).read_text(),object_pairs_hook=pairs,parse_float=Decimal if decimal else float,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
def save(p,d):Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(json.dumps(d,indent=2,allow_nan=False)+'\n')
def bind(p,root):return dict(path=str(p.relative_to(root)),bytes=p.stat().st_size,sha256=sha(p))
def verify(p,b):
 if p.stat().st_size!=b['bytes'] or sha(p)!=b['sha256']:raise ValueError('Artifact mismatch: '+str(p))
def score_value(data,predictor):
 v=data[FIELDS[predictor]]
 if isinstance(v,bool) or not isinstance(v,(Decimal,int,float)):raise ValueError('Score must be a finite JSON number')
 v=Decimal(str(v));low,high=(-100,Decimal('1.5')) if predictor=='AlphaFold Server' else (0,1)
 if not v.is_finite() or not low<=v<=high:raise ValueError('Score outside documented range')
 return v
def maximum_set(rows):
 available=[r for r in rows if r['coordinateAvailable']]
 if not available:return dict(status='abstain',selected=[],score=None,reason='No available coordinates')
 if any(r['scoreStatus']!='available' for r in available):return dict(status='abstain',selected=[],score=None,reason='Required native confidence unavailable in coordinate pool; no candidate dropped')
 high=max(Decimal(r['exportedScore']) for r in available)
 return dict(status='selected',selected=[r['id'] for r in available if Decimal(r['exportedScore'])==high],score=str(high),reason='')
def audit(bundle,archives,output):
 from Bio.PDB.MMCIF2Dict import MMCIF2Dict
 started=time.monotonic();out=Path(output);out.mkdir(parents=True,exist_ok=False)
 plan=load(bundle/'plan.json');assert sha(bundle/'plan.json')==sha(OLD/'plan.json')
 provenance=load(bundle/'archive-provenance.json');zips=[]
 for b in provenance['archives']:
  path=archives/b['name'];verify(path,dict(bytes=b['bytes'],sha256=b['sha256']));zips.append(zipfile.ZipFile(path))
 expected={(j['job'],f['filename']):f for j in load(ROOT/'validation/gpcr-paper-development-2026-09-04/confovhh-audit/audit-summary.json')['jobs'] for f in j['ignoredSummaryFiles']}
 reviewed={(r['jobId'],r['modelIndex']):r for r in load(ROOT/'validation/gpcr-paper-development-2026-09-04/reviewed-cognate-plan.json')['jobs']}
 request_records=[r for r in load(bundle/'input-and-reference-review.json') if 'request' in r];requests=[];target_requests={}
 for rr in request_records:
  p=bundle/'artifacts'/rr['request']['path'];verify(p,rr['request']);original=ROOT/'validation/gpcr-paper-development-2026-09-04/source/S4_job_requests'/p.name;assert p.read_bytes()==original.read_bytes()
  r=load(p)[0];assert r['dialect']=='alphafoldserver' and r['modelSeeds']==[str(rr['seed'])]
  assert r['name'].endswith('_seed'+str(rr['seed']))
  normalized={k:v for k,v in r.items() if k not in ('name','modelSeeds')};target_requests.setdefault(rr['targetId'],[]).append(normalized)
  requests.append(dict(targetId=rr['targetId'],jobId=r['name'],seed=rr['seed'],binding=rr['request'],dialect=r['dialect'],schemaVersion=r['version'],sequenceLengths=[len(s['proteinChain']['sequence']) for s in r['sequences']],templates=[s['proteinChain'].get('useStructureTemplate') for s in r['sequences']],normalizedRequestSha256=hashlib.sha256(json.dumps(normalized,sort_keys=True).encode()).hexdigest()))
 assert all(len(v)==2 and v[0]==v[1] for v in target_requests.values()),'Within-target settings differ beyond seed/name'
 rows=[]
 for a in plan['attempts']:
  predictor='Boltz 2.2.1' if a['targetId']=='exposed-3P0G' else 'AlphaFold Server';legacy=predictor=='AlphaFold Server';job=a['id'].rsplit('_model_',1)[0];idx=int(a['id'].rsplit('_model_',1)[1]);row=dict(id=a['id'],targetId=a['targetId'],jobId=job,predictor=predictor,modelIndex=idx,coordinateAvailable=a['coordinate'] is not None,producerStatus=a['status'],producerReason=a['reason'],field=FIELDS[predictor],direction='higher-better',coordinate=a['coordinate'],confidence=a['confidence'],scoreStatus='missing',exportedScore=None)
  if a['coordinate'] is not None:
   cp=bundle/'artifacts'/a['coordinate']['path'];verify(cp,a['coordinate']);d=MMCIF2Dict(str(cp))
   if legacy:
    hist=reviewed[job,idx];assert hist['modelSha256']==sha(cp)
    row['softwareName']=d['_software.name'];row['softwareVersion']=d['_software.version'];row['citationTitle']=d['_citation.title'];row['embeddedModelName']=d['_ma_model_list.model_name']
    assert row['softwareName']==['AlphaFold'] and all('AlphaFold-beta-20231127' in s for s in row['softwareVersion'])
    for b in (a['coordinate'],a['confidence']):
     source='VERIFY/runs/'+job+'/'+Path(b['path']).name;matches=[z.read(source) for z in zips if source in z.namelist()];assert len(matches)==1 and hashlib.sha256(matches[0]).hexdigest()==b['sha256'];row.setdefault('archiveMembers',[]).append(source)
   if a['confidence'] is not None:
    p=bundle/'artifacts'/a['confidence']['path'];verify(p,a['confidence'])
    if legacy:verify(p,expected[job,p.name])
    try:row.update(scoreStatus='available',exportedScore=str(score_value(load(p,decimal=True),predictor)))
    except (KeyError,ValueError) as ex:row.update(scoreStatus='invalid',scoreError=str(ex))
  elif legacy:
   names=[f'VERIFY/runs/{job}/fold_{job.lower()}_model_{idx}.cif',f'VERIFY/runs/{job}/fold_{job.lower()}_summary_confidences_{idx}.json']
   row['absentArchiveMembers']=[]
   for name in names:
    assert not any(name in z.namelist() for z in zips),'Previously missing archive member now available: '+name
    row['absentArchiveMembers'].append(name)
  rows.append(row)
 jobs=[]
 for job in dict.fromkeys(r['jobId'] for r in rows):
  rs=[r for r in rows if r['jobId']==job];available=[r for r in rs if r['coordinateAvailable']];isaf=rs[0]['predictor']=='AlphaFold Server'
  numbers=[Decimal(r['exportedScore']) for r in available if r['scoreStatus']=='available'];versions=sorted({v for r in available for v in r.get('softwareVersion',[])})
  jobs.append(dict(jobId=job,predictor=rs[0]['predictor'],planned=len(rs),available=len(available),softwareVersions=versions,exportedScoresInFileIndexOrder=[r['exportedScore'] for r in rs],nonincreasingFileRankOrder=(all(x>=y for x,y in zip(numbers,numbers[1:])) if isaf and len(numbers)==5 else None),documentedServerFirstFile=(job+'_model_0' if isaf and len(available)==5 else None),scope='File rank is documented for AlphaFold Server; exported equal values cannot reveal unrounded score differences or internal tie-breaking.'))
  if isaf and len(available)==5:assert jobs[-1]['nonincreasingFileRankOrder'],'Server rank/score contradiction requires diagnosis'
 save(out/'provenance.json',dict(schema='confovhh.predictor-native-confidence-provenance.v1',status='SUPPORTED_EXPORTED_SCORE_BASELINE',requests=requests,jobs=jobs,rows=rows,archiveProvenance=provenance,boltzGenerationReceipt=bind(ROOT/'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/generation/generation-receipt.json',ROOT),boltzRuntimeReceipt=bind(ROOT/'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/runtime/runtime-smoke.json',ROOT),limits=['Provenance is verified against preserved records, not provider-signed attestation.','AlphaFold software labels and export times are preserved; proprietary weights/build and unrounded native scores cannot be recovered.','Request schema version 3 is an export-format field, not an AlphaFold model version; current server README describes version 1, so historical request re-executability is not established.'],outcomesRead=False,seconds=time.monotonic()-started))
 print(json.dumps(dict(status='PASS',records=len(rows),verifiedAvailable=sum(r['coordinateAvailable'] for r in rows),legacyJobsWithOutputs=sum(j['predictor']=='AlphaFold Server' and j['available']>0 for j in jobs))))
def check_freeze():
 f=load(P/'freeze-v1.json')
 for b in f['repositoryFiles']:verify(ROOT/b['path'],b)
 return f
def select(bundle,output):
 start=time.monotonic();f=check_freeze();policy=load(P/'policy-v1.json');prov=load(P/'provenance/provenance.json');plan=load(bundle/'plan.json');assert sha(bundle/'plan.json')==f['replayPlanSha256'];rows=prov['rows'];out=Path(output);out.mkdir(parents=True,exist_ok=False)
 for r in rows:
  if r['coordinateAvailable']:
   verify(bundle/'artifacts'/r['coordinate']['path'],r['coordinate'])
   if r['confidence'] is not None:
    p=bundle/'artifacts'/r['confidence']['path'];verify(p,r['confidence'])
    try:
     value=str(score_value(load(p,decimal=True),r['predictor']));assert r['scoreStatus']=='available' and value==r['exportedScore']
    except (KeyError,ValueError):
     assert r['scoreStatus']=='invalid' and r['exportedScore'] is None
 result=[];jobrows=[]
 for t in plan['targets']:
  rs=[r for r in rows if r['targetId']==t['id']];assert len({r['predictor'] for r in rs})==1
  result.append(dict(targetId=t['id'],groupId=t['groupId'],predictor=rs[0]['predictor'],baseline=policy['baseline'],planned=len(rs),available=sum(r['coordinateAvailable'] for r in rs),**maximum_set(rs)))
  for job in dict.fromkeys(r['jobId'] for r in rs):
   js=[r for r in rs if r['jobId']==job];row=dict(targetId=t['id'],jobId=job,predictor=rs[0]['predictor'],planned=len(js),available=sum(r['coordinateAvailable'] for r in js),**maximum_set(js))
   if row['predictor']=='AlphaFold Server' and row['available']==5:
    row['documentedServerSelectedFile']=job+'_model_0';assert row['documentedServerSelectedFile'] in row['selected']
    row['uniqueSelectionRecoverableFromExportedScoreAlone']=len(row['selected'])==1
   jobrows.append(row)
 save(out/'selections.json',dict(baseline=policy['baseline'],targetSelections=result,withinJobSelections=jobrows,attempts=rows,outcomesRead=False))
 save(out/'receipt.json',dict(status='COMPLETE',freezeSha256=sha(P/'freeze-v1.json'),selectionsSha256=sha(out/'selections.json'),scriptSha256=sha(__file__),seconds=time.monotonic()-start,outcomesRead=False,newGeneration=False))
 print(json.dumps(dict(status='COMPLETE',targets=len(result),attempts=len(rows))))
def outcome_summary(ids,outcomes):
 known=[outcomes[i]['DockQ'] for i in ids if outcomes[i]['status']=='available'];missing=len(ids)-len(known)
 if not ids:return dict(mean=None,minimum=None,maximum=None,missingSelectedOutcomes=0,lower=0.,upper=1.)
 return dict(mean=math.fsum(known)/len(ids) if not missing else None,minimum=min(known) if known else None,maximum=max(known) if known else None,missingSelectedOutcomes=missing,lower=math.fsum(known)/len(ids),upper=(math.fsum(known)+missing)/len(ids))
def evaluate(selections,output):
 start=time.monotonic();f=check_freeze();s=load(selections/'selections.json');receipt=load(selections/'receipt.json');assert sha(selections/'selections.json')==receipt['selectionsSha256'] and receipt['freezeSha256']==sha(P/'freeze-v1.json')
 previous=load(OLD/'evaluation.json');outcomes={r['id']:r for r in previous['outcomes']};assert set(outcomes)=={r['id'] for r in s['attempts']}
 out=Path(output);out.mkdir(parents=True,exist_ok=False);combined=[];perjob=[]
 for native in s['targetSelections']:
  pool=[r['id'] for r in s['attempts'] if r['targetId']==native['targetId'] and r['coordinateAvailable']];available=[i for i in pool if outcomes[i]['status']=='available'];best=max((outcomes[i]['DockQ'] for i in available),default=None);bt=[i for i in available if outcomes[i]['DockQ']==best]
  existing=[r for r in previous['selectionRows'] if r['targetId']==native['targetId']]
  for row in [*existing,dict(native,arm=native['baseline'])]:
   q=outcome_summary(row['selected'],outcomes);combined.append(dict(targetId=native['targetId'],predictor=native['predictor'],groupId=native['groupId'],method=row['arm'],status=row['status'],selectedIds=row['selected'],tieCount=len(row['selected']),selectedDockQ=q['mean'],selectedDockQMinimum=q['minimum'],selectedDockQMaximum=q['maximum'],bestAvailableDockQ=best,bestAvailableIds=bt,differenceFromBestAvailable=q['mean']-best if q['mean'] is not None and best is not None else None,planned=native['planned'],coordinatesAvailable=native['available'],DockQAvailable=len(available),missingPlanned=native['planned']-native['available'],missingSelectedOutcomes=q['missingSelectedOutcomes'],selectedDockQLower=q['lower'],selectedDockQUpper=q['upper'],fullPlannedPoolComplete=native['planned']==len(available),independentValidation=False))
 for row in s['withinJobSelections']:
  r=dict(row,exportedScoreSelection=outcome_summary(row['selected'],outcomes));i=row.get('documentedServerSelectedFile');r['documentedServerFileDockQ']=outcomes[i]['DockQ'] if i else None;perjob.append(r)
 save(out/'comparison.json',dict(rows=combined,withinJob=perjob,attempts=s['attempts'],outcomes=previous['outcomes'],knownOutcomesBeforeDefinition=True,independentValidation=False,acrossTargetConfidenceScoreComparison=False))
 with (out/'comparison.csv').open('w') as stream:
  w=csv.DictWriter(stream,fieldnames=list(combined[0]));w.writeheader();w.writerows({k:'; '.join(v) if isinstance(v,list) else v for k,v in r.items()} for r in combined)
 save(out/'receipt.json',dict(status='COMPLETE',freezeSha256=sha(P/'freeze-v1.json'),selectionReceiptSha256=sha(selections/'receipt.json'),priorEvaluationSha256=sha(OLD/'evaluation.json'),comparisonSha256=sha(out/'comparison.json'),seconds=time.monotonic()-start,newGeneration=False,newGpuHours=0,newCloudCostUSD=0))
 print(json.dumps([r for r in combined if r['method']=='exploratory-predictor-native-confidence-v1'],indent=2))
def main():
 p=argparse.ArgumentParser();sp=p.add_subparsers(dest='cmd',required=True)
 a=sp.add_parser('audit');a.add_argument('--bundle',type=Path,required=True);a.add_argument('--archives',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
 a=sp.add_parser('select');a.add_argument('--bundle',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
 a=sp.add_parser('evaluate');a.add_argument('--selections',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
 a=p.parse_args()
 if a.cmd=='audit':audit(a.bundle,a.archives,a.output)
 elif a.cmd=='select':select(a.bundle,a.output)
 else:evaluate(a.selections,a.output)
if __name__=='__main__':main()
