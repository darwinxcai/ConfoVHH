# Startup operations v1.0.0 — CPU diagnosis and reusable build

Effective scope: additive CPU diagnostics and environment preservation only.
Parent: `250350ab4b995e075edcb489c4f183e32b35efd6`. No prediction is launched by this amendment or its workflow. Inference remains blocked pending diagnosis, live GPU gates, and a cumulative budget/deadline assessment.

## Preserved failure

Compiler recovery execution `confovhh-3p0g-compiler-recovery-20260909-01` failed the original runtime checker. Receipt SHA-256: `d46d33cc01a85d0d80c42147e8f36db8e9edbfc2abf788dae17e8e5105b377ec`. Backup SHA-256: `e70c37cb0cd57e2a66f23f7eca1d40c23ded067ab3f0d2e2abbd187ea8e14288`.

The timed command was `/workspace/confovhh-boltz/bin/boltz predict --help`, limited to 60 seconds. The checker saved stream lengths and SHA-256 values, not raw child stdout/stderr. Stdout was empty; stderr was 332 bytes with SHA-256 `616cbb2fb89a42b7d4cb7376d699730069d4ed29353660c41c53af19c12fe962`. Identical warning text reconstructed from other preserved logs matches that hash; it does not establish the timeout cause. A separate raw import log ended after a 90-second diagnostic timeout, without periodic stacks. Storage/CPU explanations remain hypotheses.

## Pinned CPU environment and bounded observations

The public repository's standard Ubuntu 22.04 Linux x86_64 GitHub Actions runner builds the unchanged recovery Dockerfile with exact base `docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3`. Its isolated `/opt/confovhh-boltz` Python 3.11, Boltz 2.2.1, Torch 2.7.1, dependency hash locks, compiler installation, and checkers are unchanged. A narrow build context contains only that recipe, locks and checkers. No experimental input or reference structure is transferred to the builder.

The first help-only command retains a 60-second deadline and saves separate raw streams. A separate instrumented console help invocation has a 300-second diagnostic observation limit, import timings and stack dumps every 15 seconds. The second invocation may benefit from caches warmed by the first. It is not an extension, rerun or PASS of the frozen checker. Every subprocess is terminated as a process group at its absolute diagnostic deadline. Offline/telemetry flags in the diagnostic receipt are diagnostic-only; they do not change an inference invocation.

The original checker remains byte-identical: its CLI check is 60 seconds. The frozen generation runner also remains byte-identical: it invokes that checker internally under a 180-second outer deadline, retaining the nested 60-second CLI limit. CPU help completion and compiler-only checks cannot certify either the actual-host original runtime gate or the full fresh Triton GPU JIT gate. Both must PASS on the eventual inference host, and its internal check must also PASS.

## Reusable environment

After diagnostics, export the existing Dockerfile's fixed `/opt/confovhh-boltz` and `/opt/confovhh-runtime` prefixes, preserving file contents, links, modes and original timestamps. Capture every added or upgraded OS package relative to the exact base and download those exact `.deb` versions. Store a complete manifest, raw export logs, concatenated archive hash, and hashes of 512 MiB archive parts.

Restore is offline into the same exact base and prefixes only. Require independently preserved manifest hash, controller-verified live image identity, exact base Python executable/header hashes and ABI, matching base OS inventory, exact compiler package closure, file-level round-trip verification and pip consistency. This avoids a fresh dependency resolution or installation. It makes no claim that GPU startup or JIT has passed. Never overwrite an existing environment.

Build/diagnostic helper limits and workflow step limits bound CPU work. Public standard-runner compute is free; retain artifacts for one day, at most 12 GiB total, with a conservative $0.10 storage reserve. No Runpod allocation is part of this amendment. Download and verify reusable artifacts before any GPU decision.

## Required before inference

Preserve diagnosis evidence and any demonstrated operational remedy in a subsequent versioned receipt/amendment; do not infer causation from timeout alone. Reconcile posted charges and pending estimates without double-counting the earlier reported $0.78. Prior cumulative GPU allocation was 3,915.779 seconds; maximum remaining is 3,284.221 seconds (54m44.221s). The $6 total cap remains, with $4.40 provisionally remaining before this step's storage reserve and billing reconciliation.

Estimate setup, both gates, frozen ten-pose inference and backup before allocation. An external controller must enforce the absolute remaining cumulative GPU deadline from allocation creation, including setup and cleanup reserve. If the estimate does not fit, request a revised allowance before allocation. No experimental protocol, candidate seeds, inputs, models, precision, kernels, scoring, ties, DockQ logic, or previous records may be changed by this operational work.
