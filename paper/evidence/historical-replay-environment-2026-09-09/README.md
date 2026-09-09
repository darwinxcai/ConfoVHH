# Historical replay environment identity preflight

This is a bounded prerequisite for the proposed execution separation in draft
PR #57, not that separation's implementation or approval. Historical producers,
frozen contracts and receipts remain unchanged. Current product dependency
checks must continue to use the patched graph.

## Verified scope

`identity-plan.json` binds the complete original package manifest and lockfile,
the VHH pregraph producer and its three local static-import sources, plus the
installed immunum package metadata, JavaScript and WASM. Source bytes were read
from commit `b19cae064f621f97fb460da0d401fba7aa140f1a`; package hashes agree with
the earlier dependency-patch receipt. The plan has an independently pinned digest
in `scripts/paper/verify-historical-replay-environment.mjs`.

The preflight rejects changed bytes, missing/duplicate/unsafe paths, symlinked
ancestors, ambient NODE_OPTIONS/NODE_PATH and producer-relative package shadowing.
It checks the original complete root lock before source or module payloads. It
does not import the producer or package and does not open scientific inputs.
The package uses its verified `main` entry without conditional exports; the
resolution probe uses Node's `createRequire` from the producer's location. It
does not simulate arbitrary ESM loader hooks or certify runtime equivalence.

Run from a clean process against a designated historical workspace:

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/paper/verify-historical-replay-environment.mjs /absolute/historical/workspace
node --test tests/historical-replay-environment.test.mjs
```

On 9 September 2026, the retained original workspace passed all nine identity
bindings and local package resolution on Node 24.19.0. The separate patched
worktree rejected at the complete lockfile byte count (448017 versus historical
466779), before inspecting modules. An initial attempt with ambient Node
configuration also rejected as intended; a new clean-environment invocation
passed. These observations are not historical replay results.

Nine synthetic tests verify the bounded acceptance and rejection behavior,
including same-length corruption, missing dependencies, nested module shadowing,
symlinks and caller mutation during asynchronous checks. Lint uses the retained
original ESLint installation with an explicit original config because this
worktree has no installed dependency graph; it is not patched-graph validation.

## Remaining integration requirements

1. Define and review a source/input inventory and separate invocation context for
   every affected producer, not just this VHH import chain. Root-directory
   substitution alone is insufficient.
2. Provision and verify the historical dependency graph and runtime in an
   appropriately isolated context. This preflight neither installs packages nor
   establishes security isolation. Do not ship known-vulnerable historical
   dependencies as the current product or waive its advisory gate.
3. Execute unchanged historical checks from that context and current product
   checks against the patched graph. Capture new browser receipts as new
   executions, without relabeling old receipts.
4. Pass every required release gate, including the separate exact public
   producer download, before any merge or archived release.

File checks are a read-only preflight for a quiescent trusted workspace, not an
OS sandbox or a guarantee against concurrent hostile filesystem mutation. The
plan's recorded commit is a provenance claim; byte verification does not prove
execution at that commit or complete dependency closure. No scientific result,
formal disposition, eligibility, frozen-engine or predictive-accuracy authority
is granted. Independent eligible groups remain 0; predictive accuracy is
unmeasured.
