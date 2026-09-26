# Portable round4 scientific evidence

These tools are prepared with synthetic fixtures. They must not build a final
archive or open the new outcome tables until the root agent has completed the
scientific phases, reporting releases and reports and authored the final map.
No map template is an authorization. No private backup, credential, cloud action,
or new production outcome was used to implement the archive tools.

The root-level `ROUND4-FINAL-ARTIFACT-MAP.json` has schema
`confovhh-round4-final-artifact-map-v1` and exactly these fields. Every binding
means `{path,bytes,sha256}` with a canonical execution-root-relative path, an
integer byte count and SHA256. The base ZIP is the only external payload binding;
every other bound scientific file must be an archive manifest member.

| Field | Required contents |
| --- | --- |
| `status`, `authorizeArchive`, `artifactsQuiescent` | `COMPLETE`, `true`, `true`, issued only by root after the artifact tree stops changing |
| `baseArchive` | Binding of `confovhh-source-first-ranking-v3.zip`, SHA256 `707e21e7668e8f0e2fced4c594c508a61f0e6d950e2cbcd52988a815ec0999f0` |
| `archiveImplementationFreeze` | Binding of `round4-archive/IMPLEMENTATION-FREEZE.json`; exact six-file method roster plus the two mandatory pinned reporting/capture freezes |
| `development` | `planned:900`, `cohort`, `sourceRankingReceipt`, `outcomeReceipt` |
| `reserved` | `planned:75` or `100`, plus the same three bindings |
| `initialDevelopment` | `planned:300`, authoritative v2 `fitReceipt` and `independentFitReceipt` |
| `combinedDevelopment` | `planned:1200`, `status`, `joinReceipt`, `fitReceipt`, `independentFitReceipt`, `incompleteDisposition` |
| `reservedCapture` | Canonical `bundleRoot`, `outputRoot`, and binding `completeReceipt` for the exact successful v2 capture |
| `reporting` | Bindings `selectionReceipt`, `reservedSummaryReceipt`, `finalPolicy`, and `reports` containing exactly `REPORT-V4.md` and `V4_REPLAY.md` |
| `scientificClaims` | Exactly `independentGeneralizationEstablished:false` and `productionPromotion:false` |

For a complete combined fit, its status is `COMPLETE_FIT`, both fit bindings are
present, and `incompleteDisposition` is null. For unavailable produced labels,
status is `INCOMPLETE_GENERATED_OUTCOMES`, both fit bindings are null, and the
disposition binds the separately root-authorized source-only `selection.json`.
That record must be an output of the reporting helper's distinct incomplete
selection receipt and retain every missing ID and reason. It cannot claim a
completed combined fit or that source won a comparison. Both branches retain all
1200 development attempts. The generation-arm choice still follows its separately
frozen gate. Reserved summary `NEEDS_ATTENTION` is a completed report with explicit
missingness, not a declaration that all produced outcomes became available.

The builder rejects nonterminal source attempts, snapshots, wrong denominators,
missing phase receipts, crossbound cohorts/reports, unfinished report placeholders
and incomplete method rosters. Reporting APIs subsequently provide stronger
scientific authentication and exact arithmetic replay. The root authorization is
an explicit trust boundary; these local receipts are hash bindings, not digital
signatures or an independent identity service.

Before importing replay helpers, the archive method checks the exact reporting
freeze SHA256 `7d391c58dae4f4275f73b9e381c3b84b4a4d161eff56ffe0e49dd0e0280ee552`
and v2 capture preparation freeze SHA256
`5db9c0712580994d9101796347e9d7ab8dff9571094052711a25d5f98e06a3a9`.
Their declared executable files and nested reporting method bindings are
reopened. A changed helper or a newly self-declared dependency freeze is refused.

All finite round4 scientific directories are selected: planning, benchmark,
generation, reserved preparation/generation/review, cloud metadata, predictions,
outcomes, ranking, analysis, reporting and these archive tools. The three final
root files above are added. The entire prior v3 member payload is copied byte for
byte, including prior negative results, receipts, native references and frozen
dependencies. New raw coordinates and confidence/PAE/PDE arrays, processed MSAs,
attempt ledgers, canonical views/maps, source/challenger ranks, outcomes,
grouping/exposure evidence, fit outputs, decisions, reports and code remain in
the selected trees. Selected membership and every file hash are checked before
copying and again before finalization.

Private SSH keys, host-key files, private-volume-backups, Git/Python caches,
incomplete transfers, downloaded model caches, portable runtime archives and
redundant transport ZIP/tar files are excluded. Hash receipts for separately
preserved transport/runtime artifacts remain. Authenticated raw MSA server
`out.tar.gz` replies are kept because capture replay binds their bytes. No whole
home/host scan is used. Every selected new binary/text file is scanned for common
credential forms without printing matching contents. Only CSV/A3M sequence
fields whose exact bytes occur in public sequence/MSA capture provenance may
skip the ambiguous AWS-key-ID pattern. Headers, CSV keys, arbitrary files and all
other credential patterns retain full scanning. One unchanged independent test
source also retains its deliberate all-A dummy key identifier: the exception
requires its exact path suffix, 2,970 bytes, SHA256, and sole matching dummy
value. Editing that file, appending a credential, moving its bytes to another
path, or supplying a forged identity cannot use the exception. This packaging
correction preserves the original test and scientific evidence unchanged.
The manifest separately records both public-MSA and reviewed-test exceptions;
fresh extraction rescans and compares both rosters.

Run only after final root authorization, with all logs outside selected trees:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python round4-archive/build_evidence.py > round4-archive-build.log 2>&1
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python round4-archive/verify_archive.py > round4-archive-verify.log 2>&1
```

The ZIP, `round4-archive-receipt.json`, replay log and verification receipt are
root-level outputs. A failed `.part` file is preserved; it is never silently
overwritten or announced as finished. Archive verification extracts to a new
temporary execution root, rejects duplicate/case-colliding/escaping names,
symlinks and special members, checks exact manifest membership and hashes, and
checks that all phase bindings refer to extracted manifest members. When the
original base ZIP remains on the verifier host, its original members are also
independently compared against the archived historical payload inventory.

Replay imports only the extracted implementations and scientific inputs. An
isolated Python child has a clean environment, no bytecode writes, an audit hook
denying original scientific artifact reads and network access, and only a
guarded Node child is permitted. Node runs its native permission system with
filesystem access limited to the fresh extraction. Installed pinned Python
packages and the Node executable are reused as runtime dependencies. This is a
guard against accidental fallback to live scientific inputs, not a claim to
sandbox arbitrary hostile native extensions. Synthetic controls exercise both
Python and Node rejection paths.

Scientific replay performs exact source/contact feature and rank verification,
raw/canonical conservation checks, fixed per-segment sequence correspondence,
all-view aggregation of the saved DockQ values, the old300/new900 development
join, independent saved-model/fold/grid/metric arithmetic, generation comparison,
selection and reserved summary/report replay. The independent model audit uses
its frozen numerical tolerances; report bytes must match exactly. Capture replay
checks exact queries/full contexts, all captured file hashes and absence of
templates/restraints/native coordinates. No prediction or network request is
made. The verifier explicitly records `numericalDockQRecomputed:false`: production
DockQ numerical functions are not rerun by this archive workflow.

Synthetic controls run with:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover -s round4-archive -p test_archive.py -v
```

The final implementation freeze will be written only after the bounded code
review and contract tests are complete. Building or testing these tools alone
does not establish completion of any actual scientific phase or private backup.
