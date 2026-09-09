# Prospective selection-set accounting

Status: separate descriptive metric component, verified only with arbitrary
synthetic labels. No prediction, native coordinate, biological outcome or new
performance measurement was opened. The historical paired evaluator, frozen
scores, v3 protocol and exposure decisions are unchanged.

`scripts/paper/compare-selection-sets.mjs` prevents different prediction jobs
from being silently pooled into one candidate set. The unit of selection is
an explicitly declared **selection set**: the candidate pool from which each
ranker selects one pose. The caller must establish that this boundary matches
the intended scientific question. A seed is metadata, not a new target or
independent group.

## Exact input contract

The schema is `confovhh-selection-sets-v1`. JSON objects reject extra or missing
fields and duplicate keys. Identifiers contain 1–80 ASCII letters, numbers,
underscores, dots or hyphens, starting with a letter or number.

| Field | Required content |
| --- | --- |
| `studyId` | Identifier for the separately declared study |
| `positiveOutcomeDefinition` | Nonempty, prespecified binary endpoint definition |
| `method`, `baseline` | Each has `name` and `policySha256`; names differ |
| `targets` | Unique `{id, groupId}` rows; at least one target |
| `generators` | Unique `{id, conditionIds}` rows; each has at least one unique declared condition |
| `selectionSets` | Unique `{id, targetId, generatorId, conditionId, seed, plannedCandidates}` rows |
| `attempts` | Unique `{id, groupId, targetId, generatorId, selectionSetId, status, reason}` rows |
| `rankings` | Unique `{id, methodTier, baselineTier}` rows for eligible attempts |
| `outcomes` | Unique `{id, positive}` rows for eligible attempts; `positive` is exactly numeric 0 or 1 |

`seed` is either an unsigned 32-bit integer or `null` when not applicable.
Repeated seeds do not change grouping. `plannedCandidates` is a positive integer
and declares the number of candidate attempts expected for that selection set.
An attempt ID identifies a planned candidate attempt, including an attempt that
produced no coordinate file. Repeated identifiers, mismatched membership and
more recorded attempts than planned reject. Group membership comes exclusively
from `targets`, and every attempt must agree with that inventory.

This version deliberately requires a **fully crossed declared design**: every
target must have every declared generator and every condition declared for that
generator. Conditions may differ between generators. A missing cell remains in
the report and blocks the aggregate. A noncrossed scientific design needs its
own explicit schema and weighting contract; do not disguise missing cells by
changing target identities or pooling jobs.

The supported limits are 1,000 targets in 200 groups, eight generators, eight
conditions per generator, 10,000 selection sets, and 20,000 planned candidate
attempts overall. Empty selection-set or attempt tables produce incomplete
accounting rather than a fabricated success rate. Complete removal of targets,
conditions, sets or candidate IDs from an unfrozen input cannot be independently
detected here: an external immutable manifest is still required.

## Endpoint and weights

For each eligible common pool, lower integer rank tiers are better. If the best
tied tier contains `m` candidates and `s` have positive outcomes, expected top-1
success is `s/m`. The entire tie is preserved. This assumes uniform choice within
the tier; neither candidate names nor a favorable candidate break the tie.

The primary descriptive comparison averages:

1. Selection sets equally within a target–generator–condition cell.
2. Declared conditions equally within each target–generator pair.
3. Generators equally within each target.
4. Targets equally within each declared group.
5. Groups equally overall.

Thus adding seeds in a condition does not give that condition more weight, and
adding candidate poses does not give their selection set more weight. The report
records each set's implied `primaryWeight` and the complete aggregation hierarchy.
More seeds can change the estimated effect within a condition; they cannot
increase the declared target or group count. Group declarations themselves do
not prove independence.

All-positive and all-negative sets remain in the primary comparison, each with
paired difference zero. `mixedSecondary` is explicitly conditional: restrict to
sets containing both outcomes, preserve their original primary weights, then
normalize by their total weight. Do not reweight each surviving group equally
after filtering. The report includes retained IDs, their count, represented
group count and `primaryWeightFraction`. For a complete comparison, the primary
paired difference equals the mixed subset's conditional difference multiplied
by that weight fraction, up to floating-point rounding. If no set is mixed, the
secondary comparison is unavailable and the complete primary difference is zero.

## Missingness and failure

An `eligible` attempt requires an empty reason, both rank tiers and a known binary
outcome. `failed` and `ineligible` attempts require a nonempty reason and must
not enter ranks or outcomes. Full attempt IDs, membership, status and reason
are retained in `attemptAccounting`.

Fewer recorded attempts than planned produces `incomplete-attempt-inventory`;
it does not permit ranking the incomplete set. A fully recorded set with no
eligible candidates produces `no-eligible-candidates`. Either case, or a missing
target–generator–condition cell, blocks both primary and secondary aggregates.
Known eligible outcomes remain mandatory even in an otherwise incomplete input.

When some attempts fail but a fully recorded set retains eligible candidates,
success is conditional on that eligible common pool. Failures are counted but
not assigned negative recovery labels. **This component does not estimate
scheduled-job yield.** That endpoint needs a separate prespecified failure policy.
An unknown outcome is never converted to zero. Eligibility and exclusion rules
must be fixed independently of observed success; this tool cannot certify that.

## Use and limits

```bash
node --test tests/selection-set-comparison.test.mjs
node scripts/paper/compare-selection-sets.mjs \
  --input=AUTHORIZED_PROSPECTIVE_INPUT.json \
  --output=/tmp/NEW_SELECTION_SET_RECEIPT.json
```

The executable hashes exact input bytes, evaluator source and strict JSON parser
source, records the Node version and refuses output overwrite. It does not
generate predictions, calculate ranking features, verify rank-policy execution,
derive native-pose labels, fetch data, certify exposure, authorize label access,
or establish prior registration. No uncertainty interval, power estimate,
superiority decision or scheduled-job yield is reported.

The tests demonstrate a concrete case in which pooling two jobs changes a
paired comparison; fixed hierarchy weights; full ties;
retained failures and nonmixed sets; and rejection of unknown outcomes and
inconsistent inventories. These are arithmetic and accounting controls, not
evidence that ConfoVHH outperforms predictor confidence. Historical studies must
continue to use their own frozen protocol and evaluator.
