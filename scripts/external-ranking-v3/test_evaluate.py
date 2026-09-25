import copy
import itertools
import unittest

from evaluate import evaluate_record, aggregate_groups, window_weights


def record(scores=(.9, .8, .7), invalid=(), missing=(), not_produced=(), validity=True, no_contact=False, set_id='set'):
    rows = []
    for i, score in enumerate(scores):
        id_ = chr(97+i)
        state = 'not-produced' if id_ in not_produced else 'invalid' if id_ in invalid else 'valid'
        source = 'not-produced' if id_ in not_produced else 'missing' if id_ in missing else 'present'
        eligible = state != 'not-produced' and (not validity or state == 'valid')
        key = [score] if eligible and source == 'present' else None
        rows.append({'id':id_, 'key':key, 'rank':None, 'eligible':eligible,
                     'status':'scored' if key else 'unavailable' if eligible else 'excluded',
                     'sourceStatus':source, 'validityStatus':state,
                     'interfaceStatus':'not-produced' if state == 'not-produced' else 'invalid-input' if state == 'invalid' else 'no-contact' if no_contact else 'contacting'})
    ordered = sorted({tuple(r['key']) for r in rows if r['key']}, reverse=True)
    for r in rows:
        if r['key']:
            r['rank'] = ordered.index(tuple(r['key']))+1
    eligible = [r for r in rows if r['eligible']]
    absent = sum(r['key'] is None for r in eligible)
    available = bool(eligible) and not absent
    return {'setId':set_id, 'arm':'source-validity' if validity else 'source-only', 'rows':rows,
            'status':'ranked' if available else 'abstain', 'reason':'' if available else 'Selection unavailable',
            'selected':sorted(r['id'] for r in rows if r['rank'] == 1) if available else [],
            'selectionPolicy':{'validityApplied':validity},
            'coverage':{'plannedCount':len(rows), 'producedCount':len(rows)-len(not_produced),
                        'eligibleCount':len(eligible), 'excludedCount':len(rows)-len(eligible),
                        'sourceRankedCount':sum(r['key'] is not None for r in rows), 'missingSourceCount':absent}}


def evaluate(rec, outcomes=None):
    return evaluate_record(rec, outcomes or {r['id']:.1 for r in rec['rows']}, [r['id'] for r in rec['rows']])


