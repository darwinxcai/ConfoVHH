# Entry-specific review of sixteen auxiliary candidates

Status: **16 entity roles supported; 12 scoped entry exclusions; four entries pending inventory reconciliation.** V3 remains DRAFT with target freeze BLOCKED. Broader candidate discovery is incomplete.

This review advances the [212-row descriptor triage](../auxiliary-remainder-bound-2026-09-04/README.md) using entry-specific primary publication text, exact deposition statements, and the frozen entity sequences and inventories. The evidence record distinguishes source facts from audit inferences. It does not access native coordinates, structural figures, labels, or predictions.

| Outcome | Entries | Meaning |
|---|---:|---|
| Auxiliary role supported for the candidate entity | 16 | Thirteen anti-Fab nanobodies and three scFv16 fragments have entry-specific reagent-role evidence |
| Entry exclusion supported by this scoped review | 12 | The paper, deposition linkage, and enumerated inventory support the auxiliary-binder exclusion |
| Inventory discrepancy remains unresolved | 4 | 8JBG, 8XVJ, 8XVK, and 8XVL retain PENDING_REQUIRED_METADATA |
| Original remainder outside this review | 196 | Nb35-like entries still need entry-specific review |

The paper for 8JBG reports modeled Nb35 that is absent from the frozen entity table. The papers for 8XVJ/8XVK/8XVL describe an additional receptor-specific Fab301 that is absent as separately named entities in the frozen inventory. The reviewed scFv16 or anti-Fab entity can be assigned an auxiliary role without silently resolving these inventory discrepancies. There are therefore **200 unresolved entries in this historical remainder after applying the 12 scoped review dispositions**. This is not a new whole-census count bound.

All thirteen anti-Fab entities share the exact 121-residue sequence segment found at residues 3–123 of source-reviewed 6WW2 entity 2. Terminal extensions are recorded explicitly. This computational segment relationship supports identity review alongside each entry's paper; it does not establish cleavage state or replace entry-specific evidence. The 6WW2 paper attributes its reagent to Ereno-Orbea et al. 2018. Identity to a different, later universal Fab-binding reagent is not assumed.

`source-reviews.json` contains nine primary sources, section references, deposition mappings, frozen raw-file hashes, full polymer-entity inventories, chain identifiers, sequence hashes, and the reasons for each disposition. These records supersede only the corresponding triage assessments. The frozen historical master disposition ledger and integration state are preserved; later integration must explicitly cite this package.

Verify source-to-metadata bindings and the sequence comparisons with:

```bash
node scripts/hard-decoy-v3/verify-auxiliary-source-review.mjs
node --test tests/hard-decoy-v3-auxiliary-source-review.test.mjs
```

The verifier checks reproducibility and consistency of the recorded evidence. Scientific interpretation remains reviewable through the cited primary sources; passing software checks does not prove source completeness.

Next actions are to reconcile the four inventory discrepancies, review the 196 Nb35-like entries using their exact-sequence groups and entry-specific papers, and complete the separately archived broader discovery routes required by the [census reconstruction plan](../CENSUS_RECONSTRUCTION_PLAN.md). No terminal census decision follows until those scopes are resolved.
