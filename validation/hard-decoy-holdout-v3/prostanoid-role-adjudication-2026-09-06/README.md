# Prostanoid binder-role and target-format adjudication

Status: **12 bounded entry exclusions supported; zero eligible-component increment; v3 freeze remains blocked.**

This packet converts the retained preparation Methods and complete polymer inventories from the EP2/EP4 and DP1 source reviews into entry-level dispositions without changing the historical 287-entry ledger. Nine entries contain source-supported auxiliary VHH reagents: EP2 and inactive DP1 use anti-Fab nanobodies, while active DP1 uses Nb35 with Gs. EP4 has a conventional Fab heavy/light pair rather than a deposited VHH target, and 9UWD's exact linked deposition contains only one receptor polymer despite the paper's FabBRIL/NbFab preparation. That bounded inventory fact does not claim that experimental antibodies were absent.

| Disposition | Entries | Count |
| --- | --- | ---: |
| EXCLUDE_AUXILIARY_BINDER | 8ZVZ, 8ZW0, 9AU0, 9E9S, 9EE5, 9EI5, 9EKH, 9JRO, 9JRT | 9 |
| EXCLUDE_NO_DIRECT_RECEPTOR_VHH_INTERFACE | 9JQY, 9JQZ, 9UWD | 3 |

The sequence checks are contextual, not role authority by themselves: EP2 Nb exactly matches historical 8TB7_3; the three inactive-DP1 anti-Fab nanobodies exactly match source-reviewed 6WW2_2; and all four active-DP1 Nb35 entities contain the same 126-residue segment as source-reviewed 7FIM_1. Entry-specific preparation text and exact deposition linkage supply the role/format evidence.

All 47 retained polymers remain enumerated. The EP4 boundary discrepancy, DP1 tag/boundary discrepancies, EP2 fusion provenance, and 9UWD experimental-versus-deposited coverage discrepancy remain explicit. They do not create a direct deposited VHH target in these entries and therefore do not block the bounded exclusions. DP1 same-receptor and DP1–EP2/EP4 comparison signals remain graph-pending.

No independent eligible group is added or removed from the formally cleared count because none was cleared before this packet. No whole-census bound is asserted, the master disposition ledger is unchanged, prior exposure records remain applicable, and target freeze remains blocked.

Verify deterministically with:

```bash
node scripts/hard-decoy-v3/adjudicate-prostanoid-roles.mjs verify
node --test tests/hard-decoy-v3-prostanoid-role-adjudication.test.mjs
```
