"""Outcome-free round4 prediction features and immutable source-rank seal.

This adapter is separate from the frozen fitter. Canonicalization belongs to
round4-outcomes/prepare_predictions.py; no physical SASA audit is requested.
"""
from __future__ import annotations
import argparse
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import artifacts as a
import ranker as r

ROOT=HERE.parent
VERSION='2.2.1+b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc'
MODEL='090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1'
ROLE={'development':'development','reserved':'reserved-evaluation'}
PROOF_KEYS={'schema','evaluationRole','snapshot','preparationReceipt','predictionTable','ranks','attempts','contactRequest','contactEvidence',
            'plannedCount','producedCount','sourceAvailableCount','allPlannedIdsRetained','outcomeInputs','implementation','nodeVersion'}

def prep_module(root):
    name='confovhh_round4_bound_preparation';path=root/'round4-outcomes/prepare_predictions.py'
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def implementation(root):
    freeze=a.strict_json((HERE/'IMPLEMENTATION-FREEZE-V2.json').read_bytes())
    for name,expected in freeze['implementation'].items():a.check(a.sha((HERE/name).read_bytes())==expected,'Frozen ranker implementation changed: '+name)
    a.check(Path(r.__file__).resolve()==HERE/'ranker.py' and Path(a.__file__).resolve()==HERE/'artifacts.py','Imported ranker module origin differs')
    files=['round4-ranking/prepare_features.py','round4-ranking/contact_features.mjs','round4-ranking/ranker.py','round4-ranking/artifacts.py',
           'round4-ranking/IMPLEMENTATION-FREEZE-V2.json','round4-outcomes/prepare_predictions.py',
           'ConfoVHH/scripts/external-ranking-v3/policy.mjs','ConfoVHH/scripts/external-ranking-v3/contact-only.mjs',
           'ConfoVHH/scripts/hard-decoy/oracle/canonical-json.mjs','ConfoVHH/validation/prospective-benchmark-v1/engine-lock.json']
    return {p:a.sha(a.safe(root,p).read_bytes()) for p in files}

def node():
    a.check(not os.environ.get('NODE_OPTIONS') and not os.environ.get('NODE_PATH'),'Ambient Node injection must be absent')
    candidate=os.environ.get('CONFOVHH_NODE_BINARY') or shutil.which('node') or '/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    version=subprocess.check_output([candidate,'--version'],text=True).strip()
    a.check(version=='v24.19.0','Frozen contact Node version required (set CONFOVHH_NODE_BINARY)')
    return candidate,version

def replay_contact(root,request_path,evidence_path,mode):
    binary,version=node()
    with tempfile.TemporaryDirectory(prefix='contact-runtime-',dir=HERE) as temporary:
        env=dict(os.environ,TMPDIR=temporary)
        cmd=[binary,str(HERE/'contact_features.mjs'),mode,str(root),str(request_path),str(evidence_path)]
        result=subprocess.run(cmd,capture_output=True,text=True,env=env,timeout=7200)
    a.check(result.returncode==0,'Frozen contact adapter failed: '+result.stderr[-3000:])
    attestation=a.strict_json(result.stdout)
    a.check(attestation['status']=='PASS' and attestation['outcomeInputs']==[],'Unexpected contact adapter attestation')
    return version

def grouping_binding(root,inventory,provided=None):
    if inventory['evaluationRole']=='development':
        groups,b=a.qualified_groups(root)
    else:
        a.check(provided is not None,'Reserved prediction extraction requires a frozen reserved grouping binding')
        b=provided;document=a.strict_json(a.bound(root,b))
        a.check(document['schema']=='confovhh-round4-reserved-groups-v1' and document['evaluationRole']=='reserved','Reserved grouping contract differs')
        groups={x['setId']:x['biologicalGroupId'] for x in document['sets']}
        a.check(len(groups)==len(document['sets']),'Duplicate reserved grouping target')
    a.check(set(groups)=={row['setId'] for row in inventory['rows']},'Grouping and prediction target membership differ')
    return b

def contact_request(inventory,preparation_binding,preparation,targets,sequences):
    rows=[]
    for row in inventory['rows']:
        target=targets[row['setId']];seq=sequences[row['setId']]
        rows.append({'id':row['id'],'setId':row['setId'],'producerStatus':'failed' if row['status']=='interrupted' else row['status'],
                     'geometryStatus':row['geometryStatus'],'coordinate':row['canonicalCoordinate'],
                     'receptorSequenceSha256':a.sha(''.join(seq[k] for k in target['receptorChains']).encode()),
                     'vhhSequenceSha256':a.sha(seq[target['selectedNb']].encode())})
    return {'schema':'confovhh-round4-contact-request-v1','preparationReceiptSha256':preparation_binding['sha256'],
            'inventorySha256':preparation['inventory']['sha256'],'rows':rows,'outcomeInputs':[]}

