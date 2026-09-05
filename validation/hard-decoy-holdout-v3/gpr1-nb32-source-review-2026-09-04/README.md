# GPR1 Nb32 source and construct review

**The six GPR1 Nb32 entities have a source-supported auxiliary beta-arrestin reagent role.** The [2025 PNAS Ib32 study](https://doi.org/10.1073/pnas.2507384122) explicitly identifies nanobody32 as beta-arrestin-recognizing in its abstract and publishes the complete sensor amino-acid sequence in Methods. All six deposited GPR1 Nb32 entities match its 114 nanobody residues exactly; their terminal expression sequences differ.

This resolves the reagent-family ambiguity without establishing an entry exclusion. The GPR1 [Science paper](https://doi.org/10.1126/science.adt8794) has no Europe PMC full-text copy and its supplement capture returned HTTP 403. Its primary sample Methods and exact deposition statement remain unreviewed. **All six entry dispositions remain pending**, with zero new eligible targets, independent components or formal graph decisions. Sequence identity does not prove universal receptor nonbinding or absence of incidental receptor contacts.

| Finding | Evidence and scope |
| --- | --- |
| Nb32 role | Primary PNAS abstract identifies the target class; the Methods sequence matches all 114 nanobody residues in every GPR1 entry. The GPR1 deposited sequence is those residues followed by six histidines. |
| Independent reagent references | The same 114-residue sequence appears in 8JRU, 8JRV, 6NI2, 9BT8 and 9CX3. Their primary Methods and exact deposition statements are captured. Full tagged constructs differ. |
| scFv30 | All six GPR1 entries contain an identical 245-residue scFv30 entity. Its first 108 residues exactly match the Fab30 light-chain segment in 6NI2; residues 125–245 exactly match a 121-residue heavy-chain segment. These are computational contiguous matches, not experimentally assigned domain boundaries. |
| Receptor sequence | All six deposited receptor entities contain GPR1 canonical residues 2–322 followed by V2R residues 343–371. Five match the GPR1 segment exactly; 9UYN has V143C. The purpose of that substitution is not assigned. |
| Terminal constructs | 9UYH/9UYI/9UYJ/9UYL have a 46-residue deposited prefix and total length 396; 9UYM/9UYN have a 64-residue prefix and total length 414. Exact prefixes are retained without inventing expression or cleavage history. |
| Prior development scan | Canonical GPR1 P46091 was unrecognized in the earlier receptor scan, whereas the V2R annotation was recognized. Its no-observed-signal category cannot establish GPR1 independence. This packet captures canonical GPR1 and V2R sequences twice with identical responses. |

The complete 29-polymer GPR1 inventory and the 24 polymers from five reference entries are retained, including both antibody-format entities and all receptor, ligand and arrestin entities. Metadata component descriptions remain distinguished from complete primary sample accounting. The unusual phage source-organism annotation attached to GPR1 Nb32 is preserved as a database annotation, not interpreted as the biological origin of the antibody.

The GCGR reference also retains its own unresolved construct discrepancy: its Methods describe a C-terminal PreScission sequence and eight-histidine tag, with protease cleavage, whereas the deposited 8JRU/8JRV Nb32 sequences contain an `MA` prefix and `HHHHHHEPEA` suffix around the shared 114 residues. The sequence relationship is exact; the tag and processing history is not reconciled. No unreported tag swap or cleavage explanation is assigned.

Nineteen public-source requests are preserved with raw response bytes, timestamps, status and SHA-256 hashes. The provenance chain includes the GPR1 bibliography/institutional route, Nb32 primary reagent papers, canonical sequences, and rejected search leads. Unrelated or non-primary search hits are not used as role evidence. Frozen metadata, previous reviews and formal ledgers are unchanged.

Only primary abstracts, selected construct/expression/sample Methods and data availability were read. No Results, figure captions, native coordinates, native images, measured contacts, labels or predictions were inspected. The permitted GPR1 abstract itself contains qualitative receptor/arrestin state and interaction-pattern language, so this is not a claim of complete prose blindness; exposure review remains necessary before eligibility. An exploratory sensor-methods extraction also displayed optical measurement procedures, without native complex pose evidence. Raw publication bodies should not be displayed indiscriminately.

Run the deterministic offline replay from the repository root:

```sh
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
python3 -B validation/hard-decoy-holdout-v3/gpr1-nb32-source-review-2026-09-04/build.py verify
```

Replay verifies the raw captures and bibliography query, exact allowed-section extraction, all input digests and polymer sequence inventories, the published Nb32 sequence, five primary deposition links, canonical-sequence repeats, all sequence comparisons, and the exact package checksum inventory. It performs no network request and emits only counts and gate states.
