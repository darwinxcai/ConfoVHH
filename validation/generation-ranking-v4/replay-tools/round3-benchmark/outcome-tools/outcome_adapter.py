#!/usr/bin/env python3
"""Authenticated, segment-preserving DockQ 2.1.3 outcome adapter.

seal verifies prediction-only rankings and all reference identities without scoring.
evaluate consumes that immutable seal. Prospective evaluation additionally requires
a root-issued release. All file paths are execution-root-relative bindings.
"""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parents[1]
PROTOCOL_SHA = '9cf1b2444c67dbaccbe3c8a8c826e980ac4877d790f955d6ab6b9233d03680b5'
REFERENCE_SHA = 'a7b197c0393462809792f9cf00eef01231c32932d5c53b07f0c9375c30e796b0'
V3_FILES = {'manifest.json','source-score-receipt.json','source-manifest.json','source-features.json','source-attempts.json','source-ranks.json','features.json','attempts.json','ranks.json','blocks.json','calibrations.json','contact-evidence.json'}
REQUEST_KEYS = {'schema','evaluationRole','executionFreeze','batchPlan','producerProvenance','rankingReceipts','predictionViews','referenceInventory'}
TIMEOUT = 600

def check(value, message):
    if not value: raise ValueError(message)

def exact(value, keys):
    check(type(value) is dict and set(value)==set(keys), 'Unexpected/missing fields: '+str(set(value) if isinstance(value,dict) else type(value)))

def sha(raw): return hashlib.sha256(raw).hexdigest()
def packed(value): return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(value): return type(value) is str and bool(re.fullmatch('[0-9a-f]{64}',value))
def finite(value): return type(value) in (int,float) and math.isfinite(value)
def now(): return dt.datetime.now(dt.timezone.utc).isoformat()

def node_binary():
    candidate=os.environ.get('CONFOVHH_NODE_BINARY') or shutil.which('node') or '/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    path=Path(candidate).resolve()
    check(path.is_file() and os.access(path,os.X_OK),'Node is required for exact contact-evidence/rank authentication; set CONFOVHH_NODE_BINARY')
    check(not os.environ.get('NODE_OPTIONS') and not os.environ.get('NODE_PATH'),'Ambient Node injection must be absent')
    return str(path)

def strict_json(raw):
    def unique(pairs):
        output={}
        for k,v in pairs:
            check(k not in output,'Duplicate JSON key'); output[k]=v
        return output
    def reject(value): raise ValueError('Nonfinite JSON constant: '+value)
    return json.loads(raw,object_pairs_hook=unique,parse_constant=reject)

def safe_path(root, relative):
    check(type(relative) is str and relative and '\\' not in relative and not Path(relative).is_absolute() and '..' not in Path(relative).parts, 'Unsafe artifact path')
    path=root/relative
    check(path.resolve()==path and path.is_file() and not path.is_symlink(),'Missing/indirect artifact: '+relative)
    return path

def bound(root, binding):
    exact(binding,['path','bytes','sha256'])
    check(type(binding['bytes']) is int and 0<binding['bytes']<=256_000_000 and digest(binding['sha256']),'Invalid artifact binding')
    path=safe_path(root,binding['path']); raw=path.read_bytes()
    check(len(raw)==binding['bytes'] and sha(raw)==binding['sha256'],'Artifact identity differs: '+binding['path'])
    return raw

def binding(root,path):
    path=Path(path); raw=path.read_bytes()
    return {'path':str(path.relative_to(root)),'bytes':len(raw),'sha256':sha(raw)}

