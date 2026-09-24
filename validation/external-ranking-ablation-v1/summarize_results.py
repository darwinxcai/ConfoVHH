import csv, hashlib, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
load=lambda p:json.loads((ROOT/p).read_text())
analysis=load('outcomes/analysis.json'); outcomes={r['id']:r for r in load('outcomes/outcomes.json')}
features={r['id']:r for r in load('scores/features.json')}; ranks=load('scores/ranks.json')
def csvsave(name,rows):
 with (ROOT/name).open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
summary=[]; long=[]; bands=[]; selected=[]
for r in analysis['arms']:
 summary.append(dict(collection=r['setId'],method=r['arm'],n=r['plannedCount'],spearman=r['spearmanPreferenceVsDockQ'],auroc=r['pairwiseAUROCByThreshold']['0.23'],selected_dockq=r['selected']['meanDockQ'],top10_correct=r['windows']['top10']['correctCountsByThreshold']['0.23'],random_top10_correct=10*r['randomExpectation']['correctFractionByThreshold']['0.23'],best_available_dockq=r['bestAvailable']['DockQ'],best_available_rank_interval=json.dumps(r['bestAvailable']['overallRankInterval'])))
 for band in ['topThird','middleThird','bottomThird']:
  bands.append(dict(collection=r['setId'],method=r['arm'],band=band,size=r['windows'][band]['size'],**r['windows'][band]['qualityCounts']))
 for id in r['selected']['ids']:
  selected.append(dict(collection=r['setId'],method=r['arm'],id=id,DockQ=outcomes[id]['DockQ'],**{k:features[id][k] for k in ['burial','evidenceTier','contacts','clashes','overlapBurden']}))
for r in ranks:
 for item in r['rows']:
  id=item['id'];long.append(dict(collection=r['setId'],method=r['arm'],id=id,scientific_rank=item['rank'],rank_key=json.dumps(item['key']),DockQ=outcomes[id]['DockQ'],burial=features[id]['burial'],clashes=features[id]['clashes'],contacts=features[id]['contacts'],overlap_burden=features[id]['overlapBurden'],source_score=features[id]['producerScore']))
csvsave('summary.csv',summary);csvsave('ranked_poses.csv',long);csvsave('ranked_quality_bands.csv',bands);csvsave('selected_pose_diagnostics.csv',selected)
published={r['pose_id']:float(r['dockq']) for r in csv.DictReader((ROOT/'champloo_data/6IBB_pose_manifest.csv').open())}
for kind in ['original','refined']:
 for r in load(f'lightdock_data/{kind}/mapped_records.json'):
  published[r['id']]=(r['published_fnat']+1/(1+(r['published_iRMSD']/1.5)**2)+1/(1+(r['published_LRMSD']/8.5)**2))/3
