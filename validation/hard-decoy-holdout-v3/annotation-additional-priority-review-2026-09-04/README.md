# Additional annotation priorities and publication accession closure

This packet reviews ADGRV1/RE02 **9FTE** and rhodopsin/Mb7 **9NYX**, then follows three exact publication accessions with repeated metadata capture. It preserves four polymer inventories for the original entries and seven more for **9NNZ, 9NOZ and 9UOK**. All deposited sequences and SHA-256 hashes are retained. No target is cleared and no independent component is established.

| Entry | Evidence and remaining issue |
| --- | --- |
| 9FTE | The [candidate bioRxiv preprint](https://www.biorxiv.org/content/10.64898/2026.03.05.709805v1) is identified by first-party metadata and a primary PDF index phrase containing the exact accession. Direct HTML, JATS and PDF requests returned HTTP 429. Primary Methods and deposition verification remain pending. Deposited mouse receptor metadata versus the preprint's human-receptor description also needs reconciliation. |
| 9NYX | [Primary Methods and Data Availability](https://pmc.ncbi.nlm.nih.gov/articles/PMC12891041/) support a separately prepared bovine rhodopsin/Mb7 experimental sample and its exact deposition. Mb7 is a scaffold construct; the deposited 122-residue entity has 11 unknown residues. Its receptor accession P02699 matches development entry 8FCZ. |
| 9NNZ, 9NOZ | Both are named in that primary deposition paragraph. Two metadata captures agree for each entry. Each contains identical 514-residue Mb7 and 348-residue rhodopsin sequences; the receptor sequence exactly matches development 8FCZ. The longer binder sequences help explain the partial 9NYX record, but do not repair its unknown residues or certify a complete input. |
| 9UOK | The sibling LGR4 review identified this exact accession in [primary Data Availability](https://www.nature.com/articles/s41467-025-61545-z). Two captures agree across its three polymer entities. Construct adjudication and the sibling review's exposure caveat remain in force. |

`source-reviews.json` contains the two reviews, source scope, inventories and input digests. `development-reference-comparisons.json` compares their exact accession labels and full sequence hashes against all 17 development nodes. Exact nonmatches do not establish absence of a leakage edge.

`publication-closure/` retains the pinned GraphQL request, both responses, HTTP provenance, normalized inventories, manifest, archived collector source and metadata assessments. Normalization preserves null GPCRdb fields for these outside-index entries. It does not inherit another accession's preferred receptor chain. Both normalized responses agreed; all seven polymer sequence lengths and hashes were checked.

The main reviewer read only metadata, sequences, section headings, and relevant construct/sample Methods and deposition prose. A citation-recovery child also received incidental wider prose for 9FTE: qualitative receptor/loop states, caption fragments naming simulation observables, receptor residue ranges, simulation procedures and generic contact-definition thresholds. The child reported no residue-pair contact assignments, measured native contacts, binder orientation, or epitope/CDR contacts. `incidental-prose-exposure.json` preserves this scope without reproducing details. Secondary transcript text was not used as linkage evidence. No coordinates, maps, structural images, contact tables, model outcomes or holdout labels were accessed.

The next scientific actions are primary construct/deposition reconciliation for 9FTE and formal development/construct adjudication for the publication-linked entries. Discovery remains incomplete; the whole-census component upper bound remains unknown and target freeze remains blocked.

Verify retained file bytes from this directory with `sha256sum -c checksums.sha256`. Checksums establish artifact integrity, not scientific eligibility.
