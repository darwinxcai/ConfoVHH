# ConfoVHH independent hard-decoy protocol v2

Status: **target census blocked; no holdout coordinates, candidate poses, DockQ labels, or performance results accessed**.

This versioned protocol supersedes `HARD_DECOY_PROTOCOL.md` for any future independent holdout. The v1 document remains immutable as a historical record. Version 2 corrects three label-leakage risks in v1: native-derived poses cannot be the primary benchmark, DockQ-band quotas cannot select the primary population, and coordinate hashes cannot break scientific score ties.

No execution is authorized by this file. The public v0.8.0 product and the commit-attested v0.5.0 scientific engine remain unchanged. A benchmark may proceed only after an exact target set satisfies every target and leakage gate, the pre-label package is checksummed, and the user approves the resulting digest and resource envelope.

## Question and estimand

Among **contact-rich candidates** produced without the native relative receptor–VHH pose, does the frozen ConfoVHH v0.5 coordinate-audit ordering enrich DockQ-acceptable-or-better poses beyond every prespecified baseline?

The primary estimand is an equal-weight macro average over independent receptor/VHH/epitope/publication groups. Results describe reference similarity in the frozen benchmark only. They do not establish binding, affinity, specificity, conformational selectivity, signaling, membrane compatibility, flexible docking, or nonbinder discrimination.

## Blind boundary

During target curation, public metadata, sequences, publications, licenses, release dates, and depositor annotations may be used. New holdout coordinates, native poses, native interfaces, DockQ values, CAPRI labels, ConfoVHH results, and performance summaries may not be opened or emitted.

The public PDB archive is not cryptographically secret. This protocol therefore claims process separation and immutable provenance, not blinding against a malicious operator. Preparation, generation/audit, and label/evaluation stages have separate filesystem allowlists. Label code and native-reference readers are unavailable to pre-label preparation modules.

The state machine is monotonic. A census that cannot reach the target minimum
terminates in a blocked state; reopening it requires a new, versioned census
record rather than mutating the blocked one:

`DRAFT -> TARGET_CENSUS_BLOCKED`

or

`DRAFT -> TARGETS_FROZEN -> CANDIDATES_FROZEN -> AUDITS_FROZEN -> PRELABEL_FROZEN -> APPROVED -> OPENED -> EXECUTED_PASS | EXECUTED_FAIL | OPENED_FAILED -> PUBLISHED`

There are no reverse transitions. `TARGET_CENSUS_BLOCKED` is terminal for its
version. Once `OPENED` is recorded, a crash or unresolved error becomes
`OPENED_FAILED`; the same holdout may not be silently repaired, relabeled, or
rerun.

## Independent-group and leakage contract

Create one union graph over every development and candidate target. A graph edge is added when any condition is true:

1. identical receptor UniProt accession, or canonical 7TM global identity **>=0.40** at **>=0.80 mutual coverage**;
2. identical VHH parent/variant metadata, or IMGT-numbered framework identity **>=0.90** plus CDR3 global identity **>=0.70** with absolute CDR3 length difference <=2;
3. identical primary DOI or PMID;
4. same-side native epitope signatures with Jaccard **>=0.40** or containment **>=0.60**.

Map receptor epitope residues to GPCRdb generic positions. Unmapped loops and termini use fixed region tokens. A candidate connected to any development node is excluded. A VHH that cannot be IMGT-numbered or a target whose direct receptor epitope cannot be mapped cannot prove leakage freedom and is excluded prospectively. Repeat the receptor exclusion at identity **>=0.30** as a veto-only sensitivity analysis.

Pin the global-alignment implementation, scoring parameters, GPCRdb snapshot, IMGT implementation, input sequences, and complete pairwise matrices. Threshold equality is excluded. Freeze an exact number of groups and exact target identities; never use an open-ended "at least ten" set after labels exist.

The primary holdout requires **at least 10 independent connected components**, each disjoint from development and from every other holdout component. Repeated structures, construct variants, receptor subtypes above the threshold, VHH lineages, mapped epitopes, and publications stay in one component.

Exclude auxiliary G-protein nanobodies, anti-BRIL/anti-Fab binders, arrestin-directed binders, same-chain receptor–VHH fusions, fusion-only contacts, and complexes without a direct receptor–VHH interface. A VHH contacting both a receptor and an engineered fusion is excluded from the primary benchmark because the docking target is construct-dependent.

