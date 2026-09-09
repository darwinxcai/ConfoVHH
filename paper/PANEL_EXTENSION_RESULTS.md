# Ranking generalization across a seventeen-receptor panel

A drop-in results section. The study record is
[`validation/panel-extension-v1/`](../validation/panel-extension-v1/); every
number below is read from `results.json` and nothing here is recomputed by hand.

## Why this study exists

The DockQ development pilot used five receptor-VHH complexes. A ranking tuned,
inspected, and reported on five structures can succeed because those five
structures are agreeable, not because the ordering captures anything general.
This study asks one question: does the shipped pose ranking still separate
acceptable from unacceptable interfaces on structures the pilot never touched?

## Pre-registration

The protocol was frozen before any pose existed and before any runner code was
written. This is checkable from the repository history rather than asserted:

| Event | Commit | Timestamp |
|---|---|---|
| Protocol frozen | `d818b6c` | 2026-09-03 17:57:15 UTC |
| First runner code | `ce71afc` | 2026-09-03 18:02:07 UTC |
| Run completed | | 2026-09-03 19:01:04 UTC |

The frozen specification is `validation/panel-extension-v1/study-spec.json`,
SHA-256 `1ac4ccbb6530c72f95b1b1343c9615327abbdad4b43d37e286368ac778d3d825`, and
the result record carries that digest. The specification named the primary
population, the comparator arms, the acceptance rule, and the three outcome
branches in advance, and forbade post-hoc rescue. The reported branch is the one
the frozen rule selected.

## Design

Seventeen receptor-VHH complexes were drawn from the public panel. Twelve had
never been used by the pilot; those twelve are the primary endpoint. The five
pilot structures are reported separately and are marked contaminated, because
the ranking had already seen them.

Each target contributed 72 rigid-body perturbations of its solved complex, 1,224
poses in total. Two duplicates were excluded and none errored, leaving 1,222
labelled poses, of which 775 scored at or above the DockQ acceptability cutoff
of 0.23. Labels come from official DockQ 2.1.3. Software: ConfoVHH 0.5.0, Node
22.18.0.

Six comparators ran alongside the shipped ranking, including two single-feature
ablations and a random-tie-breaking floor, so the result is measured against the
components it is built from rather than against nothing.

## Result on the twelve previously unused targets

The prespecified rule required the shipped ranking to exceed both the random
floor and the previous ordering on average precision, and to reach expected
precision at rank 1 of at least 0.80. It did. The frozen outcome branch is
**generalizes**.

Average precision, target-macro aggregated, with hierarchical cluster bootstrap
intervals over 10,000 replicates:

| Arm | Average precision | Interval | AUROC | Precision at 1 |
|---|---|---|---|---|
| Shipped pose ranking (v0.6) | 0.838 | 0.815 to 0.862 | 0.762 | 1.000 |
| Previous ordering (v0.4) | 0.713 | 0.687 to 0.745 | 0.609 | 0.995 |
| Buried surface area alone | 0.725 | 0.685 to 0.762 | 0.698 | 0.000 |
| CDR contact share alone | 0.693 | 0.659 to 0.732 | 0.664 | 0.350 |
| Contact count alone | 0.645 | 0.601 to 0.687 | 0.570 | 0.083 |
| Clash burden alone | 0.629 | 0.586 to 0.674 | 0.524 | 0.245 |
| Random tie-breaking floor | 0.635 | 0.618 to 0.660 | 0.500 | 0.635 |

The shipped interval overlaps no comparator interval. Its average-precision lift
over the random floor is 1.32, interval 1.283 to 1.360.

Two features of the table matter more than the headline number.

**The ablations do not reproduce the ranking.** Buried surface area alone
reaches a respectable average precision of 0.725 but places an unacceptable pose
first on every one of the twelve targets. The tiered ordering places an
acceptable pose first on every one. Ordering quality averaged over a whole list
and ordering quality at the position a user actually reads are different
properties, and only the composite ranking has both.

**No target fails.** Per-target average precision runs from 0.787 to 0.905 and
precision at rank 1 is exactly 1.000 on all twelve. The panel result is not one
or two strong targets carrying a weak remainder.

| Target | Average precision | Precision at 1 | Positive prevalence |
|---|---|---|---|
| 5JQH-A-C | 0.787 | 1.000 | 0.611 |
| 6IBL-A-C | 0.791 | 1.000 | 0.611 |
| 5C1M-A-B | 0.805 | 1.000 | 0.639 |
| 8FCZ-A-C | 0.816 | 1.000 | 0.639 |
| 8QOT-A-B | 0.816 | 1.000 | 0.569 |
| 7YM8-A-D | 0.822 | 1.000 | 0.653 |
| 6RNK-A-B | 0.847 | 1.000 | 0.653 |
| 6VI4-B-C | 0.849 | 1.000 | 0.611 |
| 4MQS-A-B | 0.851 | 1.000 | 0.648 |
| 7L1V-R-S | 0.869 | 1.000 | 0.681 |
| 6KNM-B-A | 0.893 | 1.000 | 0.667 |
| 6B73-B-C | 0.905 | 1.000 | 0.639 |

On all seventeen targets together the shipped average precision is 0.816, and on
the five reused pilot targets alone it is 0.764. Both populations are marked
contaminated and neither is the endpoint.

## What this establishes, and what it does not

It establishes that the ordering is not an artefact of five structures. On
twelve receptor-VHH complexes it had never seen, the ranking separates
acceptable from unacceptable interfaces well ahead of its own components and
well ahead of chance, and it puts an acceptable pose at the top of every list.

It does not establish that the ranking helps on predictor output. Every pose
here is a rigid-body perturbation of a solved complex. That population is easier
and differently shaped than the candidates a prediction pipeline produces, and
DockQ measures geometric similarity to the source complex rather than binding.
The study record states this boundary itself and sets
`establishesGeneralizationToPredictorOutput` to false.

This is not the pre-registered hard-decoy holdout, and must never be reported as
though it were. That protocol retains its own eligibility, overlap, exposure and
freeze gates, its execution is unauthorized, and this study read nothing from
it.

## Relation to the prediction-selection result

The two results are not in conflict and should be presented together.

On perturbed native structures the geometric criterion discriminates strongly.
On real prediction output it adds nothing over the predictor's own reported
confidence: ConfoVHH selected an acceptable model in 18 of 33 jobs against 19 of
33 for the maximum exported score, over only four jobs that contained both an
acceptable and a poor interface, all on one reference complex.

The honest reading is that the ranking captures real interface geometry, and
that on the predictions tested, the predictor's own confidence already carried
that information. Deciding between those two possibilities needs a decoy
population the ranking has not seen and that a predictor did not also score,
which is what the hard-decoy protocol is for and why it stays unexecuted rather
than being approximated here.
