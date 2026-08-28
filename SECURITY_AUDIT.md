# Product 0.9.0 dependency-advisory triage

Review date: 2026-08-28

The root npm lockfile is part of the digest-attested scientific-engine v0.5.0 record. A current `npm audit --omit=dev` reports high-severity advisories against five installed package families: `next`, `postcss`, `nanoid`, `sharp`, and `fast-uri`. The isolated `qa/` lockfile reports zero known vulnerabilities. This record does not dismiss the advisories or claim that an installed vulnerable version is patched.

## Exposure review

| Package | Why it is installed | Product 0.9.0 exposure and control |
|---|---|---|
| `next@16.2.6` | Compatibility types/package for the Vinext application | Production is built and routed by Vinext, not the Next.js server. ConfoVHH has no Server Actions, authentication middleware, rewrites, or server-side user-data endpoints. The Worker rejects every method except `GET` and `HEAD` before framework routing. |
| `postcss@8.5.14` and `8.4.31` | Build-time CSS processing | It processes repository-controlled CSS during the build. PostCSS code is absent from the generated production bundles; users cannot submit CSS or source maps to the deployed service. |
| `nanoid@3.3.12` | Transitive PostCSS dependency | It is not imported by ConfoVHH and is absent from the generated production bundles. |
| `sharp@0.34.5` | Optional Next.js dependency and local Miniflare tooling | It is absent from the generated production bundles. Hosted image transformation uses the platform image binding and same-origin assets; ConfoVHH accepts no user image uploads. |
| `fast-uri@3.1.2` | Transitive schema/build tooling | It is absent from the generated production bundles and is not used for ConfoVHH URL authorization, outbound routing, or source-file parsing. |

The generated `dist/server/vinext-externals.json` is empty, and a release build contains no module markers for these five package families. Public traffic is additionally constrained by a same-origin-first content security policy, a single explicit RCSB connect origin for the opt-in worked example, framing denial, MIME-sniffing denial, a restrictive permissions policy, and no server-side scientific-file upload endpoint.

## Disposition

Product 0.9.0 treats the current findings as installed build/compatibility dependency risk, not as demonstrated reachable vulnerabilities in the deployed application. Builds must run in an ephemeral or otherwise non-sensitive environment and must never process untrusted repository CSS or configuration. Release artifacts include the complete CycloneDX SBOM so downstream scanners retain visibility.

The packages must be upgraded in a forward scientific-engine release, with a reviewed lockfile diff, new non-overwriting attestations, the complete offline/adversarial suite, public producer regression, coverage gate, and browser acceptance suite. The historical v0.5.0 lockfile and validation evidence will remain unchanged.

Advisory references: [Next.js middleware bypass](https://github.com/advisories/GHSA-6gpp-xcg3-4w24), [Next.js Server Action denial of service](https://github.com/advisories/GHSA-m99w-x7hq-7vfj), [PostCSS path traversal](https://github.com/advisories/GHSA-r28c-9q8g-f849), [fast-uri host confusion](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), and [sharp/libvips vulnerabilities](https://github.com/advisories/GHSA-f88m-g3jw-g9cj). The npm audit output contains the complete advisory set applicable on the review date.
