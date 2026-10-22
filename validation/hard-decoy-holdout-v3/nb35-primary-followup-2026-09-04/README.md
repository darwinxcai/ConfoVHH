# Historical Nb35 primary-source followup

This packet continues the sixteen unresolved entries in `nb35-source-review-2026-09-04`. It adds six exact author-hosted deposition links and verifies the complete frozen inventory of 102 polymer entities. **All sixteen entries remain pending.** No candidate or entry exclusion, eligible target, independent component, or whole-census bound is added.

| Publication group | Entries | New evidence | Remaining gap |
| --- | ---: | --- | --- |
| Amylin receptors, Science 2022, DOI `10.1126/science.abm9609` | 10 | Current bibliography/access-route capture; frozen inventory verified | Primary construct/sample Methods and complete deposition statement |
| PTH1R, Molecular Cell 2022, DOI `10.1016/j.molcel.2022.07.003` | 6 | Kato laboratory publication card explicitly links 7VVJ, 7VVK, 7VVL, 7VVM, 7VVN and 7VVO to the exact paper | Primary Methods, direct reagent-role evidence and primary paper deposition statement |

The [author laboratory publication page](https://park.itc.u-tokyo.ac.jp/hekato_lab/en/publications/) is a new linkage source. Its single matching card is bounded by its exact title and article element before extraction. The laboratory's PDB links corroborate publication membership, but do not explain individual sample composition, experimentally expressed constructs, or Nb35's role. The paper itself remains inaccessible. Nureki's publication list and the institutional news record lead back to the citation rather than a retrieved manuscript.

Twelve access-route captures are retained with timestamps, raw response hashes and HTTP or transport outcomes. The amylin publisher supplement returned HTTP 403; its institutional page also returned 403 and Crossref returned 429. The PTH1R publisher PDF and Crossref-advertised text-mining route timed out. Europe PMC supplies bibliography and a publisher PDF route, without a PMC identifier for either article. These access failures describe these requests, not universal absence of accessible copies.

The old component annotations and Nb35 shared-segment comparison are carried forward as prior evidence. Complete sequence lengths, sequence hashes, entity identifiers and both chain identifier systems are rechecked against frozen raw records for every polymer. Names or shared sequence alone still cannot establish a whole-entry absence claim. The historical review and frozen files are unchanged.

No coordinate files, native images, measured contacts, labels or predictions were inspected. Search results were reduced to URLs before model-visible output. One exploratory laboratory-page extraction emitted surrounding bibliography entries and identifier links; this was bibliographic content, not paper Results or figure captions. Final replay extracts only the matching card's title and links. Raw HTML is preserved for provenance and should not be displayed indiscriminately.

Run from the repository root:

```sh
python3 -B validation/hard-decoy-holdout-v3/nb35-primary-followup-2026-09-04/build.py verify
```

This offline command verifies raw capture hashes and query echoes, exact publication-card linkage, the prior review and frozen input digests, all 102 polymer records, regenerated evidence bytes, and the exact package checksum inventory. It performs no network request. `fetch_sources.py` is capture provenance and refuses to overwrite existing attempts. Repeating failed requests is not the next scientific task; a genuinely new accessible manuscript route or a separately authorized source handoff is needed.
