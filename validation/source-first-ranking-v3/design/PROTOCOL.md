# Prospective source-first ranking and generation round 3

The user authorized all experiments on 2026-09-24. No production default changes.

## Population and generation

The separately sealed round3-benchmark enrollment supplies 8 new-pose target sets, with 25 prespecified seeds per set. Preserve selected nanobody and receptor assembly context fixed in its chain manifest. CASR has a 6-Angstrom reference and is exploratory. GRM5/LGR4 have prior metadata-screening exposure; distinguish new outcome evaluation from untouched historical holdout. CHRM1 is related to the exposed muscarinic family. Other groups have earlier development exposure. Retain every planned attempt and all-good/all-bad sets.

Four development/failure-followup sets use the exact released AF2IG construct sequences for 6KNM, 8QOT, 8TH3 and 8TH4, including source fusion residues and ordering. These four represent three biological groups. Generate 25 seeds each. This is a newly documented method/regime comparison, not a byte-exact AF2IG rerun or proof of a producer bug fix. References supply sequence identities only to launch preparation; no native coordinates or contact maps enter prediction or ranking.

Pin Boltz 2.2.1 source b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc, structure model boltz2_conf.ckpt (hash recorded before inference), MSA server sequence search, 3 recycling steps, 200 sampling steps, 1 diffusion sample per seed, seeds 0-24, step scale 1.5, bf16 default precision. No native templates, contact/pocket constraints, force potentials, ligand affinity prediction or outcome-based retries. Preserve retrieved MSAs and their hashes. Same inference settings across targets; record input length, context and all environmental failures. Runtime optimization may change storage, batching of independent jobs or optional acceleration only with an explicit implementation addendum before affected predictions; never silently alter scientific inputs.

## Ranking policies

Source confidence alone; source with explicit input-integrity validation; and the same with CDR contact share resolving exact source ties. Missing optional CDR information falls back to source order. No-contact predictions are valid predictions with unsupported interface geometry, distinct from corrupt input. All planned rows remain visible. Source scores absent on required eligible candidates trigger explicit selection unavailability.

Optional fourth policy uses an empirically chosen source-score gap tolerance; this is a development-selected tolerance, not measured uncertainty. Candidate gaps are [0, 0.002, 0.005, 0.01, 0.02] for the pinned Boltz pair-context confidence only. Fit on the four newly generated development sets, grouped by receptor/nanobody lineage (8TH3/8TH4 together), never on the eight prospective target outcomes. Select the gap with highest group-weighted first-choice DockQ gain subject to no loss of acceptable-first-choice success on any development set; break objective ties toward smaller gap. Evaluate the complete selection procedure leaving each biological group out. A nonzero final gap is eligible only when its leave-group-out pooled mean first-choice gain is positive and no held-out development set loses an acceptable source choice; otherwise freeze zero. No nonzero calibration transfers to 2+2 multimer source scores or the separate CHRM1 third-chain context. Exact-tie arm remains available everywhere.

Freeze implementation/calibration hashes and score every prospective pose before opening prospective outcomes. Reuse the old 995-pose panel solely as a regression test, never as independent confirmation. More seeds do not create independent biological groups.

## Evaluation and promotion

Primary descriptive endpoint: change in first-choice DockQ versus source alone, averaged first within biological groups then across groups. Also report acceptable-first-choice rate (DockQ >=0.23), top-five mean quality/acceptable count, source-correct choices lost, source-incorrect choices rescued, selection coverage, invalid-input and missing-feature reasons, and fraction of sets containing any acceptable pose. All exact selection ties are evaluated uniformly, including ties crossing a top-k boundary.

For homodimers, keep the predicted selected Nb fixed. A bijective scoring view may merge receptor chain labels/residue identifiers while preserving every atom coordinate; retain a complete identity map and original multimer. Evaluate a fixed complete set of symmetry-equivalent native assignments and use symmetry-corrected quality only after ranks are sealed. Merged chain labels do not represent a covalent receptor construct. Report full-complex source confidence versus selected-Nb/receptor-assembly feature context explicitly.

This finite study is exploratory: the newly outcome-tested independent groups are too few for a reliable general claim. No promotion to production on this round alone. A future confirmatory benchmark must prespecify its sample size and acceptable-regression margin using variability estimated from development data, and demonstrate improvement with uncertainty evaluated across independent biological groups rather than poses.

## Separate membrane experiment

Keep PPM3 receptor-only membrane placement separate, with its own prescored method/configuration freeze. Native complex orientation must not enter frame assignment. The new carbonyl-slab proxy is a distinct experiment from v2 phosphate-bead collision scoring. Retain unavailable frames explicitly and do not infer a membrane side for the nanobody.

## Preservation

All jobs run detached on the task-created Runpod pod with results on its network volume. Download and independently verify immutable result hashes before removing compute/storage. Never delete older resources. Preserve failures and negative results. Report results in plain language with denominators and limitations.
