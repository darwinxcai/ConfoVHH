# Official Boltz parser smoke on synthetic input

On 2026-09-08 the **unmodified Boltz 2.2.1 `parse_boltz_schema` and PDB/mmCIF
loaders executed successfully** in a partial CPU parser environment. The input
was a generated four-residue chain with deliberately nonphysical coordinates,
an omitted cysteine atom, gapped author numbers, and arginine naming that
triggers the official parser's correction. No prepared native template was
opened. No prediction ran. This receipt grants no native-template, inference,
benchmark-eligibility, or scientific-performance authority.

Retained input, observed processed atoms/masks and mappings, component manifest,
parser log, three failing controls, and software/source hashes are in
[`tests/fixtures/boltz-parser-synthetic-2026-09-08/`](../../tests/fixtures/boltz-parser-synthetic-2026-09-08/).

The official schema parser recovered the query `VACRGV` positions 1–4 (zero based)
against the template `ACRG` positions 0–3, retained four residues despite author
numbers 10/14/19/20, inserted one masked zero-coordinate slot for absent CYS SG,
and exchanged the two ARG NH1/NH2 coordinate assignments as specified by the
official parser. It returned 26 atom slots with 25 present atoms. All other
synthetic atom coordinates matched the independent fixture expectation.

**PDB author chain `X` became parsed subchain `X1`.** A schema referring to `X`
was rejected; `X1` succeeded. The production preparation code previously emitted
the `cif` schema key even for a PDB path. It now dispatches `.pdb` through `pdb`
and `.cif`/`.mmcif` through `cif`, rejects other extensions, and preserves explicit
chain pins. Do not infer a real parsed chain by appending `1`: actual parsed-chain
evidence matching the pinned input is still required before any real job runs.
Frozen inputs and provenance are not rewritten by this change.

## Lightweight offline verification

These commands require only Node and Python's standard library. They validate
the retained receipt, reject altered masks/mappings/coordinates and accidental
authority promotion, and test PDB/CIF format dispatch. They do **not** execute
Boltz again:

```bash
python3 -B scripts/paper/boltz-parser-smoke.py verify \
  --out tests/fixtures/boltz-parser-synthetic-2026-09-08
node --test tests/paper-boltz-parser.test.mjs tests/gpcr-paper-boltz.test.mjs
```

## Repeat the actual official parser execution

Use Python 3.12 on Linux x86-64. An isolated environment avoids changing the
project's runtime. Package downloads are free software downloads; no checkpoint,
chemical-component archive, MSA retrieval, or model execution occurs.

```bash
python3.12 -m venv /tmp/confovhh-parser-replay-env
/tmp/confovhh-parser-replay-env/bin/python -m pip download --no-deps \
  boltz==2.2.1 gemmi==0.6.5 -d /tmp/confovhh-parser-replay-wheels
/tmp/confovhh-parser-replay-env/bin/python -m pip install --no-deps \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  -r scripts/paper/boltz-parser-requirements.txt
/tmp/confovhh-parser-replay-env/bin/python -B scripts/paper/boltz-parser-smoke.py run \
  --boltz-wheel /tmp/confovhh-parser-replay-wheels/boltz-2.2.1-py3-none-any.whl \
  --gemmi-wheel /tmp/confovhh-parser-replay-wheels/gemmi-0.6.5-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl \
  --out /tmp/confovhh-parser-replay-result
```

The output directory must not exist. Require exit zero and
`SYNTHETIC_PARSER_RUN_PASSED`. Wrong wheel bytes, imports, features, masks,
mappings, or negative controls fail closed. The runner checks all installed
Boltz Python sources against the pinned wheel and the Gemmi native module
against its pinned wheel. The receipt records every installed package version.
The remaining dependencies are version pinned, not wheel-hash locked; this is
not a complete immutable prediction runtime. RDKit creates the synthetic
canonical molecules and artificial conformers locally, with no production CCD
cache. A Python audit hook rejects network/process calls after imports and
through parser execution; it is not an OS sandbox.

The prepared real templates still need authorized parser checks using verified
production components and their declared mappings/atom masks. Full cached MSAs,
runtime/checkpoint/cache verification and a successful prediction smoke remain
separate blockers. This synthetic receipt does not satisfy the existing runner's
job-specific `template_parse_evidence` gate.

Primary implementation inspected: the exact Boltz wheel recorded in the receipt;
corresponding [official parser source](https://github.com/jwohlwend/boltz/tree/cb04aeccdd480fd4db707f0bbafde538397fa2ac/src/boltz/data/parse).
