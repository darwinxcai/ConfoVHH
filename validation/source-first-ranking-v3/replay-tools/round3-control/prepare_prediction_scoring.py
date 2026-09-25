#!/usr/bin/env python3
"""Prepare and score immutable prediction-only round-3 artifacts.

No reference structure, reference inventory, outcome map or quality label is read.
Final scoring needs a completed generated/failed receipt for every planned job.
Smoke and preparation-only snapshots preserve the whole planned inventory.
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import inspect
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT/'ConfoVHH'
NODE = '/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
COMMIT = 'b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc'
VERSION = '2.2.1+'+COMMIT
CANON = ROOT/'round3-benchmark/scoring-view/canonicalize_view.py'
PROFILES = {'pair':('boltz2-pair','pair-confidence'), 'dimer':('boltz2-dimer','two-receptors-two-Nbs-confidence'), 'helix':('boltz2-helix','receptor-Nb-G11-helix-confidence')}
PREPARATION_VERSION = 3
_canonicalizer = None


class GeometryValidationError(ValueError):
    def __init__(self,message,report):
        super().__init__(message);self.report=report


def check(value,message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def hashfile(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda:handle.read(4*1024*1024),b''):
            h.update(block)
    return h.hexdigest()


def strict_json(raw):
    def unique(pairs):
        out={}
        for key,value in pairs:
            check(key not in out,'Duplicate JSON field')
            out[key]=value
        return out
    def nonfinite(value):
        raise ValueError('Nonfinite JSON token '+value)
    return json.loads(raw,object_pairs_hook=unique,parse_constant=nonfinite)


def sequence_document(raw):
    if raw.lstrip().startswith(b'{'):
        return strict_json(raw)
    import yaml
    class UniqueSafeLoader(yaml.SafeLoader):
        pass
    def mapping(loader,node,deep=False):
        loader.flatten_mapping(node);out={}
        for key_node,value_node in node.value:
            key=loader.construct_object(key_node,deep=deep)
            check(key not in out,'Duplicate YAML field')
            out[key]=loader.construct_object(value_node,deep=deep)
        return out
    UniqueSafeLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,mapping)
    return yaml.load(raw,Loader=UniqueSafeLoader)


def safe_file(root,relative):
    check(type(relative) is str and relative and not Path(relative).is_absolute() and '..' not in Path(relative).parts and '\\' not in relative,'Unsafe artifact path')
    path=root/relative
    check(path.resolve()==path and path.is_file() and not path.is_symlink(),'Missing or indirect artifact: '+relative)
    return path


def binding(root,path):
    path=Path(path)
    check(path.resolve()==path and path.is_file() and path.is_relative_to(root),'Artifact outside execution root or indirect')
    return {'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':hashfile(path)}


def write_json(path,value,reuse=False):
    raw=(json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
    if path.exists():
        check(reuse and path.read_bytes()==raw,'Immutable artifact differs or already exists: '+str(path))
    else:
        path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)
    return sha(raw)


def canonicalizer():
    global _canonicalizer
    if _canonicalizer is None:
        spec=importlib.util.spec_from_file_location('prediction_only_canonicalizer',CANON)
        _canonicalizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(_canonicalizer)
    return _canonicalizer


def classify(target):
    if target['id'] in ('CASR_NB2D11','GRM5_NB43'):
        check(len(target['receptorChains'])==2 and len(target['contextChains'])==1,'Dimer role topology differs')
        return 'dimer'
    if target['id']=='CHRM1_NB1B4':
        check(len(target['receptorChains'])==1 and len(target['contextChains'])==1,'Helix role topology differs')
        return 'helix'
    check(len(target['receptorChains'])==1 and target['contextChains']==[] and target['context']=='pair','Pair role topology differs')
    return 'pair'


def load_plan(root):
    launch=root/'round3-cloud/launch-bundle'; freeze_path=root/'round3-control/EXECUTION-FREEZE.json'
    freeze=strict_json(freeze_path.read_bytes()); plan_path=launch/'batch-plan.json'
    check(hashfile(plan_path)==freeze['files']['batch-plan.json'],'Frozen launch plan hash differs')
    check(hashfile(root/'round3-control/PROTOCOL.md')==freeze['files']['PROTOCOL.md'],'Frozen scientific protocol differs')
    plan=strict_json(plan_path.read_bytes())
    check(plan['schema']=='confovhh-round3-batch-plan-v1' and plan['sourceCommit']==COMMIT and plan['scientific_settings']['seeds']==list(range(25)) and all(type(s) is int for s in plan['scientific_settings']['seeds']),'Plan producer/seeds differ')
    check(plan['native_coordinate_inputs']==[] and plan['planned_attempts']==300 and len(plan['targets'])==12,'Plan enrollment/input isolation differs')
    check(sum(t['split']=='development' for t in plan['targets'])==4 and sum(t['split']=='prospective' for t in plan['targets'])==8,'Plan split membership differs')
    targets={}; sequences={}
    for target in plan['targets']:
        check(target['id'] not in targets,'Duplicate target in frozen plan');targets[target['id']]=target
        input_path=safe_file(launch,target['input'])
        check(hashfile(input_path)==target['input_sha256']==freeze['files'][target['input']],'Launch sequence input hash differs')
        # Accept the frozen JSON/YAML sequence syntax; no reference is consulted.
        value=sequence_document(input_path.read_bytes())
        check(set(value)=={'version','sequences'} and value['version']==1,'Unexpected prediction input fields')
        chains={}
        for item in value['sequences']:
            check(set(item)=={'protein'} and set(item['protein'])=={'id','sequence'},'Only unconstrained protein sequence input is accepted')
            protein=item['protein']; ids=protein['id'] if isinstance(protein['id'],list) else [protein['id']]
            check(type(protein['sequence']) is str and protein['sequence'] and all('A'<=a<='Z' for a in protein['sequence']),'Invalid launch sequence')
            for id_ in ids:
                check(type(id_) is str and id_ not in chains,'Duplicate input chain ID');chains[id_]=protein['sequence']
        role_ids=target['receptorChains']+[target['selectedNb']]+target['contextChains']
        check(len(set(role_ids))==len(role_ids) and set(role_ids)==set(chains),'Launch role inventory differs from protein inputs')
        classify(target)
        sequences[target['id']]=chains
    return plan,targets,sequences,binding(root,plan_path),binding(root,freeze_path)


def expected_command(plan,target,seed):
    root='/workspace/confovhh-round3'
    args=[plan['runtime_cli'],'predict',root+'/'+target['input'],'--out_dir','/tmp/confovhh-round3-work/'+target['id'],'--cache',root+'/cache','--model','boltz2','--devices','1','--accelerator','gpu','--recycling_steps','3','--sampling_steps','200','--diffusion_samples','1','--max_parallel_samples','1','--step_scale','1.5','--seed',str(seed),'--use_msa_server','--output_format','mmcif','--num_workers','0','--override']
    if plan['scientific_settings'].get('no_kernels'):
        args.append('--no_kernels')
    return args


def verify_job(root,job_path,plan,target,seed,plan_binding):
    receipt_path=job_path/'receipt.json'
    if not receipt_path.is_file():
        return None
    receipt=strict_json(safe_file(job_path,'receipt.json').read_bytes())
    job_id=f"{target['id']}_seed{seed:02d}"
    check(receipt['jobId']==job_path.name==job_id and receipt['targetId']==target['id'] and type(receipt['seed']) is int and receipt['seed']==seed,'Generation job identity differs')
    check(receipt['plan_sha256']==plan_binding['sha256'] and receipt['input_sha256']==target['input_sha256'],'Generation plan/input binding differs')
    check(receipt['command']==expected_command(plan,target,seed),'Generation command differs from fixed prediction regime')
    check(receipt['status'] in ('generated','failed'),'Generation receipt is incomplete')
    check(type(receipt['output_hashes']) is dict,'Output bindings absent')
    actual_outputs=set()
    for path in job_path.rglob('*'):
        check(not path.is_symlink(),'Symlink in raw generation output')
        if path.is_file():
            rel=str(path.relative_to(job_path))
            if rel not in ('receipt.json','running.json'):
                actual_outputs.add(rel)
    check(actual_outputs==set(receipt['output_hashes']),'Generation output inventory differs; missing or unlisted file')
    for rel,expected in receipt['output_hashes'].items():
        path=safe_file(job_path,rel)
        check(hashfile(path)==expected,'Generation output digest mismatch: '+rel)
    if receipt['status']=='generated':
        check(type(receipt['exit_code']) is int and receipt['exit_code']==0,'Generated receipt has failed exit')
        check(receipt['coordinate']==f"prediction/{target['id']}_model_0.cif" and receipt['source_confidence']==f"prediction/confidence_{target['id']}_model_0.json",'Unexpected generated coordinate/confidence output')
        check(receipt['coordinate'] in receipt['output_hashes'] and receipt['source_confidence'] in receipt['output_hashes'],'Coordinate/source not bound by generation receipt')
    else:
        check(type(receipt.get('reason')) is str and receipt['reason'],'Failed generation reason missing')
    return receipt


def verify_raw_geometry(raw_path,target,launch_sequences):
    from Bio.Data.PDBData import protein_letters_3to1_extended
    _,_,_,rows,_=canonicalizer().read_atoms(raw_path)
    serials=set(); atoms=set();labels=set();residues=collections.defaultdict(dict)
    for row in rows:
        xyz=[float(row['Cartn_'+axis]) for axis in 'xyz']
        check(all(math.isfinite(x) for x in xyz),'Nonfinite original atom coordinate')
        model=row.get('pdbx_PDB_model_num','1'); serial=(model,row.get('id'))
        check(serial not in serials,'Duplicate original atom IDs');serials.add(serial)
        chain=row['label_asym_id']; pos=row.get('label_seq_id',row.get('auth_seq_id'))
        identity=(model,chain,pos,row.get('pdbx_PDB_ins_code','?'),row['label_atom_id'],row.get('label_alt_id','.'))
        check(identity not in atoms,'Duplicate original atom/residue identities');atoms.add(identity)
        if row.get('group_PDB')=='ATOM' or (str(pos).isdigit() and chain in launch_sequences):
            labels.add(chain)
            pos=int(pos);comp=row['label_comp_id'];key=(pos,row.get('pdbx_PDB_ins_code','?'))
            old=residues[model,chain].setdefault(key,comp)
            check(old==comp,'Conflicting original polymer residue identities')
    check(labels==set(launch_sequences),'Modeled chain inventory differs from launch topology')
    models=sorted({model for model,chain in residues})
    sequence_checks=[]
    for model in models:
        for chain,expected in sorted(launch_sequences.items()):
            observed=''.join(protein_letters_3to1_extended[comp] for _,comp in sorted(residues[model,chain].items()))
            sequence_checks.append({'modelId':model,'chainId':chain,'role':'receptor' if chain in target['receptorChains'] else 'selectedNb' if chain==target['selectedNb'] else 'context',
                                    'inputResidueCount':len(expected),'observedResidueCount':len(observed),'expectedSequenceSha256':sha(expected.encode()),'observedSequenceSha256':sha(observed.encode()),'exactInputSequenceMatch':observed==expected})
    report={'schema':'confovhh-round3-raw-input-integrity-v1','atomCount':len(rows),'allCoordinatesFinite':True,'originalAtomIdsUnique':True,'originalAtomIdentitiesUnique':True,
            'modelIds':models,'allInputChainSequencesMatch':all(row['exactInputSequenceMatch'] for row in sequence_checks),'chainSequenceChecks':sequence_checks,'expectedSequencesSource':'Frozen launch input JSON/YAML only; includes every receptor, selected Nb and context chain'}
    if not report['allInputChainSequencesMatch']:
        raise GeometryValidationError('Raw sequence differs from launch input: '+','.join(r['modelId']+':'+r['chainId'] for r in sequence_checks if not r['exactInputSequenceMatch']),report)
    return report


def verify_canonical_view(root,raw,view,target):
    """Replay the prescribed bijection; identical chains must not mask role swaps.

    Absolute source/output paths in old sidecars are provenance only. Everything
    else, including every atom identity and residue/segment assignment, must agree.
    """
    map_path=view.with_suffix('.mapping.json');receipt_path=view.with_suffix('.receipt.json')
    for path in (view,map_path,receipt_path):
        safe_file(root,str(path.relative_to(root)))
    mapping=strict_json(map_path.read_bytes());record=strict_json(receipt_path.read_bytes())
    roles={'chainNamespace':'label','requestedReceptorChains':target['receptorChains'],'requestedSelectedNb':target['selectedNb'],
           'resolvedReceptorLabelChains':target['receptorChains'],'resolvedSelectedNbLabelChain':target['selectedNb']}
    check(all(mapping.get(key)==value for key,value in roles.items()),'Canonical view role assignment differs from frozen launch plan')
    check(record['sourceSha256']==mapping['sourceSha256']==hashfile(raw) and record['viewSha256']==mapping['outputSha256']==hashfile(view) and record['mapSha256']==hashfile(map_path),'Canonical view/map/source changed')
    with tempfile.TemporaryDirectory(prefix='confovhh-view-replay-') as temporary:
        replay=Path(temporary)/'view.cif'
        replay_record=canonicalizer().canonicalize_view(raw,replay,target['receptorChains'],target['selectedNb'],chain_namespace='label')
        replay_map=strict_json(replay.with_suffix('.mapping.json').read_bytes())
        check(hashfile(replay)==hashfile(view),'Canonical coordinate view differs from prescribed complete-atom replay')
        check({k:v for k,v in mapping.items() if k not in ('source','output')}=={k:v for k,v in replay_map.items() if k not in ('source','output')},'Canonical complete atom/residue identity map differs from prescribed replay')
        # The map digest depends on its original absolute provenance paths.
        omitted={'sourcePath','viewPath','mapPath','mapSha256'}
        check({k:v for k,v in record.items() if k not in omitted}=={k:v for k,v in replay_record.items() if k not in omitted},'Canonical receipt claims differ from prescribed replay')
    return record


def prepare_generated(root,job_path,receipt,target,launch_sequences):
    job_id=receipt['jobId']; raw=safe_file(job_path,receipt['coordinate']); source=safe_file(job_path,receipt['source_confidence'])
    receipt_binding=binding(root,job_path/'receipt.json'); raw_binding=binding(root,raw); source_binding=binding(root,source)
    source_value=None; source_error=''
    try:
        confidence=strict_json(source.read_bytes())['confidence_score']
        check(type(confidence) in (int,float) and math.isfinite(confidence),'Original confidence_score is not finite/nonboolean numeric')
        source_value=confidence
    except (ValueError,KeyError,TypeError) as error:
        source_error=f'{type(error).__name__}: {error}'
    kind=classify(target);generator_id,context=PROFILES[kind]
    adapter={'schema':'confovhh-round3-original-confidence-adapter-v1','confidence_score':source_value,'sourceStatus':'present' if source_error=='' else 'invalid','sourceReason':source_error,
             'originalConfidence':source_binding,'generationReceipt':receipt_binding,'planSha256':receipt['plan_sha256'],'inputSha256':receipt['input_sha256'],
             'rawCoordinate':raw_binding,'generatorId':generator_id,'producerVersion':VERSION,'scoreContext':context,'scientificScalar':'Original full generated-complex confidence_score, unchanged'}
    adapter_path=root/'round3-predictions/source-adapters'/(job_id+'.json');write_json(adapter_path,adapter,reuse=True)
    adapter_binding=binding(root,adapter_path)|{'jsonPointer':'/confidence_score'}
    view=root/'round3-predictions/scoring-views'/(job_id+'.cif'); prep_path=view.with_suffix(f'.preparation-v{PREPARATION_VERSION}.json')
    old_expected={'generationReceiptSha256':receipt_binding['sha256'],'rawCoordinateSha256':raw_binding['sha256'],'sourceAdapterSha256':adapter_binding['sha256'],'canonicalizerSha256':hashfile(CANON),'launchInputSha256':target['input_sha256']}
    expected=old_expected|{'preparationVersion':PREPARATION_VERSION,'prepareScriptSha256':hashfile(Path(__file__).resolve()),'rawValidatorSha256':sha(inspect.getsource(verify_raw_geometry).encode()),'viewValidatorSha256':sha(inspect.getsource(verify_canonical_view).encode())}
    if prep_path.exists():
        previous=strict_json(prep_path.read_bytes())
        check(previous['bindings']==expected,'Immutable preparation identity changed')
        if previous['viewReceipt'] is not None:
            record=previous['viewReceipt']; path=safe_file(root,record['path'])
            check(path.stat().st_size==record['bytes'] and hashfile(path)==record['sha256'],'View receipt changed')
            canonical=strict_json(path.read_bytes())
            safe_file(root,str(view.relative_to(root)));safe_file(root,str(view.with_suffix('.mapping.json').relative_to(root)))
            check(hashfile(view)==canonical['viewSha256'] and hashfile(view.with_suffix('.mapping.json'))==canonical['mapSha256'] and canonical['sourceSha256']==raw_binding['sha256'],'Canonical view/map/source changed')
            verify_canonical_view(root,raw,view,target)
            check(verify_raw_geometry(raw,target,launch_sequences)==previous['rawInputIntegrity'],'Recorded raw input integrity differs')
        return adapter_binding, previous
    existing_record=None
    if view.exists() or view.with_suffix('.receipt.json').exists() or view.with_suffix('.mapping.json').exists():
        for path in (view,view.with_suffix('.receipt.json'),view.with_suffix('.mapping.json')):
            safe_file(root,str(path.relative_to(root)))
        existing_record=strict_json(view.with_suffix('.receipt.json').read_bytes())
        check(hashfile(view)==existing_record['viewSha256'] and hashfile(view.with_suffix('.mapping.json'))==existing_record['mapSha256'] and existing_record['sourceSha256']==raw_binding['sha256'],'Existing canonical view/map/source differs')
        verify_canonical_view(root,raw,view,target)
        for suffix in ('.preparation.json','.preparation-v2.json'):
            legacy=view.with_suffix(suffix)
            if legacy.exists():
                old=strict_json(legacy.read_bytes())
                check(old['bindings']==old_expected and old['viewReceipt']==binding(root,view.with_suffix('.receipt.json')),'Legacy view receipt binding differs')
    error=''; view_binding=None;raw_integrity=None
    try:
        raw_integrity=verify_raw_geometry(raw,target,launch_sequences)
        record=existing_record if existing_record is not None else canonicalizer().canonicalize_view(raw,view,target['receptorChains'],target['selectedNb'],chain_namespace='label')
        if existing_record is None:
            verify_canonical_view(root,raw,view,target)
        check(record['sourceSha256']==raw_binding['sha256'] and record['everyAtomRetained'] is True and record['everyCoordinateTokenIdentical'] is True and record['everyNonidentifierAtomFieldIdentical'] is True,'Coordinate preservation assertion failed')
        check(record['sourceCoordinateTokenSha256']==record['viewCoordinateTokenSha256'] and record['sourceAtoms']==record['viewAtoms'],'Coordinate tokens or atom inventory changed')
        view_binding=binding(root,view.with_suffix('.receipt.json'))
    except (ValueError,KeyError,TypeError,AssertionError,UnicodeError) as exc:
        error=f'{type(exc).__name__}: {exc}'
        raw_integrity=getattr(exc,'report',raw_integrity)
    prepared={'schema':'confovhh-round3-generated-preparation-v3','id':job_id,'setId':target['id'],'seed':receipt['seed'],'bindings':expected,'rawCoordinate':raw_binding,
              'sourceAdapter':adapter_binding,'sourceStatus':adapter['sourceStatus'],'sourceReason':source_error,'geometryStatus':'canonicalized' if view_binding else 'invalid',
              'viewReceipt':view_binding,'canonicalCoordinate':binding(root,view) if view_binding else None,'canonicalMap':binding(root,view.with_suffix('.mapping.json')) if view_binding else None,
              'rawInputIntegrity':raw_integrity,'unavailableReason':error,'launchRoleChainNamespace':'label','referenceInputs':[]}
    write_json(prep_path,prepared)
    return adapter_binding,prepared


def build_provenance(root,plan,plan_binding,freeze_binding,kind,attempts,ledger,smoke):
    generator_id,context=PROFILES[kind]
    dev_pair=kind=='pair' and all(row['setId'].startswith('dev_') for row in attempts) and len(attempts)==100 and not smoke
    common={'schema':'confovhh-round3-pair-producer-provenance-v1' if dev_pair else 'confovhh-round3-prediction-producer-provenance-v1',
            'generatorId':generator_id,'producerVersion':VERSION,'scoreContext':context,'scoreName':'confidence_score','direction':'higher-better','packageVersion':'2.2.1','sourceCommit':COMMIT,
            'modelSha256':next(m['sha256'] for m in plan['model_hashes'] if m['path']=='cache/boltz2_conf.ckpt'),'contextRegime':kind,
            'scientificSettings':{'recyclingSteps':3,'samplingSteps':200,'diffusionSamples':1,'stepScale':1.5,'seeds':list(range(25)),'precision':'bf16-mixed','templates':False,'restraints':False,'forcePotentials':False},
            'generationRunId':'round3-'+plan_binding['sha256'][:16],'executionFreezeSha256':freeze_binding['sha256'],
            'attempts':[{'id':a['id'],'setId':a['setId'],'seed':ledger[a['id']]['seed'],'generationReceiptSha256':ledger[a['id']]['generationReceipt']['sha256'] if ledger[a['id']]['generationReceipt'] else None,'coordinateSha256':a['coordinate']['sha256'] if a['coordinate'] else None} for a in attempts]}
    return common


def prepare(root,cohort,prefix,smoke=False,prepare_only=False,calibration_path=None,node=NODE):
    root=Path(root).resolve(); plan,targets,sequences,plan_binding,freeze_binding=load_plan(root)
    check(cohort in ('development','prospective'),'Invalid cohort')
    check(prefix and len(prefix)<40 and all(c.isalnum() or c in '-_' for c in prefix),'Unsafe output prefix')
    check(not smoke or prefix.startswith('smoke-'),'Smoke outputs must have a separate smoke- prefix')
    check(cohort=='prospective' or calibration_path is None,'Development preparation must remain uncalibrated')
    selected=sorted((t for t in targets.values() if t['split']==cohort),key=lambda t:t['id'])
    raw_root=root/'round3-predictions/raw/results'; jobs=[]
    for target in selected:
        for seed in range(25):
            job_id=f"{target['id']}_seed{seed:02d}"; path=raw_root/job_id
            record=verify_job(root,path,plan,target,seed,plan_binding)
            jobs.append((target,seed,path,record))
    expected_count=100 if cohort=='development' else 200
    check(len(jobs)==expected_count,'Cohort planned membership differs')
    missing=[path.name for target,seed,path,record in jobs if record is None]
    check(smoke or prepare_only or not missing,f'Final scoring refuses incomplete {cohort}: {len(missing)}/{expected_count} receipts absent; use a separate smoke or preparation-only snapshot')
    prep_dir=root/'round3-ranking'/f'{prefix}-preparation-{cohort}'
    v1_dir=root/'round3-ranking'/f'{prefix}-v1-{cohort}';v3_dir=root/'round3-ranking'/f'{prefix}-v3-{cohort}'
    check(not prep_dir.exists() and not v1_dir.exists() and not v3_dir.exists(),'Immutable preparation/scoring output already exists')
    prep_dir.mkdir(parents=True,exist_ok=False)
    manifest={'schema':'confovhh-external-development-input-v1','studyId':f'round3-{cohort}-{prefix}','generators':[],'sets':[],'attempts':[]}
    ledger={};view_rows=[];set_policies=[];kinds=set()
    for target in selected:
        kind=classify(target);kinds.add(kind)
        manifest['sets'].append({'id':target['id'],'receptorChain':'R','vhhChain':'V','selectedModelId':'1'})
        chains=sequences[target['id']]
        set_policies.append({'setId':target['id'],'biologicalGroupId':target['group'],'receptorSequenceSha256':sha(''.join(chains[c] for c in target['receptorChains']).encode()),'vhhSequenceSha256':sha(chains[target['selectedNb']].encode())})
    for kind in sorted(kinds):
        manifest['generators'].append({'id':PROFILES[kind][0],'scoreName':'confidence_score','direction':'higher-better'})
    for target,seed,path,record in jobs:
        job_id=path.name;kind=classify(target);status=record['status'] if record else 'not-run'
        reason=record.get('reason','') if record else 'No immutable completed generation receipt was available in this snapshot'
        attempt={'id':job_id,'setId':target['id'],'generatorId':PROFILES[kind][0],'status':status,'reason':reason if status!='generated' else '', 'coordinate':None,'producerScore':None}
        entry={'id':job_id,'setId':target['id'],'seed':seed,'status':status,'reason':reason,'generationReceipt':binding(root,path/'receipt.json') if record else None,
               'rawCoordinate':None,'sourceAdapter':None,'geometryStatus':'not-produced','viewReceipt':None,'unavailableReason':reason}
        if record and status=='generated':
            adapter,prepared=prepare_generated(root,path,record,target,sequences[target['id']]);attempt['producerScore']=adapter
            entry.update({k:prepared[k] for k in ('rawCoordinate','sourceAdapter','geometryStatus','viewReceipt','canonicalCoordinate','canonicalMap','rawInputIntegrity','unavailableReason','sourceStatus','sourceReason')})
            entry['preparationReceipt']=binding(root,root/'round3-predictions/scoring-views'/(job_id+f'.preparation-v{PREPARATION_VERSION}.json'))
            if prepared['viewReceipt']:
                attempt['coordinate']=binding(root,root/'round3-predictions/scoring-views'/(job_id+'.cif'))|{'format':'mmcif'}
        manifest['attempts'].append(attempt);ledger[job_id]=entry
        view_rows.append({'id':job_id,'setId':target['id'],'seed':seed,'viewReceipt':entry['viewReceipt'],'unavailableReason':entry['unavailableReason']})
    manifest_path=prep_dir/'v1-manifest.json';write_json(manifest_path,manifest)
    write_json(prep_dir/'preparation-ledger.json',list(ledger.values()))
    write_json(prep_dir/'prediction-view-inventory.json',{'schema':'confovhh-round3-prediction-view-inventory-v1','cohort':cohort,'smoke':smoke,'rows':view_rows})
    profiles=[]
    for kind in sorted(kinds):
        attempts=[a for a in manifest['attempts'] if a['generatorId']==PROFILES[kind][0]]
        provenance=build_provenance(root,plan,plan_binding,freeze_binding,kind,attempts,ledger,smoke)
        prov_path=prep_dir/f'producer-provenance-{PROFILES[kind][0]}.json';write_json(prov_path,provenance)
        calibration=None
        if kind=='pair' and calibration_path is not None:
            calibration=binding(root,Path(calibration_path).resolve())
        profiles.append({'generatorId':PROFILES[kind][0],'version':VERSION,'scoreContext':PROFILES[kind][1],'scoreProvenance':binding(root,prov_path),'calibration':calibration})
    template={'schema':'confovhh-source-first-input-v3','studyId':manifest['studyId'],'evaluationRole':'development' if cohort=='development' else 'sealed-validation','sourceScoreReceipt':None,'producerProfiles':profiles,'setPolicies':set_policies}
    write_json(prep_dir/'v3-input-template.json',template)
    summary={'schema':'confovhh-round3-prediction-preparation-receipt-v1','preparedAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'cohort':cohort,'smoke':smoke,'prepareOnly':prepare_only,'plannedCount':expected_count,
             'completedGenerationReceipts':expected_count-len(missing),'generationStatusCounts':dict(collections.Counter(a['status'] for a in manifest['attempts'])),
             'canonicalViewCount':sum(r['viewReceipt'] is not None for r in view_rows),'invalidGeometryIds':[r['id'] for r in ledger.values() if r['geometryStatus']=='invalid'],
             'sourceUnavailableIds':[r['id'] for r in ledger.values() if r.get('sourceStatus')=='invalid'],'absentGenerationIds':missing,
             'plan':plan_binding,'executionFreeze':freeze_binding,'launchRoleExpectations':'SHA256 of launch input sequence text, receptor chains concatenated in declared order; no reference or coordinate-derived expected sequence',
             'implementation':{'prepareScriptSha256':hashfile(Path(__file__).resolve()),'canonicalizerSha256':hashfile(CANON)},'referenceInputs':[],'outcomeInputs':[],
             'calibrationAppliedToPair':calibration_path is not None,'productionDefaultChanged':False,'files':{p.name:hashfile(p) for p in prep_dir.iterdir() if p.is_file()}}
    write_json(prep_dir/'preparation-receipt.json',summary)
    if not prepare_only:
        env={k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH')}
        for command,log in [([node,str(REPO/'scripts/external-ranking/score.mjs'),'--manifest',str(manifest_path),'--artifacts',str(root),'--output',str(v1_dir)],prep_dir/'v1-score.log')]:
            with log.open('x') as handle:
                subprocess.run(command,stdout=handle,stderr=subprocess.STDOUT,env=env,check=True)
        actual={**template,'sourceScoreReceipt':binding(root,v1_dir/'receipt.json')};write_json(prep_dir/'v3-input.json',actual)
        with (prep_dir/'v3-score.log').open('x') as handle:
            subprocess.run([node,str(REPO/'scripts/external-ranking-v3/score.mjs'),'--input',str(prep_dir/'v3-input.json'),'--artifacts',str(root),'--output',str(v3_dir)],stdout=handle,stderr=subprocess.STDOUT,env=env,check=True)
        scoring={'schema':'confovhh-round3-prediction-scoring-receipt-v1','cohort':cohort,'smoke':smoke,'plannedCount':expected_count,'preparationReceipt':binding(root,prep_dir/'preparation-receipt.json'),
                 'v1Receipt':binding(root,v1_dir/'receipt.json'),'v3Receipt':binding(root,v3_dir/'receipt.json'),'predictionViewInventory':binding(root,prep_dir/'prediction-view-inventory.json'),'v3Input':binding(root,prep_dir/'v3-input.json'),
                 'referenceInputs':[],'outcomeInputs':[],'productionDefaultChanged':False}
        write_json(prep_dir/'scoring-receipt.json',scoring)
    return summary,prep_dir,v1_dir if not prepare_only else None,v3_dir if not prepare_only else None


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cohort',choices=['development','prospective'],required=True)
    parser.add_argument('--artifacts',type=Path,default=ROOT);parser.add_argument('--prefix');parser.add_argument('--smoke',action='store_true');parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--calibration',type=Path);parser.add_argument('--node',default=NODE)
    args=parser.parse_args();prefix=args.prefix or ('smoke-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S') if args.smoke else 'prepared-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S') if args.prepare_only else 'fresh')
    summary,prep,v1,v3=prepare(args.artifacts,args.cohort,prefix,args.smoke,args.prepare_only,args.calibration,args.node)
    print(json.dumps({'preparation':str(prep),'v1':str(v1) if v1 else None,'v3':str(v3) if v3 else None,'plannedCount':summary['plannedCount'],'completedGenerationReceipts':summary['completedGenerationReceipts'],'canonicalViewCount':summary['canonicalViewCount'],'invalidGeometryIds':summary['invalidGeometryIds'],'smoke':args.smoke}))
