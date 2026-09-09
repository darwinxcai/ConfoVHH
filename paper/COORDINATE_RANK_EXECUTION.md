# Coordinate-executed current-product ranking

`scripts/paper/export-coordinate-ranks.mjs` executes the shipped coordinate
audit before ranking. The earlier report bridge checks supplied report bytes
and declarations without opening the coordinate file. This executor accepts
coordinate bytes and explicit selections, with no supplied audit features,
reports or biological outcomes.

This records a new current-product execution. It does not authenticate an earlier
prediction/report, implement the different frozen v3 scoring arm or measure
predictive performance. No ranking rule or frozen scientific file changes.

## Executed path

1. Snapshot the manifest and every eligible attempt's coordinate bytes; verify
   exact SHA-256, byte count and membership. Retain failed/ineligible attempts.
2. Parse the explicit PDB/mmCIF model with the production parser. Require
   distinct selected chains and a declared role confirmation. No assembly is
   inferred or reconstructed.
3. Execute `analyzeInterface` with confidence interpretation off, no PAE and
   the production canonical selected-geometry SASA frame.
4. Create production reports through the attested audit-export path; send their
   exact bytes through the existing report/ranking bridge.
5. Preserve scientific ties and within-target/generator baseline order. Any
   missing required producer score withholds the paired ranking array.

The receipt includes full report JSON strings, a report manifest, exact
coordinate/report bindings and `comparisonFields` for the paired evaluator.
Its method identity binds the current report pipeline, this executor, selected
installed immunum package/JS/WASM bytes and runtime version. Scientific module
resolution must match the recorded package. This is a bounded identity record,
not a complete executable/environment closure or a pre-outcome registration.
Timestamps identify the new execution and change on replay; input identities,
audit semantics and scientific ranks remain separately checkable.

## Input and execution

The schema is `confovhh-coordinate-rank-input-v1`, with exactly `schema`,
`studyId`, `generators`, `attempts` and `coordinates`. Generator and attempt
fields follow [the current-product adapter](CURRENT_PRODUCT_RANK_EXPORT.md).
Every eligible attempt has one coordinate descriptor:

| Field | Required value |
| --- | --- |
| `id` | Unique safe attempt ID |
| `format` | `pdb` or `mmcif` |
| `coordinateSha256`, `coordinateBytes` | Exact original file identity |
| `receptorChain`, `vhhChain` | Distinct explicitly selected chain IDs |
| `selectedModelId` | Explicit model ID, including `1` for a single model |
| `chainRolesConfirmed` | `true`, a supplied declaration, not biological verification |
| `producerScore` | Finite supplied score, or explicit `null` |

The directory must contain exactly `<id>.pdb` or `<id>.cif`, according to format.
Symlinks, unexpected files, duplicate JSON keys, unknown fields, output overwrite
and invalid UTF-8 reject. Limits are 200 files, 8 MB each, 64 MB total and 12,000
parsed protein heavy atoms per file, plus production geometry work budgets.
Exceeding a limit fails instead of silently truncating or excluding a model.

Use explicitly authorized inputs and a new output path. Start without ambient
`NODE_OPTIONS` or `NODE_PATH`; on a POSIX shell:

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/paper/export-coordinate-ranks.mjs \
  --input=MANIFEST.json --coordinates=AUTHORIZED_DIRECTORY --output=NEW_RECEIPT.json
env -u NODE_OPTIONS -u NODE_PATH node --test tests/coordinate-rank-export.test.mjs
```

The [retained synthetic example](evidence/coordinate-rank-execution-2026-09-09/README.md)
uses generated alanine fragments only. Tests cover contact/no-contact controls,
PDB/mmCIF and model selection, altered coordinates, missingness, mutable caller
buffers, filesystem boundaries and downstream report replay. They establish no
GPCR–VHH performance result.

## Remaining predictive requirements

Biological chain identity, source eligibility, independent grouping, complete
prospective attempt accounting, producer-score provenance, pre-label chronology
and authorized reference outcomes remain separate requirements. Supplied
`eligible` and `groupId` fields are declarations, not clearance by this utility.
The executor reads no outcome labels and cannot turn a favorable geometry flag
into an affinity, binding or native-pose probability. Independent eligible groups
remain zero; predictive accuracy remains unmeasured.
