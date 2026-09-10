import importlib.util,tempfile,unittest
from decimal import Decimal
from pathlib import Path
S=Path(__file__).resolve().parents[1]/'scripts/benchmark/predictor-native-confidence-v1.py'
spec=importlib.util.spec_from_file_location('native_confidence',S);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
def row(id,value,available=True,status='available'):return dict(id=id,coordinateAvailable=available,scoreStatus=status,exportedScore=value)
class NativeConfidenceTests(unittest.TestCase):
 def test_exact_export_ties(self):
  self.assertEqual(n.maximum_set([row('a','0.87'),row('b','0.870'),row('c','0.86')])['selected'],['a','b'])
 def test_decimal_precision_not_collapsed(self):
  self.assertEqual(n.maximum_set([row('a','0.90000000000000000001'),row('b','0.9')])['selected'],['a'])
 def test_documented_predictor_ranges_are_distinct(self):
  self.assertEqual(n.score_value({'ranking_score':Decimal('-99.1')},'AlphaFold Server'),Decimal('-99.1'))
  self.assertEqual(n.score_value({'ranking_score':Decimal('1.4')},'AlphaFold Server'),Decimal('1.4'))
  with self.assertRaises(ValueError):n.score_value({'confidence_score':Decimal('1.4')},'Boltz 2.2.1')
 def test_no_metric_substitution(self):
  with self.assertRaises(KeyError):n.score_value({'iptm':.9,'ptm':.8},'AlphaFold Server')
  with self.assertRaises(KeyError):n.score_value({'ranking_score':.9},'Boltz 2.2.1')
 def test_malformed_scores(self):
  for v in [True,'0.9',None,Decimal('NaN'),Decimal('Infinity')]:
   with self.assertRaises(ValueError):n.score_value({'ranking_score':v},'AlphaFold Server')
 def test_missing_coordinate_preserved_but_not_selectable(self):
  data=[row('a','0.7'),row('absent',None,False,'missing')];self.assertEqual(n.maximum_set(data)['selected'],['a']);self.assertEqual(len(data),2)
 def test_missing_confidence_abstains_whole_available_pool(self):
  self.assertEqual(n.maximum_set([row('a','0.9'),row('b',None,True,'missing')])['status'],'abstain')
  self.assertEqual(n.maximum_set([row('a',None,False,'missing')])['status'],'abstain')
 def test_uniform_ties_and_missing_outcome_bounds(self):
  outcomes={'a':dict(status='available',DockQ=.5),'b':dict(status='missing',DockQ=None)}
  q=n.outcome_summary(['a','b'],outcomes);self.assertIsNone(q['mean']);self.assertEqual((q['lower'],q['upper']),(.25,.75))
  outcomes['b']=dict(status='available',DockQ=.1);self.assertEqual(n.outcome_summary(['a','b'],outcomes)['mean'],.3)
 def test_hash_and_duplicate_key_rejection(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x';p.write_text('{"a":1,"a":2}')
   with self.assertRaises(ValueError):n.load(p)
   b=n.bind(p,Path(d));p.write_text('{}')
   with self.assertRaises(ValueError):n.verify(p,b)
if __name__=='__main__':unittest.main()
