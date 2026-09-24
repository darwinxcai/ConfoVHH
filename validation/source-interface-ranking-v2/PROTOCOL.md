# Source and interface ranking comparison v2

Status: frozen before calculating v2 rankings or additional-cohort reference outcomes. The original 395 poses and their outcomes have already been inspected in development. This is a prespecified development comparison, not an independent validation claim.

## Enrollment and separation

Retain all 395 previously audited poses, in their three original sets: Champloo 6IBB Chai (195), LightDock 3P0G original (100), and its HADDOCK refinement (100). The two 3P0G sets share a biological system and are not two independent systems.

Attempt all 600 source-planned predictions from the published Junker–Schoeder receptor-template study: 6KNM, 8QOT, 8TH3 and 8TH4; AF2IG, Boltz-2 and RF3; 50 seeds each. Keep every planned attempt in a missingness ledger, even if an archive, model, score or reference cannot be recovered. Confirm actual publisher inventory and document any count correction before scoring. This cohort is added coverage of development-exposed receptor/Nb systems. It is not an independent holdout. The AT118 variants form a related lineage, and methods and receptor constructs remain separate sets. Record source templates, resolved receptor fragments versus full-length inputs, chain roles and receptor/Nb sequence relationships. Do not compare raw source confidences between methods or targets.

No target is enrolled or removed based on observed pose quality. Scores are written and hash-bound before joining reference outcomes. Official source coordinates remain unchanged. Native structures, native contacts, native binding side, DockQ and source-reported accuracy are unavailable to the selector.

## Fixed score arms

Keep the five v1 methods byte-for-byte in membership and rankings: shipped v0.6 tier/burial, burial only, producer score, clash-fraction v1 and overlap-burial v1. No change to shipped production scoring is authorized by a favorable development result alone.

Let S be the saved source producer score in its documented preferred direction. Let B be the existing interface burial proxy, N the number of contacting residue pairs, C the severe-clash residue-pair count and Q the existing overlap burden. G = B/(1+Q).

P = paratopeProxyShare, eligible only when the frozen engine reports vhhNumbering.status == numbered. This is the engine's aggregate CDR contact share; retain its documented convention rather than substituting CDR3 alone.

F = polarContactProxyCount/N, requiring N > 0. The numerator counts distance-qualified atom contacts, not confirmed hydrogen bonds; F is an intensity per contacting residue pair and can exceed one.

D = (N-C)/B, requiring N > 0 and B > 0. This is clean contact-pair density per burial area, not a learned binding-energy model.

For each separate set, r(X) = (n - average ordinal rank(X))/(n-1), after orienting X so greater preference is better; n=1 yields 0.5. Exact ties receive average ranks. Percentiles are computed over all planned rows, with no outcome-dependent masks or complete-case subsets.

Seven additional arms, with fixed equal component weights:

1. hybrid-SG = 0.5 r(S) + 0.5 r(G)
2. G-paratope = 0.5 r(G) + 0.5 r(P)
3. G-polar = 0.5 r(G) + 0.5 r(F)
4. G-density = 0.5 r(G) + 0.5 r(D)
5. H-paratope = 0.5 r(S) + 0.25 r(G) + 0.25 r(P)
6. H-polar = 0.5 r(S) + 0.25 r(G) + 0.25 r(F)
7. H-density = 0.5 r(S) + 0.25 r(G) + 0.25 r(D)

Missing or ineligible required features cause the whole method/set to abstain; every attempt remains present. No weight optimization, feature selection, threshold sweep, training or target-specific exception is permitted in this comparison. Any later change requires a new protocol and separate evidence.

## Membrane qualification

Assess prediction-side membrane inputs separately. A membrane ablation is eligible only with a supplied orientation/binding-side source available to the prediction workflow. Transfer a supplied membrane through an alignment using receptor coordinates alone. Never infer membrane placement or allowed side from the native receptor/Nb complex or its accuracy. Before any membrane-ranked outcomes, freeze its exact transform, applicability, score, missingness policy and verification in a dated addendum. If reliable provenance or transformation is absent, record abstention instead of fabricating a generic orientation. This qualification does not alter the twelve-arm comparison above.

## Outcomes and decision criteria

Use the unchanged v1 reference-only DockQ 2.1.3 evaluator with fixed chain roles, original coordinates, selected first model and default sequence alignment. Keep independent CLI/API agreement checks. Join previously computed original-cohort outcomes by hash-bound ID and coordinate identity; compute new-cohort outcomes only after that cohort's feature and ranking receipts exist.

Primary practical metrics are the expected DockQ and probability of acceptable-or-better quality (DockQ >= 0.23) of the first choice, plus mean DockQ and expected correct counts among the top five and top ten. Average uniformly over exact scientific ties, including ties spanning window boundaries. Also report medium/high thresholds, Spearman preference versus DockQ, pairwise AUROC, best available pose position and the random expectation.

Compare the hybrid arms primarily against source-only and hybrid-SG; compare G-feature arms against G and burial-only. Report every prespecified arm and set, including regressions, failures, constant-score sets and one-class AUROC being undefined. Do not silently pick a winner using one metric. Do not pool thousands of poses as independent biological samples or attach pose-level significance claims. Summaries give each distinct receptor/Nb lineage group equal influence, with methods/construct variants nested within the group; per-set results remain authoritative.

An improvement to global ordering does not establish better first-choice selection, and increased coverage does not establish independent generalization. A production default change requires broader independent target-level evidence. These experiments can identify or reject the next candidate without changing the default.

## Verification and outputs

Strict allowlisted selector inputs; hash-bind source receipts, audits, features, code, ranks and outcomes. Check P/F/D definitions against contact/atom provenance. Test exact ties, shuffled input order, original-five preservation, missing feature abstention and outcome-field injection rejection. Independently reconstruct new scalar arms and top-five metrics. Preserve complete manifests, recovery checks, negative results and a replayable artifact. Never overwrite v1 receipts or its evidence archive.
