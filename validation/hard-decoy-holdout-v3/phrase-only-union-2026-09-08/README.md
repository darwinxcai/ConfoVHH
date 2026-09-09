# Phrase-only metadata union: chunks 000–002

This receipt binds three retained operational packets to the original 12,262-identifier phrase-only membership and the unchanged metadata query. The packet inventories are disjoint and exactly equal saved lexical ordinals 0–749. Together they contain 750 complete entry inventories and 1,214 polymers. The remaining 11,512 identifiers refer only to this pinned phrase-only membership; broader discovery remains incomplete.

The two new packets contributed 500 entries and 765 polymers. Each made 20 successful metadata requests across two repeats, with no failures, missing entries, incomplete polymer inventories or repeat disagreements. Chunk 000 uses its reviewed `75aa996…` snapshot, while preserving its original source, captures and earlier snapshot. No packet was modified to construct this union. Capture timestamps remain in each packet's immutable records.

There are 89 review-queue entities and 47 entities requiring missing-sequence, noncanonical-sequence or engine-error review. These are separate, potentially overlapping categories, not extra entries or independent groups. The latter count does not mean that 47 sequences are absent. Three numbered-heavy-domain calls occur across chunks 000–002. These are review signals, not VHH identity, receptor-binding role, eligibility or independence decisions; zero such calls in chunk 002 does not establish absence.

Each packet's remaining count of 12,012 subtracts that packet alone. The union count of 11,512 is recomputed from the disjoint identifier sets, not obtained by adding packet-local remaining counts. Complete polymer inventories establish only metadata accounting, not biological or discovery completeness.

`summary.json` retains exact original-membership, query, collector, packet-plan and snapshot artifact hashes. Snapshot manifests bind the remaining derived files; capture bindings bind immutable capture records, which bind raw responses. No coordinates, poses, contact tables, labels, prediction outputs or article bodies were accessed. No formal dispositions or independent eligible groups were added, and predictive accuracy remains unmeasured.

Run `node --test tests/hard-decoy-v3-phrase-only-union.test.mjs` to verify the evidence bindings, exact offline replay of chunks 001 and 002, denominator accounting, and duplicate/omission rejection. The existing chunk collector test verifies the original chunk and its legacy provenance. Restore the global-text artifacts first on a fresh checkout using `node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs`.
