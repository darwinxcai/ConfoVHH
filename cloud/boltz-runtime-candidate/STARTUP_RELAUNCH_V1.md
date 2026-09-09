# Startup relaunch operations v1 — reusable environment and preserved checks

This is an additive operational amendment to recovery commit
`250350ab4b995e075edcb489c4f183e32b35efd6`. It grants no additional GPU time,
does not allocate a resource, and does not change the frozen ten-candidate
experiment, original runtime checker, toolchain checker, generation runner,
model checkpoints, inputs, seeds, sampling parameters, ranking or evaluation.
The prior failed runtime receipt remains failed and unchanged.

## Evidence and demonstrated limitation

The previous command `/workspace/confovhh-boltz/bin/boltz predict --help`
timed out after the original 60 seconds. Its receipt retained output lengths
and hashes, not the raw child streams. The independently reconstructed
332-byte stderr matches the preserved hash, but is labelled a reconstruction.
The old host and environment are gone; no active stack was saved at the
timeout. The original low-level cause is undetermined. In particular, the
evidence does not establish a filesystem or CPU bottleneck as its cause.

CPU workflow run `34398379988` built the unchanged recovery Dockerfile using
the exact pinned Linux base and Python dependency locks. Startup completed
in 7.135 seconds; the separate instrumented help-only observation completed
in 5.481 seconds. Both saved raw stdout/stderr, with import timings and
15-second periodic stack capture enabled for the instrumented observation.
Neither needed a stack dump because startup finished before the first one.

The first real CPU restore run `34399863151` failed during offline APT
acquisition, before environment extraction. Its failure and all logs remain
preserved. Run `34401282631` reproduced that failure without changing package
state and with the container network disconnected. Staging the same 45
hash-verified compiler archives under the canonical APT cache filenames made
the same acquisition probe succeed. The original bundle restoration helper
then succeeded unchanged with `--no-download`. Restored startup took 6.482
seconds and the instrumented observation took 4.978 seconds. This establishes
the offline restoration fix; it does not identify the earlier GPU host's
startup bottleneck or certify GPU readiness.

## Reusable environment identity and production restoration

Base image:
`docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3`.

The independently preserved runtime bundle manifest is
`b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c`.
Its environment archive is
`fc5a2e1881f41993ab7b9e0809fb2598ec0b6346fc6ee153c2209bb8d5dc334a`.
The local transport tar is
`4a2c2862c100ae1dc49a886b3533b6da23e80678a7323bc450b4946d0d98471f`.
The complete local backup verifies all eight transport parts, 206 bundle
files, seven internal environment parts and 42,990 environment entries.
The compiler packages and all pinned Python dependencies are reused; there
is no new dependency resolution or GPU-time installation from package indexes.

Use the minimal `bootstrap-ssh-preserving-base.py` with its exact captured
SSH package plan. It protects every preexisting base package and refuses
an incompatible upgrade. It restores the original package-selection state.
Keep the provider's exact image identity and the bootstrap's raw logs.

The new production helper `prepare-compiler-cache-v1.py` verifies both the
bundle manifest and `compiler-cache-mapping-v1.json` against independently
fixed hashes, checks all 45 package identities and archive bytes, and copies
them to the CPU-proven APT cache names. It refuses conflicting or symlink
cache entries. It installs nothing, requests no network download, changes no
network configuration and repeats no intentional failure on the paid host.
The mapping SHA-256 is
`181ff9b1f7e4fdf7093d1b85eea5b72a4702ef42014e5f473722096f0539b7b6`.

After cache staging, use the unchanged `boltz-runtime-bundle.py restore`.
It verifies the base interpreter, headers, ABI, OS baseline, compiler
transaction and every restored file/link/mode/mtime before executing Python.
Retain its actual restore receipt and raw streams. A successful CPU restore
receipt cannot be substituted for the target's restore receipt.

