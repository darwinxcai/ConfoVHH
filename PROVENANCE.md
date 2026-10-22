# Release provenance

ConfoVHH uses separately versioned layers:

- the researcher-facing product release, currently 0.9.1;
- the canonical audit and geometry lineage, which remains version 0.5.0 for compatibility with the frozen v0.5 studies;
- promoted VHH-numbering and pose-ranking policies, both versioned 0.6.0 with additive promotion and validation records.

A component promotion does not rewrite or relabel frozen historical evidence. The `validation/v0.5-engine-implementation-snapshot-v1/` package preserves the scientific-core objects and executed `immunum 1.2.0` bytes used by the v0.5 studies. Current production VHH numbering uses pinned `immunum 1.3.0`; `validation/v0.6-engine-implementation-snapshot-v1/` binds the exact current scientific-core bytes and records that `lib/vhh-numbering.ts` is the sole promoted file in the pinned scientific-core set. The root dependency/build environment is separately security-patched and is not represented as the historical attested lockfile.

## Historical evidence boundary

The Sites source history used for this product contains the referenced historical commits as ancestors, including scientific-engine commit `04c6bda2289157dd294c290609f6052aa0ef9195`, public-regression commit `5cb57617b54baa314513486885c402449f643406`, replay commit `278ae1a74da133778fba5b17bc296a8e37f02e76`, and census-start commit `a4dffa87913b364eb5fc7c220ac2b75011ad0c0a`. They are therefore resolvable in that source history. A fresh clone of the current public GitHub repository does not contain these objects, however, and GitHub's commit API does not resolve them. They must not be described as independently reachable from public GitHub.

The underlying evidence remains digest-verifiable. Across the preserved packages, all applicable implementation, raw-source, dependency, result, and package files are checksummed; design-only packages do not claim executed dependencies or results. Release receipts verify every listed checksum row, bind the current v3 source snapshot, both independently timed entry-metadata captures, the original public entry attestation, integration state, licenses, and import receipt, and then bind those digests to a publicly reachable `product-vX.Y.Z` tag and Git tree. The two entry captures retain distinct raw response bytes and timestamps but replay to identical normalized entry, entity, and triage ledgers. Semantic package replay remains a separate CI gate. This forward binding improves public traceability; it neither publishes missing historical commit objects nor adds scientific evidence.

## Automated product release

After CI succeeds on the current `main` commit, the release workflow:

1. rechecks that the successful commit is still the head of `main`;
2. reruns the offline release gate and exact public producer-output regression;
3. creates two normalized archives of the exact commit and fails unless they are byte-identical;
4. inventories the exact already-built production output twice and publishes only a matching file-path/byte-count/SHA-256 manifest—not the credential-bearing bundle bytes;
5. generates a CycloneDX SBOM, a provenance receipt, and `SHA256SUMS`;
6. creates the annotated `product-vX.Y.Z` tag and GitHub Release without publishing the private npm package.

The JSON receipt records the product and engine versions, commit and tree, exact CI run, runtime versions, root and QA lockfile hashes, the dated security-triage hash, verified scientific checksum-manifest roots and file counts, standalone v3 evidence digests, release-asset hashes, hosted URL, and negative validation boundaries. It also binds the production-output manifest and records that no production-bundle archive or credential-bearing bundle bytes were published, that the manifest is not deployable, and that a fresh verified build is required for deployment. Independent production compilation is neither verified nor claimed. Vinext emits fresh per-build credentials, so independently built chunk hashes can differ; ConfoVHH does not replace those credentials with public constants merely to force byte identity. Release creation fails if any listed package checksum, citation version, product tag, checked-out commit, Git tree, or exact-output manifest is inconsistent.

## Verification

Download every asset from the GitHub Release into one directory, then run:

```bash
sha256sum --check SHA256SUMS
```

Compare the receipt's `source.commitSha` and `source.treeSha` with the annotated release tag. The production-build manifest is inspection/attestation-only: it contains hashes of a CI bundle whose server output used per-build framework credentials. It is not a deployment artifact. Build a fresh production bundle from the annotated source tag before deployment so new credentials are minted. The hosted application is built and deployed separately from the same reviewed source tree and never reuses a published production bundle.