def profile(plan,target,arm):
    context=target['context']
    contexts={'pair':'pair-confidence','two-receptors-two-Nbs':'two-receptors-two-Nbs-confidence',
              'receptor-Nb-G11-helix':'receptor-Nb-G11-helix-confidence',
              'receptor-targetNb-Gs-auxiliaryNb35':'receptor-targetNb-Gs-auxiliaryNb35-confidence'}
    a.check(context in contexts,'Unknown producer topology context')
    settings=plan['settings']|{k:v for k,v in arm.items() if k!='id'}
    return {'producerVersion':VERSION,'modelSha256':MODEL,'scoreContext':contexts[context],
            'generationRegimeSha256':r.digest(a.normalize_settings(settings))}

def table_from_evidence(root,inventory,preparation_binding,preparation,plan,targets,request,evidence,group_binding):
    a.check(evidence['schema']=='confovhh-round4-contact-evidence-v1' and evidence['outcomeInputs']==[],'Invalid contact evidence contract')
    a.check(evidence['preparationReceiptSha256']==preparation_binding['sha256'] and evidence['inventorySha256']==preparation['inventory']['sha256'],'Contact evidence source binding differs')
    a.check(len(evidence['reports'])==len(inventory['rows']) and [x['id'] for x in evidence['reports']]==[x['id'] for x in inventory['rows']],'Contact evidence membership/order differs')
    arms={x['id']:x for x in plan['arms']};rows=[];ledger=[];bindings=[preparation_binding,preparation['inventory'],inventory['cohort']]
    for row,proof in zip(inventory['rows'],evidence['reports']):
        confidence={};value=None;reason='No produced source confidence'
        if row['sourceConfidence'] is not None:
            confidence=a.strict_json(a.bound(root,row['sourceConfidence']));bindings.append(row['sourceConfidence'])
            raw=confidence.get('confidence_score')
            if r.finite(raw):value=raw;reason=''
            else:reason='Produced source confidence missing or nonfinite'
        a.check(proof['setId']==row['setId'] and proof['coordinateSha256']==(row['canonicalCoordinate']['sha256'] if row['canonicalCoordinate'] else None),'Contact coordinate/target identity differs')
        status='failed' if row['status']=='interrupted' else row['status']
        validity=proof['validity']['status'];validity='unavailable' if validity=='not-produced' else validity
        feature=a.extract_feature_values(confidence,proof)
        rows.append({'id':row['id'],'setId':row['setId'],'poolId':row['setId']+'::'+row['generationArm']+'::'+row['seedBatch'],
                     'generationArm':row['generationArm'],'seedBatch':row['seedBatch'],'producerStatus':status,'sourceValue':value,
                     'sourceDirection':'higher-better','validityStatus':validity,'coordinateSha256':proof['coordinateSha256'],
                     'profile':profile(plan,targets[row['setId']],arms[row['generationArm']]),'features':feature})
        ledger.append({'id':row['id'],'setId':row['setId'],'generationArm':row['generationArm'],'seed':row['seed'],
                       'originalProducerStatus':row['status'],'producerStatus':status,'geometryStatus':row['geometryStatus'],
                       'validityStatus':validity,'sourceStatus':'present' if value is not None else 'missing' if status=='generated' else 'not-produced',
                       'sourceReason':reason,'contactStatus':proof['contactStatus'],'contactReason':proof['reason'],
                       'optionalCdrStatus':proof['cdr']['status'],'unavailableReason':row['unavailableReason']})
    r.validate_rows(rows)
    table={'schema':'confovhh-round4-prediction-table-v1','evaluationRole':ROLE[inventory['evaluationRole']],
           'origin':'round4-frozen-generation-plan','rows':sorted(rows,key=lambda x:x['id']),
           'inputBindings':sorted({b['path']:b for b in bindings}.values(),key=lambda b:b['path']),
           'groupingBinding':group_binding,'outcomeInputs':[],'featureNames':list(r.FEATURES)}
    return table,sorted(ledger,key=lambda x:x['id'])

def prepare(root,preparation_binding,output,group_binding=None):
    output=Path(output).resolve();a.check(output.is_relative_to(HERE) and not output.exists(),'Feature output must be new directory under round4-ranking')
    impl=implementation(root);prep=prep_module(root);inventory,receipt=prep.verify_preparation(root,preparation_binding)
    cohort,plan,targets,sequences,_=prep.verify_cohort(root,inventory['cohort'])
    gb=grouping_binding(root,inventory,group_binding);request=contact_request(inventory,preparation_binding,receipt,targets,sequences)
    output.mkdir(parents=True);a.save(output/'contact-request.json',request)
    version=replay_contact(root,output/'contact-request.json',output/'contact-evidence.json','extract')
    evidence=a.strict_json((output/'contact-evidence.json').read_bytes())
    table,ledger=table_from_evidence(root,inventory,preparation_binding,receipt,plan,targets,request,evidence,gb)
    saved={'schema':'confovhh-round4-saved-ranks-v1','predictionTableDigest':r.digest(table),'ranks':r.rank(table['rows']),
           'modelBinding':None,'outcomeInputs':[]}
    for name,value in [('predictions.json',table),('source-ranks.json',saved),('attempts.json',ledger)]:a.save(output/name,value)
    seal={'schema':'confovhh-round4-source-ranking-receipt-v1','evaluationRole':table['evaluationRole'],'snapshot':inventory['snapshot'],
          'preparationReceipt':preparation_binding,'predictionTable':a.binding(root,output/'predictions.json'),
          'ranks':a.binding(root,output/'source-ranks.json'),'attempts':a.binding(root,output/'attempts.json'),
          'contactRequest':a.binding(root,output/'contact-request.json'),'contactEvidence':a.binding(root,output/'contact-evidence.json'),
          'plannedCount':len(table['rows']),'producedCount':sum(x['producerStatus']=='generated' for x in table['rows']),
          'sourceAvailableCount':sum(x['sourceValue'] is not None for x in table['rows']),
          'allPlannedIdsRetained':True,'outcomeInputs':[],'implementation':impl,'nodeVersion':version}
    a.save(output/'source-rank-receipt.json',seal);return seal

