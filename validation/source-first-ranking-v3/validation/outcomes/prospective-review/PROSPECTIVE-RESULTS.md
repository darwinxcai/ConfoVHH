# Independent prospective review
Independent review passed for all 200 planned attempts across eight sets. 200 outcomes are available and 0 remain explicitly unavailable. All four saved policies, source-score eligibility, gap-zero scope, exact ties, and reported group/stratum summaries agree with the independent calculations.

| Set | Acceptable known / planned | Source first DockQ | Exact-CDR first DockQ | First-choice change | Exact-CDR top-five mean | Unavailable outcomes |
|---|---:|---:|---:|---:|---:|---:|
| ADRA1A_NB29 | 11/25 | 0.276008 | 0.276008 | 0.000000 | 0.383521 | 0 |
| CASR_NB2D11 | 0/25 | 0.008530 | 0.008530 | 0.000000 | 0.014581 | 0 |
| CHRM1_NB1B4 | 3/25 | 0.253610 | 0.253610 | 0.000000 | 0.146689 | 0 |
| FZD3_NB9 | 24/25 | 0.522720 | 0.522720 | 0.000000 | 0.533799 | 0 |
| GRM5_NB43 | 25/25 | 0.718824 | 0.718824 | 0.000000 | 0.757600 | 0 |
| HCRTR2_SB51 | 25/25 | 0.428426 | 0.428426 | 0.000000 | 0.512332 | 0 |
| LGR4_NB21 | 0/25 | 0.108630 | 0.108630 | 0.000000 | 0.109285 | 0 |
| RHO_NB2 | 22/25 | 0.734708 | 0.734708 | 0.000000 | 0.699471 | 0 |

Counts use all planned attempts. An unavailable outcome is not counted as a confirmed failure; the complete JSON retains quality bounds and missingness. Exact scientific ties are averaged uniformly, including fractional top-five boundary weights. No unavailable outcome is replaced by zero.

The pair-confidence calibration remains frozen at gap 0. Dimer and CHRM1 three-chain confidence retain the exact-source fallback without importing that calibration. The calibrated and exact-CDR arms have identical scientific ordering and selection at gap 0; their provenance modes remain distinct.
For `source-validity`, first-choice DockQ increased in 0 sets, decreased in 0, stayed equal in 8, and was unavailable in 0. Acceptable-choice probability decreased in 0 sets and increased in 0.
For `source-validity-cdr-exact`, first-choice DockQ increased in 0 sets, decreased in 0, stayed equal in 8, and was unavailable in 0. Acceptable-choice probability decreased in 0 sets and increased in 0.
For `source-validity-cdr-calibrated`, first-choice DockQ increased in 0 sets, decreased in 0, stayed equal in 8, and was unavailable in 0. Acceptable-choice probability decreased in 0 sets and increased in 0.

The primary newly outcome-tested stratum is GRM5–NB43 plus LGR4–NB21. Its source-versus-exact-CDR first-choice DockQ change is 0.000000. CASR stays a separate exploratory, low-resolution stratum; CHRM1 is a related exposed family, and four other sets remain development exposed. These strata must not be presented as eight untouched independent validation groups.

Both dimer sets retain four prespecified native assignments per evaluable pose, the same prediction-selected Nb, fixed bijective receptor-protomer correspondence, and exact maximum only after all views succeed. A failed view makes the full pose outcome unavailable. Context chains are ignored only by the defined R/V metric; full-complex producer confidence and selected-Nb/receptor-assembly features keep their separate meanings.

This finite exploratory study does not establish a general ranking improvement or justify a production change. Two newly outcome-tested groups are insufficient for that claim, and predictor-training independence remains unverified (see the separate training-exposure qualification). More seeds do not create more biological groups.

The reviewer first required the driver completion, seal and release, then reauthenticated coordinate/reference/output identities through the frozen adapter. A separate arithmetic implementation checked saved scientific keys, coverage, all pools, first-choice/top-five/top-ten summaries, AUROC, rank correlation, exact gap-zero fallback, and every reported group/stratum contrast. It inspected each fixed-view correspondence without recomputing DockQ, rerunning predictions, selecting parameters or changing rankings. Evidence and exact hashes are in `prospective-review/receipt.json`; numerical details are in its JSON/CSV artifacts.
