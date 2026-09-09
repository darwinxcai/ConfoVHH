# Preserved historical integration-state replay

The patched product lockfile cannot reproduce every original source-bound
metadata receipt. This fixed runner executes the unchanged historical
integration verifier and its complete original test file in a separately
provisioned workspace at source revision
`b19cae064f621f97fb460da0d401fba7aa140f1a`.

| Fixed recipe | Original entry point | Required result |
| --- | --- | --- |
| `integration-verifier` | `scripts/hard-decoy-v3/verify-integration-state.mjs` | Exact original JSON accounting; `DRAFT`, target freeze `BLOCKED`, zero formally cleared groups, no approval/execution authority |
| `integration-tests` | `tests/hard-decoy-v3-integration-state.test.mjs` | Both unchanged original tests, including authority/access/count/threshold rejection assertions |

The integration verifier replays the archived design and census contracts,
source universe, both normalized entry-metadata captures, disposition seed,
development metadata, exact-evidence pregraph, VHH sequence pregraph and bounded
census audit. This recomputes metadata/sequence analyses, including live immunum
numbering and sequence comparisons. It reads preserved metadata and sequences;
it does not execute the native oracle, read native or predicted biological
coordinates, read biological outcome labels, or fetch new evidence.

The [Node 24.19.0 receipt](evidence/historical-integration-replay-2026-09-09/receipt-node24.json)
and [Node 22.23.2 receipt](evidence/historical-integration-replay-2026-09-09/receipt-node22.json)
record successful unchanged verifier replays and **2/2 original tests on each runtime** with
all 190 file identities preserved before and after both recipes. The runner's
11 focused tests cover identity drift, dependency shadowing, strict output
accounting and output-location protections. These checks establish software
replay behavior, not independent biological validation.

From the current checkout, with the original workspace and a new receipt's
parent directory already present:

```sh
node scripts/paper/run-historical-integration-replay.mjs \
  --workspace=/absolute/original/workspace \
  --output=/absolute/new-integration-receipt.json
node --test tests/historical-integration-replay.test.mjs
```

The SHA-256-pinned plan
[`historical-integration-replay-plan-2026-09-09.json`](historical-integration-replay-plan-2026-09-09.json)
binds 190 files: both complete original root manifests, the 12-module verifier
import closure and original integration test, installed immunum package/JS/WASM,
11 exact evidence inventories, and the additional protocols, contracts,
attestations, correction and ancestry controls. Identical bytes and inventories
are required before and after each recipe. Installed numbering code is checked
before historical import, which itself initializes WASM. Nested package scopes,
competing ancestor immunum packages, symlinks, hardlinks and unexpected evidence
files reject. Both CommonJS and conditional-exports shadowing are covered by
the competing-package rejection.

Commands, recipe order, expected JSON result and both original test names are
fixed. The caller cannot add filters or choose another test. Acceptance requires
successful exit, exact TAP indices and plan, both tests passing and zero failed,
cancelled, skipped or todo tests. Children receive a small environment allowlist
without inherited Node hooks, test context, credentials or proxy settings. Each
child has a 180-second timeout and 1 MB combined output cap, with process-group
termination on POSIX. The Node 22.23.2-specific WASM inlining workaround matches
the existing historical runner. New receipts are exclusive-created outside the
historical workspace and retain full bounded stdout/stderr, hashes, arguments,
runtime and source identities. Original evidence is never rewritten.

The runner's identity checks are bounded provenance verification. They do not
establish complete dependency closure, exact runtime equivalence, a filesystem
sandbox, network isolation or protection against concurrent malicious mutation.
The source-commit field is an authenticated plan's claim; the runner checks its
listed bytes rather than asserting the entire Git tree is clean or identical.
The fixed reviewed verification branches do not invoke collectors or writers.

This work preserves an additional historical assertion set; it does not complete
mandatory current/historical CI routing, current-product release verification,
all historical replays, frozen scoring-engine recovery or predictive evaluation.
The seven provisional census groups remain provisional; independently cleared
eligible groups remain **0** and predictive accuracy remains **unmeasured**.
No frozen protocol, original assertion, access boundary or scientific gate is
relaxed.
