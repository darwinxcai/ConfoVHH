#!/usr/bin/env python3
"""Detached local collector: download and verify one immutable remote backup."""
import argparse,datetime,hashlib,json,os,pathlib,subprocess,tarfile,time,traceback

def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''): h.update(b)
 return h.hexdigest()
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(p,d):
 with p.open('x') as f:json.dump(d,f,indent=2);f.write('\n')
def main():
 a=argparse.ArgumentParser();a.add_argument('--config',required=True);x=a.parse_args();c=json.loads(pathlib.Path(x.config).read_text());out=pathlib.Path(c['localOutput']);out.mkdir(parents=True,exist_ok=False)
 deadline=datetime.datetime.fromisoformat(c['hardDeadlineUtc'].replace('Z','+00:00')).timestamp();prefix=c['remotePrefix'];assert prefix=='execution03-backup'
 receipt={'schema':'confovhh.detached-backup-collector.v3','startedAtUtc':utc(),'status':'WAITING_FOR_REMOTE_BACKUP','predictionRequested':False,'cloudActionTaken':False};save(out/'collector-start.json',receipt)
 try:
  errors=0
  while time.time()<deadline-90:
   try:
    r=subprocess.run(['ssh','-F',c['sshConfig'],'pilot','cat /workspace/'+prefix+'-receipt.json'],capture_output=True,timeout=15)
    if r.returncode==0:
     remote_bytes=r.stdout;remote=json.loads(remote_bytes);assert remote['status']=='REMOTE_ARCHIVE_VERIFIED_REQUIRES_LOCAL_VERIFICATION';assert remote['executionId']==c['executionId'];break
   except (subprocess.TimeoutExpired,ValueError):errors+=1
   time.sleep(min(10,max(0,deadline-90-time.time())))
  else:raise TimeoutError('Backup receipt unavailable before independent stop reserve')
  (out/(prefix+'-receipt.json')).write_bytes(remote_bytes)
  for kind in ('archive','manifest'):
   row=remote[kind];name=row['path'];assert pathlib.PurePosixPath(name).name==name and name.startswith(prefix)
   allowance=min(120,max(1,deadline-70-time.time()))
   r=subprocess.run(['scp','-F',c['sshConfig'],'pilot:/workspace/'+name,str(out/name)],capture_output=True,timeout=allowance)
   if r.returncode:raise RuntimeError('Transfer failed for '+kind+': '+r.stderr.decode(errors='replace')[-1500:])
   p=out/name;assert p.stat().st_size==row['bytes'],kind+' size';assert sha(p)==row['sha256'],kind+' sha'
  mp=out/remote['manifest']['path'];m=json.loads(mp.read_text());expected={row['path']:row for row in m['files']};assert len(expected)==len(m['files']);expected[mp.name]={'bytes':mp.stat().st_size,'sha256':sha(mp)}
  destination=out/'preserved';destination.mkdir(exist_ok=False)
  with tarfile.open(out/remote['archive']['path'],'r:gz') as tf:
   members=tf.getmembers();assert len(members)==len(expected);assert {r.name for r in members}==set(expected)
   for member in members:
    p=pathlib.PurePosixPath(member.name);assert member.isfile() and not p.is_absolute() and '..'not in p.parts;row=expected[member.name];assert member.size==row['bytes'];dest=destination/member.name;dest.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256()
    with tf.extractfile(member) as src,dest.open('xb') as dst:
     for b in iter(lambda:src.read(4*1024*1024),b''):h.update(b);dst.write(b)
    assert h.hexdigest()==row['sha256'],member.name+' content';assert sha(dest)==row['sha256'],member.name+' extracted'
  results=destination/'executions'/c['executionId']/'runtime-results';ledger=results/'controller-attempt-ledger.json';blocked=results/'gate-blocked-execution.json';slots=json.loads((ledger if ledger.exists()else blocked).read_text());rows=slots.get('attempts',slots.get('plannedSlots'));assert len(rows)==10 and {r['id']for r in rows}=={f'seed{s}_model_{i}'for s in (1,2)for i in range(5)}
  receipt.update(status='PASS',archive=remote['archive'],manifest=remote['manifest'],payloadFilesVerified=len(m['files']),totalMembersVerified=len(expected),tenSlotsVerified=True,sshTimeoutCount=errors,completedAtUtc=utc())
  save(out/'local-verification.json',receipt)
 except BaseException as e:
  receipt.update(status='FAIL',errorType=type(e).__name__,error=str(e),completedAtUtc=utc());(out/'collector-traceback.log').write_text(traceback.format_exc());save(out/'collector-failure.json',receipt);return 1
 print(json.dumps(receipt),flush=True);return 0
if __name__=='__main__':raise SystemExit(main())
