# Acceptable GPCR nanobody predictions can mask errors in confidence ranking

**Draft for author review — 26 September 2026.** This version includes the completed targeted follow-up and molecular illustrations.

**Author:** Dong Wang Darwin Cai  
**Affiliation:** Independent researcher  
**Corresponding author:** Dong Wang Darwin Cai; darwinxcai@gmail.com  
**Keywords:** GPCR; nanobody; structure prediction; Boltz-2; model selection; DockQ; reproducibility

## Abstract

A structure predictor can return many models of the same GPCR–nanobody complex, leaving the user to choose one, usually by the program’s confidence score. We used Boltz-2 to generate batches of 25 models per complex and setting for complexes with known experimental structures, withholding the experimental coordinates from prediction. Confidence chose a model before we compared every prediction with the experimental structure using DockQ (higher scores indicate closer agreement; ≥0.23 was considered acceptable). For GPR158, 24 of 25 models were acceptable, yet the confidence-selected model ranked 24th by accuracy, 0.130 points below the best generated model. Acceptable-or-unacceptable reporting would count this as a success. ADGRV1 and MC4R generated no acceptable baseline models, so their failures began with the structures produced. A follow-up, chosen after those failures were known, generated 100 more predictions: broader sampling produced one borderline acceptable ADGRV1 model that confidence ranked 17th, while the other three new batches produced none. Development comparisons covered 1,200 predictions. An earlier attempt to learn a better scoring rule from previous predictions made selection worse. In the expanded analyses, the largest average gain in the chosen model’s accuracy was 0.017 points, below the 0.020 requirement set before testing. Among the receptor–nanobody pairs the new scoring rules could assess, confidence found an acceptable model in 25 of the 26 batches containing one. This retrospective count came from only eight receptor groups, tested repeatedly. No learned ranking method was tested on the three reserved complexes. None of the tested alternatives improved selection enough to replace confidence under our criteria, yet confidence still made the GPR158 ranking mistake. Benchmarks should report every model’s accuracy and the chosen model’s position among them, alongside counts of acceptable choices.

## Introduction

A structure-prediction program can produce different models of the same GPCR bound to a nanobody. The practical question is which model to use. The program usually provides a confidence score for each prediction, but a high score does not guarantee that the nanobody occupies the experimentally observed position. When the chosen model is inaccurate, it helps to ask two questions: did any of the generated models resemble the experimental complex, and did the ranking method choose one of them?

We address those questions by predicting complexes whose experimental structures are already known. For each complex and setting, Boltz-2 generated 25 candidate structures from the protein sequences and sequence alignments. Experimental coordinates were withheld from prediction. Boltz-2’s returned confidence score selected a candidate, and we then compared all 25 candidates with the experimental structure. This separates the task of **generating** a useful structure from the task of **selecting** it. If every candidate is poor, rearranging their ranking cannot produce a good structure. If a better candidate exists but is overlooked, selection can still be improved.

