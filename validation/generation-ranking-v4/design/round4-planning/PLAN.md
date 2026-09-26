# Next ConfoVHH study: candidate diversity, broader receptors and learned ranking

Status: planning and evidence review. This is not an execution freeze. No new GPU jobs or model training have started under this plan.

## What we are building on

Round 3 supports confidence-first selection on the tested predictions: 5/5 acceptable first choices versus 3/5 for the unchanged physical score on the five directly comparable prospective cases. Confidence succeeded in all six prospective pools containing an acceptable candidate; two other pools contained none. Additional contact rules made no selections change, and the membrane term had no consistent benefit. The matched comparison has prior project/family exposure and is not a broad accuracy estimate.

Keep the exact versioned source-confidence baseline. The current implementation uses fixed prediction models and explicit ranking rules; generating more predictions does not update model weights. The next learned component would be a small ConfoVHH selector trained to rank existing candidate structures. Boltz weights stay fixed in this study.

## 1. Qualify the dataset before assigning training and test roles

Refresh the current public mammalian GPCR–nanobody inventory and reconcile it with the repository's existing sequence, construct and exposure records. Confirm that the chosen nanobody directly binds the enrolled receptor rather than merely stabilizing a helper protein. Record exact deposited constructs, assembly context, reference quality, missing interface residues, engineered segments, binder ancestry, known related receptors and previous project use.

Count biological groups, not coordinate files, seeds or repeat structures. Closely related receptor constructs and known related nanobodies must stay together under a declared grouping rule. Retain separate categories for prior outcome exposure, metadata/source exposure, related-family exposure and model-training uncertainty. A recent deposition alone does not establish model-training independence.

All round-3 cases are now development-exposed. New eligible groups will be assigned to development or a reserved final test before generation/outcomes. A final test group cannot become a training example during the same study. Do not select the final test by observing which pools contain a favorable mixture of good and bad predictions: retain every enrolled pool and separately report whether within-pool ranking was testable.

The number of usable new independent groups is not yet known. The older prospective-benchmark-v1 inventory is a dated qualification snapshot under a different protocol, not a current proof that additional groups are unavailable. It also cannot be treated as a list of already qualified independent targets.

Specific re-review findings: RCSB currently lists GPR158/Nb20 (9VOR) and GPR151/Legobody (9W3K), but both already occur in the repository inventory. GPR158 has recorded construct/source-exposure questions. The retained GPR151 sequence review records a development-related receptor segment and a nanobody sequence match. Neither is currently certified as a new independent test group by this plan. Any deposited-construct development study must state its narrower scope explicitly.

## 2. Improve candidate generation on existing development cases

Compare three bounded generation strategies: the unchanged baseline, one broader structural-sampling setting, and one alignment-subsampling setting. Change one factor at a time. Use the same receptor/nanobody sequences, assembly context, model checkpoint and captured sequence alignments; retain successful cases as controls alongside difficult cases. OPRM1, AGTR1/8TH4 and LGR4 are priority failures; CASR remains a separate low-resolution exploratory case.

Before launching, freeze the exact settings, seed schedule, number of attempts per arm and runtime identities. Compare equal candidate counts and report actual compute use separately; a more expensive setting does not get described as equally efficient without evidence. Preserve every planned failure and all negative results. No reference coordinates, target-specific contact restraints or answer-based retries enter prediction generation or ranking features.

Evaluate generation and selection separately: (a) did any acceptable candidate exist, (b) how close was the best generated candidate, and (c) how good was the candidate actually selected by the unchanged confidence policy? Report candidate diversity without assuming that greater diversity guarantees higher quality. Raw confidence values from different producer/context regimes will not be pooled without a separately validated comparison rule.

The pinned Boltz prediction documentation supports both sampling controls and alignment subsampling. These are available experimental controls, not demonstrated GPCR–nanobody improvements. Any different input-construct or helper-context experiment must be a separately labeled comparison.

## 3. Fit a small ranking model after dataset qualification

First assess whether the qualified development groups support a modest model. Start with a limited, prespecified comparison: original source confidence; a simple learned combination of prediction-confidence components; and a small regularized model that adds prediction-only interface evidence. Candidate features include confidence specifically at the selected receptor–nanobody interface, uncertainty in relative partner placement, severe clashes and contact consistency. The failed contact-share override remains a negative baseline; it is not presumed useful merely because a learner can assign it a weight.

Train using known reference agreement as labels, while ensuring that references, reference-derived contact locations, receptor identifiers and outcome summaries cannot enter inference features. Give biological groups comparable weight. Choose features, normalization and regularization only inside grouped development validation, keeping related receptor/nanobody examples together. Preserve explicit invalid-input handling and source-confidence fallback when optional features are unavailable; a learner must not gain an apparent advantage by dropping difficult candidates. Thousands of poses from a few families do not justify a large neural model.

The aim is to improve continuous structural quality, including cases where confidence already selects an acceptable pose but misses a substantially closer one. If there are too few effective groups, retain the model as an exploratory development result and preserve confidence-first as the operating baseline. General antibody-complex data, if later considered, would be auxiliary training data with explicit domain and overlap checks; it would not count as independent GPCR validation.

## 4. Freeze and judge improvement on the reserved receptors

Lock candidate-generation policy, feature extraction, trained weights, failure behavior and ranking rules before opening final-test outcomes. Rank the same saved candidates with the baseline and challenger. No learning or rule adjustment occurs after the final test is opened.

Report first-choice structural quality, acceptable-first-choice rate, top-five quality, good baseline choices lost, failed baseline choices rescued, selection coverage and the gap between the selected and best available candidate. Candidate availability remains a separate result. Keep all-good/all-bad pools and missing results in the all-enrolled summary; report mixed-quality pools as a descriptive subgroup without replacing the primary denominator.

Before execution, use development variability and the actual number of qualified groups to specify the sample-size rationale, primary endpoint and acceptable regression margin. Estimate uncertainty across biological groups. Promote a learned selector only if the locked test supports a useful quality gain with an acceptable loss/coverage profile; otherwise retain confidence-first. A small panel can provide exploratory evidence without establishing general superiority.

## Immediate work order

Complete the eligibility and relatedness ledger, assign protected test groups, and freeze the controlled generation comparison. Run generation experiments on existing development cases while preparing the newly qualified dataset. Fit the small ranker only when the development set supports it, then perform the reserved comparison once. Preserve the previous reports and production defaults throughout development.

## Evidence consulted

- Round-3 result report: `../REPORT-V3.md`; reviewed GitHub state remains draft PR65, with production defaults unchanged.
- Current v3 policy and input contract: `../ConfoVHH/scripts/external-ranking-v3/README.md`.
- Prior inventory and exposure qualifications: `../ConfoVHH/validation/prospective-benchmark-v1/README.md` and its inventory files.
- Target-specific retained reviews: `../ConfoVHH/validation/hard-decoy-holdout-v3/mglyr-source-resolution-2026-09-08/README.md` and `../ConfoVHH/validation/hard-decoy-holdout-v3/gpr151-source-review-2026-09-04/README.md`.
- [Pinned Boltz prediction documentation](https://github.com/jwohlwend/boltz/blob/b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc/docs/prediction.md).
- Current metadata candidates, not eligibility certificates: [RCSB 9VOR](https://www.rcsb.org/structure/9VOR) and [RCSB 9W3K](https://www.rcsb.org/structure/9W3K).
