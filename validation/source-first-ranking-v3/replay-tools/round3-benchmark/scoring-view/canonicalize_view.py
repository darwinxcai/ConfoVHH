#!/usr/bin/env python3
"""Bijective coordinate-preserving virtual-chain scoring views; never a covalent model.

All original atom rows are retained. Only chain/entity/atom/residue identifiers change.
For mmCIF input coordinate, occupancy, B-factor and other atom field strings survive
without float conversion. Native symmetry choices are a caller-frozen assignment.
"""
from __future__ import annotations
import argparse, collections, hashlib, io, json, pathlib, re
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.PDB import MMCIFIO

PREFIX='_atom_site.'
CHANGED={'id','label_asym_id','auth_asym_id','label_entity_id','label_seq_id','auth_seq_id'}
IDENTITY=['group_PDB','id','label_atom_id','auth_atom_id','label_alt_id','label_comp_id','auth_comp_id','label_asym_id','auth_asym_id','label_entity_id','label_seq_id','auth_seq_id','pdbx_PDB_ins_code','pdbx_PDB_model_num']
def digest(data):return hashlib.sha256(data).hexdigest()
def packed(obj):return json.dumps(obj,sort_keys=True,separators=(',',':')).encode()
def missing(s):return s in [None,'.','?','']
def integer(s):return bool(re.fullmatch(r'[+-]?\d+',str(s)))
def read_atoms(path):
    path=pathlib.Path(path);data=path.read_bytes(); text=data.decode('utf-8')
    if path.suffix.lower() in ['.cif','.mmcif'] or text.lstrip().startswith('data_'):
        doc=MMCIF2Dict(io.StringIO(text));cols=[k[len(PREFIX):] for k in doc if k.startswith(PREFIX)]
        if not cols:raise ValueError('No atom_site loop')
        n=len(doc[PREFIX+cols[0]])
        if any(len(doc[PREFIX+c])!=n for c in cols):raise ValueError('Ragged atom_site loop')
        rows=[{c:doc[PREFIX+c][i] for c in cols} for i in range(n)]
        return data,doc,cols,rows,'mmcif'
    cols=['group_PDB','id','type_symbol','label_atom_id','label_alt_id','label_comp_id','label_asym_id','label_entity_id','label_seq_id','pdbx_PDB_ins_code','Cartn_x','Cartn_y','Cartn_z','occupancy','B_iso_or_equiv','auth_seq_id','auth_comp_id','auth_asym_id','auth_atom_id','pdbx_PDB_model_num']
    rows=[];model='1'
    for line in text.splitlines():
        if line.startswith('MODEL '):model=line[10:14].strip() or '1'
        if not line.startswith(('ATOM  ','HETATM')):continue
        if len(line)<54:raise ValueError('Truncated PDB atom line')
        chain=line[21:22].strip() or '_';atom=line[12:16].strip();res=line[17:20].strip()
        vals=[line[:6].strip(),line[6:11].strip(),line[76:78].strip() if len(line)>=78 else atom[0],atom,line[16:17].strip() or '.',res,chain,'?', '?',line[26:27].strip() or '?',line[30:38].strip(),line[38:46].strip(),line[46:54].strip(),line[54:60].strip() or '1.00',line[60:66].strip() or '0.00',line[22:26].strip(),res,chain,atom,model]
        rows.append(dict(zip(cols,vals)))
    if not rows:raise ValueError('No PDB atom records')
    return data,{},cols,rows,'pdb'

