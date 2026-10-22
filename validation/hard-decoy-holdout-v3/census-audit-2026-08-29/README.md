# ConfoVHH hard-decoy v3 bounded metadata census audit

Status: **PRE-LABEL, METADATA-ONLY, INCOMPLETE; NOT A TARGET FREEZE**

Retrieval date: 2026-08-29 UTC  
Package timestamp: 2026-08-29T05:16:29Z

## Outcome

This bounded public-metadata census found **zero new independent GPCR–VHH components** beyond the seven provisional v2 components:

1. GPR158 / Nb20 (`9VOR`)
2. LGR4 / NB21 (`9S37`)
3. CaSR / NB2D11 (`7E6U`)
4. metabotropic glutamate receptor group / DN13 or Nb43 (`7E9G`, `8TAO`)
5. ADGRV1 / RE02 (`9FTE`)
6. DRD1 / NBA3 (`8JXS`)
7. MC4R / pN162 (`8QJ2`)

The formal state therefore remains:

- seven provisional components;
- zero formally cleared components;
- zero newly added independent components;
- minimum required components: ten;
- source universe not frozen;
- exhaustive entry-level dispositions not complete;
- target manifest not ready to freeze or approve.

The public-main v3 commits `8901e47d6969fcc170b1444bb0023c9457e2dc08`, `e3325aa0b5f6a9616a00e4770e7407f639f0ac3a`, and `07781f50c51e58dc11376d4168c57d18968e2dd2` provide, respectively, a draft protocol, a reconstruction plan, and reconstructible source-universe contracts/workflow/tests. They do **not** contain a completed 287-entry disposition ledger, a frozen source snapshot, completed leakage matrices, or cleared targets. This package adds bounded dispositions for 20 PDB entries discovered or revisited in the metadata sweep; it does not complete those missing work packages.

## Blindness and access attestation

During this audit:

- no PDB/mmCIF coordinate file or coordinate endpoint was requested;
- no native receptor–VHH pose was inspected or visualized;
- no native contacts, interfaces, DockQ, CAPRI, Fnat, iRMSD, or LRMSD values were accessed or calculated;
- no ConfoVHH holdout audit or benchmark score was generated;
- no candidate-generator output or performance result was accessed;
- only public identifiers, entry/polymer metadata, deposited sequences, citations, depositor annotations, and primary-publication text were used.

These statements are also recorded in `access-state.json` and mechanically checked by `verify.mjs`.

## Search result

The historical four-term RCSB/GPCRdb search was reproduced without archive drift:

| Set | Count | SHA-256 of normalized IDs |
|---|---:|---|
| RCSB `nanobody` | 1,760 | `a66f26fce4498ba07dc2eb46bd5ba1c5440f671209775e9496ce7b82bd194795` |
| RCSB `VHH` | 475 | `0ad358494867265303e46afe24f7122508d98a6717c6d5ae26059b5e4adef614` |
| RCSB `camelid` | 188 | `43fbe51adbd46533cc7855e8f5ce5f3e85752d45790e97b057a68b253a21b41c` |
| RCSB `megabody` | 59 | `c63071f001fb61779eafddfed99b5b41826f2f8c04f798ad4cd833fb6cf37d91` |
| RCSB four-term union | 2,065 | `c154b8a9780f0d7a898a9fed77bbc54f2b18572830840d55ead625ede647f0ca` |
| GPCRdb structure codes | 1,716 | `4a0e3a35472703207a8d9615071f78a5d397e7281698dc5047b2c38bfc77e861` |
| Intersection | 287 | `fa51175683d9f4f02ded64c6e7ce82fd64ee339dae7be8dbd32c3e9af546dba7` |

An accession-centered recent-release sweep was added because free-text searches can miss binders named only `NBxx`. It queried 2,471 GPCRdb receptor accessions against experimental RCSB entries released on or after 2025-01-01. Seven deterministic batches produced 873 unique entries (normalized-ID SHA-256 `8a27cca5141bbc7cc8a3cf3543f56c1f95fcbe1d562402203753183a14d3f0c3`). Exact payload templates, batch counts, and hashes are in `provenance.json`.

The new direct-looking records either collapse into the existing LGR4 or GPR158 provisional components, or fail closed because of exact development-receptor/VHH reuse, engineered development-epitope grafts, auxiliary-binder status, or absence of a full GPCR. The complete bounded decisions and sequence hashes are in `dispositions.jsonl`.

## Important non-claim

This audit is not exhaustive enough to freeze a v3 target set. Raw HTTP response bytes were **not preserved** for this bounded run, repeat-response equality was not recorded, the full 287-entry universe was not assigned dispositions, and the broader discovery routes in `CENSUS_RECONSTRUCTION_PLAN.md` remain incomplete. The recorded counts and digests are reproducibility evidence, not a replacement for the required raw source snapshot.

Reaching ten groups from the currently reviewed public structures would require relaxing the preregistered independence, direct-interface, or leakage criteria. This audit does not authorize that relaxation.

## Sources and licensing

Every PDB and publication link used for a disposition is embedded in `dispositions.jsonl`. RCSB/wwPDB structural metadata and deposited sequences are covered by the [wwPDB CC0 usage policy](https://www.wwpdb.org/about/usage-policies). Publication licenses were not inferred: only citations, links, and short factual paraphrases are recorded, and no publication text is redistributed.

## Verification

From this directory:

```bash
node verify.mjs
node --test verify.test.mjs
```

The verifier validates JSON/JSONL structure, counts, blind-state flags, dates, links, sequence digests, and all file hashes in `checksums.sha256`.
