# Descriptive selection analysis of the retained GPCR development set

This addendum extends the
[paired development study](../gpcr-paper-development-2026-09-04/MANUSCRIPT_SECTIONS.md).
It describes a retrospective use of existing predictions and unchanged
ConfoVHH rankings. The numerical source is
[selection-analysis.json](selection-analysis.json), with one record per job in
[per-job-selection.csv](per-job-selection.csv).

## Methods

We compared model-selection rules using 165 retained cognate predictions
from 33 five-model jobs, spanning 15 conditions, four reference complexes,
and three receptor targets. The preceding audit had calculated official
DockQ 2.1.3 against explicitly reviewed cognate references and applied the
unchanged ConfoVHH production implementation to the same coordinates.
Here, we reused those paired results without generating predictions, changing
the ranking policy, or fitting a threshold. Interface acceptability was
defined by the existing DockQ boundary of 0.23.

For each job, the ConfoVHH choice was the model with the lowest recorded
evidence rank. There were no tied top ConfoVHH ranks. The exported-score
baseline retained all models attaining the maximum recorded `ranking_score`.
We verified all 165 exported values against their original
`summary_confidences_i.json` files and the file hashes recorded in the
preceding audit. The values agreed exactly, but their numerical precision
was at most two decimal places. Neither unrounded internal scores nor the
producer's original tie-breaking policy was available. Thus this baseline
represents maximum exported score, rather than an identified producer-selected
pose. We preserved every maximal-score tie and assigned equal weight to tied
models when calculating expectations.

We also calculated the analytical expectation of selecting uniformly among
the five candidates and a hindsight ceiling obtained by choosing the highest
official DockQ. The latter uses native-reference outcomes and is not a
deployable method. Expected acceptable counts were summed over jobs;
selected DockQ means weighted each job equally. Minimum and maximum outcomes
were obtained from the least and most favorable permitted choice within each
job. These are possible-outcome bounds, not confidence intervals. Uniform and
tie-weighted expectations involved no random draws. We reported results by
reference complex and separately identified jobs with candidates on both
sides of the acceptability boundary.

## Results

Of the 33 jobs, 16 had five acceptable candidates, 13 had none, and four had
a mixture. All four mixed jobs came from 3P0G, across two conditions. The 13
jobs with no acceptable candidate comprised all 12 5JQH jobs and one 5C1M job.
Their retained candidate sets therefore offered no possibility of an
acceptable top selection, placing the overall hindsight ceiling at 20 jobs.

| Selection rule | Acceptable count / 33 | Possible count range | Equal-job mean DockQ | Possible mean DockQ range |
|---|---:|---:|---:|---:|
| ConfoVHH | 18 | 18–18 | 0.405619 | 0.405619–0.405619 |
| Maximum exported score, equal-weight ties | 19 | 19–19 | 0.412419 | 0.406546–0.419039 |
| Uniform selection, analytical expectation | 18 | 16–20 | 0.402137 | 0.364050–0.439690 |
| Highest DockQ, hindsight | 20 | 20–20 | 0.439690 | 0.439690–0.439690 |

Table values for DockQ are rounded to six decimal places. Counts in the
uniform-selection row are expectations, not observed random-selection
outcomes. Exported-score maxima were tied in 22 jobs. No tied maximal-score
set crossed the acceptability boundary, so any resolution of those ties
produced the same binary count, while selected DockQ varied within the
reported bounds.

| Reference complex | Jobs | Mixed jobs | ConfoVHH acceptable | Maximum exported score | Uniform expected | Hindsight best |
|---|---:|---:|---:|---:|---:|---:|
| 3P0G | 9 | 4 | 7 | 8 | 7 | 9 |
| 4MQS | 6 | 0 | 6 | 6 | 6 | 6 |
| 5C1M | 6 | 0 | 5 | 5 | 5 | 5 |
| 5JQH | 12 | 0 | 0 | 0 | 0 | 0 |

Among the four mixed jobs, ConfoVHH selected an acceptable model in two,
compared with three for maximum exported score, two expected under uniform
selection, and four under hindsight selection. In
`3P0G_recOFF_nbON_complex_seed2`, ConfoVHH selected model 4 with DockQ
0.018424, whereas both exported-score maxima, models 0 and 1, were acceptable
(DockQ 0.252411 and 0.245017). In the corresponding seed 3 job, both rules
selected below threshold despite two acceptable alternatives. ConfoVHH's
selected model 2 had DockQ 0.026969 and a `supported` geometry flag in the
preceding audit. Across all 33 jobs, binary selection outcomes agreed in 32
and favored the exported-score baseline in one. These observations do not
support a claim of ConfoVHH selection superiority in this set.

## Interpretation and limitations

The 16 all-acceptable and 13 all-below-threshold jobs show why aggregate
selection counts must be interpreted together with candidate availability.
Only four jobs distinguish binary choice quality, and all four share one
reference complex. The seed- and condition-related jobs are not independent
biological replicates. Equal job weighting retains the observed imbalance
between reference complexes, rather than estimating performance on an
equally weighted population of targets.

This analysis used previously inspected reference outcomes and a retained
subset of 165 of 250 preliminary cognate models; the other 85 coordinates
remain unavailable, and their absence has not been established to be random.
The original ConfoVHH audit used coordinates without full per-model PAE.
The exported-score baseline is limited by the precision of the available
summaries and an unknown internal tie policy. Hindsight selection supplies
only an outcome-dependent ceiling. No ranking weights or thresholds were
changed in response to these results.

The evidence therefore supports a transparent account of selection behavior
and identifiable failure cases within this development corpus. It does not
provide independent validation, calibrated probabilities, experimental
binding or state-selectivity evidence, or generalization to new
receptor/binder families. It does not advance or replace the separate frozen
hard-decoy v3 evaluation.

## Reproducibility

The analysis script is
[audit-gpcr-selection.py](../../scripts/paper/audit-gpcr-selection.py).
The [README](README.md) gives commands for a fresh output directory, both for
the published-table calculation and for verification against the recovered
original summaries. [provenance.json](provenance.json) records the paired
input, script, inventory, and output hashes;
[confidence-source-verification.json](confidence-source-verification.json)
records all 165 verified summary files. Coordinate, reference-mapping,
official-scoring, and ConfoVHH audit provenance remain in the
[preceding public study](../gpcr-paper-development-2026-09-04/README.md).
