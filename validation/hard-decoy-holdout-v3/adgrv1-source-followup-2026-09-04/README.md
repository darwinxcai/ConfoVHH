# ADGRV1 sequence reconciliation and official citation follow-up

The deposited **9FTE receptor is an exact mouse-sequence fragment plus a terminal suffix**. Its first 415 residues match mouse UniProt **B8JJE0 residues 5884–6298** exactly, followed by `SGRHHHHHHHH`. The corresponding reviewed mouse Q8VHN7 fragment differs at one position: deposited R239 versus canonical G6122. The origin of this variation is unverified. The 415-residue block is not an exact substring of the captured human Q8WXG9 canonical sequence. This independently supports the deposition's mouse annotation. It does not establish the species used experimentally or explain the preprint's human-receptor description.

The [candidate bioRxiv preprint](https://www.biorxiv.org/content/10.64898/2026.03.05.709805v1) is independently corroborated by [Europe PMC](https://europepmc.org/article/PPR/PPR1220841) and [Crossref](https://api.crossref.org/works/10.64898/2026.03.05.709805). Its exact primary deposition paragraph and construct Methods remain unavailable. PDBe, PDBj and EMDB still give unpublished attribution; Europe PMC provides no PMC/PDF record, both HAL queries returned no records, Crossref's delivery destination denied access, and the advertised bioRxiv JATS route remained rate limited. These observations describe the searched routes and do not establish absence of a publication or full text elsewhere. Historical evidence remains unchanged.

A second bounded task rechecked **9S38** through official PDBe publication metadata and an exact-token Europe PMC query. The deposition still has no DOI or PMID. Three unrelated search results provide no deposition linkage. The existing exact-sequence relationship to 9S37 remains a useful lead, with primary attribution pending.

`source-followup.json` separates facts, inferences, retrieval limitations and remaining work. `sources/` retains all 19 HTTP response bodies, including failed responses, with individual request URLs, timing, response headers, byte lengths and hashes. Full metadata bodies are archived; the reviewer inspected citation fields, source organism and sequence fields only. No publication Results or captions were rendered in this follow-up. `exposure-scope.json` preserves the previous ADGRV1 and LGR4 exposure caveats.

The comparison is exact substring matching and does not use coordinates, an alignment model or inferred contact geometry. The suffix is a sequence observation; its experimental design and purpose are not established. No target, independent component, exclusion or no-edge conclusion is certified. The whole-census component upper bound remains unknown and target freeze remains blocked.

Reproduce all retained scientific results and verify the exact file inventory offline, from the repository root:

```bash
python3 -B validation/hard-decoy-holdout-v3/adgrv1-source-followup-2026-09-04/build.py verify --repository-root .
```

The script is portable to another checkout when the same historical input files are retained. It verifies those inputs against the digests in the reproduced output. `capture.py` records new, uniquely named responses only; it refuses to overwrite an existing capture. Capturing is separate from offline verification.

The next source task requires a permissible primary Methods/deposition source or an independently verifiable publisher/deposition update. Experimental species, complete receptor/RE02 construct provenance, 9S38 attribution and the existing exposure adjudications remain open.
