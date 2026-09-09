# Boltz GPU runtime candidate

**Later input recovery:** the separately frozen [single-case 3P0G pilot](../../validation/single-case-development-3p0g-2026-09-09/README.md) now has newly captured MSAs and verified real checkpoint/cache bytes. The input-blocker descriptions below record this runtime candidate’s earlier preparation state; they are not the current status of that new pilot. Actual GPU installation and inference remain pending.

**Runtime recovery update:** the operator reports a successful A100 package installation and original GPU smoke check, followed by inference failure because Triton could not find a C compiler. This chat has not inspected those remote logs. See the [compiler recovery record](../../validation/single-case-development-3p0g-2026-09-09/COMPILER_RECOVERY.md). The compiler/JIT fix below has not yet run on a GPU.

**Original preparation state: dependencies resolved; image not built, installed or tested on a GPU here.** This
directory prepares a technical runtime pilot. It does not clear a study target,
recover an MSA, authorize an independent benchmark, or demonstrate pose-selection
performance. The original frozen generator records remain unchanged.

The candidate uses Python 3.11 on Linux x86_64, Boltz 2.2.1, Torch 2.7.1,
RDKit 2024.9.6 and the four cuEquivariance 0.5.0 packages. The optional CUDA
packages are included because Boltz's default inference path enables their
kernels. Torch 2.6.0 was rejected during actual resolution: it pins cuBLAS
12.4.5.8 while cuEquivariance's CUDA package requires at least 12.5.0. The
successful replacement resolves cuBLAS 12.6.4.1. This resolves a declared
dependency conflict; kernel ABI and inference compatibility still need execution.

`requirements-linux-py311.lock` contains 92 exact distribution versions and
approved artifact hashes, resolved with uv 0.12.8 against public PyPI. The
separate bootstrap lock pins pip, setuptools and wheel. The Dockerfile installs
into a fresh virtual environment and disables build isolation so source builds
cannot silently resolve an additional build environment. Source distributions
may still require unavailable build tools; an actual build must determine that.
The image's existing Python packages are not inherited by the virtual environment.

The base is the Linux/amd64 image
`pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime`, pinned by manifest digest in the
Dockerfile. Exact registry manifest/config bytes and their verification record
are under `evidence/image/`. The dependency receipt under `evidence/` verifies
the downloaded Boltz wheel's actual bytes against the previously recorded
SHA-256; other resolved package artifacts have not all been downloaded. No
final container digest, complete build reproducibility or GPU compatibility is
claimed for the corrected image.

## Build and bounded runtime check

For an initial technical session, a Pod can also start directly from the pinned
official base image and install these locks into a new virtual environment.
This avoids needing Docker inside the Pod. The base must receive the host C/C++
toolchain before compilation. On this Ubuntu base, as root, run the following
and retain the complete installation log and package inventory:

```sh
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential
mkdir -p /workspace/runtime-results
dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' > /workspace/runtime-results/os-packages.tsv
export CC=/usr/bin/gcc
export CXX=/usr/bin/g++
```

Use the active Python interpreter's own headers. Installing an arbitrary
`python3-dev` package may supply a different Python minor version. The new
compiler check verifies `Python.h` against the running interpreter and compiles
and executes a small C program. OS package resolution is recorded, not claimed
to be an immutable snapshot. Retain the final container digest if building an
image, or the base digest plus installed package identities for a direct Pod.

From a checkout of the recorded recovery commit, with
`/workspace/confovhh-boltz` not already present:

```sh
/opt/conda/bin/python -I -c 'import sys; assert sys.version_info[:2] == (3, 11)'
/opt/conda/bin/python -I -m venv /workspace/confovhh-boltz
/workspace/confovhh-boltz/bin/python -I -m pip --isolated install \
  --index-url https://pypi.org/simple --require-hashes --no-deps --no-cache-dir \
  -r cloud/boltz-runtime-candidate/bootstrap-linux-py311.lock
/workspace/confovhh-boltz/bin/python -I -m pip --isolated install \
  --index-url https://pypi.org/simple --require-hashes --no-build-isolation --no-cache-dir \
  -r cloud/boltz-runtime-candidate/requirements-linux-py311.lock
/workspace/confovhh-boltz/bin/python -I -m pip check
env -u PYTHONPATH -u PYTHONHOME /workspace/confovhh-boltz/bin/python -I \
  scripts/cloud/check-boltz-runtime.py \
  --lock cloud/boltz-runtime-candidate/requirements-linux-py311.lock \
  --output /workspace/runtime-results/runtime-smoke.json
env -u PYTHONPATH -u PYTHONHOME /workspace/confovhh-boltz/bin/python -I \
  scripts/cloud/check-boltz-toolchain.py \
  --output /workspace/runtime-results/toolchain-jit
```

