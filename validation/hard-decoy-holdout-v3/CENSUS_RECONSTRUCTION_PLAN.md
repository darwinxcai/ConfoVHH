# ConfoVHH hard-decoy v3 census reconstruction plan

Status: **pre-label scientific work only; no target freeze or execution authorization**

Protocol authority note (2026-08-29): this reconstruction plan originated with
the archived annotation-epitope draft. Annotation fields below are retained as
descriptive source metadata only. They cannot establish epitope independence
or advance a target. The selected eligibility gate is the sealed native-contact
oracle in `HARD_DECOY_PROTOCOL_V3.md`.

Date: 2026-08-29 UTC

## Purpose

Rebuild the independent GPCR–VHH target census so that a third party can reproduce every source result, every disposition, every leakage edge, and the final connected-component count without opening native holdout coordinates or DockQ/CAPRI labels.

The v2 record remains immutable and terminal at `TARGET_CENSUS_BLOCKED`. This directory starts a new v3 pre-label workstream.

## Frozen starting facts

The v2 audit recorded:

- 2,065 unique RCSB entries from the four full-text terms `nanobody`, `VHH`, `camelid`, and `megabody`;
- 1,716 GPCRdb structure rows;
- a 287-entry intersection;
- seven provisional groups: GPR158, LGR4, CASR, MGLU, ADGRV1, DRD1, and MC4R;
- zero formally cleared groups;
- a formal minimum of 10 independent groups.

The 287 entry-level dispositions were not frozen. Therefore the v2 search conclusion is not independently reconstructible and cannot serve as a final census.

## Work package A — source reconstruction

For each frozen source response:

1. archive the raw metadata response bytes;
2. record retrieval UTC, URL/request payload, byte count, SHA-256, and HTTP validators when supplied;
3. deterministically normalize returned PDB IDs;
4. generate a one-row-per-entry source ledger;
5. reconcile source counts and union/intersection hashes against the previous audit where the query is identical.

No coordinate files are permitted in this work package.

## Work package B — exhaustive disposition ledger for the 287-entry universe

Create exactly one disposition row for every entry in the frozen 287-entry intersection.

Minimum fields:

- `pdb_id`
- `source_query_ids`
- `release_date`
- `receptor_entity_name`
- `receptor_uniprot`
- `vhh_entity_name`
- `vhh_sequence_sha256`
- `primary_doi`
- `primary_pmid`
- `publication_status`
- `direct_receptor_vhh_evidence`
- `construct_evidence`
- `auxiliary_binder_flag`
- `annotation_epitope_token` (descriptive only; never an eligibility decision)
- `receptor_cluster_status`
- `vhh_cluster_status`
- `known_parent_status`
- `publication_edge_status`
- `disposition_code`
- `disposition_reason`
- `evidence_urls`
- `native_coordinates_inspected=false`

Every row must terminate in one of a frozen set of mutually exclusive disposition codes. Missing or ambiguous evidence fails closed.

## Work package C — broaden discovery without changing the existing 287 ledger

The four-term search is known to be incomplete because depositor terminology can omit those strings. Additional searches therefore form separate source universes; they never mutate the historical four-term universe.

Prespecified discovery routes:

1. RCSB metadata/entity searches for camelid single-domain antibody taxonomy and immunoglobulin/VHH polymer annotations, intersected with GPCR receptor annotations;
2. GPCRdb structure inventory joined to RCSB polymer-entity metadata to identify entries containing a receptor plus a small immunoglobulin-domain protein even when free text lacks `nanobody`/`VHH`;
3. publication-first searches using the exact phrases `GPCR nanobody`, `GPCR VHH`, `G protein-coupled receptor nanobody`, `extracellular GPCR nanobody`, and `conformation-selective nanobody`, followed by PDB accession extraction;
4. recent-release audit for PDB entries released after the v2 source snapshot;
5. exact follow-up of unpublished PDB entries when the primary publication becomes available.

Each discovery route receives its own raw-response hash, normalized-ID hash, and deduplicated union hash before curation.

## Work package D — deterministic leakage data

Before any target is formally cleared, freeze:

- canonical receptor accession/isoform rules;
- canonical 7TM extraction;
- pinned GPCRdb snapshot and hierarchy IDs;
- global aligner/scoring/gap/coverage rules;
- complete receptor identity matrix;
- pinned IMGT implementation and complete VHH sequence/CDR matrix;
- known-parent/variant provenance ledger;
- descriptive annotation-epitope ontology and source-backed assignments for curation only;
- complete sealed-oracle request inputs and native-contact edge matrix under `HARD_DECOY_PROTOCOL_V3.md`;
- complete development publication and epitope registry;
- all graph nodes and edge ledgers.

The graph, not manual judgment, determines connected components.

## Work package E — candidate quality gate

Metadata-only provisional status is not formal clearance. Each target must also resolve:

- biological assembly/model identity;
- direct receptor–VHH interface evidence from source metadata/publication;
- construct/fusion ambiguity;
- publication identity;
- sequence completeness sufficient for the frozen generator inputs;
- VHH IMGT readiness;
- receptor cluster independence;
- VHH cluster/known-parent independence;
- sealed native-contact epitope independence (annotation metadata is non-dispositive);
- publication independence.

CASR, ADGRV1, DRD1, and MC4R remain conditional exactly as documented in the v2 census until these gates are mechanically resolved.

## Current spot-check outcome

A fresh metadata/publication spot-check on 2026-08-29 surfaced no defensible new eighth independent group. It rediscovered already-known/provisional systems including LGR4–NB21, GPR158–Nb20, and ADGRV1–Re02, while recent AT1R and M1 nanobody structures remain excluded by exact development-receptor or receptor-cluster rules already recorded in v2.

This spot-check is **not** an exhaustive search and does not update the formal group count.

## Advancement rule

Proceed to an exact v3 target manifest only if at least 10 groups survive all leakage and construct gates. Freeze the exact number and exact identities before candidate generation.

While discovery or scientific dispositions remain incomplete, keep the formal v3 protocol state at `DRAFT` and record the target-freeze gate separately as `BLOCKED`. If a completed census still yields fewer than 10 formally cleared independent groups, transition to the protocol-defined terminal `TARGET_CENSUS_BLOCKED` state. Do not reduce the threshold, substitute a weaker study, or open labels to decide what to keep.

## Integrity rule

Until a v3 pre-label seal is created and explicitly approved:

- no holdout coordinates;
- no native receptor–VHH pose inspection;
- no DockQ/CAPRI labels;
- no ConfoVHH holdout scoring;
- no performance summaries;
- no resource-cap expansion based on holdout outputs.
