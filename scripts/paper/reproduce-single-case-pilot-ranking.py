#!/usr/bin/env python3
"""Post-outcome, CPU-only replay; original frozen scientific code and records remain untouched."""
import argparse, csv, hashlib, json, os, pathlib, shutil, subprocess, sys
from datetime import datetime, timezone
import numpy as np
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo',required=True,type=pathlib.Path,help='Unmodified frozen 335617a repository with pinned immunum installed')
parser.add_argument('--evaluation',required=True,type=pathlib.Path,help='Preserved execution03 evaluation directory')
parser.add_argument('--generation',required=True,type=pathlib.Path,help='Preserved execution03 3p0g-pilot-output directory')
parser.add_argument('--output',required=True,type=pathlib.Path,help='New empty output directory')
parser.add_argument('--node',default='node',help='Node with TypeScript support; same version as original for strict receipt equality')
args=parser.parse_args()
REPO=args.repo.resolve();OUT=args.output.resolve();EVAL=args.evaluation.resolve()
OUT.mkdir(parents=True,exist_ok=True)
assert not list(OUT.iterdir()),'Output must be empty; previous records are not overwritten'
CASE=REPO/'validation/single-case-development-3p0g-2026-09-09'
GEN=args.generation.resolve();NODE=args.node
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p): return json.loads(pathlib.Path(p).read_text())
def save(p,v):
    with pathlib.Path(p).open('x') as f: json.dump(v,f,indent=2,allow_nan=False);f.write('\n')
def verify(root,r):
    p=root/r['path'];assert p.is_file() and not p.is_symlink()
    assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'],str(p)
    return p
plan=load(CASE/'protocol.json'); generation=load(GEN/'generation-receipt.json')
assert sha(CASE/'protocol.json')=='8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()=='335617ae2744d8e9061464bafd62e166209d8c46'
sources=[]
for name,r in plan['method']['sourceFiles'].items():
    p=verify(REPO,dict(r,path=name));sources.append(dict(path=name,sha256=sha(p),bytes=p.stat().st_size))
