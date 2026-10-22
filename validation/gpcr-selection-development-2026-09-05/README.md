# Selection audit of the retained GPCR development models

This retrospective follow-up asks whether the unchanged ConfoVHH evidence
ranking selects a native-like interface from each retained five-model job.
It uses the completed [paired development study](../gpcr-paper-development-2026-09-04/README.md):
165 models from 33 jobs, 15 conditions, four reference complexes, and three
receptor targets. Official DockQ values and ConfoVHH ranks are reused from
that study; this analysis generates no predictions and fits no ranking policy.

The observed selection results do **not support a claim of ConfoVHH selection
superiority**. ConfoVHH selects an interface with DockQ ≥ 0.23 in 18 of 33 jobs;
the maximum exported `ranking_score` gives 19, uniform selection has an
expected count of 18, and hindsight selection of the highest DockQ gives 20.
Only four jobs contain candidates on both sides of the threshold. All four
come from 3P0G, across two conditions; ConfoVHH succeeds in two and the
maximum exported score in three.

## Candidate availability determines what selection can change

“Acceptable” throughout means official DockQ ≥ 0.23 against the reviewed
cognate reference. It does not denote experimental binding or a biological
state. A mixed job has at least one candidate on each side of this boundary.

| Reference complex | Jobs | All five acceptable | All five below threshold | Mixed jobs |
|---|---:|---:|---:|---:|
| 3P0G | 9 | 5 | 0 | 4 |
| 4MQS | 6 | 6 | 0 | 0 |
| 5C1M | 6 | 5 | 1 | 0 |
| 5JQH | 12 | 0 | 12 | 0 |
| **Total** | **33** | **16** | **13** | **4** |

The 16 all-acceptable jobs succeed under every selection rule. The 13 jobs
without any acceptable retained candidate cannot be rescued by selecting
among these five models. Consequently, the maximum attainable count here is
20 of 33, and only the four mixed jobs distinguish binary selection outcomes.
Continuous DockQ can still differ between choices in the other jobs.

## Selection definitions and tie handling

- **ConfoVHH:** retain every model with the lowest recorded
  `confovhh_evidence_rank` within its job. The production audit has one such
  model in each of the 33 jobs. Its unchanged ranking used coordinates and
  had no full per-model PAE; the exported score was not an input to that rank.
- **Maximum exported score:** retain every model attaining the exact maximum
  `source_reported_ranking_score` within its job. For expected outcomes, give
  these tied models equal probability. This is an explicitly defined baseline,
  not a reconstruction of the producer's actual selected pose.
- **Uniform selection:** give each of the five retained models probability
  one fifth. Expectations are calculated analytically, without random draws.
- **Best available:** select the highest official DockQ within each job,
  retaining any exact ties. This uses the native reference outcome and supplies
  a hindsight ceiling, not a deployable selection method.

All 165 exported scores were checked against the matching original
`summary_confidences_i.json` files, including their byte hashes from the prior
audit inventory. Every value agrees. The exported values have at most two
decimal places; this check cannot recover unrounded internal scores or the
producer's original tie-breaking policy. There are 22 jobs with tied exported
maxima: 11 two-way, four three-way, six four-way, and one five-way tie. The
remaining 11 have a unique maximum. No maximal-score tie set includes models
on opposite sides of DockQ 0.23, so tie resolution does not change the binary
count of 19. It does change the mean selected DockQ.

Each job receives equal weight in the descriptive mean. For a selected set
of models, the expected DockQ and acceptability are their arithmetic means.
The overall expected acceptable count is the sum of these per-job
acceptability expectations. Reported minimum and maximum outcomes take,
respectively, the least and most favorable allowed choice in every job.
These bounds are **possible selection outcomes, not confidence intervals**;
they express no uncertainty about performance on new targets. Equal weighting
of jobs also does not give equal weighting to reference complexes.

## Measured results

All values below are calculated from [selection-analysis.json](selection-analysis.json).
DockQ is rounded to six decimal places in the tables; the JSON and
[per-job-selection.csv](per-job-selection.csv) retain the numerical outputs.

| Selection rule | Acceptable count / 33 | Possible count range | Equal-job mean DockQ | Possible mean DockQ range |
|---|---:|---:|---:|---:|
| ConfoVHH | 18 | 18–18 | 0.405619 | 0.405619–0.405619 |
| Maximum exported score, equal-weight ties | 19 | 19–19 | 0.412419 | 0.406546–0.419039 |
| Uniform selection, analytical expectation | 18 | 16–20 | 0.402137 | 0.364050–0.439690 |
| Best available, hindsight | 20 | 20–20 | 0.439690 | 0.439690–0.439690 |

ConfoVHH has the same binary outcome as the exported-score baseline in 32
jobs and a worse outcome in one; none is ambiguous because of score ties.
Its mean selected DockQ minus the equal-weight exported-score mean is
−0.006799. These are descriptions of this retained set, not independent-trial
comparisons.

