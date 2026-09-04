# Annotation-route priority source review — 2026-09-04

Eight entries remain pending: 9VOR/9VOS (GPR158/mGlyR) and 8XT9/8XUM/9KGK/9KHH/9S37/9S38 (LGR4). The package preserves all eight entry inventories, 23 deposited polymer records and their sequence hashes, primary-source provenance, exact sequence relationships and scoped development checks. It adds no eligible targets or certified independent components.

- [mGlyR/Nb20 primary source](https://www.nature.com/articles/s41467-026-68339-x) explicitly deposits 9VOR and 9VOS. These entries have identical receptor and Nb20 sequences. Construct/tag reconciliation remains open.
- [LGR4/NB21 primary source](https://www.nature.com/articles/s41467-025-63410-5) explicitly deposits 8XT9, 8XUM and 9S37. [LGR4/NB18 primary source](https://www.nature.com/articles/s41467-025-61545-z) resolves previously uncited 9KGK and 9KHH, and names the additional lead 9UOK. 9S38 matches all three 9S37 polymer sequences but has no exact deposition link in either reviewed paper.
- Deposited sequence comparisons against archived UniProt annotations find all seven transmembrane segment sequences in every reviewed receptor. These are not ectodomain-only deposited polymers. Experimental construct equivalence remains unresolved, particularly where LGR4 Methods and deposited sequences differ or short antibody records represent experimentally fused MB52 reagents.

**Exposure limitation:** an overly broad section filter emitted native contact/orientation prose from two LGR4 Results sections. No images, coordinates, contact tables, pose files or labels were fetched. `exposure-caveat.json` records the affected entries and exact source sections without reproducing contact details. The six LGR4 entries and related 9UOK are exposure-blocked pending formal adjudication; this package cannot claim they remained wholly unseen.

`source-reviews.json` separates source facts, sequence comparisons and audit interpretation. No exact receptor-accession, primary-DOI or full-polymer-sequence matches to the 17-node development inventory were found by these scoped checks. That does not certify family, VHH-lineage or full-graph disjointness. Frozen census and protocol files were not changed. Target freeze remains blocked and the whole-census component upper bound remains unknown.

Verification: all eight reported polymer counts and 23 sequence SHA-256 values replay against the archived metadata; all seven transmembrane segment comparisons replay against the two archived UniProt responses. Every bound input digest and every package checksum was checked.
