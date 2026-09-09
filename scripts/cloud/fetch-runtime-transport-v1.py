#!/usr/bin/env python3
"""Download individually bounded artifact ZIPs and verify original transport parts."""
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import zipfile

config_path = Path(sys.argv[1])
config = json.loads(config_path.read_text())
config_path.unlink()  # Temporary scoped URLs are not experiment outputs.
root = Path(config['output'])
root.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
remaining = datetime.fromisoformat(config['deadlineUtc'].replace('Z', '+00:00')).timestamp() - time.time()
assert 0 < remaining <= 4484.221, 'Approved cumulative deadline required'
deadline = started + min(600, remaining)

def download(row):
    archive = root / (row['partName'] + '.zip')
    part = root / row['partName']
    def digest(path):
        h = hashlib.sha256()
        with path.open('rb') as f:
            for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Download controller deadline')
                h.update(block)
        return h.hexdigest()
    if part.exists():
        assert part.stat().st_size == row['partBytes'] and digest(part) == row['partSha256']
        return {'part': row['partName'], 'status': 'ALREADY_VERIFIED'}
    if not archive.exists():
        request = urllib.request.Request(row['url'], headers={'User-Agent': 'Mozilla/5.0'})
        h, size = hashlib.sha256(), 0
        temporary = archive.with_suffix('.download')
        try:
            with urllib.request.urlopen(request, timeout=45) as response, temporary.open('wb') as target:
                while block := response.read(4 * 1024 * 1024):
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Download controller deadline')
                    target.write(block)
                    size += len(block)
                    h.update(block)
            assert size == row['zipBytes'] and h.hexdigest() == row['zipSha256'], 'Artifact ZIP identity differs'
            temporary.rename(archive)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Artifact HTTP {error.code}; refresh this part URL if expired') from None
    else:
        assert archive.stat().st_size == row['zipBytes'] and digest(archive) == row['zipSha256']
    with zipfile.ZipFile(archive) as source:
        files = [x for x in source.infolist() if not x.is_dir()]
        assert len(files) == 1 and files[0].filename == row['partName'], 'Unexpected ZIP members'
        assert files[0].file_size == row['partBytes']
        temporary = part.with_suffix('.extracting')
        h, size = hashlib.sha256(), 0
        with source.open(files[0]) as original, temporary.open('wb') as target:
            while block := original.read(4 * 1024 * 1024):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Download controller deadline')
                target.write(block)
                h.update(block)
                size += len(block)
        assert size == row['partBytes'] and h.hexdigest() == row['partSha256'], 'Transport part identity differs'
        temporary.rename(part)
    return {'part': row['partName'], 'status': 'DOWNLOADED_AND_VERIFIED', 'bytes': size, 'sha256': h.hexdigest()}

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = {pool.submit(download, row): row for row in config['parts']}
    for future in concurrent.futures.as_completed(futures):
        try:
            result = future.result()
        except Exception as exc:
            result = {'part': futures[future]['partName'], 'status': 'FAIL', 'error': str(exc)}
        results.append(result)
        print(json.dumps(result), flush=True)
status = 'ALL_TRANSPORT_PARTS_VERIFIED' if all(x['status'] != 'FAIL' for x in results) else 'INCOMPLETE'
receipt = {'status': status, 'parts': results, 'elapsedSeconds': time.monotonic() - started}
(root / ('download-receipt-' + str(int(time.time())) + '.json')).write_text(json.dumps(receipt, indent=2)+'\n')
if status != 'ALL_TRANSPORT_PARTS_VERIFIED':
    raise SystemExit(1)
assert len(config['parts']) == 8
ordered = sorted(config['parts'], key=lambda r: r['partName'])
assert [r['partName'] for r in ordered] == [f'runtime-bundle.part{i:02d}' for i in range(8)]
archive = Path('/workspace/runtime-bundle.tar')
h, size = hashlib.sha256(), 0
with archive.open('xb') as target:
    for row in ordered:
        with (root / row['partName']).open('rb') as source:
            while block := source.read(4 * 1024 * 1024):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Transport assembly deadline')
                target.write(block)
                h.update(block)
                size += len(block)
assert size == 3570472960 and h.hexdigest() == '4a2c2862c100ae1dc49a886b3533b6da23e80678a7323bc450b4946d0d98471f'
receipt.update(status='TRANSPORT_ARCHIVE_VERIFIED', archive=str(archive), archiveBytes=size,
               archiveSha256=h.hexdigest(), elapsedSeconds=time.monotonic()-started,
               completedAtUtc=datetime.now(timezone.utc).isoformat())
(root / 'transport-download-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps(receipt), flush=True)

