# Separately scoped membrane-protein–VHH feasibility plan

Status: **working design, not preregistered or frozen; no new discovery census, native-coordinate access, prediction, label, or experiment has been performed for this study**.

Prepared 2026-09-04. This is an actionable alternative-study design, not a claim that enough eligible targets exist. Its usefulness does not depend on whether the current GPCR census bound is ultimately certified: that bound concerns its archived search universe and assumptions. A non-GPCR study answers a different question and cannot repair or enlarge the GPCR holdout.

Starting records: [GPCR v3 protocol](../../HARD_DECOY_PROTOCOL_V3.md), [separate development protocol](../../LEAKAGE_COMPONENT_DEVELOPMENT_PROTOCOL.md), [validation and implementation scope](../../VALIDATION.md), and [generator/MSA readiness audit](../hard-decoy-holdout-v3/generator-readiness-2026-09-04/README.md). Their completed work is preserved; this draft does not authorize their blocked execution steps.

## Proposed question and scope

Does the frozen ConfoVHH coordinate-only ordering improve selection of reference-similar predicted poses for **direct VHH complexes with non-GPCR integral membrane proteins**, compared with producer confidence?

Start with full membrane-protein constructs, including channels, transporters and other membrane receptors whose experimental assemblies contain a direct, noncovalent VHH interface. Record protein class and membrane topology from public annotation. Exclude soluble proteins, isolated soluble ectodomains, GPCRs, scFvs/Fabs, auxiliary binders, same-chain target–VHH fusions and unresolved direct-target assignments from the primary scope. These exclusions are proposed design choices, not biological conclusions about the excluded proteins. They keep the first census interpretable; any broader version must be named before its outcomes are inspected.

Use a distinct study identifier, input registry, candidate ledger and result package. Do not pool components, poses, confidence intervals or success counts with GPCR v2/v3 or the existing development studies. Report membrane-protein classes separately as diagnostics. A positive pooled result across this new population would not validate GPCR transfer or performance in every represented class.

## First executable work package: discovery using metadata only

1. Archive a dated membrane-protein accession inventory with its inclusion rule, version and source. Search experimental structural records both by membrane-protein accessions and by VHH/nanobody/single-domain-antibody descriptors. Use complementary sequence-based VHH discovery so a missing keyword does not imply absence. Store exact query bodies, paginated responses, totals, retrieval UTC, URLs, byte counts and hashes. Report each search's coverage limitations.
2. Preserve the union of all hits and deduplicate by stable entry and entity identifiers. Record intersections and omissions from each source. Never describe a keyword intersection as the whole public structural universe.
3. Read entity sequences, construct annotations and primary publications to identify candidate target/VHH entities. Distinguish direct target binders from G-protein, Fab, BRIL or other auxiliary binders. Record positive evidence and unresolved cases individually. A familiar auxiliary binder name is not proof that no second, unnamed VHH is present.
4. Join candidates to the complete exposure registry: every target, VHH, publication and structure previously used to develop ConfoVHH or inspected for its scientific evaluation. Keep earlier rejected hits in the provenance ledger; exposure and eligibility are separate fields.
5. Build a reproducible metadata dependency graph and report candidate counts, provisional components, excluded components and unresolved components. A metadata upper bound is conditional on the discovery coverage and graph rules. No target is finally eligible merely because its descriptor looks correct.

No coordinate retrieval, structural thumbnails, contact calculation, pose generation or scoring belongs in this work package. Literature prose can disclose interface information; record that exposure rather than calling this complete human blindness. Later generations must be sequence-driven and receive no manually inferred interface restraint.

Minimum ledger fields:

| Group | Required fields |
|---|---|
| Discovery | Study ID, stable candidate ID, PDB/entity IDs, discovery source/query IDs, retrieval date, raw-response hash, record release/revision date |
| Molecular identity | Exact target and VHH sequences/hashes, canonical accessions/isoforms, target class/family/domain annotation and source version, VHH identity/known parent, antibody-format evidence |
| Construct and role | Target construct boundaries, engineered partners/fusions, direct-binding citation and quoted location, auxiliary roles, assembly/model/chain-selector status |
| Dependence and exposure | DOI/PMID, target-family cluster, VHH cluster/parent, previous-development relationship, known interface information already observed, unresolved dependencies |
| Disposition | Include/exclude/pending, reason, evidence reference, missing information, reviewer and decision date |

## Independent unit and dependency rules

The inferential unit is a **connected dependency component**, not a PDB record, receptor name, VHH variant, experimental repeat or predicted pose. Build one graph containing previous development/exposure nodes and all new candidates. A component connected to development is excluded from an independent evaluation.

Proposed edges are shared canonical target, shared source-backed target family or relevant homologous domain family, known VHH parent/variant, prespecified VHH sequence cluster, shared primary publication, and duplicated construct/experimental complex. For multimeric targets, record every intended interface-bearing subunit and relevant shared subunit; ambiguous identity remains unresolved. Resolve known collaboration, discovery campaign or binder-library dependencies where reported.

Do not export the GPCR canonical-TM1–TM7 rule to channels, transporters or other folds. Select and version family/domain annotations, alignments, coverage definitions, graph thresholds and a more conservative sensitivity graph using sequences and metadata before native access or candidate generation. Missing family or VHH-parent information cannot support a strong biological-lineage claim. Use the narrower vocabulary actually established, such as `metadata-family-disjoint` or `sequence-cluster-disjoint`.

