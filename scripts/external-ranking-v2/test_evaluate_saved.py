import importlib.util
import copy
import itertools
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('v2_eval', pathlib.Path(__file__).with_name('evaluate_saved.py'))
eval_ = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eval_)


def rank_record(rows, selected, status='ranked'):
    return {'setId':'s','arm':'hybrid-SG','scoreName':'fixed test','direction':'higher-better','status':status,'reason':'',
            'rows':[{'id':i,'rank':r,'key':[1/r] if r else None,'status':'scored' if r else 'unavailable','reason':''} for i,r in rows], 'selected':selected}


class MetricsTests(unittest.TestCase):
    def test_boolean_and_nonfinite_are_not_outcome_numbers(self):
        for value in (True, False, float('nan'), float('inf'), '0.5', None):
            self.assertFalse(eval_.finite_number(value))
        self.assertTrue(eval_.finite_number(0.5))
        self.assertTrue(eval_.finite_number(0))

    def test_extended_membership_and_ledger_identity_reject_adversarial_rows(self):
        attempt = {'id':'a','setId':'s','generatorId':'g','status':'generated'}
        feature = {'id':'a','setId':'s','generatorId':'g','coordinateSha256':'coordinate'}
        data = {'source-manifest.json':{'attempts':[attempt]},
                'attempts.json':[{'id':'a','setId':'s','generatorId':'g','producerStatus':'generated','status':'scored'}],
                'source-features.json':[feature],
                'features.json':[{'id':'a','setId':'s','generatorId':'g','sourceFeature':feature,'coordinateSha256':'coordinate','sourceAuditSha256':'audit'}],
                'percentiles.json':[{'setId':'s','component':c,'status':'complete','rows':[{'id':'a','value':1,'percentile':.5}]} for c in ('S','G','P','F','D')]}
        score = {'attemptCount':1,'scoredCount':1,'attemptsSha256':'ledger'}
        original = {'attemptsSha256':'ledger','artifactHashes':{'a/audit.json':'audit'}}
        eval_.verify_extended_membership(data,score,original)
        mutations = [
            lambda d: d['attempts.json'][0].update(setId='wrong'),
            lambda d: d['attempts.json'][0].update(generatorId='wrong'),
            lambda d: d['attempts.json'][0].update(producerStatus='failed'),
            lambda d: d['source-features.json'].clear(),
            lambda d: d['features.json'].clear(),
            lambda d: d['features.json'][0].update(id='wrong'),
            lambda d: d['features.json'][0].update(sourceAuditSha256='wrong'),
            lambda d: d['percentiles.json'].pop(),
            lambda d: d['percentiles.json'][0]['rows'][0].update(id='wrong'),
            lambda d: d['percentiles.json'][0]['rows'][0].update(value=None),
            lambda d: d['percentiles.json'][0]['rows'][0].update(percentile=True),
        ]
        for mutate in mutations:
            changed=copy.deepcopy(data);mutate(changed)
            with self.assertRaises(ValueError): eval_.verify_extended_membership(changed,score,original)
        with self.assertRaisesRegex(ValueError,'digest'):
            eval_.verify_extended_membership(data,{**score,'attemptsSha256':'changed'},original)

    def test_top_five_equals_all_tie_permutations(self):
        record=rank_record([('a',1),('b',1),('c',2),('d',2),('e',2),('f',2),('g',3)],['a','b'])
        values={'a':0.1,'b':0.9,'c':0.0,'d':0.2,'e':0.6,'f':0.8,'g':0.7}
        result=eval_.summarize_saved(record,values)
        means=[];counts=[]
        for top in itertools.permutations('ab'):
            for middle in itertools.permutations('cdef'):
                ids=(top+middle+('g',))[:5]
                means.append(sum(values[x] for x in ids)/5)
                counts.append(sum(values[x]>=.23 for x in ids))
        self.assertAlmostEqual(result['practicalWindows']['top5']['meanDockQ'],sum(means)/len(means))
        self.assertAlmostEqual(result['practicalWindows']['top5']['correctCountsByThreshold']['0.23'],sum(counts)/len(counts))
        self.assertAlmostEqual(result['practicalWindows']['top1']['meanDockQ'],.5)
        self.assertAlmostEqual(result['practicalWindows']['top1']['correctCountsByThreshold']['0.23'],.5)

    def test_missing_outcome_preserves_mass(self):
        record=rank_record([('a',1),('b',1),('c',2)],['a','b'])
        result=eval_.summarize_saved(record,{'a':.8,'b':None,'c':0})
        item=result['practicalWindows']['top1']
        self.assertIsNone(item['meanDockQ'])
        self.assertEqual(item['meanDockQBounds'],[.4,.9])
        self.assertIsNone(result['pairwiseAUROCByThreshold'])

    def test_abstention_has_no_selection_windows(self):
        record=rank_record([('a',None),('b',None)],[],status='abstain')
        result=eval_.summarize_saved(record,{'a':.8,'b':0})
        self.assertIsNone(result['practicalWindows'])

    def test_short_set_top_five_contains_all(self):
        result=eval_.summarize_saved(rank_record([('a',1),('b',2)],['a']),{'a':.8,'b':0})
        self.assertEqual(result['practicalWindows']['top5']['size'],2)
        self.assertEqual(result['practicalWindows']['top5']['meanDockQ'],.4)

    def test_group_weights_not_pose_or_method_counts(self):
        rows=[]
        for s,q in [('s1',.9),('s2',.5),('s3',.2)]:
            r=rank_record([('a',1),('b',2)],['a']);r['setId']=s
            rows.append(eval_.summarize_saved(r,{'a':q,'b':0}))
        result=eval_.biological_summary(rows,{'s1':'A','s2':'A','s3':'B'})[0]
        self.assertAlmostEqual(result['equalGroupMean']['top1MeanDockQ'],.45)

    def test_group_missing_values_not_dropped(self):
        rows=[]
        for s,q in [('s1',.9),('s2',None)]:
            r=rank_record([('a',1),('b',2)],['a']);r['setId']=s
            rows.append(eval_.summarize_saved(r,{'a':q,'b':0}))
        result=eval_.biological_summary(rows,{'s1':'A','s2':'B'})[0]
        self.assertIsNone(result['equalGroupMean']['top1MeanDockQ'])


if __name__=='__main__': unittest.main()
