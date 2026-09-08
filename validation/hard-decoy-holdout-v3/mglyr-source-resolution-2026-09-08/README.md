# GPR158 / Nb20 preparation and discovery-route follow-up

The authors' reported immune-library discovery route for Nb20 is now preserved
with exact primary Methods paragraphs. Exact cryo-EM receptor and Nb20 tag
constructs remain unresolved. This packet adds **zero independent eligible groups**
and changes no frozen disposition, exposure record or eligibility requirement.

The primary source is Laboute, T., Zucca, S., Sial, O. K., et al. (2026),
[*Targeting mGlyR with nanobodies for depression*](https://doi.org/10.1038/s41467-026-68339-x).
The article's permissions explicitly state [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
`source-provenance.json` retains that license text and attribution. The five
retained paragraphs have XML markup removed and whitespace normalized; their
wording is otherwise unchanged. No third-party images are reproduced.

| Source-reported fact | Exact Methods locator |
| --- | --- |
| One llama was immunized with mGlyR-expressing HEK293 membranes; its leukocytes supplied VHH cDNA. | `Sec13`, paragraph 0 |
| Amplified cDNA was cloned into pCANTAB5 for phage display. | `Sec13`, paragraph 9 |
| Mock-membrane depletion and mGlyR-membrane selection were followed by three panning rounds; 61 individual clones were screened. | `Sec14`, paragraph 0 |
| The construct Methods explicitly name Nb20 among candidates subcloned into pET28a and provide its sequence. | `Sec11`, paragraph 0 |
| General nanobody production used C-terminal c-myc/8xHis tags. | `Sec15`, paragraph 0 |

Paragraph indexes are zero-based. The 61 screened clones describe the source's
discovery workflow, not independent benchmark cases. The linked passages support
the reported immune-library origin; they do not establish complete binder ancestry
or rule out relationships to the development set or other census entries.

## Construct and access outcome

The fresh Europe PMC XML response is byte-identical to the earlier capture
(`5841cd77...90776`). Its direct preparation Methods still do not explicitly link
the deposited receptor sequence (Q5T848 residues 1–775 plus LEVLFQ) or the deposited
Nb20 N-terminal prefix to the cryo-EM reagent. The general production tags cannot
be assigned to that preparation without an explicit source link.

The legitimate [Europe PMC supplementary-file service](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12834959/supplementaryFiles)
provided a ZIP. The extracted member `41467_2026_68339_MOESM1_ESM.pdf` was
4,489,295 bytes, matching the previously declared attachment name and byte count.
Its observed SHA-256 is recorded in `retrieval-attempts.json`. Name/size agreement
is an attachment-identity observation, not verification of a previously published
checksum or validation of its scientific contents.

A conservative preparation-heading selector found no allowed Methods block in
the PDF text. Remaining text, captions, figures and tables were not reviewed.
**This does not establish that construct information is absent.** The full XML,
ZIP, PDF and extracted full PDF text are not retained in the repository.

For the cited [2022 preparation article](https://doi.org/10.1126/science.abl4732),
the fresh PMC HTML confirms the same official NIHMS supplementary DOCX link.
Its download returned challenge HTML, the conventional Science supplement URL
returned HTTP 403, and Europe PMC's supplementary API reported that article was
not open access. A heading-only scan of the main PMC HTML found no heading matching
the conservative preparation selector; no main-body paragraph was selected or read.
That selector outcome does not establish that preparation details are absent.
These are route-specific observations. No challenge was solved, and no claim of
general source unavailability is made.

The next useful primary evidence is a legitimately downloaded copy of the 2022
supplement or a successful later official download, processed for named preparation
Methods only. A source must explicitly reconcile the 2026 receptor truncation and
Nb20 N-terminal tag; their sequence pattern alone cannot do so. Global ancestry,
overlap, exposure and formal eligibility review are also still required.

## Reproducible source integrity

From the repository root:

```sh
node scripts/hard-decoy-v3/verify-mglyr-source-resolution.mjs
node --test tests/hard-decoy-v3-mglyr-source-resolution.test.mjs
```

The verifier reads only the four selected-source JSON files and the three named
prior construct-follow-up metadata files. It checks file and paragraph hashes,
claim-to-paragraph links, permitted source inventory and zero scientific authority.
It does not independently adjudicate the Methods, inspect actual structures,
reproduce supplementary-file retrieval, certify ancestry or certify independence.

To replay the extraction when the exact permitted XML response is available:

```sh
python3 scripts/hard-decoy-v3/extract-mglyr-source-methods.py permitted-article.xml new-selected-methods.json
```

This offline standard-library extractor checks the full response hash before
parsing and emits only the five fixed preparation/library paragraphs. Its output
was compared byte-for-byte with `source-blocks.json`. No network request or
supplement parsing occurs in the extractor. It refuses changed source bytes and
an existing output file. The optional extraction replay requires Python 3;
the normal Node verification and tests do not.
