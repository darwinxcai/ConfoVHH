# Startup operations v1.0.2 — offline compiler acquisition control

This is an additive CPU-only diagnostic and candidate operational correction.
It does not rebuild, edit or replace the runtime bundle, Python dependency
locks, compiler package bytes, original runtime checker, generation runner or
previous receipts. The first runtime artifact remains run `34398379988`, commit
`257945495d8382702f2305a56e56ae662c628ef1`, manifest SHA-256
`b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c`.

## Preserved failure

CPU restore run `34399863151` at commit
`fa6dc73ef2d8fe214201eb3ac2f31caca4a4549f` passed the base-preserving SSH bootstrap
and Linux controller control, but the actual offline compiler install exited
100 after 1.819 seconds. Failed restore-receipt SHA-256:
`5fa2b8e4d0155bdaaf88b8498c37c88e200afa76329f2582e0044e39c02af31f`.
All preserved files remain unchanged.

The failed command was `apt-get --no-download --no-install-recommends -y install`
followed by the absolute paths of all 45 captured `.deb` files. Raw stdout and
stderr exist. Stderr contained only the generic inability-to-fetch message;
stdout listed suggestions/recommendations, without identifying the rejected
acquisition URI. This evidence does not prove either a missing package or a
local-file/cache acquisition defect.

## Exact upstream behavior and testable candidate

The pinned base reports APT and libapt-pkg version 2.4.14. The exact source was
retrieved from the [official Ubuntu source archive](https://archive.ubuntu.com/ubuntu/pool/main/a/apt/apt_2.4.14.tar.xz),
SHA-256 `8d1b2748a6b5c99c9fd56dfadde280b85616dd67d22f7ca44f86225fa688a98c`.
Its acquisition code rejects uncached, non-local items when downloads are
disabled, producing the observed generic error before normal installation
reporting. An already present canonical cache archive is marked complete and
local. The selected acquisition URI can differ from another same-version local
alternative. These implementation facts motivate cache staging; they do not
identify which item failed in the prior run.

The candidate correction is to copy the **same checksum-verified captured
archives** into APT's own canonical archive-cache filenames before executing
the **unchanged** original bundle restore helper. No new package, version,
repository resolution, `--fix-missing`, disabled dependency check, or network
fallback is permitted. The candidate is not described as a demonstrated fix
until the controlled negative/positive observations actually support it.

## CPU control and decision points

The separate `.github/workflows/boltz-runtime-restore-v2.yml` runs only when its
own path changes on `work/boltz-startup-recovery-20260909`. It downloads and
verifies the same immutable first runtime artifact. It does not rerun the
original build workflow, rebuild dependencies, or repack the already preserved
transport artifacts. Only new small evidence is uploaded with one-day retention.

The fresh pinned-base container first uses the SSH helper with the exact package
plan from the successful earlier CPU bootstrap. Plan SHA-256:
`4c2f2c6bebfd78edafba133cc9b60ecc3467ab821518a3a96d9e6d7cbd1ac5dd`.
The host then disconnects the container's Docker network and verifies an empty
network attachment set. The new cache-staging helper independently requires
that only the loopback interface remains. Compiler diagnostics, staging,
restoration and startup controls all run without an external network interface.

Before any candidate change, the helper preserves:

1. Installed package inventory, APT configuration and existing cache identities.
2. A bounded resolver simulation. Every planned installation must match a
   captured package/version; removals or unbundled versions cause an immediate
   stop with raw diagnostics retained.
3. A print-only acquisition plan, including every selected URI, canonical cache
   filename, size and APT-reported hash. Each row must map to a captured `.deb`
   whose SHA-256 independently matches the frozen bundle manifest.
4. A bounded negative control using the original offline install command. Its
   expected failure is preserved separately, followed by a package-inventory
   comparison. If it unexpectedly succeeds, record non-reproduction and whether
   package state changed, then stop without cache staging or a causal-fix claim.
5. A supplemental acquisition-only debug probe preserving source/authentication
   decisions. `--download-only` in this diagnostic prevents package installation.

Only after reproducing the original failure without any package-state change
does the helper stage the identical captured archives at the canonical names
reported by APT. Existing cache files with different identities are preserved
and rejected. The helper then repeats the same acquisition-only diagnostic with
networking still disconnected; it must succeed and leave package state
unchanged. This before/after comparison distinguishes cache staging from an
unrecorded package or connectivity change.

After that staging control succeeds, the unchanged `boltz-runtime-bundle.py`
(SHA-256 `a290e798628defaceff074141f5a02fc6dbe556080f905f8bb6e7dff70def7d9`)
performs its original offline restore, verifies the exact OS transaction,
interpreter/headers/ABI, all environment bytes, symlinks, modes and timestamps,
and runs `pip check`. The compiler-only control and bounded help diagnostics
follow. A failure at any stage retains its evidence and blocks GPU allocation.

No GPU runtime PASS is asserted by this CPU control. The original 60-second
Boltz CLI gate, the runner's 180-second outer check and the fresh full GPU JIT
gate remain unchanged and mandatory on the eventual GPU host. The remaining
cumulative GPU-time and $6 total limits do not reset.

The diagnostic helper is bounded to 180 seconds; the original restore remains
bounded to 660 seconds. The container is removed on completion or failure. The
workflow preserves small receipts, raw streams, source identities and network
state; it excludes the reproducible temporary archive reconstruction. Previously
verified transport parts remain available independently of this retry's outcome.
