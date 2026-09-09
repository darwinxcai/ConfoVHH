# Twelve-packet discovery union

This immutable successor preserves the three earlier union receipts and every
original packet. It binds exactly the first **3,000** identifiers in the pinned
12,262-entry phrase-only partition. Verified cumulative totals are **5,316
polymers**, **455 review rows** and **159 missing/noncanonical/engine-review
entities**. The review categories overlap, and the last count does not mean 159
absent sequences. Exactly **9,262** identifiers remain uncaptured in this
partition. This is operational coverage, not a whole-census bound, independent
sample size or biological sampling claim.

| New packet | Identifier range | Complete inventories | Polymers | Review rows | Sequence/engine review | Heavy-domain leads |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 008 | 2N2W–2VAS | 250 | 367 | 37 | 18 | 1 |
| 009 | 2VAY–3BTQ | 250 | 517 | 78 | 6 | 13 |
| 010 | 3BTT–3GM1 | 250 | 392 | 46 | 12 | 3 |
| 011 | 3GM2–3M96 | 250 | 813 | 20 | 4 | 2 |

All 80 new repeated metadata requests ultimately succeeded with HTTP 200 and
agree after normalization. Packet 009 batch 007 repeat 1 returned HTTP 502 on
its first attempt and succeeded on the collector's second attempt after its
built-in delay. Both attempts and their response bytes remain retained. Together
with the earlier packet 003 failure, the cumulative union contains **two failed
attempts**, **240 successful responses** and **zero unresolved requests**. No
collector, query, screen, threshold, frozen input or earlier exposure record
changed. The collector made requests sequentially within the fixed chunk order.

## Every new heavy-domain hit is retained for review

`lead-triage.json` binds all **19** new lead entries to exact source rows and
preserves all **76** deposited polymers across those entries. Only deposited
metadata was reviewed. No primary article bodies, Results, figures, native
coordinates, relative poses, contact tables, labels or prediction outputs were
accessed for this increment.

| Entries | Complete deposited context | Interpretation boundary |
| --- | --- | --- |
| 2QR0, 3BDY | VEGFA with conventional Fab heavy/light chains | Numbered heavy domains do not establish VHH identity |
| 2VC2, 2VDK, 2VDL, 2VDM, 2VDN, 2VDO, 2VDP, 2VDQ, 2VDR | Integrin alpha-IIb/beta-3 with conventional 10E5 heavy/light chains; five entries also contain a deposited peptide | All polymers remain accounted; no formal exclusion or role assignment |
| 2W9E | Prion protein with ICSM18 Fab heavy/light chains | Conventional antibody context; disposition pending |
| 2X6M | Dromedary heavy-chain variable domain with an alpha-synuclein peptide | Camelid-domain signal, without an established GPCR case |
| 31IC | EAAT3 transporter with deposited B11 nanobody | Nanobody metadata signal; primary DOI/PMID absent; no established GPCR case |
| 3CK0 | Angiotensin II octapeptide with immunoglobulin heavy/light chains | Ligand context does not establish receptor presence; primary DOI/PMID absent |
| 3FFD | Parathyroid hormone-related protein with monoclonal Fab heavy/light chains | Hormone context does not establish receptor presence |
| 3G6J | Complement C3 alpha/beta chains with Fab heavy/light chains | Complete four-polymer inventory; disposition pending |
| 3JAB, 3JBQ | Phosphodiesterase domains and inhibitory peptide with 2E8 IgG1-kappa heavy/light chains | G-protein-effector context does not establish GPCR presence |

These contexts do not establish direct GPCR–VHH binding, formal eligibility,
formal exclusion, independence or leakage-graph clearance. All lead dispositions
remain pending. Unnumbered and missingness-review rows remain in the denominator;
the numbering screen alone cannot establish absence of hidden VHH constructs.

## Offline verification and continuation

```sh
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
node --test tests/hard-decoy-v3-phrase-only-union.test.mjs
```

Tests replay each new packet without network, verify exact evidence hashes and
ordinal membership, recompute all polymer/review totals, check the unchanged
eight-packet prefix, and bind every new heavy-domain lead to its complete
deposited inventory. Earlier receipts retain their own verification.

Next fixed batch: **chunk index 12**. New independent eligible groups: **0**.
Predictive accuracy remains **unmeasured**. This receipt improves evidence
completeness and does not itself resolve publication or predictive-evaluation
gates.
