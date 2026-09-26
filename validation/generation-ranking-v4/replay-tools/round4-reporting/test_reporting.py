"""Synthetic reporting controls; never open a new scientific outcome artifact."""
import copy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import report_common as c
import select_final as s
import summarize_reserved as z

def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); sys.modules[name] = value; spec.loader.exec_module(value); return value
g = module(c.ROOT / 'round4-analysis/analyze_generation.py', 'reporting_test_frozen_metrics')

def comparison(arm='baseline', passes=True):
    return {'pairGenerationDecision': {'selectedArm': arm, 'candidates': {a: {'passes': passes} for a in ('broader', 'msa1024')}}}

def nested(gain, kind='ridge', loss=False):
    base = {'pools': {'a': {'selectionAvailable': True, 'firstAcceptableProbability': 1.0},
                      'b': {'selectionAvailable': True, 'firstAcceptableProbability': 1.0}}, 'aggregate': {'selectedPools': 2}}
    candidate = copy.deepcopy(base)
    if loss: candidate['pools']['a']['firstAcceptableProbability'] = .5
    return {'learnerSupportedComparison': {'firstDockQGain': gain, 'acceptableLossPools': ['a'] if loss else [], 'coverageUnchanged': True},
            'learnerSupported': candidate, 'learnerSupportedBaseline': base}, {'kind': kind}

def selection_fixture(cgain=.03, igain=.04, ckind='ridge', ikind='ridge', closs=False, iloss=False):
    docs = {}; bindings = {}
    for family, gain, kind, loss in [('confidence', cgain, ckind, closs), ('interface', igain, ikind, iloss)]:
        n, m = nested(gain, kind, loss); n['family'] = m['family'] = family
        docs[family+'-nested.json'] = n; docs[family+'-model.json'] = m
        bindings[family] = {'path': family+'.json', 'bytes': 10, 'sha256': family[0]*64}
    return docs, bindings

def reserved_fixture(arm='baseline', challenger=False):
    selection = {'pairGenerationArm': arm, 'reservedPlannedAttempts': 75 if arm == 'baseline' else 100,
                 'selectedModel': {'synthetic': True} if challenger else None, 'selectedFamily': 'confidence' if challenger else 'source',
                 'status': 'COMPLETE_EXPLORATORY_SELECTION'}
    roster = z.expected_roster(selection); rows=[]; prepared=[]; outcomes=[]; jobs=[]; timings={}
    for target, generation, seed in sorted(roster):
        ident=f'{target}__{generation}__seed{seed:02d}'; pool=f'{target}::{generation}::batch'
        row={'id':ident,'setId':target,'poolId':pool,'generationArm':generation,'seedBatch':'batch','producerStatus':'generated',
             'sourceValue':float(25-seed),'sourceDirection':'higher-better','validityStatus':'valid','coordinateSha256':'a'*64,
             'profile':{'scoreContext':z.CONTEXTS[target]},'features':{}}
        rows.append(row);timings[ident]=2.
        prepared.append({'id':ident,'setId':target,'generationArm':generation,'seedBatch':'batch','seed':seed,
                         'status':'generated','canonicalCoordinate':{'sha256':'a'*64},'geometryStatus':'canonicalized','unavailableReason':''})
        outcomes.append({'id':ident,'setId':target,'generationArm':generation,'seedBatch':'batch','seed':seed,
                         'producerStatus':'generated','coordinateSha256':'a'*64,'status':'evaluated','DockQ':.3 if seed%2==0 else .1,'reason':''})
        jobs.append({'jobId':ident,'targetId':target,'armId':generation,'seed':seed})
    alternate=None if arm=='baseline' else arm
    plan={'schema':'confovhh-round4-generation-plan-v1','plannedAttempts':len(jobs),'targets':[{'id':t} for t in z.TARGETS],
          'jobs':jobs,'selectedAlternative':alternate,'generationChoice':{'selectedArmInDevelopment':arm,'selectedAlternative':alternate,
          'includeSelectedAlternative':alternate is not None,'alternativePermittedOnlyFor':'ADGRV1_RE02','otherContextsRetainBaseline':True}}
    enrollment={'targets':[{'id':t,'context':z.CONTEXTS[t],'biologicalGroupId':t,'learnerEligibleContext':t=='ADGRV1_RE02',
                            'limitations':['Synthetic qualification.'],'historicalIndependenceCertified':False,'predictorTrainingExposure':{'certifiedUnseen':False}} for t in z.TARGETS]}
    table={'evaluationRole':'reserved-evaluation','outcomeInputs':[],'rows':rows}
    inventory={'evaluationRole':'reserved','snapshot':False,'rows':prepared}
    outcome={'evaluationRole':'reserved','rows':outcomes}
    return selection,table,inventory,outcome,plan,enrollment,{},timings,g

