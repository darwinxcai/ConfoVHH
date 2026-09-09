#!/usr/bin/env python3
"""Detached execution03: verify/reuse or restore, fresh gates, frozen runner, backup."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, importlib.util, json, os, subprocess, sys, time, traceback

ID='confovhh-3p0g-startup-recovery-20260909-03'
OLD='confovhh-3p0g-startup-recovery-20260909-02'
BASE='docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3'
BUNDLE='b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c'
HERE=Path(__file__).resolve().parent
ROOT=Path('/workspace'); RESULTS=ROOT/'executions'/ID/'runtime-results'
CONTROL=ROOT/'resume-execution03-control'


def now():return datetime.now(timezone.utc).isoformat()
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def save(p,d):
 with Path(p).open('x') as f:json.dump(d,f,indent=2,sort_keys=True);f.write('\n')
def load_module(name,p):
 sys.dont_write_bytecode=True
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--pod-id',required=True);p.add_argument('--deadline-utc',required=True)
 p.add_argument('--preservation-deadline-utc',required=True);p.add_argument('--base-identity-receipt',type=Path,required=True)
 p.add_argument('--launch-manifest',type=Path)
 p.add_argument('--worker',action='store_true');a=p.parse_args()
 end=datetime.fromisoformat(a.deadline_utc.replace('Z','+00:00'))
 keep=datetime.fromisoformat(a.preservation_deadline_utc.replace('Z','+00:00'))
 if end.tzinfo is None or keep.tzinfo is None or not 0<end.timestamp()-time.time()<=3614.729 or keep<=end:p.error('Fresh approved workload deadline and later preservation deadline required')
 if not a.worker:
  RESULTS.mkdir(parents=True,exist_ok=False);CONTROL.mkdir(exist_ok=False)
  if a.launch_manifest is not None:
   raw=a.launch_manifest.read_bytes();assert json.loads(raw).get('executionId',ID)==ID,'Launch manifest execution differs'
   with (RESULTS/'launch-manifest.json').open('xb') as f:f.write(raw)
  args=[sys.executable,'-I',str(Path(__file__).resolve()),*sys.argv[1:],'--worker']
  with (CONTROL/'worker.stdout.log').open('xb') as out,(CONTROL/'worker.stderr.log').open('xb') as err:
   child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
  record={'executionId':ID,'workerPID':child.pid,'startedAtUtc':now(),'command':args,'detached':True,'workloadDeadlineUtc':a.deadline_utc,'preservationDeadlineUtc':a.preservation_deadline_utc}
  save(CONTROL/'launch.json',record);print(json.dumps(record));return 0
 deadline=time.monotonic()+end.timestamp()-time.time()
 preserve_deadline=time.monotonic()+keep.timestamp()-time.time()
 gates=load_module('bounded_gates',HERE/'run-startup-gates-v1.py')
 monitor=load_module('frozen_monitor',HERE/'monitor-frozen-startup-v2.py')
 logdir=RESULTS/'resume-commands';logdir.mkdir(exist_ok=False)
 receipt={'schema':'confovhh.resume-execution03.v1','executionId':ID,'podId':a.pod_id,'startedAtUtc':now(),'status':'RUNNING','commands':[],'historicalRecordsModified':False}
 launched_monitor=False
 def command(label,args,outer=660,cutoff=None):
  row=gates.run_command(args,logdir,label,outer,deadline if cutoff is None else cutoff)
  receipt['commands'].append({'label':label,**row})
  if row.get('exitCode')!=0 or row['status']!='PASS':raise RuntimeError(label+' failed; retained raw logs')
  return row
 try:
  base=json.loads(a.base_identity_receipt.read_text())
  assert base.get('verified') is True and base.get('verifiedBaseImageRef')==BASE and base.get('podId')==a.pod_id,'Current provider base identity differs'
  (RESULTS/'live-base-identity.json').write_bytes(a.base_identity_receipt.read_bytes())
  bundle=ROOT/'reusable';assert sha(bundle/'bundle.json')==BUNDLE,'Bundle manifest differs'
  data=json.loads((bundle/'bundle.json').read_text())
  helper=ROOT/'boltz-runtime-bundle.py'
  assert sha(helper)=='a290e798628defaceff074141f5a02fc6dbe556080f905f8bb6e7dff70def7d9','Bundle helper differs'
  historical=ROOT/'executions'/OLD/'runtime-results'
  provenance=RESULTS/'provenance';provenance.mkdir()
  existing=[Path('/opt/confovhh-boltz').exists(),Path('/opt/confovhh-runtime').exists()]
  binding={'schema':'confovhh.resumed-environment-binding.v1','executionId':ID,'bundleSha256':BUNDLE,'newBaseIdentitySha256':sha(RESULTS/'live-base-identity.json'),'createdAtUtc':now(),'environmentFilesVerified':False}
  if all(existing):
   for src,dest in [(historical/'restore/restore-receipt.json',provenance/'historical-restore-receipt.json'),(historical/'live-base-identity.json',provenance/'historical-base-identity.json')]:
    assert src.is_file() and not src.is_symlink();dest.write_bytes(src.read_bytes())
   original=json.loads((provenance/'historical-restore-receipt.json').read_text())
   assert original['status']=='RESTORED_REQUIRES_ORIGINAL_RUNTIME_AND_FULL_GPU_JIT' and original['bundleSha256']==BUNDLE and original['environmentVerifiedBeforeExecution']
   assert original['baseIdentityReceiptSha256']==sha(provenance/'historical-base-identity.json')
   binding.update(mode='REUSED_PRESERVED_ENVIRONMENT',restoreReceiptPath='provenance/historical-restore-receipt.json',restoreBaseIdentityPath='provenance/historical-base-identity.json',freshRestoreClaimed=False)
  elif any(existing):raise RuntimeError('Partial /opt environment exists; refuse overwrite or silent repair')
  else:
   command('compiler-cache-stage',['/opt/conda/bin/python','-I',str(ROOT/'prepare-compiler-cache-v1.py'),'--bundle',str(bundle),'--mapping',str(ROOT/'compiler-cache-mapping-v1.json'),'--output',str(RESULTS/'compiler-cache')],180)
   command('restore',['/opt/conda/bin/python','-I',str(helper),'restore','--max-seconds',str(max(1,min(660,int(deadline-time.monotonic()-10)))),'--bundle',str(bundle),'--expected-bundle-sha256',BUNDLE,'--base-identity-receipt',str(RESULTS/'live-base-identity.json'),'--output',str(RESULTS/'restore')],680)
   binding.update(mode='FRESH_RESTORE_FROM_SAME_BUNDLE',restoreReceiptPath='restore/restore-receipt.json',restoreBaseIdentityPath='live-base-identity.json',freshRestoreClaimed=True)
  # Current bytes are checked independently even when the historical restore survives.
  mod=load_module('original_bundle_helper',helper);mod.DEADLINE=deadline
  verification=RESULTS/'environment-verification';verification.mkdir()
  assert mod.python_identity(verification,'current-base-python')==data['pythonIdentity'],'Current base interpreter/header identity differs'
  current=mod.environment_entries();expected=data['environmentEntries']
  normalize=lambda rows:{r['path']:{k:v for k,v in r.items() if k!='mtimeNs'} for r in rows}
  assert normalize(current)==normalize(expected),'Current environment content/mode/link inventory differs from preserved bundle'
  packages=mod.inventory(verification,'current-os-packages')
  assert all(packages.get(k)==v for k,v in data['installedOsPackages'].items()),'Current captured compiler/package versions differ'
  command('pip-check',['/opt/confovhh-boltz/bin/python','-I','-m','pip','check'],60)
  proof={'status':'CURRENT_ENVIRONMENT_BYTES_VERIFIED','entries':len(current),'bundleSha256':BUNDLE,'mode':binding['mode'],'mtimeComparison':'Not used for reuse admission; file bytes, modes, links and complete inventory verified','verifiedAtUtc':now()}
  save(verification/'receipt.json',proof)
  binding.update(status='ENVIRONMENT_VERIFIED_FOR_FRESH_GPU_CHECKS',environmentFilesVerified=True,environmentVerificationSha256=sha(verification/'receipt.json'),restoreReceiptSha256=sha(RESULTS/binding['restoreReceiptPath']),restoreBaseIdentitySha256=sha(RESULTS/binding['restoreBaseIdentityPath']))
  save(RESULTS/'environment-binding.json',binding)
  cache=historical/'cache-download-receipt.json';assert cache.is_file()
  (RESULTS/'cache-download-receipt.json').write_bytes(cache.read_bytes())
  save(RESULTS/'cache-provenance.json',{'copiedFromHistoricalReceipt':str(cache),'sha256':sha(cache),'freshDownloadClaimed':False,'frozenRunnerAndAdmissionWillReverifyActualBytes':True})
  command('fresh-gpu-gates',['/opt/conda/bin/python','-I',str(HERE/'run-startup-gates-v1.py'),'--execution-id',ID,'--deadline-utc',a.deadline_utc],500)
  # run_command uses start_new_session=True and detached stdin/output files.
  launched_monitor=True
  command('frozen-monitor',['/opt/conda/bin/python','-I',str(HERE/'monitor-frozen-startup-v2.py'),'--execution-id',ID,'--python','/opt/confovhh-boltz/bin/python','--wrapper',str(HERE/'run-frozen-startup-v3.sh'),'--deadline-utc',a.deadline_utc],max(1,deadline-time.monotonic()+60),deadline+65)
  receipt['status']='MONITOR_COMPLETE'
 except BaseException as exc:
  receipt.update(status='STOPPED_OR_FAILED',errorType=type(exc).__name__,error=str(exc))
  (RESULTS/'resume-error.log').write_text(traceback.format_exc())
 finally:
  # Complete a separate conservative ledger if a pre-gate failure or controller
  # interruption prevented the unchanged runner from producing its own ledger.
  ledger=RESULTS/'controller-attempt-ledger.json'
  if not ledger.exists():
   save(ledger,monitor.administrative_ledger(ROOT/'executions'/ID/'3p0g-pilot-output',ID,set(),receipt.get('error','pre-gate-stop')))
  receipt.update(completedAtUtc=now(),monitorLaunched=launched_monitor)
  save(RESULTS/'resume-before-preservation.json',receipt)
  archive_logs=CONTROL/'preservation';archive_logs.mkdir()
  args=['/opt/conda/bin/python','-I',str(HERE/'preserve-execution-v2.py'),'--execution-id',ID,'--python','/opt/confovhh-boltz/bin/python','--pod-id',a.pod_id,'--output-prefix','execution03-backup','--deadline-utc',a.preservation_deadline_utc,'--include','executions/confovhh-3p0g-startup-recovery-20260909-01','--include','executions/'+OLD,'--include',str(HERE.relative_to(ROOT)),'--include','ssh-bootstrap-resume-v3','--include','deadline-resume-v3/config.json']
  outcome=gates.run_command(args,archive_logs,'preserve',max(1,preserve_deadline-time.monotonic()-5),preserve_deadline)
  save(CONTROL/'completion.json',{'executionId':ID,'scientificPhaseStatus':receipt['status'],'preservation':outcome,'archiveReceiptExpected':'/workspace/execution03-backup-receipt.json','externalControlLogsSeparate':str(CONTROL),'localVerificationRequired':True,'cloudShutdownControlledExternally':True,'completedAtUtc':now()})
 return 0

if __name__=='__main__':raise SystemExit(main())
