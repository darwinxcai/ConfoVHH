# ConfoVHH v0.5 scientific-engine validation record

ConfoVHH is a coordinate-quality and prioritization aid. The record below tests parser correctness, assembly reconstruction, geometric calculations, deterministic multi-pose bookkeeping, paired coordinate-context bookkeeping, browser-worker behavior, numerical/resource bounds, and reproducible benchmark plumbing. It does **not** validate binding, affinity, specificity, signaling, physiological assembly, membrane compatibility, state selectivity, near-native ranking, or a universal pose-acceptance threshold.

The current researcher-facing product is release 0.8.0 and continues to run the attested v0.5.0 scientific engine. Product-only functions—workflow navigation, native prediction-run manifests, provider-specific file pairing, per-pose PAE mapping and quarantine, annotated receptor-footprint consistency, researcher-authored candidate dispositions and shortlist exports, the coordinate-review brief, contact filtering/CSV, PAE display downsampling, dossier/notebook serialization, import validation, accessibility, cancellation, and local-summary privacy—have their own deterministic offline tests. They do not change the fixed contact, clash, SASA, PAE-summary, IMGT, ensemble, or paired-comparison calculations, and they do not create new biological validation evidence.

## Release test layers

### Offline automated suite

The standard suite covers:

- fixed-column PDB parsing, actual model-ID selection, duplicate model-ID rejection, insertion codes, modified polymer residues, hydrogen removal, duplicate/malformed records, occupancy boundaries, zero-occupancy residue indexing, coherent residue-level alternate-conformer selection, and explicit 100-model input bounds;
- bounded PDBx/mmCIF tokenization with quoted and semicolon text, comments, missing-value distinctions, arbitrary loop column order, uncommon whitespace, uncertainty notation, strict numeric syntax, model selection, multi-character IDs, label/auth identity, microheterogeneity fail-closed behavior, malformed-block/loop/control-token rejection, and exact 256-protein-chain and 256-assembly inventory bounds;
- fail-closed rejection of source coordinates outside ±10,000,000 Å;
- deposited-assembly metadata, operation lists/ranges/Cartesian products, noncommuting transform composition order, multiple generator rows, unique generated chain instances, missing/duplicate operator rejection, unknown asym-ID rejection, rigid-transform checks, coordinate bounds, and expansion limits;
- exact contact, polar, salt-proxy, clash, and interchain-disulfide boundaries, including the inclusive 4.5 Å residue-contact boundary, a 50,000-unique-interface-pair allocation cap, and fail-closed behavior before an oversized interface ledger is materialized;
- coordinate-completeness and pLDDT range/coverage guards;
- formal IMGT positions, FR/CDR boundaries, terminal tags, and long-CDR3 insertion labels with exactly pinned `immunum 1.2.0`;
- AlphaFold-style, generic `pae`, and raw PAE JSON; exact square-matrix dimensions up to 1,500 residues and Float32-range checks; bounded preflight rejection of oversized or deeply nested JSON before parsing; explicit axis-orientation and residue-order confirmation; directional summaries; contact-wise conservative aggregation; row-major `Float32Array` storage; and production-worker transfer behavior;
- analytic two-sphere ΔSASA, deterministic atom-order traversal, partner-swap and translation invariance, source-frame contact preservation, randomized proper-rigid canonical-frame stability, exact-distance tie handling under large translations, and spatial-grid agreement with brute-force/analytic oracles including a narrow selenium boundary case;
- fail-closed SASA preflights at 25,000,000 candidate atom-distance checks and 250,000,000 surface-point occlusion checks;
- mixed PDB/PDBx-mmCIF ensembles, recurrence calculations, exact-sequence matching, upload-order invariance, connected-component near-duplicate resolution, deterministic geometry medoids, proper-rotation duplicate detection, mirrored-coordinate non-equivalence, pre-audit duplicate removal, partial batch failure, provenance, CSV formula neutralization, competition ranks, and shared strict JSON/CSV validation;
- paired reference/comparison audits, exact observed receptor/VHH sequence gates, ambiguity rejection, comparison-minus-reference signed deltas, all three Jaccards, shared/reference-only/comparison-only contacts, optional descriptive labels, duplicate rejection, provenance, and export schemas;
- large-cardinality and adversarial cases covering 130,000 exact duplicate atom records, 1,000×1,000 ambiguous chain candidates, 3,000+3,000 atom SASA candidate pressure, bounded interface-pair creation, a 250,000 shared-atom chain-suggestion comparison budget, and deterministic fallback when more than 4,096 chain pairs are nearby;
- rendered application and accessibility semantics, raw-byte file hashing, worker cancellation/error behavior, busy-state progress context, production assets, and production-worker runtime requests;
- deterministic native-run classification and pairing for AlphaFold Server, local AlphaFold 3, ColabFold, and Boltz naming conventions; path and content sniffing; duplicate-digest and one-PAE-per-pose guards; manifest permutation invariance; bounded selection/manifest byte and count limits; bounded unsupported-binary inventory; metadata-only skipping of oversized unsupported binaries before read/hash/manifest; and no-raw-source export privacy;
- per-retained-pose PAE parsing with explicit researcher confirmation, exact token-metadata subsetting, asymmetric directional summaries, declared-maximum validation, partial PAE rejection without coordinate-result erasure, and strict source/hash/model provenance;
- optional user-supplied extracellular/intracellular/transmembrane residue-class mapping, mutual-exclusivity checks, exact observed-contact overlap, annotation-coverage accounting, intended-side descriptive shares, and fixed negative inference flags;
- offline validation of frozen public-data manifests, historical and v0.5 replay artifact checksums, source/implementation hashes, DockQ ledger completeness, CAPRI boundaries, control results, every AP/AUROC/Kendall point and sensitivity result, all 10,000 bootstrap intervals, and mandatory false claim flags.

