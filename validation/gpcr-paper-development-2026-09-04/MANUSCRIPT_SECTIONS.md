# ConfoVHH: retrospective application to GPCR–VHH predictions

Working software-paper sections, 5 September 2026. The numbers below derive
from the completed records in this directory. This is a draft contribution to
the manuscript, not a submitted paper or an independent validation study.

## Proposed statement of contribution

ConfoVHH records the structural evidence used to review predicted GPCR–VHH
complexes, including interface contacts, burial, clashes, numbered CDR
participation, and recurrence within a prediction run. Its contribution is a
reproducible audit with explicit input identity and missing-evidence handling.
The retrospective application below establishes that the software can audit
genuine GPCR prediction outputs and preserves the distinction between plausible
interface geometry and agreement with a deposited native interface. It does
not establish a calibrated probability of binding or native-pose correctness.

## Methods: retrospective corpus and inclusion

The supplied AlphaFold Server corpus comprised 460 model records from 92 jobs
and 31 input conditions. Each submitted job requested one seed and retained
five model records. Three verification archives contained 355 model coordinate
files from 71 jobs. The recovered master metrics matched the current source
CSV row for row. Original request and coordinate bytes were bound by SHA-256
digests. Coordinates were available for 165 of 250 preliminary cognate models,
all 60 swapped/irrelevant-binder controls, and 130 of 150 receptor-only models.
The control models were excluded from cognate-interface scoring because their
submitted binder did not match the deposited binder reference. Receptor-only
models were not assigned an interface score.

The retained cognate cohort consisted of 165 models from 33 jobs and 15
conditions, representing four deposited complexes across three receptor
targets. Eligibility was determined from retained files, request identity,
reference provenance, and sequence compatibility, without consulting the new
official DockQ scores. Both predicted protein chains matched their respective
submitted sequences exactly. Observed native sequences were covered completely
as ordered subsequences of the corresponding model sequences. Chain roles
were explicit: notably, the native 5JQH VHH uses author chain C, whereas its
label chain is D. Sequence compatibility supports reference use but does not
prove biological binding or eliminate alignment ambiguity. This corpus had
already been examined during development and was not treated as a held-out
test set.

## Methods: official interface scoring

Native-interface recovery was recomputed using unmodified DockQ 2.1.3 with
default protein-interface definitions, sequence alignment enabled, and fixed
native-to-model receptor/binder chain maps. Original CIF and gzipped CIF files
were parsed directly. No chain-map optimization was used. Known memoization
caches were cleared between models. The exact dependency versions, source
archive hash, installed source files, and locally compiled binary fingerprint
were recorded. All 165 models passed input preflight and scoring without a
failure. Native self-comparisons and 100 Å translated-binder controls passed
for all four references. Five genuine prediction cases covering each distinct
reference/chain mapping produced matching official API and CLI results.
These controls verify the invocation and file mapping; they are not a second
independent implementation of DockQ.

