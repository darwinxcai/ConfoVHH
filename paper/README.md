# ConfoVHH manuscript and evidence

The [working manuscript](CONFO_VHH_WORKING_MANUSCRIPT.md) integrates the
completed GPCR application, within-job selection audit, measured figure,
primary-source context, and limitations. It is a software/application draft,
not a submitted paper or a claim of independently validated ranking efficacy.

The [software/application draft](SOFTWARE_PAPER.md) develops the near-term paper
scope: auditable review, reuse, design rationale, related software, and the
limitations demonstrated by the retained application. The
[reviewer guide](REVIEWER_GUIDE.md) supplies an executable offline synthetic
example; the [claim/evidence manifest](CLAIM_EVIDENCE.json) and
[data-availability record](DATA_AVAILABILITY.md) define public replay boundaries;
and [submission readiness](SUBMISSION_READINESS.md) identifies the concrete
publication gates. Additional census exclusions alone do not complete a paper.

## What the current evidence supports

| Question | Completed evidence | Interpretation |
|---|---|---|
| Can the workflow audit genuine GPCR predictions? | 165 reviewed cognate models; all officially rescored and audited with unchanged ConfoVHH | A traceable retrospective application |
| Does a supported geometry flag identify the deposited interface? | Eight of fifteen supported flags have DockQ below 0.23 | The flag must remain evidence for review, not a native-pose classification |
| Does ConfoVHH improve native-interface selection here? | 18/33 acceptable selections versus 19/33 for maximum exported score; only four mixed-quality jobs | No support for selection superiority in this retained set |
| Can one receptor distance stand in for interface recovery? | 5JQH endpoint agreement co-occurs with poor official DockQ | The readouts must be evaluated separately |
| Is a controlled template comparison ready to run? | Two coordinate-preserving templates with the same 275 residues and 2,155 heavy atoms; a separate official Boltz synthetic parser smoke now passes | Real-template parsing, complete runtime/cache verification, and inference remain unfinished |

The 33 jobs are nested within 15 conditions, four reference complexes, and
three receptor targets. All four jobs with both acceptable and poor candidates
concern 3P0G. These are not 33 independent informative biological experiments.

## Evidence locations

- [Paired development study](../validation/gpcr-paper-development-2026-09-04/README.md):
  reviewed inclusion, official DockQ 2.1.3, unchanged ConfoVHH audits, endpoint
  reproduction, all 165 paired values, and the measured figure.
- [Selection audit](../validation/gpcr-selection-development-2026-09-05/README.md):
  all 33 jobs, four comparison rules, original-score checks, ties, possible
  outcomes, and paper-ready methods/results.
- [Optional matched templates](../validation/gpcr-matched-template-development-2026-09-05/README.md):
  original-to-query correspondence, equal residue/atom coverage, every
  exclusion, preserved coordinates, and new input hashes. These assets do not
  replace the historical 92-job inputs or activate the proposed 54-job design.

## Next executable work

An [executable paired-selection metric](PAIRED_SELECTION_EVALUATION.md) now
provides tie-aware top-1 comparisons, declared-group weighting, uncertainty and
complete supplied-attempt accounting. It has been exercised only with synthetic
labels. It does not score new complexes or constitute an independent evaluation;
authorized frozen study inputs and the complete protocol are still required.

1. **Complete reviewer reproduction against the proposed release.** Follow the
   [reviewer guide](REVIEWER_GUIDE.md), preserve both synthetic browser exports,
   and run the [export comparison](WORKFLOW_EVALUATION.md). The automated
   browser regression checks role-confirmation reset, missing evidence, and
   report agreement; a real independent researcher's completion remains a
   separate requirement.
2. **Resolve manuscript data availability and submission facts.** The
   [data-availability record](DATA_AVAILABILITY.md) describes what can be
   reproduced from public artifacts. Full raw-to-result reproduction needs
   durable access and redistribution terms for the original archives. Author
   contributions/disclosures, the exact reviewed release, and a stable archive
   identifier remain open.
3. **Recover the missing original outputs when permitted.** Eighty-five
   preliminary cognate models, including the highlighted 3P0G pre-2011 seeds
   2 and 3, remain unavailable for official scoring. Three additional
   `af3_slim` archives were listed but their download failed with HTTP 502;
   their contents remain unverified. The retained models also lack full
   per-model PAE matrices. Record availability accurately if these cannot be
   recovered; preserve the complete missing-input accounting.

## Optional prospective extension

These prediction tasks are separate from preparing the existing
software/application contribution. They require the relevant data-access and
compute authorization, and do not replace the publication work above.

1. **Verify the prepared templates in an inspected Boltz environment when
   permitted by the current data-access boundary.** The
   official parser must preserve the intended coordinate mask and recover the
   declared query/template mapping. Standard PDB parsing and the pinned loader's
   Gemmi conversion have been checked; missing/padded sequence metadata was
   corrected with preserved failing controls. The
   [official Boltz synthetic smoke](../scripts/paper/boltz-parser-README.md) now
   exercises the complete schema parser, offset mapping, atom masks, and PDB
   chain renaming. The wrapper now dispatches PDB versus CIF correctly.
   Real-template processing has not been performed in this increment; the
   synthetic result cannot satisfy job-specific parsing evidence. A parser check
   requires no GPU inference and must precede a prediction smoke test.
2. **Complete the inputs for one reproducible prediction job.** Cached MSAs,
   chemical-component/template features, exact runtime dependencies, and
   model/cache files must be verified locally. Existing checkpoint and wheel
   metadata do not establish a complete runnable environment. Record a
   successful single-job execution and its failures before scaling.

The independent hard-decoy protocol remains a separate project record. This
retrospective analysis neither clears its target/component requirements nor
adds an independent test. Do not tune the ranking policy on these 165 models
and then reuse their results as validation.

## Verification of this increment

The selection and template preparation scripts use Python's standard library.
Their Node test wrappers run 14 and 11 synthetic regression tests respectively. The
synthetic coordinates and scores remain confined to tests. They never enter
the manuscript data or figure.

The selection analysis was also recomputed independently for every job/method
combination and checked against all 165 original confidence JSON files. An
independent Biopython 1.88 read of the two exported PDBs confirmed one chain,
275 residues, 2,155 atoms, matching residue/atom identities, and source
coordinates within its float32 representation precision. The preparation
script separately verifies exact source-to-export decimal coordinates and
unchanged endpoint distances. Input, script, and generated-output hashes are
recorded in each evidence directory.

A separate Gemmi 0.6.5 conversion check verifies both corrected templates and
detects four incomplete-metadata controls. It records the exact Boltz wheel and
loader source inspected, but does not import or execute the full Boltz parser.

On 8 September, a new, separately scoped official Boltz 2.2.1 execution used
generated synthetic input only. Its receipt records 26 atom slots, 25 present
atoms, correct offset mapping, and three rejected controls. The
[replay instructions and limits](../scripts/paper/boltz-parser-README.md) retain
the exact wheel/source identities and partial CPU environment. No native
template, inference, or new scientific result is claimed.

Run the focused offline regressions from the repository root:

```bash
node --test tests/gpcr-paper-selection.test.mjs tests/gpcr-paper-template.test.mjs
node scripts/paper/verify-claim-evidence-manifest.mjs
```

Full reproduction commands and success criteria appear in the linked evidence
READMEs. Successful tests do not imply completed inference or prospective
biological validation.
