# Experimental source-first ranking v3

This isolated implementation produces prediction-only source-first rankings. It does not change a production default, fit a tolerance, open reference structures, or read calibration outcome evidence. It consumes a hash-bound v1 scoring receipt and independently recovers each original producer score, including a produced candidate whose coordinate scoring failed.

Run with Node 24.19 or a compatible Node version with TypeScript stripping:

```sh
node scripts/external-ranking-v3/score.mjs --input INPUT.json --artifacts ARTIFACT_ROOT --output NEW_DIRECTORY
```

All relative bindings resolve under `ARTIFACT_ROOT`. Output creation is exclusive. The scorer authenticates the v1 manifest, features, attempt ledger, saved ranks and per-pose artifacts; verifies the unchanged original adapter and frozen parser; and replays the v1 ranks for identity verification. No v1 scoring function, v2 formula, or production scorer is edited.

## Policy

Three arms are always saved:

| Arm | Eligibility and order |
| --- | --- |
| `source-only` | Every produced candidate; original source scalar in its declared direction. |
| `source-validity` | Produced candidates with valid prediction-side input integrity; original source scalar. |
| `source-validity-cdr-exact` | Same valid candidates; optional CDR contact share breaks complete exact source-score tie blocks. |

An optional fourth arm, `source-validity-cdr-calibrated`, consumes a separately frozen producer/version/context tolerance. It is a **development-selected tolerance, not measured confidence uncertainty**. A profile without a calibration uses the exact-tie fallback even when other profiles have a calibrated fourth arm. The exact-tie arm is always retained.

Source scores are oriented to larger-is-preferred without scaling. In the calibrated arm, source-sorted blocks are anchored at the highest remaining score: a member must be within the tolerance of that anchor. Nearby-score relationships do not chain. Different blocks retain source order. A multi-member block uses descending `[anchor, P, source]` only when every member has available optional `P`; otherwise every member preserves source order using `[anchor, null, source]`. Equal CDR share preserves source ordering; equal scientific keys remain tied. Candidate IDs only make serialization deterministic.

`P` is the numbered CDR1–3 contact-pair count divided by **all** interface contact pairs, matching the frozen audit. FR1–4, CDR, and unnumbered contact counts and shares are also saved as diagnostics. The latter may contain construct extensions or unassigned residues; the selector does not assert that every unnumbered contact is an extension. No additional component is used to rank.

## Distinct unavailable states

- Corrupt/unparseable or unbound coordinates, duplicate atom identities, inconsistent/absent role chains, conflicting residue identities, nonfinite selected coordinates, or a supplied prediction-sequence mismatch fail validity. Source-only still retains their independent source scores.
- Gross backbone distances are diagnostic only. Numeric adjacency across a canonical virtual receptor-chain join makes no covalent-bond claim and never causes exclusion.
- A valid no-contact pose remains eligible. An all-no-contact set preserves honest source ranking and reports `unsupported-all-no-contact`; numerical selection does not establish a supported binding interface.
- Missing optional numbering, absent audit features, or undefined no-contact CDR share preserve the complete source block's order. They do not remove a candidate or an entire set.
- An absent/invalid source score on any eligible candidate makes that arm's selection unavailable. Partial source ranks remain diagnostic, with no claimed top-k selection. A missing score on a candidate excluded by validity does not poison the remaining valid pool.
- An all-invalid set makes validity-policy selection unavailable. Failed and not-run generation attempts remain in the full ledger but are ineligible in every arm.

## Input contract

Every listed field is required; nullable bindings must be explicit `null`. Unknown fields and outcome-like keys are rejected. A binding is `{ "path": "relative/file", "bytes": 123, "sha256": "64 lowercase hex characters" }`.

