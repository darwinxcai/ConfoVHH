# Development-only source-gap calibration

This runner implements the gap-selection rule in `round3-control/PROTOCOL.md`, hash `9cf1b2444c67dbaccbe3c8a8c826e980ac4877d790f955d6ab6b9233d03680b5`. It accepts only the **100 fresh development attempts** listed below. It cannot accept the old 995-pose regression panel, prospective target IDs, a split AGTR1 lineage, or another producer/context. No production default changes.

| Set | Seeds | Biological group |
| --- | --- | --- |
| dev_6knm | 0–24 | APLNR-JN241 |
| dev_8qot | 0–24 | OPRM1-NbE |
| dev_8th3 | 0–24 | AGTR1-AT118 |
| dev_8th4 | 0–24 | AGTR1-AT118 |

Attempt IDs must begin with their exact set ID plus `_`; the seed is a separately authenticated integer, not inferred by the runner from a suffix. All 100 rows must be present, even failed attempts. A finite authenticated outcome and complete required selection are necessary to fit; otherwise the runner records an abstention and emits no calibration JSON. Invalid input, no contact and missing optional numbering retain their v3 meanings.

## What is selected

The frozen grid is `[0, 0.002, 0.005, 0.01, 0.02]`. `generate_grid.mjs` calls the actual `rankSourceFirst()` policy at every gap; it does not reimplement source blocks, CDR fallback, validity, or ranks. The Python runner checks that the original saved v3 ranks replay from the bound features. It saves the entire prediction grid and receipt before opening either development outcome file.

For each training subset, maximize the equal-biological-group mean first-choice DockQ gain versus source-only, with equal weights for sets inside a group. A candidate is admissible only when no training set loses acceptable-first-choice probability. Exact source/scientific ties are evaluated uniformly, so this guard compares probabilities rather than choosing a tied ID. Mathematical objective ties favor the smaller gap. The scorer/evaluator uses standard finite JSON scalars; calibration comparisons recompute first-choice expectations as exact rational sums of the decimal representations of those same scalars, avoiding floating-point artifacts in objective ties and the positive-gain gate. No source-rank formula is mirrored.

The entire selection procedure is evaluated in three leave-biological-group-out folds. 8TH3 and 8TH4 are always held out together. A nonzero final gap requires positive pooled held-out equal-group gain, no held-out acceptable-choice loss, and an admissible fit in every fold and in the complete development fit. Otherwise the frozen gap is zero. If even exact-tie reranking has a safety loss, zero is recorded as the prescribed conservative floor, explicitly **not** a claim that exact ties passed the safety rule. All fixed source/validity/exact-tie policies remain available for separate reporting.

This is a **development-selected tolerance, not measured confidence uncertainty**. The output applies only to the exact producer/version/score context in its provenance. It must not transfer to 2+2 multimer source scores or the separate CHRM1 helix context. This development calibration and its leave-group-out diagnostics do not constitute independent confirmation or production promotion.

## Before the 100 fresh development outcomes are available

1. Finish every prespecified generation attempt and preserve each generation receipt, canonical scoring view and transform receipt. A failed attempt is still a planned row.
2. Construct the producer-provenance record below using the canonical coordinate hashes and actual generation receipt digests. Use its binding in the v3 development producer profile before saving v3 ranks.
3. Save uncalibrated v3 development features/ranks with `evaluationRole: development` and `calibration: null`. One combined four-set bundle or up to four nonoverlapping bundles is supported.
4. The separate outcome adapter authenticates reference, canonical-coordinate, generation and outcome artifact identities, then supplies the map and authentication receipt below. The calibration runner trusts that bound attestation for artifact-level authentication and independently checks all IDs, seeds, coordinate hashes, producer/context identities and v3 receipt hashes. It does not reopen native coordinates or recalculate DockQ.
5. Run the command below once all required evidence is available. Freeze the resulting calibration JSON and its complete evidence bundle before prospective scoring/outcome evaluation. An incomplete-evidence abstention is preserved; it does not authorize dropping rows or retrying based on outcomes.

## Bound input contract

A binding is exactly `{ "path": "relative/path.json", "bytes": 123, "sha256": "64 lowercase hex characters" }`. Paths resolve under the execution artifact root and cannot traverse symlinks or leave it. Every listed field is required; unknown/absent fields are rejected by the respective schema checks. Digest placeholders below are schematic and must be replaced with actual hashes.

The runner input contains:

```json
{
  "schema": "confovhh-round3-gap-calibration-input-v1",
  "calibrationId": "round3-boltz2-pair-gap",
  "startedAtUtc": "2026-09-25T00:00:00Z",
  "executionFreeze": { "path": "round3-control/EXECUTION-FREEZE.json", "bytes": 123, "sha256": "..." },
  "producerProvenance": { "path": "round3-ranking/fresh-pair-provenance.json", "bytes": 123, "sha256": "..." },
  "cohorts": [ { "path": "round3-ranking/fresh-v3-development/receipt.json", "bytes": 123, "sha256": "..." } ],
  "outcomeMap": { "path": "round3-ranking/fresh-development-outcomes.json", "bytes": 123, "sha256": "..." },
  "analysisReceipt": { "path": "round3-ranking/fresh-development-outcome-authentication.json", "bytes": 123, "sha256": "..." }
}
```

`startedAtUtc` timestamps the run/grid metadata. The exported calibration's `frozenAtUtc` is generated at completion after fitting; it is not backdated to the supplied start time.