def canonicalize_view(input_path,output_path,receptor_chains,selected_nb,chain_namespace='auth',keep_context=True):
    """Create R/V view and .mapping.json/.receipt.json sidecars; refuse overwrite.

    `chain_namespace` explicitly selects auth_asym_id or label_asym_id. Author IDs
    must resolve to a unique polymer label chain; ambiguity fails closed.
    All unselected atom rows are context, including waters/ligands sharing auth IDs.
    """
    if chain_namespace not in ['auth','label']:raise ValueError('chain_namespace must be auth or label')
    if not receptor_chains or len(set(receptor_chains+[selected_nb]))!=len(receptor_chains)+1:raise ValueError('Distinct ordered receptor and selected Nb chains required')
    source,doc,cols,rows,fmt=read_atoms(input_path)
    outpath=pathlib.Path(output_path);mapping_path=outpath.with_suffix('.mapping.json');receipt_path=outpath.with_suffix('.receipt.json')
    for p in [outpath,mapping_path,receipt_path]:
        if p.exists():raise FileExistsError(p)
    defaults={'auth_asym_id':lambda r:r['label_asym_id'],'auth_seq_id':lambda r:r.get('label_seq_id','?'),'label_entity_id':lambda r:'?','label_seq_id':lambda r:'?','id':lambda r:'?','pdbx_PDB_model_num':lambda r:'1','pdbx_PDB_ins_code':lambda r:'?','label_alt_id':lambda r:'.','auth_atom_id':lambda r:r['label_atom_id'],'auth_comp_id':lambda r:r['label_comp_id']}
    for c,fn in defaults.items():
        if c not in cols:
            cols.append(c)
            for row in rows:row[c]=fn(row)
    for c in ['Cartn_x','Cartn_y','Cartn_z','label_asym_id','label_comp_id','label_atom_id']:
        if c not in cols:raise ValueError('Missing required atom field '+c)
    label_rows=collections.OrderedDict()
    for i,row in enumerate(rows):label_rows.setdefault(row['label_asym_id'],[]).append(i)
    polymer_labels=set()
    for lab,indices in label_rows.items():
        if any(integer(rows[i]['label_seq_id']) or rows[i].get('group_PDB')=='ATOM' for i in indices):polymer_labels.add(lab)
    def resolve(chain):
        if chain_namespace=='label':matches=[chain] if chain in polymer_labels else []
        else:matches=[lab for lab in polymer_labels if any(rows[i]['auth_asym_id']==chain for i in label_rows[lab])]
        if len(matches)!=1:raise ValueError(f'{chain_namespace} chain {chain!r} resolves to {matches}; require one polymer label chain')
        return matches[0]
    rlabels=[resolve(c) for c in receptor_chains];vlabel=resolve(selected_nb)
    if len(set(rlabels+[vlabel]))!=len(rlabels)+1:raise ValueError('Role labels collide')
    selected=rlabels+[vlabel];context=[lab for lab in label_rows if lab not in selected]
    if not keep_context:raise ValueError('Dropping context is disabled: this utility preserves every atom row')
    output_chains={lab:'R' for lab in rlabels}|{vlabel:'V'}|{lab:'X'+str(i+1) for i,lab in enumerate(context)}
    new_entities={chain:str(i+1) for i,chain in enumerate(dict.fromkeys(output_chains.values()))}
    residue_maps={};segments=[];offset=0
    for lab in selected+context:
        indices=label_rows[lab];positions=collections.OrderedDict()
        for i in indices:
            row=rows[i];key=(row['label_seq_id'] if integer(row['label_seq_id']) else '?',row['auth_seq_id'],row['pdbx_PDB_ins_code'])
            positions.setdefault(key,[]).append(i)
        all_labels=all(integer(k[0]) for k in positions)
        if any(integer(k[0]) for k in positions) and not all_labels:raise ValueError('Mixed present/absent label sequence IDs in '+lab)
        position_number={}
        if all_labels:
            for k in positions:
                if int(k[0])<1:raise ValueError('Nonpositive polymer label sequence ID')
                position_number[k]=int(k[0])
            # Distinct author positions cannot collapse into one virtual residue.
            if len(set(position_number.values()))!=len(position_number):raise ValueError('Ambiguous label-to-author residue mapping in '+lab)
            length=max(position_number.values())
            entities={rows[i]['label_entity_id'] for i in indices}
            entcols=doc.get('_entity_poly_seq.entity_id',[]); nums=doc.get('_entity_poly_seq.num',[])
            declared=[int(n) for e,n in zip(entcols,nums) if e in entities and integer(n)]
            if declared:length=max(length,max(declared))
            numbering_basis='original-label-seq-id; offset by declared polymer length when available'
        else:
            keys=list(positions)
            if all(integer(k[1]) for k in keys):
                keys.sort(key=lambda k:(int(k[1]),'' if missing(k[2]) else k[2]));used=0;last=None
                for k in keys:
                    n=int(k[1]);used=1 if last is None else used+(1 if last==n else n-last);position_number[k]=used;last=n
                length=max(position_number.values());numbering_basis='author-number gaps preserved; insertion variants disambiguated; no full-sequence claim'
            else:
                position_number={k:i+1 for i,k in enumerate(keys)};length=len(keys);numbering_basis='observed context residue order (non-numeric author identifiers)'
        base=offset if lab in rlabels else 0
        for k,num in position_number.items():residue_maps[(lab,k)]=str(base+num)
        segments.append({'outputChain':output_chains[lab],'originalLabelChain':lab,'originalAuthChains':sorted({rows[i]['auth_asym_id'] for i in indices}),'role':'receptor' if lab in rlabels else 'selectedNb' if lab==vlabel else 'context','residueOffset':base,'segmentLength':length,'observedResidues':len(positions),'missingPositions':[base+i for i in range(1,length+1) if i not in set(position_number.values())] if lab in polymer_labels else [],'numberingBasis':numbering_basis,'covalentLinkToPreviousSegment':False})
        if lab in rlabels:offset+=length
    transformed=[];atom_map=[];residue_map=collections.OrderedDict()
    for i,row in enumerate(rows):
        lab=row['label_asym_id'];key=(row['label_seq_id'] if integer(row['label_seq_id']) else '?',row['auth_seq_id'],row['pdbx_PDB_ins_code']);newnum=residue_maps[(lab,key)];chain=output_chains[lab]
        new=dict(row);new.update(id=str(i+1),label_asym_id=chain,auth_asym_id=chain,label_entity_id=new_entities[chain],label_seq_id=newnum,auth_seq_id=newnum)
        transformed.append(new)
        original={c:row[c] for c in IDENTITY};canon={c:new[c] for c in IDENTITY}
        atom_map.append({'sourceRow':i+1,'outputRow':i+1,'original':original,'canonical':canon})
        residue_map.setdefault((lab,key),{'originalLabelChain':lab,'originalAuthChain':row['auth_asym_id'],'originalLabelSeqId':row['label_seq_id'],'originalAuthSeqId':row['auth_seq_id'],'originalInsertionCode':row['pdbx_PDB_ins_code'],'canonicalChain':chain,'canonicalResidueId':newnum,'canonicalInsertionCode':row['pdbx_PDB_ins_code']})
    stable=lambda rs:[[r[c] for c in cols if c not in CHANGED] for r in rs]
    coords=lambda rs:[[r[c] for c in ['Cartn_x','Cartn_y','Cartn_z']] for r in rs]
    if stable(rows)!=stable(transformed):raise AssertionError('Nonidentifier atom field changed')
    output_dict={'data_':'CONFOVHH_VIRTUAL_VIEW','_confovhh_view.source_sha256':digest(source),'_confovhh_view.covalent_join':'no','_confovhh_view.description':'Virtual noncovalent scoring view; disconnected receptor protomers retain original coordinates and explicit source segments.'}
    for c in cols:output_dict[PREFIX+c]=[row[c] for row in transformed]
    writer=MMCIFIO();writer.set_dict(output_dict);buf=io.StringIO();writer.save(buf);outbytes=buf.getvalue().encode()
    reparsed=MMCIF2Dict(io.StringIO(outbytes.decode()))
    for c in cols:
        if reparsed[PREFIX+c]!=[row[c] for row in transformed]:raise AssertionError('CIF serialization changed tokens: '+c)
    outpath.parent.mkdir(parents=True,exist_ok=True);outpath.write_bytes(outbytes)
    mapping={'schema':'confovhh-bijective-virtual-view-map-v1','source':str(pathlib.Path(input_path).resolve()),'sourceSha256':digest(source),'output':str(outpath.resolve()),'outputSha256':digest(outbytes),'chainNamespace':chain_namespace,'requestedReceptorChains':receptor_chains,'requestedSelectedNb':selected_nb,'resolvedReceptorLabelChains':rlabels,'resolvedSelectedNbLabelChain':vlabel,'segments':segments,'residues':list(residue_map.values()),'atoms':atom_map}
    mapping_path.write_text(json.dumps(mapping,indent=2)+'\n')
    receipt={'schema':'confovhh-bijective-virtual-view-receipt-v1','sourcePath':str(pathlib.Path(input_path).resolve()),'sourceSha256':digest(source),'sourceFormat':fmt,'viewPath':str(outpath.resolve()),'viewSha256':digest(outbytes),'mapPath':str(mapping_path.resolve()),'mapSha256':digest(mapping_path.read_bytes()),'sourceAtoms':len(rows),'viewAtoms':len(transformed),'sourceCoordinateTokenSha256':digest(packed(coords(rows))),'viewCoordinateTokenSha256':digest(packed(coords(transformed))),'sourceUnchangedAtomFieldsSha256':digest(packed(stable(rows))),'viewUnchangedAtomFieldsSha256':digest(packed(stable(transformed))),'everyAtomRetained':True,'everyCoordinateTokenIdentical':True,'everyNonidentifierAtomFieldIdentical':True,'bijection':'source row to output row plus complete identity map','covalentJoinAsserted':False,'selectedNbFixed':True,'segments':segments,'scoringPerformed':False,'dockqPerformed':False}
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n');return receipt

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--receptor-chains',nargs='+',required=True);p.add_argument('--selected-nb',required=True);p.add_argument('--chain-namespace',choices=['auth','label'],required=True)
    a=p.parse_args();print(json.dumps(canonicalize_view(a.input,a.output,a.receptor_chains,a.selected_nb,a.chain_namespace)))
if __name__=='__main__':main()
