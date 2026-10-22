# Publication-first record triage — 2026-09-04

All 24 records captured by `publication-first-discovery-2026-09-04` now have an evidence-based bibliographic category. This extends the five existing priority reviews to the remaining 19 records. It establishes no additional eligible independent GPCR–VHH component and makes no scientific entry exclusion.

| Record category | Records | Interpretation |
| --- | ---: | --- |
| Experimental GPCR structural candidate | 4 | GPBAR, MC4R, AT1R and ADGRG2 papers require entry/construct/role adjudication; a paper naming a deposition does not establish an eligible receptor–VHH reference pose. |
| Experimental GPCR binder, no new complex reference established | 2 | ACKR3 and MRGPRX2 evidence retained from the five priority reviews. |
| Experimental GPCR nonstructural study | 2 | Beta2AR native mass spectrometry and endosomal signaling experiments. |
| Methods or computational reuse | 3 | Diffraction-data reanalysis, M2 molecular dynamics and cryo-EM reconstruction methods. |
| Non-GPCR target study | 5 | ELIC/5-HT3 ion channels, Patched1 publication and preprint, MelB transporter and staphylococcal toxins. |
| Review or perspective | 8 | Backward citation mining remains open. |

These are record counts, including both versions of the Patched1 study. Crossref explicitly records `10.1101/783290` as a preprint of `10.1073/pnas.2011560117`, and the publication record supplies the reciprocal relation. Both source records remain in the inventory, assigned to one publication family. The resulting **23 publication families are not an independent benchmark sample size**. No title-based deduplication was used.

## Deposition reconciliation

Two identical exact-primary-citation DOI queries for nine GPCR-relevant original studies returned the same seven experimental entry IDs, with total count equal to the returned count in both responses:

| Paper / target | Indexed PDB IDs | Existing evidence |
| --- | --- | --- |
| GPBAR, `10.1073/pnas.2117054119` | 7XTQ | Primary data statement names 7XTQ and EMD-33452; 7XTQ is already in the historical 287-entry metadata inventory. |
| ACKR3, `10.1038/s41467-024-49000-x` | 8UEK | Existing priority review: isolated nanobody NMR, with a computational receptor complex. |
| MC4R, `10.1038/s41467-024-50827-7` | 8QJ2 | Existing priority review; actual deposited construct requires reconciliation. |
| AT1R, `10.1073/pnas.2423931122` | 9EAH, 9EAI, 9EAJ | Existing priority review of deposited receptor–nanobody fusion constructs and development exposure. |
| ADGRG2, `10.1038/s41589-025-01896-2` | 8YKD | Existing priority review; experimental reference pose for the paper's target nanobody is not established. |

No extra accession was found beyond these existing reviews and the historical GPBAR metadata. The GPBAR entry contains a polymer named Nanobody-35; this observation does not assign its formal binder role. An exact-DOI index miss is not proof of no deposition: citation indexing may lag, another publication may be the primary citation, and supplemental resources may exist. Queries and both raw responses are archived.

## Evidence and remaining work

`bibliographic-reviews.jsonl` retains every input source ID, DOI, category, interpretation, source references and remaining evidence. `publication-families.json` records the explicit version linkage. `primary-source-facts.json` separates the additional primary-paper facts from inherited priority reviews. Existing package paths in per-record source lists are relative to `validation/hard-decoy-holdout-v3/`; paths beginning `sources/` refer to this directory. The manifest records full repository-relative input paths and hashes.

The new capture contains abstract metadata for all 23 PubMed records, two Crossref version records, three successful primary-article XML captures and one preserved failed full-text request. M2 paper full-text XML returned HTTP 404 with an empty body; its abstract explicitly describes molecular-dynamics simulations, but the failed request cannot establish full-text or deposition absence. The reconstruction methods paper reuses existing ribosome/PTCH1 datasets, including EMPIAR-10328. The diffraction paper mines existing PDB structure-factor data. These method categories are supported by article prose, rather than inferred from titles.

ELIC/5-HT3, Patched1 and MelB can seed a separate membrane-protein literature route, without pooling them into the GPCR census. Review reference mining remains incomplete. The five prior priority reviews and all unresolved construct, binder-role, developmental-exposure and independence questions are retained. The formal ledger is unchanged; protocol status remains **DRAFT**, target freeze **BLOCKED**, and the whole-census upper bound is unset.

Only bibliographic metadata, deposited sequence metadata and article prose were used. No coordinates, figure assets, native relative binder poses or DockQ labels were accessed.

## Reproduction

From the repository root, verify the package's byte inventory:

```sh
cd validation/hard-decoy-holdout-v3/publication-first-triage-2026-09-04
sha256sum -c checksums.sha256
```

`build-triage.py` requires Python 3 and `lxml`. Running it rebuilds the six derived JSON/JSONL files entirely from archived sources and existing input packages, without network requests. It asserts the exact PubMed record coverage, reciprocal version linkage, repeat search agreement and accession reconciliation. The rebuilt manifest receives a new `createdAt`; rebuilding therefore requires a new checksum inventory. The archived capture records independently preserve source request URLs, HTTP status/date, response hashes and exact POST request-body hashes.
