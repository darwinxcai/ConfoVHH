#!/usr/bin/env python3
"""Offline archive regression checks; fixture mutations stay in temporary copies."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
import collect
import replay


class CitationArchiveChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='confovhh-c5-verification-')
        self.archive = Path(self.temp.name) / 'archive'
        shutil.copytree(replay.HERE, self.archive, ignore=shutil.ignore_patterns('__pycache__'))
        self.patches = [patch.object(replay, 'HERE', self.archive),
                        patch.object(collect, 'HERE', self.archive),
                        patch('urllib.request.urlopen', side_effect=AssertionError('Replay attempted network access'))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def replace_response(self, request_id, mutate):
        capture_path = self.archive / 'captures' / f'{request_id}.json'
        capture = json.loads(capture_path.read_text())
        raw_path = self.archive / capture['rawFile']
        response = json.loads(raw_path.read_text())
        mutate(response)
        raw_path.write_text(collect.dump(response))
        capture.update(sha256=collect.sha(raw_path.read_bytes()), bytes=raw_path.stat().st_size)
        capture_path.write_text(collect.dump(capture))
        manifest_path = self.archive / 'capture-manifest.json'
        manifest = json.loads(manifest_path.read_text())
        for row in manifest['captures']:
            if row['requestId'] == request_id:
                row['sha256'] = collect.sha(capture_path.read_bytes())
        manifest_path.write_text(collect.dump(manifest))

    def test_actual_archive_replays_without_network(self):
        result = replay.main()
        self.assertEqual(result['citationGapEntries'], 60)
        self.assertEqual(result['newExactPrimaryDepositionLinks'], 7)
        self.assertFalse(result['targetFreezePermitted'])

    def test_rehashed_wrong_query_options_are_rejected(self):
        self.replace_response('title-01', lambda response: response['request'].update(synonym=True))
        with self.assertRaisesRegex(AssertionError, 'Bibliography query options differ'):
            replay.main()

    def test_rehashed_repeat_author_change_is_rejected(self):
        self.replace_response('rcsb-01-repeat-2', lambda response:
                              response['data']['entries'][0]['rcsb_primary_citation'].update(rcsb_authors=['Altered fixture author']))
        with self.assertRaisesRegex(AssertionError, 'Full citation fields differ between repeats'):
            replay.main()

    def test_prior_source_review_hash_is_checked(self):
        path = self.archive / 'source-notes.json'
        notes = json.loads(path.read_text())
        next(row for row in notes['reviews'] if row['pdbId'] == '8HN1')['priorSourceReviewRef']['sha256'] = '0' * 64
        path.write_text(collect.dump(notes))
        with self.assertRaisesRegex(AssertionError, 'Prior source review hash differs'):
            replay.main()


if __name__ == '__main__':
    unittest.main()