def save(path,value):
    raw=(json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
    with path.open('xb') as f: f.write(raw)
    return sha(raw)

def canonical_module(root):
    path=root/'round3-benchmark/scoring-view/canonicalize_view.py'
    spec=importlib.util.spec_from_file_location('outcome_canonical',path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

def relocated(root, original):
    """Absolute receipt paths are provenance only; resolve suffix in current root."""
    p=Path(original)
    if not p.is_absolute(): return safe_path(root,original)
    matches=[i for i,v in enumerate(p.parts) if v=='execution-20260924']
    check(len(matches)==1,'Cannot map original receipt path to execution root')
    return safe_path(root,str(Path(*p.parts[matches[0]+1:])))

def verify_view(root, coordinate, receipt_binding, receptors, nb, namespace):
    raw=bound(root,coordinate); receipt=strict_json(bound(root,receipt_binding))
    check(receipt['schema']=='confovhh-bijective-virtual-view-receipt-v1','Invalid canonical receipt')
    path=safe_path(root,coordinate['path'])
    check(relocated(root,receipt['viewPath'])==path and receipt['viewSha256']==sha(raw),'Canonical coordinate differs')
    source=relocated(root,receipt['sourcePath']); mapping_path=path.with_suffix('.mapping.json')
    check(relocated(root,receipt['mapPath'])==mapping_path,'Mapping path differs')
    source_raw=source.read_bytes(); map_raw=safe_path(root,str(mapping_path.relative_to(root))).read_bytes()
    check(sha(source_raw)==receipt['sourceSha256'] and sha(map_raw)==receipt['mapSha256'],'Raw coordinate/map hash differs')
    mapping=strict_json(map_raw)
    check(mapping['schema']=='confovhh-bijective-virtual-view-map-v1' and mapping['sourceSha256']==sha(source_raw) and mapping['outputSha256']==sha(raw),'Mapping coordinate identity differs')
    check(mapping['requestedReceptorChains']==receptors and mapping['requestedSelectedNb']==nb and mapping['chainNamespace']==namespace,'Fixed chain assignment/namespace differs')
    check(all(receipt[k] is True for k in ['everyAtomRetained','everyCoordinateTokenIdentical','everyNonidentifierAtomFieldIdentical','selectedNbFixed']) and receipt['covalentJoinAsserted'] is False,'Canonical preservation flags fail')
    canonical=canonical_module(root)
    # Deterministic replay independently resolves raw author/label chain roles,
    # reconstructs every residue offset/segment/map entry, and checks byte-exact
    # canonical output. Absolute provenance paths are excluded only from the map
    # comparison; no archived receipt or input is edited during relocation.
    with tempfile.TemporaryDirectory(prefix='confovhh-outcome-replay-') as temporary:
        replay_path=Path(temporary)/'view.cif'
        canonical.canonicalize_view(source,replay_path,receptors,nb,namespace)
        replay_mapping=strict_json(replay_path.with_suffix('.mapping.json').read_bytes())
        check(replay_path.read_bytes()==raw,'Canonical deterministic replay differs')
        strip_paths=lambda value:{k:v for k,v in value.items() if k not in ['source','output']}
        check(strip_paths(replay_mapping)==strip_paths(mapping),'Canonical role/residue/segment mapping replay differs')
    _,_,source_cols,original,_=canonical.read_atoms(source)
    _,_,view_cols,view,_=canonical.read_atoms(path)
    check(len(original)==len(view)==len(mapping['atoms'])==receipt['sourceAtoms']==receipt['viewAtoms'],'Atom inventory differs')
    # Canonicalizer adds only identifier defaults; compare every original non-ID field.
    unchanged=[c for c in source_cols if c not in canonical.CHANGED]
    check([[r[c] for c in unchanged] for r in original]==[[r[c] for c in unchanged] for r in view],'Nonidentifier atom fields differ')
    coords=lambda rows:[[r[c] for c in ['Cartn_x','Cartn_y','Cartn_z']] for r in rows]
    check(coords(original)==coords(view),'Coordinate tokens differ')
    coordinate_tokens=sha(packed(coords(view)))
    check(coordinate_tokens==receipt['sourceCoordinateTokenSha256']==receipt['viewCoordinateTokenSha256'],'Coordinate census differs')
    rec_labels=mapping['resolvedReceptorLabelChains']; v_label=mapping['resolvedSelectedNbLabelChain']
    check(len(rec_labels)==len(receptors) and len(set(rec_labels+[v_label]))==len(rec_labels)+1,'Ambiguous chain roles')
    for i,(old,new,atom) in enumerate(zip(original,view,mapping['atoms'])):
        check(atom['sourceRow']==atom['outputRow']==i+1,'Atom map is not bijective')
        for key in canonical.IDENTITY:
            if key in old: check(atom['original'][key]==old[key],'Original atom identity differs')
            check(atom['canonical'][key]==new[key],'Canonical atom identity differs')
        role='R' if old['label_asym_id'] in rec_labels else 'V' if old['label_asym_id']==v_label else None
        check(new['auth_asym_id']==new['label_asym_id'] and (new['auth_asym_id']==role if role else new['auth_asym_id'].startswith('X')),'Selected/context atom reassigned')
        check(all(math.isfinite(float(new[c])) for c in ['Cartn_x','Cartn_y','Cartn_z']),'Nonfinite coordinate')
    check({r['pdbx_PDB_model_num'] for r in view}=={'1'},'Exactly model 1 is required')
    check(mapping['segments']==receipt['segments'],'Segment metadata differs')
    return {'coordinate':coordinate,'viewReceipt':receipt_binding,'source':binding(root,source),'map':binding(root,mapping_path),'mapping':mapping}

def verify_membership(rows, targets):
    check(type(rows) is list and len(rows)==25*len(targets),'Missing planned attempts')
    check(len({r['id'] for r in rows})==len(rows),'Duplicate attempt ID')
    expected={(t,s) for t in targets for s in range(25)}
    got=[]
    for row in rows:
        check(type(row['seed']) is int and row['setId'] in targets and type(row['id']) is str and row['id'].startswith(row['setId']+'_'),'Attempt identity differs')
        check(row['id']==row['setId']+'_seed%02d'%row['seed'],'Attempt ID differs from frozen seed naming')
        got.append((row['setId'],row['seed']))
    check(set(got)==expected and len(set(got))==len(got),'Planned set/seed membership differs')

def implementation(root):
    check(importlib.metadata.version('DockQ')=='2.1.3','DockQ 2.1.3 is required')
    import DockQ.DockQ as dq
    package=Path(dq.__file__).parent
    files={str(p.relative_to(package)):sha(p.read_bytes()) for p in sorted(package.rglob('*')) if p.is_file() and p.suffix in ('.py','.so')}
    method_raw=(root/'round3-benchmark/outcome-tools/METHOD-FREEZE.json').read_bytes(); method=strict_json(method_raw)
    check(sha(method_raw)=='2914ec4b58f128427e3b6ba5f3d28da3dd6ae71770c1e969b350c5b78f383b29','Fixed DockQ method freeze differs')
    source=Path(__file__).read_text(); nodes={n.name:n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)}
    for name,expected in method['functionSourceSha256'].items(): check(sha(ast.get_source_segment(source,nodes[name]).encode())==expected,'Frozen correspondence/metric function differs: '+name)
    check(files==method['DockQFiles'] and importlib.metadata.version('biopython')==method['BioVersion'] and importlib.metadata.version('numpy')==method['numpyVersion'],'Fixed DockQ/array/alignment runtime differs')
    return {'adapterSha256':sha(Path(__file__).read_bytes()),'methodFreezeSha256':sha(method_raw),'canonicalizerSha256':sha((root/'round3-benchmark/scoring-view/canonicalize_view.py').read_bytes()),
            'contactEvidenceVerifierSha256':sha((root/'ConfoVHH/scripts/external-ranking-v3/verify-contact-evidence.mjs').read_bytes()),
            'NodeVerifierVersion':subprocess.run([node_binary(),'--version'],capture_output=True,text=True,check=True).stdout.strip(),
            'DockQVersion':'2.1.3','DockQFiles':files,'BioVersion':importlib.metadata.version('biopython'),'numpyVersion':importlib.metadata.version('numpy'),
            'alignment':'separate ordered receptor segments and fixed VHH; DockQ 5/0/-4/-0.5 sequence scores; first optimum; concat fixed correspondences; unchanged calc_DockQ',
            'perViewTimeoutSeconds':TIMEOUT}

def verify_rankings(root, bindings, role):
    check(type(bindings) is list and bindings,'No ranking receipt supplied')
    attempts=[]; feature_rows=[]; receipts=[]
    ranking_role='development' if role=='development' else 'sealed-validation'
    for item in bindings:
        raw=bound(root,item); receipt=strict_json(raw); receipts.append(sha(raw))
        check(receipt['schema']=='confovhh-source-first-receipt-v3' and receipt['evaluationRole']==ranking_role and receipt['outcomeInputs']==[],'Not sealed prediction-only v3 ranks')
        check(set(receipt['files'])==V3_FILES,'Unexpected v3 file inventory')
        folder=(root/item['path']).parent; data={}
        for name,expected in receipt['files'].items():
            check(Path(name).name==name and digest(expected),'Unsafe ranked file')
            path=safe_path(root,str((folder/name).relative_to(root))); file_raw=path.read_bytes()
            check(sha(file_raw)==expected,'Saved ranking artifact differs: '+name)
            data[name]=strict_json(file_raw)
        for rel,expected in receipt['implementation'].items():
            check(sha(safe_path(root,'ConfoVHH/'+rel).read_bytes())==expected,'Scoring implementation differs')
        source=data['source-score-receipt.json']
        check(source['outcomeInputs']==[] and receipt['sourceScoreReceiptSha256']==receipt['files']['source-score-receipt.json'],'Source ranking receipt differs')
        for name,field in [('manifest','manifestSha256'),('features','featuresSha256'),('attempts','attemptsSha256'),('ranks','ranksSha256')]:
            check(source[field]==receipt['files']['source-'+name+'.json'],'Source saved file differs')
        check(data['manifest.json']['evaluationRole']==ranking_role,'Ranking role differs')
        original_binding=data['manifest.json']['sourceScoreReceipt']
        check(sha(bound(root,original_binding))==receipt['files']['source-score-receipt.json'],'Original source receipt differs')
        source_folder=(root/original_binding['path']).parent
        for rel,expected in source['artifactHashes'].items():
            check(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}/(?:audit|overlaps|execution|attempt)\.json',rel) and digest(expected),'Invalid source artifact')
            check(sha(safe_path(root,str((source_folder/rel).relative_to(root))).read_bytes())==expected,'Source audit identity differs')
        sets=data['source-manifest.json']['sets']
        check(all((s['receptorChain'],s['vhhChain'],s['selectedModelId'])==('R','V','1') for s in sets),'Ranking must use canonical R/V model 1')
        cohort=data['source-manifest.json']['attempts']; features=data['features.json']
        check(len(cohort)==receipt['plannedCount']==len(features),'Ranking attempt count differs')
        check({a['id'] for a in cohort}=={f['id'] for f in features},'Feature membership differs')
        fm={f['id']:f for f in features}
        for a in cohort:
            check(fm[a['id']]['coordinateSha256']==(a['coordinate']['sha256'] if a['coordinate'] else None),'Ranked coordinate hash differs')
            feature=fm[a['id']]; evidence=feature['contactEvidence']
            if evidence is not None:
                exact(evidence,['kind','sha256']);check(digest(evidence['sha256']) and evidence['kind'] in ['full-audit','standalone-contact'],'Invalid contact evidence binding')
                if evidence['kind']=='full-audit': check(evidence['sha256']==feature['sourceAuditSha256']==source['artifactHashes'].get(a['id']+'/audit.json'),'Full-audit contact identity differs')
                else: check(feature['sourceAuditSha256'] is None,'Standalone contact cannot replace a full audit')
            else: check(feature['sourceAuditSha256'] is None,'Bound full audit lost its contact evidence identity')
        # Use the actual JS serializer/validator and frozen contact implementation
        # to authenticate report digests, recompute standalone contacts and replay
        # saved ranks. This helper accepts no outcome inputs.
        verifier=root/'ConfoVHH/scripts/external-ranking-v3/verify-contact-evidence.mjs'
        replay=subprocess.run([node_binary(),str(verifier),'--artifacts',str(root),'--receipt',str(root/item['path'])],capture_output=True,text=True,timeout=600)
        check(replay.returncode==0,'Prediction-only contact/rank replay failed: '+replay.stderr[-2000:])
        replay_result=strict_json(replay.stdout)
        check(replay_result['schema']=='confovhh-saved-contact-replay-v1' and replay_result['savedReceiptSha256']==item['sha256'] and replay_result['plannedCount']==len(cohort) and replay_result['outcomeInputs']==[] and replay_result['savedRanksAndBlocksExact'] is True,'Contact/rank replay attestation differs')
        attempts+=cohort; feature_rows+=features
    check(len({a['id'] for a in attempts})==len(attempts),'Duplicate attempt across ranking receipts')
    return attempts,{f['id']:f for f in feature_rows},receipts

def preflight(root, request):
    """Read-only identity validation, no DockQ calls and no outcome reads."""
    exact(request,REQUEST_KEYS); role=request['evaluationRole']
    check(request['schema']=='confovhh-round3-outcome-input-v1' and role in ['development','prospective'],'Invalid outcome request')
    freeze_raw=bound(root,request['executionFreeze']); freeze=strict_json(freeze_raw)
    check(freeze['files']['PROTOCOL.md']==PROTOCOL_SHA and sha((root/'round3-control/PROTOCOL.md').read_bytes())==PROTOCOL_SHA,'Protocol differs')
    plan_raw=bound(root,request['batchPlan']); plan=strict_json(plan_raw)
    check(sha(plan_raw)==freeze['files']['batch-plan.json'] and plan['protocol_sha256']==PROTOCOL_SHA,'Batch plan differs')
    targets={t['id']:t for t in plan['targets'] if t['split']==role}
    check(len(targets)==(4 if role=='development' else 8),'Wrong target enrollment')
    reference_raw=bound(root,request['referenceInventory']); references=strict_json(reference_raw)
    check(sha(reference_raw)==REFERENCE_SHA and references['schema']=='confovhh-round3-outcome-reference-inventory-v1','Fixed reference inventory differs')
    for b in references['sourceInventories']+[references['canonicalizer']]: bound(root,b)
    rt={t['id']:t for t in references['targets'] if t['evaluationRole']==role}
    check(set(rt)==set(targets),'Reference set membership differs')
    refs={}
    for set_id,t in targets.items():
        row=rt[set_id]
        check(row['predictionReceptorChains']==t['receptorChains'] and row['predictionSelectedNb']==t['selectedNb'],'Reference prediction-side assignment differs')
        expected_count=4 if set_id in ['CASR_NB2D11','GRM5_NB43'] else 1
        check([v['id'] for v in row['views']]==['assignment-%02d'%i for i in range(expected_count)],'Missing fixed native symmetry view')
        refs[set_id]=[{'id':v['id'],**verify_view(root,v['coordinate'],v['viewReceipt'],v['originalAuthReceptorChains'],v['originalAuthSelectedNb'],'auth')} for v in row['views']]
    attempts,features,receipt_hashes=verify_rankings(root,request['rankingReceipts'],role)
    pb=request['producerProvenance']
    if role=='development': check(type(pb) is dict,'Development requires one pair-context provenance binding')
    else: check(type(pb) is list and len(pb)==3,'Prospective requires the three fixed producer-context provenance bindings')
    provenance_raw=[bound(root,b) for b in (pb if isinstance(pb,list) else [pb])]
    provenance_items=[strict_json(raw) for raw in provenance_raw]
    settings={'recyclingSteps':3,'samplingSteps':200,'diffusionSamples':1,'stepScale':1.5,'seeds':list(range(25)),'precision':'bf16-mixed','templates':False,'restraints':False,'forcePotentials':False}
    for item in provenance_items:
        check(item['schema'] in ['confovhh-round3-prediction-producer-provenance-v1','confovhh-round3-pair-producer-provenance-v1'],'Unexpected producer provenance schema')
        check(item['executionFreezeSha256']==sha(freeze_raw) and type(item['generationRunId']) is str and item['generationRunId'],'Generation freeze/run identity differs')
        check(item['packageVersion']=='2.2.1' and item['sourceCommit']==plan['sourceCommit'] and item['modelSha256']==plan['model_hashes'][0]['sha256'] and item['scientificSettings']==settings,'Producer/model/scientific settings differ')
        check(all(type(item['scientificSettings'][k]) is type(v) for k,v in settings.items()) and all(type(s) is int for s in item['scientificSettings']['seeds']),'Scientific setting types differ')
        check(item['scoreName']=='confidence_score' and item['direction']=='higher-better' and item['generatorId']=='boltz2-'+item['contextRegime'],'Producer score identity differs')
        for a in item['attempts']:
            exact(a,['id','setId','seed','generationReceiptSha256','coordinateSha256'])
            check((digest(a['generationReceiptSha256']) or a['generationReceiptSha256'] is None and a['coordinateSha256'] is None) and (a['coordinateSha256'] is None or digest(a['coordinateSha256'])),'Invalid generation or coordinate identity')
    check({p['contextRegime'] for p in provenance_items}==({'pair'} if role=='development' else {'pair','dimer','helix'}),'Producer context inventory differs')
    check(len({p['generationRunId'] for p in provenance_items})==1,'Producer contexts belong to different runs')
    provenance={'generationRunId':provenance_items[0]['generationRunId'],'attempts':[a for p in provenance_items for a in p['attempts']]}
    provenance_sha=sha(provenance_raw[0]) if role=='development' else sha(packed([sha(raw) for raw in provenance_raw]))
    verify_membership(provenance['attempts'],targets)
    produced={a['id']:a for a in provenance['attempts']}
    views_raw=bound(root,request['predictionViews']); views=strict_json(views_raw)
    exact(views,['schema','cohort','smoke','rows'])
    check(views['schema']=='confovhh-round3-prediction-view-inventory-v1' and views['cohort']==role and type(views['smoke']) is bool,'Invalid prediction-view inventory')
    if role=='development' and not views['smoke']:
        check(provenance_items[0]['schema']=='confovhh-round3-pair-producer-provenance-v1','Only final complete development provenance is calibratable')
    if not views['smoke']:
        check(all(digest(a['generationReceiptSha256']) for a in provenance['attempts']),'Final evaluation requires a generation/failure receipt for every planned attempt')
    verify_membership(views['rows'],targets); vm={v['id']:v for v in views['rows']}
    check({a['id'] for a in attempts}==set(produced)==set(vm),'Ranked/produced/view planned IDs differ')
    rows=[]
    for a in sorted(attempts,key=lambda v:v['id']):
        p=produced[a['id']]; v=vm[a['id']]; t=targets[a['setId']]
        exact(v,['id','setId','seed','viewReceipt','unavailableReason'])
        coordinate=a['coordinate']; identity={k:p[k] for k in ['id','setId','seed','coordinateSha256']}
        producer=next(item for item in provenance_items if any(r['id']==a['id'] for r in item['attempts']))
        expected_context='dimer' if len(t['receptorChains'])==2 else 'helix' if t['contextChains'] else 'pair'
        check(a['generatorId']==producer['generatorId'] and producer['contextRegime']==expected_context,'Ranked producer/context differs from fixed target regime')
        check(p['setId']==a['setId']==v['setId'] and p['seed']==v['seed'],'Attempt/set/seed differs')
        check(p['coordinateSha256']==(coordinate['sha256'] if coordinate else None),'Produced/ranked coordinate differs')
        if coordinate: bound(root,{k:coordinate[k] for k in ['path','bytes','sha256']})
        if v['viewReceipt'] is not None:
            check(coordinate is not None and v['unavailableReason']=='','Unexpected canonical-view disposition')
            verified=verify_view(root,{k:coordinate[k] for k in ['path','bytes','sha256']},v['viewReceipt'],t['receptorChains'],t['selectedNb'],'label')
            rows.append({**identity,'view':verified,'unavailableReason':''})
        else:
            check(type(v['unavailableReason']) is str and v['unavailableReason'],'Absent view requires explicit reason')
            check(coordinate is None or features[a['id']]['validity']['status']!='valid','Valid ranked coordinate cannot silently lose its canonical view')
            rows.append({**identity,'view':None,'unavailableReason':v['unavailableReason']})
    return {'role':role,'smoke':views['smoke'],'rows':rows,'references':refs,'rankingReceiptSha256':receipt_hashes,'producerProvenanceSha256':provenance_sha,'generationRunId':provenance['generationRunId']}

def residue_key(residue): return (str(residue.id[1]),residue.id[2].strip() or '?')

def runtime_segments(chain, mapping, role):
    """Reorder only residue traversal, never coordinates; preserve segment membership."""
    original=list(chain.get_residues()); check(len(original)==len(chain.sequence),'Parser residue/sequence length differs')
    letters={id(r):aa for r,aa in zip(original,chain.sequence)}
    expected={}
    for row in mapping['residues']:
        if row['canonicalChain']==role:
            key=(row['canonicalResidueId'],row['canonicalInsertionCode'] if row['canonicalInsertionCode'] not in ['.','?',''] else '?')
            check(key not in expected,'Residue identity map collision'); expected[key]=row['originalLabelChain']
    labels=[s['originalLabelChain'] for s in mapping['segments'] if s['outputChain']==role]
    check(labels and len(labels)==len(set(labels)),'Invalid segment list')
    groups=[]
    for lab in labels:
        residues=[r for r in original if expected.get(residue_key(r))==lab]
        check(residues,'Empty parsed polymer segment')
        groups.append({'label':lab,'residues':residues,'sequence':''.join(letters[id(r)] for r in residues)})
    ordered=[r for g in groups for r in g['residues']]
    check(len(ordered)==len(original) and {id(r) for r in ordered}=={id(r) for r in original},'Parsed residue coverage differs')
    chain.child_list=ordered
    chain.sequence=''.join(g['sequence'] for g in groups)
    return groups

def aligned_segments(model_groups,native_groups):
    from Bio import Align
    check(len(model_groups)==len(native_groups),'Receptor protomer count differs')
    components=[]; correspondence=[]
    for index,(m,n) in enumerate(zip(model_groups,native_groups)):
        aligner=Align.PairwiseAligner(); aligner.match=5; aligner.mismatch=0; aligner.open_gap_score=-4; aligner.extend_gap_score=-.5
        alignment=aligner.align(m['sequence'],n['sequence'])[0]
        a,b=alignment[0,:],alignment[1,:]
        matches=''.join('|' if x==y else ' ' if '-' in (x,y) else '.' for x,y in zip(a,b))
        mi=ni=0; pairs=[]
        for x,match,y in zip(a,matches,b):
            mr=m['residues'][mi] if x!='-' else None; nr=n['residues'][ni] if y!='-' else None
            if match=='|': pairs.append({'modelResidue':list(residue_key(mr)),'nativeResidue':list(residue_key(nr))})
            mi+=x!='-'; ni+=y!='-'
        check(mi==len(m['residues']) and ni==len(n['residues']) and pairs,'Segment alignment is empty/incomplete')
        check(len({tuple(p['modelResidue']) for p in pairs})==len(pairs)==len({tuple(p['nativeResidue']) for p in pairs}),'Nonbijective residue correspondence')
        components.append((a,matches,b))
        correspondence.append({'segmentIndex':index,'modelOriginalLabelChain':m['label'],'nativeOriginalLabelChain':n['label'],
                               'modelResidues':len(m['residues']),'nativeResidues':len(n['residues']),'matchedResidues':len(pairs),
                               'alignment':{'model':a,'matches':matches,'native':b},'residuePairs':pairs})
    return tuple(''.join(c[i] for c in components) for i in range(3)),correspondence

def dockq_api(model_path,native_path,model_mapping,native_mapping):
    import DockQ.DockQ as dq
    check(importlib.metadata.version('DockQ')=='2.1.3','Wrong DockQ version')
    model=dq.load_PDB(str(model_path),chains=['R','V'],n_model=0)
    native=dq.load_PDB(str(native_path),chains=['R','V'],n_model=0)
    check(set(model.child_dict)==set(native.child_dict)=={'R','V'},'Context chain entered DockQ')
    def coordinate_inventory(structure):
        return sorted((c.id,str(r.id),str(a.id),str(a.altloc),tuple(float(x) for x in a.coord)) for c in structure for r in c for a in r)
    before=[coordinate_inventory(s) for s in [model,native]]
    alignments=[]; correspondence={}
    for role in ['R','V']:
        mg=runtime_segments(model[role],model_mapping,role); ng=runtime_segments(native[role],native_mapping,role)
        alignment,corr=aligned_segments(mg,ng); alignments.append(alignment); correspondence[role]=corr
    check(before==[coordinate_inventory(s) for s in [model,native]],'DockQ preparation altered coordinates/atom identities')
    info=dq.calc_DockQ((model['R'],model['V']),(native['R'],native['V']),alignments=tuple(alignments),capri_peptide=False,low_memory=False)
    check(info is not None and finite(float(info['DockQ'])) and 0<=float(info['DockQ'])<=1,'DockQ absent/out of range')
    scalar={k:(v.item() if hasattr(v,'item') else v) for k,v in info.items()}
    check(all(not isinstance(v,float) or math.isfinite(v) for v in scalar.values()),'Nonfinite DockQ metric')
    return {'status':'evaluated','DockQ':float(info['DockQ']),'metrics':scalar,'correspondence':correspondence,
            'correspondenceSha256':sha(packed(correspondence)),'contextChainsIgnored':True,'coordinatesUnchanged':True}

def combine_views(fixed_ids, results):
    check([r['id'] for r in results]==fixed_ids and len(set(fixed_ids))==len(fixed_ids),'Missing/duplicate/reordered reference result')
    errors=[r for r in results if r['status']!='evaluated']
    if errors: return {'status':'unavailable','DockQ':None,'reason':'At least one fixed reference view failed: '+'; '.join(r['id']+': '+r['reason'] for r in errors),'maximizingReferenceIds':[]}
    check(all(finite(r['DockQ']) and 0<=r['DockQ']<=1 for r in results),'Invalid per-view outcome')
    best=max(r['DockQ'] for r in results)
    return {'status':'evaluated','DockQ':best,'reason':'','maximizingReferenceIds':[r['id'] for r in results if r['DockQ']==best]}

def validate_release(release,seal_sha,seal,started):
    exact(release,['schema','evaluationRole','rankingSealSha256','generationRunId','releasedAtUtc','authorizeFrozenProspectiveOutcomeEvaluation'])
    check(release['schema']=='confovhh-round3-prospective-outcome-release-v1' and release['evaluationRole']=='prospective' and release['authorizeFrozenProspectiveOutcomeEvaluation'] is True,'Prospective outcomes have not been released')
    check(release['rankingSealSha256']==seal_sha and release['generationRunId']==seal['generationRunId'],'Release belongs to another sealed run')
    times=[dt.datetime.fromisoformat(v.replace('Z','+00:00')) for v in [seal['sealedAtUtc'],release['releasedAtUtc'],started]]
    check(all(t.utcoffset()==dt.timedelta(0) for t in times) and times[0]<=times[1]<=times[2],'Release chronology differs')

def verify_worker_job(root,job):
    """Even internal workers require a sealed, enrolled coordinate/reference pair."""
    exact(job,['id','referenceId','rankingSeal','release','model','native','modelMap','nativeMap'])
    seal=strict_json(bound(root,job['rankingSeal']))
    check(seal['schema']=='confovhh-round3-outcome-ranking-seal-v1' and seal['outcomesComputed'] is False and seal['implementation']==implementation(root),'Worker lacks current immutable ranking seal')
    check(job['id'] in seal['plannedIds'],'Worker attempt is outside the sealed enrollment')
    if seal['evaluationRole']=='prospective':
        check(job['release'] is not None,'Root prospective release is required for worker')
        validate_release(strict_json(bound(root,job['release'])),job['rankingSeal']['sha256'],seal,now())
    else: check(seal['evaluationRole']=='development' and job['release'] is None,'Worker role/release differs')
    request=strict_json(bound(root,seal['request']));check(request['evaluationRole']==seal['evaluationRole'],'Worker request role differs')
    views=strict_json(bound(root,request['predictionViews']));check(views['smoke'] is False,'Smoke views cannot enter worker')
    matches=[r for r in views['rows'] if r['id']==job['id']]
    check(len(matches)==1 and matches[0]['viewReceipt'] is not None,'Worker view is not enrolled')
    pose=matches[0];view_receipt=strict_json(bound(root,pose['viewReceipt']))
    check(view_receipt['viewSha256']==job['model']['sha256'] and view_receipt['mapSha256']==job['modelMap']['sha256'],'Worker prediction differs from sealed canonical view')
    ref_raw=bound(root,request['referenceInventory']);check(sha(ref_raw)==REFERENCE_SHA,'Worker reference inventory differs')
    refs=strict_json(ref_raw)
    targets=[t for t in refs['targets'] if t['id']==pose['setId'] and t['evaluationRole']==seal['evaluationRole']]
    check(len(targets)==1,'Worker target role differs')
    reference=[r for r in targets[0]['views'] if r['id']==job['referenceId']]
    check(len(reference)==1 and reference[0]['coordinate']==job['native'],'Worker native assignment is not prespecified')
    ref_receipt=strict_json(bound(root,reference[0]['viewReceipt']))
    check(ref_receipt['mapSha256']==job['nativeMap']['sha256'],'Worker native mapping differs')
    for name in ['model','native','modelMap','nativeMap']: bound(root,job[name])
    return strict_json(bound(root,job['modelMap'])),strict_json(bound(root,job['nativeMap']))

def seal_request(root,input_path,output):
    check(output.is_relative_to(root) and output.parent.resolve()==output.parent,'Output must remain in the execution root')
    request_binding=binding(root,input_path); request=strict_json(bound(root,request_binding)); verified=preflight(root,request)
    check(not verified['smoke'],'Smoke preparation cannot be sealed for outcome evaluation')
    result={'schema':'confovhh-round3-outcome-ranking-seal-v1','sealedAtUtc':now(),'request':request_binding,'evaluationRole':verified['role'],
            'generationRunId':verified['generationRunId'],'rankingReceiptSha256':verified['rankingReceiptSha256'],
            'producerProvenanceSha256':verified['producerProvenanceSha256'],'plannedIds':[r['id'] for r in verified['rows']],
            'implementation':implementation(root),'outcomesComputed':False}
    save(output,result); return binding(root,output)

def evaluate(root,seal_path,output,release_path=None):
    check(output.is_relative_to(root) and output.parent.resolve()==output.parent,'Output must remain in the execution root')
    seal_binding=binding(root,seal_path); seal=strict_json(bound(root,seal_binding)); started=now()
    check(seal['schema']=='confovhh-round3-outcome-ranking-seal-v1' and seal['outcomesComputed'] is False,'Invalid outcome ranking seal')
    check(seal['implementation']==implementation(root),'Sealed outcome implementation differs')
    release_binding=None
    if seal['evaluationRole']=='prospective':
        check(release_path is not None,'Root release is required before prospective outcome evaluation')
        release_binding=binding(root,release_path)
        validate_release(strict_json(bound(root,release_binding)),seal_binding['sha256'],seal,started)
    else: check(release_path is None,'Development does not consume a prospective release')
    request=strict_json(bound(root,seal['request'])); verified=preflight(root,request)
    check(not verified['smoke'] and seal['evaluationRole']==verified['role'] and seal['generationRunId']==verified['generationRunId'],'Sealed run/role differs')
    check(seal['plannedIds']==[r['id'] for r in verified['rows']] and seal['rankingReceiptSha256']==verified['rankingReceiptSha256'] and seal['producerProvenanceSha256']==verified['producerProvenanceSha256'],'Sealed rankings/membership differ')
    output.mkdir(parents=True,exist_ok=False); (output/'artifacts').mkdir()
    outcome_rows=[]; auth_rows=[]; artifacts=[]
    for row in verified['rows']:
        identity={k:row[k] for k in ['id','setId','seed','coordinateSha256']}
        references=verified['references'][row['setId']]
        ref_descriptor=[{'id':r['id'],'coordinateSha256':r['coordinate']['sha256'],'mapSha256':r['map']['sha256']} for r in references]
        ref_sha=references[0]['coordinate']['sha256'] if len(references)==1 else sha(packed(ref_descriptor))
        results=[]
        if row['view'] is None:
            aggregate={'status':'unavailable','DockQ':None,'reason':row['unavailableReason'],'maximizingReferenceIds':[]}
        else:
            for reference in references:
                job={'id':row['id'],'referenceId':reference['id'],'rankingSeal':seal_binding,'release':release_binding,
                     'model':row['view']['coordinate'],'native':reference['coordinate'],'modelMap':row['view']['map'],'nativeMap':reference['map']}
                # One fresh interpreter per view isolates parser/correspondence caches.
                try:
                    result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'worker','--artifacts',str(root)],input=json.dumps(job),text=True,capture_output=True,timeout=TIMEOUT+10)
                    check(result.returncode==0,'DockQ worker: '+result.stderr[-2000:]); value=strict_json(result.stdout)
                except Exception as error:
                    value={'status':'unavailable','DockQ':None,'reason':str(error)}
                results.append({'id':reference['id'],'referenceSha256':reference['coordinate']['sha256'],**value})
            aggregate=combine_views([r['id'] for r in references],results)
        artifact={'schema':'confovhh-round3-dockq-pose-artifact-v1',**identity,'fixedReferenceViews':ref_descriptor,
                  'predictionSelectedNbFixed':True,'chainMap':{'R':'R','V':'V'},'results':results,**aggregate}
        artifact_path=output/'artifacts'/(row['id']+'.json'); save(artifact_path,artifact); artifact_binding=binding(root,artifact_path); artifacts.append(artifact_binding)
        outcome_rows.append({**identity,**{k:aggregate[k] for k in ['status','DockQ','reason']}})
        auth_rows.append({**identity,'referenceSha256':ref_sha,'outcomeArtifactSha256':artifact_binding['sha256']})
    role=verified['role']; outcome_map={'schema':'confovhh-round3-'+role+'-outcome-map-v1','evaluationRole':role,'rows':outcome_rows}
    outcome_sha=save(output/'outcome-map.json',outcome_map)
    authentication={'schema':'confovhh-round3-'+role+'-outcome-authentication-v1','outcomeMapSha256':outcome_sha,
                    'rankingReceiptSha256':verified['rankingReceiptSha256'],'producerProvenanceSha256':verified['producerProvenanceSha256'],
                    'generationRunId':verified['generationRunId'],'coordinateIdentityVerified':True,'referenceIdentityVerified':True,
                    'outcomeArtifactsVerified':True,'rankingSealedBeforeOutcomes':True,'rows':auth_rows}
    save(output/'authentication.json',authentication)
    receipt={'schema':'confovhh-round3-dockq-evaluation-receipt-v1','evaluationRole':role,'startedAtUtc':started,'finishedAtUtc':now(),
             'rankingSeal':seal_binding,'release':release_binding,'request':seal['request'],'outcomeMap':binding(root,output/'outcome-map.json'),
             'authentication':binding(root,output/'authentication.json'),'artifacts':artifacts,'implementation':implementation(root),
             'plannedCount':len(outcome_rows),'evaluatedCount':sum(r['status']=='evaluated' for r in outcome_rows),'allPlannedIdsRetained':True,
             'dimerAggregation':'maximum across exactly all four prespecified native views; any failed view makes outcome unavailable',
             'prospectiveReleaseChecked':role=='prospective'}
    save(output/'receipt.json',receipt); verify_evaluation(root,binding(root,output/'receipt.json'))
    return binding(root,output/'receipt.json')

