# Predictor training exposure remains unverified

The eight enrolled target sets are a study of newly generated predictions with rankings sealed before outcome evaluation. They are **not certified as unseen by Boltz-2**. Three reference entries predate its reported PDB training cutoff; five postdate it. Actual inclusion of an entry, selected interface, or related sequence in the exact checkpoint's training data was not established.

The Boltz-2 paper reports experimental PDB training structures released before **2023-06-01**. Its preprocessing uses biological assembly 1 and removes oversized complexes, clashing chains, very short resolved chains, unknown-only chains and certain nonbiological ligands. These filters prevent release date alone from proving membership. Structure training also uses molecular dynamics and distilled predictions; confidence training uses PDB data. The authors describe sequence-based novelty filtering for their own benchmarks, which has not been reproduced for this panel. [Boltz-2 paper, Section 2 and Appendices A.1.1, A.1.3, C.1.3 and D.1.1](https://jeremywohlwend.com/assets/boltz2.pdf).

The comparison below uses RCSB **initial release dates**, not deposition or revision dates, from the already enrolled metadata. All eight dates agree exactly with the frozen chain manifest.

| Target / Nb | Reference | Initial release | Relation to reported PDB training window |
|---|---|---|---|
| CASR / NB2D11 | [7E6U](https://www.rcsb.org/structure/7E6U) | 2021-09-22 | Before cutoff: potential overlap |
| GRM5 / NB43 | [6N51](https://www.rcsb.org/structure/6N51) | 2019-01-23 | Before cutoff: potential overlap |
| CHRM1 / NB1B4 | [9UCP](https://www.rcsb.org/structure/9UCP) | 2025-10-29 | After cutoff: outside that date window |
| LGR4 / NB21 | [9S37](https://www.rcsb.org/structure/9S37) | 2025-07-30 | After cutoff: outside that date window |
| ADRA1A / NB29 | [7YM8](https://www.rcsb.org/structure/7YM8) | 2023-07-05 | After cutoff: outside that date window |
| HCRTR2 / SB51 | [7L1V](https://www.rcsb.org/structure/7L1V) | 2021-02-10 | Before cutoff: potential overlap |
| RHO / NB2 | [8FCZ](https://www.rcsb.org/structure/8FCZ) | 2023-08-30 | After cutoff: outside that date window |
| FZD3 / NB9 | [8QW4](https://www.rcsb.org/structure/8QW4) | 2024-09-04 | After cutoff: outside that date window |

Post-cutoff status applies only to the exact PDB entry's date relative to the reported experimental PDB window. It does not establish unseen receptors, Nb families, homologous interfaces or absence from other training sources. Likewise, pre-cutoff status establishes possible overlap, not proven training membership. No target-specific exclusion is inferred from generic preprocessing rules.

GRM5 and LGR4 should remain described as **newly outcome-tested groups in this project**. GRM5's reference is pre-cutoff. LGR4's exact reference is post-cutoff, while sequence/family novelty remains unverified. Earlier project metadata screening and predictor training exposure are separate issues. Using no native templates during this study does not remove information previously learned by the predictor.

At the pinned source commit `b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc`, the official training guide still marks updated Boltz-2 training documentation as forthcoming and supplies Boltz-1 data instructions. This qualification does not treat those older assets as a definitive Boltz-2 inclusion/exclusion list. [Pinned official training guide](https://github.com/jwohlwend/boltz/blob/b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc/docs/training.md).

This is an interpretation qualification only. Enrollment, prediction inputs, ranking rules and selection are unchanged. No prospective outcomes or native coordinates were opened. `date-qualification.json` and its CSV retain all eight classifications; the JSON binds the original RCSB metadata, enrollment, launch plan and downloaded primary sources. The checkpoint identifier is inherited from the frozen launch plan, not a newly audited training manifest. `receipt.json` binds this report and the reproducible metadata-only classifier.
