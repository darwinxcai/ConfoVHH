"""Verify archive closure, extract safely, and replay only extracted artifacts."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
NODE='/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
BASE_SHA='03abee56b5921ba209b8a8c9df4ccd5b35d4f2526abb6fdfc8696b3bbe7d759e'
FORBIDDEN_PARTS={'.git','__pycache__','.pytest_cache','.DS_Store','ssh_ed25519','ssh_ed25519.pub','known_hosts','known_hosts.old'}
INJECTION_ENV={'PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONUSERBASE','NODE_OPTIONS','NODE_PATH'}
ROLES={'development':100,'prospective':200}

# Inside an isolated interpreter, original-root reads are limited to its reused
# Python runtime. Original scientific artifacts cannot be fallback inputs.
REPLAY_BOOTSTRAP=r'''
import os,pathlib,runpy,sys
original=pathlib.Path(sys.argv[1]).resolve()
script=pathlib.Path(sys.argv[2]).resolve()
runtime=pathlib.Path(sys.prefix).resolve()
def audit(event,args):
    if event not in ('open','os.listdir','os.scandir'):return
    value=args[0] if args else None
    if value is None:value=os.getcwd()
    if isinstance(value,int):return
    candidate=pathlib.Path(os.fsdecode(value)).resolve()
    if candidate.is_relative_to(original) and not candidate.is_relative_to(runtime):
        raise PermissionError('Original scientific artifact access is forbidden during archive replay')
sys.addaudithook(audit)
sys.argv=[str(script),*sys.argv[3:]]
runpy.run_path(str(script),run_name='__main__')
'''

def check(value,message):
    if not value:raise ValueError(message)

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def strict_json(raw):
    def unique(pairs):
        result={}
        for key,value in pairs:
            check(key not in result,'Duplicate JSON key');result[key]=value
        return result
    def reject(value):raise ValueError('Nonfinite JSON constant: '+value)
    return json.loads(raw,object_pairs_hook=unique,parse_constant=reject)

def safe_relative(name):
    check(type(name) is str and name and '\\' not in name and not any(ord(c)<32 or ord(c)==127 for c in name),'Unsafe archive path')
    value=PurePosixPath(name)
    check(not value.is_absolute() and '..' not in value.parts and value.as_posix()==name and name not in ('.','..'),'Noncanonical or escaping archive path')
    check(not re.match(r'^[A-Za-z]:',name) and not any(part in FORBIDDEN_PARTS for part in value.parts),'Forbidden archive path')
    return value

def safe_file(root,name):
    safe_relative(name);path=root/name
    check(path.resolve()==path and path.is_file() and not path.is_symlink(),'Missing or indirect archived file: '+name)
    return path

def valid_digest(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None

def manifest_bound(root,binding,files):
    check(type(binding) is dict and set(binding)=={'path','bytes','sha256'},'Invalid archived binding')
    name=binding['path'];safe_relative(name)
    check(name in files,'Binding is not an archived manifest member')
    check(type(binding['bytes']) is int and binding['bytes']>0 and valid_digest(binding['sha256']),'Invalid archived binding value')
    check(files[name]=={'bytes':binding['bytes'],'sha256':binding['sha256']},'Binding differs from archived manifest')
    path=safe_file(root,name)
    check(path.stat().st_size==binding['bytes'] and digest(path)==binding['sha256'],'Extracted binding bytes differ')
    return path

def extract_verified(archive,destination,receipt):
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist();names=[e.filename for e in entries]
        check(len(names)==len(set(names)),'Duplicate archive member')
        for entry in entries:
            safe_relative(entry.filename)
            kind=stat.S_IFMT(entry.external_attr>>16)
            check(not entry.is_dir() and kind in (0,stat.S_IFREG),'Symlink or special archive member')
        check('ROUND3_EVIDENCE_MANIFEST.json' in names,'Archive manifest absent')
        manifest=strict_json(z.read('ROUND3_EVIDENCE_MANIFEST.json'))
        check(manifest.get('schema')=='confovhh-round3-evidence-manifest-v1','Wrong archive manifest schema')
        files=manifest['files'];check(type(files) is dict,'Invalid archive file inventory')
        check(set(names)==set(files)|{'ROUND3_EVIDENCE_MANIFEST.json'},'Archive membership differs')
        check(type(manifest['payloadFileCount']) is int and manifest['payloadFileCount']==receipt['payloadFileCount']==len(files),'Archive count differs')
        check(manifest['baseArchiveSha256']==receipt['baseArchiveSha256']==BASE_SHA,'Historical base archive binding differs')
        check(manifest['reportReceipts']==receipt['reportReceipts'] and len(manifest['reportReceipts'])==2,'Report receipt crossbinding or coverage differs')
        for name,bound in files.items():
            safe_relative(name)
            check(type(bound) is dict and set(bound)=={'bytes','sha256'} and type(bound['bytes']) is int and bound['bytes']>=0 and valid_digest(bound['sha256']),'Invalid archive file binding')
        for entry in entries:
            raw=z.read(entry.filename)
            if entry.filename in files:
                bound=files[entry.filename]
                check(len(raw)==bound['bytes'] and hashlib.sha256(raw).hexdigest()==bound['sha256'],'Archive file digest differs: '+entry.filename)
            path=destination/entry.filename;path.parent.mkdir(parents=True,exist_ok=True)
            check(path.parent.resolve()==path.parent and not path.exists(),'Indirect or colliding extraction path')
            with path.open('xb') as stream:stream.write(raw)
    for name,bound in files.items():check(digest(safe_file(destination,name))==bound['sha256'],'Extracted file hash differs')
    return manifest

def verified_reports(destination,manifest):
    reports=[];seen=set();files=manifest['files']
    for binding in manifest['reportReceipts']:
        prior_path=manifest_bound(destination,binding,files);prior=strict_json(prior_path.read_bytes())
        role=prior['evaluationRole']
        check(prior.get('schema')=='confovhh-round3-frozen-report-evaluation-v1' and role in ROLES and role not in seen,'Unexpected or duplicate report role')
        check(type(prior['planned']) is int and prior['planned']==ROLES[role],'Report planned denominator differs')
        check(type(prior['outcomesAvailable']) is int and 0<=prior['outcomesAvailable']<=prior['planned'],'Invalid report outcome coverage')
        seen.add(role)
        outcome_path=manifest_bound(destination,prior['outcomeReceipt'],files)
        outcome=strict_json(outcome_path.read_bytes())
        check(outcome.get('schema')=='confovhh-round3-dockq-evaluation-receipt-v1' and outcome['evaluationRole']==role and outcome['plannedCount']==prior['planned'] and outcome['evaluatedCount']==prior['outcomesAvailable'],'Report and outcome receipt identity/coverage differs')
        for name,expected in prior['files'].items():
            check(type(name) is str and PurePosixPath(name).name==name,'Report result must be a local filename')
            relative=str((prior_path.parent/name).relative_to(destination));safe_relative(relative)
            check(relative in files and files[relative]['sha256']==expected,'Report result is absent or changed in archive')
        reports.append((prior_path,prior,outcome_path))
    check(seen==set(ROLES),'Both complete planned cohort reports are required')
    return sorted(reports,key=lambda item:item[1]['evaluationRole'])

def isolated_environment(node):
    return {**{k:v for k,v in os.environ.items() if k not in INJECTION_ENV},'CONFOVHH_NODE_BINARY':str(node)}

def main(args):
    source=args.artifacts.resolve();receipt=strict_json(safe_file(source,'round3-archive-receipt.json').read_bytes())
    check(receipt.get('schema')=='confovhh-round3-archive-receipt-v1','Wrong archive receipt schema')
    archive=safe_file(source,receipt['path']);check(archive.stat().st_size==receipt['bytes'] and digest(archive)==receipt['sha256'],'Archive receipt hash differs')
    destination=Path(tempfile.mkdtemp(prefix='confovhh-round3-verified-')).resolve()/'execution-20260924';destination.mkdir()
    manifest=extract_verified(archive,destination,receipt);reports=verified_reports(destination,manifest)
    python=Path(args.python or source/'.venv/bin/python').absolute();node=Path(args.node).resolve()
    check(python.is_file() and node.is_file(),'Explicit Python/Node runtime unavailable')
    environment=isolated_environment(node);results=[]
    for prior_path,prior,outcome_path in reports:
        out=destination/'fresh-archive-verification'/prior['evaluationRole']
        script=safe_file(destination,'round3-control/evaluate_fresh.py')
        command=[str(python),'-I','-c',REPLAY_BOOTSTRAP,str(source),str(script),'--artifacts',str(destination),'--outcomes',str(outcome_path),'--output',str(out)]
        log=source/f'round3-archive-{prior["evaluationRole"]}-replay.log'
        with log.open('x') as stream:subprocess.run(command,cwd=destination,env=environment,stdout=stream,stderr=subprocess.STDOUT,check=True)
        recreated=strict_json((out/'receipt.json').read_bytes())
        check(prior['files']==recreated['files'],'Saved numerical report files differ after extraction')
        for field in ('evaluationRole','planned','sets','biologicalGroups','outcomesAvailable','arms','reportingSpecificationSha256','tieClarificationSha256','implementation','rankingReceipts','outcomeReceipt'):
            check(prior[field]==recreated[field],'Replayed report provenance or coverage differs: '+field)
        results.append({'role':prior['evaluationRole'],'planned':prior['planned'],'outcomesAvailable':prior['outcomesAvailable'],
                        'allReportFilesByteExact':True,'authenticationAndSavedRanksReplayed':True,'files':prior['files']})
    result={'schema':'confovhh-round3-fresh-archive-verification-v1','completedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'archiveSha256':receipt['sha256'],'extractedRoot':str(destination),'payloadFileCount':len(manifest['files']),
            'allArchiveAndExtractedFileHashesVerified':True,'usedOriginalLiveArtifactInputs':False,
            'originalArtifactReadGuardActive':True,'isolatedPython':True,'cleanInjectionEnvironment':True,'replayCwd':str(destination),
            'runtimeReused':'Explicit installed pinned Python packages and Node only; original task artifact access is rejected by the replay audit hook.',
            'pythonRuntime':str(python),'nodeRuntime':str(node),'verifierSha256':digest(Path(__file__)),'reports':results}
    with (source/'round3-archive-verification.json').open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps({k:v for k,v in result.items() if k!='reports'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',type=Path,default=ROOT)
    parser.add_argument('--python',help='Pinned installed Python runtime; no scientific artifacts are read from its parent task')
    parser.add_argument('--node',default=NODE,help='Pinned Node runtime executable')
    main(parser.parse_args())
