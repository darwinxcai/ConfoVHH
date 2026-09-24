# Bounded public GPCR–VHH holdout refresh — 2026-09-24

No new target was certified for the frozen prospective benchmark. This package is source and eligibility research, not a pose benchmark or a score improvement. No candidate coordinates, scorer outputs, DockQ outcomes, prior chat, or memory files were opened. Primary-paper and repository eligibility prose was read and must remain part of the exposure record.

## Fresh release interval

The RCSB Search API was queried for initial releases **after 2026-09-10 through 2026-09-24**, using the union of `nanobody`, `VHH`, `sybody`, `megabody`, `single-domain antibody`, and `single domain antibody`. The saved query returned **16 records**. The first narrower `nanobody` query returned five; the six-term union supersedes that preliminary result. Search relevance values in the response are database search outputs, not ConfoVHH or pose-quality scores.

Eight records have GPCR titles. Six name the already exposed receptor family and a scFv helper, and are excluded from discovery as a new independent target group without opening their coordinates. The remaining two are newly released AVPR1A structures:

| Entry | Public metadata | Qualification |
|---|---|---|
| [9U40](https://www.rcsb.org/structure/9U40) | Released 2026-09-23; 3.04 Å; receptor author R/label A, vasopressin peptide, Gq alpha/beta/gamma and **Nanobody 35** author N/label F | Only deposited VHH is the known G-protein-helper name Nb35. No accession-specific primary publication or source-backed direct receptor–VHH role was established. **Not cleared.** |
| [9U43](https://www.rcsb.org/structure/9U43) | Released 2026-09-23; 3.02 Å; same receptor/helper identities; D-peptide title | Same target group as 9U40, not a second independent target. Same unresolved direct-role evidence. **Not cleared.** |

The receptor in both records includes a large fusion and is 855 aa; Nb35 is 157 aa in deposited metadata. These are deposited polymer lengths, not a certified purified-sample sequence. The entries are marked “To be published.” We did not claim that a keyword or a globally acceptable resolution certifies direct binding, sample identity, or local interface quality. A coordinate-level exclusion was not performed.

The other eight records are not GPCR cases by their entry titles: an ion-channel extracellular loop, a CFTR channel, yeast TIM23, KLC1/peptide and four pathogen-antigen records. They do not enter this GPCR study. In particular [9Y7F](https://www.rcsb.org/structure/9Y7F) is a new high-resolution human Nav1.7-loop/nanobody complex, but substituting it would broaden the scientific population beyond GPCRs and is not proposed as clearance under this protocol.

This is a reproducible **text-query interval refresh**, not an exhaustive sequence-based census of all current PDB entries. Missing metadata synonyms, delayed indexing and differently annotated helper chains remain search limits. Initial-release filtering also does not audit older entries whose polymer identities were recently revised.

## Apparent leads checked against current repository rules

The source of development and eligibility rules was the fresh GitHub clone. The later review was read at commit `dc543d152b73d31d80933e8c90e2444c9319c59a`, specifically the prospective protocol/inventory, blocked-entry-resolution, and exposure-review-26 decisions/biology/recovery documents. It certifies zero independent groups; this refresh does not waive any gates.

- **CHRM1 / Nb1B4, [9UCP](https://www.rcsb.org/structure/9UCP):** public direct extracellular VHH reference, 2.88 Å, released 2025-10-29, [primary paper](https://doi.org/10.1073/pnas.2508879122). CHRM2 is development-exposed, so the frozen conservative muscarinic family rule prevents calling CHRM1 family-disjoint. Companion [9UAZ](https://www.rcsb.org/structure/9UAZ) has no complete nanobody model according to the paper and is not a substitute.
- **GPR151, [9W3K](https://www.rcsb.org/structure/9W3K):** 2026 public reference and [primary paper](https://doi.org/10.1073/pnas.2534234123), but the current repository eligibility review already records a positive Nb6 sequence connection to development 6VI4 and excludes it. A different receptor name does not overcome binder lineage reuse.
- **CNR1 / CNb36, [9B9Y](https://www.rcsb.org/structure/9B9Y):** direct-binding source and public coordinates exist; [primary paper](https://doi.org/10.1038/s41467-024-54206-0). The current inventory keeps the family blocked for possible development/source-family connections and incomplete construct/ancestry certification. The linked 9B9Z/9BA0 records do not supply independent receptor groups.
- **CASR / NB2D11, [7E6U](https://www.rcsb.org/structure/7E6U):** public direct-binding reference, but deposited 6.0 Å fails the unchanged <=4.0 Å gate. [Primary paper](https://doi.org/10.7554/eLife.68578).
- **MRGPRX2 nanobodies:** the [2026 primary study](https://doi.org/10.1038/s41467-026-72093-5) and [author GitHub repository](https://github.com/kruselab/MRGPRX2-AF-M-screen) support computational predictions plus experimental binding/function assays. No experimental receptor–VHH coordinate reference was identified. Predicted models cannot become native DockQ ground truth. This is not an eligible pose holdout.
- **mGlu1/2/5, LGR4, ADGRV1 and GPR158:** the current 26-entry adjudication already preserves specific sample/lineage/exposure/reference-quality blockers. This refresh did not rerun those investigations or promote unresolved cases.

## Required next evidence

For the two new AVPR1A entries, only source-backed evidence that the deposited VHH directly binds the receptor could make further qualification useful; their current helper identity gives no basis to spend GPU resources. Exact sample identity, full relatedness review, exposure disposition, local reference quality and all existing target-input seals would still be required. Recovering old exposed-family metadata cannot restore independence. No scored-generation run was launched and no new independent-group count is claimed.
