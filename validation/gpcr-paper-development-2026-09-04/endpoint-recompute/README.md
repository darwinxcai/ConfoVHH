# Retained-coordinate endpoint recomputation

All **355 retained predictions across 71 jobs** reproduce the source TM3–TM6
distance at its published precision of 0.001 Å. This includes all **165 reviewed
cognate predictions** used for official interface rescoring. The other 105 source
rows lack raw predictions and remain unverified.

This is an independent implementation of the declared geometric calculation, not
independent biological validation. It imports neither the supplied analysis script
nor ConfoVHH. Biopython 1.88 parses the original mmCIF atom-site records; Python's
`math.dist` calculates the C-alpha distance. Each predicted receptor sequence must
exactly match one submitted protein, and only one chain may contain both unique
`D[RK]Y` and `[CTS]W[A-Z]P` motifs. The endpoints are the R/K of the first motif and
the residue 16 sequence positions before the second motif's proline. This follows
the supplied endpoint definition and does not independently establish generic
position assignments or the receptor's complete conformational state.

Residue order comes from mmCIF `label_seq_id`. Both selected alpha carbons must
have exactly one conformer. Other residues' alternate conformers do not affect
the measurement. The initial scratch attempt rejected alternate alpha carbons
anywhere in a native structure and stopped at a non-endpoint residue of 5C1M;
that overly broad guard was corrected without changing endpoints or row inclusion.
The failed attempt and subsequent successful scratch execution are preserved in
`../endpoint-recompute-prior-receipts/`.

`per_model.csv` supports an exact join by job, model index, original coordinate
SHA-256 and request SHA-256. `per_model.jsonl` additionally retains the selected
author/label chain identities, residue identities, exact atom coordinates, motifs
and receptor sequence hashes. `reference_measurements.json` records the same
measurement for all six supplied references after checking their source hashes.
`summary.json` binds the executed script, parser, source tables and output bytes.

The portable execution reproduced the scratch CSV, JSONL and reference-measurement
files byte for byte. It did not regenerate predictions or modify any input.

| Reference | Recomputed distance (Å) |
| --- | ---: |
| 3P0G | 14.130493303490859 |
| 5JQH | 8.071600460875151 |
| 4MQS | 13.900153092682110 |
| 5C1M | 12.938588060526543 |
| 3UON | 8.503402260272061 |
| 4DKL | 6.467938234089748 |

To recompute in the recorded Python/Biopython environment, use a fresh output
directory and the recovered raw `VERIFY` directory:

```bash
.bench-venv/bin/python scripts/paper/recompute-gpcr-endpoints.py \
  --root /absolute/path/to/VERIFY \
  --source validation/gpcr-paper-development-2026-09-04/source \
  --manifest validation/gpcr-paper-development-2026-09-04/official-dockq/reviewed_scoring_manifest.csv \
  --out /absolute/path/to/fresh-endpoint-results
```

The script checks the immutable reviewed 165-model manifest digest. It refuses
to overwrite existing output. Endpoint agreement must not be presented as
interface recovery, binding, affinity or complete active/inactive state agreement.
