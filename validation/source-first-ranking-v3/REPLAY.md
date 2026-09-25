# Round 3 evidence and replay

This is a finite experimental evaluation of source-first ranking, contact-feature recovery, candidate generation and a separate membrane proxy. Production defaults were not changed. Read `REPORT-V3.md` for results and `round3-control/PROTOCOL.md` for the prespecified design. The original 995-pose panel is development-exposed regression evidence; the 300 new predictions comprise 100 development and 200 prospective attempts. Only two prospective biological groups are newly outcome-tested, and their prior metadata exposure is disclosed.

## Preserved artifacts

The round3 ZIP combines the byte-verified complete v2 archive with the round3 experiment. Its `ROUND3_EVIDENCE_MANIFEST.json` lists the size and SHA256 of every payload file. The separate `round3-archive-receipt.json` binds the final archive. Raw prediction coordinates, confidence values, arrays and logs are under `round3-predictions/raw/results/`; exact canonical views and identity maps are under `round3-predictions/scoring-views/`. Completed cloud metadata snapshots preserve the fixed sequence inputs, retrieved sequence alignments, preprocessing and runtime provenance. Every planned attempt remains represented.

Private SSH keys, host connection files, unrelated account resources, Python caches, redundant raw transfer archives and the portable Python environment are excluded. The separate portable runtime is retained locally and bound by its recovery receipts. Any additional complete cloud-volume backup is kept in a private directory outside the scientific archive and GitHub publication.

## Runtime

The original analysis used Python 3.12, Node 24.19.0, DockQ 2.1.3, Biopython 1.88, NumPy 1.26.4 and the remaining pinned packages in `round3-control/analysis-requirements-lock.txt`. The frozen ranking engine and its locked numbering dependency are included in the historical payload. No downloaded model weights are needed to replay saved rankings and evaluations.

The outcome seal binds the exact DockQ implementation, including its compiled macOS extension. The verified extraction replay reuses the installed pinned runtime while reading all scientific inputs from the new extraction. Installing the same version numbers on another platform does not establish byte-identical implementation identity; such a rerun needs a separately recorded runtime and evaluation receipt. Plain archive file-hash verification is platform independent.

## Verified extraction replay

Place the archive and `round3-archive-receipt.json` in the execution directory alongside the verifier and the pinned analysis environment. The verifier extracts into a new directory named `execution-20260924`, checks every archived and extracted file hash, authenticates both final outcome bundles, replays saved ranking/contact evidence, recomputes the reports from saved outcomes and requires every numerical report file to match exactly. It runs in isolation and denies reads of original scientific artifacts. It does not rerun GPU prediction or fit a new ranking policy.

```sh
.venv/bin/python round3-control/verify_round3_archive.py --artifacts .
```

Use its `--python` and `--node` options when the pinned executables have different paths. `round3-archive-verification.json` records the actual verification result and extraction location. Creating that file is not itself proof: its pass assertions are written only after all checks finish.

## Individual stages

The final ranking directories are `round3-ranking/fresh-v3-development` and `round3-ranking/fresh-v3-prospective`. Their receipts bind all saved features, original source scores, scientific ties, contact-only evidence and ranks. The original physical scorer remains a separately reported comparator and keeps its original limits.

The outcome adapter in `round3-benchmark/outcome-tools/` validates all coordinate and chain-role identities. For the two receptor dimers it fixes the selected predicted nanobody, aligns receptor copies separately and evaluates all four prespecified equivalent native assignments. A failed required assignment makes the whole outcome unavailable. Native coordinates never enter generation or ranking.

```sh
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py verify \
  --artifacts . --receipt round3-ranking/fresh-outcomes-development/receipt.json
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py verify \
  --artifacts . --receipt round3-ranking/fresh-outcomes-prospective/receipt.json
```

The development-only calibration is preserved under `round3-ranking/fresh-pair-calibration/`. It uses the five prespecified gap candidates and three biological-group holdouts, with both AGTR1 cases kept together. The final gap is zero. All four nonzero candidates reduced the group-weighted mean quality of the first development choice. This is a negative result for overriding confidence with the contact share; it is not an estimate of confidence uncertainty. Prospective outcomes were not used to choose the gap.

Final reports are under `round3-ranking/fresh-evaluation-{development,prospective}`. They retain missingness, uniform tie expectations, fixed biological-group strata, candidate availability and the unchanged physical comparator. `round3-control/REPORTING-TIE-CLARIFICATION.json` defines acceptable-choice changes as marginal probability changes, without inventing independently drawn tie losses or rescues.

Historical regressions are under `round3-ranking/regression-final-*`; all 995 earlier poses retain their prior ranks, ties and features. The separate membrane results, source and negative cases are under `round3-membrane/`. Neither negative results nor unavailable frames are dropped from the archive.
