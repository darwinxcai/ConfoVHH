# Eligibility resolution and completed retrospective replay

The benchmark preparation package was published in draft PR #60 at commit `3ac09e27ead4d72c03e476181aad779a983664b7`; its tree matches the tested local preparation. This addendum preserves that entire freeze, the five existing methods, the original negative 3P0G result and all earlier records.

**No independent target or group is cleared.** Two readily resolvable entries now have evidence-backed scientific exclusions. The other 268 remain blocked, not declared scientifically ineligible. The finite curated inventory now has 80 excluded and 268 blocked entries; the separate 17,387 unreviewed discovery IDs have not become eligible by implication.

A bounded, explicitly retrospective replay has also **completed** on four already-exposed complexes. It used the unchanged evaluator and existing coordinates, with no new GPU generation. This is a compatibility and structural-audit evaluation, not independent validation or a complete confidence-versus-geometry benchmark.

## What blocked the original 270 entries

These counts overlap. The row-level `blocked-entry-resolution.csv` retains every original reason and its new disposition.

| Specific recorded blocker | Entries | Interpretation |
|---|---:|---|
| Direct receptor/VHH role or exact construct certification incomplete | 270 | Unresolved scientific identity/role evidence; not merely paperwork |
| Complete parent/family and no-edge review missing | 270 | Unresolved scientific independence certification |
| General input and reference feasibility not locked | 270 | Mixed: administrative artifact/MSA/execution seals plus scientific reference assembly/mapping/quality review |
| Possible receptor or nanobody connection to development | 242 | Provisional relatedness signal; **not 242 proven exclusions** |
| Related source-family exposure review | 228 | Exposure/ancestry adjudication; overlaps the preceding category |
| Recorded structural or prediction-prose exposure review | 31 | Actual prose exposure recorded; its scope and downstream family consequences require adjudication |
| Engineered ADRB2 graft related to development | 1 | Scientific development-related graft concern |

A mutually exclusive partition is **242 with possible development connections, 26 with exposure review but no such sequence-component flag, and 2 with only the three generic blockers**. Those last two are 7UL3 and 9W3K. There are zero targets for which *only* administrative missingness remains after all scientific eligibility requirements have been certified. An unknown role, family history or reference mapping cannot be promoted to a pass by filling in an execution form.

## Resolved front of the queue

Selection of these two entries was based on their three-blocker metadata status, not predicted outcomes. Exact canonical construct FASTAs and full native label-to-author residue mappings are retained. No MSA or prediction input is generated for a scientifically excluded entry.

| Entry | Verified roles / full lengths | Sequence and ancestry decision | Reference check | Disposition |
|---|---|---|---|---|
| 7UL3 | receptor author A, 400 aa; Nb6M author C, 131 aa; NabFab H/L are helpers | Nb6M vs development 6VI4: framework 75/91 (82.42%), CDR3 15/15. The numerical sequence rule **does not pass**. The primary paper identifies Nb6M as Nb6 antigen-binding loops grafted onto an alpaca scaffold and the receptor as an H2R/KOR ICL3 hybrid. The existing known-parent/graft veto applies. | 3.0 Å global resolution; 268 receptor and 117 VHH residues observed; 22 native residue contact pairs within 4.5 Å. Current full entity sequences exactly match retained metadata; all observed selected residues map to their entity sequences. | Scientifically excluded: development parent and engineered graft |
| 9W3K | receptor author A, 419 aa; NB6 author B, 127 aa | NB6 vs development 6VI4: framework 88/91 (96.70%), CDR3 15/15; length difference 0. Frozen sequence-relatedness rule passes. The current deposited complex confirms the NB6/receptor interface. This is a relatedness exclusion, not proof of genealogical identity. | 3.08 Å global resolution; 275 receptor and 126 VHH residues observed; 23 native residue contact pairs within 4.5 Å. Full sequences match retained metadata; observed residues map exactly. | Scientifically excluded: development-related VHH |

