# New 900-attempt generation comparison

This exploratory comparison uses the newly generated seed batch only: twelve cases, three arms, and 25 planned attempts per case and arm. The earlier 300 predictions are excluded.

The prespecified pair-context gate retains/selects **baseline**. The primary nine cases represent eight qualified biological groups. Other contexts retain baseline. This is not a general superiority or production-promotion claim.

| Arm | Generated / planned | Valid | Evaluable | First-choice DockQ | Acceptable-first probability | Best available DockQ |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 225 / 225 | 225 | 225 | 0.3999 | 0.6875 | 0.4830 |
| broader | 225 / 225 | 225 | 225 | 0.4165 | 0.6875 | 0.5033 |
| msa1024 | 225 / 225 | 225 | 225 | 0.4051 | 0.7500 | 0.5036 |

Means give equal weight to biological groups and then to target cases within each group. Scientific score ties are averaged. Detailed JSON retains all 36 pools, every group difference, first/top-five summaries, best-candidate gaps, failures, missing outcomes, wall-time completeness, and descriptive whole-group bootstrap intervals.

| Alternative | First-choice gain | Acceptable-first losses | Coverage unchanged | Complete outcomes | Passes gate |
|---|---:|---:|---|---|---|
| broader | 0.0166 | 0 | True | True | False |
| msa1024 | 0.0052 | 0 | True | True | False |

Full-context, helix, dimer, dimer-without-CASR, and low-resolution exploratory CASR results are reported separately in comparison.json. No missing quality value is replaced with zero. Available best describes only evaluated candidates. One additional reserved learner-eligible group will remain insufficient for a broad superiority claim.
