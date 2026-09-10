# 3P0G current-ConfoVHH development pilot

**Completed result (9 September 2026; analysis 10 September UTC):** all ten
frozen candidates generated and evaluated. ConfoVHH selected `seed2_model_4`
(DockQ 0.1762564824406321); confidence and best available selected
`seed2_model_0` (0.48462880897372757). Independent rank replay passed. The
[complete result and failure analysis](completed-pilot-execution03/README.md)
preserves original predictions, previous failed/not-run attempts and the
negative conclusion. No new GPU generation was used for the analysis.

## Historical preparation and operator reports

The statements below describe earlier preparation states and allowances; they
are retained as history and superseded by the completed result above.

**Later operator report:** an A100 attempt reportedly produced no poses because Triton could not find a system C compiler. The [compiler recovery addendum](COMPILER_RECOVERY.md) and additional JIT check now govern a technical retry. Earlier preparation evidence below is retained; remote failure artifacts and billing still require verification.

**Inputs and reference controls are prepared; generation has not run and the
ConfoVHH/confidence/DockQ comparison is unavailable.** No GPU has been allocated
or charged by this session. The user reports a funded Runpod account, but
authenticated cloud access is not available in this session.

This is one previously exposed development case, not independent validation
or frozen-v3 execution. [Eligibility](../../paper/SINGLE_CASE_PILOT_ELIGIBILITY_2026-09-09.md)
fixes experimental 3P0G assembly 1, receptor A and Nb80 B. Prediction uses the
full deposited A501/B126 sequences, including the receptor fusion and tags,
plus ligand C specified only by CCD identity P0G/BI-167107. It receives no
experimental coordinates, templates, pocket restraints or affinity task.
The substantial unobserved receptor sequence limits reference evaluation.

## Frozen design and verified preparation

[protocol.json](protocol.json) was frozen at commit
local commit `f6360771a9e341643ffbb6f51974bf7bb28eb183`, with SHA-256
`8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9`.
The identical tree is published as commit `7e353c0e7aa3aa0af53249ed655dfd8e087e2c10`.
Local freezing preceded reference inspection; public publication followed
reference controls and preceded any candidate generation.
It binds the current 0.6.0 scoring sources from commit `67fd462`, and remains
unchanged after reference opening. Boltz 2.2.1 will attempt ten candidates:
seeds 1 and 2, five diffusion samples each, pooled as one declared selection
set. Seeds are sampling runs, not independent biological observations.

| Preparation | Actual evidence |
| --- | --- |
| Fresh per-chain MSAs | [Verification](msa/verification.json) confirms exact 501/126-residue queries, matching aligned lengths, archive bytes and pinned parser output; A has 15,222 records and B 12,255, including repeated queries |
| Real Boltz cache | [Independent byte verification](cache/post-download-byte-verification.json) passes for both checkpoints and `mols.tar`: 6,204,362,719 bytes from the pinned revision; safe tar inventory includes P0G; extraction and model loading remain pending |
| Experimental reference | [Retrieval](reference/retrieval.json) binds the original CIF; [preflight](reference/reference-preflight-receipt.json) verifies identity assembly, model 1, author A/B mapping, 284/121 observed residues and 3,211 protein atoms |
| DockQ 2.1.3 controls | Native self ≈1; common translation changes DockQ by <1e-6; VHH +1,000 Å gives DockQ 0.00002736 and fnat 0; native-self API/CLI difference is 0; runtime/source identities are recorded |

These newly captured MSAs satisfy this single case's input requirement. They
do not recover the older missing archive or alter any v3 readiness claim.
The MSA service's exact database revision remains unreported.

The comparison preserves every exact best-tier tie for ConfoVHH and producer
confidence, reporting all IDs and mean/min/max DockQ plus expected success at
DockQ ≥0.23. The maximum available DockQ is a retrospective oracle, not a
deployable selector. Keep every planned attempt and failure; missing audit,
confidence or DockQ for a generated candidate withholds the complete paired
comparison. DockQ evaluates protein A:B; producer confidence covers the whole
A/B/C complex. No confidence interval, significance or general superiority
claim follows from this case. The first successful planned prediction still
requires its own API/CLI DockQ agreement check within 1e-6.

The [execution source freeze](execution-source-freeze.json) binds the generation,
reference and comparison helpers before prediction. [Software verification](software-verification.json)
records 10 comparison tests, 5 mocked generation-accounting tests and 12 runtime-checker
tests passing, plus scoped lint. These are software checks, not pose predictions.
Any `accounting-failed` generated slot must be reconciled before comparison.

## Remaining execution steps

Obtain authenticated cloud access and an actual acceptable quote. The frozen
planning price is $1.59/GPU-hour: two hours would be about $3.18 GPU-only.
Accept at most $2/GPU-hour, two GPU-hours, $4 GPU charge, and a total quoted
session budget of $6. The rough first-session estimate is 45–120 minutes
including setup; this has not been measured on the target GPU.

The cloud controller must enforce the two-hour limit **from allocation**, save
results and stop the Pod. The process runner does not control billing or
terminate cloud resources. Installation, transfer and GPU checks use that same
allocation time. The actual GPU smoke check necessarily occurs after allocation
and must pass before inference; a smoke pass is not kernel/inference validation.

Use the pinned Linux/amd64 PyTorch base image and a fresh isolated Python 3.11
environment installed from the exact bootstrap and dependency hash locks, as
specified in the [runtime installation instructions](../../cloud/boltz-runtime-candidate/README.md#build-and-bounded-runtime-check).
Boltz, Torch/CUDA and optional acceleration kernels have not yet been exercised
on the target GPU. Stop and retain a failed receipt if installation or the
runner's GPU check fails.

The two archives have separate purposes; [input-archives.json](input-archives.json)
records their exact byte counts and hashes:

- `ConfoVHH_3P0G_generation_inputs_20260909.zip` contains only the frozen
  generation manifest, protocol, MSAs and MSA provenance. Unpacking under
  `/workspace` creates `/workspace/generation-inputs`.
- `ConfoVHH_3P0G_input_evidence_20260909.zip` contains local reference and
  provenance evidence, including experimental coordinates. Keep it with the
  evaluation process; do not mount it on the generation Pod.

Transfer the three separately verified cache files to `/workspace/boltz-cache`;
the small archives do not contain their 6.2 GB payload. After the pinned
installation, with the verified checkout at `/workspace/ConfoVHH`, this is the
prepared runner command, **not an executed run**:

```sh
env -u PYTHONPATH -u PYTHONHOME /workspace/confovhh-boltz/bin/python -I \
  /workspace/ConfoVHH/scripts/paper/run-single-case-generation.py \
  --inputs /workspace/generation-inputs \
  --cache /workspace/boltz-cache \
  --python /workspace/confovhh-boltz/bin/python \
  --output /workspace/3p0g-pilot-output
```

The output directory must be new. The runner verifies input/cache bytes,
prepares the chemical cache, checks the actual GPU runtime, and records both
seeds and all ten planned attempts. Preserve raw coordinates, confidence/PAE,
logs, timings and receipts before stopping the Pod. After generation, freeze
the candidate/audit ledgers and execute the prespecified local protein A:B
DockQ comparison, including the remaining candidate API/CLI crosscheck.