```json
{
  "schema": "confovhh-source-first-input-v3",
  "studyId": "same-as-v1-study",
  "evaluationRole": "development",
  "sourceScoreReceipt": { "path": "v1/receipt.json", "bytes": 123, "sha256": "..." },
  "producerProfiles": [
    { "generatorId": "producer", "version": "unknown", "scoreContext": "pair-confidence", "scoreProvenance": null, "calibration": null }
  ],
  "setPolicies": [
    { "setId": "set", "biologicalGroupId": "group", "receptorSequenceSha256": null, "vhhSequenceSha256": null }
  ]
}
```

The snippet is schematic; replace digest placeholders and sizes with authentic bindings. Generator and set membership must exactly match the v1 manifest. Distinct scalar-generation contexts require distinct producer profile IDs. The version may be `unknown` for an uncalibrated historical source; a calibrated profile requires a known version and bound score provenance.

Optional role hashes are SHA-256 of the frozen parser's modeled chain sequence text (no added newline). They must come from prediction inputs/the generated scoring view, never from the held-out reference. A null hash means only role-chain identifiers and presence were checked; numbering does not establish chain biology. A modeled-sequence hash differs from a full polymer sequence when coordinates omit residues.

A calibration JSON has exactly these fields:

```text
schema = confovhh-source-gap-freeze-v1
calibrationId
generatorId
producerVersion
scoreContext
scoreName
direction = higher-better | lower-better
maximumPreferredScoreGap = finite nonnegative number
developmentGroupIds = unique nonempty list
selectionRule = development-selected-tolerance-not-confidence-uncertainty
frozenAtUtc = UTC timestamp
evidenceSha256
```

Producer ID, version, context, score name and direction must match exactly. `sealed-validation` additionally rejects any biological group appearing in calibration development groups. This prevents declared lineage reuse; the orchestration layer remains responsible for constructing truthful biological-group membership and for freezing the actual development selection procedure. Evidence is identified by digest and is not opened by the selector.

## Saved files and evaluation

`receipt.json` binds `manifest.json`, `features.json`, `attempts.json`, `ranks.json`, `blocks.json`, `calibrations.json`, plus byte-identical `source-score-receipt.json`, `source-manifest.json`, `source-features.json`, `source-attempts.json`, and `source-ranks.json`. The receipt includes source receipt/rank identities, implementation hashes, parser lock identity and coverage counts. Coordinate hashes and original score bindings remain attached to each feature. Raw calibration/provenance/coordinate/producer-score artifacts remain at their bound input paths and must be retained in a full replay package.

`evaluate.py` is a pure evaluation helper with no file IO. After a caller authenticates receipts, coordinate hashes, reference identity, and outcome provenance, call:

```python
result = evaluate_record(saved_set_arm, outcomes_by_id, all_planned_ids)
macro = aggregate_groups(all_set_arm_results, set_to_biological_group)
```

The helper verifies full row membership, scientific ties, selection availability and coverage. It reports all-planned, all-produced, all-valid, and policy-eligible pools separately. Top-1/5/10 windows integrate uniformly over scientific boundary ties; excluded rows remain visible in coverage. Missing outcomes retain probability mass and bounds. Unavailable selections have no top-k window. Spearman/AUROC describe only the explicit eligible pool, and missing or abstaining sets/groups are never silently removed from macro means. Labels never recompute features, eligibility or ranks. This helper is not a receipt-authentication or reference-join CLI.

## Checks

```sh
node --test tests/external-ranking.test.mjs tests/external-ranking-v2.test.mjs tests/external-ranking-v3.test.mjs
python3 -m unittest discover -s scripts/external-ranking-v3 -p 'test_*.py' -v
python3 -m unittest discover -s scripts/external-ranking-v2 -p 'test_*.py' -v
```

The v3 tests include an actual frozen-parser/v1-score round trip with a corrupt candidate whose source remains available, complete ties and permutation checks, anchored tolerances, missing-feature fallback, state contradictions, outcome injection, no-contact handling, and exact expected tie windows checked against exhaustive permutations. These are correctness tests, not evidence that v3 improves biological ranking.
