# Nb20 has a documented named derivative

The retained, licensed 2026 primary construct paragraph (`Sec11.p0`) explicitly
describes Nb20* as a site-directed derivative of Nb20. This packet makes that
known relationship executable and reviewable. It does not complete the ancestry
review or change the frozen census/graph.

The [primary Methods](https://doi.org/10.1038/s41467-026-68339-x) specify two
sequence replacements. Their positions agree exactly with the source-reported
131-residue Nb20 sequence:

| Source region label | One-based source positions | Parent segment | Replacement |
| --- | --- | --- | --- |
| CDR1 | 30–35 | IGNIYI | GGAGAG |
| CDR2 | 54–62 | RTVRWTKYE | GAVGGAAAG |

These are the paper's labels and full-sequence positions, not new IMGT numbering.
Applying the stated replacements changes 13 positions while preserving length.
The derived sequence hash is an inference from the reported edits; it is not a
measurement or validation of an expressed reagent. The source's functional
description of Nb20* is not used as a binding result, benchmark label or score.

The recorded relationship must be considered when evaluating source-family
independence. It cannot establish that any deposited entity is Nb20*, resolve all
other parent/variant relationships, or certify a no-edge decision. Exact cryo-EM
receptor truncation and Nb20 tag/preparation links remain unresolved.

## Verification

`lineage.json` is regenerated from the existing exact primary paragraph, without
network access. The verifier checks the source identity, paragraph digest,
unique named relation, parent-sequence digest and each reported position.

```sh
node --test tests/hard-decoy-v3-mglyr-known-lineage.test.mjs
node scripts/hard-decoy-v3/review-mglyr-known-lineage.mjs --output=/tmp/new-nb20-lineage.json
```

Use a new output path. Tests reject source substitution, altered mutations,
changed parent bytes, missing/duplicate paragraphs, duplicate JSON keys and
invalid input encoding. File hashes demonstrate retained-byte consistency;
they do not authenticate execution, biological identity or source correctness.

## Additional public source route

[WO2024118636A1](https://patents.google.com/patent/WO2024118636A1/en) was accessible
through its public patent page. Its construct and production paragraphs corroborate
the named derivative and general C-terminal tag description. Its cryo-EM paragraph
still cites earlier preparation; it does not explicitly resolve the deposited
receptor truncation or Nb20 N-terminal prefix. This is corroboration from the same
research program, not an independent experiment.

`patent-access.json` records retrieval metadata and selected paragraph hashes.
The full response and paragraph text are not redistributed here. Consequently,
this is a bounded access/corroboration record, not a self-contained replay of the
patent. The lineage computation instead relies on the already-retained licensed
primary Methods. See `source-navigation-exposure.json` for search/snippet and
heading-navigation exposures during this continuation. No clean-blind status is
claimed; formal exposure adjudication remains required.

Independent eligible groups added: **0**. Predictive accuracy remains
**unmeasured**. No scoring policy, frozen input, prior exposure record, formal
disposition, eligibility decision or execution gate is changed.
