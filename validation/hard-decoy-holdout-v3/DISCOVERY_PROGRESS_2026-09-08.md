# Discovery continuation: 8 September 2026

This follows [the earlier discovery record](DISCOVERY_PROGRESS_2026-09-04.md)
and the publication/evaluation continuation in
[`paper/PROGRESS_2026-09-08.md`](../../paper/PROGRESS_2026-09-08.md).
Read the latest repository and PR state before repeating work. Current main at
the start of this increment was `9aeadb8185a02da4e67967d9fbe12b1503d02e96`;
PR #56 contains the subsequent unmerged evaluation/evidence work. Its required
exact producer gate still receives HTTP 403 from Zenodo.

## Completed GPR158/mGlyR source-family comparisons

The [Nb20 development comparison](mglyr-development-review-2026-09-08/README.md)
reconciles both 9VOR and 9VOS with the retained source-review inventories and all
six deposited polymers. It reproduces the shared Nb20 IMGT domain and all 18
frozen development VHH profiles, then evaluates 36 entity/reference rows,
representing 18 distinct domain/reference comparisons. No frozen VHH threshold
signal was found in that defined comparison. This is not evidence of unrelated
ancestry or a formal no-edge decision.

The [canonical receptor follow-up](mglyr-canonical-capture-2026-09-08/README.md)
then closes the missing Q5T848 reference-profile gap recorded in that first
packet. Four fresh GPCRdb responses comprise two repeated protein/residue
captures. They agree with each other and with the independently retained human
UniProt sequence, including all 1,215 canonical residue positions. The unchanged
frozen GPCRdb extractor yields 208 residues across TM1–TM7. The 17 unique
development receptor comparisons are represented by 34 entry/reference rows.
Neither the primary nor the existing veto-only sensitivity criterion produces
a threshold signal in these comparisons.

The first packet's missing-profile status is preserved as a historical record;
the later packet explicitly supplies the new comparison evidence. The new
canonical profile is a separate capture epoch, not a replacement of any frozen
profile. Canonical receptor agreement does not resolve expressed constructs,
tags, resolved-coordinate identity or biological binder role.

## What remains before this family can enter an independent evaluation

1. Resolve exact cryo-EM receptor truncation and Nb20 tag/preparation provenance
   from the unavailable supplementary Methods identified in the existing
   construct follow-up. Metadata sequence agreement is insufficient.
2. Resolve known parent/variant relationships and candidate-to-candidate
   comparisons, then integrate the source family into the formal global graph.
   Comparisons only to development references do not establish independence.
3. Adjudicate the retained navigation/exposure caveats under the existing rules.
   No new exposure clearance is granted by sequence comparisons.
4. Preserve the exact frozen engine/rounding and pre-label execution requirements
   before any v3 benchmark execution. The separately named current-product
   evaluation adapter cannot substitute for that arm.

Formally cleared independent eligible groups remain **0**. No scoring policy,
frozen scientific input, census disposition or earlier exposure record changed.
No primary article body, coordinate, relative pose, contact table, reference
label or real prediction output was accessed by these two comparisons.

Offline verification commands:

```sh
node scripts/hard-decoy-v3/compare-mglyr-development.mjs verify
node scripts/hard-decoy-v3/review-mglyr-receptor.mjs verify
```

Separate evaluation machinery now verifies supplied audit-report bytes and
extracts current-product rank features directly; see
[`AUDIT_REPORT_RANK_EXPORT.md`](../../paper/AUDIT_REPORT_RANK_EXPORT.md).
Its examples use generated synthetic data only. The scientific next step remains
resolving eligible independent data and its provenance, not treating successful
software tests as predictive-performance evidence.

## Additional source and candidate-union evidence

