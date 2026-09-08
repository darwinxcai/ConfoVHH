# Historical source recovery: source-only verification

`receipt.json` records an executed, local byte-verification pass over the source
objects referenced by the pinned v0.5 implementation archive index. It verifies
29 source references representing 22 unique content-addressed source objects;
7 references reuse an already verified object. The receipt retains every
logical-path/object/hash mapping and observed byte length.

The exact archive index SHA-256 is
`d98f7766e660248d03771e3678bec5bfaf33da2072d45e034eb2e0596bf3b1e5`.
Only allowlisted `lib/*.ts`, `scripts/*.mjs`, `scripts/*.py`, `package.json`,
and `package-lock.json` references are read. The three excluded validation
metadata references are listed without opening their objects. Dependency
objects and historical summary files are not read; archived code is not
executed. The verifier performs no network requests.

Reproduce from the repository root, selecting a new output path:

```sh
node scripts/paper/verify-historical-source-archive.mjs --output=/tmp/confovhh-historical-source-receipt.json
node --test tests/historical-source-archive.test.mjs
```

Existing output files are never overwritten. Capture time and Node version
describe this execution; the deterministic `result` and verifier/helper source
hashes can be compared independently of those runtime fields.

This verifies source availability, not the complete historical execution
environment. Recorded combined implementation hashes include excluded metadata
and are retained as declarations rather than recomputed. The archive refers to
two historical attestation commits; it does not establish equivalence to the
frozen v3 engine commit `04c6bda2289157dd294c290609f6052aa0ef9195` or tree
`1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9`. The receipt explicitly keeps
`fullClosureVerified`, `exactFrozenCommitTreeEquivalenceEstablished`,
`executionVerified`, and `scientificAuthority` false. It cannot establish
candidate eligibility, independence, chronology, or prediction accuracy.
