#!/usr/bin/env python3
"""Post hoc, CPU-only structural diagnosis. Never modifies frozen coordinates/scores.

Usage: work/evaluation-venv/bin/python work/selection-failure/geometry/analyze_geometry.py
Mapping uses deposited mmCIF label_seq_id, independently checked against archived metadata;
superpositions use only native-observed, identically named receptor backbone atoms.
"""
from pathlib import Path
import os, json, csv, hashlib, sys, argparse
os.environ.setdefault('MPLCONFIGDIR', str(Path('work/selection-failure/geometry/mpl-cache').resolve()))
import numpy as np
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

ROOT=Path.cwd().resolve()
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evaluation',type=Path,default=ROOT/'outputs/startup-recovery/execution03-evaluation')
parser.add_argument('--case',type=Path,default=ROOT/'work/ConfoVHH/validation/single-case-development-3p0g-2026-09-09/case')
parser.add_argument('--reference',type=Path,default=ROOT/'work/local-evaluation/reference/3P0G.cif')
parser.add_argument('--native-protein',type=Path,default=ROOT/'work/local-evaluation/reference-preflight/native_AB.pdb')
parser.add_argument('--output',type=Path,default=ROOT/'outputs/selection-failure/geometry')
args=parser.parse_args()
OUT=args.output.resolve();EVAL=args.evaluation.resolve();CASE=args.case.resolve();REF=args.reference.resolve();NATIVE_PROTEIN=args.native_protein.resolve()
OUT.mkdir(exist_ok=True,parents=True)
IDS=[f'seed{s}_model_{i}' for s in (1,2) for i in range(5)]
RADII={'H':1.2,'C':1.7,'N':1.55,'O':1.52,'S':1.8,'P':1.8,'SE':1.9,'F':1.47,'CL':1.75,'BR':1.85,'I':1.98}
BB=('N','CA','C','O')
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,obj): (OUT/p).write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
def load(p):
    d=MMCIF2Dict(str(p)); atoms={}
    keys=['group_PDB','label_asym_id','label_seq_id','auth_seq_id','pdbx_PDB_ins_code','label_comp_id','label_atom_id','type_symbol','Cartn_x','Cartn_y','Cartn_z','occupancy','B_iso_or_equiv','label_alt_id','pdbx_PDB_model_num']
    for vals in zip(*(d['_atom_site.'+k] for k in keys)):
        v=dict(zip(keys,vals))
        if v['group_PDB']!='ATOM' or v['label_asym_id'] not in ('A','B') or v['pdbx_PDB_model_num']!='1':continue
        if v['type_symbol'].upper() in ('H','D'):continue
        k=(v['label_asym_id'],int(v['label_seq_id']),v['label_atom_id'])
        rec={'chain':k[0],'label':k[1],'name':k[2],'resname':v['label_comp_id'],'element':v['type_symbol'].upper(),'xyz':np.array([float(v[t]) for t in ('Cartn_x','Cartn_y','Cartn_z')]),'auth':v['auth_seq_id']+('' if v['pdbx_PDB_ins_code'] in ('?','.') else v['pdbx_PDB_ins_code']),'occupancy':float(v['occupancy']),'bfactor':float(v['B_iso_or_equiv']),'alt':v['label_alt_id']}
        if k not in atoms or (rec['occupancy'],-ord(rec['alt'][0]))>(atoms[k]['occupancy'],-ord(atoms[k]['alt'][0])):atoms[k]=rec
    return atoms
native=load(REF)
meta=json.loads((CASE/'3P0G-case-metadata-summary.json').read_text())
seqs={e['label_asym_id']:e['sequence'] for e in meta['entities']}
observed={c:{k[1] for k in native if k[0]==c} for c in ('A','B')}
assert len(observed['A'])==284 and len(observed['B'])==121
metadata={}
for c in ('A','B'):
    metadata[c]={int(r['label_seq_id']):r for r in csv.DictReader((CASE/f'3P0G-{c}-label-auth-sequence.tsv').open(),delimiter='\t')}
    assert observed[c]=={i for i,r in metadata[c].items() if r['modeled_per_metadata']=='True'}
for a in native.values():
    assert seq1(a['resname'])==seqs[a['chain']][a['label']-1]
    assert a['auth']==metadata[a['chain']][a['label']]['author_residue_id_including_insertion_code']
