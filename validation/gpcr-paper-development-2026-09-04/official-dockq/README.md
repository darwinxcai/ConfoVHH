# Official DockQ rescoring of retained developmental GPCR predictions

The run completed **165 of 165 cognate models, with zero scoring failures**:
33 prediction jobs and four deposited reference complexes. These are previously
exposed retrospective examples. Models within a job and repeated jobs for the
same target are not independent biological samples.

| Reference | Models | Jobs |
|---|---:|---:|
| 3P0G | 45 | 9 |
| 4MQS | 30 | 6 |
| 5C1M | 30 | 6 |
| 5JQH | 60 | 12 |

## Files and interpretation

- `official_DockQ.csv` contains official DockQ 2.1.3 scores and components,
  original coordinate SHA-256 values, explicit native-to-model chain maps,
  request hashes, and the preserved `legacy_custom_score`. The legacy column
  is not standard DockQ and remains clearly separated.
- `reviewed_scoring_manifest.csv` is an exact byte copy of the recovered,
  independently reviewed input manifest. Its SHA-256 is pinned in the runner.
- `preflight_ledger.jsonl` and `per_model_ledger.jsonl` bind every model to its
  submitted request, source metric and job rows, coordinate hashes, receptor
  and binder sequence checks, and fixed author-chain mapping.
- `run_provenance.json` records the exact runtime, dependencies, source-module
  pins, installed-distribution fingerprint, script and input hashes, known
  parser limitation, completion status and controls.
- `environment_install_receipt.json`, `requirements-exact.txt`, and
  `installation.log` document installation. The cached source archive was
  actually recovered and its SHA-256 matched the historical source pin;
  all five installed Python/Cython source files matched that archive.
  The locally rebuilt compiled binary is separately fingerprinted.
- `source_controls.json` records native self-comparisons and controls in which
  the binder was translated 100 Angstrom for all four references. All passed.
- `api_cli_crosschecks.json` and `cli_crosschecks/` compare the official API
  against the official CLI for five genuine predictions covering every
  distinct reference/mapping combination. All six numerical components agree
  to a tolerance of 1e-12; contact counts agree exactly. Selection used input
  order and chain maps, not score. This checks invocation consistency, not an
  independent implementation of the DockQ definition.
- `legacy_comparison.json` records every quality-bin change. Zero models cross
  the 0.23 boundary after correction. Seventeen 4MQS models move from the old
  numerical high bin to the official medium bin. The largest absolute score
  change is 0.0820003. Applying bins to the old custom score here is solely a
  comparison of earlier labels, not validation of those labels.
- `execution.log` ends in `OFFICIAL DOCKQ BUILD OK`; the captured process exit
  status was zero. The provenance status is `COMPLETE`.

Official scores classify 75 retained models as incorrect, 15 as acceptable,
70 as medium and 5 as high interface recovery. These classifications concern
agreement with the specified deposited interface. They do not establish
binding affinity, receptor-state selectivity, experimental validity, or
generalization to new receptor/binder systems.

The highlighted 3P0G pre-2011 **seed 1** mean is now 0.268285 (legacy 0.2654).
Raw predictions for that condition's seeds 2 and 3 were not recovered. Their
legacy means of 0.776 and 0.908 cannot be presented as verified official DockQ
results. No missing values were inferred or imputed.

## Exact scoring policy

Genuine model and native files are parsed directly from the original CIF or
gzipped CIF bytes. The official default protein interface/atom definitions and
sequence alignment are used, with `no_align=False` and
`capri_peptide=False`. Chain maps are fixed from the reviewed author-chain
identities; no score-driven chain-map search is performed. Every known DockQ
memoization cache is cleared between models, as in the historical adapter.

5JQH's native VHH uses author chain **C** (label chain D). Native 5C1M contains
modified residue YCM57: the unmodified official protein parser excludes this
HETATM, recognizing 295 receptor residues. The independent sequence review
includes YCM as C and counts 296. That interpretation is limited to sequence
review; no deposited or predicted coordinates were normalized or rewritten.

The runner validates the full cohort before scoring, rejects swapped and
irrelevant-binder controls, detects duplicate identities, verifies hashes and
request/sequence roles, rejects nonfinite values, and exits nonzero on errors.
A per-model failure remains in the flushed ledger and produces a distinctly
named partial CSV. It does not produce a success marker.

## Reproduction

From the repository root, use the exact recorded Python dependencies and the
recovered raw corpus plus independent mapping review. Choose a fresh output
directory; the runner refuses to overwrite a prior run.

```bash
.bench-venv/bin/python scripts/paper/score-cognate-interfaces.py \
  --root /path/to/VERIFY \
  --manifest validation/gpcr-paper-development-2026-09-04/official-dockq/reviewed_scoring_manifest.csv \
  --source validation/gpcr-paper-development-2026-09-04/source \
  --mapping-review validation/gpcr-paper-development-2026-09-04/retained-mapping-review.json \
  --out /path/to/fresh-results
```

Add `--dry-run` for a complete input/runtime preflight without scoring. The
raw coordinates are intentionally external to this result directory.

Nine offline failure-path tests pass:

```bash
python tests/gpcr-paper-dockq.test.py
```

No GPU inference, new predictions, historical benchmark rewrites, or frozen
test modifications were performed by this scorer.
