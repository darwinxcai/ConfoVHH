#!/usr/bin/env python3
"""Prepare optional matched native-coordinate templates; no Boltz or inference.

Correspondence is specific to the two source structures. Shared position means
3P0G author residue ID and 5JQH author residue ID minus 1000, not newly assigned
generic GPCR numbering. All selections depend on input coverage/identity only.
"""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
AA = dict(zip("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split(), "ARNDCQEGHILKMFPSTWYV"))
SOURCES = {
    "3P0G": {"native_sha256": "25cfe2f425f962fe27c82cdc4f107598a2563d8a6c968e669ffe4e1d5611ae63",
             "request_sha256": "93d1b61885370dfdbbbb4319abc85c474ea909565c452ea84934927686537f9d",
             "query_sha256": "e9052379ba6dca45a6a4148a53cc1d6ad790f05e4b4f0a9237afe2fcc8638926",
             "query_length": 501, "author_offset": 0},
    "5JQH": {"native_sha256": "4e3c8351601f421c9a073046438f81ceaedd1df6de4ab409eca79e40fdd32fe7",
             "request_sha256": "30847fb3933987ef27b2acdc7c245f412d185158f3bfbeda4f41af2ffd699aa9",
             "query_sha256": "a75c94a1f62e10ac15b6f98bc141b8e9ca968455db6003201060e0f940f3361c",
             "query_length": 471, "author_offset": 1000},
}
ANCHORS = {131: "ARG", 272: "LEU"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def atom_rows(text):
    """Parse the atom-site loop in the source CIF subset; fail on other syntax."""
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.startswith("_atom_site.group_PDB")]
    require(len(starts) == 1, "exactly one source atom-site loop required")
    index, keys = starts[0], []
    while lines[index].startswith("_atom_site."):
        keys.append(lines[index].strip().split(".", 1)[1])
        index += 1
    rows = []
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if line.startswith("#"):
            break
        if not line:
            continue
        values = re.findall(r"'[^'\n]*'(?=\s|$)|\"[^\"\n]*\"(?=\s|$)|[^\s]+", line)
        values = [v[1:-1] if v.startswith(("'", '"')) and v[-1:] == v[:1] else v for v in values]
        require(len(values) == len(keys), "unsupported/truncated atom-site row")
        row = dict(zip(keys, values))
        require(row["pdbx_PDB_model_num"] == "1", "multiple native models")
        require(all(math.isfinite(float(row[k])) for k in ("Cartn_x", "Cartn_y", "Cartn_z")), "nonfinite native coordinate")
        rows.append(row)
    require(rows, "no native atoms")
    return rows


def map_native(rows, query, author_offset):
    residues = {}
    for row in rows:
        if row["auth_asym_id"] != "A" or row["label_seq_id"] in (".", "?"):
            continue
        require(row["group_PDB"] == "ATOM", "unexpected non-ATOM polymer residue")
        require(row["label_asym_id"] == "A", "native label/auth chain mismatch")
        require(row["pdbx_PDB_ins_code"] in (".", "?"), "unresolved insertion-code mapping")
        label_id, auth_id = int(row["label_seq_id"]), int(row["auth_seq_id"])
        comp = row["label_comp_id"]
        require(comp in AA and 1 <= label_id <= len(query), "native/query map coverage invalid")
        require(query[label_id - 1] == AA[comp], f"native/query residue mismatch at label ID {label_id}")
        position = auth_id - author_offset
        identity = (label_id, auth_id, comp)
        if position not in residues:
            residues[position] = {"identity": identity, "atoms": collections.defaultdict(list)}
        residue = residues[position]
        require(residue["identity"] == identity, "ambiguous native author/label residue mapping")
        residue["atoms"][row["label_atom_id"]].append(row)
    require(residues, "empty receptor map")
    labels = [r["identity"][0] for _, r in sorted(residues.items())]
    require(labels == sorted(set(labels)), "nonmonotonic or duplicated native/query correspondence")
    for position, residue in residues.items():
        require(len(residue["atoms"].get("CA", [])) == 1, f"missing/ambiguous CA at source position {position}")
    for position, comp in ANCHORS.items():
        require(position in residues and residues[position]["identity"][2] == comp,
                "author offset does not preserve declared reference endpoint anchors")
    return residues


def matched_mask(left, right):
    shared = sorted(left.keys() & right.keys())
    retained, excluded = [], []
    for position in shared:
        a, b = left[position], right[position]
        if a["identity"][2] != b["identity"][2]:
            excluded.append({"shared_author_position": position, "3P0G_component": a["identity"][2],
                             "5JQH_component": b["identity"][2], "reason": "nonidentical_residue"})
            continue
        names = []
        for name in sorted(a["atoms"].keys() & b["atoms"].keys()):
            aa, bb = a["atoms"][name], b["atoms"][name]
            if len(aa) != 1 or len(bb) != 1:
                continue  # Exclude every ambiguous atom name from both templates.
            if aa[0]["type_symbol"] in ("H", "D") or bb[0]["type_symbol"] in ("H", "D"):
                continue
            require(aa[0]["type_symbol"] == bb[0]["type_symbol"], "shared atom element mismatch")
            names.append(name)
        require({"N", "CA", "C", "O"} <= set(names), f"incomplete shared backbone at {position}")
        retained.append({"shared_author_position": position, "component": a["identity"][2], "atom_names": names})
    require(retained, "empty common atom mask")
    require(set(ANCHORS) <= {r["shared_author_position"] for r in retained}, "endpoint absent from common mask")
    return retained, excluded


def write_pdb(path, mapped, mask):
    lines = ["REMARK 900 OPTIONAL DEVELOPMENT TEMPLATE. NOT PARSED BY BOLTZ.\n",
             "REMARK 900 RESIDUE IDS ARE THE SHARED 3P0G AUTHOR-BASED MAPPING.\n"]
    serial = 0
    for item in mask:
        position = item["shared_author_position"]
        for name in item["atom_names"]:
            row = mapped[position]["atoms"][name][0]
            require(len(name) <= 3, "unsupported protein atom name length")
            serial += 1
            xyz = [float(row[k]) for k in ("Cartn_x", "Cartn_y", "Cartn_z")]
            require(all(float(f"{value:.3f}") == value for value in xyz), "PDB would round source coordinates")
            occupancy, bfactor = float(row["occupancy"]), float(row["B_iso_or_equiv"])
            require(math.isfinite(occupancy) and math.isfinite(bfactor), "nonfinite occupancy or B factor")
            lines.append(f"ATOM  {serial:5d}  {name:<3} {item['component']:3s} A{position:4d}    "
                         + "".join(f"{value:8.3f}" for value in xyz)
                         + f"{occupancy:6.2f}{bfactor:6.2f}          {row['type_symbol']:>2s}\n")
    lines += ["TER\n", "END\n"]
    path.write_text("".join(lines))


def verify_pdb(path, mapped, mask):
    expected = {(m["shared_author_position"], name): mapped[m["shared_author_position"]]["atoms"][name][0]
                for m in mask for name in m["atom_names"]}
    actual = {}
    for line in path.read_text().splitlines():
        if line.startswith("ATOM  "):
            require(line[21] == "A", "output chain identity mismatch")
            key = int(line[22:26]), line[12:16].strip()
            require(key not in actual, "duplicate output atom")
            actual[key] = {"component": line[17:20], "xyz": [float(line[30:38]), float(line[38:46]), float(line[46:54])],
                           "element": line[76:78].strip()}
        else:
            require(line.startswith(("REMARK", "TER", "END")), "unexpected output record")
    require(actual.keys() == expected.keys(), "output/common-mask coverage mismatch")
    for key, row in expected.items():
        require(actual[key]["component"] == row["label_comp_id"] and actual[key]["element"] == row["type_symbol"],
                "output residue/atom identity mismatch")
        require(actual[key]["xyz"] == [float(row[k]) for k in ("Cartn_x", "Cartn_y", "Cartn_z")], "output coordinates changed")
    a, b = sorted(ANCHORS)
    original = math.dist([float(mapped[a]["atoms"]["CA"][0][k]) for k in ("Cartn_x", "Cartn_y", "Cartn_z")],
                         [float(mapped[b]["atoms"]["CA"][0][k]) for k in ("Cartn_x", "Cartn_y", "Cartn_z")])
    exported = math.dist(actual[(a, "CA")]["xyz"], actual[(b, "CA")]["xyz"])
    require(original == exported, "endpoint geometry changed")
    return {"atoms": len(actual), "residues": len(mask), "maximum_coordinate_change_A": 0.0,
            "reference_endpoint_before_A": original, "reference_endpoint_after_A": exported,
            "endpoint_change_A": exported - original, "all_atom_identities_and_coordinates_match": True}


def prepare(raw_root, out):
    native_maps, input_records = {}, []
    for reference, specification in SOURCES.items():
        native = raw_root / "references" / (reference + ".cif.gz")
        job = reference + "_default_complex_seed1"
        request = raw_root / "runs" / job / ("fold_" + job.lower() + "_job_request.json")
        require(sha(native) == specification["native_sha256"], f"native hash mismatch: {reference}")
        require(sha(request) == specification["request_sha256"], f"request hash mismatch: {reference}")
        data = json.loads(request.read_text())
        require(len(data) == 1 and data[0]["name"] == job, "request identity mismatch")
        candidates = [(index, entry["proteinChain"]["sequence"]) for index, entry in enumerate(data[0]["sequences"])
                      if "proteinChain" in entry and hashlib.sha256(entry["proteinChain"]["sequence"].encode()).hexdigest() == specification["query_sha256"]]
        require(len(candidates) == 1, "submitted receptor identity is not unique")
        index, query = candidates[0]
        require(len(query) == specification["query_length"], "query length mismatch")
        rows = atom_rows(gzip.decompress(native.read_bytes()).decode())
        native_maps[reference] = map_native(rows, query, specification["author_offset"])
        input_records.append({"reference": reference, **specification, "native_path": str(native.relative_to(raw_root)),
                              "request_path": str(request.relative_to(raw_root)), "request_sequence_index_zero_based": index,
                              "reference_polymer_chain": "A", "observed_native_residues_mapped": len(native_maps[reference]),
                              "all_observed_residues_match_submitted_query": True})
    mask, exclusions = matched_mask(native_maps["3P0G"], native_maps["5JQH"])
    out.mkdir(parents=True, exist_ok=False)
    full_maps, dropped_atoms = {}, []
    by_position = {item["shared_author_position"]: item for item in mask}
    template_indices = {row["shared_author_position"]: index for index, row in enumerate(mask)}
    for item in mask:
        position = item["shared_author_position"]
        item["template_sequence_index_zero_based"] = template_indices[position]
        item["query_indices_zero_based"] = {ref: residues[position]["identity"][0] - 1 for ref, residues in native_maps.items()}
        item["native_ids"] = {ref: {"label_seq_id": residues[position]["identity"][0],
                                   "auth_seq_id": residues[position]["identity"][1]} for ref, residues in native_maps.items()}
    for reference, residues in native_maps.items():
        full_maps[reference] = []
        for position, residue in sorted(residues.items()):
            label, auth, comp = residue["identity"]
            status = ("retained" if position in by_position else "nonidentical_shared_residue"
                      if any(r["shared_author_position"] == position for r in exclusions) else "not_shared_observed_author_position")
            full_maps[reference].append({"native_label_asym_id": "A", "native_auth_asym_id": "A",
                "native_label_seq_id": label, "native_auth_seq_id": auth, "component": comp,
                "submitted_query_index_zero_based": label - 1, "shared_author_position": position,
                "status": status, "template_sequence_index_zero_based": template_indices.get(position)})
            kept = by_position.get(position, {}).get("atom_names", [])
            for name, atoms in residue["atoms"].items():
                if name not in kept:
                    dropped_atoms.append({"reference": reference, "native_label_seq_id": label,
                                          "native_auth_seq_id": auth, "atom_name": name,
                                          "source_atom_records": len(atoms), "reason": status if status != "retained" else "not_shared_unique_heavy_atom"})
    write_json(out / "shared-residue-atom-mask.json", mask)
    write_json(out / "full-native-to-query-maps.json", full_maps)
    write_json(out / "excluded-nonidentical-residues.json", exclusions)
    write_json(out / "excluded-atom-records.json", dropped_atoms)
    checks = {}
    for reference, residues in native_maps.items():
        path = out / (reference + "_shared_receptor_template.pdb")
        write_pdb(path, residues, mask)
        checks[reference] = verify_pdb(path, residues, mask)
    write_json(out / "preparation.json", {
        "schema": "confovhh.optional-matched-native-templates.v1", "status": "PREPARED_NOT_BOLTZ_PARSED",
        "data_role": "Optional new development inputs; neither historical 92-job manifest nor proposed 54-job protocol activated",
        "source_reference_provenance": input_records, "script_sha256": sha(__file__),
        "mapping_rule": "Intersect observed 3P0G chain-A author positions with 5JQH chain-A author positions minus 1000; exact amino-acid identity required at every retained position; full native label_seq_id is checked against the submitted query before masking.",
        "numbering_limit": "Source-specific author-number correspondence, checked against both submitted sequences and the existing R131/L272 versus R1131/L1272 endpoints; no generic GPCR numbering assignment is performed.",
        "atom_mask_rule": "Identical shared heavy-atom names with one source conformer per name in each structure; all N/CA/C/O required; no coordinate-, score-, or prediction-based selection.",
        "shared_residues": len(mask), "shared_heavy_atoms_per_template": sum(len(m["atom_names"]) for m in mask),
        "excluded_nonidentical_positions": [r["shared_author_position"] for r in exclusions],
        "geometry_checks": checks, "native_cif_files_modified": False, "boltz_parser_validation": "not_performed",
        "msa_retrievals": 0, "inference_runs": 0, "protocol_activation": False,
        "limits": ["Both inputs contain target-specific experimental structural information; this is not blind prediction.",
                   "Shared side-chain coverage is incomplete where either reference lacks atoms; downstream template parsing must verify treatment.",
                   "Coordinates retain experimental geometry but no longer include ligands, nanobodies, unshared residues or fusion coordinates.",
                   "One structure per endpoint confounds template identity with conformation; these assets alone do not establish a general effect."],
        "outputs_sha256": {p.name: sha(p) for p in sorted(out.iterdir()) if p.is_file()},
    })
    return {"status": "PREPARED_NOT_BOLTZ_PARSED", "residues": len(mask), "heavy_atoms_per_template": checks["3P0G"]["atoms"],
            "output": str(out.resolve())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.raw_root.resolve(), args.out.resolve()), indent=2))
    except (ValueError, KeyError, OSError, TypeError) as exc:
        print(json.dumps({"status": "FAILED", "error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
