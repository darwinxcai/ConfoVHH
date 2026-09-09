# Coding and predictive-validation work executable in this chat

Updated 9 September 2026. This record tracks repository, data-processing and
computational-evaluation work. Author administration and researcher recruitment
are outside this progress accounting.

**The coding/evaluation work is not complete.** The core analysis workflow is
implemented. Substantial remaining work concerns release integration and a
defensible predictive evaluation. Test counts and discovery inventories do not
provide a percentage of either track completed.

| Deliverable | Established evidence | Remaining chat-side work |
| --- | --- | --- |
| Parse, audit and export selected coordinates | PR #56's exact tree passed 864 tests on Node 22/24, full local Node 22 release checks, and hosted browser/accessibility, coverage and static build | Preserve these gates after source/dependency changes; exact public producer download still fails HTTP 403 |
| Execute current-product ranking from coordinate and confidence bytes | [Source-bound execution](SOURCE_BOUND_COORDINATE_RANKING.md) verifies both supplied file identities, extracts fixed AF3/Boltz confidence fields, reruns the audit and exports tied ranks; generated cases pass | Authenticate actual prediction-run inputs/outputs and complete prospective attempt accounting; the filenames and hashes alone do not prove original-run association |
| Keep prediction jobs separate during comparison | [Selection-set evaluation](SELECTION_SET_EVALUATION.md) selects within each declared job before averaging and retains nonmixed sets, failures, missingness and component weights | Freeze the actual population/job schedule, outcome definition, inference and uncertainty plan; execute on authorized data. The new component is descriptive and does not estimate scheduled-job yield |
| Integrate patched dependencies without changing historical evidence | Draft PR #57 installs/builds with patched dependencies; unchanged VHH, [synthetic recipes](HISTORICAL_SYNTHETIC_REPLAYS.md), and [integration verifier plus its two original tests](HISTORICAL_INTEGRATION_REPLAY.md) execute in the original workspace; integration replays pass on Node 22/24 with 190 file identities unchanged | Route mandatory historical assertions to their verified environments while retaining current-product coverage; complete remaining metadata recipes and required CI. No CI routing has changed |
| Assemble the evaluation population | Exact phrase-only discovery covers 3,000 entries; next fixed batch is 12, with 9,262 identifiers left in that partition | Resolve source/construct identity, ancestry/overlap and exposure accounting; complete eligibility and grouping. This partition is not a whole-census bound |
| Prepare a bounded GPU runtime/pilot | [Cloud preparation](CLOUD_GPU_PREPARATION_2026-09-09.md) provides a digest-pinned base, resolved Boltz/CUDA dependency locks, candidate Dockerfile and runtime checker | Build and test the actual image; recover exact pilot MSAs and full cache provenance; obtain authenticated cloud access; execute and time one declared pilot. No GPU inference has run |
| Measure independent pose-selection performance | Rank export and paired-comparison code exist and are tested synthetically; zero independent eligible groups are cleared | Freeze the applicable study population, method and baselines before outcomes; execute the prespecified comparison with uncertainty and failure accounting |
| Bind technical methods to a validated release | Seven main claims bind to 14 public artifacts; methods/reviewer instructions exist | Complete original-input replay or explicit bounded reproducibility, reconcile current/historical execution, regenerate release-specific evidence and archive the verified version |

## What predictive success must mean

The immediate computational question is whether the declared ConfoVHH method
selects reference-consistent poses better than the named producer-confidence
baseline across independently eligible GPCR–VHH groups. A favorable interface
flag, reproducible geometry or passing software test does not answer that
question. Pose assessment also does not establish binding affinity, specificity
or cellular activity.

The current-product path now provides actual coordinate-to-rank execution for a
separately specified evaluation. It cannot stand in for the older frozen v3 arm,
whose original engine/quantization provenance remains unresolved and whose
ranking policy differs. Do not invent a rounding rule or relabel current-product
output as recovered historical output.

If the prespecified comparison does not support a predictive advantage, retain
and report that result. Subsequent policy development belongs to a new separated
evaluation cycle; tuning on the holdout cannot retain an independent-validation
claim.

## Next coding actions

1. Complete historical execution contexts and explicit CI routing while
   preserving frozen hashes, receipts and all assertions. The completed fixed
   historical recipes are not a release-wide migration.
2. Apply the implemented confidence-file/coordinate binding to authenticated
   original prediction outputs under a separately frozen study. Keep the actual
   selection-set inventory and source/sample provenance separate from declarations.
3. Continue permitted metadata/Methods source resolution until the prospective
   evaluation has a defensible population and method identity. Retain failed
   attempts, ties, missingness and overlap decisions.
4. Execute the authorized prespecified comparison once its gates pass; report
   performance, uncertainty and failure modes.
5. Resolve exact public-source availability and finish current/historical CI
   before code freeze and release archiving.

**Predictive accuracy is unmeasured; independently cleared eligible groups: 0.**
No percentage, accuracy gain or submission date is inferred from this work.
Both PRs remain subject to their release and historical-replay blockers.

## Takeover correction: compute preparation is not independent validation

The quoted 92 jobs / 460 models belong to the explicitly development-only GPCR
review Boltz arm. They are not a ready independent ConfoVHH benchmark. The
[input audit](BOLTZ_INPUT_AUDIT_2026-09-09.md) identifies 13 protein sequences,
34 template sources and a shortest two-sequence, template-free development pilot.
The previously uploaded frozen-MSA archive was located by metadata, but two
retrieval attempts failed; no sequence-matched input recovery is claimed.

Reusing development-exposed receptors or adding seeds cannot create independent
biological groups. A mixed-only comparison changes the estimand and belongs in
a prespecified conditional analysis with every scheduled job retained. The new
selection-set component implements a primary comparison over all complete sets
and a clearly separated mixed secondary; it does not retrofit independence to
the old development panel. See [this continuation](PROGRESS_2026-09-09_TAKEOVER.md).
