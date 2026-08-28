# Contributing to ConfoVHH

ConfoVHH welcomes focused bug reports, reproducible parser fixtures, validation cases, documentation corrections, and narrowly scoped pull requests.

## Before opening an issue

- Confirm that no unpublished, proprietary, patient-derived, or credential-bearing data are attached.
- Record the ConfoVHH product and engine versions shown in the application header.
- State the coordinate format, prediction producer, browser/Node version, and exact error message.
- Reduce structural examples to a public PDB entry or a minimal synthetic fixture whenever possible.

## Development setup

```bash
npm ci
npm run lint
npm test
```

The ordinary suite must pass before a pull request is opened. Scientific-core changes should add an independent oracle, adversarial boundary case, or public regression fixture; increasing the test count alone is not validation.

## Scientific claims

Pull requests must preserve the distinction between coordinate evidence and biological evidence. Do not describe geometry, PAE, recurrence, ΔSASA, or an evidence band as proof of binding, affinity, state selectivity, signaling, developability, or membrane compatibility.

## Data and privacy

Do not commit private prediction outputs or unpublished laboratory structures. Public structural fixtures should include source accession, retrieval date, and checksum where applicable.
