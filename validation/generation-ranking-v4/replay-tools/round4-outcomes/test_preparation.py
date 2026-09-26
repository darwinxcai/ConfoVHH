import copy
import json
from pathlib import Path
import tempfile
import unittest
import prepare_predictions as p

class PreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=p.ROOT
        cls.cohort=p.bind(cls.root,p.HERE/'development-cohort.json')
        cls.c,cls.plan,cls.targets,cls.sequences,cls.runner=p.verify_cohort(cls.root,cls.cohort)
        cls.prep,cls.auth=p.old_modules(cls.root)
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='test-preparation-',dir=p.HERE);self.tmp=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def raw(self,target):
        return self.root/'round3-predictions/raw/results'/f'{target}_seed00'/'prediction'/f'{target}_model_0.cif'
    def empty_cohort(self):
        c=copy.deepcopy(self.c);c['rawRoot']=str((self.tmp/'empty-raw').relative_to(self.root));out=self.tmp/'cohort.json';p.save(out,c);return out
    def mutate_raw(self,source,fn):
        from Bio.PDB import MMCIFIO
        _,_,cols,rows,_=self.prep.canonicalizer().read_atoms(source);fn(rows)
        out=self.tmp/'changed.cif';writer=MMCIFIO();writer.set_dict({'data_':'test',**{'_atom_site.'+c:[r[c] for r in rows] for c in cols}});writer.save(str(out));return out
    def test_authenticates_complete_900_producer_roster(self):
        self.assertEqual(len(self.plan['jobs']),900);self.assertEqual(len(self.targets),12);self.assertEqual(len({j['jobId'] for j in self.plan['jobs']}),900)
    def test_real_old_raw_matches_same_prescribed_input(self):
        r=self.prep.verify_raw_geometry(self.raw('dev_8qot'),self.targets['dev_8qot'],self.sequences['dev_8qot'])
        self.assertTrue(r['allInputChainSequencesMatch']);self.assertEqual(r['modelIds'],['1'])
    def test_nonfinite_coordinate_rejected(self):
        raw=self.mutate_raw(self.raw('dev_8qot'),lambda rows:rows[0].update(Cartn_x='nan'))
        with self.assertRaisesRegex(ValueError,'Nonfinite'):self.prep.verify_raw_geometry(raw,self.targets['dev_8qot'],self.sequences['dev_8qot'])
    def test_missing_input_residue_rejected(self):
        def mutate(rows):
            first=(rows[0]['label_asym_id'],rows[0]['label_seq_id']);rows[:]=[r for r in rows if (r['label_asym_id'],r['label_seq_id'])!=first]
        raw=self.mutate_raw(self.raw('dev_8qot'),mutate)
        with self.assertRaisesRegex(ValueError,'Raw sequence differs'):self.prep.verify_raw_geometry(raw,self.targets['dev_8qot'],self.sequences['dev_8qot'])
    def test_snapshot_retains_all_not_run_rows(self):
        c=self.empty_cohort();r=p.prepare(self.root,c,self.tmp/'snapshot',True);inv,_=p.verify_preparation(self.root,p.bind(self.root,self.tmp/'snapshot/preparation-receipt.json'))
        self.assertEqual(r['statusCounts'],{'not-run':900});self.assertEqual(len(inv['rows']),900)
    def test_final_preparation_rejects_missing_attempts(self):
        with self.assertRaisesRegex(ValueError,'terminal receipt'):p.prepare(self.root,self.empty_cohort(),self.tmp/'final',False)
        self.assertFalse((self.tmp/'final').exists())
    def test_outcome_injection_into_prediction_inventory_rejected(self):
        p.prepare(self.root,self.empty_cohort(),self.tmp/'snapshot',True);i=self.tmp/'snapshot/prediction-view-inventory.json';r=self.tmp/'snapshot/preparation-receipt.json'
        inv=p.strict(i.read_bytes());inv['rows'][0]['DockQ']=1.;i.write_text(json.dumps(inv));rec=p.strict(r.read_bytes());rec['inventory']=p.bind(self.root,i);r.write_text(json.dumps(rec))
        with self.assertRaisesRegex(ValueError,'Unexpected prediction row'):p.verify_preparation(self.root,p.bind(self.root,r))
    def test_wrong_identical_dimer_nb_role_rejected(self):
        raw=self.raw('GRM5_NB43');view=self.tmp/'wrong-role.cif'
        self.prep.canonicalizer().canonicalize_view(raw,view,['A','B'],'D',chain_namespace='label')
        with self.assertRaisesRegex(ValueError,'role assignment'):self.prep.verify_canonical_view(self.root,raw,view,self.targets['GRM5_NB43'])
    def test_rehashed_residue_mapping_corruption_detected(self):
        raw=self.raw('dev_8qot');view=self.tmp/'correct.cif';self.prep.canonicalizer().canonicalize_view(raw,view,['A'],'B',chain_namespace='label')
        mp=view.with_suffix('.mapping.json');rp=view.with_suffix('.receipt.json');m=p.strict(mp.read_bytes());m['residues'][0]['originalLabelChain']='Q';mp.write_text(json.dumps(m));r=p.strict(rp.read_bytes());r['mapSha256']=p.sha(mp.read_bytes());rp.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'mapping replay'):self.auth.verify_view(self.root,p.bind(self.root,view),p.bind(self.root,rp),['A'],'B','label')
    def test_context_atoms_retained_in_correct_dimer_view(self):
        raw=self.raw('GRM5_NB43');view=self.tmp/'correct-dimer.cif';r=self.prep.canonicalizer().canonicalize_view(raw,view,['A','B'],'C',chain_namespace='label')
        self.prep.verify_canonical_view(self.root,raw,view,self.targets['GRM5_NB43'])
        self.assertEqual(r['sourceAtoms'],r['viewAtoms']);mapping=p.strict(view.with_suffix('.mapping.json').read_bytes());self.assertTrue(any(s['outputChain'].startswith('X') for s in mapping['segments']))

if __name__=='__main__':unittest.main(verbosity=2)
