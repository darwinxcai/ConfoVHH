#!/usr/bin/env python3
"""Reuse existing SSH or invoke the unchanged base-preserving bootstrap."""
import argparse,datetime,hashlib,json,os,pathlib,re,subprocess

def main():
 a=argparse.ArgumentParser();a.add_argument('--bootstrap',required=True);a.add_argument('--plan',required=True);a.add_argument('--output',required=True);x=a.parse_args();out=pathlib.Path(x.output)
 if not pathlib.Path('/usr/sbin/sshd').is_file():
  os.execv('/opt/conda/bin/python',['/opt/conda/bin/python','-I',x.bootstrap,'--output',str(out),'--package-plan',x.plan,'--max-seconds','240','--serve'])
 out.mkdir(parents=True,exist_ok=False);receipt={'schema':'confovhh.retained-ssh-resume.v3','startedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'existingSshReused':True,'basePackageChanges':False,'status':'FAIL'}
 try:
  plan=json.loads(pathlib.Path(x.plan).read_text());raw=subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${Architecture}\n'],timeout=15).decode();inventory={r.split('\t')[0]:{'version':r.split('\t')[1],'architecture':r.split('\t')[2]}for r in raw.splitlines()}
  assert all(inventory.get(k)==v for k,v in plan['addedPackages'].items()),'SSH closure differs from captured versions'
  key=os.environ.get('PILOT_SSH_PUBLIC_KEY','').strip();assert re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?',key),'Expected explicit public key'
  d=pathlib.Path('/root/.ssh');d.mkdir(mode=0o700,exist_ok=True);p=d/'authorized_keys';assert not p.is_symlink()
  if p.exists():assert key in p.read_text().splitlines(),'Explicit public key is not in existing authorized_keys'
  else:
   with p.open('x')as f:f.write(key+'\n')
   p.chmod(0o600)
  pathlib.Path('/run/sshd').mkdir(exist_ok=True);subprocess.run(['ssh-keygen','-A'],check=True,timeout=15,capture_output=True);subprocess.run(['/usr/sbin/sshd','-t','-o','PasswordAuthentication=no','-o','PermitRootLogin=prohibit-password','-o','PubkeyAuthentication=yes'],check=True,timeout=15,capture_output=True)
  receipt.update(status='RETAINED_SSH_VERIFIED',packagePlanSha256=hashlib.sha256(pathlib.Path(x.plan).read_bytes()).hexdigest())
 except BaseException as e:receipt.update(errorType=type(e).__name__,error=str(e));raise
 finally:receipt['completedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();(out/'resume-ssh-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 os.execv('/usr/sbin/sshd',['/usr/sbin/sshd','-D','-e','-o','PasswordAuthentication=no','-o','PermitRootLogin=prohibit-password','-o','PubkeyAuthentication=yes'])
if __name__=='__main__':main()
