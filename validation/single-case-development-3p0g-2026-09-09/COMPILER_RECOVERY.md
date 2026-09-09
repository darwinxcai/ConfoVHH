# Compiler recovery before the first generated pose

The operator reported that the first A100 installation and original GPU smoke
check passed, but inference failed because Triton could not find a system C
compiler. They reported zero generated poses, preservation of the logs and ten
attempt records, and termination of the Pod. Estimated aggregate charges were
$0.78, including the earlier RTX 4090 session, with $5.22 of the original $6
budget remaining. These are **user-relayed operator observations**; this chat
has not inspected or independently verified the remote execution artifacts or
settled billing. They are not prediction-accuracy measurements.

## Confirmed preparation gap and correction

The original candidate Dockerfile did not install a system compiler. Its frozen
runtime checker exercises GPU matrix multiplication and Boltz CLI loading,
without compiling a Triton kernel. Therefore its passing result did not test
the subsequently reported failure condition.

The exact pinned Triton 3.3.1 source at
[python/triton/runtime/build.py](https://github.com/triton-lang/triton/blob/v3.3.1/python/triton/runtime/build.py)
uses the `CC` environment override, otherwise GCC followed by Clang, and obtains
Python headers from the active interpreter's sysconfig paths. Its missing
compiler error matches the described failure class; the original traceback
still needs comparison with this source. Retrieved source SHA-256:
`080b3fac37f0380980543c8d48f2e227bae8860760eb66b23c81c4781fd259c2`.

The corrected Dockerfile and direct-Pod instructions install `build-essential`,
set explicit GCC/G++ paths, and preserve the resolved OS-package inventory.
The active Python 3.11 interpreter must provide matching Python headers. Do not
substitute another Python minor's development headers.

A separate `scripts/cloud/check-boltz-toolchain.py` verifies a real host-C
compilation and adds a fresh-cache Triton GPU JIT/launch control. It retains
failure receipts and logs. Its compiler-only mode explicitly cannot certify GPU
readiness. The original frozen runtime checker, scoring code, Python dependency
locks, generation script, protocol, and input ZIP remain unchanged.

The corrected image has not been built here. GPU compilation and full model
inference with this correction remain unverified. Installing from an apt
repository does not by itself provide an immutable OS-package snapshot;
record actual package versions and binary identities before inference.

## Local verification, without a GPU

All 13 focused tests pass with no skips, including real GCC compilation and
rejection of mismatched Python headers. Executing the pinned upstream Triton
host-build function reproduces its missing-compiler error with no compiler
available and successfully builds and loads a tiny C library when GCC is
available. The new helper reports `COMPILER_ONLY_PASS` on the local Python
3.12.14 runtime; its GPU stage was skipped. These are preparation controls, not
verification of the remote traceback, the frozen Python 3.11 GPU environment,
or Boltz inference. The [verification record](compiler-recovery-verification.json)
preserves test output, compiler receipt, text logs and new source identities.
All 41 scoring identities, eight execution identities and the protocol hash
still match the original immutable records.

## One technical retry, with the original experiment preserved

Before allocating another Pod, the connected operator must recover and hash the
previous failure bundle, confirm that no candidate coordinate was produced, and
identify the failure from its actual traceback. If coordinates exist, stop this
zero-output retry route and reconcile them under the original analysis plan.

Record a new recovery execution ID linked to the original execution and this
correction. Preserve every previous attempt record. Retry the same ten logical
candidate slots (seeds 1 and 2, five samples per seed) once; qualify artifacts
and ledgers by execution ID so repeated candidate names never overwrite the
old run. Report both execution history and logical candidate counts. Do not
report the failed run as if it never occurred or count absent coordinates as
DockQ=0.

This addendum permits recovery from the reported zero-output infrastructure
failure. It permits no outcome-based resampling, extra candidates, changed
sequences/MSAs/checkpoints, alternative scoring, changed precision or disabled
kernels. It does not edit the original freeze. The case remains development
exposed, with zero independent eligible biological groups.

Verify the remaining cost and cumulative GPU-time allowance from actual
allocation records; neither resets on retry. The original maximums remain
$6 total and two GPU-hours. The earlier 45–120 minute setup-plus-run estimate
was unmeasured. If the remaining allowance cannot support setup and inference,
report a revised estimate before a further allocation rather than silently
extending it.

## Execution and scientific deliverable

Use the same digest-pinned base and exact Python dependency locks. Restore only
verified inputs/cache bytes. Keep the experimental reference outside generation
inputs. Follow the [updated installation commands](../../cloud/boltz-runtime-candidate/README.md#build-and-bounded-runtime-check).
Require the original runtime-check PASS and the new toolchain-JIT full PASS
before invoking the unchanged ten-pose generation script. The external
controller must enforce the remaining cumulative allocation limit, preserve
outputs and stop the Pod; neither checker controls billing.

After generation, execute the fixed A:B DockQ 2.1.3 analysis and the first
candidate API/CLI agreement check. Deliver the ConfoVHH best-tier, predictor
confidence best-tier and retrospective best-candidate rows with all exact ties,
DockQ values, failed attempts, missingness and runtime/cost accounting. No
publication-readiness or predictive-superiority claim follows from repairing
the runtime alone, and a successful single case remains a development pilot.
