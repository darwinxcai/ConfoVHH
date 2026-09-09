# Synthetic coordinate-to-audit-to-rank execution

All coordinates here are generated four-alanine fragments from
`scripts/paper/reviewer-demo.mjs`: two copies of the near-contact arrangement
and one separated control. The baseline numbers and failed-attempt record are
arbitrary fixtures. No native/predicted GPCR–VHH input or biological outcome was
read, and no predictive performance was measured.

`example/input.json` binds every exact coordinate file. `rank-receipt.json`
contains new production audit reports, exact report/coordinate identities and
the resulting scientific ranks. Duplicate geometry retains a scientific tie;
one failed attempt stays in the inventory. The independent exhaustive contact
oracle in the existing generator agrees with the production contact counts.
No paired outcome comparison is executed by this example.

Reproduce into a new directory from the proposed revision:

```sh
env -u NODE_OPTIONS -u NODE_PATH node \
  paper/evidence/coordinate-rank-execution-2026-09-09/generate-example.mjs \
  --output=NEW_DIRECTORY
```

Report execution timestamps and report digests change on replay. Original input
identities, audit semantics and scientific ranks are separately checkable.
`generation.json` binds the generator and executed source identities. This is
new evidence under the patched product lock; no historical receipt is rewritten.

Eight coordinate-executor tests pass on Node 24.19.0 and Node 22.23.2. They cover
actual computation, independently enumerated contacts, altered source bytes,
explicit chains/models, equivalent mmCIF input, failure inventory, missing
producer scores, caller mutation, strict JSON and filesystem boundaries. The
combined current/preflight suite passes 34/34; new coordinate and historical
runner tests pass 11/11 on Node 22.23.2. See `verification.json` for commands,
scope and exact log identities.

The broader 45-test check deliberately retains its one failure: an unchanged
historical synthetic report receipt binds the old root lock. All 11 tests in
that report file pass when executed from the original workspace. This failure
is not suppressed or replaced with a new historical digest, and the 34-test
result is not described as the full release gate.

Clean installation, dependency graph, existing advisory gate, production audit,
lint, typecheck and verified build pass on the current patched graph. The same
three pre-existing development advisory exceptions remain; lint reports 21
pre-existing warnings and no errors. Full release/coverage/browser integration
for the patched graph is still blocked by historical replay migration and the
separate public producer access failure.

This packet establishes new execution from supplied coordinate bytes. It does
not establish original prediction provenance, biological roles, eligibility,
independent groups, pre-label chronology or predictive accuracy. `SHA256SUMS`
binds every retained packet file except itself.
