# Five-arm exploration of the exposed 3P0G poses

**Post-outcome development; no new GPU generation and no independent validation.** The original result is preserved in [execution03](../completed-pilot-execution03/README.md). This is not a correction to the tested implementation or proof of a better selector.

Five arms were declared at local commit `068dbbd` before calculating these new scores. Outcomes were already known. The [declaration](DECLARATION.md) and [hash freeze](freeze-v1.json) record the complete limited search: three comparison arms and exactly two new formulas, no parameter sweep. Neither new formula is promoted over the other based on this case. Production scoring and the original evidence manifests are unchanged.

## Selection outcomes

| Arm | Selected candidate(s) | Selected DockQ | Selected minus confidence | Best available minus selected |
|---|---|---:|---:|---:|
| frozen-v06 | seed2_model_4 | 0.1762564824406321 | -0.30837232653309543 | 0.30837232653309543 |
| burial-only | seed2_model_0 | 0.48462880897372757 | 0.0 | 0.0 |
| predictor-confidence | seed2_model_0 | 0.48462880897372757 | 0.0 | 0.0 |
| clash-fraction-v1 | seed2_model_0 | 0.48462880897372757 | 0.0 | 0.0 |
| overlap-burial-v1 | seed2_model_0 | 0.48462880897372757 | 0.0 | 0.0 |

All ten candidates are present in all five arms (50 scored rows). There are no score ties at any rank, no unscored candidates, no missing DockQ, and no new failed attempts. Historical failed and not-run attempts remain in the original package; they are not new candidates or omitted losses. Best available means the retrospective maximum in this ten-pose pool, not a deployable selector.

Both new formulas select the best available pose, but so do burial alone and predictor confidence. Thus there is **no selected-pose advantage for either graded penalty over either simple baseline on this case**. This supports investigating the removal of an absolute gate; it cannot choose a winning redesign or establish generalization.

## Complete ranks

Ranks are dense, higher scientific keys are better, and IDs never break ties. DockQ is an outcome joined after ranking.

| Candidate | Frozen | Burial | Confidence | Clash fraction | Overlap burial | DockQ |
|---|---:|---:|---:|---:|---:|---:|
| seed1_model_0 | 7 | 5 | 4 | 6 | 5 | 0.41451984199389164 |
| seed1_model_1 | 6 | 4 | 6 | 5 | 6 | 0.3757359167773013 |
| seed1_model_2 | 9 | 7 | 7 | 8 | 8 | 0.20782171517087225 |
| seed1_model_3 | 10 | 9 | 8 | 9 | 9 | 0.20512446299198026 |
| seed1_model_4 | 2 | 10 | 10 | 10 | 10 | 0.17029171132592144 |
| seed2_model_0 | 3 | 1 | 1 | 1 | 1 | 0.48462880897372757 |
| seed2_model_1 | 4 | 2 | 2 | 2 | 2 | 0.45530981662134734 |
| seed2_model_2 | 8 | 6 | 3 | 3 | 3 | 0.4766947196533409 |
| seed2_model_3 | 5 | 3 | 5 | 4 | 4 | 0.4216895163471448 |
| seed2_model_4 | 1 | 8 | 9 | 7 | 7 | 0.1762564824406321 |

The second-best native match, seed2_model_2, moves from frozen rank 8 to rank 3 under both graded formulas (burial alone ranks it 6). It remains below seed2_model_1, which has lower DockQ. The original selected seed2_model_4 remains above seed1_model_2 and seed1_model_3 under both graded formulas despite having lower DockQ. Removing the decisive tier gate does not make the entire ordering agree with structural accuracy.

## Exact geometry and new scores

B is frozen half-delta-SASA in Å². C counts severe residue-pair clashes, N counts contacting residue pairs, and Q is the mean squared positive overlap divided by 0.6² across those pairs. The displayed values use the full stored Python floating-point representation. The [50-row CSV](results/all-arm-candidate-results.csv) and [JSON](results/all-arm-candidate-results.json) also include exact keys for every arm, input hashes, confidence, status and DockQ.