assert generation['protocolSha256']==sha(CASE/'protocol.json')
assert generation['status']=='GENERATION_COMPLETE'
ids=plan['plannedCandidateIds'];assert len(ids)==10 and len(set(ids))==10
attempts={a['id']:a for a in generation['attempts']};assert set(attempts)==set(ids)
old_input=load(EVAL/'source-bound-input.json');old_receipt=load(EVAL/'source-bound-receipt.json')
old_eval=load(EVAL/'evaluation-execution-receipt.json')
for record in old_eval['allArtifacts']: verify(EVAL,record)
art=OUT/'artifacts';art.mkdir(exist_ok=False)
manifest={'schema':'confovhh-source-bound-coordinate-input-v1','studyId':plan['studyId'],'generators':[{'id':plan['generator']['id'],'extractor':plan['baseline']['extractor']}],'attempts':[],'coordinates':[],'scoreSources':[]}
roles=[];raw_geometry={}
RADII={'C':1.7,'N':1.55,'O':1.52,'S':1.8,'P':1.8,'SE':1.9}
for id in ids:
    a=attempts[id];assert a['status']=='generated' and a['seedExitCode']==0 and a['confidenceStatus']=='present'
    assert id==f"seed{a['seed']}_model_{a['modelFileIndex']}"
    coord=verify(GEN,a['artifacts']['coordinate']);conf=verify(GEN,a['artifacts']['confidence'])
    assert coord.name==f"3P0G_seed{a['seed']}_model_{a['modelFileIndex']}.cif"
    assert conf.name=='confidence_'+coord.stem+'.json'
    dest=art/id;dest.mkdir();shutil.copyfile(coord,dest/coord.name);shutil.copyfile(conf,dest/conf.name)
    manifest['attempts'].append(dict(id=id,groupId='3P0G',targetId='3P0G',generatorId='boltz221',status='eligible',reason=''))
    manifest['coordinates'].append(dict(id=id,format='mmcif',coordinateSha256=sha(coord),coordinateBytes=coord.stat().st_size,receptorChain='A',vhhChain='B',selectedModelId='1',chainRolesConfirmed=True))
    manifest['scoreSources'].append(dict(id=id,extractor='boltz-confidence-score-v1',coordinatePath=f'{id}/{coord.name}',coordinateSha256=sha(coord),source=dict(path=f'{id}/{conf.name}',sha256=sha(conf),bytes=conf.stat().st_size)))
    # Parse decimal coordinate text independently of the ConfoVHH parser. Avoid Bio.PDB float32 coordinates.
    d=MMCIF2Dict(str(coord));atoms=[]
    for j,chain in enumerate(d['_atom_site.auth_asym_id']):
        if chain not in ('A','B'): continue
        assert d['_atom_site.label_asym_id'][j]==chain
        assert d['_atom_site.pdbx_PDB_model_num'][j]=='1'
        assert d['_atom_site.label_alt_id'][j] in ('.','?')
        assert float(d['_atom_site.occupancy'][j])==1
        atoms.append(dict(chain=chain,res=int(d['_atom_site.auth_seq_id'][j]),label=int(d['_atom_site.label_seq_id'][j]),resname=d['_atom_site.label_comp_id'][j],name=d['_atom_site.label_atom_id'][j],element=d['_atom_site.type_symbol'][j].upper(),xyz=[float(d['_atom_site.Cartn_'+k][j]) for k in 'xyz']))
    for protein in plan['case']['inputProteins']:
        ca=[at for at in atoms if at['chain']==protein['chain'] and at['name']=='CA']
        assert [at['res'] for at in ca]==list(range(1,len(ca)+1))
        seq=''.join(seq1(at['resname']) for at in ca)
        assert seq==protein['sequence'] and hashlib.sha256(seq.encode()).hexdigest()==protein['sequence_sha256']
        for ca_atom in ca:
            atom_names=[at['name'] for at in atoms if at['chain']==protein['chain'] and at['res']==ca_atom['res']]
            assert all(atom_names.count(name)==1 for name in ('N','CA','C','O')),'Missing or duplicated backbone atom'
    roles.append(dict(id=id,coordinateSha256=sha(coord),confidenceSha256=sha(conf),chainA='receptor',chainB='VHH',chainASequenceSha256=plan['case']['inputProteins'][0]['sequence_sha256'],chainBSequenceSha256=plan['case']['inputProteins'][1]['sequence_sha256'],chainAResidues=501,chainBResidues=126,model='1',labelAndAuthChainsAgree=True,exactFrozenSequences=True,allBackboneAtomsPresentExactlyOnce=True,backboneCompleteness={'A':1.0,'B':1.0}))
    aa=[at for at in atoms if at['chain']=='A']; bb=[at for at in atoms if at['chain']=='B']
    xyzb=np.array([at['xyz'] for at in bb]);pairs={};clashes=[];atom_contacts=0;max_overlap=-float('inf')
    for ra in aa:
        dist=np.sqrt(np.sum((np.array(ra['xyz'])-xyzb)**2,axis=1))
        for j in np.where(dist<=4.5)[0]:
            vb=bb[j];dd=float(dist[j]);atom_contacts+=1;k=(ra['res'],vb['res'])
            pairs.setdefault(k,{'minimumDistance':float('inf'),'maximumOverlap':-float('inf'),'severe':False})
            pair=pairs[k];pair['minimumDistance']=min(pair['minimumDistance'],dd)
            disulfide=ra['resname']==vb['resname']=='CYS' and ra['name']==vb['name']=='SG' and 1.8<=dd<=2.3
            if disulfide:continue
            ov=RADII[ra['element']]+RADII[vb['element']]-dd
            pair['maximumOverlap']=max(pair['maximumOverlap'],ov);max_overlap=max(max_overlap,ov)
            if ov>=.6:
                pair['severe']=True
                clashes.append(dict(receptor=f"{ra['resname']} A:{ra['res']} {ra['name']}",vhh=f"{vb['resname']} B:{vb['res']} {vb['name']}",receptorResidue=ra['res'],vhhResidue=vb['res'],distanceAngstrom=dd,overlapAngstrom=ov))
    raw_geometry[id]=dict(contactPairCount=len(pairs),atomContactCount=atom_contacts,receptorInterfaceResidues=len(set(p[0] for p in pairs)),vhhInterfaceResidues=len(set(p[1] for p in pairs)),severeClashCount=sum(p['severe'] for p in pairs.values()),maximumOverlapAngstrom=max_overlap,clashingAtomPairs=clashes)