def ranks_for(rows):
    ranked=[]; pools={}
    for row in rows:pools.setdefault(row['poolId'],[]).append(row)
    for pool,rs in pools.items():
        produced=[r for r in rs if r['producerStatus']=='generated']
        available=bool(produced) and all(r['sourceValue'] is not None for r in produced)
        ordered=sorted([r['sourceValue'] for r in produced],reverse=True) if available else []
        for row in rs:
            score=row['sourceValue'] if available and row['producerStatus']=='generated' else None
            positions=[i+1 for i,v in enumerate(ordered) if v==score] if score is not None else []
            ranked.append({'id':row['id'],'poolId':pool,'setId':row['setId'],'status':'not-produced' if row['producerStatus']!='generated' else 'source' if available else 'abstained',
                           'reason':'','score':score,'rankMin':min(positions) if positions else None,'rankMax':max(positions) if positions else None})
    return ranked

def finish_fixture(f):
    f[6]['source']=ranks_for(f[1]['rows'])
    if f[0]['selectedModel'] is not None:f[6]['challenger']=copy.deepcopy(f[6]['source'])
    return f

def mutate_status(f, target, seed, failed=False, unavailable=False):
    ident=f'{target}__baseline__seed{seed:02d}'
    row=next(x for x in f[1]['rows'] if x['id']==ident); raw=next(x for x in f[2]['rows'] if x['id']==ident); q=next(x for x in f[3]['rows'] if x['id']==ident)
    if failed:
        row.update(producerStatus='failed',sourceValue=None,validityStatus='unavailable',coordinateSha256=None)
        raw.update(status='interrupted',canonicalCoordinate=None,geometryStatus='not-produced',unavailableReason='producer interrupted')
        q.update(producerStatus='interrupted',coordinateSha256=None,status='unavailable',DockQ=None,reason='producer interrupted')
    if unavailable:q.update(status='unavailable',DockQ=None,reason='synthetic metric failure')
    return ident

class SelectionTests(unittest.TestCase):
    def test_highest_gain_and_exact_family_tie(self):
        d,b=selection_fixture(); self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'interface')
        d,b=selection_fixture(.03,.03); self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'confidence')

    def test_below_boundary_negative_and_no_final_ridge_fallback(self):
        d,b=selection_fixture(.019999999999,.019); self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'source')
        d,b=selection_fixture(.02,.04,ikind='source'); self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'confidence')
        d,b=selection_fixture(-.02,-.03); self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'source')

    def test_any_acceptable_probability_loss_rejects(self):
        d,b=selection_fixture(.4,.5,closs=True,iloss=True); result=s.choose(comparison(),d,b)
        self.assertEqual(result['selectedFamily'],'source'); self.assertEqual(result['familyAssessments']['confidence']['acceptableLossPools'],['a'])

    def test_swapped_coverage_not_hidden_by_equal_total(self):
        d,b=selection_fixture();
        for f in s.FAMILIES:
            n=d[f+'-nested.json'];n['learnerSupported']['pools']['a']['selectionAvailable']=False
            n['learnerSupportedBaseline']['pools']['b']['selectionAvailable']=False
        self.assertEqual(s.choose(comparison(),d,b)['selectedFamily'],'source')

    def test_nonfinite_boolean_gain_rejected(self):
        for value in (True,float('nan'),float('inf')):
            d,b=selection_fixture(value)
            with self.assertRaises(ValueError):s.choose(comparison(),d,b)

    def test_generation_choice_preserved_and_failed_alternative_rejected(self):
        d,b=selection_fixture()
        self.assertEqual(s.choose(comparison('broader'),d,b)['reservedPlannedAttempts'],100)
        with self.assertRaises(ValueError):s.choose(comparison('broader',False),d,b)

    def test_incomplete_preserves_every_missing_reason_no_winner_claim(self):
        status={'fitEligible':False,'status':'INCOMPLETE_GENERATED_OUTCOMES','planned':1200,
                'generatedOutcomesUnavailable':['p2','p9'],'newOutcomeDispositions':{i:{'status':'unavailable','reason':i+' missing'} for i in ['p2','p9']}}
        x=s.incomplete_choice(comparison(),status,'parent holds source')
        self.assertEqual([r['id'] for r in x['generatedOutcomesUnavailable']],['p2','p9'])
        self.assertIsNone(x['selectedModel']);self.assertFalse(x['sourceWonComparisonClaim']);self.assertFalse(x['completedCombinedFit'])
        status['fitEligible']=True
        with self.assertRaises(ValueError):s.incomplete_choice(comparison(),status,'reason')

    def test_no_release_no_dependency_or_outcome_access(self):
        release={k:None for k in s.NORMAL_RELEASE};release.update(schema='confovhh-round4-final-selection-release-v1',evaluationRole='development',authorizeFinalSelection=False)
        with patch.object(c,'validate_freeze',side_effect=AssertionError('must not open dependency')):
            with self.assertRaisesRegex(ValueError,'explicit parent'):s.authenticated_selection(c.ROOT,release)
        release={k:None for k in z.RELEASE_KEYS};release.update(schema='confovhh-round4-reserved-summary-release-v1',evaluationRole='reserved',authorizeReservedSummary=False)
        with patch.object(c,'validate_freeze',side_effect=AssertionError('must not open dependency')):
            with self.assertRaisesRegex(ValueError,'explicit parent'):z.authenticated_summary(c.ROOT,release)

