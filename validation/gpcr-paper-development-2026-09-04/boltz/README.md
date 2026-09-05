# Development Boltz pilot workflow

The supplied arm contained 92 job inputs (460 planned models), 13 distinct protein
sequences and provenance records for 34 template accessions. Those inputs are now
normalized in `jobs.json`; `template_provenance.csv` preserves the source checksums
byte for byte. No predictions, template downloads, MSAs or Boltz installation were
performed in this repair. The imported jobs are development data and do not modify
the frozen ConfoVHH validation records.

This is an accession-matched comparison with AlphaFold 3. Template feature handling,
MSAs, alignments and sampling are not identical across predictors. Matching seed
integers does not establish paired random realizations. Historical AF3 date caps
become explicit supplied template sets here, with a different intervention meaning.

## What the repair establishes

- All input artifact paths sent to Boltz are absolute. Generated JSON is valid YAML
  and retains the `.yaml` suffix supported by Boltz.
- Each sequence requires a shared, local A3M with a matching query, SHA-256 and
  generation provenance. The command never supplies `--use_msa_server`.
- Execution requires an exact Boltz version, Python executable hash, installed
  Boltz Python-source hash, explicit model checkpoint hash and pre-staged cache
  inventory. The observed dependency versions are recorded with every attempt.
- Template-enabled jobs require source checksum matches, explicit template-chain
  identities and a hashed record of parsed mappings and residue alignments matching
  the exact prepared input and Boltz version/source. No mappings were guessed here.
- One job is executed per invocation. Every attempt has an independent output
  directory, command, provenance, complete stdout/stderr and terminal status.
- Success requires exit code zero and exactly model IDs 0–4, each with a CIF and
  confidence JSON. CIF checks require finite coordinates and one C-alpha atom for
  every expected residue with matching chain and sequence identities; confidence
  fields must be numeric, finite and in range. These are file/identity checks,
  not stereochemical or biological validation.
- Only an atomic completion record permits a skip. Every skip rechecks the current
  input fingerprint and the saved outputs, input, command, stdout/stderr logs and
  provenance hashes.
  An empty or partial directory never counts as completion.
- Before marking a successful process complete, the runner rehashes the MSAs,
  templates, parser evidence, Python executable, checkpoint and complete cache,
  checks the cache inventory and reprobes the software environment. Persistent
  changes during execution leave the attempt incomplete. A file changed and then
  restored between checks remains a time-of-check/time-of-use limitation; immutable
  filesystems/containers are needed to eliminate that possibility.

The offline tests reproduce the old failure: a process creates an empty output
directory and exits 42. The replacement remains incomplete; a retry creates a new
attempt and preserves the failed attempt. Additional tests cover truncated files,
missing/incorrect model identities, wrong chain sequences, nonfinite confidence,
modified outputs or inputs, changed pin fingerprints, and concurrent runs.
They also cover deleted/modified logs and MSAs/checkpoints changed during execution.

## Remaining prerequisites

`pins.example.json` is intentionally unconfigured and fails readiness. Populate a
separate local pins file only from an inspected environment and real input files.
No GPU inference is enabled by importing the manifest or running tests.

The `runtime.python` and `checkpoint` records have `path` and `sha256` fields. Use
an exact `runtime.boltz_version`, such as the actual installed release, without an
upgrade command. `runtime.boltz_source_sha256` is the hash computed by the
`RUNTIME_PROBE` constant in the runner: a deterministic inventory of the installed
Boltz `.py` files. This probe also returns installed package versions. The hash is
not a git commit or package version, and should not be described as one.

The cache record has an absolute or pins-file-relative `path` and a complete
`files` list, each with a cache-relative `path` and SHA-256. For the inspected
upstream Boltz-2 startup, the pre-staged inventory must include
`boltz2_conf.ckpt`, `boltz2_aff.ckpt`, `mols.tar` and the extracted `mols/` files.
The explicit checkpoint must match `boltz2_conf.ckpt`. The affinity weights are a
startup dependency in the inspected implementation even though this pilot does
not request affinity prediction. The runner does not obtain any of these assets.
Version-specific behavior must still be confirmed in the real pilot environment.

`msas` is keyed by the manifest's `sequence_sha256`. Each record contains `path`,
`sha256` and a `provenance` object with `method`, `database`, and `created_utc`.
Record the actual retrieval method/database/version available; do not fabricate
database versions when an earlier server response omitted them. If provenance is
insufficient, create a new documented input set rather than relabel old MSAs.

`templates` is keyed by uppercase PDB accession, with `path` and `sha256` matching
the imported provenance. `template_chains` is keyed by
`JOB:QUERY_CHAIN:PDB_ID` and has the actual template chain ID as its value. The
source accession lists alone do not identify those template chains.

For a template-enabled job, `template_parse_evidence[JOB]` points to a JSON artifact
using `path` and `sha256`. Its required content is:

```json
{
  "job": "the exact manifest job",
  "boltz_version": "the inspected exact release",
  "boltz_source_sha256": "the inspected source hash",
  "input_sha256": "the SHA-256 from prepare",
  "template_records": [
    {
      "pdb_id": "the accession",
      "chain_id": "query chain",
      "template_id": "actual parsed template chain",
      "query_indices": [0, 1],
      "template_indices": [10, 11]
    }
  ]
}
```

The displayed indices are schema examples, not measured alignments. Populate them
from an actual parser pass in the pinned environment, preserving its raw extraction
record. The runner checks evidence consistency and its hash; it cannot prove that
a supplied evidence file truthfully reports an external parser execution. It does
not currently implement that extraction pass. No real parser evidence was supplied
with this package, so template-enabled execution remains blocked.

## Commands from the repository root

Run the offline regressions:

```bash
node --test tests/gpcr-paper-boltz.test.mjs
```

To prepare one local input after filling the real pins, without inference:

```bash
python3 scripts/paper/boltz-workflow.py prepare \
  --manifest validation/gpcr-paper-development-2026-09-04/boltz/jobs.json \
  --pins /absolute/path/to/local-pins.json \
  --job 3P0G_no_templates_complex_seed1 \
  --out /absolute/path/to/prepared-inputs
```

Replace `prepare` with `readiness` to check the pinned software, cache and (for
template jobs) parser evidence. Readiness does not establish successful inference.
For `run`, use a new output root and keep the same single `--job`; inference is
then requested explicitly. The production command fixes five diffusion samples,
three recycling steps and 200 sampling steps. Other settings inherit the exact
pinned release's defaults and observed environment. Review those settings before
expanding any pilot to additional jobs. `verify` revalidates an existing completion
record without launching predictions. It is read-only.

After inspecting a failed attempt, `run --retry` retains the failure and creates a
new attempt. For changed inputs/pins or tampered completed outputs, use a separate
output root. A `RUNNING.lock` left by an interrupted process is not automatically
deleted; first verify the process is gone, then archive/remove that lock manually.

No copied legacy interface-scoring function is used here. Standard DockQ scoring
and ConfoVHH evaluation are separate downstream tasks after predictions exist.
