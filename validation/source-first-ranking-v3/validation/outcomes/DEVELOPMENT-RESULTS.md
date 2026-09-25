# Development results: no additional ranking gain

All 100 planned development predictions were produced, canonicalized and evaluated successfully. Source ranking, source plus validity, and source plus validity with exact-score CDR tie handling selected the same first candidates and had identical top-five summaries. The new ranking rules therefore show **no added selection benefit on this panel**. Acceptable means DockQ ≥ 0.23.

| Development set | Acceptable poses | First-choice DockQ | Top-five mean DockQ | Acceptable in top five |
|---|---:|---:|---:|---:|
| 6KNM | 25/25 | 0.692878 | 0.687603 | 5/5 |
| 8QOT | 0/25 | 0.141479 | 0.145586 | 0/5 |
| 8TH3 | 25/25 | 0.470623 | 0.469503 | 5/5 |
| 8TH4 | 0/25 | 0.106615 | 0.103028 | 0/5 |

First-choice success is 2/4 sets for all three arms. Every set contains either only acceptable or only unacceptable poses. This panel cannot test discrimination within mixed acceptable/unacceptable candidate pools; within-set AUROC at 0.23 is undefined. Continuous DockQ differences remain measurable. The four sets represent only three biological groups because 8TH3 and 8TH4 share AGTR1–AT118. These are development results, not independent validation.

The prespecified confidence-gap experiment rejected every nonzero choice. The objective averages sets within each biological group, then gives each group equal weight. Exact scientific ties receive uniform weight.

| Maximum source-confidence gap | Change in group-weighted first-choice DockQ versus source |
|---:|---:|
| 0 | 0 |
| 0.002 | −0.001464 |
| 0.005 | −0.017941 |
| 0.010 | −0.017975 |
| 0.020 | −0.034966 |

All candidates passed the acceptable-choice no-loss condition, which is weak here because every pool has one binary outcome class. Each of the three leave-one-biological-group-out fits selected gap 0, including the exact-objective tie that favors the smaller gap. Held-out gains were 0 for APLNR–JN241, OPRM1–NbE and AGTR1–AT118; pooled gain was 0. The nonzero adoption gate failed. The frozen result is **FROZEN_ZERO**, scoped to the pinned Boltz 2.2.1 pair-confidence context. It is not a measured confidence uncertainty or a general safety claim.

The earlier released models must be included in the generation comparison:

| Set | Old AF2IG acceptable / 50 | Old Boltz acceptable / 50 | New Boltz acceptable / 25 | Old Boltz first-choice DockQ |
|---|---:|---:|---:|---:|
| 6KNM | 0 | 50 | 25 | 0.886240 |
| 8QOT | 0 | 48 | 0 | 0.707451 |
| 8TH3 | 0 | 50 | 25 | 0.603806 |
| 8TH4 | 0 | 50 | 0 | 0.691315 |

The new input receptor and VHH sequences exactly match all 50 released AF2IG predictions per set and the corresponding processed references. Thus the change from AF2IG's 0/4 to new Boltz's 2/4 sets with acceptable candidates is construct matched at the sequence level. It changes the prediction method and generation regime, however, and does not identify an AF2IG export bug or a single cause of recovery. The earlier independent raw-file diagnosis found 199/200 AF2IG predictions already lacked contacts; it found no evidence that ConfoVHH introduced the separation. The author-modified AF2IG producer and exact reordered input artifacts were absent.

The old Boltz run achieved 198/200 acceptable poses and 4/4 acceptable first choices, exceeding this new run's 50/100 and 2/4. This is not a controlled regression comparison: all four old Boltz receptor constructs differ, although the VHH sequences match. New/old receptor lengths are 351/380, 287/398, 393/359 and 382/359 for the sets above. The archived old YAMLs specify native receptor templates and empty MSAs; its job enables force potentials. The new run uses the MSA server, no templates or potentials, a pinned producer, 3 recycles, 200 sampling steps and 25 seeds rather than 50. Old released coordinates match their own archived input sequences for all 200 poses. These results neither establish overall improvement over the old Boltz regime nor isolate the effect of construct, template, MSA, potential or producer changes.

Independent verification reauthenticated all 100 new outcomes, raw coordinate/reference identities, complete membership and sealed ranking receipts through the frozen adapter. A separate arithmetic implementation reproduced all five calibration objectives and all three training/held-out folds using exact rational arithmetic, and reproduced first-choice and fractional-boundary top-five summaries. It also checked the old outcome/score receipts, all 400 old coordinate and score-adapter hashes, old reference hashes, saved source ranks, and all 400 observed chain sequences. No ranks, parameters or DockQ labels were recomputed. Prospective outcomes were not opened.

Evidence: `development-review/review.json`, `development-review/generation-comparison.csv`, `development-review/receipt.json`; replay: `review_development.py`. The parent calibration freeze is `round3-control/FINAL-CALIBRATION-FREEZE.json`, SHA-256 `1f29206c405001d59dad23583bfd62301828899fe42974e47f5bba78ae36a2b2`. The authenticated development outcome receipt is SHA-256 `56234e8ac1f10f09e8e8ed54f39079e8eca77d166260870d89c407e69487ca79`.
