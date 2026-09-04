# Broader census progress, 4 September 2026

The original 287-entry keyword intersection is not the whole GPCR–VHH census. The broader discovery work below expands the evidence base without promoting candidates or rewriting frozen records. The formal GPCR study remains **DRAFT**, target freeze remains **BLOCKED**, and the whole-census independent-component upper bound remains **unknown**.

## Completed discovery and review packages

| Work package | Verified result | Scientific limit |
| --- | --- | --- |
| [GPCRdb complement capture](gpcrdb-complement-metadata-2026-09-04/README.md) | 1,426 of 1,429 omitted accessions captured twice; 4,826 polymer entities | Coverage of the archived GPCRdb complement, not all relevant PDB entries |
| [Removed-accession reconciliation](gpcrdb-complement-replacements-2026-09-04/README.md) | Three explicit replacement links; two replacements already captured; union has 1,427 distinct current accessions | Aliases are not independent cases; 9J31 needs its own construct review |
| [Complement sequence screen](gpcrdb-complement-screen-2026-09-04/README.md) | All 4,826 entities screened; 663 heavy-domain-positive entities in 647 entries; three highest-priority ambiguous descriptors | Heavy-domain detection includes conventional Fab/scFv and does not establish VHH identity or receptor binding |
| [Complement priority source review](gpcrdb-complement-priority-review-2026-09-04/README.md) | 11 entries reviewed: three development-connected exclusions, three engineered-binding-site exclusions, five pending | Entry-level source assessments do not certify the formal leakage graph |
| [Historical Nb35 source review](nb35-source-review-2026-09-04/README.md) | 28 attempted; 12 supported auxiliary-binder exclusions; 16 awaiting primary full text | This is a scoped review of the historical remainder, not a complete census |
| [Publication-first search](publication-first-discovery-2026-09-04/README.md) | Five specified searches; all returned pages captured; 24 distinct bibliographic records | Records include reviews and publication versions; five queries cannot establish exhaustive literature coverage |
| [Five priority publication reviews](publication-accession-review-2026-09-04/priority-reviews.json) | Distinguishes isolated-binder structures, modeled complexes, development-linked fusions and experimental deposits | No new independent eligible GPCR component is established by this review |
| [Current GPCRdb comparison](gpcrdb-recent-delta-2026-09-04/README.md) | Two current captures match the archived 1,716 identifiers and normalized rows | An unchanged index can still lag recent deposits |
| [Independent recent RCSB discovery](rcsb-recent-discovery-2026-09-04/README.md) | 112 recent receptor-related metadata entries captured twice; independent domain controls recorded | Broad text hits include non-GPCRs; the receptor-domain panel has documented sensitivity gaps |
| [Recent sequence screen](rcsb-recent-screen-2026-09-04/README.md) | 744 polymer entities; 11 heavy-domain-positive entities in eight entries | A negative numbering result is not proof that a VHH is absent |
| [Recent priority source review](rcsb-recent-priority-review-2026-09-04/README.md) | All 24 queued entities across 11 entries reconciled; eight positive entries target IgE, viral RBD or GABAA channels | GABAA nanobodies seed a separate membrane-study review, at most one provisional shared-publication component |
| [Global annotation discovery](annotation-discovery-2026-09-04/README.md) | 386 receptor-domain / immunoglobulin-domain or camelid-source intersections; 142 previously uncollected entries captured twice | Known VHHs can lack the selected immunoglobulin annotations; these routes remain incomplete |
| [Annotation sequence screen](annotation-screen-2026-09-04/README.md) | All 719 polymers screened; 160 heavy-domain-positive entities in 141 entries | Direct binding, construct suitability and independence require source review |
| [Complete bibliographic record triage](publication-first-triage-2026-09-04/README.md) | All 24 records categorized; reciprocal preprint/publication links yield 23 publication families; seven exact-DOI deposits already known | Publication families are not independent benchmark components; review-reference mining remains open |
| [Citation follow-up](publication-followup-2026-09-04/README.md) | 60 citation gaps checked twice; seven new exact deposition links plus one known control; 22 other identifier-only recoveries | Thirty entries retain missing identifiers; metadata recovery does not adjudicate binding roles or exposure |

