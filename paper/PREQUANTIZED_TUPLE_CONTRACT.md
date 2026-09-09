# Partial prequantized tuple contract utility

`scripts/hard-decoy-v3/prequantized-tuple-contract.mjs` implements only the
seven-field ordering in the unchanged frozen scoring contract. It loads that
contract with exact SHA-256
`88c144fa7708901c910cea2f8ba000352f2d8f4ce0cb07d4084f6e26948b2698` before
exposing its comparator. This closes a gap between checking the written field
order and testing its executable lexicographic behavior.

It does **not** implement the frozen engine or establish an executable frozen
benchmark arm. Engine identity, execution environment, complete scientific
dependency closure and the original quantization convention remain unresolved.
No frozen protocol, configuration, scoring policy or input is changed.

## Input representation

Each tuple contains exactly these fields, in priority order:

| Input | Ordering and representation |
| --- | --- |
| `evidenceBandOrdinal` | Integer 0–3, higher first; original contract ordinals |
| `severeClashResiduePairCount` | Nonnegative safe integer, lower first |
| `maximumVdwOverlapBin` | Supplied safe integer index in 0.01 Å units, lower first |
| `imgtNumberingAvailable` | Boolean, true first |
| `cdrContactShare` | Finite fraction 0–1, higher first; null after every available fraction, including zero |
| `interfaceResiduePairCount` | Nonnegative safe integer, higher first |
| `deltaSasaBin` | Supplied safe integer index in 1 Å² units, higher first |

An overlap bin of 120 represents an already-quantized value of 1.20 Å; a ΔSASA
bin of 1000 represents an already-quantized value of 1000 Å². The utility never
derives an index from a raw measurement, rounds a number, selects a halfway rule,
or verifies the caller's bin assignment. Integer bins are signed to avoid adding
an unstated physical-value eligibility rule. This representation does not certify
that any signed value could be emitted by the original engine.

Numbering availability and CDR share remain separate supplied fields. The
utility does not derive or impute one from the other, or certify their upstream
consistency. Missing required fields, extra fields, nonfinite values, unsafe
integer counts/bins and accessor properties fail validation. Null is permitted
only for the explicitly missing CDR share. Display identifiers and coordinate
hashes are not accepted as tuple fields.

`compareTuples(left, right)` returns -1 if the left tuple precedes the right,
1 if it follows, and 0 for identical complete tuples. A return value of zero
must remain a scientific tie; an application must not convert display positions
into unique scientific ranks. CDR fractions are compared as supplied without an
invented tolerance. The module has no target or generator context and does not
enforce within-target grouping; callers remain responsible for choosing an
authorized population.

## Scope and unresolved provenance

`loadPrequantizedTupleContract()` returns immutable contract metadata and the
validation/comparison functions. Its status is
`PARTIAL_PREQUANTIZED_CONTRACT_UTILITY`. The returned boundary explicitly sets
`frozenEngineVerified`, `rawFeatureQuantizationImplemented`,
`upstreamBinAssignmentVerified`, `executionPermitted`, `eligibilityVerified`,
`independentGroupsVerified` and `predictiveAccuracyEstablished` to false.

The declared engine commit/tree identify the frozen requirement only. They do
not attest to recovered executable bytes. The module imports no current-product
scorer, reads no coordinate, contact table, real feature report or outcome, and
provides no real-feature rank export or benchmark authorization path. It must
not substitute for the frozen arm.

Source review found that the retained historical `lib/confovhh.ts` object
`15f25a465e0c357a7a59c0e0d57b4e50aad76f16647dc02ab835613c33a51edf`
returns full-precision `maximumOverlapAngstrom` and `deltaSasaAngstrom2`.
Its decimal formatting occurs in display strings. Display formatting cannot
establish the missing scientific quantization operation, and this source subset
has not been established as identical to the frozen engine commit/tree. See
[the existing policy review](RANK_POLICY_REVIEW_2026-09-08.md).

## Synthetic verification

Run:

```sh
node --test tests/hard-decoy-v3-prequantized-tuple-contract.test.mjs
```

The tests exercise exact contract identity, each lexicographic priority against
adverse later fields, CDR missingness, complete ties, external identifier and
input-order invariance, discrete bins, complete input validation and exhaustive
order-law checks over synthetic tuples. No scientific performance or biological
claim follows from these tests. Independent eligible-group count and measured
predictive accuracy are unchanged.
