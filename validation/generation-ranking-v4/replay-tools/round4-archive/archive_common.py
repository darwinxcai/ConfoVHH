"""Strict portable archive contracts. No scientific outcomes are read on import."""
from __future__ import annotations
import csv
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys

if not __debug__:
    raise RuntimeError('Optimized Python is forbidden for archive verification')
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE_NAME = 'confovhh-source-first-ranking-v3.zip'
BASE_SHA = '707e21e7668e8f0e2fced4c594c508a61f0e6d950e2cbcd52988a815ec0999f0'
MAP_NAME = 'ROUND4-FINAL-ARTIFACT-MAP.json'
MANIFEST_NAME = 'ROUND4_EVIDENCE_MANIFEST.json'
DIRECTORIES = tuple('round4-' + n for n in ('planning', 'benchmark', 'generation', 'reserved-preparation',
    'reserved-generation', 'reserved-review', 'cloud', 'predictions', 'outcomes', 'ranking', 'analysis', 'reporting', 'archive'))
TOP_FILES = (MAP_NAME, 'REPORT-V4.md', 'V4_REPLAY.md')
FORBIDDEN = {'.git', '__pycache__', '.pytest_cache', '.DS_Store', 'private-volume-backups',
    'ssh_ed25519', 'ssh_ed25519.pub', 'known_hosts', 'known_hosts.old', '.env', 'credentials'}
FREEZE_FILES = tuple('round4-archive/' + n for n in ('archive_common.py', 'build_evidence.py',
    'verify_archive.py', 'replay_science.py', 'test_archive.py', 'README.md'))
DEPENDENCY_PINS = {
    'round4-reporting/REPORTING-FREEZE.json': '7d391c58dae4f4275f73b9e381c3b84b4a4d161eff56ffe0e49dd0e0280ee552',
    'round4-reserved-preparation/v2/PREPARATION-FREEZE.json': '5db9c0712580994d9101796347e9d7ab8dff9571094052711a25d5f98e06a3a9',
}
SECRET = re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])|hf_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|https?://[^\s/:]+:[^\s/@]+@')
NON_AWS_SECRET = re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|hf_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|https?://[^\s/:]+:[^\s/@]+@')
PROTEIN = re.compile(r'[ACDEFGHIKLMNPQRSTVWYBXZJUOacdefghiklmnpqrstvwybxzjuo.*-]+')
# This unchanged, independently reviewed test deliberately contains one all-A
# dummy access-key identifier. Exact source bytes and the sole match are checked;
# neither filenames alone nor arbitrary test files receive an exception.
REVIEWED_SYNTHETIC_FIXTURE = {
    'path': 'round4-outcomes/review_archive_controls.py',
    'bytes': 2970,
    'sha256': 'a03dcd0daab92f084974d53ac2d9bc52eb4598876632507ee180a0f0b6fd35e2',
}

def check(value, message):
    if not value:
        raise ValueError(message)

