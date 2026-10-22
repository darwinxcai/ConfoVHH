# GPR1/Nb32 bounded candidate-entity adjudication

Status: **six deposited Nb32 candidate entities receive bounded auxiliary-role dispositions; all six whole entries remain pending.**

The retained primary Nb32 source identifies nanobody32 as a beta-arrestin-recognizing reagent and publishes its 114-residue sequence. Each GPR1 entry contains an entity named Nanobody 32 with that exact 114-residue core followed by six histidines. The source fact, named metadata identity and exact sequence relationship jointly support `EXCLUDE_CANDIDATE_ENTITY_AUXILIARY_BINDER` for those six entities. Sequence identity alone is explicitly not role authority.

All 29 deposited polymers remain accounted for. Every entry also contains scFv30, whose retained sequence has exact Fab30 segment relationships but whose GPR1 experimental preparation and direct-binding role remain unreviewed. Consequently no whole-entry exclusion or eligible-target decision is issued.

A fresh direct request to the Science article remained HTTP 403. Indexed snippets were not promoted to Methods evidence. The same narrowly targeted search incidentally displayed secondary structural prose; `access-and-exposure.json` records categories without copying the prose. No coordinates, receptor–VHH relative poses, structural images, structural contact tables, actual native receptor–VHH residue-contact assignments, labels or predictions were accessed.

The master ledger and formal graph are unchanged. New eligible targets and independent components: **zero**. Formally cleared independent components remain **zero**; the whole-census upper bound remains unknown; target freeze remains blocked.

Verify offline with:

```bash
node scripts/hard-decoy-v3/adjudicate-gpr1-nb32.mjs verify
node --test tests/hard-decoy-v3-gpr1-nb32-adjudication.test.mjs
```
