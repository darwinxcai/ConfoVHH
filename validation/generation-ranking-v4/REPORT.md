# ConfoVHH: testing better generation and ranking

**Scientific report complete, 25 September 2026.** All prediction, numerical outcome and official summary stages are complete. The reserved summary matches the separate saved-rank/outcome arithmetic check. Both final figures were generated from completed, receipt-bound reports and visually inspected. Archive identity and fresh-extraction verification are recorded separately as described below; this report alone is not an archive replay PASS claim. Artifact paths refer to the full scientific archive's execution root.

This study found modest development gains, but **no tested change met the rule for replacing the original confidence ranking or prediction settings**. The retained method succeeded on one of three additional receptor complexes. The other two had no acceptable candidate among their 25 predictions, so reranking that batch alone could not solve them.

The practical result is a better diagnosis of the remaining problems, not a promoted ranking upgrade. ConfoVHH's production defaults and the underlying Boltz model weights are unchanged.

## What was tested

The study generated **900 new development predictions and 75 reserved predictions**, all successfully recovered and evaluated. Combined ranking development also used 300 earlier predictions. Those earlier predictions were reused as development evidence, not counted as new runs.

| Evidence block | Predictions | Biological scope |
|---|---:|---|
| Preserved initial ranking experiment | 300 | 12 cases, 11 groups |
| New generation comparison | 900 | The same 12 cases; three settings and 25 fresh seeds per setting |
| Combined ranking development | 1,200 | Earlier 300 plus new 900; 48 separate candidate pools |
| Reserved evaluation | 75 | Three additional deposited-construct cases, 25 predictions each |

Nine development pair cases represent eight biological groups. The two AT118 variants share a group. The other three cases retain the original ranking because they have dimer or helper-protein contexts. Additional seeds and settings increase candidate variation, not the number of independent receptors.

Quality is measured with DockQ against the specified experimental structure. “Acceptable” means DockQ at least 0.23. These measurements concern structural agreement, not affinity, receptor function, or experimental binding success. Missing outcomes would remain missing; this completed study has none.

## Generation changes: local benefits, no overall replacement

The 900 new predictions compare baseline settings with broader sampling and alignment subsampling. All three use the same frozen model, exact protein constructs and assembly contexts, and captured alignments. Broader sampling changes diffusion step scale from 1.5 to 1.0. Alignment subsampling retains 1.5 and limits the combined alignment to 1,024 rows. All use three recycling steps, 200 sampling steps, one diffusion sample, and seeds 25–49.

The primary results below average equally across the eight pair groups, then across cases within each group. Candidate counts are ordinary counts. “Best available” means the best candidate identified afterward using the reference; it is not an achieved ranking result.

| Setting | First-choice quality | Top-five mean quality | Best available quality | Acceptable-first probability | Acceptable candidates |
|---|---:|---:|---:|---:|---:|
| Baseline | 0.399873 | 0.403532 | 0.482985 | 0.6875 | 127/225 |
| Broader sampling | 0.416499 | 0.409734 | 0.503282 | 0.6875 | 128/225 |
| Alignment subsampling | 0.405117 | 0.408361 | 0.503551 | 0.7500 | 136/225 |

Broader sampling improved first-choice quality by **0.016626**; alignment subsampling improved it by **0.005244**. Both fell below the prespecified 0.020 improvement requirement. Neither lost an acceptable first choice in a pair pool, and coverage remained complete. The frozen decision therefore retained baseline settings. This does not prove baseline is universally best.

Descriptive 95% whole-group bootstrap intervals for those gains were −0.019101 to +0.055472 and −0.036348 to +0.066095, respectively. They use 10,000 resamples of only eight groups and are not the selection rule or proof of broad superiority.

There were meaningful case-specific differences:

