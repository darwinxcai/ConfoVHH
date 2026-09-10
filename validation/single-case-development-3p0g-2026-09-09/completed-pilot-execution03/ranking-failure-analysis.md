# Frozen ranking reproduction and selection failure

This is a post-outcome diagnosis of the completed 3P0G development case. The frozen ten-candidate population, scientific code, original receipts, and negative result are unchanged. No GPU generation or replacement candidates were used.

## Reproduction and identity

The final replay independently reconstructed the input manifest from the preserved generation receipt, verified all 41 source/dependency byte hashes frozen in protocol.json, verified the hashes of every file in the original evaluation execution receipt, and reran the frozen source-bound coordinate scorer. All ten complete audit objects, structure records, audit policies, ConfoVHH scientific ranks and confidence ranks matched exactly. Execution timestamps and their derived enclosing report hashes change on rerun.

Independent Python parsing of the raw mmCIF decimal coordinates verified one selected model 1, matching auth/label chain identifiers, receptor A (501 residues) and VHH B (126 residues), exact frozen sequences, candidate/seed/model filename mapping, coordinate and confidence hashes, and every N/CA/C/O backbone atom exactly once. Direct float64 atom distances independently reproduced all residue-contact counts, atom-contact counts, contacting-residue counts and severe-clash residue-pair counts. Maximum-overlap values agreed to less than 1e-12 Å. This rules out parsing/counting and role-binding explanations for the observed failure in this tested path.

ConfoVHH measures A:B here. Ligand C is excluded from those geometry measurements. Baseline confidence is the unchanged Boltz whole A/B/C complex confidence_score field, higher better; it is not receptor–VHH-specific confidence. PAE and per-atom confidence were uniformly omitted from frozen ConfoVHH scoring.

## Exact comparison

The frozen scientific key is lexicographically descending `(evidenceTier, halfDeltaSasaInterfaceAreaAngstrom2)`. Supported=2, mixed=1, limited/not-assessable=0. The area is half of the total receptor-plus-VHH solvent-accessible surface loss, with a 1.4 Å probe, 960 sphere samples per atom, element Bondi radii, and the frozen canonical selected-chain coordinate frame. It is used at full stored precision.

`seed2_model_4` beats `seed1_model_4` because both are supported and 1058.4596798033813 > 928.2626822950779 Å². It beats `seed2_model_0` on the first key: 2 > 1. The best-DockQ candidate's larger area, 1512.5783279588954 Å², is never compared across those evidence tiers. No candidate-ID tiebreak or reversed sort direction selects the winner. No exact scientific or confidence ties occurred.

The supported tier requires at least 18 contacting residue pairs, at least 7 receptor and 6 VHH interface residues, and exactly zero severe-clash residue pairs after passing the broader assessability/limited criteria. All ten satisfy the contact and completeness floors. The two zero-clash models are supported; all eight remaining models are mixed solely because they have one or more such clash pairs. None reaches the limited maximum-overlap threshold of 1.5 Å or the limited relative-clash-count threshold.

This penalizes all six poses with DockQ >=0.23: all six are mixed. Both supported models have DockQ <0.23. Among mixed models, burial ranks seed2_model_0 first. The observed failure is therefore dominated by the zero-clash evidence-tier gate, followed by a larger-area tie-break between two inaccurate supported poses. The most-buried pose is seed2_model_0, ConfoVHH rank 3.

## Meaning of reported clashes

The `severeClashCount` field counts distinct contacting receptor/VHH residue pairs containing at least one noncovalent heavy-atom Bondi overlap >=0.6 Å. It does not count every clashing atomic pair. Plausible Cys SG–SG distances 1.8–2.3 Å are exempted. Atom contacts use distance <=4.5 Å. These are geometric audit proxies under the frozen policy, not a complete chemical steric-energy model.

