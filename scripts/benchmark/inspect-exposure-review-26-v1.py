#!/usr/bin/env python3
"""Native eligibility evidence only; no predictor, selector, or accuracy outcomes."""
import argparse,hashlib,json,time,itertools
from pathlib import Path
import numpy as np
from Bio.PDB.kdtrees import KDTree
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1

def table(d, prefix):
 keys=[k for k in d if k.startswith(prefix+'.')]
 return [{k.split('.',1)[1]:d[k][i] for k in keys} for i in range(len(d[keys[0]]))] if keys else []
def inspect(path):
 d=MMCIF2Dict(str(path));polys=table(d,'_entity_poly');entities={r['id']:r for r in table(d,'_entity')};sequences={};chains={};chosen={}
 for r in polys:
  r['sequence']=''.join(r['pdbx_seq_one_letter_code_can'].split());r['length']=len(r['sequence']);r['sequenceSha256']=hashlib.sha256(r['sequence'].encode()).hexdigest();r['description']=entities[r['entity_id']]['pdbx_description'];sequences[r['entity_id']]=r['sequence']
 for r in table(d,'_atom_site'):
  if r.get('pdbx_PDB_model_num','1')!='1' or r['type_symbol'] in ('H','D') or r['label_seq_id'] in ('.','?') or float(r['occupancy'])<=0:continue
  key=(r['label_asym_id'],r['label_seq_id'],r['label_atom_id']);old=chosen.get(key)
  if old is None or float(r['occupancy'])>float(old['occupancy']):chosen[key]=r
 for r in chosen.values():
  ch=r['label_asym_id'];seqid=int(r['label_seq_id']);eid=r['label_entity_id'];aa=seq1(r['label_comp_id'],custom_map={'MSE':'M','YCM':'C','SEP':'S','TPO':'T','PTR':'Y'})
  c=chains.setdefault(ch,{'labelChain':ch,'authorChain':r['auth_asym_id'],'entityId':eid,'description':entities[eid]['pdbx_description'],'depositedLength':len(sequences[eid]),'residueMapping':{},'xyz':[],'resids':[],'sequenceMismatch':[]})
  expected=sequences[eid][seqid-1]
  if expected!=aa and (seqid,r['label_comp_id'],expected) not in c['sequenceMismatch']:c['sequenceMismatch'].append((seqid,r['label_comp_id'],expected))
  c['residueMapping'][seqid]={'labelResidue':seqid,'authorResidue':r['auth_seq_id'],'insertionCode':r['pdbx_PDB_ins_code'],'residue':r['label_comp_id'],'expected':expected}
  c['xyz'].append([float(r['Cartn_'+a]) for a in 'xyz']);c['resids'].append(seqid)
 pairs=[]
 for ac,bc in itertools.combinations(chains,2):
  a,b=chains[ac],chains[bc];x,y=np.array(a['xyz']),np.array(b['xyz']);tree=KDTree(np.ascontiguousarray(y),10);contacts=set();distances=[]
  for i,point in enumerate(x):
   for hit in tree.search(point,4.5):contacts.add((a['resids'][i],b['resids'][hit.index]));distances.append(hit.radius)
  mind=min(distances) if distances else None
  pairs.append({'labelChains':[ac,bc],'authorChains':[a['authorChain'],b['authorChain']],'entities':[a['entityId'],b['entityId']],'residuePairsWithin4_5Angstrom':len(contacts),'minimumHeavyAtomDistanceIfWithin4_5':mind,'contactResiduePairs':sorted(contacts)})
 for c in chains.values():
  c['observedResidues']=len(c['residueMapping']);c['residueMapping']=[c['residueMapping'][i] for i in sorted(c['residueMapping'])];c['selectedHeavyAtoms']=len(c.pop('xyz'));c.pop('resids')
 categories=['_struct','_exptl','_refine','_em_3d_reconstruction','_citation','_struct_ref','_struct_ref_seq','_struct_ref_seq_dif','_pdbx_entity_src_syn','_entity_src_gen','_pdbx_struct_assembly','_pdbx_struct_assembly_gen','_pdbx_struct_oper_list','_pdbx_database_status']
 return {'pdbId':path.stem,'sourceUrl':f'https://files.rcsb.org/download/{path.name}','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'polymers':polys,'chains':list(chains.values()),'pairContacts':pairs,'categories':{k:table(d,k) for k in categories},'limitations':'Model 1, deposited coordinates. Highest-occupancy alternate per atom; first in file on ties. Native heavy-atom proximity supports deposited geometry only, not biochemical direct-binding evidence or local-density quality. Assembly operators retained; no symmetry-generated contacts silently assumed. No selector or prediction accuracy computation.'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--raw',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 root=Path(__file__).resolve().parents[2];ids=json.loads((root/'validation/exposure-review-26-v1/review-plan.json').read_text())['fixedPdbOrder'];results=[];start=time.monotonic()
 for pdb in ids:
  result=inspect(a.raw/(pdb+'.cif'));(a.output/(pdb+'.json')).write_text(json.dumps(result,indent=2)+'\n')
  summary={'pdbId':pdb,'polymers':[{k:x[k] for k in ('entity_id','description','length','pdbx_strand_id','sequenceSha256')} for x in result['polymers']],'observed':[{k:x[k] for k in ('labelChain','authorChain','entityId','observedResidues','sequenceMismatch')} for x in result['chains']],'citations':result['categories']['_citation'],'resolution':result['categories']['_refine']+result['categories']['_em_3d_reconstruction']};results.append(summary);print(pdb,[(x['description'],x['length'],x['pdbx_strand_id']) for x in result['polymers']],flush=True)
 (a.output/'summary.json').write_text(json.dumps({'seconds':time.monotonic()-start,'results':results},indent=2)+'\n')
if __name__=='__main__':main()
