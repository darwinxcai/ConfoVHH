#!/usr/bin/env python3
"""Prepare the authorized public 3P0G development reference; never read v3 data."""
import argparse
import contextlib
import copy
import csv
import datetime
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import traceback

import numpy as np
from Bio.PDB import MMCIFParser, PDBIO, PDBParser, Select
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SeqUtils import seq1

PROTOCOL_SHA = "8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9"
FREEZE_COMMIT = "f6360771a9e341643ffbb6f51974bf7bb28eb183"
CASE_REL = Path("validation/single-case-development-3p0g-2026-09-09")
MAPPING = {"A": "A", "B": "B"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    with Path(path).open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


class ProteinAB(Select):
    def accept_model(self, model):
        return model.serial_num == 1

    def accept_chain(self, chain):
        return chain.id in MAPPING

    def accept_residue(self, residue):
        return residue.id[0] == " "

    def accept_atom(self, atom):
        return atom.element not in {"H", "D"}


def save_protein(structure, path):
    require(not path.exists(), f"Refusing overwrite: {path.name}")
    writer = PDBIO()
    writer.set_structure(structure)
    writer.save(str(path), ProteinAB(), preserve_atom_numbering=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    reference = args.reference_dir.resolve()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    receipt = {"schema": "confovhh-single-case-reference-preflight-v1", "status": "STARTED",
               "started_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "command": [sys.executable, *sys.argv], "script_sha256": sha(__file__),
               "scientific_protocol_sha256": PROTOCOL_SHA, "prior_freeze_commit": FREEZE_COMMIT,
               "scope": "Public development reference and synthetic controls only; no candidate performance or v3 execution",
               "provided_to_generator": False, "checks": []}
    native_source = reference / "3P0G.cif"
    original_digest = None
    try:
        protocol = root / CASE_REL / "protocol.json"
        require(sha(protocol) == PROTOCOL_SHA, "Frozen protocol digest mismatch")
        frozen = json.loads(protocol.read_text())
        retrieval = json.loads((reference / "retrieval.json").read_text())
        original_digest = sha(native_source)
        require(original_digest == retrieval["sha256"] and native_source.stat().st_size == retrieval["bytes"], "Reference retrieval identity mismatch")
        require(retrieval["scoring_protocol_sha256"] == PROTOCOL_SHA and retrieval["prior_local_freeze_commit"] == FREEZE_COMMIT, "Reference freeze binding mismatch")
        require(retrieval["url"] == frozen["evaluation"]["referenceUrl"], "Reference source URL mismatch")
        receipt["original_reference"] = {"path": str(native_source), "sha256": original_digest, "bytes": native_source.stat().st_size,
                                         "retrieval_receipt_sha256": sha(reference / "retrieval.json"), "retrieval": retrieval}
        metadata = {}
        receipt["metadata"] = {}
        for chain in MAPPING:
            rel = CASE_REL / "case" / f"3P0G-{chain}-label-auth-sequence.tsv"
            local = root / rel
            committed = subprocess.check_output(["git", "show", f"{FREEZE_COMMIT}:{rel.as_posix()}"], cwd=root)
            require(local.read_bytes() == committed, f"Frozen {chain} metadata changed")
            values = list(csv.DictReader(io.StringIO(committed.decode()), delimiter="\t"))
            metadata[chain] = {int(row["label_seq_id"]): row for row in values}
            receipt["metadata"][chain] = {"path": rel.as_posix(), "sha256": sha(local), "rows": len(values)}
        data = MMCIF2Dict(str(native_source))
        require(data["_entry.id"] == ["3P0G"], "Wrong PDB entry")
        rows = list(zip(*(data[key] for key in ["_atom_site.group_PDB", "_atom_site.pdbx_PDB_model_num",
            "_atom_site.label_asym_id", "_atom_site.auth_asym_id", "_atom_site.label_entity_id", "_atom_site.label_seq_id",
            "_atom_site.auth_seq_id", "_atom_site.pdbx_PDB_ins_code", "_atom_site.label_comp_id",
            "_atom_site.label_atom_id", "_atom_site.label_alt_id", "_atom_site.occupancy", "_atom_site.type_symbol",
            "_atom_site.Cartn_x", "_atom_site.Cartn_y", "_atom_site.Cartn_z"])))
        require(len(rows) == 3238 and all(len(data[key]) == len(rows) for key in data if key.startswith("_atom_site.")), "Unexpected atom table size")
        expected_polymers = {str(row["entity"]): row["sequence"] for row in frozen["case"]["inputProteins"]}
        actual_polymers = dict(zip(data["_entity_poly.entity_id"], ["".join(s.split()) for s in data["_entity_poly.pdbx_seq_one_letter_code_can"]]))
        require(actual_polymers == expected_polymers, "Deposited polymer sequences differ from frozen prediction input")
        require(data["_pdbx_struct_assembly_gen.assembly_id"] == ["1"] and data["_pdbx_struct_assembly_gen.asym_id_list"] == ["A,B,C"] and data["_pdbx_struct_assembly_gen.oper_expression"] == ["1"], "Assembly selector changed")
        require(data["_pdbx_struct_oper_list.id"] == ["1"], "Unexpected assembly operation")
        for i in range(1, 4):
            require(float(data[f"_pdbx_struct_oper_list.vector[{i}]"][0]) == 0, "Nonidentity assembly translation")
            for j in range(1, 4):
                require(float(data[f"_pdbx_struct_oper_list.matrix[{i}][{j}]"][0]) == int(i == j), "Nonidentity assembly rotation")
        observed = {"A": {}, "B": {}}
        counts = {"A": 0, "B": 0, "C": 0}
        raw_atoms = {}
        for group, model, label, author, entity, label_seq, author_seq, ins, resname, atomname, alt, occupancy, element, x, y, z in rows:
            require(model == "1" and label in counts, "Unexpected model or chain")
            require(alt in {".", "?"} and float(occupancy) == 1.0, "Alternate conformer or nonunit occupancy requires a new reviewed preparation")
            xyz = [float(x), float(y), float(z)]
            require(all(math.isfinite(v) for v in xyz) and element not in {"H", "D"}, "Nonfinite coordinate or unexpected hydrogen")
            counts[label] += 1
            if label == "C":
                require(group == "HETATM" and author == "A" and entity == "3" and resname == "P0G" and label_seq == ".", "Unexpected nonpolymer inventory")
                continue
            require(group == "ATOM" and author == label and entity == {"A": "1", "B": "2"}[label], "Protein entity/chain identity mismatch")
            n = int(label_seq)
            expected = metadata[label].get(n)
            auth_id = author_seq + ("" if ins in {".", "?"} else ins)
            require(expected and expected["modeled_per_metadata"] == "True" and expected["author_residue_id_including_insertion_code"] == auth_id and expected["one_letter"] == seq1(resname), "Observed sequence/author mapping differs from frozen metadata")
            observed[label][n] = auth_id
            atom_id = (author, int(author_seq), " " if ins in {".", "?"} else ins, atomname)
            require(atom_id not in raw_atoms, "Duplicate observed protein atom")
            raw_atoms[atom_id] = xyz
        require(counts == {"A": 2290, "B": 921, "C": 27}, "Unexpected chain atom counts")
        for chain in MAPPING:
            require(set(observed[chain]) == {n for n, row in metadata[chain].items() if row["modeled_per_metadata"] == "True"}, "Missing/extra observed residues")
            require(len(observed[chain]) == {"A": 284, "B": 121}[chain], "Unexpected modeled residue count")
        receipt["coordinate_inventory"] = {"models": ["1"], "atom_counts_by_label_chain": counts,
            "protein_modeled_residues": {chain: len(values) for chain, values in observed.items()}, "ligand": "label C/auth A/entity 3/P0G",
            "alternate_conformers": 0, "all_occupancies": 1.0, "assembly": "1", "operation": "identity", "mapping_native_to_model": MAPPING}
        receipt["preparation_policy"] = {"chains": ["A", "B"], "model": "1", "atoms": "Observed protein heavy atoms only",
            "missing_residues": "No invented residues or coordinates", "altloc": "Fail closed unless every atom has blank/no alternate conformer",
            "occupancy": "Require all atoms occupancy 1", "numbering": "Preserve author residue numbers and insertion codes",
            "coordinate_serialization": "Biopython PDBIO; verify each output coordinate within 0.00051 Angstrom of original mmCIF",
            "excluded_nonpolymer": "P0G retained only in original CIF; not in protein DockQ reference"}
        structure = MMCIFParser(QUIET=True, auth_chains=True, auth_residues=True).get_structure("3P0G", str(native_source))
        require(len(structure) == 1 and next(structure.get_models()).serial_num == 1, "Biopython model inventory mismatch")
        native = out / "native_AB.pdb"
        save_protein(structure, native)
        reread = PDBParser(QUIET=True).get_structure("native", str(native))
        derived_atoms = {(a.get_parent().get_parent().id, a.get_parent().id[1], a.get_parent().id[2], a.id): a.coord for a in reread.get_atoms()}
        require(set(derived_atoms) == set(raw_atoms), "PDB conversion lost or introduced protein atoms")
        largest_error = max(float(np.max(np.abs(derived_atoms[key] - raw_atoms[key]))) for key in raw_atoms)
        require(largest_error <= 0.00051, "PDB conversion changed observed coordinates")
        receipt["coordinate_roundtrip_max_absolute_error_A"] = largest_error
        receipt["checks"].append("original CIF, frozen metadata, exact observed atom and residue maps, identity assembly, PDB roundtrip verified")
        helper_path = root / "scripts/paper/score-cognate-interfaces.py"
        spec = importlib.util.spec_from_file_location("dockq_helpers", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        import DockQ.DockQ as dockq
        receipt["runtime"] = helper.verify_runtime(dockq)
        receipt["runtime"]["helper_script_sha256"] = sha(helper_path)
        translated = copy.deepcopy(structure)
        for atom in translated.get_atoms():
            atom.coord = atom.coord + np.array([37.0, -19.0, 11.0])
        common = out / "control_common_translation.pdb"
        save_protein(translated, common)
        far_structure = copy.deepcopy(structure)
        for atom in far_structure[0]["B"].get_atoms():
            atom.coord = atom.coord + np.array([1000.0, 0.0, 0.0])
        far = out / "control_vhh_plus1000A_x.pdb"
        save_protein(far_structure, far)
        controls = {}
        for name, model in [("native_self", native), ("common_translation", common), ("vhh_plus1000A_x", far)]:
            capture = io.StringIO()
            try:
                with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
                    metrics = helper.score_paths(model, native, MAPPING, dockq)
            finally:
                (out / f"{name}.api.log").write_text(capture.getvalue())
            write_json(out / f"{name}.api.json", metrics)
            controls[name] = {"model_sha256": sha(model), "native_sha256": sha(native), "metrics": metrics,
                "invocation": {"function": "DockQ.DockQ.run_on_all_native_interfaces", "chain_map": MAPPING, "no_align": False, "capri_peptide": False}}
        require(abs(controls["native_self"]["metrics"]["DockQ"] - 1.0) <= 1e-6, "Native-self control failed")
        require(abs(controls["common_translation"]["metrics"]["DockQ"] - controls["native_self"]["metrics"]["DockQ"]) <= 1e-6, "Common-translation invariance failed")
        require(controls["vhh_plus1000A_x"]["metrics"]["fnat"] == 0 and controls["vhh_plus1000A_x"]["metrics"]["DockQ"] < 0.23, "Far-separation control failed")
        command = [sys.executable, "-m", "DockQ.DockQ", str(native), str(native), "--mapping", "AB:AB", "--n_cpu", "1", "--json", str(out / "native_self.cli.json")]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=60)
        (out / "native_self.cli.stdout.log").write_text(completed.stdout)
        (out / "native_self.cli.stderr.log").write_text(completed.stderr)
        receipt["cli_crosscheck"] = {"command": command, "exit_code": completed.returncode}
        require(completed.returncode == 0, "DockQ CLI native-self failed")
        cli = json.loads((out / "native_self.cli.json").read_text())
        require(cli["best_mapping"] == MAPPING and set(cli["best_result"]) == {"AB"}, "CLI interface/mapping mismatch")
        delta = abs(float(cli["best_result"]["AB"]["DockQ"]) - controls["native_self"]["metrics"]["DockQ"])
        require(delta <= 1e-6, "CLI/API native-self disagreement")
        receipt["cli_crosscheck"]["absolute_DockQ_difference"] = delta
        receipt["controls"] = controls
        receipt["native_reference"] = {"path": str(native), "sha256": sha(native), "bytes": native.stat().st_size,
                                        "protein_atoms": len(raw_atoms), "native_to_model": MAPPING}
        receipt["checks"].extend(["native self", "common translation", "VHH +1000 Angstrom x", "native-self API/CLI"])
        receipt["candidate_api_cli_crosscheck"] = "Not yet run; frozen first-successful-planned-candidate check remains required"
        receipt["status"] = "PASS_REFERENCE_PREFLIGHT_ONLY"
    except Exception as error:
        receipt["status"] = "FAIL_REFERENCE_PREFLIGHT"
        receipt["failure"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
    finally:
        if original_digest is not None:
            receipt["original_reference_unchanged"] = sha(native_source) == original_digest
            if not receipt["original_reference_unchanged"]:
                receipt["status"] = "FAIL_REFERENCE_CHANGED"
        receipt["completed_at_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        receipt["artifacts"] = [{"file": p.name, "sha256": sha(p), "bytes": p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file()]
        write_json(out / "reference-preflight-receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(out / "reference-preflight-receipt.json"), "failure": receipt.get("failure", {}).get("message")}))
    return 0 if receipt["status"] == "PASS_REFERENCE_PREFLIGHT_ONLY" else 1


if __name__ == "__main__":
    sys.exit(main())
