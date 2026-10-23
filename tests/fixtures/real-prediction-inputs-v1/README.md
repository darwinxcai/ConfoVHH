# Exact public producer inputs

This archive preserves the 26 original files used by the software compatibility regression in `scripts/validate-real-prediction-runs.mjs`. All original bytes, filenames and SHA-256 checksums match the existing record in `validation/real-prediction-run-regression-v1.json`. No structures, scores or expected results were modified. These controls are not GPCR–nanobody ranking evidence.

CI verifies the archive checksum, extracts the originals into a temporary directory, and runs the same complete pose/PAE regression against the unchanged expected record. Missing, changed or incomplete input files fail verification. Keeping these exact copies avoids making deterministic software checks depend on the availability of an external download service. This check does not demonstrate current upstream availability. The verifier's default network mode remains available for an explicit source-download check.

## Sources and attribution

Ten ColabFold files come from Bohdana Rovenko, Mykhailo Girych and Ville Hietakangas, *AlphaFold2 Multimer Structural Models for CtBP-Prospero Protein Interaction*, version v1, September 5, 2025, [Zenodo record 17063524](https://doi.org/10.5281/zenodo.17063524). These files are redistributed without modification under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The dataset supports Rovenko et al., *Metabolic control of enteroendocrine cell fate through a redox state sensor CtBP*, [PMID 40631244](https://pubmed.ncbi.nlm.nih.gov/40631244/). Attribution does not imply endorsement.

Sixteen AlphaFold Server example files come from [martinovein/AF3_MiniPAE](https://github.com/martinovein/AF3_MiniPAE/tree/a7458d1d26a35154cbfc3e24ec197352079970df/data/example/p06730_o60516), pinned revision `a7458d1d26a35154cbfc3e24ec197352079970df`. They are unchanged copies of the files redistributed by that repository. Its original MIT notice is preserved in `AF3_MiniPAE-LICENSE.txt`; the upstream license and original source terms are not replaced by ConfoVHH's license.

## Contents and verification

The archive contains only 26 regular files under the two dataset IDs used by the verifier. Their combined uncompressed size is 12,955,122 bytes. It contains no executable payload, links, absolute paths or parent-directory paths. Source URLs, expected byte counts, SHA-256 hashes, biological context and all expected audit outputs remain in the existing regression record.

`checksums.sha256` is checked from the repository root before extraction. The tar entries are sorted by path, have a fixed timestamp of zero, numeric owner/group zero, empty owner names, and mode 0644. The gzip timestamp is zero and its filename is empty. Compression changes do not alter the original input bytes.
