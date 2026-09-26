import copy
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import ranker as r
import artifacts as a
import run

def fixture(groups=4,poses=6):
    rows=[];labels={};grouping={}
    for g in range(groups):
        target='target'+str(g);grouping[target]='group'+str(g)
        for i in range(poses):
            v=.1+.8*i/(poses-1);ident=target+'_'+str(i)
            rows.append({'id':ident,'setId':target,'poolId':target+'::baseline::batch','generationArm':'baseline','seedBatch':'batch',
                         'producerStatus':'generated','sourceValue':1-v,'sourceDirection':'higher-better','validityStatus':'valid','coordinateSha256':'0'*64,
                         'profile':{'producerVersion':'v','modelSha256':'1'*64,'scoreContext':'pair-confidence','generationRegimeSha256':'2'*64},
                         'features':{'complex_plddt':v,'iptm':v,'complex_iplddt':v,'log1p_complex_ipde':1-v,
                                     'log1p_contact_pairs':v,'cdr_share':v,'unnumbered_share':1-v}})
            labels[ident]=.3+.6*i/(poses-1) # All acceptable; continuous ranking must still improve.
    return rows,labels,grouping

class RankerTests(unittest.TestCase):
    def test_injected_outcome_and_arbitrary_feature_rejected(self):
        rows,_,_=fixture();rows[0]['DockQ']=.9
        with self.assertRaisesRegex(ValueError,'outcome injection'):r.rank(rows)
        rows,_,_=fixture();rows[0]['features']['reference_rmsd']=0
        with self.assertRaisesRegex(ValueError,'Unexpected inference feature'):r.rank(rows)

    def test_boolean_nonfinite_duplicate_rejected(self):
        for key,value in [('sourceValue',True),('sourceValue',float('nan'))]:
            rows,_,_=fixture();rows[0][key]=value
            with self.assertRaises(ValueError):r.rank(rows)
        rows,_,_=fixture();rows[0]['features']['cdr_share']=True
        with self.assertRaises(ValueError):r.rank(rows)
        rows,_,_=fixture()
        with self.assertRaises(ValueError):r.rank(rows+[rows[0]])

    def test_source_exact_and_lower_direction(self):
        rows,_,_=fixture(groups=1);rr=r.rank(rows)
        self.assertEqual(rr[0]['rankMin'],1);self.assertEqual(rr[0]['score'],rows[0]['sourceValue'])
        for x in rows:x['sourceDirection']='lower-better'
        self.assertEqual(r.rank(rows)[-1]['rankMin'],1)

    def test_failed_attempt_kept_without_poisoning_produced(self):
        rows,labels,groups=fixture(groups=1);failed=rows[0]
        failed.update(producerStatus='failed',sourceValue=None,validityStatus='unavailable',coordinateSha256=None)
        failed['features']={k:None for k in r.FEATURES};labels[failed['id']]=None
        ranked=r.rank(rows);self.assertEqual(ranked[0]['status'],'not-produced')
        self.assertEqual(ranked[1]['rankMin'],1)
        m=r.fit_ridge(rows,labels,groups,'confidence',.1)
        ev=r.evaluate(rows,labels,groups,r.rank(rows,m))
        self.assertEqual(ev['aggregate']['plannedAttempts'],6);self.assertEqual(ev['aggregate']['producedCandidates'],5)
        self.assertTrue(ev['aggregate']['complete'])

    def test_produced_missing_source_abstains_whole_pool(self):
        rows,labels,groups=fixture(groups=1);rows[0]['sourceValue']=None
        self.assertTrue(all(q['status']=='abstained' for q in r.rank(rows)))
        self.assertIsNone(r.evaluate(rows,labels,groups,r.rank(rows))['aggregate']['firstDockQ'])

    def test_no_produced_pool_retains_all_attempts(self):
        rows,labels,groups=fixture(groups=1)
        for x in rows:x['producerStatus']='not-run';x['sourceValue']=None;labels[x['id']]=None
        result=r.evaluate(rows,labels,groups,r.rank(rows))
        self.assertEqual(result['aggregate']['producedCandidates'],0);self.assertFalse(result['aggregate']['complete'])

    def test_scientific_tie_top5_boundary_and_shuffle(self):
        rows,labels,groups=fixture(groups=1)
        for x in rows:x['sourceValue']=.8
        rr=r.rank(rows);ev=r.evaluate(rows,labels,groups,rr)['aggregate']
        self.assertAlmostEqual(ev['firstDockQ'],sum(labels.values())/6)
        self.assertAlmostEqual(ev['top5MeanDockQ'],sum(labels.values())/6)
        self.assertAlmostEqual(ev['top5ExpectedAcceptableCount'],5)
        self.assertEqual(rr,r.rank(list(reversed(rows))))
        corrupt=copy.deepcopy(rr);corrupt[0]['rankMin']=2
        with self.assertRaisesRegex(ValueError,'tie ranks'):r.evaluate(rows,labels,groups,corrupt)

    def test_optional_missing_pool_fallback_not_partial(self):
        rows,labels,groups=fixture();model=r.fit_ridge(rows,labels,groups,'interface',.1)
        test=copy.deepcopy(rows);test[0]['features']['cdr_share']=None
        rr=r.rank(test,model);pool=[q for q in rr if q['setId']=='target0']
        self.assertTrue(all(q['status']=='source' and q['reason']=='optional-feature-unavailable' for q in pool))
        self.assertEqual([q['score'] for q in pool],[q['score'] for q in r.rank(test) if q['setId']=='target0'])
        conf=r.fit_ridge(rows,labels,groups,'confidence',.1)
        self.assertTrue(all(q['status']=='learned' for q in r.rank(test,conf)))

    def test_invalid_no_contact_and_context_are_separate(self):
        rows,labels,groups=fixture();model=r.fit_ridge(rows,labels,groups,'interface',.1)
        invalid=copy.deepcopy(rows);invalid[0]['validityStatus']='invalid'
        self.assertEqual(r.rank(invalid,model)[0]['reason'],'invalid-or-unavailable-input')
        no_contact=copy.deepcopy(rows);no_contact[0]['features'].update(log1p_contact_pairs=0,cdr_share=None,unnumbered_share=None)
        self.assertEqual(r.rank(no_contact,model)[0]['reason'],'optional-feature-unavailable')
        dimer=copy.deepcopy(rows)
        for q in dimer:q['profile']['scoreContext']='two-receptors-two-Nbs-confidence'
        self.assertTrue(all(q['status']=='source' and q['reason']=='unsupported-score-context' for q in r.rank(dimer,model)))

    def test_new_producer_regime_fallback(self):
        rows,labels,groups=fixture();m=r.fit_ridge(rows,labels,groups,'confidence',.1)
        for q in rows:q['profile']['generationRegimeSha256']='3'*64
        self.assertTrue(all(q['reason']=='unsupported-producer-profile' for q in r.rank(rows,m)))

    def test_weight_hierarchy_and_duplicate_cell(self):
        rows,labels,groups=fixture(groups=2,poses=3)
        more=copy.deepcopy(rows[:3])
        for q in more:q['id']+='again';q['poolId']+='again';q['seedBatch']='batch2'
        weights=r.pool_weights(rows+more,groups)
        self.assertEqual(weights['target0::baseline::batch'],.25)
        self.assertEqual(weights['target0::baseline::batchagain'],.25)
        self.assertEqual(weights['target1::baseline::batch'],.5)
        for q in more:q['seedBatch']='batch'
        with self.assertRaisesRegex(ValueError,'cell'):r.pool_weights(rows+more,groups)

    def test_centered_ridge_matches_independent_pair_differences(self):
        rows,labels,groups=fixture(groups=1,poses=6)
        model=r.fit_ridge(rows,labels,groups,'confidence',.1)
        x=np.asarray([[q['features'][k] for k in r.CONFIDENCE] for q in rows]);y=np.asarray([labels[q['id']] for q in rows]);n=len(rows)
        # Ordered-pair sum /(2*n*n) equals centered sum /n exactly.
        dx=np.asarray([(x[i]-x[j])/model['scales'] for i in range(n) for j in range(n)])
        dy=np.asarray([y[i]-y[j] for i in range(n) for j in range(n)])
        expected=np.linalg.solve(dx.T@dx/(2*n*n)+.1*np.eye(4),dx.T@dy/(2*n*n))
        np.testing.assert_allclose(model['coefficients'],expected,atol=1e-12)

    def test_constant_feature_retained_zero_coefficient(self):
        rows,labels,groups=fixture()
        for q in rows:q['features']['iptm']=.1
        m=r.fit_ridge(rows,labels,groups,'confidence',.1)
        self.assertEqual(m['scales'][1],1);self.assertEqual(m['coefficients'][1],0)
        self.assertEqual(m['featureNames'],list(r.CONFIDENCE))

    def test_exact_decimal_constant_labels_have_zero_coefficients(self):
        rows,labels,groups=fixture()
        labels={k:.1 for k in labels}
        model=r.fit_ridge(rows,labels,groups,'interface',.1)
        self.assertEqual(model['coefficients'],[0.0]*7)

    def test_heldout_labels_cannot_change_fitted_outer_model(self):
        rows,labels,groups=fixture(groups=3)
        before=r.nested_validate(rows,labels,groups,'confidence')
        changed=dict(labels)
        for q in rows:
            if q['setId']=='target0':changed[q['id']]=1-labels[q['id']]
        after=r.nested_validate(rows,changed,groups,'confidence')
        bf=next(x for x in before['folds'] if x['heldOutGroup']=='group0');af=next(x for x in after['folds'] if x['heldOutGroup']=='group0')
        self.assertEqual(bf['model'],af['model']);self.assertEqual(bf['selection'],af['selection'])
        self.assertNotIn('group0',bf['trainingGroups']);self.assertFalse(set(bf['heldOutIds'])&set(bf['model']['trainingIds']))

    def test_heldout_features_cannot_change_normalization(self):
        rows,labels,groups=fixture(groups=3);before=r.nested_validate(rows,labels,groups,'confidence')
        for q in rows:
            if q['setId']=='target0':q['features']['log1p_complex_ipde']=10000
        after=r.nested_validate(rows,labels,groups,'confidence')
        self.assertEqual(before['folds'][0]['model'],after['folds'][0]['model'])

    def test_inner_loss_guard_rejects_quality_gain_with_success_loss(self):
        rows,labels,groups=fixture(groups=3)
        # In one group only source-favored low-feature candidate is acceptable.
        for q in rows:
            if q['setId']=='target0':labels[q['id']]=.24 if q['id'].endswith('_0') else .22
        selected,trace=r.select_setting(rows,labels,groups,'confidence')
        self.assertIsNone(selected)
        self.assertTrue(all(c['comparison']['acceptableLossPools'] for c in trace['candidates']))

    def test_clear_shared_signal_can_fit_without_losing_acceptable(self):
        rows,labels,groups=fixture(groups=3);selected,trace=r.select_setting(rows,labels,groups,'confidence')
        self.assertIn(selected,r.GRID)
        outer=r.nested_validate(rows,labels,groups,'confidence')
        self.assertTrue(outer['learnerSupportedComparison']['exploratoryUsefulGainGatePassed'])

    def test_absent_labels_and_wrong_membership_refuse_fit(self):
        rows,labels,groups=fixture();labels[rows[0]['id']]=None
        with self.assertRaisesRegex(ValueError,'outcome unavailable'):r.fit_ridge(rows,labels,groups,'confidence',.1)
        rows,labels,groups=fixture();labels.pop(rows[0]['id'])
        with self.assertRaisesRegex(ValueError,'membership'):r.fit_ridge(rows,labels,groups,'confidence',.1)

    def test_minimum_groups_counts_only_complete_usable_pools(self):
        for mode in ('failed','invalid','missing'):
            rows,labels,groups=fixture(groups=3)
            for q in rows:
                if q['setId']=='target0':
                    if mode=='failed':q.update(producerStatus='failed',sourceValue=None);labels[q['id']]=None
                    elif mode=='invalid':q['validityStatus']='invalid'
                    else:q['features']['cdr_share']=None
            self.assertEqual(len(r.eligible_group_ids(rows,groups,'interface')),2)
            result=r.nested_validate(rows,labels,groups,'interface')
            self.assertTrue(all(f['selectedLambda'] is None and f['selection']['reason']=='insufficient-outer-supported-groups' for f in result['folds']))
            if mode=='missing':self.assertEqual(len(r.eligible_group_ids(rows,groups,'confidence')),3)

    def test_normalized_regime_ignores_only_nonscientific_controls(self):
        old={'recyclingSteps':3,'samplingSteps':200,'diffusionSamples':1,'stepScale':1.5,'seeds':list(range(25))}
        new={'recycling_steps':3,'sampling_steps':200,'diffusion_samples':1,'step_scale':1.5,'seeds':list(range(25,50)),
             'write_full_pae':True,'write_full_pde':True,'use_msa_server':False,'num_workers':0,'max_msa_seqs':8192}
        self.assertEqual(a.normalize_settings(old),a.normalize_settings(new))
        new['step_scale']=1.0;self.assertNotEqual(a.normalize_settings(old),a.normalize_settings(new))
        new['new_science_flag']=True
        with self.assertRaisesRegex(ValueError,'Unrecognized'):a.normalize_settings(new)

    def test_tampered_binding_and_path_escape(self):
        with tempfile.TemporaryDirectory(dir=a.HERE) as td:
            root=Path(td);p=root/'x.json';p.write_text('{}');b=a.binding(root,p);p.write_text('{"changed":1}')
            with self.assertRaisesRegex(ValueError,'binding differs'):a.bound(root,b)
            with self.assertRaisesRegex(ValueError,'Unsafe path'):a.safe(root,'../outside')

    def test_fit_release_requires_explicit_authorization(self):
        release={'schema':'confovhh-round4-development-fit-release-v1','evaluationRole':'development','authorizeDevelopmentFit':False,
                 'protocol':{},'implementation':{},'predictionTable':{},'labels':{},'grouping':{},'plannedIds':[]}
        with self.assertRaisesRegex(ValueError,'explicit development release'):run.validate_release(a.ROOT,release)

if __name__=='__main__':unittest.main()
