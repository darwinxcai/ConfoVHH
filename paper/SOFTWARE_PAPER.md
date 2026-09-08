# ConfoVHH: an auditable workspace for reviewing predicted GPCR–nanobody interfaces

Darwin Cai

Software/application draft, 8 September 2026. **Not submission-ready; venue
undecided.** Author information and disclosure statements require the author's
review. This draft describes the software contribution and the already reported
retrospective application. The detailed numerical methods and results remain in
the [working application manuscript](CONFO_VHH_WORKING_MANUSCRIPT.md).

## Summary

ConfoVHH is an open-source browser application for reviewing modeled complexes
between G-protein-coupled receptors (GPCRs) and single-domain antibodies
(nanobodies or VHHs). It connects explicit chain assignment, geometric interface
measurements, antibody-region numbering, optional predicted aligned error
(PAE), compatible-pose comparison, and researcher decisions in an exportable
record. The intended user is a researcher who has generated several complex
models and needs to document what supports experimental follow-up. ConfoVHH
analyzes existing structures; its evidence summaries are not calibrated binding
or native-pose probabilities. A completed retrospective application to 165
retained GPCR prediction models demonstrates use of the unchanged workflow and
exposes limitations in its selection behavior. The contribution is an inspectable
review process, with explicit provenance and missing-evidence handling.

## Statement of need

Reviewing several predicted complexes involves decisions that can be lost when
the output is reduced to a selected image or a single confidence score. These
include which chains represent receptor and binder, whether antibody loops
participate in the interface, whether atoms interpenetrate, which receptor
surface is contacted, and whether an uncertainty matrix actually corresponds to
the coordinate residues. A later reviewer also needs to identify the exact
input, software policy, and reasoning behind an advance, hold, or exclude
decision.

ConfoVHH organizes these steps around a receptor–VHH analysis record. Its
research purpose is to make a proposed shortlist auditable across laboratory and
computational collaborators. The application does not infer a receptor's
membrane orientation or functional state. Researchers supply intended receptor
footprints, and the software reports geometric overlap with that hypothesis.
This framing permits useful inspection even when no experimental complex is
available, while preserving the distinction between modeled evidence and
experimental confirmation.

## Related software and scope of the contribution

