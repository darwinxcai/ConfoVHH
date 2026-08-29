# Product 0.9.1 dependency-security record

Review date: 2026-08-29

Product 0.9.1 uses a security-patched dependency/build environment that is intentionally distinct from the historical v0.5 execution lockfile. The unchanged v0.5 evidence summaries retain their original hashes; exact historical implementation and `immunum 1.2.0` bytes are preserved in the checksummed `validation/v0.5-engine-implementation-snapshot-v1/` package.

After a clean `npm ci`, the current dependency state reports:

| Gate | Result |
|---|---:|
| `npm ls --all` | exit 0 |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix qa --audit-level=moderate` | 0 vulnerabilities |

No advisory is suppressed or allowlisted.

On the reviewed Linux host, npm 11.9.0 also prints three `extraneous` annotations after a pristine install: lockfile-pinned optional `@img/sharp-wasm32` 0.35.2 and 0.35.4 packages plus their `@emnapi/runtime` 1.11.3 dependency. Repeating `npm prune` leaves the same optional-platform annotations. Every named package has a registry URL and integrity digest in `package-lock.json`; `npm ls --all` exits 0, reports no invalid or missing dependency, and both full and production audits remain at zero vulnerabilities. This npm optional-dependency accounting is recorded for transparency and is not treated as a dirty source tree or a failed installation. A changed package set, nonzero graph exit, invalid dependency, or audit finding remains release-blocking.

## Patched cohort

The reviewed update moves the coupled runtime/tooling families together:

| Family | Current version |
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
