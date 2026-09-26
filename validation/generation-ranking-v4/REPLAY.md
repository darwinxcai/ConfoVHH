# Replaying the generation and ranking study

This document describes the frozen replay method for the completed 900-prediction development experiment, combined 1,200-prediction ranking comparison, and 75-prediction reserved evaluation. The archive identity and actual verification status are recorded separately in `round4-archive-receipt.json` and `round4-archive-verification.json`; this guide alone is not a replay PASS claim. Paths refer to the execution root in the full evidence archive.

The replay reconstructs the reported decisions from saved inputs. It checks source/contact features and rankings, coordinate conservation and fixed residue correspondence, aggregation of saved DockQ values, the 300+900 development join, independent saved-fit arithmetic, and final reports. It makes no new protein predictions, MSA requests, fitting choices or cloud calls. **It does not rerun the numerical production DockQ calculation.** That distinction must remain explicit beside any final PASS claim.

## Evidence packages

The full v4 ZIP preserves every member of the prior v3 payload byte for byte and adds the finite round4 scientific evidence. The prior archive SHA256 is `707e21e7668e8f0e2fced4c594c508a61f0e6d950e2cbcd52988a815ec0999f0`. The new archive is `confovhh-source-first-ranking-v4.zip`. Its manifest and separately generated completion receipt authenticate its final membership and identity. An archive cannot include its own final hash in this report without a circular dependency.

| Evidence | Authoritative record |
| --- | --- |
| Full v4 ZIP byte count and SHA256 | `round4-archive-receipt.json` |
| Completed study, report and method bindings | `ROUND4-FINAL-ARTIFACT-MAP.json` |
| Fresh extraction and replay result | `round4-archive-verification.json` |
| Completed generation comparison | `round4-analysis/new900-analysis/receipt.json` |
| Final selection and reserved summary | `round4-reporting/final-selection/receipt.json`, `round4-reporting/reserved-summary/receipt.json` |
| Receipt-bound figures | `round4-analysis/figures/final-results/receipt.json` |

The completed policy retains baseline generation and original source confidence, with no learned challenger. Both fitted candidate families missed the development improvement gate. The reserved evaluation therefore has exactly 75 baseline attempts and is a source-only evaluation.

The full archive contains exact input protein sequences and captured MSAs, original predictions and confidence/PAE/PDE arrays, attempt receipts, canonical coordinates/maps, fixed references, source/challenger ranks, all metric-view artifacts, grouping/exposure qualification, fitting/fold evidence and negative results. Private credentials/backups, caches, portable environment bundles and redundant transport archives are excluded. Public MSA server replies whose bytes are required for capture verification remain included.

A separate compact repository payload is staged only after the full fresh replay passes. It contains unchanged portable ranker code, reports, scientific design, selected receipts, all reserved attempts and receipt-bound SVGs. Compact nested summaries omit per-pose ranks and repeated inner fitting traces while preserving metrics, weights, comparisons, limitations and outer-fold membership. Its source map identifies every unchanged archive copy and explicit projection. Raw structures, arrays and MSAs remain in the full archive. The compact payload is not a substitute for the complete scientific replay inputs.

## Runtime and identities

The generation source is Boltz commit `b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc`, with confidence-checkpoint SHA256 `090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1`. Exact runtime, source, checkpoint and captured-input identities are retained in the generation/runtime receipts. The learned ranker leaves Boltz inference and weights unchanged.

Replay uses the pinned Python environment, NumPy 1.26.4, DockQ 2.1.3 and the frozen contact runtime, including Node v24.19.0. Installed runtime packages and the Node executable are dependencies supplied by the replay host; the scientific inputs and implementation files come from the extraction. Reusing installed packages is disclosed and is not presented as a fully self-contained container image.

Scientific bindings use an execution-root-relative path, exact byte count and SHA256. Older absolute paths in canonicalizer receipts are provenance text, not a reason to read the old working directory. The bound adapter resolves the actual artifacts inside the supplied extraction. Local hash receipts bind bytes and authorized phase chronology; they are not digital signatures or an independent identity service.

## Verification sequence

The final artifact map must identify the complete 900-attempt development evidence, all 1,200 combined development identities, the actual 75-attempt reserved plan, and the correct complete-fit or explicit incomplete branch. It also binds the old 300 fit/audit, final selection, reserved summary, policy freeze and the two final root reports. Unfinished placeholders, snapshots, wrong denominators, missing phase receipts and mixed cohorts are rejected.

The archive verifier extracts into a new directory. It rejects escaping, duplicate or case-colliding names, symlinks and special entries; checks every manifest member and byte identity; and verifies that all scientific phase bindings point into the extracted payload. It rechecks the credential scan, the narrow format-aware public-MSA provenance exception and the exact reviewed-test exception described below. Hashes are checked again after replay. If the original prior v3 ZIP remains available on the replay host, its members are also directly compared with the preserved historical payload inventory.