| Reference complex | ConfoVHH acceptable / jobs | Exported-score maximum / jobs | Uniform expected / jobs | Hindsight best / jobs |
|---|---:|---:|---:|---:|
| 3P0G | 7 / 9 | 8 / 9 | 7 / 9 | 9 / 9 |
| 4MQS | 6 / 6 | 6 / 6 | 6 / 6 | 6 / 6 |
| 5C1M | 5 / 6 | 5 / 6 | 5 / 6 | 5 / 6 |
| 5JQH | 0 / 12 | 0 / 12 | 0 / 12 | 0 / 12 |

For the four mixed jobs, the corresponding counts are 2, 3, 2 expected, and
4 out of 4. The two exported-score ties in this subset are preserved below.
Model indices are the original zero-based indices. Each row's full job name
is `3P0G_` followed by the displayed suffix.

| Job suffix | Acceptable candidates | ConfoVHH model; DockQ | Exported-max model(s); expected DockQ | Uniform acceptable expectation |
|---|---:|---|---|---:|
| `cutoff_2011_01_18_complex_seed1` | 3 / 5 | 0; 0.402668 | 0; 0.402668 | 0.6 |
| `recOFF_nbON_complex_seed1` | 3 / 5 | 1; 0.380324 | 0, 1; 0.383108 | 0.6 |
| `recOFF_nbON_complex_seed2` | 2 / 5 | 4; 0.018424 | 0, 1; 0.248714 | 0.4 |
| `recOFF_nbON_complex_seed3` | 2 / 5 | 2; 0.026969 | 0; 0.027198 | 0.4 |

In `recOFF_nbON` seed 2, ConfoVHH selects model 4 below threshold while both
exported-score maxima are acceptable. In seed 3, both rules select below
threshold despite two acceptable alternatives. The latter ConfoVHH-selected
model carries a `supported` geometry flag in the
[paired source CSV](../gpcr-paper-development-2026-09-04/paper-evidence/results/paired-model-metrics.csv).
This is a concrete case in which that flag does not identify the native pose.

## Reproduction and receipts

Run from the repository root using Python 3.9 or newer; this script uses only
the standard library. Choose an output directory that does not already exist.
The published-table calculation requires no raw coordinates or score rerun:

```bash
python3 scripts/paper/audit-gpcr-selection.py \
  --study validation/gpcr-paper-development-2026-09-04 \
  --out /fresh/gpcr-selection-csv
```

To reproduce the additional original-summary verification used for the
committed results, provide the recovered `VERIFY` root:

```bash
python3 scripts/paper/audit-gpcr-selection.py \
  --study validation/gpcr-paper-development-2026-09-04 \
  --raw-root /path/to/VERIFY \
  --out /fresh/gpcr-selection-verified
```

Require exit status zero and the final marker
`GPCR SELECTION AUDIT OK: 165 models, 33 jobs, 4 mixed-label jobs`.
The CSV-only invocation records `PUBLISHED_CSV_ONLY`; the second records
`VERIFIED_AGAINST_ORIGINAL_EXPORTED_JSON`. Both calculate the same selection
results from the pinned paired CSV. The latter additionally requires the
original exported summaries, which are not embedded in the repository.

- [selection-analysis.json](selection-analysis.json) contains all 33 model
  selection sets, model hashes, outcome bounds, and aggregate results.
- [per-job-selection.csv](per-job-selection.csv) provides one row per job.
- [confidence-source-verification.json](confidence-source-verification.json)
  records all 165 original summary file paths, hashes, sizes, and scores.
- [provenance.json](provenance.json) records the script hash, paired-input
  hash, prior confidence-inventory hash, output hashes, and interpretation.
- [MANUSCRIPT_ADDENDUM.md](MANUSCRIPT_ADDENDUM.md) provides methods, results,
  and limitations for use alongside the
  [prior manuscript sections](../gpcr-paper-development-2026-09-04/MANUSCRIPT_SECTIONS.md).

The paired input SHA-256 is
`94a0182d5e960e75641f5f891a2a8fefc8ac1fc942134cff253e83a1b5d3bc2c`.
The previous study supplies the original coordinate/request/reference hashes,
official DockQ 2.1.3 execution receipts, mapping review, and unchanged
ConfoVHH production-audit provenance.

## Scope of the evidence

The 33 jobs are correlated observations across a small set of targets,
conditions, and seeds. The four mixed jobs are not four independent targets.
This analysis follows inspection of their native-reference outcomes and
therefore remains development work. It does not change the production ranking
policy or contribute an independent test to the frozen hard-decoy v3 protocol.

The retained 165 models represent only 165 of 250 preliminary cognate records;
85 cognate coordinates remain unavailable. Their absence is not established
to be random. There are no full per-model PAE matrices in the retained audit,
and swapped/irrelevant-binder and receptor-only records are outside this
cognate selection analysis. The descriptive counts and outcome bounds do not
estimate calibrated efficacy or establish binding, state selectivity, or
performance on new receptor/binder families. Broader ranking claims require
a separately specified evaluation with adequate independent coverage and
jobs containing meaningful candidate alternatives.
