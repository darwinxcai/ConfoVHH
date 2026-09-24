import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('analyze.py')
s=importlib.util.spec_from_file_location('analyze',p); a=importlib.util.module_from_spec(s); s.loader.exec_module(a)

def arm(ranks, selected=None, status='ranked'):
 return {'setId':'x','arm':'burial-only','scoreName':'burial-only','direction':'higher-better','status':status,'reason':'','selected':selected if selected is not None else [str(i) for i,r in enumerate(ranks) if r==1], 'rows':[{'id':str(i),'rank':r} for i,r in enumerate(ranks)]}

class Metrics(unittest.TestCase):
 def test_perfect_and_reversed(self):
  good=a.analyze_arm(arm([1,2,3,4]), {'0':.9,'1':.6,'2':.3,'3':.1})
  self.assertEqual(good['spearmanRankVsDockQ'],-1)
  self.assertEqual(good['spearmanPreferenceVsDockQ'],1)
  self.assertEqual(good['pairwiseAUROCByThreshold']['0.23'],1)
  self.assertEqual(good['bestAvailable']['overallRankInterval'],[1,1])
  self.assertEqual(good['qualityCounts'],dict(incorrect=1.,acceptable=1.,medium=1.,high=1.))
  self.assertEqual(a.pairwise_auc([4,3,2,1],[True,True,True,False]),0)
 def test_complete_tie(self):
  x=a.analyze_arm(arm([1,1,1,1]),{'0':.1,'1':.3,'2':.6,'3':.9})
  self.assertIsNone(x['spearmanRankVsDockQ'])
  self.assertEqual(x['pairwiseAUROCByThreshold']['0.23'],.5)
  self.assertAlmostEqual(x['selected']['meanDockQ'],.475)
  self.assertEqual(x['selected']['dockqRange'],[.1,.9])
  self.assertEqual(x['bestAvailable']['overallRankInterval'],[1,4])
  for w in x['windows'].values():
   self.assertAlmostEqual(w['meanDockQ'],.475)
 def test_auc_tie_hand_example(self):
  self.assertEqual(a.pairwise_auc([1,2,2,3],[True,True,False,False]),.875)
  self.assertIsNone(a.pairwise_auc([1,2],[True,True]))
 def test_top10_boundary_tie(self):
  ranks=list(range(1,9))+[9]*4
  x=a.analyze_arm(arm(ranks),{str(i):(.8 if i<9 else .1) for i in range(12)})
  top=x['windows']['top10']
  self.assertEqual(top['size'],10)
  for i in range(8,12): self.assertEqual(top['weights'][str(i)],.5)
  self.assertEqual(top['qualityCounts']['high'],8.5)
  self.assertEqual(top['qualityCounts']['incorrect'],1.5)
 def test_hundred_equal_thirds(self):
  x=a.analyze_arm(arm(list(range(1,101))),{str(i):.5 for i in range(100)})
  ws=x['windows']
  for key in ('topThird','middleThird','bottomThird'):
   self.assertAlmostEqual(ws[key]['size'],100/3)
   self.assertAlmostEqual(ws[key]['qualityCounts']['medium'],100/3)
  for i in range(100):
   self.assertAlmostEqual(sum(ws[k]['weights'].get(str(i),0) for k in ('topThird','middleThird','bottomThird')),1)
  self.assertIsNone(x['spearmanRankVsDockQ'])
 def test_missing_outcome(self):
  x=a.analyze_arm(arm([1,1,2]),{'0':.8,'1':None,'2':.2})
  self.assertFalse(x['complete']); self.assertIsNone(x['pairwiseAUROCByThreshold'])
  self.assertIsNone(x['spearmanRankVsDockQ']); self.assertIsNone(x['bestAvailable'])
  self.assertEqual(x['missingOutcomeIds'],['1'])
  self.assertIsNone(x['selected']['meanDockQ']); self.assertEqual(x['selected']['meanDockQBounds'],[.4,.9])
  self.assertEqual(x['plannedCount'],3); self.assertEqual(x['outcomeCount'],2)
 def test_missing_rank_abstains(self):
  x=a.analyze_arm(arm([1,None,2],[],status='abstain'),{'0':.8,'1':.5,'2':.2})
  self.assertIsNone(x['windows']);self.assertIsNone(x['spearmanRankVsDockQ'])
  self.assertEqual(x['selected']['meanDockQBounds'],[0,1])
 def test_rank_average_and_saved_rank_validation(self):
  self.assertEqual(a.rank_average([1,2,2,4]),[1,2.5,2.5,4])
  r={'rows':[{'id':'a','key':[2,None],'rank':1,'status':'scored'},{'id':'b','key':[1,4],'rank':2,'status':'scored'}], 'selected':['a'],'status':'ranked'}
  a.verify_saved_rank_record(r,['a','b'])
  r['rows'][1]['rank']=1
  with self.assertRaises(ValueError):a.verify_saved_rank_record(r,['a','b'])

if __name__=='__main__':unittest.main()
