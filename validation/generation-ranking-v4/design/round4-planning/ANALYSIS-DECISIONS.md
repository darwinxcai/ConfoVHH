# Round 4 analysis decisions before new predictions and outcomes

This document supplements the design plan and the separate frozen generation and
ranking protocols. It does not revise any round 3 result. At creation, the cloud
runtimes have passed verification; no round 4 molecular predictions or reserved
outcomes have been produced. The first authorized ranking fit uses only the 300
already exposed round 3 predictions. Its results have not yet been inspected.

## Controlled development generation comparison

The primary generation comparison uses the 900 newly planned attempts only:
12 fixed cases, 25 seeds per case and arm, three arms. The old 300 predictions
remain a separate seed batch for ranking-model development. Combining both seed
batches for training does not add independent biological groups.

For each new 25-attempt pool report attempted, generated, valid and evaluable
counts; whether an acceptable structure exists; acceptable structures per planned
attempt; best available DockQ; and the unchanged source policy's first-choice
DockQ, acceptable probability and top-five summaries. Acceptable means DockQ at
least 0.23, matching round 3. Missing outcomes remain explicitly unavailable;
they are not scored as zero or discarded to create a complete favorable panel.
Scientific ties are averaged, following the ranker protocol.

The ordinary pair-context cases form the primary scope for selecting a candidate
generation setting. The nine cases represent eight qualified groups; the two
angiotensin cases share group weight. Report the full 12-case panel and each
other assembly context separately. CASR is explicitly exploratory because of its
low-resolution reference. No setting is promoted for a different context on the
basis of a pair-only average.

Use equal biological-group weight, then equal target weight within a group.
Compare each alternative with the new-seed baseline. A candidate setting must
increase mean source-selected first-choice DockQ by at least 0.02, cause no loss
of acceptable-first probability in any pair-context pool, and preserve selection
coverage. Among settings passing this exploratory gate, choose the largest mean
first-choice gain; exact ties prefer baseline, then broader sampling, then MSA
subsampling. If neither alternative passes, retain baseline. The gate is a
practical exploratory rule, not a significance test. Best-candidate availability
and quality are reported even when selection does not improve.

Report every biological-group difference. For development comparisons with at
least two groups, a fixed-seed bootstrap across whole biological groups (10,000
resamples, seed 20260925) may describe uncertainty. Do not bootstrap poses or
arms as independent examples. With one reserved learner-eligible group, report
the actual difference and no population-level confidence interval.

Candidate diversity is descriptive, not a selection criterion. If computed, use
pairwise selected-nanobody C-alpha RMSD after fitting all declared receptor
C-alpha atoms between predictions within a pool. Use the fixed input chain
assignment and no native-derived trimming, contact mask or symmetry choice.
Report median and distribution across available valid pairs; disclose that fixed
chain assignments can include dimer label permutations. Different seeds in the
MSA arm also consume random draws for alignment subsampling, so matching seed
numbers does not guarantee matched diffusion noise.

Record actual prediction wall time and attempts. Equal candidate counts do not
imply equal compute cost. The five technical smoke attempts are prespecified
seed-25 members of the 900, stay in their original pools, and are checked without
reference outcomes. Technical failures stay recorded; recovery must be explicit,
never an unrecorded replacement of a poor or failed prediction.

## Ranking selection and reserved receptors

Use the fixed confidence-only and confidence-plus-interface families in the
ranking protocol. The main development estimate comes from the final combined
1,200-attempt development analysis after all planned new attempts are accounted
for. Preserve the initial 300-row analysis separately. Do not revise features or
regularization in response to those results during this study.

A family can become the reserved challenger only if its frozen nested validation
passes the prespecified 0.02 useful-gain/no-acceptable-loss/unchanged-coverage gate
and its final full-development model is a fitted ridge model. Among eligible
families choose the largest supported-scope first-choice gain; exact ties prefer
the smaller confidence-only model. If neither is eligible, retain source
confidence as the operating candidate and report the learned models as negative
or inconclusive experiments. Choosing a family from outer estimates remains
exploratory model selection, as already stated in the ranking protocol.

The proposed reserved panel comprises ADGRV1/RE02, GPR158/Nb20 and MC4R/pN162,
subject to the separate exact-construct enrollment freeze and reference controls.
Only ADGRV1 is pair-context eligible. The other two use their complete deposited
protein assemblies and test baseline/fallback coverage. Retain every enrolled
case regardless of whether it yields an all-good, mixed or all-bad candidate pool.
These cases have metadata/source exposure and uncertain predictor-training
membership; no blanket independent or training-unseen claim is permitted.

Plan 25 baseline seeds (0-24) for each reserved case. If a different pair generation
setting passes the development gate, also plan 25 matching seed numbers for that
setting on ADGRV1. Thus the reserved panel has 75 baseline attempts, or 100 total
attempts if a pair-only alternative is selected. Rank each saved candidate pool
separately with source and the single frozen challenger. Never pool raw scores
across generation settings or assembly contexts. Capturing sequence alignments
and authenticating exact sequence-only inputs may precede model freeze; reserved
prediction generation and outcome opening follow the final policy freeze.

Freeze exact generation settings, input/MSA identities, feature extraction,
weights, source fallback and ranking behavior before reserved generation. Save
rankings before opening reserved outcomes. No post-test refitting or rule changes.

One additional learner-eligible receptor is too little evidence for a general
superiority claim or a production-default promotion. Regardless of its result,
this study can establish an exploratory candidate, identify a failed approach,
or broaden documented coverage. Keep the established confidence-first default
unless a later adequately broad validation supports changing it.
