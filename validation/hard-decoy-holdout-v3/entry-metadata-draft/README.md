# ConfoVHH hard-decoy v3 entry-metadata contract

Status: **metadata enrichment in progress; no entry disposition is complete and no target freeze or benchmark execution is authorized**.

This package binds a metadata-only RCSB GraphQL query to the exact 287-entry source universe archived under `source-snapshot-2026-08-29`. The collector retrieves each batch twice, retains both raw responses, canonicalizes entry and polymer-entity metadata, joins the frozen GPCRdb metadata, and emits review signals that cannot be interpreted as scientific dispositions.

The package forbids holdout coordinates, coordinate-derived native interfaces, native relative receptor–VHH poses, DockQ/CAPRI labels, ConfoVHH holdout scores, and performance results. Every output row remains `PENDING_DISPOSITION`; source-backed direct-interface, construct, publication, receptor-cluster, VHH-cluster/parent, and annotation-epitope review must still be completed before any target can be formally cleared.
