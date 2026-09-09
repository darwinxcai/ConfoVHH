# Data and code availability for the software/application paper

Updated 8 September 2026. This record distinguishes what a public reviewer can
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

## Partially reproducible

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
Full raw-to-result reproduction is not currently available because durable
public access and redistribution terms for the original coordinate and
confidence archives remain unresolved. Coordinates for 85 additional
preliminary cognate models and full PAE matrices are unavailable; analyses and
claims are therefore limited to the retained subset. The exact reviewed release
and archival DOI will be supplied before submission.

This wording must be updated if the data-access position changes and must be
checked against the selected venue's policy. It grants no permission to release
third-party or unpublished inputs.
