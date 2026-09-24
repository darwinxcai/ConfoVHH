# Reproduce the external-development experiment

The evidence ZIP contains the selected original 395 coordinates, their source scores, both original reference structures, the scoring/reference manifests, the pinned engine (including its small numbering dependency), scripts and recorded outputs. The 1.3 GB all-target Champloo download is omitted; its publisher checksum, file provenance and the exact selected members are retained. Unrelated old task files and memory are not included.

Verify `EVIDENCE_MANIFEST.json` against every listed file before running. Use Node **24.19.0**, Python **3.12.14**, and the exact dependencies in `analysis-requirements-lock.txt`. Run from the extracted top-level directory. Node's scientific dependency is already included with the frozen engine; no application build is needed.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r analysis-requirements-lock.txt
node ConfoVHH/scripts/external-ranking/score.mjs --manifest score-manifest.json --artifacts . --output replay-scores
.venv/bin/python verify_replay.py scores replay-scores replay-verification-new.json
.venv/bin/python verify_geometry.py --root . --out independent_geometry_replay
.venv/bin/python ConfoVHH/scripts/external-ranking/analyze.py --references reference-manifest.json --artifact-root . --output replay-outcomes
```

The reference manifest binds the original sealed score receipt, so the last command validates the original saved rankings. To evaluate a new score execution instead, bind a new reference manifest to that execution's receipt; never replace an old receipt. Complete scientific features and ranks must reproduce; generated report timestamps and derived hashes can differ. The reference stage must report all 395 outcomes and three exact CLI/API crosschecks.

The checked-in `score.mjs` is a development adapter. The two graded formulas remain experimental. This package does not establish independent target performance and does not alter the application's default ranker.

Useful tables: `summary.csv`, `ranked_poses.csv`, `ranked_quality_bands.csv`, `selected_pose_diagnostics.csv`, `published_metric_comparison.csv`, `compatibility_with_handoff.csv`. Read `REPORT.md` for conclusions and the unresolved handoff discrepancies.
