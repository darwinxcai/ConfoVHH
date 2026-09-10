#!/usr/bin/env python3
"""Verify the preparation freeze and inventory without opening new outcomes."""
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'validation/prospective-benchmark-v1'
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    for r in load(P/'inventory/source-bindings.json'):
        p=ROOT/r['path'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'],r['path']
    rows=load(P/'inventory/curated-target-inventory.json');summary=load(P/'inventory/summary.json')
    groups=load(P/'inventory/relatedness-groups.json');ids={r['pdbId'] for r in rows}
    assert len(ids)==len(rows)==summary['curatedEntries']
    membership={id:g['id'] for g in groups for id in g['members']}
    assert set(membership)==ids and sum(len(g['members']) for g in groups)==len(ids)
    assert all(r['relatednessGroup']==membership[r['pdbId']] and not r['eligibleIndependent'] and r['exclusionOrBlockReasons'] for r in rows)
    assert all(not g['certifiedIndependent'] for g in groups)
    assert summary['certifiedIndependentGroups']==0 and summary['eligibleTargets']==[]
    for status,key in [('EXCLUDED','excludedCuratedEntries'),('BLOCKED','blockedCuratedEntries')]:
        assert sum(r['status']==status for r in rows)==summary[key]
    with (P/'inventory/discovery-and-eligibility-ledger.csv').open() as f:ledger=list(csv.DictReader(f))
    assert len(ledger)==len({r['pdbId'] for r in ledger})==summary['discoveryIdentifiers']
    assert sum(r['curatedInventory']=='True' for r in ledger)==len(rows)
    assert all(r['eligibleIndependent']=='False' and r['reason'] for r in ledger)
    lookup={r['pdbId']:r for r in rows}
    assert lookup['3P0G']['status']=='EXCLUDED' and lookup['8JXS']['status']=='EXCLUDED'
    assert lookup['7E6U']['status']=='EXCLUDED'
    assert membership['9VOR']==membership['9VOS'] and membership['7E9G']==membership['8TAO']==membership['6N4X']
    feasible=load(P/'feasibility-and-compute.json')
    assert feasible['actualEligibleIndependentGroups']==0 and feasible['proposedGpuAllocationHours']==0
    for r in load(P/'engine-lock.json')['files'].values():assert len(r['sha256'])==64
    freeze=P/'freeze-v1.json'
    if freeze.exists():
        f=load(freeze);assert f['runnableProspectiveStudySealed'] is False and f['eligibleTargets']==[] and f['eligibleIndependentGroups']==[]
        for r in f['artifacts']:
            p=ROOT/r['path'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'],r['path']
    subprocess.run([sys.executable,str(ROOT/'scripts/paper/verify-graded-clash-exploration-v1.py')],check=True,capture_output=True)
    print(json.dumps(dict(status='PASS',curatedEntries=len(rows),discoveryIdentifiers=len(ledger),
          certifiedIndependentGroups=0,provisionalComponents=len(groups),originalFiveMethodsAndEvidenceUnchanged=True,
          newCandidateOutcomesRead=False,newGeneration=False,runnableProspectiveStudySealed=False),indent=2))


if __name__=='__main__':main()
