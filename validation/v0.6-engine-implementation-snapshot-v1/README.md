# v0.6 engine implementation attestation

This package binds the scientific-core implementation bytes the product currently
executes, and the executed `immunum` bytes, content-addressed by SHA-256.
`index.json` restores each logical path, records the v0.5 digest beside the current
one, and names exactly which files the v0.6 VHH numbering promotion changed.

It supersedes nothing. `validation/v0.5-engine-implementation-snapshot-v1` remains
byte-identical and continues to bind the historical execution environment that the
v0.5 public-regression and DockQ replay attestations were produced under. This
package answers a different question: what runs now.

The promotion changes one pinned file, `lib/vhh-numbering.ts`. The generating script
asserts that set and fails if the promotion touched anything else.

`package.json` and `package-lock.json` appear in `index.json` with their digests but
have no object here. They are recorded, not pinned: the pin excludes them because the
dependency environment is separately patched, the lockfile alone is 456 KiB, and the
v0.5 snapshot already preserves the historical manifest bytes.
