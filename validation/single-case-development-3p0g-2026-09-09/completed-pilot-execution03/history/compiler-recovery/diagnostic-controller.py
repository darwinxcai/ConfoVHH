from pathlib import Path
import json,subprocess,os,signal,time,datetime,hashlib
r=Path('/workspace/runtime-results')
smoke=json.loads((r/'runtime-smoke.json').read_text());assert smoke['status']=='FAIL'
assert smoke['model_inference_runs']==0
assert not Path('/workspace/executions/confovhh-3p0g-compiler-recovery-20260909-01/3p0g-pilot-output').exists()
assert not (r/'import-diagnostic.json').exists()
args=['/workspace/confovhh-boltz/bin/python','-I','-X','importtime','-c','import boltz.main']
env={k:v for k,v in os.environ.items() if k not in ['PYTHONPATH','PYTHONHOME']}
started=time.monotonic();at=datetime.datetime.now(datetime.timezone.utc).isoformat();log=r/'import-diagnostic.log'
with log.open('xb') as f:
 p=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,env=env,start_new_session=True)
 try:rc=p.wait(timeout=90);timeout=False
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGKILL);rc=p.wait();timeout=True
row={'purpose':'Post-failure import-only diagnosis; not a runtime-gate rerun and not inference','startedAtUtc':at,'completedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':args,'timeoutSeconds':90,'timedOut':timeout,'exitCode':rc,'elapsedSeconds':time.monotonic()-started,'originalRuntimeGateRetained':'FAIL','inferenceExecuted':False,'fullGpuJitGateReached':False,'logSha256':hashlib.sha256(log.read_bytes()).hexdigest()}
(r/'import-diagnostic.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row))
