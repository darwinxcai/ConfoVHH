# Optional matched native receptor templates

**Prepared, not parsed by Boltz and not activated in any inference protocol.**
These are new development inputs derived from experimentally determined
[3P0G](https://www.rcsb.org/structure/3P0G) and
[5JQH](https://www.rcsb.org/structure/5JQH) coordinates recovered in the verification
bundle. They neither replace the historical 92-job template inputs nor activate
the separately proposed 54-job design. No MSA retrieval or inference occurred.
The preparation script uses Python's standard
library only.

Both PDB files contain **275 identical residue identities and the same 2,155 heavy
atom identities**, all in chain A. Every coordinate equals its source coordinate
at the source's 0.001 Å precision. The measured endpoint remains 14.130493 Å in
3P0G and 8.071600 Å in 5JQH. These are distances in the existing experimental
structures, not new predictions or evidence of model performance.

## Mapping and exclusions

The complete **observed** native receptor chains were first checked against the
submitted receptor sequences: 284 observed residues from the 501-residue 3P0G
construct and 391 from the 471-residue 5JQH construct. Each native `label_seq_id`
matches its own submitted sequence position exactly. The full observed-residue maps,
including all excluded positions, are in `full-native-to-query-maps.json`.
Unresolved residues have no coordinates to map or export.

The source-specific comparison uses 3P0G author IDs and 5JQH author IDs minus 1000.
It is checked against both submitted sequences and the previously identified
R131/L272 versus R1131/L1272 reference endpoints. This is an author-number
correspondence, not a new assignment of generic GPCR numbering.

There are 283 shared observed author positions. The following eight have different
amino acids and are excluded from both templates:

| Shared position | 3P0G | 5JQH |
|---|---|---|
| 23 | Asp | Trp |
| 24 | Val | Asp |
| 25 | Thr | Ala |
| 26 | Gln | Tyr |
| 27 | Gln | Ala |
| 28 | Arg | Ala |
| 96 | Met | Thr |
| 98 | Met | Thr |

All other unshared positions are also excluded. Retaining only shared receptor
positions removes the crystallization fusion coordinates; selecting polymer chain A
and the shared atom mask removes the nanobodies, ligands, solvent and other chains.
This does not assume that every excluded position is a fusion residue.

At each retained residue, the output contains only heavy atom names present exactly
once in both references. Missing or ambiguous side-chain atom names are omitted
from both templates; all retained residues have N, C-alpha, C and O. This yields
equal atom coverage without choosing a favorable conformation or inventing missing
coordinates. Shared side-chain coverage is consequently incomplete at some residues.
All omitted source atom groups are recorded in `excluded-atom-records.json`.

`shared-residue-atom-mask.json` records every retained atom name, the source label
and author IDs in both structures, both submitted-query indices, and the template
sequence index. All JSON indices explicitly labeled zero-based are zero-based.
The output PDB residue number is the shared 3P0G author-based position, so gaps are
preserved. The 5JQH output author labels are therefore deliberately renumbered;
its original author labels remain in the maps. Coordinates are not aligned,
rotated, minimized or otherwise changed.

## Verification and next step

The files now include padded PDB `SEQRES` records declaring exactly the retained
275-residue sequence. A real Gemmi 0.6.5 conversion check caught two issues in
earlier exports: omitting `SEQRES` produced an empty entity sequence, and an
unpadded final sequence line was read as 285 residues. The corrected files retain
275 sequence positions, all 2,155 atoms and all coordinates through the conversion
used by Boltz's PDB loader. Four failing metadata controls are preserved in
[`conversion-audit/`](conversion-audit/). These controls contain source coordinates
with deliberately incomplete metadata; they are not inference inputs.

This is **Gemmi conversion verification, not full Boltz parser validation**.
The inspected Boltz 2.2.1 wheel has SHA-256
`b8c62bbdede1922931d9203118f62c858f11aa699bf91fd4c05a5ed6a6d8b4fc`.
Its PDB loader supports PDB input and converts it through Gemmi. The subsequent
polymer parser uses chemical-component records, inserts absent atom slots, and
can swap arginine NH1/NH2 coordinates. Those processed features still need to be
checked in a complete environment. The conversion receipt records both source
module hashes and the exact Gemmi wheel/native module used.

`preparation.json` records the exact source reference/request/sequence hashes,
script hash, output hashes and atom-by-atom preservation checks. These native files
are different byte artifacts from the old Boltz template-provenance entries for
the same accessions; their new derived hashes must remain separate.

Run the offline mapping/export regressions:

```bash
node --test tests/gpcr-paper-template.test.mjs
```

Reproduce the assets into a fresh directory using the recovered source files:

```bash
python3 -B scripts/paper/prepare-matched-gpcr-templates.py \
  --raw-root /absolute/path/to/VERIFY \
  --out /absolute/path/to/new-matched-template-output
```

To reproduce the conversion check, use Python 3.12 on Linux x86-64 with the
hash-verified Gemmi 0.6.5 wheel identified in
[`conversion-verification.json`](conversion-audit/conversion-verification.json).
The script verifies that its imported native module matches that wheel. It does
not import or install Boltz, PyTorch, or model weights:

```bash
python3 scripts/paper/verify-gpcr-template-conversion.py \
  --templates validation/gpcr-matched-template-development-2026-09-05 \
  --boltz-wheel /path/to/boltz-2.2.1-py3-none-any.whl \
  --gemmi-wheel /path/to/gemmi-0.6.5-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl \
  --out /fresh/conversion-audit
```

Require exit status zero and the final `GPCR TEMPLATE CONVERSION OK` marker.
The [official Boltz source](https://github.com/jwohlwend/boltz/tree/cb04aeccdd480fd4db707f0bbafde538397fa2ac)
provides the loader and subsequent polymer parser. This check replays only the
loader's conversion and independently checks its outputs with Gemmi.

The next executable validation is an **input-parser-only pass in an inspected,
pinned Boltz 2.2.1 environment**. Confirm that the PDB template loader recognizes
one protein chain with 275 residues, preserves the intended shared atom mask and
coordinates, and produces the declared query/template mappings for each construct.
Save the actual processed mappings/features and hashes. Missing side-chain handling
must be checked in Boltz; the completed conversion check does not establish it.
That environment is not supplied here. Any revised runner must
explicitly support the PDB templates before use.

Only after that check and separately verified cached MSAs, checkpoint and runtime
pins would an inference smoke test become meaningful. No inference command or new
job manifest is generated by this preparation.

Both templates supply considerable target-specific experimental information.
One exemplar per endpoint also couples template identity to conformation. The files
are suitable for preparing a controlled comparison, but do not establish a universal
template-state effect, receptor thermodynamics, binding or biological efficacy.
