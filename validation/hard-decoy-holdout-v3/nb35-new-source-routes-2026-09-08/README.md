# Historical Nb35: bounded new source-route check

Four previously unattempted metadata/access routes were checked. No primary
Methods were recovered, and all 16 historical entries remain pending. No previous
failed download was repeated, and no eligibility or exclusion decision changed.

| Route | Observed result | Scientific limit |
| --- | --- | --- |
| [Amylin exact-DOI OpenAlex record](https://api.openalex.org/works/https://doi.org/10.1126/science.abm9609) | Exact title and DOI match; locations list DOI and PubMed. | No additional manuscript route in this record; not an exhaustive availability search. |
| [PTH1R exact-DOI OpenAlex record](https://api.openalex.org/works/https://doi.org/10.1016/j.molcel.2022.07.003) | Exact title and DOI match; locations include the previously known Cell PDF. | The aggregator declares OA/CC BY; the primary document and its license statement were not retrieved. |
| [PTH1R official full-text HTML](https://www.cell.com/molecular-cell/fulltext/S1097-2765(22)00660-8) | Read timed out. | No source body or preparation Methods received. |
| Figshare public metadata search for the exact amylin title | HTTP 403. | No manuscript metadata returned. This was a read-only search, not a publication action. |

`access-followup.json` records request URLs, query, available timestamps, response
hashes and selected bibliography/location fields. Raw response bodies were not
retained. The original 16-entry inventory and prior evidence files are linked by
hash. No structures, Results, figures, captions, structural contact tables, labels
or predictions were inspected.

The remaining source requirement is unchanged: obtain each paper's primary
construct/sample Methods, explicit reagent-role evidence and complete deposition
statement. Existing sequence matches and author-hosted PDB links cannot substitute
for those statements. A failed request or missing URL in an aggregator cannot prove
that the required information is absent or universally inaccessible.

Repeated download chasing stops here. A new institutional/author manuscript route
or a legitimately obtained source document is needed before another preparation-only
review is useful. Other authorized project work can continue.

## Why an entity-only exclusion is also still unsupported

`entity-evidence-gap.json` records a separate review of seven named retained files,
with their exact hashes and all 16 candidate identifiers. None of these candidates
already has an integrated entity-only disposition.

The reference source supports the auxiliary G-alpha/G-beta role of Nb35. However,
the candidate identity evidence is a shared 126-residue computational substring of
`7FIM_1`; the historical review explicitly says its boundaries are not experimentally
established domain boundaries. All 16 complete deposited candidate sequences differ
from the complete reference sequence. Retained DP1 preparation paragraphs name
Nb35 and its use but do not supply the missing complete-core sequence mapping.

The GPR1/Nb32 precedent has a stronger anchor: a complete 114-residue nanobody
sequence published in primary Methods. That evidence cannot be replaced here by
assuming the 126 shared Nb35 residues constitute a source-established complete core.
No qualifying primary complete-core mapping was identified in the seven reviewed
files; this is a bounded evidence gap, not a claim that no source exists elsewhere.

**No entity-only overlay was created.** Reopen this narrower adjudication only when
a primary complete Nb35 sequence/construct mapping establishes reference–candidate
core identity, or candidate-specific Methods establish the deposited reagent's
identity and auxiliary role. Repeating the same name plus substring inference does
not add evidence. The 16 pending entries and the previously accounted 102 polymers
remain unchanged, with no new independent eligible groups or whole-entry authority.
