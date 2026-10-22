# Independent RCSB recent-release discovery

This package searches experimental PDB entries initially released from 2026-08-30 through 2026-09-04 UTC. The end-date filter is exclusive at 2026-09-05; coverage is limited to what was indexed at the recorded request times, not future releases later in the nominal window.

Four Pfam annotation queries and six complementary text queries were each repeated twice. The text terms are GPCR, two quoted forms of G-protein-coupled receptor, Frizzled, Smoothened, and receptor. The broad receptor term intentionally retains false positives for subsequent sequence and role review. Four older PDB IDs serve only as positive controls for the domain-query mechanism and are never added to the recent candidate set.

- Observed recent candidate entries: 112.
- Repeat-confirmed discovery queries: 10/10.
- Confirmed domain controls: 4/4.
- Repeat-confirmed entry metadata: 112; unresolved: 0.
- Candidates absent from the archived GPCRdb inventory: 112.
- Specified query capture complete: true.

The [official RCSB search schema](https://search.rcsb.org/rcsbsearch/v2/metadata/schema) and [search documentation](https://search.rcsb.org/) establish attribute names, date filters, nested-annotation grouping, and pagination. Pfam accession identities are archived from the [InterPro API](https://www.ebi.ac.uk/interpro/api/). Annotation type and accession are grouped together to refer to the same nested annotation object. Pagination uses 100 IDs per page, checks total counts and gaps, and fails incomplete after 20 pages rather than silently truncating. HTTP 204 with an empty body is retained as a zero-result response; failed HTTP requests remain unresolved.

| Pfam accession | Verified short name | Scope |
| --- | --- | --- |
| PF00001 | 7tm_1 | rhodopsin-family membrane domain |
| PF00002 | 7tm_2 | secretin-family membrane domain, also found in adhesion GPCRs |
| PF00003 | 7tm_3 | family-3 membrane domain |
| PF01534 | Frizzled | Frizzled/Smoothened membrane region |

This is not an exhaustive GPCR classification. Other noncanonical or nonvertebrate receptor families, domain-poor or truncated constructs, unannotated receptor sequences and delayed Pfam assignments are not guaranteed coverage. The generic receptor text query helps recover some omissions but provides no exhaustive guarantee. A hit can be an unrelated receptor, an isolated receptor fragment, or a GPCR without a VHH. Eligibility, direct binding role and independent leakage components remain unresolved. The protocol stays DRAFT and target freeze stays BLOCKED.

All raw request and response bodies, query definitions, HTTP statuses/dates, hashes, per-page results, failures, normalized metadata and checksums are archived. RCSB entry capture uses the pinned existing GraphQL metadata query. No coordinates, native interface geometry, rendered structures, model scores or holdout labels were requested.

Replay without network access:

```sh
node scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs verify
```

Future capture of this same historical date window requires a new output directory:

```sh
node scripts/hard-decoy-v3/capture-recent-rcsb-discovery.mjs collect /absolute/path/to/new-output
```

## Control correction and capture provenance

The first PF00001 control mistakenly used 5UZ7, a calcitonin receptor entry classified as class B1 in the archived GPCRdb metadata. Its two zero-result responses are retained as a class-mismatch check. The corrected class-A control uses beta2-adrenergic receptor entry 3SN6, requested twice after the correction. This changes the control interpretation, not the date-bounded discovery queries or the candidate set.

The initial collector source, manifest, response records and query definitions are preserved under provenance/. The original collector digest remains unchanged in the manifest. A second capture epoch records the exact corrected source used for the additional control requests. The final replay digest is separate, so earlier capture records are not attributed to subsequently edited code. The official schema document contains legitimate escaped newlines in descriptions; only this external documentation document uses ordinary JSON parsing. Search responses and study artifacts retain strict duplicate-key rejection.