class SavedEvaluationTests(unittest.TestCase):
    def test_tie_windows_match_exhaustive_permutations(self):
        rec = record((.9,.9,.9,.8,.8,.8,.8,.7,.6,.6,.6,.6))
        rows = rec['rows']
        groups = [[r['id'] for r in rows if r['rank'] == rank] for rank in range(1,6)]
        permutations = [sum((list(part) for part in parts), []) for parts in itertools.product(*(itertools.permutations(g) for g in groups))]
        for k in (1,5,10):
            exact = {r['id']:sum(r['id'] in order[:k] for order in permutations)/len(permutations) for r in rows}
            actual = window_weights(rows,k)
            self.assertEqual(actual,{key:value for key,value in exact.items() if value})
            self.assertAlmostEqual(sum(actual.values()),k)
        outcomes = {r['id']:.1 for r in rows}; outcomes['b'] = .7
        result = evaluate(rec,outcomes)
        self.assertAlmostEqual(result['firstChoiceDockQ'],.3)
        self.assertAlmostEqual(result['firstChoiceAcceptableProbability'],1/3)

    def test_invalid_baseline_choice_preserved_and_policy_denominators_explicit(self):
        values = {'a':.95,'b':.5,'c':.1}
        baseline = evaluate(record(invalid=('a',),validity=False),values)
        filtered = evaluate(record(invalid=('a',)),values)
        self.assertEqual(baseline['selected']['ids'],['a'])
        self.assertEqual(filtered['selected']['ids'],['b'])
        self.assertEqual(filtered['pools']['allPlanned']['size'],3)
        self.assertEqual(filtered['pools']['allProduced']['size'],3)
        self.assertEqual(filtered['pools']['policyEligible']['size'],2)
        self.assertEqual(filtered['coverage']['eligibleFractionOfProduced'],2/3)
        values['a'] = 0
        self.assertEqual(evaluate(record(invalid=('a',)),values)['firstChoiceDockQ'],.5)

    def test_missing_source_on_invalid_row_does_not_poison_valid_selection(self):
        rec = record(invalid=('a',),missing=('a',))
        self.assertEqual(evaluate(rec)['selected']['ids'],['b'])
        absent = record(missing=('b',))
        result = evaluate(absent)
        self.assertEqual(result['status'],'abstain')
        self.assertIsNone(result['firstChoiceDockQ'])
        self.assertIsNone(result['practicalWindows'])
        self.assertEqual(result['coverage']['sourceRankedCount'],2)
        self.assertEqual(result['coverage']['missingSourceCount'],1)

    def test_missing_selected_outcome_keeps_probability_mass_and_bounds(self):
        result = evaluate(record((.9,.9,.7)),{'a':.6,'b':None,'c':.1})
        summary = result['selected']['summary']
        self.assertEqual(summary['missingOutcomeMass'],.5)
        self.assertIsNone(summary['meanDockQ'])
        self.assertEqual(summary['meanDockQBounds'],[.3,.8])
        self.assertEqual(summary['correctCountBoundsByThreshold']['0.23'],[.5,1])
        self.assertIsNone(result['firstChoiceAcceptableProbability'])
        self.assertFalse(result['eligibleRankingMetrics']['complete'])
        unselected_missing = evaluate(record(),{'a':.6,'b':.3,'c':None})
        self.assertEqual(unselected_missing['firstChoiceDockQ'],.6)
        self.assertFalse(unselected_missing['eligibleRankingMetrics']['complete'])

    def test_no_contact_and_no_valid_input_are_distinct(self):
        supported = evaluate(record(no_contact=True))
        self.assertEqual(supported['status'],'ranked')
        self.assertEqual(supported['interfaceSupport']['status'],'unsupported-all-no-contact')
        self.assertEqual(supported['interfaceSupport']['selectedStateProbabilities']['no-contact'],1)
        invalid = evaluate(record(invalid=('a','b','c')))
        self.assertEqual(invalid['status'],'abstain')
        self.assertEqual(invalid['interfaceSupport']['status'],'no-valid-inputs')
        self.assertIsNone(invalid['practicalWindows'])

    def test_failed_attempts_remain_in_planned_pool(self):
        result = evaluate(record(not_produced=('c',)),{'a':.7,'b':.1})
        self.assertEqual(result['coverage']['notProducedCount'],1)
        self.assertEqual(result['pools']['allPlanned']['missingOutcomeMass'],1)
        self.assertEqual(result['pools']['allProduced']['missingOutcomeMass'],0)
        self.assertEqual(result['missingOutcomeIdsAllPlanned'],['c'])
        self.assertEqual(result['missingOutcomeIdsEligible'],[])

    def test_invalid_membership_ties_coverage_booleans_and_states_rejected(self):
        original = record()
        mutations = [lambda r:r['coverage'].__setitem__('plannedCount',2),
                     lambda r:r['rows'][0].__setitem__('id','b'),
                     lambda r:r['rows'][0].__setitem__('rank',2),
                     lambda r:r['rows'][0].__setitem__('eligible',1),
                     lambda r:r['rows'][0].__setitem__('key',[True]),
                     lambda r:r['rows'][0].__setitem__('interfaceStatus','invalid-input'),
                     lambda r:r['rows'][0].__setitem__('validityStatus','not-produced'),
                     lambda r:r.__setitem__('selected',['b'])]
        for mutation in mutations:
            rec = copy.deepcopy(original); mutation(rec)
            with self.assertRaises(ValueError):
                evaluate_record(rec,{'a':.1,'b':.2,'c':.3},['a','b','c'])
        for value in (True,False,float('inf'),float('nan'),-1,1.1):
            with self.assertRaises(ValueError):
                evaluate(original,{'a':value,'b':.2,'c':.3})
        boolean_coverage = record((.9,))
        boolean_coverage['coverage']['plannedCount'] = True
        with self.assertRaises(ValueError):
            evaluate(boolean_coverage)

    def test_ranking_metrics_correct_on_reverse_and_tied_rankings(self):
        result = evaluate(record(),{'a':.1,'b':.5,'c':.9})
        self.assertAlmostEqual(result['eligibleRankingMetrics']['spearmanPreferenceVsDockQ'],-1)
        self.assertEqual(result['eligibleRankingMetrics']['pairwiseAUROCByThreshold']['0.23'],0)
        tied = evaluate(record((.9,.9,.9)),{'a':.1,'b':.5,'c':.9})
        self.assertIsNone(tied['eligibleRankingMetrics']['spearmanPreferenceVsDockQ'])
        self.assertEqual(tied['eligibleRankingMetrics']['pairwiseAUROCByThreshold']['0.23'],.5)

    def test_group_means_weight_groups_equally_and_do_not_drop_abstentions(self):
        records = [evaluate(record((.9,),set_id=s),{'a':q}) for s,q in [('s1',1),('s2',0),('s3',0)]]
        membership = {'s1':'group1','s2':'group2','s3':'group2'}
        aggregate = aggregate_groups(records,membership)[0]
        self.assertEqual(aggregate['equalGroupMeans']['firstChoiceDockQ'],.5)
        records[1] = evaluate(record((.9,),missing=('a',),set_id='s2'),{'a':.8})
        aggregate = aggregate_groups(records,membership)[0]
        self.assertIsNone(aggregate['equalGroupMeans']['firstChoiceDockQ'])
        self.assertEqual(aggregate['groups'][1]['plannedSets'],2)
        self.assertEqual(aggregate['groups'][1]['selectionAvailableSets'],1)
        with self.assertRaises(ValueError):
            aggregate_groups(records,{'s1':'group1','s2':'group2'})


if __name__ == '__main__':
    unittest.main()
