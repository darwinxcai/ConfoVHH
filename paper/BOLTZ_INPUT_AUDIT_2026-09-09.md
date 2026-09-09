# Boltz input scope and readiness audit

Audit date: 9 September 2026. Inspected repository source:
`32a78f4d5f4c2d8ca52e99541bf5023b2d4915c7`.

**The staged 92-job / 460-model Boltz arm is a GPCR review development
comparison, not a staged independent ConfoVHH benchmark.** Its manifest and
runner explicitly require `development_only`. Preparing or executing that arm
does not clear independent targets, alter the frozen holdout, or demonstrate
ConfoVHH pose-selection performance.

## Verified manifest scope

Source files:

- `validation/gpcr-paper-development-2026-09-04/boltz/jobs.json`
- `validation/gpcr-paper-development-2026-09-04/boltz/template_provenance.csv`
- `validation/gpcr-paper-development-2026-09-04/boltz/README.md`
- `scripts/paper/boltz-workflow.py`

| Property | Observed value |
| --- | --- |
| Declared scope | `development_only` |
| Imported source path | `GPCR_handoff_bundle.zip/boltz_arm.zip/boltz` |
| Jobs | 92 |
| Planned models | 460; five per job |
| Distinct protein sequences | 13; this is not a receptor or independent-group count |
| Jobs by chain count | 62 two-chain jobs; 30 one-chain jobs |
| Jobs without templates | 17 |
| Source template accessions | 34 |
| Job/query-chain/template combinations | 354 |

The comparison is accession-matched across AlphaFold Server and Boltz.
Accession matching does not establish identical template features, MSAs,
alignments, or sampling. Matching seed integers does not create paired random
realizations. Historical AlphaFold date caps and explicitly supplied Boltz
template sets have different intervention meanings.

| Inspected artifact | SHA-256 |
| --- | --- |
| `jobs.json` | `57d8b54c151ecbdcf9814f0f3b94fb6cb19c92476563f3aa03b373c94ed0387c` |
| `template_provenance.csv` | `42c46c95792e8371bf6a0f260d4358057757494449d809940f0e0bd03178cf16` |
| `scripts/paper/boltz-workflow.py` | `7d2b2086efe1b81695ee5fbce868082b2b2eb5c9fd6e28f2e0874014772dfa4c` |

The template-provenance hash matches the manifest's declared value. The
historical `boltz/readiness.json` retains an earlier runner hash; it is an
archived observation, not a fresh execution against the current runner. This
audit does not overwrite it.

## Current input blockers

| Requirement | Available evidence | Still needed |
| --- | --- | --- |
| Runtime, checkpoint, complete cache | Runner validates Python bytes, exact Boltz version/source, checkpoint bytes, and the cache inventory. `pins.example.json` is intentionally empty. | An inspected actual inference environment and real immutable or otherwise controlled input/cache files; no placeholder pins. |
| Local A3Ms | Exact query sequences and sequence digests exist in `jobs.json`. A recent archive candidate was located by filename metadata below. | Authenticated file membership, exact A3M bytes/query matches, and actual generation provenance for each sequence required by the chosen job. |
| Source templates | Expected source SHA-256 and byte counts exist for 34 accessions. | Exact matching source bytes. The two derived receptor templates under `validation/gpcr-matched-template-development-2026-09-05/` cannot silently substitute for these sources. |
| Template-chain and alignment evidence | Official Boltz 2.2.1 parser execution on synthetic input is retained in `tests/fixtures/boltz-parser-synthetic-2026-09-08/`. | Actual job-specific parsed chain identities and residue mappings tied to the exact input and pinned software, for template-enabled jobs. |
| Real end-to-end pilot | Runner and synthetic parser/output checks exist. | One successful actual job with preserved attempts, outputs, command, logs, input hashes and runtime provenance. This audit executes no prediction. |

The synthetic parser environment is partial and uses synthetic chemical
components. It does not provide a complete inference runtime, production cache,
real template parse, or successful GPU job. Its documented author-chain to
parsed-subchain behavior also means real chain IDs must be observed; a suffix
must not be guessed. See `scripts/paper/boltz-parser-README.md`.

## Newly located input candidates

After reading the earlier candidate observation in
`paper/evidence/input-archive-candidates-2026-09-08/`, an authorized metadata-only
filename search on 9 September found these records:

| Filename | Reported bytes | Record creation time (UTC) |
| --- | ---: | --- |
| `gpcr_frozen_msas_20260908T175627507640Z(1).zip` | 4,358,618 | `2026-09-08T17:57:25.163926Z` |
| `collect_gpcr_frozen_msas.py` | 3,919 | `2026-09-08T17:39:36.905666Z` |
| `GPCR_handoff_bundle.zip` | 3,548,223 | `2026-09-04T23:39:17.147890Z` |

