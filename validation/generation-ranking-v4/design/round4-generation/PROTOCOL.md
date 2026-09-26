# Controlled round-4 generation comparison

All twelve existing target sets are development exposed. This comparison has
900 planned attempts: twelve sets × three arms × seeds 25–49. The old 300
predictions remain a separate seed batch. Extra seeds are not independent
biological replication; the two AGTR1 constructs stay in one biological group.
CASR remains a separately reported low-resolution exploratory case. No native
coordinates, target-specific restraints, templates or outcomes enter this runner.

| Arm | Diffusion step scale | MSA subsampling |
|---|---:|---|
| baseline | 1.5 | disabled, matching the previous CLI |
| broader | 1.0 | disabled |
| msa1024 | 1.5 | enabled, pinned default 1,024 combined rows |

Broader changes only step scale. msa1024 adds only the subsampling flag. A smaller
step scale is an available diversity control, not a demonstrated quality gain.
The 1,024 depth was selected before new predictions/outcomes using captured input
depths: all twelve complexes have 8,797–9,124 combined model MSA rows. Most unique
chain MSAs have 8,192 rows; FZD3 receptor has 7,601, LGR4 receptor 4,781, and the
CHRM1 helper helix 419. Subsampling acts on the combined rows rather than on each
chain independently, so none of these complex arms is a row-count no-op.

The exact checkpoint is Boltz-2 confidence SHA256
`090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1`,
source commit `b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc`. The restored Python/CUDA
environment and complete package freeze must match round 3. Common settings are
three recycling steps, 200 sampling steps, one diffusion sample, one parallel
sample, GPU/bfloat16 inference, kernels enabled, no force potentials, no dataloader
workers, and mmCIF output. Full PAE/PDE recording is explicitly requested uniformly
in all arms. These output flags are recording controls, not an arm difference.
Confidence, pLDDT, PAE and PDE outputs are all required and authenticated.

Each target uses the byte-identical old YAML, unchanged chain order, exact
sequences, selected Nb and full assembly/helper context. Captured processed
records, structures and MSA arrays are authenticated against the preserved cloud
snapshot archive manifest and old input plan. Query residue identities and chain
lengths were checked independently. There are no reference templates or contact
constraints in those processed records. Original MSA CSV files are also staged.
No previous predictions are staged. Each attempt starts with a new scratch
directory containing only a copy of those captured processed inputs; no MSA-server
flag is passed. The pinned preprocessing path recognizes the existing record and
rebuilds its manifest without refetching or reparsing the YAML. The override flag
allows new prediction output; it does not replace the staged processed input.
Used processed arrays are rehashed after each successful prediction.

The executable CLI's subsample default is False. Its help text and Python callback
default misleadingly say True; Click's absent boolean flag controls the actual
CLI default. A runtime probe checks this exact installed parser. The pinned
inference featurizer uses NumPy seed 42 and deterministic row truncation; the
optional MSA module invokes torch.randperm and does not guarantee retention of the
query row. No modifications to that algorithm are made. Global seeds 25–49 are
shared schedules across arms, not proof of identical subsequent diffusion noise:
MSA subsampling consumes random numbers. Arms rotate in a fixed order by target
and seed to reduce execution-order confounding. No outcome affects job order.

Before unrestricted execution, the parent inspects this sealed plan, code and
tests. The runtime probe authenticates package/source/checkpoint identities,
parses all three actual CLI commands, runs the unmodified input-pairing function
on all twelve captured inputs, verifies seed-repeat behavior of row sampling,
and checks finite CUDA kernels against the official nonkernel path. It computes
no molecular prediction or native agreement.

The bounded prediction smoke consists of five members of the 900: seed 25 for
dev_8qot in all three arms, CHRM1_NB1B4 baseline, and CASR_NB2D11 baseline. Successful
smokes remain ordinary attempts in the comparison and are never rerun. These
cover pair, helper and largest dimer context without inspecting DockQ. The smoke
verifier requires exact chain sequences, finite coordinates, confidence/array
outputs and retained used-input hashes. A hash-bound parent release then permits
the remaining queue. Scientific failure dispositions are preserved; neither
failed nor interrupted attempts are automatically retried or replaced.

Atomic directory claims prevent duplicate work across workers. Receipt publication
uses a fully flushed temporary inode and exclusive atomic link. Terminal receipts
cannot be overwritten. Resume authenticates initial and terminal metadata against
the frozen job, input, command, arm and complete main-output inventory. A claimed
directory without a terminal receipt is retained for explicit technical recovery.
Two consecutive failures pause a worker for diagnosis. The fixed per-attempt
timeout is four hours. Successful operational scratch is disposable only after
outputs and their immutable receipt are durably committed; captured inputs and
used-input hashes remain. Failed/interrupted scratch is preserved separately.
Main output inventory rejects symlinks/special entries and includes all nested
predictor outputs, including names resembling receipts or work directories.

Status always reports all 900 planned identities and distinguishes pending,
claimed/interrupted, generated, failed and terminal interrupted rows. Generation
failure counts are separate from scientific quality. Attempt runtimes, output
hashes and all negative results are retained. Equal numbers of attempts do not
establish equal compute efficiency. Ranking and native outcome evaluation are
separate hash-gated stages owned by the parent; no generation retry, setting or
input changes are selected from these new outcomes.

Source evidence: pinned [prediction documentation](https://github.com/jwohlwend/boltz/blob/b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc/docs/prediction.md),
archived installed `boltz/main.py`, `data/module/inferencev2.py`,
`data/feature/featurizerv2.py`, and `model/modules/trunkv2.py`. The archive and
extracted source hashes are retained in the input/source qualification receipts.
Actual runtime and smoke results must be reported separately from the 21 local
workflow tests and independent code review.
