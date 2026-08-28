# Security policy

## Supported release

Security and data-integrity fixes target the current `main` branch and latest published product release.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose local files, bypass parser/resource limits, execute untrusted content, corrupt provenance, or produce misleading scientific exports. Report it privately through GitHub's private vulnerability reporting feature when available.

Include the affected release, browser or Node version, minimal reproduction, expected behavior, and observed behavior. Do not attach proprietary or unpublished structures.

## Data-handling model

ConfoVHH performs coordinate and PAE analysis in the browser. The application does not intentionally upload selected source files or place raw coordinates/PAE matrices into its local summary notebook. Exported dossiers may contain derived contacts, metrics, hashes, user notes, and provenance, so researchers should still review exports before sharing them.
