# ConfoVHH prospective hard-decoy validation protocol

Status: **prospectively specified; formal holdout not yet executed**. This file is a versioned protocol, not a public preregistration or proof that a holdout exists. Until an unopened, family-clustered holdout passes every release gate below, ConfoVHH must not claim to identify near-native poses or predict binding.

The executed five-target local-SE(3) development pilot is documented in `validation/dockq-development-pilot-v1/`. It reuses development structures and validates generation, labeling, aggregation, and provenance plumbing only. It does not count toward this protocol.

## Primary question

Does a score ordering frozen before holdout access enrich reference-similar GPCR–VHH poses among contact-rich, physically plausible docking decoys beyond prespecified single-feature baselines?

Pinned DockQ v2 is the offline structural-similarity oracle. It compares a pose with a known reference complex; it does not measure binding, affinity, specificity, signaling, or physiological validity. DockQ quality bands are incorrect below 0.23, acceptable from 0.23 to below 0.49, medium from 0.49 to below 0.80, and high at or above 0.80. See the [DockQ paper](https://doi.org/10.1371/journal.pone.0161879), [DockQ v2](https://doi.org/10.1093/bioinformatics/btae586), and [official implementation](https://github.com/wallnerlab/DockQ).

## Split and leakage contract

- Treat the current 17-structure regression panel and the five-target local-SE(3) pilot as development data only.
- Lock at least 10 additional direct GPCR–VHH complexes representing at least 10 independent receptor–epitope–VHH-lineage groups before any scoring revision.
- Keep identical receptor UniProt IDs, receptor 7TM clusters, VHH lineages/CDR3s, mapped epitopes, construct families, publications, and repeated ligand/state structures in the same group.
- Cluster canonical UniProt 7TM segments with a fixed global alignment. Primary leakage exclusion is >40% sequence identity at ≥80% mutual coverage; repeat the analysis under a stricter 30% identity rule.
- Group receptor subtypes with >40% 7TM identity even when deposited under different gene names. Group identical or clearly lineage-related VHHs even when chain IDs or constructs differ.
- Exclude every development PDB, receptor cluster, VHH lineage, publication, and mapped interface from the primary holdout.
- Curate the depositor-defined assembly from PDBx/mmCIF and store source URL, retrieval time, raw bytes/SHA-256, assembly ID, model ID, label/auth asym IDs, operator tuples/matrices, chain-instance map, extraction version, and normalized A:B pair digest.
- Exclude auxiliary G-protein nanobodies, anti-BRIL/Fab binders, arrestin-directed binders, same-chain covalent receptor–VHH fusions, and pairs lacking a direct receptor–VHH interface.
- Restrict receptor chains to the mapped receptor sequence when a deposited fusion partner shares the chain.
- Never attach native PAE or interpret experimental B factors as pLDDT for rigid-body decoys.

All target identities and group assignments must be frozen and checksummed before any holdout pose is scored. If a group assignment changes after labels are viewed, create a new holdout version.

## Candidate generation

Keep receptor coordinates fixed and transform the bound VHH with deterministic, stored 4×4 matrices. Preserve receptor and VHH internal geometry. Generate approximately 2,048 candidates per target before DockQ from three fixed strata:

1. **Local SE(3):** 576 poses from rotations of 2°, 5°, 10°, 20°, 40°, and 80° crossed with translations of 0.5, 1, 2, 4, 8, and 16 Å and 16 deterministic axis/direction replicates.
2. **Tangential slides:** 512 poses from eight slide distances spanning 2–20 Å, 16 tangent azimuths, and four spins around the local surface normal.
3. **Wrong-patch relocation:** up to 960 poses from 48 solvent-accessible receptor anchors on the native membrane face and 20 VHH spins per anchor.

For wrong-patch poses:

- derive a membrane normal from mapped transmembrane helices;
- retain anchors on the same extracellular or intracellular side as the native VHH;
- exclude anchors within 12 Å of any native interface residue;
- use a fixed residue-level solvent-accessibility method;
- orient the native paratope toward the local surface and radially adjust it to create a contact-rich nonoverlapping pose.

Apply these label-independent physical filters before ConfoVHH:

- at least eight receptor–VHH residue pairs within 5 Å;
- no protein-heavy-atom separation below 1.8 Å;
- exact monomer sequence and coordinate integrity;
- VHH Cα pose deduplication below 0.5 Å RMSD after receptor alignment;
- no filter based on ConfoVHH evidence, contacts at its released cutoff, ΔSASA, CDR share, or any DockQ value.

Freeze and hash the complete candidate transform ledger before DockQ labeling. Failed and excluded poses must remain in the ledger with explicit reasons.

## DockQ labeling and final pool

Pin official `DockQ==2.1.3` and record the installed version plus package digest. Normalize pairs to canonical A=receptor and B=VHH, then use explicit `--mapping AB:AB`. Clear DockQ memoization caches between models or run isolated processes; validate the batch path against the standalone CLI within 10⁻⁶.

Use DockQ only after the candidate ledger is frozen. Select a final 200-pose pool per target without consulting ConfoVHH:

- 2 high;
- 3 medium;
- 5 acceptable;
- 95 incorrect with \(0.10 \leq DockQ < 0.23\);
- 95 incorrect with \(DockQ < 0.10\).

Within each band, use deterministic max-min ligand-RMSD diversity and fixed generator caps. Native-self and +1,000 Å VHH controls remain outside the ranking pool. The final benchmark therefore contains exactly 2,000 poses and a fixed 5% acceptable-or-better prevalence if all ten targets satisfy the quota. A target unable to satisfy its quota fails assembly of that holdout version; do not backfill using ConfoVHH.

## Frozen ConfoVHH arms

The product’s ensemble consensus is pool-dependent and limited to 2–12 uploaded poses, so it is not the primary single-pose score. Before the holdout is opened, freeze this transparent independent-pose audit ordering:

1. evidence band: supported, mixed, limited, not-assessable;
2. fewer severe-clash residue pairs;
3. smaller maximum van der Waals overlap;
4. higher IMGT CDR-contact share, with unavailable values last;
5. more interface residue pairs;
6. larger ΔSASA;
7. coordinate SHA-256 as a label-independent final display tie-break.

Call this an audit ordering, not a probability, affinity score, or binding score. Pose SHA-256 must not break metric ties. Score every pose with `confidenceMode="none"`, no PAE, no pLDDT interpretation, and no ensemble recurrence.

Prespecified single-feature baselines are contact count, ΔSASA, negative severe-clash count, negative maximum overlap, CDR-contact share where available, and an all-tied prevalence baseline. A pool-dependent offline ensemble arm may be reported only as a separate sensitivity analysis explicitly outside the product’s 12-pose operating range. Do not fit weights, thresholds, or a composite score using holdout DockQ labels.

## Tie handling and endpoints

Primary binary label: DockQ ≥0.23.

Primary endpoints:

- receptor-family-macro average precision;
- AP lift over the fixed 5% per-target prevalence.

Secondary endpoints:

- receptor-family-macro AUROC;
- expected success and precision at 1, 5, and 10;
- enrichment factor at 1% and 5%;
- receptor-family-macro Kendall τb against continuous DockQ;
- acceptable-pose rate and supported-versus-other odds ratio by evidence band;
- supported-band rate among physically plausible incorrect poses;
- results by generator, receptor family, native interface size, and structure resolution.

Ties are scientific ties:

- average precision enters each complete score block together;
- AUROC uses a Mann–Whitney formulation with 0.5 credit for positive-negative ties;
- Kendall uses τb;
- precision@k uses the expected positive fraction when a boundary block crosses \(k\);
- success@k uses the corresponding hypergeometric expected probability;
- EF uses \(k=\max(1,\lceil pn\rceil)\) and each target’s actual prevalence;
- pose IDs are for deterministic display only and never affect metrics.

Calculate every metric per target first. Average repeated structures inside a receptor/interface-family group, then weight independent groups equally. Report the eligible-target denominator for every macro value; targets lacking both classes are unavailable, not silently removed.

For supported-versus-other odds ratios, require observations in both exposure groups. Apply a 0.5 Haldane–Anscombe correction only when an otherwise eligible 2×2 table has a zero outcome cell. Average log odds ratios across independent groups, then exponentiate.

## Uncertainty and sensitivity

Use 10,000 paired hierarchical bootstrap replicates:

1. sample receptor/interface-family groups with replacement;
2. sample targets within each selected group with replacement;
3. retain all score arms under the same draw;
4. never resample individual poses.

Report percentile 2.5% and 97.5% bounds, seed, finite-replicate count, and eligible groups. Use the same draws for paired arm differences. These are holdout-group bootstrap intervals, not a substitute for a second external benchmark. Do not report parametric p-values or “statistically significant” based only on this deterministic panel.

Required sensitivity analyses:

- DockQ cutoffs 0.21, 0.23, and 0.25;
- exclusion of poses within ±0.02 of 0.23;
- exclusion of every receptor group violating the stricter 30% development-identity rule;
- leave-one-family-out results;
- generator-level metrics only when the stratum contains at least five positives and 20 negatives; otherwise report false-positive rate and counts.

## Benchmark-machinery controls

The holdout run fails unless all controls pass:

- 10/10 native-self DockQ values equal 1 within 10⁻⁶;
- 10/10 +1,000 Å VHH translations have DockQ <0.01, zero ConfoVHH contacts, and zero ΔSASA;
- ten whole-complex rigid transformations preserve DockQ, contacts, clashes, and ΔSASA;
- repeated generation produces byte-identical transform ledgers;
- single-process and multiprocessing DockQ results agree;
- API and standalone CLI agree within 10⁻⁶ on at least 20 poses;
- reconstructing each audited decoy from its stored matrix reproduces its coordinate hash;
- ConfoVHH scoring does not mutate the frozen transform or DockQ ledgers;
- each target has exactly 200 unique poses and the prespecified class counts;
- no development structure, receptor cluster, VHH lineage, mapped epitope, or publication occurs in the primary holdout.

## Artifact contract

Store a versioned specification, target ledger, pose ledger, machine-readable summary, human-readable summary, and SHA-256 checksum manifest. Each pose retains generator stratum, seed, pivot, axis/direction, affine matrix, coordinate hashes, eligibility, deduplication, DockQ mapping and raw metrics, CAPRI class, ConfoVHH audit fields, software versions, implementation digest, timestamp, and error state. The result must contain:

```json
{
  "formalHoldoutEvaluated": true,
  "hardDecoyProtocolCompleted": true,
  "nearNativeRankingValidated": false,
  "preliminaryNearNativeClaimAllowed": false
}
```

The last two flags can change only through the release gate below. “Completed” means the frozen protocol and controls were executed; it does not mean the scientific gate passed.

## Preliminary release gate

The phrase “preliminary enrichment of reference-similar poses” is permitted only if the unopened holdout meets every condition:

- macro AUROC point estimate ≥0.70 and 95% lower bound >0.50;
- supported-band odds ratio ≥2 and 95% lower bound >1;
- paired target-macro AP difference versus every prespecified single-feature baseline >0 with each paired 95% lower bound >0;
- expected top-10 success at least 10 percentage points above the strongest single-feature baseline with paired lower bound >0;
- AP-lift lower bound >1;
- no eligible generator stratum performs below its all-tied/random expectation;
- improvement direction is unchanged at DockQ cutoffs 0.21, 0.23, and 0.25, after boundary exclusion, and under the stricter 30% identity rule;
- all machinery, leakage, quota, and artifact-integrity controls pass.

Even if every gate passes, the allowed statement must name the synthetic rigid-body benchmark, target and family counts, fixed prevalence, and reference-similarity endpoint. It must immediately state that the study does not validate experimental binding, affinity, specificity, conformational selectivity, flexible docking, nonbinder discrimination, or de novo model quality.

If any gate fails, publish the result and retain the narrower claim:

> ConfoVHH audits coordinate coherence and ensemble recurrence; it does not identify near-native or binding-competent poses.