The [source-resolution packet](mglyr-source-resolution-2026-09-08/README.md)
now records the authors' reported Nb20 discovery route from five selected,
licensed preparation/selection Methods paragraphs: llama immunization,
leukocyte VHH library construction, depletion and phage selection, and the
explicit Nb20 expression-vector link. This establishes the reported discovery
route, not a complete parent/variant genealogy or an independence decision.
General assay tags still do not establish the exact deposited cryo-EM reagent.

An official Europe PMC supplementary-files route supplied the 2026 supplement.
Its identity and the conservative extraction result are retained. No preparation
block passed that selector; this does not show that the missing construct facts
are absent from the supplement. The confirmed 2022 PMC attachment still returned
challenge HTML. Exact receptor truncation and Nb20 N-terminal tag/preparation
links therefore remain unresolved.

The [bounded candidate comparison](mglyr-candidate-review-2026-09-08/README.md)
adds 752 VHH source-row comparisons: all 285 frozen candidate profiles plus 467
retained domain calls from six named screen inventories. These represent 239
unique profile computations; one frozen VHH row remains unnumbered. All 6,357
screen rows are accounted for, including 5,968 without a retained domain call.
Those no-call rows do not establish absence of a binder or an overlap edge.

The canonical receptor comparison preserves 290 rows: 287 frozen candidate
rows plus separately retained DP1, proposed M1 and GPR158-family profiles. It
computes 87 unique TM-sequence comparisons and retains 22 unresolved mappings.
The proposed M1 canonical sequence is still not assigned to its deposited
construct. The only threshold-positive comparisons in either arm are the query
family itself. This is a result for the enumerated, hash-bound profile universe;
it is not a formal no-edge ruling, global graph closure, census completeness or
ancestry clearance. Existing prostanoid exclusions are preserved unchanged.

These increments supersede the earlier missing-computation observations for
the named retained candidate profiles. They leave source-level parent/variant
adjudication, exact construct links, unprofiled material, global graph
integration and exposure decisions open. Independent eligible groups added:
**0**; formally cleared independent eligible groups remain **0**.

Continue by verifying both packets, then pursue a legitimately accessible copy
of the confirmed 2022 preparation supplement or another explicit primary
preparation statement. A future safe extraction may inspect named preparation
sections; do not inspect figures, captions, structural results or prohibited
holdout data to fill a construct gap. Preserve the current source and selector
records, and record any later evidence as a separate capture epoch.

## Phrase-only discovery begins; source gaps remain explicit

The first fixed lexical chunk of the saved phrase-only remainder is now
captured: **250 of 12,262 identifiers**, from 10DJ through 1CVF. Ten batches of
25 entries were each requested twice using the unchanged metadata-only GraphQL
query. All 20 responses returned HTTP 200 and agreed after the existing
metadata normalization. All 250 deposited polymer inventories are complete;
449 polymer entities are retained. No identifier or failed response was dropped.
The operational partition is not a biological sample or earlier scientific
preregistration.

The original producer source, collection plan, requests, responses and first
derived snapshot are retained in
[`phrase-only-chunk-000-2026-09-08`](phrase-only-chunk-000-2026-09-08/).
The [reviewed offline finalization](phrase-only-chunk-000-2026-09-08/snapshots/75aa996e3bdf68d433fb062ec9cc3e225b7cc12dc8583929518d9905af60cafe/README.md)
is separately identified; it does not rewrite
the original capture implementation. It distinguishes partial inventories from
complete ones and the number outside this packet from a cumulative multi-packet
count. At this checkpoint, this is the only captured chunk of the saved
phrase-only remainder, leaving **12,012 identifiers outside this captured
chunk**. This is not a whole-census completeness or component bound.

The unchanged all-polymer sequence screen processes 227 distinct present
sequences and retains 41 review rows, including 22 entities needing
missing/noncanonical/engine review. Its one numbered-heavy-domain entry is
1BJ1. The [follow-up triage](phrase-only-1bj1-triage-2026-09-08/README.md)
verifies its complete three-polymer inventory: a 231-residue annotated Fab heavy
chain, 214-residue annotated Fab light chain and 102-residue VEGFA entity. Fresh
exact-DOI/PMID bibliography identifies the same VEGF–humanized-Fab paper. This
supports conventional-Fab context, not a VHH eligibility decision or absence
proof. Primary Methods were not retrieved, so formal disposition remains
pending. The annotation/publication wording difference is retained.

