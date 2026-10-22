#!/usr/bin/env python3
"""Verify the Gemmi conversion used by the pinned Boltz PDB loader.

This exercises Gemmi, not the full Boltz parser, chemical cache or inference.
Two failing metadata controls remain in the output alongside corrected CIFs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import zipfile

import gemmi

WHEEL_PINS = {
    "boltz": "b8c62bbdede1922931d9203118f62c858f11aa699bf91fd4c05a5ed6a6d8b4fc",
    "gemmi": "305489477e80c6453d7a48ba78cde3e7496825ee54546bc25fcd2a900ed8d958",
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identities(structure):
    return [(chain.name, residue.seqid.num, residue.name, atom.name,
             atom.element.name, atom.pos.x, atom.pos.y, atom.pos.z)
            for chain in structure[0] for residue in chain for atom in residue]


def convert(path, destination):
    structure = gemmi.read_structure(str(path))
    structure.setup_entities()
    # Match the subchain naming performed by Boltz 2.2.1 parse/pdb.py.
    counts, rename = {}, {}
    for chain in structure[0]:
        counts[chain.name] = 0
        for residue in chain:
            if residue.subchain not in rename:
                counts[chain.name] += 1
                rename[residue.subchain] = chain.name + str(counts[chain.name])
            residue.subchain = rename[residue.subchain]
    for entity in structure.entities:
        entity.subchains = [rename[subchain] for subchain in entity.subchains]
    before = identities(structure)
    structure.make_mmcif_document().write_file(str(destination))
    converted = gemmi.make_structure_from_block(gemmi.cif.read(str(destination))[0])
    require(before == identities(converted), "Conversion changes coordinate/atom identities")
    return converted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--templates", type=Path, required=True)
    parser.add_argument("--boltz-wheel", type=Path, required=True)
    parser.add_argument("--gemmi-wheel", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    require(gemmi.__version__ == "0.6.5", "Unexpected Gemmi version")
    for name, path in [("boltz", args.boltz_wheel), ("gemmi", args.gemmi_wheel)]:
        require(sha(path) == WHEEL_PINS[name], f"{name} wheel hash mismatch")
    with zipfile.ZipFile(args.gemmi_wheel) as wheel:
        native_modules = [name for name in wheel.namelist() if name.endswith(".so")]
        require(len(native_modules) == 1, "Unexpected Gemmi native-module inventory")
        require(wheel.read(native_modules[0]) == Path(gemmi.__file__).read_bytes(),
                "Imported Gemmi differs from the pinned wheel")
    with zipfile.ZipFile(args.boltz_wheel) as wheel:
        loader_hash = hashlib.sha256(wheel.read("boltz/data/parse/pdb.py")).hexdigest()
        polymer_hash = hashlib.sha256(wheel.read("boltz/data/parse/mmcif.py")).hexdigest()
    mask_path = args.templates / "shared-residue-atom-mask.json"
    mask = json.loads(mask_path.read_text())
    expected = [row["component"] for row in mask]
    require(len(mask) == 275 and sum(len(row["atom_names"]) for row in mask) == 2155,
            "Unexpected matched cohort")
    args.out.mkdir(parents=True, exist_ok=False)
    results, controls = [], []
    for reference in ("3P0G", "5JQH"):
        source = args.templates / f"{reference}_shared_receptor_template.pdb"
        converted = convert(source, args.out / f"{reference}_gemmi_converted.cif")
        require(len(converted.entities) == 1, "Expected one polymer entity")
        entity = converted.entities[0]
        require(list(entity.full_sequence) == expected, "Converted sequence differs from shared mask")
        require(len(converted[0]) == 1 and len(converted[0][0]) == 275,
                "Converted polymer coverage differs")
        atoms = identities(converted)
        require(len(atoms) == 2155, "Converted atom coverage differs")
        polymer = converted[0][0].get_polymer()
        alignment = gemmi.align_sequence_to_polymer(entity.full_sequence, polymer,
                     entity.polymer_type, gemmi.AlignmentScoring())
        require(alignment.match_string == "|" * 275, "Sequence/polymer alignment differs")
        results.append({"reference": reference, "input_sha256": sha(source),
                        "residues": 275, "atoms": 2155, "sequence_matches_shared_mask": True,
                        "sequence_polymer_alignment": alignment.match_string,
                        "all_atom_identities_and_coordinates_preserved": True,
                        "converted_author_chain": converted[0][0].name,
                        "converted_subchains": list(entity.subchains)})
        lines = source.read_text().splitlines(keepends=True)
        for name, text in [
            ("missing_seqres", "".join(line for line in lines if not line.startswith("SEQRES"))),
            ("unpadded_seqres", "".join(line.rstrip() + "\n" if line.startswith("SEQRES") else line for line in lines)),
        ]:
            negative = args.out / f"{reference}_{name}.pdb"
            negative.write_text(text)
            bad = convert(negative, args.out / f"{reference}_{name}.cif")
            actual_sequence = list(bad.entities[0].full_sequence)
            require(actual_sequence != expected, "Negative metadata control unexpectedly passed")
            controls.append({"reference": reference, "control": name,
                             "input_sha256": sha(negative), "expected_sequence_residues": 275,
                             "observed_sequence_residues": len(actual_sequence),
                             "status": "EXPECTED_SEQUENCE_MISMATCH"})
    receipt = {
        "schema": "confovhh.gpcr-template-gemmi-conversion.v1",
        "status": "GEMMI_CONVERSION_VERIFIED_FULL_BOLTZ_PARSE_NOT_PERFORMED",
        "runtime": {"python_version": platform.python_version(), "gemmi_version": gemmi.__version__,
                    "gemmi_native_module_sha256": sha(gemmi.__file__)},
        "wheel_sha256": WHEEL_PINS, "script_sha256": sha(__file__),
        "boltz_loader_source_sha256": loader_hash, "boltz_polymer_source_sha256": polymer_hash,
        "shared_mask_sha256": sha(mask_path), "templates": results, "negative_controls": controls,
        "full_boltz_parser_executed": False, "inference_runs": 0,
        "limits": ["Replays only the pinned loader's Gemmi PDB-to-mmCIF conversion, not parse_mmcif or parse_boltz_schema.",
                   "Full Boltz parsing additionally needs its dependencies and verified chemical-component cache.",
                   "The official polymer parser inserts absent atom slots and may swap arginine NH1/NH2 coordinates; processed features still require verification.",
                   "No actual query/template feature mapping or inference is claimed."],
        "outputs_sha256": {p.name: sha(p) for p in sorted(args.out.iterdir())},
    }
    (args.out / "conversion-verification.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("GPCR TEMPLATE CONVERSION OK: 2 templates; 275 residues and 2155 atoms each; 4 negative controls detected")


if __name__ == "__main__":
    main()
