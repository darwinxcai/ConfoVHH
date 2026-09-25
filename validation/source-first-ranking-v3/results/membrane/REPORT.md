# Fixed membrane ranking comparison

The membrane addition did **not improve ranking consistently against producer confidence or the existing S/G hybrid**. It helped some OPRM1 and AGTR1-H quality measures but hurt APLNR. All methods already chose a correct first prediction and five correct top-five predictions in each eligible set, so there was no correctness gain. Keep this as a development result; it does not support general promotion of the membrane term.

The fixed G-PPM3 and H-PPM3 ranks were sealed at 2026-09-24T23:29:38Z before this outcome join. The root ranking freeze and feature protocol were unchanged. No weights, membrane frames, atom masks or tie rules were fitted to these outcomes.

All 200 original attempts remain in every arm. The membrane arms rank 150 predictions in three complete sets (APLNR, OPRM1, AGTR1-H) and abstain for all 50 AGTR1-L predictions because one required receptor membrane frame failed. The two AGTR1 constructs remain one biological group. These previously exposed development predictions are not an independent holdout.

The following equal-set averages are explicitly conditional on the three eligible sets and compare every baseline on the same 150 predictions. They are not estimates for all 200 attempts. In the separate all-planned group summary, the new membrane arms retain undefined AGTR1 and overall averages because AGTR1-L is missing.

| Method | First-choice mean DockQ | Top-five mean DockQ | Correct first / top five per eligible set |
|---|---:|---:|---:|
| Producer confidence | 0.7325 | 0.7193 | 1 / 5 |
| Frozen v0.6 | 0.6517 | 0.6886 | 1 / 5 |
| Physical G | 0.6517 | 0.6943 | 1 / 5 |
| Hybrid S/G | 0.6970 | 0.7087 | 1 / 5 |
| G + membrane | 0.6806 | 0.7020 | 1 / 5 |
| S/G + membrane | 0.6873 | 0.7073 | 1 / 5 |

Higher DockQ is better; “correct” means DockQ ≥0.23. The saved metrics also include top ten and rank correlation.

| Receptor / construct | Method | First DockQ | Top-five mean DockQ | AUROC |
|---|---|---:|---:|---:|
| APLNR / 6KNM | Producer confidence | 0.8862 | 0.8788 | — |
| APLNR / 6KNM | Frozen v0.6 | 0.8624 | 0.8878 | — |
| APLNR / 6KNM | Physical G | 0.8624 | 0.8878 | — |
| APLNR / 6KNM | Hybrid S/G | 0.8982 | 0.8981 | — |
| APLNR / 6KNM | G + membrane | 0.8431 | 0.8725 | — |
| APLNR / 6KNM | S/G + membrane | 0.8529 | 0.8804 | — |
| OPRM1 / 8QOT | Producer confidence | 0.7075 | 0.6729 | 0.7604 |
| OPRM1 / 8QOT | Frozen v0.6 | 0.4970 | 0.5802 | 0.3229 |
| OPRM1 / 8QOT | Physical G | 0.4970 | 0.5972 | 0.2812 |
| OPRM1 / 8QOT | Hybrid S/G | 0.5912 | 0.6174 | 0.5260 |
| OPRM1 / 8QOT | G + membrane | 0.5830 | 0.6242 | 0.3854 |
| OPRM1 / 8QOT | S/G + membrane | 0.5912 | 0.6260 | 0.7188 |
| AGTR1-H / 8TH3 | Producer confidence | 0.6038 | 0.6060 | — |
| AGTR1-H / 8TH3 | Frozen v0.6 | 0.5957 | 0.5979 | — |
| AGTR1-H / 8TH3 | Physical G | 0.5957 | 0.5979 | — |
| AGTR1-H / 8TH3 | Hybrid S/G | 0.6016 | 0.6107 | — |
| AGTR1-H / 8TH3 | G + membrane | 0.6156 | 0.6093 | — |
| AGTR1-H / 8TH3 | S/G + membrane | 0.6180 | 0.6154 | — |
| AGTR1-L / 8TH4 | Producer confidence | 0.6913 | 0.6737 | — |
| AGTR1-L / 8TH4 | Frozen v0.6 | 0.6447 | 0.6692 | — |
| AGTR1-L / 8TH4 | Physical G | 0.6447 | 0.6692 | — |
| AGTR1-L / 8TH4 | Hybrid S/G | 0.6621 | 0.6717 | — |
| AGTR1-L / 8TH4 | G + membrane | — | — | — |
| AGTR1-L / 8TH4 | S/G + membrane | — | — | — |