## Source and target records

For every included and excluded candidate, retain:

- PDB ID, depositor assembly and model, label/auth chain identifiers, operator provenance, experimental method, resolution, release date, and retrieval UTC;
- exact RCSB/wwPDB, GPCRdb, UniProt, publication, and license-evidence URLs;
- archived raw metadata response, byte count, SHA-256, ETag, and Last-Modified
  when supplied;
- complete receptor construct, canonical receptor, canonical 7TM, and VHH sequences plus SHA-256;
- UniProt mappings, VHH name, IMGT numbering status, CDR sequences, construct/fusion identity, ligand/state, published epitope description, primary DOI/PMID, and exclusion reasons;
- PDB archive license evidence (CC0) and the license of every external software/data source.

No native coordinates or reference-derived numeric geometry may appear in the public pre-label package.

## Required generators

The primary benchmark uses the same receptor and VHH sequences with two independently implemented learned-complex generators:

1. **ColabFold 1.6.2 / AlphaFold-Multimer v3**, tag commit `c7d1772352cc9619df25c6d36cb0f218c0c6610e`;
2. **Boltz 2.2.1**, tag commit `cb04aeccdd480fd4db707f0bbafde538397fa2ac`.

Exact OCI/environment, checkpoint, MSA, configuration, command, seed, CUDA/driver/PyTorch, GPU model, thread, and resource hashes must be filled and sealed before generation. Mutable tags or unchecksummed live MSA queries fail the benchmark.

Both generators receive only sequences and frozen MSAs. Templates are disabled. Neither receives a native complex, bound relative transform, native receptor face, native interface residues, DockQ, CAPRI, ConfoVHH output, or feedback from the other generator. Training/template leakage is recorded separately from ConfoVHH development leakage, including model training cutoff, PDB release date, MSA/template settings, and known homologous complexes.

### Seed schedule and outputs

For canonical target ID `t`:

`base_seed = uint31(first_8_bytes(SHA256("ConfoVHH-H2-generators-v1\0" || t)))`.

- ColabFold standard: seeds `base_seed + 0..19`, five AF-Multimer-v3 models each.
- ColabFold diversity: seeds `base_seed + 100..119`, five models each, dropout enabled, `max_seq=128`, `max_extra_seq=256`, cluster profile disabled.
- Boltz: seeds `base_seed + 1000..1007`, 25 diffusion samples each.

ColabFold freezes `num_recycle=3`, no relaxation, no early stopping, and retains all 200 models. Boltz freezes three recycling steps, 200 sampling steps, 25 diffusion samples, `max_parallel_samples=5`, `step_scale=1.5`, potentials enabled, and full PAE output, retaining all 200 samples.

Each attempted output keeps its raw and canonical coordinate hashes, producer confidence, PAE/confidence tensors, input/MSA/config hashes, seed, command, logs, exit state, resource use, and exact failure reason. Failed seeds are never replaced.

ColabFold producer confidence is AlphaFold-Multimer ranking confidence. Boltz producer confidence is its documented complex confidence. Raw scales are analyzed only within target-by-generator strata. A pooled producer baseline uses descending, tie-aware within-target-by-generator percentile ranks.

Native-derived SE(3), slide, or wrong-patch perturbations from v1 may be used only as a separately named secondary mechanistic stress set. They may not count as an independent generator or repair a failed primary target.

## Pre-label eligibility and population

The primary population is **every pre-label eligible output** from both generators. Eligibility is frozen before DockQ:

- successful finite coordinate parse;
- exact frozen receptor and VHH polymer sequences and unique chain mapping;
- at least eight cross-chain residue pairs within 5.0 A;
- no cross-chain protein-heavy-atom separation below 1.8 A;
- VHH C-alpha duplicate components below 0.5 A RMSD after receptor alignment are represented once using a deterministic pre-label rule;
- all resource limits satisfied.

Eligibility cannot use ConfoVHH's 4.5 A contact count, evidence band, DeltaSASA, CDR share, producer confidence, native geometry, DockQ, or CAPRI. Every attempt—including malformed, nonfinite, timed-out, duplicated, ineligible, and resource-killed outputs—remains in the ledger and reconciles exactly.

The claim must always say "among contact-rich candidates." A target missing either required generator fails the procedural gate; it is not backfilled.

