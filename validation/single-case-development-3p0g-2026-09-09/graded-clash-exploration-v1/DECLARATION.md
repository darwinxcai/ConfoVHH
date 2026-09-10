# Graded clash exploration v1: declaration before this comparison

This is post-outcome development on the same ten execution03 poses, prompted by the already published negative result at commit 75880d1b5f5772817dd986d9f30b77bcb6964bf5. The authors already know the DockQ outcomes. A commit before calculating the new scores documents the limited search; it is not prospective preregistration or blinding.

Exactly five arms will be reported. Higher keys rank first, with exact floating-point equality defining scientific ties and dense ranks. Candidate IDs are display labels only. No sweeps, fitted weights, alternative masks, relaxation, replacement poses, or additional arms are authorized by this declaration.

Let B be the exact frozen half-delta-SASA interface area in Å², N the number of interchain residue pairs with at least one heavy-atom distance <=4.5 Å, and C the number of these pairs with a nonexempt overlap >=0.6 Å. For each contacting residue pair p, let o_p be its maximum positive nonexempt heavy-atom overlap, or zero if none. Radii, model, chain roles and disulfide exemption follow the frozen measurement policy. Set Q = sum((o_p/0.6)^2)/N.

| Arm | Exact key, descending | Purpose |
|---|---|---|
| frozen-v06 | (frozen evidence tier, B) | Preserve the original selector and negative result |
| burial-only | B | Simple geometry baseline |
| predictor-confidence | Original Boltz confidence_score | Original confidence baseline, including its whole-complex scope |
| clash-fraction-v1 | B * (1 - C/N) | Finite penalty proportional to the fraction of contacts with severe overlap |
| overlap-burial-v1 | B / (1 + Q) | Graded magnitude penalty, including mild overlaps below 0.6 Å |

Both new formulas are hypotheses, not demonstrated fixes or physical energies. Neither has priority over the other for a future superiority claim; all five must remain in a prospective comparison. No production ranking code or historical evidence tier is changed. All original structural warnings remain visible separately. The continuous positive-overlap contribution in overlap-burial-v1 removes the special zero-severe-clash preference, but the 4.5 Å contact membership and disulfide exemption still have boundaries. Clash-fraction-v1 retains the 0.6 Å step in C without a tier jump.

Normalization limits size dependence of clash burden; maximum overlap per residue pair limits atom-pair multiplicity. The 0.6 Å scale is inherited; exponent 2 and both formulas are declared heuristic choices, not estimated from outcomes. They can under-penalize localized serious defects, favor large incorrect interfaces, or dilute penalties with extra contacts. No validation of these tradeoffs is claimed.

Coordinate-only feature extraction must verify all ten original coordinate and confidence hashes, model 1, receptor A and VHH B, and frozen sequences. Use all modeled A/B residues, including the fusion. No native contacts, DockQ, experimental coordinates, observed-residue masks, or reference-derived regions may enter the selector. The rank stage takes a strict feature schema and has no native-reference argument. Frozen B and tier are reused from the independently reproduced, hash-bound audit; N, C and Q are recalculated directly from decimal coordinates. Native-reference outcomes are joined only in a separate evaluation stage after saving and hashing ranks.

This implementation is scoped to these ten complete models. Missing or invalid inputs stop extraction and preserve prior files; they are not replaced. The ranker retains per-arm unavailable scores with null ranks and explicit reasons for missing inputs or N=0. All ties and unavailable outcomes must be reported. A tie's expected selected DockQ is the uniform mean, accompanied by range and missing count. With missing selected DockQ, the complete tie mean is unavailable. Do not use an ID to resolve ties.

Report all ten rows for every arm, exact scores, ranks, selections, DockQ, selected-minus-confidence difference, and loss to the best available pose. All ten are one exposed development case, not ten independent tests. No p-values, confidence intervals, new generation, new target evaluation, or promotion of a winning method on these data.

Before evaluating new targets, freeze a complete target-independent implementation and the eligible population, generator budget, missing-data rules, reference evaluator, family/lineage grouping and statistical plan. This case-specific comparison is not that completed study registration. See the accompanying prospective evaluation requirements after this comparison. Any new variant is a new version and stays exploratory on exposed cases.
