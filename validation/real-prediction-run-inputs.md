# Replaying the exact producer-output regression

The regression uses 26 public producer files: 10 ColabFold files from
[Zenodo record 17063524](https://zenodo.org/records/17063524) and 16 AlphaFold
Server example files from the pinned AF3_MiniPAE revision recorded in
[`real-prediction-run-regression-v1.json`](real-prediction-run-regression-v1.json).
These are software compatibility controls, not GPCR–nanobody ranking evidence.

The default command downloads the original files, checks every expected byte
count and SHA-256, recomputes all audits, and compares the complete result:

```sh
node scripts/validate-real-prediction-runs.mjs --verify=validation/real-prediction-run-regression-v1.json --quiet
```

An upstream HTTP 403 is an access denial. It is not retried or treated as a
passing check. Restore permitted source access, or provide exact copies obtained
through permitted access. An explicitly selected input directory can be used:

```sh
node scripts/validate-real-prediction-runs.mjs --input-dir=/path/to/producer-inputs --verify=validation/real-prediction-run-regression-v1.json --quiet
```

To reduce load on Zenodo, the network mode requests those files one at a time,
with a one-second gap after each successful file. A failed download stops the
dataset before another file starts. URLs and access credentials are unchanged;
this scheduling does not clear or bypass an upstream access restriction.

The directory must contain one subdirectory per dataset ID:

- `zenodo-17063524-colabfold-multimer/`: the 10 original filenames listed in that
  dataset's `inputs` array.
- `af3-minipae-p06730-o60516/`: the 16 original filenames listed in that dataset's
  `inputs` array.

Local input mode applies the identical byte-count, SHA-256, decoding and audit
checks. A missing or changed file fails. It never fetches a replacement, changes
the expected record, or skips a dataset. It verifies the retained source bytes;
it does not demonstrate that the upstream service is currently reachable.

Retain source attribution and applicable licenses with any redistributed input
copies. The source locations, versions and license notes remain in the existing
regression record. No producer data are bundled with this documentation.
