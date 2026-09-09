# Startup operations v1.0.1 — independent CPU restore control

This additive amendment validates restoration of the already prepared runtime
before any further GPU allocation. It does not edit the original runtime
checker, generation runner, dependencies, experimental inputs or protocol. The
old failed runtime receipt remains failed. The original CLI deadline is still
60 seconds and the runner still invokes that checker under its 180-second outer
limit. No GPU is requested and no prediction is launched by this control.

The source artifact must come from successful workflow run `34398379988` at
commit `257945495d8382702f2305a56e56ae662c628ef1`. The restore workflow checks that
run's exact commit, completed/success status, immutable artifact IDs, names,
digests and expiration. If the first export failed, is incomplete, or its
artifact has expired, this workflow stops; it does not substitute another run
or quietly rebuild the environment.

The workflow runs only after a push changing
`.github/workflows/boltz-runtime-restore-v1.yml` on
`work/boltz-startup-recovery-20260909`. Its separate workflow path and additive
amendment path do not match the first CPU diagnostic workflow's trigger. It
checks out its own controller commit and verifies both existing helper files
byte-for-byte against their exact first-source hashes. It records that original
helper commit separately from the new SSH-bootstrap/controller commit.
Permissions are limited to `contents: read` and `actions: read`; the
temporary GitHub token is used only for metadata and artifact download and is
not passed into the runtime container.