The [Nb35 follow-up](nb35-new-source-routes-2026-09-08/README.md) checked four
genuinely new bibliography/access routes without recovering primary Methods.
It also tested whether a narrower entity-only adjudication was possible from
retained evidence. The available 126-residue computational match is not a
primary-source definition of the complete Nb35 core; therefore it cannot carry
the stronger identity authority used in the Nb32 precedent. The missing link
is a primary complete-sequence/construct mapping or candidate-paper Methods
explicitly identifying the reagent and its role. All 16 entries and 102 polymer
records remain pending and unchanged.

Next: verify the current phrase packet, then collect the next fixed chunk with
`--chunk-index 1` into a new output directory. Aggregate progress by verified
identifier union across packets; do not subtract only the latest chunk from the
original denominator and call that cumulative progress. Inspect new review
signals using preparation/deposition evidence and complete inventories. Preserve
every unresolved screen and all earlier source/exposure records. No native
coordinates, poses, contact tables, labels or real prediction outputs are
authorized by this continuation. Formally cleared independent groups remain
**0**; independent predictive accuracy remains **unmeasured**.

## Phrase-only chunks 001–002 and executable tuple-contract verification

The next two fixed lexical packets are complete and exactly replayable using
the unchanged collector and metadata query:

| Packet | Identifier range | Complete entry inventories | Polymers | Review rows | Missing/noncanonical/engine-review entities |
| --- | --- | ---: | ---: | ---: | ---: |
| [001](phrase-only-chunk-001-2026-09-08/) | 1CVH–1HCA | 250 | 381 | 30 | 13 |
| [002](phrase-only-chunk-002-2026-09-08/) | 1HCI–1MG8 | 250 | 384 | 18 | 12 |

Each packet has 20 successful repeated responses, with no failures, missing
entries, incomplete inventories or disagreements. The new
[three-packet union receipt](phrase-only-union-2026-09-08/README.md) verifies
disjoint membership equal to the first 750 identifiers in the original saved
12,262-identifier remainder. It contains **1,214 polymers**, **89 review rows**
and **47 entities requiring missing/noncanonical/engine review**. The last count
does not mean 47 absent sequences. The **11,512 uncaptured identifiers** refer
only to this fixed membership, not a whole-census bound. This supersedes the
earlier one-packet continuation count without rewriting the original packet.

The two numbered-heavy-domain leads in chunk 001 are 1CZ8_3 and 1G6V_2.
The [1CZ8 triage](phrase-only-1cz8-triage-2026-09-08/README.md) and
[1G6V triage](phrase-only-1g6v-triage-2026-09-08/README.md) bind their complete
five-polymer inventories to fresh exact Crossref and Europe PMC bibliography.
These support conventional-Fab/VEGFA and camel single-domain-antibody CAB-CA05/
carbonic-anhydrase contexts, respectively. Both advertised publisher XML routes
timed out; preparation Methods remain unrecovered. Both formal dispositions
remain pending. These positive contexts do not convert the sequence screen into
eligibility, absence, no-edge or whole-census authority. Chunk 002 has no
numbered-heavy-domain calls; unresolved screens remain in the review records,
and a zero call count does not establish absence.

The [partial prequantized tuple utility](../../paper/PREQUANTIZED_TUPLE_CONTRACT.md)
now tests the seven priorities in the exact frozen scoring contract. It accepts
already-assigned integer bin indices and performs no raw-feature rounding,
current-product score substitution or real-feature export. All engine,
upstream-bin, execution, eligibility and accuracy authorities remain false.
The exact protocol-declared Git commit could not be retrieved by a blob-excluding
Git fetch; the [access receipt](../../paper/evidence/frozen-source-retrieval-2026-09-08/README.md)
does not establish absence elsewhere. Original engine identity and the
scientific rounding convention remain unresolved. The repeated source-header
prose exposure during review is appended to the existing exposure record,
without changing any earlier adjudication or tuning a parameter.

