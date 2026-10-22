# FZD3 primary construct and deposition review

This packet retains two HTTP captures for DOI 10.1038/s41467-024-51451-1 (PMC11341715). The complete XML is archived for reproducibility but was never rendered to the reviewer. Only the exact Methods subsections “Discovery of the nanobodies” and “Protein expression,” plus the Data availability paragraph, were extracted. Structural determination Methods, Results, figures, captions, tables, coordinates, native contact/orientation interpretations, and benchmark labels were not exposed.

The primary deposition statement identifies **8Q7O as the FZD3 CRD–Nb8 crystal complex**. The expression Methods specify human Q9NPG1 CRD residues **26–138**, a C-terminal 3C/monoVenus/Twin-Strep precursor tag arrangement, and coexpression with untagged Nb8 in HEK293S GnTI- suspension cells. Purification includes 3C cleavage and endoglycosidase F1 treatment. The paper's Nb8 name still requires reconciliation with the deposited 14478 alias and exact polymer sequence.

These are source observations. They grant no formal eligibility, exclusion, graph edge, independence claim, or whole-census upper bound. Existing exposure caveats remain unchanged.

Offline replay, from any working directory:

```sh
python3 -B /absolute/path/to/fzd3-source/capture_extract.py verify
```

`capture_extract.py` resolves files relative to itself and checks DOI/PMC identity, requested capture routes, body sizes/hashes, exact section extraction, deposition token, and exact checksum inventory. The source-facts summary is human-curated; the parent package performs deposited sequence comparisons. `capture` refuses to overwrite retained captures.
