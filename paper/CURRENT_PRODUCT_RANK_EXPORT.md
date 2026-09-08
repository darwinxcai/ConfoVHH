# Current-product rank export for a separate evaluation

Status: implemented and tested using synthetic audit features only. The product
score is unchanged. No native structure, real prediction, biological outcome or
new holdout label was opened. The independent eligible-group count remains zero.

The [policy review](RANK_POLICY_REVIEW_2026-09-08.md) found that the current
shortlist and the frozen v3 benchmark specify different ranking policies.
The latter's historical engine commit could not be retrieved in this check,
and its quantization contract lacks an explicit rounding operation. Those
blockers remain unresolved. This adapter is explicitly **not v3 compatible**.

For authorized single-audit exports, the newer
[audit-report bridge](AUDIT_REPORT_RANK_EXPORT.md) verifies exact report bytes,
extracts the features and binds the upstream audit policy. Use its
`comparisonFields` to retain that complete method identity in an evaluation.
The feature-only API below remains a lower-level transformation with the
limitations stated here.

## What is executed and verified

`scripts/paper/export-current-product-ranks.mjs` imports the actual shipped
`scorePoseRanking` function and requires the exact source hashes of
`lib/pose-ranking.ts` and `lib/pose-evidence-v06.ts` recorded in the review.
It accepts only an attempt inventory, current-product audit feature slices,
declared source-audit hashes and named producer scores with explicit direction.
Its input schema has no outcome field. It fetches no external data.

The product computes evidence tier and unquantized half-DeltaSASA burial.
Null burial sorts last within its own tier; a large burial cannot cross a tier
boundary. The adapter preserves exact tier/burial ties and exports zero-based
dense tiers. IDs order the serialized rows only. This avoids importing the UI's
unique sequential display ranks as if they were scientific distinctions.

Ranking is separate within each target/generator. The baseline uses the declared
raw score direction and preserves equal scores. Within a stratum this supplies
the same ordering as any strictly monotone percentile transform; it does not
calculate percentile values or compare raw scores across generators. Producer
score semantics and direction still require external source justification.

Every eligible attempt must have exactly one feature row. Unknown, duplicate,
excluded or missing feature rows reject. Failed/ineligible attempts remain in
the exported inventory. If even one required producer score is null, method
ranks are retained but the complete paired rankings array is withheld with
`baseline-unavailable`. Empty eligible strata remain explicit in the attempt
inventory and prevent aggregation when passed to the paired evaluator.

The receipt binds exact input bytes and canonical input content, the product
sources, adapter and strict JSON parser. Method and baseline policy identities
also bind their source/configuration and tie rules. Output overwrite, source
drift and duplicate JSON keys reject.

## What is not certified

The adapter verifies the transformation of **supplied features into ranks**.
It does not execute the full coordinate audit, read the named upstream audit
artifact, verify that its declared hash matches real bytes, confirm chain roles,
prove eligibility or component independence, or establish pre-label chronology.
A valid source hash is not proof that the supplied feature values came from that
source. The receipt records these limitations and keeps all such claim flags
false. A future study needs separately verified audit execution and input binding.

The paired evaluator's top-1 result is conditional on eligible candidates.
Failed-attempt accounting is retained separately; it is not a prediction-yield
endpoint. Confidence scores and structural plausibility are not substituted for
reference-pose or experimental outcomes.

## Run against explicitly authorized input

Use a new output filename:

```bash
node scripts/paper/export-current-product-ranks.mjs \
  --input=AUTHORIZED_FEATURES.json --output=NEW_RANK_RECEIPT.json
node --test tests/current-product-rank-export.test.mjs \
  tests/current-product-rank-export-cli.test.mjs
```

For a separately authorized evaluation, use `result.method`, `result.baseline`,
`result.generators`, `result.attempts` and `result.rankings` from a complete export
as the matching fields of the [paired comparison](PAIRED_SELECTION_EVALUATION.md).
Supply the outcome definition and complete outcome table separately. Never
change the rankings after observing those outcomes. This command/document grants
no data-access permission and cannot unlock the v3 benchmark.

The [preserved synthetic example](evidence/current-product-rank-synthetic-2026-09-08/README.md) exercises export and comparison with arbitrary
features and labels. It certifies arithmetic and software integration only;
it does not measure actual ConfoVHH accuracy or add independent groups.