def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def packed(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()

def strict(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            check(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    def reject(value):
        raise ValueError('Nonfinite JSON constant')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject)

def load(path):
    return strict(Path(path).read_bytes())

def safe_relative(name):
    check(type(name) is str and name and '\\' not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'Unsafe archive path')
    p = PurePosixPath(name)
    check(not p.is_absolute() and '..' not in p.parts and p.as_posix() == name and name not in ('.', '..'), 'Noncanonical archive path')
    check(not re.match(r'^[A-Za-z]:', name) and not set(p.parts) & FORBIDDEN, 'Forbidden archive path')
    return p

def regular(root, name):
    safe_relative(name)
    p = Path(root) / name
    check(p.resolve() == p and p.is_file() and not p.is_symlink(), 'Missing or indirect archive artifact: ' + name)
    check(stat.S_ISREG(p.stat().st_mode), 'Nonregular archive artifact')
    return p

def binding(root, path):
    p = Path(path)
    name = p.relative_to(root).as_posix()
    regular(root, name)
    return {'path': name, 'bytes': p.stat().st_size, 'sha256': sha(p)}

def binding_shape(b):
    check(type(b) is dict and set(b) == {'path', 'bytes', 'sha256'}, 'Invalid file binding')
    safe_relative(b['path'])
    check(type(b['bytes']) is int and b['bytes'] >= 0 and type(b['sha256']) is str and re.fullmatch('[a-f0-9]{64}', b['sha256']), 'Invalid bound size/digest')

def bound(root, b, files=None):
    binding_shape(b)
    expected = {k: b[k] for k in ('bytes', 'sha256')}
    if files is not None:
        check(files.get(b['path']) == expected, 'Binding is not an exact archive manifest member')
    p = regular(root, b['path'])
    check(p.stat().st_size == b['bytes'] and sha(p) == b['sha256'], 'Bound artifact changed: ' + b['path'])
    return p

def all_bindings(value):
    if type(value) is dict:
        if set(value) == {'path', 'bytes', 'sha256'}:
            yield value
        else:
            for item in value.values():
                yield from all_bindings(item)
    elif type(value) is list:
        for item in value:
            yield from all_bindings(item)

def validate_dependency_freezes(root, freeze, files=None):
    dependencies = freeze['dependencies']
    check(type(dependencies) is list and len(dependencies) == len(DEPENDENCY_PINS) and
          {b['path'] for b in dependencies} == set(DEPENDENCY_PINS), 'Archive dependency freeze roster differs')
    for b in dependencies:
        check(b['sha256'] == DEPENDENCY_PINS[b['path']], 'Archive dependency pin differs')
        document = load(bound(root, b, files))
        if b['path'] == 'round4-reporting/REPORTING-FREEZE.json':
            own = document['files']
            check({'round4-reporting/report_common.py', 'round4-reporting/select_final.py', 'round4-reporting/summarize_reserved.py'} <=
                  {x['path'] for x in own}, 'Reporting executable dependency missing')
            for x in own: bound(root, x, files)
            # These exact nested method freezes are pinned by the reporting freeze.
            for x in document['dependencies']:
                path = bound(root, x, files)
                if path.suffix == '.json':
                    nested = load(path)
                    for item in nested.get('files', []): bound(root, item, files)
        else:
            check({'capture_inputs.py', 'build_bundle.py', 'test_capture_inputs.py'} <=
                  {x['path'] for x in document['artifacts']}, 'Capture executable dependency missing')
            for x in document['artifacts']:
                # The redundant upload tarball is separately hash-bound but is
                # intentionally not a replay dependency or compact archive member.
                if x['path'].endswith('.tar.gz'): continue
                item = {**x, 'path': 'round4-reserved-preparation/v2/' + x['path']}
                bound(root, item, files)

def validate_final_map(root, m, files=None):
    keys = {'schema', 'status', 'authorizeArchive', 'artifactsQuiescent', 'baseArchive', 'archiveImplementationFreeze',
        'development', 'reserved', 'initialDevelopment', 'combinedDevelopment', 'reservedCapture', 'reporting', 'scientificClaims'}
    check(type(m) is dict and set(m) == keys and m['schema'] == 'confovhh-round4-final-artifact-map-v1', 'Wrong final artifact map')
    check(m['status'] == 'COMPLETE' and m['authorizeArchive'] is True and m['artifactsQuiescent'] is True, 'Root final authorization/quiescence absent')
    check(m['scientificClaims'] == {'independentGeneralizationEstablished': False, 'productionPromotion': False}, 'Unsupported scientific claim')
    base = m['baseArchive']; binding_shape(base)
    check(base['path'] == BASE_NAME and base['sha256'] == BASE_SHA, 'Wrong unchanged base archive')
    for role, count in [('development', 900), ('reserved', m['reserved'].get('planned'))]:
        row = m[role]
        check(set(row) == {'planned', 'cohort', 'sourceRankingReceipt', 'outcomeReceipt'}, 'Cohort final-map fields differ')
        check(type(row['planned']) is int and row['planned'] == count and (role != 'reserved' or count in (75, 100)), 'Wrong attempt denominator')
    initial = m['initialDevelopment']
    check(set(initial) == {'planned', 'fitReceipt', 'independentFitReceipt'} and initial['planned'] == 300, 'Authoritative initial300 fit evidence required')
    combined = m['combinedDevelopment']
    check(set(combined) == {'planned', 'status', 'joinReceipt', 'fitReceipt', 'independentFitReceipt', 'incompleteDisposition'}, 'Wrong combined disposition')
    check(combined['planned'] == 1200 and combined['status'] in ('COMPLETE_FIT', 'INCOMPLETE_GENERATED_OUTCOMES'), 'Wrong combined1200 status')
    if combined['status'] == 'COMPLETE_FIT':
        check(combined['fitReceipt'] is not None and combined['independentFitReceipt'] is not None and combined['incompleteDisposition'] is None, 'Complete combined fit lacks evidence')
    else:
        check(combined['fitReceipt'] is None and combined['independentFitReceipt'] is None and combined['incompleteDisposition'] is not None, 'Incomplete combined data cannot claim a fit')
    cap = m['reservedCapture']
    check(set(cap) == {'bundleRoot', 'outputRoot', 'completeReceipt'}, 'Wrong capture binding')
    for key in ('bundleRoot', 'outputRoot'):
        p = safe_relative(cap[key]); check(p.parts[0] in DIRECTORIES, 'Capture outside scientific tree')
    check(set(m['reporting']) == {'selectionReceipt', 'reservedSummaryReceipt', 'finalPolicy', 'reports'}, 'Required reports/policy missing')
    check(len(m['reporting']['reports']) == 2 and {b['path'] for b in m['reporting']['reports']} == {'REPORT-V4.md', 'V4_REPLAY.md'}, 'Both final report files required')
    for b in all_bindings({k: v for k, v in m.items() if k != 'baseArchive'}):
        bound(root, b, files)
    freeze = load(bound(root, m['archiveImplementationFreeze'], files))
    check(freeze.get('schema') == 'confovhh-round4-archive-tools-freeze-v1' and freeze.get('newOutcomesRead') is False, 'Wrong archive implementation freeze')
    check(len(freeze['files']) == len(FREEZE_FILES) and {b['path'] for b in freeze['files']} == set(FREEZE_FILES), 'Incomplete archive implementation roster')
    for b in freeze['files']:
        bound(root, b, files)
    validate_dependency_freezes(root, freeze, files)
    for b in m['reporting']['reports']:
        text = bound(root, b, files).read_text()
        check(not re.search(r'\bFINAL_[A-Z0-9_]+\b', text), 'Final report placeholders remain')
        check(not re.search(r'^\*\*Assembly status:.*\b(?:pending|draft)\b', text, re.I | re.M), 'Report assembly unfinished')
    return m

def phase_receipts(root, m, files=None):
    """Check genuine terminal membership before packaging; replay later is stronger."""
    for role in ('development', 'reserved'):
        item = m[role]; cohort = load(bound(root, item['cohort'], files))
        source = load(bound(root, item['sourceRankingReceipt'], files))
        outcome = load(bound(root, item['outcomeReceipt'], files))
        count = item['planned']; ids = cohort['plannedIds']
        check(cohort['evaluationRole'] == role and len(ids) == len(set(ids)) == count, 'Cohort terminal roster differs')
        check(source['schema'] == 'confovhh-round4-source-ranking-receipt-v1' and source['snapshot'] is False,
              'Final nonsnapshot source seal required')
        check(source['evaluationRole'] == ('development' if role == 'development' else 'reserved-evaluation') and source['plannedCount'] == count,
              'Source role/denominator differs')
        table = load(bound(root, source['predictionTable'], files))
        check(len(table['rows']) == count and {r['id'] for r in table['rows']} == set(ids) and
              all(r['producerStatus'] in ('generated', 'failed') for r in table['rows']), 'Unfinished or missing planned attempt')
        check(outcome['schema'] == 'confovhh-round4-outcome-receipt-v1' and outcome['evaluationRole'] == role and
              outcome['plannedCount'] == count and outcome['evaluatedCount'] + outcome['unavailableCount'] == count and
              outcome['allPlannedIdsRetained'] is True and outcome['explicitReleaseChecked'] is True, 'Outcome terminal ledger incomplete')
        om = load(bound(root, outcome['outcomeMap'], files))
        check(om['cohort'] == item['cohort'] and len(om['rows']) == count and {r['id'] for r in om['rows']} == set(ids), 'Outcome roster/cohort differs')
        request = load(bound(root, outcome['request'], files))
        check(request['sourceRankingReceipt'] == item['sourceRankingReceipt'], 'Outcome/source crossbinding differs')
    combined = m['combinedDevelopment']; join = load(bound(root, combined['joinReceipt'], files))
    check(join['schema'] == 'confovhh-round4-combined-development-join-receipt-v1' and join['planned'] == 1200 and
          join['reservedOutcomesRead'] is False, 'Combined development join missing')
    if combined['status'] == 'COMPLETE_FIT':
        check(join['fitEligible'] is True and join['status'] == 'READY_FOR_SEPARATE_FIT_RELEASE', 'Incomplete outcomes cannot authorize fit')
    else:
        check(join['fitEligible'] is False and join['status'] == 'INCOMPLETE_GENERATED_OUTCOMES', 'Incomplete disposition not supported by join')
    for item, count in [(m['initialDevelopment'], 300)] + ([(combined, 1200)] if combined['status'] == 'COMPLETE_FIT' else []):
        fit = load(bound(root, item['fitReceipt'], files)); audit = load(bound(root, item['independentFitReceipt'], files))
        check(fit['schema'] == 'confovhh-round4-ranking-execution-receipt-v1' and fit['status'] == 'COMPLETE' and fit['planned'] == count,
              'Fit phase incomplete or wrong denominator')
        check(audit['schema'] == 'confovhh-round4-independent-fit-verification-v2' and audit['status'] == 'PASS' and
              audit['planned'] == count and audit['fitReceipt'] == item['fitReceipt'], 'Independent fit evidence differs')
    selection = load(bound(root, m['reporting']['selectionReceipt'], files))
    complete_fit = combined['status'] == 'COMPLETE_FIT'
    check(selection.get('schema') == ('confovhh-round4-final-selection-receipt-v1' if complete_fit else 'confovhh-round4-incomplete-selection-receipt-v1') and
          selection.get('status') == ('COMPLETE_EXPLORATORY_SELECTION' if complete_fit else 'SOURCE_BASELINE_PRESERVED_INCOMPLETE_DEVELOPMENT'),
          'Final selection disposition differs')
    check(selection['combinedJoinReceipt'] == combined['joinReceipt'] and selection['fitReceipt'] == combined['fitReceipt'] and
          selection['fitVerification'] == combined['independentFitReceipt'], 'Selection/combined evidence crossbinding differs')
    generation = load(bound(root, selection['generationAnalysisReceipt'], files))
    check(generation['sourceRankingReceipt'] == m['development']['sourceRankingReceipt'] and
          generation['outcomeReceipt'] == m['development']['outcomeReceipt'], 'Selection used other new900 evidence')
    if not complete_fit:
        check(selection['selectedModel'] is None, 'Incomplete development cannot select a learned model')
        disposition = load(bound(root, combined['incompleteDisposition'], files))
        check(disposition['schema'] == 'confovhh-round4-incomplete-source-disposition-v1' and
              disposition['completedCombinedFit'] is False and disposition['sourceWonComparisonClaim'] is False and
              disposition['selectedModel'] is None and disposition['generatedOutcomesUnavailable'], 'Incomplete disposition lost its limitations')
        check(combined['incompleteDisposition'] in selection['files'], 'Incomplete disposition is not the saved selection output')
    report = load(bound(root, m['reporting']['reservedSummaryReceipt'], files))
    check(report['schema'] == 'confovhh-round4-reserved-summary-receipt-v1' and report['status'] in ('COMPLETE_DESCRIPTIVE_SUMMARY', 'NEEDS_ATTENTION'),
          'Reserved summary phase unfinished')
    for key, expected in [('selectionReceipt', m['reporting']['selectionReceipt']), ('finalPolicyFreeze', m['reporting']['finalPolicy']),
                          ('sourceRankingReceipt', m['reserved']['sourceRankingReceipt']), ('outcomeReceipt', m['reserved']['outcomeReceipt']),
                          ('cohort', m['reserved']['cohort'])]:
        check(report[key] == expected, 'Reserved report phase crossbinding differs: ' + key)
    check(report['counts']['planned'] == m['reserved']['planned'] and report['allPlannedAttemptsRetained'] is True,
          'Reserved report denominator differs')
    return {'development': 900, 'reserved': m['reserved']['planned'], 'combinedDevelopment': combined['status']}

def excluded(name):
    p = PurePosixPath(name)
    if set(p.parts) & FORBIDDEN or p.name.endswith(('.partial', '.part', '.pyc')):
        return True
    if any(part in ('cache', '.cache', 'recovery-archives', 'transport-archives') for part in p.parts):
        return p.suffix in ('.gz', '.zip', '.tar', '.pt', '.ckpt', '.pkl') or 'cache' in p.parts or '.cache' in p.parts
    if p.name == 'confovhh-env-v2.tar.gz' or p.suffix in ('.ckpt', '.pt'):
        return True
    # Raw public MSA server replies remain part of authenticated capture evidence.
    if p.name.endswith(('.tar.gz', '.tgz', '.tar', '.zip')):
        return not (p.name == 'out.tar.gz' and 'captured' in p.parts and 'msa' in p.parts)
    return False

def selected(root, directories=DIRECTORIES, top_files=TOP_FILES):
    items = {}; omitted = []
    for name in directories:
        folder = root / name
        check(folder.resolve() == folder and folder.is_dir(), 'Required scientific directory absent/indirect: ' + name)
        for p in folder.rglob('*'):
            rel = p.relative_to(root).as_posix()
            if excluded(rel):
                if p.is_file() or p.is_symlink(): omitted.append(rel)
                continue
            check(not p.is_symlink(), 'Indirect selected artifact: ' + rel)
            if p.is_file():
                regular(root, rel); items[rel] = p
            else:
                check(p.is_dir(), 'Special selected artifact: ' + rel)
    for name in top_files:
        items[name] = regular(root, name)
    check(len({p.casefold() for p in items}) == len(items), 'Case-insensitive archive path collision')
    return items, sorted(omitted)

def snapshot(items):
    return {name: {'bytes': p.stat().st_size, 'sha256': sha(p)} for name, p in sorted(items.items())}

def unchanged(root, expected):
    items, _ = selected(root)
    check(snapshot(items) == expected, 'Selected membership/bytes changed; artifacts must be quiescent')

def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); sys.modules[name] = value
    spec.loader.exec_module(value)
    return value

def public_msa_proofs(root, m):
    """Only hashes explicitly bound by sequence/MSA capture metadata get special parsing."""
    proofs = {}
    def add(path, b, provenance):
        check(path.stat().st_size == b['bytes'] and sha(path) == b['sha256'], 'MSA provenance hash differs')
        if path.suffix in ('.csv', '.a3m'):
            proofs.setdefault((b['bytes'], b['sha256']), []).append(provenance)
    for role in ('development', 'reserved'):
        cohort = load(bound(root, m[role]['cohort']))
        planpath = bound(root, cohort['generationPlan']); plan = load(planpath)
        check(plan['nativeCoordinateInputs'] == [] and plan['sourceCommit'] == 'b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc', 'MSA producer source differs')
        for target in plan['targets']:
            for b in target['capturedFiles']:
                p = bound(planpath.parent, b)
                check(PurePosixPath(b['path']).parts[:2] == ('captured', target['id']), 'MSA captured target differs')
                add(p, b, {'kind': 'frozen-generation-capture', 'plan': cohort['generationPlan'], 'targetId': target['id'], 'member': b})
    cap = m['reservedCapture']; bundle = root / cap['bundleRoot']; output = root / cap['outputRoot']
    plan = load(regular(bundle, 'capture-plan.json')); complete = load(bound(root, cap['completeReceipt']))
    check(complete['status'] == 'PASS' and complete['molecularPredictionsRun'] == 0 and complete['planSha256'] == sha(bundle/'capture-plan.json'), 'Reserved capture incomplete')
    check(len(complete['receipts']) == len(plan['targets']) == 3, 'Reserved capture panel differs')
    receipts = {Path(b['path']).name: b for b in complete['receipts']}
    for t in plan['targets']:
        b = receipts[t['id'] + '.CAPTURE-RECEIPT.json']; r = load(bound(output, b))
        check(r['status'] == 'PASS' and r['planSha256'] == complete['planSha256'] and r['input'] == t['input'], 'Capture provenance differs')
        check(r['capture']['allInputCoordinatesZero'] is True and r['capture']['allTemplatesAndRestraintsAbsent'] is True, 'Capture purity evidence absent')
        for f in r['capture']['files']:
            p = bound(output/'captured'/t['id'], f)
            add(p, f, {'kind': 'reserved-capture', 'captureReceipt': binding(root, output/b['path']), 'targetId': t['id'], 'member': f})
    return proofs

def scan_file(path, identity, msa_proofs):
    fixture = REVIEWED_SYNTHETIC_FIXTURE
    if (tuple(path.parts[-2:]) == tuple(PurePosixPath(fixture['path']).parts) and
            identity == {k: fixture[k] for k in ('bytes', 'sha256')}):
        raw = path.read_bytes()
        check(len(raw) == fixture['bytes'] and hashlib.sha256(raw).hexdigest() == fixture['sha256'],
              'Reviewed synthetic credential fixture bytes changed')
        matches = list(SECRET.finditer(raw))
        check(len(matches) == 1 and matches[0].group() == b'AK' + b'IA' + b'A' * 16,
              'Reviewed synthetic credential fixture match differs')
        return {'formatAwarePublicMsa': False, 'reviewedSyntheticCredentialFixture': dict(fixture)}
    evidence = msa_proofs.get((identity['bytes'], identity['sha256']))
    is_csv = path.parent.name == 'msa' and re.fullmatch(r'[A-Za-z0-9_-]+_\d+\.csv', path.name)
    is_a3m = path.name in {'pair.a3m', 'uniref.a3m', 'bfd.mgnify30.metaeuk30.smag30.a3m'}
    if evidence and (is_csv or is_a3m):
        def check_text(text, sequence=False):
            pattern = NON_AWS_SECRET if sequence and len(text) > 20 and PROTEIN.fullmatch(text) else SECRET
            check(not pattern.search(text.encode()), 'Potential credential in authenticated MSA field; content withheld')
        with path.open(encoding='utf-8', newline='') as f:
            if is_csv:
                reader = csv.DictReader(f); check(reader.fieldnames == ['key', 'sequence'], 'Unexpected MSA CSV schema')
                for row in reader:
                    check(set(row) == {'key', 'sequence'} and all(type(v) is str for v in row.values()), 'Malformed MSA CSV')
                    check_text(row['key']); check_text(row['sequence'], True)
            else:
                header = False
                for line in f:
                    text = line.rstrip('\r\n')
                    if text.startswith('>'): header = True; check_text(text)
                    elif text: check_text(text, True)
                check(header, 'Malformed MSA A3M')
        return {'formatAwarePublicMsa': True, 'provenance': evidence}
    prior = b''
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            check(not SECRET.search(prior + block), 'Potential credential in selected artifact; content withheld')
            prior = block[-512:]
    return {'formatAwarePublicMsa': False}
