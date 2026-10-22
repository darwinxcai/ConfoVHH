#!/usr/bin/env python3
"""Capture public metadata or publication text without rendering source bodies."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent


def capture(item):
    name, url = item
    destination = ROOT / 'sources' / (name + '.body')
    if destination.exists():
        raise RuntimeError('Immutable capture exists: ' + name)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    request = urllib.request.Request(url, headers={'User-Agent': 'ConfoVHH-public-metadata-audit/1.0', 'Accept': 'application/json, application/xml, text/html;q=0.8'})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            body = response.read()
            status, headers, final_url = response.status, dict(response.headers), response.url
    except urllib.error.HTTPError as error:
        body = error.read()
        status, headers, final_url = error.code, dict(error.headers), error.url
    except Exception as error:
        body = b''
        status, headers, final_url = None, {}, url
        headers['capture-error'] = type(error).__name__ + ': ' + str(error)
    destination.write_bytes(body)
    record = dict(id=name, url=url, finalUrl=final_url, method='GET', startedAt=started,
                  finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), status=status,
                  headers=headers, file=destination.relative_to(ROOT).as_posix(), bytes=len(body),
                  sha256=hashlib.sha256(body).hexdigest())
    (ROOT / 'sources' / (name + '.capture.json')).write_text(json.dumps(record, indent=2) + '\n')
    return {key: record[key] for key in ('id', 'status', 'bytes', 'sha256')}


if __name__ == '__main__':
    import sys
    requests = json.loads(Path(sys.argv[1]).read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        print(json.dumps(list(pool.map(capture, requests)), indent=2))
