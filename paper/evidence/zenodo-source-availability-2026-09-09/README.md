# Public producer source availability, 9 September 2026

The exact public producer regression at starting commit
`3df9d9573cbbb73d749d2b3315f396fbec7fe52a` again failed with HTTP 403 in
[job 102240942799](https://github.com/darwinxcai/ConfoVHH/actions/runs/34279616607/job/102240942799).
This packet records a bounded review of the official record metadata route,
not a new download of the producer files.

| Retained receipt | Observation |
| --- | --- |
| `record-metadata-receipt.json` | One official record API request began at 02:32:59.929 UTC and timed out at 02:33:24.937 UTC; no response body retained |
| `record-web-tool-receipt.json` | One web open of the same official metadata URL returned a non-retryable tool rejection; no upstream HTTP status, headers or body were supplied; exact request time was not retained |

No retry followed the tool rejection. No original producer coordinate or score
file was requested in this review, and no officially advertised alternative
file endpoint was recovered. The tool rejection is not an HTTP 403 observation.
Neither observation establishes that the record is absent, private or invalid.

The unchanged release regression still requires successful access to all pinned
public files with their existing byte counts and SHA-256 identities. This record
authorizes no inferred fallback URL, replacement bytes, skipped gate or merge.
The Zenodo parser fixture is separate from the original GPCR–VHH application
inputs; fixing its download would not resolve their availability or establish
predictive accuracy. See the [prior observations](../zenodo-source-availability-2026-09-08/README.md).

`SHA256SUMS` binds the three evidence files in this packet. Access observations
have no scientific eligibility, exposure-clearance or independence authority.
