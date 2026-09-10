# Data and code availability for the software/application paper

Updated 10 September 2026 (UTC). This record distinguishes what a public reviewer can
reproduce now from what still requires external data access. It is suitable as
the source for a venue-specific data-availability statement, but it is not a
claim that all underlying application inputs are public.

## Publicly reproducible now

- The MIT-licensed source, tests, documentation and release workflow are in the
  public [ConfoVHH repository](https://github.com/darwinxcai/ConfoVHH).
- The committed retrospective summaries and selection analysis have public
  standard-library replay tests. These reproduce the reported derived tables
  and consistency checks; they do not reconstruct unavailable original models.
- The [claim/evidence manifest](CLAIM_EVIDENCE.json) binds seven manuscript
  statements to 14 exact evidence files and records their SHA-256 digests,
  evidence class and interpretation boundary. Verify it with:

  ```bash
  node scripts/paper/verify-claim-evidence-manifest.mjs
  node --test tests/paper-claim-evidence.test.mjs
  ```

- The [reviewer guide](REVIEWER_GUIDE.md) generates a synthetic offline example
  and records input, output and implementation hashes. The official Boltz
  parser smoke is also synthetic. Neither is an application-study observation.

## Separate completed ten-candidate pilot

The repository now includes the [3P0G execution03 package](../validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03/README.md):
ten raw coordinate and predictor-confidence files, all ten full PAE matrices,
original generation/runtime/evaluation receipts, prior failed/not-run records,
reference coordinates, and a byte-verified CPU ranking reproduction with
post-outcome interface analysis. The frozen MSAs, protocol and dependency locks
remain in their original locations. The package supplies coordinate-to-ranking
replay; reproducing GPU generation is a separate operation requiring the pinned
external model assets and runtime. No new generation is needed to inspect or
replay this result.

The [new pilot claim/evidence manifest](evidence/single-case-3p0g-selection-failure-2026-09-09/claim-evidence-v1.json)
truthfully records new analysis and access to predictions and the native
reference. It is separate from the unchanged historical seven-claim manifest.
The original negative outcome and the post-outcome diagnostics are separately
named. Verify the package with
`python3 scripts/paper/verify-single-case-pilot-evidence.py`.
This adds one development-exposed case, not independent validation, and does
not recover any of the historical missing models or PAE matrices below.
A stable archival identifier for the submitted release is still outstanding.

## Partially reproducible historical application

The public repository contains the retained derived application and selection
artifacts, their provenance records, checksums and tests. These support replay
from committed derived evidence. They do not provide full raw-to-result replay
because durable public access and redistribution terms for the original
coordinate and confidence archives have not been resolved.

The retained application contains 165 cognate models. Coordinates for 85 other
preliminary cognate models remain unavailable, and the missingness is not known
to be random. Full PAE matrices are absent from the retained cohort. Summary
confidence values are not substituted for PAE. Any submitted paper must retain
these limitations and define its analyzed population as the retained subset.

## Not yet available

- A stable archive and DOI for the exact submitted software release.
- A permitted public archive of the original retained coordinate/confidence
  inputs, with a hash-bound manifest and redistribution terms.
- The 85 missing preliminary cognate coordinate models and full PAE matrices.
- An independent researcher's completed workflow-evaluation record.

If the original retained inputs cannot be distributed, the final statement must
name the access restriction or custodian and the exact procedure, if any, for
legitimate access. No such custodian, permission or procedure is asserted here.
The paper may still report a retained-subset application only if the selected
venue permits this arrangement and the public derived replay is described
precisely.

## Private archive recovery leads

A [metadata-only archive search](evidence/input-archive-candidates-2026-09-08/README.md)
located three verification archives and two handoff/evidence archives by exact
filename, with their reported sizes. No archive payload or member was opened.
These are possible recovery routes, not verified original-input availability:
their contents, identity with retained inputs, missing-model/full-PAE membership
and redistribution terms remain unknown. No missingness count or public
reproducibility claim changes. A custodian-provided member inventory and
distribution terms would allow the next metadata comparison without exposing
restricted prediction or coordinate data.

## Provisional manuscript statement

ConfoVHH source code, documentation, synthetic reviewer inputs and verification
tests are publicly available in the project repository under the MIT license.
The repository also contains checksummed derived tables and standard-library
replay tests for the reported retrospective application and selection analysis.
For the historical 165-model application, full raw-to-result reproduction is
not currently available because durable public access and redistribution terms for the original coordinate and
confidence archives remain unresolved. Coordinates for 85 additional
preliminary cognate models and full PAE matrices are unavailable; analyses and
claims are therefore limited to the retained subset. The exact reviewed release
and archival DOI will be supplied before submission.

This wording must be updated if the data-access position changes and must be
checked against the selected venue's policy. It grants no permission to release
third-party or unpublished inputs.
