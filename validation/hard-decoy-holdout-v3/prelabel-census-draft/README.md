# ConfoVHH hard-decoy v3 pre-label census contracts

Status: **census in progress; no target set is frozen and no execution is authorized**.

This directory contains the machine-readable rules required before rebuilding the independent GPCR–VHH census:

- the monotonic blocked/in-progress state;
- exact public metadata query contracts;
- the one-row-per-entry disposition contract; and
- the annotation-only epitope ontology adopted by the v3 draft.

These files do not contain holdout coordinates, native relative poses, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results. A source-universe snapshot is evidence for what was searched, not evidence that any target is leakage-free. Every returned source entry must still receive exactly one reconstructible disposition, and at least 10 independent connected components must survive all gates before target freeze.
