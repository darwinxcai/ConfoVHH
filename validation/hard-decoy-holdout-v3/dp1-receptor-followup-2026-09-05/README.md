# DP1 canonical receptor follow-up, 5 September 2026

This follows PR #45 without repeating its primary-source review. Four new GPCRdb responses capture Q13258 and its complete residue inventory twice. All 359 canonical positions are present, agree with the retained independent UniProt sequence, and yield 237 TM1–TM7 residues using the unchanged frozen extractor. Raw bytes, timestamps, capture plan and source-code hashes are retained.

The new canonical profile closes the missing-reference limitation for the seven heavy-positive DP1 entries and additionally includes receptor-only **9UWD**, without treating absent heavy-domain calls as evidence of antibody absence. All eight entries and 33 polymers remain accounted for. We calculate all 17 unique development comparisons and explicitly map them to all **136 entry/reference pairs**. Primary development signals: none. Veto-only sensitivity signals (including any primary signals): none. A nonmatch is not proof of independence.

## Subsequent cross-publication and receptor review

All **28 unordered DP1 entry pairs** share the Q13258 annotation; **15 pairs cross the two primary publications**. This is canonical receptor evidence, not identity of engineered deposits or a formal component certificate. DP1 was also compared with the already retained EP2 and EP4 canonical profiles; these two comparisons were missing from the earlier review.

| Comparison | Identical / alignment columns | Coverage, DP1 / reference | Primary criterion | Sensitivity criterion |
| --- | --- | --- | --- | --- |
| DP1 / P43116 | 114 / 237 | 0.919831223629 / 1 | true | true |
| DP1 / P35408 | 90 / 243 | 0.932489451477 / 0.973568281938 | false | true |

The primary criterion is the unchanged 40% identity and 80% coverage on both sides; 30% identity is a veto-only sensitivity criterion, not an independently selected cutoff. Exact frozen rational comparisons, all alignment counts and gap metrics are retained. EP2/EP4 reference profiles retain their original 30 August epoch; their canonical sequence hashes match the 5 September UniProt captures. No deployed GPCRdb/source-commit equivalence is claimed.

## Limits

These are **canonical-reference comparisons**, not a claim that an engineered deposited receptor has the same transmembrane sequence or experimental construct. All PR #45 range, tag, fusion, binder-role and 9UWD polymer-coverage discrepancies remain open. No frozen profile, protocol, ledger or formal graph is changed. New independent components: **zero**; whole-census upper bound: **unknown**; V3 remains **DRAFT/BLOCKED**. Prior exposure records remain applicable. No coordinates, poses, contact tables, Results, labels or prediction outputs were accessed.

Sources: [GPCRdb accession record](https://gpcrdb.org/services/protein/accession/Q13258/), [GPCRdb canonical residues](https://gpcrdb.org/services/residues/pd2r_human/), and the independently captured [UniProt Q13258 record](https://rest.uniprot.org/uniprotkb/Q13258.json) retained in the preceding source packet. GPCRdb data attribution and CC BY 4.0 license follow the frozen receptor snapshot's [legal notice](https://docs.gpcrdb.org/legal_notice.html).

## Offline reproduction

Run from the repository root:

`node scripts/hard-decoy-v3/review-dp1-receptor.mjs verify`

Verification rebuilds every result from the four retained responses and bound prior inputs, compares repeats and canonical sequences, checks all pair counts, and rejects changed/missing/extra files. It performs no network calls. Tests also exercise incomplete residue inventories, repeat disagreement, wrong accessions, sequence mutation, relocation and output tampering.

Next: adjudicate the source-supported binder-role and canonical receptor/development relationships alongside the preserved construct/exposure discrepancies. The reviewed pair lists are inputs to that formal review, not completed eligibility decisions.
