"""Released, authenticated old300 + new900 development join; never fits a model."""
from __future__ import annotations
import argparse
from collections import Counter
import copy
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import artifacts as a
import ranker as r
import run as runner
import prepare_features as features

ROOT=HERE.parent
OLD_RELEASE_SHA='e9f27baecbceab7ea6b59269690212f15c8390bf2fab33c6568fd95c47b7bc12'
OUTCOME_FREEZE_SHA='190329a887cb579c35f76f0a3c780fc35964d6a330e52e693d3f5bcfd05dde15'
FEATURE_FREEZE_SHA='b0d59c38d86e5e3ebecc1cefba3b9ca4ad15d49d9c5f68ea8ded2cb9956eb685'
COHORT_SHA='a4191a9499ce45848c2a03a4a4920c5d54c4212b7268c46d654d83229f3adc77'
TABLE_KEYS={'schema','evaluationRole','origin','rows','inputBindings','groupingBinding','outcomeInputs','featureNames'}
LABEL_KEYS={'schema','evaluationRole','labels','inputBindings','predictionTableDigest','reservedOutcomesRead'}
JOIN_KEYS={'schema','evaluationRole','authorizeDevelopmentLabelJoin','oldFitRelease','newSourceReceipt','newOutcomeReceipt','implementation'}

def unique_bindings(bindings):
    seen={}
    for binding in bindings:
        a.check(type(binding)is dict and set(binding)=={'path','bytes','sha256'},'Unexpected evidence binding')
        a.check(binding['path'] not in seen or seen[binding['path']]==binding,'Conflicting evidence bindings')
        seen[binding['path']]=binding
    return [seen[name] for name in sorted(seen)]

def implementation(root):
    feat=a.strict_json((HERE/'FEATURE-ADAPTER-FREEZE.json').read_bytes())
    a.check(a.sha((HERE/'FEATURE-ADAPTER-FREEZE.json').read_bytes())==FEATURE_FREEZE_SHA,'Feature adapter freeze changed')
    a.check(feat['implementation']==features.implementation(root),'Frozen feature implementation changed')
    path=root/'round4-outcomes/IMPLEMENTATION-FREEZE.json';raw=path.read_bytes()
    a.check(a.sha(raw)==OUTCOME_FREEZE_SHA,'Outcome implementation freeze changed')
    outcome=a.strict_json(raw)
    for binding in outcome['files']:a.bound(root,binding)
    return {'joinAdapterSha256':a.sha(Path(__file__).read_bytes()),'ranker':runner.implementation(),
            'featureFreezeSha256':FEATURE_FREEZE_SHA,'outcomeFreezeSha256':OUTCOME_FREEZE_SHA,
            'outcomeAdapterSha256':outcome['implementation']['adapterSha256']}

def old_release_binding(root):
    binding=a.binding(root,HERE/'fit-release-v2.authorized.json')
    a.check(binding['sha256']==OLD_RELEASE_SHA,'Frozen old300 fit release changed')
    return binding

def proposed_join(root,source_path,outcome_path):
    # This merely binds the named receipts. It does not inspect outcome values.
    return {'schema':'confovhh-round4-combined-development-join-release-v1','evaluationRole':'development',
            'authorizeDevelopmentLabelJoin':False,'oldFitRelease':old_release_binding(root),
            'newSourceReceipt':a.binding(root,source_path),'newOutcomeReceipt':a.binding(root,outcome_path),
            'implementation':implementation(root)}

def validate_join_release(root,release):
    a.check(type(release)is dict and set(release)==JOIN_KEYS,'Invalid combined-development join release')
    a.check(release['schema']=='confovhh-round4-combined-development-join-release-v1' and release['evaluationRole']=='development'
            and release['authorizeDevelopmentLabelJoin'] is True,'Actual development label join lacks explicit parent release')
    a.check(release['implementation']==implementation(root),'Join implementation differs from release')
    a.check(release['oldFitRelease']==old_release_binding(root),'Old300 evidence differs from frozen release')
    for name in ('oldFitRelease','newSourceReceipt','newOutcomeReceipt'):a.bound(root,release[name])

def check_table(table,groups):
    a.check(type(table)is dict and set(table)==TABLE_KEYS,'Unexpected prediction table fields')
    a.check(table['schema']=='confovhh-round4-prediction-table-v1' and table['evaluationRole']=='development'
            and table['outcomeInputs']==[] and table['featureNames']==list(r.FEATURES),'Invalid development prediction table')
    r.validate_rows(table['rows']);r.validate_groups(table['rows'],groups)