AUROC is defined only for OPRM1, whose 50-prediction set contains 48 correct and two incorrect models. APLNR and both AGTR1 sets contain only correct models, so their AUROC is undefined. AGTR1-L membrane metrics are unavailable because of the prespecified whole-set abstention.

On APLNR, both membrane arms reduce first-choice quality relative to all four baselines. On OPRM1, H-PPM3 improves top-five quality and AUROC over hybrid S/G but remains below producer confidence; its first selection is unchanged from the hybrid. On AGTR1-H, H-PPM3 improves first-choice and top-five quality over all four baselines. G-PPM3 loses some top-five/top-ten quality relative to the hybrid there.

Every substantive negative comparison is listed below. Full unrounded deltas for every comparison remain in comparisons.csv/json. Differences no larger than 1e-12 are classified as floating-point reporting roundoff only, without changing any metric or rank. This avoids interpreting a weighted correct count such as 9.999999999999998 as a lost correct prediction.

| Receptor / construct | New arm | Comparator | Lower measures |
|---|---|---|---|
| APLNR / 6KNM | G-PPM3 | Producer confidence | rank correlation, first DockQ, top5 mean DockQ, top10 mean DockQ |
| APLNR / 6KNM | G-PPM3 | Frozen v0.6 | rank correlation, first DockQ, top5 mean DockQ |
| APLNR / 6KNM | G-PPM3 | Physical G | rank correlation, first DockQ, top5 mean DockQ, top10 mean DockQ |
| APLNR / 6KNM | G-PPM3 | Hybrid S/G | rank correlation, first DockQ, top5 mean DockQ, top10 mean DockQ |
| APLNR / 6KNM | H-PPM3 | Producer confidence | rank correlation, first DockQ, top10 mean DockQ |
| APLNR / 6KNM | H-PPM3 | Frozen v0.6 | first DockQ, top5 mean DockQ |
| APLNR / 6KNM | H-PPM3 | Physical G | rank correlation, first DockQ, top5 mean DockQ, top10 mean DockQ |
| APLNR / 6KNM | H-PPM3 | Hybrid S/G | rank correlation, first DockQ, top5 mean DockQ |
| OPRM1 / 8QOT | G-PPM3 | Producer confidence | rank correlation, AUROC, first DockQ, top5 mean DockQ, top10 mean DockQ |
| OPRM1 / 8QOT | G-PPM3 | Frozen v0.6 | rank correlation |
| OPRM1 / 8QOT | G-PPM3 | Hybrid S/G | rank correlation, AUROC, first DockQ, top10 mean DockQ |
| OPRM1 / 8QOT | H-PPM3 | Producer confidence | rank correlation, AUROC, first DockQ, top5 mean DockQ, top10 mean DockQ |
| OPRM1 / 8QOT | H-PPM3 | Hybrid S/G | top10 mean DockQ |
| AGTR1-H / 8TH3 | G-PPM3 | Producer confidence | top10 mean DockQ |
| AGTR1-H / 8TH3 | G-PPM3 | Hybrid S/G | top5 mean DockQ, top10 mean DockQ |

All 200 coordinate and reference hashes were verified through the existing outcome preflight. An independent pairwise implementation reproduced preferred percentiles, exact combined keys, dense ranks and complete selected-ID sets. Separate calculations verified tied top1/top5/top10 membership, mean DockQ, correct counts and AUROC. Exact numeric ties follow the previously frozen v2 arithmetic; identifiers only serialize rows.

Files: rank-seal.json and independent-rank-verification.json; analysis.json and evaluation-receipt.json; metrics.csv and comparisons.csv; negative-cases.json; ranking-comparison.png/.pdf. No predictions or membrane frames were regenerated in this stage.
