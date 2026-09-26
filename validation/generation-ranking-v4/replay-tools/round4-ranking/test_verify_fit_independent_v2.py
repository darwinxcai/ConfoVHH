import copy
import unittest
from unittest.mock import patch
import ranker as r
import verify_fit_independent_v2 as v

def fixture():
    rows=[];labels={};groups={f'T{i}':f'G{i}' for i in range(4)}
    for target in groups:
        for arm in ('baseline','broader'):
            for batch in ('old','new') if arm=='baseline' else ('new',):
                for i in range(4):
                    rid=f'{target}/{arm}/{batch}/{i}';value=.1+.2*i
                    row={'id':rid,'setId':target,'poolId':f'{target}/{arm}/{batch}','generationArm':arm,'seedBatch':batch,
                         'producerStatus':'generated','sourceValue':.9-.1*i,'sourceDirection':'higher-better','validityStatus':'valid','coordinateSha256':'0'*64,
                         'profile':{'producerVersion':'synthetic','modelSha256':'1'*64,'scoreContext':'pair-confidence','generationRegimeSha256':arm},
                         'features':{k:value for k in r.FEATURES}}
                    rows.append(row);labels[rid]=value
    return rows,labels,groups

def saved(rows,labels,groups,family='confidence'):
    nested=r.nested_validate(rows,labels,groups,family);lam,trace=r.select_setting(rows,labels,groups,family)
    model=r.source_model(family,rows,groups) if lam is None else r.fit_ridge(rows,labels,groups,family,lam)
    return nested,trace,model

