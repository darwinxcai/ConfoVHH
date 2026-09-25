import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import calibrate as c

NODE = os.environ.get('CONFOVHH_NODE','/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')


def fixture(gaps=None):
    result = subprocess.run([NODE,str(c.HERE/'synthetic_fixture.mjs')],input=json.dumps({'gaps':gaps or {}}),text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


def grid_for(request):
    result = subprocess.run([NODE,str(c.HERE/'generate_grid.mjs')],input=json.dumps(request),text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


def enrollment(request):
    return [{'id':a['id'],'setId':a['setId'],'seed':int(a['id'].rsplit('seed',1)[1]),'generationReceiptSha256':c.sha(a['id'].encode()),'coordinateSha256':a['coordinate']['sha256'] if a['coordinate'] else None} for b in request['bundles'] for a in b['sourceManifest']['attempts']]


def outcomes(request, quality=None):
    quality = quality or {}
    rows = []
    for a in enrollment(request):
        q = quality.get(a['setId'],(.1,.8))[min(a['seed'],1)] if a['seed'] < 2 else .05
        rows.append({key:a[key] for key in ('id','setId','seed','coordinateSha256')} | {'status':'evaluated','DockQ':q,'reason':''})
    return {'schema':'confovhh-round3-development-outcome-map-v1','evaluationRole':'development','rows':rows}


def write(root, rel, value):
    target = root/rel; target.parent.mkdir(parents=True,exist_ok=True)
    raw = (json.dumps(value,indent=2)+'\n').encode(); target.write_bytes(raw)
    return {'path':rel,'bytes':len(raw),'sha256':c.sha(raw)}


def io_fixture(root, prediction=None, labels=None):
    prediction = copy.deepcopy(prediction or fixture()); bundle = prediction['bundles'][0]
    freeze = write(root,'execution-freeze.json',{'files':{'PROTOCOL.md':c.PROTOCOL}})
    profile=bundle['input']['producerProfiles'][0]; generator=bundle['sourceManifest']['generators'][0]
    provenance = {'schema':'confovhh-round3-pair-producer-provenance-v1','generatorId':generator['id'],'producerVersion':profile['version'],'scoreContext':profile['scoreContext'],'scoreName':generator['scoreName'],'direction':generator['direction'],
                  'packageVersion':'2.2.1','sourceCommit':c.COMMIT,'modelSha256':c.MODEL,'contextRegime':'pair','scientificSettings':{'recyclingSteps':3,'samplingSteps':200,'diffusionSamples':1,'stepScale':1.5,'seeds':list(range(25)),'precision':'bf16-mixed','templates':False,'restraints':False,'forcePotentials':False},
                  'generationRunId':'synthetic-test-only','executionFreezeSha256':freeze['sha256'],'attempts':enrollment(prediction)}
    producer = write(root,'producer.json',provenance); profile['scoreProvenance'] = producer
    grid = grid_for(prediction)
    saved = {'manifest.json':bundle['input'],'source-manifest.json':bundle['sourceManifest'],'features.json':bundle['features'],'ranks.json':grid['baselines'][0]['ranks'],'calibrations.json':{},
             'source-score-receipt.json':{},'source-features.json':[],'source-attempts.json':[],'source-ranks.json':[],'attempts.json':[],'blocks.json':grid['baselines'][0]['blocks'],'contact-evidence.json':[]}
    files = {name:write(root,'ranking/'+name,data)['sha256'] for name,data in saved.items()}
    method=json.loads(subprocess.run([NODE,str(c.REPO/'scripts/external-ranking-v3/verify-contact-evidence.mjs'),'--method'],text=True,capture_output=True,check=True).stdout)
    ranking = write(root,'ranking/receipt.json',{'schema':'confovhh-source-first-receipt-v3','evaluationRole':'development','outcomeInputs':[],'files':files,
                    'sourceScoreReceiptSha256':files['source-score-receipt.json'],'standaloneContactEvidenceCount':0,'standaloneContactComputedCount':0,'contactMethod':method,
                    'implementation':{name:c.sha((c.REPO/name).read_bytes()) for name in ('scripts/external-ranking-v3/policy.mjs','scripts/external-ranking-v3/score.mjs','scripts/external-ranking-v3/contact-only.mjs')}})
    labels = labels or outcomes(prediction)
    mapping = write(root,'outcomes.json',labels)
    auth_rows=[{key:r[key] for key in ('id','setId','seed','coordinateSha256')} | {'referenceSha256':c.sha(r['setId'].encode()),'outcomeArtifactSha256':c.sha(json.dumps(r).encode())} for r in labels['rows']]
    authentication = write(root,'outcome-authentication.json',{'schema':'confovhh-round3-development-outcome-authentication-v1','outcomeMapSha256':mapping['sha256'],'rankingReceiptSha256':[ranking['sha256']],
                    'producerProvenanceSha256':producer['sha256'],'generationRunId':provenance['generationRunId'],'coordinateIdentityVerified':True,'referenceIdentityVerified':True,'outcomeArtifactsVerified':True,'rankingSealedBeforeOutcomes':True,'rows':auth_rows})
    request={'schema':'confovhh-round3-gap-calibration-input-v1','calibrationId':'synthetic-gap','startedAtUtc':'2026-09-25T00:00:00Z','executionFreeze':freeze,'producerProvenance':producer,'cohorts':[ranking],'outcomeMap':mapping,'analysisReceipt':authentication}
    return request,prediction,provenance


class CalibrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prediction = fixture(); cls.grid = grid_for(cls.prediction)

    def analyze(self, labels=None, grid=None, prediction=None):
        p = prediction or self.prediction
        return c.analyze_grid(grid or self.grid,labels or outcomes(p),enrollment(p))

    def test_actual_selector_smallest_effective_tolerance_and_group_holdout(self):
        result = self.analyze()
        self.assertEqual(result['status'],'CALIBRATED_NONZERO')
        self.assertEqual(result['finalGap'],.005)
        self.assertEqual(result['leaveGroupOutPooledFirstChoiceGain']['exact'],'7/10')
        self.assertEqual(len(result['leaveGroupOut']),3)
        fold = next(f for f in result['leaveGroupOut'] if f['heldOutGroup']=='AGTR1-AT118')
        self.assertEqual(fold['heldOutSets'],['dev_8th3','dev_8th4'])
        self.assertEqual(fold['trainingSets'],['dev_6knm','dev_8qot'])
        self.assertTrue(all(f['fit']['selectedGap']==.005 for f in result['leaveGroupOut']))

    def test_all_no_gain_chooses_zero_and_retains_all_sets(self):
        result = self.analyze(outcomes(self.prediction,{s:(.4,.4) for s in c.GROUPS}))
        self.assertEqual(result['finalGap'],0)
        self.assertFalse(result['nonzeroGatePassed'])
        self.assertEqual(result['fullDevelopmentFit']['selectedGap'],0)
        self.assertEqual(len(result['evaluations']),40)

    def test_safety_rejects_training_loss_and_detects_heldout_loss(self):
        labels = outcomes(self.prediction,{'dev_6knm':(.4,.1)})
        result = self.analyze(labels)
        self.assertEqual(result['fullDevelopmentFit']['selectedGap'],0)
        self.assertEqual(result['heldOutAcceptableChoiceLossSets'],['dev_6knm'])
        self.assertEqual(result['finalGap'],0)
        self.assertFalse(result['nonzeroGatePassed'])
        unsafe = next(r for r in result['fullDevelopmentFit']['candidates'] if r['gap']==.005)
        self.assertEqual(unsafe['acceptableChoiceLossSets'],['dev_6knm'])

    def test_positive_full_fit_but_zero_heldout_gain_forces_zero(self):
        labels = outcomes(self.prediction,{s:(.4,.4) for s in c.GROUPS} | {'dev_6knm':(.1,.8)})
        # Only one group benefits. Other groups alone select zero; no held-out gain remains.
        result = self.analyze(labels)
        self.assertEqual(result['fullDevelopmentFit']['selectedGap'],.005)
        self.assertEqual(result['leaveGroupOutPooledFirstChoiceGain']['exact'],'0')
        self.assertEqual(result['finalGap'],0)

    def test_group_weighting_is_not_four_set_weighting(self):
        labels = outcomes(self.prediction,{'dev_6knm':(.1,.7),'dev_8qot':(.1,.7),'dev_8th3':(.1,.1),'dev_8th4':(.1,.1)})
        result = self.analyze(labels)
        row=next(r for r in result['fullDevelopmentFit']['candidates'] if r['gap']==.005)
        self.assertEqual(row['groupWeightedFirstChoiceGain']['exact'],'2/5')

    def test_missing_outcome_or_source_abstains_without_dropping_mass(self):
        labels=outcomes(self.prediction); labels['rows'][-1].update(status='unavailable',DockQ=None,reason='Fixture missing outcome')
        result=self.analyze(labels)
        self.assertEqual(result['status'],'ABSTAIN_INCOMPLETE_EVIDENCE')
        self.assertIsNone(result['finalGap'])
        self.assertEqual(len(result['missingOutcomeIds']),1)
        p=copy.deepcopy(self.prediction); p['bundles'][0]['features'][0]['source'].update(status='missing',rawValue=None,preferredValue=None,reason='Fixture absent source')
        result=self.analyze(grid=grid_for(p),prediction=p)
        self.assertEqual(result['status'],'ABSTAIN_INCOMPLETE_EVIDENCE')
        self.assertEqual(result['unavailableSourceSets'],['dev_6knm'])

    def test_uniform_exact_ties_safety_uses_probability(self):
        p=fixture({s:0 for s in c.GROUPS})
        labels=outcomes(p,{s:(.5,.1) for s in c.GROUPS})
        result=self.analyze(labels,grid=grid_for(p),prediction=p)
        self.assertFalse(result['fullDevelopmentFit']['admissibleFitAvailable'])
        self.assertEqual(result['finalGap'],0)
        self.assertTrue(result['zeroIsNotASafetyClaim'])
        self.assertEqual(result['evaluations'][0]['firstChoiceAcceptableProbability'],.5)

    def test_invalid_rows_remain_visible_and_optional_features_fall_back(self):
        p=copy.deepcopy(self.prediction)
        f=p['bundles'][0]['features'][0]
        f['validity']={'status':'invalid','reasonCodes':['fixture-duplicate-atom-identities'],'error':'','roleIdentityScope':'unavailable','parserDiagnostics':None,'sequenceChecks':{'receptor':'unavailable','vhh':'unavailable'},'sequenceSha256':{'receptor':None,'vhh':None},'backboneDiagnostics':[]}
        f['interface']={'status':'invalid-input','contactPairCount':None}
        f['cdr']={'status':'unavailable','numberingStatus':None,'paratopeProxyShare':None,'reason':'Fixture invalid input','components':None}
        result=self.analyze(grid=grid_for(p),prediction=p)
        subset=[r for r in result['evaluations'] if r['setId']=='dev_6knm' and r['arm']==c.ARM]
        self.assertTrue(all(r['pools']['allPlanned']['size']==25 and r['pools']['policyEligible']['size']==24 for r in subset))
        # Valid no-contact candidates retain source selection rather than being removed.
        p=copy.deepcopy(self.prediction)
        for f in p['bundles'][0]['features']:
            f['interface']={'status':'no-contact','contactPairCount':0}
            f['cdr']={'status':'unavailable','numberingStatus':'numbered','paratopeProxyShare':None,'reason':'No contacting pairs','components':None}
        result=self.analyze(grid=grid_for(p),prediction=p)
        self.assertEqual(result['finalGap'],0)
        self.assertTrue(all(r['coverage']['eligibleCount']==25 and r['interfaceSupport']['status']=='unsupported-all-no-contact' for r in result['evaluations']))

    def test_leakage_grouping_partial_membership_and_boolean_labels_rejected(self):
        for mutate in (lambda p:p['bundles'][0]['input'].__setitem__('evaluationRole','sealed-validation'),
                       lambda p:p['bundles'][0]['input']['setPolicies'][2].__setitem__('biologicalGroupId','unseen-prospective-group'),
                       lambda p:p['bundles'][0]['input']['setPolicies'][0].__setitem__('setId','CASR_NB2D11'),
                       lambda p:p['bundles'][0]['features'][0].__setitem__('DockQ',.99),
                       lambda p:p['bundles'][0]['sourceManifest']['attempts'].pop()):
            p=copy.deepcopy(self.prediction); mutate(p)
            with self.assertRaises(subprocess.CalledProcessError): grid_for(p)
        labels=outcomes(self.prediction); labels['rows'][0]['DockQ']=True
        with self.assertRaises(ValueError): self.analyze(labels)
        labels=outcomes(self.prediction); labels['rows'][0]['id']='CASR_NB2D11_seed00'
        with self.assertRaises(ValueError): self.analyze(labels)
        with self.assertRaises(ValueError): c.strict_json('{"DockQ":0.1,"DockQ":0.2}')

    def test_bound_end_to_end_and_authentication_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); request,p,provenance=io_fixture(root)
            receipt,calibration=c.run(request,root,root/'fit',NODE)
            self.assertEqual(calibration['maximumPreferredScoreGap'],.005)
            self.assertEqual(calibration['evidenceSha256'],c.sha((root/'fit/analysis-receipt.json').read_bytes()))
            self.assertEqual(receipt['producerProvenanceSha256'],request['producerProvenance']['sha256'])
            self.assertEqual(receipt['analysisReceiptSha256'],request['analysisReceipt']['sha256'])
            self.assertEqual(receipt,json.loads((root/'fit/analysis-receipt.json').read_text()))
            self.assertTrue((root/'fit/prediction-grid-receipt.json').is_file())
            # Export must pass the real selector's calibration contract and replay.
            bundle=copy.deepcopy(p['bundles'][0]); raw=(root/'fit/calibration.json').read_bytes()
            bundle['input']['producerProfiles'][0]['calibration']={'path':'fit/calibration.json','bytes':len(raw),'sha256':c.sha(raw)}
            bundle['calibrations']={calibration['generatorId']:calibration}
            module=(c.REPO/'scripts/external-ranking-v3/policy.mjs').as_uri()
            script="import {readFileSync} from 'node:fs'; import {rankSourceFirst} from "+json.dumps(module)+"; const r=rankSourceFirst(JSON.parse(readFileSync(0,'utf8'))); process.stdout.write(JSON.stringify(r.ranks.filter(v=>v.arm==='source-validity-cdr-calibrated').map(v=>v.selected)));"
            replay=subprocess.run([NODE,'--input-type=module','-e',script],input=json.dumps(bundle),capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(replay.stdout),[[s+'_seed01'] for s in sorted(c.GROUPS)])
            with self.assertRaises(FileExistsError): c.run(request,root,root/'fit',NODE)
            tampered=json.loads((root/'outcomes.json').read_text()); tampered['rows'][0]['coordinateSha256']='a'*64
            request['outcomeMap']=write(root,'outcomes.json',tampered)
            auth=json.loads((root/'outcome-authentication.json').read_text()); auth['outcomeMapSha256']=request['outcomeMap']['sha256']; auth['rows'][0]['coordinateSha256']='a'*64
            request['analysisReceipt']=write(root,'outcome-authentication.json',auth)
            with self.assertRaises(ValueError): c.run(request,root,root/'wrong-coordinates',NODE)
            self.assertTrue((root/'wrong-coordinates/prediction-grid-receipt.json').is_file())
            self.assertFalse((root/'wrong-coordinates/calibration.json').exists())

    def test_incomplete_end_to_end_creates_analysis_without_calibration(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); labels=outcomes(self.prediction)
            labels['rows'][0].update(status='unavailable',DockQ=None,reason='Fixture coordinate/outcome failure')
            request,_,_=io_fixture(root,self.prediction,labels)
            receipt,calibration=c.run(request,root,root/'fit',NODE)
            self.assertEqual(receipt['status'],'ABSTAIN_INCOMPLETE_EVIDENCE')
            self.assertIsNone(calibration)
            self.assertFalse((root/'fit/calibration.json').exists())
            self.assertTrue((root/'fit/analysis-receipt.json').is_file())

    def test_producer_context_and_outcome_file_in_prediction_receipt_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve(); request,_,provenance=io_fixture(root)
            provenance['contextRegime']='2gpcr-2nb'
            request['producerProvenance']=write(root,'producer.json',provenance)
            with self.assertRaises(ValueError): c.load_predictions(root,request)
            request,_,_=io_fixture(root)
            receipt=json.loads((root/'ranking/receipt.json').read_text()); receipt['files']['outcomes.json']='a'*64
            request['cohorts']=[write(root,'ranking/receipt.json',receipt)]
            with self.assertRaises(ValueError): c.load_predictions(root,request)


if __name__=='__main__':
    unittest.main()
