# Round4 dataset qualification

Three cases are qualified for the parent-approved reserved new-outcome study. Only **ADGRV1/RE02** tests the pair learner. GPR158/Nb20 and MC4R/pN162 retain their full deposited protein context and unchanged-source fallback. One learner test group cannot establish general superiority or justify production promotion, even if its result is favorable.

| Case | Reference | Exact protein input | Fixed prediction roles | Use |
|---|---|---|---|---|
| ADGRV1 / RE02 | [9FTE](https://www.rcsb.org/structure/9FTE) | 426 + 147 residues | receptor A; Nb B | Pair learner test, with construct/reference limitations |
| GPR158 / Nb20 | [9VOR](https://www.rcsb.org/structure/9VOR) | 2 × 781 + 2 × 150 residues | receptor A/B; Nb C; context D | Exploratory full-context baseline |
| MC4R / pN162 | [8QJ2](https://www.rcsb.org/structure/8QJ2) | Six proteins, 1,799 residues | receptor E; Nb F; context A/B/C/D | Full-context baseline with discovery-construct relationship |

These are **exact deposited protein-construct benchmarks**, including declared terminal tags and fusions. They do not certify complete original assay-reagent provenance, physiological lipid/glycan context, historical untouched status or predictor-training novelty. Generation inputs contain full declared protein sequences; native unresolved regions are neither filled in nor used to trim inputs. No native coordinates, templates or contact restraints belong in a generation upload.

`ENROLLMENT.freeze.json` is the accepted qualification ledger. It binds the unchanged original `PROPOSED-ENROLLMENT.json`, exact sequence files, references, controls and limitations. Parent execution and outcome seals remain necessary before generation or evaluation. `launch-inputs/*.yaml` is the generation-file allowlist; `public-sources/qualification-native-reference/` and `reference-views/` are evaluation-only.

## Reference and construct limitations

- **9FTE:** deposited receptor residues 1–415 exactly match mouse UniProt B8JJE0 residues 5884–6298, followed by the deposited suffix. The preprint describes human ADGRV1; that discrepancy remains open. This study expressly uses the deposited mouse construct. The 3.82 Å reference contains 255/426 receptor residues and 107/147 Nb residues. All three IMGT CDRs are represented, while terminal framework/receptor regions remain missing. Fresh primary full-text/PDF requests returned HTTP429 and those response bodies are retained. Prior source metadata and the official two-chain deposition support a limited deposited-pair study, not full assay provenance. [Primary preprint record](https://doi.org/10.64898/2026.03.05.709805).
- **9VOR:** each Nb contacts both receptor protomers, so pair-only reduction is unsuitable. The paper warns that local ECD/Nb density is weak and reports local refinement at 4.14 Å; the global deposition resolution of 3.47 Å should not be used to imply confident side-chain placement. Both 9VOR and 9VOS contain the same deposited Nb20 sequence; the paper's Nb20* mutant is a separate reagent. 9VOR is prespecified as the RGS-free structural class, with its full 2+2 protein context. [Primary article](https://pmc.ncbi.nlm.nih.gov/articles/PMC12834959/).
- **8QJ2:** a previous inventory incorrectly applied the β2AR-graft concern to the deposited receptor itself. Current UniProt and RCSB sequences show the complete 332-residue wild-type MC4R sequence exactly at positions 126–457 of the 729-residue deposited fusion. The primary paper separately describes a β2AR/Cb80 discovery immunogen and a wild-type MC4R cryo-EM construct with terminal BRIL/mCherry/tags. That correction is recorded without erasing the discovery relationship. Retain Gs and auxiliary Nb35 even though selected pN162 contacts the receptor alone; native proximity does not establish helper-independent receptor conformation. The target Nb has 85/117 residues represented, including all three CDRs. [Primary article](https://pmc.ncbi.nlm.nih.gov/articles/PMC11445563/).

Every native atom and coordinate token is retained in six bijective scoring views: one ADGRV1 assignment, four prespecified GPR158 receptor-order/Nb symmetry assignments, and one MC4R assignment. Prediction-side Nb choice never varies. Biological assembly1 is the identity operation for all three depositions. View replay verifies the complete atom and residue maps, including missing sequence positions and disconnected receptor segments.

## Discovery, grouping and exposure

The bounded public refresh captured 407 RCSB entry records from the `nanobody GPCR` full-text query; 306 intersect the current repository's 348-entry curated inventory. Targeted ACKR3/VUN701/RE02 queries and primary-paper leads supplement that list. This is not an exhaustive PDB census. Unqualified hits remain in `discovery-refresh-ledger.jsonl`; search hits are never promoted from titles alone. Thirteen focused leads, including all exclusions and unavailable references, are in `eligibility-ledger.json` and its CSV.

GRM1/7DGE uses the exact current GRM5 Nb43 sequence. GRM2 remains in the related mGlu family with multichain context. GPR151/9W3K and CXCR4/8ZPL match development Nb6; the known Nb6M parent relationship and KOR graft in HRH2/7UL3 remain blocking despite a negative framework threshold. AVPR1A/9UWI has no deposited Nb. The ACKR3 preprint describes VUN701 complexes, but the bounded official search located only isolated VUN701/8UEK plus other ACKR3 complexes. The GABAB paper reports unresolved Nb4C10 density, and its cited 9XVZ entry returned404 during this pass. None substitutes for an eligible native pair.

`development-group-map.json` is separately accepted for the twelve existing development cases: eleven total groups and eight groups among nine pair-context cases. All seeds and generation arms retain their case group. AT118-H/L remain one source-known lineage even though they miss the older sequence threshold. Sixty-six current selected-Nb comparisons and 216 historical comparisons found no additional current threshold merger. Historical family, engineered-construct and ancestry uncertainties remain explicit. Auxiliary Nb35/NabFab identities are not silently treated as target-binding Nb ancestry. All300 earlier and900 same-case new predictions are development only.

The three new reference release dates fall after Boltz2's reported 2023-06-01 experimental-PDB cutoff. This does not prove receptor, Nb, interface or distilled-data novelty. Metadata/prose exposure, ConfoVHH outcome/tuning exposure and predictor-training exposure are separate claims.

## Evaluation-format repair and checks

DockQ2.1.3 first attempts fixed-column PDB parsing even for a `.cif` file. One GPR158 canonical view caused that attempt to return an empty model without an exception, preventing mmCIF fallback. The original failed native-self attempt is retained in `native-self-controls/`.

`explicit_mmcif_metric.py` selects DockQ's pinned mmCIF parser directly and requires nonempty R/V chains. It replaces exactly two loader expressions in the hash-verified round3 function. Every other numerical-function byte, residue correspondence function, metric parameter and original frozen file stays unchanged. The helper exposes `implementation(execution_root)` and `dockq_api(model_path, native_path, model_mapping, native_mapping, execution_root=...)` for the round4 outcome adapter.

- Six native-self controls passed within the existing 1e-8 tolerance. These are format controls, not experimental-reference accuracy or ranking evidence.
- All300 existing predictions, including pair, dimer and G11-helix contexts, produced exactly matching complete result and residue-correspondence hashes before/after the dispatch repair. The comparison used each case's prespecified first native assignment and published equality hashes, not pose-quality values.
- Six focused dispatch tests passed; three adversarial proposal checks reject wrong Nb assignment, altered sequence digest and dropped context roles.

The initial dispatch test expected a ValueError where the upstream parser correctly failed closed with KeyError. That test expectation was corrected; its initial log remains preserved. No metric code changed for that correction.

Run `verify_qualification.py` to verify the final artifact inventory and accepted ledger, or `verify_proposed_panel.py` to replay all six views and the sequence/context checks. The scripts use the existing pinned workspace Python dependencies. No new reserved predictions or prediction-quality labels were accessed during qualification.
