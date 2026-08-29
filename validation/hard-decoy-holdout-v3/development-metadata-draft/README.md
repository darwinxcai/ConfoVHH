# ConfoVHH hard-decoy v3 development metadata archive

Status: **pre-label development-exposure reconstruction; no target clearance or freeze**.

This contract retrieves public metadata and polymer sequences for all 17 structures recorded in the frozen development registry, including structures that were absent from the 287-entry search intersection. The same RCSB GraphQL metadata query is repeated twice and normalized independently; exact raw responses, requests, normalized entries, receptor tokens, all VHH-like exposure tokens, publication identifiers, and checksums are retained.

A VHH-like entity is recorded as a sequence exposed during development, not automatically as the direct receptor binder. Direct-binder identity, known-parent provenance, epitope annotation, receptor 7TM clustering, VHH IMGT/CDR clustering, and formal connected-component clearance remain separate gates.

No holdout coordinate, native relative receptor–VHH pose, DockQ/CAPRI label, ConfoVHH holdout score, or performance result is accessed.