The best-DockQ pose seed2_model_0 has six measured severe residue pairs (A242/B28, A297/B1, A297/B26, A298/B5, A405/B29, A490/B1); their triggering atomic overlaps are 0.6071–0.7497 Å. The second-best DockQ pose seed2_model_2 has just one: LEU A408 CD2 versus VAL B103 CG1, distance 2.6444861785042475 Å and overlap 0.7555138214957524 Å. This single C–C pair prevents the supported tier. The selected pose has maximum overlap 0.5037578092964918 Å. Runner-up seed1_model_4 has maximum overlap 0.599472986547203 Å, about 0.000527 Å below the frozen 0.6 Å cutoff. Its supported classification is close to that threshold in the supplied coordinates. No cutoff, coordinate, relaxation or scientific key was changed during diagnosis.

Engineered/unobserved receptor-region interpretation must use the separate full-sequence-to-observed-reference mapping. Raw candidate A residue numbers are not experimental author numbers. The independent clash ledger preserves every triggering atom identity for that mapping.

## Reference-only diagnostic

The exact preserved observed native_AB.pdb (SHA-256 f9c2b4e63bcf9beda92cfd147686186e24e1f098472e15447fa1f76cbbdbb557) was audited separately with the same geometry settings: supported, 46 contacting residue pairs, zero severe clash pairs, maximum overlap 0.4408049726584502 Å, area 865.0401433789232 Å². It was never inserted into the ten-candidate ranking. Native and prediction areas have different available receptor-residue inventories; area differences alone do not demonstrate a placement error or justify a native-inclusive selection result.

## Diagnosis and claim boundary

No implementation bug was found in the tested candidate identity, parser/chain binding, clash/contact counts, burial-to-ranking value flow, ranking directions or tie adapter. The reproduced result is a negative selection result for this frozen policy: ConfoVHH selects seed2_model_4 (DockQ 0.1762564824406321); confidence and retrospective best available select seed2_model_0 (DockQ 0.48462880897372757); difference is -0.30837232653309543. There is no corrected scientific result to substitute. The raw overlap proxy and zero-clash tier gate can prefer geometric cleanliness over closer experimental placement in this case.

Changing that gate, masking receptor regions, adding confidence/PAE or chemical energy, or optimizing burial would be scoring redesign informed by these outcomes and must be evaluated prospectively on new held-out cases. This single previously exposed development case has zero independent biological validation groups.

## Source anchors in frozen commit 335617ae2744d8e9061464bafd62e166209d8c46

- lib/confovhh.ts:485–501: probe, sampling and Bondi radii; 718–721: overlap formula; 1681–1684: contact and severe-overlap thresholds; 1779–1787: residue-pair clash counting and disulfide exemption; 1895–1916: tier assignment; 2063–2066: area output divided by two.
- lib/pose-evidence-v06.ts:74–82: tier numbers; 233–258: measurable-burial floor and null handling; 301–304: exact area carried through; 314–328: descending tier/area display comparator.
- scripts/paper/export-current-product-ranks.mjs:27–45: scientific comparator and dense exact-tie tiers, with IDs only serializing rows; 111–119: higher-better confidence comparison and zero-based tier export.
- scripts/paper/export-coordinate-ranks.mjs:109–118: explicit selected model/chains, canonical geometry, confidenceMode none and PAE omitted.
- protocol.json: method.rankingKeys, method.confidenceMode, method.pae, baseline, selectionUnit and evaluation define the frozen analysis policy; the plan is never edited here.

## Reproducible artifacts

Canonical replay: reproduction/reproduction-receipt.json, reproduction/identity-and-source-verification.json, reproduction/source-bound-replay.json, reproduction/candidate-table.json, reproduction/candidate-table.csv, reproduction/independent-contact-clash-geometry.json. The first post-outcome replay is retained in the local analysis archive; final-replay additionally verifies independent backbone atom completeness explicitly. Both give identical metrics and ranks. DockQ values in this ranking script are read from checksum-verified frozen evaluation outcomes, not independently recomputed by this script.

The exact per-candidate table is in reproduction/candidate-table.md and machine-readable CSV/JSON. All ten outcomes succeeded, with no missing coordinates, confidence or DockQ values.
