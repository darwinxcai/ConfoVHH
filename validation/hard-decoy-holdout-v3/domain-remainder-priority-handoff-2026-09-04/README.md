# Domain-remainder priority metadata handoff

This packet compares nine selected entries with the frozen development references using deposited sequence hashes and receptor accession metadata only. It does not resolve antibody format, direct binding role, construct eligibility, parent-variant relationships, or development disposition. All three groups remain pending scientific review and have no formal component-count authority.

| Selected entries | Receptor accession | Exact sequence observation | Development comparison |
| --- | --- | --- | --- |
| 9LQU, 9LQW, 9LQX, 9LR1, 9LR2 | APJ / P35414 | All five JN241-9 entities have the same 130-aa full deposited sequence; it also exactly matches 8Z74 entity 1 and 8Z7J entity 6. | Receptor accession matches development 6KNM. The 130-aa candidate sequence does not exactly match its 129-aa JN241 sequence or any other development VHH profile. Deposited receptor constructs also differ. Parent-variant and formal development review remain pending. |
| 9W3K, 9W3L | GPR151 / Q8TDV0 | The entries share the same 419-aa receptor entity and 127-aa NB6 entity. 9W3L contains only those two polymer entities; 9W3K also contains the named Legobody scaffold/Fab components. | No exact canonical receptor accession, full candidate-entity sequence, or numbered heavy-domain match occurs in the bounded development references. This does not establish independence. Format, role, construct, family, and other leakage review remain pending. |
| 9ZXC, 9ZXD | AT1R / P30556 | Both contain the same 582-aa entity described as AT118-R nanobody plus receptor and BRIL insertion. Candidate and receptor are parts of the same deposited entity. | Receptor accession matches development 6DO1. No full-entity or numbered-domain match to its Nb.AT110i1 or another development VHH profile was found. Full fusion identity is not full VHH identity; source-confirmed VHH boundaries and construct/development review remain pending. |

**Development reference correction:** 6KNM is APJ/P35414. 6O3C is Smoothened/P56726 with NbSmo8 and is not an APJ development reference. 6DO1 is AT1R/P30556. These assignments come from the frozen development metadata and its canonical receptor profile, rather than from treating every SIFTS accession in a fusion as a receptor.

`comparisons.json` retains complete SHA-256 values, entity identifiers and lengths, accession evidence, candidate domain-call intervals, matching development records, exact full-entity occurrences across seven captured metadata sources, and hashes of all inputs. Full candidate-containing entities are compared against all 18 frozen development VHH profiles; receptor accessions are checked against all 17 frozen development receptor nodes. The seven source inventories are the six previously captured metadata inputs plus the newly completed domain remainder.

A negative exact-match result is narrower than a leakage clearance. No additional primary-literature search or structural data access was performed. The metadata capture and sequence-screen packets retain their original inventories. The broader census remains incomplete and target freeze remains blocked.

Reproduce without network access from the repository root:

```sh
python3 -B validation/hard-decoy-holdout-v3/domain-remainder-priority-handoff-2026-09-04/build.py verify
(cd validation/hard-decoy-holdout-v3/domain-remainder-priority-handoff-2026-09-04 && sha256sum -c checksums.sha256)
```
