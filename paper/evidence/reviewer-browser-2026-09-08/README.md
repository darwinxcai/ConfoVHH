# Automated synthetic browser execution, 8 September 2026

The documented reviewer workflow completed in Chromium 149.0.7827.0 and
Node 24.19.0 against the built production application. Both arbitrary alanine
examples were uploaded through the browser and their reports downloaded.
The audit button required role confirmation for each input; replacing the input
cleared the earlier confirmation. The near example displayed 10 contact pairs;
the separated example displayed zero. PAE, pLDDT, and CDR annotations were
unavailable. No off-origin requests or page errors were observed during navigation
and the workflow.

`execution.json` binds the test, interface source, browser configuration, verifier
and QA dependency lockfile to their SHA-256 identities and records the base URL
and browser project. These are local source identities; the receipt does not
attest the complete served build. `receipt.json` is the generator receipt;
the `synthetic-*.audit.json` files are its unmodified reference reports.
`browser-*.json` are the downloaded browser exports. The comparison required
all semantic fields to match except the export timestamp, including exact input
identity, roles, policy, measurements, and missingness. It uses the production
import validator and regenerates the synthetic reference locally.

Replay the preserved report comparison from the repository root:

```bash
node scripts/paper/verify-reviewer-exports.mjs \
  --example=paper/evidence/reviewer-browser-2026-09-08 \
  --near=paper/evidence/reviewer-browser-2026-09-08/browser-near.json \
  --separated=paper/evidence/reviewer-browser-2026-09-08/browser-separated.json
```

To repeat the actual browser actions, install application and QA dependencies,
install the QA Chromium runtime, build the application, then run:

```bash
npm --prefix qa test -- --grep 'paper reviewer workflow'
```

The ordinary hosted browser gate includes this test. Fresh execution artifacts
are written to its `qa/test-results` directory. The preserved local execution
used an externally supplied Chromium executable through the existing
`CONFOVHH_CHROMIUM_EXECUTABLE` option because the standard browser download was
unavailable. Hosted CI uses its pinned Playwright browser distribution.

This is implementation-assisted automated software verification. No participant
was recruited or authenticated, no independent researcher completion was
established, and no real research input, prediction, holdout label or biological
endpoint was used. The synthetic contact counts are test observations only.
