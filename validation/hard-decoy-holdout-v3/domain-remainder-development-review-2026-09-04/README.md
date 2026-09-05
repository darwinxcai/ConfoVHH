# Domain-remainder development-reference review

Metadata and sequence review only. Target freeze remains blocked; the whole-census independent-component upper bound remains unknown.

All 374 heavy-domain-positive entities in 345 of the 692 captured entries are accounted for. Their 478 window calls are retained, including overlapping alternatives; these are not independent domains. All 18 frozen development VHH profiles reproduce, and all 17 development receptor nodes are compared.

19 entities have a positive frozen VHH sequence criterion; 42 entries have a positive canonical receptor annotation/TM signal. These counts are review signals and cannot establish direct binding, VHH format, ancestry, formal leakage edges, exclusions, eligibility, or independent components. A negative comparison is never a no-edge decision.

## Methods and limits

The prior screen is hash-bound, not rediscovered. Every retained domain interval is extracted and renumbered using pinned immunum 1.3.0 IMGT heavy-chain numbering. Boundaries, framework and CDR3 digests must reproduce; disagreements remain unresolved. Nonempty IMGT regions do not prove complete biological termini. Overlapping contained alternatives remain explicit; any positives confined to them are flagged. Frozen global affine BLOSUM62 framework/CDR3 thresholds use integer arithmetic.

Receptor accessions are recognized only through retained uniquely resolved canonical GPCRdb profiles. Arbitrary fusion annotations, including T4 lysozyme and BRIL, do not become receptor identities. Available canonical TM1–TM7 sequences use the frozen primary identity/coverage criterion and retain the 0.30 identity sensitivity criterion as a veto-only review signal. Every recognized alternative is retained, and missing profiles or multiple recognized accessions remain unresolved for entity/construct adjudication. Canonical sequence comparison does not establish deposited construct sequence identity.

The next offline task groups source review by 99 exact containing-entity sequences, retaining every entry and distinct DOI/PMID identifier. These groups are not VHH identities, equivalent publications, or leakage components. Descriptor-based auxiliary/Fab/scFv signals organize review but never exclude an entry. All prior exposure caveats continue to apply; this package itself reads only the bound metadata/sequence inputs and no primary publications, native coordinates, pose images, labels or model outputs.

## Reproduce

From any checkout root with the pinned npm dependencies installed:

`node scripts/hard-decoy-v3/compare-domain-remainder-development.mjs verify --repository-root . --output-directory validation/hard-decoy-holdout-v3/domain-remainder-development-review-2026-09-04`

To create a fresh copy, use `collect` with an empty output directory. The output is byte-deterministic, without timestamps or absolute workspace paths. Verification rebuilds every output and checks the exact file inventory, so missing pairs, extra files and edited input/output bytes fail. All files except checksums.sha256 are listed in that inventory; the manifest binds source, protocol contracts, existing algorithms and runtime dependency hashes.
