# Approved startup operations v2

The user approved exactly **20 additional minutes** of cumulative GPU allocation.
The resulting ceiling is 8,400 seconds total. After the recorded 3,915.779
seconds already allocated, the remaining allowance is **4,484.221 seconds**.
The dollar ceiling and all other existing conditions remain unchanged.

For the next pod, the independent cloud controller must use the provider's
actual `createdAt` timestamp to set hard shutdown deadline
`H = createdAt + 4,484.221 seconds`. It must pass the absolute workload cutoff
`H − 420 seconds` into the new monitor and wrapper, reserving seven minutes for
output preservation and shutdown. Installation, transfer, checks and inference
all consume this same window; starting a process must not reset the clock.
If preservation finishes sooner, shut down sooner.

The additive v2 monitor and gates accept deadlines no more than 4,484.221
seconds in the future, forward the absolute deadline unchanged and retain the
existing process handling. The wrapper calls the correspondingly versioned v2
gate. The v1 files remain immutable. All source/dependency/cache identities and
required restore/original-runtime/full-GPU-JIT PASS gates are unchanged.

The frozen scientific runner and original runtime checker remain byte-for-byte
unchanged, including the original **60-second CLI help child limit** and the
runner's **180-second outer runtime-check limit**. No prediction parameter,
seed, sample count, output rule or scientific threshold is amended. The tests
exercise only absolute deadlines, toy argument forwarding and exact additive
file differences. This preparation allocates no GPU and invokes no scientific
runner or model inference.

The same launch package includes bounded operational preparation and GPU-gate
controllers. Preparation verifies the immutable source/input archives, the
3.570 GB transport archive, the provider base-image receipt and every staged
helper before restoring. Checkpoint download can overlap offline restoration.
The transport helper downloads only checksum-bound parts of the already saved
runtime; temporary scoped download URLs are removed after reading and omitted
from preserved results. Failure ends that preparation and retains raw evidence.

The external gate controller invokes the unchanged runtime checker with a
180-second enclosing limit and the unchanged full toolchain checker with a
240-second enclosing limit, both bounded by the cumulative workload cutoff.
Their own original timeouts are unchanged. Separate raw logs and invocation
receipts are retained; a failed gate creates ten NOT_RUN administrative records
without editing the original receipt or invoking the scientific runner.