def validate_layout(old,new,attempts,groups):
    check_table(old,groups);check_table(new,groups)
    a.check(len(groups)==12 and len(set(groups.values()))==11,'Expected twelve development sets and eleven groups')
    a.check(old['groupingBinding']==new['groupingBinding'],'Old/new biological grouping differs')
    expected_old={f'{s}_seed{i:02d}' for s in groups for i in range(25)}
    expected_new={f'{s}__{arm}__seed{i:02d}' for s in groups for arm in ('baseline','broader','msa1024') for i in range(25,50)}
    a.check(len(old['rows'])==300 and {x['id'] for x in old['rows']}==expected_old,'Old300 planned membership differs')
    a.check(len(new['rows'])==900 and {x['id'] for x in new['rows']}==expected_new,'New900 planned membership differs')
    a.check(len(attempts)==900 and len({x['id'] for x in attempts})==900 and {x['id'] for x in attempts}==expected_new,'New attempt ledger membership differs')
    ledger={x['id']:x for x in attempts};old_profiles={}
    for row in old['rows']:
        a.check(row['generationArm']=='baseline' and row['seedBatch']=='seeds00-24' and row['poolId']==row['setId']+'::baseline::seeds00-24','Old seed-batch/arm/pool differs')
        a.check(row['setId'] not in old_profiles or row['profile']==old_profiles[row['setId']],'Old baseline profile varies within target')
        old_profiles[row['setId']]=row['profile']
    batch='seeds-'+','.join(map(str,range(25,50)))
    for row in new['rows']:
        attempt=ledger[row['id']]
        a.check(row['producerStatus']!='not-run','Final new cohort still contains a not-run attempt')
        a.check(row['id']==f"{row['setId']}__{row['generationArm']}__seed{attempt['seed']:02d}",'New attempt seed/identity differs')
        a.check(attempt['setId']==row['setId'] and attempt['generationArm']==row['generationArm'] and attempt['producerStatus']==row['producerStatus'],'New ledger pool/production differs')
        a.check(row['seedBatch']==batch and row['poolId']==row['setId']+'::'+row['generationArm']+'::'+batch,'New seed-batch/pool differs')
        baseline=old_profiles[row['setId']]
        a.check(all(row['profile'][k]==baseline[k] for k in ('producerVersion','modelSha256','scoreContext')),'Old/new producer/model/context differs')
        if row['generationArm']=='baseline':a.check(row['profile']==baseline,'Normalized old/new baseline regimes differ')
        else:a.check(row['profile']['generationRegimeSha256']!=baseline['generationRegimeSha256'],'Alternate generation regime silently became baseline')
    r.pool_weights(old['rows']+new['rows'],groups)
    return ledger

