# ConfoVHH independent hard-decoy protocol v3

Status: **design selected; oracle request not frozen; target census remains below the prespecified minimum; no holdout DockQ/CAPRI label or performance result accessed**.

Version 3 is a new protocol. It does not mutate, reopen, or supersede the terminal
`TARGET_CENSUS_BLOCKED` record under `validation/hard-decoy-holdout-v2/`.
The public product and every frozen v0.5 scientific-engine artifact remain
unchanged. Version 3 resolves one contradiction in v2: native-contact epitope
disjointness is certified by a noninteractive one-way coordinate oracle rather
than by a preparation module that is forbidden to read coordinates.

No generator run, native-reference opening, DockQ labeling, or benchmark
execution is authorized by this document. Execution still requires an exact
set of at least ten leakage-cleared independent groups, a complete checksummed
pre-label package, a frozen resource envelope, and explicit approval of that
package digest.

## Question and estimand

Among contact-rich candidates generated without the native receptor–VHH
relative pose, does the frozen ConfoVHH v0.5 coordinate-audit preorder enrich
DockQ-acceptable-or-better poses beyond every prespecified baseline?

The primary estimand is an equal-weight macro average over independent
receptor/VHH/native-epitope/publication components. It describes reference
similarity in this frozen benchmark only. It cannot establish binding,
affinity, specificity, signaling, conformational selectivity, membrane
compatibility, flexible docking, or nonbinder discrimination.

## Immutable ancestry

The v3 precommit must bind, without modifying:

- `HARD_DECOY_PROTOCOL.md`;
- `HARD_DECOY_PROTOCOL_V2.md`;
- the complete checksummed v2 blocked census;
- the commit-attested ConfoVHH v0.5 engine at commit
  `04c6bda2289157dd294c290609f6052aa0ef9195`, tree
  `1d0bc74ca7ca8d59de840b224e453bb61bd8e6b9`; and
- every frozen public-regression and DockQ-development artifact already bound
  by the v0.5 validation record.

Any digest mismatch terminates the v3 attempt before native access.

## Monotonic state machine

The oracle/census phase is:

`DRAFT -> ORACLE_REQUEST_FROZEN -> ORACLE_EXECUTED -> LEAKAGE_GRAPH_FROZEN`

or, when the signed oracle graph leaves fewer than ten eligible independent
components:

`ORACLE_EXECUTED -> TARGET_CENSUS_BLOCKED`

or a terminal branch:

`DRAFT -> TARGET_CENSUS_BLOCKED`

`ORACLE_REQUEST_FROZEN -> ORACLE_FAILED`

Only `LEAKAGE_GRAPH_FROZEN` may continue to:

`TARGETS_FROZEN -> CANDIDATES_FROZEN -> AUDITS_FROZEN -> PRELABEL_FROZEN -> APPROVED -> OPENED -> EXECUTED_PASS | EXECUTED_FAIL | OPENED_FAILED -> PUBLISHED`

There are no reverse transitions. A mutation, systemic oracle error, source
change, missing row, crash after native access, or attempted second execution
creates a new terminal record. It is never repaired in place.

The public state record must distinguish:

- `nativeCoordinatesAccessedByOracle`;
- `nativeCoordinatesObservedByBenchmarkTeam`;
- `nativeInterfaceDeclassifiedPrelabel`;
- `dockqLabelsAccessed`; and
- `performanceResultsAccessed`.

For a successful pre-label oracle run, only the first field is true. This is a
process-separation claim, not cryptographic proof against a malicious
privileged operator.

## Four isolated stages

### A. Metadata preparation

May read public metadata, sequences, primary publications, licenses, GPCRdb and
UniProt annotations. It may not mount native coordinates, candidate poses,
ConfoVHH results, DockQ, or label/evaluation storage.

### B. Sealed leakage oracle

May read only the frozen whole-batch request, precommitted native coordinate
files, pinned mapping/ontology data, its read-only implementation, and its
private signing/encryption material. It receives no generated pose, ConfoVHH
code or output, DockQ installation, label, or evaluation artifact.

### C. Candidate generation and ConfoVHH audit