Run:

```bash
npm test
npm run test:adversarial
npm run test:release
node scripts/validate-real-prediction-runs.mjs --verify=validation/real-prediction-run-regression-v1.json --quiet
```

`npm run test:release` is the offline release gate: lint, typecheck, production build, ordinary tests, then the fixed-seed adversarial suite. The adversarial layer adds randomized rigid transforms and reflections, parser/PAE boundary constructions, malformed token streams, exact resource ceilings, ensemble and native-manifest upload permutations, provider-key collision families, directional PAE metamorphic checks, topology set-oracle comparisons, cancellation/replacement state-machine traces, export mutation attacks, and CSV control/format-character injection cases. It is deterministic and offline; it complements rather than replaces the ordinary unit and integration suite.

Current v0.8 product-layer result (2026-08-28): **349/349 ordinary tests passed**, including the emitted production prediction-run worker runtime request; **33/33 fixed-seed adversarial suites passed**, exercising exactly **7,221,999 semantic cases** and **4,679,968 assertions**. These are software-verification counts, not biological-validation samples.

The blocked hard-decoy v2 census adds 19 ordinary integrity tests, bringing the current repository total to **368/368** without relabeling the v0.8 product-layer result.

### v0.8 product-layer validation boundary

The native-run workflow first invokes the unchanged coordinate-only v0.5 ensemble executor. Only retained exact-sequence-compatible poses advance to an independent per-pose PAE audit. PAE remains exact per-pose context: an audit uses only the PAE source explicitly associated with that coordinate pose, and no PAE source or summary is pooled, transferred, or substituted across poses. A missing, malformed, dimension-mismatched, ambiguously mapped, or understated-maximum PAE source receives an explicit rejected/not-provided record while the coordinate audit remains labeled as coordinate-only. No fallback searches another JSON file, and PAE does not affect recurrence rank, evidence band, contact geometry, clashes, or approximate SASA.

Provider filenames are tested as deterministic association proposals, not identity proofs. A directory or multi-file selection may contain at most 512 entries; no more than 128 bounded recognized/readable files can enter one manifest. The manifest preserves the relative directory, byte count, SHA-256, detected role/provider, native key, and selected association for every bounded file that entered it, including bounded ignored, unsupported, or rejected files. Supported coordinate text is limited to 12 MiB per file, JSON to 16 MiB per file, aggregate coordinate text to 48 MiB, selected PAE JSON attachments to 48 MiB aggregate, and recognized/readable manifest content to 96 MiB. Oversized unsupported binaries are excluded before read and hash and appear only in a separate local metadata record containing path, size, and reason; they are not part of the scientific manifest or run dossier. Bounded NPZ and pickle files can be inventoried and hashed but are never decoded, deserialized, or executed. Boltz NPZ remains unsupported for PAE analysis; the app does not claim that naive format conversion proves matrix axes, token mapping, or compatibility. Continue coordinate-only unless a compatible JSON matrix and its complete protein-residue axes/order have been independently verified. AlphaFold 3 token-level PAE with nonprotein tokens is subset only when chain and residue token metadata maps each parsed protein residue exactly once.

Annotated receptor-footprint consistency compares unique coordinate-contacting receptor residues with mutually exclusive user-supplied residue classes. Its exported result explicitly records that no topology inference, membrane-plane calculation, or membrane-compatibility assessment occurred. These checks validate deterministic mapping and accounting only; they do not validate extracellular accessibility, whole-binder sidedness, receptor state, epitope correctness, or binding.

