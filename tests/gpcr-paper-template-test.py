"""Synthetic geometry/mapping fixtures; no simulated coordinates enter artifacts."""
import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/prepare-matched-gpcr-templates.py"
SPEC = importlib.util.spec_from_file_location("matched_templates", SCRIPT)
templates = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(templates)


def atoms(offset=0):
    rows = []
    for label, position, comp in [(1, 131, "ARG"), (2, 200, "ALA"), (3, 272, "LEU")]:
        for index, name in enumerate(["N", "CA", "C", "O"]):
            rows.append({"auth_asym_id": "A", "label_asym_id": "A", "label_seq_id": str(label),
                         "auth_seq_id": str(position + offset), "label_comp_id": comp,
                         "label_atom_id": name, "pdbx_PDB_ins_code": "?", "group_PDB": "ATOM",
                         "type_symbol": "N" if name == "N" else "O" if name == "O" else "C",
                         "Cartn_x": str(label), "Cartn_y": str(index), "Cartn_z": "0.001",
                         "occupancy": "1.00", "B_iso_or_equiv": "20.00"})
    return rows


class MatchedTemplateTest(unittest.TestCase):
    def setUp(self):
        self.left = templates.map_native(atoms(), "RAL", 0)
        self.right = templates.map_native(atoms(1000), "RAL", 1000)

    def test_full_observed_native_query_map_and_identical_atom_coverage(self):
        mask, excluded = templates.matched_mask(self.left, self.right)
        self.assertEqual([r["shared_author_position"] for r in mask], [131, 200, 272])
        self.assertEqual(sum(len(r["atom_names"]) for r in mask), 12)
        self.assertEqual(excluded, [])
        self.assertEqual([r["identity"][0] for _, r in sorted(self.left.items())], [1, 2, 3])
        self.assertEqual([r["identity"][1] for _, r in sorted(self.right.items())], [1131, 1200, 1272])

    def test_wrong_author_offset_rejected(self):
        with self.assertRaisesRegex(ValueError, "author offset"):
            templates.map_native(atoms(1000), "RAL", 999)

    def test_native_query_residue_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, "residue mismatch"):
            templates.map_native(atoms(), "RGL", 0)

    def test_absent_ca_rejected(self):
        rows = [r for r in atoms() if not (r["label_seq_id"] == "2" and r["label_atom_id"] == "CA")]
        with self.assertRaisesRegex(ValueError, "missing/ambiguous CA"):
            templates.map_native(rows, "RAL", 0)

    def test_map_beyond_submitted_sequence_coverage_rejected(self):
        with self.assertRaisesRegex(ValueError, "map coverage"):
            templates.map_native(atoms(), "RA", 0)

    def test_nonidentical_residue_excluded_without_selecting_coordinates(self):
        right = copy.deepcopy(self.right)
        right[200]["identity"] = (2, 1200, "GLY")
        for values in right[200]["atoms"].values():
            for row in values:
                row["label_comp_id"] = "GLY"
        mask, exclusions = templates.matched_mask(self.left, right)
        self.assertEqual([r["shared_author_position"] for r in mask], [131, 272])
        self.assertEqual(exclusions[0]["shared_author_position"], 200)

    def test_nonshared_and_ambiguous_sidechain_atoms_excluded_from_both(self):
        left, right = copy.deepcopy(self.left), copy.deepcopy(self.right)
        extra = copy.deepcopy(left[200]["atoms"]["CA"][0])
        extra["label_atom_id"] = "CB"
        left[200]["atoms"]["CB"] = [extra]
        right[200]["atoms"]["CB"] = [copy.deepcopy(extra), copy.deepcopy(extra)]
        mask, _ = templates.matched_mask(left, right)
        self.assertNotIn("CB", next(r for r in mask if r["shared_author_position"] == 200)["atom_names"])

    def test_missing_shared_backbone_fails(self):
        right = copy.deepcopy(self.right)
        del right[200]["atoms"]["O"]
        with self.assertRaisesRegex(ValueError, "incomplete shared backbone"):
            templates.matched_mask(self.left, right)

    def test_export_preserves_every_coordinate_and_endpoint(self):
        mask, _ = templates.matched_mask(self.left, self.right)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.pdb"
            templates.write_pdb(path, self.left, mask)
            check = templates.verify_pdb(path, self.left, mask)
            self.assertEqual(check["maximum_coordinate_change_A"], 0)
            self.assertEqual(check["endpoint_change_A"], 0)
            self.assertEqual(check["atoms"], 12)
            lines = path.read_text().splitlines(keepends=True)
            path.write_text("".join(line for line in lines if not line.startswith("ATOM      1 ")))
            with self.assertRaisesRegex(ValueError, "coverage mismatch"):
                templates.verify_pdb(path, self.left, mask)

    def test_export_refuses_to_round_finer_source_coordinates(self):
        mask, _ = templates.matched_mask(self.left, self.right)
        self.left[200]["atoms"]["CA"][0]["Cartn_x"] = "1.0001"
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, "round source coordinates"):
                templates.write_pdb(Path(temp) / "synthetic.pdb", self.left, mask)

    def test_missing_or_incorrect_sequence_metadata_is_rejected(self):
        mask, _ = templates.matched_mask(self.left, self.right)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.pdb"
            templates.write_pdb(path, self.left, mask)
            original = path.read_text()
            self.assertTrue(all(len(line) == 80 for line in original.splitlines()
                                if line.startswith("SEQRES")))
            path.write_text("".join(line for line in original.splitlines(keepends=True)
                                    if not line.startswith("SEQRES")))
            with self.assertRaisesRegex(ValueError, "sequence coverage mismatch"):
                templates.verify_pdb(path, self.left, mask)
            path.write_text(original.replace("ARG ALA LEU", "ARG GLY LEU"))
            with self.assertRaisesRegex(ValueError, "sequence coverage mismatch"):
                templates.verify_pdb(path, self.left, mask)


if __name__ == "__main__":
    unittest.main()
