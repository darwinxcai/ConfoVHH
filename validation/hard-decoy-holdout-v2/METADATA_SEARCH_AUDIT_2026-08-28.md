# Metadata-only GPCR-VHH search audit

Status: **independent search audit; not a target manifest and not authorization to execute**

Cutoff: 2026-08-28 UTC.

This audit extends the blocked screening snapshot in
`prelabel-census/` without changing its terminal
`TARGET_CENSUS_BLOCKED` state. It used public metadata only. No candidate
coordinate file, native pose, native interface, DockQ/CAPRI label, ConfoVHH
result, or holdout performance result was opened or emitted.

## Frozen query shape

Each term was submitted separately to
`POST https://search.rcsb.org/rcsbsearch/v2/query` with this body:

```json
{
  "query": {
    "type": "terminal",
    "service": "full_text",
    "parameters": {"value": "<TERM>"}
  },
  "return_type": "entry",
  "request_options": {
    "paginate": {"start": 0, "rows": 10000},
    "results_content_type": ["experimental"]
  }
}
```

Identifiers were uppercased, deduplicated, sorted bytewise, serialized one per
line with a terminal newline, and hashed with SHA-256.

| Term | Unique entries | Sorted-ID SHA-256 |
|---|---:|---|
| `nanobody` | 1,760 | `a66f26fce4498ba07dc2eb46bd5ba1c5440f671209775e9496ce7b82bd194795` |
| `VHH` | 475 | `0ad358494867265303e46afe24f7122508d98a6717c6d5ae26059b5e4adef614` |
| `camelid` | 188 | `43fbe51adbd46533cc7855e8f5ce5f3e85752d45790e97b057a68b253a21b41c` |
| `megabody` | 59 | `c63071f001fb61779eafddfed99b5b41826f2f8c04f798ad4cd833fb6cf37d91` |

The four-term union contained 2,065 unique entries and had SHA-256
`c154b8a9780f0d7a898a9fed77bbc54f2b18572830840d55ead625ede647f0ca`.

## GPCR inventory intersection

The GPCR inventory was retrieved from `GET https://gpcrdb.org/structure/`.
The response contained 7,918,869 bytes and had SHA-256
`e12185d20153e7e3844319f5ca1d24eb31ec05d2181442320dd6b40ac2be1f3c`.
The first HTML table was parsed by iterating `tbody/tr`, taking direct cell
`td[7]` as the PDB code, then applying the same uppercase, deduplication,
sorting, newline, and hashing rules.

- GPCRdb rows: 1,716
- unique PDB codes: 1,716
- duplicate PDB codes: 0
- sorted code-list SHA-256:
  `4a0e3a35472703207a8d9615071f78a5d397e7281698dc5047b2c38bfc77e861`
- four-term RCSB union intersected with GPCRdb: 287 entries
- sorted intersection SHA-256:
  `fa51175683d9f4f02ded64c6e7ce82fd64ee339dae7be8dbd32c3e9af546dba7`

The term counts, response-byte digest, code-list digest, intersection count,
and intersection digest were independently reproduced before this record was
committed.

## Audit correction

An internal draft reported an intersection of 387. Independent reproduction
showed that 387 belonged to a broader, noisier seven-term union that also used
`single-domain antibody`, `single domain antibody`, and
`single chain antibody fragment`. RCSB tokenizes those multi-token searches
broadly. The incorrect attribution was corrected before this record was
committed; the four-term result is 287.

## Scientific disposition

The metadata review reported no credible eighth provisional candidate under
the current screening heuristics. Newly surfaced direct-looking systems were
reported as collapsing into an existing provisional group, overlapping a
development receptor or VHH system, using a grafted development epitope, or
being auxiliary/fusion constructs.

The 287 entry-level disposition rows were not frozen in this record, so the
curation conclusion is not independently reconstructible from the counts and
hashes alone and does not update the formal census. It is not a global upper
bound: depositor terminology can omit all four terms, GPCRdb can lag new PDB
releases, and metadata alone cannot establish an atom-level direct interface.
The formal group count therefore remains zero cleared and seven provisional in
the blocked census; no target set is frozen or executable.
