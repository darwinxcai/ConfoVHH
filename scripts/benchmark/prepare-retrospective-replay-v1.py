#!/usr/bin/env python3
"""Bind a fixed exposed four-complex replay without changing the frozen evaluator."""
import argparse,gzip,hashlib,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p):return json.loads(p.read_text())
def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2)+'\n')
def main():
 p=argparse.ArgumentParser();p.add_argument('--archives',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
 archives=[a.archives/f'GPCR_AI_verification_part{i}.zip' for i in (1,2,3)];zips=[zipfile.ZipFile(p) for p in archives]
 source=ROOT/'validation/gpcr-paper-development-2026-09-04'; reviewed=load(source/'reviewed-cognate-plan.json'); review={(x['jobId'],x['modelIndex']):x for x in reviewed['jobs']};sources=[]
 def fetch(name):
  matches=[z.read(name) for z in zips if name in z.namelist()];assert len(matches)<=1,('duplicate',name);return matches[0] if matches else None
 def bind(rel,b,expected=None):
  assert b is not None,rel
  if expected:assert sha(b)==expected,('historical hash mismatch',rel)
  p=out/'artifacts'/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);return dict(path=rel,bytes=len(b),sha256=sha(b))
 prior=load(ROOT/'validation/prospective-benchmark-v1/exposed-regression-plan.json'); inventory={r['pdbId']:r for r in load(ROOT/'validation/prospective-benchmark-v1/inventory/curated-target-inventory.json')}; targets=[];attempts=[];refs=[];inputreview=[]
 pilot=ROOT/'validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03'
 t=prior['targets'][0];t['groupId']=inventory['3P0G']['relatednessGroup'];targets.append(t)
 for item in prior['attempts']:
  row=dict(item)
  for kind in ('coordinate','confidence'):
   b=(ROOT/item[kind]['path']).read_bytes();assert sha(b)==item[kind]['sha256'];row[kind]=bind('pilot/'+Path(item[kind]['path']).name,b,item[kind]['sha256'])
  attempts.append(row)
 native=bind('references/3P0G-native-AB.pdb',(pilot/'reference/native_AB.pdb').read_bytes());refs.append(dict(targetId=t['id'],native=native,nativeReceptorChain='A',nativeVhhChain='B'))
 for pdb in ('4MQS','5C1M','5JQH'):
  id='exposed-'+pdb+'-legacy-default'; target=None;canonical=None
  for seed in (1,2):
   job=f'{pdb}_default_complex_seed{seed}';requestname='fold_'+job.lower()+'_job_request.json';request=(source/'source/S4_job_requests'/requestname).read_bytes();saved=bind('requests/'+requestname,request);requestdata=json.loads(request)[0]
   proteins=[s['proteinChain']['sequence'] for s in requestdata['sequences'] if 'proteinChain' in s];assert len(proteins)==2
   if canonical is None:canonical=proteins
   assert proteins==canonical,'Within-target inputs differ'
   rolemap=review[(f'{pdb}_default_complex_seed1',0)]['modelChains']
   if target is None:target=dict(id=id,groupId=inventory[pdb]['relatednessGroup'],receptorChain=rolemap['receptor'],vhhChain=rolemap['vhh'],receptorSequence=proteins[ord(rolemap['receptor'])-ord('A')],vhhSequence=proteins[ord(rolemap['vhh'])-ord('A')]);targets.append(target)
   inputreview.append(dict(targetId=id,seed=seed,request=saved,predictorDialect=requestdata['dialect'],templateSettings=[s['proteinChain'].get('useStructureTemplate') for s in requestdata['sequences'] if 'proteinChain' in s],newGeneration=False))
   for i in range(5):
    stem='fold_'+job.lower();path=f'VERIFY/runs/{job}/{stem}_model_{i}.cif';b=fetch(path);cid=job+'_model_'+str(i)
    row=dict(id=cid,targetId=id,status='not-run',reason='Historical planned attempt: coordinate absent from all three retained archives; original execution success unknown; no replacement.',coordinate=None,confidence=None)
    if b is not None:
     expected=review[(job,i)];assert expected['requestSha256']==saved['sha256'];assert expected['modelChains']==rolemap
     row.update(status='generated',reason='',coordinate=bind('legacy/'+Path(path).name,b,expected['modelSha256']))
     cb=fetch(f'VERIFY/runs/{job}/{stem}_summary_confidences_{i}.json');row['confidence']=bind('legacy/'+stem+f'_summary_confidences_{i}.json',cb) if cb else None
    attempts.append(row)
  first=review[(f'{pdb}_default_complex_seed1',0)];nb=fetch('VERIFY/'+first['nativePath']);assert sha(nb)==first['nativeSha256'];original=bind('references/'+Path(first['nativePath']).name,nb,first['nativeSha256'])
  native=bind('references/'+pdb+'.cif',gzip.decompress(nb)) if first['nativePath'].endswith('.gz') else original
  refs.append(dict(targetId=id,native=native,nativeReceptorChain=first['nativeChains']['receptor'],nativeVhhChain=first['nativeChains']['vhh']))
  inputreview.append(dict(targetId=id,referenceReview=first['referenceReview'],nativeOriginal=original,nativeEvaluated=native,interpretation='Fixed historical role mapping and default DockQ sequence alignment; missing terminal/engineered regions not masked or repaired. Sequence-compatible deposited-pose comparison, not unique alignment or density certification.'))
 plan=dict(schema='confovhh-prediction-only-benchmark-v1',studyId='retrospective-four-complex-compatibility-v1',targets=targets,attempts=attempts)
 save(out/'plan.json',plan);save(out/'references-template.json',dict(schema='confovhh-reference-evaluation-v1',scoreReceiptSha256='BOUND_AFTER_SCORING',targets=refs));save(out/'input-and-reference-review.json',inputreview)
 save(out/'archive-provenance.json',dict(archives=[dict(name=p.name,bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for p in archives],historicalReviewedPlanSha256=sha((source/'reviewed-cognate-plan.json').read_bytes()),modelsVerifiedAgainstPriorHashes=sum(x['status']=='generated' for x in attempts),coordinateRepair=False,scoreSubstitution=False))
 save(out/'study-design.json',dict(schema='confovhh.retrospective-compatibility-study.v1',status='SEALED_BEFORE_REPLAY',prospective=False,independentValidation=False,referenceComplexes=['3P0G','4MQS','5C1M','5JQH'],selectionSets=4,attempts=40,selectionRule='Keep original Boltz 3P0G ten-pose pilot. For every other previously reviewed cognate reference complex, use the original default condition, seeds 1 and 2, all five models; keep absent records. No selection based on outcomes.',groups={g:[t['id'] for t in targets if t['groupId']==g] for g in sorted({t['groupId'] for t in targets})},independentGroupCount=0,arms=['frozen-v06','burial-only','predictor-confidence','clash-fraction-v1','overlap-burial-v1'],comparisons='All five target selections, exact ties, all failures and missing data. Four frozen contrasts retained descriptively. No inferential significance or independent-validation claim.',legacyPredictor='AlphaFold server historical default template-enabled requests; not regenerated or represented as Boltz. Frozen geometric engine reused only for format-compatible coordinates. Internal helper generator ID is a historical constant, not origin authentication.',confidencePolicy='Original confidence JSON preserved unchanged. Missing Boltz confidence_score causes frozen confidence arm abstention. Do not alias AF ranking_score or pLDDT.',noNewGeneration=True,noNewScoringVariants=True,wallClockLimitSeconds=2700,estimatedLocalCpuMinutes=[15,45],newGpuHours=0,newCloudCostUSD=0))
 bound=[]
 for p in sorted(out.rglob('*')):
  if p.is_file():bound.append(dict(path=str(p.relative_to(out)),bytes=p.stat().st_size,sha256=sha(p.read_bytes())))
 save(out/'freeze.json',dict(schema='confovhh.retrospective-replay-freeze.v1',artifacts=bound,frozenEvaluatorPreparation=sha((ROOT/'validation/prospective-benchmark-v1/freeze-v1.json').read_bytes()),prospective=False,independentGroups=0))
 print(json.dumps(dict(output=str(out),attempts=len(attempts),coordinates=sum(x['status']=='generated' for x in attempts),missing=sum(x['status']!='generated' for x in attempts),targets=len(targets))))
if __name__=='__main__':main()
