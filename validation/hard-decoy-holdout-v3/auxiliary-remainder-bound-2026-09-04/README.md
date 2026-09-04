# ConfoVHH hard-decoy v3 auxiliary-remainder bound

Status: **AUXILIARY_REMAINDER_TRIAGED_SOURCE_REVIEW_REQUIRED**

This package organizes 212 pending entries from the historical 287-entry sub-universe for source review. It does not close those rows or terminate v3.

## Entity-level result

Descriptors and companion-protein names suggest 196 Nb35, three scFv16, and 13 anti-Fab reagents. All 212 remain PENDING_REQUIRED_METADATA. Their hashes partition into 29 exact-sequence groups for efficient identity and variant review. The additional descriptor scan detects 16 scFv16-like entities and 28 Fab-chain-like entities; it does not establish that no other VHH exists.

## Census consequence

The earlier eight-component frontier is a bounded prior analysis. Treating it as a whole-census bound requires additional evidence. The reconstruction plan explicitly says the four-term historical search is incomplete. General reagent-role papers plus entity-name matches cannot establish every entry-specific role or close broader discovery. V3 remains DRAFT with target freeze BLOCKED; no terminal decision is reached.

Correction to local commit 9ef5d5e: its terminal TARGET_CENSUS_BLOCKED conclusion, 212 formal exclusions, and no-hidden-VHH assertion were unsupported and are withdrawn. Passing software tests did not validate those scientific premises. Complete entry-specific source review and the separately archived broader discovery routes before deciding census feasibility.

A separate [entry-specific follow-on review](../auxiliary-remainder-source-review-2026-09-04/README.md) records primary-source adjudication for 16 rows. This triage snapshot retains its original pending statuses; the follow-on package states exactly which entry assessments it supersedes and which discrepancies remain open.

No oracle request, target freeze, MSA retrieval, generator run, native coordinate access, pose inspection, DockQ/CAPRI label access, or ConfoVHH performance analysis is authorized.

Regenerate and verify with:

```bash
node scripts/hard-decoy-v3/build-auxiliary-remainder-bound.mjs
node --test tests/hard-decoy-v3-auxiliary-remainder-bound.test.mjs
```
