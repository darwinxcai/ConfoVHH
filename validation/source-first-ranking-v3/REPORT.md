# ConfoVHH round 3: ranking, candidate generation and larger complexes

**Completed: 300 fresh predictions evaluated; independent scientific review passed. Experimental changes are retained for review, with production defaults unchanged.**

The finite experiment generated 25 prespecified predictions for each of 12 GPCR–nanobody target sets: four development sets for choosing the ranking policy, and eight sets evaluated after that policy was frozen. It also tested a membrane term on an earlier panel and checked the unchanged behavior of all 995 previously evaluated predictions. This round does not change production defaults.

## What the completed development tests show

On this panel, predictor confidence remains the strongest supported starting point. On the 100 development predictions, validating the input and using nanobody contact information for exact confidence ties did not change the first selections or the top-five summaries. Allowing contact information to override nearby confidence scores lowered group-weighted mean first-choice DockQ; acceptable-first-choice probability was unchanged. The selected override tolerance is therefore zero, fixed before the prospective outcomes were opened.

Two development sets contain acceptable candidates in all 25 runs; the other two contain none. A ranking method cannot select a good structure that the generator never produced. These single-class pools also cannot test how well a ranker separates acceptable from unacceptable candidates within the same pool.

Here, “acceptable” means the predicted interface passes the prespecified structural-agreement threshold, DockQ ≥0.23. It is a computational comparison with a reference structure, not experimental evidence of binding, affinity or biological activity. Higher DockQ means closer structural agreement.

## All 300 fresh predictions

All 300 attempts generated predictions, all 300 were input-valid, and all 300 pose-level reference outcomes were available. In the eight prospective sets, source confidence selected an acceptable first structure in **6/8**, including every set that contained any acceptable candidate. The frozen contact-based policies made the same first selections and had the same top-five summaries. Their added first-choice DockQ gain, acceptable-choice probability gain, lost-success count and rescued-success count are all **zero** versus source confidence.

The independent review confirmed that every prospective confidence score block contains one prediction. Consequently, exact-tie contact rules and the calibrated zero-gap rule have no opportunity to change the ordering on this panel. Their unchanged results do not demonstrate that contacts carry no useful information in other settings.

| Target case | Exposure stratum | Acceptable / 25 | Source / frozen first DockQ | Top-five mean DockQ | Acceptable in top five |
|---|---|---:|---:|---:|---:|
| APLNR–JN241 / 6KNM | Development | 25/25 | 0.6929 / 0.6929 | 0.6876 | 5/5 |
| OPRM1–NbE / 8QOT | Development | 0/25 | 0.1415 / 0.1415 | 0.1456 | 0/5 |
| AGTR1–AT118 / 8TH3 | Development | 25/25 | 0.4706 / 0.4706 | 0.4695 | 5/5 |
| AGTR1–AT118 / 8TH4 | Development | 0/25 | 0.1066 / 0.1066 | 0.1030 | 0/5 |
| GRM5–Nb43 | New outcome group | 25/25 | 0.7188 / 0.7188 | 0.7576 | 5/5 |
| LGR4–Nb21 | New outcome group | 0/25 | 0.1086 / 0.1086 | 0.1093 | 0/5 |
| CASR–Nb2D11 | Exploratory, low resolution | 0/25 | 0.0085 / 0.0085 | 0.0146 | 0/5 |
| CHRM1–Nb1B4 | Related exposed family | 3/25 | 0.2536 / 0.2536 | 0.1467 | 2/5 |
| ADRA1A–Nb29 | Development exposed | 11/25 | 0.2760 / 0.2760 | 0.3835 | 5/5 |
| HCRTR2–Sb51 | Development exposed | 25/25 | 0.4284 / 0.4284 | 0.5123 | 5/5 |
| RHO–Nb2 | Development exposed | 22/25 | 0.7347 / 0.7347 | 0.6995 | 5/5 |
| FZD3–Nb9 | Development exposed | 24/25 | 0.5227 / 0.5227 | 0.5338 | 5/5 |

The prospective pool contains 110/200 acceptable predictions; development contains 50/100. These pose counts describe availability, not independent biological replication. Four prospective pools contain a mixture of acceptable and unacceptable structures: ADRA1A, CHRM1, FZD3 and RHO. Both newly outcome-tested groups still have single-class pools: GRM5 is 25/25 acceptable and LGR4 is 0/25. Thus the most independent stratum does not test binary discrimination within a mixed pool.

