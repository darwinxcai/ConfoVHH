# GPCRdb recent inventory delta

This metadata-only package compares two current captures of [GPCRdb's structure inventory](https://gpcrdb.org/services/structure/) with the immutable 2026-08-29 snapshot.

- Archived inventory: 1716 entries. Current observed inventory: 1716.
- New index entries: 0; removed entries: 0; existing entries with metadata changes: 0.
- First PDB release after 2026-08-29: 0; older PDB entries newly indexed: 0; unresolved release dates: 0.
- New entries with repeat-confirmed RCSB metadata: 0; unresolved: 0.
- Both inventory identifier sets agree: true; both full inventory metadata sets agree: true.

Raw files preserve exact bytes returned by fetch after transport decoding. Response records retain request times, server dates, HTTP status, selected headers, request and response SHA-256 values, and failures. RCSB requests use the existing pinned metadata query with polymer sequences, chain identifiers and publication metadata. No coordinate files, rendered structures, relative poses or holdout labels were requested.

This is a partial recent-release discovery route. An unchanged GPCRdb index is not evidence that no new public GPCR structures exist: indexing can lag or omit entries. New index membership is not itself a new PDB release. An independent RCSB release-date/receptor search and the other reconstruction routes remain required. No target eligibility or exclusion is assigned here; the protocol remains DRAFT and its target-freeze gate remains BLOCKED.

The release cutoff means the end of 2026-08-29 UTC, not the precise retrieval instant of the historical inventory. Changed existing metadata and removals are retained separately and do not rewrite the old snapshot. If a capture fails or its identifier sets disagree, the removed-ID file is empty and the summary marks its count unresolved; it must not be interpreted as zero removals.

Replay without network access:

```sh
node scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs verify
```

A future collection requires a new, nonexistent output directory:

```sh
node scripts/hard-decoy-v3/capture-recent-gpcrdb-delta.mjs collect /absolute/path/to/new-snapshot
```
