#!/usr/bin/env python3
"""Verify append-only eligibility decisions, replay accounting and original evidence."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];P=ROOT/'validation/benchmark-eligibility-resolution-v1'
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 for row in load(P/'package-manifest.json')['files']:
  f=ROOT/row['path'];assert f.stat().st_size==row['bytes'] and sha(f)==row['sha256'],row['path']
 subprocess.run([sys.executable,str(ROOT/'scripts/benchmark/verify-preparation.py')],check=True,capture_output=True)
 rows=load(P/'blocked-entry-resolution.json');assert len(rows)==270 and len({r['pdbId'] for r in rows})==270
 assert {r['pdbId'] for r in rows if r['updatedStatus']=='EXCLUDED'}=={'7UL3','9W3K'}
 assert sum(r['updatedStatus']=='BLOCKED' for r in rows)==268 and not any(r['eligibleIndependent'] for r in rows)
 groups=load(P/'relatedness-groups.json');assert len(groups['groups'])==55 and groups['noEdgesRemoved']
 members={i for g in groups['groups'] for i in g['members']};assert len(members)==348 and sum(len(g['members']) for g in groups['groups'])==348
 g=next(g for g in groups['groups'] if '6VI4' in g['members']);assert {'7UL3','9W3K'}<=set(g['members'])
 seq={r['pdbId']:r for r in load(P/'sequence-resolution.json')['results']}
 assert not any(r['thresholdCriterionSatisfied'] for r in seq['7UL3']['comparisons'])
 assert any(r['developmentId']=='development:6VI4' and r['thresholdCriterionSatisfied'] for r in seq['9W3K']['comparisons'])
 r=P/'retrospective-replay';attempts=load(r/'score-attempts.json');outcomes=load(r/'dockq-outcomes.json')['rows'];ev=load(r/'evaluation.json')
 assert len(attempts)==len(outcomes)==40 and sum(a['status']=='scored' for a in attempts)==35 and sum(a['status']=='not-run' for a in attempts)==5
 assert sum(a['status']=='available' for a in outcomes)==35 and not any(a['status']=='failed' for a in outcomes)
 assert len(ev['selectionRows'])==20 and sum(x['status']=='abstain' for x in ev['selectionRows'])==3
 old=load(ROOT/'validation/prospective-benchmark-v1/exposed-regression/ranks.json');new=load(r/'score-ranks.json')
 for row in old:
  now=next(x for x in new if x['targetId']==row['targetId'] and x['arm']==row['arm']);assert now['rows']==row['rows'] and now['selected']==row['selected']
 s={(x['targetId'],x['arm']):x for x in ev['selectionRows']}
 for arm in ('clash-fraction-v1','overlap-burial-v1'):assert s['exposed-4MQS-legacy-default',arm]['mean']<s['exposed-4MQS-legacy-default','burial-only']['mean']
 assert len(load(r/'dockq-crosschecks.json'))==4 and all(x['status']=='PASS' and x['absoluteDifference']==0 for x in load(r/'dockq-crosschecks.json'))
 assert load(r/'controller-receipt.json')['newGpuHours']==0
 print(json.dumps(dict(status='PASS',originalPreparationUnchanged=True,originalNegativeAndFiveMethodsUnchanged=True,blockedRowsAccountedFor=270,newScientificExclusions=2,remainingBlocked=268,independentGroups=0,retrospectiveAttempts=40,scoredAndDockqEvaluated=35,missing=5,confidenceAbstentions=3,apiCliPasses=4,newGeneration=False),indent=2))
if __name__=='__main__':main()
