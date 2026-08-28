# Dependency policy

ConfoVHH separates the frozen scientific-engine dependency record from product-assurance tooling.

## Scientific-engine dependencies

The root `package.json` and `package-lock.json` identify scientific engine v0.5.0 and are digest-bound by the preserved validation attestations. Automated dependency-update pull requests therefore do not target the root npm package. A root dependency update requires an explicit scientific-engine release, review of the dependency and transitive diff, a fresh clean-tree validation run, regenerated non-overwriting attestations, and an updated engine version. Historical artifacts are never rewritten.

Security reports affecting a frozen dependency are triaged immediately. Affected behavior is isolated or patched in a new engine release; a published artifact is not silently relabeled.

The dated [product dependency-advisory triage](./SECURITY_AUDIT.md) records known findings, observed bundle exposure, compensating controls, and the required forward-release path. A scope assessment is not a patched-version claim.

## Product-assurance dependencies

The independent `qa/` package contains browser, accessibility, and coverage tooling only. It has its own exact package manifest and lockfile and does not enter scientific calculations. Dependabot checks that package monthly.

GitHub Actions references are pinned to full commit SHAs. Dependabot checks those pins weekly. Every automated update must pass the full CI matrix before merge.

## Review checklist

- Confirm the update is in the intended root, `qa/`, or Actions dependency domain.
- Review release notes, integrity metadata, licenses, and known vulnerabilities.
- Run the offline release gate, coverage floor, Chromium acceptance/accessibility suite, and public producer regression.
- For scientific-engine changes, generate new forward-versioned attestations; never modify frozen evidence directories.
