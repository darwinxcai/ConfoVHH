"""Synthetic/old-data tests only. No prospective native-comparison labels."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from Bio.PDB import MMCIFParser

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('adapter',HERE/'outcome_adapter.py')
adapter=importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)
ROOT=HERE.parents[1]
canonical=adapter.canonical_module(ROOT)

def manual_metrics(model_path,native_path,correspondence):
    """Independent NumPy metric, no DockQ parser, contacts, superposition or formula."""
    parser=MMCIFParser(QUIET=True)
    model=parser.get_structure('model',str(model_path))[0]; native=parser.get_structure('native',str(native_path))[0]
    def lookup(chain): return {adapter.residue_key(r):r for r in chain if r.id[0]==' '}
    mg={c:lookup(model[c]) for c in ['R','V']}; ng={c:lookup(native[c]) for c in ['R','V']}
    paired={c:[(mg[c][tuple(p['modelResidue'])],ng[c][tuple(p['nativeResidue'])]) for s in correspondence[c] for p in s['residuePairs']] for c in ['R','V']}
    def distance(a,b):
        aa=np.array([x.coord for x in a],dtype=np.float64); bb=np.array([x.coord for x in b],dtype=np.float64)
        return np.min(np.sum((aa[:,None,:]-bb[None,:,:])**2,axis=2))
    nat_total=sum(distance(a,b)<25 for a in ng['R'].values() for b in ng['V'].values())
    md=np.array([[distance(a[0],b[0]) for b in paired['V']] for a in paired['R']])
    nd=np.array([[distance(a[1],b[1]) for b in paired['V']] for a in paired['R']])
    fnat=float(np.sum((md<25)&(nd<25))/nat_total)
    bb=['C','CA','N','O']
    def atoms(pairs,indices=None):
        indices=range(len(pairs)) if indices is None else sorted(set(indices)); m=[]; n=[]
        for i in indices:
            a,b=pairs[i]
            for name in bb:
                if name in a and name in b: m.append(a[name].coord); n.append(b[name].coord)
        return np.array(m,dtype=np.float64),np.array(n,dtype=np.float64)
    def fit(m,n):
        mc=m.mean(0); nc=n.mean(0); u,_,vh=np.linalg.svd((m-mc).T@(n-nc)); rot=u@vh
        if np.linalg.det(rot)<0: u[:,-1]*=-1; rot=u@vh
        return rot,nc-mc@rot
    def rms(m,n): return float(np.sqrt(np.mean(np.sum((m-n)**2,axis=1))))
    contacts=np.nonzero(nd<100)
    mr,nr=atoms(paired['R'],contacts[0]); mv,nv=atoms(paired['V'],contacts[1]); mi=np.concatenate([mr,mv]); ni=np.concatenate([nr,nv])
    rot,tr=fit(mi,ni); irms=rms(mi@rot+tr,ni)
    receptor='R' if len(ng['R'])>len(ng['V']) else 'V'; ligand='V' if receptor=='R' else 'R'
    mr,nr=atoms(paired[receptor]); mv,nv=atoms(paired[ligand]); rot,tr=fit(mr,nr); lrms=rms(mv@rot+tr,nv)
    value=(fnat+1/(1+(irms/1.5)**2)+1/(1+(lrms/8.5)**2))/3
    return {'DockQ':value,'fnat':fnat,'iRMSD':irms,'LRMSD':lrms}

AA={'A':'ALA','C':'CYS','D':'ASP','E':'GLU','F':'PHE','G':'GLY','H':'HIS','I':'ILE','K':'LYS','L':'LEU','M':'MET','N':'ASN','P':'PRO','Q':'GLN','R':'ARG','S':'SER','T':'THR','V':'VAL','W':'TRP','Y':'TYR'}
def fixture(path, missing=False, context_shift=0., v_shift=0.):
    lines=[]; serial=1
    for chain,seq,base in [('A','ACDEFGHIKLMNPQRS',(0.,0.,0.)),('B','ACDEFGHIKLMNPQRS',(35.,3.,1.)),('C','YTWVLSNQ',(2.,3.5,0.)),('D','YTWVLSNQ',(37.,6.5,1.)),('E','YTWVLSNQ',(500.+context_shift,500.,0.))]:
        for i,aa in enumerate(seq,1):
            if missing and ((chain=='A' and i in [5,6]) or (chain=='B' and i in [10,11,12])): continue
            x=base[0]+i*1.7; y=base[1]+np.sin(i*.7); z=base[2]+np.cos(i*.4)
            if chain=='C': y+=v_shift
            if chain=='D': x+=context_shift
            for name,element,dx,dy,dz in [('N','N',-.4,0.,0.),('CA','C',0.,0.,0.),('C','C',.4,.2,0.),('O','O',.6,.4,.1),('CB','C',0.,-.5,.4)]:
                lines.append(f'ATOM  {serial:5d} {name:^4s} {AA[aa]:>3s} {chain}{i:4d}    {x+dx:8.3f}{y+dy:8.3f}{z+dz:8.3f}{1.:6.2f}{90.:6.2f}          {element:>2s}'); serial+=1
    path.write_text('\n'.join(lines)+'\nEND\n')

class OutcomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='confovhh-outcome-tests-')
        cls.dir=Path(cls.temp.name).resolve()/'execution-20260924'; cls.dir.mkdir()
        code=cls.dir/'round3-benchmark/scoring-view'; code.mkdir(parents=True)
        shutil.copyfile(ROOT/'round3-benchmark/scoring-view/canonicalize_view.py',code/'canonicalize_view.py')
        fixture(cls.dir/'model.pdb',v_shift=.75); fixture(cls.dir/'native.pdb',missing=True)
        fixture(cls.dir/'changed-context.pdb',context_shift=1000.,v_shift=.75)
        for name in ['model','changed-context']:
            canonical.canonicalize_view(cls.dir/(name+'.pdb'),cls.dir/(name+'.cif'),['A','B'],'C','label')
        for i,(rec,nb) in enumerate([(['A','B'],'C'),(['A','B'],'D'),(['B','A'],'C'),(['B','A'],'D')]):
            canonical.canonicalize_view(cls.dir/'native.pdb',cls.dir/('native-%d.cif'%i),rec,nb,'auth')
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def mapping(self,name): return json.loads((self.dir/(name+'.mapping.json')).read_text())
    def metric(self,model='model',native='native-0'):
        return adapter.dockq_api(self.dir/(model+'.cif'),self.dir/(native+'.cif'),self.mapping(model),self.mapping(native))

    def test_context_excluded_and_segment_manual_metric(self):
        result=self.metric(); changed=self.metric('changed-context')
        self.assertEqual(result['DockQ'],changed['DockQ'])
        self.assertEqual(result['correspondenceSha256'],changed['correspondenceSha256'])
        independent=manual_metrics(self.dir/'model.cif',self.dir/'native-0.cif',result['correspondence'])
        for key,value in independent.items(): self.assertAlmostEqual(value,result['metrics'][key],delta=1e-6)
        for segment in result['correspondence']['R']:
            self.assertEqual(segment['modelOriginalLabelChain'],segment['nativeOriginalLabelChain'])
        self.assertEqual([s['nativeResidues'] for s in result['correspondence']['R']],[14,13])

    def test_swapped_missing_residue_dimer_and_fixed_four_maximum(self):
        rows=[]
        for i in range(4):
            result=self.metric(native='native-%d'%i)
            independent=manual_metrics(self.dir/'model.cif',self.dir/('native-%d.cif'%i),result['correspondence'])
            self.assertAlmostEqual(independent['DockQ'],result['DockQ'],places=7)
            rows.append({'id':'assignment-%02d'%i,**result})
            expected=['A','B'] if i<2 else ['B','A']
            self.assertEqual([s['nativeOriginalLabelChain'] for s in result['correspondence']['R']],expected)
            for segment in result['correspondence']['R']:
                for pair in segment['residuePairs']:
                    index=segment['segmentIndex']; mid=int(pair['modelResidue'][0]); nid=int(pair['nativeResidue'][0])
                    self.assertEqual(mid<=16,index==0)
                    # Both native segments retain the 16-position author span.
                    self.assertEqual(nid<=16,index==0)
        aggregate=adapter.combine_views([r['id'] for r in rows],rows)
        self.assertEqual(aggregate['DockQ'],max(r['DockQ'] for r in rows))
        with self.assertRaises(ValueError): adapter.combine_views([r['id'] for r in rows],rows[:3])
        failed=copy.deepcopy(rows); failed[2]={'id':'assignment-02','status':'unavailable','DockQ':None,'reason':'synthetic parser failure'}
        self.assertEqual(adapter.combine_views([r['id'] for r in rows],failed)['status'],'unavailable')

    def test_duplicate_or_missing_planned_rows_fail(self):
        rows=[{'id':'dev_x_seed%02d'%s,'setId':'dev_x','seed':s} for s in range(25)]
        adapter.verify_membership(rows,{'dev_x'})
        for bad in [rows[:-1],rows[:-1]+[rows[0]]]:
            with self.assertRaises(ValueError): adapter.verify_membership(bad,{'dev_x'})

    def test_bound_tampering_and_duplicate_json_fail(self):
        path=self.dir/'binding-test.json'; path.write_text('{"x":1}')
        b=adapter.binding(self.dir,path); self.assertEqual(adapter.bound(self.dir,b),path.read_bytes())
        path.write_text('{"x":2}')
        with self.assertRaises(ValueError): adapter.bound(self.dir,b)
        for raw in ['{"x":1,"x":2}','{"x":NaN}']:
            with self.assertRaises(ValueError): adapter.strict_json(raw)

    def test_wrong_selected_nb_namespace_and_segment_map_rejected(self):
        coord=adapter.binding(self.dir,self.dir/'model.cif'); receipt=adapter.binding(self.dir,self.dir/'model.receipt.json')
        adapter.verify_view(self.dir,coord,receipt,['A','B'],'C','label')
        with self.assertRaises(ValueError): adapter.verify_view(self.dir,coord,receipt,['A','B'],'D','label')
        with self.assertRaises(ValueError): adapter.verify_view(self.dir,coord,receipt,['A','B'],'C','auth')
        # Rehashing a fabricated segment map and its receipt still fails replay.
        mp=self.dir/'model.mapping.json'; rp=self.dir/'model.receipt.json'; mraw=mp.read_bytes(); rraw=rp.read_bytes()
        try:
            mapping=json.loads(mraw); mapping['residues'][0]['originalLabelChain']='B'; mp.write_text(json.dumps(mapping))
            r=json.loads(rraw); r['mapSha256']=adapter.sha(mp.read_bytes()); rp.write_text(json.dumps(r))
            with self.assertRaises(ValueError): adapter.verify_view(self.dir,coord,adapter.binding(self.dir,rp),['A','B'],'C','label')
        finally: mp.write_bytes(mraw); rp.write_bytes(rraw)

    def test_relocated_archive_never_needs_original_live_paths(self):
        with tempfile.TemporaryDirectory(prefix='confovhh-relocated-') as temporary:
            moved=Path(temporary).resolve()/'fresh-extraction'; shutil.copytree(self.dir,moved)
            coord=adapter.binding(moved,moved/'model.cif'); receipt=adapter.binding(moved,moved/'model.receipt.json')
            verified=adapter.verify_view(moved,coord,receipt,['A','B'],'C','label')
            self.assertEqual(verified['coordinate']['sha256'],coord['sha256'])

    def test_prospective_release_requires_matching_seal_run_and_time(self):
        seal={'sealedAtUtc':'2026-09-24T23:00:00+00:00','generationRunId':'run-1'}
        release={'schema':'confovhh-round3-prospective-outcome-release-v1','evaluationRole':'prospective','rankingSealSha256':'a'*64,'generationRunId':'run-1','releasedAtUtc':'2026-09-24T23:01:00+00:00','authorizeFrozenProspectiveOutcomeEvaluation':True}
        adapter.validate_release(release,'a'*64,seal,'2026-09-24T23:02:00+00:00')
        for field,value in [('rankingSealSha256','b'*64),('generationRunId','run-2'),('authorizeFrozenProspectiveOutcomeEvaluation',False),('releasedAtUtc','2026-09-24T22:59:00+00:00')]:
            bad=copy.deepcopy(release); bad[field]=value
            with self.assertRaises(ValueError): adapter.validate_release(bad,'a'*64,seal,'2026-09-24T23:02:00+00:00')

    def test_complete_unavailable_output_roundtrip_and_calibration_contract(self):
        # Input authentication has separate real-data preflight controls. Here
        # inject its result to exercise the complete no-pose output path and the
        # independent calibration consumer without evaluating any fresh pose.
        rows=[]; refs={}
        for set_id in ['dev_6knm','dev_8qot','dev_8th3','dev_8th4']:
            for seed in range(25): rows.append({'id':set_id+'_seed%02d'%seed,'setId':set_id,'seed':seed,'coordinateSha256':None,'view':None,'unavailableReason':'synthetic generation failure'})
            refs[set_id]=[{'id':'assignment-00','coordinate':adapter.binding(self.dir,self.dir/'native-0.cif'),'map':adapter.binding(self.dir,self.dir/'native-0.mapping.json')}]
        verified={'role':'development','smoke':False,'rows':rows,'references':refs,'rankingReceiptSha256':['a'*64],'producerProvenanceSha256':'b'*64,'generationRunId':'synthetic-test-only'}
        req=self.dir/'test-request.json'; req.write_text('{}\n'); seal=self.dir/'test-seal.json'; out=self.dir/'test-evaluation'
        with patch.object(adapter,'preflight',return_value=verified),patch.object(adapter,'implementation',return_value={'testOnly':True}):
            adapter.seal_request(self.dir,req,seal)
            receipt_binding=adapter.evaluate(self.dir,seal,out)
            outcome,authentication,_=adapter.verify_evaluation(self.dir,receipt_binding)
            self.assertEqual(len(outcome['rows']),100)
            self.assertTrue(all(r['DockQ'] is None and r['status']=='unavailable' for r in outcome['rows']))
            spec=importlib.util.spec_from_file_location('calibration_consumer',ROOT/'round3-ranking/calibration-tools/calibrate.py')
            calibration=importlib.util.module_from_spec(spec); spec.loader.exec_module(calibration)
            request={'outcomeMap':adapter.binding(self.dir,out/'outcome-map.json'),'analysisReceipt':adapter.binding(self.dir,out/'authentication.json'),'producerProvenance':{'sha256':'b'*64}}
            provenance={'generationRunId':'synthetic-test-only','attempts':[{k:r[k] for k in ['id','setId','seed','coordinateSha256']} for r in rows]}
            got,_=calibration.authenticate_outcomes(self.dir,request,provenance,['a'*64])
            self.assertEqual(got,outcome)
            tamper=out/'artifacts'/('dev_6knm_seed00.json'); data=json.loads(tamper.read_text()); data['DockQ']=1.; tamper.write_text(json.dumps(data))
            with self.assertRaises(ValueError): adapter.verify_evaluation(self.dir,receipt_binding)

    def test_internal_worker_cannot_bypass_rank_seal(self):
        job={'model':adapter.binding(self.dir,self.dir/'model.cif'),'native':adapter.binding(self.dir,self.dir/'native-0.cif'),
             'modelMap':adapter.binding(self.dir,self.dir/'model.mapping.json'),'nativeMap':adapter.binding(self.dir,self.dir/'native-0.mapping.json')}
        with self.assertRaises(ValueError): adapter.verify_worker_job(self.dir,job)

if __name__=='__main__': unittest.main(verbosity=2)
