# Round 4 authenticated prediction preparation and released outcomes

The preparation stage reads prediction inputs and outputs only. It authenticates
the complete generation plan, every terminal producer receipt, full sequences of
all input chains, and original coordinates. It reuses the frozen round 3
canonicalizer without editing sequences, coordinates, atom inventories, or context
chains. Declared prediction label chains become receptor R and selected nanobody V;
context atoms remain in the canonical file and are excluded from DockQ.

Every planned attempt remains in the inventory. Failed/interrupted generation is
unavailable; generated geometry that fails the fixed input integrity checks is
retained with its original confidence and raw-coordinate binding. A canonical
coordinate can independently fail optional contact-feature checks without losing
its coordinate identity. Final preparation requires a terminal receipt for every
attempt. Snapshot preparation is explicitly ineligible for outcome evaluation.

The evaluation stage authenticates the saved source ranking through
`round4-ranking/prepare_features.py::verify_source_seal`, including exact ranking
replay and prediction-only contact evidence. Optional saved challenger rankings
are replayed from their bound models. It then seals all planned identities,
coordinates, mappings, rankings and fixed native references before any metric call.
Both development and reserved evaluation require a separate explicit release bound
to this seal and cohort. Reserved evaluation additionally requires a final policy
freeze that binds the generation plan, enrollment and allowed learned models,
dated no later than the first generation start.

DockQ 2.1.3 uses the frozen round 3 per-segment sequence correspondence and metric
functions. The sole format change is Ampere's separately qualified explicit mmCIF
dispatch helper. That helper retained exact full results/correspondences across
all 300 old predictions, with six native self-controls. Each dimer keeps its fixed
prediction nanobody and uses exactly four prespecified native receptor-order / Nb
assignments. All four must evaluate successfully; only then is their maximum used.
Exact ties retain every maximizing reference ID. There is no prediction-side
nanobody selection, missing-loop filling, or native-derived coordinate adjustment.

`verify_evaluation(root, receipt_binding)` returns `(outcome_map, receipt)` after
reopening all bound inputs and artifacts, replaying source rankings and fixed
residue correspondences, and recomputing fixed-view aggregation. Correspondence
replay checks the ordered receptor segments independently of the saved digest;
it does not rerun DockQ. Per-view artifacts preserve raw scalar metrics and all
residue pairs. Missing predictions and metric failures retain a null DockQ with a
nonempty reason; no missing row is dropped.

## Invocation

Run from the execution root using `.venv/bin/python -B`.

```text
round4-outcomes/prepare_predictions.py prepare
  --cohort round4-outcomes/development-cohort.json
  --output round4-outcomes/final-preparation-development
```

After the prediction-only feature adapter creates the final source receipt:

```text
round4-outcomes/outcome_adapter.py request --role development
  --preparation round4-outcomes/final-preparation-development/preparation-receipt.json
  --source-ranking round4-ranking/final-features-development/source-rank-receipt.json
  --references round4-outcomes/reference-inventory.json
  --output round4-outcomes/development-outcome-request.json

round4-outcomes/outcome_adapter.py seal
  --request round4-outcomes/development-outcome-request.json
  --output round4-outcomes/development-ranking-seal.json
```

The parent creates the explicit release only after checking the seal. Then:

```text
round4-outcomes/outcome_adapter.py evaluate
  --seal round4-outcomes/development-ranking-seal.json
  --release round4-outcomes/development-outcome-release.json
  --output round4-outcomes/development-evaluation --workers 4

round4-outcomes/outcome_adapter.py verify
  --receipt round4-outcomes/development-evaluation/receipt.json
```

Reserved requests use `--role reserved`, their separate completed preparation and
source receipts, `--final-policy` and optionally repeated `--challenger-ranks`.
All artifacts use execution-root-relative `{path, bytes, sha256}` bindings.
Absolute paths in old canonicalizer receipts are provenance text; the frozen
authentication adapter resolves artifacts within the supplied execution root.

## Release and result contracts

Release schema `confovhh-round4-outcome-release-v1` has exactly these fields:
`schema`, `evaluationRole` (`development` or `reserved`), `rankingSealSha256`,
`cohortSha256`, `releasedAtUtc` (UTC), `authorizeOutcomeEvaluation: true`.
The ranking seal must precede the release, which must precede evaluation.

Reserved policy schema `confovhh-round4-final-policy-freeze-v1` has exactly:
`schema`, `frozenAtUtc`, `allowedModelBindings`,
`allowedGenerationPlanSha256`, `reservedEnrollment`.
The model list is the exact required challenger roster: omission, addition and
duplicate models are rejected. An unchanged-source decision uses an empty list
and requires no challenger rankings.

Evaluation output contains `outcome-map.json`, one JSON per planned pose under
`artifacts/`, and `receipt.json`. The outcome map schema is
`confovhh-round4-outcome-map-v1`, with `evaluationRole`, bound `cohort`, and `rows`.
Every row has exactly `id`, `setId`, `generationArm`, `seedBatch`, `seed`,
`producerStatus`, `coordinateSha256` (canonical or null), `status`
(`evaluated` or `unavailable`), `DockQ` (finite [0,1] or null), and `reason`.
An evaluated row has an empty reason. A failed generation remains a planned row.
The receipt binds the request, ranking seal, explicit release, full map and all
per-pose artifacts, records implementation identities and disposition counts.

## Controls and limits

The five real initial predictions passed prediction-only preparation while all
900 planned IDs were retained in the snapshot. Ten preparation tests passed.
Twenty-three outcome tests use only synthetic metric controls and reference identity
checks: no new prediction/native outcomes. They cover all 15 fixed reference
target inventories, missing-loop dimers, context exclusion, independent NumPy
metrics, exact four-view maximum/ties, missingness, release/snapshot restrictions,
rehashed cross-protomer correspondence tampering, changed reserved constructs,
exact frozen challenger membership and tampered generation failure reporting.

The first outcome test run used an unnecessarily strict 1e-6 Å RMSD agreement
threshold between independent float-precision implementations. Its largest
reported failure was 2.34e-6 Å. The retained second run uses 1e-5 Å for RMSD and
1e-7 for dimensionless DockQ and passes. This changes only a synthetic test
tolerance, not the scoring method or any scientific selection threshold.

The final 23-test run is retained in `outcome-tests-v6.log`. An actual integration
check authenticated and replayed the five-prediction source/contact evidence, then
correctly refused outcome access because it was a snapshot; its final receipt is
`SMOKE-SNAPSHOT-REFUSAL-V3.json`. Prior test logs and refusal receipts remain as
historical evidence and bind their then-current implementation versions.

The unchanged preparation verifier authenticates failed/interrupted status and
absence of usable coordinates, but does not independently constrain the failure
description or null integrity placeholder. The new outcome preflight closes that
bounded reporting limitation by requiring the exact authenticated producer reason
and `rawInputIntegrity: null` before sealing or evaluation. It cannot change the
generation disposition, ranks, coordinates or numerical metric.

This code does not fit models, select generation settings, or authorize its own
release. Development and reserved interpretation remain separate parent tasks.