assert manifest==old_input,'Independent reconstruction differs from original manifest'
save(OUT/'source-bound-input.json',manifest)
save(OUT/'identity-and-source-verification.json',dict(status='PASS',protocolSha256=sha(CASE/'protocol.json'),generationReceiptSha256=sha(GEN/'generation-receipt.json'),sourceFiles=sources,candidates=roles,allOriginalEvaluationArtifactHashesVerified=True))
save(OUT/'independent-contact-clash-geometry.json',raw_geometry)
env={k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME')}
started=datetime.now(timezone.utc).isoformat()
with (OUT/'replay.stdout.log').open('xb') as stdout,(OUT/'replay.stderr.log').open('xb') as stderr:
    subprocess.run([NODE,str(REPO/'scripts/paper/export-source-bound-coordinate-ranks.mjs'),f'--input={OUT}/source-bound-input.json',f'--artifacts={art}',f'--output={OUT}/source-bound-replay.json'],check=True,timeout=900,env=env,stdout=stdout,stderr=stderr)
new=load(OUT/'source-bound-replay.json')['result'];old=old_receipt['result']
assert new['comparisonFields']==old['comparisonFields']
rows=[]
dockq={r['id']:r for r in load(EVAL/'comparison-receipt.json')['report']['candidateLedger']}
for id in ids:
    current=json.loads(new['coordinateExecution']['reports'][id]);prior=json.loads(old['coordinateExecution']['reports'][id]);audit=current['audit']
    for k in ('structure','audit','auditPolicy'):assert current[k]==prior[k],(id,k)
    raw=raw_geometry[id]
    for k in ('contactPairCount','atomContactCount','receptorInterfaceResidues','vhhInterfaceResidues','severeClashCount'):assert raw[k]==audit[k],(id,k)
    assert abs(raw['maximumOverlapAngstrom']-audit['maximumOverlapAngstrom'])<1e-12
    independent_level='not-assessable' if raw['contactPairCount']==0 else 'limited' if raw['contactPairCount']<8 or raw['receptorInterfaceResidues']<3 or raw['vhhInterfaceResidues']<3 or raw['maximumOverlapAngstrom']>=1.5 or raw['severeClashCount']>=max(5,int(np.ceil(raw['contactPairCount']*.25))) else 'supported' if raw['contactPairCount']>=18 and raw['receptorInterfaceResidues']>=7 and raw['vhhInterfaceResidues']>=6 and raw['severeClashCount']==0 else 'mixed'
    assert independent_level==audit['evidenceLevel']
    conf=load(art/next(d['source']['path'] for d in manifest['scoreSources'] if d['id']==id))['confidence_score']
    evidence={'supported':2,'mixed':1,'limited':0,'not-assessable':0}[independent_level]
    rows.append(dict(id=id,status='success',evidenceLevel=independent_level,evidenceTier=evidence,halfDeltaSasaInterfaceAreaAngstrom2=audit['halfDeltaSasaInterfaceAreaAngstrom2'],severeClashCount=raw['severeClashCount'],maximumOverlapAngstrom=audit['maximumOverlapAngstrom'],contactPairCount=raw['contactPairCount'],atomContactCount=raw['atomContactCount'],receptorInterfaceResidues=raw['receptorInterfaceResidues'],vhhInterfaceResidues=raw['vhhInterfaceResidues'],confidence=conf,DockQ=dockq[id]['DockQ'],coordinateSha256=roles[ids.index(id)]['coordinateSha256'],confidenceSha256=roles[ids.index(id)]['confidenceSha256']))
# Independent tuple sorting from fresh audit, with exact scientific ties and no ID tiebreak.
keys=sorted(set((r['evidenceTier'],r['halfDeltaSasaInterfaceAreaAngstrom2']) for r in rows),reverse=True)
confidence_keys=sorted(set(r['confidence'] for r in rows),reverse=True)
original_ranks={r['id']:r for r in old['comparisonFields']['rankings']}
for r in rows:
    r['confoRank']=keys.index((r['evidenceTier'],r['halfDeltaSasaInterfaceAreaAngstrom2']))+1
    r['confidenceRank']=confidence_keys.index(r['confidence'])+1
    assert r['confoRank']==original_ranks[r['id']]['methodTier']+1
    assert r['confidenceRank']==original_ranks[r['id']]['baselineTier']+1
save(OUT/'candidate-table.json',rows)
with (OUT/'candidate-table.csv').open('x') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
table='| Candidate | Evidence (tier) | Exact half-delta-SASA (Å²) | Clash pairs | Max overlap (Å) | Residue contacts | Atom contacts | Receptor/VHH residues | Confidence | DockQ | Confo rank |\n|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|\n'
for r in rows:table+='| '+ ' | '.join(str(x) for x in [r['id'],f"{r['evidenceLevel']} ({r['evidenceTier']})",r['halfDeltaSasaInterfaceAreaAngstrom2'],r['severeClashCount'],r['maximumOverlapAngstrom'],r['contactPairCount'],r['atomContactCount'],f"{r['receptorInterfaceResidues']}/{r['vhhInterfaceResidues']}",r['confidence'],r['DockQ'],r['confoRank']])+' |\n'
(OUT/'candidate-table.md').write_text(table)
save(OUT/'reproduction-receipt.json',dict(status='PASS',startedAtUtc=started,completedAtUtc=datetime.now(timezone.utc).isoformat(),scriptSha256=sha(__file__),replaySha256=sha(OUT/'source-bound-replay.json'),originalSourceBoundReceiptSha256=sha(EVAL/'source-bound-receipt.json'),rankingsExactlyMatch=True,fullFreshAuditsExactlyMatch=True,independentContactAndClashCountsMatch=True,independentRankTupleSortingMatches=True,sourceFileCount=len(sources),candidateCount=10,allCandidateIdsAndRolesAndHashesVerified=True,noNewGpuGeneration=True,scoringChanges=False,bugFoundInTestedPath=False,originalResultPreserved=True,limitations=['Post-outcome replay of one development case, not independent validation.','DockQ values loaded from checksum-verified preserved frozen evaluation; DockQ itself not rerun by this ranking script.','Tier check relies on independently verified full backbone completeness of these fully modeled chains.']))
print(json.dumps({'status':'PASS','rows':len(rows),'output':str(OUT)}))
