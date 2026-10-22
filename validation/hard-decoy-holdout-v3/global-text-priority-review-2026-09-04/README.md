# Four global-text discovery priorities

Primary publication evidence resolves the deposition links and sample classes for four selected entries. All eight deposited polymer entities and their exact sequences are retained in `source-reviews.json`.

| Entry | Primary-source result | Remaining limit |
| --- | --- | --- |
| **7T62** | CT3 is a mouse monoclonal antibody prepared as a **Fab**, mixed with glypican-2 for negative-stain EM. The paper's wwPDB identifier **D_1000256119** exactly matches the 7T62 deposition metadata. | Its 433-residue deposited CT3 entity does not establish a single-domain VHH or a particular experimental chain topology. Glypican-family annotation supplies a target-class explanation for the global text hit. |
| **8Q7O** | Primary Data availability explicitly identifies **FZD3 CRD–Nb8**. The deposited receptor contains exactly canonical residues **26–138**, with terminal sequence retained separately. | The publication's **Nb8** name versus deposited **14478** remains unreconciled; complete post-cleavage terminal sequence provenance is pending. |
| **6N4Y, 6N50** | Primary Data availability explicitly identifies **mGlu5 ECD–Nb43** samples, with L-quisqualate in 6N50. Both receptor and Nb43 sequences are identical across the two entries. | Methods specify receptor **21–569**, six histidines and tag removal; both deposits contain a **37-residue prefix + canonical 21–571 + eight histidines**. Experimental and deposited constructs remain unreconciled. |

The FZD3 and mGlu5 receptor fragments end before the first canonical transmembrane segment. All seven annotated TM segment sequences were checked and are absent as complete exact substrings from those deposited receptor sequences. This establishes sequence scope, not resolved structural content or a formal entry exclusion. Canonical accessions, full polymer sequences and publication identifiers were also compared with all 17 development-reference nodes. **8Q7O shares both receptor accession and publication DOI with development entry 8QW4**; different Nb8/Nb9 names do not establish independence. Exact nonmatches for the other entries do not certify absence of leakage.

The three primary publications are [CT3/GPC2](https://pmc.ncbi.nlm.nih.gov/articles/PMC8233664/), [FZD3 nanobodies](https://pmc.ncbi.nlm.nih.gov/articles/PMC11341715/) and [mGlu5/Nb43](https://pmc.ncbi.nlm.nih.gov/articles/PMC6709600/). Retained primary excerpts contain construct/sample preparation and deposition prose. Full source responses are archived for reproducibility and must not be rendered wholesale during restricted review.

**Exposure caveat:** the initial mGlu5 Methods-navigation pass also printed qualitative structural section headings, and an initial Methods extraction included model-building procedures and stereochemistry summaries. The retained extractor now restricts crystallization sections to their sample-preparation paragraphs. No Results paragraphs, figure captions, residue-contact assignments, native pose coordinates, structural images, contact tables, model prediction outputs or DockQ/CAPRI labels were accessed. `exposure-scope.json` records the incidental prose; no clean-blind or exposure-clearance claim is made for the affected source family.

`source-reviews.json` separates source facts, sequence observations, unresolved constructs and formal authority. No target or independent component is cleared. The whole-census component upper bound remains unknown, and target freeze remains blocked. Existing evidence, protocols and ledgers are unchanged; 8YKD was not reviewed again.

Verify the retained file inventory, all source hashes, canonical sequence comparisons, primary deposition joins and exact filtered source extraction offline from the repository root:

```bash
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
python3 -B validation/hard-decoy-holdout-v3/global-text-priority-review-2026-09-04/build.py verify --repository-root .
```

On a fresh checkout, the first command restores the exact compressed global-text artifacts required by the review. The verification command also replays the independent FZD3 extractor. Both scripts resolve files relative to their own packet; `--repository-root` may point to a relocated checkout. The global 2,911-entry metadata file and screen inputs are pinned by SHA-256, without copying or modifying those historical artifacts.
