# Compact round4 publication staging

This helper creates a new local review directory only after the full scientific
archive passes fresh-extraction verification. It never changes the ConfoVHH
checkout, Git state, GitHub, cloud resources, scientific inputs, scores or models.

Run from the execution root, after final archive verification:

```sh
.venv/bin/python round4-archive/publication/build_publication.py
```

The default output is the new `round4-publication-stage/` directory. An alternate
new root-level `round4-publication-stage-<suffix>/` is accepted. Existing outputs
are never replaced. Interrupted staging is retained and has no completion receipt.

`files/` contains only the proposed repository additions. `tree-elements.json`
contains UTF-8 GitHub tree entries, `index.json` binds each byte and Git blob SHA,
and `receipt.json` says `STAGED_ONLY`. The proposed parent head is metadata; the
parent agent must independently verify it before any later publication action.

Authentication reopens the archive, its manifest and its fresh replay receipt,
requires the pinned archive verifier and implementation freeze, and checks the
complete development/reserved replay scope. Publication code must itself be an
exact manifest member. Scientific sources are copied from the fresh extracted
tree, not the live scientific tree. Every copied source is checked again before
tree construction. Final archive and verification receipts are separately marked
post-archive evidence because they cannot be inside the archive they identify.

The compact package includes unchanged ranker code, dependencies, README and
synthetic tests under `scripts/external-ranking-v4`; reports and scientific design
under `validation/generation-ranking-v4`; the initial300 and combined1200 results
(including negative results or an explicit incomplete source-only disposition);
reserved attempts, exposure/construct qualification, receipt-bound SVG displays,
and unchanged replay helper copies. It keeps pool metrics, weights, comparisons,
limitations and outer-fold membership in compact nested summaries, while omitting
per-pose ranks and repeated inner-fit model traces from those projections. Their
exact originals remain in the complete archive. All projections are declared in
`PUBLICATION-SOURCE-MAP.json` with original bindings and a precise operation.

Raw coordinate files, native structures, MSA data, prediction arrays, model weights,
private credentials/backups, cloud infrastructure records, transport archives,
PNG/PDF figures and caches are not in this compact payload. A strict credential
scan has no sequence exception because MSA data are not selected. Any suspicious
compact metadata is rejected without printing its content. Each file is limited
to 4 MiB and the complete payload to 32 MiB; a failed budget requires an explicit
new method revision rather than silent file omission.

The full replay authenticates saved numerical DockQ values and recomputes fixed
correspondence and metric-view aggregation; it does not call production DockQ.
There is only one reserved learner-eligible biological group. This publication
does not establish broad independent generalization or promote production defaults.

Tests use synthetic archive/receipt/result fixtures and unchanged ranker code.
They do not open actual new scientific outcomes or private backups.

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover \
  -s round4-archive/publication -p test_publication.py -v
```