The officially verified download action is
`actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` (v8.0.1).
Its official action metadata supports exact artifact IDs, source run ID,
repository and read token, with digest mismatches configured as errors. The
tag's commit and action metadata were checked against the official
[`actions/download-artifact` release](https://github.com/actions/download-artifact/releases/tag/v8.0.1)
and [immutable action definition](https://github.com/actions/download-artifact/blob/3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/action.yml).

The runtime bundle is verified against its separately uploaded diagnostic
receipt and the independently preserved manifest SHA-256
`b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c`.
The runtime artifact is fixed to ID `10122737648`, 3,570,346,126 ZIP bytes and
SHA-256 `fa2b96fa36226ac0b497956c4d9d3948e8b0452d4de92c9cada20dc93cfb21f2`.
Its runtime archive has 3,485,961,842 bytes and SHA-256
`fc5a2e1881f41993ab7b9e0809fb2598ec0b6346fc6ee153c2209bb8d5dc334a`.
The verifier checks all parts, the concatenated
archive, and each archived file, mode and symlink before restoration. A fresh
CPU container is pulled from the exact base
`docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3`.
The host records and verifies its digest, architecture, OS and image config ID.

Before restoring, the fresh target exercises the exact proposed minimal SSH
bootstrap. The previous bootstrap explicitly requested `ca-certificates` and
`curl`, allowing irrelevant base-package upgrades that the compiler-only bundle
does not necessarily capture. The new version requests only `openssh-server`,
temporarily holds every already installed package, and refuses any change to a
preexisting package's version or architecture. It restores the original package
selection/hold state afterward. If SSH requires an incompatible upgrade, the
control fails rather than weakening restoration's identity checks.

The bootstrap retains raw logs, complete before/after inventories, exact added
package identities and a reusable `ssh-package-plan.json`. The future GPU
bootstrap should use that verified exact package plan, and repeat the same
base-package protection and identity checks. It does not need to request a new
certificate bundle or curl: artifact staging can use the base Python and SSH
file transfer. The CPU control creates/checks host keys but starts no SSH daemon
and receives no user authorization key. Its separate `--serve` mode is reserved
for the actual pod, with one explicitly supplied public key; it refuses to
overwrite existing authorized keys.

Inside that SSH-prepared container, the bundle restores the captured compiler package
transaction with network downloads disabled and recreates the same
`/opt/confovhh-boltz` and `/opt/confovhh-runtime` prefixes. The helper verifies
the base interpreter and headers, Python ABI, OS package baseline/transaction,
and every restored file, symlink, mode and nanosecond modification time before
executing `pip check`. This exercises real package and interpreter integration,
which synthetic archive tests cannot establish.

The restored runtime then executes the compiler-only check and the same bounded
help-only diagnostics: one exact CLI command with a 60-second deadline, followed
by the separately instrumented 300-second observation with import timings and
15-second stack traces. Raw streams and receipts are retained. Filesystem caches
may be warmed by archive verification and the earlier help command; this is
recorded as a limitation. CPU startup success does not prove that the previous
pod's timeout cause has been identified, and cannot certify GPU readiness.

A `CPU_RESTORE_CONTROL_COMPLETE` receipt means the minimal SSH bootstrap left
all base packages unchanged and restored package selection state, the captured
compiler package closure restored successfully, compiler-only control succeeded, pinned identities
matched, and both bounded help observations completed. It is neither the
original GPU runtime PASS nor a full fresh Triton GPU JIT PASS. Both remain
required on the eventual inference host, including the frozen runner's internal
check. Any failure blocks GPU allocation and retains the diagnostic evidence.

The job is bounded to 90 minutes of standard CPU-runner work; SSH preparation
is bounded to 240 seconds with a separate 15-second package-selection rollback,
restore work is bounded to 660 seconds, compiler-only work to 120 seconds, and the diagnostic
controller to 420 seconds. All containers are removed on completion/failure.
Raw diagnostic evidence is uploaded separately from the runtime. A failed
restore may retain a reconstructed `restore/runtime.tar.gz`; its hash/size are
recorded but that reproducible staging copy is excluded from the diagnostic
artifact. It can be recreated from the unchanged verified source bundle.

## Connector-sized transport preservation

The connector rejects an artifact ZIP larger than 512 MiB; the initial complete
runtime artifact exceeds that limit. After successful source-bundle
verification, an independent repack step creates a tar containing the unchanged
downloaded `reusable/` directory and splits it into at most ten 480 MiB parts.
Each part is uploaded separately with compression disabled, leaving at least
32 MiB for ZIP overhead below the connector limit. A small transport manifest
binds original source run/commit/artifact ID and original bundle-manifest hash,
the whole tar's size/SHA-256, every original bundle file, and every part's
size/SHA-256 and order. The original bundle is hash-checked again and remains
unchanged. No environment is rebuilt or installed by transport repacking.

The repack and part uploads run even if the later CPU restore/compiler/startup
control fails, provided original-bundle verification passed. A failed restore
therefore does not prevent preserving the valid runtime artifact locally.
Ten fixed upload slots are conditional on actual verified part files; absent
slots do not create empty artifacts. Each upload has a five-minute limit;
repacking has a 600-second limit. Download all emitted parts and the small
manifest, verify every part and the concatenated tar, safely extract its
`reusable/` directory, then repeat the original bundle verifier. Do not claim a
complete local backup until all those checks pass.

Retention is one day. The repacker sums the first run's actual artifact sizes,
new transport bytes, small diagnostic evidence and a 128 MiB ZIP/metadata
reserve; it refuses a combined total above 12 GiB. The separate diagnostic
content must stay below 400 MiB. This avoids large-token or signed-download-URL
workarounds and keeps the existing $0.10 artifact-storage reserve. Preserve the
verified source bundle locally before its one-day retention expires.

This control incurs no Runpod GPU time. The original cumulative GPU and total
dollar limits remain unchanged. A real CPU restore receipt and the final
artifact size/timings should update the separate preallocation assessment
before asking for or using any revised GPU allowance.

## External workload controller preparation

This version also preserves the additive `monitor-frozen-v2.py` and
`preserve-execution-v2.py` helpers. They use the selected environment path and
execution ID instead of the previous hardcoded `/workspace` path, recognize
owned process groups with PID birth-time checks, require absolute deadlines,
retain original receipts and all ten slots, and refuse to archive active work.
The workload monitor cannot itself stop cloud billing; an independent Runpod
controller still must stop the pod by the cumulative allocation deadline.
Its current admission ceiling remains 3,284.221 seconds and grants no time
extension. A Linux smoke test exercises only toy sleeping Python processes and
deadline rejection; it launches no scientific runner or prediction. Read its
separate receipt before activating these helpers.
