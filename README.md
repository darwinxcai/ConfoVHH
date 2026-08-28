# ConfoVHH

**Local-first structural triage for modeled GPCR–nanobody complexes.**

[![CI](https://github.com/darwinxcai/ConfoVHH/actions/workflows/ci.yml/badge.svg)](https://github.com/darwinxcai/ConfoVHH/actions/workflows/ci.yml)
![Product](https://img.shields.io/badge/product-v0.8.0-42d3a5)
![Scientific engine](https://img.shields.io/badge/scientific_engine-v0.5.0-2b8a75)
![Tests](https://img.shields.io/badge/ordinary_tests-349%2F349_passed-42d3a5)
![Node](https://img.shields.io/badge/Node-%E2%89%A522.18-5fa04e)

**[Launch ConfoVHH](https://confovhh.darwin-cai.chatgpt.site)** · [Five-minute workflow](#five-minute-workflow) · [Validation record](./VALIDATION.md) · [How to cite](./CITATION.cff)

ConfoVHH is a browser-side research application for auditing and prioritizing predicted GPCR–VHH coordinate sets from AlphaFold, ColabFold, and Boltz workflows. It converts raw complex predictions into inspectable interface evidence, pose-recurrence summaries, researcher-authored candidate decisions, and provenance-bound handoff reports.

Raw coordinates and PAE matrices remain in the browser tab. The application does **not** claim to predict binding, affinity, functional state, membrane compatibility, or pose correctness.

## Why this project exists

Structure-prediction pipelines can produce many visually plausible GPCR–nanobody poses, but built-in confidence values do not automatically answer whether an interface is physically coherent, CDR-driven, recurrent across seeds, or located at the intended receptor footprint. ConfoVHH makes those questions explicit and auditable without collapsing them into an opaque composite score.

### Core workflow

```mermaid
flowchart TD
    A["PDB / mmCIF or prediction folder"] --> B["Confirm receptor and VHH chains"]
    B --> C["Audit contacts, clashes, ΔSASA and CDR usage"]
    C --> D["Attach directional PAE when mapping is confirmed"]
    C --> E["Compare 2–12 compatible poses"]
    D --> F["Review evidence and intended footprint"]
    E --> F
    F --> G["Advance / hold / reject with researcher notes"]
    G --> H["Export JSON, CSV and Markdown dossier"]
```

## What it does

- Parses legacy PDB and PDBx/mmCIF coordinates, including explicit deposited-assembly reconstruction.
- Identifies receptor–VHH contacts, interface residues, geometric clash candidates, and deterministic 960-point Shrake–Rupley ΔSASA.
- Assigns sequence-aligned IMGT framework/CDR regions with pinned `immunum 1.2.0`.
- Maps directional PAE only after explicit model/residue-order confirmation.
- Compares compatible multi-seed pose ensembles by contact, epitope, and paratope recurrence.
- Audits existing AlphaFold Server, local AlphaFold 3, ColabFold, and Boltz output folders.
- Maps user-supplied extracellular, intracellular, transmembrane, and intended receptor footprints without inferring membrane orientation.
- Supports researcher-authored **advance / hold / reject** decisions and notes without inventing a binding score.
- Exports canonical audit JSON, spreadsheet-safe CSV, lab-note Markdown, and complete workspace dossiers with hashes and method provenance.

## Five-minute workflow

ConfoVHH audits prediction outputs; it does not run AlphaFold, ColabFold, or Boltz from FASTA sequences.

1. [Open the public app](https://confovhh.darwin-cai.chatgpt.site). For an immediate single-structure example, choose **Load β₂AR–Nb80 demo**.
2. For a batch, choose the prediction output folder (or the matching files), then review every coordinate/PAE association and select a reference pose.
3. Choose **Open reference pose**, confirm which chains are the receptor and VHH, and run the single-pose interface audit.
4. Use **Continue prediction run** to return to the batch. ConfoVHH propagates chain roles only through unique exact-sequence matches and rejects ambiguous or changed chains.
5. Analyze the ready poses, inspect coordinate recurrence and per-pose PAE, record **advance / hold / reject** decisions, and export the dossier or shortlist.

All scientific work stays in the browser tab. Boltz coordinates are supported, but native NPZ PAE is inventory-only; continue coordinate-only unless a compatible JSON matrix and its axes/order were independently verified.

## Run locally

Requirements: Node.js 22.18 or newer.

```bash
git clone https://github.com/darwinxcai/ConfoVHH.git
cd ConfoVHH
npm ci
npm run dev
```

Open the local address printed by the development server, then either load the public β₂AR–Nb80 demo (PDB `3P0G`) or select your own PDB/mmCIF complex. Analysis is performed locally in a Web Worker.

For a production verification run:

```bash
npm run lint
npm test
node scripts/validate-real-prediction-runs.mjs --verify=validation/real-prediction-run-regression-v1.json --quiet
```

## Validation snapshot

| Layer | Current result | Interpretation |
|---|---:|---|
| Ordinary unit/integration tests | 368/368 passed | 349 product/engine tests plus 19 fail-closed census-integrity tests |
| Genuine producer outputs | 2 public runs · 26 source files · 10/10 poses · 10/10 PAE audits | End-to-end compatibility for actual AlphaFold Server and ColabFold outputs |
| PDB↔mmCIF parity | 17/17 structures | Parser/metric reproducibility across serializations |
| Deposited assemblies | 5/5 coordinate oracles | Assembly-operation reconstruction accuracy |
| Native interfaces | 17/17 detected | Positive and obvious-geometry regression coverage |
| Far-translation controls | 102/102 rejected | Zero-interface sanity checks |
| DockQ development ledger | 360/360 poses + 20/20 controls | Benchmark plumbing and descriptive development analysis |

These counts are software/regression evidence, not a biological performance estimate. The DockQ perturbation set is development-only and does not establish generalization. No independent family-clustered hard-decoy holdout has yet been evaluated. See [VALIDATION.md](./VALIDATION.md) and [HARD_DECOY_PROTOCOL.md](./HARD_DECOY_PROTOCOL.md).

On 2026-08-28, the documented metadata-only screen for the stricter [v2 hard-decoy protocol](./HARD_DECOY_PROTOCOL_V2.md) recorded eight candidate structures resolving to seven provisional public direct GPCR–VHH groups and zero formally cleared groups, against a frozen minimum of ten. Candidate-discovery completeness was not established. No candidate coordinates, DockQ/CAPRI labels, or holdout results were accessed. The minimum was not relaxed, so this is a checksummed [blocked screening checkpoint](./validation/hard-decoy-holdout-v2/prelabel-census/), not an exhaustive census, assembled holdout, upper bound, or performance result.

## Architecture

ConfoVHH is a TypeScript/React application built with Vinext for Cloudflare-compatible deployment. Coordinate parsing, IMGT numbering, ensemble analysis, and per-pose PAE auditing run in bounded browser workers. Canonical reports retain raw-file SHA-256 values, coordinate/geometry fingerprints, parser policy, chain/assembly provenance, and software versions.

The repository's `package.json` version remains `0.5.0` because it identifies the commit-attested scientific engine. Researcher-facing capabilities advance independently as product release `0.8.0`; product-only changes do not relabel the frozen v0.5 validation artifacts.

```text
app/          researcher workspace and orchestration
components/   prediction-run intake, contact/PAE explorers, state comparison
lib/          parsers, geometry engine, workers, exports, validation contracts
tests/        unit, integration, rendered-output, and worker-runtime tests
validation/   frozen public regression and DockQ development artifacts
scripts/      reproducible public-data and adversarial validation runners
```

## Scientific boundaries

ConfoVHH prioritizes **coordinate plausibility and recurrence for experimental review**. Favorable output is not evidence of binding, affinity, specificity, stability, signaling, receptor-state selectivity, physiological assembly, or membrane compatibility. Experimental validation remains required.

## Author and citation

ConfoVHH was created by [Darwin Cai](https://github.com/darwinxcai). Citation metadata are available in [CITATION.cff](./CITATION.cff). Third-party licenses and attributions are summarized in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Released under the [MIT License](./LICENSE).

## Product release 0.8

The researcher-facing product release is 0.8.0. Its scientific engine remains the commit-attested v0.5.0 implementation; the v0.5 public-regression and post-label replay artifacts are not relabeled as new validation.

Release 0.8 adds a researcher-authored candidate decision layer to native prediction-run results. Scientists can search and filter audited poses, record advance/hold/reject dispositions with bounded notes, reopen candidates for deeper inspection, and export a provenance-bound shortlist as JSON or spreadsheet-safe CSV. These decisions are deliberately separate from ConfoVHH evidence fields: the product does not compute or imply a composite binding score.

The product layer adds:

- a task-centered workflow for single-pose audit, optional seed/pose ensemble, optional paired context, and handoff;
- explicit study, receptor, candidate, coordinate-context, intended-footprint, and research-note metadata;
- a deterministic coordinate-review brief derived from the existing evidence band, review findings, selected metrics, and workflow coverage, with no new composite score;
- a searchable, filterable, paginated complete contact explorer and contact CSV export;
- two directional cross-chain PAE heatmaps on shared receptor-Y/VHH-X axes (the reverse block is explicitly transposed for aligned display), sampled contact overlays, both directional medians/P90s, and a conservative ≤10 Å contact share that is explicitly descriptive—not calibrated or a native predictor cutoff;
- user-defined intended receptor-footprint mapping and observed-contact overlap, explicitly not specificity or state compatibility;
- expanded ensemble inspection with the three consensus components, pairwise matrix, and an excluded-pose ledger;
- one strict JSON workspace dossier plus a human-readable Markdown handoff, with exact report/workflow/decision/provenance reconciliation alongside the canonical scientific exports;
- read-only dossier review and an opt-in, versioned local summary notebook;
- explicit cancel, three-minute worker timeouts, guarded reset, coordinate replacement, focused errors/results, skip navigation, and responsive workflow states.
- a native prediction-run intake for AlphaFold Server, local AlphaFold 3, ColabFold, and Boltz output directories, with a bounded scientific-manifest ledger, a separate metadata-only ledger for oversized unsupported binaries, deterministic pairing proposals, explicit researcher confirmation, per-pose PAE quarantine, coordinate-recurrence analysis, and JSON/CSV run exports;
- optional annotated receptor-footprint consistency using mutually exclusive extracellular, intracellular, and transmembrane residue sets supplied by the researcher, without inferring a membrane plane, orientation, accessibility, receptor state, or binding.

The local notebook stores explicitly saved user-entered study context and derived summary metrics. It does not automatically copy loaded coordinate text, parsed sequences, PAE matrices, or residue-contact tables. Notebook imports use exact allowlists and internally reconcile their claimed selection identity, but their metrics, audit fingerprints, and provenance claims are not recomputed or authenticated because a notebook intentionally omits the canonical report and source data. Treat an imported notebook as a schema-checked organizational summary, not scientific evidence. Complete dossier files can contain full canonical result records and contact tables, but no raw coordinate or PAE matrix. Dossier import validates fixed policy text, report structure, result-field attestation, workflow/decision consistency, footprint requests, PAE residue mapping, and cross-report provenance; it does not replay coordinate geometry/PAE values or authenticate the non-cryptographic screening fingerprints. Re-upload coordinates to recompute, extend, or verify an imported analysis.

### Native prediction-run intake

The prediction-run intake introduced in v0.7 scans selected files locally and supports these exact native associations:

| Producer | Coordinate pattern | PAE/confidence pattern used for PAE | Pairing namespace |
|---|---|---|---|
| AlphaFold Server | `fold_<job>_model_<N>.cif` | `fold_<job>_full_data_<N>.json` | relative directory + job + model number |
| Local AlphaFold 3 | `<base>_model.cif` | `<base>_confidences.json` | relative directory + base name |
| ColabFold | `<prefix>_(unrelaxed\|relaxed)_rank_###_<tag>.pdb` | `<prefix>_scores_rank_###_<tag>.json` | relative directory + complete rank/tag |
| Boltz | `<input>_model_N.(cif\|pdb)` | `pae_<input>_model_N.npz` is inventory-only and is not analyzed | relative prediction directory + input + model number |

Filename matching proposes an association; it does not prove that two files came from the same model or that a PAE axis follows coordinate residue order. Every PAE-bearing run therefore requires explicit confirmation after the manifest is reviewed. AlphaFold 3 token metadata is used only when it maps every parsed protein residue uniquely; extra or ambiguous tokens fail closed. A dimension-only matrix still requires researcher confirmation. Summary-confidence JSON is retained as metadata and is never substituted for PAE.

The public generated-output regression downloads and verifies exact SHA-256 values for two genuine five-model runs: a CC-BY-4.0 [ColabFold-multimer dataset](https://zenodo.org/records/17063524) and the commit-pinned [AF3_MiniPAE AlphaFold Server example](https://github.com/martinovein/AF3_MiniPAE/tree/a7458d1d26a35154cbfc3e24ec197352079970df/data/example/p06730_o60516). All 10 coordinates, all 10 matched PAE sources, manifest pairing, exact-sequence chain propagation, recurrence, contact/clash/ΔSASA calculation, and per-pose export records completed. These two compatibility controls are not GPCR–VHH systems and do not add biological or ranking validation; domain-specific geometry regression remains the separate 17-structure public GPCR–VHH panel.

A directory or multi-file selection may contain at most 512 entries. From that selection, at most 128 bounded recognized/readable files can enter one scientific manifest, including no more than 12 coordinate poses. Supported coordinate text is limited to 12 MiB per file, JSON to 16 MiB per file, aggregate coordinate text to 48 MiB, selected PAE JSON attachments to 48 MiB aggregate, and recognized/readable manifest content to 96 MiB. A supported text candidate that exceeds its individual limit stops intake. An oversized unsupported binary is instead retained only as a local skipped-file record containing its relative path, byte count, and reason; it is not read, hashed, or included in the scientific manifest or run dossier. Bounded NPZ and pickle files may be hashed and inventoried in the manifest, but they are never decoded, deserialized, or executed. Duplicate coordinate digests, ambiguous relaxed/unrelaxed variants, reused PAE files, path traversal, invisible/control characters, disguised content, and unresolved pairings block analysis until explicitly resolved.

Coordinate recurrence is calculated first by the unchanged v0.5 ensemble engine. PAE remains exact per-pose context: each retained pose is audited only with its explicitly associated PAE source, and no PAE source or summary is pooled, transferred, or substituted across poses. A missing, malformed, or unmappable PAE source is recorded for that pose as not provided or rejected and cannot silently become another pose's confidence input. PAE never changes recurrence rank or coordinate evidence band. The run dossier contains the resolved bounded manifest, hashes, pairing basis, rejection ledgers, canonical reports, and optional topology summaries, but excludes raw coordinate text, PAE matrices, and the metadata-only records for oversized unsupported binaries that never entered the manifest.

## v0.5 scope

### Coordinate ingestion and provenance

- reads legacy PDB (`.pdb`, `.ent`) and PDBx/mmCIF (`.cif`, `.mmcif`) coordinate text;
- uses recognized filename extensions first and content sniffing as a fallback for unknown extensions; malformed input fails closed;
- parses the selected actual model identifier rather than assuming that model IDs start at one;
- preserves PDBx/mmCIF `label_asym_id` and depositor-facing `auth_asym_id` separately;
- inventories deposited assembly annotations and reconstructs only an explicitly selected assembly;
- expands operation lists, numeric ranges, and Cartesian products without evaluating code;
- gives every generated chain copy an opaque unique identity and records its source asym ID, generator row, operation tuple, and composite transform;
- analyzes protein-heavy-atom records only and reports nonprotein components omitted during assembly materialization;
- records SHA-256 over the original file bytes separately from both a source-frame selected-coordinate fingerprint and an SE(3)-canonical selected-geometry fingerprint;
- rejects source coordinates outside ±10,000,000 Å before geometry analysis;
- performs coordinate and PAE parsing in a Web Worker with bounded input, atom, protein-chain, chain-copy, model, assembly, operation-expression, and PAE-matrix limits.

“Deposited assembly” means a depositor/PDB-supplied annotation. Applying its operators does not determine whether that assembly is physiological, and ConfoVHH does not generate additional crystallographic symmetry mates.

### Interface audit

- unique receptor–VHH residue contacts within 4.5 Å;
- interface-residue counts on each chain;
- distance-only donor–acceptor and acidic/basic proximity candidates;
- element-specific severe van der Waals overlaps and a narrow interchain-disulfide exemption;
- occupancy-aware, coherent residue-level alternate-conformer selection;
- parser diagnostics for malformed, duplicate, unsupported, zero-occupancy, and conflicting records;
- deterministic 960-point Shrake–Rupley protein-heavy-atom ΔSASA and the descriptive \(\frac{1}{2}\Delta SASA\) interface-area convention;
- formal sequence-aligned IMGT numbering and CDR/interface mapping using exactly pinned `immunum 1.2.0`;
- optional directional interface PAE from a dimension-matched JSON matrix after explicit residue-order confirmation;
- optional interface pLDDT only when the user confirms that the coordinate B-factor field stores pLDDT.

Single-audit contact, distance, overlap, PAE, pLDDT, and approximate SASA calculations use the selected source coordinates exactly as supplied or materialized. Multi-file ensemble and paired jobs keep contacts, distances, clashes, and provenance in each source frame but make an in-memory deterministic proper-signed rigid-frame clone for approximate SASA only. The clone is not exported as a changed structure and is not used for contact decisions. The policy records `selected-heavy-atom-farthest-signed-frame-v1` as the SASA-frame algorithm. This split-frame policy has tested numerical stability under broad rigid transforms while preserving exact source-frame distance boundaries; finite-grid anchor ties can still cause small ΔSASA changes and remain explicitly warned about.

SASA work fails closed before unbounded computation. Each audit permits at most 25,000,000 candidate atom-distance checks while building partner-neighbor lists and at most 250,000,000 surface-point occlusion checks. These are computational safety bounds, not scientific thresholds.

PAE is disabled after deposited-assembly expansion because a matrix for the supplied asymmetric coordinates cannot safely be reused across generated chain copies. PAE input is limited to 16 MiB of source text and a square matrix of at most 1,500 residues; container, nesting, entry-count, dimension, and finite-value preflights fail at the first exceeded bound. The matrix is stored as a row-major `Float32Array`, parsed off the main thread, and transferred rather than duplicated.

### Multi-pose comparison

ConfoVHH compares a selected reference coordinate scope with 1–11 as-supplied PDB and/or PDBx/mmCIF candidates when the observed receptor and VHH sequences match the explicitly selected reference pair exactly. Candidate files are parsed independently and assigned only when exact observed-sequence matching is unique; chain IDs may differ. The selected receptor–VHH heavy-atom identity inventory must also match the reference exactly, so an otherwise sequence-identical pose with missing side-chain atoms can be rejected. It reports contact-pair, receptor-epitope, and VHH-paratope Jaccard recurrence, then assigns a deterministic rank in this order:

1. higher ensemble consensus;
2. lower severe-clash burden.

Poses tied on both scientific criteria receive the same competition rank; the stable code-unit pose identifier controls display order only. The visible `triageGroup` is a descriptive coordinate-geometry band derived from the single-pose evidence level. It and ΔSASA remain report metadata; neither controls ensemble rank. Rank is therefore recurrence-first, not an estimate of binding or native-pose correctness.

Every pose retains source format, model ID, coordinate scope, assembly ID, label/auth chain identities, copy/operator provenance, raw-byte SHA-256, a source-frame selected-coordinate fingerprint, and a separate SE(3)-canonical selected-geometry fingerprint. Duplicate membership is resolved as connected components of proper-rotation fit edges, so non-transitive chains of near-duplicates do not depend on upload order. The reference is privileged in its component; every candidate-only component retains a deterministic geometry medoid. Duplicate nonrepresentatives are removed before interface ledgers are allocated. The proper-rotation duplicate check requires a fitted heavy-atom RMSD ≤0.02 Å and maximum residual ≤0.05 Å; reflected coordinates do not pass. JSON and CSV reports use application export schema 1.2 with an explicit software version and audit-policy fingerprint, and CSV fields are neutralized against spreadsheet-formula injection.

The coordinate and geometry fingerprints are deterministic screening/provenance identifiers, not cryptographic identity proofs: they use FNV-1a and the geometry form rounds canonical coordinates to 0.01 Å. Raw-file SHA-256 remains the cryptographic byte-level identifier.

Consensus measures recurrence inside the uploaded set, not correctness. Correlated seeds and near-duplicates can inflate it, and a consistently wrong pose can recur. PAE and B-factor-derived pLDDT are completely omitted from ensemble comparison, including per-contact confidence, so all poses use the same coordinate-only policy.

### Paired coordinate-context comparison

The state-context workspace compares one explicitly selected receptor–VHH pair from the reference file with a uniquely assigned comparison pair after independent parsing and exact observed-sequence matching. It requires unambiguous, exact equality of both observed receptor sequences and both observed VHH sequences; the comparison chain IDs need not match the reference chain IDs. The current rigid-duplicate gate additionally requires the selected receptor–VHH heavy-atom identity inventories to correspond exactly; equal sequences alone do not guarantee pair eligibility. It reports:

- signed contact, clash, and approximate ΔSASA changes, always defined as **comparison minus reference**;
- contact-pair, receptor-epitope, and VHH-paratope Jaccard similarity;
- shared, reference-only, and comparison-only residue contacts;
- the independent audit and full coordinate provenance for each side;
- optional user labels that are retained as descriptive metadata only.

The single-audit JSON report, ensemble JSON/CSV reports, and paired JSON/CSV reports use application export schema 1.2. Paired JSON and long-form CSV both include all shared, reference-only, and comparison-only contact records, along with the SASA orientation policy, sphere-point count, 25,000,000 candidate-distance bound, and 250,000,000 surface-point-occlusion bound. Paired comparison has no rejection ledger in either format: a failed pair produces an error instead of an accepted summary export.

The same proper-rotation fit used for ensemble deduplication rejects a rigidly equivalent pair before comparison. The feature does not align one biological interface onto the other, infer an active or inactive receptor state, estimate conformational preference, or validate state-selective binding. A favorable signed change is not evidence that one condition binds better.

Reference/comparison labels are optional user-supplied metadata only. Paired jobs accept and use no PAE, B-factor-derived pLDDT, or per-contact confidence values; confidence fields in the coordinate-only audits must be null.

Each condition's approximate SASA is evaluated in its own deterministic canonical clone. Small ΔSASA differences can reflect finite sphere-grid orientation or a canonical-anchor switch and must not be interpreted as energetic changes.

## Evidence boundaries

The evidence band describes internal coordinate coherence. It is not a probability, energy, or calibrated decision threshold. Favorable geometry does not establish:

- experimental binding or nonbinding;
- affinity, specificity, kinetics, or developability;
- agonism, antagonism, signaling, or receptor-state selectivity;
- membrane compatibility or physiological assembly;
- correctness relative to an unknown native complex.

## Validation status

The release suite combines offline unit/integration tests with distinct public-data exercises. They answer different questions and are never pooled into one performance claim.

The public-panel counts below were reproduced from clean source commit `5cb57617b54baa314513486885c402449f643406` and are recorded with raw-source, implementation, and executed-`immunum` hashes in `validation/v0.5-public-regression-attestation-v1/`.

| Exercise | Result | What it supports | What it does not support |
|---|---:|---|---|
| PDB↔PDBx/mmCIF native serialization parity | 17/17 exact atom, residue, contact, and clash/evidence matches; ΔSASA parity within 1×10⁻⁹ Å² | parser normalization and metric reproducibility | docking or binding discrimination |
| Deposited-assembly reconstruction | 5/5 official assembly oracles matched; maximum coordinate error <0.00078 Å | operation parsing, composition, and chain-copy provenance | physiological oligomerization |
| Public native-interface regression panel | 17/17 interfaces detected; 17/17 translations preserved contacts/ΔSASA; 102/102 far translations returned zero contacts/ΔSASA | native-interface and obvious-geometry regression | realistic negatives or near-native ranking |
| Public state-context coverage inventory | 4/4 native interfaces represented in 2 receptor-context pairs; 0 same-VHH cross-context pairs | regression coverage for the four individual coordinate audits | state discrimination, state selectivity, or same-VHH context transfer |
| Local-SE(3) DockQ development pilot | 360/360 poses scored; all 20 controls/cross-checks passed | deterministic generation, DockQ labeling, tie-aware aggregation, and provenance plumbing | locked holdout, blind docking, or near-native validation |
| v0.5 post-label DockQ regression replay | 360/360 exact coordinates, non-SASA audits, DockQ records, and CAPRI labels; 360/360 SASA audits within fixed tolerance; 20/20 controls/cross-checks | no unintended software regression detected on the previously labeled development ledger | new evidence, independent validation, or generalization |

The development-only DockQ pilot reused five public complexes already present in development data. At DockQ ≥0.23, target-macro AP was 0.688 for the categorical ConfoVHH evidence band, 0.636 for the all-tied prevalence baseline, and 0.773 for raw ΔSASA. Corresponding AUROCs were 0.574, 0.500, and 0.754. This narrow, high-positive-prevalence perturbation grid therefore does not justify a near-native-ranking claim. The complete frozen v0.4 specification, source-integrity manifest, 360-pose ledger, per-target results, 10,000-replicate tie-aware bootstrap summaries, implementation/DockQ/Python provenance, and checksums remain byte-for-byte frozen in `validation/dockq-development-pilot-v1/`.

The v0.5 replay was executed from clean source commit `278ae1a74da133778fba5b17bc296a8e37f02e76` and is recorded separately in `validation/dockq-v0.5-regression-replay-v1/`. It reproduced all discrete records exactly; maximum ΔSASA drift was 1.03×10⁻¹⁰ Å² against the 1×10⁻⁹ Å² bound fixed before the full 360-pose scan. It reuses already observed DockQ labels only to detect software regression and is not a second experiment. The public state-context inventory is in `validation/state-context-native-regression-v1.json` and contains zero same-VHH cross-context examples.

No independent family-clustered hard-decoy holdout dataset exists for this release; none has been assembled, labeled, frozen, opened, or evaluated. [HARD_DECOY_PROTOCOL.md](./HARD_DECOY_PROTOCOL.md) is a prospective protocol only and must not be described as an existing dataset or a completed study.

The separate [v2 pre-label census](./validation/hard-decoy-holdout-v2/prelabel-census/) is deliberately blocked before target freeze: its documented screen contains seven provisional and zero formally cleared groups, below the preregistered minimum of ten; candidate discovery remains incomplete. It does not change any validation claim above.

See [VALIDATION.md](./VALIDATION.md) for methods, frozen expectations, and the status of commit-attested release results.

## Local commands

ConfoVHH requires Node.js 22.18.0 or newer.

```bash
npm run dev
npm run lint
npm run typecheck
node --test tests/*.test.mjs
npm test
npm run test:release
npm run test:adversarial
npm run test:mmcif
npm run test:benchmark
npm run test:public-attestation
```

The DockQ exercises additionally require pinned DockQ 2.1.3:

```bash
python3 -m venv .bench-venv
CC=gcc .bench-venv/bin/pip install "DockQ==2.1.3"
npm run test:dockq-pilot
npm run test:dockq-replay
```

`npm run test:mmcif` and `npm run test:benchmark` download public RCSB files and are intentionally separate from the offline release suite. `npm run test:public-attestation` executes both from a clean committed worktree, records raw-source hashes and commit-bound implementation digests, and atomically writes a non-overwriting v0.5 evidence artifact. `npm run test:dockq-pilot` is the historical v0.4 runner: its frozen version assertion means it is runnable only from the v0.4 source tree, and a release must never overwrite `validation/dockq-development-pilot-v1/`. `npm run test:dockq-replay` writes the separate post-label v0.5 regression attestation and must start from a clean committed tree.

The app includes a public experimental demo based on the β₂AR–Nb80 complex [RCSB PDB 3P0G](https://www.rcsb.org/structure/3P0G). Coordinate and PAE analysis occurs locally in the browser; unpublished structures are not required for the bundled examples or validation records.
