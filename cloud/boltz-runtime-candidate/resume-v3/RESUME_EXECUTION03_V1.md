# Execution 03 resume controller v1

This additive controller uses the approved 11,100-second cumulative GPU ceiling,
7,485.271 seconds already used and at most 3,614.729 seconds newly available.
The root controller supplies the actual workload cutoff and later preservation
cutoff; the independent cloud-stop daemon remains responsible for stopping
billing. No limit is reset by this helper.

Run `/opt/conda/bin/python -I /workspace/resume-v3/resume-execution03.py --pod-id ID --deadline-utc WORKLOAD_CUTOFF --preservation-deadline-utc ARCHIVE_CUTOFF --base-identity-receipt FRESH_PROVIDER_RECEIPT`.
The command creates execution03 and immediately launches a detached worker.
Both parent and child reject old output paths. The worker chains current
runtime verification, fresh original/runtime GPU JIT gates, the existing frozen
monitor/runner, and automatic archive creation without another readiness stop.
The monitor starts in its own session with detached input and saved output.

If both original /opt prefixes survive, their complete file inventory, bytes,
modes and symlink targets are compared against the unchanged bundle manifest;
base Python/header identity and captured OS package versions are rechecked.
Modification timestamps are not used for reuse admission. The historical
execution02 restore and its actual historical base receipt are copied unchanged
into provenance. A new environment-binding receipt links that historical
restore to current verification and the fresh provider base receipt. It does
not fabricate a new restore. If both /opt prefixes are absent, the same captured
compiler-cache helper and unchanged bundle restorer reconstruct the environment.
A partial or mismatching environment is preserved and rejected.

Execution01/02 files and their runtime-results alias are not rewritten. The
cache receipt is copied as historical provenance, and admission plus the frozen
runner reverify actual cache bytes. No previous GPU PASS is accepted: this
execution runs both GPU checkers again with original 60-second CLI and
180-second outer runtime constraints; full fresh Triton GPU JIT remains
required. The original frozen runner performs its own unchanged internal gate.
All scientific inputs, seeds, candidates, dependencies and scoring remain fixed.

After monitor exit, whether success, failure or deadline, the controller produces
or retains ten-slot accounting and invokes the unchanged preservation helper.
It includes execution03, execution01/02, source, inputs, locks and this controller
directory, producing `/workspace/execution03-backup.tar.gz` and its manifest and
receipt. Control logs generated during/after archival live separately under
`/workspace/resume-execution03-control`; the local collector must preserve that
directory alongside the archive/receipt before checksum verification and pod
termination. The controller does not perform or claim local backup verification
or cloud shutdown.
