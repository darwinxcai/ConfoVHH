# ConfoVHH manuscript and figures

**Acceptable GPCR nanobody predictions can mask errors in confidence ranking**  
Dong Wang Darwin Cai · Independent researcher

Latest verified manuscript revision: **26 September 2026** (abstract polish).
Copied to GitHub on 7 October 2026. This is a reviewed working draft, not a
submitted preprint. The publication items below remain open.

- [Read the manuscript](CONFO_VHH_WORKING_MANUSCRIPT.md), including supplementary methods and Table S1.
- [Download the 18-page PDF](ConfoVHH-preprint-revised.pdf).
- [Download the editable Word document](ConfoVHH-preprint-revised.docx).
- [Source map](source-map.json) and [artifact checksums](MANUSCRIPT-ASSETS.json).

## What this revision reports

For GPR158, 24 of 25 predictions were acceptable, yet default confidence chose
the model ranked 24th by accuracy, 0.130 DockQ below the best generated model.
An acceptable-or-unacceptable benchmark would count that selection as a
success. The ADGRV1 and MC4R baseline batches contained no acceptable model.
The completed follow-up generated one borderline acceptable ADGRV1 model,
which confidence ranked 17th; this follow-up was selected after the failures
were known and is not independent validation.

The manuscript retains the initial negative ranking result, the development
comparisons that did not meet the criteria for replacing confidence, and all
limitations. Its 25-of-26 selection result is conditional on an acceptable
model already being present and comes from eight repeatedly tested receptor
groups. It does not establish that confidence can predict whether a batch
contains any acceptable model.

## Supporting figures

| Figure | Subject | Files |
|---|---|---|
| 1 | Three baseline complexes and actual GPR158 molecular overlays | [PNG](figures/figure-1.png) · [SVG](figures/figure-1.svg) · [PDF](figures/figure-1.pdf) |
| 2 | Contact rules and confidence selection | [PNG](figures/figure-2.png) · [SVG](figures/figure-2.svg) · [PDF](figures/figure-2.pdf) |
| 3 | Generation settings across development cases | [PNG](figures/figure-3.png) · [SVG](figures/figure-3.svg) · [PDF](figures/figure-3.pdf) |
| 4 | Completed ADGRV1 and MC4R follow-up | [PNG](figures/figure-4.png) · [SVG](figures/figure-4.svg) · [PDF](figures/figure-4.pdf) |

Captions and the molecular-display limitations are in the manuscript. PDF,
Word and all 12 figure files are byte-identical to the verified workspace
artifacts. Only the four Markdown figure links were changed for GitHub.

## Provenance and scope

The source map preserves claim-to-evidence identifiers and hashes. Paths
beginning with `local-evidence/` identify retained workspace evidence; those
files are **not included** in this manuscript package and those identifiers
are not download links. Published manuscript and figure paths are relative
to this directory. Historical validation records in the source map describe
the original September 26 artifact; `MANUSCRIPT-ASSETS.json` records both its
hash and the hash after the four link replacements.

The earlier experimental code and compact results remain on the separate
[development branch](https://github.com/darwinxcai/ConfoVHH/tree/21afb63518a3846bb80612924967489f9fbafe12/validation/generation-ranking-v4).
That earlier package does not contain the later 100-prediction follow-up or
molecular illustrations. This update publishes the latest manuscript and
figures, not the complete raw-data archive or a new software release.

The previous September 5 manuscript remains available in
[Git history](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/paper/CONFO_VHH_WORKING_MANUSCRIPT.md).
The [software/application draft](SOFTWARE_PAPER.md),
[reviewer guide](REVIEWER_GUIDE.md),
[older submission checklist](SUBMISSION_READINESS.md),
[165-model development study](../validation/gpcr-paper-development-2026-09-04/README.md),
and [33-job selection audit](../validation/gpcr-selection-development-2026-09-05/README.md)
remain historical context, not the current manuscript or its current
publication checklist.

## Remaining publication items

- Deposit the complete supporting archive and replace the pending public DOI.
- Confirm funding and compute support.
- Confirm acknowledgements and any permissions to name contributors.
- Establish whether employer review is required. The draft discloses Hansoh
  employment and the author's statement that the work was independent;
  employer clearance has not been established.

These items remain explicit in the verified draft; this GitHub update does
not resolve them or claim that the manuscript has been submitted.
