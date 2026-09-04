# GPCRdb complement sequence screen

Status: GPCRDB_COMPLEMENT_SEQUENCE_SCREENED_PENDING_ROLE_AND_COMPLETENESS_REVIEW.

Screened 719 protein or unknown-type entities across 142 captured entries, using 240 distinct present sequences. 160 entities in 141 entries yield a complete numbered heavy-chain variable domain. These are review signals, not confirmed VHHs or direct receptor binders.

The sequence method uses the pinned immunum 1.3.0 heavy-chain IMGT implementation at confidence 0.5, with complete region coverage and numbering/segmentation agreement. Whole canonical runs are scanned; 256-residue windows at stride 96 and recursive flanking intervals help find domains in long or multidomain chains. The method runs independently of descriptions and source taxonomy. Its sensitivity is not validated.

26 positive entities lack the historical descriptor/taxonomy signal. 0 are untagged and have no exact full-entity or numbered-domain match in the historical reference profiles. This does not establish novel VHH identity, receptor binding or independence.

Review tiers: 0, sequence-positive without antibody wording or exact prior exposure; 1, other unexposed positives; 2, exact historical/development matches; 3, auxiliary reagent wording; 4, lexical antibody signals or missing/noncanonical/engine-error sequences. Tier 5 entities have no such signal and remain in the complete entity inventory. Every tier remains scientifically unresolved.

- Immunum detects antibody heavy variable domains; Fab VH and scFv VH can produce the same positive signal as VHH.
- Whole chains, canonical runs, overlapping windows and recursive remainders are screened. Sensitivity for unusual or incomplete domains is not established; failure to number does not establish VHH absence.
- Overlapping window calls are preserved and are not independent domain counts. Extra residues may be a fusion, constant domain, linker or tag; sequence length alone does not adjudicate a construct.
- Exact historical sequence matches are exposure flags, not automatic formal leakage edges or role exclusions. Near matches and known-parent relationships remain unaudited here.
- The review queue prioritizes positive, lexical, missing-sequence and engine-error signals. Every other polymer remains in entity-screens.jsonl without an exclusion or absence call.
- The snapshot is a frozen GPCRdb inventory complement, not an exhaustive GPCR-VHH universe. Other discovery routes and entry-specific source review remain required.

Files bind the input snapshot, historical profiles, source script, lockfile and executed immunum JavaScript/WASM bytes by SHA-256. Rebuild with `node scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs build INPUT_DIRECTORY OUTPUT_DIRECTORY`; verify without rewriting with `... verify INPUT_DIRECTORY OUTPUT_DIRECTORY`. No coordinates or holdout labels are used.
