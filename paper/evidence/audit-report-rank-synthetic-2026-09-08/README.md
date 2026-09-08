# Synthetic audit-report-to-comparison replay

This packet exercises the production audit engine on arbitrary generated atom
arrangements from `scripts/paper/reviewer-demo.mjs`, then passes the resulting
single-audit reports through the new report-to-rank bridge and paired evaluator.
These are not protein models, real predictions, reference poses or biological
outcomes. The repeated near fixture deliberately tests scientific ties; it is
not an additional independent case.

`manifest.json` contains the attempt inventory and expected report/source
identities. `reports/` contains the exact generated JSON reports.
`rank-receipt.json` records successful report validation, feature extraction,
source identities and ranks under the complete common audit policy.
`synthetic-outcomes.json` holds arbitrary labels separately.
`comparison-input.json` uses the bridge's `comparisonFields` unchanged;
`comparison-receipt.json` records the executed arithmetic.

The method and baseline both have synthetic expected top-1 success of one half,
so their paired difference is zero. The single synthetic group cannot support a
between-group confidence interval. These numbers establish no scientific
accuracy, calibration, binding prediction or selection advantage.

Replay from the repository root with new output filenames:

```sh
node scripts/paper/export-audit-report-ranks.mjs \
  --input=paper/evidence/audit-report-rank-synthetic-2026-09-08/manifest.json \
  --reports=paper/evidence/audit-report-rank-synthetic-2026-09-08/reports \
  --output=/tmp/confovhh-audit-rank-replay.json
node scripts/paper/compare-paired-selection.mjs \
  --input=paper/evidence/audit-report-rank-synthetic-2026-09-08/comparison-input.json \
  --output=/tmp/confovhh-audit-comparison-replay.json
node --test tests/audit-report-rank-export.test.mjs
```

The test regenerates the source reports from synthetic coordinates, checks the
saved manifest/report/ranker bindings, and independently replays the comparison.
Node version is execution metadata; deterministic result and input hashes are
compared separately. This packet grants no permission to access real reports,
coordinates or reference labels and certifies no eligible independent group.
