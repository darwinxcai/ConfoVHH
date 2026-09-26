# Fixed new-900 generation comparison

This analyzer implements the parent's frozen `ANALYSIS-DECISIONS.md`. It compares
only the new 900 planned attempts: twelve cases, baseline/broader/msa1024, and
25 seeds (25–49) per case and arm. The old 300 predictions, reserved cases, and
mixed seed batches are rejected. Development exposure remains development
exposure; repeated arms and seeds do not create biological groups.

The primary nine pair cases have eight qualified groups. Means weight biological
groups equally and then targets within each group; the two AGTR1 cases therefore
share a group. Reports retain every target and group difference. Full-panel,
dimer, helix, dimer-without-CASR, and low-resolution exploratory CASR views are
separate. Neither dimer nor helix results influence the pair-only arm decision.

For every pool the output records planned, attempted, generated, failed, not-run,
valid, and evaluable counts; known acceptable count and availability; acceptable
structures per planned attempt; best available/complete quality; original-source
first-choice quality and acceptable probability; top-five expected mean/count;
best-candidate gaps; and known/complete actual per-attempt wall time. Attempted
means generated or failed; not-run attempts remain in the planned denominator.
Recorded wall time is neither GPU-only time nor the elapsed makespan of parallel
workers. Optional pose-diversity calculations are not performed here.

The saved original source ranking is replayed exactly using the frozen ranker.
Invalid produced inputs retain their source score and candidate status. Missing
source confidence on any produced candidate abstains for its entire pool. Tied
score blocks are uniformly averaged, including a tie crossing the fifth rank;
identifiers never break scientific ties. A missing label in a first/top-five
tie support makes that summary unavailable. Missing labels elsewhere stay in
the count and yield bounds, and complete-best/gap stay unavailable. Available
best describes only evaluated candidates. No missing DockQ is assigned zero.

An alternative passes only when its primary equal-group first-choice gain is at
least 0.02, no pair target loses acceptable-first probability, per-target selection
coverage is unchanged, and all generated outcomes in the baseline/alternative
comparison are available. Displaying a partially known selected-block metric
cannot authorize an arm with unresolved outcomes. Among passing arms choose the
largest gain; exact ties prefer broader before msa1024. If neither passes, retain
baseline. Other contexts retain baseline. The result is an exploratory generation
choice, with no production promotion or general-superiority claim.

The parent approved exact rational arithmetic on the serialized decimal DockQ
values, rational tie probabilities, and group/target means before labels. This
avoids floating summation deciding the exact 0.02 or no-loss boundary. Numbers
are converted to ordinary floating JSON values only after the decision. The
uncertainty output is descriptive paired whole-group bootstrap: NumPy PCG64 seed
20260925, 10,000 resamples, 95% percentile bounds with linear quantile interpolation.
Both arms retain the same sampled group indices. No pose or arm is treated as
independent replication. Fewer than two groups or missing relevant group metrics
produces no interval. The exact NumPy version and draw-index hashes are bound.

`analyze_generation.py` exposes a pure synthetic-test API and a separate guarded
command interface. Before opening any new data, the command requires a parent
release and authenticates the exact required method-file roster. It then calls
`prepare_features.verify_source_seal` and `outcome_adapter.verify_evaluation`,
requires a final non-snapshot new900 cohort, and joins every outcome to its exact
ID, target, arm, seed batch, seed, original producer status, and canonical-coordinate
SHA256. Runtime is read only through the preparation inventory's authenticated
`generationReceipt`; the two timing aliases must agree. No metric is recomputed
by this analyzer; the outcome verifier reparses correspondence for authentication.

Parent creates a new JSON release under this directory with exactly:

```json
{
  "schema": "confovhh-round4-generation-analysis-release-v1",
  "evaluationRole": "development",
  "authorizeNewDevelopmentAnalysis": true,
  "analysisFreeze": {"path": "round4-analysis/ANALYZER-FREEZE.json", "bytes": 0, "sha256": "REPLACE_WITH_ACTUAL_BINDING"},
  "sourceRankingReceipt": {"path": "REPLACE_WITH_FINAL_NEW900_SOURCE_RECEIPT", "bytes": 0, "sha256": "REPLACE_WITH_ACTUAL_BINDING"},
  "outcomeReceipt": {"path": "REPLACE_WITH_RELEASED_NEW900_OUTCOME_RECEIPT", "bytes": 0, "sha256": "REPLACE_WITH_ACTUAL_BINDING"},
  "generationPlan": {"path": "round4-generation/bundle/batch-plan.json", "bytes": 0, "sha256": "REPLACE_WITH_ACTUAL_BINDING"},
  "grouping": {"path": "round4-benchmark/development-group-map.json", "bytes": 0, "sha256": "REPLACE_WITH_ACTUAL_BINDING"}
}
```

The illustrative zero sizes/placeholders are not an executable release. Each
binding uses execution-root-relative paths and actual bytes/SHA256. Run only
after parent outcome and analysis authorization:

```sh
PYTHONDONTWRITEBYTECODE=1 execution-20260924/.venv/bin/python execution-20260924/round4-analysis/analyze_generation.py --release execution-20260924/round4-analysis/analysis-release.authorized.json --output execution-20260924/round4-analysis/new900-comparison
```

The output directory must be new. It contains `comparison.json`, a readable
`REPORT.md`, per-attempt timing bindings, and an immutable receipt binding its
inputs and outputs. Tests use only synthetic outcomes and existing input/plan
metadata. No new prediction-quality label was read while implementing or testing
the analyzer.
