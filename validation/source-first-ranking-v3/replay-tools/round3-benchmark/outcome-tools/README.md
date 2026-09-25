# Round3 authenticated DockQ outcomes

This adapter prepares and authenticates evaluation data for the frozen round3
benchmark. It does not generate models or change ranking. New prospective
prediction/native comparisons require a separate root-issued release after the
rank seal. Smoke preparations cannot be sealed for evaluation.

The exact reference inventory is `reference-inventory.json`, SHA-256
`a7b197c0393462809792f9cf00eef01231c32932d5c53b07f0c9375c30e796b0`.
It contains 4 exact AF2IG processed development references and 14 views for the 8
prospective targets. The two dimers each have 4 views; the other targets each have
one. Development reference preparation used the original files listed by
`expansion-v2/af2ig-reference-inventory.json`, retaining every atom, coordinate
token, residue identity and original sequence order. Only identifiers change in
the canonical views. Context chains remain in each file.

## Correspondence and metric

DockQ 2.1.3 is required. Its unchanged `calc_DockQ` computes the final metric on the
R/V interface. Only R and V enter the metric; X context chains do not. The selected
prediction Nb never changes between reference views.

Default DockQ globally aligns a concatenated receptor sequence and therefore does
not guarantee correspondence across the join between identical receptor copies.
The adapter independently replays the canonicalizer, then uses its authenticated
original-chain segments to establish the fixed protomer correspondence. It aligns
each corresponding receptor segment separately with DockQ's default sequence
parameters: match 5, mismatch 0, gap open -4, gap extend -0.5, first optimal
alignment returned by pinned Biopython 1.88. VHH alignment is separate. Exactly
matching aligned residues are retained, following DockQ's behavior. Segment
alignments are concatenated only after their residue correspondences are fixed.
No pair can cross a protomer boundary, and residue use is one-to-one.

Canonical files retain original atom-row order even when native receptor order is
permuted. The adapter therefore reorders only in-memory residue traversal into
the prescribed segment order before invoking DockQ. It checks that every parsed
atom identity and coordinate remains unchanged. No coordinate fitting precedes
evaluation; DockQ's ordinary receptor/interface superpositions are metric steps.

Every result retains its per-segment alignment strings and full residue-pair
correspondence plus a digest. Every dimer pose must finish all four prespecified
native assignments. The reported DockQ is their maximum; all maximizing reference
IDs are retained on exact ties. Any failed view makes that pose unavailable;
partial-reference maxima are prohibited. Worker limits are fixed at 600 seconds
per view. Failures retain their reason and all planned membership.

## Input

All bindings have exactly `{path, bytes, sha256}`, with paths relative to the
execution root. A request has these exact fields:

```json
{
  "schema": "confovhh-round3-outcome-input-v1",
  "evaluationRole": "development",
  "executionFreeze": {"path": "round3-control/EXECUTION-FREEZE.json", "bytes": 0, "sha256": "REPLACE"},
  "batchPlan": {"path": "round3-cloud/launch-bundle/batch-plan.json", "bytes": 0, "sha256": "REPLACE"},
  "producerProvenance": {"path": "PREPARATION/producer-provenance-boltz2-pair.json", "bytes": 0, "sha256": "REPLACE"},
  "rankingReceipts": [{"path": "RANKING/receipt.json", "bytes": 0, "sha256": "REPLACE"}],
  "predictionViews": {"path": "PREPARATION/prediction-view-inventory.json", "bytes": 0, "sha256": "REPLACE"},
  "referenceInventory": {"path": "round3-benchmark/outcome-tools/reference-inventory.json", "bytes": 15202, "sha256": "a7b197c0393462809792f9cf00eef01231c32932d5c53b07f0c9375c30e796b0"}
}
```

Zero sizes and `REPLACE` are documentation placeholders and are rejected. For
`prospective`, `producerProvenance` is an ordered list of the pair, dimer and helix
bindings. Their attempts must partition all 200 seeds. Development uses the
single pair provenance with all 100 seeds, matching the calibration contract.
The v3 ranking receipt's role is `development` for development and
`sealed-validation` for prospective. Every target retains seeds 0–24 and exact
`<setId>_seedNN` identifiers.

The prediction inventory supplied by preparation has schema
`confovhh-round3-prediction-view-inventory-v1`, fields `cohort`, `smoke`, and rows
`{id,setId,seed,viewReceipt,unavailableReason}`. Canonical view receipts bind raw
source, view and full mapping. Prediction roles use the **label** namespace;
native roles use the **author** namespace. Independent canonicalizer replay
checks the expected original chain IDs, resolved roles, every segment/residue/map
entry, and byte-exact canonical output. Merely relabeling a receipt for an
identical alternative Nb fails.

Receipt absolute paths are provenance text. During relocated archive replay,
the suffix after the unique `execution-20260924` component is mapped into the
current root. Every actual file is then reopened through a safe root-relative
path, with hashes checked. No original live workspace file is required and no
receipt is rewritten. Symbolic links, path escapes, altered bytes, duplicate JSON
keys and nonfinite JSON numbers fail validation.

## Commands

