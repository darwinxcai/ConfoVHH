# Isolated product dependency patch, 9 September 2026

**Draft; blocked from integration.** The patch remedies two dependency findings
from CI run [34304741740](https://github.com/darwinxcai/ConfoVHH/actions/runs/34304741740)
on publication-branch head `b19cae064f621f97fb460da0d401fba7aa140f1a`.
It changes the current product package and lockfile, while preserving all
scientific source, frozen contracts, historical manifests and receipts.
The preserved historical replay gate correctly rejects the new root lockfile.
This packet is not a release receipt or evidence of scientific validation.

## Verified findings and bounded patch

| Finding | Existing path | Exact patched resolution |
|---|---|---|
| [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), moderate: invalid arguments may terminate the process | Production dependency `next@16.3.3` → `baseline-browser-mapping@2.10.30` | Override mapping to `2.11.0`, the published patched version; the [maintainer release](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.0) is available |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), high: upstream libheif vulnerabilities affect processing untrusted images | Development dependency `@cloudflare/vite-plugin` → `miniflare@5.20260828.0-alpha` → `sharp@0.35.2`; Next already used `sharp@0.35.4` | Override only Miniflare's Sharp requirement to `0.35.4`, the maintainer's patched minimum |

The dependency diff is limited to baseline-browser-mapping and the Sharp
closure. npm deduplicates the pre-existing Next Sharp subtree into the patched
root `sharp@0.35.4`; platform Sharp packages move to `0.35.4` and their libvips
packages to `1.3.3`. No direct framework version or scientific-engine dependency
was upgraded. `dependency-diff.json` records every changed/removed package path.
Registry integrity metadata is retained in `package-lock.json`.

Both hosted jobs installed successfully, then exited at the existing advisory
gate before running release tests. `hosted-failure-excerpts.log` preserves the
relevant decoded log lines and job URLs. The advisory sources above were checked
on 9 September; these were real reported findings, not a transient registry
failure. The gate's production-tree classification establishes graph reachability,
not a demonstration of a working exploit against this application.

## Verification in the isolated checkout

Node `24.19.0` was used. After a clean `npm ci`:

| Command | Result |
|---|---|
| `npm ls --all` | Exit 0; complete graph retained in `dependency-graph.log` |
| `node scripts/audit-advisories.mjs` | Exit 0; both new findings resolved; the same three previously recorded development-only exceptions remain |
| `npm audit --omit=dev --audit-level=moderate --json` | Exit 0; zero production vulnerabilities reported at this execution |
| `npm run lint` | Exit 0, with 21 pre-existing warnings and no errors |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; existing verified build command completed |

No audit exception, threshold or gate was added or weakened. The full release,
coverage and browser matrix was not rerun on this graph and has not passed.
The built files are transient; no claim of complete served-build identity or
an independently reproduced production bundle is made.

`gate-results.json` records exact audit commands, exit codes and log hashes.
`patch-receipt.json` identifies both complete lockfiles, the current manifest,
and the unchanged installed `immunum` package/JavaScript/WASM bytes. Identical
scientific dependency bytes do not make the changed full lockfile satisfy an
existing full-lock contract.

## Preserved blocker and proposed next work

The unchanged command

```bash
node scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs verify validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29
```

exits 1 with **`Pinned dependency lock digest drifted.`** This check occurs
before sequence-input loading or matrix computation. `historical-gate-failure.json`
records the command and failure without biological outcomes. The expected digest
in the frozen contract was not changed.

Read-only source review identifies additional historical dependencies on the
current root lock: `scripts/hard-decoy-v3/verify-integration-state.mjs`,
`scripts/paper/verify-reviewer-exports.mjs`, and the preserved complement,
domain-development, MGlyR and phrase-chunk replay producers. A package-only
update cannot pass all their unchanged historical bindings. These additional
gates were not rerun as part of this packet.

A separate proposal is to preserve the original package/lock and unchanged
producer sources in an explicitly historical replay workspace, execute those
producers from within that workspace, and verify their exact scientific
dependency bytes. Current product verification would continue against the
patched graph. This requires a designed and independently reviewed separation
of execution contexts; passing a different root to a live imported module alone
is insufficient because producer self-hashes and module resolution are also
bound. No such harness or routing change is implemented here. Historical
receipts must remain unchanged, and any new current-product browser evidence
must be captured as a new execution.

This draft must remain blocked until that preservation design is reviewed and
implemented without weakening the contracts, all applicable current and
historical gates pass in their declared environments, and the normal release
evidence is regenerated. The separate public producer download failure also
remains unresolved by this patch. No independent eligible group or predictive
accuracy measurement is added.