Nanobodies can stabilize and modulate GPCR conformations, but their small interfaces, variable binding loops, and receptor assembly contexts complicate structure prediction. Structural surveys provide an important starting point. Schlimgen and colleagues’ class-A-focused analysis reported 54 GPCR-targeting nanobody structures, including 16 nonredundant structures, in 2024. These counts describe that survey, rather than a current census across all GPCR classes. [1](https://doi.org/10.1038/s41467-024-49000-x)

AlphaFold 3 and Boltz-2 have expanded the range of biomolecular interactions that can be modeled, but antibody and nanobody docking remains difficult. [2](https://doi.org/10.1038/s41586-024-07487-w), [3](https://doi.org/10.1101/2025.06.14.659707) Hitawala and Gray documented persistent docking failures and examined how confidence measures relate to structural accuracy. [4](https://doi.org/10.1080/19420862.2025.2545601) FoldBench evaluated 1,522 assemblies across nine tasks and showed that performance depends in part on similarity to training data. [5](https://doi.org/10.1038/s41467-025-67127-3)

Predicting whether two proteins bind is a related but different question. Harvey, Smith, Hurley and colleagues used AlphaFold-Multimer to study GPCR–nanobody binding and prospectively identify MRGPRX2 binders. Their training collection included 32 validated binder pairs and 127 negative-control pairs made by pairing nanobodies with other antigens. Those controls were not all experimentally validated nonbinders, and the 32 binder pairs were not a collection of 32 nonredundant solved complexes. [6](https://doi.org/10.1038/s41467-026-72093-5) Agreement with an experimental complex structure and discrimination between binders and nonbinders therefore require separate evaluations.

ConfoVHH is the collection of scripts used here to run and compare these predictions. The comparison throughout was **default confidence**: selecting the candidate with the highest confidence score returned by Boltz-2. Development experiments tested contact-based rules, changes to generation settings, and learned ranking scores, and supported retaining this baseline. The subsequent GPR158 evaluation exposed the central problem: confidence selected an acceptable structure near the bottom of the accuracy ranking. We use that result to show how acceptable-or-unacceptable scoring can conceal a ranking error, then examine the development comparisons that explain why confidence remained the baseline.

## Methods

### Study design and datasets

Each *case* specified a GPCR, its nanobody, the exact protein sequences used in the experimental construct, and any other protein chains retained in the prediction. We generated 25 structures for each case, setting, and batch of random seeds. We call this set of 25 a *candidate pool*. Different seeds allow repeated predictions of the same input. Related constructs were kept in one *biological group*, so that testing two versions of the same complex did not count as testing two independent biological examples.

The initial experiment generated 300 predictions for 12 cases representing 11 groups. Four cases were used to choose a contact-based selection rule, which was then tested on eight further cases. Some of these eight had been studied previously or were related to earlier cases; the protocol recorded those relationships before testing. These 300 predictions later became development data.

The expanded experiment generated 900 new predictions for the same 12 cases: 25 predictions under each of three generation settings. Together, the initial and expanded experiments provided 1,200 predictions in 48 sets of 25. The main learned-ranking comparison used nine receptor–nanobody pair cases from eight groups, because two AGTR1–AT118 constructs belonged to one group. CASR and GRM5 dimers and the CHRM1 helper-chain complex retained default confidence; the learned methods did not support those assemblies.

After generation and ranking choices were fixed, we generated 25 predictions each for three additional complexes: ADGRV1–RE02, GPR158–Nb20, and MC4R–pN162. These 75 predictions formed the reserved evaluation (Table 1). The initial and expanded experiments are called rounds 3 and 4 in the accompanying files.

ADGRV1 and MC4R produced no acceptable baseline predictions, so we conducted a targeted follow-up. We generated 25 new structures under each of the two alternative settings for each complex, giving 100 new predictions. We compared them with the 50 existing baseline predictions. These targets were chosen after their failures were known. It remained separate from the 1,200-prediction development analysis and was not used to train a ranking model.

**Table 1. Datasets and their uses.** A set contains 25 repeated predictions of one complex under one setting. The combined development set reuses the first two rows. Across all stages, 1,375 distinct predictions were generated (300 + 900 + 75 + 100). The follow-up reuses 50 of the earlier baseline predictions; they are not counted twice.

| Dataset | Predictions | Sets of 25 | Purpose |
|---|---:|---:|---|
| Initial experiment | 300 | 12 | Test contact rules on 12 cases in 11 groups; later reused for development |
| Expanded development experiment | 900 | 36 | Compare three generation settings on the same cases using new seeds |
| Combined development set | 1,200 | 48 | Evaluate learned ranking; eight groups eligible for the main pair comparison |
| Three additional complexes | 75 | 3 | Evaluate the chosen baseline after development decisions were fixed |
| Targeted follow-up | 100 new | 4 new | Test two settings on ADGRV1 and MC4R after their baseline failures; compare with 50 earlier baseline predictions |

### Structure generation

The prediction inputs matched the specified experimental constructs. They retained the receptor, nanobody, helper-protein sequences, fusions, tags, and chain assignments instead of substituting canonical wild-type sequences. CASR and GRM5 each retained two receptor copies and two nanobodies. CHRM1 retained its third-chain helix. LGR4 used the receptor–Nb21 pair without the separate helper binder.

The initial, expanded, and reserved generation experiments used the same Boltz-2 model weights, run with software version 2.2.1. We compared the baseline setting with two alternatives. **Broader sampling** changed the diffusion step scale from 1.5 to 1.0, altering how the predictor sampled structures. **Alignment subsampling** limited the multiple sequence alignment—the collection of related protein sequences supplied to the predictor—to 1,024 combined rows, while retaining the baseline step scale. The names describe the settings; they do not imply that either produces more accurate models. All settings used three recycling steps, 200 sampling steps, and one diffusion sample per seed.

The new development predictions used seeds 25–49 and the same starting alignments and protein inputs for each setting. Equal seed numbers do not ensure identical random draws because alignment subsampling also uses random numbers. Experimental coordinates, structural templates, contact restraints, and force potentials were excluded from generation, as were deposited glycans, lipids, and detergents. Within each planned batch, we retained every attempt, including the initial technical checks, and did not add attempts after seeing their accuracy. All 975 new predictions in the expanded and reserved experiments were recovered and evaluated. Exact software versions and settings are in the supplementary methods.

### Measuring structural quality and selection

We compared each predicted receptor–nanobody interface with the experimental structure using DockQ. Higher DockQ indicates closer agreement with the experimental binding arrangement. We used the prespecified threshold of 0.23 to classify a prediction as acceptable. [7](https://doi.org/10.1093/bioinformatics/btae586) This classification concerns structural agreement.

Confidence and accuracy have different roles in this experiment. Boltz-2 returns confidence before the experimental comparison, so confidence can be used to select a model for an unknown structure. DockQ requires the experimental reference and was used only to evaluate the predictions. For the initial and expanded ranking comparisons, the primary outcome was the DockQ of the model selected first. In tables we call this *selected model DockQ*. We also measured how often the selected model was acceptable, the average DockQ and acceptable count among the five highest-ranked models, and the fraction of planned predictions that could be evaluated.

For each set of 25, we also identified the model with the highest DockQ and measured its advantage over the selected model. This *best available* model shows what the predictor had generated. Identifying it requires knowing the experimental structure, so it is a retrospective comparison, not a usable selection method for an unknown complex. When confidence scores tied exactly, we averaged over the tied choices, including ties at fifth place. We never used model identifiers or experimental accuracy to break selection ties.

The experimental chain assignments and the nanobody being assessed were fixed in advance. For dimers, we assessed the specified symmetry-equivalent assignments and aligned receptor copies separately. Unresolved experimental residues were excluded from assessment. A failed required reference comparison would make the outcome unavailable; we did not silently drop that comparison. Missing predictions, invalid structures, and unavailable comparisons were tracked separately from valid but inaccurate structures, including those with no interface contacts. No expanded or reserved outcome was missing.

The targeted follow-up first asked whether a setting generated any acceptable model, reporting the acceptable count among 25 planned attempts. We then asked whether confidence selected an acceptable model. Accuracy distributions, the best available model, and the five highest-ranked models provided additional detail. Evaluated and unavailable results were reported separately. This follow-up introduced no new ranking method or rule for changing the default settings.

### Ranking methods and criteria for changing the baseline

The contact-based rules asked whether the interface between a receptor and nanobody could help select a model. A rule could break an exact confidence tie or override a small confidence difference. Before choosing a rule, we fixed five possible maximum differences: 0, 0.002, 0.005, 0.010, and 0.020. We allowed a nonzero override only if it improved accuracy when each biological group was left out for testing, without losing an acceptable model selected by default confidence.

The expanded experiment tested two learned ranking methods. The first combined Boltz-2’s component confidence measures, including confidence in residue positions and relative chain placement. The second also used interface contact counts and the fraction of contacts involving nanobody binding loops. These methods learned from the accuracy of predictions in the development data. When ranking a test case, neither method received the target identity, sequence, experimental outcome, reference resolution, generation-setting label, or seed identifier. The exact features and regression procedure are in the supplementary methods. Boltz-2 itself was not retrained.

To test learned ranking, we withheld all predictions from one biological group, fitted and chose a ranking method using the remaining groups, and then ranked the withheld predictions. The choice of method was itself tested by withholding groups within the training data. Thus, related constructs and repeated predictions never appeared on both sides of a training–test split. Default confidence remained an option whenever learning a new score did not help. The reported result evaluates this whole selection procedure, including its decisions to keep default confidence.

Average performance gave equal weight to each biological group. Within a group, weight was divided across its cases, settings, batches, and predictions. This prevented a group with more repeated predictions from dominating the comparison. We reported the receptor–nanobody pair analysis separately from the analysis of all planned assemblies. Unsupported assemblies, or any set in which a candidate lacked a required feature, retained default confidence.

Before examining the comparisons, we required an average gain of at least 0.020 in selected model DockQ before changing the baseline. A change also had to meet the prespecified conditions for retaining acceptable selections and continue to rank every set supported by the baseline. For learned ranking, the probability of selecting an acceptable model could not decrease in any withheld set. The 0.020 requirement was a practical decision threshold, not a test of statistical significance.

### Analyses performed after the experiments

After the accuracy results were known, we counted how many sets contained only acceptable models, only unacceptable models, or a mixture. We compared the number of acceptable models selected by default confidence with the number expected from random selection and the number possible if the best model were known. These were ordinary counts across sets, without group weighting. Repeated sets from the same receptor group were not treated as independent biological tests. We also examined the complete DockQ distributions for the three additional complexes. These retrospective analyses explain the results; they did not guide generation or ranking.

For generation changes, we calculated descriptive 95% confidence intervals by resampling whole biological groups 10,000 times from the eight groups in the pair analysis. These intervals describe uncertainty in the average difference and were not used to change the decision criteria. DockQ results are displayed to three decimal places; rankings, differences, and decisions used the unrounded values.

## Results

### An acceptable selection concealed a ranking error

We asked whether choosing an acceptable model also meant choosing one of the most accurate structures the predictor had produced. For GPR158, 24 of 25 models were acceptable, yet confidence selected the model ranked 24th by DockQ, 0.130 below the best generated model. Reporting only whether the selected model was acceptable would have counted this as a success. The other two complexes separated this hidden selection error from generation failure: ADGRV1 produced no acceptable baseline model and confidence chose its worst prediction, whereas MC4R offered no acceptable model to select. Figure 1 shows the complete accuracy distributions and compares the selected and best available GPR158 structures.

### Development comparisons supported retaining confidence as the baseline

Before evaluating the three additional complexes, we asked whether changing how models were generated or chosen would improve the accuracy of the chosen structure. None of the tested alternatives improved selection enough to meet our rules for replacing the default workflow. The comparisons below explain why the GPR158 ranking error matters: it occurred with the baseline retained after testing alternatives.

#### Contact based selection

We asked whether using the contacts between the predicted receptor and nanobody could help choose more accurate models than confidence alone. The contact rule chosen for subsequent testing selected exactly the same models as default confidence and added no benefit. All 300 initial predictions could be evaluated. The first four cases were used to choose how much weight to give interface contacts. APLNR and one AGTR1 construct each had 25 acceptable candidates; OPRM1 and the other AGTR1 construct had none. Allowing contacts to override a nonzero confidence difference reduced average selected model DockQ by 0.001–0.035, with groups weighted equally. We therefore kept the rule that contacts could only break exact confidence ties.

In the eight subsequent cases, default confidence selected an acceptable structure in six, including every set that contained one. The contact rule selected exactly the same models and gave the same top-five results because there were no relevant confidence ties (Figure 2). An existing physical scoring method could score five of these cases. On those five, default confidence selected an acceptable model in all five, compared with three for the physical scorer; average selected model DockQ was 0.443 and 0.376, respectively. The physical scorer could not score the other three cases. Confidence performed better on this comparison, but the contact rule added no benefit.

The 200 subsequent predictions included 75 without a full physical score. Contact features were recovered separately for all 75, increasing the number that could be described without improving selection. An earlier test of a membrane-based score also showed no consistent improvement and could not score one entire set because the required receptor orientation was unavailable.

#### Generation settings

We next asked whether changing how the program generated structures would help confidence choose more accurate models. The changes helped some complexes, but their average gains were too small to meet our rule for replacing the default settings. We generated 900 new development models under the three settings (Figure 3; Table 2). All could be evaluated. Across the eight groups in the main pair analysis, broader sampling improved the average DockQ of the selected model by 0.017; alignment subsampling improved it by 0.005. Neither reached the required 0.020 gain. The descriptive 95% intervals were −0.019 to +0.055 and −0.036 to +0.066. Both included zero and allowed effects in either direction.

**Table 2. Effects of prediction settings.** The selected model is the one ranked highest by default confidence. DockQ averages and probabilities of an acceptable selection give each biological group equal weight. Acceptable-candidate totals are ordinary counts across nine pair cases per setting. Best available DockQ describes the highest accuracy found retrospectively in each set; it is not an achieved ranking result.

| Setting | Selected model DockQ | Top-five mean DockQ | Best available DockQ | Probability of acceptable selection | Acceptable candidates |
|---|---:|---:|---:|---:|---:|
| Baseline | 0.400 | 0.404 | 0.483 | 0.688 | 127/225 |
| Broader sampling | 0.416 | 0.410 | 0.503 | 0.688 | 128/225 |
| Alignment subsampling | 0.405 | 0.408 | 0.504 | 0.750 | 136/225 |

The changes had different effects across complexes. For the AGTR1–AT118-L construct, alignment subsampling generated seven acceptable models and ranked one first; the other settings generated none. Broader sampling generated one acceptable LGR4 candidate, but default confidence did not place it in the top five. CHRM1 had a few acceptable candidates, but none of the three settings selected one first. OPRM1 and the exploratory CASR case produced no acceptable candidates under any setting. Across all 12 cases, the acceptable-candidate totals were 153/300 for baseline, 155/300 for broader sampling, and 163/300 for alignment subsampling.

We also compared predictions with one another to ask whether the settings produced a wider range of structures. Median structural variation increased in 11 of 12 cases with broader sampling and in 7 of 12 with alignment subsampling. More varied predictions were not reliably more accurate. This separate analysis used 900 structures and 10,800 comparisons between structures from the same set; it was not used to choose a setting.

#### Learned ranking

We asked whether a scoring rule learned from earlier predictions could choose more accurate models than the program’s own confidence, using the same candidate structures. The first test worsened selection, and the expanded comparison did not improve it enough to meet our rules for replacing default confidence. The first test used the initial 300 predictions. Among the 225 predictions eligible for the pair analysis, the average DockQ of the selected model fell from 0.399 with default confidence to 0.373 with either learned method. Both methods replaced an acceptable FZD3 selection with an unacceptable one. With groups weighted equally, the probability of an acceptable selection fell from 0.688 to 0.563. The final procedures therefore retained default confidence.

The comparison was more favorable after adding the expanded development predictions (Table 3). The pair analysis now included 900 predictions: the same initial 225 plus 675 new predictions. When each receptor group was withheld for testing, combining confidence components improved average selected model DockQ by 0.017. Adding interface features improved it by 0.006. Neither gain reached 0.020, and neither method changed any acceptable-or-unacceptable selection outcome. Combining confidence components also slightly reduced the average accuracy of the five highest-ranked models, despite improving the first selection.

**Table 3. Learned ranking on the combined development set.** Each biological group was withheld while the ranking method was chosen and fitted on the other groups. Results include the procedure’s decisions to retain default confidence. All averages give equal weight to groups; these are not scores on the data used to fit each model.

| Ranking procedure | Selected model DockQ | Change from default | Top-five mean DockQ | Probability of acceptable selection |
|---|---:|---:|---:|---:|
| Default confidence | 0.407 | — | 0.410 | 0.708 |
| Confidence components | 0.424 | +0.017 | 0.406 | 0.708 |
| Confidence and interface features | 0.413 | +0.006 | 0.411 | 0.708 |

Each procedure used a learned score in 20 sets and retained default confidence in 16 other pair sets. Twelve sets with unsupported assemblies used default confidence throughout. Neither learned procedure qualified for testing on the three additional complexes. The supplementary methods describe independent checks of the calculations.

### Acceptable selection counts left little room to distinguish rankings

We asked how much a different ranking method could improve the result if success meant only choosing an acceptable model. In the development sets eligible for learned ranking, **default confidence already selected an acceptable model in 25 of the 26 sets containing one**, leaving at most one acceptable selection to gain.

Among all 36 eligible sets, 14 contained only acceptable models, 10 contained none, and 12 contained a mixture. A different ranking could change acceptable-or-unacceptable success only in the mixed sets. These were repeated sets from eight biological groups, not 36 independent targets.

The complete development set, including assemblies outside the learned methods’ scope, contained 48 sets: 18 all acceptable, 14 all unacceptable, and 16 mixed. The mixed sets came from ADRA1A, AGTR1–AT118, FZD3, LGR4, RHO, and CHRM1. CHRM1 retained default confidence because of its helper-chain assembly. Supplementary Table S1 gives the full breakdown.

These counts also explain the limitation of reporting only acceptable-or-unacceptable success. Two acceptable models can still differ substantially in structural accuracy, as can two models below the threshold. DockQ can reveal those differences even when the success count stays the same. An older analysis of 33 five-model jobs is reported separately in the supplementary results and is not part of these 48 sets.

### GPR158 passed the success criterion despite a poor ranking choice

After the development comparisons, we asked whether the retained workflow chose accurate structures for three additional complexes. Confidence chose an acceptable GPR158 model while overlooking more accurate models, whereas ADGRV1 and MC4R produced no acceptable model to choose. We used baseline generation and default confidence for ADGRV1–RE02, GPR158–Nb20, and MC4R–pN162. All 75 predictions could be evaluated. Confidence rankings were recorded before comparison with the experimental structures (Table 4). No learned method was tested here. Only ADGRV1 had an assembly supported by the learned pair methods; GPR158 and MC4R used default confidence by design.

GPR158 generated 24 acceptable predictions out of 25. Confidence selected the model with the 24th-highest DockQ: it was the least accurate acceptable prediction and second worst overall. The best available model scored 0.442, compared with 0.311 for the selected model, a difference of 0.130 calculated from the unrounded scores. Both passed the acceptable criterion, so that success count concealed the difference in accuracy. Figure 1B–C compares these two GPR158 predictions with the experimental complex, PDB 9VOR. [8](https://doi.org/10.2210/pdb9VOR/pdb)

ADGRV1 showed problems at both stages. None of its 25 predictions reached the acceptable threshold, and confidence selected the least accurate prediction. Choosing the best available model would have improved DockQ by 0.113, but that model was still unacceptable. Better ranking alone could not have made this set a success at the chosen threshold.

MC4R generated no acceptable model. Confidence selected the second-best of 25 predictions, but even the best scored only 0.008. Selecting it would have improved DockQ by about 0.002. The main limitation here was the set of structures produced under the tested conditions.

Across these three sets, confidence selected one acceptable model, which was also the maximum possible count. Random selection would have given 0.96 expected acceptable selections across the three sets. That near-equality concealed very different distributions of structural accuracy, as the opening figure illustrates.

**Table 4. Default-confidence results for three additional complexes.** Each set contains 25 models. Selected model quality rank is its position when all models are ordered by DockQ, so 25 is worst. The top-five mean describes the five models ranked highest by confidence.

| Complex | Acceptable candidates | Minimum / median / maximum DockQ | Selected model DockQ | Selected model quality rank | Top-five mean DockQ |
|---|---:|---|---:|---:|---:|
| ADGRV1–RE02 | 0/25 | 0.015 / 0.067 / 0.128 | 0.015 | 25 | 0.073 |
| GPR158–Nb20 | 24/25 | 0.005 / 0.371 / 0.442 | 0.311 | 24 | 0.365 |
| MC4R–pN162 | 0/25 | 0.002 / 0.003 / 0.008 | 0.006 | 2 | 0.006 |

### Broader sampling produced one acceptable ADGRV1 model but confidence missed it

We asked whether changing how structures were generated could produce an acceptable model for ADGRV1 or MC4R after their initial failures. Broader sampling produced one borderline acceptable ADGRV1 model, which confidence ranked 17th, but neither setting produced an acceptable MC4R model. All 100 new predictions were generated and evaluated. Together with the 50 earlier baseline predictions, they provided six sets of 25 for comparison (Figure 4; Table 5).

Broader sampling produced one acceptable ADGRV1 model out of 25. Its DockQ was 0.234, only just above the 0.230 threshold, compared with a best baseline value of 0.128. Confidence ranked this model 17th and instead selected a model scoring 0.043. Alignment subsampling produced no acceptable ADGRV1 model, although its best score of 0.227 was close to the threshold. Its confidence-selected model scored 0.077. Thus, the best available ADGRV1 structure improved, but neither setting produced an acceptable first selection or placed an acceptable model in the top five. Median accuracy did not improve: baseline, broader sampling, and alignment subsampling had median DockQ values of 0.067, 0.059, and 0.057.

MC4R remained unsuccessful under both new settings. None of its 50 new predictions was acceptable, and the best score under either setting was 0.009. The limiting step remained generation under the tested conditions.

This experiment produced one mixed set containing both acceptable and unacceptable models. Its only acceptable model was borderline and was missed by confidence. Generation had created a selection opportunity, but the selected-model result remained a failure. No ranking model was fitted and the workflow defaults were unchanged.

**Table 5. Targeted follow-up after baseline failures.** Each row contains 25 evaluated predictions. Baseline rows reuse earlier predictions; the other four rows contain the 100 new predictions. The selected model and the top five are chosen by default confidence. Best available DockQ is determined retrospectively. Neither complex had an acceptable confidence-selected model under any setting.

| Complex | Setting | Acceptable candidates | Selected model DockQ | Best available DockQ | Top-five mean DockQ |
|---|---|---:|---:|---:|---:|
| ADGRV1–RE02 | Earlier baseline | 0/25 | 0.015 | 0.128 | 0.073 |
| ADGRV1–RE02 | Broader sampling | 1/25 | 0.043 | 0.234 | 0.066 |
| ADGRV1–RE02 | Alignment subsampling | 0/25 | 0.077 | 0.227 | 0.042 |
| MC4R–pN162 | Earlier baseline | 0/25 | 0.006 | 0.008 | 0.006 |
| MC4R–pN162 | Broader sampling | 0/25 | 0.007 | 0.009 | 0.006 |
| MC4R–pN162 | Alignment subsampling | 0/25 | 0.007 | 0.008 | 0.006 |

## Discussion

For GPR158, Boltz-2 generated 24 acceptable models out of 25 and confidence selected the model with the 24th-highest DockQ. The selection passed the acceptable criterion while leaving 0.130 DockQ of available accuracy unrealized. Reporting only whether the top model was acceptable would have recorded a success and hidden this ranking error. Benchmarks should therefore report the accuracy of all generated models, the selected model’s position among them, and whether any acceptable candidate was generated.

The development comparisons make this finding consequential. None of the tested alternatives met the criteria for replacing default confidence, and confidence already selected an acceptable model in almost every eligible set that contained one. Those results supported keeping confidence in this workflow. They did not make an acceptable selection evidence that the ranking had identified one of the most accurate available structures. Continuous accuracy exposed a difference that the acceptable-selection count discarded.

ADGRV1 and MC4R show how the same comparison changes the diagnosis of failure. When no acceptable model had been generated, reordering the existing candidates could not produce an acceptable selection. Broader sampling then created one borderline acceptable ADGRV1 model, but confidence missed it. A selected-model failure alone would have hidden that change in what generation had achieved. The full set of predictions shows whether the next improvement must address generation, selection, or both.

These findings complement larger structure benchmarks and GPCR binder-screening studies. [4](https://doi.org/10.1080/19420862.2025.2545601), [5](https://doi.org/10.1038/s41467-025-67127-3), [6](https://doi.org/10.1038/s41467-026-72093-5) Predicting whether proteins bind, reproducing their experimental interface, and selecting among predicted structures are different tasks. Here, the missed GPR158 accuracy was already present among the generated structures. Future comparisons should test ranking on additional independent receptor groups and report those within-set differences alongside acceptable-or-unacceptable success.

## Limitations

The development set contains 11 biological groups, with only eight eligible for learned pair ranking. Related constructs and repeated predictions do not increase that independent sample size. Some initial test cases had been studied previously, and all initial results later became development data. The expanded analysis added predictions and settings for the same groups, so it cannot establish that more training data improved performance on new receptors. These comparisons do not establish performance on receptor families outside this benchmark. No learned method met the criteria for testing on the three reserved complexes; there is no reserved test showing that learned ranking outperforms default confidence. The targeted follow-up cannot supply that independent test. Its single acceptable ADGRV1 model was close to the threshold; its count should be read alongside continuous scores and does not establish a reliable improvement.

The acceptable-model counts and descriptions of reserved accuracy distributions were retrospective analyses, not additional prospective tests. The GPR158 result demonstrates that acceptable-or-unacceptable scoring can conceal a ranking error; it does not estimate how often this occurs across receptors. The 25-of-26 count measures selection success among sets already known to contain an acceptable model. We did not test whether confidence can identify such sets prospectively or warn that every candidate is poor. Retaining confidence under the prespecified replacement criteria does not show that it is optimal or that interface features cannot help elsewhere. Intervals estimated from eight receptor groups cannot support precise population estimates.

We could not establish that the complexes were independent of Boltz-2’s training data. A structure released after a model’s training cutoff may still resemble training examples in sequence, receptor family, or interface. Excluding templates at prediction time does not remove information learned during training. Preparing the experimental references also exposed metadata and structural context. Results concern the specified constructs, assemblies, predictor and settings. They may not apply to wild-type proteins or other assemblies, and the MC4R failures do not establish that other settings or predictors cannot model the complex. Earlier runs with different constructs, templates, or potentials cannot isolate the effect of changing the predictor. Success rates from other studies also depend on their task, assembly, sampling budget, and similarity to training examples.

The experimental structures have their own limitations. CASR was an exploratory case at 6 Å resolution. ADGRV1 used the deposited mouse construct; only 255 of 426 receptor residues and 107 of 147 nanobody residues were resolved. The associated preprint’s description of this construct as human remains a documented discrepancy. GPR158 retained two receptors and two nanobodies, with weaker local density around the extracellular and nanobody regions. MC4R retained its six-protein assembly and 729-residue receptor fusion; 85 of 117 residues of the target nanobody were resolved. Accuracy in the assessed regions does not validate unresolved regions or establish that an assembly is physiologically relevant. Neither DockQ nor predictor confidence establishes binding affinity, receptor activity, state selectivity, experimental binding success, or therapeutic value.

## Data and code availability

The earlier study is recorded in [ConfoVHH draft pull request 67](https://github.com/darwinxcai/ConfoVHH/pull/67) and the archive `confovhh-source-first-ranking-v4.zip`. These contain the original negative results, protocols, ranking analyses, and 75 reserved outcomes. The 100-prediction follow-up and molecular illustrations were produced later and are not part of that earlier archive. The source map accompanying this revision identifies their separate local data and code. **Public archive DOI: [PENDING DEPOSIT].** A public deposit covering this revision has not yet been made. Version identifiers and archive checksums are listed in the supplementary methods.

The accompanying `source-map.json` links claims and figures to their data and analysis files. It identifies analyses performed after outcomes were known. The checking scripts reproduce rankings and summary statistics from saved results and check the residue mappings used for evaluation. These checks do not repeat the numerical DockQ calculations.

## Author and administrative statements

**Author contributions:** I formulated the research questions, selected the study design and evaluation criteria, interpreted the results, and prepared and revised the manuscript using the AI-assisted workflows described below.  
**Funding:** [AUTHOR TO PROVIDE FUNDERS AND GRANTS, OR CONFIRM NO SPECIFIC FUNDING.]  
**Competing interests:** Dong Wang Darwin Cai is employed by Hansoh. This work was conducted independently and did not use Hansoh resources.  
**Acknowledgements:** [CONFIRM CONTRIBUTORS, COMPUTE SUPPORT, AND PERMISSION TO NAME THEM.]  
**AI and tool assistance:** OpenAI Codex was used for code development, computational workflow execution, data analysis, figure preparation, and manuscript drafting and editing. Anthropic Claude was used for research discussion and manuscript feedback. The author is responsible for the content and conclusions.  
**Ethics statement:** This study used existing structural data and computational predictions. No new experiments involving human participants or animals were performed.

## References

1. Schlimgen RR, Peterson FC, Heukers R, Smit MJ, McCorvy JD, Volkman BF. Structural basis for selectivity and antagonism in extracellular GPCR-nanobodies. *Nature Communications*. 2024;15:4611. [doi:10.1038/s41467-024-49000-x](https://doi.org/10.1038/s41467-024-49000-x).
2. Abramson J, Adler J, Dunger J, et al. Accurate structure prediction of biomolecular interactions with AlphaFold 3. *Nature*. 2024;630:493–500. [doi:10.1038/s41586-024-07487-w](https://doi.org/10.1038/s41586-024-07487-w).
3. Passaro S, Corso G, Wohlwend J, et al. Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction. *bioRxiv* [preprint]. 2025. [doi:10.1101/2025.06.14.659707](https://doi.org/10.1101/2025.06.14.659707).
4. Hitawala FN, Gray JJ. What does AlphaFold3 learn about antibody and nanobody docking, and what remains unsolved? *mAbs*. 2025;17(1):2545601. [doi:10.1080/19420862.2025.2545601](https://doi.org/10.1080/19420862.2025.2545601).
5. Xu S, Feng Q, Qiao L, et al. Benchmarking all-atom biomolecular structure prediction with FoldBench. *Nature Communications*. 2026;17:442. Published online 4 December 2025; version of record 13 January 2026. [doi:10.1038/s41467-025-67127-3](https://doi.org/10.1038/s41467-025-67127-3).
6. Harvey EP, Smith JS, Hurley JD, et al. In silico discovery of nanobody binders to a G-protein coupled receptor using AlphaFold-Multimer. *Nature Communications*. 2026;17:5641. [doi:10.1038/s41467-026-72093-5](https://doi.org/10.1038/s41467-026-72093-5).
7. Mirabello C, Wallner B. DockQ v2: improved automatic quality measure for protein multimers, nucleic acids, and small molecules. *Bioinformatics*. 2024;40(10):btae586. [doi:10.1093/bioinformatics/btae586](https://doi.org/10.1093/bioinformatics/btae586).

8. RCSB Protein Data Bank. 9VOR: Cryo-EM Structure of Human GPR158 Bound to Nanobody Nb20. Released 31 December 2025. [doi:10.2210/pdb9VOR/pdb](https://doi.org/10.2210/pdb9VOR/pdb).

## Figure captions

**Figure 1. Prediction accuracy and an example of a missed better candidate.** (A) DockQ values for all 75 baseline predictions of the three additional complexes. Diamonds mark the confidence-selected models and vertical ticks mark medians. Vertical offsets separate overlapping points and have no measurement meaning. The dashed line marks DockQ 0.23; the horizontal axis shows 0–0.5 of the full 0–1 scale. (B,C) GPR158–Nb20 binding-region views comparing the selected prediction (B; DockQ 0.311) with the best of the same 25 predictions, identified retrospectively (C; DockQ 0.442). Higher DockQ here does not mean better contact recovery: model C recovered 11 of 30 experimental interface contacts, compared with 12 of 30 for model B. Both were superposed on the experimental receptor dimer from PDB 9VOR, using the same camera. Experimental and predicted nanobodies are blue and orange; receptor dimers are gray and tan. The nanobody was not fitted independently. Only corresponding resolved residues are shown; the other nanobody is omitted. These views were prepared after evaluation and did not guide prediction or selection. [Existing figure](figures/figure-1.svg).

**Figure 2. Adding contact rules did not change the selected structures.** Each row is a pool of 25 predictions from the initial experiment. Circles show the DockQ of the candidate selected by default confidence; diamonds show the candidate selected after adding the chosen contact rule. The values coincide. Vertical ticks mark the best candidate identified using the experimental reference, and bars show the number of acceptable candidates. The dotted line marks DockQ 0.23. The first four rows were used to choose the rule. Blue shading identifies GRM5 and LGR4, the two biological groups whose structural outcomes were first tested in this experiment. [Existing figure](figures/figure-2.svg).

**Figure 3. Generation changes had different effects across complexes.** The three settings each produced 25 predictions per case. Points show the DockQ of the candidate selected by default confidence; ticks mark the best available candidate found retrospectively. Connecting lines show the difference between these two values, not uncertainty intervals. Right-hand columns give acceptable-candidate and evaluated-candidate counts. The dotted line marks DockQ 0.23. Shaded rows identify CHRM1, GRM5, and CASR assemblies that were excluded from learned pair ranking. The group-weighted summaries appear in Table 2. [Existing figure](figures/figure-3.svg).

**Figure 4. Changing prediction settings on two previously unsuccessful complexes.** All 150 evaluated predictions are shown: 100 new predictions and 50 earlier baseline predictions. Each setting has 25 models per complex. Dots show individual DockQ values, horizontal bars show medians, and diamonds show the models selected by default confidence. Horizontal offsets separate overlapping points and have no measurement meaning. The shared axis shows 0–0.30 of the full 0–1 scale; the dashed line marks the acceptable threshold of 0.23. Counts below the plot give acceptable models among 25. Only broader sampling for ADGRV1 generated an acceptable model, which confidence ranked 17th. The complexes were selected for this follow-up after their baseline failures were known; these are descriptive comparisons, not independent validation. [Existing figure](figures/figure-4.svg).

## Supplementary methods and results

### Software and generation details

Boltz 2.2.1 used source commit `b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc` and a fixed, checksum-verified confidence checkpoint. Inference used GPU bfloat16 precision with enabled kernels. The recorded input files identify the exact sequences, alignments, chain assignments, model files, and software settings used for every attempt. Inputs, output identities, job times, and file checksums were preserved to support independent checking.

The completed analysis package is recorded at ConfoVHH commit `21afb63518a3846bb80612924967489f9fbafe12` in draft pull request 67. The scientific archive is `confovhh-source-first-ranking-v4.zip`, with SHA-256 `201f60ea744152b56564d81518d917e3f0b2ea3cdbbd5844c835517eba21e20f`. The pull request is an unmerged review copy. This older archive excludes the targeted follow-up and the later molecular illustrations described below.

### Contact features and learned ranking

Contact recovery used the same definitions as the full physical-score analysis but omitted its computationally limiting surface-area calculation. Recovered contacts did not substitute for an unavailable full physical score. A nonzero confidence override was allowed only if leave-one-group-out testing improved first-choice DockQ without losing an acceptable default choice.

The confidence-component model used complex pLDDT, ipTM, interface pLDDT, and log(1 + interface predicted distance error). These measure confidence in residue positions, relative chain placement, and interfacial distances. The interface model added log(1 + contact-pair count), the share of contacts assigned to complementarity-determining regions (CDRs), and the share that could not be assigned a nanobody residue number. CDRs are the variable nanobody loops that commonly participate in antigen binding.

We centered features and DockQ within training pools. Feature scales were weighted root-mean-square centered values calculated from training data only. Weighted ridge regression had no intercept and used penalties of 0.01, 0.1, 1, and 10. The inner validation loop selected the highest expected first-choice DockQ subject to no loss in acceptable-first probability in any inner held-out pool. Exact objective ties favored default confidence, then the larger penalty. The outer loop evaluated this complete selection-and-fitting procedure on a held-out biological group.

Weights were divided equally across biological groups, cases within each group, generation settings within each case, seed batches within each setting, and predictions within each pool. This prevents groups with more constructs or predictions from dominating the primary estimate. Each combined-data procedure used learned ranking in 20 pools (500 predictions), selected default confidence in 16 pair pools (400 predictions), and required default confidence in 12 unsupported-context pools (300 predictions). Final full-development fits used penalty 10, but neither method met the criteria for reserved testing. Independent checks covered 528 distinct inner fits, 1,200 saved ranks, 48 pools, 11 outer groups, and 1,002 saved scalar values.

### Pool composition after the experiments

**Supplementary Table S1. Candidate availability and binary selection.** Each pool contains 25 predictions. Random selection is the expected number of acceptable first choices when selecting uniformly within each pool. Default confidence and best possible are counts across pools; best possible assumes access to the experimental outcomes. Rows overlap and must not be added together. These unweighted summaries differ from the group-weighted estimates in Tables 2–3 and are not independent trials.

| Dataset | Pools | All acceptable | None acceptable | Mixed | Random selection | Default confidence | Best possible |
|---|---:|---:|---:|---:|---:|---:|---:|
| Combined development | 48 | 18 | 14 | 16 | 25.24 | 30 | 34 |
| Combined pair analysis | 36 | 14 | 10 | 12 | 20.92 | 25 | 26 |
| New development only | 36 | 14 | 10 | 12 | 18.84 | 22 | 26 |
| New pair analysis only | 27 | 11 | 7 | 9 | 15.64 | 19 | 20 |

The older retrospective analysis examined 165 retained models from 33 five-model jobs, covering 15 conditions, four reference complexes, and three receptor targets. Sixteen jobs contained only acceptable candidates, 13 contained none, and four were mixed; all four mixed jobs involved 3P0G. ConfoVHH selected 18 acceptable first models, matching the expected count under random selection, compared with 20 possible if the best candidates were known. These correlated jobs were not independent biological replicates. Eighty-five of 250 preliminary cognate coordinates were unavailable. This dataset is separate from the initial and expanded experiments reported in the main text.

### Targeted follow-up on two unsuccessful additional cases

The follow-up generated 100 new predictions for ADGRV1–RE02 and MC4R–pN162: 25 seeds numbered 0–24 under broader sampling and 25 under alignment subsampling for each complex. Broader sampling used diffusion step scale 1.0. Alignment subsampling retained 1.5 and limited the combined alignment to 1,024 rows. The complete constructs, assembly contexts, captured alignments, model checkpoint, and default confidence ranking were unchanged. The comparison reused 50 earlier baseline predictions; equal seed numbers do not imply identical random draws. The targets were chosen after their baseline failures were known.

Generation was limited to 100 attempts, 24 cumulative hours of job time on a single GPU, and a deadline of 6 October 2026 at 00:42 UTC. Prediction had to stop at either time limit, with no additional attempts. Subsequent copying and verification could finish later and remained included in time accounting. All 100 attempts produced predictions without a retry or generation failure. The raw results were copied and verified before the cloud GPU was deleted. All 100 new predictions and the 50 earlier comparators had evaluated DockQ outcomes; none was missing.

All new confidence scores and rankings were recorded and fixed before comparison with experimental structures. DockQ 2.1.3 used the unchanged reference assignments and residue correspondences. MC4R retained Gs and auxiliary Nb35 during generation; evaluation assessed the fixed receptor–target-nanobody pair over resolved reference residues. Missing comparisons were retained with reasons and were not assigned a DockQ of zero.

For each set, the report retained the count of acceptable models out of 25 planned attempts, the number evaluated, and the acceptable fraction among evaluated attempts. Finding an acceptable model was considered recovery of generation only for that particular set. The absence of an acceptable model could not be established if an outcome remained unavailable. Distribution summaries used evaluated models. Selection summaries averaged exact confidence ties; any unavailable model with a positive chance of selection made that summary unavailable. A tied set containing acceptable and unacceptable models did not guarantee an acceptable selection even if its mean exceeded the threshold. Differences from baseline were reported only when both values existed. The two complexes were described separately, without population confidence intervals, p-values, new learned rankers, or changes to production defaults.

A local scoring-process interruption left 80 saved evaluations. These results were checked and reused unchanged. The 20 models without saved results were then evaluated one at a time using the same method. Some calculations may have run without being saved before the interruption; the decision to resume depended only on which result files existed and passed checks. No additional structure was generated and no confidence ranking, reference assignment, or accuracy rule changed. The interruption and recovery are recorded with the analysis files.

### Molecular illustration of GPR158 selection

Figure 1 uses the original reserved GPR158–Nb20 predictions. Confidence selected seed 14, with DockQ 0.311. The highest-DockQ model was seed 04, with DockQ 0.442 and confidence rank 23 of 25. It was chosen retrospectively for illustration; no new prediction or DockQ calculation was performed.

Both models had the same unique highest-scoring reference assignment among the four specified before evaluation: receptor chains A and B with Nb20 at PDB 9VOR label chain D, author chain E. This nanobody corresponds to prediction chain C. The other nanobody was retained during generation but is omitted from the image. The displayed residue correspondences are those already used for evaluation: 541 of 781 receptor residues in protomer A, 540 of 781 in protomer B, and 121 of 150 in the selected nanobody. Unresolved or unmatched regions are not shown.

For display, one rigid least-squares fit aligned the 1,081 corresponding receptor Cα atoms jointly across the dimer. The same rotation and translation were applied to every displayed model atom, including the nanobody; the nanobody was not fitted independently. This whole-dimer display fit differs from the fitting used inside DockQ. Its receptor Cα residuals were 8.256 Å for the selected model and 8.379 Å for the best model, so neither image implies a perfect receptor match. PyMOL 3.1.0 rendered both models with a common camera determined from the experimental structure. The binding-region close-ups changed only the common framing. Display coordinates were rounded to 0.001 Å for PDB exchange; the original coordinates remained unchanged.

The overlay illustrates backbone placement, not atomic interaction accuracy. The higher-DockQ model recovered 11 of 30 native contacts, compared with 12 of 30 for the confidence-selected model in the saved evaluation. We therefore do not interpret its higher DockQ as improved contact recovery. Lower local density around the experimental extracellular and nanobody regions also limits side-chain interpretation. Panel A preserves all 75 original accuracy values, selected markers, medians, and the threshold.
