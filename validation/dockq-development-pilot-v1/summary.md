# ConfoVHH local-SE(3) DockQ development pilot

Status: executed as a **development-only plumbing and association study** on previously used public complexes. It is not the formal hard-decoy protocol or an independent holdout.

DockQ measures similarity to each source complex, not binding, affinity, specificity, function, or physiological validity. All near-native and preliminary-release flags remain false.

## Dataset

- Targets: 5
- Grid poses generated: 360
- Poses retained after label-blind 0.5 Å VHH C-alpha deduplication: 360
- CAPRI-style classes among retained poses: 55 high, 76 medium, 98 acceptable, 131 incorrect
- Native-self controls: 5/5 passed
- +1000 Å controls: 5/5 passed
- Independent DockQ CLI cross-checks: 10/10 passed

## Tie-aware target-macro results at DockQ >= 0.23

| Prespecified arm | AP | AP lift | AUROC | Expected success@10 | Kendall tau-b |
|---|---:|---:|---:|---:|---:|
| confovhh_evidence_v0_4 | 0.687853610626 | 1.081281677441 | 0.574180187644 | 1 | 0.368180967558 |
| contact_count | 0.673342807553 | 1.058839644242 | 0.623736937385 | 1 | 0.129967961985 |
| delta_sasa | 0.772742639817 | 1.214965805109 | 0.754144372319 | 1 | 0.381470235495 |
| clash_burden | 0.594257550904 | 0.933964374894 | 0.468559655847 | 1 | 0.091945571742 |
| cdr_contact_share | 0.687729162761 | 1.081787548163 | 0.674351958005 | 1 | 0.197956483419 |
| random_all_tied | 0.636111111111 | 1 | 0.5 | 0.999988525134 | NA |

Intervals in the machine-readable summary are paired 10,000-replicate development-target bootstrap dispersion intervals. They are not evidence of external generalization or statistical significance.

CDR-arm clarification: numbered poses with zero contacts receive a bottom score of 0 rather than being dropped. This missing-value policy was clarified after the initial plumbing run, without fitting a threshold or weight to DockQ; the evidence-band and delta-SASA arms are unaffected.

## Interpretation boundary

This native-derived perturbation grid can reveal descriptive association inside a narrow local rigid-body distribution. It does not test blind docking, wrong-patch decoys, flexible conformational change, non-binders, unseen receptor families, unseen VHH lineages, or experimental binding. The separate prospectively specified hard-decoy protocol remains unexecuted.
