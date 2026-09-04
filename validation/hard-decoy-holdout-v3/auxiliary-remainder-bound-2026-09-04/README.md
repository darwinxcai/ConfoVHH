# ConfoVHH hard-decoy v3 auxiliary-remainder bound

Status: **TARGET_CENSUS_BLOCKED**

This source-backed audit closes the 212 rows left outside the earlier salvage queue. It uses frozen public entity metadata and primary role sources, without native coordinates or relative-pose inspection.

## Entity-level result

Each row contains exactly one apparent VHH-like entity, already marked auxiliary in the frozen triage snapshot. Exact descriptor matching and required companion entities classify 196 as Nb35 G-protein stabilizers, three as scFv16 G-protein stabilizers, and 13 as anti-Fab fiducial nanobodies. A broader antibody-like entity scan additionally accounts for 16 scFv16 stabilizers and 28 Fab heavy/light chains and finds no hidden VHH candidate. The v3 protocol explicitly excludes all three auxiliary VHH-like classes. Every row therefore has an independent-component increment upper bound of zero.

## Census consequence

The preceding audit bounded the favorable prioritized frontier at eight components and proved that at least two more would have to come from these 212 rows. Because this package closes all 212 at zero, eight is now the whole-census upper bound. The protocol requires at least ten, so version 3 terminates at `TARGET_CENSUS_BLOCKED`.

This terminal decision does not authorize a smaller formal GPCR holdout. A smaller panel remains exploratory only. A broader membrane-protein-VHH benchmark would require a separately preregistered protocol.

No oracle request, target freeze, MSA retrieval, generator run, native coordinate access, pose inspection, DockQ/CAPRI label access, or ConfoVHH performance analysis is authorized.

Regenerate and verify with:

```bash
node scripts/hard-decoy-v3/build-auxiliary-remainder-bound.mjs
node --test tests/hard-decoy-v3-auxiliary-remainder-bound.test.mjs
```
