# Review-exposure addendum, 7 September 2026

Status: **QUARANTINED; NO SCIENTIFIC AUTHORITY; TARGET FREEZE BLOCKED.**

Two narrow source lookups returned more prose than requested. The amylin/Nb35 lookup rendered structural Results prose for the ten-entry `10.1126/science.abm9609` family. The ADGRV1 lookup rendered a third-party snippet containing structural contact, residue-pair and prediction-output prose for 9FTE. The publisher page for the amylin article did not become available through the browser verification screen. These returns were not used to advance either source review.

`exposure-addendum.json` records the affected entry boundaries and distinguishes narrative exposure from artifacts that were not opened. In particular, no coordinate or map file, structural image, contact table, native relative pose, DockQ/CAPRI label, benchmark output or model artifact was requested or inspected. The ADGRV1 exposure extends an already active caveat; the amylin family now independently requires exposure adjudication.

The addendum deliberately does not reproduce the exposed prose. It cannot establish eligibility, binder role, construct status, a graph edge, a no-edge decision, a component count or a whole-census bound. The formally cleared independent eligible-group count remains zero and target freeze remains blocked.

Verify the bounded record and its relationship to the prior ADGRV1 exposure record with:

```bash
node scripts/hard-decoy-v3/verify-review-exposure-followup.mjs
node --test tests/hard-decoy-v3-review-exposure-followup.test.mjs
```
