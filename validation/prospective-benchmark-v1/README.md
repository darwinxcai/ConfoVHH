# Prospective benchmark preparation

**The target-general evaluator is implemented and tested. Independent generation is blocked: no group currently qualifies.** The five scoring methods remain unchanged; 3P0G is used only as an already-exposed regression case. No new candidate outcome, native pose or prediction was inspected, and no GPU was allocated.

## Delivered implementation

- `scripts/benchmark/evaluator.py score`: reads only prediction inputs and hash-bound Boltz mmCIF/confidence files; recomputes frozen geometry and all five methods for arbitrary targets within the declared input contract. No reference argument or supplied-score override.
- `scripts/benchmark/dockq-outcomes.py`: separate reference stage with explicit chain mapping, raw logs, failure preservation and first-candidate API/CLI crosscheck per target.
- `scripts/benchmark/evaluator.py evaluate`: binds outcomes to saved score receipts; retains all attempts, scientific ties, missing data and abstentions; computes target/group comparisons and the prespecified four-comparison analysis.
- [Full protocol](PROTOCOL.md), [engine/dependency lock](engine-lock.json), [generation defaults](generation-policy.json), [test receipt](test-validation.json) and [unchanged 3P0G regression receipt](exposed-regression-verification.json).

Twenty-eight relevant tests pass: 13 general evaluator tests, seven unchanged-method tests and eight original pilot-evidence tests. Tests cover actual synthetic coordinate execution, roles/sequences, atom order, altered files, unsupported models/alternate locations/occupancies, path safety, missing confidence, failed attempts, all-failed targets, scientific ties, missing outcomes, group weighting, Holm correction and synthetic DockQ API/CLI agreement. All ten 3P0G feature records and all fifty scientific keys/ranks reproduce exactly. The original 311-artifact negative-result package still verifies unchanged. A synthetic DockQ adapter field-name error was diagnosed and corrected; its failed log remains in `implementation-test-history/`.

This is general across targets **within the pinned Boltz output contract**, not an arbitrary-format docking suite. Multi-model/partial/noncanonical inputs are explicit failures. Missing features never trigger a formula change or favorable subset selection. “Supported” remains a historical geometric warning tier, not pose correctness.

## Actual inventory and exposure

| Inventory category | Count |
|---|---:|
| Retained discovery identifiers plus explicit controls | 17,735 |
| Curated entries reconciled here | 348 |
| Curated entries excluded | 78 |
| Curated entries still blocked | 270 |
| Remaining unreviewed discovery identifiers | 17,387 |
| Prior native/legacy development references | 19 |
| Prior assembly-parser controls | 4 |
| Entries with recorded prose-exposure review requirements | 31 |
| Provisional relatedness components | 57 |
| **Certified independent groups / eligible targets** | **0 / 0** |

Exposure categories overlap and must not be added. The 57 components include development entries and controls and are **not 57 independent groups**. Metadata-capture membership is listed for 8,471 identifiers, not a claim that 8,471 entries have completed role or eligibility review. These are retained metadata snapshots through 9 September 2026, not an exhaustive fresh literature/database search. The number of independent groups that could eventually be recovered is unknown, not zero by proof.

The [complete ledger](inventory/discovery-and-eligibility-ledger.csv) retains every identifier. The [curated inventory](inventory/curated-target-inventory.json) supplies per-entry reasons, receptor/nanobody sequence groups, combined relatedness groups, prior dispositions and exposure provenance. [Groups](inventory/relatedness-groups.json), [links](inventory/relatedness-links.json), [prior exposure registry](inventory/prior-exposure-registry.json) and [input hashes](inventory/source-bindings.json) make the reconciliation inspectable. Unknown direct-binding roles and missing ancestry evidence remain blocked. Possible VHH sequence links do not become assertions of a biological lineage.

The original seven-family frontier is not a cleared sample:

| Candidate family / representatives | Remaining exclusion or blocker |
|---|---|
| GPR158 — 9VOR/9VOS | Prior source-family exposure; unresolved exact receptor/Nb20 preparation/construct attribution and reference suitability; known Nb20/Nb20* ancestry must remain grouped |
| LGR4 — 9S37 and related entries | Prior structural-prose exposure; direct binder versus helper identity, construct and complete family/lineage certification still required |
| CaSR — 7E6U | Excluded by the declared <=4 Å reference-resolution gate; retained deposition is 6 Å |
| mGlu — 7E9G/8TAO and related entries | One related family, not separate independent cases; prior mGlu source exposure and incomplete ancestry/construct/no-edge certification |
| ADGRV1 — 9FTE | Recorded contact/prediction-prose exposure and unresolved source/construct reconciliation; historical “unpublished” notes are not a current publication claim |
| DRD1 — 8JXS | Excluded by the already documented primary receptor-sequence edge to development adrenergic receptors |
| MC4R — 8QJ2 | Engineered beta2AR-related graft and auxiliary binder/role/construct concerns prevent independent clearance |

