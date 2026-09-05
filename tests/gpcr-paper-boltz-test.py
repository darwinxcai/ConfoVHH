"""Offline regression tests. Synthetic atoms/values are fixtures, never study data."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/boltz-workflow.py"
SPEC = importlib.util.spec_from_file_location("boltz_workflow", SCRIPT)
workflow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workflow)


class BoltzWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.job = {"job": "fixture_seed1", "seed": 1, "diffusion_samples": 5,
                    "chains": [{"id": "A", "sequence": "AC", "sequence_sha256": hashlib.sha256(b"AC").hexdigest()}],
                    "templates": [], "source_yaml_sha256": "f" * 64}
        self.prepared = {"fingerprint": "f" * 64, "python": sys.executable,
                         "cache": str(self.root / "cache"), "checkpoint": str(self.root / "weights"),
                         "record": {"sources": [], "verified_assets": [], "runner_sha256": workflow.digest(SCRIPT),
                                    "input": {"version": 1, "sequences": [
                             {"protein": {"id": "A", "sequence": "AC", "msa": "/fixture.a3m"}}]}}}

    def command(self, action="good"):
        code = '''import json, pathlib, sys
p=pathlib.Path("out/boltz_results_fixture_seed1/predictions/fixture_seed1")
p.mkdir(parents=True)
action=sys.argv[1]
if action == "fail": sys.exit(42)
count=4 if action == "partial" else 5
cif="""data_fixture
loop_
_atom_site.label_atom_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.label_comp_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
CA A 1 ALA 1.0 2.0 3.0
CA A 2 CYS 2.0 2.0 3.0
#
"""
for i in range(count):
 (p/f"fixture_seed1_model_{i}.cif").write_text(cif)
 (p/f"confidence_fixture_seed1_model_{i}.json").write_text(json.dumps({"confidence_score":0.7,"ptm":0.6,"complex_plddt":0.8}))
if action == "truncated": (p/"fixture_seed1_model_4.cif").write_text("data_empty\\n")
if action == "nan": (p/"confidence_fixture_seed1_model_4.json").write_text('{"confidence_score":NaN,"ptm":0.6,"complex_plddt":0.8}')
if action == "wrong_chain":
 f=p/"fixture_seed1_model_4.cif"; f.write_text(cif.replace("CA A", "CA B"))
if action == "wrong_id": (p/"fixture_seed1_model_4.cif").rename(p/"fixture_seed1_model_5.cif")
'''
        return [sys.executable, "-c", code, action]

    def run_fixture(self, action="good", retry=False):
        return workflow.execute(self.job, self.prepared, self.root / "runs", retry, self.command(action))

    def test_failed_empty_directory_never_skips_and_retry_preserves_evidence(self):
        with self.assertRaisesRegex(ValueError, "exit 42"):
            self.run_fixture("fail")
        with self.assertRaisesRegex(ValueError, "incomplete attempt"):
            self.run_fixture()
        result = self.run_fixture(retry=True)
        self.assertEqual(result["status"], "complete")
        attempts = list((self.root / "runs/fixture_seed1/attempts").iterdir())
        self.assertEqual(len(attempts), 2)
        states = [workflow.read(p / "status.json")["status"] for p in attempts]
        self.assertCountEqual(states, ["complete", "failed_or_incomplete"])

    def test_complete_skips_only_after_verification(self):
        self.assertEqual(self.run_fixture()["status"], "complete")
        self.assertEqual(self.run_fixture("fail")["status"], "verified_complete")

    def test_rejects_bad_outputs_even_if_process_exits_zero(self):
        for action in ["partial", "truncated", "nan", "wrong_chain", "wrong_id"]:
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    self.run_fixture(action, retry=True)
                self.assertFalse((self.root / "runs/fixture_seed1/COMPLETE.json").exists())

    def test_hash_tampering_rejected(self):
        result = self.run_fixture()
        confidence = Path(result["attempt"]) / "out/boltz_results_fixture_seed1/predictions/fixture_seed1/confidence_fixture_seed1_model_0.json"
        values = workflow.read(confidence)
        values["ptm"] = 0.5
        workflow.write(confidence, values)
        with self.assertRaisesRegex(ValueError, "hashes changed"):
            self.run_fixture()

    def test_input_tampering_rejected(self):
        result = self.run_fixture()
        (Path(result["attempt"]) / "fixture_seed1.yaml").write_text("{}")
        with self.assertRaisesRegex(ValueError, "hashes changed"):
            self.run_fixture()

    def test_deleted_log_rejected(self):
        result = self.run_fixture()
        (Path(result["attempt"]) / "stdout.log").unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_fixture()

    def test_modified_log_rejected(self):
        result = self.run_fixture()
        (Path(result["attempt"]) / "stderr.log").write_text("modified after completion")
        with self.assertRaisesRegex(ValueError, "hashes changed"):
            self.run_fixture()

    def test_msa_mutation_during_execution_prevents_complete(self):
        msa = self.root / "fixture.a3m"
        msa.write_text(">fixture\nAC\n")
        self.prepared["record"]["sources"].append({"kind": "msa", "path": str(msa), "sha256": workflow.digest(msa)})
        argv = self.command()
        argv[2] += "\npathlib.Path(" + repr(str(msa)) + ").write_text('changed while predicting')\n"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            workflow.execute(self.job, self.prepared, self.root / "runs", command=argv)
        self.assertFalse((self.root / "runs/fixture_seed1/COMPLETE.json").exists())
        attempts = list((self.root / "runs/fixture_seed1/attempts").iterdir())
        self.assertEqual(workflow.read(attempts[0] / "status.json")["status"], "failed_or_incomplete")

    def test_checkpoint_mutation_during_execution_prevents_complete(self):
        checkpoint = self.root / "fixture.ckpt"
        checkpoint.write_text("synthetic checkpoint fixture")
        self.prepared["record"]["verified_assets"].append({"path": str(checkpoint), "sha256": workflow.digest(checkpoint)})
        argv = self.command()
        argv[2] += "\npathlib.Path(" + repr(str(checkpoint)) + ").write_text('changed while predicting')\n"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            workflow.execute(self.job, self.prepared, self.root / "runs", command=argv)
        self.assertFalse((self.root / "runs/fixture_seed1/COMPLETE.json").exists())

    def test_changed_pin_fingerprint_rejected(self):
        self.run_fixture()
        self.prepared["fingerprint"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            self.run_fixture()

    def test_concurrent_or_interrupted_lock_is_preserved(self):
        folder = self.root / "runs/fixture_seed1"
        folder.mkdir(parents=True)
        (folder / "RUNNING.lock").write_text("fixture")
        with self.assertRaises(FileExistsError):
            self.run_fixture()
        self.assertEqual((folder / "RUNNING.lock").read_text(), "fixture")

    def test_missing_or_wrong_msa_fails_before_execution(self):
        with self.assertRaisesRegex(ValueError, "missing artifact"):
            workflow.prepare(self.job, {}, self.root, {})
        msa = self.root / "msa.a3m"
        msa.write_text(">query\nAA\n")
        pins = {"msas": {self.job["chains"][0]["sequence_sha256"]: {
            "path": str(msa), "sha256": workflow.digest(msa),
            "provenance": {"method": "synthetic fixture", "database": "none", "created_utc": "fixture"}}}}
        with self.assertRaisesRegex(ValueError, "MSA query/sequence mismatch"):
            workflow.prepare(self.job, pins, self.root, {})

    def test_unpinned_runtime_fails_before_probe(self):
        with patch.object(workflow.subprocess, "run") as probe:
            with self.assertRaises(ValueError):
                workflow.preflight(self.job, {}, self.root, {}, [])
            probe.assert_not_called()

    def test_default_command_requires_local_cache_checkpoint_and_omits_msa_server(self):
        actual_run = subprocess.run
        captured = []
        def fake_run(argv, **kwargs):
            captured.append(argv)
            return actual_run(self.command(), **kwargs)
        with patch.object(workflow.subprocess, "run", side_effect=fake_run):
            workflow.execute(self.job, self.prepared, self.root / "runs")
        self.assertNotIn("--use_msa_server", captured[0])
        self.assertIn("--checkpoint", captured[0])
        self.assertIn("--cache", captured[0])
        self.assertEqual(captured[0][captured[0].index("--diffusion_samples") + 1], "5")


if __name__ == "__main__":
    unittest.main()
