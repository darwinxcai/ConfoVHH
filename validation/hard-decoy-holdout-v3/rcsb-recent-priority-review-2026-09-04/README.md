# Recent-release priority scope review

All 24 queued polymer entities have been reviewed across 11 entries. The 11 heavy-variable-domain detections occur in eight entries whose deposited target identities are outside the GPCR study population. These detections therefore do not establish eight additional GPCR–VHH targets.

| Entries | Heavy-domain positive entities | Deposited complex context | Scope assessment |
| --- | ---: | --- | --- |
| 30AC, 30AD, 30AE, 30AF | 4 | IgE-Fc with anti-IgE Fab heavy and light chains | Conventional Fab complexes targeting an immunoglobulin fragment |
| 9X9T | 2 | SARS-CoV-2 spike RBD with paired Fab heavy and light chains | Viral antigen/Fab complex |
| 9SL1, 9SLD, 9SLM | 5 | GABAA alpha4/beta3/delta channel with Nb24 and, in two entries, Mb30 | Ion-channel complexes; potential separate membrane-study leads |
| 9SQK, 9SS3, 9SVO | 0 | ASF1A histone chaperone with cr17, cr7 or cr5 | Three short, noncanonical sequences remain unresolved |

The other ten queued entities are lexical antibody matches or light/constant chains in the same complexes. Every queued entity retains its original identifier, sequence hash, screen status and source record. `entity-reviews.jsonl` accounts for all 24; `entry-reviews.jsonl` includes every deposited polymer entity in each of the 11 entries.

The GABA classification is supported by the [primary publisher's article record](https://www.nature.com/articles/s41467-026-76879-5), which categorizes the paper under ligand-gated ion channels, together with [UniProt GABRA4](https://rest.uniprot.org/uniprotkb/P48169.json), which identifies a GABA-gated chloride-channel subunit. The DOI matches all three PDB primary-citation records. These are GABAA channels, distinct from GABAB GPCRs. The retrieved publisher page contains abstract and metadata but no main Introduction, Methods or Results sections, so detailed Nb24/Mb30 role evidence has not been reviewed.

The GABA entries can seed the separate membrane-protein study, subject to unresolved eligibility. Under that draft's shared-publication rule, all three contribute **at most one provisional component**. They do not contribute three independent cases, and they must not be pooled with the GPCR benchmark. Existing development exposure, receptor-family dependence, binder lineage and generator training overlap remain unresolved. `membrane-study-seed.json` preserves those conditions and the following construct issues:

- 9SLM contains Nb24 only. 9SL1 and 9SLD contain Nb24 plus an entity labeled Mb30.
- The deposited Mb30 entity has 138 residues. Its descriptor does not establish completeness of the experimentally used megabody or its scaffold.
- Nb24 has 133 deposited residues in 9SL1/9SLD and 123 in 9SLM. The longer sequence is exactly the shorter sequence followed by `HHHHHHEPEA`. This observed suffix is retained; its experimental provenance is unreviewed and no canonical sequence is silently substituted.
- All three receptor-subunit sequence hashes match across entries, but some receptor descriptions and UniProt assignments differ. These construct and species annotations require reconciliation before generator inputs.

The cr peptides in 9SQK, 9SS3 and 9SVO have 18, 20 and 19 deposited residues, respectively, including unresolved `X` characters. Their metadata describes ASF1-binding foldamer/peptide work. The noncanonical-sequence flags provide neither a VHH identification nor proof that a VHH is absent. No residues are guessed.

The separate `fungal-gpcr-context.json` retains **9SH6**, which has positive GPCR metadata context but no confident heavy-domain detection in its five deposited polymer entities. It was outside the 24-row priority queue. An algorithmic negative is not an absence proof or a formal census exclusion.

This package establishes no new eligible GPCR–VHH complex and no whole-census upper bound. Formal disposition ledgers remain unchanged; the GPCR protocol remains DRAFT and target freeze remains BLOCKED. No native coordinates, binder poses, figures, holdout labels or model scores were inspected. HTML source capture did not download linked figures or supplementary files.

`source-facts.json` separates source observations from interpretation. The original publisher HTML, curated receptor JSON and Crossref record are retained under `sources/`, with request times and hashes in `source-capture-records.json`. The publisher identifies its article license as CC BY 4.0. `manifest.json` hashes the reviewed source files and the builder. The builder requires Python with lxml and reconstructs the review JSON from archived evidence; it is not a live source collector. `checksums.sha256` covers the complete review package.