A secondary spectrum-balanced analysis may use the historical 2 high / 3 medium / 5 acceptable / 95 near-incorrect / 95 far-incorrect quota only after the primary candidate ledger is immutable. It is outcome-conditioned, has artificial prevalence, and cannot support the primary claim.

## Frozen ConfoVHH arm

Run the commit-attested v0.5.0 engine from commit `04c6bda2289157dd294c290609f6052aa0ef9195`, tree `1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9`, in a detached clean worktree with the transitive scientific-source and dependency closure hashed.

Use coordinate-only audits: `confidenceMode="none"`, no PAE, no pLDDT interpretation, and no ensemble recurrence. The scientific preorder is lexicographic:

1. evidence ordinal: supported=3, mixed=2, limited=1, not-assessable=0;
2. fewer severe-clash residue pairs;
3. smaller maximum van der Waals overlap, quantized to 0.01 A;
4. IMGT numbering available, then higher CDR-contact share;
5. more interface residue pairs;
6. larger DeltaSASA, quantized to 1 A2.

Preserve full-tuple ties. Coordinate hashes and row IDs may order display rows only and never enter the scientific preorder.

## Prespecified baselines

Evaluate on the identical candidate rows:

- producer confidence/rank within target-by-generator;
- DeltaSASA;
- contact count;
- negative severe-clash count;
- negative maximum overlap;
- CDR-contact share;
- all-tied ranking;
- fixed-seed random permutation as a diagnostic, not the all-tied baseline.

No score, weight, threshold, quantization, baseline orientation, or missing-value policy may change after labels are opened. Producer confidence missing from either required generator fails its comparison rather than silently dropping rows.

## Labels and failure policy

Pin official `DockQ==2.1.3` and explicit receptor:VHH mapping `AB:AB`. Record DockQ, Fnat, iRMSD, LRMSD, candidate/reference hashes, invocation, package digest, and raw output.

CAPRI/DockQ bands are incorrect `[0,0.23)`, acceptable `[0.23,0.49)`, medium `[0.49,0.80)`, and high `[0.80,1]`. The primary binary label is DockQ >=0.23. Sensitivity cutoffs are 0.21 and 0.25; exclusion within +/-0.02 of 0.23 is veto-only.

An eligible row with missing or nonfinite DockQ or ConfoVHH output fails the machinery gate. No imputation or deletion is allowed. A stratum with no positives has AP/AUROC/Kendall unavailable and success/precision at k equal to zero; an all-positive stratum is uninformative for discrimination. Report all denominators. At least ten independent groups must contain both classes for a ranking claim.

## Endpoints and ties

Compute metrics in each target-by-generator stratum, average generator strata equally within target, targets equally within independent group, and groups equally. Pairwise arm differences use the exact common eligible rows and are differenced before averaging.

Primary endpoints:

- independent-group-macro average precision (AP);
- AP lift, calculated per stratum as AP/prevalence before hierarchical averaging.

Secondary endpoints:

- AUROC;
- expected precision and success at k=1,5,10;
- enrichment factor at p=0.01 and 0.05 with `k=max(1,ceil(p*n))`;
- Kendall tau-b against continuous DockQ;
- supported-versus-other odds ratio;
- supported-band false-positive rate among incorrect poses;
- generator, receptor class, interface-size, resolution, and training-cutoff diagnostics.

For a tied score block with `m` rows, `q` positives, and `r` positions crossing k: expected additional true positives are `r*q/m`; success is `1-C(m-q,r)/C(m,r)` unless a prior positive already makes it one. AP enters complete blocks together. AUROC gives 0.5 credit to positive-negative ties. Kendall uses tau-b.

The supported-versus-other odds ratio uses a 0.5 correction on all four cells only when an otherwise eligible 2x2 table has a zero cell.

## Uncertainty, multiplicity, and sensitivities

Use 10,000 paired hierarchical bootstrap replicates with a frozen seed/RNG and type-7 percentile quantiles. Sample independent groups with replacement, then targets within each selected group; keep both generators and all poses intact. Use identical draws for all arms and paired differences. Report finite replicates and eligible groups. Do not bootstrap poses, report parametric p-values, or use "statistically significant" language.

The scientific gate is an intersection-union gate: every condition must pass. Secondary and subgroup analyses are descriptive. Sensitivities can veto but never rescue. For strongest-baseline top-10 success, recompute the maximum prespecified baseline in every bootstrap replicate before differencing.

