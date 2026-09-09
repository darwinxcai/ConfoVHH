# Two preserved synthetic replays

The current product security patch changes the complete root lockfile. Two
preserved synthetic evidence tests therefore cannot reproduce their original
source-bound receipts in that patched context. The new fixed runner executes
the unchanged original tests inside the separately provisioned original
workspace at source revision `b19cae064f621f97fb460da0d401fba7aa140f1a`.
Existing receipts, contracts, tests, dependency hashes and CI gates are unchanged.

| Fixed recipe | Original test file | Required tests |
| --- | --- | ---: |
| `reviewer-exports` | `tests/paper-reviewer-browser-evidence.test.mjs` | 1 |
| `audit-report-ranks` | `tests/audit-report-rank-export.test.mjs` | 11 |

The first recipe compares saved toy browser exports with their preserved
generator receipt; it does not open a browser or establish an independent
participant's completion. The second replays the generated toy coordinate,
report, rank and separately supplied synthetic-label workflow, alongside its
existing malformed-input and accounting checks. Neither recipe reads native or
predicted biological structures, biological outcome labels or candidate metadata.

From the current checkout, after provisioning the original workspace and an
existing directory for the new receipt:

```sh
node scripts/paper/run-historical-synthetic-replays.mjs \
  --workspace=/absolute/original/workspace \
  --output=/absolute/new-receipt.json
node --test tests/historical-synthetic-replays.test.mjs
```

The plan `historical-synthetic-replay-plan-2026-09-09.json` is itself SHA-256
pinned by the runner. It binds 63 original files: complete root package/lock,
all library TypeScript (also hashed by the original receipts), explicitly
reviewed script/test imports and hash-only source references, the exact
immunum package/JavaScript/WASM, and both synthetic evidence inventories.
Source and fixture identities are verified before and after each child runs.
Unexpected library files, evidence files, symlinks, nested package scopes and
shadowed immunum resolution are rejected. The invocation cannot select another
test or add filters. Exact test names/counts, zero failures/cancellations/skips/
todos, successful exit and unchanged identities are all required.

Children receive a small environment allowlist that excludes Node hooks,
credentials, proxy settings and inherited test context. Each has a 180-second
timeout and a combined 1 MB output limit. On POSIX, termination addresses the
child process group. The version-specific Node 22.23.2 WASM inlining workaround
matches the existing historical runner. Tests may create and remove their own
synthetic temporary files; no original evidence is overwritten. Receipts must
be new files outside the historical workspace and preserve command, runtime,
source identities, complete bounded TAP output and its hashes.

This is a bounded source/dependency identity check, not complete dependency
closure, exact historical runtime equivalence, a filesystem sandbox or network
isolation. The reviewed fixed tests use no network, but the harness does not
enforce a network sandbox. Identity checks before and after execution do not
constitute protection against concurrent malicious workspace mutation. All
library files are bound for provenance; their inclusion does not imply every
one executes. The synthetic workflow gives no biological or predictive
validation authority. Broader historical metadata replays, current product
verification, live browser checks and required CI integration remain separate
work. No CI routing or test exclusions are introduced here.
