# Eight-packet discovery union

This successor preserves both earlier union receipts and all original packets.
It binds exactly the first **2,000** identifiers in the pinned 12,262-entry
phrase-only partition. The verified totals are **3,227 polymers**, **274 review
rows** and **119 missing/noncanonical/engine-review entities**. These categories
overlap; the last count does not mean 119 absent sequences. Exactly **10,262**
identifiers remain uncaptured in this partition. This is operational coverage,
not a whole-census bound or biological sampling claim.

| New packet | Identifier range | Complete inventories | Polymers | Review rows | Sequence/engine review | Heavy-domain leads |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 004 | 1R2A–1X6C | 250 | 390 | 33 | 12 | 5 |
| 005 | 1X7E–2BXU | 250 | 537 | 42 | 7 | 4 |
| 006 | 2BYE–2IUI | 250 | 382 | 49 | 19 | 2 |
| 007 | 2IUL–2N2V | 250 | 344 | 35 | 24 | 0 |

All 80 new repeated metadata requests succeeded with HTTP 200; their normalized
inventories agree. There were no failed requests in these four packets. The one
earlier HTTP 502 attempt remains retained in packet 003. No collector, query,
screen, threshold, frozen input or earlier exposure record changed.

## Every new heavy-domain hit is retained for review

`lead-triage.json` binds all eleven leads to exact source rows and preserves
all 39 deposited polymers across those eleven entries. This is metadata triage;
primary preparation Methods for these leads were not accessed in this increment.

| Entries | Deposited context | Remaining interpretation boundary |
| --- | --- | --- |
| 1SY6, 1XIW | CD3 components with antibody heavy/light chains | Fab/scFv context does not establish a VHH case |
| 1TZH, 1TZI, 2FJG, 2FJH | VEGFA with antibody heavy/light chains | Conventional Fab context; formal disposition remains pending |
| 1V7M, 1V7N | Thrombopoietin with TN1 heavy/light chains | Conventional Fab context; formal disposition remains pending |
| 2BDN | CCL2 with 11K2 heavy/light chains | Conventional antibody context; formal disposition remains pending |
| 25ST, 25SU | TAS2R4, scFv16 and G-protein components; 25ST also has a tripeptide | GPCR-containing entries, but the 307-residue antibody is annotated scFv16; primary DOI/PMID are absent |

The TAS2R4 entries warrant explicit format/source review. A numbered heavy domain
inside an scFv does not establish VHH identity, nor does the presence of a GPCR
establish that an antibody binds that receptor directly. No binding role or
formal exclusion is inferred here. Unnumbered and missingness-review rows remain
in the denominator; zero heavy-domain calls in packet 007 do not prove absence.

## Offline verification and continuation

```sh
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
node --test tests/hard-decoy-v3-phrase-only-union.test.mjs
```

Tests replay each new packet without network, verify exact source identities and
ordinal membership, recompute polymer/review totals, reject duplicate or omitted
membership, and account for every heavy-domain lead and its complete inventory.
The older three- and four-packet receipts remain independently verified.

Next fixed batch: **chunk index 8**. New independent eligible groups: **0**.
Predictive accuracy remains **unmeasured**. Publication still requires original
input availability, independent researcher completion, author/disclosure facts
and a validated archived release. Construct, lineage, overlap, exposure and
frozen-engine requirements remain additional predictive-evaluation gates.