def combine_payloads(old,old_labels,new,outcome,attempts,groups,prediction_bindings,label_bindings):
    """Pure membership/identity join. Synthetic fixtures can exercise all branches."""
    ledger=validate_layout(old,new,attempts,groups)
    a.check(type(old_labels)is dict and set(old_labels)==LABEL_KEYS and old_labels['schema']=='confovhh-round4-development-labels-v1'
            and old_labels['evaluationRole']=='development' and old_labels['reservedOutcomesRead'] is False,'Invalid exposed old labels')
    a.check(old_labels['predictionTableDigest']==r.digest(old),'Old labels belong to different prediction table')
    r.validate_labels(old['rows'],old_labels['labels'])
    a.check(type(outcome)is dict and set(outcome)=={'schema','evaluationRole','cohort','rows'} and outcome['schema']=='confovhh-round4-outcome-map-v1'
            and outcome['evaluationRole']=='development','Reserved or unknown outcomes cannot enter development join')
    a.check(len(outcome['rows'])==900 and len({x['id'] for x in outcome['rows']})==900,'Outcome planned membership differs')
    byid={x['id']:x for x in new['rows']};a.check({x['id'] for x in outcome['rows']}==set(byid),'Outcome IDs differ from source seal')
    labels=dict(old_labels['labels']);dispositions={};missing=[]
    for row in outcome['rows']:
        a.check(set(row)=={'id','setId','generationArm','seedBatch','seed','producerStatus','coordinateSha256','status','DockQ','reason'},'Unexpected outcome row fields')
        prediction=byid[row['id']];attempt=ledger[row['id']]
        a.check(all(row[k]==prediction[k] for k in ('setId','generationArm','seedBatch','coordinateSha256')),'Outcome coordinate or pool mapping differs')
        expected='failed' if row['producerStatus']=='interrupted' else row['producerStatus']
        a.check(expected==prediction['producerStatus'] and row['producerStatus']==attempt['originalProducerStatus'] and type(row['seed'])is int and row['seed']==attempt['seed'],'Outcome generation identity differs')
        y=row['DockQ'];a.check(row['status'] in ('evaluated','unavailable'),'Unknown outcome disposition')
        if row['status']=='evaluated':
            a.check(prediction['producerStatus']=='generated' and r.finite(y) and 0<=y<=1 and row['reason']=='','Invalid evaluated outcome')
        else:
            a.check(y is None and type(row['reason'])is str and row['reason'],'Unavailable outcome lacks an explicit reason')
            if prediction['producerStatus']=='generated':missing.append(row['id'])
        labels[row['id']]=y;dispositions[row['id']]={'status':row['status'],'reason':row['reason']}
    rows=sorted(copy.deepcopy(old['rows']+new['rows']),key=lambda x:x['id'])
    table={'schema':'confovhh-round4-prediction-table-v1','evaluationRole':'development','origin':'round3-plus-round4-development',
           'rows':rows,'inputBindings':unique_bindings(prediction_bindings),'groupingBinding':old['groupingBinding'],
           'outcomeInputs':[],'featureNames':list(r.FEATURES)}
    r.validate_rows(rows);r.validate_groups(rows,groups)
    label_record={'schema':'confovhh-round4-development-labels-v1','evaluationRole':'development',
                  'labels':dict(sorted(labels.items())),'inputBindings':unique_bindings(label_bindings),
                  'predictionTableDigest':r.digest(table),'reservedOutcomesRead':False}
    status={'schema':'confovhh-round4-combined-development-status-v1','status':'READY_FOR_SEPARATE_FIT_RELEASE' if not missing else 'INCOMPLETE_GENERATED_OUTCOMES',
            'fitEligible':not missing,'planned':1200,'oldPlanned':300,'newPlanned':900,'sets':len(groups),'groups':len(set(groups.values())),
            'produced':sum(x['producerStatus']=='generated' for x in rows),'nonproduced':sum(x['producerStatus']!='generated' for x in rows),
            'generatedOutcomesUnavailable':sorted(missing),'producedSourceMissing':sorted(x['id'] for x in rows if x['producerStatus']=='generated' and x['sourceValue'] is None),
            'poolCount':len(r.by_pool(rows)),'newOutcomeDispositions':dispositions,'allPlannedRowsRetained':True,
            'modelsFit':0,'reservedOutcomesRead':False,'rulesChanged':False}
    if not missing:r.validate_labels(rows,labels)
    return table,label_record,status

