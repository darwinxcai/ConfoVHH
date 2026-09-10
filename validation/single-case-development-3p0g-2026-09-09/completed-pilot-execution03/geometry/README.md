# 3P0G receptor-aligned failure diagnosis

This is a post hoc diagnosis of one explicitly development-exposed case. No GPU generation, coordinate optimization, replacement candidate, or frozen-score change was performed. The original ten candidate coordinates and frozen DockQ values remain the primary pilot result.

## Observed structural failure

The receptor-aligned overlays were rendered and visually inspected in two orthogonal views. Both choices place the VHH at broadly the same receptor face. The ConfoVHH choice, `seed2_model_4`, has a substantially displaced and differently oriented VHH relative to the experimental complex. The confidence/best-DockQ choice, `seed2_model_0`, tracks the experimental VHH more closely. Thus “incorrect interface” here means incorrect detailed docking orientation and contact pattern, not a demonstrated wholesale switch to the opposite receptor surface.

The fit uses 1,136 identical backbone atoms (N, CA, C, O) from the 284 experimentally observed receptor residues. It never fits the VHH. Receptor fit RMSD is 2.0043653370 Å for the ConfoVHH choice and 1.7355688786 Å for the confidence choice. After this fit, exact-label VHH backbone RMSD is 17.7954592094 versus 6.8960626595 Å, and VHH CA-centroid displacement is 14.6433750230 versus 6.0861507526 Å. The frozen DockQ ligand RMSDs are 17.9119646612 and 6.9878799379 Å; the small difference is explained by the repeated-His alignment ambiguity below.

Independent native-contact recovery at the 5 Å heavy-atom cutoff is 13/51 (25.49%) versus 31/51 (60.78%). This exactly reproduces the corresponding frozen DockQ native-contact counts. The product's separate 4.5 Å contact counts should not be conflated with DockQ's 5 Å counts.

## Engineered and unobserved receptor regions

Archived depositor metadata and sequence tables establish a 501-residue chain A: an eight-residue N-terminal engineered tag, the first 230 residues of the receptor construct, 160 residues of T4 lysozyme at label positions 239–398, and the receptor C segment. Experimental chain A observes only label positions 31–235 and 402–480 (284 residues); missing ranges are 1–30, 236–401, and 481–501. The entire T4L fusion is unobserved in the experimental coordinates. Chain B observes positions 2–122 (121 of 126 residues), with the N-terminal residue and last four His-tag residues missing. All ten predictions contain the exact full frozen A and B sequences. The independent mapping verifies every observed residue against the depositor label/auth sequence table; chain roles were not swapped.

| Choice | Region of receptor A | Product 4.5 Å residue contacts | Product clash residue pairs |
|---|---|---:|---:|
| ConfoVHH `seed2_model_4` | Observed receptor | 25 | 0 |
| ConfoVHH `seed2_model_4` | Unobserved receptor excluding T4L/tag | 3 | 0 |
| ConfoVHH `seed2_model_4` | Entirely unobserved T4L fusion | 18 | 0 |
| Confidence `seed2_model_0` | Observed receptor | 54 | 1 |
| Confidence `seed2_model_0` | Unobserved receptor excluding T4L/tag | 8 | 1 |
| Confidence `seed2_model_0` | Entirely unobserved T4L fusion | 21 | 4 |

Neither choice contacts the N-terminal engineered tag. The full-construct overlays show generated T4L close to the VHH in both choices. Eighteen of the selected pose's 46 product contacts, and 21 of the better pose's 83, involve this experimentally unobserved fusion. Those contacts are supported by generated coordinates only; the reference cannot establish them as correct or incorrect. The buried-area calculation and contact/clash census include those generated residues, while DockQ compares the observed native interface. This difference in evaluation scope affects interpretation.

The confidence choice has six independently reproduced product clashes. Four involve T4L, one involves unobserved receptor position 490 and unobserved VHH position 1, and one involves experimentally observed receptor position 405 (author His269) and VHH Phe29. The latter is a carbon–carbon distance of 2.6502607465 Å and vdW overlap 0.7497392535 Å. Thus most clash penalties concern regions absent from the native coordinates, but removing only unobserved-region clashes would still leave one observed-interface clash; it does not by itself remove the frozen zero-clash tier gate. The numeric penalties follow the defined product algorithm, not a candidate-ID or chain-role bug. Full atom identities, distances, overlaps, pLDDT/B-factor values, and regional counts for all ten candidates are in the JSON and CSV census files.

## Repeated-His mapping sensitivity

An independent inspection of DockQ's frozen sequence alignment found exact mapping for all 284 observed receptor residues and the 119 nonterminal VHH positions. At the repeated six-His tail, native observed His121/122 align to generated His125/126 rather than positions 121/122. Identical repeated residues permit this alternative sequence alignment; the explicit chain mapping A:A and B:B is correct. This is an evaluation mapping limitation, not evidence of a ConfoVHH ranking implementation defect.

A separately labeled post hoc sensitivity uses the same DockQ implementation and unchanged coordinates, sets the native PDB residue numbers to deposited label positions, and calls numbering-based alignment (`no_align=True`). This gives:

| Selection | Frozen DockQ | Exact deposited-label sensitivity DockQ |
|---|---:|---:|
| ConfoVHH `seed2_model_4` | 0.1762564824406321 | 0.1769118036045605 |
| Confidence/best `seed2_model_0` | 0.48462880897372757 | 0.4867453599181881 |

All ten native-contact counts and interface RMSDs are unchanged. Maximum absolute DockQ change is 0.0032699582. The best candidate stays `seed2_model_0`, and no ConfoVHH or confidence rank changes because those scores are not recalculated by this sensitivity. The negative selection result is unchanged. Full original and sensitivity values are retained side by side in `dockq-label-mapping-sensitivity.csv` and `.json`; they do not replace the frozen scores.

## Reproduction and files

Use the supplied `analyze_geometry.py` from a directory containing the study artifacts, with Python, NumPy, Biopython, Matplotlib, and the preserved pinned DockQ 2.1.3 distribution. The script accepts explicit portable paths:

```text
python analyze_geometry.py --evaluation /path/to/execution03-evaluation --case /path/to/case --reference /path/to/3P0G.cif --native-protein /path/to/native_AB.pdb --output /path/to/new/geometry-output
```

The script writes independent all-ten geometry metrics, exact residue mappings, per-contact and per-clash records, a DockQ alignment audit, and the mapping sensitivity. `receptor-aligned-overlays.{png,pdf,svg}` and `interface-contact-maps.{png,pdf,svg}` are standalone figures. Three PDB files provide experimental-frame structures for interactive viewing, using deposited label numbering. The reference PDB numbering conversion preserves protein atom coordinates. `analysis-provenance.json` records input hashes, script hash, runtime versions, command arguments, and generated artifact hashes.

The reported failure motivates exploratory score-development questions, including the discontinuity of the zero-clash evidence tier and the treatment of unobserved engineered construct regions. Such redesigns are not validated by this case and require new held-out evaluation. This diagnosis proposes no replacement frozen result.
