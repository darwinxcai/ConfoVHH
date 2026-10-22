# ConfoVHH hard-decoy v3 pre-label viability review

Status: **PRELABEL_VIABILITY_REVIEW_CREATED_TARGET_CENSUS_BLOCKED**

This package records the statistical stop/fallback rule before further candidate adjudication and creates a deterministic review queue from already frozen public metadata and pregraphs. It does not inspect native coordinates, assign labels, clear targets, or authorize execution.

## Statistical decision

The formal GPCR-VHH holdout still requires at least 10 leakage-cleared independent components. Seven previously screened components remain provisional and zero are formally cleared. If fewer than 10 survive, v3 remains blocked; any smaller GPCR panel must be reported as an exploratory feasibility study. A broader membrane-protein-VHH benchmark must be separately preregistered and cannot be pooled with v3.

## Review queue

The frozen 287-entry snapshot contains 39 metadata-direct-looking entries. After removing 10 exact development PDB IDs, 29 entries remain for prioritized review:

- 6 have no path to development in the combined review-only pregraph and are reviewed first;
- 4 have a multi-edge path to development through candidate nodes; and
- 19 have a one-edge path to development.

A path is not yet a formal exclusion because VHH roles, parent/variant provenance, and some edge authority remain unresolved. Likewise, absence of a path is not evidence that a target is independent or eligible. Every row remains `PENDING_REQUIRED_METADATA`.

## Highest-priority entries

- 6N51
- 7DGE
- 7EPB
- 8T7H
- 8XFP
- 8XFS

These entries still require public-source direct-interface, construct, auxiliary-binder, parent/variant, publication, and later sealed native-epitope review. The queue intentionally contains no coordinates, native interface residues, prediction outputs, DockQ/CAPRI labels, or ConfoVHH holdout results.