The handoff's earlier custom score used Cα RMSDs and a modified interface
definition. It is retained as `legacy_custom_score` and is not identified as
standard DockQ. The official 0.23 boundary is used only for official scores.
The standard implementation excludes native 5C1M HETATM residue YCM57 from its
protein representation. The independent sequence review mapped YCM to cysteine
solely to document correspondence; the scored coordinate files were unchanged.
DockQ methodology and implementation are described by
[Basu and Wallner](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0161879)
and the [official DockQ repository](https://github.com/wallnerlab/DockQ).

## Methods: ConfoVHH application and endpoint reproduction

The same 165 coordinate files were audited using ConfoVHH product release
0.9.1, geometry engine 0.5.0, ranking policy 0.6.0, and immunum 1.3.0. These
version labels refer to distinct implementation layers. Each five-model job
was analyzed separately, with model 0 supplying explicitly reviewed reference
chain selectors for within-run correspondence. Here, the reference pose is a
predicted model used for correspondence, not the deposited native structure.
For every model, parsed receptor and VHH sequences were checked against the
role-specific submitted sequence hashes. All models were accepted and all VHHs
were numbered. Interface metrics, evidence flags, ranks, and recurrence were
exported through the production implementation; no threshold, weight, or
ranking policy was adjusted using the new DockQ results.

None of the 165 models had a retained full-data PAE matrix. All had confidence
summary JSON, which was hashed for inventory and excluded from PAE and
ConfoVHH ranking. Source ipTM and producer ranking scores were retained as
separately labeled context. Recurrence compares samples within each five-model
job and cannot be interpreted as independent recurrence across seeds.

The declared receptor endpoint readout was independently recomputed for all
355 retained coordinate files and six deposited references. A separate
Biopython mmCIF dictionary parser identified the unique receptor bearing the
declared DRY-like and CWxP-like motifs. Each predicted receptor sequence was
checked against its submission; deposited references used the explicit
receptor chain selectors in the reference provenance table. The measurement
was the Euclidean Cα distance from the R/K in
D[RK]Y to the residue sixteen sequence positions before the proline in
[CTS]W[A-Z]P. Selected endpoint residues, atom coordinates, chain identifiers,
and hashes were retained. This reproduces the supplied coarse geometric
readout; it does not independently validate generic-position assignments or
infer the receptor's complete functional state.

## Results

All 355 recomputed endpoint measurements reproduced the source CSV to its
reported precision of 0.001 Å. Official interface rescoring changed numerical
values, but no retained model crossed the 0.23 boundary relative to its earlier
numerical position. Seventeen 4MQS models that had previously occupied the
custom score's high bin instead received official medium-quality labels. The
largest absolute correction was 0.0820. This comparison audits earlier labels;
it does not validate applying standard categories to the custom score.

Of the retained models, 35/45 for 3P0G, 0/60 for 5JQH, 30/30 for 4MQS, and
25/30 for 5C1M reached official DockQ 0.23. Corresponding median official
scores were 0.3803, 0.0806, 0.7679, and 0.7112. These are descriptive model
counts within four systems, not independent estimates of predictor accuracy.

The retained 5JQH results provide a direct example of the distinction between
the receptor endpoint and interface recovery. The fifteen models in the
pre-2011 rescue condition had a mean endpoint distance of 8.3429 Å, compared
with 8.0716 Å for the deposited reference. Their mean official DockQ was
0.07193, and none reached 0.23. The available five-model default job had a mean
distance of 15.1088 Å and mean DockQ 0.08506. Thus, an endpoint nearer the
deposited value co-occurred with poor recovery of the deposited VHH interface.
These measurements support separating the two readouts; they do not by
themselves establish a causal template mechanism or full receptor-state
prediction capability.

ConfoVHH assigned 15 supported, 131 mixed, and 19 limited geometry flags. Eight
of the fifteen supported flags occurred in models below DockQ 0.23: seven
5JQH models and one 3P0G model. Conversely, a native-like interface could carry
geometry cautions. The observed discordance supports the software's stated
interpretation of its flags as structured evidence for review. It does not
support using them as native-pose classifications or calibrated probabilities.
The paired figure includes all 165 measured models; no values are drawn from
an illustrative mockup.

## Figure caption

**ConfoVHH interface geometry and native-interface recovery in retained GPCR
predictions.** Each point is one retained model, plotted directly from the
hash-verified paired CSV. Panels identify the four deposited references. The
horizontal axis is ConfoVHH interface burial, defined as half the change in
solvent-accessible surface area on association; the vertical axis is official
DockQ 2.1.3. Color and marker indicate the unchanged production geometry
evidence flag. The dashed line marks official DockQ 0.23. Models are nested
within 33 five-model jobs, 15 conditions, and three receptor targets. All
models lack full PAE input. Point overlap reflects measured values, and no
jitter, sampling, aggregation, or imputation is applied.

## Limitations and next evidence

Raw predictions remain unavailable for 105 original records, including 85
preliminary cognate models. In particular, 3P0G pre-2011 seeds 2 and 3—the
counterexample highlighted in the earlier handoff—cannot yet be officially
rescored. Their legacy means of 0.776 and 0.908 must remain unverified. Only
seed 1 can currently be reported with an official mean, 0.268285. The retained
cohort is unbalanced and its availability may be selective. It cannot establish
population-level ranking performance, receptor-family generalization, binding
affinity, specificity, membrane compatibility, or state selectivity.

The Boltz arm has not been run. Its execution wrapper now preserves failed
attempts, verifies exact output identities, and binds logs, cached inputs and
software/checkpoint provenance before completion. Actual software and asset
pins, cached MSAs, and template mapping/alignment evidence remain outstanding.
Matching template accessions or integer seeds alone cannot establish parity
between predictors.

Further work should recover the missing coordinates and PAE, run the existing
unchanged policy on a prospectively specified family-separated evaluation,
and document outside use. The separate frozen-test preparation is not advanced
or unblocked by labeling these retrospective models as new test data. The
manuscript's research-impact statement should describe the completed 165-model
application, replacing the earlier unsupported claim of completed ConfoVHH
triage across all 460 original records.
