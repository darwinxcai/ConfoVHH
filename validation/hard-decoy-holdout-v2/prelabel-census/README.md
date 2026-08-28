# Independent hard-decoy target census

Status: **blocked before target freeze** (`TARGET_CENSUS_BLOCKED`)

This directory records the metadata-only target census for the prospective
independent hard-decoy benchmark in `HARD_DECOY_PROTOCOL_V2.md`. It is an
blocked screening checkpoint, not a holdout dataset and not a completed benchmark.

The preregistered minimum is 10 receptor-family- and VHH-lineage-disjoint,
direct GPCR–VHH target groups. The documented screen recorded eight candidate
structures resolving to seven provisional groups and zero formally cleared
groups before the remaining prespecified quality and leakage gates.
Candidate-discovery completeness was not established. The minimum was not
relaxed, related targets were not used to pad the panel, and the manifest
therefore remains fail-closed.

No candidate coordinate file, native pose, DockQ/CAPRI label, or performance
result was retrieved or inspected during this census. The package records
metadata source observations, exact deposited construct sequences, VHH IMGT regions,
development exclusions, proposed generators, scoring and endpoint contracts,
resource bounds, historical-artifact locks, and the unresolved fields that
would have to be completed before a future target freeze.

## Verify

From the repository root:

```bash
node scripts/hard-decoy/verify-census.mjs
node --test tests/hard-decoy-census.test.mjs
(cd validation/hard-decoy-holdout-v2/prelabel-census && sha256sum -c checksums.sha256)
```

The verifier must report:

- status `TARGET_CENSUS_BLOCKED`;
- 10 required groups, exactly seven provisional groups in this documented
  screen, and zero frozen eligible groups;
- zero coordinate payloads, result records, or private-storage locators;
- exact sequence, lineage, protocol, package-file, and historical-artifact
  hashes, plus syntactically validated source-observation digests;
- two independently pinned prediction-generator contracts; and
- `holdoutReadyForApproval: false` and `executionPermitted: false`.

The package covers partial RCSB Core metadata only; it is not the complete
RCSB/GPCRdb/UniProt/publication source set required by the future protocol.
The raw RCSB metadata response bodies were not retained in this blocked screen.
Their recorded byte counts and SHA-256 values are provenance observations and
cannot be independently rehashed from this package. Archiving and rehashing
those exact response bytes is mandatory before any future `TARGETS_FROZEN`
transition.

Changing the minimum, broadening the scientific scope, or consuming a smaller
panel is a new scientific decision. None is authorized by this record.
