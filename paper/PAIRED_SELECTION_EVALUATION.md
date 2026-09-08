# Measuring improvement in GPCR–nanobody pose selection

Status: executable metric component, tested on arbitrary synthetic labels only.
No new prediction, native coordinate, holdout label, biological measurement or
scientific performance result was opened for this work. The frozen v0.5 score,
v3 protocol, census, exposure decisions and eligibility gates are unchanged.

The practical question is whether a method chooses a better pose from the same
candidate set than a prespecified baseline. A well-formed report or physically
plausible interface alone cannot answer that question. This component evaluates
one interpretable endpoint: **expected success of the top-ranked selection**.
It does not implement the entire v3 endpoint contract or authorize label access.

## Executable component

`scripts/paper/compare-paired-selection.mjs` accepts a declared attempt inventory,
two precomputed rank-tier columns and a separate binary-outcome table. It does
not calculate ConfoVHH scores, generate predictions, fetch data, select targets,
infer eligibility, or derive a success label from a confidence score. Lower
integer tiers are better; equal tiers preserve the complete scientific tie.

For a best tier containing `m` poses, `s` of which meet the separately defined
outcome, expected top-1 success is `s/m`. This corresponds to uniform random
selection within that tier. It is not the optimistic probability that at least
one tied pose is correct, and candidate IDs do not break ties.

The method and baseline use the identical eligible rows. Their paired success
difference is averaged over generators within each target, then targets within
each declared group, then groups with equal weight. Extra poses do not create
additional independent experiments. The output retains each stratum, group
effect and leave-one-group-out contrast.

Uncertainty uses a deterministic paired bootstrap: sample groups with replacement,
then targets within each sampled group, carrying the same method/baseline pair
through every draw. Generators and poses are not resampled. Default: 10,000 draws,
nonzero uint32 seed 20260908, and 2.5th/97.5th type-7 percentiles of paired
differences. One group yields no interval. The report makes no superiority
decision, including when an interval excludes zero. This is one endpoint against
one baseline, without multiplicity correction or the full protocol's sensitivity
analyses. Independent, representative groups and exchangeable targets remain
assumptions; resampling cannot correct leakage or selection bias. Small samples
and degenerate intervals require particular caution. General methodological
background: [Saravanan, Berman and Sober](https://arxiv.org/abs/2007.07797) and
[paired percentile resampling in SciPy's documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html).

Failed/ineligible attempts require a reason and remain counted. Every eligible
attempt requires exactly one ranking row and one binary outcome; unknown,
duplicate and missing rows reject. A target cannot appear in different groups.
Every declared generator must have eligible candidates for every target, or the
aggregate and interval remain unavailable. All-positive and all-negative strata
are retained and explicitly marked as lacking outcome diversity. Removing an
entire target from every supplied table cannot be detected without an external
frozen inventory; the tool does not claim to certify source-population completeness.

Top-1 success is **conditional on the eligible candidate pool**. A failed attempt
remains in the accounting but does not lower this success rate when its stratum
still has eligible candidates. This endpoint is not overall generation success
or yield per attempted prediction.

The [current-product rank exporter](CURRENT_PRODUCT_RANK_EXPORT.md) supplies
verified feature-to-tier transformation using the shipped scorer. Its source
identity and scientific ties are explicit. It is incompatible with the distinct
frozen v3 preorder and does not authenticate upstream audit measurements.

## Replay the synthetic example

From the repository root, choose an output filename that does not exist:

```bash
node scripts/paper/compare-paired-selection.mjs \
  --input=paper/evidence/paired-selection-synthetic-2026-09-08/input.json \
  --output=/tmp/confovhh-synthetic-selection-receipt.json
node --test tests/paired-selection-comparison.test.mjs
```

The checked-in example has arbitrary labels and rank tiers. Its group effects
are +0.5 and -1, giving an equal-group method–baseline difference of -0.25.
These are arithmetic controls, not ConfoVHH performance measurements. The policy
hash fields are deliberately symbolic test declarations, not real scoring
policies. The output binds exact input bytes, evaluator source and strict JSON
parser source by SHA-256 and records the Node runtime. It refuses output
overwrite and duplicate JSON keys. A local hash receipt proves neither prior
registration nor the chronology of rank freezing and label opening.

## What makes an eventual scientific run interpretable

1. Freeze the eligible population, complete attempt schedule, certified component
   map, policies, rank-tier derivation, outcome definition, baseline set and
   analysis plan before labels are opened. Resolve data-access and source
   availability requirements. Failed attempts cannot be replaced after outcomes.
2. Preserve rank exports from the unchanged method and baselines. Verify that
   declared tiers faithfully implement their policies, including missing values
   and ties; this generic component does not provide that adapter attestation.
3. Obtain authorized outcomes separately. Reference-pose recovery, experimental
   binding, affinity and conformation selectivity are different endpoints.
   Labels cannot be inferred from a visually plausible interface or producer
   confidence. Thresholds must be defined before outcomes, not selected here.
4. Run all prespecified endpoints and controls, retain failures and uncertainty,
   and report the result even if the method does not improve selection.

For the independent hard-decoy study, follow [v3](../HARD_DECOY_PROTOCOL_V3.md),
including its minimum independent-group requirement and separate sealed stages.
This component neither replaces that protocol nor waives its gates. Real CRO
comparisons additionally need locked candidates, experimental controls and
assay-specific outcome definitions. No participant contact, paid computation,
candidate procurement or experimental execution is authorized by this document.
