#!/usr/bin/env python3
"""Eligibility-only native mapping inspection; never a selector input."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1
p=argparse.ArgumentParser();p.add_argument('--references',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2];proof=json.loads((root/'validation/benchmark-eligibility-resolution-v1/sequence-resolution.json').read_text());results=[]
metadata=[]
for source in proof['inputs'][:2]:metadata.extend(json.loads(line) for line in (root/source['path']).read_text().splitlines())
for record in proof['results']:
 id=record['pdbId'];path=a.references/(id+'.cif');d=MMCIF2Dict(str(path));eid=record['entity']['entityId']; rec='A';vhh=record['entity']['authAsymIds'][0]
 entityseq=dict(zip(d['_entity_poly.entity_id'],[s.replace('\n','').replace(' ','') for s in d['_entity_poly.pdbx_seq_one_letter_code_can']]))
 assert entityseq[eid]==record['entity']['sequence'],'Current reference VHH differs from frozen metadata'
 frozen=next(r for r in metadata if r['pdbId']==id);receptor=next(e for e in frozen['polymerEntities'] if 'A' in e['authAsymIds'])
 assert entityseq[receptor['entityId']]==receptor['sequence'],'Current receptor differs from frozen metadata'
 input_sequences={rec:receptor['sequence'],vhh:record['entity']['sequence']}
 fasta=a.output.parent/(id+'-screened-constructs.fasta');fasta.write_text(''.join('>'+id+'_'+ch+'\n'+seq+'\n' for ch,seq in input_sequences.items()))
 atoms={};mapping={};selected=[]
 for i,ch in enumerate(d['_atom_site.auth_asym_id']):
  if d['_atom_site.pdbx_PDB_model_num'][i]!='1' or ch not in (rec,vhh) or d['_atom_site.type_symbol'][i] in ('H','D'):continue
  if d['_atom_site.label_seq_id'][i] in ('.','?'):continue
  label=int(d['_atom_site.label_seq_id'][i]);ent=d['_atom_site.label_entity_id'][i];res=d['_atom_site.label_comp_id'][i]
  assert entityseq[ent][label-1]==seq1(res,custom_map={'YCM':'C','MSE':'M'}),('residue mismatch',id,ch,label,res)
  mapping[(ch,label)]=dict(authResidue=d['_atom_site.auth_seq_id'][i],labelChain=d['_atom_site.label_asym_id'][i],entity=ent,residue=res)
  atoms.setdefault(ch,[]).append((label,np.array([float(d['_atom_site.Cartn_'+x][i]) for x in 'xyz'])))
 pairs=set();minsep=float('inf');xyz=np.array([v[1] for v in atoms[vhh]])
 for r,x in atoms[rec]:
  ds=np.linalg.norm(xyz-x,axis=1);minsep=min(minsep,float(ds.min()))
  for j in np.flatnonzero(ds<=4.5):pairs.add((r,atoms[vhh][j][0]))
 results.append(dict(pdbId=id,sourceUrl=f'https://files.rcsb.org/download/{id}.cif',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size,model='1',receptorAuthChain=rec,vhhAuthChain=vhh,metadataVhhExactSequenceMatch=True,metadataReceptorExactSequenceMatch=True,fullInputLengths={ch:len(seq) for ch,seq in input_sequences.items()},fullInputSequenceSha256={ch:hashlib.sha256(seq.encode()).hexdigest() for ch,seq in input_sequences.items()},canonicalInputSequences=all(set(seq)<=set('ACDEFGHIKLMNPQRSTVWY') for seq in input_sequences.values()),declaredResolutionAngstrom=frozen['resolutionAngstrom'],screenedConstructFastaSha256=hashlib.sha256(fasta.read_bytes()).hexdigest(),observedResiduesAllMatchEntityLabelSequence=True,observedResidueCounts={c:sum(k[0]==c for k in mapping) for c in (rec,vhh)},minimumHeavyAtomSeparationAngstrom=minsep,interfaceResiduePairsWithin4_5Angstrom=len(pairs),residueMapping=[dict(authChain=c,labelResidue=r,**v) for (c,r),v in sorted(mapping.items())],scope='Reference structural inspection for role and sequence mapping only; no prediction outcomes, no reference masks for selector, no density-based local-quality certification.'))
a.output.write_text(json.dumps(dict(schema='confovhh.reference-eligibility-inspection.v1',results=results),indent=2)+'\n');print([{k:v for k,v in r.items() if k not in ('residueMapping','scope')} for r in results])