The search used quoted title-only queries for `gpcr_frozen_msas`, the exact
timestamped ZIP filename, and `GPCR_handoff_bundle.zip`, with metadata-only
results. Only deterministic filename matches are included above; supplemental
fuzzy results were not treated as evidence. Private identifiers and access
links are excluded from this public record.

The exact recently uploaded MSA archive name is now located. This improves the
recovery route but does not authenticate its contents. No archive or collector
script was downloaded, materialized, read, or executed. No member inventory,
archive SHA-256, MSA query, generation record, coordinate payload, or prediction
output was opened in this lookup. Matching filename, size and timestamp do not
establish equality with imported inputs or public redistribution rights.

The next recovery evidence is a permitted metadata-only member inventory and
applicable provenance/distribution record. Any later payload access must satisfy
the existing exposure rules independently. The newly located GPCR review files
must not be relabeled as independent ConfoVHH holdout inputs.

### Authorized sequence-only recovery attempt

After the metadata lookup, recovery of the exact timestamped MSA archive was
authorized for bounded ZIP inventory and sequence/provenance inspection only.
The intended procedure would reject unsafe or oversized archive members, avoid
extraction, and read only A3M query/sequence content and declared input
provenance. Native structures, predicted coordinates and outcome records would
remain unopened. Any indication of proprietary source content would stop that
inspection.

The archive transfer failed with HTTP 502 on both the initial attempt and one
retry. No archive bytes became available for this audit. Consequently no ZIP
member inventory, archive/member SHA-256, query match, or provenance verification
was performed. In particular, neither the pilot's two required sequence records
nor the full manifest's 13 sequence records is reported as recovered. The
candidate remains located by metadata only; this failure does not change its
contents or prove that its source is unavailable elsewhere.

## Shortest useful development pilot

The existing workflow already names
`3P0G_no_templates_complex_seed1` as its single-job preparation example.
This job has two chains, seed 1, five diffusion samples, and no templates.

| Query chain | Sequence length | Sequence SHA-256 |
| --- | ---: | --- |
| A | 126 | `3e4dbf73ccc8ab7a4fb2fedd17695befe7f2807f17650d8ef60080aef9a8562f` |
| B | 501 | `e9052379ba6dca45a6a4148a53cc1d6ad790f05e4b4f0a9237afe2fcc8638926` |

Its preparation requires these two exact sequence-matched A3Ms and their
provenance. Readiness additionally requires the full runtime/checkpoint/cache
pins. It does not require all 13 MSAs, any of the 34 templates, or template
parser evidence. A successful no-template pilot would validate this particular
development execution path; it would not validate template-enabled jobs or
independent predictive superiority.

The highest-value bounded input work is to authenticate the two required MSA
records and create a new read-only per-job readiness receipt identifying missing
assets. Then prepare the exact local input and inspect runtime readiness before
renting compute. Preserve failed attempts and measure actual pilot duration and
cost before extrapolating to a full batch. This audit supplies no GPU price or
runtime estimate because no relevant timed pilot has been performed here.

## Independent evaluation remains separate

`HARD_DECOY_PROTOCOL_V3.md` requires a frozen eligible population, leakage and
exposure accounting, method/baseline identity, and prespecified endpoints before
benchmark execution. Its learned-generator arm forbids templates and native
pose/interface feedback. Its existing development panel cannot be promoted to
independent holdout data by generating more seeds or additional predictor models.

Any current-product evaluation that differs from the historical v3 engine or
ranking contract needs a separately declared protocol and source identity. Do
not modify frozen files to convert the GPCR review arm into that evaluation.

A conditional endpoint restricted to jobs containing both acceptable and poor
models must be declared before labels are opened, with all jobs and failed
attempts retained in accounting. Outcome-adaptive retention cannot substitute
for a frozen population. Uncertainty must respect independent components;
additional jobs for the same component do not increase the independent target
count. A defensible study must retain a negative comparison if that is what its
prespecified analysis shows.

## Access and authority record

This audit read code, manifest/query metadata, protocol text, and existing
development documentation. Earlier navigation searches during this audit
incidentally returned aggregate and case-specific development outcome prose in
the root `README.md` and `VALIDATION.md`. Those values are not reproduced here.
The observed file hashes were:

- `README.md`: `d63a789812958d0608dedbde7cab096f4cfe46f0fb7a494bf03d3ec20d57891d`
- `VALIDATION.md`: `45728def6c9b0b16f4d13bde47c08313e361cf66b1164c7e6d593ed7f0098f5c`

The exact initial read time was not retained. No coordinate payload, relative
pose, structural contact table, or per-pose outcome ledger was opened. No score,
threshold, baseline, frozen protocol, or exposure disposition was changed. This
is an additional disclosure, not clean-blind or formal exposure clearance.
Earlier exposure records and their adjudication requirements remain intact.

No new original model or MSA was authenticated, no independent group was
cleared, no inference ran, and no predictive performance claim follows from
this input audit.
