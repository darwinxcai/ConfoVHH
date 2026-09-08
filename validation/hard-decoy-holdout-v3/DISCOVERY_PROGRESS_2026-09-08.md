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
