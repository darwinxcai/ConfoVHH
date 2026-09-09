# Cloud GPU preparation and remaining gates

Updated 9 September 2026. **Prepare one bounded GPU session; do not launch the
full study yet.** No paid resource was created, no image was built, and no model
inference ran in this continuation.

## Concrete preparation completed

The [Boltz runtime candidate](../cloud/boltz-runtime-candidate/README.md) now
contains a digest-pinned official PyTorch base, Python 3.11 dependency and build
bootstrap locks, an isolated-environment Dockerfile, and a GPU runtime checker.
Actual public PyPI resolution produced 92 exact package versions with hashes.
The Boltz 2.2.1 wheel's downloaded bytes match its previously recorded identity.
The base manifest and config hashes were independently recomputed; Python 3.11
was corroborated from bounded image-layer metadata. Full image layers, package
installation, build success, GPU operation and inference remain untested.

The attempted Torch 2.6.0/CUDA-extra environment did not resolve because of
incompatible cuBLAS requirements. The candidate therefore uses Torch 2.7.1 and
cuEquivariance 0.5.0, with resolved cuBLAS 12.6.4.1. This is a new technical
candidate, not an authenticated historical inference environment. No frozen
generator contract or engine receipt was changed to match it. The GPU checker
tests a small matrix operation and CLI loading; only a later real inference
can establish model and acceleration-kernel compatibility.

The [historical integration replay](HISTORICAL_INTEGRATION_REPLAY.md) also now
passes on Node 22.23.2 and 24.19.0. Both unchanged original tests pass on each
runtime, with all 190 bound files and 11 inventories unchanged before and after
the verifier and test recipes. This extends release integration evidence;
mandatory CI routing and the broader release matrix remain unfinished.

## First cloud session

A single A100 80 GB Pod is a reasonable initial runtime/pilot candidate because
it provides memory headroom while actual requirements are still unmeasured.
This is a planning choice, not a measured requirement or cheapest-GPU result.
Use a Pod for the controlled container and retained logs. Serverless deployment
is not needed for this bounded batch-research task.

Runpod's public A100 PCIe page lists Secure Cloud from **$1.59 per hour**, checked
9 September 2026. Two hours would be $3.18 in GPU time at that list rate. This
is a session budget illustration, not a prediction that setup or inference will
finish in two hours. Confirm the live machine quote and any CPU, disk, volume
or other charges before starting. No full-batch cost is estimated without a
timed successful pilot. Sources: [Runpod A100 pricing](https://www.runpod.io/gpu-models/a100-pcie)
and [Pod lifecycle](https://docs.runpod.io/pods/manage-pods).

Before launching, obtain an authenticated Runpod connection through its secure
account/CLI configuration. No authenticated connection, API-key environment or
CLI configuration was available to this session. Do not place credentials in
the repository, evidence receipts or ordinary chat. Account setup can proceed
while the remaining local preparation continues.

The launch sequence is:

1. Choose the prepared runtime route: build the candidate on a Docker-capable
   host and retain its final digest, or start the pinned official base image
   and install the locks inside a fresh Pod virtual environment. The latter
   needs no Docker inside the Pod. Both routes remain unexecuted. Retain logs
   and resolve actual installation errors before continuing.
2. Verify the pilot's exact local A3Ms, complete real chemical/checkpoint cache
   and provenance. Boltz 2.2.1 also checks for the affinity checkpoint before
   input validation, even for a structure-only job. Missing files must not be
   replaced by placeholders.
3. Select a compatible live A100 80 GB host, confirm its quote and driver
   compatibility, and set a bounded session limit. Run the runtime checker
   before inference and retain a failed receipt if it fails.
4. Run only the declared technical/development pilot through the existing
   provenance-checking workflow. Preserve every attempt, command, input hash,
   output, log, timing and resource observation. Then derive a real batch cost
   estimate. A runtime smoke check alone does not complete this step.
5. Copy and verify results before ending the Pod. Stopping releases the GPU but
   retained storage may still be billed; termination deletes Pod-local storage.
   Network volumes have their own lifecycle and charges.

## Scientific scope remains unchanged

The staged 92 jobs / 460 models belong to the separate GPCR review development
arm. Its shortest existing no-template pilot still needs two exact local A3Ms
and their generation provenance, plus runtime and cache verification. The
archive is located by metadata; its bytes remain unrecovered. Completing that
pilot would validate a development execution path, not an independent target.

The independent ConfoVHH study still requires defensible target eligibility and
grouping, exposure/overlap accounting, method identity and a frozen schedule
and analysis before its protected inputs and outcomes are used. Its current
generator-readiness record remains blocked before target freeze and MSA
retrieval. Independently cleared eligible groups remain **0**; predictive
advantage over producer confidence remains **unmeasured**. The original public
producer replay and current/historical CI integration also remain release
blockers. Spending on a large GPU batch does not resolve these conditions.
