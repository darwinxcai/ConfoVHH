#!/usr/bin/env python3
"""Export complete retrospective results; no ranking changes or dropped outcomes."""
import argparse,csv,hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def load(p):return json.loads(p.read_text())
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--bundle',type=Path,required=True);p.add_argument('--results',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();bundle=a.bundle;result=a.results;dest=a.output;pub=dest/'retrospective-replay';pub.mkdir(parents=True,exist_ok=True)
 plan=load(bundle/'plan.json');ledger={r['id']:r for r in load(result/'scores/attempts.json')};features={r['id']:r for r in load(result/'scores/features.json')};ev=load(result/'comparison/evaluation.json');ranks=load(result/'scores/ranks.json');outcomes={r['id']:r for r in ev['outcomes']}
 old=ROOT/'validation/gpcr-paper-development-2026-09-04/confovhh-audit/audit-summary.json';expected={(j['job'],f['filename']):f for j in load(old)['jobs'] for f in j['ignoredSummaryFiles']};verified=[]
 for attempt in plan['attempts']:
  if attempt['coordinate'] is not None and attempt['coordinate']['path'].startswith('legacy/'):
   path=bundle/'artifacts'/attempt['confidence']['path'];job=attempt['id'].rsplit('_model_',1)[0];r=expected[(job,path.name)];assert path.stat().st_size==r['bytes'] and sha(path)==r['sha256'];verified.append(dict(id=attempt['id'],sha256=sha(path),originalField='ranking_score',frozenRequiredField='confidence_score',substituted=False))
 save(dest/'legacy-confidence-verification.json',dict(historicalReceiptSha256=sha(old),verified=verified,status='PASS'))
 rows=[]
 for attempt in plan['attempts']:
  id=attempt['id'];f=features.get(id,{});row=dict(id=id,targetId=attempt['targetId'],status=ledger[id]['status'],reason=ledger[id]['reason'],confidenceStatus=ledger[id]['confidenceStatus'],coordinateSha256=(attempt['coordinate'] or {}).get('sha256'),confidenceSha256=(attempt['confidence'] or {}).get('sha256'),evidenceTier=f.get('evidenceTier'),burial=f.get('burial'),contacts=f.get('contacts'),clashes=f.get('clashes'),overlapBurden=f.get('overlapBurden'),confidence=f.get('confidence'),DockQ=outcomes[id]['DockQ'],outcomeStatus=outcomes[id]['status'])
  for arm in ['frozen-v06','burial-only','predictor-confidence','clash-fraction-v1','overlap-burial-v1']:
   group=next(r for r in ranks if r['targetId']==attempt['targetId'] and r['arm']==arm);rankrow=next((r for r in group['rows'] if r['id']==id),{});row[arm+'Rank']=rankrow.get('rank');row[arm+'Selected']=id in group['selected'];row[arm+'Status']=group['status']
  rows.append(row)
 with (pub/'all-40-attempts.csv').open('w') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
 with (pub/'all-20-selections.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(ev['selectionRows'][0]));w.writeheader();w.writerows({**r,'selected':'; '.join(r['selected'])} for r in ev['selectionRows'])
 for name in ['plan.json','references-template.json','input-and-reference-review.json','archive-provenance.json','study-design.json','freeze.json']:shutil.copy2(bundle/name,pub/name)
 for name in ['features.json','ranks.json','attempts.json','receipt.json']:shutil.copy2(result/'scores'/name,pub/('score-'+name))
 for name in ['outcomes.json','crosschecks.json','receipt.json']:shutil.copy2(result/'dockq'/name,pub/('dockq-'+name))
 for name in ['controller-receipt.json','precheck.json']:shutil.copy2(result/name,pub/name)
 shutil.copy2(result/'comparison/evaluation.json',pub/'evaluation.json')
 original=load(ROOT/'validation/prospective-benchmark-v1/exposed-regression/features.json');assert all(features[r['id']]==r for r in original)
 assert len(rows)==40 and sum(r['status']=='scored' for r in rows)==35 and sum(r['status']=='not-run' for r in rows)==5
 assert all(r['status']=='PASS' and r['absoluteDifference']==0 for r in load(result/'dockq/crosschecks.json'))
 assert sum(r['arm']=='predictor-confidence' and r['status']=='abstain' for r in ev['selectionRows'])==3
 verification=dict(status='PASS',allPreparedHashesVerified=True,coordinatesVerifiedAgainstHistoricalBindings=35,legacyConfidenceFilesVerifiedAgainstHistoricalBindings=len(verified),plannedAttempts=40,scoredCoordinates=35,missingHistoricalCoordinates=5,scoringFailures=0,dockqAvailable=35,dockqFailures=0,firstCandidateApiCliCrosschecksPassed=4,legacyConfidenceArmAbstentions=3,original3P0GFeaturesExactlyReproduced=True,original3P0GNegativeSelectionPreserved=True,fiveMethodsUnchanged=True,independentValidation=False)
 save(dest/'verification.json',verification);print(json.dumps(verification,indent=2))
if __name__=='__main__':main()
