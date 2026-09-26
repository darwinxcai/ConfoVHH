#!/usr/bin/env python3
"""Immutable round4 feature, fitting, ranking and evaluation interfaces."""
import argparse
from pathlib import Path
import sys
sys.dont_write_bytecode=True
import artifacts as a
import ranker as r

HERE=Path(__file__).resolve().parent
IMPLEMENTATION=('ranker.py','artifacts.py','run.py')

def implementation():return {name:a.sha((HERE/name).read_bytes()) for name in IMPLEMENTATION}
def load(path):return a.strict_json(Path(path).read_bytes())

def load_predictions(root,path,allowed_roles=('development',)):
    t=load(path)
    a.check(set(t)=={'schema','evaluationRole','origin','rows','inputBindings','groupingBinding','outcomeInputs','featureNames'},'Invalid prediction table contract')
    a.check(t['schema']=='confovhh-round4-prediction-table-v1' and t['evaluationRole'] in allowed_roles and t['outcomeInputs']==[],'Only authorized outcome-free prediction table accepted')
    a.check(t['featureNames']==list(r.FEATURES),'Feature list changed')
    for b in t['inputBindings']:a.bound(root,b)
    a.bound(root,t['groupingBinding']);r.validate_rows(t['rows'])
    return t

def load_labels(root,path,table):
    x=load(path)
    a.check(set(x)=={'schema','evaluationRole','labels','inputBindings','predictionTableDigest','reservedOutcomesRead'},'Invalid labels contract')
    a.check(x['schema']=='confovhh-round4-development-labels-v1' and x['evaluationRole']=='development' and x['reservedOutcomesRead'] is False,'Labels not authorized development')
    a.check(x['predictionTableDigest']==r.digest(table),'Labels bound to different prediction table')
    for b in x['inputBindings']:a.bound(root,b)
    r.validate_labels(table['rows'],x['labels']);return x

def proposed_release(root,predictions,labels):
    t=load_predictions(root,predictions);load_labels(root,labels,t);_,gb=a.qualified_groups(root)
    return {'schema':'confovhh-round4-development-fit-release-v1','evaluationRole':'development',
            'authorizeDevelopmentFit':False,'protocol':a.binding(root,HERE/'PROTOCOL-DRAFT.md'),
            'implementation':implementation(),'predictionTable':a.binding(root,Path(predictions).resolve()),
            'labels':a.binding(root,Path(labels).resolve()),'grouping':gb,'plannedIds':sorted(x['id'] for x in t['rows'])}

def validate_release(root,release):
    keys={'schema','evaluationRole','authorizeDevelopmentFit','protocol','implementation','predictionTable','labels','grouping','plannedIds'}
    a.check(set(release)==keys,'Invalid fit release fields')
    a.check(release['schema']=='confovhh-round4-development-fit-release-v1' and release['evaluationRole']=='development' and release['authorizeDevelopmentFit'] is True,'Fitting lacks explicit development release')
    a.check(release['implementation']==implementation(),'Fitting code differs from release')
    a.check(release['protocol']==a.binding(root,HERE/'PROTOCOL-DRAFT.md'),'Protocol differs from release')
    for key in ('protocol','predictionTable','labels','grouping'):a.bound(root,release[key])
    groups,gb=a.qualified_groups(root);a.check(gb==release['grouping'],'Qualified grouping differs')
    t=load_predictions(root,root/release['predictionTable']['path']);l=load_labels(root,root/release['labels']['path'],t)
    a.check(release['plannedIds']==sorted(x['id'] for x in t['rows']),'Fit membership differs')
    r.validate_groups(t['rows'],groups);return t,l,groups

def write_result(folder,values,metadata):
    folder=Path(folder).resolve();a.check(folder.is_relative_to(HERE) and not folder.exists(),'Output must be new directory under round4-ranking')
    folder.mkdir(parents=True)
    for name,value in values.items():a.save(folder/name,value)
    receipt={'schema':'confovhh-round4-ranking-execution-receipt-v1','implementation':implementation(),
             'files':{name:a.binding(a.ROOT,folder/name) for name in values},**metadata}
    a.save(folder/'receipt.json',receipt)
    return receipt

def fit(root,release_path,output):
    release=load(release_path);table,label_record,groups=validate_release(root,release);rows=table['rows'];labels=label_record['labels']
    files={};summary={}
    for family in ('confidence','interface'):
        nested=r.nested_validate(rows,labels,groups,family)
        setting,selection=r.select_setting(rows,labels,groups,family)
        model=r.source_model(family,rows,groups) if setting is None else r.fit_ridge(rows,labels,groups,family,setting)
        files[family+'-nested.json']=nested;files[family+'-final-selection.json']=selection
        files[family+'-model.json']=model
        summary[family]={'selectedFinalLambda':setting,'finalModelKind':model['kind'],
                         'nestedAllPlanned':nested['allPlannedComparison'],'nestedLearnerSupported':nested['learnerSupportedComparison']}
    files['summary.json']={'families':summary,'candidateGate':'Exploratory >=0.02 nested supported first DockQ gain, no acceptable loss, unchanged selection coverage',
                           'familyChoiceAfterOuterResultsIsExploratory':True,'productionDefaultChanged':False,
                           'BoltzWeightsChanged':False,'allTrainingDataDevelopmentExposed':True,'reservedOutcomesRead':False}
    return write_result(output,files,{'status':'COMPLETE','release':a.binding(root,Path(release_path).resolve()),'planned':len(rows),'reservedOutcomesRead':False})

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['extract-round3','labels-round3','prepare-release','fit','rank','evaluate'])
    p.add_argument('--artifacts',type=Path,default=a.ROOT);p.add_argument('--predictions',type=Path)
    p.add_argument('--labels',type=Path);p.add_argument('--release',type=Path);p.add_argument('--model',type=Path)
    p.add_argument('--ranks',type=Path);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();root=args.artifacts.resolve()
    if args.command=='extract-round3':
        table=a.extract_round3(root)
        result=write_result(args.output,{'predictions.json':table,'feature-availability.json':a.feature_audit(table)},
                            {'status':'COMPLETE','outcomeInputs':[],'planned':len(table['rows'])})
    elif args.command=='labels-round3':
        table=load_predictions(root,args.predictions)
        result=a.extract_round3_labels(root,table);a.save(args.output,result)
    elif args.command=='prepare-release':
        result=proposed_release(root,args.predictions,args.labels);a.save(args.output,result)
    elif args.command=='fit':result=fit(root,args.release,args.output)
    elif args.command=='rank':
        table=load_predictions(root,args.predictions,('development','reserved-evaluation'));model=load(args.model) if args.model else None
        result={'schema':'confovhh-round4-saved-ranks-v1','predictionTableDigest':r.digest(table),'ranks':r.rank(table['rows'],model),
                'modelBinding':a.binding(root,args.model.resolve()) if args.model else None,'outcomeInputs':[]}
        a.save(args.output,result)
    else:
        table=load_predictions(root,args.predictions);labels=load_labels(root,args.labels,table);groups,_=a.qualified_groups(root)
        ranks=load(args.ranks);a.check(ranks['predictionTableDigest']==r.digest(table),'Ranks and predictions differ')
        result=r.evaluate(table['rows'],labels['labels'],groups,ranks['ranks']);a.save(args.output,result)
    print(a.strict_json(__import__('json').dumps({'status':'COMPLETE','output':str(args.output)})))

if __name__=='__main__':main()
