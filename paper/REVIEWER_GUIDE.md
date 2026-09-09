# Reviewer reproduction guide

This guide separates a small offline software demonstration from reproduction
of the paper's retrospective results. The demonstration creates two arbitrary
alanine fragments. They are neither GPCRs nor VHHs and supply no biological
validation evidence. It does not read study structures, prediction outputs,
labels, or census artifacts.

## First executable check

Use Node.js 22.18 or newer, Git, and the revision supplied with the paper.
Dependency installation requires internet access; the demonstration itself does
not. Record the actual runtime and checked-out commit before generating the
examples. From the repository root:

```bash
node --version
git rev-parse HEAD
git status --short
npm ci
node scripts/paper/reviewer-demo.mjs --output=/tmp/confovhh-review-example
```

Choose a new output directory. The command refuses to overwrite an existing
one. It runs the production parser, interface analysis, and audit exporter on
generated inputs; checks contact counts against exhaustive distance enumeration;
checks that the separated fragments have no contacts; round-trips both reports
through the import validator; and requires a modified result to be rejected.
Assertions must pass and the command must exit with status zero.

The directory contains two clearly named synthetic PDB files, their JSON audit
reports, and `receipt.json`. The receipt records SHA-256 identities for the
inputs, outputs, library source, script, and dependency lockfile, plus the Node
version and check outcomes. Generated input/report bytes are deterministic;
source digests and the runtime version will change when their inputs change.
Keep the receipt with the exact checked-out revision. It is a software execution
record, not a substitute for a source release or archived study data.

The [8 September execution receipt](evidence/reviewer-demo-2026-09-08.json)
preserves the implementation-assisted run: 10 residue pairs and 90 atom contacts
for the near input, zero for the separated input, and successful round-trip and
tamper controls for both. It is not an independent researcher's completion.

For an interactive check, start `npm run dev` and load the generated files.
Use the [workflow task sheet](WORKFLOW_EVALUATION.md). This sheet is ready for
independent completion; no participant result is claimed. The tiny fragments
cannot validate antibody numbering or scientific interpretation.

The task exports **Single-pose audit JSON**. Keep these full reports; a Markdown
handoff or candidate CSV contains a different summary and cannot substitute for
them in the comparison below. The application's optional notebook stores entered
context and derived summaries in browser local storage across sessions. It does
not retain the raw coordinate and PAE files, and notebook saving is not required
for this task.

After downloading both browser reports, run the task sheet's
`verify-reviewer-exports.mjs` command. It validates source hashes, roles, policy,
missingness and every measurement against the regenerated synthetic reference;
only the export timestamp may differ. Keep its comparison receipt with the two
exports. Report agreement does not authenticate a participant or establish
independent completion.

The [preserved automated browser execution](evidence/reviewer-browser-2026-09-08/README.md)
exercises the task sheet through both downloads. It checks required role
confirmation, its reset after replacement, visible missing-evidence states,
and exact report agreement. This is an automated execution record; the
independent completion sheet remains unfilled.

To check the preserved exports without operating a browser, run:

```bash
node scripts/paper/verify-reviewer-exports.mjs \
  --example=paper/evidence/reviewer-browser-2026-09-08 \
  --near=paper/evidence/reviewer-browser-2026-09-08/browser-near.json \
  --separated=paper/evidence/reviewer-browser-2026-09-08/browser-separated.json
```

This regenerates the synthetic reference and validates the retained reports
against the current checkout. It does not repeat the recorded browser actions.
The preserved browser receipt hashes selected source files and the QA lockfile;
it explicitly does not attest the complete served build. A future submitted
release still needs its own source and execution identity. If source identities
no longer match, retain the failure and use the recorded revision or execute a
new workflow; do not update the historical receipt to force agreement.

## Broader software checks

```bash
node --test tests/paper-reviewer-demo.test.mjs tests/paper-reviewer-exports.test.mjs tests/paper-reviewer-browser-evidence.test.mjs
npm run test:release
```

The first command checks the synthetic demonstration, deterministic outputs,
export comparison and its rejection cases, and the preserved browser evidence.
It requires installed dependencies but no study inputs or network access.
The second is the existing repository release gate, including its
historical fixtures and evidence-contract checks. It is substantially broader
than this demonstration. Commit-specific CI also runs supported Node versions,
coverage, browser/accessibility checks, and a separately identified public
producer regression. These checks do not measure scientific efficacy.

The [optional Boltz parser smoke](../scripts/paper/boltz-parser-README.md) has a
separate Python environment and receipt. It does
not run model inference and does not validate the real prepared templates.

## What can be reproduced for the application paper

The existing [application manuscript](CONFO_VHH_WORKING_MANUSCRIPT.md) and its
linked evidence packages distinguish retained-summary replay from full
raw-to-result computation. This guide does not rerun either study analysis or
download the missing original archives. Full replay needs durable, permitted
access to the original coordinates and confidence data, pinned external
dependencies, and the exact study commands. Missing inputs must remain explicit;
synthetic files cannot replace them.

Before submission, bind this guide, software release, and application input
manifest to a stable archive, then record a reviewer's independent completion.
The [submission readiness record](SUBMISSION_READINESS.md) lists the remaining
availability and author requirements. The independent hard-decoy study retains
its separate eligibility, overlap, exposure, and freeze gates.
