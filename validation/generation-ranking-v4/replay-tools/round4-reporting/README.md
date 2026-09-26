# Frozen selection and descriptive reserved reporting

These helpers implement the existing `round4-planning/ANALYSIS-DECISIONS.md`.
They do not fit models, generate predictions, compute native quality metrics,
create a final policy or authorize outcome opening. All original scientific
code, features, grids and receipts remain unchanged. Tests use synthetic inputs
only. No new development or reserved quality labels were opened to implement
these helpers.

## Decisions

Normal selection requires the authenticated, complete new900 generation
comparison, the authenticated complete combined1200 join, its separately released
fit and the saved v2 independent fit verification. Generation comparison values,
timing bindings and report bytes are recomputed with the unchanged analyzer.
The combined join is replayed. Saved fit arithmetic, every fold, all planned rows,
ties, missingness and weights are checked by the independent v2 verifier; this
does not run another fit.

Each model family must have nested pair-scope first-choice DockQ gain at least
0.02, no acceptable-first probability loss in any supported pair pool, unchanged
per-pool coverage, and a final model of kind `ridge`. The highest eligible gain
wins; an exact family tie prefers `confidence`. If neither passes, source
confidence remains the operating candidate. This is exploratory family selection,
not an unbiased estimate for the selected family or a production promotion.
The frozen fitter's floating arithmetic determines the ranking gate, without a
new tolerance. The separately frozen generation analyzer retains its exact
rational decision arithmetic.

A **separate incomplete disposition** is available only when the authenticated
combined join reports unavailable generated outcomes. A distinct parent release
must authorize preserving source confidence and give a reason. Every missing
identity and reason is retained. No combined fit is claimed, no learned model
is permitted, and source is explicitly not described as winning a completed
comparison. The normal complete-fit path is unchanged. This exception cannot
select a generation alternative that failed its own frozen gate.

The generation analyzer's selected pair arm is preserved. Baseline selection
requires exactly75 reserved attempts:25 seeds0–24 for each of ADGRV1_RE02,
GPR158_NB20 and MC4R_PN162. A selected broader or msa1024 arm mandates25 additional
ADGRV1 attempts, for100. Other contexts retain baseline. No opt-out, changed
target, extra seed, mixed-arm score pool or omitted attempt is accepted.

## Bindings and releases

Every binding is exactly `{path, bytes, sha256}` with a canonical execution-root
relative path. Symlinks, traversal, duplicate JSON properties, nonfinite JSON,
changed bytes and redirected report members are rejected. Releases are written
and authorized by the parent, never by these helpers. All commands refuse an
existing output directory.

The reporting method is `round4-reporting/REPORTING-FREEZE.json`. It binds exactly
the five source/test/documentation files and pinned scientific dependency freezes.
Authorization and method integrity are checked before reading actual outcome
artifacts. The following release objects have **exactly** the listed fields.

Normal release:

```
schema: confovhh-round4-final-selection-release-v1
evaluationRole: development
authorizeFinalSelection: true
reportingFreeze: binding
generationAnalysisReceipt: binding
combinedJoinReceipt: binding
fitReceipt: binding
fitVerification: binding
```

Separate incomplete disposition release:

```
schema: confovhh-round4-incomplete-selection-release-v1
evaluationRole: development
authorizeIncompleteSourceDisposition: true
reason: nonempty parent explanation
reportingFreeze: binding
generationAnalysisReceipt: binding
combinedJoinReceipt: binding
```

The new900 source and outcome bindings in the generation comparison must equal
those in the combined join. The fit's prediction/label bindings must equal the
combined join outputs; the fit must contain all1200 planned attempts. The
independent verification must reproduce exactly and bind that same fit.

Reserved summary release:

```
schema: confovhh-round4-reserved-summary-release-v1
evaluationRole: reserved
authorizeReservedSummary: true
reportingFreeze: binding
selectionReceipt: binding
finalPolicyFreeze: binding
outcomeReceipt: binding
```