May read sequences, frozen MSAs, generator environments, and the signed
boolean leakage result. It may not read native coordinates, hidden oracle
evidence, DockQ, or label/evaluation storage.

### D. One-time label/evaluation opening

After approval and immutable candidate/audit ledgers, this stage may decrypt
the oracle evidence, open native references, compute DockQ/CAPRI labels, and
evaluate the frozen endpoints exactly once.

## Whole-batch oracle request

One nonadaptive request must include every development and candidate node and
every candidate-development and candidate-candidate pair. A queryable oracle,
incremental target addition, or post-result follow-up is forbidden.

The request freezes:

- exact target/node IDs, roles, receptor/VHH entities, assembly, model and
  chain-copy selectors;
- source URL, retrieval UTC, byte length, SHA-256, license and response
  metadata for every coordinate and annotation input;
- exact receptor construct, canonical receptor, concatenated canonical TM1–TM7
  and VHH sequences plus SHA-256;
- exact IMGT numbering, framework/CDR sequences, known parent/variant evidence,
  publication identities and construct/fusion annotations;
- a pinned GPCRdb snapshot, construct-to-canonical alignment, generic-position
  mapping and fixed region-token ontology;
- parser, modified-residue, alternate-conformer, occupancy, insertion-code,
  assembly-operation, malformed-record and resource-limit policies;
- the contact, direct-interface, tokenization, overlap and graph rules below;
- the deterministic representative-selection rule;
- the complete pair manifest with no omitted or duplicate unordered pair;
- source/container/dependency/code hashes, signing-key fingerprint, encryption
  recipient, canonicalization profile and commitment domains; and
- an authorization digest distinct from the later benchmark-execution approval.

Ambiguous assembly, model, receptor chain-copy or VHH chain-copy selection
fails closed. The oracle never chooses the pair producing the most contacts.

## Native-interface rule

The isolated implementation is independent of ConfoVHH and uses:

- protein heavy atoms only; H and D are excluded;
- the exact precommitted assembly, model and chain copies;
- a native residue-pair contact when any heavy-atom distance is **<= 5.0 A**;
- a direct interface only when at least eight unique receptor–VHH residue pairs
  contact; and
- a required pinned mapping for every contacting receptor residue.

Each contacting receptor residue maps to one GPCRdb generic-position token or
one fixed, construct-aligned region token. Unknown, mixed, duplicate or
ambiguous mappings fail closed for that target. No manual side or epitope
assignment may occur after native coordinates are read.

For nonempty hidden token sets `A` and `B`:

- `intersection = |A intersect B|`;
- `union = |A union B|`;
- `minSize = min(|A|, |B|)`; and
- an epitope edge exists when `5*intersection >= 2*union` or
  `5*intersection >= 3*minSize`.

These integer comparisons are the exact Jaccard >=0.40 and containment >=0.60
rules. Equality conservatively creates an exclusion edge. Empty, unmappable or
failed targets produce `FAIL_CLOSED`, never `NO_EDGE`.

## One-way public output

The oracle emits one fixed-schema record for every precommitted unordered pair:

- `EDGE`;
- `NO_EDGE`; or
- `FAIL_CLOSED`.

It also emits fixed-size salted commitments to hidden node and pair records, an
ordered Merkle root, request/protocol/source/code/container/mapping/ontology
digests, the distinct request-freeze authorization receipt, a monotonic sequence
number, the exact signing, encryption-recipient and precommitted-ephemeral public
key digests, the commitment and padding entropy commitments, a precommitted
transparency-service challenge, an encrypted evidence-bundle digest and byte
count, and an Ed25519 signature over restricted RFC 8785 canonical JSON.

Before label opening the oracle must not emit literal or deterministically
hashed epitope tokens, residue IDs, generic positions, contact counts,
distances, side classifications, exact Jaccard/containment values, native
coordinates, private paths, per-target timing, detailed parse errors, DockQ or
any performance field. Unsalted token hashes are forbidden because the GPCR
position universe is dictionary-reversible.