## Freeze and exact remaining blockers

The preparation freeze binds the implementation, unchanged formulas, dependencies, complete retained inventory, provisional group snapshot, fixed generation defaults, four primary comparisons, tie/failure policy, analysis plan and feasibility record. It explicitly marks the **runnable prospective study as unsealed**, with empty eligible target/group sets. An empty target set is not a successful benchmark freeze.

1. **Eligibility/exposure:** no curated entry has a complete independent-eligibility certificate. Resolve the entry-specific exclusions and remaining binding-role, construct, source-quality and prior-exposure decisions; complete a bounded discovery/sampling frame without using outcomes.
2. **Independence:** close receptor/VHH/source-family and known-parent review, including missing profiles and uncertain roles. Existing threshold pregraphs and absence of matches cannot certify no edge. Final independent groups therefore cannot yet be sealed.
3. **Target-specific artifacts:** exact prediction sequences/chemical identities, locally captured MSAs, reference identity/assembly/mapping adjudication, and all ten planned attempts for each eligible target do not exist as a sealed general benchmark bundle. No performance-based cropping or MSA rescue is permitted.
4. **Sample feasibility:** actual G=0 supports no prospective accuracy or superiority estimate. The required sample must come from certified inventory, not seeds, poses, provisional families or metadata rows. Under the stated assumptions, even seven all-winning groups is only a mathematical significance floor. Sensitivity planning requires 24–104 independent groups for 80% per-comparison power at assumed strict-win probabilities of 0.80–0.65; these are required counts, not available targets or estimates from 3P0G. [Exact feasibility record](feasibility-and-compute.json).
5. **Execution resources:** a deployable compiler/environment/checkpoint/cache artifact, target-size budget, fresh allocation quote, and general launch/controller bundle must be verified before spending. The original runtime and full JIT checks remain mandatory. The controller must enforce a cumulative deadline independently of this chat and reserve verified backup/shutdown time. No allocation has been requested.

## Compute estimate before generation

The actual execution03 generation receipt reports 1,401.4826 seconds (23m21s) for the exposed 501+126-residue complex. This is a sizing reference, not a universal runtime. The live Runpod catalog returned **$1.59/hour** for one A100 PCIe 80 GB in Secure Cloud, with low availability; [quote and timestamp](a100-catalog-quote.json).

For a comparable complex using a reusable environment, provisionally allow 25–40 minutes inference, 5–10 minutes resume/runtime/JIT checks, and 10–15 minutes verified backup/shutdown: **40–65 GPU minutes, about $1.06–$1.72 GPU-only per standalone case**. CPU MSA preparation, storage/transfer, cache recovery and longer constructs are additional, currently unquantified items. For T comparable cleared targets sharing a pod, the rough batch range is `25T+15` to `40T+25` GPU minutes, before any recovery. Refresh the actual quote and size-dependent budget before allocation.

**Current proposed allocation: 0 GPU hours and $0 new compute**, because T=0. The former pilot's payments and time are historical usage, not a new benchmark allowance.

## Honest alternative

Use an explicitly **retrospective, exposure-aware development/structural-audit evaluation**, with the five methods fixed. The legacy recovery inventory lists 355 coordinate records as present-but-unverified and 105 missing across six reference IDs. Compatible records need checksum, binding-role, confidence and reference-mapping verification before use; they are not 355 independent cases or verified modern DockQ measurements. Preserve all losses and exclusions. Keep the existing 3P0G result unchanged.

A narrower prospective audit-utility study could evaluate provenance reconstruction, warning accuracy and user interpretation against independent ground truth. It needs a predeclared task/sample design and utility evidence; it cannot substitute for held-out pose-selection performance. No alternative evaluation has been started here.

## Reproduction

Use the locked CPU environment and Node 24.19.0. From the repository root:

```sh
BENCHMARK_NODE=/path/to/node python -m unittest discover -s tests -p test_prospective_benchmark.py
python scripts/benchmark/verify-preparation.py
python scripts/benchmark/evaluator.py score --plan validation/prospective-benchmark-v1/exposed-regression-plan.json --artifacts . --node /path/to/node --output /tmp/new-exposed-regression
```

The score stage has no outcome argument. Reference evaluation and outcome joining are separate CLI commands documented by `--help`; their manifest must bind the saved score receipt. Do not run them on new targets before the target-specific seal. Existing outputs are not overwritten. The inventory builder also refuses an existing inventory directory; replay it in a separate checkout after preserving/removing only that generated directory.

Source attribution: retained RCSB/wwPDB metadata (CC0) and GPCRdb data (CC-BY-4.0); we acknowledge the use of [GPCRdb](https://www.gpcrdb.org). Exact upstream source and license records remain in the historical metadata packages. New groupings are conservative review aids, not biological lineage or independence certificates.
