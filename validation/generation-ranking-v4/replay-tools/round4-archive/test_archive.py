"""Synthetic archive and isolation controls. Never read actual scientific outputs."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile
import archive_common as c
import build_evidence as builder
import verify_archive as verifier


def put(root, name, value):
    p = root/name; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(value if isinstance(value, bytes) else c.packed(value))
    return c.binding(root, p)


def final_fixture(root):
    for name in c.FREEZE_FILES: put(root, name, b'synthetic frozen method\n')
    reporting_files = [put(root, 'round4-reporting/'+name, b'synthetic reporting code\n')
                       for name in ('report_common.py', 'select_final.py', 'summarize_reserved.py')]
    reporting = put(root, 'round4-reporting/REPORTING-FREEZE.json', {'files': reporting_files, 'dependencies': []})
    capture_files = [put(root, 'round4-reserved-preparation/v2/'+name, b'synthetic capture code\n')
                     for name in ('capture_inputs.py', 'build_bundle.py', 'test_capture_inputs.py')]
    capture = put(root, 'round4-reserved-preparation/v2/PREPARATION-FREEZE.json', {
        'artifacts': [{**b, 'path': Path(b['path']).name} for b in capture_files]})
    # Production pins are replaced only inside this test class's temporary mock.
    c.DEPENDENCY_PINS.update({b['path']: b['sha256'] for b in (reporting, capture)})
    freeze = put(root, 'round4-archive/IMPLEMENTATION-FREEZE.json', {
        'schema': 'confovhh-round4-archive-tools-freeze-v1', 'newOutcomesRead': False,
        'files': [c.binding(root, root/n) for n in c.FREEZE_FILES], 'dependencies': [reporting, capture]})
    records = {}
    for role, n in [('development', 900), ('reserved', 75)]:
        prefix = 'round4-ranking/' + role
        ids = [role + str(i) for i in range(n)]
        cohort = put(root, prefix+'/cohort.json', {'evaluationRole': role, 'plannedIds': ids})
        table = put(root, prefix+'/table.json', {'rows': [{'id': i, 'producerStatus': 'failed'} for i in ids]})
        source = put(root, prefix+'/source.json', {'schema': 'confovhh-round4-source-ranking-receipt-v1',
            'snapshot': False, 'evaluationRole': role if role == 'development' else 'reserved-evaluation',
            'plannedCount': n, 'predictionTable': table})
        om = put(root, prefix+'/outcomes.json', {'cohort': cohort, 'rows': [{'id': i} for i in ids]})
        request = put(root, prefix+'/request.json', {'sourceRankingReceipt': source})
        outcome = put(root, prefix+'/receipt.json', {'schema': 'confovhh-round4-outcome-receipt-v1',
            'evaluationRole': role, 'plannedCount': n, 'evaluatedCount': 0, 'unavailableCount': n,
            'allPlannedIdsRetained': True, 'explicitReleaseChecked': True, 'outcomeMap': om, 'request': request})
        records[role] = dict(planned=n, cohort=cohort, sourceRankingReceipt=source, outcomeReceipt=outcome)
    def fit(n):
        f = put(root, f'round4-ranking/fit{n}/receipt.json', {'schema': 'confovhh-round4-ranking-execution-receipt-v1', 'status': 'COMPLETE', 'planned': n})
        a = put(root, f'round4-ranking/fit{n}/audit.json', {'schema': 'confovhh-round4-independent-fit-verification-v2', 'status': 'PASS', 'planned': n, 'fitReceipt': f})
        return dict(planned=n, fitReceipt=f, independentFitReceipt=a)
    join = put(root, 'round4-ranking/join.json', {'schema': 'confovhh-round4-combined-development-join-receipt-v1',
        'planned': 1200, 'reservedOutcomesRead': False, 'status': 'READY_FOR_SEPARATE_FIT_RELEASE', 'fitEligible': True})
    combined_fit = fit(1200)
    generation = put(root, 'round4-analysis/generation.json', {'sourceRankingReceipt': records['development']['sourceRankingReceipt'],
                                                            'outcomeReceipt': records['development']['outcomeReceipt']})
    report = {}
    report['selectionReceipt'] = put(root, 'round4-reporting/selectionReceipt.json', {
        'schema': 'confovhh-round4-final-selection-receipt-v1', 'status': 'COMPLETE_EXPLORATORY_SELECTION',
        'combinedJoinReceipt': join, 'fitReceipt': combined_fit['fitReceipt'], 'fitVerification': combined_fit['independentFitReceipt'],
        'generationAnalysisReceipt': generation, 'selectedModel': None})
    report['finalPolicy'] = put(root, 'round4-reporting/final-policy.json', {'fixture': True})
    report['reservedSummaryReceipt'] = put(root, 'round4-reporting/reservedSummaryReceipt.json', {
        'schema': 'confovhh-round4-reserved-summary-receipt-v1', 'status': 'COMPLETE_DESCRIPTIVE_SUMMARY',
        'selectionReceipt': report['selectionReceipt'], 'finalPolicyFreeze': report['finalPolicy'],
        'sourceRankingReceipt': records['reserved']['sourceRankingReceipt'], 'outcomeReceipt': records['reserved']['outcomeReceipt'],
        'cohort': records['reserved']['cohort'], 'counts': {'planned': 75}, 'allPlannedAttemptsRetained': True})
    report['reports'] = [put(root, n, b'Final synthetic report\n') for n in ('REPORT-V4.md', 'V4_REPLAY.md')]
    cap = put(root, 'round4-reserved-preparation/completion.json', {'fixture': True})
    m = {'schema': 'confovhh-round4-final-artifact-map-v1', 'status': 'COMPLETE', 'authorizeArchive': True,
        'artifactsQuiescent': True, 'baseArchive': {'path': c.BASE_NAME, 'bytes': 123, 'sha256': c.BASE_SHA},
        'archiveImplementationFreeze': freeze, **records, 'initialDevelopment': fit(300),
        'combinedDevelopment': {**combined_fit, 'status': 'COMPLETE_FIT', 'joinReceipt': join, 'incompleteDisposition': None},
        'reservedCapture': {'bundleRoot': 'round4-reserved-preparation/bundle', 'outputRoot': 'round4-reserved-preparation/output', 'completeReceipt': cap},
        'reporting': report, 'scientificClaims': {'independentGeneralizationEstablished': False, 'productionPromotion': False}}
    put(root, c.MAP_NAME, m)
    return m


def zip_fixture(root, mutate=None, extra=None):
    m = final_fixture(root); put(root, 'old-v3/retained.txt', b'exact historical fixture bytes\n')
    files = c.snapshot({p.relative_to(root).as_posix(): p for p in root.rglob('*') if p.is_file()})
    base = {'old-v3/retained.txt': files['old-v3/retained.txt']}
    manifest = {'schema': 'confovhh-round4-evidence-manifest-v1', 'baseArchive': m['baseArchive'],
        'basePayloadFiles': base, 'basePayloadInventorySha256': hashlib.sha256(c.packed(base)).hexdigest(),
        'finalArtifactMap': c.binding(root, root/c.MAP_NAME), 'payloadFileCount': len(files),
        'payloadBytes': sum(x['bytes'] for x in files.values()), 'files': files, 'selectedSourceSnapshot': files}
    if mutate: mutate(manifest)
    path = root.parent/'synthetic.zip'
    with zipfile.ZipFile(path, 'w') as z:
        for name in files: z.writestr(name, (root/name).read_bytes())
        z.writestr(c.MANIFEST_NAME, c.packed(manifest))
        if extra: z.writestr(*extra)
    rec = {k: manifest[k] for k in ('basePayloadInventorySha256', 'payloadFileCount', 'payloadBytes', 'finalArtifactMap')}
    rec.update(manifestSha256=hashlib.sha256(c.packed(manifest)).hexdigest(), baseArchiveSha256=c.BASE_SHA)
    return path, rec


class ArchiveControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.top = Path(self.temp.name).resolve()
        self.root = self.top/'source'; self.root.mkdir(); self.dest = self.top/'extracted'; self.dest.mkdir()
        self.pin_patch = mock.patch.object(c, 'DEPENDENCY_PINS', {}); self.pin_patch.start()
    def tearDown(self): self.pin_patch.stop(); self.temp.cleanup()
    def test_strict_json(self):
        for raw in ['{"a":1,"a":2}', '{"x":NaN}']:
            with self.assertRaises(ValueError): c.strict(raw)
    def test_unsafe_names(self):
        for name in ['../a', '/a', 'a/./b', 'a//b', 'C:secret', 'a\\b', 'a\x00b', 'private-volume-backups/object', 'x/ssh_ed25519']:
            with self.subTest(name=name), self.assertRaises(ValueError): c.safe_relative(name)
    def test_valid_synthetic_fresh_extraction(self):
        archive, receipt = zip_fixture(self.root)
        manifest, m = verifier.extract_verified(archive, self.dest, receipt)
        self.assertEqual(m['reserved']['planned'], 75)
        self.assertEqual((self.dest/'old-v3/retained.txt').read_bytes(), b'exact historical fixture bytes\n')
    def test_case_collision_rejected(self):
        archive, receipt = zip_fixture(self.root, extra=('OLD-v3/retained.txt', b'collision'))
        with self.assertRaises(ValueError): verifier.extract_verified(archive, self.dest, receipt)
    def test_symlink_zip_member_rejected(self):
        info = zipfile.ZipInfo('link'); info.create_system = 3; info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive, receipt = zip_fixture(self.root, extra=(info, b'outside'))
        with self.assertRaises(ValueError): verifier.extract_verified(archive, self.dest, receipt)
    def test_unlisted_payload_rejected(self):
        archive, receipt = zip_fixture(self.root, extra=('unlisted', b'content'))
        with self.assertRaises(ValueError): verifier.extract_verified(archive, self.dest, receipt)
    def test_changed_member_hash_rejected(self):
        def change(m): m['files']['old-v3/retained.txt']['sha256'] = '0'*64
        archive, receipt = zip_fixture(self.root, mutate=change)
        with self.assertRaises(ValueError): verifier.extract_verified(archive, self.dest, receipt)
    def test_nonmember_binding_rejected(self):
        b = put(self.root, 'round4-ranking/file.json', b'{}')
        with self.assertRaises(ValueError): c.bound(self.root, b, {})
    def test_archive_authorization_required(self):
        m = final_fixture(self.root); m['authorizeArchive'] = False
        with self.assertRaises(ValueError): c.validate_final_map(self.root, m)
    def test_no_false_complete_fit(self):
        m = final_fixture(self.root); m['combinedDevelopment']['status'] = 'INCOMPLETE_GENERATED_OUTCOMES'
        with self.assertRaises(ValueError): c.validate_final_map(self.root, m)
    def test_snapshot_is_not_complete(self):
        m = final_fixture(self.root); row = m['development']; b = row['sourceRankingReceipt']; r = c.load(self.root/b['path']); r['snapshot'] = True
        row['sourceRankingReceipt'] = put(self.root, b['path'], r)
        with self.assertRaises(ValueError): c.phase_receipts(self.root, m)
    def test_not_run_attempt_rejected(self):
        m = final_fixture(self.root); b = m['development']['sourceRankingReceipt']; source = c.load(self.root/b['path'])
        table = c.load(self.root/source['predictionTable']['path']); table['rows'][0]['producerStatus'] = 'not-run'
        source['predictionTable'] = put(self.root, source['predictionTable']['path'], table)
        m['development']['sourceRankingReceipt'] = put(self.root, b['path'], source)
        with self.assertRaises(ValueError): c.phase_receipts(self.root, m)
    def test_reporting_policy_crossbinding_rejected(self):
        m = final_fixture(self.root); other = put(self.root, 'round4-reporting/other-policy.json', {'fixture': 'other'})
        m['reporting']['finalPolicy'] = other
        with self.assertRaises(ValueError): c.phase_receipts(self.root, m)
    def test_explicit_incomplete_join_and_source_disposition_retained(self):
        m = final_fixture(self.root); combo = m['combinedDevelopment']
        join = c.load(self.root/combo['joinReceipt']['path']); join.update(status='INCOMPLETE_GENERATED_OUTCOMES', fitEligible=False)
        combo['joinReceipt'] = put(self.root, combo['joinReceipt']['path'], join)
        disposition = put(self.root, 'round4-reporting/incomplete-selection.json', {
            'schema': 'confovhh-round4-incomplete-source-disposition-v1', 'completedCombinedFit': False,
            'sourceWonComparisonClaim': False, 'selectedModel': None,
            'generatedOutcomesUnavailable': [{'id': 'synthetic-missing', 'status': 'unavailable', 'reason': 'synthetic failure'}]})
        combo.update(status='INCOMPLETE_GENERATED_OUTCOMES', fitReceipt=None, independentFitReceipt=None, incompleteDisposition=disposition)
        sb = m['reporting']['selectionReceipt']; selection = c.load(self.root/sb['path'])
        selection.update(schema='confovhh-round4-incomplete-selection-receipt-v1', status='SOURCE_BASELINE_PRESERVED_INCOMPLETE_DEVELOPMENT',
                         combinedJoinReceipt=combo['joinReceipt'], fitReceipt=None, fitVerification=None, files=[disposition])
        m['reporting']['selectionReceipt'] = put(self.root, sb['path'], selection)
        rb = m['reporting']['reservedSummaryReceipt']; report = c.load(self.root/rb['path'])
        report.update(selectionReceipt=m['reporting']['selectionReceipt'], status='NEEDS_ATTENTION')
        m['reporting']['reservedSummaryReceipt'] = put(self.root, rb['path'], report)
        c.validate_final_map(self.root, m); c.phase_receipts(self.root, m)
        selection['selectedModel'] = {'syntheticForbiddenModel': True}
        m['reporting']['selectionReceipt'] = put(self.root, sb['path'], selection)
        with self.assertRaises(ValueError): c.phase_receipts(self.root, m)
    def test_missing_method_binding_rejected(self):
        m = final_fixture(self.root); b = m['archiveImplementationFreeze']; f = c.load(self.root/b['path']); f['files'].pop()
        m['archiveImplementationFreeze'] = put(self.root, b['path'], f)
        with self.assertRaises(ValueError): c.validate_final_map(self.root, m)
    def test_dependency_pin_cannot_be_redeclared(self):
        m = final_fixture(self.root); b = m['archiveImplementationFreeze']; f = c.load(self.root/b['path'])
        f['dependencies'][0]['sha256'] = '0'*64
        m['archiveImplementationFreeze'] = put(self.root, b['path'], f)
        with self.assertRaisesRegex(ValueError, 'dependency pin differs'): c.validate_final_map(self.root, m)
    def test_dependency_code_must_still_match_before_import(self):
        m = final_fixture(self.root)
        (self.root/'round4-reporting/select_final.py').write_bytes(b'changed helper')
        with self.assertRaises(ValueError): c.validate_final_map(self.root, m)
    def test_missing_dependency_code_cannot_be_omitted_from_freeze(self):
        m = final_fixture(self.root); b = m['archiveImplementationFreeze']; f = c.load(self.root/b['path'])
        dep = f['dependencies'][0]; document = c.load(self.root/dep['path']); document['files'].pop()
        replacement = put(self.root, dep['path'], document)
        f['dependencies'][0] = replacement
        c.DEPENDENCY_PINS[replacement['path']] = replacement['sha256']
        m['archiveImplementationFreeze'] = put(self.root, b['path'], f)
        with self.assertRaisesRegex(ValueError, 'executable dependency missing'): c.validate_final_map(self.root, m)
    def test_unfinished_report_rejected(self):
        m = final_fixture(self.root); m['reporting']['reports'][0] = put(self.root, 'REPORT-V4.md', b'FINAL_PENDING_RESULT')
        with self.assertRaises(ValueError): c.validate_final_map(self.root, m)
    def test_selected_symlink_rejected(self):
        d = self.root/'round4-analysis'; d.mkdir(); (d/'link').symlink_to(self.top/'outside')
        with self.assertRaises(ValueError): c.selected(self.root, ('round4-analysis',), ())
    def test_transport_exclusions_preserve_bound_msa_reply(self):
        self.assertTrue(c.excluded('round4-cloud/recovery-archives/batch.tar.gz'))
        self.assertTrue(c.excluded('round4-generation/upload.tar.gz'))
        self.assertTrue(c.excluded('round4-cloud/cache/model.ckpt'))
        self.assertFalse(c.excluded('round4-reserved-preparation/output/captured/target/msa/raw/out.tar.gz'))
    def test_base_member_bytes_exact(self):
        base = self.top/'base.zip'; out = self.top/'out.zip'; raw = bytes(range(256))*30
        with zipfile.ZipFile(base, 'w') as z: z.writestr('historical/data.bin', raw)
        with zipfile.ZipFile(out, 'w') as z: saved = builder.copy_base(base, z)
        with zipfile.ZipFile(out) as z: self.assertEqual(z.read('historical/data.bin'), raw)
        self.assertEqual(saved['historical/data.bin']['sha256'], hashlib.sha256(raw).hexdigest())


class CredentialControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name); (self.root/'msa').mkdir()
        self.path = self.root/'msa/target_0.csv'
        # Construct a protein-alphabet AWS-lookalike, never a real credential.
        self.sequence = 'AK' + 'IA' + 'A'*16 + '-AAAA'
    def tearDown(self): self.temp.cleanup()
    def scan(self, text, authenticated=True):
        self.path.write_text(text); identity = {'bytes': self.path.stat().st_size, 'sha256': c.sha(self.path)}
        proofs = {(identity['bytes'], identity['sha256']): [{'syntheticPublicProvenance': True}]} if authenticated else {}
        return c.scan_file(self.path, identity, proofs)
    def test_proven_public_sequence_false_positive_permitted(self):
        self.assertTrue(self.scan('key,sequence\n0,'+self.sequence+'\n')['formatAwarePublicMsa'])
    def test_unproven_identical_sequence_rejected(self):
        with self.assertRaises(ValueError): self.scan('key,sequence\n0,'+self.sequence+'\n', False)
    def test_header_or_key_never_exempted(self):
        with self.assertRaises(ValueError): self.scan('key,sequence\n'+self.sequence+',AAAA\n')
    def test_other_credential_patterns_never_exempted(self):
        with self.assertRaises(ValueError): self.scan('key,sequence\n0,hf_'+'a'*24+'\n')
    def test_arbitrary_file_not_msa_exempted(self):
        self.path = self.root/'arbitrary.txt'
        with self.assertRaises(ValueError): self.scan(self.sequence)


class ReviewedSyntheticFixtureControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fixture = c.REVIEWED_SYNTHETIC_FIXTURE
        # Code-only provenance, not a scientific result or private artifact.
        self.raw = (c.ROOT / self.fixture['path']).read_bytes()
        self.path = self.root / self.fixture['path']
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(self.raw)
    def tearDown(self): self.temp.cleanup()
    def identity(self):
        return {'bytes': self.path.stat().st_size, 'sha256': c.sha(self.path)}
    def test_exact_reviewed_source_passes_and_declares_provenance(self):
        result = c.scan_file(self.path, self.identity(), {})
        self.assertFalse(result['formatAwarePublicMsa'])
        self.assertEqual(result['reviewedSyntheticCredentialFixture'], self.fixture)
    def test_exact_bytes_at_another_path_are_not_exempt(self):
        self.path = self.root / 'unreviewed.py'; self.path.write_bytes(self.raw)
        with self.assertRaisesRegex(ValueError, 'Potential credential'):
            c.scan_file(self.path, self.identity(), {})
    def test_benign_edit_invalidates_whole_file_exception(self):
        self.path.write_bytes(self.raw + b'\n# changed fixture\n')
        with self.assertRaisesRegex(ValueError, 'Potential credential'):
            c.scan_file(self.path, self.identity(), {})
    def test_appended_credential_is_not_exempt(self):
        self.path.write_bytes(self.raw + b'\n# hf_' + b'a' * 24 + b'\n')
        with self.assertRaisesRegex(ValueError, 'Potential credential'):
            c.scan_file(self.path, self.identity(), {})
    def test_forged_original_identity_does_not_exempt_changed_bytes(self):
        original = self.identity()
        self.path.write_bytes(self.raw + b'\n# changed fixture\n')
        with self.assertRaisesRegex(ValueError, 'fixture bytes changed'):
            c.scan_file(self.path, original, {})
    def test_false_digest_does_not_exempt_original_bytes(self):
        forged = {'bytes': len(self.raw), 'sha256': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'Potential credential'):
            c.scan_file(self.path, forged, {})
    def test_original_independent_review_binds_exact_fixture(self):
        review = c.load(c.ROOT / 'round4-outcomes/ARCHIVE-INDEPENDENT-REVIEW.json')
        self.assertIn(self.fixture, review['controls'])


class IsolationControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name).resolve()
        self.original = self.root/'original'; self.original.mkdir()
        self.extracted = self.root/'extracted'; self.extracted.mkdir(); (self.extracted/'round4-archive').mkdir()
        self.node = verifier.node_wrapper(self.extracted, Path(verifier.NODE))
        self.env = verifier.isolated_environment(self.extracted, self.node)
    def tearDown(self): self.temp.cleanup()
    def python(self, source):
        script = self.extracted/'round4-archive/probe.py'; script.write_text(source)
        return subprocess.run([sys.executable, '-I', '-B', '-c', verifier.BOOTSTRAP, str(self.original), str(script)],
                              cwd=self.extracted, env=self.env, capture_output=True, text=True)
    def test_python_original_artifact_read_blocked(self):
        p = self.original/'synthetic.txt'; p.write_text('synthetic original')
        result = self.python('from pathlib import Path\nPath('+repr(str(p))+').read_bytes()\n')
        self.assertNotEqual(result.returncode, 0); self.assertIn('Original scientific artifact access forbidden', result.stderr)
    def test_python_extracted_read_permitted(self):
        p = self.extracted/'synthetic.txt'; p.write_text('synthetic extracted')
        result = self.python('from pathlib import Path\nassert Path('+repr(str(p))+').read_text()=="synthetic extracted"\n')
        self.assertEqual(result.returncode, 0, result.stderr)
    def test_python_network_and_arbitrary_subprocess_blocked(self):
        for source in ['import socket\nsocket.socket()\n', 'import subprocess\nsubprocess.run(["/bin/echo","test"])\n']:
            result = self.python(source); self.assertNotEqual(result.returncode, 0); self.assertIn('forbidden', result.stderr.lower())
    def test_node_original_read_blocked(self):
        p = self.original/'synthetic.txt'; p.write_text('synthetic original')
        probe = self.extracted/'probe.mjs'; probe.write_text('import fs from "node:fs"; fs.readFileSync('+json.dumps(str(p))+');')
        result = subprocess.run([str(self.node), str(probe)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0); self.assertIn('ERR_ACCESS_DENIED', result.stderr)
    def test_node_permission_and_child_overrides_rejected(self):
        probe = self.extracted/'probe.mjs'; probe.write_text('console.log("allowed script")')
        for option in ['--allow-fs-read='+str(self.original), '--allow-child-process']:
            for argv in [[option, str(probe)], [str(probe), option]]:
                result = subprocess.run([str(self.node), *argv], env=self.env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('allowed script', result.stdout)
    def test_python_rejects_node_option_and_environment_injection(self):
        probe = self.extracted/'probe.mjs'; probe.write_text('console.log("allowed script")')
        source = 'import os,subprocess\nsubprocess.run([os.environ["CONFOVHH_NODE_BINARY"],'+repr(str(probe))+',"--allow-child-process"])\n'
        result = self.python(source); self.assertNotEqual(result.returncode, 0); self.assertIn('injection option forbidden', result.stderr)
        source = 'import os,subprocess\nsubprocess.run([os.environ["CONFOVHH_NODE_BINARY"],"--version"],env=dict(os.environ,NODE_OPTIONS="--allow-child-process"))\n'
        result = self.python(source); self.assertNotEqual(result.returncode, 0); self.assertIn('environment injection forbidden', result.stderr)
    def test_guarded_node_child_from_python_permitted(self):
        result = self.python('import os,subprocess\nassert subprocess.check_output([os.environ["CONFOVHH_NODE_BINARY"],"--version"],text=True).strip()=="v24.19.0"\n')
        self.assertEqual(result.returncode, 0, result.stderr)
    def test_guarded_extracted_node_script_from_python_permitted(self):
        data = self.extracted/'data.txt'; data.write_text('exact extracted fixture')
        probe = self.extracted/'probe.mjs'; probe.write_text('import fs from "node:fs"; if(fs.readFileSync('+json.dumps(str(data))+',"utf8")!=="exact extracted fixture")throw Error("wrong");')
        result = self.python('import os,subprocess\nsubprocess.run([os.environ["CONFOVHH_NODE_BINARY"],'+repr(str(probe))+'],check=True)\n')
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__': unittest.main(verbosity=2)
