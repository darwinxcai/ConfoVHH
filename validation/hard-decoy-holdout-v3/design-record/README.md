# Hard-decoy v3 design record

This checksummed package records the selected one-way oracle design without
claiming that an oracle request, target manifest, leakage graph, candidate set,
audit set or pre-label benchmark has been frozen.

Current state: `DRAFT`.

The immutable v2 record remains terminal `TARGET_CENSUS_BLOCKED`. No v2 file is
rewritten by this package. The v3 design releases only signed pair decisions
(`EDGE`, `NO_EDGE`, or `FAIL_CLOSED`) and salted commitments before label
opening. Native token sets and exact overlap statistics remain in one encrypted,
fixed-size evidence bundle.

The current blocker is scientific, not cosmetic: the archived screen contains
seven provisional and zero formally cleared groups, below the unchanged
minimum of ten. The oracle request therefore does not yet exist and no native
coordinate has been accessed under v3.

Run the design verifier with:

```bash
node scripts/hard-decoy-v3/verify-design-record.mjs
```

This verifier checks the exact package inventory, all SHA-256 rows, protocol
ancestry, blocked access state, oracle output policy, cryptographic profile and
the pinned v2 release roots. The Git commit/release receipt remains the external
trust surface; checksums inside this directory are integrity evidence, not an
independent timestamp or signature.
