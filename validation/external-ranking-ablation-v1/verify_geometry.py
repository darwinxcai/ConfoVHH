"""Independent Bio.PDB geometry audit. Does not read ranks or accuracy labels.

Usage: .venv/bin/python verify_geometry.py --root .
Root contains score-manifest.json and scores/{pose_id}/{audit,overlaps}.json.
Bio.PDB supplies polymer/chain/residue/atom identity. MMCIF2Dict and original
PDB coordinate fields preserve decimal-to-float64 coordinates; Bio.PDB's
float32 coordinate roundtrip is separately checked, not used for geometry.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
import csv
import hashlib
import json
from pathlib import Path
import sys
import warnings

import Bio
from Bio.PDB import MMCIFParser, PDBParser
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1
import numpy as np
import scipy
from scipy.spatial.distance import cdist

RADII={'C':1.7,'N':1.55,'O':1.52,'S':1.8,'P':1.8,'SE':1.9,
       'H':1.2,'F':1.47,'CL':1.75,'BR':1.85,'I':1.98}
CANONICAL=set('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL'.split())|{'MSE','SEC','PYL'}
CONTACT=4.5
SEVERE=.6
TOL=1e-8

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

@dataclass(frozen=True)
class Item:
    chain: str
    residue: str
    residue_name: str
    atom_name: str
    element: str
    coord: tuple[float,float,float]

def exact_coordinates(path,fmt):
    """Use Bio's mmCIF lexer; only six fixed PDB fields are read directly."""
    if fmt=='mmcif':
        d=MMCIF2Dict(str(path))
        chain_ids=d.get('_atom_site.auth_asym_id',d['_atom_site.label_asym_id'])
        columns=[chain_ids]+[d['_atom_site.'+k] for k in ['id','Cartn_x','Cartn_y','Cartn_z']]
        rows=[((chain,int(i)),(float(x),float(y),float(z))) for chain,i,x,y,z in zip(*columns)]
    else:
        rows=[((s[21],int(s[6:11])),(float(s[30:38]),float(s[38:46]),float(s[46:54])))
              for s in path.read_text().splitlines() if s.startswith(('ATOM  ','HETATM'))]
    result=dict(rows)
    if len(result)!=len(rows):
        raise ValueError('Atom serials within a chain are not unique; multi-model or duplicate-serial adjudication required')
    return result

def parse_atoms(path,fmt,chains):
    parser=MMCIFParser(QUIET=False) if fmt=='mmcif' else PDBParser(QUIET=False)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        structure=parser.get_structure('raw',str(path))
    if len(structure)!=1:
        raise ValueError('Expected exactly one source model')
    model=structure[0]
    if set(chains)-set(c.id for c in model):
        raise ValueError('Requested chain absent')
    exact=exact_coordinates(path,fmt)
    atoms=[];sequences={};ignored=Counter();selected=Counter();roundtrip_max=0.0
    for chain_id in chains:
        chain=model[chain_id]
        sequence=[]
        residue_order=0
        for residue in chain:
            if residue.resname not in CANONICAL:
                ignored['nonpolymer_residues']+=1
                continue
            residue_order+=1
            if residue.is_disordered():
                raise ValueError(f'Disordered residue {chain_id} {residue.id}: altloc adjudication required')
            sequence.append(seq1(residue.resname,custom_map={'MSE':'M','SEC':'U','PYL':'O'}))
            rnumber=residue.id[1];icode=residue.id[2].strip()
            key=json.dumps([chain_id,rnumber,icode,residue_order],separators=(',',':')) if fmt=='mmcif' else f'{chain_id}:{rnumber}:{icode}'
            for atom in residue:
                if atom.is_disordered() or atom.get_altloc().strip():
                    raise ValueError('Disordered atom requires explicit independent altloc adjudication')
                element=atom.element.strip().upper()
                if element in {'H','D'}:
                    ignored['hydrogen_deuterium_atoms']+=1
                    continue
                occupancy=atom.get_occupancy()
                occupancy=1.0 if occupancy is None else occupancy
                if not 0<=occupancy<=1:
                    raise ValueError('Invalid atom occupancy')
                if occupancy==0:
                    ignored['zero_occupancy_atoms']+=1
                    continue
                xyz=exact[(chain_id,int(atom.get_serial_number()))]
                error=float(np.max(np.abs(np.asarray(xyz)-np.asarray(atom.coord,dtype=np.float64))))
                expected=np.asarray(xyz,dtype=np.float32).astype(np.float64)
                if not np.array_equal(expected,np.asarray(atom.coord,dtype=np.float64)):
                    raise ValueError('Bio.PDB identity does not match exact-decimal coordinate roundtrip')
                roundtrip_max=max(roundtrip_max,error)
                if not np.isfinite(xyz).all():
                    raise ValueError('Nonfinite coordinate')
                atoms.append(Item(chain_id,key,residue.resname,atom.get_name(),element,xyz))
                selected[element]+=1
        sequences[chain_id]=''.join(sequence)
    return atoms,sequences,{'ignored':dict(ignored),'elements':dict(selected),
        'biopdb_float32_roundtrip_max_error':roundtrip_max,
        'parser_warnings':sorted({str(w.message) for w in caught})}

