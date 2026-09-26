"""Only synthetic metric controls and prediction/reference identity checks.

No round-4 prediction is compared with a native coordinate in these tests.
"""
import copy
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import outcome_adapter as a
p=a.p

class OutcomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=a.ROOT
        cls.temp=tempfile.TemporaryDirectory(prefix='synthetic-outcome-tests-',dir=a.HERE);cls.dir=Path(cls.temp.name)
        cls.oldtests=p.module(cls.root/'round3-benchmark/outcome-tools/test_outcome_adapter.py','round4_old_synthetic_fixtures')
        cls.prep,cls.old=p.old_modules(cls.root);cls.helper=a.metric(cls.root)
        for name,kwargs in [('model',{'v_shift':.75}),('native',{'missing':True}),('context',{'context_shift':1000.,'v_shift':.75})]:
            cls.oldtests.fixture(cls.dir/(name+'.pdb'),**kwargs)
        for name in ['model','context']:
            cls.prep.canonicalizer().canonicalize_view(cls.dir/(name+'.pdb'),cls.dir/(name+'.cif'),['A','B'],'C','label')
        for i,(rec,nb) in enumerate([(['A','B'],'C'),(['A','B'],'D'),(['B','A'],'C'),(['B','A'],'D')]):
            cls.prep.canonicalizer().canonicalize_view(cls.dir/'native.pdb',cls.dir/f'native-{i}.cif',rec,nb,'auth')
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def mapping(self,name):return p.strict((self.dir/(name+'.mapping.json')).read_bytes())
    def value(self,model='model',native='native-0'):
        return self.helper.dockq_api(self.dir/(model+'.cif'),self.dir/(native+'.cif'),self.mapping(model),self.mapping(native),execution_root=self.root)
    def view(self,name):return {'coordinate':p.bind(self.root,self.dir/(name+'.cif')),'map':p.bind(self.root,self.dir/(name+'.mapping.json'))}
    def artifact_result(self,native='native-0'):
        ref=self.view(native);return {'id':native,'referenceSha256':ref['coordinate']['sha256'],**self.value(native=native)}
    def save(self,name,value):
        path=self.dir/(self.id().split('.')[-1]+'-'+name+'.json');p.save(path,value);return p.bind(self.root,path)
    def release(self,**changes):
        release={'schema':'confovhh-round4-outcome-release-v1','evaluationRole':'development','rankingSealSha256':'a'*64,'cohortSha256':'b'*64,'releasedAtUtc':'2026-09-25T01:00:01Z','authorizeOutcomeEvaluation':True};release.update(changes)
        seal={'evaluationRole':'development','cohort':{'sha256':'b'*64},'sealedAtUtc':'2026-09-25T01:00:00Z'}
        return self.save('release',release),{'sha256':'a'*64},seal,'2026-09-25T01:00:02Z'
    def test_reference_roster_has_12_development_and_3_reserved(self):
        refs=a.reference_spec(self.root);self.assertEqual(len(refs['targets']),15)
        for target in refs['targets']:self.assertEqual(len(target['views']),4 if len(target['predictionReceptorChains'])==2 else 1)
    def test_all_reference_bindings_replay_with_auth_namespace(self):
        refs=a.reference_spec(self.root)
        targets=[{'id':t['id'],'receptorChains':t['predictionReceptorChains'],'selectedNb':t['predictionSelectedNb']} for t in refs['targets']]
        got=a.verify_references(self.root,p.bind(self.root,a.HERE/'reference-inventory.json'),targets)
        self.assertEqual(set(got),{t['id'] for t in targets})
    def test_synthetic_native_self_is_one(self):
        self.assertAlmostEqual(self.value('native-0','native-0')['DockQ'],1.,places=12)
    def test_missing_loop_dimer_matches_independent_numpy_metric(self):
        for index in range(4):
            native=f'native-{index}';value=self.value(native=native)
            manual=self.oldtests.manual_metrics(self.dir/'model.cif',self.dir/(native+'.cif'),value['correspondence'])
            # Independent Bio.PDB/NumPy and DockQ coordinate arrays have distinct
            # float precision. Use 1e-5 A for RMSDs, 1e-7 for dimensionless DockQ.
            for key,expected in manual.items():self.assertAlmostEqual(expected,value['metrics'][key],delta=1e-5 if key in ('iRMSD','LRMSD') else 1e-7)
            self.assertEqual([c['nativeOriginalLabelChain'] for c in value['correspondence']['R']],['A','B'] if index<2 else ['B','A'])
            a.verify_correspondence(self.root,self.view('model'),self.view(native),self.artifact_result(native))
    def test_context_coordinate_changes_are_ignored(self):
        self.assertEqual(self.value(),self.value('context'))
    def test_rehashed_cross_protomer_correspondence_is_rejected(self):
        result=self.artifact_result();result['correspondence']['R'][0]['residuePairs'][0]['nativeResidue']=result['correspondence']['R'][1]['residuePairs'][0]['nativeResidue']
        result['correspondenceSha256']=p.sha(p.packed(result['correspondence']))
        with self.assertRaisesRegex(ValueError,'independently replay'):a.verify_correspondence(self.root,self.view('model'),self.view('native-0'),result)
    def test_all_four_fixed_assignments_required_and_exact_ties_retained(self):
        results=[{'id':str(i),'status':'evaluated','DockQ':value} for i,value in enumerate([.2,.8,.8,.3])]
        combined=self.old.combine_views(['0','1','2','3'],results);self.assertEqual(combined['DockQ'],.8);self.assertEqual(combined['maximizingReferenceIds'],['1','2'])
        with self.assertRaisesRegex(ValueError,'Missing'):self.old.combine_views(['0','1','2','3'],results[:3])
        results[2]={'id':'2','status':'unavailable','DockQ':None,'reason':'Synthetic failure'}
        self.assertEqual(self.old.combine_views(['0','1','2','3'],results)['status'],'unavailable')
    def test_missing_prediction_retained_without_starting_metric(self):
        row={'id':'synthetic__baseline__seed25','setId':'synthetic','generationArm':'baseline','seedBatch':'seeds-25','seed':25,'producerStatus':'failed','coordinate':None,'unavailableReason':'Synthetic generation failure'}
        with patch.object(a.subprocess,'run',side_effect=AssertionError('Metric must not run')):
            value=a.evaluate_pose(self.root,row,[],None,None)
        self.assertEqual(value['id'],row['id']);self.assertEqual(value['status'],'unavailable');self.assertIsNone(value['DockQ']);self.assertEqual(value['reason'],row['unavailableReason'])
    def test_valid_release_requires_exact_seal_and_chronology(self):a.validate_release(self.root,*self.release())
    def test_wrong_release_seal_rejected(self):
        with self.assertRaisesRegex(ValueError,'another ranking seal'):a.validate_release(self.root,*self.release(rankingSealSha256='c'*64))
    def test_early_release_rejected(self):
        with self.assertRaisesRegex(ValueError,'chronology'):a.validate_release(self.root,*self.release(releasedAtUtc='2026-09-25T00:59:59Z'))
    def test_false_authorization_rejected(self):
        with self.assertRaisesRegex(ValueError,'not been explicitly released'):a.validate_release(self.root,*self.release(authorizeOutcomeEvaluation=False))
    def test_worker_cannot_bypass_release(self):
        with patch.object(a,'metric',side_effect=AssertionError('Metric must not run')):
            with self.assertRaisesRegex(ValueError,'require release'):a.worker(self.root,{'id':'x','referenceId':'r','seal':None,'release':None})
    def test_snapshot_rejected_before_any_metric(self):
        request={'schema':'confovhh-round4-outcome-request-v1','evaluationRole':'development','preparationReceipt':{'dummy':'prep'},'sourceRankingReceipt':{},
                 'sourceRankingVerifier':p.bind(self.root,self.root/'round4-ranking/prepare_features.py'),'referenceInventory':{},'finalSelectionFreeze':None,'challengerRanks':[]}
        verifier=types.SimpleNamespace(verify_source_seal=lambda *_:({}, {}, {'preparationReceipt':request['preparationReceipt'],'snapshot':True}))
        with patch.object(a,'rank_module',return_value=verifier),patch.object(a,'metric',side_effect=AssertionError('Metric must not run')):
            with self.assertRaisesRegex(ValueError,'final complete'):a.preflight(self.root,request)
    def test_reserved_freeze_must_precede_generation(self):
        enrollment=p.bind(self.root,self.root/'round4-benchmark/ENROLLMENT.freeze.json');targets=p.strict(p.bound(self.root,enrollment))['targets']
        plan=self.save('plan',{'targets':[{k:t[k] for k in ['id','receptorChains','selectedNb','contextChains','context']}|{'chainSequenceSha256':{s['id']:s['sequenceSha256'] for s in t['sequenceChains']}} for t in targets]})
        rec=self.save('generation',{'startedUtc':'2026-09-25T01:00:00Z'})
        inv={'rows':[{'setId':t['id'],'generationReceipt':rec} for t in targets]}
        freeze={'schema':'confovhh-round4-final-policy-freeze-v1','frozenAtUtc':'2026-09-25T01:00:01Z','allowedModelBindings':[],
                'allowedGenerationPlanSha256':[plan['sha256']],'reservedEnrollment':enrollment}
        with self.assertRaisesRegex(ValueError,'preceded final'):a.verify_final_freeze(self.root,self.save('freeze',freeze),{'generationPlan':plan},inv,[])
    def test_reserved_construct_change_rejected_even_in_allowed_plan(self):
        enrollment=p.bind(self.root,self.root/'round4-benchmark/ENROLLMENT.freeze.json');targets=p.strict(p.bound(self.root,enrollment))['targets']
        planned=[{k:t[k] for k in ['id','receptorChains','selectedNb','contextChains','context']}|{'chainSequenceSha256':{s['id']:s['sequenceSha256'] for s in t['sequenceChains']}} for t in targets]
        planned[0]['chainSequenceSha256']['A']='0'*64;plan=self.save('changed-plan',{'targets':planned})
        freeze={'schema':'confovhh-round4-final-policy-freeze-v1','frozenAtUtc':'2026-09-25T01:00:00Z','allowedModelBindings':[],
                'allowedGenerationPlanSha256':[plan['sha256']],'reservedEnrollment':enrollment}
        inv={'rows':[{'setId':t['id'],'generationReceipt':None} for t in targets]}
        with self.assertRaisesRegex(ValueError,'construct differs'):a.verify_final_freeze(self.root,self.save('freeze',freeze),{'generationPlan':plan},inv,[])
    def reserved_roster(self,allowed):
        enrollment=p.bind(self.root,self.root/'round4-benchmark/ENROLLMENT.freeze.json');targets=p.strict(p.bound(self.root,enrollment))['targets']
        plan=self.save('plan',{'targets':[{k:t[k] for k in ['id','receptorChains','selectedNb','contextChains','context']}|{'chainSequenceSha256':{s['id']:s['sequenceSha256'] for s in t['sequenceChains']}} for t in targets]})
        inv={'rows':[{'setId':t['id'],'generationReceipt':None} for t in targets]}
        freeze={'schema':'confovhh-round4-final-policy-freeze-v1','frozenAtUtc':'2026-09-25T01:00:00Z','allowedModelBindings':allowed,
                'allowedGenerationPlanSha256':[plan['sha256']],'reservedEnrollment':enrollment}
        return self.save('freeze',freeze),{'generationPlan':plan},inv
    def test_reserved_source_only_empty_challenger_roster_is_valid(self):
        a.verify_final_freeze(self.root,*self.reserved_roster([]),[])
    def test_reserved_frozen_model_cannot_be_omitted(self):
        model=self.save('model',{'syntheticModel':1})
        with self.assertRaisesRegex(ValueError,'roster differs'):a.verify_final_freeze(self.root,*self.reserved_roster([model]),[])
    def test_reserved_supplied_model_cannot_be_duplicated(self):
        model=self.save('model',{'syntheticModel':1});ranks1=self.save('ranks-one',{'modelBinding':model});ranks2=self.save('ranks-two',{'modelBinding':model})
        with self.assertRaisesRegex(ValueError,'Repeated/missing supplied'):a.verify_final_freeze(self.root,*self.reserved_roster([model]),[ranks1,ranks2])
    def test_reserved_unfrozen_model_cannot_be_added(self):
        model=self.save('model',{'syntheticModel':1});ranks=self.save('ranks',{'modelBinding':model})
        with self.assertRaisesRegex(ValueError,'roster differs'):a.verify_final_freeze(self.root,*self.reserved_roster([]),[ranks])
    def test_legitimate_failed_and_interrupted_explanations_retained(self):
        receipt=self.save('producer',{'reason':'Synthetic terminal failure'})
        for status in ['failed','interrupted']:
            a.verify_failure_disposition(self.root,{'status':status,'generationReceipt':receipt,'rawInputIntegrity':None,'unavailableReason':'Synthetic terminal failure'})
    def test_rehashed_failure_explanation_or_integrity_injection_rejected(self):
        receipt=self.save('producer',{'reason':'Synthetic terminal failure'})
        good={'status':'failed','generationReceipt':receipt,'rawInputIntegrity':None,'unavailableReason':'Synthetic terminal failure'}
        for change in [{'unavailableReason':'Changed failure'},{'rawInputIntegrity':{'fake':True}}]:
            with self.assertRaisesRegex(ValueError,'Failure reporting differs'):a.verify_failure_disposition(self.root,good|change)
    def test_preflight_rejects_tampered_failure_reporting_before_seal(self):
        receipt=self.save('producer',{'reason':'Synthetic terminal failure'})
        good={'id':'failed-id','status':'failed','generationReceipt':receipt,'rawInputIntegrity':None,'unavailableReason':'Synthetic terminal failure'}
        request={'schema':'confovhh-round4-outcome-request-v1','evaluationRole':'development','preparationReceipt':{'dummy':'prep'},'sourceRankingReceipt':{},
                 'sourceRankingVerifier':p.bind(self.root,self.root/'round4-ranking/prepare_features.py'),'referenceInventory':{},'finalSelectionFreeze':None,'challengerRanks':[]}
        verifier=types.SimpleNamespace(verify_source_seal=lambda *_:({'evaluationRole':'development','rows':[{'id':'failed-id'}]}, {},
                   {'preparationReceipt':request['preparationReceipt'],'snapshot':False,'evaluationRole':'development'}))
        for change in [{'unavailableReason':'Changed failure'},{'rawInputIntegrity':{'fake':True}}]:
            inv={'snapshot':False,'evaluationRole':'development','cohort':{},'rows':[good|change]}
            with patch.object(a,'rank_module',return_value=verifier),patch.object(p,'verify_preparation',return_value=(inv,{})),patch.object(p,'verify_cohort',return_value=({'evaluationRole':'development'},{},{},{},None)),patch.object(a,'metric',side_effect=AssertionError('Metric must not run')):
                with self.assertRaisesRegex(ValueError,'Failure reporting differs'):a.preflight(self.root,request)

if __name__=='__main__':unittest.main(verbosity=2)
