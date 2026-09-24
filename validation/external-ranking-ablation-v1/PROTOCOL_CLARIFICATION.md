# Notation clarification

Q means `mean((maxPositivePairOverlap / 0.6)^2)`, not `mean(maxPositivePairOverlap^2) / 0.6`. This is the unchanged formula in the prior GitHub module, scoring adapter, scoring receipt and original protocol's linked implementation. This note clarifies the original prose; it changes no code, rank, threshold, or planned endpoint. Added during independent code review, after score sealing and before the reference analysis was run. The original protocol and its checksum remain intact.
