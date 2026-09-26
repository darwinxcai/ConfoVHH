# Reserved descriptive results

All 75 planned attempts are retained: 75 generated, 0 generation failures, 75 evaluated, and 0 generated structures with unavailable outcomes.

Frozen candidate: **source**. Development disposition: **COMPLETE_EXPLORATORY_SELECTION**.

ADGRV1 is the single learner-eligible biological test group. GPR158 and MC4R test complete-assembly source/fallback coverage separately. Different generation arms remain separate candidate pools.

| Case | Arm | Policy | Evaluated / planned | First DockQ | Acceptable-first probability | Top5 mean DockQ | Top5 acceptable count | Best complete gap |
|---|---|---|---:|---:|---:|---:|---:|---:|
| ADGRV1_RE02 | baseline | source | 25 / 25 | 0.015327 | 0.000000 | 0.073408 | 0.000000 | 0.113118 |
| GPR158_NB20 | baseline | source | 25 / 25 | 0.311409 | 1.000000 | 0.364886 | 5.000000 | 0.130475 |
| MC4R_PN162 | baseline | source | 25 / 25 | 0.006260 | 0.000000 | 0.005727 | 0.000000 | 0.001986 |

Scientific ties are averaged, including partial ties at the top-five boundary. Acceptable means DockQ ≥ 0.23. Missing labels remain unavailable. First/top-five metrics require every label in the relevant tie support; best-complete gaps and acceptable fractions per planned attempt require all generated outcomes. Available-best values describe evaluated candidates only.

The JSON and CSV preserve coverage, per-pool acceptable fractions, incomplete-outcome bounds, timing, policy differences and all attempt-level reasons. No population-level confidence interval is reported for one learner group.

These cases have metadata/source exposure and uncertain predictor-training membership. DockQ validates only the frozen corresponding resolved regions. No general superiority or production-default promotion is claimed. No model was fitted or native quality metric recomputed by this reporter.

**ADGRV1_RE02 qualifications:** 3.82Åglobal reference;255/426 receptor and107/147Nb residues represented. All three IMGT CDRs represented, but native coordinates cannot validate missing receptor or terminal regions. Mouse deposited construct versus human preprint species discrepancy remains unresolved. Exact deposited-protein construct benchmark only. Fresh primary fulltext/pdf retrieval returned429; original preprint metadata/deposition provenance and retained prior source review support a limited deposited-pair claim, not a complete experimental construct provenance audit.

**GPR158_NB20 qualifications:** Nanobody contacts both receptor protomers; pair-only reduction is scientifically unsuitable. Keep full2+2 protein context. Global deposition resolution3.47Å does not describe the weak ECD/Nb density. Primary paper reports localECD/Nb refinement4.14Å and cautions side-chain placement. Exploratory baseline coverage only. Use deposited receptor781aa andNb150aa; original assay/reagent construct reconciliation is narrower than full biological validation. 9VOR is prespecified as the RGS-free structural class;9VOS is an alternate6-protein context of the sameNb lineage, never an independent group.

**MC4R_PN162 qualifications:** Retain all six deposited protein chains, includingGs and auxiliaryNb35. TargetpN162 contacts receptor only, but this does not prove the active receptor conformation is helper-independent. Whole729aa BRIL/MC4R/mCherry/tag construct retained; no trimming to resolved receptor or canonical332aa segment. 3.4Åglobal reference with85/117pN162 residues represented; all3IMGTCDRs represented, substantial framework and receptor-fusion regions unresolved. Discovery used beta2AR-grafted/Cb80-stabilized immunogen, while deposited receptor core is exact wild-typeMC4R. Record source relationship without mislabeling the deposited construct.