The first archive build stopped before ZIP creation because an unchanged independent scanner test deliberately contains an all-A dummy key identifier. A complete scan of 17,894 selected files found no other flagged file. The packaging-only correction accepts that test only at its exact path suffix, byte length and SHA256, after rehashing its actual contents and confirming its sole match is the known dummy. The manifest records this exception separately, and fresh extraction must reproduce the identical exception roster. Altered files, appended credentials and the same contents at another path remain rejected. The original implementation, failed build record, complete diagnostic, 42 archive/isolation controls and four rerun original review controls are preserved in `round4-archive/packaging-correction-20260925/`. Historical independent reviews remain labeled as reviews of the original implementation; the correction received root local code and boundary-test review. Scientific calculations, ranks, policies, outcomes and their implementations are unchanged.

The isolated Python child imports extracted scientific code, runs with a clean environment, and is guarded against reading original scientific artifacts, network access or arbitrary child launches. Its permitted Node child uses native filesystem permissions restricted to the extraction. This prevents accidental fallback to the live working tree; it is not a claim to sandbox arbitrary hostile native extensions.

The scientific checks cover:

1. Every planned generation identity and terminal producer receipt; raw confidence/coordinate hashes; fixed input sequences/roles; canonical atom and coordinate conservation; source ranks and frozen contact evidence.
2. Previously sealed source/challenger rankings, bound references and explicit outcome release; fixed per-protomer correspondence; every prespecified dimer view; the maximum and all tied maximizing reference IDs from saved values.
3. The exact old-300/new-900 join, preserving target, arm, seed batch, producer profile, coordinate identity and missingness. Missing produced outcomes block a complete fit rather than disappearing.
4. Independent saved-model coefficients, training-only scales, group folds, penalty/source choices, scientific ties and metrics. The audit uses unordered pair differences and augmented least squares instead of the fitter's calculation; frozen numerical tolerances apply to this audit, while saved report bytes must match exactly.
5. Generation gate arithmetic, final selection and the reserved summary, including source-only fallback contexts and every attempted case. A separately authorized incomplete source disposition is replayed as incomplete, never as a completed source win.
6. Reserved capture queries, full assembly sequences, captured file hashes and zero coordinate placeholders, with no templates or restraints. No prediction or MSA service call is made.

The initial 300 negative comparison remains separately replayable. The final map binds the genuine v2 independent audit `round4-ranking/fit-development-300-independent-verification-v2.json`; the original fit and older audit remain unchanged and preserved. The combined 1,200 fit also has its own v2 independent audit. The 900 new attempts determine the matched generation comparison; the combined 1,200 determine the main exploratory ranking selection. There are 11 development groups, including eight eligible pair groups. More rows do not create more biological groups. The reserved panel has only one learner-eligible group; its context cases and fallback behavior remain explicit.

## Running the saved verification

Use the frozen verifier from an execution-root copy containing the completed archive and its archive receipt. Supply explicit runtime paths if the host differs. The verifier refuses to overwrite its output receipts/logs, so a second verification needs a fresh work directory containing the same completed inputs.

```sh
PYTHONDONTWRITEBYTECODE=1 /absolute/path/to/pinned/python -B \
  round4-archive/verify_archive.py \
  --artifacts /absolute/path/to/execution-root-copy \
  --python /absolute/path/to/pinned/python \
  --node /absolute/path/to/node
```

The outer verifier uses its sibling `archive_common` module; it starts the scientific replay child with isolated Python internally. This command performs saved-evidence replay, not new outcome evaluation. The expected success record is `round4-archive-verification.json` with status `PASS`, exact archive binding, `originalScientificInputsUsed:false`, and `numericalDockQRecomputed:false` in its replay record. Read the actual counts and disposition from that completed verification receipt; this example command is not a completion claim.

For the compact portable ranker alone, NumPy 1.26.4 is required. Its 23 focused tests use synthetic data:

```sh
python -B -m unittest discover -s scripts/external-ranking-v4 -p test_ranker.py
```

The larger replay helpers require the full bound archive. Synthetic test success checks implementation behavior; it does not reproduce actual study results. The separate prediction-to-prediction diversity diagnostic completed on all 900 structures and 10,800 within-pool comparisons. Its result is `round4-analysis/diversity/development900/receipt.json`; its separately recorded actual replay is under `round4-analysis/diversity/actual-review/`. That replay matched saved outputs byte for byte. This is distinct from the main archive replay and has no role in scientific selection.

## Operations and reporting limits

The worker-B dispatcher recovery retained the original failure log and authorization. It restarted the frozen dispatcher without an unfinished owned prediction, added no planned attempts and retried no failed predictions. This operational event remains visible alongside successful outputs. Worker status snapshots are historical queue observations, not evidence of current process quiescence or sums of independent predictions.

Structural evaluation uses resolved native atoms for the prespecified constructs; the reserved claims are limited to their exact deposited protein constructs. Missing regions remain unassessed; source exposure and uncertain predictor-training membership remain limitations. The preserved source-first policy, whole-pool fallback, missingness and tied selections must survive replay exactly. No result from this small reserved panel authorizes a production-default promotion or a general superiority claim.