class ReservedTests(unittest.TestCase):
    def test_complete75_and100_each_case_arm_retained(self):
        for arm,count in [('baseline',75),('broader',100),('msa1024',100)]:
            f=finish_fixture(reserved_fixture(arm));summary,attempts=z.build_summary(*f)
            self.assertEqual(summary['counts']['planned'],count);self.assertEqual(len(attempts),count)
            self.assertIsNone(summary['populationConfidenceInterval']);self.assertFalse(summary['generalSuperiorityClaim'])
            self.assertEqual(len(summary['pools']),3 if count==75 else 4)

    def test_alternative_omission_extra_context_and_seed_rejected(self):
        f=finish_fixture(reserved_fixture('broader'));f[4]['selectedAlternative']=None
        with self.assertRaises(ValueError):z.build_summary(*f)
        for change in ('seed','targetId'):
            f=finish_fixture(reserved_fixture());f[4]['jobs'][0][change]=25 if change=='seed' else 'UNKNOWN'
            with self.assertRaises(ValueError):z.build_summary(*f)

    def test_first_and_top5_scientific_tie_exact_expected(self):
        f=reserved_fixture()
        for row in f[1]['rows']:
            if row['setId']=='ADGRV1_RE02' and int(row['id'][-2:])<6:row['sourceValue']=99.
        finish_fixture(f);summary,_=z.build_summary(*f)
        pool=next(p for p in summary['pools'] if p['setId']=='ADGRV1_RE02')
        self.assertEqual(pool['firstDockQ'],float(Fraction(1,5)))
        self.assertEqual(pool['firstAcceptableProbability'],.5)
        self.assertEqual(pool['top5MeanDockQ'],.2);self.assertEqual(pool['top5ExpectedAcceptableCount'],2.5)
        bad=copy.deepcopy(f[:-1])+(g,);bad[6]['source'][0]['rankMax']=5
        with self.assertRaises(ValueError):z.build_summary(*bad)

    def test_generation_failure_retained_and_does_not_poison_source(self):
        f=reserved_fixture();ident=mutate_status(f,'ADGRV1_RE02',0,failed=True);finish_fixture(f)
        summary,attempts=z.build_summary(*f);p=next(x for x in summary['pools'] if x['setId']=='ADGRV1_RE02')
        self.assertEqual(summary['counts']['failedGeneration'],1);self.assertEqual(len(attempts),75)
        self.assertTrue(p['selectionAvailable']);self.assertEqual(p['firstDockQ'],.1)
        a=next(x for x in attempts if x['id']==ident);self.assertEqual(a['originalProducerStatus'],'interrupted');self.assertEqual(a['outcomeUnavailableReason'],'producer interrupted')

    def test_missing_top_label_remains_unavailable_no_zero_or_drop(self):
        f=reserved_fixture();mutate_status(f,'ADGRV1_RE02',0,unavailable=True);finish_fixture(f)
        summary,attempts=z.build_summary(*f);p=next(x for x in summary['pools'] if x['setId']=='ADGRV1_RE02')
        self.assertEqual(summary['status'],'NEEDS_ATTENTION');self.assertIsNone(p['firstDockQ']);self.assertIsNone(p['top5MeanDockQ'])
        self.assertIsNone(p['acceptablePerPlanned']);self.assertIsNone(p['bestCandidateGap']);self.assertEqual(len(attempts),75)
        self.assertEqual(p['acceptablePerPlannedBounds'],[12/25,13/25])

    def test_missing_unselected_label_preserves_known_top5_but_not_complete_gap(self):
        f=reserved_fixture();mutate_status(f,'ADGRV1_RE02',24,unavailable=True);finish_fixture(f)
        summary,_=z.build_summary(*f);p=next(x for x in summary['pools'] if x['setId']=='ADGRV1_RE02')
        self.assertEqual(p['firstDockQ'],.3);self.assertIsNotNone(p['top5MeanDockQ']);self.assertIsNone(p['bestCompleteDockQ'])
        self.assertIsNone(p['bestCandidateGap']);self.assertEqual(p['availableBestCandidateGap'],0.)

    def test_missing_source_abstains_whole_produced_pool(self):
        f=reserved_fixture();f[1]['rows'][0]['sourceValue']=None;finish_fixture(f)
        summary,_=z.build_summary(*f);p=next(x for x in summary['pools'] if x['setId']=='ADGRV1_RE02')
        self.assertFalse(p['selectionAvailable']);self.assertIsNone(p['firstDockQ']);self.assertEqual(p['evaluableCount'],25)

    def test_full_context_cannot_acquire_learned_ranking(self):
        f=finish_fixture(reserved_fixture(challenger=True));summary,_=z.build_summary(*f)
        self.assertEqual(len(summary['pools']),6)
        row=next(x for x in f[6]['challenger'] if x['setId']=='MC4R_PN162');row['status']='learned'
        with self.assertRaisesRegex(ValueError,'fallback'):z.build_summary(*f)

    def test_coordinate_identity_and_reserved_scope_rejected(self):
        f=finish_fixture(reserved_fixture());f[3]['rows'][0]['coordinateSha256']='b'*64
        with self.assertRaisesRegex(ValueError,'coordinate'):z.build_summary(*f)
        f=finish_fixture(reserved_fixture());f[1]['evaluationRole']='development'
        with self.assertRaisesRegex(ValueError,'scope'):z.build_summary(*f)

    def test_shuffle_does_not_change_report(self):
        f=finish_fixture(reserved_fixture('broader',True));first=z.build_summary(*f)
        for item in (f[1]['rows'],f[2]['rows'],f[3]['rows'],f[4]['jobs'],f[6]['source'],f[6]['challenger']):item.reverse()
        second=z.build_summary(*f);self.assertEqual(first,second);self.assertEqual(z.documents(*first),z.documents(*second))