Existing molecular tools already provide substantial relevant functionality.
Mol* offers browser-based molecular visualization with sequence navigation,
measurements, sessions, and structural superposition. It is an established
alternative for interactive structural inspection. [Mol* documentation](https://molstar.org/viewer-docs/).
ChimeraX also supports inspection of AlphaFold uncertainty and contact evidence;
its developers document filtering contact displays by distance and maximum PAE.
[ChimeraX developer documentation discussion](https://mail.cgl.ucsf.edu/mailman/archives/list/chimerax-users%40cgl.ucsf.edu/message/HTZOCMHAT222XZAHAN7GYDF5BVD3BEER/).
The present work therefore does not claim that molecular visualization, contact
analysis, or PAE display is new.

ConfoVHH's design contribution is the integration of a narrower review task:
explicit receptor/VHH roles, numbered antibody regions, correspondence checks,
two documented pose summaries, researcher-supplied footprints, and decisions
exported with source hashes and method provenance. A dedicated application
makes these choices part of one review record. Whether this integration saves
time or prevents more review errors than existing workflows remains a question
for a defined user evaluation. No comparative usability or superiority result
has been measured here.

The software reuses pinned `immunum` numbering rather than presenting antibody
numbering as a new method. Reference-dependent interface assessment in the
retrospective study uses the official DockQ implementation; it is distinct from
the application's coordinate-only evidence policy. The public repository's
[dependency notices](../THIRD_PARTY_NOTICES.md) and
[provenance record](../PROVENANCE.md) document these implementation boundaries.

## Software design

The interface is implemented in TypeScript and React. Parsing, numbering,
geometry, PAE processing, and comparison run in bounded browser Web Workers.
This separates expensive analysis from interface interaction and keeps selected
structure and PAE files in the browser session. Local processing is a deliberate
choice for researchers working with unpublished models; exported reports still
require careful sharing because they contain derived interface information and
researcher notes.

Input handling recognizes PDB and PDBx/mmCIF structures and several common
prediction-output organizations. The researcher confirms chain assignments
before analysis. Producer recognition does not substitute for checking that
coordinate, sequence, and confidence records describe the same model. Directional
PAE requires confirmation of the matrix-to-residue order. A missing matrix is
represented as unavailable, rather than replaced by a summary confidence value.
Boltz NPZ PAE remains inventory-only unless a compatible JSON representation and
residue mapping have been independently verified.

The geometry layer reports contact pairs, interface residues, severe steric
overlap, and approximate buried surface area. IMGT-numbered regions permit
inspection of CDR participation. Compatible poses can be compared for repeated
receptor contacts and VHH participation. Recurrence is conditional on the
uploaded set and its dependencies: repeated samples from one prediction job are
not independent biological observations. The pose shortlist and ensemble view
use separately documented ordering rules, so users should retain the method
identity when comparing exported ranks.

JSON, CSV, and Markdown exports retain source hashes and method provenance
alongside review decisions. Distinct product, geometry-engine, and ranking-policy
versions identify different implementation layers. This supports tracing an
analysis after later software changes. Hashes identify bytes; they neither
guarantee that the correct biological reference was selected nor make an
unavailable input publicly reproducible.

## Reuse and verification

The [repository README](../README.md) documents installation with Node.js,
dependency installation, and local execution. The bundled public demonstration
supports learning the intake, chain-confirmation, review, and export sequence
without private data. Reusers should retain their inputs with the exported
record and record the software revision. The repository provides a license,
citation metadata, issue templates, contribution instructions, and automated
release checks.

Software verification addresses parsing, geometry, role and correspondence
handling, exports, and failure behavior. Synthetic fixtures exercise adverse
conditions and numerical boundaries. Their values are test inputs, never study
observations. Browser and accessibility checks address application behavior;
they do not establish that researchers understand the outputs or make better
experimental choices. The useful acceptance test for a new analyst is completion
of a specified review workflow with the expected identities, missing-evidence
state, and exported provenance. A documented independent completion of that
workflow is still needed.

The analysis scripts accompanying the retrospective application can reconstruct
its selection summaries from retained tabular evidence. Complete public
raw-to-result replay requires additional durable access to the original
coordinate and confidence archives. A reproducibility package must state which
of these two levels it actually verifies, record dependency and input identities,
and fail visibly when a required input is missing or altered.

## Completed application and interpretation

The existing application manuscript reports 165 retained cognate predictions
from 33 five-model jobs, 15 conditions, four reference complexes, and three
receptor targets. The unchanged ConfoVHH implementation was applied to this
previously inspected development corpus and compared with official DockQ 2.1.3.
Eight of fifteen supported geometry flags occurred below DockQ 0.23. Thus a
supported flag could accompany poor recovery of the deposited interface in this
observed set.

ConfoVHH selected an acceptable model in 18 of 33 jobs, compared with 19 for a
maximum-exported-score baseline and an analytical uniform-selection expectation
of 18. Only four jobs contained candidates on both sides of the acceptability
boundary, and all four concerned the same reference, 3P0G. These results do not
support native-pose selection superiority. They demonstrate a practical use of
the software for documenting where its geometry evidence agrees or disagrees
with a reference-dependent evaluation. No policy adjustment based on these
outcomes is presented as validation.

The retained set lacks full PAE and omits coordinates for 85 additional
preliminary cognate models. Their absence is not established to be random.
The detailed manuscript also reports that agreement in one receptor distance
can coexist with poor VHH-interface recovery. Neither observation establishes
binding affinity, state selectivity, membrane compatibility, or improved
experimental decisions. All quantitative statements in this section summarize
the existing manuscript; no new native structures, prediction outputs, or
outcome tables were accessed to prepare this draft.

## Availability and remaining publication work

ConfoVHH source code is available under the MIT license at
[darwinxcai/ConfoVHH](https://github.com/darwinxcai/ConfoVHH). The current citation
metadata identifies product version 0.9.1. A submission must identify the exact
reviewed release and stable archive location. Public deposition of the raw
application inputs, redistribution terms, and the long-term availability of
those archives remain unresolved.

The [submission readiness record](SUBMISSION_READINESS.md) defines the remaining
deliverables for this software/application route. An independent hard-decoy
ranking claim would require the separate frozen protocol and its eligibility,
overlap, and exposure gates. Producing a software paper does not clear those
gates or add an independent eligible group.

## Author information and AI assistance

This draft was prepared with OpenAI Codex assistance on 8 September 2026 for
document review, source lookup, organization, and writing. This statement does
not constitute a complete project-wide AI disclosure. Before submission, the
author must reconcile the tools and model versions used across code,
documentation, and manuscript development and describe their scope. Author
review of all assisted outputs and responsibility for core design decisions
must be confirmed by the author; that confirmation is not asserted here.
Affiliation, author contributions, funding, competing interests, and the final
authorship list also remain for author completion.
