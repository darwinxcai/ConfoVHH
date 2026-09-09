#!/usr/bin/env python3
"""Offline recovery of verified ZIP bytes; never reuse failed extraction parts."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, time, zipfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--plan', type=Path, required=True)
p.add_argument('--deadline-utc', required=True)
a = p.parse_args()
seconds = datetime.fromisoformat(a.deadline_utc.replace('Z', '+00:00')).timestamp()-time.time()
assert 0 < seconds <= 4484.221
deadline = time.monotonic()+min(360, seconds)
root = Path('/workspace/runtime-transport-v2')
root.mkdir(exist_ok=False)
receipt = {'schema':'confovhh.offline-transport-recovery.v2','status':'FAIL','startedAtUtc':datetime.now(timezone.utc).isoformat(),'originalFilesChanged':False,'predictionRequested':False,'parts':[]}

def blocks(f):
    while block := f.read(4*1024*1024):
        if time.monotonic() >= deadline: raise TimeoutError('Transport recovery deadline')
        yield block

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in blocks(f): h.update(block)
    return h.hexdigest()

try:
    rows=json.loads(a.plan.read_text())['parts']
    assert [r['name'] for r in rows]==[f'runtime-bundle.part{i:02d}' for i in range(8)]
    for row in rows:
        archive=Path('/workspace/runtime-transport')/(row['name']+'.zip')
        assert archive.is_file() and not archive.is_symlink()
        assert archive.stat().st_size==row['zipBytes'] and digest(archive)==row['zipSha256']
        temporary=root/(row['name']+'.extracting')
        final=root/row['name']
        with zipfile.ZipFile(archive) as z:
            members=z.infolist()
            assert len(members)==1 and members[0].filename==row['name'] and members[0].file_size==row['bytes']
            with z.open(members[0]) as source, temporary.open('xb') as target:
                for block in blocks(source): target.write(block)
        assert temporary.stat().st_size==row['bytes'] and digest(temporary)==row['sha256']
        temporary.rename(final)
        receipt['parts'].append(dict(row,status='FINAL_FILE_BYTES_VERIFIED'))
        print(json.dumps({'part':row['name'],'status':'FINAL_FILE_BYTES_VERIFIED'}),flush=True)
    archive=Path('/workspace/runtime-bundle.tar')
    h=hashlib.sha256();size=0
    with archive.open('xb') as target:
        for row in rows:
            with (root/row['name']).open('rb') as source:
                for block in blocks(source): target.write(block);h.update(block);size+=len(block)
    assert size==3570472960 and h.hexdigest()=='4a2c2862c100ae1dc49a886b3533b6da23e80678a7323bc450b4946d0d98471f'
    assert digest(archive)==h.hexdigest()
    receipt.update(status='TRANSPORT_ARCHIVE_VERIFIED',archiveBytes=size,archiveSha256=h.hexdigest())
finally:
    receipt['completedAtUtc']=datetime.now(timezone.utc).isoformat()
    (root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
