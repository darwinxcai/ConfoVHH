# Reviewer reproduction guide

This guide separates a small offline software demonstration from reproduction
of the paper's retrospective results. The demonstration creates two arbitrary
alanine fragments. They are neither GPCRs nor VHHs and supply no biological
validation evidence. It does not read study structures, prediction outputs,
labels, or census artifacts.

## First executable check

Use Node.js 22.18 or newer, Git, and the revision supplied with the paper.
Dependency installation requires internet access; the demonstration itself does
not. From the repository root:

```bash
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

## Broader software checks

```bash
node --test tests/paper-reviewer-demo.test.mjs
npm run test:release
```

The first command repeats the synthetic demonstration and checks deterministic
outputs. The second is the existing repository release gate, including its
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