The encrypted, fixed-size-padded evidence bundle retains exact hidden token
sets, contact decisions, overlap numerators/denominators, per-target failures,
source digests and the precommitted entropy openings used to derive unique,
record-kind-separated 256-bit commitment nonces and deterministic padding. Its
header binds both the precommitted recipient and one-time ephemeral public keys.
It is encrypted to the recipient and may be decrypted only after `OPENED`.
Post-opening, an independent implementation must reproduce every target and
pair commitment, public pair decision, ordered Merkle root and entropy
precommitment.

The signature proves origin and integrity. It does not prove scientific
correctness, confidentiality, or human blindness.

## Oracle isolation and failure policy

The one-time oracle runs in a separate noninteractive VM or independent
custodian environment with:

- no TTY, shell, debugger, interactive exec, `ptrace`, core dump or crash
  upload;
- network disabled after source staging;
- an unprivileged identity, read-only code/input mounts and tmpfs scratch;
- no repository, candidate-pose, generator, ConfoVHH, DockQ or label mounts;
- one exact input allowlist and two exact outputs: signed public certificate and
  encrypted padded evidence;
- status-only stdout/stderr with no path or target-specific error; and
- an external append-only timestamp/transparency receipt.

Symlink, hardlink, traversal, duplicate-ID, duplicate-JSON-key,
noncanonical-number, nonfinite, Unicode-confusable, path/inode/TOCTOU,
source-digest, key-substitution, request-replay, transcript-truncation and
second-execution adversaries fail closed. A systemic or target-specific failure
cannot trigger interactive inspection or a same-version rerun.

## Independent-component graph and claim vocabulary

Create one union graph over every development and candidate node. Add an edge
when any rule is true:

1. identical receptor UniProt accession, or concatenated canonical TM1–TM7
   global identity >=0.40 at >=0.80 coverage of each sequence;
2. identical known VHH parent/variant provenance, or IMGT-numbered framework
   identity >=0.90 plus CDR3 global identity >=0.70 and absolute CDR3 length
   difference <=2;
3. identical primary DOI or PMID; or
4. signed oracle decision `EDGE` or `FAIL_CLOSED`.

The primary claim vocabulary is
`canonical-TM1-TM7-sequence-cluster-disjoint`,
`VHH-sequence-cluster-disjoint with known-parent veto`,
`native-epitope-oracle-disjoint`, and `publication-disjoint`. Do not claim
biological receptor-family or VHH-lineage disjointness unless source-backed
family/parent provenance independently establishes it.

Pin the alignment implementation, substitution matrix, affine-gap parameters,
tie precedence, isoform selection, TM extraction, IMGT implementation, coverage
denominators and complete symmetric matrices. Threshold equality creates an
edge. Repeat receptor exclusion at >=0.30 identity as veto-only sensitivity.

A candidate connected to any development node is excluded. Holdout nodes in
one connected component form one independent group. Repeated structures,
construct variants, subtypes above threshold, related VHHs, overlapping native
epitopes and publications remain in one component.

The primary holdout requires an exact frozen set of **at least ten** independent
components, each leakage-free from development. Fewer than ten terminates this
protocol version in `TARGET_CENSUS_BLOCKED`.

Exclude auxiliary G-protein nanobodies, anti-BRIL/anti-Fab binders,
arrestin-directed binders, same-chain receptor–VHH fusions, fusion-only
contacts, and any VHH contacting both receptor and engineered fusion. A direct
receptor–VHH interface, usable atom-level model and complete source/publication
record are mandatory.

## Representative selection

Before oracle execution, one representative per already known
receptor/VHH/publication component is chosen lexicographically by:

1. direct non-fusion receptor–VHH construct;
2. complete precommitted biological assembly and unambiguous chain copies;
3. higher-resolution experimental model;
4. fewer unresolved receptor/VHH backbone residues;
5. earlier PDB release date; and
6. bytewise PDB ID.

The oracle may merge additional components through native epitope edges but may
not select a different representative after seeing its output. If a chosen
representative fails closed, the component fails; no substitute is introduced.

## Generators and candidate population

The generator, seed, retention, resource and failure contracts remain those
frozen in v2 unless a fully checksummed v3 precommit replaces them before
`TARGETS_FROZEN`:

1. ColabFold 1.6.2 / AlphaFold-Multimer v3 at commit
   `c7d1772352cc9619df25c6d36cb0f218c0c6610e`;
2. Boltz 2.2.1 at commit
   `cb04aeccdd480fd4db707f0bbafde538397fa2ac`.

Templates and native-pose/interface feedback remain forbidden. Both learned
generators are mandatory for every target; failed attempts are retained and
never replaced. Exact OCI images, checkpoints, MSAs, commands, seeds, CUDA,
driver, framework, GPU, concurrency and resource hashes must be resolved before
target freeze.

The primary population is every pre-label eligible contact-rich output under
the v2 eligibility rule. Eligibility cannot use ConfoVHH evidence, DeltaSASA,
CDR share, producer confidence, native geometry, DockQ or CAPRI. Every attempt
reconciles exactly.

## Frozen ConfoVHH arm and baselines

Run the commit-attested v0.5 engine in a detached clean worktree, coordinate
only, with no PAE, pLDDT interpretation or ensemble recurrence. Preserve full
ties under the v2 lexicographic preorder:

1. evidence ordinal;
2. fewer severe-clash residue pairs;
3. smaller maximum overlap quantized to 0.01 A;
4. IMGT numbering available, then higher CDR-contact share;
5. more interface residue pairs; and
6. larger DeltaSASA quantized to 1 A2.

Prespecified baselines are producer within-target/generator percentile,
DeltaSASA, contact count, negative severe clashes, negative maximum overlap,
CDR-contact share, all-tied ranking and fixed-seed random permutation as a
diagnostic. No score, threshold, orientation, missing-value rule or weight may
change after opening.

## Labels, endpoints, uncertainty and gates

Pin DockQ 2.1.3 with explicit receptor:VHH mapping `AB:AB`. CAPRI/DockQ bands,
primary DockQ >=0.23 label, 0.21/0.25 sensitivities, hierarchical averaging,
tie-aware AP/AUROC/top-k/enrichment, Kendall tau-b, 10,000 paired hierarchical
bootstrap replicates, leave-one-group-out analyses, failure handling and every
scientific gate remain exactly as specified in v2 and its checksummed endpoint
contract.

At least ten independent groups must contain both classes for a ranking claim.
Every v2 integrity control remains mandatory, plus exact signed-oracle request,
certificate, encrypted-evidence, transparency-receipt and post-opening
recomputation agreement.

If any scientific gate fails, publish every result and use the v2 negative
conclusion without qualification. `nearNativeRankingValidated` remains false
after one benchmark regardless of outcome.

## Separate development evaluation

Any leakage-component-out analysis of the existing 17 development structures
is a separately preregistered **development evaluation**, not this independent
holdout. It cannot add groups, repair oracle failures, tune the frozen ordering,
or rescue a failed holdout gate. Its protocol and results must use visibly
different paths and claim flags.

## Current blocker

The immutable v2 screen recorded seven provisional groups and zero formally
cleared groups. Version 3 resolves the oracle design conflict but does not
create additional independent targets. The v3 oracle request cannot freeze
until a reproducible, archived candidate universe yields at least ten
metadata-complete provisional components, all required source/mapping records
are complete, and the independent parser/container/key ceremony is pinned.

Substantial GPU execution remains unapproved and cannot begin before those
target and pre-label gates pass.

## Allowed pre-execution statement

Until an exact request is frozen and executed successfully, the strongest
allowed statement is:

> ConfoVHH has a versioned design for a one-way native-epitope leakage oracle.
> The independent GPCR–VHH hard-decoy holdout remains unassembled and
> unexecuted because the prespecified minimum of ten leakage-cleared groups has
> not yet been met.

After a successful pre-label oracle run, the additional allowed statement is:

> Native coordinates were accessed only by a versioned, noninteractive oracle
> that released a prespecified boolean leakage matrix and cryptographic
> commitments. No native coordinates, interfaces, residue tokens, DockQ labels,
> or performance results were declassified before label opening. This is a
> process-separation claim, not proof against a malicious privileged operator.
