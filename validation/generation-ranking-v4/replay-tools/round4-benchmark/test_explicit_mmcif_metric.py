import tempfile,unittest
from pathlib import Path
import explicit_mmcif_metric as metric
H=Path(__file__).resolve().parent
class DispatchChecks(unittest.TestCase):
 def test_valid_large_cif_loads_selected_chains(self):
  p=H/'reference-views/GPR158_NB20__R-AB__V-C.cif'
  model=metric.load_explicit_mmcif(p,['R','V'])
  self.assertEqual({c.id:len(c) for c in model},{'R':1081,'V':121})
 def test_rejects_role_override(self):
  with self.assertRaisesRegex(ValueError,'selected-role'):
   metric.load_explicit_mmcif(H/'reference-views/ADGRV1_RE02__R-A__V-B.cif',['R'])
 def test_rejects_model_override(self):
  with self.assertRaisesRegex(ValueError,'selected-role'):
   metric.load_explicit_mmcif(H/'reference-views/ADGRV1_RE02__R-A__V-B.cif',['R','V'],1)
 def test_rejects_uncanonicalized_reference(self):
  with self.assertRaises((ValueError,KeyError)):
   metric.load_explicit_mmcif(H/'public-sources/qualification-native-reference/9FTE.cif',['R','V'])
 def test_rejects_wrong_format_and_header(self):
  with tempfile.TemporaryDirectory(dir=H,prefix='.dispatch-test-') as temp:
   p=Path(temp)/'bad.pdb';p.write_text('data_test\n')
   with self.assertRaisesRegex(ValueError,'explicitly canonical mmCIF'):metric.load_explicit_mmcif(p,['R','V'])
   p=p.with_suffix('.cif');p.write_text('not_a_cif\n')
   with self.assertRaisesRegex(ValueError,'data header'):metric.load_explicit_mmcif(p,['R','V'])
 def test_frozen_numerical_method_verified(self):
  data=metric.implementation()
  self.assertFalse(data['numericalMetricChanged']);self.assertFalse(data['correspondenceChanged'])
  self.assertEqual(data['round3']['methodFreezeSha256'],'2914ec4b58f128427e3b6ba5f3d28da3dd6ae71770c1e969b350c5b78f383b29')
if __name__=='__main__':unittest.main()