diagnostic=[dict(id=id,collection=r['setId'],official_dockq=r['DockQ'],source_dockq=published[id],absolute_difference=abs(r['DockQ']-published[id]),source_metric='published DockQ rounded to three decimals' if r['setId']=='champloo_6ibb' else 'DockQ formula applied to published ProFit/Fnat terms') for id,r in outcomes.items()]
csvsave('published_metric_comparison.csv',diagnostic)
handoff={'champloo_6ibb':(.363,.640),'lightdock_original_3p0g':(-.207,.442),'lightdock_refined_3p0g':(.645,.773)}
csvsave('compatibility_with_handoff.csv',[dict(collection=r['collection'],handoff_spearman=handoff[r['collection']][0],fresh_spearman=r['spearman'],difference_spearman=r['spearman']-handoff[r['collection']][0],handoff_auroc=handoff[r['collection']][1],fresh_auroc=r['auroc'],difference_auroc=r['auroc']-handoff[r['collection']][1]) for r in summary if r['method']=='frozen-v06'])
names={'champloo_6ibb':'Champloo Chai-1 / 6IBB','lightdock_original_3p0g':'LightDock original / 3P0G','lightdock_refined_3p0g':'HADDOCK refined / 3P0G'}
methods={'frozen-v06':'Shipped ConfoVHH','burial-only':'Burial alone','producer-score':'Source score','clash-fraction-v1':'Clash fraction','overlap-burial-v1':'Overlap burden'}
table='| Collection | Method | Spearman ↑ | AUROC ↑ | Selected DockQ ↑ | Correct in top 10 |\n|---|---|---:|---:|---:|---:|\n'
for r in summary:table+=f"| {names[r['collection']]} | {methods[r['method']]} | {r['spearman']:.3f} | {r['auroc']:.3f} | {r['selected_dockq']:.3f} | {r['top10_correct']:g} |\n"
report='''# External pose-ranking improvement experiment — 24 September 2026

The existing overlap-burden penalty improves correct-versus-incorrect AUROC over the shipped ConfoVHH ordering on all three external collections. It is **not an overall replacement**: the top original LightDock pose deteriorates from DockQ 0.245 to 0.114, refined-pose rank correlation falls slightly, and source scores outperform it on every collection's AUROC. The clash-fraction alternative substantially harms Champloo ordering. Production ranking remains unchanged.

This continuation used the pasted handoff and a fresh GitHub checkout, including the current scientific draft. No local memory, earlier task history, or old workspace outputs were consulted. The new work is a separate, reproducible external-development benchmark adapter and a five-method ablation, not flexible model training or a prospective validation claim.

## Results

All **395 poses** have five saved rankings and independently computed official DockQ outcomes, without missing scores or reference failures. Scores were sealed before the separate reference stage. Correct means DockQ >=0.23; high means >=0.80. Source scores are original Chai-1 ipTM, LightDock score and HADDOCK score, with their respective directions. Each method ranks the same complete collection.

'''+table+'''
![Five-method comparison](ranking-comparison.png)

The three collections contain only **two biological systems**, both development-exposed. The original and refined LightDock poses are related descendants. There are zero certified independent groups. No pose-level significance tests or independent-generalization claims are made.

## What the ablation says

- **SUCNR1–Nb6:** overlap burden raises AUROC from 0.639 to 0.663 and correct poses in the top ten from nine to ten, while retaining the same high-quality first pose. Its AUROC remains far below Chai-1 ipTM's 1.000. Clash fraction falls to 0.445.
- **Original ADRB2–Nb80:** both graded formulas repair much of the shipped ranker's poor global ordering. However, simple burial already achieves AUROC 0.760, above either penalty (0.758 and 0.726). Both penalties select an incorrect pose at DockQ 0.114, whereas shipped ConfoVHH, burial alone and the source score each select an acceptable pose. Better AUROC does not imply a better first choice.
- **Refined ADRB2–Nb80:** overlap burden's AUROC gain is only 0.003; rank correlation declines from 0.641 to 0.632. Every geometric arm selects the same incorrect pose (DockQ 0.114), whereas the HADDOCK score selects an acceptable one (0.267). The penalties do not resolve that selection failure.

This supports further examination of interface specificity and the source-score advantage, but supplies no fair basis for fitting additional weights to these same two systems. The two tested formulas and all negative results are retained. Neither candidate is promoted to the application default.

## Compatibility with the handoff

The new baseline is measured in the same execution as the candidate arms. It is close to, but not an exact replay of, the pasted historical summary: fresh Spearman values are 0.361 / -0.206 / 0.641 versus 0.363 / -0.207 / 0.645; AUROC is 0.639 / 0.442 / 0.772 versus 0.640 / 0.442 / 0.773. The historical detailed artifacts were deliberately not consulted, so their precise chain/rounding/scoring configuration cannot be certified from the handoff alone. No setting was changed to force those numbers.

For Champloo, all published DockQ values reproduce within 0.0005. Using those three-decimal source values rather than full-precision recomputed values gives shipped Spearman 0.3627 and source-score Spearman 0.7231, explaining the correlation rounding difference. It does not explain the small historical shipped-AUROC difference.

Official DockQ classes in the fresh, fixed-reference run are:

| Collection | Incorrect | Acceptable | Medium | High |
|---|---:|---:|---:|---:|
| Champloo | 68 | 0 | 48 | 79 |
| LightDock original | 82 | 14 | 4 | 0 |
| HADDOCK refined | 83 | 14 | 3 | 0 |

The original LightDock distribution differs from the handoff's 80 incorrect / 17 acceptable / 3 medium. The same fresh class counts also follow from the published LightDock/HADDOCK metric terms. CAPRI category labels and DockQ threshold categories must not be silently interchanged. This experiment makes no claim to have resolved the historical count discrepancy. See `compatibility_with_handoff.csv` and `published_metric_comparison.csv`.

## New-target qualification

A bounded fresh RCSB text-query search of releases after 10 September through 24 September returned 16 records absent from the retained inventory, including eight GPCR-titled entries. Six belong to an exposed family. Newly released AVPR1A entries 9U40/9U43 contain Nb35; no source-backed direct receptor-binding role was established. Neither is cleared. The detailed search, query limitations and exact metadata are retained in `research_holdout/README.md`. This was a metadata refresh, not an exhaustive all-PDB sequence census.

## Implementation and checks

- Baseline GitHub main: `9aeadb8185a02da4e67967d9fbe12b1503d02e96`; continuation base: `dc543d152b73d31d80933e8c90e2444c9319c59a`. The four scientific parser/audit/ranking files match the frozen engine exactly. All 41 frozen dependency/source identities and the original graded-selector module are checked before scoring.
- A new strict PDB/mmCIF development adapter reads unchanged coordinate bytes and explicit model/chain roles. It preserves source-score names/directions, exact scientific ties, all attempts and whole-arm abstention for missing scores. The separate Boltz-only prospective evaluator and its eligibility rules remain untouched.
- Six scoring tests and eight reference-analysis hand-example tests passed. Independent review also checked ties, missingness, AUROC direction and the installed DockQ native-to-model mapping contract. Historical 50 method/pose keys and ranks reproduce without loading their outcomes.
- A separate Biopython/raw-decimal parser verified all 395 selected atom inventories, residue-pair and atom-contact counts, severe-clash counts, maximum overlap and overlap census. Counts/census match exactly; maximum Q difference is 8.9e-16. This independently checks geometry, not SASA or biological validity. A first-pass verifier issue with chain-local atom serial numbers was fixed by using chain-plus-serial identity; the initial failed receipt and adjudication are retained.
- A second scoring process reproduced every feature and rank exactly. Audit timestamps and their derived report hashes differ as expected; numerical audits and other provenance match. Reference evaluation used DockQ 2.1.3, NumPy 1.26.4 and Biopython 1.88, fixed chain maps (Champloo model B/A to native C/D; LightDock A/B to A/B), the first model and default sequence alignment, with no chain-map search. All three first-pose API/CLI checks matched exactly; 395 reference evaluations completed in 98.33 seconds.
- All work used local CPU. No GPU was provisioned; new cloud compute charges are zero. A plotting dependency initially tried to upgrade NumPy; it was restored to the exact analysis pin, checked with the package resolver, and no reference evaluation used the changed environment.

## Sources and files

Primary sources: [ConfoVHH scientific draft](https://github.com/darwinxcai/ConfoVHH/pull/60), [Champloo repository](https://github.com/csi-greifflab/ab_ag_champloo), [Champloo data](https://zenodo.org/records/19061737), [LightDock dataset](https://github.com/lightdock/membrane_docking/tree/6fedad53cb7f999233a706ac2090a8fde47fb33b), [LightDock paper](https://www.nature.com/articles/s41467-020-20076-5), [DockQ documentation](https://github.com/wallnerlab/DockQ).

`summary.csv` contains all 15 comparisons; `ranked_poses.csv` contains 1,975 method/pose rows; `ranked_quality_bands.csv` contains expected quality counts in equal ranked thirds (fractional boundaries for 100 poses); `selected_pose_diagnostics.csv` retains the selected pose's geometric measurements. The evidence archive contains original selected inputs, source mapping, explicit manifests, frozen engine, scripts, complete scored/reference ledgers and verification receipts. See `REPLAY.md` for reproduction.
'''
(ROOT/'REPORT.md').write_text(report)
print(table)