Required veto analyses are cutoffs 0.21/0.23/0.25, boundary exclusion, 30%-identity exclusion, every leave-one-group-out analysis, and each generator separately.

## Integrity controls

The execution is uninterpretable unless all pass:

- exact target, source, generator, environment, checkpoint, MSA, implementation, rule, and ledger hashes;
- at least ten leakage-free independent groups and both required generators for every target;
- every attempted and eligible row reconciled, with no replacement attempts;
- native-self DockQ=1 within 1e-6 and far-translation DockQ<0.01, zero contacts, zero DeltaSASA for every target;
- whole-complex rigid invariance for DockQ and every ConfoVHH field;
- standalone and batch DockQ agreement within 1e-6 on at least 20 poses;
- candidate reconstruction and raw/canonical coordinate hashes agree;
- ConfoVHH scoring cannot mutate candidate or label ledgers;
- a different display hash cannot split a scientific tie;
- independent metric implementations agree on analytic and randomized fixtures;
- no preparation module imports DockQ, native readers, child processes, or unrestricted filesystem access;
- no native path, coordinate text, DockQ/CAPRI/Fnat/iRMSD/LRMSD field, or sentinel byte appears in public pre-label artifacts;
- symlink, hard-link, traversal, duplicate-ID, noncanonical-JSON, nonfinite-number, source-TOCTOU, dirty-tree, changed-seal, and second-execution adversaries fail closed;
- generic CI cannot invoke authorization, label opening, or one-time execution.

## Resource and failed-pose contract

Freeze per-file bytes, per-target attempts, wall time, CPU/GPU time, RAM/VRAM, output bytes, MSA requests, retries, and concurrency before execution. No cap may be expanded after inspecting a holdout output. Perform calibration only on synthetic or development inputs.

Planning bounds—not measured promises—are 10-30 GPU-hours for ColabFold, 10-50 GPU-hours for Boltz, and 250 GB storage for ten targets. Each learned arm has a hard eight GPU-hour per-target cap and 25 GB per-target output cap. A timeout or resource kill remains a failed ledger row and is never retried under a new seed.

## Gates and allowed claims

Procedural gate: all integrity controls pass, at least ten independent groups exist, both generators are complete, and 100% of pre-label eligible rows have immutable ConfoVHH and DockQ records.

Evaluability gate: at least ten independent groups contribute both classes; producer confidence is available for both generators; supported odds ratio is estimable; and each generator has prespecified class/group coverage.

Scientific gate:

- macro AUROC point >=0.70 and paired-bootstrap lower >0.50;
- macro AP-lift lower >1;
- supported odds ratio point >=2 and lower >1;
- ConfoVHH-minus-each-baseline macro AP point and paired lower >0;
- ConfoVHH-minus-maximum-baseline expected success@10 point >=0.10 and paired lower >0;
- each generator macro AP lift >=1 and AUROC >=0.50;
- every required sensitivity preserves positive AP difference against every baseline;
- every leave-one-group-out AP difference against the strongest baseline remains >0.

Missing or unavailable gate quantities fail. Passing one benchmark may set only `formalHoldoutEvaluated=true`, `hardDecoyProtocolCompleted=true`, and a narrowly named preliminary reference-similarity claim flag. `nearNativeRankingValidated` remains false pending a second independent or prospective benchmark.

If machinery passes but any scientific gate fails, publish every metric and failure and use exactly this conclusion:

> On the frozen [G]-group, [N]-pose reference-similarity benchmark, the preregistered ConfoVHH audit ordering did not satisfy all enrichment gates. ConfoVHH remains a coordinate-coherence and recurrence audit; this result does not validate selection of near-native or binding-competent poses.

## Current freeze blocker

The documented metadata-only screen dated 2026-08-28 records eight candidate
structures resolving to seven provisional groups and zero formally cleared
groups, below the minimum of ten. Candidate-discovery completeness is not
established.
The machine-readable census and exclusion ledger live under
`validation/hard-decoy-holdout-v2/prelabel-census/`. This protocol must remain
unexecutable until a reproducible search universe yields an exact >=10-group
target manifest and every missing source archive,
sequence/lineage/epitope/publication record passes the leakage validator.

Substantial GPU allocation is also required for both frozen generator arms. No GPU run is authorized before the target-count blocker is resolved and the user approves the final checksummed resource envelope.
