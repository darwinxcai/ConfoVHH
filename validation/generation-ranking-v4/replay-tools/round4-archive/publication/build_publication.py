"""Stage a compact review payload only from a fully verified fresh v4 archive.

No Git/API operation, prediction, metric calculation, or fitting is performed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

if not __debug__:
    raise RuntimeError('Optimized Python is forbidden for publication authentication')
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PREFIX = 'validation/generation-ranking-v4'
SCRIPT_PREFIX = 'scripts/external-ranking-v4'
BASE_HEAD = '5378ea1e028b6c3fedcbeff70faf793d8f5e1559'
BASE_ARCHIVE_SHA = '707e21e7668e8f0e2fced4c594c508a61f0e6d950e2cbcd52988a815ec0999f0'
ARCHIVE_FREEZE_SHA = '5d17525f28fafefd7761884c1f17c6a4008c46c8c6e7a82afd1259d3e5d85100'
VERIFIER_SHA = 'e36de8a36feaddf92f2354608528eb312aec1d52b4d5831f55c72a56af529c2e'
MANIFEST = 'ROUND4_EVIDENCE_MANIFEST.json'
FINAL_MAP = 'ROUND4-FINAL-ARTIFACT-MAP.json'
OWN_FILES = tuple('round4-archive/publication/' + n for n in ('build_publication.py', 'test_publication.py', 'README.md'))
PORTABLE = ('ranker.py', 'artifacts.py', 'run.py', 'test_ranker.py', 'README.md')
SUFFIXES = {'.py', '.mjs', '.md', '.json', '.csv', '.svg', '.txt'}
FORBIDDEN = {'.git', 'ConfoVHH', 'private-volume-backups', '.env', 'credentials', 'ssh_ed25519',
             'ssh_ed25519.pub', 'known_hosts', 'cache', '.cache', '__pycache__', 'raw', 'reserved-raw',
             'captured', 'public-sources', 'reference-views', 'round4-cloud'}
SECRET = re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])|hf_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|https?://[^\s/:]+:[^\s/@]+@')
FIXED = (
    'round4-planning/PLAN.md', 'round4-planning/ANALYSIS-DECISIONS.md',
    'round4-planning/ANALYSIS-DECISIONS-FREEZE.json', 'round4-planning/FEATURE-OUTCOME-ACCEPTED.json',
    'round4-planning/RESERVED-ENROLLMENT-ACCEPTED.json',
    'round4-benchmark/README.md', 'round4-benchmark/ENROLLMENT.freeze.json',
    'round4-benchmark/development-group-map.json', 'round4-benchmark/QUALIFICATION-RECEIPT.json',
    'round4-benchmark/eligibility-ledger.json', 'round4-benchmark/eligibility-ledger.csv',
    'round4-benchmark/candidate-nb-sequence-audit.json', 'round4-benchmark/development-selected-nb-audit.json',
    'round4-benchmark/construct-reconciliation-and-corrections.json',
    'round4-benchmark/native-context-and-reference-coverage.json', 'round4-benchmark/assembly-identity-validation.json',
    'round4-benchmark/reference-view-inventory.json',
    'round4-generation/PROTOCOL.md', 'round4-generation/bundle/GENERATION-FREEZE.json',
    'round4-generation/bundle/batch-plan.json', 'round4-generation/INPUT-QUALIFICATION.json',
    'round4-ranking/PROTOCOL-DRAFT.md', 'round4-ranking/IMPLEMENTATION-FREEZE.json',
    'round4-ranking/IMPLEMENTATION-FREEZE-V2.json', 'round4-ranking/FEATURE-ADAPTER-FREEZE.json',
    'round4-ranking/COMBINED-DEVELOPMENT-TOOLS-FREEZE.json', 'round4-analysis/ANALYZER-FREEZE.json',
    'round4-outcomes/IMPLEMENTATION-FREEZE.json', 'round4-outcomes/reference-inventory.json',
    'round4-reporting/REPORTING-FREEZE.json', 'round4-archive/IMPLEMENTATION-FREEZE.json',
    'round4-outcomes/ARCHIVE-INDEPENDENT-REVIEW.json', 'round4-outcomes/REPORTING-INDEPENDENT-REVIEW.json',
    'round4-outcomes/GENERATION-ANALYSIS-REVIEW.json', 'round4-outcomes/COMBINED-DEVELOPMENT-REVIEW.json',
    'round4-ranking/OUTCOME-PREPARATION-REVIEW.json', 'round4-ranking/GENERATION-REVIEW.json',
    'round4-archive/packaging-correction-20260925/ROOT-RELEASE.json',
    'round4-archive/packaging-correction-20260925/STRUCTURAL-REVIEW.json',
    'round4-archive/packaging-correction-20260925/ORIGINALS.json',
    'round4-archive/packaging-correction-20260925/round4-archive-scan-diagnostic.json',
)
TOOLS = (
    'round4-ranking/ranker.py', 'round4-ranking/artifacts.py', 'round4-ranking/run.py',
    'round4-ranking/prepare_features.py', 'round4-ranking/combine_development.py',
    'round4-ranking/verify_fit_independent_v2.py', 'round4-ranking/test_ranker.py',
    'round4-ranking/test_prepare_features.py', 'round4-ranking/test_combine_development.py',
    'round4-ranking/test_verify_fit_independent_v2.py', 'round4-ranking/README.md',
    'round4-outcomes/prepare_predictions.py', 'round4-outcomes/outcome_adapter.py',
    'round4-outcomes/test_preparation.py', 'round4-outcomes/test_outcomes.py', 'round4-outcomes/README.md',
    'round4-analysis/analyze_generation.py', 'round4-analysis/test_analyze_generation.py', 'round4-analysis/README.md',
    'round4-analysis/figures/plot_results.py', 'round4-reporting/select_final.py',
    'round4-reporting/summarize_reserved.py', 'round4-reporting/report_common.py',
    'round4-reporting/test_reporting.py', 'round4-reporting/README.md',
    'round4-benchmark/explicit_mmcif_metric.py', 'round4-benchmark/test_explicit_mmcif_metric.py',
    'round3-benchmark/scoring-view/canonicalize_view.py', 'round3-control/prepare_prediction_scoring.py',
    'round3-benchmark/outcome-tools/outcome_adapter.py',
    'round4-archive/archive_common.py', 'round4-archive/build_evidence.py',
    'round4-archive/verify_archive.py', 'round4-archive/replay_science.py',
    'round4-archive/test_archive.py', 'round4-archive/README.md', *OWN_FILES,
)


def need(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False, ensure_ascii=False) + '\n').encode()


def strict(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, 'Duplicate JSON key'); out[key] = value
        return out
    def invalid(_):
        raise ValueError('Nonfinite JSON value')
    def finite_float(text):
        value = float(text)
        need(math.isfinite(value), 'Nonfinite JSON value')
        return value
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid, parse_float=finite_float)


def relative(name):
    need(type(name) is str and name and '\\' not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'Unsafe path')
    p = PurePosixPath(name)
    need(not p.is_absolute() and '..' not in p.parts and p.as_posix() == name and name != '.' and not re.match(r'^[A-Za-z]:', name), 'Noncanonical path')
    return p


def regular(root, name):
    relative(name); p = root / name
    need(p.resolve() == p and p.is_file() and not p.is_symlink() and stat.S_ISREG(p.stat().st_mode), 'Missing or indirect file: ' + name)
    return p


def identity(path):
    return {'bytes': path.stat().st_size, 'sha256': sha(path)}


def shape(b):
    need(type(b) is dict and set(b) == {'path', 'bytes', 'sha256'}, 'Binding fields differ')
    relative(b['path'])
    need(type(b['bytes']) is int and b['bytes'] >= 0 and type(b['sha256']) is str and re.fullmatch('[0-9a-f]{64}', b['sha256']), 'Invalid binding digest/size')


def bound(root, b, manifest=None):
    shape(b); expected = {k: b[k] for k in ('bytes', 'sha256')}
    if manifest is not None:
        need(manifest.get(b['path']) == expected, 'Binding is not an exact manifest member')
    path = regular(root, b['path']); need(identity(path) == expected, 'Bound bytes changed: ' + b['path'])
    return path


def bindings(value):
    if type(value) is dict:
        if set(value) == {'path', 'bytes', 'sha256'}:
            yield value
        else:
            for v in value.values(): yield from bindings(v)
    elif type(value) is list:
        for v in value: yield from bindings(v)


def metadata_file(name):
    p = relative(name)
    need(not set(p.parts) & FORBIDDEN and p.suffix in SUFFIXES and not p.name.endswith(('.partial', '.part')), 'Forbidden compact source: ' + name)


def validate_replay(replay, final_map):
    need(replay['schema'] == 'confovhh-round4-extracted-scientific-replay-v1' and replay['status'] == 'PASS', 'Scientific replay has not passed')
    need(replay['numericalDockQRecomputed'] is False and replay['independentGeneralizationEstablished'] is False and replay['productionPromotion'] is False, 'Replay scope differs')
    need(set(replay['cohorts']) == {'development', 'reserved'}, 'Replay cohort roster differs')
    for role, expected in [('development', 900), ('reserved', final_map['reserved']['planned'])]:
        row = replay['cohorts'][role]
        need(type(row['planned']) is int and row['planned'] == expected and row['evaluated'] + row['unavailable'] == expected, 'Replay denominator differs')
        need(all(row[k] is True for k in ('rawAndCanonicalInputsVerified', 'sourceContactFeaturesAndRanksRecomputed', 'fixedCorrespondenceRecomputed', 'savedMetricViewAggregationRecomputed')), 'Replay scientific verification incomplete')
        need(row['numericalDockQRecomputed'] is False, 'Numerical DockQ scope differs')
    initial = replay['initialDevelopmentFit']; combined = replay['combinedDevelopment']
    need(initial['planned'] == 300 and initial['independentSavedFitRecalculated'] is True and initial['allSavedAuditFieldsMatch'] is True, 'Initial300 fit replay incomplete')
    need(combined['planned'] == 1200, 'Combined planned denominator differs')
    if final_map['combinedDevelopment']['status'] == 'COMPLETE_FIT':
        need(combined['independentSavedFitRecalculated'] is True and combined['allSavedAuditFieldsMatch'] is True, 'Combined1200 fit replay incomplete')
    else:
        need(combined['status'] == 'INCOMPLETE_GENERATED_OUTCOMES' and combined['modelsFit'] is False and combined['missingAttemptsPreserved'] is True and combined['fitCompletionClaimed'] is False, 'Incomplete fit disposition lost')
    report = replay['reporting']
    need(all(report[k] is True for k in ('generationComparisonRecomputed', 'selectionRecomputed', 'reservedSummaryRecomputed')), 'Reporting replay incomplete')
    need(all(report[k] == final_map['reporting'][k] for k in ('selectionReceipt', 'reservedSummaryReceipt')), 'Reporting replay binds another study')
    cap = replay['reservedCapture']
    need(cap['targets'] == 3 and all(cap[k] is True for k in ('exactQueriesAndFullContextsVerified', 'noTemplatesOrRestraints', 'zeroInputCoordinatesVerified')) and cap['networkUsed'] is False and cap['predictionsGenerated'] is False, 'Capture replay incomplete')


def verified_context(root):
    """Authenticate completion before opening any scientific outcome documents."""
    root = root.resolve()
    ar_path = regular(root, 'round4-archive-receipt.json'); vr_path = regular(root, 'round4-archive-verification.json')
    ar = strict(ar_path.read_bytes()); vr = strict(vr_path.read_bytes())
    need(ar['schema'] == 'confovhh-round4-archive-receipt-v1' and vr['schema'] == 'confovhh-round4-fresh-archive-verification-v1' and vr['status'] == 'PASS', 'Full fresh archive PASS is required')
    need(vr['archive'] == ar['archive'], 'Archive receipts disagree')
    need(vr['originalScientificInputsUsed'] is False, 'Fresh replay used original scientific inputs')
    flags = ('allExtractedHashesVerifiedBeforeAndAfterReplay', 'basePayloadBytePreserved',
        'newFileCredentialScanAndPublicMsaProvenanceReplayed', 'pythonOriginalArtifactReadGuard',
        'pythonNetworkAndChildLaunchGuard', 'nodeFilesystemPermissionGuard', 'isolatedPython', 'cleanEnvironment')
    need(all(vr[k] is True for k in flags), 'Fresh archive safeguards incomplete')
    need(vr['verifier']['path'] == 'round4-archive/verify_archive.py' and vr['verifier']['sha256'] == VERIFIER_SHA, 'Unrecognized fresh verifier')
    archive = bound(root, ar['archive'])
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist(); names = [e.filename for e in infos]
        need(len(names) == len(set(names)) == len({x.casefold() for x in names}), 'ZIP member collision')
        for e in infos:
            relative(e.filename)
            need(not e.is_dir() and stat.S_IFMT(e.external_attr >> 16) in (0, stat.S_IFREG) and not e.flag_bits & 1, 'ZIP contains nonregular/encrypted member')
        raw = z.read(MANIFEST); need(hashlib.sha256(raw).hexdigest() == ar['manifestSha256'], 'Manifest changed')
        manifest = strict(raw)
    need(manifest['schema'] == 'confovhh-round4-evidence-manifest-v1', 'Wrong evidence manifest')
    files = manifest['files']; need(type(files) is dict and set(names) == set(files) | {MANIFEST}, 'Manifest membership differs')
    for name, v in files.items(): shape({'path': name, **v}); need(set(v) == {'bytes', 'sha256'}, 'Invalid inventory fields')
    need(len(files) == ar['payloadFileCount'] == vr['payloadFileCount'] == manifest['payloadFileCount'], 'Payload count differs')
    need(all(type(x) is int and x >= 0 for x in (ar['payloadFileCount'], vr['payloadFileCount'], manifest['payloadFileCount'], ar['payloadBytes'], manifest['payloadBytes'])), 'Payload counts must be nonnegative integers')
    need(sum(v['bytes'] for v in files.values()) == ar['payloadBytes'] == manifest['payloadBytes'], 'Payload bytes differ')
    need(ar['baseArchiveSha256'] == manifest['baseArchive']['sha256'] == BASE_ARCHIVE_SHA, 'Base archive changed')
    base = manifest['basePayloadFiles']; selected = manifest['selectedSourceSnapshot']
    need(type(base) is dict and base and type(selected) is dict and set(files) == set(base) | set(selected), 'Base/selected payload closure differs')
    need(all(files.get(n) == b for n, b in [*base.items(), *selected.items()]), 'Base/selected member changed')
    base_hash = hashlib.sha256((json.dumps(base, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()).hexdigest()
    need(base_hash == ar['basePayloadInventorySha256'] == manifest['basePayloadInventorySha256'], 'Base payload inventory differs')
    need(ar['finalArtifactMap'] == manifest['finalArtifactMap'] and ar['finalArtifactMap']['path'] == FINAL_MAP, 'Final map binding differs')
    extracted = Path(vr['extractedRoot'])
    need(extracted.is_absolute() and extracted.resolve() == extracted and extracted.is_dir() and not extracted.is_relative_to(root) and not root.is_relative_to(extracted), 'Fresh extraction must be direct and separate from original tree')
    need(regular(extracted, MANIFEST).read_bytes() == raw, 'Fresh manifest changed')
    bound(extracted, vr['verifier'], files)
    need(ar['builder']['path'] == 'round4-archive/build_evidence.py', 'Archive builder path differs')
    bound(extracted, ar['builder'], files)
    frozen = regular(extracted, 'round4-archive/IMPLEMENTATION-FREEZE.json')
    need(sha(frozen) == ARCHIVE_FREEZE_SHA, 'Archive implementation freeze changed')
    need(files.get('round4-archive/IMPLEMENTATION-FREEZE.json') == identity(frozen), 'Archive freeze is not a manifest member')
    freeze = strict(frozen.read_bytes())
    for b in freeze['files']: bound(extracted, b, files)
    for name in OWN_FILES:
        fresh = regular(extracted, name); need(files.get(name) == identity(fresh), 'Publication code not in verified archive')
        need(identity(regular(root, name)) == files[name], 'Live publication implementation differs from verified archive')
    final_map = strict(bound(extracted, ar['finalArtifactMap'], files).read_bytes())
    need(final_map['schema'] == 'confovhh-round4-final-artifact-map-v1' and final_map['status'] == 'COMPLETE' and final_map['authorizeArchive'] is True and final_map['artifactsQuiescent'] is True, 'Final root authorization/quiescence absent')
    need(final_map['archiveImplementationFreeze'] == {'path': 'round4-archive/IMPLEMENTATION-FREEZE.json', **identity(frozen)} and final_map['baseArchive'] == manifest['baseArchive'], 'Final map implementation/base differs')
    need(final_map['development']['planned'] == 900 and type(final_map['reserved']['planned']) is int and final_map['reserved']['planned'] in (75, 100), 'Attempt roster differs')
    need(final_map['combinedDevelopment']['planned'] == 1200 and final_map['combinedDevelopment']['status'] in ('COMPLETE_FIT', 'INCOMPLETE_GENERATED_OUTCOMES') and final_map['initialDevelopment']['planned'] == 300, 'Development disposition differs')
    need(final_map['scientificClaims'] == {'independentGeneralizationEstablished': False, 'productionPromotion': False}, 'Unsupported scientific claim')
    for b in bindings({k: v for k, v in final_map.items() if k != 'baseArchive'}): bound(extracted, b, files)
    replay_path = regular(extracted, 'fresh-archive-replay.json')
    need(sha(replay_path) == vr['replaySha256'], 'Fresh replay bytes changed')
    replay = strict(replay_path.read_bytes()); need(replay == vr['replay'] and replay['finalArtifactMap'] == ar['finalArtifactMap'], 'Fresh replay/map differs')
    validate_replay(replay, final_map)
    return {'root': root, 'extracted': extracted, 'files': files, 'map': final_map, 'archive': ar, 'verification': vr,
            'postArchive': {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)} for p in (ar_path, vr_path)}}


class Payload:
    def __init__(self, context):
        self.context = context; self.entries = {}; self.copies = []; self.derived = []; self.folded = set()

    def source(self, name):
        metadata_file(name); files = self.context['files']
        need(name in files, 'Compact source absent from archive: ' + name)
        return bound(self.context['extracted'], {'path': name, **files[name]}, files)

    def read(self, b):
        shape(b); path = self.source(b['path']); need(identity(path) == {k: b[k] for k in ('bytes', 'sha256')}, 'Receipt member differs')
        return strict(path.read_bytes())

    def put(self, name, raw):
        metadata_file(name)
        need(name.startswith(PREFIX + '/') or name.startswith(SCRIPT_PREFIX + '/'), 'Compact destination outside allowed prefixes')
        need(name.casefold() not in self.folded, 'Duplicate compact destination')
        need(len(raw) <= 4 * 1024**2, 'Compact member exceeds 4 MiB limit')
        raw.decode('utf-8'); need(not SECRET.search(raw), 'Credential-shaped content in compact member (content redacted)')
        self.entries[name] = raw; self.folded.add(name.casefold())

    def add(self, source, target):
        path = self.source(source); raw = path.read_bytes()
        need({'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()} == self.context['files'][source], 'Source changed during read')
        self.put(target, raw); self.copies.append({'source': source, 'publicationPath': target, **self.context['files'][source]})

    def add_binding(self, b, target):
        self.read(b) if PurePosixPath(b['path']).suffix == '.json' else bound(self.context['extracted'], b, self.context['files'])
        self.add(b['path'], target)

    def receipt(self, b, target, required):
        value = self.read(b); self.add(b['path'], target + '/receipt.json')
        members = value['files']; members = list(members.values()) if type(members) is dict else members
        by_name = {}
        for member in members:
            shape(member); name = PurePosixPath(member['path']).name
            need(name not in by_name, 'Duplicate receipt basename'); by_name[name] = member
        need(set(required) <= set(by_name), 'Required compact receipt member absent')
        for name in required: self.add_binding(by_name[name], target + '/' + name)
        return value, by_name


def project_nested(value):
    expected = {'schema', 'family', 'folds', 'ranks', 'allPlanned', 'sourceBaseline', 'allPlannedComparison',
                'learnerSupported', 'learnerSupportedBaseline', 'learnerSupportedComparison', 'completeLearnerEligibleGroups', 'claims'}
    need(set(value) == expected and value['schema'] == 'confovhh-nested-development-ranking-v1', 'Unknown nested result schema')
    # Every summary, pool-level metric, weighting, negative and limitation remains.
    # Per-pose ranks and repeated inner-fit traces stay in the full archive.
    out = {k: v for k, v in value.items() if k not in ('folds', 'ranks')}
    out['schema'] = 'confovhh-round4-compact-nested-summary-v1'
    for fold in value['folds']:
        need(set(fold) == {'heldOutGroup', 'selectedLambda', 'trainingGroups', 'heldOutIds', 'selection', 'model'}, 'Unknown outer-fold field')
    out['folds'] = [{k: f[k] for k in ('heldOutGroup', 'selectedLambda', 'trainingGroups', 'heldOutIds')} for f in value['folds']]
    out['projection'] = {'omittedFields': ['ranks', 'folds[].selection', 'folds[].model'], 'noMetricRecalculation': True}
    return out


def add_fit(p, item, title, expected):
    target = PREFIX + '/results/' + title
    fit, members = p.receipt(item['fitReceipt'], target, ('summary.json', 'confidence-model.json', 'interface-model.json'))
    need(fit['schema'] == 'confovhh-round4-ranking-execution-receipt-v1' and fit['status'] == 'COMPLETE' and fit['planned'] == expected and fit['reservedOutcomesRead'] is False, 'Fit receipt incomplete')
    audit = p.read(item['independentFitReceipt'])
    need(audit['schema'] == 'confovhh-round4-independent-fit-verification-v2' and audit['status'] == 'PASS' and audit['planned'] == expected and audit['fitReceipt'] == item['fitReceipt'], 'Independent fit evidence differs')
    p.add_binding(item['independentFitReceipt'], target + '/independent-verification.json')
    p.add_binding(fit['release'], target + '/fit-release.json')
    for family in ('confidence', 'interface'):
        b = members[family + '-nested.json']; result = project_nested(p.read(b)); name = target + '/' + family + '-nested-summary.json'
        p.put(name, encode(result)); p.derived.append({'source': b, 'publicationPath': name,
            'operation': 'Keep all metrics, pool weights, comparisons, claims and fold membership; omit per-pose ranks and repeated fold selection/model traces. No numerical recomputation.'})


def compose(context):
    p = Payload(context); m = context['map']
    for source, target in [('REPORT-V4.md', 'REPORT.md'), ('V4_REPLAY.md', 'REPLAY.md'), (FINAL_MAP, 'evidence/' + FINAL_MAP)]:
        p.add(source, PREFIX + '/' + target)
    for source in FIXED: p.add(source, PREFIX + '/design/' + source)
    for source in TOOLS: p.add(source, PREFIX + '/replay-tools/' + source)
    for name in PORTABLE: p.add('round4-ranking/' + name, SCRIPT_PREFIX + '/' + name)
    selection, _ = p.receipt(m['reporting']['selectionReceipt'], PREFIX + '/results/selection', ('selection.json', 'REPORT.md'))
    p.add_binding(selection['release'], PREFIX + '/results/selection/release.json')
    generation, gm = p.receipt(selection['generationAnalysisReceipt'], PREFIX + '/results/generation', ('comparison.json', 'timing-bindings.json', 'REPORT.md'))
    need(generation['planned'] == 900 and generation['sourceRankingReceipt'] == m['development']['sourceRankingReceipt'] and generation['outcomeReceipt'] == m['development']['outcomeReceipt'], 'Generation evidence differs')
    p.add_binding(generation['release'], PREFIX + '/results/generation/release.json')
    add_fit(p, m['initialDevelopment'], 'initial300', 300)
    combined = m['combinedDevelopment']
    join, _ = p.receipt(combined['joinReceipt'], PREFIX + '/results/combined1200/join', ('join-status.json',))
    need(join['planned'] == 1200 and join['reservedOutcomesRead'] is False and selection['combinedJoinReceipt'] == combined['joinReceipt'], 'Combined join differs')
    if combined['status'] == 'COMPLETE_FIT':
        need(join['fitEligible'] is True and selection['fitReceipt'] == combined['fitReceipt'] and selection['fitVerification'] == combined['independentFitReceipt'], 'Completed fit bindings differ')
        add_fit(p, combined, 'combined1200/fit', 1200)
    else:
        need(join['fitEligible'] is False and combined['fitReceipt'] is None and combined['independentFitReceipt'] is None and selection['selectedModel'] is None and selection['schema'] == 'confovhh-round4-incomplete-selection-receipt-v1', 'Incomplete development cannot claim a learned fit')
        p.add_binding(combined['incompleteDisposition'], PREFIX + '/results/combined1200/incomplete-disposition.json')
    reserved, rm = p.receipt(m['reporting']['reservedSummaryReceipt'], PREFIX + '/results/reserved', ('summary.json', 'attempts.json', 'POOLS.csv', 'REPORT.md'))
    need(reserved['counts']['planned'] == m['reserved']['planned'] and reserved['selectionReceipt'] == m['reporting']['selectionReceipt'] and reserved['allPlannedAttemptsRetained'] is True, 'Reserved scope differs')
    for key, name in [('release', 'release.json'), ('finalPolicyFreeze', 'final-policy.json'), ('generationPlan', 'generation-plan.json'), ('cohort', 'cohort.json'), ('sourceRankingReceipt', 'source-receipt.json'), ('outcomeReceipt', 'outcome-receipt.json')]:
        p.add_binding(reserved[key], PREFIX + '/results/reserved/' + name)
    for role in ('development',):
        for key in ('sourceRankingReceipt', 'outcomeReceipt', 'cohort'):
            p.add_binding(m[role][key], PREFIX + '/results/generation/' + key + '.json')
    figure_path = 'round4-analysis/figures/final-results/receipt.json'
    figure = strict(p.source(figure_path).read_bytes())
    need(figure['schema'] == 'confovhh-round4-descriptive-figures-v1' and figure['reportReceipts'] == [selection['generationAnalysisReceipt'], m['reporting']['reservedSummaryReceipt']] and figure['reportMembers'] == [gm['comparison.json'], rm['summary.json']], 'Figure report bindings differ')
    need(figure['rankingOrSelectionChanged'] is False and figure['outcomesRecomputed'] is False and figure['structuralQualityValuesUnchanged'] is True and figure['missingValuesZeroFilled'] is False, 'Figure scientific scope differs')
    p.read(figure['implementation']) if figure['implementation']['path'].endswith('.json') else bound(context['extracted'], figure['implementation'], context['files'])
    roster = {PurePosixPath(b['path']).name: b for b in figure['files']}
    need(len(roster) == len(figure['files']) == 6 and set(roster) == {n + '.' + e for n in ('generation-comparison', 'reserved-results') for e in ('png', 'svg', 'pdf')}, 'Figure inventory differs')
    for b in figure['files']: bound(context['extracted'], b, context['files'])
    for name in ('generation-comparison.svg', 'reserved-results.svg'): p.add_binding(roster[name], PREFIX + '/figures/' + name)
    p.add(figure_path, PREFIX + '/figures/receipt.json')
    for name, expected in context['postArchive'].items():
        path = regular(context['root'], name); need(identity(path) == expected, 'Post-archive evidence changed')
        target = PREFIX + '/evidence/' + name; p.put(target, path.read_bytes())
        p.derived.append({'source': {'path': name, **expected}, 'publicationPath': target,
                          'operation': 'Unchanged post-archive completion evidence; not a manifest member because the archive and its verification are created afterward.'})
    overview = f'''# Finite generation and ranking experiment

Read [the result report](REPORT.md) and [the replay requirements](REPLAY.md).
This is an exploratory study, with all 300 initial and 900 additional development
attempts retained. The reserved study contains {m['reserved']['planned']} attempts
on three deposited-construct cases, with only one learner-eligible biological
group. It cannot establish broad independent generalization or a production
promotion. Existing production defaults are unchanged.

The full archive SHA256 is `{context['archive']['archive']['sha256']}`.
The full fresh replay passed before this review package was staged. It verified
source/contact features, ranks, fixed sequence correspondence, saved metric
aggregation, generation comparison, independent saved-fit arithmetic and reports.
It did **not** rerun the production numerical DockQ calculation.

Both initial300 negative results and the combined1200 disposition are preserved.
Compact nested summaries omit only repeated inner-fit traces and per-pose ranks;
all aggregate/pool metrics, weighting, negative comparisons and claims remain.
All raw predictions, arrays, MSAs and full fit traces remain in the full archive.

`PUBLICATION-SOURCE-MAP.json` identifies every unchanged archive member and every
explicit compact projection. Final archive/verification receipts are separately
identified as post-archive evidence. The SVG figures are receipt-bound displays;
their PNG/PDF versions remain in the full archive.

The unchanged ranker and focused tests live under `scripts/external-ranking-v4`.
With NumPy 1.26.4 installed, run `python -m unittest discover -s
scripts/external-ranking-v4 -p test_ranker.py`. These tests use synthetic data.
The remaining artifact-bound interfaces need the full extracted archive. Unchanged
`replay-tools/` copies retain their execution-relative layout; they are review
copies and do not replace the complete bound inputs.

This staging tool makes no repository, branch, pull request or network changes.
Cloud infrastructure records, private backups and credentials are excluded.
'''
    p.put(PREFIX + '/README.md', overview.encode())
    source_map = {'schema': 'confovhh-round4-compact-publication-source-map-v1',
        'fullArchive': context['archive']['archive'], 'verifiedManifestSha256': context['archive']['manifestSha256'],
        'proposedBaseHead': BASE_HEAD, 'unchangedArchiveCopies': p.copies, 'derivedOrPostArchiveEvidence': p.derived,
        'generatedOverview': PREFIX + '/README.md', 'numericalDockQRecomputed': False,
        'scientificInputOrigin': 'Fresh verified extraction only; external completion receipts are separately authenticated.'}
    p.put(PREFIX + '/PUBLICATION-SOURCE-MAP.json', encode(source_map))
    need(sum(map(len, p.entries.values())) <= 32 * 1024**2, 'Compact payload exceeds 32 MiB budget')
    return p


def write_stage(context, payload, output):
    root = context['root']; output = Path(output).absolute()
    need(output.resolve() == output and output.parent == root and re.fullmatch(r'round4-publication-stage(?:-[a-z0-9-]+)?', output.name) and not output.exists(), 'Staging output must be a new dedicated root-level publication directory')
    output.mkdir(); files = output / 'files'; files.mkdir()
    for name, raw in sorted(payload.entries.items()):
        path = files / name; path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(raw)
    # Catch mutation after selection before emitting a publication-ready payload.
    for b in payload.copies:
        bound(context['extracted'], {'path': b['source'], 'bytes': b['bytes'], 'sha256': b['sha256']}, context['files'])
    for item in payload.derived:
        b = item['source']; source_root = context['root'] if b['path'] in context['postArchive'] else context['extracted']
        bound(source_root, b, None if source_root == context['root'] else context['files'])
    index = []; tree = []
    for name, raw in sorted(payload.entries.items()):
        need(regular(files, name).read_bytes() == raw, 'Staged bytes changed')
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        index.append({'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'gitBlobSha': blob})
        tree.append({'path': name, 'mode': '100644', 'type': 'blob', 'content': raw.decode('utf-8')})
    for name, value in [('index.json', index), ('tree-elements.json', tree)]:
        with (output/name).open('xb') as stream: stream.write(encode(value))
    receipt = {'schema': 'confovhh-round4-compact-publication-staging-receipt-v1', 'status': 'STAGED_ONLY',
        'fullArchive': context['archive']['archive'], 'freshVerification': {'path': 'round4-archive-verification.json', **context['postArchive']['round4-archive-verification.json']},
        'publicationImplementation': [{'path': n, **context['files'][n]} for n in OWN_FILES],
        'proposedBaseHead': BASE_HEAD, 'fileCount': len(index), 'payloadBytes': sum(x['bytes'] for x in index),
        'index': {'path': 'index.json', **identity(output/'index.json')},
        'treeElements': {'path': 'tree-elements.json', **identity(output/'tree-elements.json')},
        'repositoryModified': False, 'published': False, 'cloudActions': False,
        'sourceScientificBytesChanged': False, 'modelsFit': 0, 'numericalDockQRecomputed': False}
    with (output/'receipt.json').open('xb') as stream: stream.write(encode(receipt))
    return receipt


def build(root, output):
    context = verified_context(root); payload = compose(context)
    return write_stage(context, payload, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, default=ROOT/'round4-publication-stage')
    args = parser.parse_args(); result = build(args.artifacts, args.output)
    print(json.dumps({'status': result['status'], 'files': result['fileCount'], 'payloadBytes': result['payloadBytes']}))
