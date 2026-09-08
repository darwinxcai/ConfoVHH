# Independent evaluation records

One JSON file per participant who completes
[the workflow task sheet](../../WORKFLOW_EVALUATION.md). Name the file for the
participant and the date, for example `2026-10-02-a-nguyen.json`. Nothing in
this directory may be written on a participant's behalf.

`scripts/paper/submission-status.mjs` counts a record toward the submission
gates only when `relationshipToImplementation` is exactly `independent` and
`outcome` is exactly `completed`. A partial or failed attempt is still worth
retaining: it is evidence about the software, and the manuscript should report
it rather than discard it.

```json
{
  "schemaVersion": "confovhh-independent-evaluation-1.0.0",
  "participant": "Name, or an agreed pseudonym if the participant prefers one",
  "relationshipToImplementation": "independent",
  "completedOn": "2026-10-02",
  "repositoryCommit": "the exact commit the participant checked out",
  "environment": "Node version, browser, operating system",
  "stepsCompleted": [1, 2, 3, 4, 5],
  "outcome": "completed",
  "roleConfirmationGateObserved": true,
  "countsMatchedReceipt": true,
  "missingPaePreserved": true,
  "failuresObserved": "Verbatim, including anything the participant found confusing",
  "assistanceRequired": "What they had to ask about, or none",
  "suggestedImprovement": "Their words, not a paraphrase",
  "exportsRetainedAt": "where the participant's two browser exports are kept"
}
```

`relationshipToImplementation` must be one of `independent`,
`contributor`, or `implementation`. Only `independent` means the person did not
write, review, or advise on the ConfoVHH code being evaluated. Record the honest
value: a contributor's run is a useful smoke test and a dishonest independence
claim is a retraction risk.
