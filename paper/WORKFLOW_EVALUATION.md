# Reviewer task: synthetic input to auditable export

This task evaluates **software mechanics only**. The two generated inputs are
arbitrary four-alanine fragments with chains named R and V. They are neither
GPCRs nor VHHs, experimental structures, or predictions. Assigning R and V to
the application's receptor/VHH fields exercises role handling; it does not
establish biological identity. No binding, numbering, ranking, or research-use
claim follows from completion.

## Preparation

Use one recorded repository revision and the installation instructions in
[README.md](../README.md). From the repository root, generate the examples into
a new directory:

```bash
node scripts/paper/reviewer-demo.mjs --output=/tmp/confovhh-review-example
npm run dev
```

The generator refuses an existing output directory; choose another new path
for a repeat. It creates `synthetic-near.pdb`, `synthetic-separated.pdb`, their
`.audit.json` reports, and `receipt.json`. Generation reads local implementation
files and uses no network or research dataset. Dependency installation may
require network access. Open the local application address printed by the
development server. File analysis runs in the browser; do not select private
inputs for this exercise. Reports contain derived measurements and provenance,
so inspect them before sharing.

## Task sequence

1. Load `synthetic-near.pdb` through the single-coordinate-file path. Check that
   two chains, R and V, are present, each with four residues. The input contains
   32 atoms altogether. Record any discrepancy before proceeding.
2. Select R as **Receptor chain** and V as **VHH chain**. Set **B-factor
   interpretation** to **Do not interpret as pLDDT**. Leave PAE unattached. Check
   that **Run interface audit** is unavailable before confirming roles. Then
   confirm the deliberately assigned software roles and run the audit.
3. Locate the contact count and missing-PAE state. No valid VHH numbering or
   antibody-loop identity should be inferred from these alanine fragments.
   Export **Single-pose audit JSON**.
4. Use **Replace coordinate** to load `synthetic-separated.pdb`. Confirm that
   the earlier audit is cleared and the role-confirmation checkbox is reset,
   then repeat the audit and export steps. The near case must have contacts;
   the separated case must have zero contact pairs. Both must retain absent
   PAE, rather than reporting zero uncertainty.
5. Compare each browser export with its generated audit JSON and receipt.
   Match `structure.sourceFileSha256` to the corresponding case's
   `coordinateSha256`, confirm the selected chains, and compare
   `audit.contactPairCount` with the receipt's `residuePairs`. Verify `pae` is
   null and `auditPolicy.pae` is `omitted`. Compare software version and policy
   fields with the generated report. Export timestamps can differ; do not
   require browser and generated JSON files to have identical whole-file hashes.

Use the offline comparison command after saving both browser exports:

```bash
node scripts/paper/verify-reviewer-exports.mjs \
  --example=/tmp/confovhh-review-example \
  --near=/path/to/near-browser-export.json \
  --separated=/path/to/separated-browser-export.json \
  --output=/tmp/confovhh-review-comparison.json
```

Choose a new output filename. The command refuses to overwrite existing files.
It validates both browser reports with the production importer, checks the
generator receipt against the current library, generator and dependency-lock
hashes, and regenerates the synthetic reference locally. All report fields must
match the corresponding reference except `generatedAt`; JSON whitespace and
object-key order may differ. Source identities, role assignments, fixed policy,
counts, other measurements and absent PAE remain exact requirements. Keep the
generated reports unchanged, even their formatting, because their byte hashes
are bound to the generator receipt. Use the same source revision as generation;
if it has changed, preserve the earlier package and repeat in a new directory.

A successful command writes a comparison receipt with hashes of both submitted
exports. This verifies report agreement only. It cannot distinguish a browser
export from a copied generated report, identify the participant, observe the
role-confirmation gate or establish independent completion. Record those
observations separately below. No scientific or biological validation follows.

The receipt records a successful export round trip and rejection of a report
whose contact count was altered. These are generator checks, not observations
of the participant's actions. Unexpected contacts in the separated case,
invented PAE, mismatched input hashes, or auditing without role confirmation are
failures to preserve and report. Do not repair an output to make it agree.

## Completion and feedback record

Leave unperformed steps blank. Retain both browser exports with this record.

| Field | Participant entry |
|---|---|
| Participant / relationship to implementation | |
| Date; repository commit | |
| Node version; browser and operating system | |
| Generator command and output directory | |
| Steps completed independently | |
| Role-confirmation gate observed | |
| Near/separated counts matched receipt | |
| Missing PAE and provenance matched | |
| Export comparison command and receipt path | |
| Failure messages or unexpected behavior | |
| Assistance required; confusing instructions | |
| Suggested improvement | |

Completion demonstrates reproducible software operations on synthetic inputs.
Genuine research-use evidence still requires a later domain-scientist task
using an explicitly designated public development input, with its scope and
interpretation documented separately. No external invitation is sent by this
task sheet.