def geometry(receptor,vhh):
    x=np.asarray([a.coord for a in receptor],dtype=np.float64)
    y=np.asarray([a.coord for a in vhh],dtype=np.float64)
    distance=cdist(x,y,metric='euclidean')
    ri,vi=np.nonzero(distance<=CONTACT)
    contacts={}
    severe_atoms=0
    for i,j in zip(ri,vi):
        a,b=receptor[i],vhh[j]
        key=(a.residue,b.residue)
        contacts.setdefault(key,0.0)
        d=distance[i,j]
        disulfide=(a.residue_name==b.residue_name=='CYS' and
                   a.atom_name==b.atom_name=='SG' and 1.8<=d<=2.3)
        if disulfide:
            continue
        overlap=max(0.0,RADII.get(a.element,1.7)+RADII.get(b.element,1.7)-d)
        if overlap>=SEVERE:
            severe_atoms+=1
        contacts[key]=max(contacts[key],float(overlap))
    n=len(contacts)
    severe_residues=sum(o>=SEVERE for o in contacts.values())
    q=sum((o/SEVERE)**2 for o in contacts.values())/n if n else 0.0
    return {'contacts':n,'clashes':severe_residues,'atomContacts':len(ri),
            'maximumOverlap':max(contacts.values(),default=0.0),'overlapBurden':q,
            'severe_atom_pair_count_diagnostic':severe_atoms,
            'census':contacts}

def self_checks():
    def atom(chain,key,name,element,x,res='ALA'):
        return Item(chain,key,res,name,element,(x,0.,0.))
    a=atom('R','R1','C','C',0.)
    b=atom('V','V1','O','O',2.)
    g=geometry([a],[b])
    assert (g['contacts'],g['clashes'],g['atomContacts'])==(1,1,1)
    assert abs(g['overlapBurden']-((1.7+1.52-2)/.6)**2)<1e-12
    # Multiple atom contacts contribute their maximum overlap to one residue pair.
    g=geometry([a],[b,atom('V','V1','N','N',3.0)])
    assert g['contacts']==1 and g['atomContacts']==2
    assert abs(g['overlapBurden']-((1.7+1.52-2)/.6)**2)<1e-12
    g=geometry([a],[atom('V','V1','C','C',4.5)])
    assert g['contacts']==1 and g['overlapBurden']==0
    g=geometry([a],[atom('V','V1','C','C',4.500001)])
    assert g['contacts']==0
    sg=atom('R','R1','SG','S',0.,'CYS')
    g=geometry([sg],[atom('V','V1','SG','S',2.,'CYS')])
    assert g['contacts']==1 and g['clashes']==0 and g['overlapBurden']==0
    g=geometry([sg],[atom('V','V1','SG','S',1.7,'CYS')])
    assert g['clashes']==1
    return 6

