"""Synthetic new900 comparison tests; no prediction or native outcomes opened."""
import copy
from fractions import Fraction
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import analyze_generation as a

PLAN=json.loads((a.ROOT/'round4-generation/bundle/batch-plan.json').read_text())
GROUPING=json.loads((a.ROOT/'round4-benchmark/development-group-map.json').read_text())

def fixture(gains=None):
    gains=gains or {};rows=[];labels={};times={}
    for j in PLAN['jobs']:
        arm=j['armId'];tid=j['targetId'];ident=j['jobId'];seq='synthetic-seeds25-49'
        rows.append(dict(id=ident,setId=tid,poolId=tid+'::'+arm+'::'+seq,generationArm=arm,seedBatch=seq,
            producerStatus='generated',sourceValue=1-(j['seed']-25)/100,sourceDirection='higher-better',validityStatus='valid',
            coordinateSha256='1'*64,profile=dict(producerVersion='synthetic',modelSha256='2'*64,scoreContext='pair-confidence',generationRegimeSha256=arm),
            features={k:None for k in a.ranker.FEATURES}))
        labels[ident]=float(Fraction(3,10)+Fraction(str(gains.get(arm,0))));times[ident]=2.0
    return rows,labels,times

def report(rows,labels,times):return a.analyze(rows,labels,a.ranker.rank(rows),GROUPING,PLAN,times)

def outcome_fixture():
    rows,labels,_=fixture();jobs={j['jobId']:j for j in PLAN['jobs']};prepared=[];outcomes=[]
    for r in rows:
        seed=jobs[r['id']]['seed'];prepared.append(dict(id=r['id'],seed=seed,status='generated'))
        o={k:r[k] for k in ['id','setId','generationArm','seedBatch','coordinateSha256','producerStatus']}
        o.update(seed=seed,status='evaluated',DockQ=labels[r['id']]);outcomes.append(o)
    return rows,prepared,outcomes