class IndependentV2Tests(unittest.TestCase):
    def assert_verify(self,rows,labels,groups,family='confidence'):
        data=saved(rows,labels,groups,family)
        # Freeze the actual implementation out of reach while expected values
        # are computed, so accidental calls cannot make this a circular test.
        with patch.object(r,'rank',side_effect=AssertionError('Expected rank must be independent')),patch.object(r,'fit_ridge',side_effect=AssertionError('Expected fit must be independent')),patch.object(r,'evaluate',side_effect=AssertionError('Expected metric must be independent')),patch.object(r,'select_setting',side_effect=AssertionError('Expected selection must be independent')):
            report=v.verify_family(*data,rows,labels,groups,family,set())
        return data,report
    def test_complete_mixed_arms_batches_and_learned_models(self):
        for family in ('confidence','interface'):
            with self.subTest(family=family):
                data,report=self.assert_verify(*fixture(),family)
                self.assertEqual(report['plannedRowsVerified'],48);self.assertEqual(report['plannedPools'],12)
                self.assertEqual(report['finalKind'],'ridge')
    def test_related_targets_and_unequal_pool_sizes_keep_hierarchical_weights(self):
        rows,labels,groups=fixture();groups['T1']=groups['T0']
        removed=rows.pop(0);labels.pop(removed['id'])
        data,report=self.assert_verify(rows,labels,groups,'interface')
        self.assertEqual(report['outerGroupsVerified'],3);self.assertEqual(report['plannedRowsVerified'],47)
        expected=v.weights(v.pools(rows),groups)
        self.assertAlmostEqual(sum(expected.values()),1.)
        self.assertAlmostEqual(sum(w for p,w in expected.items() if p.startswith('T0/')),1/6)
        self.assertAlmostEqual(sum(w for p,w in expected.items() if p.startswith('T2/')),1/3)
    def test_nonproduction_and_empty_pool_remain_in_coverage(self):
        rows,labels,groups=fixture();empty=rows[0]['poolId']
        for x in rows:
            if x['poolId']==empty:
                x.update(producerStatus='failed',sourceValue=None,validityStatus='unavailable',coordinateSha256=None);labels[x['id']]=None
        rows[5].update(producerStatus='failed',sourceValue=None,coordinateSha256=None);labels[rows[5]['id']]=None
        data,report=self.assert_verify(rows,labels,groups)
        self.assertEqual(report['selectedPools'],11);self.assertIsNone(report['allPlannedFirstDockQ'])
        self.assertEqual(len(data[0]['ranks']),48)
    def test_missing_source_produces_whole_pool_abstention(self):
        rows,labels,groups=fixture();rows[0]['sourceValue']=None
        data,report=self.assert_verify(rows,labels,groups)
        self.assertEqual(report['selectedPools'],11);self.assertIsNone(report['allPlannedFirstDockQ'])
    def test_optional_feature_fallback_and_eligible_group_minimum(self):
        rows,labels,groups=fixture()
        for row in rows:
            if row['setId']!='T0':row['features']['cdr_share']=None
        data,report=self.assert_verify(rows,labels,groups,'interface')
        self.assertEqual(report['finalKind'],'source');self.assertTrue(all(not x['selection']['candidates'] for x in data[0]['folds']))
    def test_source_ties_keep_fractional_window_and_lower_direction(self):
        rows,labels,groups=fixture()
        for row in rows:row['sourceValue']=.1;row['sourceDirection']='lower-better'
        expected=v.expected_ranks(rows)
        self.assertEqual(expected,r.rank(rows));v.same(v.metric(rows,labels,groups,expected),r.evaluate(rows,labels,groups,expected))
        self.assertTrue(all(x['rankMin']==1 and x['rankMax']==4 for x in expected))
    def test_tied_block_crossing_top5_keeps_fractional_mass(self):
        row=fixture()[0][0];rows=[];ys=[.9,.8,.7,.1,.2,.3,.4];scores=[3.,2.,1.,0.,0.,0.,0.]
        for i,score in enumerate(scores):
            item=copy.deepcopy(row);item['id']=str(i);item['sourceValue']=score;rows.append(item)
        labels={str(i):q for i,q in enumerate(ys)};groups={row['setId']:'G'};ranks=v.expected_ranks(rows)
        report=v.metric(rows,labels,groups,ranks)
        self.assertAlmostEqual(report['aggregate']['top5MeanDockQ'],.58)
        self.assertAlmostEqual(report['aggregate']['top5ExpectedAcceptableCount'],4.)
        self.assertTrue(all(x['rankMin']==4 and x['rankMax']==7 for x in ranks if int(x['id'])>=3))
        v.same(report,r.evaluate(rows,labels,groups,r.rank(rows)))
    def test_singleton_constant_features_pair_matrix_can_be_empty(self):
        rows,labels,groups=fixture();rows=[x for x in rows if x['id'].endswith('/0')];labels={x['id']:.1 for x in rows}
        model=r.fit_ridge(rows,labels,groups,'confidence',.1)
        v.verify_model(model,rows,labels,groups,'confidence',.1)
        self.assertEqual(model['coefficients'],[0.]*4)
    def test_nonfinite_boolean_and_missing_generated_outcome_rejected(self):
        for field,value in [('sourceValue',float('nan')),('sourceValue',True)]:
            rows,labels,groups=fixture();rows[0][field]=value
            with self.assertRaises(ValueError):v.validate_inputs(rows,labels,groups)
        rows,labels,groups=fixture();labels[rows[0]['id']]=None
        with self.assertRaisesRegex(ValueError,'outcome unavailable'):v.validate_inputs(rows,labels,groups)
    def test_dropped_attempt_or_rehashed_fold_leakage_rejected(self):
        rows,labels,groups=fixture();nested,trace,model=saved(rows,labels,groups)
        changed=copy.deepcopy(nested);changed['ranks'].pop()
        with self.assertRaises(ValueError):v.verify_family(changed,trace,model,rows,labels,groups,'confidence',set())
        changed=copy.deepcopy(nested);inner=changed['folds'][0]['selection']['candidates'][0]['folds'][0]
        held=inner['heldOutGroup'];leaked=next(x['id'] for x in rows if groups[x['setId']]==held)
        inner['model']['trainingIds'].append(leaked);inner['trainingIds']=inner['model']['trainingIds'];inner['modelDigest']=v.digest(inner['model'])
        with self.assertRaisesRegex(ValueError,'leakage'):v.verify_family(changed,trace,model,rows,labels,groups,'confidence',set())
    def test_boolean_hyperparameter_cannot_impersonate_numeric_grid(self):
        rows,labels,groups=fixture();nested,trace,model=saved(rows,labels,groups)
        trace['candidates'][2]['lambda']=True
        with self.assertRaisesRegex(ValueError,'grid/coverage'):v.verify_family(nested,trace,model,rows,labels,groups,'confidence',set())

if __name__=='__main__':unittest.main(verbosity=2)
