import copy
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import combine_development as c

def fixture():
    groups={f'T{i:02d}':('G00' if i<2 else f'G{i:02d}') for i in range(12)}
    gb={'path':'synthetic/groups.json','bytes':0,'sha256':'a'*64};old=[];new=[];attempts=[];outcomes=[]
    batch='seeds-'+','.join(map(str,range(25,50)))
    def row(target,arm,seed,old=False):
        rid=f'{target}_seed{seed:02d}' if old else f'{target}__{arm}__seed{seed:02d}'
        sb='seeds00-24' if old else batch
        return {'id':rid,'setId':target,'poolId':target+'::'+arm+'::'+sb,'generationArm':arm,'seedBatch':sb,
                'producerStatus':'generated','sourceValue':.5,'sourceDirection':'higher-better','validityStatus':'valid',
                'coordinateSha256':c.a.sha(rid.encode()),'profile':{'producerVersion':'synthetic-version','modelSha256':'1'*64,
                'scoreContext':'pair-confidence','generationRegimeSha256':{'baseline':'2','broader':'3','msa1024':'4'}[arm]*64},
                'features':{key:.3 for key in c.r.FEATURES}}
    for target in groups:
        old.extend(row(target,'baseline',i,True) for i in range(25))
        for arm in ('baseline','broader','msa1024'):
            for seed in range(25,50):
                x=row(target,arm,seed);new.append(x)
                attempts.append({k:x[k] for k in ('id','setId','generationArm','producerStatus')}|{'seed':seed,'originalProducerStatus':'generated'})
                outcomes.append({k:x[k] for k in ('id','setId','generationArm','seedBatch','producerStatus','coordinateSha256')}|{'seed':seed,'status':'evaluated','DockQ':.4,'reason':''})
    def table(rows):return {'schema':'confovhh-round4-prediction-table-v1','evaluationRole':'development','origin':'synthetic',
                           'rows':rows,'inputBindings':[],'groupingBinding':gb,'outcomeInputs':[],'featureNames':list(c.r.FEATURES)}
    old=table(old);new=table(new)
    labels={'schema':'confovhh-round4-development-labels-v1','evaluationRole':'development','labels':{x['id']:.3 for x in old['rows']},
            'inputBindings':[],'predictionTableDigest':c.r.digest(old),'reservedOutcomesRead':False}
    outcome={'schema':'confovhh-round4-outcome-map-v1','evaluationRole':'development','cohort':{},'rows':outcomes}
    return old,labels,new,outcome,attempts,groups,[],[]

