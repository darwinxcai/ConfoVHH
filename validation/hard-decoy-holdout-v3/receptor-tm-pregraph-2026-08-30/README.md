# ConfoVHH hard-decoy v3 canonical receptor TM1-TM7 pregraph

Status: **RECEPTOR_TM_PREGRAPH_COMPLETED_BLOCKED_PENDING_REMAINING_PRELABEL_ADJUDICATION**.

This metadata-only snapshot maps every frozen candidate and development node through the GPCRdb accession endpoint, requires one unique canonical SWISSPROT GPCR record, extracts canonical TM1 through TM7 from the GPCRdb residue endpoint, and serializes every unordered node pair.

The primary possible-leakage rule is identical canonical receptor accession or global TM1-TM7 identity >=0.40 at >=0.80 coverage of each sequence. A >=0.30 identity threshold at the same coverage is retained only as a conservative veto sensitivity. Equality creates an edge.

A missing, invalid, or multiply mapped receptor profile produces FAIL_CLOSED. Absence of a primary threshold match is not formal NO_EDGE evidence. Components are sequence-evidence components, not biological receptor-family claims or benchmark-independent groups.

Two complete GPCRdb captures must agree after normalization. Raw responses, source documentation, normalized records, pair matrices, manifests, and checksums are preserved. No native coordinates, relative poses, native epitopes, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results are accessed. Target freeze and execution remain unauthorized.
