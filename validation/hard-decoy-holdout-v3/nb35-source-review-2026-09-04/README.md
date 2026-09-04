# Nb35 primary-source review, 4 September 2026

This package attempts entry-specific review of 28 records from four large publication groups in the historical Nb35 queue. It supports 12 bounded auxiliary-binder exclusions. Sixteen entries remain pending because complete primary methods and deposition text could not be retrieved. Pending rows are retained even though their sequences share a 126-residue segment with source-linked Nb35.

| Publication | Entries | Outcome |
| --- | ---: | --- |
| [Cao et al., Science 2022](https://doi.org/10.1126/science.abm9609) | 10 | Pending primary full text |
| [Kobayashi et al., Molecular Cell 2022](https://doi.org/10.1016/j.molcel.2022.07.003) | 6 | Pending primary full text |
| [Zhao et al., Nature Communications 2022](https://doi.org/10.1038/s41467-022-28683-0) | 6 | Source-supported auxiliary exclusions |
| [Li et al., PNAS 2023](https://doi.org/10.1073/pnas.2303696120) | 6 | Source-supported auxiliary exclusions |

The JSON separates facts reported by each paper, computational sequence relationships, and entry-level audit inferences. The Nature Communications article supplies direct reagent-target evidence. The PNAS article establishes its own sample composition and exact depositions; the reagent-role inference also requires the recorded sequence relationship to the independently source-linked reference. Its 8JIQ deposition is explicitly an updated prior model.

Every row records all deposited polymer entities, canonical sequence hashes, entity and chain identifiers, component accounting, and the exact frozen raw-metadata file hash. All sequences were checked against those raw records. Eleven reviewed entries have the complete 140-residue reference sequence; 8JIS has an exact internal 126-residue segment. Terminal differences are recorded without inventing an expression or cleavage explanation.

These are entry assessments, not a completed census or a component upper bound. A name match or absence of an antibody keyword has no exclusion authority. No native coordinates, structural images, docking labels or prediction outputs were inspected. The protocol remains DRAFT and its target freeze remains blocked.

Files: `source-reviews.json` contains source facts and the 28 reviews; `checksums.sha256` protects this package. Input hashes identify the pre-existing frozen metadata, which is not modified.
