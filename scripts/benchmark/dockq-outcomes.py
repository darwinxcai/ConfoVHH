#!/usr/bin/env python3
"""Separate reference stage. Never imported by the prediction-only selector."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import evaluator as e


def api_worker(model,native,model_chains,native_chains):
    from DockQ.DockQ import load_PDB, run_on_all_native_interfaces
    mapping=dict(zip(native_chains,model_chains))
    result,total=run_on_all_native_interfaces(load_PDB(str(model)),load_PDB(str(native)),chain_map=mapping,no_align=False)
    e.require(len(result)==1,'Exactly the declared receptor/VHH interface must be evaluable')
    row=next(iter(result.values()))
    print(json.dumps(dict(DockQ=float(row['DockQ']),fnat=float(row['fnat']),iRMSD=float(row['iRMSD']),LRMSD=float(row['LRMSD']),chainMap=mapping)))


def run(scores,artifacts,reference_manifest,reference_root,out):
    e.require(importlib.metadata.version('DockQ')=='2.1.3','DockQ lock mismatch')
    receipt=e.load(scores/'receipt.json');plan=e.load(scores/'plan.json');e.validate_plan(plan)
    e.require(e.sha(scores/'plan.json')==receipt['canonicalSavedPlanSha256'] and e.sha(scores/'attempts.json')==receipt['attemptsSha256'],'Score plan or attempts changed')
    refs=e.load(reference_manifest);e.keys(refs,'schema scoreReceiptSha256 targets')
    e.require(refs['schema']=='confovhh-reference-evaluation-v1' and refs['scoreReceiptSha256']==e.sha(scores/'receipt.json'),'References must bind saved score receipt')
    target_map={t['id']:t for t in plan['targets']};ref_map={}
    for r in refs['targets']:
        e.keys(r,'targetId native nativeReceptorChain nativeVhhChain')
        e.require(r['targetId'] in target_map and r['targetId'] not in ref_map,'Duplicate or unknown reference target')
        for k in ('nativeReceptorChain','nativeVhhChain'):
            e.require(isinstance(r[k],str) and len(r[k])==1 and r[k].isalnum(),'Single ASCII chain IDs required for fixed CLI mapping')
        e.require(r['nativeReceptorChain']!=r['nativeVhhChain'],'Distinct reference roles required')
        ref_map[r['targetId']]=r
    e.require(set(ref_map)==set(target_map),'Every target needs explicit reference status')
    out.mkdir(parents=True,exist_ok=False);e.save(out/'reference-plan.json',refs)
    status={a['id']:a for a in e.load(scores/'attempts.json')};outcomes=[];crosschecks=[];checked=set()
    for attempt in plan['attempts']:
        id=attempt['id'];t=target_map[attempt['targetId']];r=ref_map[t['id']]
        row=dict(id=id,status='missing',DockQ=None,reason='No evaluable generated coordinates')
        if status[id]['status']=='scored':
            folder=out/id;folder.mkdir()
            try:
                e.require(r['native'] is not None,'Missing reference declared')
                model=e.artifact(artifacts.resolve(),attempt['coordinate']);native=e.artifact(reference_root.resolve(),r['native'])
                mc=t['receptorChain']+t['vhhChain'];nc=r['nativeReceptorChain']+r['nativeVhhChain']
                e.require(len(mc)==2,'Single character prediction chains required by fixed DockQ CLI contract')
                cmd=[sys.executable,str(Path(__file__).resolve()),'api-worker',str(model),str(native),mc,nc]
                with (folder/'api.stdout.json').open('xb') as stdout,(folder/'api.stderr.log').open('xb') as stderr:
                    subprocess.run(cmd,stdout=stdout,stderr=stderr,timeout=120,check=True)
                q=e.load(folder/'api.stdout.json')['DockQ'];e.require(0<=q<=1,'Invalid API DockQ')
                if t['id'] not in checked:
                    checked.add(t['id']);cli=folder/'cli.json'
                    cmd=[sys.executable,'-m','DockQ',str(model),str(native),'--mapping',mc+':'+nc,'--json',str(cli),'--n_cpu','1']
                    with (folder/'cli.stdout.log').open('xb') as stdout,(folder/'cli.stderr.log').open('xb') as stderr:
                        subprocess.run(cmd,stdout=stdout,stderr=stderr,timeout=120,check=True)
                    cq=e.load(cli)['GlobalDockQ'];delta=abs(cq-q)
                    crosschecks.append(dict(targetId=t['id'],candidate=id,api=q,cli=cq,absoluteDifference=delta,status='PASS' if delta<=1e-12 else 'FAIL'))
                    e.require(delta<=1e-12,'API/CLI crosscheck failed; stop without changing mapping')
                row=dict(id=id,status='available',DockQ=q,reason='')
            except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
                row.update(status='failed',reason=type(error).__name__+': '+str(error))
                # Diagnose a new evaluator failure before further reference evaluation.
                outcomes.append(row)
                for remaining in plan['attempts'][len(outcomes):]:
                    outcomes.append(dict(id=remaining['id'],status='missing',DockQ=None,reason='Stopped after reference-evaluation failure'))
                break
        outcomes.append(row)
    e.save(out/'outcomes.json',dict(schema='confovhh-separate-outcomes-v1',scoreReceiptSha256=e.sha(scores/'receipt.json'),rows=outcomes))
    e.save(out/'crosschecks.json',crosschecks)
    e.save(out/'receipt.json',dict(referenceManifestSha256=e.sha(reference_manifest),scriptSha256=e.sha(__file__),
          dockqVersion='2.1.3',alignment='DockQ sequence alignment; explicit roles; no chain search; no_align=False',
          allRawStdoutStderrPreserved=True,newMappingOptimization=False))


def main():
    if len(sys.argv)>1 and sys.argv[1]=='api-worker':
        api_worker(*sys.argv[2:]);return
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('scores','artifacts','reference-manifest','reference-root','output'):p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();run(a.scores,a.artifacts,a.reference_manifest,a.reference_root,a.output)


if __name__=='__main__':main()
