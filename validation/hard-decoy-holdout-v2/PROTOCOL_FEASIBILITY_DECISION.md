# Hard-decoy protocol feasibility decision

Status: **scientific decision required before any target-freeze transition**

No native holdout coordinate, pose, DockQ/CAPRI label, or performance result
was accessed during this review.

## Primary conflict

`HARD_DECOY_PROTOCOL_V2.md` currently requires native-contact epitope overlap
to establish leakage freedom while its blind boundary forbids native-reference
readers during target curation. Both cannot be certified simultaneously as
written.

Two defensible designs exist:

1. **Strict metadata blindness.** Define publication/depositor-annotated
   epitope signatures, freeze accepted evidence and a topology/domain ontology,
   and exclude missing or ambiguous annotations. The supported claim becomes
   `annotation-epitope-disjoint`, not `native-contact-epitope-disjoint`.
2. **Sealed coordinate oracle.** A versioned one-way process reads native
   coordinates only to emit signed epitope tokens, overlap decisions, and
   provenance hashes. It emits no coordinates, pose visualization, DockQ label,
   or performance result. This preserves a native-contact claim but changes the
   current no-native-reader boundary and requires explicit approval.

Neither choice relaxes the minimum of ten or solves the current target-count
shortfall by itself.

## Other operational blockers

- `receptor-family-disjoint` is currently mixed with a 40% canonical-7TM
  identity heuristic. A pinned GPCRdb family edge or narrower sequence-cluster
  claim is required.
- The VHH heuristic establishes a sequence cluster, not biological lineage.
  Source-backed parent provenance is required for a lineage claim; otherwise
  the claim must be `VHH-sequence-cluster-disjoint` with known-parent vetoes.
- Canonical 7TM extraction, isoform selection, aligner/scoring, coverage,
  threshold equality, gap handling, and complete symmetric matrices are not
  yet frozen.
- The development registry lacks complete publication and epitope nodes.
- Candidate target records and the VHH-lineage ledger disagree about IMGT
  readiness; one canonical hashed record is required.
- Missing primary-publication identity, ambiguous direct-interface evidence,
  unresolved assembly/model identity, and fusion-contact ambiguity must fail
  closed.
- Exact graph nodes, edge ledgers, connected-component construction, and the
  representative-selection rule must be mechanical rather than manually
  assigned.

## Decision boundary

The formal holdout remains blocked and unexecuted until:

- one epitope-blinding design is approved and versioned;
- the family/sequence and lineage/sequence claim vocabulary is fixed;
- all leakage matrices and development nodes are complete; and
- at least ten leakage-cleared independent groups exist.

If fewer than ten remain, a smaller exploratory panel, leave-family-out
cross-validation, or broader membrane-protein scope must be a separately named
and preregistered study. None may be relabeled as the requested independent
GPCR-VHH holdout.

