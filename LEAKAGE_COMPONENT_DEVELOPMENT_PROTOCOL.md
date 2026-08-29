# ConfoVHH leakage-component-out development evaluation protocol v1

Status: **preregistered design only; no new candidates generated and no new
DockQ labels opened**.

This study is a retrospective leakage-component-out **development evaluation**
of the frozen ConfoVHH v0.5 scoring rule. It is not an independent holdout and
must never be called independent validation, ordinary model cross-validation,
or evidence of binding. The v0.5 preorder has no fitted parameters; leaving a
component out evaluates transfer descriptively but does not train the score.

The study is separate from `HARD_DECOY_PROTOCOL_V3.md`. It cannot supply missing
holdout groups, tune the v0.5 ordering, repair an oracle failure, rescue a failed
holdout gate, or change any formal-holdout claim flag.

## Provisional development components

The current 17-structure public panel provisionally yields:

| Component | Structures |
|---|---|
| beta-adrenergic | 3P0G, 5JQH, 6IBL |
| opioid | 5C1M, 6B73, 6VI4, 8QOT |
| alpha-1 adrenergic | 7YM8 |
| CHRM2 | 4MQS |
| US28 | 4XT1 |
| AGTR1 | 6DO1 |
| SUCNR1 | 6RNK |
| APLNR | 6KNM |
| rhodopsin | 8FCZ |
| HCRTR2 | 7L1V |
| SMO | 6O3C |
| FZD3 | 8QW4 |

These are not frozen folds. Before generation, reconstruct them mechanically
from complete receptor, VHH, native-epitope, construct and publication
matrices. Require at least ten connected components after the full graph is
frozen; otherwise the study is a descriptive pilot.

## Leakage graph

Create one node per exact receptor–VHH experimental target. Add an edge for:

1. identical receptor UniProt accession;
2. concatenated canonical TM1–TM7 identity >=0.40 at >=0.80 mutual coverage;
3. identical known VHH parent/variant, or IMGT framework identity >=0.90 plus
   CDR3 identity >=0.70 and length difference <=2;
4. identical DOI or PMID;
5. native receptor-epitope Jaccard >=0.40 or containment >=0.60; or
6. exact construct, receptor–VHH pair or assembly duplication.

For this development-only study, native epitopes may be derived openly using
protein-heavy-atom contacts <=4.5 A and the pinned GPCRdb/region mapping. Freeze
exact isoforms, sequences, aligner and parameters, matrices, typed edges,
connected components, representative rules, and a veto-only 0.30 receptor
identity graph before candidate generation.

The five-target/360-pose historical DockQ development pilot is excluded from
the new primary population by raw/canonical coordinate hash and by
receptor-aligned VHH duplicate detection. It remains a named historical
comparator only.

## Candidate generation

Generate a new template-free population for all 17 targets with both pinned
implementations:

- ColabFold 1.6.2 / AlphaFold-Multimer v3;
- Boltz 2.2.1.

Reuse the hard-decoy v2 seed, attempt, retention and no-replacement schedule:
200 attempted outputs per target per generator, or 6,800 attempts total.
Freeze outputs, failures, producer confidence, input/MSA/config hashes and
resource records before DockQ.

Primary eligibility is label-free: finite exact-sequence parse, unique
receptor/VHH mapping, at least eight residue pairs within 5 A, no protein-heavy
atom separation below 1.8 A, deterministic receptor-aligned VHH duplicate
collapse below 0.5 A, and every resource bound satisfied. Every failure and
resource kill remains in the ledger. No DockQ-balanced quota is permitted.

Direct scaling of the existing plan implies approximately 34–136 planning
GPU-hours and about 425 GB. These are planning bounds, not promises. Generation
requires a separately frozen environment/resource manifest and explicit
approval; no substantial GPU work is authorized by this document.

Record every target's relationship to each generator's training cutoff.
Training memorization remains an unavoidable development-study confounder.

## Frozen arms

Primary: the exact v0.5 coordinate-only lexicographic preorder at commit
`04c6bda2289157dd294c290609f6052aa0ef9195`, with no PAE, pLDDT or recurrence.

Baselines on identical rows:

- producer-confidence percentile within target by generator;
- DeltaSASA;
- contact count;
- negative severe-clash count;
- negative maximum overlap;
- CDR-contact share;
- all tied; and
- fixed-seed random order as a diagnostic.

No feature, direction, quantization, threshold, tie or missing-value rule may
change after DockQ opens.

An optional secondary learned arm may use a direction-constrained ridge
logistic ranker, but only with fully nested leakage-component-out tuning,
out-of-fold scores and the entire nested procedure repeated under permutation.
It is exploratory and cannot replace the product score.

## Labels and endpoints

Use DockQ 2.1.3, explicit receptor:VHH mapping and primary DockQ >=0.23 labels.
Compute within target by generator; then average generators within target,
targets within component, and components equally.

Primary:

- component-macro AP;
- component-macro AP lift, with stratum AP/prevalence computed before
  hierarchical averaging; and
- paired AP difference against every baseline.

Secondary:

- AUROC;
- expected precision and success at 1, 5 and 10;
- enrichment factors at 1% and 5%;
- Kendall tau-b against continuous DockQ;
- supported-band odds ratio and false-positive rate; and
- generator and training-cutoff diagnostics.

Preserve complete score ties. Hashes and IDs never enter a scientific rank.

## Uncertainty and permutation

- 50,000 paired hierarchical bootstrap draws over components and then targets;
  never resample poses.
- Identical draws for all arms and paired contrasts; type-7 percentile
  intervals and complete component effects.
- Delete-one-component jackknife/influence analysis.
- Exact component-level sign flips for paired ConfoVHH–baseline AP differences
  when components <=20, with one sign per component and max-T simultaneous
  contrasts.
- Otherwise 100,000 Monte Carlo sign flips with `(b+1)/(B+1)` correction.
- 10,000 DockQ-tuple permutations within target by generator as an algorithmic
  null diagnostic only, not primary inference.
- Any learned arm repeats its complete nested pipeline under at least 5,000
  within-stratum label permutations.

## Failure gates

No family-transfer development claim unless all pass:

- at least ten leakage components contain both DockQ classes;
- both generators contribute eligible candidates for every target;
- every attempt reconciles without deletion or replacement;
- every eligible row has immutable ConfoVHH and DockQ records;
- native-self, far-translation, rigid-invariance, reconstruction and
  independent metric controls pass;
- macro AUROC >=0.70 with lower interval >0.50;
- AP-lift lower interval >1;
- paired AP difference versus every baseline has point and simultaneous lower
  interval >0;
- expected success@10 improves by >=0.10 over the prespecified maximum baseline
  with lower interval >0;
- adjusted component sign-flip result <=0.05;
- each generator has AP lift >=1 and AUROC >=0.50; and
- 0.21/0.23/0.25 cutoffs, boundary exclusion, the 0.30 graph and every
  delete-one-component analysis preserve direction.

Missing quantities fail. A study below ten class-informative components is
published only as a descriptive pilot; gates are not weakened after labels.

## Allowed claim

Only after every gate passes:

> Across [G] leakage-separated components in a retrospective public-development
> study, the frozen ConfoVHH v0.5 audit ordering showed consistent enrichment
> of DockQ-reference-similar ColabFold/Boltz poses.

The next sentence must state that targets were reused during development,
generator training overlap may exist, and this is not independent validation
of near-native selection, binding, affinity, specificity, function, state
selectivity, membrane compatibility or nonbinder discrimination.

All independent-holdout and near-native-validation flags remain false.