class CombinedDevelopmentTests(unittest.TestCase):
    def setUp(self):self.args=fixture()
    def join(self):return c.combine_payloads(*self.args)
    def test_exact_1200_rows_and_distinct_48_pools_preserved(self):
        table,labels,status=self.join()
        self.assertEqual((len(table['rows']),len(labels['labels']),status['poolCount']),(1200,1200,48))
        self.assertTrue(status['fitEligible']);self.assertEqual(status['groups'],11)
        expected={x['id']:x for table in (self.args[0],self.args[2]) for x in table['rows']}
        self.assertEqual({x['id']:x for x in table['rows']},expected)
        self.assertEqual(table['outcomeInputs'],[]);self.assertEqual(status['modelsFit'],0)
    def test_unavailable_generated_label_blocks_fit_without_dropping(self):
        self.args[3]['rows'][0].update(status='unavailable',DockQ=None,reason='Synthetic metric failure')
        table,labels,status=self.join();self.assertFalse(status['fitEligible']);self.assertEqual(len(table['rows']),1200)
        self.assertEqual(status['generatedOutcomesUnavailable'],[self.args[3]['rows'][0]['id']])
        with self.assertRaisesRegex(ValueError,'outcome unavailable'):c.r.validate_labels(table['rows'],labels['labels'])
    def test_failed_generation_kept_but_does_not_make_labels_incomplete(self):
        pred=self.args[2]['rows'][0];pred.update(producerStatus='failed',sourceValue=None,validityStatus='unavailable',coordinateSha256=None)
        self.args[4][0].update(producerStatus='failed',originalProducerStatus='interrupted')
        self.args[3]['rows'][0].update(producerStatus='interrupted',coordinateSha256=None,status='unavailable',DockQ=None,reason='Synthetic interrupted generation')
        table,labels,status=self.join();self.assertTrue(status['fitEligible']);self.assertEqual(status['nonproduced'],1)
        c.r.validate_labels(table['rows'],labels['labels'])
        ranks={x['id']:x for x in c.r.rank(table['rows'])};self.assertEqual(ranks[pred['id']]['status'],'not-produced')
    def test_missing_produced_source_is_explicit_not_a_dropped_label(self):
        self.args[2]['rows'][0]['sourceValue']=None
        table,labels,status=self.join();self.assertTrue(status['fitEligible']);self.assertEqual(len(status['producedSourceMissing']),1)
        pool=self.args[2]['rows'][0]['poolId'];ranks=[x for x in c.r.rank(table['rows']) if x['poolId']==pool]
        self.assertTrue(all(x['status']=='abstained' for x in ranks))
    def test_optional_missing_feature_remains_in_combined_table(self):
        self.args[2]['rows'][0]['features']['cdr_share']=None
        table,labels,status=self.join();self.assertTrue(status['fitEligible'])
        self.assertEqual(c.r.learned_reason([self.args[2]['rows'][0]],'interface'),'optional-feature-unavailable')
    def test_coordinate_seed_and_arm_join_mismatches_rejected(self):
        for field,value in [('coordinateSha256','0'*64),('seed',26),('generationArm','broader')]:
            args=copy.deepcopy(self.args);args[3]['rows'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):c.combine_payloads(*args)
    def test_missing_duplicate_or_reserved_outcomes_rejected(self):
        for mutation in ('missing','duplicate','reserved'):
            args=copy.deepcopy(self.args)
            if mutation=='missing':args[3]['rows'].pop()
            elif mutation=='duplicate':args[3]['rows'][-1]=args[3]['rows'][0]
            else:args[3]['evaluationRole']='reserved'
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):c.combine_payloads(*args)
    def test_outcome_injection_into_features_rejected(self):
        self.args[2]['rows'][0]['DockQ']=.99
        with self.assertRaisesRegex(ValueError,'injection forbidden'):self.join()
    def test_relabelled_grouping_or_baseline_profile_rejected(self):
        args=copy.deepcopy(self.args);args[2]['groupingBinding']['sha256']='0'*64
        # Fixture tables deliberately shared the same original binding object;
        # replace the new binding explicitly to model a separate altered artifact.
        args[2]['groupingBinding']={'path':'different','bytes':0,'sha256':'0'*64}
        with self.assertRaisesRegex(ValueError,'grouping differs'):c.combine_payloads(*args)
        for row in self.args[2]['rows']:
            if row['setId']=='T00' and row['generationArm']=='baseline':row['profile']['generationRegimeSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'baseline regimes differ'):self.join()
    def test_false_label_join_release_stops_before_any_bound_input_read(self):
        release={k:None for k in c.JOIN_KEYS};release.update(schema='confovhh-round4-combined-development-join-release-v1',evaluationRole='development',authorizeDevelopmentLabelJoin=False)
        with patch.object(c.a,'bound',side_effect=AssertionError('No actual labels may be opened')):
            with self.assertRaisesRegex(ValueError,'explicit parent release'):c.validate_join_release(c.ROOT,release)
    def test_conflicting_input_binding_cannot_be_silently_overwritten(self):
        b={'path':'synthetic/file','bytes':1,'sha256':'0'*64}
        with self.assertRaisesRegex(ValueError,'Conflicting'):c.unique_bindings([b,b|{'sha256':'1'*64}])
    def test_incomplete_join_emits_every_row_but_no_fit_release(self):
        self.args[3]['rows'][0].update(status='unavailable',DockQ=None,reason='Synthetic technical failure')
        payloads=self.join()
        with tempfile.TemporaryDirectory(prefix='synthetic-combined-',dir=c.HERE) as temporary:
            temporary=Path(temporary);release=temporary/'synthetic-release.json';c.a.save(release,{'syntheticFixtureOnly':True})
            with patch.object(c,'authenticated_payloads',return_value=payloads),patch.object(c,'implementation',return_value={'synthetic':True}),patch.object(c.runner,'proposed_release',side_effect=AssertionError('Incomplete data must not propose fit')):
                receipt=c.combine(c.ROOT,release,temporary/'output')
                self.assertFalse(receipt['fitReleaseProposed']);self.assertFalse((temporary/'output/fit-release.proposed.json').exists())
                c.verify_combination(c.ROOT,c.a.binding(c.ROOT,temporary/'output/receipt.json'))
                table=c.a.strict_json((temporary/'output/predictions.json').read_bytes());self.assertEqual(len(table['rows']),1200)

if __name__=='__main__':unittest.main(verbosity=2)
