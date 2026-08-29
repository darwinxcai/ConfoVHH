# ConfoVHH independent hard-decoy protocol v3 — draft

Status: **DRAFT ONLY; target census blocked; no holdout coordinates, candidate poses, DockQ/CAPRI labels, ConfoVHH holdout scores, or performance results accessed.**

This file is additive. It does **not** modify or supersede `HARD_DECOY_PROTOCOL.md`, `HARD_DECOY_PROTOCOL_V2.md`, the public product release, the commit-attested v0.5.0 scientific engine, or any frozen historical validation artifact. It resolves protocol ambiguities identified in `validation/hard-decoy-holdout-v2/PROTOCOL_FEASIBILITY_DECISION.md` without authorizing target freeze or execution.

The formal benchmark remains blocked unless an exact preregistered set contains at least 10 leakage-cleared independent GPCR–VHH groups and every pre-label integrity gate passes.

## 1. Scientific question

Among contact-rich receptor–VHH candidate poses generated without access to the native relative receptor–VHH pose, does the frozen ConfoVHH v0.5 coordinate-audit preorder enrich DockQ-acceptable-or-better poses beyond every prespecified baseline?

The benchmark can support only a ranking/reference-similarity claim on the frozen benchmark population. It cannot by itself establish binding, affinity, specificity, conformational selectivity, signaling, membrane compatibility, flexible docking, or nonbinder discrimination.

## 2. Blind boundary: strict metadata blindness

The v3 draft adopts **strict metadata blindness** for target curation.

Allowed before target freeze:

- RCSB/wwPDB metadata and sequence records;
- UniProt and pinned GPCRdb metadata;
- primary publications and depositor annotations;
- licenses, release dates, experimental method/resolution, construct descriptions, and sequence provenance;
- publication/depositor descriptions of receptor-facing epitopes at a prespecified topology/domain level.

Forbidden before the label-opening stage:

- holdout coordinate files or coordinate-derived native interfaces;
- native relative receptor–VHH poses or visual inspection of them;
- DockQ, CAPRI, Fnat, iRMSD, LRMSD, or any native-geometry score;
- ConfoVHH holdout results or benchmark performance summaries.

Therefore the formal leakage claim is **annotation-epitope-disjoint**, not native-contact-epitope-disjoint. A future native-contact claim would require a separately versioned sealed-coordinate-oracle protocol and explicit approval; it may not be silently introduced into this study.

## 3. Receptor independence vocabulary

The primary claim is **receptor-cluster-disjoint** unless a stronger family claim is mechanically demonstrated.

For every development and candidate receptor, freeze:

1. canonical UniProt accession and isoform rule;
2. canonical 7TM sequence extraction rule;
3. a pinned GPCRdb snapshot and hierarchy identifiers;
4. global-alignment implementation, scoring parameters, gap policy, coverage calculation, and complete symmetric identity matrix.

A receptor leakage edge is added if either condition holds:

- identical canonical UniProt accession; or
- canonical 7TM global identity >=0.40 at >=0.80 mutual coverage.

Threshold equality is excluded from independence: values exactly at a threshold create an edge. A >=0.30 identity analysis remains veto-only sensitivity analysis.

A stronger `receptor-family-disjoint` statement may be made only if all frozen groups are also distinct under the prespecified pinned GPCRdb family node. GPCRdb family labels are not interchangeable with the sequence-cluster criterion.

## 4. VHH independence vocabulary

The primary claim is **VHH-sequence-cluster-disjoint with known-parent vetoes** unless biological lineage is source-backed.

A VHH leakage edge is added when any of the following holds:

- source metadata identifies the same parent, variant series, or maturation lineage;
- IMGT-numbered framework identity >=0.90 **and** CDR3 global identity >=0.70 with absolute CDR3 length difference <=2;
- exact CDR3 identity plus source evidence indicates reuse of the same scaffold/parent.

A biological `VHH-lineage-disjoint` statement is permitted only for groups whose parent/lineage provenance is explicitly supported by a primary source or depositor record. Unknown provenance may not be converted into a lineage claim by sequence similarity alone.

Freeze the IMGT implementation/version, numbering inputs, normalized sequences, CDR definitions, pairwise matrices, and failure reasons. An unnumberable VHH fails closed for the formal holdout.

## 5. Annotation-epitope independence

Before any candidate target is accepted, assign an annotation epitope signature from the primary publication or depositor annotation using a frozen ontology.

The ontology must distinguish at minimum:

- intracellular receptor surface;
- extracellular orthosteric pocket / extracellular loop surface;
- N-terminal or large extracellular-domain surface;
- receptor core/7TM surface when explicitly described;
- named receptor domain for class B/C/F/adhesion or LGR receptors;
- unknown/ambiguous.

Exact residue-level claims are not inferred when coordinates are forbidden. A candidate with missing, contradictory, or ambiguous receptor-facing epitope evidence is excluded from the formal holdout.

An epitope leakage edge is added when the source-backed signatures are the same frozen topology/domain token or when one token is a prespecified parent of the other in the ontology. The ontology and all assignments must be frozen before any label access.

The claim is explicitly `annotation-epitope-disjoint`.

## 6. Publication independence