| Candidate | B | C/N | Q | B*(1-C/N) | B/(1+Q) |
|---|---:|---:|---:|---:|---:|
| seed1_model_0 | 1367.632311505746 | 6/68 | 0.17006022825415304 | 1246.958872255239 | 1168.8563361788565 |
| seed1_model_1 | 1381.2205453445376 | 6/69 | 0.18941110623077653 | 1261.1144109667518 | 1161.2642072273916 |
| seed1_model_2 | 1164.721862013725 | 7/52 | 0.20133144256700555 | 1007.9323805888006 | 969.525828380007 |
| seed1_model_3 | 1027.3088663810124 | 2/48 | 0.14636819940358312 | 984.5043302818036 | 896.1421530320597 |
| seed1_model_4 | 928.2626822950779 | 0/41 | 0.07623789066282158 | 928.2626822950779 | 862.5069702046911 |
| seed2_model_0 | 1512.5783279588954 | 6/83 | 0.12311061641491837 | 1403.2353162992163 | 1346.775914902485 |
| seed2_model_1 | 1427.4961344460512 | 4/73 | 0.07323145676794907 | 1349.2771681750346 | 1330.091589697692 |
| seed2_model_2 | 1366.7861739208936 | 1/72 | 0.06271234157297763 | 1347.803032616437 | 1286.129953001054 |
| seed2_model_3 | 1425.927814086937 | 5/72 | 0.15829914098771541 | 1326.9050492197885 | 1231.0531568477265 |
| seed2_model_4 | 1058.4596798033813 | 0/46 | 0.07001269406363081 | 1058.4596798033813 | 989.2029185033552 |

The best pose has six severe clashes among 83 contacts. Clash-fraction-v1 applies a finite 6/83 penalty to its burial rather than demoting it below every zero-clash pose. Its adjusted score is 1403.2353162992163, above 1349.2771681750346 for seed2_model_1. The overlap-burial-v1 comparison is 1346.775914902485 versus 1330.091589697692. That narrow latter margin is not evidence of robustness; no parameter sweep was performed.

The original decisive comparison remains (tier 2, 1058.4596798033813) for seed2_model_4 versus (tier 1, 1512.5783279588954) for seed2_model_0. Evidence tier wins before burial is compared. The frozen implementation has not been changed or relabeled as passed.

## Reference separation and limitations

All modeled receptor A and VHH B residues contribute, including the fusion. Extraction verified frozen sequences, coordinates, confidence hashes and model 1. N and C recomputed directly from decimal coordinates match the frozen audits for every candidate. Q comes from the [coordinate-only contact overlap census](results/coordinate-only-contact-overlaps.json), without experimental-region annotations. The ranker rejects extra feature fields and takes no outcome or reference argument. [Its saved receipt](results/rank-receipt.json) binds features and ranks before the separate DockQ join. B and evidence tier are reused from the previously independently reproduced frozen audit; this comparison does not rerun SASA or DockQ.

No experimental observed-region mask, native contact, native coordinate, or DockQ enters a selector. This is computational separation, not analyst blinding: the native outcomes were already known when designing the hypotheses. Neither contact-normalized heuristic is a physical energy, and full construct geometry can still distort all three geometry-based alternatives. Structural warnings remain factual measurements under a specified policy, not accuracy labels.

## Reproduction

Use the preserved CPU Python environment (Python 3.12.14, NumPy 1.26.4, Biopython 1.88); the full original analysis lock is preserved in execution03. No network, GPU, prediction, minimization or new target is needed. From the repository root, choose a new output directory:

```sh
python scripts/paper/verify-graded-clash-exploration-v1.py
python -m unittest discover -s tests -p test_graded_clash_selectors_v1.py
python scripts/paper/graded-clash-selectors-v1.py extract --out /tmp/graded-replay-new
python scripts/paper/graded-clash-selectors-v1.py rank --features /tmp/graded-replay-new/features.json --out /tmp/graded-replay-new
python scripts/paper/graded-clash-selectors-v1.py evaluate --features /tmp/graded-replay-new/features.json --ranks /tmp/graded-replay-new/ranks.json --out /tmp/graded-replay-new
```

Files are created exclusively; existing records are never overwritten. The separate verifier checks frozen declarations/code, all input identities, overlap arithmetic, all fifty keys/ranks, the unchanged original ranks and outcome values, and the original 311-artifact evidence package.

See the [manuscript addendum and prospective requirements](../../../paper/GRADED_CLASH_EXPLORATION_2026-09-09.md) for the separate held-out selection and structural-audit utility evidence needed next. There are zero certified new independent groups and no claim of selection superiority.