| Fixed stratum | Biological groups / target sets | First-choice mean DockQ | Acceptable first-choice rate | Added frozen-policy gain |
|---|---:|---:|---:|---:|
| development-calibration | 3 / 4 | 0.374325 | 50% | 0 |
| new-outcome-group | 2 / 2 | 0.413727 | 50% | 0 |
| new-outcome-group-exploratory-low-resolution | 1 / 1 | 0.008530 | 0% | 0 |
| related-exposed-family | 1 / 1 | 0.253610 | 100% | 0 |
| development-exposed | 4 / 4 | 0.490466 | 100% | 0 |

These means weight biological groups equally and target sets equally inside a group. Development, earlier exposure and low-resolution exploratory cases are kept separate from the two newly outcome-tested groups. No significance claim is made.

### Comparison with the unchanged physical scorer

The old physical scorer can rank five of the eight prospective sets on these same saved candidates. On that explicitly matched subset, source confidence chooses an acceptable first structure in **5/5**, versus **3/5** for the physical scorer. It avoids the physical scorer’s failed first choices for CHRM1 and RHO. First-choice mean DockQ is 0.443095 versus 0.375563; top-five mean DockQ is 0.455163 versus 0.396667, with 22/25 versus 17/25 acceptable top-five selections.

This is evidence supporting confidence-first ranking on these fresh predictions, not an additional benefit from the new contact term. Physical scoring still chooses a closer first structure on ADRA1A, FZD3 and HCRTR2, although both methods pass the acceptable threshold in those cases. Its three unavailable sets—CASR, GRM5 and LGR4—remain explicit abstentions; they are not counted as physical-score failures or silently dropped from an all-planned mean. The matched five sets have previous project/family exposure, so this comparison is not a new-family confirmation.

Exact counts, continuous-quality metrics, scientific ties and missingness are in `round3-ranking/fresh-evaluation-development/` and `round3-ranking/fresh-evaluation-prospective/`. The chart is `round3-ranking/final-figures/fresh-ranking-comparison.png`, with PDF and SVG versions.

## Development-only calibration

The five candidate confidence gaps were fixed before outcomes were examined. The objective averages the two AGTR1 constructs first, then gives the three biological groups equal weight. A nonzero gap additionally had to pass the prespecified leave-one-group-out gate and avoid losing an acceptable source-confidence selection.

| Maximum confidence gap | Change in group-weighted first-choice DockQ |
|---:|---:|
| 0 | 0 |
| 0.002 | −0.001464 |
| 0.005 | −0.017941 |
| 0.010 | −0.017975 |
| 0.020 | −0.034966 |

All three held-out-group fits chose zero; each held-out improvement was zero. Every nonzero full-panel choice reduced mean quality. The binary no-loss condition provides limited reassurance here because every development pool contains only one outcome class. The selected gap is a development choice, not an estimate of uncertainty in confidence scores or a general safety guarantee. Its binding applies only to the pinned Boltz pair-confidence context. The two dimers and the CHRM1 third-chain context retain the separately specified exact-tie policy.

Evidence: `round3-ranking/fresh-pair-calibration/`, `round3-control/FINAL-CALIBRATION-FREEZE.json`, and the independently checked `round3-benchmark/outcome-tools/DEVELOPMENT-RESULTS.md`.

## Candidate generation: recovery with important comparison limits

| Development target | Earlier AF2IG acceptable / 50 | Earlier Boltz acceptable / 50 | New Boltz acceptable / 25 |
|---|---:|---:|---:|
| APLNR–JN241 / 6KNM | 0 | 50 | 25 |
| OPRM1–NbE / 8QOT | 0 | 48 | 0 |
| AGTR1–AT118 / 8TH3 | 0 | 50 | 25 |
| AGTR1–AT118 / 8TH4 | 0 | 50 | 0 |

The new receptor and nanobody sequences exactly match the released AF2IG constructs. Switching to the documented Boltz generation regime increased the number of sets with an acceptable candidate from 0/4 to 2/4 on those constructs. That changes the predictor and generation regime together; it does not isolate the cause or establish that an AF2IG software bug was repaired.