def region(i):
    if i<=8:return 'engineered_N_terminal_tag'
    if 239<=i<=398:return 'T4_lysozyme_fusion'
    if i in observed['A']:return 'native_observed_beta2AR'
    return 'native_unobserved_beta2AR'
def atoms_for(atoms,c,subset=None):return [a for k,a in sorted(atoms.items()) if k[0]==c and (subset is None or k[1] in subset)]
def census(atoms,cutoff,matched=False):
    aa=atoms_for(atoms,'A',observed['A'] if matched else None);bb=atoms_for(atoms,'B',observed['B'] if matched else None)
    ac=np.array([a['xyz'] for a in aa]);bc=np.array([a['xyz'] for a in bb])
    dd=np.sqrt(np.sum((ac[:,None,:]-bc[None,:,:])**2,axis=2))
    ii,jj=np.where(dd<=cutoff); pairs={}; atom_count=0
    for i,j in zip(ii,jj):
        a,b=aa[i],bb[j];d=float(dd[i,j]);key=(a['label'],b['label']);atom_count+=1
        overlap=RADII.get(a['element'],1.7)+RADII.get(b['element'],1.7)-d
        disulfide=a['resname']==b['resname']=='CYS' and a['name']==b['name']=='SG' and 1.8<=d<=2.3
        pair=pairs.setdefault(key,{'A_label':key[0],'A_auth':metadata['A'][key[0]]['author_residue_id_including_insertion_code'],'A_resname':a['resname'],'B_label':key[1],'B_resname':b['resname'],'A_region':region(key[0]),'B_native_observed':key[1] in observed['B'],'atom_contacts':0,'minimum_distance_A':d,'max_overlap_A':0,'clash_atom_pairs':[]})
        pair['atom_contacts']+=1;pair['minimum_distance_A']=min(pair['minimum_distance_A'],d)
        if not disulfide:pair['max_overlap_A']=max(pair['max_overlap_A'],overlap)
        if not disulfide and overlap>=0.6:pair['clash_atom_pairs'].append({'A_atom':a['name'],'B_atom':b['name'],'distance_A':d,'overlap_A':overlap,'A_bfactor':a['bfactor'],'B_bfactor':b['bfactor']})
    return pairs,atom_count
def fit(atoms):
    keys=sorted(k for k in native if k[0]=='A' and k[2] in BB and k in atoms)
    xx=np.array([atoms[k]['xyz'] for k in keys]);yy=np.array([native[k]['xyz'] for k in keys]);xmean=xx.mean(0);ymean=yy.mean(0)
    u,s,vt=np.linalg.svd((xx-xmean).T@(yy-ymean));rot=u@np.diag([1,1,np.linalg.det(u@vt)])@vt;tran=ymean-xmean@rot
    rms=float(np.sqrt(np.mean(np.sum((xx@rot+tran-yy)**2,axis=1))))
    lk=sorted(k for k in native if k[0]=='B' and k[2] in BB and k in atoms)
    ligand_rms=float(np.sqrt(np.mean([np.sum((atoms[k]['xyz']@rot+tran-native[k]['xyz'])**2) for k in lk])))
    ca=[k for k in lk if k[2]=='CA'];center_dist=float(np.linalg.norm(np.mean([atoms[k]['xyz']@rot+tran for k in ca],axis=0)-np.mean([native[k]['xyz'] for k in ca],axis=0)))
    return rot,tran,{'receptor_backbone_atom_count':len(keys),'receptor_residue_count':len({k[1] for k in keys}),'receptor_backbone_fit_RMSD_A':rms,'ligand_backbone_atom_count':len(lk),'ligand_backbone_RMSD_after_receptor_fit_A':ligand_rms,'ligand_CA_centroid_displacement_A':center_dist}
native5,_=census(native,5.0);native45,_=census(native,4.5)
assert len(native5)==51
rows=[];contacts={};models={};aligned={};mapping_rows=[]
for c in ('A','B'):
    for i,r in metadata[c].items():mapping_rows.append({'chain':c,'prediction_label_seq_id':i,'native_label_seq_id':i if i in observed[c] else None,'native_auth_residue':r['author_residue_id_including_insertion_code'],'one_letter':r['one_letter'],'native_observed':i in observed[c],'region':region(i) if c=='A' else ('VHH' if i<=120 else 'His_tag')})