def verify_evaluation(root,receipt_binding):
    """Authenticate completed output map/artifacts for calibration/report callers."""
    receipt=strict_json(bound(root,receipt_binding)); check(receipt['schema']=='confovhh-round3-dockq-evaluation-receipt-v1','Invalid evaluation receipt')
    seal=strict_json(bound(root,receipt['rankingSeal'])); request=strict_json(bound(root,receipt['request'])); verified=preflight(root,request)
    check(receipt['implementation']==seal['implementation']==implementation(root),'Evaluation implementation differs')
    check(receipt['request']==seal['request'],'Evaluation request differs from seal')
    check(seal['rankingReceiptSha256']==verified['rankingReceiptSha256'] and seal['producerProvenanceSha256']==verified['producerProvenanceSha256'] and seal['generationRunId']==verified['generationRunId'],'Evaluation seal provenance differs')
    check(dt.datetime.fromisoformat(seal['sealedAtUtc'])<=dt.datetime.fromisoformat(receipt['startedAtUtc']),'Ranks were not sealed before outcomes')
    if receipt['evaluationRole']=='prospective': validate_release(strict_json(bound(root,receipt['release'])),receipt['rankingSeal']['sha256'],seal,receipt['startedAtUtc'])
    outcome=strict_json(bound(root,receipt['outcomeMap'])); auth=strict_json(bound(root,receipt['authentication']))
    role=verified['role']
    exact(outcome,['schema','evaluationRole','rows'])
    exact(auth,['schema','outcomeMapSha256','rankingReceiptSha256','producerProvenanceSha256','generationRunId','coordinateIdentityVerified','referenceIdentityVerified','outcomeArtifactsVerified','rankingSealedBeforeOutcomes','rows'])
    check(receipt['evaluationRole']==seal['evaluationRole']==outcome['evaluationRole']==role and outcome['schema']=='confovhh-round3-'+role+'-outcome-map-v1' and auth['schema']=='confovhh-round3-'+role+'-outcome-authentication-v1','Outcome role/schema differs')
    check(auth['outcomeMapSha256']==receipt['outcomeMap']['sha256'] and auth['rankingReceiptSha256']==verified['rankingReceiptSha256'] and auth['producerProvenanceSha256']==verified['producerProvenanceSha256'] and auth['generationRunId']==verified['generationRunId'],'Outcome authentication differs')
    check(all(auth[k] is True for k in ['coordinateIdentityVerified','referenceIdentityVerified','outcomeArtifactsVerified','rankingSealedBeforeOutcomes']),'Incomplete attestation')
    ids=[r['id'] for r in verified['rows']]
    check(ids==[r['id'] for r in outcome['rows']]==[r['id'] for r in auth['rows']]==seal['plannedIds'],'Outcome membership/order differs')
    check(len(receipt['artifacts'])==len(ids)==receipt['plannedCount'],'Outcome artifact count differs')
    for row,a,p,b in zip(outcome['rows'],auth['rows'],verified['rows'],receipt['artifacts']):
        exact(row,['id','setId','seed','coordinateSha256','status','DockQ','reason'])
        exact(a,['id','setId','seed','coordinateSha256','referenceSha256','outcomeArtifactSha256'])
        artifact=strict_json(bound(root,b))
        for key in ['id','setId','seed','coordinateSha256']: check(row[key]==a[key]==p[key]==artifact[key],'Outcome identity differs')
        check(a['outcomeArtifactSha256']==b['sha256'],'Outcome artifact digest differs')
        refs=verified['references'][row['setId']]
        descriptor=[{'id':r['id'],'coordinateSha256':r['coordinate']['sha256'],'mapSha256':r['map']['sha256']} for r in refs]
        expected_ref=refs[0]['coordinate']['sha256'] if len(refs)==1 else sha(packed(descriptor))
        check(a['referenceSha256']==expected_ref and artifact['fixedReferenceViews']==descriptor,'Outcome reference identity differs')
        if p['view'] is not None:
            aggregate=combine_views([r['id'] for r in refs],artifact['results'])
            for value,ref in zip(artifact['results'],refs):
                check(value['referenceSha256']==ref['coordinate']['sha256'],'Per-view reference differs')
                if value['status']=='evaluated': check(value['correspondenceSha256']==sha(packed(value['correspondence'])) and value['contextChainsIgnored'] is True and value['coordinatesUnchanged'] is True,'Correspondence receipt differs')
        else: aggregate={'status':'unavailable','DockQ':None,'reason':p['unavailableReason'],'maximizingReferenceIds':[]}
        for key in ['status','DockQ','reason']: check(row[key]==artifact[key]==aggregate[key],'Outcome aggregation differs')
        check(artifact['maximizingReferenceIds']==aggregate['maximizingReferenceIds'],'Symmetry maximum differs')
    check(receipt['evaluatedCount']==sum(r['status']=='evaluated' for r in outcome['rows']) and receipt['allPlannedIdsRetained'] is True,'Outcome coverage differs')
    return outcome,auth,receipt

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('command',choices=['preflight','seal','evaluate','verify','worker']); p.add_argument('--artifacts',type=Path,default=DEFAULT_ROOT)
    p.add_argument('--input',type=Path); p.add_argument('--seal',type=Path); p.add_argument('--release',type=Path); p.add_argument('--output',type=Path); p.add_argument('--receipt',type=Path)
    a=p.parse_args(); root=a.artifacts.resolve()
    if a.command=='worker':
        import signal
        signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('DockQ per-view timeout'))); signal.alarm(TIMEOUT)
        job=strict_json(sys.stdin.read());model_mapping,native_mapping=verify_worker_job(root,job)
        result=dockq_api(root/job['model']['path'],root/job['native']['path'],model_mapping,native_mapping)
    elif a.command=='preflight':
        v=preflight(root,strict_json(a.input.read_bytes())); result={'role':v['role'],'smoke':v['smoke'],'planned':len(v['rows']),'views':sum(r['view'] is not None for r in v['rows']),'outcomesComputed':False}
    elif a.command=='seal': result=seal_request(root,a.input.resolve(),a.output.resolve())
    elif a.command=='evaluate': result=evaluate(root,a.seal.resolve(),a.output.resolve(),a.release.resolve() if a.release else None)
    else:
        outcome,_,receipt=verify_evaluation(root,binding(root,a.receipt.resolve())); result={'verified':True,'planned':len(outcome['rows']),'evaluated':receipt['evaluatedCount']}
    print(json.dumps(result,allow_nan=False))

if __name__=='__main__': main()
