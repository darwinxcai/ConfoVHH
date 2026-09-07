# Auxiliary-inventory bounded adjudication

Status: **8JBG, 8XVJ, 8XVK and 8XVL receive bounded auxiliary-binder exclusions; zero eligible-component increment.**

The retained primary-source review already establishes the role of every deposited VHH or antibody-format candidate. This follow-up checks those roles against each complete deposited polymer inventory rather than treating a source-only reagent name as another deposited chain.

8JBG contains six polymers. Its only deposited antibody-format entity is source-reviewed scFv16, a G-protein-complex stabilizer; the paper's modeled Nb35 is not a separate deposited entity. Each ETA entry contains four polymers: one source-reviewed anti-Fab nanobody, conventional Fab heavy/light chains, and receptor construct. Source-reported Fab301 is not a separate deposited VHH entity. These facts support `EXCLUDE_AUXILIARY_BINDER` for all four entries.

The Nb35/Fab301 source-to-deposition naming discrepancies remain explicit. They do not establish reagent absence, but they also cannot manufacture a deposited direct receptor-binding VHH target. No master ledger or formal graph is rewritten. No coordinates, relative poses, structural contact tables, labels, prediction outputs or performance results were accessed. Formally cleared independent components remain zero and target freeze remains blocked.

Verify offline with:

```bash
node scripts/hard-decoy-v3/adjudicate-auxiliary-inventory-remainders.mjs verify
node --test tests/hard-decoy-v3-auxiliary-inventory-adjudication.test.mjs
```