def validate_source_receipt(seal):
    a.check(set(seal)==PROOF_KEYS and seal['schema']=='confovhh-round4-source-ranking-receipt-v1','Unexpected source ranking receipt')
    a.check(seal['evaluationRole'] in ROLE.values() and type(seal['snapshot']) is bool,'Invalid source ranking role/snapshot type')
    a.check(all(type(seal[k]) is int and seal[k]>=0 for k in ('plannedCount','producedCount','sourceAvailableCount')),'Invalid source ranking count type')
    a.check(0<=seal['sourceAvailableCount']<=seal['producedCount']<=seal['plannedCount'],'Inconsistent source ranking coverage counts')
    a.check(seal['allPlannedIdsRetained'] is True and seal['outcomeInputs']==[],'Source ranking isolation/attempt coverage differs')

def verify_source_seal(root,receipt_binding):
    """Return (predictionTable, savedRanks, sourceReceipt); never opens outcomes."""
    root=Path(root).resolve();seal=a.strict_json(a.bound(root,receipt_binding));validate_source_receipt(seal)
    a.check(seal['implementation']==implementation(root) and seal['outcomeInputs']==[] and seal['allPlannedIdsRetained'] is True,'Source-ranking implementation/isolation differs')
    data={k:a.strict_json(a.bound(root,seal[k])) for k in ('predictionTable','ranks','attempts','contactRequest','contactEvidence')}
    prep=prep_module(root);inventory,receipt=prep.verify_preparation(root,seal['preparationReceipt'])
    _,plan,targets,sequences,_=prep.verify_cohort(root,inventory['cohort'])
    request=contact_request(inventory,seal['preparationReceipt'],receipt,targets,sequences)
    a.check(request==data['contactRequest'],'Contact request differs from authenticated preparation')
    version=replay_contact(root,root/seal['contactRequest']['path'],root/seal['contactEvidence']['path'],'verify')
    a.check(version==seal['nodeVersion'],'Contact Node version differs')
    gb=grouping_binding(root,inventory,data['predictionTable']['groupingBinding'])
    table,ledger=table_from_evidence(root,inventory,seal['preparationReceipt'],receipt,plan,targets,request,data['contactEvidence'],gb)
    a.check(table==data['predictionTable'] and ledger==data['attempts'],'Prediction-only feature or attempt replay differs')
    expected={'schema':'confovhh-round4-saved-ranks-v1','predictionTableDigest':r.digest(table),'ranks':r.rank(table['rows']),'modelBinding':None,'outcomeInputs':[]}
    a.check(data['ranks']==expected,'Saved source ranks do not replay exactly')
    a.check(seal['evaluationRole']==table['evaluationRole'] and seal['snapshot']==inventory['snapshot'],'Source ranking role/snapshot differs')
    a.check(type(seal['plannedCount']) is int and seal['plannedCount']==len(table['rows']),'Planned ranking count differs')
    a.check(seal['producedCount']==sum(x['producerStatus']=='generated' for x in table['rows']) and seal['sourceAvailableCount']==sum(x['sourceValue'] is not None for x in table['rows']),'Ranking coverage counts differ')
    return table,expected,seal

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['prepare','verify']);p.add_argument('--artifacts',type=Path,default=ROOT)
    p.add_argument('--preparation',type=Path);p.add_argument('--receipt',type=Path);p.add_argument('--output',type=Path);p.add_argument('--grouping',type=Path)
    x=p.parse_args();root=x.artifacts.resolve()
    if x.command=='prepare':seal=prepare(root,a.binding(root,x.preparation.resolve()),x.output,a.binding(root,x.grouping.resolve()) if x.grouping else None)
    else:_,_,seal=verify_source_seal(root,a.binding(root,x.receipt.resolve()))
    print(json.dumps({'status':'PASS','planned':seal['plannedCount'],'produced':seal['producedCount'],'snapshot':seal['snapshot'],'outcomeInputs':[]}))

if __name__=='__main__':main()
