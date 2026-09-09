# Synthetic current-product rank export and comparison

Four arbitrary audit-feature rows exercise the actual shipped scoring function.
They are not audits of real coordinates. Three supported rows have equal burial;
one mixed row has much larger burial. Scientific method ranks keep the supported
rows tied ahead of the mixed row. Producer scores tie a supported row with the
mixed row. One failed attempt remains in the inventory.

The separate arbitrary outcome labels give expected top-1 success of 2/3 for
the method and 1/2 for the baseline, a difference of 1/6. This is a synthetic
software control, not an accuracy measurement. With only one declared synthetic
group, the evaluator supplies no bootstrap interval. All scientific claim flags
remain false, including compatibility with the frozen v3 arm.

Files:

- `input.json`: outcome-free synthetic feature input and complete attempt ledger.
- `rank-receipt.json`: current-product source/policy identities and scientific ties.
- `synthetic-outcomes.json`: separate arbitrary labels; not read during rank export.
- `comparison-input.json`: the exact exported ranks/identities joined to those labels.
- `comparison-receipt.json`: the paired calculation and its implementation identities.

The declared audit hashes were calculated from JSON-serialized synthetic feature
objects. They do not identify full coordinate audits, and the adapter does not
verify upstream artifact bytes. The receipts attest local transformation/replay
only, not blinded study chronology, source-audit authenticity or independence.

Replay from the repository root, choosing unused output filenames:

```bash
node scripts/paper/export-current-product-ranks.mjs \
  --input=paper/evidence/current-product-rank-synthetic-2026-09-08/input.json \
  --output=/tmp/confovhh-synthetic-current-ranks.json
node scripts/paper/compare-paired-selection.mjs \
  --input=paper/evidence/current-product-rank-synthetic-2026-09-08/comparison-input.json \
  --output=/tmp/confovhh-synthetic-current-comparison.json
node --test tests/current-product-rank-export*.test.mjs
```

The preserved-evidence regression additionally requires the comparison input to
contain exactly the rank-export output and separately retained outcome rows.
