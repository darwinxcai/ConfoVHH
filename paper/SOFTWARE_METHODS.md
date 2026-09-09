# Software methods: geometry evidence and pose ordering

Reviewed 8 September 2026 against source revision
`9aeadb8185a02da4e67967d9fbe12b1503d02e96`. The definitions below describe the
unchanged geometry engine 0.5.0 and shipped pose-ranking policy 0.6.0. They
document software behavior, without estimating binding, affinity, native-pose
probability, or performance on an independent biological evaluation. The
product's `supported`, `mixed`, and `limited` review tiers are not scientific
outcome labels or the reference-dependent endpoint used in the application
study. This supplement was prepared from implementation code and existing
manuscript prose; no study inputs or outcome tables were opened.

## Measurements and missing information

Measurements use the selected receptor and VHH protein-heavy-atom coordinates.
Lengths are in ångströms (Å), areas in Å², and shares are dimensionless.

| Symbol or output | Definition and relevant behavior |
|---|---|
| `C`: contacting residue pairs | Number of distinct receptor–VHH residue pairs with at least one heavy-atom distance ≤4.5 Å. Atom-contact count is a separate measurement. |
| `R`, `V`: interface residues | Number of distinct receptor and VHH residues, respectively, participating in those pairs. |
| `B`: coordinate completeness | Minimum of the two chain backbone-completeness fractions. Each fraction counts observed residues containing all four atoms N, CA, C, O; it does not establish completeness against an unobserved full-length sequence. |
| `S`: severe clash pairs | Number of contacting residue pairs containing at least one noncovalent atom pair with van der Waals overlap ≥0.6 Å. Each residue pair contributes at most one count. Cys SG–SG distances from 1.8 through 2.3 Å are treated as plausible disulfides and excluded from this clash calculation. |
| `M`: maximum overlap | Maximum noncovalent van der Waals overlap, with a floor of zero. Atom overlap is the sum of the element radii minus the atom distance. The configured radii and fallback are retained in the cited source. |
| Interface burial | Protein-heavy-atom ΔSASA is the sum of the buried areas on the two chains; reported interface area is half that sum. The Shrake–Rupley approximation uses 960 sphere points per atom and a 1.4 Å probe. Exported methods identify the coordinate frame; ensemble comparisons require the verified deterministic SASA frame. Finite-grid area differences are not energy differences. |
| Interface pLDDT | Used only when `confidenceMode` is explicitly `plddt`. A residue uses its CA B-factor value, or the median available atom B-factor if the CA value is absent. Interface confidence is the median of available values over the distinct interface residues on both chains. Coverage is the available-value fraction. Any interface atom B-factor outside 0–100 invalidates the confidence summary. |
| PAE and CDR annotation | PAE requires a supplied matrix plus explicit convention/order confirmation; a matrix without confirmation, or confirmation without a matrix, is rejected. Missing PAE stays unavailable. PAE and CDR annotation do not enter the geometry-tier conditional or either ordering described here. |

## Geometry-tier decision order

The following branches are evaluated in order. A pose meeting an earlier branch
cannot be promoted by a later branch. In particular, `supported` inherits the
requirement to pass all `limited` exclusions.

| Review tier | Exact condition |
|---|---|
| `not-assessable` | `C = 0`. |
| `limited` | `C < 8`, or `R < 3`, or `V < 3`, or `B < 0.70`, or `M ≥ 1.5 Å`, or `S ≥ max(5, ceil(0.25 × C))`. |
| `supported` | After the previous exclusions: `C ≥ 18`, `R ≥ 7`, `V ≥ 6`, and `S = 0`. In `plddt` mode, additionally require no invalid confidence values, an available interface median ≥70, and confidence coverage ≥0.90. In `none` mode this confidence condition is omitted. |
| `mixed` | Any remaining pose with at least one contacting residue pair. |

Switching confidence mode can therefore affect the geometry tier. The mode must
be preserved with the report. An unavailable confidence summary in `plddt` mode
does not satisfy the confidence condition for `supported`; it is not filled in
from a producer summary score. The named tiers describe evidence under this
policy and must not be interpreted as experimentally verified binding states.

## Two different pose orders

The **decision shortlist** orders poses of the same complex lexicographically:

