# One explicit historical VHH metadata replay

The patched checkout called the unchanged historical VHH producer as a child
process inside the separate original workspace at source revision
`b19cae064f621f97fb460da0d401fba7aa140f1a`. It did not import that producer into
the current checkout while merely supplying a different data root.

The existing pinned nine-file identity plan verifies the original complete
manifest/lock, producer import chain and immunum bytes/resolution before and
after execution. The new runner also pins the unchanged VHH contract and
snapshot checksum inventory. Its command is fixed to `verify`; it cannot
select `generate`, arbitrary arguments, another script or another snapshot.
Output is bounded and the child is subject to a 180-second limit. The result
must retain the original blocked status and every non-authority field.

`execution.json` records a successful exact metadata/matrix replay under Node
24.19.0. The original producer performs its existing nested input/hash and
exact-output verification. Metadata and sequence inputs were read; no native
holdout/prediction coordinates or outcome labels were accessed. Frozen inputs,
policies, sources, digests and prior receipts remain unchanged.

From the proposed revision, with a separately provisioned original workspace:

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/paper/run-historical-vhh-replay.mjs \
  --workspace=ORIGINAL_WORKSPACE --output=NEW_RECEIPT.json
```

The command rejects the current patched workspace and any original-identity
drift. It neither installs dependencies nor provisions a sandbox. Runtime
version information is recorded, but equivalence to the original execution
environment and complete dependency/runtime closure are not established.
No security-isolation claim is made.

Three new runner tests check the fixed invocation, runtime workaround boundary,
result inventory/authority, output preservation and an unprovisioned workspace.
They pass on Node 22.23.2 and Node 24.19.0. The exact-version JS-to-WASM inlining
workaround is applied only to 22.23.2; assertions and frozen code are unchanged.

The separate historical synthetic report test file also passes 11/11 from the
original workspace, while one of its receipt comparisons fails on the patched
root's changed lockfile. `historical-report-check.json` preserves this scoped
observation without changing that receipt. This is not a second automatic
producer recipe or a full integration-state/release pass.

**Remaining coding work:** enumerate and route the other historical producers,
bind their invocation/input/source inventories and module resolution, validate
current-product checks in the patched context, and integrate all required CI.
One successful metadata replay does not close the migration or establish
predictive accuracy. Independent eligible groups added: zero.