The outcome adapter authenticates the explicit outcome release, prior ranking
seal, source and challenger ranks, fixed model, canonical coordinates, original
generation attempts, enrollment and all fixed native correspondences/aggregates.
The reporter additionally requires the final policy's exact model roster to match
the selection, its plan to preserve the selected generation arm, and its source
and outcome membership to match every planned attempt. Source-only selection
requires no challenger models or rank files. The full-context challenger must
reproduce source scores/ranks/status exactly.

## Commands and outputs

Use the artifact tree's pinned Python environment with NumPy1.26.4 and the frozen
source/contact runtime. Launch with `-I -B` to isolate imports and suppress
bytecode. The scripts derive the artifact root from their own location; supplying
another root while executing code from a live original tree is rejected.

```
PYTHON -I -B round4-reporting/select_final.py select \
  --release round4-reporting/selection-release.authorized.json \
  --output round4-reporting/selection-final

PYTHON -I -B round4-reporting/summarize_reserved.py summarize \
  --release round4-reporting/reserved-summary-release.authorized.json \
  --output round4-reporting/reserved-summary-final
```

The first command accepts either authorized normal or incomplete-release schema.
Selection outputs `selection.json`, `REPORT.md`, `receipt.json`.
Normal receipt schema is `confovhh-round4-final-selection-receipt-v1`, status
`COMPLETE_EXPLORATORY_SELECTION`. The incomplete receipt has distinct schema
`confovhh-round4-incomplete-selection-receipt-v1`, status
`SOURCE_BASELINE_PRESERVED_INCOMPLETE_DEVELOPMENT`; its fit/model bindings are null.
Neither receipt is a final-policy freeze or launch permission.

Reserved summary outputs `summary.json`, `attempts.json`, `POOLS.csv`, `REPORT.md`,
`receipt.json`, with receipt schema `confovhh-round4-reserved-summary-receipt-v1`.
It is `NEEDS_ATTENTION` if a generated candidate's outcome is unavailable;
otherwise `COMPLETE_DESCRIPTIVE_SUMMARY`. Generation failures remain explicit
in either status; completion does not mean every planned attempt produced a
structure. All attempt IDs, original/normalized producer statuses, geometry
status, hashes, timing, rank/tie records and missing reasons remain in the ledger.

Reports retain first/top-five means and acceptable probabilities/counts, best
complete/available DockQ, selected gaps, planned/evaluable acceptable fractions
and missing-outcome bounds. Ties use the frozen analyzer's exact rational weights;
no alphabetical tie breaking. Unknown outcomes are never zero-filled. A known
top-five can be reported if a missing label is outside its entire tie support,
but best-complete gap and complete yield stay unavailable. The actual number of
learned versus source-ranked candidates is retained, so optional-feature or
unsupported-profile fallback does not masquerade as testing the learned policy.

ADGRV1 policy and generation differences are descriptive and kept separate from
GPR158/MC4R context coverage. Matching seed numbers do not establish matched
diffusion noise. No population confidence interval is generated for one learner
group. Metadata/source exposure, uncertain predictor training membership, resolved
reference limitations and case-specific qualifications are included. There is
no general-superiority or production-default claim, regardless of result.

## Standalone read-only replay API

Run these from code inside the extracted archive, with a clean Python process:

```
select_final.verify_selection(root, receipt_binding) -> (selection, receipt)
summarize_reserved.verify_reserved_summary(root, receipt_binding) -> (summary, receipt)
select_final.replay_generation(root, generation_receipt_binding) -> (comparison, receipt)
```

The first API accepts both distinct selection receipt schemas; the saved release
determines which authorized path replays. Both final APIs reauthenticate all
dependencies, cross-bind the evidence, recompute report arithmetic and require
**exact output bytes**, including Markdown and CSV. They create no outputs and
perform no fitting or native DockQ calculation. Cached scientific modules from
another artifact root are rejected. The equivalent CLI is `verify --receipt PATH`.

Archive dependency closure includes the reporting release/freeze, selection
release and receipts, generation analysis release/receipt and its complete source,
outcome, plan and timing evidence, combined join/release and old300 dependencies,
complete-fit/release/verifier evidence when applicable, and all reserved policy,
generation, source/challenger, outcome-release/seal and enrollment dependencies.
A receipt is not a substitute for these transitive payloads.

Synthetic tests: `PYTHON -I -B round4-reporting/test_reporting.py`.
