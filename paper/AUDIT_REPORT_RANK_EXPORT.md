# Audit-report-bound current-product evaluation

For a new execution from actual supplied coordinate bytes, use the
[coordinate executor](COORDINATE_RANK_EXECUTION.md). The report-only module
described here retains its original scope and historical receipts.

The evaluator now accepts ranking inputs extracted directly from validated
single-audit report bytes. Previously, the feature adapter accepted supplied
values and a declared report hash without opening that report. This bridge
closes that specific integrity gap. It does not establish prediction accuracy.

## Verified path

`scripts/paper/export-audit-report-ranks.mjs` performs these operations:

1. Snapshot the manifest and report bytes before asynchronous operations.
2. Reconcile every eligible attempt with exactly one report descriptor and file;
   retain failed/ineligible attempts without fabricating reports or scores.
3. Check each report's exact SHA-256, strict UTF-8 JSON, production export schema
   and internal consistency. Match its declared coordinate digest/byte count,
   receptor/VHH chain selection and selected model against the manifest.
4. Require geometry-only auditing, with confidence interpretation off and PAE
   omitted. Require the same complete audit policy across every report,
   including the SASA frame. Mixed source/canonical-frame reports reject.
5. Extract the eight ranking fields from those reports and run the existing
   source-verified current-product rank exporter. Equal scientific keys stay
   tied. A missing producer score makes the paired comparison unavailable.

`comparisonFields` contains the method, baseline, generator inventory, attempts
and rankings to supply to the paired evaluator. Its method identity binds the
complete upstream audit policy, feature-extraction schema, bridge/source hashes
and underlying feature-ranking policy. A change in how audit features were
measured therefore changes the comparison method identity, even if the final
rank transformation is unchanged. The nested `rankExport` retains that original
transformation receipt for inspection; use `comparisonFields` for comparison.

The method is separately named `audit-report-bound-current-product`. It does
not replace the frozen v3 arm, which has different ranking and execution rules.
The scorer and frozen protocols are unchanged.

## Input and replay

The manifest schema is `confovhh-audit-report-rank-input-v1`, containing
`studyId`, `generators`, `attempts` and `reports`. Generator and attempt fields
follow [the current-product adapter](CURRENT_PRODUCT_RANK_EXPORT.md). Each report
descriptor contains `id`, `reportSha256`, `coordinateSha256`, `coordinateBytes`,
`receptorChain`, `vhhChain`, `selectedModelId` and `producerScore`. Features and
outcomes are not accepted in this manifest.

The report directory must contain exactly one regular `<id>.json` file for
each descriptor. No file paths are taken from report contents. Symlinks,
unlisted files, path traversal and output overwrites reject. The current bounded
implementation permits at most 200 reports, 1 MB per report and 64 MB total;
the attempt inventory permits up to 20,000 rows, including failed attempts.

```sh
node scripts/paper/export-audit-report-ranks.mjs \
  --input=AUTHORIZED_MANIFEST.json \
  --reports=AUTHORIZED_REPORT_DIRECTORY \
  --output=NEW_RANK_RECEIPT.json
node --test tests/audit-report-rank-export.test.mjs
```

The [retained synthetic workflow](evidence/audit-report-rank-synthetic-2026-09-08/README.md)
reproduces generated geometry, production audit exports, report verification,
policy-bound ranks and the paired comparison with separately supplied arbitrary
labels. It is software verification only. It does not contain real GPCR–VHH
predictions or demonstrate a ranking advantage.

## Remaining scientific requirements

| Check | What this increment establishes | What remains unverified |
| --- | --- | --- |
| Report integrity | Exact supplied bytes and internally consistent schema | Report authorship and original audit execution |
| Input identity | Report/manifest declarations agree | Actual coordinate bytes and biological chain identity |
| Method identity | Audit policy and ranking transformation are hash-bound | External pre-outcome registration and chronology |
| Baseline | Named score/direction and missingness are retained | Values match original producer artifacts; score semantics are justified |
| Study population | Supplied attempt accounting is exact | Complete prospective inventory, eligibility and independent grouping |
| Predictive validity | No validity claim | Authorized reference outcomes and an independent comparison |

Hashes are integrity checks, not independent scientific witnesses. A consistent
report can still describe the wrong biological chains, an incorrectly generated
model or an exposed case. Source hashes identify current checker/ranker files;
they do not reconstruct the environment that originally generated a report.
Candidate selection, thresholds and policy identities must be fixed before
examining evaluation outcomes. None of the data-access or eligibility gates is
relaxed by this script. Formally cleared independent groups remain zero.
