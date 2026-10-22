"""Offline checks of synthetic parser evidence; no official parser rerun here."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = load("synthetic_parser_smoke", "scripts/paper/boltz-parser-smoke.py")
workflow = load("synthetic_template_workflow", "scripts/paper/boltz-workflow.py")
FIXTURE = ROOT / "tests/fixtures/boltz-parser-synthetic-2026-09-08"


class SyntheticReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "fixture"
        shutil.copytree(FIXTURE, self.out)

    def mutate_receipt(self, change):
        path = self.out / "receipt.json"
        receipt = json.loads(path.read_text())
        change(receipt)
        smoke.write_json(path, receipt)

    def mutate_features_and_rehash(self, change):
        path = self.out / "features.json"
        features = json.loads(path.read_text())
        change(features)
        smoke.write_json(path, features)
        self.mutate_receipt(lambda r: r["outputs_sha256"].update({"features.json": smoke.sha(path)}))

    def test_retained_official_execution_has_only_synthetic_authority(self):
        receipt = smoke.verify(self.out)
        self.assertTrue(receipt["official_parser_executed"])
        self.assertEqual(receipt["native_templates_checked"], 0)
        self.assertEqual(receipt["inference_runs"], 0)

    def test_changed_missing_atom_mask_rejected_even_after_rehash(self):
        self.mutate_features_and_rehash(lambda f: f["atoms"][10].update({"is_present": True}))
        with self.assertRaisesRegex(ValueError, "feature/mapping mismatch"):
            smoke.verify(self.out)

    def test_changed_offset_mapping_rejected_even_after_rehash(self):
        self.mutate_features_and_rehash(lambda f: f["template_records"][0].update({"query_indices": [0, 1, 2, 3]}))
        with self.assertRaisesRegex(ValueError, "feature/mapping mismatch"):
            smoke.verify(self.out)

    def test_wrong_arg_naming_rejected_even_after_rehash(self):
        self.mutate_features_and_rehash(lambda f: f["atoms"][20].update({"coords": [25.0, 0.0, 0.0]}))
        with self.assertRaisesRegex(ValueError, "feature/mapping mismatch"):
            smoke.verify(self.out)

    def test_native_authority_promotion_rejected(self):
        self.mutate_receipt(lambda r: r.update({"native_templates_checked": 2}))
        with self.assertRaisesRegex(ValueError, "cannot grant native"):
            smoke.verify(self.out)

    def test_missing_negative_control_rejected(self):
        self.mutate_receipt(lambda r: r["negative_controls"].pop())
        with self.assertRaisesRegex(ValueError, "missing negative controls"):
            smoke.verify(self.out)

    def test_raw_fixture_modification_rejected(self):
        with (self.out / "synthetic.pdb").open("a") as handle:
            handle.write("REMARK changed\n")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            smoke.verify(self.out)


class TemplateFormatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        msa = self.root / "synthetic.a3m"
        msa.write_text(">synthetic\nAC\n")
        import hashlib
        sequence_hash = hashlib.sha256(b"AC").hexdigest()
        self.job = {"job": "synthetic_seed1", "seed": 1, "diffusion_samples": 5,
                    "chains": [{"id": "Q", "sequence": "AC", "sequence_sha256": sequence_hash}],
                    "templates": [{"pdb_id": "1ABC", "chain_id": "Q"}]}
        self.pins = {"msas": {sequence_hash: {"path": str(msa), "sha256": smoke.sha(msa),
                     "provenance": {"method": "synthetic", "database": "none", "created_utc": "fixture"}}},
                     "template_chains": {"synthetic_seed1:Q:1ABC": "X1"}}

    def prepare(self, suffix):
        template = self.root / ("synthetic" + suffix)
        template.write_text(smoke.fixture()[0] if suffix.lower() == ".pdb" else "data_synthetic\n")
        pins = copy.deepcopy(self.pins)
        pins["templates"] = {"1ABC": {"path": str(template), "sha256": smoke.sha(template)}}
        provenance = {"1ABC": {"sha256": smoke.sha(template), "bytes": str(template.stat().st_size)}}
        return workflow.prepare(self.job, pins, self.root, provenance)[0]["templates"][0]

    def test_pdb_schema_key_and_parsed_chain_are_preserved(self):
        for suffix in (".pdb", ".PDB"):
            with self.subTest(suffix=suffix):
                row = self.prepare(suffix)
                self.assertIn("pdb", row)
                self.assertNotIn("cif", row)
                self.assertEqual(row["template_id"], "X1")

    def test_historical_cif_semantics_remain(self):
        for suffix in (".cif", ".mmcif"):
            with self.subTest(suffix=suffix):
                row = self.prepare(suffix)
                self.assertIn("cif", row)
                self.assertNotIn("pdb", row)
                self.assertEqual(row["template_id"], "X1")

    def test_no_invented_chain_mapping(self):
        self.pins["template_chains"]["synthetic_seed1:Q:1ABC"] = "explicit-chain"
        self.assertEqual(self.prepare(".pdb")["template_id"], "explicit-chain")

    def test_unsupported_format_rejected(self):
        for suffix in (".txt", ".pdb.gz", ""):
            with self.subTest(suffix=suffix), self.assertRaisesRegex(ValueError, "unsupported template format"):
                self.prepare(suffix)


if __name__ == "__main__":
    unittest.main()
