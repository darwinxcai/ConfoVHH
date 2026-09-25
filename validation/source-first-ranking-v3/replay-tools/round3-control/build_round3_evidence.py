"""Preserve the complete v2 payload and the finite round3 experiment, without keys."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

ROOT=Path(__file__).resolve().parents[1]
BASE_SHA='03abee56b5921ba209b8a8c9df4ccd5b35d4f2526abb6fdfc8696b3bbe7d759e'
OMIT_PARTS={'.git','__pycache__','.pytest_cache','.DS_Store'}
OMIT_NAMES={'ssh_ed25519','ssh_ed25519.pub','known_hosts','known_hosts.old'}
SELECTED_DIRECTORIES=['round3-benchmark','round3-cloud','round3-control','round3-membrane','round3-predictions','round3-ranking','ConfoVHH/scripts/external-ranking-v3']
SELECTED_FILES=['REPORT-V3.md','V3_REPLAY.md','ConfoVHH/tests/external-ranking-v3.test.mjs','ConfoVHH/tests/external-ranking-v3-contact.test.mjs']
SECRET=re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])|hf_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|https?://[^\s/:]+:[^\s/@]+@')

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def safe_name(name):
    path=PurePosixPath(name)
    assert name and not path.is_absolute() and '..' not in path.parts and '\\' not in name and path.as_posix()==name and name not in ('.','..')
    assert not re.match(r'^[A-Za-z]:',name) and not any(ord(c)<32 or ord(c)==127 for c in name)
    assert not any(part in OMIT_PARTS or part in OMIT_NAMES for part in path.parts)
    return path

def included(path):
    relative=path.relative_to(ROOT)
    if any(part in OMIT_PARTS or part in OMIT_NAMES for part in relative.parts):return False
    if path.name.endswith(('.partial','.part')):return False
    # Immutable raw files and their recovery receipts are included once. The
    # separate transfer tarballs and portable Python environment remain locally
    # preserved with their original receipts and hashes.
    if 'recovery-archives' in relative.parts and path.name.endswith('.tar.gz'):return False
    if path.name=='confovhh-env-v2.tar.gz':return False
    return True

def selected_items(root):
    """The archive output/receipt/logs must live outside these source trees."""
    items={}
    for dirname in SELECTED_DIRECTORIES:
        folder=root/dirname;assert folder.is_dir()
        for path in folder.rglob('*'):
            if not included(path):continue
            assert not path.is_symlink(),'Indirect task artifact: '+str(path.relative_to(root))
            if path.is_file():items[str(path.relative_to(root))]=path
    for name in SELECTED_FILES:
        path=root/name;assert path.is_file() and not path.is_symlink();items[name]=path
    return items

def selection_snapshot(items):
    return {name:{'bytes':path.stat().st_size,'sha256':digest(path)} for name,path in sorted(items.items())}

def assert_selection_stable(root,expected):
    current=selected_items(root)
    assert set(current)==set(expected),'Selected archive membership changed during build; stop background writers before retry'
    for name,path in current.items():
        assert expected[name]=={'bytes':path.stat().st_size,'sha256':digest(path)},'Selected artifact changed during build: '+name

def verify_driver_completion(root,prospective_report):
    path=root/'round3-control/prospective-finish-run/completion.json'
    value=json.loads(path.read_text())
    assert value['status'] in ('COMPLETE','NEEDS_ATTENTION') and value['plannedCount']==200
    assert value['automaticRetry'] is False and value['productionChanged'] is False
    assert value['evaluatedCount']+value['unavailableCount']==200
    assert value['reportReceipt']==prospective_report,'Driver completion is not bound to this prospective report'
    assert not (path.parent/'failure.json').exists(),'Halted driver cannot be packaged as completed'
    return {'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':digest(path)}

def assert_report_final(path):
    text=path.read_text()
    assert not re.search(r'\bFINAL_[A-Z0-9_]+\b',text),'Final report/replay placeholders remain'
    assert not re.search(r'^\*\*Assembly status:.*\b(?:pending|draft)\b',text,re.I|re.M),'Final report assembly is still pending/draft'

def authenticated_metadata_scanner(root):
    """Only authenticated final-snapshot MSA members get format-aware scanning."""
    helper=root/'round3-cloud/metadata-recovery'
    modules={}
    for name in ('snapshot_metadata','recover_final_metadata'):
        spec=importlib.util.spec_from_file_location('archive_'+name,helper/(name+'.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);modules[name]=module
    contexts={};receipts=[]
    for receipt_path in sorted((root/'round3-cloud/final-metadata').glob('*/*/LOCAL-RECOVERY-RECEIPT.json')):
        assert receipt_path.resolve()==receipt_path,'Indirect final metadata receipt'
        receipt=json.loads(receipt_path.read_text());folder=receipt_path.parent
        assert receipt['allArchiveFileHashesVerified'] is True and receipt['allAssignedCentralRawJobsVerified'] is True
        archive=folder/Path(receipt['localArchive']).name
        assert archive.resolve()==archive and archive.is_file(),'Indirect metadata archive'
        manifest=modules['recover_final_metadata'].verify_archive(archive,receipt)
        assert manifest['podId']==receipt['podId'] and manifest['worker']==receipt['worker']
        assert len(manifest['jobs'])==receipt['assignedJobCount'] and manifest['jobs']==receipt['jobs']
        assert set(manifest['jobs'])=={f'{target}_seed{seed:02d}' for target in manifest['targets'] for seed in range(25)},'Incomplete metadata job inventory'
        extracted=folder/'artifacts';assert extracted.resolve()==extracted
        manifest_path=extracted/'SNAPSHOT-MANIFEST.json'
        assert digest(manifest_path)==receipt['manifestSha256'],'Extracted metadata manifest changed'
        allowed=set()
        for target in manifest['targets']:
            assert re.fullmatch(r'[A-Za-z0-9_-]+',target)
            for prefix in ('preprocessed','scratch-preprocessed'):
                base=extracted/prefix/target/'msa'
                for suffix in ('_paired_tmp_pairgreedy-env','_unpaired_tmp_env'):allowed.add(base/(target+suffix))
        for entry in manifest['files']:
            rel=safe_name(entry['path']);path=extracted/rel
            assert path.resolve()==path and path.is_file() and path.stat().st_size==entry['bytes'] and digest(path)==entry['sha256'],'Extracted metadata member differs'
            contexts[path]=allowed
        receipts.append({'path':str(receipt_path.relative_to(root)),'sha256':digest(receipt_path),'archiveSha256':receipt['sha256'],'manifestSha256':receipt['manifestSha256']})
    return modules['snapshot_metadata'].scan_known_public_msa,contexts,{'scannerSha256':digest(helper/'snapshot_metadata.py'),'finalMetadataReceipts':receipts}

def main(args):
    root=args.artifacts.resolve();assert root==ROOT
    base=root/'confovhh-source-interface-ranking-v2.zip';assert digest(base)==BASE_SHA
    output=args.output.resolve();assert output.parent==root and not output.exists()
    for name in ('REPORT-V3.md','V3_REPLAY.md'):assert_report_final(root/name)
    # Completion is established from authenticated reporting receipts, not a
    # generic cloud RUNNING/COMPLETE status or directory/file count.
    reports=[]
    for path,role,count in [(args.development,'development',100),(args.prospective,'prospective',200)]:
        path=path.resolve();value=json.loads(path.read_text())
        assert value['evaluationRole']==role and value['planned']==count
        reports.append({'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':digest(path)})
    completion=verify_driver_completion(root,reports[1])
    items=selected_items(root)
    selected_snapshot=selection_snapshot(items)
    msa_scanner,msa_contexts,metadata_scan_provenance=authenticated_metadata_scanner(root)
    for item in reports+[completion]:
        assert selected_snapshot[item['path']]=={k:item[k] for k in ('bytes','sha256')},'Completion/report changed before archive capture'
    excluded=[]
    for path in (root/'round3-cloud').rglob('*'):
        if path.is_file() and not included(path):excluded.append(str(path.relative_to(root)))
    records={};temporary=output.with_name(output.name+'.part')
    assert not temporary.exists()
    with zipfile.ZipFile(base) as old,zipfile.ZipFile(temporary,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True,strict_timestamps=False) as archive:
        for entry in old.infolist():
            if entry.is_dir():continue
            safe_name(entry.filename);assert entry.filename not in records
            raw=old.read(entry.filename)
            if entry.filename in items:
                assert items.pop(entry.filename).read_bytes()==raw,'Changed historical evidence: '+entry.filename
            archive.writestr(entry.filename,raw)
            records[entry.filename]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        for name,path in sorted(items.items()):
            safe_name(name);assert name not in records
            before={'bytes':path.stat().st_size,'sha256':digest(path)}
            assert before==selected_snapshot[name],'Selected artifact changed before copy: '+name
            # This is a second guard on the explicit task-directory allowlist.
            # Scan only selected textual artifacts and never print matching bytes.
            if path.suffix in {'.json','.jsonl','.txt','.log','.md','.yaml','.yml','.py','.mjs','.csv','.tsv','.sh','.a3m'}:
                msa_checked=path in msa_contexts and msa_scanner(path,msa_contexts[path])
                if not msa_checked:assert not SECRET.search(path.read_bytes()),'Potential credential in selected artifact: '+name
            archive.write(path,name)
            assert before=={'bytes':path.stat().st_size,'sha256':digest(path)},'Artifact changed during archive: '+name
            records[name]=before
        manifest={'schema':'confovhh-round3-evidence-manifest-v1','createdUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
                  'baseArchiveSha256':BASE_SHA,'reportReceipts':reports,'payloadFileCount':len(records),'files':records,
                  'excludedCloudFiles':excluded,'metadataScanProvenance':metadata_scan_provenance,'prospectiveDriverCompletion':completion,
                  'sourceSnapshotPolicy':'All selected file bytes and membership checked before copying and again before archive finalization; callers must stop background writers and keep build stdout outside selected directories.',
                  'exclusionPolicy':'No private SSH keys, host connection keys, Git metadata, Python caches, incomplete transfers, redundant raw transfer tarballs or portable Python environment. All300 raw prediction results, input/MSA/run metadata, canonical coordinates, frozen ranks and available outcomes are included. The separately preserved portable runtime remains bound by its original recovery receipts.'}
        archive.writestr('ROUND3_EVIDENCE_MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
    assert_selection_stable(root,selected_snapshot)
    temporary.rename(output)
    receipt={'schema':'confovhh-round3-archive-receipt-v1','path':output.name,'bytes':output.stat().st_size,'sha256':digest(output),
             'payloadFileCount':len(records),'baseArchiveSha256':BASE_SHA,'builderSha256':digest(Path(__file__)),'reportReceipts':reports}
    target=root/'round3-archive-receipt.json'
    with target.open('x') as stream:json.dump(receipt,stream,indent=2);stream.write('\n')
    print(json.dumps(receipt))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',type=Path,default=ROOT)
    parser.add_argument('--development',type=Path,required=True);parser.add_argument('--prospective',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'confovhh-source-first-ranking-v3.zip');main(parser.parse_args())
