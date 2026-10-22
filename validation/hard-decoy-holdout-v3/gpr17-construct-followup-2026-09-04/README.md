# GPR17 species and deposited-sequence follow-up

**The 293-residue receptor sequence in 7Y89 exactly matches human GPR17.** Its mouse organism annotation conflicts with both this sequence evidence and the primary Methods. Experimental construct reconciliation remains incomplete.

| Reference | Complete deposited sequence comparison | Interpretation |
| --- | --- | --- |
| Human canonical Q13304, 367 residues | Exact contiguous match to residues 50–342 | Supports the human sequence assignment, with 49 N-terminal and 25 C-terminal reference residues outside the deposited sequence |
| Human isoform Q13304-2, 339 residues | Exact contiguous match to residues 22–314 | The retained segment cannot distinguish these two human isoforms |
| Mouse Q6NS65, 339 residues | Minimum 23 mismatches in any 293-residue window; best window 22–314 | The deposited sequence is not an exact contiguous segment of this mouse reference; this is not an exhaustive species-origin test |

The [primary paper](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9464062/fullTextXML), DOI 10.1002/mco2.159, explicitly describes human GPR17 and assigns its preparation to 7Y89. Its construct/purification Methods describe a full-length receptor with terminal expression/purification additions and addition of scFv16 to the receptor/G-protein preparation. The existing source review already supports a conventional scFv interpretation for the antibody-containing entity. This follow-up does not establish complete experimental-to-deposited sequence mapping, processing of the terminal tags, or absence of unmodeled material. A shortened deposited polymer is not proof that the expressed reagent was truncated.

Two byte-identical independent captures are retained for the paper and each [human canonical](https://rest.uniprot.org/uniprotkb/Q13304.json), [human isoform](https://rest.uniprot.org/uniprotkb/Q13304-2.fasta), and [mouse](https://rest.uniprot.org/uniprotkb/Q6NS65.json) reference. `sequence-audit.json` inventories all five deposited polymer entities and exhaustively compares every equal-length reference window, retaining all tied minima and their differing positions. No alignment cutoff or species classifier is introduced.

The raw RCSB organism annotation is preserved. The source-supported review assignment is human-sequence-consistent, with the deposited mouse annotation flagged as inconsistent. Historical records and formal dispositions are unchanged. Exact human sequence identity plus Methods improves this one metadata assessment; it does not establish a new VHH candidate, independent component, or completed census. Target freeze remains **BLOCKED** and the whole-census component upper bound remains **unknown**.

Only the precisely named cloning/purification and data-availability sections were extracted, using direct paragraphs and excluding nested sections, figures, captions and tables. No structural Results, coordinates, native images, labels or performance outputs were inspected by this follow-up. This scoped access statement does not certify earlier reviews' exposure status.

Replay from any working directory, optionally relocating both repository and evidence:

```sh
python3 -B validation/hard-decoy-holdout-v3/gpr17-construct-followup-2026-09-04/build.py verify --repository-root .
```

`--output-directory` selects a relocated copy of this packet. `provenance/capture-build.py` preserves the initial capture implementation before replay hardening; its retrospective binding does not alter capture times. The root checksum list covers every retained file, including source bytes and both script versions. Replay makes no network requests and preserves all original captures.
