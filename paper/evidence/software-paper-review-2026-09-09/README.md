# Software-paper documentation review, 9 September 2026

This implementation-assisted review began at source revision
`3df9d9573cbbb73d749d2b3315f396fbec7fe52a`. It checks software descriptions and
reviewer instructions, not biological performance. Existing aggregate
development-result prose was visible in the assigned documents and supporting
documentation; this was not a blinded scientific evaluation. No original
prediction/native coordinates or outcome ledgers were opened. Quantitative
application claims and the claim/evidence manifest were not changed.

## Material corrections

| Finding | Revision and implementation basis |
|---|---|
| The draft grouped JSON, CSV and Markdown exports without explaining their different content | Clarified that canonical audit JSON is needed for replay; candidate shortlist CSV summarizes rows, while Markdown rounds displayed measurements. Checked `createCandidateShortlistReport` / `candidateShortlistToCsv` in `lib/candidate-shortlist.ts`, and `createHandoffMarkdown` / `parseWorkspaceBundle` in `lib/research-workspace.ts` |
| Local processing did not describe persistence of explicitly saved notebook entries | Added that entered context and derived summaries persist in browser local storage, whereas raw coordinates and PAE do not. Checked `saveNotebookSummary`, `persistNotebook` and `clearNotebook` in `app/page.tsx` |
| Import integrity could be mistaken for authentication or raw-coordinate recomputation | Stated that report import checks structure and internal consistency; it does not authenticate authors or recompute a report from original coordinates. Checked `validateImportedSingleAuditReport` in `lib/research-workspace.ts` |
| The reviewer guide did not give a direct preserved-export replay command or the complete served-build limitation | Added the executable comparison command, runtime/commit recording, JSON-format requirement and historical-receipt preservation instruction. Linked the existing browser evidence, which explicitly does not attest complete served-build identity |

The methods supplement and participant task sheet were reviewed and left
unchanged. No product algorithm, threshold, export format, test, participant
record, freeze decision or historical receipt was modified.

## Validation performed

Using the existing installed dependencies and Node `v24.19.0`:

```bash
node --test tests/paper-reviewer-demo.test.mjs tests/paper-reviewer-exports.test.mjs tests/paper-reviewer-browser-evidence.test.mjs
node scripts/paper/verify-reviewer-exports.mjs \
  --example=paper/evidence/reviewer-browser-2026-09-08 \
  --near=paper/evidence/reviewer-browser-2026-09-08/browser-near.json \
  --separated=paper/evidence/reviewer-browser-2026-09-08/browser-separated.json
git diff --check
```

All nine scoped tests passed, the preserved-export comparison exited zero with
source identities matching the checkout, and whitespace validation passed.
The comparison regenerates synthetic references and checks retained exports;
no new interactive browser run, clean dependency installation, full release
gate or independent researcher completion was performed by this review.

The inspected implementation identities were:

| File | SHA-256 |
|---|---|
| `app/page.tsx` | `005b623058d702b60a29ff08edefc1aa78710a74918984b9ceda1abc72c5e7e7` |
| `lib/audit-export.ts` | `5215a292d4f59cb0b0423f2eae725c8d3db6ca326e6cfe7ea34ad27d35e2e7db` |
| `lib/candidate-shortlist.ts` | `bc4f378baea03582dadcb38d03436b805c4f1fe353c188bdcd24dbf096468f07` |
| `lib/research-workspace.ts` | `bbf0b01cd5450658079b286b14a8728b68e743517a98d13307732000fbe0d415` |
| `scripts/paper/reviewer-demo.mjs` | `6d27b66bae273d13a7c45603205cf6f319592cdacff3879d4133c95b13155741` |
| `scripts/paper/verify-reviewer-exports.mjs` | `9e6599fddca26ae15a315aa2b6f499f704ec7b13a180bcc74d973cb6895516f0` |

## Remaining manuscript blockers

Original retained input availability and redistribution terms, independent
researcher use, confirmed authorship/disclosures, venue requirements and an
archived reviewed release remain unresolved here. The software/application
paper is still not submission-ready. This review adds no eligible independent
group and supplies no predictive-accuracy measurement. It does not rerun or
certify the separate source-availability or hosted release gates.
