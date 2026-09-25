# Experimental contact evidence addendum

This prediction-only method recovers the existing CDR contact share when a valid coordinate input lacks a bound full v1 audit. It is an experimental v3 feature adapter; production audit limits and code remain unchanged. No SASA, burial, affinity, binding-energy or outcome value is inferred from contact-only evidence.

`contact-only.mjs` verifies the entire frozen engine lock, exact `lib/confovhh.ts` SHA256 and the resolved frozen immunum dependency. It derives a temporary TypeScript module from the unchanged source prefix through both CDR share calculations, stopping at the unique `const interfaceConfidenceValues` anchor. The exported function name and relative import locations are adapted, then a minimal return is appended. All original scientific expressions, deterministic atom ordering, spatial traversal, residue-pair deduplication, coordinate bounds, numbering semantics, 5-million candidate-pair guard and 50,000 unique-pair guard remain present. The original 12,000-atom full-audit wrapper limit is not applied by this separate contact phase; no production limit is raised. All parsed selected-role atoms remain intact with no additional trimming. The frozen parser still applies its existing hydrogen, occupancy, conformer and model policies; raw coordinates and fixed selected chains/model are preserved.

Contacts include exactly those parsed selected-chain heavy atom pairs with distance at most 4.5 Å. P counts numbered CDR1–3 contacting residue pairs divided by every contacting residue pair, including framework and unnumbered residues. Zero contacts or unavailable numbering yields null P. Frozen source-index numbering maps and contact IMGT positions/regions are retained. The report exposes the same numbering summary as the full audit plus complete contact records, atom-contact count, N, P and CDR3 share. Framework and unnumbered decomposition is diagnostic and does not change the denominator or ranking formula.

A bound full audit remains authoritative, including when its P is null. Full audit hash, coordinate/model, chain-role or contact mismatch aborts scoring; it never activates recovery. For valid inputs with an absent full audit, contact-phase failure is explicit optional-feature unavailability, and the source-first policy retains its prescribed source-block fallback. The original v1 failure/status reason remains saved separately. No-contact remains a valid input and gets explicit no-contact metadata.

Every v3 feature now carries `contactEvidence`, either null or `{kind, sha256}`. `full-audit` must bind the existing `sourceAuditSha256`. `standalone-contact` requires `sourceAuditSha256: null` and valid geometry. Available CDR requires evidence and exact component agreement. Existing historical receipt files are preserved; the extended contract applies only to newly replayed v3 receipts.

The receipt inventory contains twelve files, adding `contact-evidence.json`. This is an array of standalone report entries with fields:

```text
schema: confovhh-standalone-contact-evidence-v1
id, setId, coordinateSha256, sourceScoreReceiptSha256
receptorChain, vhhChain, selectedModelId
fullAuditDisposition: {status: absent, sourceAttemptStatus, reason}
method: frozen source, lock, scientific prefix, adapter hashes and guard metadata
status: computed | unavailable
reason: empty if computed, explicit failure otherwise
contact: {contactPairCount, atomContactCount, paratopeProxyShare,
          cdr3ProxyShare, vhhNumbering, contacts} | null
```

The feature binds each entry using SHA256 of the UTF-8 bytes `JSON.stringify(entry) + '\n'`; the outer receipt binds the full saved aggregate file. Use the JS helper rather than recreating JavaScript number serialization in another language.

`verify-contact-evidence.mjs --artifacts ROOT --receipt RECEIPT` checks the exact twelve-file inventory and current implementation/method, authenticates all standalone entry/feature/coordinate/role/model bindings and original absent-audit reasons, recomputes every standalone entry from prediction coordinates, and reproduces saved ranks/blocks. It accepts no outcome file. The development calibration runner invokes this replay before opening any outcome map. The calibration grid, source directions, anchored tie blocks, safety rule and group holdouts are unchanged; a selected tolerance remains a development-selected tolerance, not measured confidence uncertainty.

Validation before fresh-label access: 995 historical predictions, 50 fresh development smoke predictions and 20 prospective smoke predictions. All 1,058 available full audits match exactly on every shared contact/numbering field and decomposition; the seven prospective cases without full audits yield separate contact evidence. Frozen original smokes, earlier preparation records and v1 ranks remain saved. See execution-root `round3-ranking/contact-only-validation/crosscheck.json` and the immutable implementation freeze for identities and test results. This is feature-consistency evidence; it does not establish improved ranking accuracy.
