# EP2/EP4 and DP1 source review, 5 September 2026

This packet advances the next two census review groups from main commit `3e608cf74e9330198752c677fe18544d3eaafa6b`, without modifying the paper work, frozen protocol, eligibility ledgers or leakage graph. It accounts for **12 entries and all 47 deposited polymers**, verifies every exact primary deposition link, and retains ten successful bibliography/article/canonical captures with original bytes and timestamps.

| Source group | Entries / polymers | Source-supported result | Remaining limit |
| --- | --- | --- | --- |
| EP2/EP4 | 9JRO, 9JRT, 9JQY, 9JQZ / 14 | EP2 preparation uses anti-BRIL Fab and anti-Fab Nb; EP4 uses conventional anti-EP4 Fab001 | GFP-like fusion provenance and EP4 boundary discrepancy remain unresolved |
| DP1, Nature Communications | 9AU0, 9E9S, 9EE5, 9EI5, 9EKH / 22 | Distinct Gs/Nb35 and BRIL/BAG2/anti-Fab-Nb preparations | Expression/deposition tag differences and formal role/graph review remain |
| DP1, PNAS | 8ZVZ, 8ZW0, 9UWD / 11 | Two Gs/Nb35 deposits plus an inactive preparation whose Methods add FabBRIL/NbFab | 9UWD retains only one receptor polymer; absent antibodies or binder fusion are not established |

## Material sequence findings

- All 18 frozen development VHH profiles were reproduced. Six deduplicated numbered domains yield 108 domain/reference pairs; all 16 heavy-domain-positive entities yield 288 entity/reference pairs. Five entities meet the frozen VHH criterion against development **8QOT**: both EP2 Nbs and the three Nature DP1 anti-Fab Nbs. EP2 has 90/91 framework identity and 14/14 CDR3 identity; the DP1 domains have 91/91 and 14/14. These are development-review signals, not new formal edges.
- The EP2 Nb exactly matches historical `8TB7_3` over its full 122 residues. Its auxiliary role is supported separately by the new paper's preparation Methods, not inferred from that sequence match alone.
- EP4 deposited sequence exactly reproduces the reported four substitutions and canonical residues **4–217 plus 260–366**, following a 228-residue prefix. Thus residues **347–366 remain in the deposit despite the Methods' stated deletion of 347–488**. This discrepancy is not silently corrected.
- Nature DP1 inactive sequences reproduce C130R/H263A/D319N and canonical ranges 1–233 plus 258–359 around a 113-residue insertion. Their terminal **ten histidines** differ from the Methods' eight-His description.
- The PNAS active deposits contain canonical DP1 1–340 after a 128-residue prefix, with no deposited C-terminal suffix although Methods describe LgBiT/OMBP-MBP engineering. The inactive 9UWD sequence instead has exact canonical blocks 1–227 and 258–340 around a 118-residue insertion. These sequence facts do not establish complete expressed constructs.

The unchanged development-comparison code also retains 187 receptor/reference comparisons for the 11 entries with heavy-domain calls. Seven lack a recognized canonical receptor profile in the retained comparison panel. New UniProt captures provide **sequence anchors only**, not newly resolved GPCRdb profiles; therefore neither nonmatches nor missing profiles establish disjointness. The single-polymer 9UWD is accounted for in the inventory but is not included in that selected heavy-positive receptor matrix. All eight DP1 entries share Q13258 across two papers; they are not eight independent cases.

## Sources, license and exposure boundary

- Wu et al., [EP2/EP4 primary publication](https://doi.org/10.1038/s44318-025-00611-0), PMID 41162752, PMC12669672. CC BY 4.0.
- [DP1 Nature Communications primary publication](https://doi.org/10.1038/s41467-025-64002-z), PMID 41062467, PMC12508460. CC BY-NC-ND 4.0.
- [DP1 PNAS primary publication](https://doi.org/10.1073/pnas.2501902122), PMID 40440061, PMC12146711. CC BY-NC-ND 4.0.

Author lists, full titles and original license notices are reproduced in `allowed-sections.json`. Source article XML is retained unmodified with its notices, separately from our factual audit. Source files retain their original licenses, not the repository's MIT license. This is non-commercial scholarly source verification.

Only bibliographic identifiers, Methods subsection titles, specified preparation Methods, deposition statements and canonical sequence annotations were inspected. No structural Results, model-building prose, captions, contact tables, native coordinates, pose images, prediction outputs or evaluation labels were inspected in this review. Deposition statements include map identifiers and sample labels; no linked coordinate/map assets were opened. Previously recorded exposure caveats remain applicable. This is **not** a clean-blind certificate.

**V3 remains DRAFT; target freeze remains BLOCKED; new formally cleared independent components: zero; whole-census upper bound: unknown.** Direct binder identity, expression/deposition reconciliation, experimental lineage and formal leakage/exposure adjudication remain separate from metadata and preparation evidence. No formal exclusions are issued here.

## Reproduce

From a checkout root with the existing pinned dependencies installed:

```sh
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
python3 -B validation/hard-decoy-holdout-v3/prostanoid-source-review-2026-09-05/build.py verify --repository-root .
node --test tests/hard-decoy-v3-prostanoid-source-review.test.mjs
```

Verification rebuilds all three derived JSON outputs offline, recomputes the development pair space, checks every repository input digest, and rejects changed, missing or extra packet files. It does not rerun network captures. Use `-B` to avoid adding Python cache files to the exact packet inventory. The capture scripts refuse to overwrite original responses. The canonical sequence anchors are deterministic exact-block matches, not an optimal alignment or frozen receptor-identity test.

Next: resolve the explicit EP4 range, DP1 tag and 9UWD polymer-coverage discrepancies through preparation/deposition records; integrate only evidence-supported role and development assessments into the separate formal review. Uncollected phrase-only discovery IDs and other source families remain open.
