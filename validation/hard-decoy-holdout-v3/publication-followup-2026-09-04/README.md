# C.5 citation-gap follow-up, 2026-09-04

This package recovers bibliographic identifiers and checks whether selected primary articles explicitly name the exact deposited accession. It records **seven new exact primary-publication links**, plus the previously reviewed 8HN1 positive control. It makes no new binder-role decisions, whole-entry exclusions, leakage-component assignments, or holdout eligibility decisions. Target freeze remains blocked.

The input union contains 287 historical entries and 1,426 captured GPCRdb-complement entries, for 1,713 distinct entries. The three unresolved accessions from the original complement capture are handled in the separate replacement package and are outside this package's input union. A gap means at least one frozen primary-citation DOI or PMID is absent. All 60 gaps were queried, including entries without antibody signals; signals determine priority only.

| Measure | Result |
| --- | ---: |
| Citation-gap entries | 60: 7 historical, 53 complement |
| Entries with antibody-evidence priority | 40 |
| Missing DOI / missing PMID at input | 37 / 60 |
| Current RCSB citation entries captured twice | 60 |
| Bibliography requests | 100: 60 exact-PDB, 13 existing-DOI, 27 frozen-title queries |
| Bibliography hit rows across these queries | 574 |
| New exact primary-deposition links | 7 |
| Previously verified exact-link control | 1 |
| Other bibliographic identifier recoveries | 22 |
| Entries with all missing identifiers recovered | 30 |
| Entries with identifiers still missing | 30 |
| New role adjudications / entry dispositions | 0 / 0 |

Hit rows may repeat the same paper across queries and do not count independent studies. Every returned page for the 100 planned/adaptive bibliography queries is captured; all returned hit counts fit one page. The API echoes the URL-encoded initial cursor as `%2A`; replay recognizes that encoding of `*` and verifies exact returned counts. Six additional supporting reviewer queries are archived separately. Two of those supporting queries are partial (25 of 47 records and 50 of 59 records); they are excluded from the 100-query completion claim. This bounded search does not establish that an unresolved entry has no publication.

The two RCSB captures agree across every requested citation field for each accession. The only change relative to the frozen DOI/PMID/title values is an extra space in the 6KUX title. RCSB itself supplied no missing DOI or PMID; recovery here comes from bibliography matching and explicit primary-source deposition statements.

| Exact accessions | Primary source | Relation |
| --- | --- | --- |
| 7TRK, 7TRP, 7TRQ, 7TRS | [eLife 83477](https://doi.org/10.7554/eLife.83477) | Four exact M4 receptor study deposits |
| 7Y35, 7Y36 | [Nature Communications 34009](https://doi.org/10.1038/s41467-022-34009-x) | Two exact PTH1R study deposits |
| 8GAG | [Nature Communications 57136](https://doi.org/10.1038/s41467-025-57136-7) | Exact CB1R study deposit |
| 8HN1 | [Communications Biology 08405](https://doi.org/10.1038/s42003-025-08405-0) | Previously verified positive control; not a new link |

These are accession-to-publication links, not independent biological components. `source-notes.json` contains 23 bounded source notes, including title-only candidates, related samples with different accession lists, structure reuse, unavailable sources, and unresolved entries. In particular, the journal article candidate for 6H7N is not substituted for its frozen preprint DOI; the related ADGRG2 article naming 7XM6 is not substituted for 7YP7. Holdings checks report 7XM6 as withdrawn/unreleased and 7YP7 as current, with no replacement mapping established. Reuse papers and title similarity do not establish original deposition.

## Evidence and replay

- `collection-plan.json` defines the exact input digests, gap selection, and 79 original requests (six RCSB repeats and 73 bibliography requests). `adaptive-requests.json` adds 27 title queries.
- `raw/` retains exact API response bytes. `captures/` retains the corresponding HTTP capture records. The collector source hash in `capture-manifest.json` remains unchanged from collection.
- `supporting-bibliography-manifest.json` describes six supplementary bibliography captures, their echoed requests, and missing HTTP timing/header provenance.
- `followup.jsonl`, `bibliography-hits.jsonl`, and `summary.json` are deterministic offline outputs of `replay.py`, using archived responses and explicit source notes.
- Primary article bodies remain outside the repository. Source URLs, available retrieved-byte hashes, and access limitations are recorded. `source-hash-review.json` records a byte-only check of 18 referenced hash claims across 11 existing source files; these matched at finalization. This is an integrity check of the recorded captures, not a new reading or independent confirmation of the manual source interpretation. Replaying the repository does not require those temporary source files.
- `checksums.sha256` inventories every retained package file except the checksum file itself.

Run from the repository root:

```sh
python3 -B validation/hard-decoy-holdout-v3/publication-followup-2026-09-04/collect.py verify
python3 -B validation/hard-decoy-holdout-v3/publication-followup-2026-09-04/replay.py verify
python3 -B validation/hard-decoy-holdout-v3/publication-followup-2026-09-04/verify_tests.py
(cd validation/hard-decoy-holdout-v3/publication-followup-2026-09-04 && sha256sum -c checksums.sha256)
```

The four regression checks replay the actual packet with network access disabled and reject a rehashed wrong query option, a rehashed disagreement in repeat author metadata, and a changed prior-review digest. The verifier checks frozen input hashes, the collection-time collector hash, request identities, raw-byte hashes, HTTP status/content type, bibliography query echoes and complete returned counts, full citation repeat agreement, prior-review references, and exact derived outputs. Manual primary-source claims remain explicitly separate from machine-replayed API evidence.

## Exposure boundary and outstanding work

`exposure-caveat.json` preserves three incidental text exposures: an unopened 8IA8 search snippet containing residue/contact classifications; an unopened 7TRK-family data-collection/refinement table snippet; and one 8J23-related caption sentence containing a qualitative loop-stabilization comparison. The latter reports no residue identities, contact pairs, coordinates, distances, or angles. Contact pairs are not reproduced in this package. None of these snippets is used for citation linkage, candidate selection, or eligibility.

No native coordinate file, structure image, or holdout label was requested or inspected in this package. Structure-related prose was incidentally visible, so this package does not claim that all such text remained unseen. Formal exposure clearance is incomplete and target freeze remains blocked. The remaining work includes unresolved citation fields, exact-deposition verification for bibliography-only matches, permitted source/construct/role review, formal component accounting, and exposure review under the frozen study protocol. Neither this route nor the broader census is marked complete.
