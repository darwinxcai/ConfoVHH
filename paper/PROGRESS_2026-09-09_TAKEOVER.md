# Publication-quality takeover: source binding and selection boundaries

Starting point: PR #57 at `32a78f4d5f4c2d8ca52e99541bf5023b2d4915c7`,
stacked on PR #56. This continuation changes evaluation/replay tooling and
documentation. The product scoring rule, frozen studies, original receipts,
dependency lock, CI gates and biological eligibility decisions are unchanged.

## Implemented and executed

1. **Reported producer confidence now comes from supplied file bytes.**
   Fixed AF3/Boltz policies bind score field, direction and range; exact file
   size/SHA-256 and native pairing conventions are verified. Numeric overrides,
   duplicate JSON, mismatched files, malformed scores and internal multi-MODEL
   ambiguity reject. Missing scores stay missing. Actual coordinates feed the
   unchanged audit; ties remain intact. All-failed input has a distinct status.
2. **Prediction jobs have explicit selection boundaries.** The additive
   evaluator chooses within each set, then averages sets, conditions,
   generators, targets and declared groups. It preserves the complete declared
   inventory and failure reasons; missing jobs/attempts/outcomes cannot quietly
   disappear. All-positive/all-negative sets remain in primary accounting;
   mixed-only results are explicitly secondary and use retained primary weights.
   This version is descriptive, without uncertainty or a scheduled-job-yield
   estimate; it requires a complete crossed target/generator/condition design.
3. **Two historical synthetic recipes execute in the original environment.**
   The fixed runner binds 63 original files and exact test inventories, checks
   them before/after execution and preserves original assertions. Actual
   reviewer-export and audit-report-rank replay passed 1/1 and 11/11.
   This is not a live browser execution, independent-user study or full CI fix.
4. **The staged Boltz work was correctly identified.** The 92-job/460-model arm
   is the separate GPCR review development comparison. Its shortest existing
   no-template pilot needs two exact A3Ms plus runtime/checkpoint/cache pins;
   it does not require all 34 source templates. The prior MSA ZIP was located,
   but retrieval failed twice with HTTP 502. No archive contents were verified.

The [end-to-end generated control](evidence/source-bound-ranking-2026-09-09/README.md)
runs confidence files and actual toy coordinates through rank export and the
selection-set evaluator. It has four generated coordinate files, two artificial
jobs, one retained failed attempt and deliberately arbitrary opposite labels.
The expected aggregate is method 0.5, baseline 0.5, paired difference 0. These
are arithmetic controls, not biological performance measurements.

## Validation and limits

The combined current scope passes 71/71 tests on Node 24.19.0, including 41 new
tests. All 41 new tests also pass on Node 22.23.2 using the existing version-specific
WASM-inlining workaround. Scoped lint and project typecheck pass. The original
historical context separately passes 12/12 synthetic tests. Seven manuscript
claims still bind to 14 artifacts, with partial public reproducibility, four
unavailable inputs, zero independent eligible groups and target freeze prohibited.
See the [verification packet](evidence/takeover-verification-2026-09-09/README.md).

Two initially identified wrapper defects were fixed before final verification:
file-level confidence could otherwise be attached to one internal MODEL from a
multi-MODEL file, and all-failed input could be labeled completed ranking.
An initial unsanitized test invocation rejected ambient Node configuration;
the documented clean-environment invocation passed. No assertion was removed.

The full patched release/coverage/browser matrix has not been rerun or certified
by this scoped work. The original historical assertions still reject the patched
complete-lock identity when executed directly there; new historical recipes do
not change CI routing. The pinned Zenodo producer example remains unavailable.
This turn's web read was rejected by the tool, not a newly observed upstream
HTTP 403; the older 403 evidence is preserved. That regression example is not
the missing GPCR–VHH benchmark dataset.

## Remaining work we can do computationally

- Complete explicit historical/current CI routing without dropping current
  coverage; implement the remaining historical metadata recipes and restore
  the exact required public producer fixture.
- Assemble a defensible evaluation population with actual independent-component
  clearance, source/exposure/training-overlap accounting and a complete attempt
  schedule. The development Boltz arm cannot substitute for this population.
- Freeze the intended deployment scenario, template policy, current-product
  method and primary producer baseline, set boundaries, residue mapping and
  recovery-label rule, failure/retry rules and group-level inference plan.
- Recover and verify permitted MSAs and other inputs, pin a real inference
  environment, and execute a technical pilot before extrapolating time/cost.
- Preserve ranks before separate reference labels, execute all prespecified
  comparisons, report uncertainty/failures, and retain negative results.

**Independent pose-selection superiority remains unmeasured. Independent cleared
groups remain 0.** Software tests and reproducing historical toy receipts do not
show that ConfoVHH outperforms producer confidence, predicts affinity or identifies
experimentally functional binders. The coding/computational work is not finished;
these requirements are separate from authorship, recruitment and CRO work.
