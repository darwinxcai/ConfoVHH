import importlib.util
import math
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('selectors', ROOT / 'scripts/paper/graded-clash-selectors-v1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def feature(id='a', **changes):
    return dict(id=id, coordinateSha256='a'*64, confidenceSha256='b'*64,
                evidenceTier=1, burial=1000., contacts=20, clashes=1,
                overlapBurden=.05, confidence=.8, **{}) | changes


class SelectorTests(unittest.TestCase):
    def test_ties_and_permutation(self):
        a, b = feature('z'), feature('a')
        first = m.rank([a, b])
        self.assertTrue(all(r['rank'] == 1 for r in first))
        key = lambda r: (r['id'], r['arm'])
        self.assertEqual(sorted(first, key=key), sorted(m.rank([b, a]), key=key))

    def test_reference_fields_rejected(self):
        for name in ('DockQ', 'nativeContacts', 'observedResidueMask', 'reference'):
            with self.assertRaises(ValueError):
                m.rank([feature() | {name: 1}])

    def test_duplicates_rejected(self):
        with self.assertRaises(ValueError):
            m.rank([feature(), feature()])

    def test_missing_is_per_arm_not_zero(self):
        rows = {r['arm']: r for r in m.rank([feature(confidence=None)])}
        self.assertIsNone(rows['predictor-confidence']['rank'])
        self.assertIsNone(rows['predictor-confidence']['key'])
        self.assertEqual(rows['burial-only']['rank'], 1)
        for value in (None, math.nan, math.inf, -1.):
            rows = {r['arm']: r for r in m.rank([feature(burial=value)])}
            self.assertIsNone(rows['overlap-burial-v1']['rank'])

    def test_no_contact_is_unavailable(self):
        rows = {r['arm']: r for r in m.rank([feature(contacts=0, clashes=0)])}
        self.assertIsNone(rows['clash-fraction-v1']['rank'])
        self.assertIsNone(rows['overlap-burial-v1']['rank'])

    def test_gradual_penalty_at_severe_threshold(self):
        eps = 1e-8
        features = [feature('below', clashes=0, overlapBurden=((.6-eps)/.6)**2/20),
                    feature('above', clashes=1, overlapBurden=((.6+eps)/.6)**2/20)]
        rows = m.rank(features)
        smooth = [r['key'][0] for r in rows if r['arm'] == 'overlap-burial-v1']
        fraction = [r['key'][0] for r in rows if r['arm'] == 'clash-fraction-v1']
        self.assertLess(abs(smooth[0]-smooth[1]), .00001)
        self.assertEqual(fraction[0]-fraction[1], 50.)

    def test_penalty_monotonic_at_fixed_burial_and_contacts(self):
        rows = m.rank([feature('less', clashes=0, overlapBurden=0.),
                       feature('more', clashes=2, overlapBurden=.2)])
        for arm in ('clash-fraction-v1', 'overlap-burial-v1'):
            selected = [r['id'] for r in rows if r['arm'] == arm and r['rank'] == 1]
            self.assertEqual(selected, ['less'])


if __name__ == '__main__':
    unittest.main()
