# Review-disposition integration overlay

Status: **70 conflict-free, contract-coded whole-entry dispositions integrated; target freeze remains blocked.**

This packet integrates the frozen disposition seed and later bounded source-review packages into one review overlay. It validates every accepted code against the frozen disposition contract, preserves every contributing source path, distinguishes the historical 287-entry universe from expanded discovery, and detects duplicate or conflicting dispositions. It does not rewrite the externally pinned master ledger or integration state.

The overlay contains 26 receptor-cluster exclusions, 31 auxiliary-binder exclusions, 3 engineered-epitope exclusions, 4 fusion-dominated exclusions and 6 no-direct-interface exclusions. Sixteen legacy source codes map unambiguously to these frozen contract categories. Two GCGR rows have consistent corroboration from both the earlier bounded audit and the later complete-inventory review; no conflict is present.

Within the historical 287-row seed, 23 previously pending rows now have contract-coded source-review overlays. If applied, that would reduce the historical pending count from 272 to 249. This is progress accounting, not a completeness claim: 32 integrated rows belong to expanded discovery, 6 additional source-reviewed rows retain ambiguous component-collapse codes requiring manual contract adjudication, and six GPR1 Nb32 entity dispositions remain excluded from the whole-entry ledger because their entries are still pending.

No eligibility or graph authority is created. Formally cleared independent components remain zero, the whole-census upper bound remains unknown, and target freeze remains blocked. No coordinates, relative poses, structural contact tables, labels, prediction outputs or performance results were accessed.

Verify offline with:

```bash
node scripts/hard-decoy-v3/integrate-review-dispositions.mjs verify
node --test tests/hard-decoy-v3-review-disposition-integration.test.mjs
```
