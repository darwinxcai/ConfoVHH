# GPR158/Nb20 bounded candidate comparison

This offline packet compares Nb20 against all 285 frozen candidate VHH profile rows and every retained domain call in six named screen inventories: GPCRdb complement, recent RCSB, annotation, global text, domain remainder and M1. Exact source hashes and every represented pair identifier are preserved. Sequence-only calls can also represent auxiliary binders, Fab domains or fused proteins; this is a search/review universe, not an eligible dataset.

Q5T848 is compared against all 287 frozen candidate receptor rows plus the separately retained DP1, proposed M1 and query-family canonical profiles. The proposed M1 reference remains unassigned to its deposited construct. Missing or unnumbered profiles remain unresolved. UniProt annotations lacking a profile are enumerated without assuming they are receptors.

The query-family self comparisons (9VOR/9VOS) are intentionally retained. Repeated entries, sequences and source epochs are not independent components. Auxiliary prostanoid exclusions are copied unchanged and no disposition or formal graph is rewritten. Negative sequence signals establish neither absence nor unrelated ancestry. Other uncollected discovery identifiers and unrecognized domains remain outside the compared profile universe.

All 30,538 metadata source rows are bound by the input hashes and a complete sorted row-identifier commitment; source inventory counts and all comparison rows are retained without duplicating the upstream metadata snapshot.

The same frozen IMGT and alignment/threshold functions are used; no coordinates, relative poses, contact tables, reference labels, prediction outputs or article bodies are read. Parent/variant provenance, construct evidence, publication-family and exposure adjudication remain separate requirements. Cleared independent groups added: zero.

Restore compressed metadata first with `node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs`, then verify with `node scripts/hard-decoy-v3/compare-mglyr-candidates.mjs verify`. Collection requires an empty output directory.