def compare_inventory(atoms,expected):
    def key(a):
        return (a.chain,a.residue,a.residue_name,a.atom_name,a.element,*a.coord)
    observed=Counter(key(a) for a in atoms)
    frozen=Counter((a['chain'],a['residue'],a['residueName'],a['atomName'],a['element'],a['x'],a['y'],a['z']) for a in expected)
    missing=list((frozen-observed).elements())
    extra=list((observed-frozen).elements())
    return {'matches_exactly':observed==frozen,'missing_count':len(missing),'extra_count':len(extra),
            'missing_examples':missing[:3],'extra_examples':extra[:3]}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parent)
    ap.add_argument('--scores',default='scores')
    ap.add_argument('--out',default='independent_geometry')
    args=ap.parse_args();root=args.root.resolve();score_dir=root/args.scores;outdir=root/args.out
    outdir.mkdir(parents=True,exist_ok=True)
    checks=self_checks()
    manifest_path=root/'score-manifest.json'
    manifest=json.loads(manifest_path.read_text())
    receipt_path=score_dir/'receipt.json'
    assert receipt_path.is_file(),'Scoring receipt required before auditing completed scores'
    settings={s['id']:s for s in manifest['sets']}
    attempts=manifest['attempts']
    assert len(attempts)==395, len(attempts)
    results=[];errors=[];sequences=defaultdict(Counter)
    for n,attempt in enumerate(attempts,1):
        pose_id=attempt['id'];set_id=attempt['setId'];config=settings[set_id]
        coordinate=root/attempt['coordinate']['path']
        try:
            assert digest(coordinate)==attempt['coordinate']['sha256'],'Coordinate source hash mismatch'
            atoms,seq,parseinfo=parse_atoms(coordinate,attempt['coordinate']['format'],[config['receptorChain'],config['vhhChain']])
            observed=geometry([a for a in atoms if a.chain==config['receptorChain']],[a for a in atoms if a.chain==config['vhhChain']])
            overlaps_path=score_dir/pose_id/'overlaps.json'
            audit_path=score_dir/pose_id/'audit.json'
            expected=json.loads(overlaps_path.read_text())
            audit=json.loads(audit_path.read_text())['audit']
            inventory=compare_inventory(atoms,expected['atomInventory'])
            mismatches=[]
            if not inventory['matches_exactly']:mismatches.append('atom_inventory')
            field_deltas={}
            for field in ['contacts','clashes','atomContacts','maximumOverlap','overlapBurden']:
                delta=abs(observed[field]-expected[field]);field_deltas[field]=delta
                if delta>(0 if field in ['contacts','clashes','atomContacts'] else TOL):mismatches.append(field)
            for field,independent in [('contactPairCount','contacts'),('severeClashCount','clashes'),('atomContactCount','atomContacts'),('maximumOverlapAngstrom','maximumOverlap')]:
                delta=abs(audit[field]-observed[independent])
                if delta>(TOL if 'Overlap' in field else 0):mismatches.append('audit.'+field)
            frozen_census={(p['receptorResidue'],p['vhhResidue']):p['positiveOverlap'] for p in expected['census']}
            census_keys=observed['census'].keys()==frozen_census.keys()
            census_delta=max((abs(v-frozen_census.get(k,float('inf'))) for k,v in observed['census'].items()),default=0.0)
            if not census_keys or census_delta>TOL:mismatches.append('overlap_census')
            for chain,sequence in seq.items():sequences[(set_id,chain)][sequence]+=1
            unknown=sorted({a.element for a in atoms if a.element not in RADII})
            if unknown:mismatches.append('unknown_element_requires_adjudication')
            result={'id':pose_id,'set_id':set_id,'coordinate':attempt['coordinate']['path'],
                    'coordinate_sha256':attempt['coordinate']['sha256'],
                    'overlaps_sha256':digest(overlaps_path),'audit_sha256':digest(audit_path),
                    'passed':not mismatches,'mismatches':mismatches,'inventory':inventory,
                    'deltas':field_deltas,'census_max_delta':census_delta,
                    'independent':{k:v for k,v in observed.items() if k!='census'},
                    'sequence_lengths':{c:len(s) for c,s in seq.items()},'parser':parseinfo}
            results.append(result)
            if mismatches:errors.append({'id':pose_id,'mismatches':mismatches})
        except Exception as e:
            errors.append({'id':pose_id,'error':f'{type(e).__name__}: {e}'})
        if n%50==0:print(f'Audited {n}/{len(attempts)}, flagged {len(errors)}',flush=True)
    sequence_report=[]
    for (set_id,chain),counts in sorted(sequences.items()):
        entry={'set_id':set_id,'chain':chain,'unique_sequences':len(counts),
               'sequences':[{'sequence':seq,'sha256':hashlib.sha256(seq.encode()).hexdigest(),'rows':count,'length':len(seq)} for seq,count in counts.items()]}
        sequence_report.append(entry)
        if len(counts)!=1:errors.append({'set_id':set_id,'chain':chain,'error':'Sequence variation within set'})
    summary={'status':'PASS' if not errors and len(results)==395 else 'FAIL',
        'independently_parsed_rows':len(results),'expected_rows':395,'failed_rows':len(errors),
        'self_check_cases':checks,'geometry_tolerance':TOL,'contact_and_clash_counts_require_exact_match':True,
        'atom_inventory_requires_exact_match':True,'uses_original_decimal_float64_coordinates':True,
        'environment':{'python':sys.version,'numpy':np.__version__,'biopython':Bio.__version__,'scipy':scipy.__version__},
        'manifest_path':'score-manifest.json','manifest_sha256':digest(manifest_path),
        'score_receipt_path':str(receipt_path.relative_to(root)),'score_receipt_sha256':digest(receipt_path),
        'script_sha256':digest(Path(__file__)),'sequence_checks':sequence_report,'errors':errors,
        'max_deltas':{k:max((r['deltas'][k] for r in results),default=None) for k in ['contacts','clashes','atomContacts','maximumOverlap','overlapBurden']},
        'census_max_delta':max((r['census_max_delta'] for r in results),default=None)}
    (outdir/'per_pose_verification.json').write_text(json.dumps(results,indent=2)+'\n')
    (outdir/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k not in {'sequence_checks','errors'}},indent=2))
    if errors:print(json.dumps({'error_examples':errors[:10]},indent=2))
    if summary['status']!='PASS':raise SystemExit(1)

if __name__=='__main__':main()
