import os
os.environ.setdefault('MPLCONFIGDIR','/private/tmp/confovhh-mpl-cache')
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parent
data=json.loads((ROOT/'outcomes/analysis.json').read_text())
arms=['frozen-v06','burial-only','producer-score','clash-fraction-v1','overlap-burial-v1']
labels=['Shipped ConfoVHH','Burial alone','Source score','Clash fraction','Overlap burden']
colors=['#475569','#a16207','#2563eb','#0f766e','#9333ea']
sets=['champloo_6ibb','lightdock_original_3p0g','lightdock_refined_3p0g']
table={(r['setId'],r['arm']):r for r in data['arms']}
fig,axes=plt.subplots(1,3,figsize=(13,5.5))
metrics=[('Rank correlation',lambda r:r['spearmanPreferenceVsDockQ'],(-.5,1)),('Correct-pose AUROC',lambda r:r['pairwiseAUROCByThreshold']['0.23'],(0,1.04)),('Selected pose DockQ',lambda r:r['selected']['meanDockQ'],(0,1))]
for ax,(title,read,limits) in zip(axes,metrics):
 for ai,(arm,label,color) in enumerate(zip(arms,labels,colors)):
  xs=[s+(ai-2)*.12 for s in range(3)]
  ys=[read(table[(s,arm)]) for s in sets]
  ax.scatter(xs,ys,s=62,c=color,label=label,zorder=3,edgecolor='white',linewidth=.7)
 ax.set_title(title,fontsize=13,pad=15,loc='left')
 ax.set_ylim(*limits);ax.set_xlim(-.5,2.5)
 ax.set_xticks(range(3),['Chai-1\n6IBB','LightDock\n3P0G','Refined\n3P0G'],fontsize=10)
 ax.grid(axis='y',color='#e2e8f0',linewidth=.7);ax.set_axisbelow(True)
 ax.spines[['top','right']].set_visible(False)
 ax.spines[['left','bottom']].set_color('#cbd5e1')
 ax.tick_params(colors='#475569');ax.set_ylabel('Higher is better',fontsize=10,color='#475569')
 if 'AUROC' in title:ax.axhline(.5,color='#94a3b8',ls='--',lw=1)
fig.suptitle('External pose ranking with gradual clash penalties',x=.06,y=.98,ha='left',fontsize=17,weight='bold')
fig.text(.06,.91,'395 poses · 3 collections · 2 development-exposed biological systems · no independent validation',fontsize=10,color='#475569')
handles,legend=axes[0].get_legend_handles_labels()
fig.legend(handles,legend,loc='lower center',ncol=5,frameon=False,bbox_to_anchor=(.5,.035),fontsize=10)
fig.subplots_adjust(top=.8,bottom=.24,left=.065,right=.985,wspace=.31)
fig.savefig(ROOT/'ranking-comparison.png',dpi=180,facecolor='white')
fig.savefig(ROOT/'ranking-comparison.pdf',facecolor='white')
