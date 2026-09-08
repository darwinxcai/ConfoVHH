#!/usr/bin/env python3
"""Run the unmodified pinned Boltz parser on generated synthetic input only.

No native-input option, chemical-cache load, model checkpoint, or inference is
supported. ``verify`` checks the retained synthetic receipt using stdlib only;
it does not rerun Boltz. ``run`` needs the parser dependencies and both wheels.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import platform
import sys
import zipfile

WHEELS = {
    "boltz": "b8c62bbdede1922931d9203118f62c858f11aa699bf91fd4c05a5ed6a6d8b4fc",
    "gemmi": "305489477e80c6453d7a48ba78cde3e7496825ee54546bc25fcd2a900ed8d958",
}
ATOMS = {
    "ALA": "N CA C O CB".split(),
    "CYS": "N CA C O CB SG".split(),
    "ARG": "N CA C O CB CG CD NE CZ NH1 NH2".split(),
    "GLY": "N CA C O".split(),
}
RESIDUES = ["ALA", "CYS", "ARG", "GLY"]
AUTHOR_IDS = [10, 14, 19, 20]
STATUS = "OFFICIAL_BOLTZ_SYNTHETIC_SCHEMA_PARSE_VERIFIED"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n")


def fixture():
    """Intentionally nonphysical points with one missing atom and a naming swap."""
    lines = ["HEADER    SYNTHETIC PARSER TEST ONLY".ljust(80),
             "SEQRES   1 X    4  ALA CYS ARG GLY".ljust(80)]
    observed = {}
    serial = 0
    for i, (residue, author_id) in enumerate(zip(RESIDUES, AUTHOR_IDS)):
        for j, atom in enumerate(ATOMS[residue]):
            if (residue, atom) == ("CYS", "SG"):
                continue
            point = [float(10 * i), float(j), 0.0]
            if residue == "ARG" and atom in {"CD", "NH1", "NH2"}:
                point = [{"CD": 20.0, "NH1": 25.0, "NH2": 21.0}[atom], 0.0, 0.0]
            observed[(i, atom)] = point
            serial += 1
            x, y, z = point
            lines.append(f"ATOM  {serial:5d} {atom:^4s} {residue:3s} X{author_id:4d}    "
                         f"{x:8.3f}{y:8.3f}{z:8.3f}{1:6.2f}{20:6.2f}          {atom[0]:>2s}  ")
    return "\n".join(lines + ["TER", "END"]) + "\n", observed


def expected_features():
    _, observed = fixture()
    rows = []
    for i, residue in enumerate(RESIDUES):
        for name in ATOMS[residue]:
            source = {"NH1": "NH2", "NH2": "NH1"}.get(name, name) if residue == "ARG" else name
            present = (i, name) in observed
            rows.append({"residue_index": i, "residue_name": residue, "atom_name": name,
                         "is_present": present, "coords": observed.get((i, source), [0.0, 0.0, 0.0])})
    return {"parsed_chain": "X1", "sequence": "ACRG", "residue_count": 4,
            "atom_slots": 26, "present_atoms": 25, "atoms": rows,
            "template_records": [{"query_chain": "Q", "template_chain": "X1",
                                  "query_indices": [1, 2, 3, 4], "template_indices": [0, 1, 2, 3]}]}


def verify(out):
    receipt = json.loads((out / "receipt.json").read_text())
    require(receipt.get("status") == STATUS, "synthetic parser execution did not pass")
    require(receipt.get("scope") == "synthetic_only", "wrong receipt scope")
    require(receipt.get("script_sha256") == sha(__file__), "runner source changed")
    require(receipt.get("wheel_sha256") == WHEELS, "wrong wheel provenance")
    require(receipt.get("official_parser_executed") is True, "official parser not executed")
    require(receipt.get("native_templates_checked") == 0 and receipt.get("inference_runs") == 0,
            "synthetic receipt cannot grant native parsing or inference authority")
    require(receipt.get("runtime", {}).get("boltz_version") == "2.2.1", "unexpected parser version")
    expected_files = {"synthetic.pdb", "missing-seqres.pdb", "features.json", "ccd-manifest.json", "parser.log"}
    require(set(receipt.get("outputs_sha256", {})) == expected_files, "receipt output inventory differs")
    require({p.name for p in out.iterdir()} == expected_files | {"receipt.json"}, "unexpected fixture artifacts")
    for name, digest in receipt["outputs_sha256"].items():
        require(not (out / name).is_symlink() and sha(out / name) == digest, f"output hash mismatch: {name}")
    require((out / "synthetic.pdb").read_text() == fixture()[0], "fixture differs from generated synthetic input")
    require(json.loads((out / "features.json").read_text()) == expected_features(), "processed feature/mapping mismatch")
    controls = receipt.get("negative_controls", [])
    require({r["name"] for r in controls} == {"author_chain_instead_of_parsed_subchain", "unknown_query_chain", "missing_seqres"},
            "missing negative controls")
    require(len(controls) == 3 and all(r["status"] == "EXPECTED_REJECTION" for r in controls), "negative control did not reject")
    return receipt


def prohibit_network_and_processes(event, args):
    if event in {"socket.connect", "socket.connect_ex", "socket.getaddrinfo", "subprocess.Popen", "os.system", "os.posix_spawn"}:
        raise RuntimeError(f"synthetic parser smoke forbids external activity: {event}")


def checked_imports(boltz_wheel, gemmi_wheel):
    for name, wheel in (("boltz", boltz_wheel), ("gemmi", gemmi_wheel)):
        require(sha(wheel) == WHEELS[name], f"{name} wheel hash mismatch")
    import boltz
    import gemmi
    import torch
    from rdkit import Chem
    from boltz.data.parse.schema import parse_boltz_schema
    # Dependency imports may probe the CPU toolchain. Only parser execution is
    # under this guard; this is not a claim to sandbox package initialization.
    sys.addaudithook(prohibit_network_and_processes)
    require(importlib.metadata.version("boltz") == "2.2.1", "unexpected installed Boltz")
    require(gemmi.__version__ == "0.6.5", "unexpected installed Gemmi")
    require(torch.version.cuda is None, "use a CPU-only PyTorch wheel")
    package = Path(boltz.__file__).resolve().parent
    sources = {}
    with zipfile.ZipFile(boltz_wheel) as wheel:
        for name in sorted(wheel.namelist()):
            if name.startswith("boltz/") and name.endswith(".py"):
                content = wheel.read(name)
                installed = package / name.removeprefix("boltz/")
                require(installed.read_bytes() == content, f"installed Boltz source differs: {name}")
                sources[name] = hashlib.sha256(content).hexdigest()
    with zipfile.ZipFile(gemmi_wheel) as wheel:
        native = [name for name in wheel.namelist() if name.endswith(".so")]
        require(len(native) == 1 and wheel.read(native[0]) == Path(gemmi.__file__).read_bytes(),
                "installed Gemmi native module differs from pinned wheel")
    return Chem, parse_boltz_schema, sources


def synthetic_components(Chem):
    molecules, manifest = {}, {}
    for letter in "ACRGV":
        molecule = Chem.MolFromSequence(letter)
        conformer = Chem.Conformer(molecule.GetNumAtoms())
        conformer.SetProp("name", "Ideal")
        atoms = []
        for atom in molecule.GetAtoms():
            name = atom.GetPDBResidueInfo().GetName().strip()
            atom.SetProp("name", name)
            coords = [float(atom.GetIdx()), 0.0, 0.0]
            conformer.SetAtomPosition(atom.GetIdx(), coords)
            atoms.append({"name": name, "element": atom.GetAtomicNum(), "synthetic_conformer": coords})
        molecule.AddConformer(conformer)
        residue = molecule.GetAtomWithIdx(0).GetPDBResidueInfo().GetResidueName()
        molecules[residue] = molecule
        manifest[residue] = atoms
    return molecules, manifest


def processed_features(target):
    template = target.templates["synthetic"]
    require(len(template.chains) == 1, "expected one parsed template chain")
    rows = []
    for residue in template.residues:
        start, count = int(residue["atom_idx"]), int(residue["atom_num"])
        for atom in template.atoms[start:start + count]:
            rows.append({"residue_index": int(residue["res_idx"]), "residue_name": str(residue["name"]),
                         "atom_name": str(atom["name"]), "is_present": bool(atom["is_present"]),
                         "coords": [float(v) for v in atom["coords"]]})
    mappings = [{"query_chain": r.query_chain, "template_chain": r.template_chain,
                 "query_indices": list(range(r.query_st, r.query_en)),
                 "template_indices": list(range(r.template_st, r.template_en))} for r in target.record.templates]
    return {"parsed_chain": str(template.chains[0]["name"]),
            "sequence": "".join({"ALA": "A", "CYS": "C", "ARG": "R", "GLY": "G"}[str(r["name"])] for r in template.residues),
            "residue_count": len(template.residues), "atom_slots": len(template.atoms),
            "present_atoms": int(template.atoms["is_present"].sum()), "atoms": rows, "template_records": mappings}


def run(out, boltz_wheel, gemmi_wheel):
    require(not out.exists(), "output must be a fresh directory")
    Chem, parse_schema, sources = checked_imports(boltz_wheel, gemmi_wheel)
    ccd, manifest = synthetic_components(Chem)
    out.mkdir(parents=True)
    text, _ = fixture()
    pdb = out / "synthetic.pdb"
    pdb.write_text(text)
    missing = out / "missing-seqres.pdb"
    missing.write_text("\n".join(line for line in text.splitlines() if not line.startswith("SEQRES")) + "\n")
    write_json(out / "ccd-manifest.json", {"source": "RDKit MolFromSequence; artificial conformer; no production CCD cache", "components": manifest})

    def parse(path=pdb, query_chain="Q", template_chain="X1"):
        document = {"version": 1, "sequences": [{"protein": {"id": "Q", "sequence": "VACRGV", "msa": "empty"}}],
                    "templates": [{"pdb": str(path.resolve()), "chain_id": query_chain, "template_id": template_chain}]}
        return parse_schema("synthetic_smoke", document, ccd, boltz_2=True)

    log = io.StringIO()
    with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        features = processed_features(parse())
        require(features == expected_features(), "official parser synthetic features differ from independent expectation")
        controls = []
        for name, args in [
            ("author_chain_instead_of_parsed_subchain", {"template_chain": "X"}),
            ("unknown_query_chain", {"query_chain": "Z"}),
            ("missing_seqres", {"path": missing}),
        ]:
            try:
                parse(**args)
            except (ValueError, IndexError, KeyError) as exc:
                controls.append({"name": name, "status": "EXPECTED_REJECTION", "exception": type(exc).__name__, "message": str(exc).replace(str(out.resolve()), "<synthetic-output>")})
            else:
                raise ValueError(f"negative control unexpectedly accepted: {name}")
    (out / "parser.log").write_text(log.getvalue().replace(str(out.resolve()), "<synthetic-output>"))
    write_json(out / "features.json", features)
    receipt = {
        "schema": "confovhh.boltz-synthetic-parser.v1", "status": STATUS, "scope": "synthetic_only",
        "official_parser_executed": True, "native_templates_checked": 0, "inference_runs": 0,
        "runtime": {"python": platform.python_version(), "platform": sys.platform, "machine": platform.machine(), "boltz_version": importlib.metadata.version("boltz"),
                    "packages": sorted([[d.metadata["Name"], d.version] for d in importlib.metadata.distributions()])},
        "wheel_sha256": WHEELS, "boltz_sources_sha256": sources, "script_sha256": sha(__file__),
        "negative_controls": controls,
        "checks": ["official PDB loader and complete schema parser executed without modification", "PDB author numbering gaps produce four sequence positions",
                   "query offset 1 maps to template offset 0", "PDB chain X becomes parsed subchain X1", "missing CYS SG remains masked with zero placeholder",
                   "ARG NH1/NH2 naming correction detected; remaining coordinates preserved"],
        "limits": ["Synthetic parsing only: the prepared 275-residue native templates were not opened or validated.",
                   "Synthetic RDKit canonical molecules and artificial conformers replace a production chemical-component cache.",
                   "This is a partial parser environment, not a complete Boltz prediction environment or container pin.",
                   "No model checkpoint, cached MSA, model features, native poses, contacts, prediction outputs or inference were accessed.",
                   "The Python audit hook rejects network/process calls during the smoke; it is not an operating-system sandbox."],
        "outputs_sha256": {p.name: sha(p) for p in sorted(out.iterdir())},
    }
    write_json(out / "receipt.json", receipt)
    verify(out)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["run", "verify"])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--boltz-wheel", type=Path)
    parser.add_argument("--gemmi-wheel", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "run":
            require(args.boltz_wheel and args.gemmi_wheel, "run requires both pinned wheels")
            run(args.out, args.boltz_wheel, args.gemmi_wheel)
        else:
            verify(args.out)
    except (ValueError, ImportError, OSError, KeyError, RuntimeError) as exc:
        print(json.dumps({"status": "BLOCKED_OR_FAILED", "official_parser_success_claimed": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({"status": "SYNTHETIC_PARSER_RUN_PASSED" if args.action == "run" else "RETAINED_SYNTHETIC_RECEIPT_VERIFIED_PARSER_NOT_RERUN", "native_templates_checked": 0, "inference_runs": 0}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
