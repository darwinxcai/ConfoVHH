# Third-party notices

ConfoVHH is distributed under the MIT License. It incorporates and depends on third-party open-source software whose original licenses remain in effect.

## Immunum

- Project: [ENPICOM/immunum](https://github.com/ENPICOM/immunum)
- Version: 1.2.0 (pinned by the lockfile)
- License: MIT
- Copyright: © 2026 ENPICOM

ConfoVHH embeds immunum's WebAssembly module into the dedicated browser audit worker for antibody-domain numbering. The installed package's MIT license is reproduced below:

> MIT License
>
> Copyright (c) 2026 ENPICOM
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## shadcn/ui and supporting styles

- Project: [shadcn/ui](https://github.com/shadcn-ui/ui)
- License: MIT

The application composes vendored shadcn-style UI primitives. The additional vendored stylesheet notice is retained in [`vendor/shadcn-tailwind-4.13.0.LICENSE.md`](./vendor/shadcn-tailwind-4.13.0.LICENSE.md).

## Other dependencies

The complete dependency graph and exact resolved versions are recorded in `package-lock.json`. Notable runtime dependencies include React, Vinext, Base UI, Radix UI, Lucide, and Tailwind CSS. Their respective license metadata are included in the installed npm packages and upstream repositories; they are not relicensed by ConfoVHH's root MIT license.

## Public biological examples

- The bundled browser demo downloads the public β₂-adrenergic receptor–Nb80 complex [PDB 3P0G](https://www.rcsb.org/structure/3P0G) from RCSB PDB.
- Public validation structure accessions, retrieval URLs, source hashes, and use boundaries are recorded in the versioned manifests under `validation/`.
- The canonical VHH numbering fixture is a public immunum documentation example.
- The long-CDR3 numbering fixture is a public sequence reported in [ANARCI issue #14](https://github.com/oxpig/ANARCI/issues/14).

## Archived public metadata responses

- RCSB PDB search/API metadata archived under `validation/hard-decoy-holdout-v3/` is identified as CC0 1.0 in the [RCSB usage policy](https://www.rcsb.org/pages/usage-policy).
- GPCRdb API/HTML metadata archived under the same validation tree is identified as CC BY 4.0 in the [GPCRdb legal notice](https://docs.gpcrdb.org/legal_notice.html); GPCRdb attribution is retained here and in the evidence record.
- The exact source-license mapping and live evidence URLs used during the 2026-08-29 metadata preparation are recorded in [`source-licenses-2026-08-29.json`](./validation/hard-decoy-holdout-v3/source-licenses-2026-08-29.json). The external license-page bytes were not archived in that record.

These metadata archives are redistributed under their source terms and are not relicensed by ConfoVHH's MIT license.

## Public prediction-output compatibility data

- The real ColabFold-multimer regression uses exact remote bytes from [Zenodo record 17063524](https://zenodo.org/records/17063524), “AlphaFold2 Multimer Structural Models for CtBP-Prospero Protein Interaction,” by Bohdana Rovenko, Mykhailo Girych, and Ville Hietakangas, under CC-BY-4.0. ConfoVHH records hashes and derived audit summaries; it does not redistribute the raw files.
- The real AlphaFold Server regression uses the commit-pinned [`AF3_MiniPAE` example](https://github.com/martinovein/AF3_MiniPAE/tree/a7458d1d26a35154cbfc3e24ec197352079970df/data/example/p06730_o60516), distributed by that repository under MIT. ConfoVHH records hashes and derived audit summaries; it does not redistribute the raw files.