The v0.8 product work intentionally leaves the frozen v0.5 engine, package lock, public regression artifacts, DockQ development pilot, and post-label replay artifacts unchanged. Acceptance of intact earlier notebook and dossier records is regression-tested; newly created researcher-facing records identify the current product release where their schema exposes that field.

The network-enabled public-data exercises are explicit commands so an offline test run cannot silently depend on a mutable remote archive:

```bash
npm run test:mmcif
npm run test:benchmark
npm run test:public-attestation
```

The first two commands print their current results. Public coordinate responses use a 30-second per-request timeout and a 4 MiB per-file declared/streamed byte limit. `npm run test:public-attestation` must start from a clean committed tree; it runs both public exercises from a detached worktree, records raw-source, implementation, and executed-dependency digests, cross-reconciles independent PDB downloads, and publishes a separate exclusively locked, non-overwriting artifact atomically.

Current status: **executed current-release regression**. The clean-tree run completed on 2026-08-27 from source commit `5cb57617b54baa314513486885c402449f643406`; checksummed outputs, exact implementation digests, raw-source hashes, and the before/after hash of the executed `immunum 1.2.0` distribution are in `validation/v0.5-public-regression-attestation-v1/`. All biological claim flags remain false.

The supported runtime is Node.js ≥22.18.0. This minimum is recorded in both `package.json` and the lockfile.

## Public generated-output compatibility regression

`node scripts/validate-real-prediction-runs.mjs --verify=validation/real-prediction-run-regression-v1.json --quiet` downloads two immutable public producer-output sets, verifies every expected byte count and SHA-256 digest before parsing, builds the same bounded manifest used by the application, and executes reference-chain confirmation, unique exact-sequence propagation, five-pose recurrence, five coordinate audits, and five per-pose PAE audits for each dataset. The checked-in result is `validation/real-prediction-run-regression-v1.json`; raw prediction files are not copied into this repository.

