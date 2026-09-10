import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('evaluator',ROOT/'scripts/benchmark/evaluator.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NODE=os.environ.get('BENCHMARK_NODE','node')


def cif(gap=3., reverse=False):
    columns='group_PDB id type_symbol label_atom_id label_alt_id label_comp_id label_asym_id label_entity_id label_seq_id pdbx_PDB_ins_code Cartn_x Cartn_y Cartn_z occupancy B_iso_or_equiv auth_seq_id auth_asym_id pdbx_PDB_model_num'.split()
    lines=['data_synthetic','#','loop_']+['_atom_site.'+x for x in columns]
    rows=[]
    for chain,comp,offset in [('R','ALA',0.),('V','GLY',gap)]:
        for i in range(1,21):
            for name,delta in [('N',-.7),('CA',0.),('C',.7),('O',1.3)]:
                rows.append(f'ATOM {len(rows)+1} {name[0]} {name} . {comp} {chain} 1 {i} ? {i*3.8+delta:.3f} {offset:.3f} 0.000 1.00 80.00 {i} {chain} 1')
    return '\n'.join(lines+(list(reversed(rows)) if reverse else rows)+['#',''])


def bound(base,name,text):
    p=base/name;p.write_text(text)
    return dict(path=name,bytes=p.stat().st_size,sha256=m.sha(p))


def fixture(base):
    targets=[dict(id='t1',groupId='g1',receptorChain='R',vhhChain='V',receptorSequence='A'*20,vhhSequence='G'*20)]
    attempts=[]
    for id,gap,conf in [('a',3.,.9),('b',3.,.2),('far',40.,.9)]:
        attempts.append(dict(id=id,targetId='t1',status='generated',reason='',
            coordinate=bound(base,id+'.cif',cif(gap)),confidence=bound(base,id+'.json',json.dumps({'confidence_score':conf}))))
    attempts.append(dict(id='failed',targetId='t1',status='failed',reason='Synthetic generation failure',coordinate=None,confidence=None))
    return dict(schema='confovhh-prediction-only-benchmark-v1',studyId='synthetic',targets=targets,attempts=attempts)


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.plan=fixture(self.base)
    def tearDown(self):self.tmp.cleanup()
    def run_score(self,plan=None,name='score'):
        p=self.base/(name+'-plan.json');p.write_text(json.dumps(plan or self.plan));out=self.base/name
        m.score(p,self.base,out,NODE);return out
    def test_rejects_outcomes_native_fields_and_duplicate_membership(self):
        for mutate in [lambda p:p.update(DockQ=[]),lambda p:p['targets'][0].update(nativeReference='x'),lambda p:p['attempts'].append(p['attempts'][0]),lambda p:p['targets'][0].update(vhhChain='R')]:
            p=copy.deepcopy(self.plan);mutate(p)
            with self.assertRaises(ValueError):m.validate_plan(p)
    def test_geometry_roles_and_atom_order(self):
        a=m.geometry(self.base/'a.cif',self.plan['targets'][0]);bound(self.base,'reverse.cif',cif(reverse=True))
        self.assertEqual(a,m.geometry(self.base/'reverse.cif',self.plan['targets'][0]))
        t=copy.deepcopy(self.plan['targets'][0]);t['vhhSequence']='A'*20
        with self.assertRaisesRegex(ValueError,'sequence'):m.geometry(self.base/'a.cif',t)
    def test_models_alternates_occupancy_reject(self):
        for index,replacement in [(17,'2'),(4,'A'),(13,'0.5')]:
            lines=cif().splitlines();i=next(i for i,line in enumerate(lines) if line.startswith('ATOM '));tokens=lines[i].split();tokens[index]=replacement;lines[i]=' '.join(tokens)
            bound(self.base,'bad.cif','\n'.join(lines))
            with self.assertRaises(ValueError):m.geometry(self.base/'bad.cif',self.plan['targets'][0])
    def test_tied_real_engine_and_zero_contact_abstention(self):
        out=self.run_score();ranks=m.load(out/'ranks.json');features=m.load(out/'features.json')
        self.assertEqual(len(features),3)
        self.assertEqual(next(r for r in ranks if r['arm']=='burial-only')['selected'],['a','b'])
        self.assertEqual(next(r for r in ranks if r['arm']=='predictor-confidence')['selected'],['a','far'])
        self.assertEqual(next(r for r in ranks if r['arm']=='overlap-burial-v1')['status'],'abstain')
        self.assertEqual(m.load(out/'attempts.json')[-1]['status'],'failed')
    def test_hash_failure_retained(self):
        self.plan['attempts']=self.plan['attempts'][:1];(self.base/'a.cif').write_text(cif(5.))
        out=self.run_score();self.assertEqual(m.load(out/'attempts.json')[0]['status'],'evaluation-failed')
        self.assertTrue(all(r['status']=='abstain' for r in m.load(out/'ranks.json')))
    def test_missing_confidence_withholds_whole_baseline(self):
        self.plan['attempts']=self.plan['attempts'][:2];self.plan['attempts'][0]['confidence']=None
        out=self.run_score();ranks=m.load(out/'ranks.json')
        self.assertEqual(next(r for r in ranks if r['arm']=='predictor-confidence')['selected'],[])
        self.assertEqual(next(r for r in ranks if r['arm']=='burial-only')['selected'],['a','b'])
    def test_separate_join_ties_missing_and_no_substitution(self):
        self.plan['attempts']=self.plan['attempts'][:2];out=self.run_score()
        outcomes=dict(schema='confovhh-separate-outcomes-v1',scoreReceiptSha256=m.sha(out/'receipt.json'),rows=[dict(id='a',status='available',DockQ=.8,reason=''),dict(id='b',status='missing',DockQ=None,reason='Synthetic missing evaluation')])
        op=self.base/'outcomes.json';op.write_text(json.dumps(outcomes));m.evaluate(out,op,self.base/'eval')
        result=m.load(self.base/'eval/evaluation.json');burial=next(r for r in result['selectionRows'] if r['arm']=='burial-only')
        self.assertIsNone(burial['mean']);self.assertEqual((burial['lower'],burial['upper']),(.4,.9))
        self.assertIsNone(result['primaryComparisons'][0]['meanGroupDelta'])
        outcomes['rows'].pop();op.write_text(json.dumps(outcomes))
        with self.assertRaisesRegex(ValueError,'Every planned'):m.evaluate(out,op,self.base/'eval2')
    def test_changed_ranks_reject_outcome_join(self):
        self.plan['attempts']=self.plan['attempts'][-1:];out=self.run_score();(out/'ranks.json').write_text('[]')
        with self.assertRaisesRegex(ValueError,'changed'):m.evaluate(out,self.base/'unused',self.base/'eval')
    def test_path_traversal_and_symlink_reject(self):
        for name in ('../secret','/tmp/secret'):
            with self.assertRaises(ValueError):m.artifact(self.base,dict(path=name,bytes=1,sha256='0'*64))
        (self.base/'link').symlink_to(self.base/'a.cif')
        with self.assertRaises(ValueError):m.artifact(self.base,self.plan['attempts'][0]['coordinate']|{'path':'link'})
    def test_binomial_planning(self):
        self.assertEqual(m.binomial_tail(7,7),1/128);self.assertIsNone(m.binomial_tail(0,0))
    def test_all_failed_targets_remain(self):
        self.plan['attempts']=self.plan['attempts'][-1:];out=self.run_score()
        self.assertEqual(len(m.load(out/'ranks.json')),5);self.assertEqual(len(m.load(out/'attempts.json')),1)
    def test_group_weighting_and_holm_keep_ties(self):
        first=copy.deepcopy(self.plan['targets'][0]);second=first|{'id':'t2','groupId':'g1'};third=first|{'id':'t3','groupId':'g2'}
        self.plan['targets']=[first,second,third];self.plan['attempts']=self.plan['attempts'][:2]
        for target in ('t2','t3'):
            for a in copy.deepcopy(self.plan['attempts'][:2]):
                a['id']=target+'-'+a['id'];a['targetId']=target;self.plan['attempts'].append(a)
        out=self.run_score();values={'a':.8,'b':.2,'t2-a':.4,'t2-b':.6,'t3-a':.1,'t3-b':.9}
        outcomes=dict(schema='confovhh-separate-outcomes-v1',scoreReceiptSha256=m.sha(out/'receipt.json'),rows=[dict(id=id,status='available',DockQ=q,reason='') for id,q in values.items()])
        op=self.base/'outcomes.json';op.write_text(json.dumps(outcomes));m.evaluate(out,op,self.base/'eval')
        c=m.load(self.base/'eval/evaluation.json')['primaryComparisons'][0]
        self.assertAlmostEqual(c['groups'][0]['delta'],-.1);self.assertAlmostEqual(c['groups'][1]['delta'],.4)
        self.assertAlmostEqual(c['meanGroupDelta'],.15);self.assertEqual((c['wins'],c['losses']),(1,1));self.assertEqual(c['holmP'],1.)
    def test_synthetic_dockq_api_cli_and_no_interface_failure(self):
        self.plan['attempts']=self.plan['attempts'][:1];out=self.run_score()
        refs=dict(schema='confovhh-reference-evaluation-v1',scoreReceiptSha256=m.sha(out/'receipt.json'),targets=[dict(targetId='t1',native=self.plan['attempts'][0]['coordinate'],nativeReceptorChain='R',nativeVhhChain='V')])
        rp=self.base/'refs.json';rp.write_text(json.dumps(refs))
        command=[os.sys.executable,str(ROOT/'scripts/benchmark/dockq-outcomes.py'),'--scores',str(out),'--artifacts',str(self.base),'--reference-manifest',str(rp),'--reference-root',str(self.base),'--output',str(self.base/'dockq')]
        subprocess.run(command,check=True,capture_output=True)
        self.assertEqual(m.load(self.base/'dockq/outcomes.json')['rows'][0]['DockQ'],1.)
        self.assertEqual(m.load(self.base/'dockq/crosschecks.json')[0]['absoluteDifference'],0.)
        refs['targets'][0]['native']=bound(self.base,'no-interface.cif',cif(40.));rp.write_text(json.dumps(refs));command[-1]=str(self.base/'dockq-failed')
        subprocess.run(command,check=True,capture_output=True)
        self.assertEqual(m.load(self.base/'dockq-failed/outcomes.json')['rows'][0]['status'],'failed')


if __name__=='__main__':unittest.main()
