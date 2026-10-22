# ConfoVHH paper development evidence

Evidence completed on 5 September 2026. This folder continues the 4 September
GPCR handoff. It is an explicitly retrospective development analysis and does
not enter the frozen hard-decoy v3 evaluation.

## What is now measured

The original handoff contains 460 model records from 92 jobs and 31 conditions.
Three recovered verification archives retain 355 model coordinates from 71
jobs. The original CSV and 92 requests are preserved byte for byte in `source/`.

Of 250 preliminary cognate model records, 165 retain coordinates and pass
reference, request, sequence, and explicit chain-role review. These 165 models
span 33 jobs, 15 conditions, four reference complexes, and three receptor
targets. The remaining 85 preliminary cognate models cannot yet be rescored.
The 60 swapped/irrelevant-binder controls are excluded from cognate DockQ;
150 receptor-only records have no binder interface. Twenty of those
receptor-only coordinates are also missing, giving 105 missing models overall.

All 165 reviewed models have now been scored using unmodified official DockQ
2.1.3 and audited with the unchanged ConfoVHH production implementation. All
355 retained receptor endpoint distances have been independently recomputed.

| Reference | Retained models / jobs | Official DockQ ≥ 0.23 | Median official DockQ | ConfoVHH supported flags | Supported with DockQ < 0.23 |
|---|---:|---:|---:|---:|---:|
| 3P0G | 45 / 9 | 35 | 0.3803 | 1 | 1 |
| 5JQH | 60 / 12 | 0 | 0.0806 | 7 | 7 |
| 4MQS | 30 / 6 | 30 | 0.7679 | 7 | 0 |
| 5C1M | 30 / 6 | 25 | 0.7112 | 0 | 0 |

These are descriptive counts of correlated models, not independent biological
replicates. In particular, eight of the fifteen ConfoVHH `supported` geometry
flags occur below the official DockQ acceptability threshold. A geometry flag
cannot be interpreted as a validated native-pose classification. No weights,
thresholds, or ranking policy were tuned against these results.

The correction from the handoff's nonstandard DockQ-like metric changes no
model's side of the 0.23 boundary. It does change the earlier numerical quality
bin for 17 4MQS models from high to official medium. The legacy metric remains
separately named and must not be used as standard DockQ.

![Every retained paired model, plotted from the measured CSV](paper-evidence/figures/confovhh-native-interface-recovery.png)

## Read these files

- `MANUSCRIPT_SECTIONS.md`: usable methods, results, figure caption, and claim limits.
- `paper-evidence/results/paired-model-metrics.csv`: all 165 joined models, with hashes.
- `paper-evidence/results/per-job-summary.csv`: all 33 five-model jobs; source ranking-score ties are retained.
- `paper-evidence/results/per-condition-summary.csv`: observed seed rosters and means.
- `paper-evidence/results/per-reference-summary.csv`: the table above at full precision.
- `official-dockq/`: official results, controls, exact environment receipt, and failure ledgers.
- `confovhh-audit/`: all production audits, per-job CSVs, methods, and output checksums.
- `endpoint-recompute/`: independent measurements for all 355 retained models and six references.
- `recovered-availability/`: original inventory stage; its conservative `unverified` labels intentionally describe that stage. The reviewed plan and completed scoring/audit receipts supply the subsequent evidence.
- `boltz/`: repaired execution workflow; still blocked pending real pinned inputs and inference.

## Reproduction

Install repository dependencies with `npm ci`. The audited versions are product
0.9.1, geometry engine 0.5.0, ranking policy 0.6.0, and immunum 1.3.0. These are
intentional version layers. Install the exact Python requirements recorded in
`official-dockq/requirements-exact.txt`; compiled DockQ requires a working C/C++
compiler. Raw coordinates remain in the recovered `VERIFY` archive layout.
They are not embedded in the repository.

From the repository root, choose fresh output directories:

```bash
node scripts/paper/gpcr-corpus.mjs \
  --raw=/path/to/VERIFY/runs --out=/fresh/intake

.bench-venv/bin/python -B scripts/paper/score-cognate-interfaces.py \
  --root /path/to/VERIFY \
  --source validation/gpcr-paper-development-2026-09-04/source \
  --manifest validation/gpcr-paper-development-2026-09-04/official-dockq/reviewed_scoring_manifest.csv \
  --mapping-review validation/gpcr-paper-development-2026-09-04/retained-mapping-review.json \
  --out /fresh/official-dockq

node scripts/paper/audit-cognate-predictions.mjs \
  --plan=validation/gpcr-paper-development-2026-09-04/reviewed-cognate-plan.json \
  --data-root=/path/to/VERIFY --out=/fresh/confovhh-audit

.bench-venv/bin/python -B scripts/paper/recompute-gpcr-endpoints.py \
  --root /path/to/VERIFY \
  --source validation/gpcr-paper-development-2026-09-04/source \
  --manifest validation/gpcr-paper-development-2026-09-04/official-dockq/reviewed_scoring_manifest.csv \
  --out /fresh/endpoint-recompute

# Rebuild tables and figure from the completed checked-in result receipts.
# Requires matplotlib; its executed version is in figure-provenance.json.
bash scripts/paper/build-gpcr-paper-evidence.sh /fresh/paper-evidence
```

The final command prints `GPCR PAPER EVIDENCE BUILD OK` only after both table
generation and plotting finish successfully. Require exit status zero and the
final marker. Earlier passing lines cannot certify later steps. Plotting reads
the hash-verified CSV, includes all 165 rows, and inserts no schematic points.

## What remains before a paper can claim more

1. Recover and officially rescore the 85 missing cognate predictions. This
   includes 3P0G pre-2011 seeds 2 and 3: the highlighted legacy means 0.776 and
   0.908 are still unverified. Retained seed 1 has official mean 0.268285.
2. Obtain full per-model PAE/full-data JSON from predictor outputs where possible. All 165 audited models
   currently have confidence summaries only. Summary `chain_pair_pae_min`
   values are not residue PAE matrices.
3. Evaluate ranking on a sufficiently broad, prospectively specified panel
   with receptor/binder family separation and appropriate realistic negatives.
   The separate hard-decoy v3 plan remains blocked; this development corpus
   does not supply independent test components or authorize a freeze.
4. Complete one genuinely pinned Boltz input and inference smoke run before
   scaling the prepared 92-job arm. Cached MSAs, model/checkpoint hashes, and
   actual template mapping evidence are unresolved. Matching template
   accessions and seed integers alone do not establish cross-model parity.
5. Replace the supplied draft's unsupported claim that ConfoVHH had already
   triaged all 460 models. The actual completed application is now 165 models.
   A software paper can describe that application, with the limitations above.
   Public development history and outside-use evidence still need to mature
   before a JOSS submission; no venue acceptance or timetable is established.

## Provenance and preservation

The supplied handoff archive is `GPCR_handoff_bundle.zip`. The recovered raw
inputs came from `GPCR_AI_verification_part1.zip`, `part2.zip`, and `part3.zip`;
the earlier next-steps package supplied the independently reconciled 165-model
manifest. `retained-mapping-review.json` preserves the exact review used by the
official scorer. `reviewed-plan-provenance.json` links the portable plan to the
original reviewed plan. Original and revised endpoint execution receipts are
preserved without presenting failed attempts as successful runs.

No new predictions, GPU inference, prospective holdout results, biological
binding measurements, or changes to production scoring are claimed here.
