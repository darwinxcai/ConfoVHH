#!/usr/bin/env python3
"""Bounded CPU replay of frozen methods; verifies prepared bytes, never allocates."""
import argparse,hashlib,json,subprocess,sys,time
from pathlib import Path
import evaluator as e
ROOT=Path(__file__).resolve().parents[2]
def main():
 p=argparse.ArgumentParser();p.add_argument('--bundle',type=Path,required=True);p.add_argument('--node',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--verify-only',action='store_true');a=p.parse_args();bundle=a.bundle.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);start=time.monotonic();stages=[]
 freeze=e.load(bundle/'freeze.json')
 for row in freeze['artifacts']:
  f=bundle/row['path'];assert f.is_file() and f.stat().st_size==row['bytes'] and e.sha(f)==row['sha256'],row['path']
 assert e.sha(ROOT/'validation/prospective-benchmark-v1/freeze-v1.json')==freeze['frozenEvaluatorPreparation']
 for row in e.load(ROOT/'validation/prospective-benchmark-v1/freeze-v1.json')['artifacts']:
  f=ROOT/row['path'];assert f.stat().st_size==row['bytes'] and e.sha(f)==row['sha256'],row['path']
 plan=e.load(bundle/'plan.json');targets=e.validate_plan(plan);e.verify_engine();checks=[]
 for attempt in plan['attempts']:
  if attempt['status']=='generated':
   e.geometry(e.artifact(bundle/'artifacts',attempt['coordinate']),targets[attempt['targetId']]);checks.append(attempt['id'])
 e.save(out/'precheck.json',dict(status='PASS',coordinateIdentityAndGeometryContractVerified=len(checks),ids=checks,frozenEvaluatorUnchanged=True))
 if a.verify_only:return
 def run(name,args):
  remaining=2700-(time.monotonic()-start);assert remaining>0,'CPU deadline elapsed'
  with (out/(name+'.stdout.log')).open('xb') as stdout,(out/(name+'.stderr.log')).open('xb') as stderr:
   begin=time.monotonic();subprocess.run([sys.executable,*map(str,args)],stdout=stdout,stderr=stderr,timeout=remaining,check=True);stages.append(dict(stage=name,seconds=time.monotonic()-begin))
 try:
  run('score',[ROOT/'scripts/benchmark/evaluator.py','score','--plan',bundle/'plan.json','--artifacts',bundle/'artifacts','--node',a.node,'--output',out/'scores'])
  ledger=e.load(out/'scores/attempts.json');assert not any(r['status']=='evaluation-failed' for r in ledger),'Stop after scoring failure; preserve without repair'
  refs=e.load(bundle/'references-template.json');refs['scoreReceiptSha256']=e.sha(out/'scores/receipt.json');e.save(out/'references.json',refs)
  run('dockq',[ROOT/'scripts/benchmark/dockq-outcomes.py','--scores',out/'scores','--artifacts',bundle/'artifacts','--reference-manifest',out/'references.json','--reference-root',bundle/'artifacts','--output',out/'dockq'])
  assert not any(r['status']=='failed' for r in e.load(out/'dockq/outcomes.json')['rows']),'Stop after reference failure; preserve without remapping'
  run('compare',[ROOT/'scripts/benchmark/evaluator.py','evaluate','--scores',out/'scores','--outcomes',out/'dockq/outcomes.json','--output',out/'comparison'])
  status='COMPLETED_WITH_DECLARED_MISSINGNESS_AND_ABSTENTIONS'
 except BaseException as ex:
  e.save(out/'controller-receipt.json',dict(status='STOPPED',error=type(ex).__name__+': '+str(ex),seconds=time.monotonic()-start,stages=stages,newGpuHours=0,newCloudCostUSD=0));raise
 e.save(out/'controller-receipt.json',dict(status=status,seconds=time.monotonic()-start,stages=stages,cpuDeadlineSeconds=2700,newGeneration=False,newGpuHours=0,newCloudCostUSD=0,bundleFreezeSha256=e.sha(bundle/'freeze.json'),independentValidation=False,scope='Retrospective compatibility/audit evaluation. Any exact test output is mechanically produced by the frozen implementation and has no confirmatory interpretation on these exposed groups.'))
 print(json.dumps(e.load(out/'controller-receipt.json'),indent=2))
if __name__=='__main__':main()