Node is also required for exact contact-evidence and saved-rank authentication.
The adapter uses `CONFOVHH_NODE_BINARY` when set, then Node on PATH, then the
bundled desktop Node executable. Set that variable explicitly on another host.
It calls the prediction-only `verify-contact-evidence.mjs` helper, which validates
all 12 saved v3 files, checks the frozen contact method and original audit-failure
provenance, recomputes each standalone contact report from its bound coordinates,
and reproduces saved ranks/blocks. This verification never accepts outcome files.
The final seal records the helper hash and Node version.

Run from the `execution-20260924` directory. The first command reads prediction
and reference identities without computing DockQ:

```sh
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py preflight --artifacts . --input OUTCOME-REQUEST.json
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py seal --artifacts . --input OUTCOME-REQUEST.json --output RANK-SEAL.json
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py evaluate --artifacts . --seal RANK-SEAL.json --output NEW-DEVELOPMENT-OUTCOME-DIRECTORY
```

To construct the request without manually entering hashes, use a completed final
preparation and ranking receipt. This command validates everything and writes only
the new request; it does not seal or evaluate outcomes:

```sh
.venv/bin/python round3-benchmark/outcome-tools/prepare_request.py --artifacts . --role development --preparation FINAL-PREPARATION --ranking-receipt FINAL-V3/receipt.json --output OUTCOME-REQUEST.json
```

For prospective evaluation, the final command additionally requires
`--release ROOT-RELEASE.json`. The root authors this release only when authorized
and when all prediction-side work and rankings have been frozen:

```json
{
  "schema": "confovhh-round3-prospective-outcome-release-v1",
  "evaluationRole": "prospective",
  "rankingSealSha256": "EXACT_RANK_SEAL_DIGEST",
  "generationRunId": "EXACT_SEALED_RUN_ID",
  "releasedAtUtc": "UTC_ISO_TIMESTAMP",
  "authorizeFrozenProspectiveOutcomeEvaluation": true
}
```

The seal precedes release, which precedes outcome computation. The seal binds the
request, complete ID inventory, ranking receipt digests, producer provenance and
the outcome implementation. Input identities are revalidated before evaluation.
`METHOD-FREEZE.json` separately binds the numerical correspondence/metric source
functions and DockQ/Biopython/NumPy identities before any fresh outcomes.
These are reproducible hash-bound provenance records, not digital signatures.
The CLI `worker` subcommand is an internal evaluation subprocess; it independently
requires the rank seal, enrolled model/reference bindings and prospective release.
Callers should use the public `preflight`, `seal`, `evaluate` and `verify` commands.

## Output and verification

Each new output directory contains:

- `outcome-map.json`: exactly every planned row, with
  `id,setId,seed,coordinateSha256,status,DockQ,reason`. Unavailable results have
  null DockQ and a nonempty reason. The coordinate hash is the **canonical scoring
  view**, matching v3 and calibration.
- `authentication.json`: the exact development calibration contract, or the
  analogous prospective schema. Each row binds coordinate, reference and raw
  outcome artifact. Single-view reference identity is its coordinate SHA;
  four-view identity is SHA-256 of the ordered reference descriptor array.
- `artifacts/<id>.json`: fixed reference descriptors, every per-view raw metric,
  full correspondence, its digest, exact maximum and all maximizing view IDs.
- `receipt.json`: bindings for the seal, release, request, map, authentication and
  all outcome artifacts, implementation hashes, times and coverage counts.

Authenticate again before calibration or summary metrics:

```sh
.venv/bin/python round3-benchmark/outcome-tools/outcome_adapter.py verify --artifacts . --receipt OUTCOME-DIRECTORY/receipt.json
```

Python callers can import `outcome_adapter.py` and call
`verify_evaluation(root, receipt_binding)`, which returns
`(outcome_map, authentication, evaluation_receipt)` only after revalidating all
input identities, ranking seals, source audits, coordinate mappings, references,
complete membership, output artifacts and fixed-view maxima. No outcome metric is
recomputed during verification. For calibration, bind `outcome-map.json` as
`outcomeMap` and `authentication.json` as `analysisReceipt`.

## Controls and limitations

`test_outcome_adapter.py` tests context exclusion (including the other Nb), dimer
missing loops and swapped assignments, correspondence bijection, fixed-four-view
completeness, membership, hash tampering, wrong Nb/namespace reuse, relocated
archives, release identity/chronology, complete unavailable output round-trip and
the independent calibration consumer. Synthetic independent metrics use NumPy
contacts, Kabsch, RMSD and the published DockQ formula without DockQ's parser,
contact routines, superposition or formula implementation.

`metric-controls-v3/receipt.json` binds 18 actual native-self controls, the old
AF2IG 6KNM pair CLI/API crosscheck and all four synthetic dimer independent metric
checks. No fresh prediction/native comparisons occurred. Native self DockQ is one
within 1e-8; tiny nonzero RMSDs arise from DockQ's float32 superposition. The old
pair CLI/API values agree exactly. Synthetic independent float64 metrics agree
within 1e-7 absolute DockQ and 1e-6 absolute plus 1e-6 relative RMSD; every raw
difference is saved. Initial over-strict floating-point test failures are retained
in `metric-controls-v1` and `metric-controls-v2`; metric inputs and code were not
tuned to fresh outcomes.

Self-controls validate parsing and bookkeeping. They do not establish docking
accuracy or prove that any new ranking improves selection. Scientific claims
require the separate frozen development/prospective analysis.
