# ConfoVHH hard-decoy v3 pre-label census contracts

Status: **census in progress; the public metadata universe and entry-metadata snapshot are archived, but no target set is frozen and no execution is authorized**.

This directory contains the machine-readable rules required for the independent GPCR–VHH census:

- the monotonic blocked/in-progress state;
- exact public metadata query contracts;
- the one-row-per-entry disposition contract; and
- the annotation-only epitope ontology adopted by the v3 draft.

## Archived pre-label evidence

The source snapshot archived on 2026-08-29 fixes an exact 287-entry RCSB/GPCRdb intersection, with independent GPCRdb API/HTML agreement. The linked entry-metadata snapshot resolves all 287 entry records and 1,401 polymer entities and assigns deterministic metadata-review strata:

- 39 `DIRECT_TARGET_CANDIDATE_REVIEW`;
- 242 `AUXILIARY_OR_CONSTRUCT_REVIEW`;
- 6 `METADATA_RESOLUTION_REQUIRED`.

These strata are triage signals, not scientific dispositions. In particular, the 39 direct-target review entries are not 39 independent or leakage-cleared targets.

The source-universe reconstruction blocker is therefore closed. The scientific census remains blocked because 0 of 287 entry dispositions are complete, the development registry and leakage matrices are incomplete, the connected-component graph does not exist, and 0 groups are formally cleared.

These files and their linked attestations contain no holdout coordinates, native relative poses, DockQ/CAPRI labels, ConfoVHH holdout scores, approvals, or performance results. At least 10 independent connected components must survive every prespecified gate before any target manifest may be frozen.