class ArtifactTests(unittest.TestCase):
    def test_duplicate_json_and_nonfinite_rejected(self):
        for raw in ('{"x":1,"x":2}','{"x":NaN}','{"x":Infinity}','{"x":1e999}'):
            with self.assertRaises(ValueError):c.strict(raw)

    def test_generation_replay_accepts_only_authenticated_derived_plan_hash(self):
        # Synthetic integration reproduces verify_cohort's real in-memory plan
        # shape. No scientific data or metric call is used in this I/O contract.
        B=lambda name:{'path':name,'bytes':1,'sha256':name[0]*64}
        release={k:B(k) for k in ['analysisFreeze','sourceRankingReceipt','outcomeReceipt','generationPlan','grouping']}
        receipt={'schema':'confovhh-round4-generation-analysis-receipt-v1','status':'COMPLETE','release':B('release'),**release,
                 'files':[],'planned':900,'old300Included':False,'reservedOutcomesRead':False,'sourceRanksRecomputedAndVerified':True,'outcomesAuthenticated':True}
        plan={'jobs':['synthetic']};verified_plan={**plan,'_sha256':release['generationPlan']['sha256']}
        source={'snapshot':False,'plannedCount':900,'evaluationRole':'development','preparationReceipt':B('prep')}
        table={'origin':'round4-frozen-generation-plan','groupingBinding':release['grouping'],'rows':[]}
        inventory={'cohort':B('cohort'),'rows':[]};cohort={'generationPlan':release['generationPlan'],'evaluationRole':'development'}
        request={'sourceRankingReceipt':release['sourceRankingReceipt'],'preparationReceipt':source['preparationReceipt']}
        payloads={'receipt':receipt,'release':release,'generationPlan':plan,'grouping':{},'request':request}
        fake_g=SimpleNamespace(validate_release=lambda *_:None,join_outcomes=lambda *_:{},analyze=lambda *_:{'replayed':True},render_report=lambda _:'report\n')
        fake_p=SimpleNamespace(verify_preparation=lambda *_:(inventory,{}),verify_cohort=lambda *_:(cohort,verified_plan,{},None,None))
        fake_f=SimpleNamespace(verify_source_seal=lambda *_:(table,{'ranks':[]},source),prep_module=lambda _:fake_p)
        fake_o=SimpleNamespace(verify_evaluation=lambda *_:({'evaluationRole':'development','cohort':inventory['cohort'],'rows':[]},{'request':B('request')}))
        modules={'generation':fake_g,'features':fake_f,'outcomes':fake_o}
        with patch.object(c,'load',side_effect=lambda _,b:payloads[b['path']]),patch.object(c,'dependency',side_effect=lambda _,__,name:modules[name]),patch.object(c,'replay_documents') as replay:
            result,_=s.replay_generation(c.ROOT,B('receipt'));self.assertEqual(result,{'replayed':True});replay.assert_called_once()
            verified_plan['_sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'cohort/plan'):s.replay_generation(c.ROOT,B('receipt'))
            verified_plan['_sha256']=release['generationPlan']['sha256'];verified_plan['jobs']=['altered']
            with self.assertRaisesRegex(ValueError,'cohort/plan'):s.replay_generation(c.ROOT,B('receipt'))

    def test_binding_tamper_escape_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();path=root/'a.json';path.write_text('{}');b=c.binding(root,path)
            path.write_text('{ }')
            with self.assertRaises(ValueError):c.bound(root,b)
            for name in ('../a','/tmp/a','a/../a','a\\b'):
                with self.assertRaises(ValueError):c.safe(root,name)
            (root/'link').symlink_to(path)
            with self.assertRaises(ValueError):c.binding(root,root/'link')

    def test_output_relocation_duplicate_and_report_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();folder=root/'saved';folder.mkdir()
            (folder/'receipt.json').write_text('{}');(folder/'REPORT.md').write_text('truth\n')
            rb=c.binding(root,folder/'receipt.json');files=[c.binding(root,folder/'REPORT.md')]
            receipt={'files':files};c.replay_documents(root,rb,receipt,{'REPORT.md':b'truth\n'})
            with self.assertRaises(ValueError):c.replay_documents(root,rb,receipt,{'REPORT.md':b'false\n'})
            with self.assertRaises(ValueError):c.output_files(root,rb,files*2,['REPORT.md'])
            (root/'REPORT.md').write_text('truth\n')
            with self.assertRaises(ValueError):c.output_files(root,rb,[c.binding(root,root/'REPORT.md')],['REPORT.md'])

    def test_completed_receipt_metadata_cannot_claim_incomplete_fit(self):
        d,b=selection_fixture();selection=s.choose(comparison(),d,b)
        release={'reportingFreeze':'f','generationAnalysisReceipt':'g','combinedJoinReceipt':'j','fitReceipt':'fit','fitVerification':'v'}
        m=s.receipt_metadata('r',release,selection)
        self.assertEqual(m['schema'],'confovhh-round4-final-selection-receipt-v1');self.assertEqual(m['fitReceipt'],'fit')
        selection={'schema':'confovhh-round4-incomplete-source-disposition-v1','status':'SOURCE_BASELINE_PRESERVED_INCOMPLETE_DEVELOPMENT','selectedModel':None}
        m=s.receipt_metadata('r',release,selection)
        self.assertEqual(m['schema'],'confovhh-round4-incomplete-selection-receipt-v1');self.assertIsNone(m['fitReceipt']);self.assertIsNone(m['fitVerification'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
