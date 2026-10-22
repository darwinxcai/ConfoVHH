# Product 0.9.1 dependency-security record

## Current maintenance review, 2026-10-22

The current application and QA dependency locks have been patched. The historical review below describes the earlier environment, not the current audit result. The frozen scientific contracts, their original lockfile hash and all recorded research results remain unchanged; historical replay uses [`scripts/replay-historical-v3.mjs`](./scripts/replay-historical-v3.mjs) and the checksummed archive in [`scripts/historical-v3-replay/`](./scripts/historical-v3-replay/), rather than rebinding it to this maintenance lockfile. The replay helper does not install the obsolete dependency tree.

| Gate | Current result |
|---|---:|
| Clean root and QA `npm ci` | pass |
| Root and QA `npm ls --all` | exit 0 |
| Full root `npm audit --audit-level=moderate` | 0 vulnerabilities |
| `node scripts/audit-advisories.mjs` | pass, 0 exceptions |
| Production `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| QA `npm audit --prefix qa --audit-level=moderate` | 0 vulnerabilities |

Next.js and its ESLint configuration move from 16.3.3 to 16.4.1, the first available version outside the current affected range; Vite moves from 8.2.2 to 8.2.4. Miniflare's exact vulnerable transitive pins are overridden with compatible patch versions, Sharp 0.35.5 and Undici 7.29.1. The Cloudflare plugin, Wrangler, Miniflare, React, Vinext and `immunum 1.3.0` versions are unchanged. Other affected transitive packages are updated within their existing major versions: `baseline-browser-mapping`, `brace-expansion` (including QA), `browserslist`, `fast-uri`, `fflate` and `source-map-js`. The three earlier advisory exceptions have been removed because their dependencies are fixed.

The remaining upstream `braces` advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), has no published fixed version as of this review. A small, explicitly identified local derivative supplies parser and AST depth guards instead of suppressing the advisory. See [`vendor/braces-depth-guard/README.md`](./vendor/braces-depth-guard/README.md) for the original license, exact provenance, modified files and limitations. It preserves normal brace expansion, limits structural nesting to 100 levels and rejects cyclic child ASTs before recursive processing. Six committed regression tests cover the exploit, alternative input routes, the boundary and normal behavior; 121 unchanged upstream assertions from six test files also passed against the patched library. The bash-dependent upstream suites were not included in that compatibility check.

The public advisory database cannot assess a local derivative. A zero audit count therefore does not replace review and regression testing of this patch. No advisory is allowlisted, the severity threshold is unchanged, and this record makes no claim of general safety for arbitrary hostile glob expressions. All application release and browser checks remain required; dependency audits alone do not establish application or scientific correctness.

## Historical review, 2026-08-29 and amendments (superseded by the current review)

Review date: 2026-08-29

Product 0.9.1 uses a security-patched dependency/build environment that is intentionally distinct from the historical v0.5 execution lockfile. The unchanged v0.5 evidence summaries retain their original hashes; exact historical implementation and `immunum 1.2.0` bytes are preserved in the checksummed `validation/v0.5-engine-implementation-snapshot-v1/` package.

After a clean `npm ci`, the current dependency state reports:

| Gate | Result |
|---|---:|
| `npm ls --all` | exit 0 |
| `node scripts/audit-advisories.mjs` (full tree, allowlist-aware) | pass, 2 reviewed exceptions |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix qa --audit-level=moderate` | 0 vulnerabilities |

Two advisories are allowlisted, both against `browserslist` and both development-only. They are recorded with their justification, scope and review date in [`security-advisory-allowlist.json`](./security-advisory-allowlist.json) and enforced by `scripts/audit-advisories.mjs`. Nothing else is suppressed. See the 2026-09-02 amendment below.

