# Release provenance

ConfoVHH uses two version namespaces:

- the researcher-facing product release, currently 0.9.0;
- the digest-attested scientific engine and root npm package, currently 0.5.0.

Product changes do not relabel the scientific engine or frozen validation evidence.

## Historical evidence boundary

The Sites source history used for this product contains the referenced historical commits as ancestors, including scientific-engine commit `04c6bda2289157dd294c290609f6052aa0ef9195`, public-regression commit `5cb57617b54baa314513486885c402449f643406`, replay commit `278ae1a74da133778fba5b17bc296a8e37f02e76`, and census-start commit `a4dffa87913b364eb5fc7c220ac2b75011ad0c0a`. They are therefore resolvable in that source history. A fresh clone of the current public GitHub repository does not contain these objects, however, and GitHub's commit API does not resolve them. They must not be described as independently reachable from public GitHub.

The underlying evidence remains digest-verifiable: each preserved package records implementation-file, raw-source, dependency, result, and package checksums. Release receipts bind those unchanged checksum manifests to a publicly reachable `product-vX.Y.Z` tag and Git tree. This forward binding improves public traceability; it neither publishes the historical commit objects nor adds scientific evidence.

## Automated product release

After CI succeeds on the current `main` commit, the release workflow:

1. rechecks that the successful commit is still the head of `main`;
2. reruns the offline release gate and exact public producer-output regression;
3. creates byte-reproducible source and production-bundle archives;
4. generates a CycloneDX SBOM, a provenance receipt, and `SHA256SUMS`;
5. creates the annotated `product-vX.Y.Z` tag and GitHub Release without publishing the private npm package.

The JSON receipt records the product and engine versions, commit and tree, exact CI run, runtime versions, root and QA lockfile hashes, the dated security-triage hash, scientific checksum-manifest hashes, release-asset hashes, hosted URL, and negative validation boundaries. Release creation fails if the citation version, product tag, checked-out commit, or Git tree is inconsistent.

## Verification

Download every asset from the GitHub Release into one directory, then run:

```bash
sha256sum --check SHA256SUMS
```

Compare the receipt's `source.commitSha` and `source.treeSha` with the annotated release tag. The hosted application is deployed separately from the same reviewed source tree and is verified after publication.
