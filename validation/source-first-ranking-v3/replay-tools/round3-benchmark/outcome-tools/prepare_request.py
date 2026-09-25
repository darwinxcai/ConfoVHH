#!/usr/bin/env python3
"""Bind a completed preparation and sealed v3 rankings; compute no outcomes."""
import argparse
from pathlib import Path
import json
import outcome_adapter as adapter

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--artifacts',type=Path,default=adapter.DEFAULT_ROOT)
    p.add_argument('--role',choices=['development','prospective'],required=True)
    p.add_argument('--preparation',type=Path,required=True)
    p.add_argument('--ranking-receipt',type=Path,action='append',required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();root=a.artifacts.resolve();prep=a.preparation.resolve();output=a.output.resolve()
    adapter.check(output.is_relative_to(root) and output.parent.resolve()==output.parent and not output.exists(),'Output must be new and inside execution root')
    provenance=[adapter.binding(root,prep/('producer-provenance-boltz2-'+context+'.json')) for context in (['pair'] if a.role=='development' else ['pair','dimer','helix'])]
    request={'schema':'confovhh-round3-outcome-input-v1','evaluationRole':a.role,
             'executionFreeze':adapter.binding(root,root/'round3-control/EXECUTION-FREEZE.json'),
             'batchPlan':adapter.binding(root,root/'round3-cloud/launch-bundle/batch-plan.json'),
             'producerProvenance':provenance[0] if a.role=='development' else provenance,
             'rankingReceipts':[adapter.binding(root,path.resolve()) for path in a.ranking_receipt],
             'predictionViews':adapter.binding(root,prep/'prediction-view-inventory.json'),
             'referenceInventory':adapter.binding(root,root/'round3-benchmark/outcome-tools/reference-inventory.json')}
    verified=adapter.preflight(root,request)
    adapter.check(not verified['smoke'],'Only completed final preparation may produce an evaluation request')
    adapter.save(output,request)
    print(json.dumps({'request':adapter.binding(root,output),'plannedCount':len(verified['rows']),'canonicalViews':sum(r['view'] is not None for r in verified['rows']),'outcomesComputed':False}))

if __name__=='__main__':main()