The earlier Boltz predictions were stronger on their own inputs: 198/200 acceptable predictions and 4/4 acceptable first choices, versus 50/100 and 2/4 here. All four old receptor constructs differ from the new constructs, although the nanobody sequences match. New/old receptor lengths are 351/380, 287/398, 393/359 and 382/359, respectively. The archived old run uses native receptor templates, empty sequence alignments and force potentials; the new run uses retrieved sequence alignments and no templates or potentials. Producer settings and seed counts also differ. This does not establish overall improvement over the old Boltz regime or a controlled regression against it.

The separate AF2IG diagnosis checked 200 coordinates and 200 uncertainty files. In 199/200 released structures, the partners already had no interface contacts at the scoring distance. Relative partner placement was uncertain despite much more stable receptor coordinates. No export translation introduced by ConfoVHH was found. The exact modified AF2IG producer and its original reordered inputs were unavailable, so the cause remains unresolved. See `round3-membrane/AF2IG_DIAGNOSIS.md` and the authenticated generation comparison in `round3-benchmark/outcome-tools/development-review/`.

## Larger-complex support and regression checks

The unchanged full physical audit has capacity limits that prevented interface feature extraction on some larger complexes. The new experimental path computes the same contact definitions without first running the more expensive surface-area calculation. It preserves the original parser, atom selection, numbering, distance boundary and contact-pair definitions; it does not trim the receptor further or substitute missing physical scores.

Where the full audit exists, it remains authoritative. Where it is absent, separately authenticated contact evidence can supply the optional contact feature. Missing optional features retain source ordering. Invalid inputs and missing required confidence remain explicit states. An otherwise input-valid prediction with no contacts is retained with an unsupported interface.

The pre-freeze contact crosscheck matched all 1,058/1,058 comparisons exactly: 995 historical predictions, 50 development implementation-check predictions and 13 prospective implementation-check predictions with available full audits. It recovered contact evidence for all seven capacity-limited predictions in the 20-prediction prospective implementation check. That establishes agreement of the implementations on those inputs, not improved biological ranking.

The complete historical regression retained the features, ranks, scientific ties, selections and evaluations of all 995 predictions and all 45 set–policy combinations. The three source-first arms each keep 9/15 acceptable first selections; all nine source-successful selections are preserved. The remaining six historical pools contain no acceptable structure. This panel was already used in development and supplies regression evidence, not independent confirmation. See `round3-ranking/REGRESSION-FINAL-REPORT.md`.

The final prospective run retained all **200/200** input-valid predictions and recovered separate contact evidence for **75/200** whose full physical audit was unavailable. All 75 contact computations succeeded. The original physical scorer and its limits remain unchanged; the recovered contact feature is not a fabricated full physical score. Coverage improvement does not by itself establish better selection accuracy. The saved v3 receipt records every source score, validation state and recovery identity.

## Membrane experiment: no consistent benefit

The separate receptor-only PPM3 experiment evaluated a fixed membrane proxy on 200 earlier Boltz predictions. One required receptor frame failed for the 8TH4 set, so the prespecified membrane policy abstains on that entire 50-prediction set. It ranks the other 150 predictions across three complete sets. No missing set is silently removed from the all-planned group summary.

On those same three eligible sets, predictor confidence selected a first structure with mean DockQ 0.7325. The existing confidence/physical hybrid achieved 0.6970, and the hybrid with the membrane term achieved 0.6873. Their top-five means were 0.7193, 0.7087 and 0.7073. All three already selected an acceptable first structure and five acceptable top-five structures in each eligible set. Some individual cases improved, but the overall comparison does not support adding this membrane term. These are conditional equal-set descriptive means on previously exposed data. Full group-level missingness and negative cases remain in `round3-membrane/ranking-evaluation/REPORT.md`.

## What the new evaluation can establish

GRM5–Nb43 and LGR4–Nb21 are newly outcome-tested biological groups in this project, but both had prior metadata screening. CASR is a separate exploratory case because its reference has 6 Å resolution. CHRM1 is related to an exposed receptor family. The other four prospective groups have earlier development exposure. Twenty-five seeds for one target do not create 25 independent biological tests. The two AGTR1 development constructs remain one group.