The environment uses `/opt/confovhh-boltz` and `/opt/confovhh-runtime`, the
original Dockerfile's prefixes on the container filesystem. The previous pod
used a separately installed `/workspace/confovhh-boltz`; that prefix is not
reused. The model cache remains `/workspace/boltz-cache`. Only exact frozen
checkpoints and chemical files are downloaded and verified. No native/reference
coordinates are staged onto the generation host.

## Both original runtime checks remain mandatory and unchanged

Before generation, run the original runtime checker using the restored
`/opt/confovhh-boltz/bin/python`. Its child CLI timeout remains **60 seconds**.
Require an actual PASS on this GPU host. Preserve raw enclosing logs and the
original receipt even when it fails. Then require `check-boltz-toolchain.py`
full PASS, with scope `compiler_and_fresh_triton_jit`: compiler and Python
headers pass, fresh Triton/TorchInductor cache, kernel executed, synchronized,
non-block-multiple input, fresh cubin present and zero maximum absolute error.
A compiler-only CPU pass is insufficient. Any failure stops this execution.

The new `verify-startup-gates-v1.py` binds the source hashes, live base identity,
actual restore receipt and bundle hash, original GPU runtime PASS, full GPU JIT
PASS and frozen checkpoint download receipt. `run-frozen-startup-v1.sh` uses
a new execution ID and refuses existing output. It sets `CC=/usr/bin/gcc` and
`CXX=/usr/bin/g++`, clears Python path overrides, and invokes the unchanged
frozen runner with `/opt/confovhh-boltz/bin/python`.

The frozen runner also executes the original checker internally after cache
and input verification. Its whole-check timeout remains **180 seconds** and
the nested CLI child remains **60 seconds**. This check is neither skipped nor
replaced by the earlier PASS. A failure blocks inference and is retained.
No timeout extension or reinterpretation is authorized by this amendment.
If either limit needs changing, stop and create a separate versioned amendment
covering both the external preflight and the runner's internal preflight first.

## Cumulative deadline and preservation

All prior allocated GPU time counts: 3,915.779 seconds. The current authorization
leaves 3,284.221 seconds (54m44.221s) under 7,200 seconds total. A proposal for
20 additional minutes is separate and not yet approved. No helper may silently
adopt it. The updated assessment is 37–71 minutes with overlap, up to 74 minutes
without overlap, including a seven-minute backup/stop reserve. Inference is an
unmeasured scheduling reservation. If the plan does not fit authorized time,
obtain the proposed revised allowance before allocating.

Immediately before allocation, recheck live Secure A100 PCIe 80 GB pricing,
configured storage costs, availability, posted charges and any active resources.
Use one GPU. Derive the hard deadline from the provider's allocation creation
time, including image startup and all preparation. The on-pod workload monitor
receives an earlier cutoff, seven minutes before the hard deadline, and stops
owned process groups on failure or cutoff. The external cloud controller must
stop the pod by the cumulative hard deadline even if SSH is unavailable.
Killing a process does not stop GPU billing. Arm an independent MCP watchdog;
confirm its observed allocation identity and deadline before running work.

The additive monitor forwards the validated new execution ID and absolute
deadline to the wrapper, retains the current admission ceiling, and accounts
for all ten slots. It preserves completed/partial coordinates and confidence,
all original receipts, interruptions, failures and missing results. It neither
retries a failed seed nor substitutes a candidate.

After quiescence, preserve and checksum-verify the inputs, dependency locks,
source identity, controllers/amendments, restoration and gate evidence, all
attempt records, coordinates, confidence and raw logs. Verify the archive and
every member independently after local transfer. Stop immediately on completion
or failure. Terminate only after the local backup is verified. If backup cannot
finish before the stop deadline, stop the GPU and retain storage containing
unverified results. Evaluate frozen DockQ locally after GPU shutdown and retain
all exact selection ties, failures and missing results without substituting zero.

The final launch manifest must bind every helper and this amendment, the source
and input identities, actual approved allowance, provider allocation receipt,
and the unique execution ID. Preserve all preceding execution records unchanged.