This proposed study makes **no native-epitope-disjointness claim**. It uses conservative family/domain exclusions instead of transferring the GPCR epitope oracle across incompatible folds. Any later native-epitope design would require its own meaningful within-family mapping and a separately specified isolation procedure.

Select one representative per provisional component mechanically from metadata, before any generator result: usable experimental assembly and complete chain identity; reported resolution; release date; then stable ID. Additional structures may be retained as component-clustered sensitivity material. Later-discovered dependencies merge components, never increase the effective sample size. Report resulting attrition without replacing failed representatives after results.

## Decide sample size before results

Do not assume that ten components provide adequate power merely because the GPCR protocol used ten as a floor. Plan against the number of **class-informative independent components**, not the number of predictions.

Proposed primary contrast: component-macro average-precision difference, ConfoVHH minus producer confidence. Compute AP within target and generator, average generators within target, and weight components equally. The design goal is to detect a 0.10 absolute AP improvement with 80% power and to target a 95% interval half-width no larger than 0.10. These numbers are proposed scientific design choices, not observed effects or promised precision.

Before freezing targets, produce a reproducible simulation or analytic planning report that varies class prevalence, tied-score frequency, component heterogeneity, paired-arm correlation and generator failure. Synthetic settings must be labeled assumptions. Existing development results may inform a clearly labeled sensitivity scenario; they cannot establish variance for this new population. Use the intended analysis and resampling procedure in the simulations and justify the range considered plausible.

Set the required component count to the largest requirement from the chosen power and precision criteria across the prespecified planning scenarios, with a floor of ten informative components. Record the final count and decision before opening any new labels. If the available census cannot satisfy it, designate the work a descriptive feasibility pilot in advance. Additional seeds or structures within a component do not repair a component shortfall. If observed class balance or failures later violate the planned minimum, report that failure; do not add targets adaptively or relax the endpoint.

## Candidate generation and analysis proposal

Use the historical, attested v0.5 coordinate-only ordering as the primary ConfoVHH arm for continuity; identify its exact code and dependency hashes. The production v0.6 ordering is different and cannot silently replace it. Any extra arm must be specified before outputs and treated as secondary. Verify applicability using synthetic structures and previously exposed development examples before locking the implementation.

Both a template-free AlphaFold-Multimer implementation and a Boltz implementation are proposed generators. Reuse verified environment assets when appropriate, but freeze new commands, checkpoint/image digests, exact target inputs, MSA policy, seeds, attempts and resource limits for this study. Resolve unpaired versus paired MSA handling explicitly. A per-sequence MSA cache alone does not freeze a joint paired request. Do not use target-native pose information to initialize, select or constrain predictions.

Training-set overlap is a separate limitation from ConfoVHH development leakage. Record each target's release date against each generator's documented training data/cutoff; use `unknown` when membership cannot be established. Template disabling does not prove absence from training. Any independent claim must name the kind of independence actually achieved.

Freeze every attempt, failure, retained pose, producer-confidence record and ConfoVHH audit before opening native references. Choose contact-rich eligibility and duplicate-collapse rules before prediction, using no score or reference geometry for selection. Retain failed attempts in the accounting and report the selection fraction; performance conditional on eligible outputs is not whole-pipeline success.

The proposed primary label is DockQ >=0.23 against the fixed experimental target–VHH interface, with exact chain correspondence and a prespecified policy for symmetry, missing residues and multimeric targets. Pin the scorer/version and mapping. DockQ reflects agreement with that reference; alternate biologically plausible poses and experimental conformational variability are limitations, not evidence that an apparent model error is correct. Resolve assembly/interface validity through a separate preparation custodian before generation, releasing eligibility and mapping only; that custodian records native access, and the generation/scoring team does not inspect native coordinates before label opening.

Primary comparison is paired AP difference versus producer confidence. Secondary comparisons are contact count, DeltaSASA, clash burden, CDR-contact share and all-tied ranking, with multiplicity handled by a rule frozen in advance. Preserve score ties; report component effects, component-resampled uncertainty, generator strata and leave-one-component-out influence. Define AP and missing-class handling explicitly; both-class components support the ranking endpoint, while every failed or single-class component remains in the census and feasibility denominator.

Success means improvement in **reference-pose ranking under this candidate-generation distribution**. It does not establish binding, affinity, specificity, signaling, state selectivity, membrane compatibility or prospective experimental hit rate.

## Practical sequence and deliverables

| Order | Deliverable | Decision it enables |
|---|---|---|
| 1 | Archived metadata search, complete entity-level dispositions and provisional component graph | Is a separately scoped sample plausible, and what does the search miss? |
| 2 | Engine applicability review, power/precision report and generator resource estimate | Formal evaluation or openly descriptive pilot; exact endpoint and minimum components |
| 3 | Complete protocol with resolved mappings, source and environment hashes, candidate/failure accounting and fixed analysis | Reproducible preparation and generation without outcome-based revision |
| 4 | Frozen candidates/audits, then one planned reference-label evaluation | Publish positive, negative or inconclusive computational result |
| Parallel | Filled [CRO brief](CRO_BRIEF_DRAFT.md) for a defined biological question | Determine whether an experiment tests a useful, distinct claim |

The next task is deliverable 1. Routine metadata collection and documentation can proceed autonomously. This draft does not itself freeze the scientific choices, launch paid computation, retrieve native coordinates or commission experiments.
