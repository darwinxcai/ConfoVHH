# External pose-ranking ablation v1

This is a retrospective development experiment, defined on 2026-09-24 before executing the two graded selectors on these collections. It is not the prospective benchmark v1 and does not relax its eligibility or generation rules. The handoff already disclosed the shipped scorer's outcomes on these two biological systems. Both systems have prior ConfoVHH development exposure. Independent biological test groups: zero.

## Fixed scope

Use the complete released 195 Chai-1 saturation predictions for Champloo 6IBB (SUCNR1–Nb6), 100 membrane-scenario LightDock predictions for 3P0G (ADRB2–Nb80), and their 100 HADDOCK-refined descendants. Evaluate the three collections separately. Original and refined LightDock poses are related observations, not separate targets. Missing or failed inputs remain in the ledger; do not generate replacements, repair coordinates, select favorable subsets, or fit any parameters.

Code baseline: current GitHub main 9aeadb8185a02da4e67967d9fbe12b1503d02e96. Continuation base: prospective-preparation branch dc543d152b73d31d80933e8c90e2444c9319c59a. Existing coordinate parser, structural audit, pose-ranking policy, and two graded formulas are preserved. The new adapter supports public PDB/mmCIF collections without changing the separately frozen Boltz-only prospective evaluator.

## Prespecified arms

1. Shipped v0.6: actual shipped evidence tier and assessable half-delta-SASA burial key.
2. Burial alone.
3. Original producer score: Chai-1 ipTM (higher), LightDock score (higher), HADDOCK score (lower). These are separate within-collection comparisons; scores are never pooled across methods or biological systems.
4. Existing clash-fraction-v1: B*(1-C/N).
5. Existing overlap-burial-v1: B/(1+Q).

B is the frozen engine's half-delta-SASA interface area. N is the number of contacting residue pairs at <=4.5 Angstrom, C is the number containing a nonexempt overlap >=0.6 Angstrom, Q is the mean squared positive maximum pair overlap divided by 0.6 Angstrom. Frozen radii and disulfide exemption are unchanged. N=0 leaves the graded arms unavailable. Scientific ties remain ties; names and input order do not affect scientific ranks. Missing required features cause whole-collection arm abstention, with diagnostic rows retained.

The two graded arms were already defined and explored on a ten-pose 3P0G pilot on GitHub. This experiment tests their transfer across external pose generators. It does not present them as new formulas or independent biological validation. No additional formula, hyperparameter sweep, flexible learned model, or outcome-driven threshold revision is permitted in this version.

## Separation and verification

Download public source files afresh and bind original bytes, paths, repository revisions, score extraction, and explicit chain roles. Keep source predictions unchanged. A strict coordinate-only manifest drives the scoring process; no native coordinates or DockQ labels enter it. Save and hash features and all five rankings before the separate reference/outcome stage. Engine source and selector hashes are recorded. Independently recompute contact counts, severe-clash counts and overlap burden from raw coordinate values and compare with the scoring output.

The separate DockQ 2.1.3 stage uses fixed model/reference roles and default sequence alignment, no chain-map optimization. Champloo model chains and native roles are confirmed from source metadata; LightDock receptor/VHH roles are A/B in both predictions and the source processed bound reference. Evaluate all residues accepted by DockQ's sequence alignment; no native-derived manual crop. Crosscheck a fixed first pose per collection using the CLI and API. Supplied metrics are a separate diagnostic, with discrepancies preserved and explained; never choose a mapping for a better result. The initial LightDock smoke test only established reference/parser compatibility, before new arm execution, and is not a held-out evaluation.

## Outcomes and decision

Report, for every collection and arm, Spearman correlation with continuous DockQ, correct-vs-incorrect AUROC (correct DockQ >=0.23), tie-aware selected DockQ and top-10 correct count, three equal-sized ranked quality strata, best-available rank interval, and random-pool expectation. DockQ classes use 0.23 / 0.49 / 0.80. Preserve all ties with expected counts at boundaries and explicitly report missingness. No pose-level p-values or confidence intervals that treat correlated poses as independent targets. The source score, burial-only baseline, losses and negative results are mandatory.

Compare the shipped results against the pasted handoff's rounded metrics as a compatibility check; do not alter settings to force agreement. A development improvement is insufficient to replace the production default. A candidate that loses materially on any collection or fails to beat simple baselines does not receive an overall-superiority claim. Record whether the proposed mechanisms help, hurt, or remain unresolved. A later design constitutes a new exploratory version and must retain this result.

## Compute

Use local CPU for this fixed-coordinate experiment. No prediction generation or cloud GPU is required. Target-disjoint discovery proceeds separately through a bounded fresh RCSB metadata search; zero eligible groups does not block this explicitly retrospective development experiment.