For 7UL3, the source is the original [universal-nanobody study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12014012/) and the deposited [7UL3 entry](https://www.rcsb.org/structure/7UL3). For 9W3K, the previously retained GPR151 sequence/source review is supplemented by the [deposited reference](https://www.rcsb.org/structure/9W3K). The KOR-like engineered segment and NB6 interface do not establish binding to the endogenous GPR151 epitope. Neither global resolution nor contact counting is a local-density certification. Such a certification would not rescue either entry from its decisive independence exclusion.

The updated component file adds these two development connections and removes none. It has 55 **provisional** components across the same 348 entries, versus 57 before merging; these are not independent sample counts. Both inspected entries connect to development 6VI4. The old group file is unchanged.

Exposure is recorded separately: retained metadata screening; prior structural/prediction-prose reading; this task's native coordinate inspection; and use for method development. The evaluator was frozen before this native inspection and was not modified afterward. Neither entry was used to tune a scoring method. Predictor-training exposure remains separately unresolved; an absence of known training membership is not evidence of training novelty.

## The executed alternative

The fixed roster uses the original ten-pose Boltz 3P0G pilot plus the original default-condition AlphaFold-server requests for **every other reviewed cognate reference complex** in the exposed legacy corpus: 4MQS, 5C1M and 5JQH. For each legacy complex, use seeds 1 and 2 and all five model indices. This rule was sealed before the replay and did not choose conditions or candidates by their accuracy. Five 5JQH seed-2 coordinates are absent from all three retained archives; their original execution success is unknown and the records are retained as unavailable (`not-run` is the frozen evaluator's producer-status representation). No replacement was made.

The pre-existing group snapshot is retained for analysis: 3P0G, 5C1M and 5JQH share one provisional component; 4MQS lies in a second. Four complexes are not four independent observations, and neither component is an independent validation group. The new eligibility merger changes neither their membership nor this retrospective weighting.

All 35 available coordinate hashes match the preserved scientific bindings. All 25 legacy confidence files match the original published audit receipt. Exact request sequences, chain roles and reference hashes are bound; current coordinate prechecks verify full input-sequence/role matching. The 5JQH request places VHH before receptor (A=VHH, B=receptor); the other two legacy requests use A=receptor, B=VHH. Two failed preparation versions that initially mishandled this ordering are retained. The frozen evaluator rejected the mismatch correctly; only preparation of the input plan was corrected, before successful scoring.

Legacy AlphaFold-server requests used templates and are not the frozen Boltz generation protocol. Their confidence JSON has `ranking_score`, not the required `confidence_score`. The files remain unchanged: the confidence arm abstains on each legacy complex. No pLDDT/ipTM/ranking-score substitution, coordinate conversion, repair, native mask, threshold change or scoring variant was introduced. The low-level frozen audit helper has a constant generator identifier; it does not authenticate upstream origin. The actual predictor provenance is explicit in the replay design and requests.

All 35 coordinates were evaluated by DockQ 2.1.3 with the fixed reviewed receptor/VHH roles and default sequence alignment. Each first candidate passed the independent API/CLI check with exactly zero difference. Missing or engineered reference regions are not used to alter ranking. The comparison is to the deposited pose under the specified alignment, not a claim of unique biological numbering or density correctness.

| Exposed complex | Coordinates / planned | Frozen v0.6 selected DockQ | Burial only | Predictor confidence | Clash fraction | Overlap burial | Best available |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3P0G | 10/10 | 0.176256 | 0.484629 | 0.484629 | 0.484629 | 0.484629 | 0.484629 |
| 4MQS | 10/10 | 0.777000 | 0.777000 | abstain | 0.738287 | 0.738287 | 0.807120 |
| 5C1M | 10/10 | 0.715276 | 0.715276 | abstain | 0.715276 | 0.715276 | 0.721171 |
| 5JQH | 5/10 | 0.078005 | 0.093139 | abstain | 0.093139 | 0.093139 | 0.093139 |

The files `all-40-attempts.csv` and `all-20-selections.csv` contain exact values, IDs, ranks, hashes, every method and every missing outcome. Exact selected sets and best-available ties are retained in `evaluation.json`; no observed selected or best-available set has multiple members. Best-available completeness in the frozen output refers to the available coordinate pool; it does **not** imply that all ten planned 5JQH predictions exist.

Both graded methods lose to burial alone on 4MQS by **0.0387126937739988 DockQ**, and tie burial on each of the other three exposed complexes. No losses are removed. The original 3P0G feature values, ranks and negative frozen selection reproduce. The mechanically emitted exact-test fields have **no confirmatory interpretation** for this exposed, partly incomplete, mixed-predictor corpus. Missing confidence also prevents the planned confidence comparisons from becoming complete. No method is validated as a better selector by this replay.

## Resources, remaining blockers and executable use

Before replay, the sealed allowance was 15–45 local CPU minutes with an independent 2,700-second controller deadline, zero GPU hours and $0 new cloud charges. Actual complete replay time was **29.066 seconds** (12.764 scoring, 13.409 DockQ, 0.041 comparison, plus verification). No cloud resource was allocated. This fast local replay is not an inference-time estimate.

The retrospective replay is executable now from the preserved archives; it has already run. With the existing pinned evaluation environment and Node, from the repository root:

```sh
python scripts/benchmark/prepare-retrospective-replay-v1.py --archives /path/to/archives --output /fresh/replay-bundle
python scripts/benchmark/run-retrospective-replay-v1.py --bundle /fresh/replay-bundle --node /path/to/pinned/node --output /fresh/replay-results
python scripts/benchmark/report-retrospective-replay-v1.py --bundle /fresh/replay-bundle --results /fresh/replay-results --output /fresh/report
```

The three archives are `GPCR_AI_verification_part1.zip`, `part2.zip`, and `part3.zip`. Archive digests, individual input bindings, all runtime output and the exact successful bundle freeze are preserved. The frozen evaluator requires its existing pinned environment; this task does not reinstall it.

The exact remaining blockers for **prospective generation** are: zero cleared independent target/group; unresolved role/construct, ancestry and exposure certification on the remaining 268 entries; no eligible target-specific reference-quality and alignment seal; no eligible target input/chemical/MSA seal; and no sealed general generation/cache/controller bundle or total resource estimate for such a set. The 17,387 unreviewed discovery IDs do not supply an invented sample size. The frozen design and tests remain available, but an empty target set cannot support power or a claimed executable prospective launch.

The exact blocker for a **complete five-method retrospective comparison** is the missing Boltz confidence field on legacy predictions, plus the five absent 5JQH records. Running more analysis cannot recover these data. Replacing the confidence definition would change the frozen method and is not done. New Boltz generation would require a separately bound exposed-target generation bundle, local MSAs, runtime/JIT checks, preserved cache assessment and a total estimate before allocation. None is silently authorized or represented as ready here. The completed alternative answers the narrower, honestly labeled compatibility/audit question with the actual available data.