The producer-provenance record is exactly:

```json
{
  "schema": "confovhh-round3-pair-producer-provenance-v1",
  "generatorId": "boltz2-pair",
  "producerVersion": "2.2.1+b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc",
  "scoreContext": "pair-confidence",
  "scoreName": "confidence_score",
  "direction": "higher-better",
  "packageVersion": "2.2.1",
  "sourceCommit": "b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc",
  "modelSha256": "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1",
  "contextRegime": "pair",
  "scientificSettings": {
    "recyclingSteps": 3,
    "samplingSteps": 200,
    "diffusionSamples": 1,
    "stepScale": 1.5,
    "seeds": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    "precision": "bf16-mixed",
    "templates": false,
    "restraints": false,
    "forcePotentials": false
  },
  "generationRunId": "actual-fresh-run-identity",
  "executionFreezeSha256": "...",
  "attempts": [
    { "id": "dev_6knm_seed00", "setId": "dev_6knm", "seed": 0, "generationReceiptSha256": "...", "coordinateSha256": "..." }
  ]
}
```

Supply all 100 attempts. `coordinateSha256` is the **canonical scoring-view coordinate digest** bound in the v3 feature and source manifest. It may be null for a failed/unavailable coordinate; a generation receipt digest is still required. Producer ID, version, context, score name and direction must match every v3 profile exactly. The profile must bind this identical producer-provenance artifact. The pinned package/source/model/settings and fixed pair context cannot be substituted by editing a profile label.

The outcome map is exactly:

```json
{
  "schema": "confovhh-round3-development-outcome-map-v1",
  "evaluationRole": "development",
  "rows": [
    { "id": "dev_6knm_seed00", "setId": "dev_6knm", "seed": 0, "coordinateSha256": "...", "status": "evaluated", "DockQ": 0.5, "reason": "" }
  ]
}
```

Every planned row must occur exactly once. `evaluated` requires finite nonboolean DockQ in [0,1], a coordinate digest and empty reason. `unavailable` requires `DockQ: null` and a nonempty reason. Missing outcomes are never filled with zero or removed.

The separate authentication receipt is exactly:

```json
{
  "schema": "confovhh-round3-development-outcome-authentication-v1",
  "outcomeMapSha256": "...",
  "rankingReceiptSha256": ["..."],
  "producerProvenanceSha256": "...",
  "generationRunId": "actual-fresh-run-identity",
  "coordinateIdentityVerified": true,
  "referenceIdentityVerified": true,
  "outcomeArtifactsVerified": true,
  "rankingSealedBeforeOutcomes": true,
  "rows": [
    { "id": "dev_6knm_seed00", "setId": "dev_6knm", "seed": 0, "coordinateSha256": "...", "referenceSha256": "...", "outcomeArtifactSha256": "..." }
  ]
}
```

Supply the same 100 ID/target/seed/coordinate identities. Evaluated rows require reference and outcome-artifact digests; unavailable rows may use null for either unavailable artifact. The four `true` values are assertions the **outcome adapter must actually establish**, not placeholders to set without verification. This runner validates their type and binds their receipt; it does not recreate their artifact-level checks.

## Run and outputs

From the execution directory:

```sh
python3 round3-ranking/calibration-tools/calibrate.py \
  --input round3-ranking/calibration-input.json \
  --artifacts . \
  --output round3-ranking/fresh-pair-calibration \
  --node /Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

The output directory must not exist. The runner first saves `prediction-request.json`, `prediction-grid.json` and `prediction-grid-receipt.json`, then authenticates development labels and writes `analysis.json` and `analysis-receipt.json`. The latter binds producer provenance, the caller's authentication receipt, the outcome map, all original v3 receipts, the prediction grid, protocol and implementation hashes. If calibration is available, `calibration.json` follows the exact v3 `confovhh-source-gap-freeze-v1` contract and its `evidenceSha256` is the analysis-receipt digest. A final `receipt.json` binds the complete output file inventory without a circular digest dependency.

Statuses:

- `CALIBRATED_NONZERO`: the selected full-development gap passed the complete leave-group-out nonzero gate.
- `FROZEN_ZERO`: the protocol returned the exact-tie floor. Read the reported safety failures and `zeroIsNotASafetyClaim`; zero alone is not positive evidence.
- `ABSTAIN_INCOMPLETE_EVIDENCE`: at least one planned outcome or required source/candidate selection is unavailable. No calibration JSON is created.

For the later report, retain all three folds, training-selected gaps, per-gap admissibility and losses, equal-group gains, all 100 attempts, and full/eligible missingness from the evaluator. Report the selected policy beside the unchanged source, validity and exact-tie arms. Do not describe the fitted tolerance as uncertainty, a confidence calibration, an independent test, or an automatically promoted default.

## Synthetic checks only

```sh
python3 -m unittest discover -s round3-ranking/calibration-tools -p 'test_*.py' -v
```

`synthetic_fixture.mjs` constructs artificial prediction-only feature/score inputs; test labels are generated separately in Python. Tests invoke the actual JS selector and cover minimum-effective tolerance, objective ties, exact tied-choice probabilities, group weighting/holdout, no gain, training and held-out acceptable-choice losses, missing evidence, invalid/no-contact separation, outcome/lineage/context leakage, complete membership, coordinate/authentication tampering, and the final bound output contract. They do not open any actual development or prospective outcomes.
