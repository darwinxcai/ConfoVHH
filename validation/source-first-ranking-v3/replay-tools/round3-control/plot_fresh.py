"""Descriptive display of frozen results; no fitting or ranking decisions."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

ROOT=Path(__file__).resolve().parents[1]
ORDER=['dev_6knm','dev_8qot','dev_8th3','dev_8th4','GRM5_NB43','LGR4_NB21','CASR_NB2D11','CHRM1_NB1B4','ADRA1A_NB29','HCRTR2_SB51','RHO_NB2','FZD3_NB9']
LABELS={'dev_6knm':'APLNR · JN241','dev_8qot':'OPRM1 · NbE','dev_8th3':'AGTR1 · AT118 (8TH3)','dev_8th4':'AGTR1 · AT118 (8TH4)',
        'GRM5_NB43':'GRM5 · Nb43','LGR4_NB21':'LGR4 · Nb21','CASR_NB2D11':'CASR · Nb2D11','CHRM1_NB1B4':'CHRM1 · Nb1B4',
        'ADRA1A_NB29':'ADRA1A · Nb29','HCRTR2_SB51':'HCRTR2 · Sb51','RHO_NB2':'RHO · Nb2','FZD3_NB9':'FZD3 · Nb9'}

def main(args):
    metrics=[];quality=[];inputs=[]
    for folder in args.reports:
        for name,target in [('compact-metrics.json',metrics),('set-quality.json',quality)]:
            path=folder/name;target.extend(json.loads(path.read_text()));inputs.append({'path':str(path.resolve()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    by={(x['setId'],x['arm']):x for x in metrics};sets={x['setId']:x for x in quality}
    order=[s for s in ORDER if s in sets];assert len(order)==len(sets)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    fig,(ax,coverage)=plt.subplots(1,2,figsize=(12,8),gridspec_kw={'width_ratios':[3,1.3]},sharey=True)
    for row,set_id in enumerate(order):
        source=by[set_id,'source-only']
        arm='source-validity-cdr-calibrated' if (set_id,'source-validity-cdr-calibrated') in by else 'source-validity-cdr-exact'
        selected=by[set_id,arm];q=sets[set_id]
        if set_id in ('GRM5_NB43','LGR4_NB21'):
            ax.axhspan(row-.47,row+.47,color='#e8f3fb',zorder=0);coverage.axhspan(row-.47,row+.47,color='#e8f3fb',zorder=0)
        if q['bestKnownDockQ'] is not None:ax.scatter(q['bestKnownDockQ'],row,marker='|',s=170,color='#929ba4',zorder=2)
        if source['firstChoiceDockQ'] is not None:ax.scatter(source['firstChoiceDockQ'],row-.12,s=42,color='#4b5563',marker='o',zorder=3)
        if selected['firstChoiceDockQ'] is not None:ax.scatter(selected['firstChoiceDockQ'],row+.12,s=47,color='#087fa3',marker='D',zorder=3)
        if source['firstChoiceDockQ'] is not None and selected['firstChoiceDockQ'] is not None:
            ax.plot([source['firstChoiceDockQ'],selected['firstChoiceDockQ']],[row-.12,row+.12],color='#afbac3',lw=1,zorder=1)
        n=q['acceptableCountKnown'];available=q['outcomesAvailable'];planned=q['planned']
        coverage.barh(row,n,height=.5,color='#87a8b7');coverage.text(n+.4,row,f'{n}/{planned}',va='center',fontsize=9)
        if available!=planned:coverage.text(0,row+.32,f'{planned-available} unavailable',fontsize=7,color='#a34d17')
    ax.axvline(.23,color='#8a6d3b',ls=':',lw=1)
    ax.set_xlim(-.02,1.02);ax.set_yticks(range(len(order)),[LABELS[s] for s in order]);ax.invert_yaxis()
    ax.set_xlabel('Structural agreement with the reference (DockQ; higher is better)');ax.set_title('Quality of the first choice',loc='left',fontweight='bold')
    ax.grid(axis='x',alpha=.15);coverage.set_xlim(0,30);coverage.set_xticks([0,5,10,15,20,25]);coverage.set_xlabel('Acceptable predictions');coverage.set_title('What was available',loc='left',fontweight='bold');coverage.tick_params(axis='y',left=False)
    handles=[Line2D([0],[0],marker='o',color='none',markerfacecolor='#4b5563',markeredgecolor='#4b5563',label='Predictor confidence'),
             Line2D([0],[0],marker='D',color='none',markerfacecolor='#087fa3',markeredgecolor='#087fa3',label='Frozen source + contact policy'),
             Line2D([0],[0],marker='|',color='none',markeredgecolor='#929ba4',markersize=12,label='Best generated prediction')]
    fig.legend(handles=handles,loc='lower left',bbox_to_anchor=(.02,.025),ncol=3,frameon=False,fontsize=9)
    fig.suptitle('ConfoVHH · 300 new predictions',x=.025,y=.985,ha='left',fontsize=19,fontweight='bold')
    fig.text(.025,.937,'Each row contains 25 fixed seeds. Blue rows are the two newly outcome-tested groups.',ha='left',fontsize=10,color='#4b5563')
    fig.text(.025,.003,'Acceptable = DockQ ≥ 0.23. CASR is exploratory because its reference has low resolution.\nDevelopment targets occupy the first four rows; no production default was changed.',ha='left',fontsize=8,color='#555')
    fig.tight_layout(rect=(.01,.09,.99,.91))
    args.output.mkdir(parents=True,exist_ok=True)
    paths=[]
    for suffix in ['png','pdf','svg']:
        path=args.output/f'fresh-ranking-comparison.{suffix}';assert not path.exists();fig.savefig(path,dpi=180,bbox_inches='tight');paths.append(path)
    receipt={'schema':'confovhh-round3-descriptive-plot-v1','inputs':inputs,'selectedPolicy':'Context-eligible frozen calibrated arm when present, otherwise frozen exact-tie arm.',
             'dataSelectionOrFitting':False,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    with (args.output/'plot-receipt.json').open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--reports',type=Path,nargs='+',required=True);parser.add_argument('--output',type=Path,required=True);main(parser.parse_args())