| Public source | Actual files exercised | Result | Purpose |
|---|---:|---:|---|
| [ColabFold-multimer CtBP–Prospero dataset, Zenodo 17063524](https://zenodo.org/records/17063524) | 5 PDB + 5 score JSON · 8,984,507 bytes | 5/5 coordinates and 5/5 PAE audited | Native rank/tag pairing and two-decimal PAE serialization |
| [AF3_MiniPAE AlphaFold Server example at commit `a7458d1`](https://github.com/martinovein/AF3_MiniPAE/tree/a7458d1d26a35154cbfc3e24ec197352079970df/data/example/p06730_o60516) | 5 mmCIF + 5 full-data JSON + 5 summary JSON + request JSON · 3,970,615 bytes | 5/5 coordinates and 5/5 PAE audited | Model-index pairing, mmCIF parsing, and token-metadata PAE mapping |

The release-candidate browser pass also selected the ten original Zenodo ColabFold files through the visible multi-file control, reviewed the five exact native associations, opened and confirmed the reference chains, completed its single-pose audit, explicitly confirmed all five PAE axes, and completed the five-pose run. The rendered result showed 5 retained coordinates, 5 audited PAE attachments, 0 rejected attachments, aligned decision/recurrence columns, and enabled manifest/dossier/CSV/shortlist exports. This is an interaction/producer-compatibility check, not a biological validation result.

The first ColabFold execution exposed a real interoperability defect: its `max_pae` scalar was `31.6875` while the two-decimal serialized matrix contained `31.69`. The intake now accepts only a fixed ≤0.01 Å serialization discrepancy, normalizes the maximum upward to the observed matrix value, and still rejects larger understatements. That boundary has a direct regression test.

These systems are not GPCR–VHH complexes. They validate producer-output compatibility, not nanobody biology, binding, pose correctness, IMGT accuracy, or ranking generalization. The separate 17-structure public GPCR–VHH panel remains the domain-specific coordinate regression. No actual Boltz native NPZ PAE is claimed as supported or validated.

## PDBx/mmCIF and deposited-assembly regression

`npm run test:mmcif` downloads both legacy PDB and PDBx/mmCIF serializations for the 17 public GPCR–VHH structures in `validation/mmcif-regression-manifest.v1.json`. Each PDBx/mmCIF and deposited-assembly source covered by the manifest must match its frozen byte count and SHA-256 before parsing. Legacy PDB bytes are independently downloaded by both public exercises, hashed in each result, and required to match each other in the commit-bound attestation.

Commit-attested v0.5 result:

- 17/17 PDB and PDBx/mmCIF structures had exactly equal selected protein-heavy-atom counts;
- 17/17 had exactly equal protein residue counts and selected receptor/VHH atom counts;
- 17/17 selected audits had exactly equal contact-pair counts, severe-clash counts, and evidence bands; PDB↔PDBx/mmCIF ΔSASA differed by no more than 1×10⁻⁹ Å² and matched the frozen value within 1×10⁻⁶ Å²;
- label/auth asym-ID disagreements in 6KNM, 7YM8, 7L1V, 5JQH, and 6IBL were resolved without merging chains.

The same command reconstructs five deposited assemblies from the source PDBx/mmCIF operator tables and independently parses RCSB’s corresponding pre-expanded official assembly files. Generated chains are paired with official chains by sequence and atom identity before coordinate comparison.

| PDB | Assembly | Protein atoms | Protein chains | Protein residues | Maximum coordinate error (Å) |
|---|---:|---:|---:|---:|---:|
| 6VI4 | 1 | 5,951 | 4 | 794 | 2.5×10⁻¹⁴ |
| 1TRZ | 3 | 2,373 | 12 | 306 | 0.000699 |
| 3C70 | 1 | 4,114 | 2 | 512 | 1.5×10⁻¹⁴ |
| 1OUT | 1 | 4,368 | 4 | 576 | 0.000770 |
| 4IP9 | 1 | 4,974 | 6 | 624 | 0.000700 |

All atom, chain, and residue counts matched exactly. The acceptance tolerance was fixed at 0.0011 Å. These tests establish faithful application of deposited transformations; they do not establish that a depositor-supplied assembly is physiological.

## Public native-interface regression panel

`npm run test:benchmark` uses 17 experimentally determined structures spanning class A and class F GPCRs, intracellular and extracellular epitopes, active and inactive contexts, and multiple VHH/scaffold families. This is a **public native-interface regression panel**, not a docking benchmark.

Commit-attested v0.5 result:

- 17/17 annotated native receptor–VHH pairs had a detected interface;
- 102/102 obvious geometry sanity controls produced by translating the VHH ±1,000 Å along each Cartesian axis had zero contacts and zero ΔSASA;
- 17/17 translations of each whole complex preserved contacts and ΔSASA to numerical tolerance;
- pair-aware chain suggestion selected a contacting native pair in the multi-copy 6IBL case;
- five structures matched independently implemented 4.5 Å residue-pair contact counts exactly;
- five ΔSASA calculations agreed with frozen Biopython-derived Shrake–Rupley reference values within 0.37% maximum observed absolute relative difference.

| PDB | Pair | Contact pairs ≤4.5 Å | ConfoVHH ΔSASA (Å²) | Frozen Biopython-derived ΔSASA (Å²) |
|---|---:|---:|---:|---:|
| 3P0G | A:B | 46 | 1729.3 | 1728.4 |
| 4XT1 | A:C | 59 | 2225.6 | 2222.9 |
| 5C1M | A:B | 57 | 2380.9 | 2389.6 |
| 6DO1 | A:C | 60 | 2247.0 | 2246.6 |
| 6IBL | A:C | 72 | 2367.6 | 2364.2 |

The panel contains 3P0G, 4MQS, 4XT1, 6DO1, 6B73, 6RNK, 6KNM, 7YM8, 8QOT, 8FCZ, 7L1V, 6O3C, 8QW4, 5JQH, 6VI4, 5C1M, and 6IBL. The ±1,000 Å cases are deliberately easy geometry controls, not realistic nonbinders, near-native decoys, or contact-rich wrong-patch poses.

“17/17 whole-complex translation invariances” is intentionally narrower than “rigid invariance.” The public command translates each intact complex; broader rotations and large-coordinate transforms are exercised in the offline adversarial suite.

## Public state-context coverage inventory

`validation/state-context-native-regression-v1.json` inventories four native GPCR–VHH complexes already represented in the public native panel:

| Receptor | Reference context | Comparison context | VHH relationship |
|---|---|---|---|
| μ-opioid receptor | 5C1M, agonist-bound active complex with intracellular Nb39 | 8QOT, extracellular antagonist NbE complex | different VHHs |
| κ-opioid receptor | 6B73, agonist-bound active complex with an active-state-stabilizing VHH | 6VI4, ligand-dependent inactive complex with Nb6 | different VHHs |

Frozen prior inventory result:

- 4/4 individual native complexes had an interface in the frozen public regression manifest;
- two receptor-context pairings are represented;
- zero pairings contain the same VHH across contexts.

This artifact is a coverage inventory and a regression anchor for the four independent coordinate audits. It is **not** a paired state-selector benchmark. It cannot evaluate whether ConfoVHH identifies a preferred state for the same VHH, because the required same-VHH cross-context examples are absent. Depositor or publication context labels are retained as metadata and are not inferred from coordinates by ConfoVHH.

All biological claim flags in the artifact are false, including `bindingValidated` and `stateSelectivityValidated`.

## Local-SE(3) DockQ development pilot

The frozen specification at `validation/dockq-development-pilot-v1/pilot-spec.json` was written before DockQ labels were generated. It reuses five development structures—3P0G, 4XT1, 6DO1, 6O3C, and 8QW4—and crosses six rotation magnitudes, six translation magnitudes, and two deterministic axis/direction replicates, yielding 72 poses per target and 360 total.

One CDR-arm missing-value rule was clarified after the initial development plumbing run and before the final source-attested rerun: a successfully numbered pose with zero contacts receives a bottom CDR-contact-share score of 0 instead of being deleted, while a target is unavailable only when every retained pose is unnumbered. No DockQ-fitted threshold or weight was introduced. This clarification does not affect the evidence-band or ΔSASA arms.

The VHH is rotated about its Cα centroid and translated while receptor and VHH internal coordinates remain fixed. Every transform, pivot, unit vector, 4×4 matrix, source/generated coordinate digest, audit output, DockQ output, and failure state is retained. Label-blind 0.5 Å VHH Cα deduplication retained all 360 poses.

DockQ-reported version 2.1.3 labeled the deterministically generated 360-pose ledger with explicit `AB:AB` mapping. The installed distribution files and complete Python environment are hashed and recorded in the machine-readable summary. Results:

- 370/370 DockQ jobs completed: 360 ranking poses, five native-self controls, and five +1,000 Å controls;
- five native-self controls were within 10⁻⁶ of DockQ 1 and reproduced the source audit under explicit discrete-field and coordinate-rounding tolerances;
- five far controls had DockQ <0.01, zero contacts, and zero ΔSASA;
- ten independently invoked DockQ CLI cross-checks matched the batch path exactly;
- the retained grid contained 55 high, 76 medium, 98 acceptable, and 131 incorrect DockQ classes;
- 229/360 poses (63.6%) were acceptable-or-better, making top-k success intrinsically easy and limiting interpretation.

Prespecified target-macro, tie-aware point results at DockQ ≥0.23:

| Score arm | AP | AP lift over target prevalence | AUROC | Kendall τb |
|---|---:|---:|---:|---:|
| ConfoVHH evidence band | 0.688 | 1.081 | 0.574 | 0.368 |
| Contact count | 0.673 | 1.059 | 0.624 | 0.130 |
| ΔSASA | 0.773 | 1.215 | 0.754 | 0.381 |
| Negative clash burden | 0.594 | 0.934 | 0.469 | 0.092 |
| CDR-contact share | 0.688 | 1.082 | 0.674 | 0.198 |
| All poses tied | 0.636 | 1.000 | 0.500 | unavailable |

Average precision enters complete score-tie blocks together; AUROC awards 0.5 credit to positive-negative ties; top-k metrics use expected values when a tie block crosses the boundary; Kendall uses τb. Metrics are computed per target before equal-weight macro averaging. The artifact includes DockQ cutoffs 0.21/0.23/0.25, exclusion of the 0.21–0.25 boundary region, positive rates by evidence band, supported-versus-other odds ratios, and 10,000 paired target-cluster bootstrap replicates. Offline tests independently recompute every reported AP, AUROC, and Kendall point estimate, all sensitivity versions, and all corresponding 10,000-replicate intervals from the pose ledger.

Interpretation: this development-only grid validates deterministic generation, labeling, aggregation, and provenance plumbing and shows descriptive associations inside its narrow native-derived distribution. The categorical ConfoVHH band did not outperform the strongest prespecified single-feature baseline. The study is not an independent holdout, not blind docking, and not execution of the formal hard-decoy protocol. The historical directory is immutable; v0.5 does not rewrite its files.

## v0.5 post-label regression replay

`npm run test:dockq-replay` regenerates the local-SE(3) coordinate ledger with the v0.5 implementation, reruns DockQ 2.1.3, and compares the result against the already labeled v0.4 development artifact. It writes only to `validation/dockq-v0.5-regression-replay-v1/`.

Current status: **executed post-label regression only**. The clean-tree run completed on 2026-08-27 from source commit `278ae1a74da133778fba5b17bc296a8e37f02e76`. All 360 generated coordinate records, normalized non-SASA audit fields, DockQ records, and CAPRI classes matched exactly. All 360 SASA audits passed the fixed 1×10⁻⁹ Å² ΔSASA and 5×10⁻¹⁰ Å² half-ΔSASA bounds; the maximum observed differences were 1.03×10⁻¹⁰ Å² and 5.14×10⁻¹¹ Å², respectively. All five native-self controls, five far-translation controls, and ten independent CLI cross-checks passed, and pose accounting, CAPRI counts, primary target-macro aggregates, sensitivity analyses, and bootstrap intervals matched exactly.

The first replay attempt used full bit-exact audit equality and halted on its first pose at a 4.55×10⁻¹³ Å² ΔSASA difference. Before scanning the remaining pose comparisons, the contract was revised to isolate only ΔSASA and half-ΔSASA behind the fixed bounds above; no DockQ label or performance aggregate was used to choose those bounds. The completed ledger contains 131 positive, 208 negative, and 21 zero ΔSASA drifts, and all 360 observed half-ΔSASA values equal observed ΔSASA/2 exactly, consistent with floating summation-order noise rather than a directional change.

The replay started from a clean, committed v0.5 tree. Its attestation records the source commit, `workingTreeDirtyAtStart: false`, exact computational implementation-file digests, frozen baseline artifact digests, the DockQ distribution digest, and the Python environment lock. Presentation components and the release-status metadata record are deliberately outside the computational digest so they can report the observed result without changing the audited algorithms. Generated outputs are checksummed in `validation/dockq-v0.5-regression-replay-v1/`.

This is a **post-label regression replay**. The v0.4 labels and aggregate results had already been observed before v0.5 was implemented. The passed exact and tolerance-bounded checks are evidence against an unintended software regression on those examples; they contribute no new estimate of ranking performance and are not an independent validation set.

No independent family-clustered hard-decoy holdout dataset exists for this release; none has been assembled, labeled, frozen, opened, or evaluated. `HARD_DECOY_PROTOCOL.md` specifies a future experiment only.

### Independent hard-decoy v2 target census

On 2026-08-28, a metadata-only census tested whether the stricter
`HARD_DECOY_PROTOCOL_V2.md` could be instantiated without weakening its
development-leakage rules. The documented screen recorded eight candidate
structures resolving to seven provisional public direct GPCR–VHH groups and
zero formally cleared groups before the unresolved quality, construct,
receptor-cluster, VHH-lineage, epitope, and publication gates. The frozen
minimum is ten, and the screen is not claimed to be globally exhaustive.

The census therefore stopped before target freeze with status
`TARGET_CENSUS_BLOCKED`. It contains no frozen eligible target set
and cannot be approved or executed. No candidate coordinates, native poses,
DockQ/CAPRI labels, or holdout performance results were retrieved or
inspected. The package pins the metadata sources and exact construct
sequences, records the 11 exclusions encountered and unresolved audits, locks the historical
artifacts, and preregisters generators, scoring, baselines, endpoints,
resources, and fail-closed state transitions so they cannot be silently
repurposed as a completed holdout.

The checksummed record is in
`validation/hard-decoy-holdout-v2/prelabel-census/`. It establishes that this
documented screen is insufficient to freeze the requested study; it does not
establish global public-data infeasibility or provide evidence for or against
ConfoVHH ranking performance.

All release claim flags remain false:

```json
{
  "bindingValidated": false,
  "affinityValidated": false,
  "specificityValidated": false,
  "functionalStateValidated": false,
  "stateSelectivityValidated": false,
  "sameVhhCrossContextValidated": false,
  "membraneCompatibilityValidated": false,
  "formalHoldoutEvaluated": false,
  "hardDecoyProtocolCompleted": false,
  "nearNativeRankingValidated": false,
  "preliminaryNearNativeClaimAllowed": false
}
```

## Method definitions

### Coordinate and assembly scope

“As supplied” means ConfoVHH applies no deposited-assembly or user-requested coordinate transform before the audit. It does not mean that the uploaded coordinates are unmodified experimental coordinates, nor does it certify how an external modeling program produced them. “Deposited assembly” means ConfoVHH applies only the selected `_pdbx_struct_assembly_gen` expressions and `_pdbx_struct_oper_list` transforms from that file. Protein-heavy-atom chains are materialized with unique instance IDs. Nonprotein components are omitted and reported. No crystallographic symmetry beyond the selected deposited assembly is generated.

### Multi-pose consistency

ConfoVHH compares 2–12 separate PDB or PDBx/mmCIF poses only when observed receptor and VHH sequences match the explicitly selected reference pair exactly. Candidate structures are parsed independently and their receptor/VHH chains are assigned only when exact observed-sequence matching is unique; chain IDs may differ. The selected receptor–VHH heavy-atom identity inventory must also correspond exactly, so sequence-identical structures with missing atoms can be ineligible. It computes pairwise Jaccard similarity for residue-contact pairs, receptor epitope residues, and VHH paratope residues; displayed consensus is their unweighted mean when defined. Deterministic rank is recurrence-first: higher ensemble consensus, then fewer severe clashes. Poses tied on both receive the same competition rank; stable code-unit pose identifier controls display order only. The visible `triageGroup` is descriptive coordinate-geometry metadata derived from the single-pose evidence level; neither it nor ΔSASA controls rank. Each retained pose has equal weight.

Near-duplicate membership is a graph property: every proper-rotation fit satisfying RMSD ≤0.02 Å and maximum residual ≤0.05 Å forms an edge, and connected components are resolved before scientific interface ledgers are allocated. The explicit reference is retained in its component. A candidate-only component retains the member minimizing summed pairwise RMSD, then summed maximum deviation, with a full-precision proper-signed geometry signature and finally external identifiers used only for exact ties. This avoids greedy upload-order dependence while preserving the complete rejection ledger.

This is a recurrence measure, not a correctness score. Seed independence cannot be verified, correlated models can inflate recurrence, and a consistently wrong pose can score highly. Ensemble audits completely omit PAE, B-factor-derived pLDDT, and per-contact confidence. Application-export-schema-1.2 JSON retains excluded files and reasons, reference identity, raw source SHA-256, a source-frame selected-coordinate fingerprint, a distinct SE(3)-canonical selected-geometry fingerprint, format/model/assembly provenance, transforms, coordinate-only policy, audit-policy fingerprint, SASA orientation, SASA-frame algorithm/version, sphere-point count, and both computational budgets. Application-export-schema-1.2 CSV contains retained comparison rows and the same policy/provenance fields; exclusion records are JSON-only. The single-audit JSON report, ensemble JSON/CSV reports, and paired JSON/CSV reports all use application export schema 1.2 in v0.5.

Coordinate and geometry fingerprints are lossy, noncryptographic FNV-1a provenance/screening identifiers; canonical geometry coordinates are rounded to 0.01 Å for that fingerprint. The independent raw-source SHA-256 is the byte-level cryptographic digest, and neither fingerprint proves biological identity.

### Paired coordinate-context comparison

The reference and comparison files are audited independently. The reference receptor/VHH pair is explicitly selected in the primary audit workspace. The comparison file is independently parsed and its pair is assigned only by a unique exact observed-sequence match to the reference; comparison chain IDs may differ and there is no separate comparison-chain confirmation step. Multiple possible pairings fail as ambiguous. The current proper-rotation duplicate fit also requires exact correspondence of the selected receptor–VHH heavy-atom identity inventory; same sequence alone does not guarantee eligibility. User labels are optional, descriptive strings. They do not change calculations or evidence bands, and ConfoVHH never classifies a structure as active or inactive from them.

All signed deltas are `comparison − reference`. The three Jaccards use residue identity in exact-sequence coordinates and report contact-pair, receptor-epitope, and VHH-paratope overlap. Shared, reference-only, and comparison-only contact sets are exported. Paired jobs accept and use no PAE, B-factor-derived pLDDT, or per-contact confidence values; the coordinate-only audit fields must be null. Application-export-schema-1.2 JSON preserves both accepted inputs, all audit methods, both fingerprints, full contact sets, and file/assembly/chain provenance. Application-export-schema-1.2 CSV is a long-form accepted-pair export containing the summary, explicit SASA policy/algorithm/bounds, and all shared/reference-only/comparison-only contact records. Paired comparison has no rejection ledger in either format: a failed pair produces an error rather than an exportable accepted summary.

Contacts and clashes use each structure’s supplied coordinates. Approximate SASA alone uses a deterministic rigid-frame clone constructed from the selected receptor–VHH pair. The clone is identity-checked against the original chain, residue, and atom ordering before analysis. This split-frame method prevents an exact 4.5 Å source-frame contact from changing because of floating-point noise introduced by a rigid canonicalization.

Reference and comparison SASA are canonicalized independently. Because the method samples a finite sphere grid, small ΔSASA deltas can reflect grid orientation or a canonical-anchor switch; they are descriptive numerical changes, not energetic changes.

A fitted proper rotation is used only to identify duplicate coordinate sets. A pair is duplicate when corresponding selected heavy atoms fit at RMSD ≤0.02 Å and maximum residual ≤0.05 Å. Reflections are rejected. The fitted transform is not used to manufacture a biological comparison.

### Interface contacts and clashes

A residue pair contacts when any cross-chain protein-heavy-atom pair is within 4.5 Å, including the boundary. Polar and acidic/basic values are distance-only candidates without angular or protonation modeling. A severe clash is a noncovalent heavy-atom van der Waals overlap of at least 0.6 Å; only a Cys SG–SG distance from 1.8 to 2.3 Å receives the possible-disulfide exemption.

### Buried solvent-accessible area

ConfoVHH reports

\[
\Delta SASA = SASA(A) + SASA(B) - SASA(A \cup B)
\]

and the descriptive interface-area convention \(\frac{1}{2}\Delta SASA\). It uses a deterministic 960-point Shrake–Rupley approximation, a 1.4 Å probe, element-based radii, selected protein heavy atoms, and one selected coordinate model. “Approximate” is intentional: ΔSASA depends on the finite sphere-point sampling convention and is not a binding energy or affinity estimate.

Interactive single-pose audits compute approximate SASA in the source coordinate frame. Ensemble and paired comparison jobs use the split-frame policy described above: original coordinates for contacts/clashes/provenance and an independently verified deterministic proper-signed canonical clone for SASA only. The exported policy names `selected-heavy-atom-farthest-signed-frame-v1`. The 25,000,000 candidate-distance and 250,000,000 surface-point-occlusion limits are implementation safety budgets. Crossing either limit returns an explicit error rather than a partial area.

The public regression compares against five frozen Biopython-derived reference values; those values are retained as regression oracles, not presented as a fully reproducible external-software execution record.

### PAE

PAE is summarized in both alignment directions over coordinate-derived contact pairs. Under the AlphaFold convention, row *i* is the residue on which the predicted structure is aligned and column *j* is the residue whose positional error is evaluated. Generic `pae` objects and raw matrices do not prove either axis orientation or residue order, so ConfoVHH requires exact dimensions plus explicit confirmation of the AlphaFold direction convention and that both axes match the displayed parsed protein-residue order. Source text is capped at 16 MiB and the square matrix at 1,500 residues; preflights also bound nesting, container, separator, and entry counts before `JSON.parse`, with the first exceeded bound reported. The confirmation and assumed convention are retained in the export. For each contact pair, the conservative value is the worse direction; median and 90th percentile are reported. The share of conservative contact-pair values at or below 10 Å is a descriptive ConfoVHH reporting rule, not a calibrated acceptance threshold or native predictor score. PAE is model-estimated relative-placement confidence, not experimental error or binding probability. It is rejected after assembly expansion. See [EMBL-EBI AlphaFold guidance](https://www.ebi.ac.uk/training/online/courses/navigating-alphafold-database/understanding-the-structure-prediction-page/downloading-files/).

### IMGT numbering

Pinned `immunum 1.2.0` assigns IMGT positions by sequence alignment. CDR1-IMGT is 27–38, CDR2-IMGT 56–65, and CDR3-IMGT 105–117, including insertion labels. These are numbering positions, not raw sequence offsets. Unrecognized sequences remain explicitly unnumbered. See the [official IMGT numbering definition](https://www.imgt.org/IMGTScientificChart/Numbering/IMGTIGVLsuperfamily.html).

## Remaining limitations

- Evidence bands are transparent heuristics, not calibrated probabilities.
- The public regression panel contains native interfaces and obvious far translations, not realistic docking negatives or experimental nonbinders.
- The local-SE(3) pilot reuses development targets, has 63.6% positives, and lacks wrong-patch, external-generator, flexible, and nonbinding cases.
- The executed v0.5 replay reused already observed labels and therefore measures regression only; it provides no new performance estimate.
- No independent family-clustered hard-decoy holdout dataset exists for this release; none has been assembled, labeled, frozen, opened, or evaluated.
- The v2 metadata census is blocked before target freeze because its documented screen contains seven provisional and zero formally cleared public groups against a minimum of ten; candidate discovery and formal leakage auditing remain incomplete.
- The public context inventory has two receptor pairs but zero same-VHH cross-context pairs.
- Ensemble recurrence cannot prove seed independence or correct for correlated model families.
- Coordinate-derived sequences omit unresolved residues; IMGT-to-coordinate mapping may be incomplete in experimental structures.
- PAE must match the exact selected model and parsed residue order; generated assemblies reject it, and token-level ligand matrices or Boltz `.npz` files require explicit external conversion and mapping.
- Nonprotein ligands, glycans, lipids, waters, ions, and membrane orientation are not evaluated.
- Active/inactive state preference, membrane compatibility, and physiological oligomerization are not assessed.
