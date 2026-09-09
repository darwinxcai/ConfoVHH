# Zenodo source-availability observation, 2026-09-08

This packet records a bounded attempt to resolve the exact public producer-input
download failure without opening producer output files. It does not establish
that the original archive is absent, deleted, private, or scientifically invalid.

The existing regression downloads ten exact pinned files from public Zenodo
record [17063524](https://zenodo.org/records/17063524). The completed GitHub
Actions job
[102138793857](https://github.com/darwinxcai/ConfoVHH/actions/runs/34249150252/job/102138793857)
on commit `a62330ef4d619e9766222f3a57cba5f7d3958f8c` failed with HTTP 403 at the
first pinned file. All size and SHA-256 checks remain unchanged.

An earlier same-session observation at `2026-09-08T16:32:01.335684+00:00`
reported HTTP 200 from the official
[record metadata API](https://zenodo.org/api/records/17063524), JSON content,
13,755 response bytes, record ID 17063524, access `open`, and 19 files. That
response body was **not retained**. This is an observed summary, not a replayable
metadata capture; it does not establish that the file-download route was usable.

The two machine-written receipts here preserve the subsequent endpoint-review
attempts. Each requested only the same official record metadata API:

| Receipt | Start time (UTC) | Observation |
| --- | --- | --- |
| `record-metadata-receipt.json` | 16:35:39.590582 | urllib read operation timed out; no response body retained |
| `record-metadata-retry-receipt.json` | 16:36:30.823930 | One bounded same-URL retry; curl timed out after 25,002 ms with zero received bytes |

The retry followed a transient timeout, not an HTTP 403 or 429 response. No
further attempts were made in this review. No actual producer JSON, coordinate
file, confidence value, scientific outcome, or private credential was requested
or read. No alternative file endpoint was inferred or probed: the metadata
needed to verify an advertised endpoint was unavailable in these attempts.

**Remaining blocker:** recover a successful exact-byte producer regression from
the pinned public files, or first establish an officially advertised public file
endpoint for those same files and preserve the unchanged byte-count and SHA-256
checks. This packet supplies no evidence for changing a source URL, accepting
different bytes, skipping a required check, or merging a failing release.

This availability observation has no eligibility, ancestry, independence,
predictive-accuracy, or original GPCR–VHH input-reproducibility authority.

A later continuation made one official record-metadata request at
`2026-09-08T16:58:09.484287+00:00`, retaining its timeout observation in
`record-metadata-165809Z-receipt.json`. The current
[official developer documentation](https://developers.zenodo.org/#retrieve-a-record)
still describes this public record GET route. No record metadata
or advertised alternative file link was recovered in this attempt; no producer
file was requested. This adds an access observation, not a solution to the
required file-download gate.

The next continuation tried the public record HTML route through the web fetch
tool. It reported upstream HTTP 429 and exposed neither response headers nor a
retained response body. The observation is recorded in
`record-html-rate-limit-receipt.json`; no retry followed the rate-limit response.
No producer file was requested and no alternative file endpoint was recovered.
The exact producer gate remains unchanged.