- Alignment subsampling produced seven acceptable AT118-L candidates out of 25 and selected one first; both other settings produced none for that case.
- Broader sampling produced one acceptable LGR4 candidate, but source confidence missed it in the first five choices. That is a ranking opportunity, not a demonstrated ranking fix.
- CHRM1 contained a few acceptable candidates that every first choice missed.
- OPRM1 and exploratory CASR contained no acceptable candidates in any setting. Reordering those pools alone cannot reach the threshold.

Across all 12 cases, acceptable counts were 153/300 for baseline, 155/300 for broader sampling, and 163/300 for alignment subsampling. The full 36-pool comparison, every attempt, timings and missingness are retained in `round4-analysis/new900-analysis/`.

The separate geometry diagnostic found increased median prediction spread with broader sampling in 11/12 cases and with alignment subsampling in 7/12. It covered 900 structures and 10,800 within-pool comparisons. Greater spread did not reliably mean better structures. This diagnostic uses receptor alignment, can reflect receptor conformational differences, and did not determine selection.

## Learned ranking: a modest development signal

Two small ranking procedures were tested: a regularized combination of confidence components, and that combination with prediction-only interface features. Normalization, penalty selection and fitting used training groups only; every construct, arm and seed batch from a biological group stayed together in validation. The original source confidence was an explicit option inside selection.

The main combined comparison includes 900 pair-context rows within the 1,200 development predictions. It keeps the four candidate pools per case separate. The table reports group-weighted held-out procedure results, not a fit evaluated on its own training data.

| Procedure | First-choice quality | Change from original | Top-five mean quality | Acceptable-first probability |
|---|---:|---:|---:|---:|
| Original confidence | 0.407048 | — | 0.409909 | 0.708333 |
| Confidence-component procedure | 0.423915 | +0.016867 | 0.406438 | 0.708333 |
| Confidence plus interface procedure | 0.413050 | +0.006002 | 0.411171 | 0.708333 |

The confidence-component procedure improved mean first-choice quality most, but its top-five mean declined slightly. Neither procedure rescued an unacceptable first choice or lost an acceptable one in these pools. Both missed the fixed +0.020 first-choice gain requirement. Final full-development fits produced ridge models with penalty 10, but **neither model qualified for the reserved study**.

The word “procedure” matters: each nested procedure used a learned ranker for 500 rows in 20 pools, retained source through inner selection for 400 pair rows in 16 pools, and used mandatory source fallback for the other 300 rows in 12 context pools. It did not apply a learned ranker to every prediction. The independent combined-fit audit checked 528 distinct inner fits, all 1,200 saved ranks, 48 pools and 11 outer groups. A separate saved-number review matched 1,002 scalar checks.

### The earlier negative result is retained

On the initial 300 predictions, source first-choice quality was 0.399184. The confidence procedure reduced it to 0.373406; the interface procedure reduced it to 0.373024. Both lost the acceptable FZD3 first choice, reducing weighted acceptable-first probability from 0.6875 to 0.5625. Both final selectors retained source.

The later positive development signal does not erase that result. It is also **not a controlled learning curve**: the combined evaluation adds arms and seed batches while keeping the same biological groups. Both the original audit and the later genuine v2 audit of the unchanged initial fit are preserved.

## Additional receptors: one success, two candidate-generation failures

The final policy was frozen before reserved predictions began: baseline generation, original confidence ranking, and **no learned challenger**. Source rankings were sealed before reference outcomes were evaluated. All 75 attempts were retained, generated, valid and evaluable.

| Reserved complex | Acceptable candidates | First-choice quality | Top-five mean quality | Best available quality |
|---|---:|---:|---:|---:|
| ADGRV1 / RE02 | 0/25 | 0.015327 | 0.073408 | 0.128445 |
| GPR158 / Nb20 | 24/25 | 0.311409 | 0.364886 | 0.441884 |
| MC4R / pN162 | 0/25 | 0.006260 | 0.005727 | 0.008247 |

GPR158's first five choices were all acceptable. ADGRV1 and MC4R had no acceptable candidate anywhere in their pools. The original ranking therefore selected an acceptable first structure in one of three cases, which is also the maximum achievable acceptable-first count from these particular pools.