On the reviewed Linux host, npm 11.9.0 also prints three `extraneous` annotations after a pristine install: lockfile-pinned optional `@img/sharp-wasm32` 0.35.2 and 0.35.4 packages plus their `@emnapi/runtime` 1.11.3 dependency. Repeating `npm prune` leaves the same optional-platform annotations. Every named package has a registry URL and integrity digest in `package-lock.json`; `npm ls --all` exits 0, reports no invalid or missing dependency, and the production audit remains at zero vulnerabilities. This npm optional-dependency accounting is recorded for transparency and is not treated as a dirty source tree or a failed installation. A changed package set, nonzero graph exit, invalid dependency, or audit finding remains release-blocking.

## Historical amendment, 2026-09-02: former development-only exceptions

A `browserslist` advisory pair (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g, both high) began failing the
full-tree gate. Both are build-time only: `browserslist` reaches the graph through `eslint-config-next`
and `react-server-dom-webpack`, is absent from the production dependency tree, and
`npm audit --omit=dev --audit-level=moderate` continues to report zero vulnerabilities, so no ConfoVHH
user is exposed.

The fix is a five-package lockfile bump that clears both advisories. It is deliberately **not** applied
yet. The root `package-lock.json` digest is bound into the frozen pre-label numbering contract at
`validation/hard-decoy-holdout-v3/vhh-sequence-contract-2026-08-29.json`, whose status is
`VHH_SEQUENCE_PREGRAPH_RULE_FROZEN` with `targetFreezePermitted: false` and `executionAuthorized: false`.
That freeze exists so the analysis environment cannot move before the hard-decoy holdout is labelled and
executed, and the recorded remediation for changing it requires regenerating every profile, pair, matrix
row and component. Moving a pre-registration freeze to clear a build-tool advisory is the wrong trade;
the bump belongs in the next pre-registration window, with the regeneration the contract requires.

To keep the exception visible rather than silent, the full-tree gate is now
`scripts/audit-advisories.mjs`, which fails on any advisory at or above moderate that is not listed in
`security-advisory-allowlist.json`. Two properties are not waivable: an advisory reachable from the
production tree fails even when allowlisted, and an entry past its `reviewBy` date fails. Both entries
are set to `reviewBy` 2026-12-01, so the exception cannot outlive its review.

Structural note for the next advisory: the contract pins the entire root lockfile, so any dependency
patch anywhere in the tree collides with a numbering attestation it has no relationship to. Narrowing
that binding to the dependencies the numbering engine actually uses would remove the collision.

## Historical patched cohort

The reviewed update moves the coupled runtime/tooling families together:

| Family | Version at the historical review |
|---|---:|
| Next.js / ESLint config | 16.3.3 |
| React / ReactDOM / React Server DOM | 19.2.8 |
| Vite | 8.2.2 |
| Vinext | 1.0.0-beta.8 |
| Vite RSC plugin | 0.5.34 |
| Cloudflare Vite plugin | 1.54.2 |
| Wrangler | 4.127.1 |
| Cloudflare Workers types | 5.20260829.1 |

The update clears the previously recorded React Server DOM, Next.js, PostCSS, Sharp, Undici, WebSocket, Vite, and transitive parser/expansion advisories. The unused D1/Drizzle starter scaffold and its vulnerable legacy esbuild loader chain were removed; ConfoVHH has no database binding, database route, or server-side scientific-file upload endpoint.

## Product controls

ConfoVHH remains a read-only application. The Worker rejects every method except `GET` and `HEAD` before framework routing. Scientific coordinates and PAE files are processed in browser workers and are not uploaded to the service. The production build must continue to prove that the server/page bundles do not instantiate the IMGT WebAssembly module, while the dedicated audit worker does.

The generated `dist/server/vinext-externals.json` is required to remain empty. Public traffic is constrained by a same-origin-first content security policy, one explicit RCSB connect origin for the opt-in worked example, framing denial, MIME-sniffing denial, a restrictive permissions policy, and no user-controlled server action.

## Release requirement

Zero-advisory audit output is a point-in-time software-supply-chain result, not a biological-validation result. Release CI reruns clean installation, dependency-graph validation, full and production audits, typecheck, lint, production build, worker/SSR checks, the ordinary and adversarial suites, public producer regression, coverage, and Chromium acceptance. Any future dependency update must preserve the historical evidence packages without overwriting them and must repeat those gates.