The new [GPR158/Nb20 deposition capture](mglyr-deposition-construct-2026-09-08/README.md)
recovers explicit expression-host metadata for all six polymers in 9VOR/9VOS:
HEK293 for both receptor entities and the RGS7/Gβ5 entities, and the deposited
BL21-Gold(DE3)pLysS AG host label for both Nb20 entities. DOI, PMID and all six
sequences agree with retained metadata. Null fragment/mutation/vector/plasmid
fields are not absence evidence. Source ranges do not establish canonical
truncation or tag cleavage. A new exact-DOI HAL metadata route confirms the cited
2022 preparation article but supplies no requested file URL; no Methods were
recovered through it. Exact cryo-EM receptor and Nb20 construct links remain
open. The packet preserves 15 file hashes, seven request/response bindings and
five prior input identities, without changing eligibility or exposure decisions.

Next discovery work starts at fixed chunk index 3 after checking current
repository and open-PR state. Preserve separate immutable packets and recompute
cumulative progress from their verified identifier union. The software-paper
input-availability and independent-user gates also remain active; additional
metadata exclusions alone cannot complete publication. Formally cleared
independent eligible groups remain **0** and independent predictive accuracy
remains **unmeasured**.

Focused verification for this increment passed **12/12 tests**: eight synthetic
tuple-contract tests and four tests for exact new-packet replay, cumulative
accounting and adversarial duplicate/omitted membership. Independent code and
union-evidence reviews found no material issues. New code/tests pass lint;
source-packet checksums and the seven manuscript claims/14 artifact bindings
verify. Hosted results for the exact pushed revision are recorded in PR #56;
the starting revision's 833-test result is not reused as a later revision's gate.

## Current continuation: packets 004–007 and known Nb20 lineage

PR #56's fourth packet (003) was already complete at starting head `16c46a5`.
This continuation adds four further complete repeated metadata packets, retaining
the collector and every earlier packet unchanged. The
[eight-packet union](phrase-only-union-through-007-2026-09-08/README.md) now covers
exactly **2,000** identifiers and **3,227** polymers, with **274** review rows and
**119** missing/noncanonical/engine-review entities. Exactly **10,262** identifiers
remain uncaptured within the pinned phrase-only membership. No whole-census
bound follows. All 80 new repeated requests succeeded and agreed.

The accompanying triage binds all eleven new heavy-domain leads and their 39
polymers. In particular, 25ST and 25SU contain TAS2R4 and an annotated scFv16;
their deposited citation lacks DOI/PMID. These facts do not establish a direct
GPCR–VHH case or its biological binding role. Preserve their pending format and
source review, the other pending lead dispositions, and every unnumbered or
missingness-review row. The absence of a numbered call is not absence evidence.

The [known-lineage record](mglyr-known-lineage-2026-09-08/README.md) now captures
Nb20* as a reported derivative of Nb20 from the existing licensed construct
paragraph. Source positions are verified against the full source-reported
sequence. A newly accessible public patent corroborates the preparation account
without resolving exact cryo-EM tags or truncation. The relationship is a bounded
documented ancestry fact, not a full global graph/independence decision. The
source-navigation exposure record remains relevant to formal adjudication.

Next fixed discovery batch: **index 8**, after checking current main/PR state.
Continue exact construct-source and original-input availability work only through
permitted routes supplying new evidence. Actual independent researcher completion
and author/archival facts remain human dependencies. Formally cleared independent
eligible groups remain **0**; predictive accuracy remains **unmeasured**. No frozen
scientific policy, source packet, disposition or earlier exposure record changed.
