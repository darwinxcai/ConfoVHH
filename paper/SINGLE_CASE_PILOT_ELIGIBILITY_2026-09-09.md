# 3P0G eligibility for the current-ConfoVHH single-case pilot

Decision on 2026-09-09: **eligible as an explicitly development-exposed,
retrospective, single-case technical/scientific pilot**. This is not an
independent validation case, a v3 holdout member, a family-transfer evaluation,
or evidence that a prediction binds. The case was selected from public
metadata and the original publication before opening coordinates for this new
pilot. It already belongs to the beta-adrenergic development component in
`LEAKAGE_COMPONENT_DEVELOPMENT_PROTOCOL.md`, and appears in the historical
DockQ-development source manifest. Its 2011 release makes generator-training
overlap a plausible confounder; actual training membership is not established.
No formal-holdout claim flag changes.

## Public identity and selector

| Field | Fixed case |
|---|---|
| PDB | 3P0G; public release 2011-01-19; deposited 2010-09-28 |
| Experiment | X-ray diffraction, 3.50 Å |
| Receptor | Entity 1, label/auth chain A, 501 deposited residues; human ADRB2–T4 lysozyme chimera |
| VHH | Nb80, entity 2, label/auth chain B, 126 deposited residues; Lama glama |
| Assembly | Biological assembly 1; author/PISA assignment; one A and one B |
| Exact operation | Operator 1 is the identity matrix, zero translation, `x,y,z`; A/B are the same copies as in the asymmetric unit |
| Nonpolymer | P0G = BI-167107 agonist; label chain C, author chain A |
| Model | Model 1; exact coordinate inventory must be confirmed after rules freeze |

Sources: [RCSB entry](https://www.rcsb.org/structure/3P0G),
[assembly metadata](https://data.rcsb.org/rest/v1/core/assembly/3P0G/1),
[entity 1](https://data.rcsb.org/rest/v1/core/polymer_entity/3P0G/1), and
[entity 2](https://data.rcsb.org/rest/v1/core/polymer_entity/3P0G/2).

The prediction input retains the authoritative A501/B126 protein sequences
and includes one ligand C specified by CCD identity `P0G`, with no native
coordinates or pocket restraints. The CCD has formula C21H26N2O4, formal
charge 0 and InChIKey `NWQXBEWHTDRJIP-KRWDZBQOSA-N`. The original
crystallization report identifies BI-167107 as the agonist, while the PDB
nonpolymer entity links its sole ligand to P0G. Sources:
[RCSB P0G chemical metadata](https://data.rcsb.org/rest/v1/core/chemcomp/P0G)
and [3P0G nonpolymer entity 3](https://data.rcsb.org/rest/v1/core/nonpolymer_entity/3P0G/3).
The current-ConfoVHH audit and primary DockQ both select only protein A/B.
Whole-complex producer confidence covers the A/B/C prediction and is not an
interface-specific A/B accuracy measurement. No affinity prediction is used.

The original report identifies an agonist-bound, Nb80-stabilized active-state
complex and describes the ICL3 T4L insertion, intracellular Nb80 interface,
and C-terminal His6 tag. The crystals were grown in lipidic cubic phase and
the diffraction data were merged from 23 crystals. These conditions and
3.5 Å resolution limit atom-level interpretation. The structure is a reference
for this engineered crystallized state, not for every receptor conformation.
Source: [Rasmussen et al., Nature 2011, DOI 10.1038/nature09648](https://cris.vub.be/ws/files/6129820/nature09648.pdf).

## Sequence and missing-residue handling

Use the exact `entity_poly.pdbx_seq_one_letter_code_can` strings; do not
reconstruct the input from mutation counts or generic wild-type sequences.
SHA-256 of each uppercase sequence without a terminal newline:

- A, 501 aa: `e9052379ba6dca45a6a4148a53cc1d6ad790f05e4b4f0a9237afe2fcc8638926`
- B, 126 aa: `3e4dbf73ccc8ab7a4fb2fedd17695befe7f2807f17650d8ef60080aef9a8562f`

The primary depositor source ranges partition A into the eight-residue
DYKDDDDA tag (1–8), ADRB2 1–230 (entity 9–238), T4L 2–161 (239–398),
and ADRB2 263–365 (399–501). N187E is the annotated engineered receptor
mutation. Direct comparison with current UniProt sequences also finds
ADRB2 G16R/E27Q and T4L R12G/C54T/C97A/I137R; these are recorded as
sequence differences, without treating every difference as an engineered
mutation. B contains the 120-residue VHH followed by His6 at 121–126.
Sources: the entity metadata above and [P07550 FASTA](https://rest.uniprot.org/uniprotkb/P07550.fasta),
[P00720 FASTA](https://rest.uniprot.org/uniprotkb/P00720.fasta).

| Chain | Unobserved entity sequence positions | Modeled positions | Modeled count |
|---|---|---|---:|
| A | 1–30, 236–401, 481–501 | 31–235 and 402–480; author 23–227 and 266–344 | 284 |
| B | 1, 123–126 | 2–122, same author numbering | 121 |

Source: public RCSB [A instance metadata](https://data.rcsb.org/rest/v1/core/polymer_entity_instance/3P0G/A)
and [B instance metadata](https://data.rcsb.org/rest/v1/core/polymer_entity_instance/3P0G/B).
The full T4L insertion is unobserved. The absent A236–401 block uses unusual
author insertion codes 227A through 233J. Preserve the exact label-to-author
map; an author residue number is not an entity sequence index.

The derived SIFTS ranges in the entity response disagree with primary
depositor boundaries: T4L length 161 and the later human block starting at
entity 400 nominally extend past the 501-residue entity. The exact deposited
sequence, primary source segmentation and observed residue map avoid this
annotation inconsistency. Do not silently repair or use those SIFTS ranges as
scoring indices.

## Bounds for later coordinate evaluation

Freeze candidate identities, current-ConfoVHH code/configuration, reporting
policy, native selectors, residue mapping and DockQ handling before the new
native opening. Use explicit predicted receptor/VHH to native A/B mapping.
Inspect model and chain inventories after opening; terminate rather than
choose an alternative copy or repair an ambiguous mapping after outcomes.
Record all missing native residues and unmapped predicted residues. Evaluate
protein A/B against the observed reference; P0G is contextual and must not
silently become a third protein interface. Do not interpret unmatched T4L,
tags or absent loops as experimentally resolved positions.

For a rigidly assembled complex, DockQ describes similarity of the assembly
to this reference under the frozen mapping. It does not establish flexible
docking, receptor activation, VHH loop remodeling, binding, affinity,
specificity, membrane compatibility, or performance beyond this case. If
native-derived component coordinates are used for candidate construction,
disclose that explicitly: the exercise then evaluates assembly/ranking with
reference-derived component conformations. One case cannot support uncertainty
or generalization claims over independent biological targets.

There is no case-selection blocker for this bounded pilot. Exact coordinate
parsing/mapping checks and native-self/rigid-invariance/far-separation controls
remain execution gates; they have not been run by this preparation task.

## Preparation record

Raw public RCSB JSON responses, their URL/retrieval/SHA-256 manifest, exact
FASTA, per-residue label/auth TSV maps, UniProt comparisons and source-response
captures are staged in `single-case-pilot-prep/case/` beside the repository.
This preparation opened no coordinate payload, computed no new DockQ label,
and read or changed no protected v3 coordinate/outcome payload. The v3
protocol/census and frozen scientific engine remain separate and unchanged.
