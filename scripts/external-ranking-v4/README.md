# Experimental small ranker

This directory owns the round 4 development ranker. No production code or prior receipts are changed. Read `PROTOCOL-DRAFT.md` for the fixed scientific design. All 300 previous round 3 predictions are now development data; the generation agent's incoming 900 runs repeat the same twelve biological cases.

The portable scientific API is `ranker.py`:

- `fit_ridge(rows, labels, groups, family, lambda)` fits a fixed small model using separate labels and within-pool centering.
- `rank(rows, model=None)` accepts prediction rows only. `None` preserves exact source ranking. Scientific ties remain tied.
- `evaluate(rows, labels, groups, ranks)` evaluates saved ranks, preserving all planned attempts and tie expectations.
- `select_setting(...)` performs inner group validation over the frozen grid plus source.
- `nested_validate(...)` evaluates the whole inner selection and fitting procedure on held-out groups.

Prediction rows have an exact field allowlist. Seven numerical features are the only learned inputs; identifiers and biological groups are only membership, weighting and fold metadata. Saved models contain their feature list, scales, coefficients, training identities and supported producer profiles. An unseen producer/model/context/regime falls back to source for the whole pool. No outcome data are needed or accepted by the ranking API.

The command interface is `run.py`; invoke it with the pinned execution-root `.venv/bin/python -B`. Output paths must be new files/directories within this directory. Examples from this directory:

```sh
../.venv/bin/python -B run.py extract-round3 --output development-300
../.venv/bin/python -B run.py labels-round3 --predictions development-300/predictions.json --output development-300/labels.json
../.venv/bin/python -B run.py prepare-release --predictions development-300/predictions.json --labels development-300/labels.json --output fit-release.proposed.json
../.venv/bin/python -B run.py fit --release fit-release.authorized.json --output fit-development-300
../.venv/bin/python -B run.py rank --predictions development-300/predictions.json --output source-ranks.json
../.venv/bin/python -B run.py rank --predictions development-300/predictions.json --model fit-development-300/confidence-model.json --output confidence-ranks.json
../.venv/bin/python -B run.py evaluate --predictions development-300/predictions.json --labels development-300/labels.json --ranks source-ranks.json --output source-evaluation.json
../.venv/bin/python -B -m unittest -v test_ranker.py
```

`prepare-release` writes `authorizeDevelopmentFit:false`. The parent issues the separately named authorized release only after review. Fitting checks the exact code, protocol, qualified grouping, tables, labels, input identities and planned IDs against that release. A failed check stops before training.

`artifacts.py` authenticates the original v3/contact/ranking receipts and raw confidence provenance without outcomes. The separate label importer authenticates the already-completed 300 outcome maps and coordinate identities. Its whitelist cannot open new reserved outcomes. This importer is deliberately specific to the saved round 3 evidence; subsequent development-generation adapters must supply the same strict prediction-row and label-table contracts and receive another release. The pure fit/rank/evaluate API already handles new generation-arm pools without changing feature or model definitions.

Training label incompleteness on a produced candidate refuses fitting/evaluation. Generation failures are different: they remain nonproduced ledger rows with null outcomes and do not poison ranking among produced structures. A missing source score on a produced structure makes source selection unavailable. An optional feature missing anywhere in a produced pool makes that learned arm fall back for the whole pool. No-contact structures stay valid; contact shares are null rather than a fabricated zero.

The two model families have separate nested estimates. Selecting a family after comparing them is exploratory and requires a later frozen reserved evaluation. A gain gate is a practical development screen, not a general significance claim. Source remains the baseline if either evidence or data coverage is insufficient.
