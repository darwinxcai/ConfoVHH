# Historical v3 replay environment

The active application receives dependency security updates. The original v3
records bind an older root lockfile, so they are replayed in a separate temporary
directory with their exact original source paths and file contents.

`manifest.json` pins the 205 inputs needed by that replay. The three objects retain
the original package manifest, dependency lock, and integration test used by the
historical integration script. All other inputs are copied from the unchanged
research files. Original generators and verifiers execute without modifications.

The helper verifies every installed `immunum` 1.3.0 file against the existing v0.6
scientific-engine attestation before copying it. It does **not** install the old
dependency tree, replace the active lockfile, or modify any research record. The
Node runtime is the current tested runtime, not a recreated historical machine.

Run the complete historical check with:

```sh
node scripts/replay-historical-v3.mjs integration
node scripts/replay-historical-v3.mjs vhh
node scripts/replay-historical-v3.mjs idempotence
```

The idempotence check runs the original integration script in the temporary copy
and requires all staged bytes and the complete staged file inventory to remain
unchanged. These checks remain regression checks of the original incomplete v3
state; they do not authorize a new experiment or change any reported result.
