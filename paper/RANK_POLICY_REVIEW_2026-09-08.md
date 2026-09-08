# Ranking policy review: 2026-09-08

This source and contract review separates the current product ranking from the
frozen hard-decoy v2/v3 benchmark arm. It does not clear a census entry, certify
independence, open a holdout, or establish prediction accuracy. No scoring rule,
frozen input, eligibility rule, or leakage gate is changed by this record.

## Scope and exact identities

The reviewed checkout was `f13e4dd625bbdceb8a4a44c94fa8b7c5bad13137`.
The frozen protocols name ConfoVHH engine commit
`04c6bda2289157dd294c290609f6052aa0ef9195` and tree
`1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9`, executed from a detached clean
worktree with the transitive scientific-source and dependency closure hashed.

| Reviewed artifact | SHA-256 |
| --- | --- |
| `HARD_DECOY_PROTOCOL_V2.md` | `9c38f2d2f7ed2ce4acd5b6730fedd6a37151fe992a808bfefc4268888f862421` |
| `HARD_DECOY_PROTOCOL_V3.md` | `1b7b869fbc777ed794a4397a418fbf92dc4fe58392f75405b5304d5de455b376` |
| `validation/hard-decoy-holdout-v2/prelabel-census/scoring-contract.json` | `88c144fa7708901c910cea2f8ba000352f2d8f4ce0cb07d4084f6e26948b2698` |
| `lib/pose-ranking.ts` | `6f0be122edcf7e6e8a70ea0f562dc0e1aa14dff4adf19b2bf2f67794711d0911` |
| `lib/pose-evidence-v06.ts` | `83bbc4c48c22eadfdf2a8a288a9a46e05315feccba80279915e74b5c469742bc` |

The local `git ls-tree` query for the historical engine commit returned
`fatal: not a tree object`. Separate GitHub contents API requests for
`lib/confovhh.ts` and `lib/pose-ranking.ts` at that exact ref in
`darwinxcai/ConfoVHH` returned HTTP 404, with `No commit found for the ref`.
These are access observations on this date, not proof that the commit or
original source bytes are absent everywhere. No historical engine execution
or source equivalence was established in this review.

## Frozen v2/v3 contract

The contract defines this lexicographic scientific preorder, best first:

| Position | Field | Rule |
| --- | --- | --- |
| 1 | Evidence ordinal | Descending: supported=3, mixed=2, limited=1, not-assessable=0 |
| 2 | Severe-clash residue-pair count | Ascending |
| 3 | Maximum van der Waals overlap | Ascending, quantized to 0.01 angstrom |
| 4 | IMGT numbering availability | Available first |
| 5 | CDR-contact share | Descending; missing follows every available value |
| 6 | Interface residue-pair count | Descending |
| 7 | Total delta-SASA | Descending, quantized to 1 square angstrom |

Identical complete quantized tuples must remain tied. Attempt identifiers,
pose identifiers, and coordinate hashes may order display rows only. The
engine must run with `confidenceMode="none"`, without PAE, pLDDT
interpretation, or ensemble recurrence. Missing/nonfinite required ConfoVHH
output fails the machinery gate. The separate CDR-share baseline declares a
missing-value contrast unavailable rather than imputing it.

The reviewed contract specifies quantization resolutions but does not specify
the rounding operation or halfway rule. No complete executable implementation
of this seven-field tuple was located in the inspected current ranking and
hard-decoy source paths. `scripts/hard-decoy/verify-census.mjs` checks the
contract's field order and exclusion of display identifiers; those checks do
not execute the scientific preorder. These bounded findings do not prove
that an implementation or additional specification cannot be recovered.

Choosing a new rounding convention and presenting it as the recovered frozen
implementation would be unsupported. The original source and complete
quantization specification remain prerequisites for claiming exact execution
of this frozen arm.

## Current product policy and adapter boundary

The public APIs `scorePoseRanking` and `rankPoses` in `lib/pose-ranking.ts`
delegate to `scorePoseEvidenceV06` and `rankPosesWithinTargetV06` in
`lib/pose-evidence-v06.ts`.

| Property | Current product | Frozen v2/v3 arm |
| --- | --- | --- |
| Evidence ordinal | supported=2, mixed=1, limited=0, not-assessable=0 | Four distinct ordinals, as above |
| Secondary ordering | Unquantized half-delta-SASA | Six further fields, including quantized overlap and total delta-SASA |
| Numbering in rank key | No separate numbering/CDR key | Availability and CDR share enter the tuple |
| Equal scientific keys | Product display orders identifiers and assigns sequential positions | Equal full tuples must retain ties |
| Incomplete audit handling | Missing/nonfinite counts normalize to zero; unavailable burial sorts last within its tier | Required missing/nonfinite output fails the machinery gate |

The product also withholds burial below its contact and per-chain interface
residue assessability floors. Current `lib/vhh-numbering.ts` delegates to the
tightened v0.6 numbering implementation. A version string alone is therefore
insufficient to identify the original frozen engine and its dependency closure.

A source-verified adapter for the current product must identify that policy
explicitly and preserve equal tier/burial keys as scientific ties before any
display ordering. Its provenance must state that it is **not compatible with
the frozen v3 arm**. It may prepare label-free rankings for a separately
specified current-product evaluation; it cannot certify candidate eligibility,
independence, pre-label chronology, or predictive performance. It cannot
replace the frozen v3 arm or change the v3 gates.

## Incidental exposure record

An initial text search was broader than intended and returned development
summary snippets. Subsequent named-source inspection also encountered
development results embedded in source comments. The affected paths and
categories are retained below without reproducing result values:

| Path | Material returned |
| --- | --- |
| `validation/dockq-development-pilot-v1/summary.md` | An aggregate development metric row |
| `validation/v0.6-engine-implementation-snapshot-v1/index.json` | Aggregate CDR-share-change counter |
| `validation/v0.6-vhh-numbering-candidate-v1/PROMOTION_2026-09-02.json` | Aggregate CDR-share-change counter |
| `validation/v0.6-vhh-numbering-candidate-v1/postlabel-replay.json` | Aggregate CDR-share-change counters |
| `validation/gpcr-paper-development-2026-09-04/confovhh-audit/audit-summary.json` | A methods-definition string |
| `validation/dockq-development-pilot-v1/summary.json` | Scoring-arm key names only |
| `validation/panel-extension-v1/results.json` | Scoring-arm key names only |
| `lib/pose-ranking.ts` | Development aggregate metrics in source comments |
| `scripts/panel-extension/metrics.mjs` | Development sample-size and replay prose in source comments |
| `lib/pose-evidence-v06.ts` | Development aggregate metrics and specific development-pose geometry/DockQ prose in source comments |
| `lib/vhh-numbering.ts` | Aggregate development comparisons in source comments |

This event is retained, not erased by classifying the files as source code.
It grants no scientific, eligibility, independence, or exposure-adjudication
authority and does not change existing exposure records. No native holdout
coordinate file, real prediction coordinate file, structural contact table, or
per-pose result ledger was opened or executed in this review. The embedded
development-pose result prose is explicitly acknowledged above. No historical
data tests were run. Any formal exposure decision remains a separate required
review under the existing protocol.
