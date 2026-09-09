# Coordinate ranking with original confidence-file extraction

`scripts/paper/export-source-bound-coordinate-ranks.mjs` adds a fixed confidence
file reader before the existing coordinate-to-rank executor. A caller can no
longer supply the numeric baseline score or its direction through this input
schema. The selected producer field is read from exact SHA-256/size-verified
JSON bytes, then actual coordinate bytes are audited with the unchanged product.

This is implemented and tested on generated examples. It is not an independent
predictive result or authentication of an original prediction run.

## Supported reported scores

| Extractor | Reported JSON field | Direction | Accepted range |
| --- | --- | --- | --- |
| `af3-ranking-score-v1` | `ranking_score` | Higher is better | -100 to 1.5 |
| `af3-iptm-v1` | `iptm` | Higher is better | 0 to 1 |
| `boltz-confidence-score-v1` | `confidence_score` | Higher is better | 0 to 1 |
| `boltz-iptm-v1` | `iptm` | Higher is better | 0 to 1 |

The field semantics and native filename conventions follow the official
[AlphaFold 3 output documentation](https://github.com/google-deepmind/alphafold3/blob/main/docs/output.md)
and [Boltz prediction documentation](https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md),
checked on 9 September 2026. Extractor versions identify this fixed parser policy;
they do not establish the version that produced an input file. Scores are read
as reported, without reconstructing them from components. Whole-complex scores
are not receptor–VHH-specific uncertainty or probabilities of experimental binding.

AF3 native local `<stem>_model.cif` pairs with
`<stem>_summary_confidences.json`; Boltz `<stem>_model_<n>.cif` or `.pdb`
pairs with `confidence_<stem>_model_<n>.json`. Each pair must share its actual
relative directory in CLI execution. AF3 Server exports, renamed files,
ColabFold ranking files, pair-specific confidence matrices and affinity fields
need their own supported policies; they are not inferred here.

## Contract and execution

Schema `confovhh-source-bound-coordinate-input-v1` contains exactly:

- `studyId` and `schema`.
- `generators`: `{id, extractor}` records. One prespecified extractor per generator.
- `attempts`: the existing `{id, groupId, targetId, generatorId, status, reason}` inventory.
- `coordinates`: the existing coordinate descriptors, **without** `producerScore`.
- `scoreSources`: `{id, extractor, coordinatePath, coordinateSha256, source}`.
  `source` is `null` for declared absence, otherwise `{path, sha256, bytes}`.

Every eligible attempt requires a coordinate and an explicit score-source status.
Failed/ineligible attempts remain in the inventory. Missing file, missing field,
null field and numeric zero remain distinct. Any unavailable eligible score
withholds paired rankings; the method audits and missingness record remain.
Malformed data, duplicate keys, wrong hashes, model/filename mismatches,
unknown fields and manual score overrides reject.
Coordinate files must contain exactly one MODEL: a file-level confidence cannot
be assigned to an arbitrary member of an internal ensemble. An all-failed
population reports `no-eligible-candidates`, rather than completed ranking.

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/paper/export-source-bound-coordinate-ranks.mjs \
  --input=MANIFEST.json --artifacts=AUTHORIZED_DIRECTORY --output=NEW_RECEIPT.json
```

The directory must contain exactly the declared artifacts at their relative
paths. Symlinks, traversal and output overwrite reject. Up to 200 coordinate
attempts and 200 score files are supported; confidence files are limited to
1 MB each/16 MB total and CLI input artifacts to 64 MB combined, in addition to
the existing coordinate-audit limits. Large studies should preserve complete
selection sets when staging batches, then combine them through a declared study
inventory. The exporter does not certify that this inventory is complete.

The receipt preserves the nested coordinate execution unchanged, the exact
confidence JSON text, file bindings, fixed extraction policy, source hashes,
missingness and comparison fields. Its new baseline identity includes extraction
code and policy. Lower-level receipts still correctly state that their own code
did not verify confidence sources; the enclosing receipt records the added step.

## Interpretation and remaining work

Matching filenames and hashes identify supplied bytes and enforce a pairing
convention. They do not prove those files originated from the same historical
prediction run. Original run inputs, runtime/checkpoints, output completeness,
chronology and model/sample membership need separate evidence.

The old exporter orders rows within target/generator. To answer a per-job
selection question, restrict those rank tiers to each **predeclared selection
set before selecting its top tier**. The separate
[selection-set evaluator](SELECTION_SET_EVALUATION.md) implements that boundary;
selecting from the union of several jobs would answer a different question.
Restriction preserves within-set relative ordering and scientific ties; it does
not justify pooling the outcomes or counting jobs as independent targets.

The source-bound path does not recover the distinct frozen-v3 engine, clear
independent targets, determine reference-derived labels or demonstrate superiority.
The next scientific execution still requires a defensible population, complete
job schedule, pinned runtime/input provenance and a frozen outcome/analysis plan.