Predictor training exposure is also unverified. The [Boltz-2 paper](https://jeremywohlwend.com/assets/boltz2.pdf) reports an experimental PDB training cutoff of 2023-06-01. Three prospective references predate it and five postdate it. Release dates do not prove that a structure was included, and post-cutoff entries do not prove novel receptor sequences, nanobody families or interfaces. GRM5's reference is before the cutoff; LGR4's exact reference is after it. No-template inference does not remove information learned during training. The archived qualification is `round3-benchmark/training-exposure/TRAINING-EXPOSURE-LIMITATION.md`.

The generation plan pins Boltz 2.2.1 and its source/model identities, three recycling steps, 200 sampling steps, one diffusion sample per seed, step scale 1.5 and seeds 0–24. All targets use retrieved sequence alignments, with no native templates, contact restraints, force potentials or outcome-driven retries. The exact receptor/nanobody/context chain assignments are fixed in the enrollment. CASR and GRM5 include both receptor copies and both nanobodies; one predicted nanobody is selected before evaluation. CHRM1 includes its third-chain helix. LGR4 uses the enrolled receptor/Nb21 pair without the separate helper binder. These construct/context choices limit comparisons with the complete deposited assemblies.

All prospective rankings are saved and sealed before their outcomes are joined. Dimer evaluation keeps the selected predicted nanobody fixed and evaluates all four prespecified symmetry-equivalent native assignments; failure of a required assignment makes the entire pose outcome unavailable. Separate receptor-copy alignment prevents an alignment from crossing between copies. Native coordinates were excluded from prediction generation and ranking-feature inputs; they were used for chain/context qualification, reference preparation and evaluation controls. The adapter passed its frozen native-self controls and independent arithmetic checks. Scientific ranking ties are evaluated uniformly; IDs only order serialization.

## Decision and the next useful experiment

Keep predictor confidence as the leading experimental ranking signal. Retain explicit input checks and the new contact recovery as tested engineering capabilities. This round supports the earlier move away from relying on the physical score alone, but finds no added selection gain from the new contact policy; all nonzero development override settings lowered continuous first-choice quality, and the membrane addition lacked consistent benefit. Production defaults remain unchanged.

Candidate generation is still the limiting factor for OPRM1/8QOT, AGTR1/8TH4, LGR4 and the exploratory CASR case: none of their 25 new attempts passes the structural criterion. Ranking also has room to improve continuous quality even when its first choice is acceptable—for example, ADRA1A’s first choice is 0.2760 while its best generated candidate is 0.5739, and HCRTR2’s values are 0.4284 versus 0.6591. These gaps are descriptive, not evidence that a tested new scoring rule can recover them.

The next study should hold receptor/nanobody constructs fixed while generating a broader range of candidates, preserve the confidence baseline, and test ranking changes on additional independent receptor/nanobody groups with both good and bad candidates. Separate generation improvements from selection improvements, freeze changes before the new comparisons, and evaluate uncertainty across biological groups. The groups evaluated here are now development-exposed for any subsequent tuning.

## Evidence and review

The complete evidence package retains the earlier 995-prediction experiment and the new raw predictions, sequence inputs, alignments, coordinate identity maps, saved rankings, outcomes, failed attempts and negative results. Private cloud connection material and full private volume backups are excluded from the scientific archive and GitHub review. The exact archive identity and extraction replay are recorded in separate receipts. See `V3_REPLAY.md` for the runtime and reproduction limits.

The independent prospective review passed after the sealed run completed: it authenticated all 200 outcomes, reproduced all 32 set–policy summaries, and checked the 350 required reference views, including four assignments for each of 50 dimer predictions. A separate arithmetic review confirmed the matched five-set physical-score comparison. The 100 development outcomes, historical regression and negative membrane results remain preserved with their checks. The focused implementation suite passed all 60 tests. The independent review is `round3-benchmark/outcome-tools/PROSPECTIVE-RESULTS.md`, with its authenticated receipt under `prospective-review/`.

All 300 raw predictions and the complete task-created cloud workspaces were backed up before cleanup. All three experiment GPU pods, the temporary maintenance CPU pod and both task-created network volumes were removed; final provider checks confirmed that all six resources were absent. Private full-volume backups remain local and separate. Archive construction and fresh-extraction replay issue their own final receipts; those receipts identify the exact package and the report files reproduced from it.