for id in IDS:
    p=EVAL/f'artifacts/{id}/3P0G_{id}.cif';at=load(p);models[id]=at
    for c in ('A','B'):
        labels=sorted({k[1] for k in at if k[0]==c});assert labels==list(range(1,len(seqs[c])+1))
        actual=''.join(seq1(at[(c,i,'CA')]['resname']) for i in labels);assert actual==seqs[c]
    rot,tran,fitrec=fit(at);aligned[id]={k:dict(v,xyz=v['xyz']@rot+tran) for k,v in at.items()}
    all45,atom45=census(at,4.5);matched5,_=census(at,5.0,True);all5,_=census(at,5.0)
    regional={r:{'residue_pairs':sum(p['A_region']==r for p in all45.values()),'atom_pairs':sum(p['atom_contacts'] for p in all45.values() if p['A_region']==r),'clash_residue_pairs':sum(bool(p['clash_atom_pairs']) for p in all45.values() if p['A_region']==r)} for r in ('native_observed_beta2AR','native_unobserved_beta2AR','T4_lysozyme_fusion','engineered_N_terminal_tag')}
    dock=json.loads((EVAL/f'{id}.dockq-api.json').read_text())['metrics'];nat_correct=len(set(matched5)&set(native5));clashes=[p for p in all45.values() if p['clash_atom_pairs']]
    rec={'id':id,'coordinate_sha256':sha(p),'sequence_identity_to_frozen_input':True,**fitrec,'all_residue_contacts_4p5_A':len(all45),'all_atom_contacts_4p5_A':atom45,'all_residue_contacts_5_A':len(all5),'matched_observed_residue_contacts_5_A':len(matched5),'native_contact_count_5_A':len(native5),'native_contact_recovered_5_A':nat_correct,'native_contact_fraction':nat_correct/len(native5),'frozen_DockQ':dock['DockQ'],'frozen_DockQ_LRMSD_A':dock['LRMSD'],'frozen_DockQ_native_contacts_recovered':dock['nat_correct'],'all_reported_clash_residue_pairs':len(clashes),'regional_contacts_4p5_A':regional,'clash_details':clashes}
    contacts[id]=all45;rows.append(rec)
    save(f'{id}-contact-census.json',{'id':id,'contacts_4p5_A':list(all45.values()),'native_observed_contacts_5_A':[{'A_label':a,'B_label':b,'native':(a,b) in native5} for a,b in matched5],'full_model_contacts_5_A':[{'A_label':a,'B_label':b,'native':(a,b) in native5} for a,b in all5]})

# Explicitly inspect the sequence alignment used by the frozen DockQ implementation.
import DockQ.DockQ as dq
mod=dq.load_PDB(str(EVAL/'artifacts/seed2_model_0/3P0G_seed2_model_0.cif'),chains=['A','B'])
ref=dq.load_PDB(str(NATIVE_PROTEIN),chains=['A','B'])
dockq_mapping={}
for c in ('A','B'):
    aln=dq.format_alignment(dq.align_chains(mod[c],ref[c]));ma,na=dq.get_aligned_residues(mod[c],ref[c],tuple(aln.values()))
    pairs=[]
    native_auth_lookup={r['author_residue_id_including_insertion_code']:i for i,r in metadata[c].items()}
    for mr,nr in zip(ma,na):
        auth=str(nr.id[1])+nr.id[2].strip();native_label=native_auth_lookup[auth]
        pairs.append({'model_label':mr.id[1],'native_label':native_label,'native_auth':auth,'identity_mapping':mr.id[1]==native_label})
    dockq_mapping[c]={'matched_count':len(pairs),'identity_mapping_count':sum(p['identity_mapping'] for p in pairs),'mismapped_pairs':[p for p in pairs if not p['identity_mapping']],'alignment':aln,'pairs':pairs}
