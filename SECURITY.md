# Security policy

## Supported release

Security and data-integrity fixes target the current `main` branch and latest published product release.

The current installed-dependency findings, deployment exposure review, and forward-remediation requirement are recorded in [SECURITY_AUDIT.md](./SECURITY_AUDIT.md). Release SBOMs intentionally retain the complete dependency inventory for independent scanning.

## Reporting a vulnerability

Please do not open a public issue containing vulnerability details that could expose local files, bypass parser/resource limits, execute untrusted content, corrupt provenance, or produce misleading scientific exports. Use [GitHub's private vulnerability report](https://github.com/darwinxcai/ConfoVHH/security/advisories/new). If that form is unavailable, open a detail-free issue titled `Security contact request`; the maintainer can then establish a private channel before you share a reproduction.

Include the affected release, browser or Node version, minimal reproduction, expected behavior, and observed behavior. Do not attach proprietary or unpublished structures.

## Data-handling model

ConfoVHH performs coordinate and PAE analysis in the browser. The application does not intentionally upload selected source files or place raw coordinates/PAE matrices into its local summary notebook. Complete audit and dossier exports do contain selected protein sequences, residue-level contact tables, metrics, hashes, user notes, and provenance, though not raw coordinate text or complete PAE matrices. Review every export before sharing it.
