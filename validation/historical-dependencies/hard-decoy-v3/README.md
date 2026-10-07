# Historical dependency input for the hard-decoy v3 evidence

This directory preserves the original root `package-lock.json` bytes named by
the unchanged August 29 numbering contract and later metadata-screen manifests.
Its SHA-256 is
`0dc4d6b441b0faf3c4ab3783115469cfc720fb8fc7cae36d225bc001ba174f54`.
The file was copied from Git before updating the live product dependencies.

The current product uses a separately patched dependency environment. Do not
install this archived lock as the product environment. Keeping this file does
not claim that current dependencies recreate the historical environment.

To verify the retained integration state, run:

```sh
node scripts/hard-decoy-v3/replay-historical-integration-state.mjs
```

The helper creates a disposable copy of retained evidence and scientific
scripts, verifies the archived lock against its fixed digest and the original
contract, and supplies it as the historical lock input. It also verifies the
exact installed `immunum` package metadata, JavaScript, WebAssembly and README
bytes used by the unchanged scientific implementation. No historical dependency
installation occurs. The original verifier still performs every checksum,
full reconstruction, scope and authority comparison. Tests retain their
tampering checks and use this context only for historical replay.

The original contract, scientific scripts, evidence, results and their hashes
are unchanged. Calling the original generator or verifier against the current
product root still rejects a mismatched lock. This replay facility does not
authorize new scientific generation or advance any blocked protocol gate.
