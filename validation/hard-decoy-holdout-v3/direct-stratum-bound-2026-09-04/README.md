# Direct-looking stratum upper bound: 2026-09-04

The 29 nondevelopment entries in the prioritized direct-looking queue can add at most **two** independent components. Nineteen have a one-edge public pregraph path to development, six are publicly linked to existing provisional components, and the four remaining transitive-path entries form at most two groups when only definite metadata identity is used.

Starting from seven existing provisional components, this stratum reaches at most nine—below the required ten. Therefore further detailed review within this 29-entry stratum cannot by itself rescue the formal holdout. Of the other 243 pending nondevelopment rows, three (`7E6U`, `8JXS`, and `8QJ2`) are already named in the seven-component census. At least one new independent component must be found among the remaining 240 rows, and more would be needed if any of the current seven fail later gates.

This is a stratum bound, not a terminal whole-census decision. It assigns no final target dispositions and authorizes no target freeze, native access, MSA retrieval, generator run, or label access.

Regenerate and verify with:

```bash
node scripts/hard-decoy-v3/build-direct-stratum-bound.mjs
node --test tests/hard-decoy-v3-direct-stratum-bound.test.mjs
```
