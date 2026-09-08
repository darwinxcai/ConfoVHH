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
