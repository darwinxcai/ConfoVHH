# GPR158 / Nb20 deposition construct metadata

New selected deposition fields establish the recorded expression hosts for all
six polymers in **9VOR and 9VOS**. Exact cryo-EM receptor truncation and Nb20
tag/preparation identity remain unresolved. This review adds **zero independent
eligible groups** and changes no prior disposition or exposure record.

The [RCSB Data API](https://data.rcsb.org/graphql) returned the exact retained
article DOI, PMID and sequences for all six entities. Both receptor entities
report HEK293 expression; the RGS7 and Gβ5 entities in 9VOS do likewise. Both Nb20
entities report the host name `Escherichia coli 'BL21-Gold(DE3)pLysS AG'`.
These are primary deposition metadata, not an independent validation of the
reagents or their preparation.

The selected fragment, mutation, vector, plasmid and source-detail fields return
null. A null response is not evidence that a modification or relevant source
document is absent. The returned source ranges index the deposited polymers;
they do not establish canonical receptor truncation or tag cleavage. The general
nanobody production Methods retained in the prior source packet describe
`E. coli BL21 DE3` and C-terminal tags. The host labels do not identify those assay
and cryo-EM constructs as the same material.

## New repository route

An exact-DOI OpenAlex query identified a previously unexamined
[HAL record](https://hal.science/hal-04994632) for the cited 2022 preparation
article, DOI `10.1126/science.abl4732`. HAL's official selected-field API confirmed
the DOI and record, but returned neither the requested main-file nor external
file URL field. No preparation Methods were obtained. This observation applies
to the captured fields and does not establish general document unavailability.
OpenAlex's OA/license labels remain discovery metadata, without primary-license
authority.

## Provenance and limits

`raw/` preserves exact request and response bytes for the deposition queries,
schema discovery and bibliography/location metadata. `retrieval-attempts.json`
records endpoint, request hashes, response hashes and timestamps. It also
preserves the schema-only query rejected because it requested two field lists;
the following schema queries requested one type each. No failed supplementary
download endpoint was retried.

`source-review.json` binds the current observations to five retained input
digests and lists all six sequence checks. Repository locations serve only as
access leads. No article Results, captions, figures, structural tables, native
coordinates, relative poses, labels or prediction outputs were requested or
reviewed.

From this packet directory, verify the retained file inventory with:

```sh
sha256sum --check checksums.sha256
```

The evidence still required is a primary preparation statement explicitly
linking the receptor's Q5T848 residues 1–775 plus LEVLFQ and Nb20's deposited
N-terminal prefix to the cryo-EM reagents. Host metadata cannot substitute for
that link. Development/census ancestry, global overlap, exposure and formal
eligibility reviews also remain outside this packet's authority.
