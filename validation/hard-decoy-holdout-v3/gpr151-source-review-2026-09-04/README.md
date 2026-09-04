# GPR151/NB6 construct and development review

**9W3K and 9W3L have strong sequence evidence of an engineered KOR-segment/NB6 construct and a positive development VHH match. Native-GPR151 binding is not established.** Primary Methods remain inaccessible, so the graft mechanism and donor provenance are inferences rather than source-confirmed facts.

| Evidence | Result | Limit |
| --- | --- | --- |
| Complete deposited inventories | 9W3K has five polymer entities; 9W3L has two. Both contain identical 419-aa receptor and 127-aa NB6 sequences. | Separate receptor and binder entities do not establish native recognition or complete experimental construct provenance. |
| Canonical receptor comparison | Two identical [UniProt Q8TDV0](https://rest.uniprot.org/uniprotkb/Q8TDV0.json) captures establish 33 sequence differences: four outside a changed 31-aa block and 29 within it. | Deposited sequence comparison cannot resolve expression tags or sample processing. |
| Development receptor segment | The changed 31-aa block exactly matches development KOR 6VI4; the longest shared segment is 32 aa. | This supports a KOR-segment engineering interpretation, but does not prove the design procedure or binding mechanism. |
| Frozen VHH sequence criterion | Against development 6VI4 Nb6, framework identity is 88/91 (96.70%) and CDR3 is 15/15 with equal length. All three CDRs are identical. | This is a positive sequence criterion, not a formal leakage edge or entry exclusion. |
| Reference comparison | All 18 frozen development profiles reproduce exactly; only 6VI4 passes the VHH criterion. Nb39 references 5C1M and 6B73 fail it. | Failure against another reference is not formal no-edge evidence. |

The [published abstract](https://www.pnas.org/doi/10.1073/pnas.2534234123), retrieved through Europe PMC, describes NELiS, four stabilizing mutations and subsequent identification of a GPR151-specific nanobody. It does not identify that later binder as the NB6 deposited in these two entries. The four abstract-reported mutations are not assumed to explain all 33 sequence differences. Publisher HTML and an unverified conventional supplement URL returned HTTP 403; primary Methods and exact deposition text were not obtained.

The source metadata for NB6 names *Spodoptera frugiperda*. That annotation is preserved and is not treated as proof of antibody origin. Source taxonomy and the name “NB6” are insufficient for binder classification.

`source-reviews.json` retains both complete polymer inventories, hashes, source limitations and separate fact/inference fields. `sequence-evidence/` contains repeated canonical metadata, numbered profiles, all reference comparisons and original execution scripts. `sequence-evidence-relocation.json` maps their original temporary execution paths to retained package files without changing the captured bytes. The original numbering and affine alignment helpers were used; no new threshold was introduced.

Replay offline from the repository root:

```sh
node validation/hard-decoy-holdout-v3/gpr151-source-review-2026-09-04/replay-sequence-evidence.mjs --repository-root .
```

The portable wrapper also accepts `--evidence-directory`, `--output-directory` and `--python`. Its output directory must be empty; by default it creates a new temporary directory. It verifies original source and scientific-input hashes, relocates only execution paths in temporary script copies, and leaves the archived scripts unchanged. It compares the complete scientific outputs, omitting only the NB6 report's runtime `createdAt`, `repositoryRoot` and `executionScript` fields. Receptor input-path prefixes are mapped to package-relative filenames; their hashes remain compared. The three additional inventory outputs must reproduce byte-for-byte. `replay-report.json` records both original and relocated source hashes. No live source request is made.

Only metadata, canonical sequences, author abstract and sequence-based topology annotation were reviewed. No structural Results, captions, contact residues, orientations, images, coordinates or holdout labels were inspected. No formal exclusion or independent-component gain is assigned. Primary construct/deposition reconciliation and formal leakage adjudication remain pending; target freeze remains blocked.

Verify retained bytes from this directory with `sha256sum -c checksums.sha256`. Artifact integrity does not establish scientific eligibility.