save('dockq-sequence-mapping-audit.json',dockq_mapping)
save('residue-mapping.json',mapping_rows)
save('geometry-analysis.json',{'status':'COMPLETE','analysis_type':'post_hoc_development_case_diagnosis_not_scoring_redesign','native_sha256':sha(REF),'native_protein_pdb_sha256':sha(NATIVE_PROTEIN),'reference_observed_residue_counts':{c:len(v) for c,v in observed.items()},'exact_mapping_method':'mmCIF label_seq_id independently checked against depositor label-auth sequence table and full frozen input sequences','alignment_method':'proper-rotation least-squares fit on exact matched native-observed chain-A N,CA,C,O atoms; ligand residual uses native-observed chain-B N,CA,C,O; no fit to VHH','contact_definition':'independent all-heavy-atom distance<=4.5 A for product census; <=5.0 A for DockQ-style native contacts; native-unobserved pairs cannot be validated or scored as recovered native contacts','clash_definition':'unique interchain residue pairs with element-vdW-radius sum minus atom distance >=0.6 A; plausible CYS-SG/CYS-SG distances1.8–2.3 A excluded, matching frozen product','native_contact_count_5_A':len(native5),'native_contact_count_4p5_A':len(native45),'candidates':rows})
fields=['id','all_residue_contacts_4p5_A','all_atom_contacts_4p5_A','all_reported_clash_residue_pairs','native_contact_recovered_5_A','native_contact_fraction','receptor_backbone_fit_RMSD_A','ligand_backbone_RMSD_after_receptor_fit_A','ligand_CA_centroid_displacement_A','frozen_DockQ']
with (OUT/'geometry-table.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows({k:r[k] for k in fields} for r in rows)
regional_rows=[]
for r in rows:
    for region_name,counts in r['regional_contacts_4p5_A'].items():regional_rows.append({'id':r['id'],'receptor_region':region_name,**counts})
with (OUT/'regional-contact-clash-census.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(regional_rows[0]));w.writeheader();w.writerows(regional_rows)

# Render orthographic CA traces in one common receptor frame. Break missing residues.
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
native_ca=np.array([v['xyz'] for k,v in native.items() if k[0]=='A' and k[2]=='CA'])
origin=native_ca.mean(0);_,_,basis=np.linalg.svd(native_ca-origin)
def points(at,c,subset=None):return [(k[1],(v['xyz']-origin)@basis.T) for k,v in sorted(at.items()) if k[0]==c and k[2]=='CA' and (subset is None or k[1] in subset)]
def trace(ax,at,c,dims,color,lw=1.4,alpha=1,subset=None,ls='-'):
    pp=points(at,c,subset);segments=[];seg=[];last=None
    for i,v in pp:
        if last is not None and i!=last+1:segments.append(seg);seg=[]
        seg.append(v);last=i
    segments.append(seg)
    for seg in segments:
        vv=np.array(seg)
        if len(vv):ax.plot(vv[:,dims[0]],vv[:,dims[1]],color=color,lw=lw,alpha=alpha,ls=ls)
def style(ax,dims):
    ax.set_aspect('equal',adjustable='datalim');ax.set_xlabel(f'Receptor principal axis {dims[0]+1} (Å)');ax.set_ylabel(f'Receptor principal axis {dims[1]+1} (Å)');ax.grid(alpha=.15)
col={'native':'#14805e','seed2_model_4':'#c9404e','seed2_model_0':'#2468b4'}
fig,axes=plt.subplots(2,2,figsize=(13,11),layout='constrained')
for ax,dims in zip(axes[0],[(0,1),(0,2)]):
    trace(ax,native,'A',dims,'#777777',1.4,.9)
    for id in ('seed2_model_4','seed2_model_0'):
        trace(ax,aligned[id],'A',dims,col[id],.7,.20,observed['A']);trace(ax,aligned[id],'B',dims,col[id],1.8,.9,observed['B'])
    trace(ax,native,'B',dims,col['native'],2.0,1)
    style(ax,dims);ax.set_title('Native-observed receptor frame · orthogonal view')
for ax,id in zip(axes[1],('seed2_model_4','seed2_model_0')):
    dims=(0,1);trace(ax,native,'A',dims,'#777777',1.2,.75);trace(ax,native,'B',dims,col['native'],1.9,.8)
    trace(ax,aligned[id],'A',dims,'#aaa',.8,.5,observed['A'])
    trace(ax,aligned[id],'A',dims,'#d9a430',1.1,.85,set(range(239,399)))
    unobs=set(range(1,502))-observed['A']-set(range(239,399));trace(ax,aligned[id],'A',dims,'#df8248',1.2,.9,unobs,ls='--')
    trace(ax,aligned[id],'B',dims,col[id],2,1)
    style(ax,dims);rec=next(r for r in rows if r['id']==id)
    ax.set_title(f'{id} · full generated construct\nDockQ {rec["frozen_DockQ"]:.3f}; ligand RMSD {rec["ligand_backbone_RMSD_after_receptor_fit_A"]:.2f} Å')
fig.suptitle('3P0G selection failure: receptor-aligned coordinate overlays\nPost hoc development-case diagnosis; CA traces, no structural regeneration',fontsize=16)
handles=[Line2D([0],[0],color=c,lw=2,label=label) for c,label in [('#777777','Observed experimental receptor'),(col['native'],'Experimental VHH'),(col['seed2_model_4'],'ConfoVHH choice'),(col['seed2_model_0'],'Confidence / best DockQ'),('#d9a430','Unobserved T4L fusion'),('#df8248','Other unobserved receptor')]]
fig.legend(handles=handles,loc='outside lower center',ncols=3,frameon=False)
for ext in ('png','pdf','svg'):fig.savefig(OUT/f'receptor-aligned-overlays.{ext}',dpi=190,bbox_inches='tight')
plt.close(fig)

fig,axes=plt.subplots(1,2,figsize=(13,5.4),layout='constrained',sharex=True,sharey=True)
for ax,id in zip(axes,('seed2_model_4','seed2_model_0')):
    cc=set(contacts[id]);nn=set(native45);common=cc&nn;extra=cc-nn;missing=nn-cc
    for pp,color,marker,label in [(missing,'#14805e','o','Native contact absent in model'),(common,'#383c41','s','Native contact recovered'),(extra,col[id],'x','Model contact absent/unobserved in native')]:
        if pp:xx,yy=zip(*pp);ax.scatter(xx,yy,c=color,marker=marker,s=22,label=label,alpha=.8)
    ax.axvspan(236,401,color='#d9a430',alpha=.17,label='Native-unobserved insertion region')
    ax.set_title(id);ax.set_xlabel('Receptor A · full input label_seq_id');ax.set_xlim(1,501);ax.set_ylim(1,126);ax.grid(alpha=.15)
axes[0].set_ylabel('VHH B · full input label_seq_id')
hh,ll=axes[1].get_legend_handles_labels();fig.legend(hh,ll,loc='outside lower center',ncols=2,frameon=False,fontsize=9)
fig.suptitle('Interface contact maps at the frozen product 4.5 Å cutoff\nAll model residues included; native-unobserved contacts have unknown experimental status',fontsize=14)
for ext in ('png','pdf','svg'):fig.savefig(OUT/f'interface-contact-maps.{ext}',dpi=190,bbox_inches='tight')
plt.close(fig)

# Common-frame PDBs for interactive inspection. Residue numbers are label_seq_id.
def write_pdb(name,at):
    ss=[]
    for n,(k,a) in enumerate(sorted(at.items()),1):
        x,y,z=a['xyz'];ss.append(f'ATOM  {n:5d} {a["name"]:^4s} {a["resname"]:3s} {a["chain"]}{a["label"]:4d}    {x:8.3f}{y:8.3f}{z:8.3f}{1.0:6.2f}{a["bfactor"]:6.2f}          {a["element"]:>2s}  ')
    (OUT/name).write_text('REMARK Label-sequence residue numbering; coordinates in experimental receptor frame\n'+'\n'.join(ss)+'\nEND\n')
write_pdb('reference-label-numbered.pdb',native)
for id in ('seed2_model_0','seed2_model_4'):write_pdb(id+'-receptor-aligned.pdb',aligned[id])

# Post hoc sensitivity only: DockQ numeric mapping after explicitly renumbering
# the reference to deposited label_seq_id. This disambiguates the repeat His tag.
# Preserve the native protein atom identities and coordinates, including all gaps.
mapping_sensitivity=[]
for id in IDS:
    model=dq.load_PDB(str(EVAL/f'artifacts/{id}/3P0G_{id}.cif'),chains=['A','B'])
    reference=dq.load_PDB(str(OUT/'reference-label-numbered.pdb'),chains=['A','B'])
    result,total=dq.run_on_all_native_interfaces(model,reference,chain_map={'A':'A','B':'B'},no_align=True,capri_peptide=False)
    old=json.loads((EVAL/f'{id}.dockq-api.json').read_text())['metrics'];rr=result['AB'];record={'id':id,'original_frozen_DockQ':old['DockQ'],'exact_label_mapping_DockQ':float(rr['DockQ']),'delta_DockQ':float(rr['DockQ']-old['DockQ']),'original_frozen_LRMSD_A':old['LRMSD'],'exact_label_mapping_LRMSD_A':float(rr['LRMSD']),'original_frozen_iRMSD_A':old['iRMSD'],'exact_label_mapping_iRMSD_A':float(rr['iRMSD']),'native_contact_count':int(rr['nat_total']),'original_native_contacts_recovered':int(old['nat_correct']),'exact_label_native_contacts_recovered':int(rr['nat_correct'])}
    expected=next(r for r in rows if r['id']==id)
    assert abs(record['exact_label_mapping_LRMSD_A']-expected['ligand_backbone_RMSD_after_receptor_fit_A'])<1e-4
    assert record['exact_label_native_contacts_recovered']==expected['native_contact_recovered_5_A']
    mapping_sensitivity.append(record)
    for name in ('align_chains','get_aligned_residues','get_residue_distances','list_atoms_per_residue','subset_atoms','run_on_chains'):
        clear=getattr(getattr(dq,name,None),'cache_clear',None)
        if clear:clear()
save('dockq-label-mapping-sensitivity.json',{'status':'COMPLETE','classification':'post_hoc_evaluation_mapping_sensitivity_not_replacement_of_frozen_result','description':'Original sequence mapping aligns observed native terminal His121/122 to modelHis125/126 because the input has a repeated six-His tail. All284 observed receptor positions and119 VHH positions map exactly. Numbering-based DockQ on deposited label numbering disambiguates the two His positions; no coordinate geometry changed. The frozen scores remain authoritative for the frozen pilot. This is a repeat-tag alignment limitation, not a chain-role swap or ConfoVHH implementation bug.','reference_label_numbered_sha256':sha(OUT/'reference-label-numbered.pdb'),'DockQ_module_sha256':sha(dq.__file__),'method':'DockQ.run_on_all_native_interfaces(chain_map={A:A,B:B}, no_align=True, capri_peptide=False), native reference protein same coordinates with residue numbers set to deposited label_seq_id','candidates':mapping_sensitivity,'frozen_best':max(mapping_sensitivity,key=lambda r:r['original_frozen_DockQ'])['id'],'sensitivity_best':max(mapping_sensitivity,key=lambda r:r['exact_label_mapping_DockQ'])['id'],'all_native_contact_counts_unchanged':all(r['original_native_contacts_recovered']==r['exact_label_native_contacts_recovered'] for r in mapping_sensitivity)})
with (OUT/'dockq-label-mapping-sensitivity.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(mapping_sensitivity[0]));w.writeheader();w.writerows(mapping_sensitivity)
def describe_path(p):return str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)
save('analysis-provenance.json',{'script_sha256':sha(__file__),'command_arguments':sys.argv,'python':sys.version,'numpy':np.__version__,'matplotlib':matplotlib.__version__,'source_artifacts':[{'path':describe_path(p),'sha256':sha(p)} for p in [REF,NATIVE_PROTEIN,CASE/'3P0G-case-metadata-summary.json',CASE/'3P0G-A-label-auth-sequence.tsv',CASE/'3P0G-B-label-auth-sequence.tsv',CASE/'3P0G-depositor-construct-vs-uniprot.json']],'outputs':[{'path':p.name,'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='analysis-provenance.json']})
print(json.dumps({'status':'COMPLETE','candidates':[{'id':r['id'],'contacts':r['all_residue_contacts_4p5_A'],'clashes':r['all_reported_clash_residue_pairs'],'regional':r['regional_contacts_4p5_A'],'fit_RMSD':r['receptor_backbone_fit_RMSD_A'],'LRMSD':r['ligand_backbone_RMSD_after_receptor_fit_A'],'native_contacts':r['native_contact_recovered_5_A']} for r in rows],'DockQ_mapping_summary':{c:{k:v for k,v in rec.items() if k not in ('pairs','alignment')} for c,rec in dockq_mapping.items()}},indent=2))
