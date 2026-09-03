# Dependency policy

ConfoVHH separates the frozen scientific-engine dependency record from product-assurance tooling.

## Scientific-engine and product dependencies

The unchanged v0.5 evidence summaries bind their original `package.json` and `package-lock.json` hashes. The checksummed `validation/v0.5-engine-implementation-snapshot-v1/` package preserves those exact historical objects and reconstructs both original combined implementation digests. Historical artifacts are never rewritten.

The live root manifests describe the security-patched product environment. The package and canonical audit version remain `0.5.0` for compatibility with the attested geometry-core lineage, but the current lockfile is explicitly **not** represented as the historical attested environment. Tests preserve the historical v0.5 source and executed `immunum 1.2.0` bytes in the v0.5 snapshot while separately binding the current production scientific-core bytes and executed `immunum 1.3.0` engine in the v0.6 snapshot; `dependencyEnvironmentMatchesAttestedV05` remains false.

A root dependency update requires review of the direct and transitive diff, clean installation, full and production audits, the complete release/coverage/browser matrix, and a new product receipt. Any change to scientific calculations additionally requires a forward scientific-engine version and new non-overwriting validation evidence.

Security reports are triaged immediately. A published artifact is never silently relabeled as patched.

The dated [product dependency-security record](./SECURITY_AUDIT.md) records exact audit gates, current versions, exposure controls, and the historical-attestation boundary.

## Product-assurance dependencies

The independent `qa/` package contains browser, accessibility, and coverage tooling only. It has its own exact package manifest and lockfile and does not enter scientific calculations. Dependabot checks the root npm graph weekly, grouping the coupled React/Next/Vinext/Vite/Cloudflare cohort for joint review, and checks the isolated QA graph monthly.

GitHub Actions references are pinned to full commit SHAs. Dependabot checks those pins weekly. Every automated update must pass the full CI matrix before merge.

## Review checklist

- Confirm the update is in the intended root, `qa/`, or Actions dependency domain.
- Review release notes, integrity metadata, licenses, and known vulnerabilities.
- Run the offline release gate, coverage floor, Chromium acceptance/accessibility suite, and public producer regression.
- For scientific-engine changes, generate new forward-versioned attestations; never modify frozen evidence directories.