The six complement exclusions concern 6KNM, 6O3C and 8W1V (development connection), and 8HN1, 8HNN and 8K2W (a transplanted KOR intracellular binding segment). The 8HN1 publication was recovered from an exact deposition statement despite its missing frozen citation. Multiple receptor-entity UniProt mappings can represent a target plus a graft donor; they must not all become target-identity edges.

8T8M and 8TAO have exact full receptor and Nb43 sequence matches plus publication matches to historical 8T7H. This supports component linkage and does not add two independent components. Formal integration and remaining eligibility checks are pending. The three highest-priority ambiguous descriptor hits, 7Y89, 8J24 and 8J6L, have scFv-format evidence but unresolved whole-entry annotations or primary methods.

## Continuing work

The global annotation search, complete bibliographic record triage and citation-gap follow-up have now produced the additional packages above. Primary-source review of the resulting mGlyR, LGR4, ADGRV1 and rhodopsin leads is proceeding, together with metadata collection for additional accessions named in their deposition statements. New metadata candidates require the same sequence and primary-source review before they can affect a disposition or component claim.

An incidental citation-search result exposed structural contact-text categories for some entries during the publication follow-up. The follow-up package records the exact query, source and affected-entry boundary without copying contact pairs. A subsequent LGR4 source review also records incidental structural Results-prose exposure; those entries likewise remain subject to exposure review. Subsequent primary-source extraction is restricted to abstract, construct/sample methods and data-availability prose, with no structural Results, figure assets or contact-table inspection. Those entries require exposure review and remain blocked. This aggregate progress record does not claim that all search returns were free of geometry-derived text. No new coordinate files, native-pose images, holdout labels or model performance outputs were requested.

## Annotation-lead review and continuation

[The mGlyR/LGR4 source review](annotation-priority-review-2026-09-04/README.md) accounts for eight entries and all 23 deposited polymer entities. Seven exact primary deposition links are supported, including newly recovered citations for 9KGK and 9KHH. The 9S38 citation remains unresolved. These represent two receptor-linked discovery groups, with no formal independence claim. All eight remain pending construct and graph review; the six LGR4 entries additionally require exposure adjudication.

The mGlyR entries 9VOR and 9VOS share exact receptor and Nb20 sequences and one publication. Sequence comparison supports the Nb20 identity and confirms all seven receptor transmembrane segments, but the deposited receptor truncation and nanobody tag provenance remain unresolved. The LGR4 review likewise confirms seven transmembrane segments while retaining discrepancies between deposited sequences and experimental construct descriptions. Canonical sequence or accession nonmatches to development are not a formal disjointness certificate.

[The ADGRV1/rhodopsin review](annotation-additional-priority-review-2026-09-04/README.md) separates a partial ADGRV1 publication link from a Methods-supported rhodopsin megabody construct. Rhodopsin accession P02699 matches development 8FCZ. The short deposited megabody sequence does not fully specify the experimental scaffold. The additional accessions 9NNZ, 9NOZ and 9UOK have been captured twice with matching normalized metadata. The first two preserve a complete 514-residue megabody sequence and a receptor sequence identical to development 8FCZ; 9UOK contains a 556-residue MB52 polymer and retains the LGR4 exposure caveat. These seven additional polymer records do not establish new independent components.

The next executable census tasks are to reconcile the mGlyR cryo-EM preparation and tags from permitted Methods, resolve the ADGRV1 exact-deposition source and construct, audit the remaining receptor-domain entries without requiring antibody/taxonomy annotations, and perform explicit exposure and component review. Unavailable primary text for sixteen historical Nb35 entries remains a separate source-access blocker. No coordinate or label access follows automatically from these tasks.

## Remaining decisions

1. Reconcile newly discovered accessions and publication versions without double-counting replacements, repeated structures or shared studies.
2. Resolve direct versus auxiliary binder roles, full polymer inventories, engineered constructs, binder lineage and missing primary methods.
3. Integrate only evidence-supported receptor, VHH, publication and development connections into the formal leakage review; preserve unresolved and exposed entries.
4. Establish a defensible census scope and independent-component count before applying the minimum of ten eligible components. Any smaller GPCR panel remains exploratory, and a broader membrane-protein study requires its own protocol.

The verified source packages preserve their original responses, source hashes and non-authority fields. Offline replay tests cover the actual saved capture, normalization, sequence-screen and alias artifacts. The historical census, protocol locks and target-freeze state remain unchanged.
