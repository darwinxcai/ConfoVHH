# Node 22.23.2 runtime review, 2026-09-09

The Node 22 release job at repository revision `3df9d9573cbbb73d749d2b3315f396fbec7fe52a` aborted inside V8 while exercising the VHH metadata pregraph replay. The job reported `unreachable code`, `Deoptimizer::DoComputeBuiltinContinuation`, and `SIGTRAP`, rather than a failed scientific assertion. The retained log excerpt contains only the runtime failure and test-runner diagnostics. `hosted-v8-abort.json` stores the original excerpt as a JSON string, preserving every UTF-8 byte, including trailing whitespace, and records the raw-excerpt SHA-256.

- CI run: https://github.com/darwinxcai/ConfoVHH/actions/runs/34279616607
- Failed job: https://github.com/darwinxcai/ConfoVHH/actions/runs/34279616607/job/102240942802
- Local reproduction: Linux x64, Node 22.23.2, V8 12.4.254.21-node.56.

The abort was locally reproducible but timing-dependent: a normal run and one run with deoptimization tracing failed with the same native stack, while another traced run passed. The trace implicated optimized `numberVhhForLeakage` during a lazy deoptimization after calling the pinned IMGT WebAssembly engine. This is diagnostic evidence of a runtime/compiler interaction; it does not establish the precise upstream V8 defect.

Disabling JS-to-WebAssembly call inlining on that exact Node version completed the unchanged six-test pregraph file in three recorded runs, including one through the new launcher. An earlier experiment disabling array-builtin inlining also passed, but that broader option was not adopted. The experiment receipt records individual outcomes and durations; these checks establish observed behavior, not proof that every possible V8 failure is resolved.

An independent review then added an explicit argument delimiter before test paths, preventing filter-looking arguments from silently skipping a failing test. The final launcher and release-automation checks passed all six assertions on Node 22.23.2. The receipt identifies earlier launcher experiments as predating that argument-boundary change and binds the final source hashes.

The launcher applies `--no-turbo-inline-js-wasm-calls` only to Node 22.23.2. It forwards the complete explicit test-file list, retains serial file execution, propagates failures and process termination, and performs no retries. Other Node versions retain their normal compiler settings. The package command still runs typechecking, the verified build, and the complete test glob; the release command still runs lint, those checks, adversarial validation, and release-artifact verification. No scoring implementation, scientific protocol, frozen hash, threshold, or scientific assertion was changed.

The moving Node 22/24 CI matrix was retained. Node 22.23.2 is a security release; replacing the current Node 22 gate with the older 22.18 baseline would reduce current-runtime assurance. The official release record is https://github.com/nodejs/node/releases/tag/v22.23.2. No version downgrade or automatic retry was used to obtain a passing check.

`review-receipt.json` binds the changed source files and exact local runtime binary to this review. Its source hashes describe the prepared patch based on the failed revision; they do not assert that the patch had already been committed or that hosted checks had passed. `experiment-results.json` is a structured extraction of the retained local logs. Raw logs remain temporary diagnostics; only concise runtime/test-execution evidence is archived here. `checksums.sha256` binds this packet and excludes itself.

At packet creation, a fresh hosted release gate and the complete release command on the committed patch remained to be run. The independent Zenodo producer-download failure remained a separate blocker. This runtime review makes no claim about predictive accuracy, biological validation, independent target eligibility, or publication readiness.
