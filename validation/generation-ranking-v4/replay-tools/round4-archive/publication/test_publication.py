"""Synthetic completion/byte-preservation controls. No production labels."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

import build_publication as p


def nested(family):
    metric = {'aggregate': {'firstDockQ': 0.2}, 'pools': {'pool': {'firstDockQ': 0.2}}, 'poolWeights': {'pool': 1}}
    return {'schema': 'confovhh-nested-development-ranking-v1', 'family': family,
        'folds': [{'heldOutGroup': 'held', 'selectedLambda': None, 'trainingGroups': ['train'],
            'heldOutIds': ['synthetic'], 'selection': {'reason': 'source-selected'}, 'model': {'kind': 'source'}}],
        'ranks': [{'id': 'synthetic', 'score': 0.1}], 'allPlanned': metric, 'sourceBaseline': metric,
        'allPlannedComparison': {'firstDockQGain': -0.1, 'acceptableLossPools': ['pool']},
        'learnerSupported': metric, 'learnerSupportedBaseline': metric,
        'learnerSupportedComparison': {'firstDockQGain': -0.1, 'acceptableLossPools': ['pool']},
        'completeLearnerEligibleGroups': ['held'], 'claims': {'allDevelopmentExposed': True}}


class Fixture:
    def __init__(self, folder, incomplete=False, reserved=75):
        self.root = folder/'original'; self.root.mkdir()
        self.extracted = folder/'fresh'; self.extracted.mkdir()
        self.files = {}
        for name in set(p.FIXED) | set(p.TOOLS) | {'round4-ranking/'+n for n in p.PORTABLE}:
            data = b'{}\n' if name.endswith('.json') else b'Synthetic fixture only\n'
            self.put(name, data)
        # These are code-only current artifacts, never scientific outcomes.
        frozen_names = tuple(x['path'] for x in p.strict((p.ROOT/'round4-archive/IMPLEMENTATION-FREEZE.json').read_bytes())['files'])
        for name in p.OWN_FILES + frozen_names + ('round4-archive/IMPLEMENTATION-FREEZE.json',):
            self.put(name, (p.ROOT/name).read_bytes())
        for name in p.OWN_FILES:
            target = self.root/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes((p.ROOT/name).read_bytes())
        for name in ('REPORT-V4.md', 'V4_REPLAY.md'): self.put(name, b'# Complete synthetic report\n')
        dev = self.cohort('development', 900); res = self.cohort('reserved', reserved)
        initial = self.fit('initial', 300)
        join = self.receipt('round4-ranking/combined/join', {'join-status.json': {'planned': 1200, 'missing': ['synthetic'] if incomplete else []}},
            {'planned': 1200, 'reservedOutcomesRead': False, 'fitEligible': not incomplete})
        combined = {'planned': 1200, 'status': 'INCOMPLETE_GENERATED_OUTCOMES' if incomplete else 'COMPLETE_FIT',
                    'joinReceipt': join, 'fitReceipt': None, 'independentFitReceipt': None, 'incompleteDisposition': None}
        if not incomplete: combined.update(self.fit('combined', 1200))
        comparison = self.receipt('round4-analysis/synthetic', {
            'comparison.json': {'pairGenerationDecision': {'selectedArm': 'baseline'}},
            'timing-bindings.json': [], 'REPORT.md': '# Synthetic comparison\n'},
            {'planned': 900, 'sourceRankingReceipt': dev['sourceRankingReceipt'], 'outcomeReceipt': dev['outcomeReceipt'],
             'release': self.doc('round4-analysis/synthetic-release.json', {'authorized': True})})
        self.selection = self.receipt('round4-reporting/selection', {'selection.json': {'selectedFamily': 'source'}, 'REPORT.md': '# Source retained\n'},
            {'schema': 'confovhh-round4-incomplete-selection-receipt-v1' if incomplete else 'confovhh-round4-final-selection-receipt-v1',
             'selectedModel': None, 'generationAnalysisReceipt': comparison, 'combinedJoinReceipt': join,
             'fitReceipt': combined['fitReceipt'], 'fitVerification': combined['independentFitReceipt'],
             'release': self.doc('round4-reporting/selection-release.json', {'authorized': True})})
        if incomplete:
            combined['incompleteDisposition'] = self.b('round4-reporting/selection/selection.json')
        policy = self.doc('round4-reporting/final-policy.json', {'source': True})
        self.summary = self.receipt('round4-reporting/reserved', {
            'summary.json': {'planned': reserved}, 'attempts.json': [{'id': 'synthetic', 'status': 'unavailable'}],
            'POOLS.csv': 'pool,status\nsynthetic,unavailable\n', 'REPORT.md': '# Reserved synthetic\n'},
            {'counts': {'planned': reserved}, 'selectionReceipt': self.selection, 'allPlannedAttemptsRetained': True,
             'release': self.doc('round4-reporting/reserved-release.json', {'authorized': True}), 'finalPolicyFreeze': policy,
             'generationPlan': self.doc('round4-reserved-generation/plan.json', {'planned': reserved}),
             'cohort': res['cohort'], 'sourceRankingReceipt': res['sourceRankingReceipt'], 'outcomeReceipt': res['outcomeReceipt']})
        cap = self.doc('round4-reserved-preparation/synthetic/COMPLETE.json', {'status': 'PASS'})
        self.map = {'schema': 'confovhh-round4-final-artifact-map-v1', 'status': 'COMPLETE', 'authorizeArchive': True,
            'artifactsQuiescent': True, 'baseArchive': {'path': 'base.zip', 'bytes': 1, 'sha256': p.BASE_ARCHIVE_SHA},
            'archiveImplementationFreeze': self.b('round4-archive/IMPLEMENTATION-FREEZE.json'),
            'development': dev, 'reserved': res, 'initialDevelopment': {'planned': 300, **initial},
            'combinedDevelopment': combined,
            'reservedCapture': {'bundleRoot': 'round4-reserved-preparation/synthetic', 'outputRoot': 'round4-reserved-preparation/synthetic', 'completeReceipt': cap},
            'reporting': {'selectionReceipt': self.selection, 'reservedSummaryReceipt': self.summary, 'finalPolicy': policy,
                'reports': [self.b('REPORT-V4.md'), self.b('V4_REPLAY.md')]},
            'scientificClaims': {'independentGeneralizationEstablished': False, 'productionPromotion': False}}
        self.doc(p.FINAL_MAP, self.map)
        figures = []
        for stem in ('generation-comparison', 'reserved-results'):
            for ext in ('png', 'svg', 'pdf'):
                figures.append(self.put('round4-analysis/figures/final-results/'+stem+'.'+ext, b'<svg>Synthetic</svg>\n' if ext == 'svg' else b'synthetic binary'))
        self.doc('round4-analysis/figures/final-results/receipt.json', {
            'schema': 'confovhh-round4-descriptive-figures-v1', 'reportReceipts': [comparison, self.summary],
            'reportMembers': [self.b('round4-analysis/synthetic/comparison.json'), self.b('round4-reporting/reserved/summary.json')],
            'implementation': self.b('round4-analysis/figures/plot_results.py'), 'files': figures,
            'rankingOrSelectionChanged': False, 'outcomesRecomputed': False,
            'structuralQualityValuesUnchanged': True, 'missingValuesZeroFilled': False})
        self.replay = {'schema': 'confovhh-round4-extracted-scientific-replay-v1', 'status': 'PASS',
            'finalArtifactMap': self.b(p.FINAL_MAP), 'cohorts': {},
            'initialDevelopmentFit': {'planned': 300, 'independentSavedFitRecalculated': True, 'allSavedAuditFieldsMatch': True},
            'combinedDevelopment': {'planned': 1200, 'status': 'INCOMPLETE_GENERATED_OUTCOMES', 'modelsFit': False, 'missingAttemptsPreserved': True, 'fitCompletionClaimed': False} if incomplete else {'planned': 1200, 'independentSavedFitRecalculated': True, 'allSavedAuditFieldsMatch': True},
            'reporting': {'selectionReceipt': self.selection, 'reservedSummaryReceipt': self.summary,
                'generationComparisonRecomputed': True, 'selectionRecomputed': True, 'reservedSummaryRecomputed': True},
            'reservedCapture': {'targets': 3, 'exactQueriesAndFullContextsVerified': True, 'noTemplatesOrRestraints': True,
                'zeroInputCoordinatesVerified': True, 'networkUsed': False, 'predictionsGenerated': False},
            'numericalDockQRecomputed': False, 'independentGeneralizationEstablished': False, 'productionPromotion': False}
        for role, n in [('development', 900), ('reserved', reserved)]:
            self.replay['cohorts'][role] = {'planned': n, 'produced': n, 'evaluated': n-1, 'unavailable': 1,
                'rawAndCanonicalInputsVerified': True, 'sourceContactFeaturesAndRanksRecomputed': True,
                'fixedCorrespondenceRecomputed': True, 'savedMetricViewAggregationRecomputed': True, 'numericalDockQRecomputed': False}
        self.seal()

    def put(self, name, raw):
        path = self.extracted/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
        self.files[name] = p.identity(path); return self.b(name)

    def doc(self, name, obj): return self.put(name, p.encode(obj))
    def b(self, name): return {'path': name, **self.files[name]}

    def receipt(self, folder, docs, extras):
        files = [self.doc(folder+'/'+n, v) if not isinstance(v, str) else self.put(folder+'/'+n, v.encode()) for n, v in docs.items()]
        return self.doc(folder+'/receipt.json', {'files': files, **extras})

    def fit(self, name, count):
        folder = 'round4-ranking/'+name
        docs = {'summary.json': {'negativeResultPreserved': True}}
        for family in ('confidence', 'interface'):
            docs[family+'-model.json'] = {'kind': 'source'}
            docs[family+'-nested.json'] = nested(family)
        receipt = self.receipt(folder, docs, {'schema': 'confovhh-round4-ranking-execution-receipt-v1',
            'status': 'COMPLETE', 'planned': count, 'reservedOutcomesRead': False,
            'release': self.doc(folder+'/release.json', {'authorized': True})})
        audit = self.doc(folder+'/independent.json', {'schema': 'confovhh-round4-independent-fit-verification-v2',
            'status': 'PASS', 'planned': count, 'fitReceipt': receipt})
        return {'fitReceipt': receipt, 'independentFitReceipt': audit}

    def cohort(self, role, count):
        return {'planned': count, **{k: self.doc('round4-outcomes/'+role+'/'+k+'.json', {'planned': count})
            for k in ('cohort', 'sourceRankingReceipt', 'outcomeReceipt')}}

    def seal(self):
        base = {'REPORT-V4.md': self.files['REPORT-V4.md']}
        base_hash = hashlib.sha256((json.dumps(base, sort_keys=True, separators=(',', ':'))+'\n').encode()).hexdigest()
        manifest = {'schema': 'confovhh-round4-evidence-manifest-v1', 'files': self.files,
            'payloadFileCount': len(self.files), 'payloadBytes': sum(b['bytes'] for b in self.files.values()),
            'baseArchive': self.map['baseArchive'], 'finalArtifactMap': self.b(p.FINAL_MAP),
            'basePayloadFiles': base, 'selectedSourceSnapshot': self.files, 'basePayloadInventorySha256': base_hash}
        raw = p.encode(manifest); (self.extracted/p.MANIFEST).write_bytes(raw)
        archive_path = self.root/'synthetic.zip'
        with zipfile.ZipFile(archive_path, 'w') as z:
            for name in self.files: z.writestr(name, (self.extracted/name).read_bytes())
            z.writestr(p.MANIFEST, raw)
        self.ar = {'schema': 'confovhh-round4-archive-receipt-v1', 'archive': {'path': archive_path.name, **p.identity(archive_path)},
            'manifestSha256': hashlib.sha256(raw).hexdigest(), 'baseArchiveSha256': p.BASE_ARCHIVE_SHA,
            'finalArtifactMap': self.b(p.FINAL_MAP), 'payloadFileCount': len(self.files), 'payloadBytes': manifest['payloadBytes'],
            'basePayloadInventorySha256': base_hash, 'builder': self.b('round4-archive/build_evidence.py')}
        (self.root/'round4-archive-receipt.json').write_bytes(p.encode(self.ar))
        (self.extracted/'fresh-archive-replay.json').write_bytes(p.encode(self.replay))
        self.vr = {'schema': 'confovhh-round4-fresh-archive-verification-v1', 'status': 'PASS', 'archive': self.ar['archive'],
            'extractedRoot': str(self.extracted), 'payloadFileCount': len(self.files), 'allExtractedHashesVerifiedBeforeAndAfterReplay': True,
            'basePayloadBytePreserved': True, 'newFileCredentialScanAndPublicMsaProvenanceReplayed': True,
            'originalScientificInputsUsed': False, 'pythonOriginalArtifactReadGuard': True, 'pythonNetworkAndChildLaunchGuard': True,
            'nodeFilesystemPermissionGuard': True, 'isolatedPython': True, 'cleanEnvironment': True,
            'replay': self.replay, 'replaySha256': p.sha(self.extracted/'fresh-archive-replay.json'),
            'verifier': self.b('round4-archive/verify_archive.py')}
        self.save_vr()

    def save_vr(self): (self.root/'round4-archive-verification.json').write_bytes(p.encode(self.vr))


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name).resolve()

    def fixture(self, **kwargs): return Fixture(self.folder, **kwargs)

    def test_full_synthetic_complete_stages_exact_source_copies_and_svg_only(self):
        f = self.fixture(); context = p.verified_context(f.root); payload = p.compose(context)
        receipt = p.write_stage(context, payload, f.root/'round4-publication-stage')
        self.assertEqual(receipt['status'], 'STAGED_ONLY'); self.assertFalse(receipt['published'])
        self.assertTrue(all(Path(n).suffix in p.SUFFIXES for n in payload.entries))
        self.assertEqual(len([n for n in payload.entries if n.endswith('.svg')]), 2)
        self.assertFalse(any(n.endswith(('.png', '.pdf', '.npz', '.cif')) for n in payload.entries))
        source_map = p.strict(payload.entries[p.PREFIX+'/PUBLICATION-SOURCE-MAP.json'])
        self.assertTrue(any('initial300' in x['publicationPath'] for x in source_map['unchangedArchiveCopies']))
        for b in source_map['unchangedArchiveCopies']:
            self.assertEqual(payload.entries[b['publicationPath']], (f.extracted/b['source']).read_bytes())
        self.assertEqual(len(source_map['derivedOrPostArchiveEvidence']), 6)
        self.assertFalse((f.root/'ConfoVHH').exists())

    def test_incomplete_join_still_preserves_initial_fit_and_explicit_disposition(self):
        f = self.fixture(incomplete=True); payload = p.compose(p.verified_context(f.root))
        self.assertIn(p.PREFIX+'/results/combined1200/incomplete-disposition.json', payload.entries)
        self.assertFalse(any('/combined1200/fit/' in n for n in payload.entries))
        self.assertTrue(any('/initial300/' in n for n in payload.entries))

    def test_100_reserved_supported(self):
        f = self.fixture(reserved=100)
        self.assertIn(b'100 attempts', p.compose(p.verified_context(f.root)).entries[p.PREFIX+'/README.md'])

    def test_no_fresh_pass_refuses_before_scientific_composition(self):
        f = self.fixture(); f.vr['status'] = 'FAILED'; f.save_vr()
        with self.assertRaisesRegex(ValueError, 'PASS'): p.verified_context(f.root)
        self.assertFalse((f.root/'round4-publication-stage').exists())

    def test_missing_guard_refused(self):
        f = self.fixture(); f.vr['nodeFilesystemPermissionGuard'] = False; f.save_vr()
        with self.assertRaisesRegex(ValueError, 'safeguards'): p.verified_context(f.root)

    def test_original_inputs_used_refused(self):
        f = self.fixture(); f.vr['originalScientificInputsUsed'] = True; f.save_vr()
        with self.assertRaisesRegex(ValueError, 'original scientific'): p.verified_context(f.root)

    def test_archive_change_refused(self):
        f = self.fixture()
        with (f.root/'synthetic.zip').open('ab') as stream: stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'bytes changed'): p.verified_context(f.root)

    def test_wrong_verifier_pin_refused(self):
        f = self.fixture(); f.vr['verifier']['sha256'] = '1'*64; f.save_vr()
        with self.assertRaisesRegex(ValueError, 'Unrecognized'): p.verified_context(f.root)

    def test_changed_fresh_report_refused(self):
        f = self.fixture(); (f.extracted/'REPORT-V4.md').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'bytes changed'): p.verified_context(f.root)

    def test_changed_fresh_replay_refused(self):
        f = self.fixture(); (f.extracted/'fresh-archive-replay.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'replay bytes'): p.verified_context(f.root)

    def test_changed_live_publication_implementation_refused(self):
        f = self.fixture(); (f.root/p.OWN_FILES[0]).write_text('changed')
        with self.assertRaisesRegex(ValueError, 'Live publication'): p.verified_context(f.root)

    def test_scientific_reads_use_fresh_sources_not_modified_live_reports(self):
        f = self.fixture(); (f.root/'REPORT-V4.md').write_text('LIVE MUST NOT BE USED')
        payload = p.compose(p.verified_context(f.root))
        self.assertNotIn(b'LIVE', payload.entries[p.PREFIX+'/REPORT.md'])

    def test_numerical_dockq_claim_refused(self):
        f = self.fixture(); f.replay['numericalDockQRecomputed'] = True; f.seal()
        with self.assertRaisesRegex(ValueError, 'scope'): p.verified_context(f.root)

    def test_wrong_attempt_count_refused(self):
        f = self.fixture(); f.replay['cohorts']['development']['planned'] = 899; f.seal()
        with self.assertRaisesRegex(ValueError, 'denominator'): p.verified_context(f.root)

    def test_missing_fit_replay_refused(self):
        f = self.fixture(); f.replay['combinedDevelopment']['allSavedAuditFieldsMatch'] = False; f.seal()
        with self.assertRaisesRegex(ValueError, 'fit replay'): p.verified_context(f.root)

    def test_source_symlink_refused(self):
        f = self.fixture(); old = f.extracted/'REPORT-V4.md'; original = old.read_bytes(); old.unlink()
        outside = self.folder/'outside.md'; outside.write_bytes(original); old.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'indirect'): p.verified_context(f.root)

    def test_source_mutation_after_selection_refuses_receipt(self):
        f = self.fixture(); context = p.verified_context(f.root); payload = p.compose(context)
        (f.extracted/'REPORT-V4.md').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'bytes changed'): p.write_stage(context, payload, f.root/'round4-publication-stage')
        self.assertFalse((f.root/'round4-publication-stage/receipt.json').exists())

    def test_post_archive_mutation_after_selection_refuses_receipt(self):
        f = self.fixture(); context = p.verified_context(f.root); payload = p.compose(context)
        (f.root/'round4-archive-verification.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'bytes changed'): p.write_stage(context, payload, f.root/'round4-publication-stage')

    def test_projection_preserves_every_negative_metric_and_group_membership(self):
        before = nested('interface'); after = p.project_nested(before)
        for k in set(before) - {'schema', 'folds', 'ranks'}: self.assertEqual(before[k], after[k])
        self.assertEqual(after['learnerSupportedComparison']['firstDockQGain'], -0.1)
        self.assertEqual(after['folds'][0]['heldOutIds'], ['synthetic'])
        self.assertNotIn('ranks', after); self.assertNotIn('model', after['folds'][0])

    def test_unknown_projection_field_fails_instead_of_silent_omission(self):
        value = nested('confidence'); value['newImportantResult'] = True
        with self.assertRaisesRegex(ValueError, 'Unknown nested'): p.project_nested(value)

    def test_unknown_fold_field_fails_instead_of_silent_omission(self):
        value = nested('confidence'); value['folds'][0]['newImportantResult'] = True
        with self.assertRaisesRegex(ValueError, 'Unknown outer'): p.project_nested(value)

    def test_figure_receipt_cannot_bind_other_reports(self):
        f = self.fixture(); context = p.verified_context(f.root)
        name = 'round4-analysis/figures/final-results/receipt.json'
        doc = p.strict((f.extracted/name).read_bytes()); doc['reportReceipts'] = list(reversed(doc['reportReceipts']))
        f.doc(name, doc); context['files'] = f.files
        with self.assertRaisesRegex(ValueError, 'Figure report bindings'): p.compose(context)

    def test_omitted_required_report_member_refused(self):
        f = self.fixture(); context = p.verified_context(f.root)
        name = f.summary['path']; doc = p.strict((f.extracted/name).read_bytes())
        doc['files'] = [x for x in doc['files'] if not x['path'].endswith('attempts.json')]
        changed = f.doc(name, doc); context['map']['reporting']['reservedSummaryReceipt'] = changed
        context['files'] = f.files
        with self.assertRaisesRegex(ValueError, 'Required compact receipt'): p.compose(context)

    def test_path_traversal_case_collision_and_private_sources_refused(self):
        for name in ('../x.json', '/x.json', 'a/./x.json', 'a\\x.json', 'a//x.json', 'C:/x.json'):
            with self.assertRaises(ValueError): p.relative(name)
        for name in ('round4-cloud/resource.json', 'private-volume-backups/object.json', 'a/pose.cif', 'captured/x.csv'):
            with self.assertRaises(ValueError): p.metadata_file(name)
        payload = p.Payload({}); payload.put(p.PREFIX+'/X.md', b'x')
        with self.assertRaisesRegex(ValueError, 'Duplicate'): payload.put(p.PREFIX+'/x.md', b'y')

    def test_secret_and_size_refusals_do_not_echo_content(self):
        payload = p.Payload({}); secret = b'Bearer ' + b'a'*25
        with self.assertRaisesRegex(ValueError, 'redacted') as exc: payload.put(p.PREFIX+'/x.md', secret)
        self.assertNotIn(secret.decode(), str(exc.exception))
        with self.assertRaisesRegex(ValueError, '4 MiB'): payload.put(p.PREFIX+'/big.txt', b'x'*(4*1024**2+1))

    def test_checkout_existing_and_external_stage_forbidden(self):
        f = self.fixture(); context = p.verified_context(f.root); payload = p.compose(context)
        for destination in (f.root/'ConfoVHH', self.folder/'round4-publication-stage'):
            with self.assertRaisesRegex(ValueError, 'dedicated'): p.write_stage(context, payload, destination)
        destination = f.root/'round4-publication-stage'; destination.mkdir()
        with self.assertRaisesRegex(ValueError, 'dedicated'): p.write_stage(context, payload, destination)

    def test_strict_duplicate_and_nonfinite_json(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}'):
            with self.assertRaises(ValueError): p.strict(raw)

    def test_strict_float_overflow_rejected_at_every_depth(self):
        for raw in ('1e999', '-1e999', '{"a":[1e999]}'):
            with self.assertRaisesRegex(ValueError, 'Nonfinite JSON'): p.strict(raw)
        self.assertEqual(p.strict('{"a":1e20,"b":-0.25}'), {'a': 1e20, 'b': -0.25})

    def test_optimized_runtime_refused(self):
        command = [sys.executable, '-I', '-O', str(p.HERE/'build_publication.py'), '--help']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0); self.assertIn('Optimized Python', result.stderr)

    def test_portable_unchanged_ranker_suite_runs_without_scientific_inputs(self):
        folder = self.folder/'portable'; folder.mkdir()
        for name in p.PORTABLE: shutil.copyfile(p.ROOT/'round4-ranking'/name, folder/name)
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(folder), '-p', 'test_ranker.py'], cwd=folder, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Ran 23 tests', result.stderr)


if __name__ == '__main__': unittest.main()
