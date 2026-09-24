# Phosphate-bead collision ablation

Frozen 2026-09-24 20:59:05 UTC, before calculating candidate membrane features or rankings. This is a separate prespecified development ablation added to source-interface-ranking-v2. The 395 poses are previously development-exposed. This qualification agent has not opened per-pose DockQ or rankings this turn; it incidentally encountered aggregate quality counts in a source-recovery README and aggregate paper results while finding methods. No such outcomes determine the definition below.

## Prediction-side source and scientific meaning

Use only the published starting receptor and its 388 MMB/BJ phosphate beads in `membrane_sources/receptor_membrane.pdb`, pinned to LightDock dataset commit `6fedad53cb7f999233a706ac2090a8fde47fb33b` and SHA256 `0fe5eec8287a782a82eed4c7107957c6d70dc427879234375d3a86f9c2538b6a`. The pinned setup declares membrane mode with this receptor. Git blob identities verify all retrieved source files. No native ligand, reference complex, allowed biological side, or predicted ligand starting placement is used to place the membrane.

The original paper identifies these beads as phosphate positions and uses distances below 2.5 A to identify bead overlap with protein heavy atoms when preparing the membrane. The present feature reuses that explicit distance as a conservative ligand/phosphate collision proxy. It is a new ablation, not a reproduction of the DFIRE energy term. It does not claim to detect all membrane penetration, assign intracellular/extracellular binding side, or estimate membrane-core thickness. Sparse headgroup beads can miss atoms inside the bilayer that are distant from the supplied bead centers.

Primary methods: [Roel-Touris et al., 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7718903/), sections Preprocessing of input structures and Implementation of a coarse-grained membrane in LightDock. The [official tutorial](https://lightdock.org/tutorials/membrane) documents phosphate conversion to MMB/BJ and receptor/membrane superposition.

## Applicability and frozen transform

Retain the original three complete sets and all 395 IDs. Require exactly one matching source/candidate receptor C-alpha per residue identity (residue number, insertion code, residue name), with complete bidirectional coverage of the 271 supplied source receptor C-alpha atoms. Do not renumber, trim, fit a selected fragment, remove coordinate outliers, or modify candidate coordinates. Independently verify the raw PDB C-alpha inventory against selected audit atoms.

Fit a single proper rigid transform by least-squares Kabsch using all matching receptor C-alpha atoms with equal weights. For row vectors, transformed source coordinates equal `source @ R + t`; require determinant of R approximately +1. Reject nonfinite coordinates, ambiguous identities, missing matches, or root-mean-square receptor residual exceeding 2.0 A. This gate is fixed before evaluating candidate membrane scores or membrane-ranked outcomes and is a coordinate reliability check. Apply the same accepted transform to all supplied membrane beads.

If any planned row lacks the source, a valid fit, or valid VHH heavy atoms, the entire method/set abstains, as required by the main protocol. Keep all rows in the feature/attempt ledger. The qualification finds the original LightDock set eligible; the refined set contains four gross receptor distortions and therefore abstains as a whole; Champloo lacks a supplied source frame and therefore abstains. These set decisions use input geometry/provenance only. The other twelve main arms and their membership remain unchanged.

## Frozen feature and score arms

For each eligible pose, use every selected VHH heavy atom in the frozen parser inventory exactly once. Count an atom as colliding if its Euclidean distance to at least one transformed MMB/BJ center is strictly less than 2.5 A. Multiple nearby beads cannot count the same atom twice. Let L be the number of selected VHH heavy atoms, K the count of colliding atoms, and `M = -K/L`, so higher M is preferred. Require L > 0. M is between -1 and 0. No side assignment, slab extension, alternate distance, distance weighting, optimization or threshold sweep is allowed.

Use the main protocol's existing `G = B/(1+Q)`, source-score orientation, and within-set tie-aware percentile transform r. Freeze two arms: `G-membrane = 0.5 r(G) + 0.5 r(M)` and `H-membrane = 0.5 r(S) + 0.25 r(G) + 0.25 r(M)`. Missingness causes whole-method/set abstention. Exact ties are scientific ties; ID sorting is only output determinism. A constant membrane feature is reported explicitly and cannot be described as an improvement. Compare G-membrane to G and H-membrane to hybrid-SG and source-only, with the same complete top-of-list and overall metrics as the main protocol.

## Verification and separation

Keep source retrieval, feature calculation/ranking, and outcome joining separate. Hash-bind this protocol, source files, coordinate/audit inputs, code, features, ranks, and receipt before joining outcomes. Check raw selected C-alpha matches, all proper-transform fits, bead preservation, exact 2.5 A boundary behavior, double-count avoidance, synthetic nonzero collisions, and rigid-transform invariance. Independently reproduce candidate collision counts with scalar distance arithmetic. No production score change follows from this ablation alone.