An edge is added for identical primary DOI or PMID. Related structures from one primary publication remain in one group. Missing primary-publication identity fails closed unless a depositor record unambiguously establishes that the entry is unpublished; an unpublished entry may be provisional but cannot be formally cleared until the publication rule for unpublished records is frozen.

## 7. Construct and direct-interface gate

Exclude prospectively:

- auxiliary G-protein nanobodies such as Nb35 that do not directly bind the receptor;
- anti-BRIL, anti-Fab, or particle-alignment binders;
- arrestin-directed binders;
- same-chain receptor–VHH fusions;
- fusion-dominated receptor complexes where the VHH primarily binds an engineered fusion partner;
- receptor constructs whose VHH-binding surface is created by grafting a development epitope;
- complexes lacking source-backed evidence for a direct receptor–VHH interface.

Engineered receptors are not automatically excluded. They require a prespecified construct-integrity decision showing that the benchmarked VHH target is the receptor surface rather than an engineered fusion or graft artifact. Ambiguity fails closed.

## 8. Reconstructible census contract

The metadata search audit is not sufficient until every screened entry has a frozen disposition.

For each source query and each returned entry, retain an immutable record containing:

- query identifier and exact query payload;
- source URL, retrieval UTC, byte count, SHA-256, ETag/Last-Modified when supplied;
- PDB ID and release date;
- receptor and VHH entity identifiers and normalized sequences where available without coordinates;
- primary DOI/PMID or explicit unpublished status;
- direct-interface evidence source;
- construct/fusion evidence;
- receptor-cluster status;
- VHH-sequence/known-parent status;
- annotation-epitope token and evidence;
- publication edge status;
- deterministic disposition code and human-readable reason.

Every entry in a frozen source union must reconcile exactly to one disposition row. Manual curation notes may explain a rule application but may not substitute for the machine-readable disposition ledger.

The currently recorded 287-entry RCSB/GPCRdb intersection is therefore a **search universe requiring reconstruction**, not a cleared target manifest.

## 9. Mechanical group construction

Construct one union graph over all development nodes and all candidate target nodes. Add receptor, VHH, annotation-epitope, and publication edges using only the frozen rules above.

A candidate connected to any development node is excluded. Remaining candidate connected components define independent groups. Representative selection, if multiple structures remain in one component, must use a deterministic pre-label rule based only on metadata-quality fields frozen in advance.

Do not manually assign groups after looking at benchmark outputs.

## 10. Minimum target rule

The formal independent holdout requires **at least 10 leakage-cleared connected components** after all audits.

The threshold is not negotiable after seeing candidate availability. If fewer than 10 survive, the formal benchmark remains blocked.

A smaller exploratory panel, leave-family-out cross-validation study, or broadened membrane-protein benchmark must be separately named and preregistered. None may be described as the formal independent 10-group GPCR–VHH holdout.

## 11. Candidate generation, scoring, baselines, labels, endpoints, and uncertainty

Unless a later version explicitly changes them before target freeze, v3 inherits the corresponding frozen provisions of `HARD_DECOY_PROTOCOL_V2.md`, including:

- two independent learned-complex generators (ColabFold/AlphaFold-Multimer and Boltz) using sequence/frozen-MSA inputs with templates disabled;
- no native-derived candidates in the primary benchmark;
- the complete pre-label eligible candidate population rather than DockQ-band sampling;
- the commit-attested ConfoVHH v0.5.0 coordinate-only preorder;
- full scientific ties with display identifiers excluded from ranking;
- producer confidence, DeltaSASA, contact count, clash metrics, CDR-contact share, all-tied, and fixed-seed-random diagnostic baselines;
- DockQ 2.1.3, DockQ >=0.23 primary binary label, prespecified sensitivities, hierarchical macro averaging, paired hierarchical bootstrap, and all previously frozen machinery/scientific gates.

Any change to those provisions must occur in a new version before target freeze and before any label access.

## 12. State and authorization

This draft does not reopen the terminal v2 `TARGET_CENSUS_BLOCKED` record. A v3 census must have a new versioned state directory and independent checksums.

Allowed next state:

`V3_DRAFT -> V3_CENSUS_IN_PROGRESS -> V3_TARGET_CENSUS_BLOCKED`

or, only if all prerequisites pass:

`V3_DRAFT -> V3_CENSUS_IN_PROGRESS -> V3_TARGETS_FROZEN -> V3_CANDIDATES_FROZEN -> V3_AUDITS_FROZEN -> V3_PRELABEL_FROZEN -> V3_APPROVED -> V3_OPENED -> V3_EXECUTED_PASS | V3_EXECUTED_FAIL | V3_OPENED_FAILED -> V3_PUBLISHED`

No label opening or benchmark execution is authorized by this draft. Before `V3_APPROVED`, publish/checksum the exact target manifest, source archive, leakage graph/matrices, generator/environment contracts, resource envelope, scoring/baseline contract, endpoint contract, and pre-label seal for explicit approval.

## 13. Current interpretation

As of the existing blocked v2 census, seven groups are provisional and zero are formally cleared. This draft does not promote any of them. It only makes the next census scientifically auditable and resolves the v2 native-epitope/blinding contradiction without weakening the minimum group count.