These are results for the retained baseline. **There is no reserved learned-versus-original comparison**, because neither learned candidate passed the development gate. ADGRV1 was the only learner-eligible reserved context; no learned model was deployed even there. GPR158 and MC4R retained their complete assemblies and source ranking by design.

## Interpretation and limits

The next scientific priority is to distinguish failure to generate a good structure from failure to rank one that exists. In this study, LGR4 under broader sampling and CHRM1 expose ranking opportunities. ADGRV1, MC4R and OPRM1 expose candidate-generation limits. Training a more elaborate ranker on the same failed pools cannot create missing acceptable structures. A future experiment should be specified separately, with more independent receptor groups and development-only decisions; these reserved outcomes must now be treated as exposed.

The benchmark concerns exact deposited protein constructs, including declared fusions, tags and helper proteins. It does not establish performance on canonical wild-type inputs or a different assembly. No native coordinates, templates, contact restraints or force potentials enter generation; deposited glycans, lipids and detergents are not generation inputs. Unresolved reference regions remain unassessed.

ADGRV1 uses the deposited mouse construct, with 255/426 receptor and 107/147 nanobody residues resolved; the preprint's human description remains a documented discrepancy. GPR158 retains two receptor chains and two nanobodies, with weaker local extracellular/nanobody density limiting interpretation. MC4R retains the six-protein assembly, including its 729-residue receptor fusion; only 85/117 target-nanobody residues are resolved. Its deposited wild-type MC4R core is distinct from the separate discovery-immunogen exposure caveat.

Experimental structure release dates do not certify absence of related sequences, interfaces or distilled examples from predictor training. Metadata/reference qualification exposure is documented. This small panel, with one learner-eligible reserved group, does not establish independent broad generalization. No production default is promoted.

## Evidence and operations

The original worker-B development dispatcher failure remains preserved. Its reviewed recovery found no unfinished owned prediction, restarted the unchanged dispatcher, and added zero scientific attempts or prediction retries. All 975 new predictions and their original outputs are retained.

Authoritative scientific records are `round4-analysis/new900-analysis/receipt.json`, `round4-ranking/fit-development-1200/receipt.json`, its independent verification, `round4-reporting/final-selection/receipt.json`, the frozen final policy, and the reserved outcome and summary receipts. Exact full evidence bindings are collected in `ROUND4-FINAL-ARTIFACT-MAP.json`.

The receipt-bound figures are `round4-analysis/figures/final-results/generation-comparison.svg` and `round4-analysis/figures/final-results/reserved-results.svg`. PNG and PDF versions are retained in the full archive; the compact repository publication includes SVGs. Dots show the actual first confidence choice, ticks show the hindsight best candidate, and shaded rows identify assembly contexts outside the pair-selection scope. Neither figure presents hindsight best quality as achieved ranking performance.

The complete private cloud backup preserves 9,518 regular files and 21,856,250,965 logical file bytes, plus directory, symlink and recorded metadata entries. Matching before/after inventories and full object checks passed; a separate local recheck also passed after cleanup. All six study pods and the dedicated volume were deleted, and Runpod returned 404 for every subsequent resource read. Original ownership/runtime records remain unchanged; `round4-cloud/CLEANUP-COMPLETE.json` binds the separate cleanup evidence. This preserves logical files and recorded metadata, not a tested full filesystem restoration.

The private backup is excluded from scientific publication. The scientific archive retains the entire earlier v3 payload and the new scientific evidence, excluding credentials, private backups and redundant transport data. Its identity and fresh-extraction verification are recorded separately in `round4-archive-receipt.json` and `round4-archive-verification.json`, avoiding a circular claim about this report's containing archive. Replay checks saved evidence and recomputes correspondence, aggregation and ranking arithmetic; **it does not rerun numerical DockQ**. See `V4_REPLAY.md` for the exact scope.