def outcome_module(root):
    folder=root/'round4-outcomes';sys.path.insert(0,str(folder))
    spec=importlib.util.spec_from_file_location('round4_join_authenticated_outcomes',folder/'outcome_adapter.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module

def authenticated_payloads(root,release,release_binding):
    validate_join_release(root,release) # Must precede any new outcome access.
    old_release=a.strict_json(a.bound(root,release['oldFitRelease']))
    old,old_labels,groups=runner.validate_release(root,old_release)
    a.check(a.extract_round3(root)==old,'Frozen old300 predictions did not replay')
    replayed=a.extract_round3_labels(root,old);a.check(replayed['labels']==old_labels['labels'],'Frozen old300 labels did not replay')
    new,saved,source=features.verify_source_seal(root,release['newSourceReceipt'])
    a.check(source['evaluationRole']=='development' and source['snapshot'] is False and source['plannedCount']==900,'Only final complete new900 source seal may join')
    prep=a.strict_json(a.bound(root,source['preparationReceipt']));a.check(prep['cohort']['sha256']==COHORT_SHA,'Unapproved new development cohort')
    attempts=a.strict_json(a.bound(root,source['attempts']))
    module=outcome_module(root);outcome,receipt=module.verify_evaluation(root,release['newOutcomeReceipt'])
    request=a.strict_json(a.bound(root,receipt['request']))
    a.check(request['sourceRankingReceipt']==release['newSourceReceipt'] and request['preparationReceipt']==source['preparationReceipt'],'Outcome did not seal the supplied source predictions')
    a.check(outcome['cohort']==prep['cohort'],'Outcome/source cohort differs')
    prediction_bindings=old['inputBindings']+new['inputBindings']+[old_release['predictionTable'],source['predictionTable'],release['newSourceReceipt']]
    label_bindings=old_labels['inputBindings']+[old_release['labels'],release['oldFitRelease'],release['newOutcomeReceipt'],release_binding]
    return combine_payloads(old,old_labels,new,outcome,attempts,groups,prediction_bindings,label_bindings)

def combine(root,release_path,output):
    output=Path(output).resolve();a.check(output.is_relative_to(HERE) and not output.exists(),'Combined output must be a new directory under round4-ranking')
    release_binding=a.binding(root,release_path);release=a.strict_json(a.bound(root,release_binding))
    table,labels,status=authenticated_payloads(root,release,release_binding)
    output.mkdir(parents=True)
    for name,value in [('predictions.json',table),('labels.json',labels),('join-status.json',status)]:a.save(output/name,value)
    proposal=None
    if status['fitEligible']:
        proposal=runner.proposed_release(root,output/'predictions.json',output/'labels.json');a.save(output/'fit-release.proposed.json',proposal)
    files=[a.binding(root,output/name) for name in ('predictions.json','labels.json','join-status.json')]
    if proposal is not None:files.append(a.binding(root,output/'fit-release.proposed.json'))
    receipt={'schema':'confovhh-round4-combined-development-join-receipt-v1','status':status['status'],'joinRelease':release_binding,
             'implementation':implementation(root),'files':files,'planned':1200,'fitEligible':status['fitEligible'],
             'fitReleaseProposed':proposal is not None,'fitAuthorized':False,'modelsFit':0,'reservedOutcomesRead':False}
    a.save(output/'receipt.json',receipt);return receipt

def verify_combination(root,receipt_binding):
    receipt=a.strict_json(a.bound(root,receipt_binding))
    a.check(set(receipt)=={'schema','status','joinRelease','implementation','files','planned','fitEligible','fitReleaseProposed','fitAuthorized','modelsFit','reservedOutcomesRead'}
            and receipt['schema']=='confovhh-round4-combined-development-join-receipt-v1','Invalid combined receipt')
    a.check(receipt['implementation']==implementation(root) and receipt['fitAuthorized'] is False and receipt['modelsFit']==0 and receipt['reservedOutcomesRead'] is False,'Combined implementation/scope differs')
    release=a.strict_json(a.bound(root,receipt['joinRelease']))
    table,labels,status=authenticated_payloads(root,release,receipt['joinRelease'])
    folder=(root/receipt_binding['path']).parent;expected={'predictions.json':table,'labels.json':labels,'join-status.json':status}
    if status['fitEligible']:expected['fit-release.proposed.json']=runner.proposed_release(root,folder/'predictions.json',folder/'labels.json')
    a.check(len(receipt['files'])==len(expected) and {b['path'] for b in receipt['files']}=={str((folder/name).relative_to(root)) for name in expected},'Combined artifact membership differs')
    for name,value in expected.items():
        binding=next(b for b in receipt['files'] if b['path']==str((folder/name).relative_to(root)))
        a.check(a.strict_json(a.bound(root,binding))==value,'Combined join did not replay: '+name)
    a.check(receipt['status']==status['status'] and receipt['planned']==1200 and receipt['fitEligible'] is status['fitEligible'] and receipt['fitReleaseProposed'] is status['fitEligible'],'Combined completeness differs')
    return receipt

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['propose-join','combine','verify'])
    parser.add_argument('--artifacts',type=Path,default=ROOT);parser.add_argument('--source',type=Path);parser.add_argument('--outcomes',type=Path)
    parser.add_argument('--release',type=Path);parser.add_argument('--receipt',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();root=args.artifacts.resolve()
    if args.command=='propose-join':result=proposed_join(root,args.source.resolve(),args.outcomes.resolve());a.save(args.output,result)
    elif args.command=='combine':result=combine(root,args.release.resolve(),args.output)
    else:result=verify_combination(root,a.binding(root,args.receipt.resolve()))
    print({'status':result.get('status','PROPOSED_NOT_AUTHORIZED'),'output':str(args.output),'modelsFit':0})

if __name__=='__main__':main()