1. Higher carried geometry tier: `supported = 2`, `mixed = 1`, and both
   `limited` and `not-assessable = 0`.
2. Larger half-ΔSASA interface area within the same tier. The burial key is null
   if `C < 1`, either chain has fewer than three interface residues, or the area
   is missing/nonfinite. A null burial sorts after finite burial in its own
   tier. Missing/nonfinite counts are normalized to zero; an unknown tier is
   normalized to `not-assessable`. The ranking adapter does not recompute an
   otherwise recognized incoming tier.
3. `poseId.localeCompare` resolves remaining ties. The resulting positions get
   distinct one-based ranks, including otherwise tied poses. This identifier
   order is an implementation tie break, not evidence of scientific preference.

The **ensemble comparison** accepts 2–12 compatible poses and requires
coordinate-only audits with confidence mode `none`, PAE omitted, and the
verified deterministic SASA frame. It verifies a common audit policy and exact
observed receptor/VHH sequences, checks selected atom-identity
compatibility, and rejects duplicate selected geometry. Contacts are mapped by
one-based residue order within each selected chain. For each pose, it computes
mean Jaccard similarity against the other poses separately for contact-pair,
receptor-interface-residue, and VHH-interface-residue sets. Two empty sets give
an unavailable similarity. The unweighted mean of available component means
is the ensemble consensus; an entirely unavailable mean remains null.

Ensemble order is descending consensus (null after available values), then
ascending severe clash-pair count, then code-unit identifier order for display.
Consensus differences ≤`1e-12` are treated as ties. Poses tied on consensus and
clash count receive the same competition rank, so ranks can be `1, 1, 3`.
Geometry tier and burial remain visible but do not control this order. The
separately displayed recurrent-contact share uses contact pairs found in at
least `max(2, ceil(number of poses / 2))` poses; it is not the ranking key.
Recurrence remains conditional on the uploaded set and its dependencies.

## Exact implementation sources

Links below point to the inspected immutable revision. SHA-256 values identify
whole source files; the line locations identify the executable definitions used
above. Historical commentary inside a source file is not additional scientific
evidence for this supplement.

| Source | Relevant definitions | SHA-256 |
|---|---|---|
| [lib/confovhh.ts](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/lib/confovhh.ts) | Radii/SASA 485–510; disulfide/overlap 701–722; backbone completeness 1394–1396; confidence 1564–1570; PAE gate/cutoffs 1672–1684; contact/clash accumulation 1743–1789; summaries/tier branches 1823–1916 | `15f25a465e0c357a7a59c0e0d57b4e50aad76f16647dc02ab835613c33a51edf` |
| [lib/pose-evidence-v06.ts](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/lib/pose-evidence-v06.ts) | Tier map 76–83; burial assessability 220–267; comparison order 314–329 | `83bbc4c48c22eadfdf2a8a288a9a46e05315feccba80279915e74b5c469742bc` |
| [lib/pose-ranking.ts](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/lib/pose-ranking.ts) | Shipped policy 65–107; input normalization and one-based ranks 124–180 | `6f0be122edcf7e6e8a70ea0f562dc0e1aa14dff4adf19b2bf2f67794711d0911` |
| [lib/pose-ensemble.ts](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/lib/pose-ensemble.ts) | Coordinate-only policy 223–265; Jaccard/missingness 349–364; compatibility gates 590–677; consensus/recurrence/order 680–789 | `c00dc56c1e8e040ccdfa21d54901dbcfc23763a84fd480bb7deb5361d36ed86a` |
| [lib/geometry-constants.ts](https://github.com/darwinxcai/ConfoVHH/blob/9aeadb8185a02da4e67967d9fbe12b1503d02e96/lib/geometry-constants.ts) | Canonical SASA frame identifier 10–11 | `43b34e9d000aabb8656d1c431ea358834f83a4d03d11ef902be12f6fb3b2b081` |

From the repository root, this command prints the corresponding file identities:

```bash
sha256sum lib/confovhh.ts lib/pose-evidence-v06.ts lib/pose-ranking.ts lib/pose-ensemble.ts lib/geometry-constants.ts
```

These hashes bind this methods description to
source bytes; they do not validate scientific claims or replace the submitted
release's complete provenance record.
