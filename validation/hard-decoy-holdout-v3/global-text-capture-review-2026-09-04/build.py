"""Replay a source-epoch attestation without changing the captured evidence."""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
PACKET = pathlib.Path(__file__).resolve().parent
CAPTURE = ROOT / 'validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read(name):
    return json.loads((CAPTURE / name).read_bytes())

def build():
    manifest = read('manifest.json')
    correction = read('provenance/adapter-correction.json')
    original_stems = {
        f'metadata-{batch:03d}-repeat-{repeat}'
        for batch in [1, 2, 3, 5] for repeat in [1, 2]
    }
    initial_failed_stems = {
        'metadata-004-repeat-1-attempt-1',
        'metadata-004-repeat-2-attempt-1',
        'metadata-006-repeat-1-attempt-1',
    }
    rows = []
    inputs = {}
    for name in ['manifest.json', 'summary.json', 'discovery-plan.json', 'continuation-plan.json', 'provenance/adapter-correction.json', 'provenance/capture-generator-original.mjs', 'provenance/capture-generator-corrected.mjs', 'provenance/finalization-code.json']:
        inputs[name] = digest((CAPTURE / name).read_bytes())
    for request in manifest['requests']:
        name = request['captureFile']
        record = read(name)
        original = request['kind'] == 'search' or request['stem'] in original_stems
        rows.append({
            'captureFile': name,
            'captureRecordSha256': digest((CAPTURE / name).read_bytes()),
            'rawFile': record['rawFile'],
            'rawSha256': record['responseSha256'],
            'success': True,
            'epoch': 'ORIGINAL' if original else 'CONTINUATION',
        })
    for record in manifest['failedRequests']:
        stem = pathlib.Path(record['failureRawFile']).name.removesuffix('-body.json')
        name = f'failures/{stem}-capture.json'
        rows.append({
            'captureFile': name,
            'captureRecordSha256': digest((CAPTURE / name).read_bytes()),
            'rawFile': record['failureRawFile'],
            'rawSha256': record['responseSha256'],
            'success': False,
            'epoch': 'ORIGINAL' if stem in initial_failed_stems else 'CONTINUATION',
        })
    rows.sort(key=lambda row: row['captureFile'])
    assert sum(row['success'] and row['epoch'] == 'ORIGINAL' for row in rows) == 172
    assert sum(not row['success'] and row['epoch'] == 'ORIGINAL' for row in rows) == 3
    for row in rows:
        assert row['rawSha256'] == digest((CAPTURE / row['rawFile']).read_bytes())
    summary = read('summary.json')
    result = {
        'schemaVersion': '1.0.0',
        'status': 'EXECUTION_HISTORY_ATTESTATION_WITH_REPLAYABLE_FILE_BINDINGS',
        'method': 'The executing agent recorded that all 164 search responses and metadata batches 1, 2, 3, 5 in both repeats completed before the citation-title adapter was introduced. Three initial failed captures are named explicitly. Remaining responses were captured by the continuation. The chronology is an execution-history attestation; cryptographic file integrity and normalized replay are independently verifiable, while hashes alone do not prove which process executed a request.',
        'scopeChronology': 'Preliminary count probes preceded scope selection. The three nonphrase-term metadata scope was set after those counts and before complete repeated ID-set capture. It is not a prospective preregistration before any query result was seen.',
        'searchDocumentation': 'https://search.rcsb.org/#basic-search',
        'searchInterpretation': 'RCSB documents full_text as an unstructured search across searchable text attributes. Quoting has documented query semantics but does not establish biological specificity. Broad counts are retained as observations, without inferring which particular tokenization behavior caused each hit.',
        'originalScriptSha256': correction['originalScriptSha256'],
        'continuationScriptSha256': correction['correctedScriptSha256'],
        'finalizerScriptSha256': read('provenance/finalization-code.json')['finalizerScriptSha256'],
        'finalizerNetworkAccess': False,
        'finalizerVerification': 'All successful captures existed before finalization. Finalization completed with fetchImpl replaced by a function that throws on every network request. Its sole operational fix raises local aggregate-file reads to 64 MiB; per-response HTTP and parser limits remain 16 MiB.',
        'inputDigests': inputs,
        'responses': rows,
        'successfulOriginalResponseCount': 172,
        'successfulContinuationResponseCount': sum(row['success'] and row['epoch'] == 'CONTINUATION' for row in rows),
        'initialFailedResponseCount': 3,
        'continuationFailedResponseCount': sum(not row['success'] and row['epoch'] == 'CONTINUATION' for row in rows),
        'selectedMetadataEntryCount': summary['capturedEntryCount'],
        'phraseOnlyNewEntriesPendingCount': summary['phraseOnlyNewEntriesPendingCount'],
        'sourceCaptureReplayRequiredSeparately': True,
        'broaderDiscoveryComplete': False,
        'formalDispositionAssigned': False,
        'formalProtocolStatus': 'DRAFT',
        'targetFreezeGate': 'BLOCKED',
        'wholeCensusComponentUpperBound': None,
    }
    return (json.dumps(result, indent=2) + '\n').encode()

def main():
    expected = build()
    note = PACKET / 'epoch-attestation.json'
    if sys.argv[1:] == ['verify']:
        assert note.read_bytes() == expected, 'Epoch attestation does not reconstruct'
        for line in (PACKET / 'checksums.sha256').read_text().splitlines():
            expected_sha, name = line.split('  ', 1)
            assert digest((PACKET / name).read_bytes()) == expected_sha
        assert sorted(p.name for p in PACKET.iterdir()) == ['README.md', 'build.py', 'checksums.sha256', 'epoch-attestation.json']
        print('Epoch attestation and exact inventory verified')
    elif sys.argv[1:] == ['build']:
        note.write_bytes(expected)
        files = ['README.md', 'build.py', 'epoch-attestation.json']
        (PACKET / 'checksums.sha256').write_text(''.join(f'{digest((PACKET / name).read_bytes())}  {name}\n' for name in files))
    else:
        raise SystemExit('Usage: python3 -B build.py build|verify')

if __name__ == '__main__':
    main()
