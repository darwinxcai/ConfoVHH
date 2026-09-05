# 9UCP Nb1B4 sequence evidence

This deterministic offline comparison uses the retained metadata for three deposited entities and all 18 frozen development VHH profiles. The 122-residue Nb1B4 entity has 91 framework and 16 CDR3 residues in its complete numbered heavy-chain domain. 0 development profiles meet the frozen framework/CDR3 criterion. A negative comparison is not evidence of independence or no leakage. Sequence evidence does not establish direct receptor binding, VHH format or ancestry.

The 435-residue entity described as an M1 receptor/de novo protein has no retained UniProt reference. None of the explicitly checked 89 canonical records, 287 candidate profiles or 17 development receptor profiles supplies M1. Repeated independent UniProt and GPCRdb captures now provide the same 460-residue P11229/acm1_human canonical sequence and a complete TM1–TM7 profile. This is a proposed reference only; no accession was assigned to the deposited construct. The packet records whole-construct alignment metrics, exact shared sequence blocks and all 17 conditional development-receptor comparisons. The canonical M1 comparison cannot establish the deposited construct identity or a formal leakage edge. Exact shared blocks do not assign biological construct boundaries or mutations. Related 9UAP/9UAZ metadata remains available for source/deposition reconciliation; absent heavy-domain detection is not absence evidence.

No publications, coordinates, native pose images, observed labels or prediction outputs were opened by this sequence analysis. Parent publication review and prior exposure adjudication remain separate. Target freeze remains blocked.

Reproduce from any checkout containing the pinned inputs and dependencies:

`node validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/build.mjs verify --repository-root .`

Use `collect --output-directory PATH` to create a fresh copy. The executed script itself is inventoried. Every output is byte-deterministic, with no timestamps or absolute workspace paths. Verification checks every output and the exact file inventory. Input and dependency bytes are hash-bound before importing the numbering implementation.
