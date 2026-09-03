# ConfoVHH

**A local-first workspace for comparing modeled GPCR–nanobody complexes before experimental follow-up.**

[![CI](https://github.com/darwinxcai/ConfoVHH/actions/workflows/ci.yml/badge.svg)](https://github.com/darwinxcai/ConfoVHH/actions/workflows/ci.yml)
![Product](https://img.shields.io/badge/product-v0.9.1-42d3a5)
![Node](https://img.shields.io/badge/Node-%E2%89%A522.18-5fa04e)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[Quick start](#quick-start) · [Validation](#validation-and-current-evidence) · [Methods and provenance](./VALIDATION.md) · [How to cite](./CITATION.cff)

![ConfoVHH auditing the public β₂AR–Nb80 structure 3P0G, showing receptor–nanobody contacts, interface burial, CDR involvement, and the interpretation boundary.](./public/media/confovhh-3p0g-audit.png)

*Example analysis of the public β₂AR–Nb80 complex 3P0G. The structure is included to demonstrate the workflow, not to benchmark prediction accuracy.*

## Why I built it

Structure-prediction tools can return several plausible GPCR–nanobody poses for the same target. Their confidence metrics are useful, but they do not directly answer the experimental questions I usually care about: Is the interface physically coherent? Are the modeled contacts concentrated in the VHH CDRs? Does the same modeled epitope recur across runs? Does the model contact the receptor region the experiment was designed to probe?

I built ConfoVHH to make that review step systematic and inspectable. It takes existing AlphaFold, ColabFold, or Boltz outputs and organizes the structural evidence needed to compare them. The project grew from work on conformation-selective GPCR nanobodies, where a visually convincing complex can still place the binder at the wrong surface or overstate what a predicted pose establishes.

ConfoVHH does **not** generate structures or predict binding affinity. It is a triage and analysis tool for models that already exist.

## What it does

- Reads PDB and PDBx/mmCIF structures, including deposited biological assemblies.
- Recognizes output folders from AlphaFold Server, local AlphaFold 3, ColabFold, and Boltz.
- Requires the researcher to confirm receptor and VHH chain assignments before analysis.
- Measures receptor–VHH contacts, interface residues, severe steric overlaps, and approximate buried surface area (ΔSASA).
- Assigns IMGT framework and CDR regions with pinned `immunum 1.3.0` and reports how much of the modeled interface is CDR-mediated.
- Maps directional PAE only when the matrix-to-residue order has been explicitly confirmed.
- Compares 2–12 compatible poses by recurrent contact pair, receptor epitope, and VHH paratope.
- Supports user-defined receptor footprints, such as an intended extracellular or intracellular binding region.
- Produces two complementary summaries: a pose shortlist ordered by coordinate evidence, and an ensemble view ordered by recurrence and clash burden.
- Exports JSON, spreadsheet-safe CSV, and Markdown reports with source hashes and method provenance.

All structure and PAE analysis runs in the browser. ConfoVHH does not upload the selected files to an application server.

## Typical workflow

1. Load a single complex or select a prediction-output folder.
2. Review the detected files and confirm the receptor and VHH chains.
3. Inspect individual interfaces, CDR usage, clashes, ΔSASA, and available PAE.
4. Compare compatible poses across models or seeds.
5. Add the intended receptor footprint and record an **advance**, **hold**, or **exclude** decision with notes.
6. Export a documented shortlist or analysis dossier for experimental review.

The bundled demo uses the public β₂AR–Nb80 complex [3P0G](https://www.rcsb.org/structure/3P0G), so the complete workflow can be explored without unpublished data.

## Reading the outputs

| Output | Useful for | Main caution |
|---|---|---|
| Contact pairs and interface residues | Locating the modeled epitope and paratope | A contact cutoff is geometric, not energetic |
| Severe clashes | Finding obvious atomic interpenetration | A clash flag does not prove experimental nonbinding |
| Half-ΔSASA interface area | Describing how much surface is buried | Burial is not binding free energy and can increase in interpenetrating poses |
| IMGT CDR-contact share | Checking whether the VHH engages through its antigen-binding loops | CDR involvement does not establish the correct epitope |
| Directional PAE | Reviewing model uncertainty over the coordinate-defined interface | It depends on correct residue-axis mapping and is not a binding score |
| Pose recurrence | Finding interfaces reproduced within the uploaded set | A consistently wrong pose can recur across correlated runs |
| Intended-footprint overlap | Testing a researcher-specified mechanistic hypothesis | ConfoVHH does not infer membrane orientation or receptor state |

## Validation and current evidence

ConfoVHH separates software verification from biological performance claims. Detailed methods, source accessions, checksums, and frozen analysis records are in [VALIDATION.md](./VALIDATION.md).

| Validation layer | Current result | What it shows |
|---|---:|---|
| Unit and integration suite | **526/526 tests passed** | Parsers, geometry calculations, exports, workers, provenance checks, and failure handling behave as specified |
| PDB ↔ mmCIF regression panel | **17/17 structures matched** | Equivalent structural inputs produce matching atom, residue, contact, and clash results |
| Deposited-assembly reconstruction | **5/5 coordinate oracles matched** | Assembly operators and generated chain copies are reconstructed correctly |
| Genuine prediction outputs | **10/10 poses and 10/10 PAE audits completed** | End-to-end compatibility with public AlphaFold Server and ColabFold outputs |
| Cross-structure pose-ranking study | **1,222 retained poses from 17 public structures** | The ranking rule was tested beyond the five structures used during development |

For the 12 structures not used to choose the pose-ranking rule, the top-ranked perturbation was DockQ-acceptable in **12/12** cases. Target-macro average precision was **0.838**, compared with **0.635** for an all-tied control.

That result is encouraging but deliberately narrow. Every decoy in the study was generated by rigidly perturbing a solved receptor–VHH complex. It shows that the ranking rule was not specific to the original five structures; it does **not** establish performance on blind docking or on the more difficult failure modes produced by real prediction pipelines, such as a plausible interface at the wrong epitope. An independent hard-decoy evaluation on prediction-derived poses remains the main scientific validation milestone.

ConfoVHH output should therefore be interpreted as structured evidence for model review, not as proof of binding, affinity, specificity, signaling, receptor-state selectivity, or membrane compatibility.

## Quick start

Requirements: Node.js 22.18 or newer.

```bash
git clone https://github.com/darwinxcai/ConfoVHH.git
cd ConfoVHH
npm ci
npm run dev
```

Open the local address printed by the development server and load the β₂AR–Nb80 demo or your own complex.

Run the complete offline release gate with:

```bash
npm run test:release
```

The public-data benchmarks download structures from RCSB and are kept separate from the offline suite:

```bash
npm run test:mmcif
npm run test:benchmark
```

## Supported inputs

- PDB and PDBx/mmCIF coordinate files
- AlphaFold Server coordinate and full-data JSON outputs
- Local AlphaFold 3 sample outputs
- ColabFold coordinate and score/PAE outputs
- Boltz coordinate outputs

Boltz NPZ PAE is currently inventory-only. Coordinate analysis can proceed, but a PAE matrix is used only when a compatible JSON representation and its residue order have been independently verified.

## Architecture and privacy

ConfoVHH is written in TypeScript and React. Coordinate parsing, IMGT numbering, interface analysis, ensemble comparison, and PAE processing run in bounded Web Workers so that large calculations do not block the interface.

```text
app/          researcher workspace and orchestration
components/   structure intake, interface review, PAE, and pose comparison
lib/          parsers, geometry, ranking, exports, and validation contracts
tests/        unit, integration, rendered-output, and worker-runtime tests
validation/   public regressions, study records, and frozen protocol artifacts
scripts/      reproducible validation and release utilities
```

Input files remain in the browser session. Exported reports may contain selected protein sequences, residue-level contacts, researcher notes, and source hashes, but not the complete raw coordinate or PAE files.

## Versioning

The researcher-facing release is **v0.9.1**. The attested contact, clash, SASA, PAE, and comparison lineage remains **v0.5**, while the current VHH-numbering and pose-ranking policies are versioned **v0.6**. Historical and current implementation snapshots are retained separately so that validation records are not rewritten when a component is promoted.

## Documentation

- [Validation record](./VALIDATION.md) — study design, results, limitations, and exact evidence locations
- [Release provenance](./PROVENANCE.md) — version layers and implementation snapshots
- [Hard-decoy protocol v3](./HARD_DECOY_PROTOCOL_V3.md) — planned independent evaluation design
- [Dependency policy](./DEPENDENCY_POLICY.md) — pinned scientific and QA environments
- [Contributing](./CONTRIBUTING.md) — development setup and data-boundary requirements
- [Citation metadata](./CITATION.cff)

## Author and license

Created and maintained by [Darwin Cai](https://github.com/darwinxcai) as an independent open-source project at the intersection of GPCR structural biology and computational protein design.

ConfoVHH is released under the [MIT License](./LICENSE). Third-party software, public structural metadata, and source-specific licenses are summarized in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
