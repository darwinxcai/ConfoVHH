#!/usr/bin/env python3
"""Bounded source-metadata capture; never requests structures or article bodies."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def capture(name, url, plan):
    assert url == plan['proteinEndpoint'] or re.fullmatch(
        r'https://gpcrdb\.org/services/residues/[a-z0-9_-]+/', url)
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(1, plan['attemptsPerEndpoint'] + 1):
        stem = HERE / 'sources' / (name + '-attempt-' + str(attempt))
        body_path = stem.with_suffix('.body')
        record_path = stem.with_suffix('.json')
        assert not body_path.exists() and not record_path.exists(), 'Refusing to overwrite capture'
        record = {'url': url, 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'captureScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'planSha256': hashlib.sha256((HERE / 'capture-plan.json').read_bytes()).hexdigest()}
        body = b''
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'ConfoVHH-canonical-mGlyR-review/1.0', 'Accept': 'application/json'})
            try:
                response = opener.open(request, timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(plan['maximumResponseBytes'] + 1)
                record.update(status=response.status, finalUrl=response.url, contentType=response.headers.get('Content-Type'))
                if len(body) > plan['maximumResponseBytes']:
                    record['failure'] = 'RESPONSE_EXCEEDS_BOUND'
        except (urllib.error.URLError, TimeoutError) as error:
            record.update(status=None, errorType=type(error).__name__)
        record.update(finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        with body_path.open('xb') as handle:
            handle.write(body)
        with record_path.open('x') as handle:
            handle.write(json.dumps(record, indent=2) + '\n')
        if record['status'] == 200 and 'failure' not in record:
            return json.loads(body)
        if record['status'] not in plan['retryStatuses'] or attempt == plan['attemptsPerEndpoint']:
            raise RuntimeError('BOUND_CAPTURE_BLOCKED:' + str(record['status']))
        time.sleep(0.75)


if __name__ == '__main__':
    (HERE / 'sources').mkdir(exist_ok=True)
    plan = json.loads((HERE / 'capture-plan.json').read_text())
    result = {'schema': 'confovhh-mglyr-canonical-capture-run-v1', 'completedRepeats': 0,
              'status': 'INCOMPLETE', 'nativeCoordinatesAccessed': False,
              'articleBodiesAccessed': False, 'scientificAbsenceAuthority': False}
    try:
        for repeat in range(1, plan['captureCount'] + 1):
            protein = capture('protein-' + str(repeat), plan['proteinEndpoint'], plan)
            assert protein['accession'] == plan['accession'], 'Wrong accession'
            assert protein['species'] == plan['species'], 'Wrong organism'
            assert protein['source'].upper() == 'SWISSPROT', 'Wrong canonical source'
            assert re.fullmatch(r'[a-z0-9_-]+', protein['entry_name']), 'Unsafe entry name'
            assert re.fullmatch(r'[ACDEFGHIKLMNPQRSTVWY]+', protein['sequence']), 'Invalid canonical sequence'
            residues = capture('residues-' + str(repeat), plan['residuesEndpointTemplate'].replace('{entry_name}', protein['entry_name']), plan)
            assert isinstance(residues, list), 'Invalid residue inventory type'
            result['completedRepeats'] += 1
        result['status'] = 'CAPTURE_COMPLETE_PENDING_OFFLINE_SCHEMA_AND_TM_VERIFICATION'
    except (RuntimeError, AssertionError, ValueError, KeyError) as error:
        result['failure'] = str(error)
    with (HERE / 'capture-run.json').open('x') as handle:
        handle.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
