"""Hash-authenticated adapters for saved prediction features and exposed labels.

The round3 importer accepts only the completed 300 now-development-exposed IDs.
Generic row extraction is reusable for subsequent separately authorized cohorts.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import ranker

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
GROUP_SHA='68e5f1de57b3f6a50193e9b4c10b230388d639ca7cd9ddd68f6a19eb18dab270'
COHORTS=('development','prospective') # Both are development-exposed in round4.
V3_FILES={'manifest.json','source-score-receipt.json','source-manifest.json','source-features.json',
          'source-attempts.json','source-ranks.json','features.json','attempts.json','ranks.json',
          'blocks.json','calibrations.json','contact-evidence.json'}
check=ranker.check

def sha(raw):return hashlib.sha256(raw).hexdigest()
def strict_json(raw):
    def pairs(items):
        result={}
        for k,v in items:check(k not in result,'Duplicate JSON key');result[k]=v
        return result
    def invalid(value):raise ValueError('Nonfinite JSON value: '+value)
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=invalid)

def safe(root,relative):
    check(type(relative) is str and relative and '\\' not in relative and not Path(relative).is_absolute() and '..' not in Path(relative).parts,'Unsafe path')
    p=root/relative
    check(p.is_file() and p.resolve()==p and not p.is_symlink(),'Missing/indirect artifact '+relative)
    return p

def binding(root,path):
    p=Path(path);raw=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(raw),'sha256':sha(raw)}

def bound(root,b):
    check(type(b) is dict and set(b)=={'path','bytes','sha256'},'Invalid binding shape')
    raw=safe(root,b['path']).read_bytes()
    check(type(b['bytes']) is int and b['bytes']==len(raw) and b['sha256']==sha(raw),'Artifact binding differs: '+b['path'])
    return raw

def save(path,value):
    path=Path(path).resolve();check(path.is_relative_to(HERE),'Writes restricted to round4-ranking')
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as f:f.write((json.dumps(value,indent=2,allow_nan=False)+'\n').encode())

def old_adapter(root):
    sys.dont_write_bytecode=True
    p=root/'round3-benchmark/outcome-tools/outcome_adapter.py'
    spec=importlib.util.spec_from_file_location('round3_authenticated_outcomes',p);module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module;spec.loader.exec_module(module)
    return module

def qualified_groups(root):
    p=root/'round4-benchmark/development-group-map.json';raw=p.read_bytes()
    check(sha(raw)==GROUP_SHA,'Qualified group map differs; coordinate explicit protocol amendment')
    obj=strict_json(raw)
    check(obj['schema']=='confovhh-round4-development-groups-v1' and obj['evaluationRole']=='development' and obj['status']=='ACCEPTED_FOR_EXPLORATORY_DEVELOPMENT_GROUPED_ANALYSIS','Grouping not accepted for development')
    check(len(obj['sets'])==len({r['setId'] for r in obj['sets']})==12,'Group membership differs')
    return {r['setId']:r['biologicalGroupId'] for r in obj['sets']},binding(root,p)

def optional_scalar(confidence,key,unit=False):
    value=confidence.get(key)
    if value is None:return None
    check(ranker.finite(value) and value>=0 and (not unit or value<=1),'Malformed prediction-confidence feature '+key)
    return value

def normalize_settings(settings):
    """Versioned effective scientific settings; transport/output flags are not regimes.

    Defaults below are the pinned Boltz2 round3 runtime defaults, independently
    checked by the round4 generation runtime probe. They are never outcome-fit.
    """
    fields={
        'recyclingSteps':(('recyclingSteps','recycling_steps'),3),
        'samplingSteps':(('samplingSteps','sampling_steps'),200),
        'diffusionSamples':(('diffusionSamples','diffusion_samples'),1),
        'stepScale':(('stepScale','step_scale'),1.5),
        'precision':(('precision',),'bf16-mixed'),
        'templates':(('templates',),False),'restraints':(('restraints',),False),
        'forcePotentials':(('forcePotentials','use_potentials'),False),
        'maxMsaSequences':(('maxMsaSequences','max_msa_seqs'),8192),
        'subsampleMsa':(('subsampleMsa','subsample_msa'),False),
        'numSubsampledMsa':(('numSubsampledMsa','num_subsampled_msa'),1024),
        'noKernels':(('noKernels','no_kernels'),False),
    }
    ignored={'seeds','seed','write_full_pae','write_full_pde','output_format','num_workers',
             'jobTimeoutSeconds','use_msa_server','max_parallel_samples','cuda_acceleration'}
    allowed=ignored|{k for aliases,_ in fields.values() for k in aliases}
    check(type(settings) is dict and set(settings)<=allowed,'Unrecognized scientific setting requires explicit regime amendment')
    result={'schema':'confovhh-normalized-boltz2-generation-regime-v1'}
    for name,(aliases,default) in fields.items():
        found=[settings[k] for k in aliases if k in settings]
        check(not found or all(type(v) is type(found[0]) and v==found[0] for v in found),'Conflicting setting aliases '+name)
        value=found[0] if found else default
        check(type(value) is type(default) or (type(default) is float and type(value) is int),'Invalid scientific setting type '+name)
        if type(value) in (int,float):check(math.isfinite(value) and value>0,'Invalid scientific setting '+name)
        result[name]=float(value) if type(default) is float else value
    return result

def extract_feature_values(confidence,feature):
    result={k:optional_scalar(confidence,k,True) for k in ranker.CONFIDENCE[:3]}
    ipde=optional_scalar(confidence,'complex_ipde')
    result['log1p_complex_ipde']=None if ipde is None else math.log1p(ipde)
    count=feature['interface']['contactPairCount']
    check(count is None or (type(count) is int and count>=0),'Invalid contact count')
    result['log1p_contact_pairs']=None if count is None else math.log1p(count)
    result['cdr_share']=result['unnumbered_share']=None
    if feature['cdr']['status']=='available':
        c=feature['cdr']['components']
        check(feature['cdr']['numberingStatus']=='numbered' and count and c['contactPairs']==count,'Invalid numbered contact evidence')
        keys=('cdrContactPairs','frameworkContactPairs','unnumberedContactPairs')
        check(all(type(c[k]) is int and c[k]>=0 for k in keys) and sum(c[k] for k in keys)==count,'Contact components differ')
        check(feature['cdr']['paratopeProxyShare']==c['cdrShareOfTotal']==c['cdrContactPairs']/count,'CDR share differs')
        check(c['unnumberedShareOfTotal']==c['unnumberedContactPairs']/count,'Unnumbered share differs')
        result['cdr_share']=c['cdrShareOfTotal'];result['unnumbered_share']=c['unnumberedShareOfTotal']
    return result

def extract_cohort(root,receipt_binding,generation_arm,seed_batch,legacy_role):
    """Prediction-only import. No outcomes or native reference inputs are opened."""
    adapter=old_adapter(root)
    attempts,features,_=adapter.verify_rankings(root,[receipt_binding],legacy_role)
    receipt=strict_json(bound(root,receipt_binding));folder=(root/receipt_binding['path']).parent
    check(set(receipt['files'])==V3_FILES,'Unexpected v3 inventory')
    manifest=strict_json((folder/'manifest.json').read_bytes());source=strict_json((folder/'source-manifest.json').read_bytes())
    directions={r['id']:r['direction'] for r in source['generators']}
    profiles={};provenance={};bindings=[receipt_binding]
    for p in manifest['producerProfiles']:
        b=p['scoreProvenance'];v=strict_json(bound(root,b));bindings.append(b)
        check(v['generatorId']==p['generatorId'] and v['producerVersion']==p['version'] and v['scoreContext']==p['scoreContext'],'Producer profile differs')
        settings=normalize_settings(v['scientificSettings'])
        profiles[p['generatorId']]={'producerVersion':p['version'],'modelSha256':v['modelSha256'],'scoreContext':p['scoreContext'],'generationRegimeSha256':ranker.digest(settings)}
        check(len(v['attempts'])==len({a['id'] for a in v['attempts']}),'Duplicate producer attempt')
        provenance[p['generatorId']]={a['id']:a for a in v['attempts']}
    output=[]
    for a in attempts:
        f=features[a['id']];check((a['id'],a['setId'],a['generatorId'])==(f['id'],f['setId'],f['generatorId']),'Feature identity differs')
        confidence={};source_value=None
        if a['producerScore'] is not None:
            b={k:a['producerScore'][k] for k in ('path','bytes','sha256')};sd=strict_json(bound(root,b));bindings.append(b)
            check(sd['schema']=='confovhh-round3-original-confidence-adapter-v1','Wrong source adapter')
            for k in ('originalConfidence','generationReceipt','rawCoordinate'):
                if sd[k] is not None:bound(root,sd[k]);bindings.append(sd[k])
            gen=strict_json(bound(root,sd['generationReceipt']));pr=provenance[a['generatorId']][a['id']]
            check(gen['jobId']==a['id'] and gen['targetId']==a['setId'],'Raw generation identity differs')
            check(pr['generationReceiptSha256']==sd['generationReceipt']['sha256'],'Generation receipt provenance differs')
            check(gen['plan_sha256']==sd['planSha256'] and gen['input_sha256']==sd['inputSha256'],'Generation input binding differs')
            if sd['originalConfidence'] is not None:
                confidence=strict_json(bound(root,sd['originalConfidence']))
                parent=(root/sd['generationReceipt']['path']).parent
                check(sd['originalConfidence']['path']==str((parent/gen['source_confidence']).relative_to(root)),'Wrong confidence file')
                check(gen['output_hashes'][gen['source_confidence']]==sd['originalConfidence']['sha256'],'Raw confidence not generation bound')
            if sd['rawCoordinate'] is not None:
                check(gen['output_hashes'][gen['coordinate']]==sd['rawCoordinate']['sha256'],'Raw coordinate differs')
                check(pr['coordinateSha256']==f['coordinateSha256'],'Producer scoring-view coordinate differs')
            check(sd['generatorId']==a['generatorId'] and sd['producerVersion']==profiles[a['generatorId']]['producerVersion'] and sd['scoreContext']==profiles[a['generatorId']]['scoreContext'],'Source confidence context differs')
            source_value=sd['confidence_score']
            check(source_value==confidence.get('confidence_score')==f['source']['rawValue'],'Original source scalar differs')
        vals=extract_feature_values(confidence,f)
        output.append({'id':a['id'],'setId':a['setId'],'poolId':a['setId']+'::'+generation_arm+'::'+seed_batch,
                       'generationArm':generation_arm,'seedBatch':seed_batch,'producerStatus':a['status'],
                       'sourceValue':source_value,'sourceDirection':directions[a['generatorId']],
                       'validityStatus':f['validity']['status'],'coordinateSha256':f['coordinateSha256'],
                       'profile':profiles[a['generatorId']],'features':vals})
    ranker.validate_rows(output)
    unique={b['path']:b for b in bindings}
    check(all(unique[b['path']]==b for b in bindings),'Conflicting evidence binding')
    return output,sorted(unique.values(),key=lambda b:b['path'])

def extract_round3(root):
    rows=[];inputs=[]
    for cohort in COHORTS:
        p=root/f'round3-ranking/fresh-v3-{cohort}/receipt.json'
        rr,bb=extract_cohort(root,binding(root,p),'baseline','seeds00-24',cohort)
        rows+=rr;inputs+=bb
    groups,gb=qualified_groups(root);ranker.validate_groups(rows,groups)
    check(len(rows)==300 and all(sum(r['setId']==s for r in rows)==25 for s in groups),'Initial authorized membership differs')
    expected={s+'_seed%02d'%i for s in groups for i in range(25)}
    check({r['id'] for r in rows}==expected,'Unauthorized prediction ID')
    return {'schema':'confovhh-round4-prediction-table-v1','evaluationRole':'development','origin':'round3-now-development-exposed',
            'rows':sorted(rows,key=lambda r:r['id']),'inputBindings':inputs,'groupingBinding':gb,
            'outcomeInputs':[],'featureNames':list(ranker.FEATURES)}

def extract_round3_labels(root,predictions):
    check(predictions['evaluationRole']=='development' and predictions['origin']=='round3-now-development-exposed','Only exposed round3 labels permitted here')
    groups,_=qualified_groups(root);expected={s+'_seed%02d'%i for s in groups for i in range(25)}
    check(len(predictions['rows'])==300 and {r['id'] for r in predictions['rows']}==expected,'Unauthorized label membership')
    adapter=old_adapter(root);labels={};inputs=[];byid={r['id']:r for r in predictions['rows']}
    for cohort in COHORTS:
        b=binding(root,root/f'round3-ranking/fresh-outcomes-{cohort}/receipt.json')
        outcome,_,receipt=adapter.verify_evaluation(root,b);inputs.append(b)
        for r in outcome['rows']:
            check(r['id'] in byid and r['id'] not in labels,'Unauthorized/duplicate outcome')
            p=byid[r['id']];check(p['coordinateSha256']==r['coordinateSha256'] and p['setId']==r['setId'],'Outcome coordinate/target differs')
            labels[r['id']]=r['DockQ'] if r['status']=='evaluated' else None
    ranker.validate_labels(predictions['rows'],labels)
    return {'schema':'confovhh-round4-development-labels-v1','evaluationRole':'development','labels':labels,
            'inputBindings':inputs,'predictionTableDigest':ranker.digest(predictions),'reservedOutcomesRead':False}

def feature_audit(table):
    rows=table['rows'];ranker.validate_rows(rows);contexts={}
    for context in sorted({r['profile']['scoreContext'] for r in rows}):
        rs=[r for r in rows if r['profile']['scoreContext']==context];fields={}
        for k in ranker.FEATURES:
            xx=[r['features'][k] for r in rs if r['features'][k] is not None]
            fields[k]={'available':len(xx),'missing':len(rs)-len(xx),'minimum':min(xx,default=None),'maximum':max(xx,default=None)}
        contexts[context]={'planned':len(rs),'sets':len({r['setId'] for r in rs}),
                           'produced':sum(r['producerStatus']=='generated' for r in rs),'fields':fields}
    return {'schema':'confovhh-round4-prediction-only-availability-v1','planned':len(rows),'contexts':contexts,
            'predictionTableDigest':ranker.digest(table),'outcomeInputs':[],'labelsUsedForFeatureChoice':False}
