# Takeover verification

Starting source: PR #57 `32a78f4d5f4c2d8ca52e99541bf5023b2d4915c7`.
The new scripts and their focused tests are identified in `verification.json`.
No scoring rule, old assertion, historical receipt or dependency lock changed.

- 71/71 combined scoped tests pass on Node 24.19.0.
- 41/41 new tests pass on Node 22.23.2 through the unchanged runtime wrapper.
- 12/12 original synthetic tests pass in the pinned historical workspace;
  its command/source receipts and complete TAP are under `historical-synthetic/`.
- Scoped lint and project typecheck pass. The npm typecheck wrapper prints the
  existing unknown `http-proxy` configuration warning; TypeScript reports no errors.
  Its exact terminal output is JSON-wrapped in `typecheck-log.json` to preserve whitespace.
- Seven claims / fourteen artifact bindings verify, with four unavailable inputs,
  partial reproducibility and zero cleared independent groups.

The Node 24 scope consists of the four new test files plus the existing
coordinate-rank, paired-selection, historical-environment and historical-VHH
runner tests. The Node 22 scope consists of the four new test files.

```sh
env -u NODE_OPTIONS -u NODE_PATH node --test \
  tests/producer-score-sources.test.mjs tests/source-bound-coordinate-ranks.test.mjs \
  tests/selection-set-comparison.test.mjs tests/historical-synthetic-replays.test.mjs \
  tests/coordinate-rank-export.test.mjs tests/paired-selection-comparison.test.mjs \
  tests/historical-replay-environment.test.mjs tests/historical-vhh-runner.test.mjs
```

For Node 22.23.2 invoke its binary with `scripts/run-node-tests.mjs` followed by
exactly the four new test filenames; the existing wrapper records its narrow
WASM-inlining workaround. `npm run typecheck` and source/test-scoped ESLint
were also executed. No package was newly installed for this continuation;
current dependencies were copied from the previously verified patched checkout.

The source-bound generated demo additionally executed the actual file/coordinate
path and job comparison with arbitrary synthetic labels; its packet is adjacent.
This is a scoped verification record, not a full release, public data replay,
live browser run, independent participant test or measurement of predictive accuracy.
CI still needs explicit historical/current routing and remaining original inputs.
