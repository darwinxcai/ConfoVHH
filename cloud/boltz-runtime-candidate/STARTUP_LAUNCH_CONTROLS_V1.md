# Startup launch wrapper v1 — preparation only

The additive `run-frozen-startup-v1.sh` accepts an execution ID and an absolute
workload deadline as its two positional arguments. The additive
`monitor-frozen-startup-v1.py` forwards those exact arguments and records them.
All existing process ownership, signal handling, administrative accounting and
the 3,284.221-second admission ceiling remain unchanged from the reviewed v2
monitor. No extra GPU allowance is granted by these files. The independent
cloud controller must supply a deadline within the authorized cumulative
allocation window, allow time for preservation and shutdown, and stop billing.

The restored environment is `/opt/confovhh-boltz`. Source, generation input and
model-cache paths remain `/workspace/ConfoVHH`, `/workspace/generation-inputs`
and `/workspace/boltz-cache`. Each execution uses the new directory
`/workspace/executions/EXECUTION_ID/runtime-results`. The wrapper refuses an
existing wrapper log, exit marker or generation-output directory; prior runs
and failed receipts remain preserved.

Before the unchanged scientific runner is invoked, `verify-startup-gates-v1.py`
requires all of the following in that execution's results directory:

- `restore/restore-receipt.json`: schema
  `confovhh.same-base-runtime-restore.v1`, exact status
  `RESTORED_REQUIRES_ORIGINAL_RUNTIME_AND_FULL_GPU_JIT`, verified environment,
  and original bundle-manifest SHA-256
  `b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c`.
- `live-base-identity.json`: verified exact base image, with its actual bytes
  bound by the restore receipt's `baseIdentityReceiptSha256`.
- `runtime-smoke.json`: original runtime checker PASS, its exact source and
  dependency-lock hashes, the restored isolated Python 3.11 environment, real
  GPU matrix operation and the original successful 60-second CLI help check.
- `toolchain-jit/receipt.json`: full compiler/header/fresh GPU JIT PASS from the
  unchanged additive toolchain checker, including an executed and synchronized
  CUDA kernel, new cubin, non-block-multiple numerical check and zero error.
- `cache-download-receipt.json`: PASS at the frozen checkpoint revision, with
  exactly all three original files. Their local bytes are independently rehashed
  again. Each immutable checker/runner/lock is also hash checked locally.

The gate records every evidence receipt's actual SHA-256 in a new
`startup-gates-receipt.json`, retaining a FAIL receipt when verification fails.
It does not accept the previous installation exit marker. CPU restoration and
compiler-only success cannot replace either GPU gate. The original runner's
internal checker remains unchanged, including its 60-second help child limit
and 180-second outer invocation limit. No inference parameters or scientific
source files are changed.

Bounded preparation tests passed 34 checks. They used the actual CPU restore
receipt read-only, mutated receipt fixtures, small cache byte fixtures and one
toy shell wrapper to verify argument forwarding and all ten not-run records.
No scientific runner, model inference, GPU or Runpod resource was invoked.
GPU PASS fixtures were synthetic and establish no live GPU readiness. The local
toy controller used a mocked empty Linux process snapshot on macOS; the prior
independent Linux process-group test remains the evidence for unchanged group
handling. New operational helper hashes must be bound into the launch manifest
before any later allocation or execution.