Stop at any failed command. Retain the installation log, base-image digest,
checkout identity and smoke receipt. The updated full commands are prepared instructions;
they have not been executed on a GPU by this chat. For a reusable custom image,
the same installation is represented by the candidate Dockerfile below.

From the repository root, on a Docker-capable Linux/amd64 build host:

```sh
docker build --platform linux/amd64 \
  -f cloud/boltz-runtime-candidate/Dockerfile \
  -t confovhh-boltz:runtime-candidate .
```

Keep the build log and final image digest. The Dockerfile-specific ignore file
limits the build context to the two locks and both runtime checkers. The base and
isolated virtual environment include large CUDA packages, so building needs
substantial disk space and network transfer. No checkpoint, MSA or prediction
data is part of the image. No hosted image has been published by this change.

After the image builds, run the check on a GPU host with the NVIDIA container
runtime. Create an empty writable results directory first:

```sh
docker run --rm --gpus all \
  --mount type=bind,src="$(pwd)/runtime-results",dst=/results \
  confovhh-boltz:runtime-candidate \
  python -I /opt/confovhh-runtime/check-boltz-runtime.py \
    --lock /opt/confovhh-runtime/requirements.lock \
    --output /results/runtime-smoke.json
docker run --rm --gpus all \
  --mount type=bind,src="$(pwd)/runtime-results",dst=/results \
  confovhh-boltz:runtime-candidate \
  python -I /opt/confovhh-runtime/check-boltz-toolchain.py \
    --output /results/toolchain-jit
```

The checker records package/runtime identities, CUDA and GPU information, an
actual small GPU matrix operation and `boltz predict --help`. It exits nonzero
and retains a failed receipt when a prerequisite fails. A passing receipt is a
runtime smoke check, **not a model inference, acceleration-kernel validation or
scientific readiness certificate**. It neither downloads weights nor contacts
an MSA service. Save this receipt and the image digest before ending the pod.

## Fresh compilation is required before retry

The original GPU matmul/help check remains unchanged because it is frozen.
A recovery controller must additionally require the new toolchain check's full
`PASS` receipt before invoking the unchanged generation runner. A
`COMPILER_ONLY_PASS` result does not authorize inference. The JIT check uses
fresh Triton and TorchInductor cache directories, executes an explicit Triton
GPU kernel, synchronizes, and compares its output with known values. A full
pass exercises compilation/launch; it still does not prove every Boltz or
cuEquivariance kernel works. Preserve failures and stop before inference if
any check fails. Never disable kernels or change precision to make the test pass.

## Inputs originally still required for a model pilot

Boltz 2.2.1's inspected `download_boltz2()` checks for `mols.tar`, the extracted
`mols/` directory, `boltz2_conf.ckpt` and `boltz2_aff.ckpt` before validating
inputs, including structure-only jobs. A confidence checkpoint alone is not a
complete cache. Do not use dummy affinity files or the synthetic parser's
chemical components to bypass this requirement. Prepare and hash the real
cache, preserving its source provenance, before invoking the existing runner.

The previously recorded confidence checkpoint has expected SHA-256
`090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1`
and 2,286,561,469 bytes at Hugging Face revision
`6fdef46d763fee7fbb83ca5501ccceff43b85607`. Those are expected identities;
checkpoint bytes have not been downloaded or verified in this preparation.
The affinity weights and chemical cache also need complete source and byte
verification. Do not let unrecorded automatic downloads become study inputs.

The existing development pilot `3P0G_no_templates_complex_seed1` additionally
requires its two exact sequence-matched local A3Ms and generation provenance.
Those inputs remain unrecovered. Its five samples belong to the separate GPCR
review development arm. It is not an independent ConfoVHH validation target.
See [the input audit](../../paper/BOLTZ_INPUT_AUDIT_2026-09-09.md) and
[cloud preparation status](../../paper/CLOUD_GPU_PREPARATION_2026-09-09.md).
