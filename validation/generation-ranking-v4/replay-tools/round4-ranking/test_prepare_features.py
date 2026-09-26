import copy
import unittest
from pathlib import Path
from unittest.mock import patch
import artifacts as a
import prepare_features as p

class FeaturePreparationTests(unittest.TestCase):
    def test_baseline_generation_regime_matches_prior_actual_profile(self):
        old=a.strict_json((p.HERE/'development-300-normalized/predictions.json').read_bytes())
        plan=a.strict_json((p.ROOT/'round4-generation/bundle/batch-plan.json').read_bytes())
        for target in plan['targets']:
            expected=next(x['profile'] for x in old['rows'] if x['setId']==target['id'])
            self.assertEqual(p.profile(plan,target,plan['arms'][0]),expected)
            for arm in plan['arms'][1:]:self.assertNotEqual(p.profile(plan,target,arm)['generationRegimeSha256'],expected['generationRegimeSha256'])

    def test_input_only_role_hash_and_interrupted_mapping(self):
        inv={'rows':[{'id':'x','setId':'T','status':'interrupted','geometryStatus':'not-produced','canonicalCoordinate':None}]}
        req=p.contact_request(inv,{'sha256':'0'*64},{'inventory':{'sha256':'1'*64}},
                              {'T':{'receptorChains':['A','B'],'selectedNb':'C'}},{'T':{'A':'AAA','B':'GG','C':'VV','D':'VV'}})
        row=req['rows'][0]
        self.assertEqual(row['producerStatus'],'failed');self.assertEqual(row['receptorSequenceSha256'],a.sha(b'AAAGG'));self.assertEqual(row['vhhSequenceSha256'],a.sha(b'VV'))

    def test_unknown_topology_not_silently_treated_as_pair(self):
        with self.assertRaisesRegex(ValueError,'Unknown producer topology'):p.profile({}, {'context':'unknown'}, {})

    def test_mc4r_full_context_has_distinct_source_only_profile(self):
        plan=a.strict_json((p.ROOT/'round4-generation/bundle/batch-plan.json').read_bytes())
        target={'context':'receptor-targetNb-Gs-auxiliaryNb35'}
        profile=p.profile(plan,target,plan['arms'][0])
        self.assertEqual(profile['scoreContext'],'receptor-targetNb-Gs-auxiliaryNb35-confidence')
        row=copy.deepcopy(a.strict_json((p.HERE/'development-300-normalized/predictions.json').read_bytes())['rows'][0])
        row['profile']=profile
        self.assertEqual(p.r.learned_reason([row],'confidence'),'unsupported-score-context')
        self.assertEqual(p.r.rank([row])[0]['score'],row['sourceValue'])

    def test_receipt_boolean_counts_and_nonboolean_snapshot_rejected(self):
        good={k:None for k in p.PROOF_KEYS}
        good.update(schema='confovhh-round4-source-ranking-receipt-v1',evaluationRole='development',snapshot=True,
                    plannedCount=1,producedCount=0,sourceAvailableCount=0,allPlannedIdsRetained=True,outcomeInputs=[])
        p.validate_source_receipt(good)
        for key,value in [('plannedCount',True),('producedCount',False),('sourceAvailableCount',False),('snapshot',1),('producedCount',-1),('sourceAvailableCount',1)]:
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):p.validate_source_receipt(good|{key:value})

    def test_receipt_outcome_injection_and_missing_attempt_guarantee_rejected(self):
        good={k:None for k in p.PROOF_KEYS}
        good.update(schema='confovhh-round4-source-ranking-receipt-v1',evaluationRole='development',snapshot=False,
                    plannedCount=1,producedCount=1,sourceAvailableCount=1,allPlannedIdsRetained=True,outcomeInputs=[])
        for value in (good|{'DockQ':.9},good|{'outcomeInputs':['outcome.json']},good|{'allPlannedIdsRetained':1}):
            with self.assertRaises(ValueError):p.validate_source_receipt(value)

    def test_frozen_ranker_and_contact_dependencies_are_bound(self):
        impl=p.implementation(p.ROOT)
        for name in ['ranker.py','artifacts.py','contact_features.mjs','prepare_features.py']:
            self.assertEqual(impl['round4-ranking/'+name],a.sha((p.HERE/name).read_bytes()))

    def test_generated_invalid_confidence_and_failed_attempts_retained(self):
        plan=a.strict_json((p.ROOT/'round4-generation/bundle/batch-plan.json').read_bytes());target=plan['targets'][0]
        rows=[];proofs=[]
        for i,status in enumerate(('generated','failed','interrupted','not-run')):
            rows.append({'id':'x'+str(i),'setId':target['id'],'generationArm':'baseline','seed':25+i,'seedBatch':'batch',
                         'status':status,'geometryStatus':'invalid' if status=='generated' else 'not-produced','canonicalCoordinate':None,
                         'sourceConfidence':{'path':'stub','bytes':1,'sha256':'0'*64} if status=='generated' else None,'unavailableReason':'diagnostic'})
            proofs.append({'id':'x'+str(i),'setId':target['id'],'coordinateSha256':None,'validity':{'status':'invalid' if status=='generated' else 'not-produced'},
                           'contactStatus':'not-attempted','reason':'diagnostic','interface':{'contactPairCount':None},'cdr':{'status':'unavailable'}})
        inv={'evaluationRole':'development','rows':rows,'cohort':{'path':'cohort','bytes':1,'sha256':'1'*64}}
        prep={'inventory':{'path':'inv','bytes':1,'sha256':'2'*64}};pb={'path':'prep','bytes':1,'sha256':'3'*64}
        evidence={'schema':'confovhh-round4-contact-evidence-v1','preparationReceiptSha256':'3'*64,'inventorySha256':'2'*64,'reports':proofs,'outcomeInputs':[]}
        with patch.object(a,'bound',return_value=b'{"confidence_score":0.7,"complex_plddt":0.8,"iptm":0.6,"complex_iplddt":0.5,"complex_ipde":4}'):
            table,ledger=p.table_from_evidence(p.ROOT,inv,pb,prep,plan,{target['id']:target},{},evidence,{})
        self.assertEqual(len(table['rows']),4);self.assertEqual(table['rows'][0]['sourceValue'],.7)
        self.assertEqual(table['rows'][0]['validityStatus'],'invalid');self.assertIsNone(table['rows'][0]['coordinateSha256'])
        self.assertEqual(ledger[2]['originalProducerStatus'],'interrupted');self.assertEqual(table['rows'][2]['producerStatus'],'failed')
        self.assertEqual(p.r.rank(table['rows'])[0]['rankMin'],1)

if __name__=='__main__':unittest.main()