class AnalyzerTests(unittest.TestCase):
    def test_new900_baseline_retained_without_gain(self):
        rows,labels,times=fixture();x=report(rows,labels,times)
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'baseline')
        self.assertEqual(len(x['pools']),36)
        pair=x['scopes']['primary-pair']['arms']['baseline']['aggregate']
        self.assertEqual((pair['plannedCount'],pair['biologicalGroupCount']),(225,8))
        self.assertEqual(x['scopes']['all-contexts']['arms']['baseline']['aggregate']['biologicalGroupCount'],11)
        self.assertEqual(x['scopes']['full-dimer-context']['arms']['baseline']['aggregate']['plannedCount'],50)
        self.assertEqual(x['scopes']['CASR-exploratory']['arms']['baseline']['aggregate']['plannedCount'],25)
    def test_exact_boundary_and_arm_tie_preference(self):
        x=report(*fixture({'broader':.02,'msa1024':.02}))
        self.assertTrue(all(g['passes'] for g in x['pairGenerationDecision']['candidates'].values()))
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'broader')
        self.assertEqual(x['pairGenerationDecision']['candidates']['broader']['meanFirstDockQGain'],.02)
    def test_below_threshold_fails_exactly(self):
        x=report(*fixture({'broader':.019999999999}))
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'baseline')
    def test_largest_eligible_gain_selected(self):
        x=report(*fixture({'broader':.03,'msa1024':.04}))
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'msa1024')
    def test_single_target_acceptable_loss_blocks_even_large_gain(self):
        rows,labels,times=fixture({'broader':.2});labels['dev_8qot__broader__seed25']=.22
        x=report(rows,labels,times);g=x['pairGenerationDecision']['candidates']['broader']
        self.assertTrue(g['checks']['usefulGain']);self.assertFalse(g['checks']['noAcceptableFirstLoss']);self.assertFalse(g['passes'])
    def test_related_two_targets_share_group_weight(self):
        rows,labels,times=fixture();labels['dev_8th3__broader__seed25']=.7
        x=report(rows,labels,times);cmp=x['scopes']['primary-pair']['comparisons']['broader']
        self.assertEqual(cmp['perGroupDifferences']['angiotensin-at118']['firstDockQ'],.2)
        self.assertEqual(cmp['equalGroupMeanDifference']['firstDockQ'],.025)
    def test_dimer_helix_cannot_drive_pair_choice(self):
        rows,labels,times=fixture()
        for r in rows:
            if r['generationArm']=='broader' and r['setId'] in ['CASR_NB2D11','GRM5_NB43','CHRM1_NB1B4']:labels[r['id']]=.99
        x=report(rows,labels,times)
        self.assertGreater(x['scopes']['all-contexts']['comparisons']['broader']['equalGroupMeanDifference']['firstDockQ'],.02)
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'baseline')
    def test_missing_low_rank_outcome_stays_visible_and_blocks_gate(self):
        rows,labels,times=fixture({'broader':.04});labels['dev_8qot__broader__seed49']=None
        x=report(rows,labels,times);p=next(p for p in x['pools'] if p['setId']=='dev_8qot' and p['generationArm']=='broader')
        self.assertEqual(p['firstDockQ'],.34);self.assertEqual(p['evaluableCount'],24);self.assertIsNone(p['acceptablePerPlanned'])
        self.assertEqual(p['acceptablePerPlannedBounds'],[.96,1]);self.assertIsNone(p['bestCandidateGap'])
        self.assertFalse(x['pairGenerationDecision']['candidates']['broader']['passes'])
    def test_missing_first_tie_member_not_omitted(self):
        rows,labels,times=fixture()
        for r in rows:
            if r['setId']=='dev_8qot' and r['generationArm']=='baseline':r['sourceValue']=.5
        labels['dev_8qot__baseline__seed49']=None;x=report(rows,labels,times)
        p=next(p for p in x['pools'] if p['setId']=='dev_8qot' and p['generationArm']=='baseline')
        self.assertTrue(p['selectionAvailable']);self.assertIsNone(p['firstDockQ']);self.assertIsNone(p['top5MeanDockQ'])
    def test_ties_uniform_first_topfive_and_shuffle_invariant(self):
        rows,labels,times=fixture()
        selected=[r for r in rows if r['setId']=='dev_8qot' and r['generationArm']=='baseline']
        for i,r in enumerate(selected):r['sourceValue']=.5;labels[r['id']]=1 if i<5 else 0
        rr=a.ranker.rank(rows);pool=a.source_pool(selected,labels,{r['id']:r for r in rr},times)
        self.assertEqual(pool['firstDockQ'],Fraction(1,5));self.assertEqual(pool['firstAcceptableProbability'],Fraction(1,5))
        self.assertEqual(pool['top5MeanDockQ'],Fraction(1,5));self.assertEqual(pool['top5ExpectedAcceptableCount'],1)
        self.assertEqual(report(rows,labels,times),report(list(reversed(rows)),labels,times))
    def test_failed_attempt_is_counted_but_not_fabricated_quality(self):
        rows,labels,times=fixture();r=next(r for r in rows if r['id']=='dev_8qot__baseline__seed49');r['producerStatus']='failed';r['validityStatus']='unavailable';r['coordinateSha256']=None;labels[r['id']]=None
        x=report(rows,labels,times);p=next(p for p in x['pools'] if p['setId']=='dev_8qot' and p['generationArm']=='baseline')
        self.assertEqual((p['plannedCount'],p['attemptedCount'],p['generatedCount'],p['failedCount'],p['evaluableCount']),(25,25,24,1,24))
        self.assertEqual(p['acceptablePerPlanned'],.96);self.assertEqual(p['firstDockQ'],.3)
    def test_source_missing_abstains_whole_pool(self):
        rows,labels,times=fixture({'broader':.1});r=next(r for r in rows if r['id']=='dev_8qot__broader__seed49');r['sourceValue']=None
        x=report(rows,labels,times);cmp=x['scopes']['primary-pair']['comparisons']['broader']
        self.assertFalse(cmp['selectionCoverageUnchanged']);self.assertIsNone(cmp['equalGroupMeanDifference']['firstDockQ'])
        self.assertEqual(x['pairGenerationDecision']['selectedArm'],'baseline')
    def test_invalid_produced_coordinates_keep_original_source_candidate(self):
        rows,labels,times=fixture();r=next(r for r in rows if r['id']=='dev_8qot__baseline__seed25');r['validityStatus']='invalid'
        x=report(rows,labels,times);p=next(p for p in x['pools'] if p['setId']=='dev_8qot' and p['generationArm']=='baseline')
        self.assertEqual(p['validCount'],24);self.assertTrue(p['selectionAvailable']);self.assertEqual(p['firstDockQ'],.3)
    def test_bootstrap_deterministic_whole_group_and_small_scope_unavailable(self):
        d={'a':Fraction(1,10),'b':Fraction(3,10)};x=a.bootstrap(d)
        self.assertEqual(x,a.bootstrap(dict(reversed(list(d.items())))));self.assertEqual(x['percentileInterval'],[.1,.3]);self.assertEqual(x['resamples'],10000)
        self.assertEqual(a.bootstrap({'a':Fraction(1)})['status'],'unavailable');self.assertEqual(a.bootstrap({'a':None,'b':Fraction(1)})['status'],'unavailable')
    def test_missing_timing_is_explicit(self):
        rows,labels,times=fixture();times['dev_8qot__baseline__seed25']=None
        x=report(rows,labels,times);p=next(p for p in x['pools'] if p['setId']=='dev_8qot' and p['generationArm']=='baseline')
        self.assertEqual(p['elapsedSecondsKnown'],48);self.assertIsNone(p['elapsedSecondsComplete']);self.assertEqual(p['elapsedAttemptsKnown'],24)
    def test_old300_or_shorter_membership_rejected(self):
        rows,labels,times=fixture()
        with self.assertRaises(ValueError):a.analyze(rows[:300],labels,a.ranker.rank(rows[:300]),GROUPING,PLAN,times)
    def test_altered_source_ranks_rejected(self):
        rows,labels,times=fixture();ranks=a.ranker.rank(rows);ranks[0]['score']+=.01
        with self.assertRaises(ValueError):a.analyze(rows,labels,ranks,GROUPING,PLAN,times)
    def test_unauthorized_release_rejected_before_file_access(self):
        release=dict(schema='confovhh-round4-generation-analysis-release-v1',evaluationRole='development',authorizeNewDevelopmentAnalysis=False,analysisFreeze={},sourceRankingReceipt={},outcomeReceipt={},generationPlan={},grouping={})
        with mock.patch.object(a,'bound',side_effect=AssertionError('File opened before authorization')):
            with self.assertRaises(ValueError):a.validate_release(a.ROOT,release)
    def test_omitted_code_freeze_binding_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();here=root/'round4-analysis';here.mkdir();fp=here/'ANALYZER-FREEZE.json'
            fp.write_text(json.dumps(dict(schema='confovhh-round4-generation-analyzer-freeze-v1',newLabelsReadAtFreeze=False,files=[])))
            release=dict(schema='confovhh-round4-generation-analysis-release-v1',evaluationRole='development',authorizeNewDevelopmentAnalysis=True,analysisFreeze=a.binding(fp,root),sourceRankingReceipt={},outcomeReceipt={},generationPlan={},grouping={})
            with mock.patch.object(a,'HERE',here),self.assertRaisesRegex(ValueError,'method binding roster'):a.validate_release(root,release)
    def test_exact_outcome_join(self):
        rows,prepared,outcomes=outcome_fixture();self.assertEqual(len(a.join_outcomes(rows,prepared,outcomes)),900)
    def test_wrong_outcome_coordinate_rejected(self):
        rows,prepared,outcomes=outcome_fixture();outcomes[0]['coordinateSha256']='f'*64
        with self.assertRaises(ValueError):a.join_outcomes(rows,prepared,outcomes)
    def test_wrong_outcome_arm_or_seed_rejected(self):
        for key,value in [('generationArm','other'),('seed',0)]:
            rows,prepared,outcomes=outcome_fixture();outcomes[0][key]=value
            with self.assertRaises(ValueError):a.join_outcomes(rows,prepared,outcomes)
    def test_duplicate_outcome_rejected(self):
        rows,prepared,outcomes=outcome_fixture();outcomes[0]=copy.deepcopy(outcomes[1])
        with self.assertRaises(ValueError):a.join_outcomes(rows,prepared,outcomes)
    def test_hidden_failed_status_rejected(self):
        rows,prepared,outcomes=outcome_fixture();outcomes[0]['producerStatus']='failed'
        with self.assertRaises(ValueError):a.join_outcomes(rows,prepared,outcomes)

if __name__=='__main__':unittest.main(verbosity=2)
