#!/usr/bin/env python3
"""Synthetic file-accounting controls; no GPU, downloads, or prediction outcomes."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/run-single-case-generation.py"
SPEC = importlib.util.spec_from_file_location("single_case_generation_under_test", SCRIPT)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class SingleCaseGenerationAccountingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="confovhh-generation-control-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.inputs = self.root / "inputs"
        self.cache = self.root / "cache"
        self.output = self.root / "output"
        self.python = self.root / "venv/bin/python"
        self.inputs.mkdir()
        self.cache.mkdir()
        self.fake_repo = self.root / "repo"
        for relative in ["cloud/boltz-runtime-candidate/requirements-linux-py311.lock",
                         "scripts/cloud/check-boltz-runtime.py"]:
            filename = self.fake_repo / relative
            filename.parent.mkdir(parents=True, exist_ok=True)
            filename.write_text("synthetic test placeholder\n")
        plan = {"generator": {"seeds": [1, 2]},
                "case": {"inputProteins": [{"chain": "A", "sequence": "AAA"},
                                             {"chain": "B", "sequence": "GGG"}]}}
        (self.inputs / "protocol.json").write_text(json.dumps(plan))
        (self.inputs / "manifest.json").write_text(json.dumps({"files": {
            "protocol.json": {"sha256": "0" * 64, "bytes": 1}}}))
        self.real_digest = runner.digest
        self.no_process = self.enterContext(patch.object(runner.subprocess, "Popen",
                                                        side_effect=AssertionError("No real subprocess permitted")))

    def mocked_preflight(self):
        # This deliberately bypasses production byte pins for tiny synthetic files.
        # Other tests below exercise missing-input rejection without this mock.
        self.enterContext(patch.object(runner, "ROOT", self.fake_repo))
        self.enterContext(patch.object(runner, "CACHE", {}))
        self.enterContext(patch.object(runner, "checked", side_effect=lambda filename, *_: Path(filename)))
        self.enterContext(patch.object(runner, "prepare_molecules", return_value=[]))

    def fake_command(self, missing_confidence=None, smoke_exit=0):
        def execute(args, log_path, timeout, env):
            self.assertGreater(timeout, 0)
            self.assertEqual(env["HF_HUB_OFFLINE"], "1")
            log_path.write_text("synthetic command log\n")
            inference = "predict" in args
            if inference:
                seed = int(args[args.index("--seed") + 1])
                name = f"3P0G_seed{seed}"
                raw = Path(args[args.index("--out_dir") + 1])
                predictions = raw / f"boltz_results_{name}" / "predictions" / name
                predictions.mkdir(parents=True)
                for model in range(5):
                    (predictions / f"{name}_model_{model}.cif").write_text(
                        f"Synthetic accounting bytes, not coordinates: {seed}/{model}\n")
                    if missing_confidence != (seed, model):
                        (predictions / f"confidence_{name}_model_{model}.json").write_text(
                            '{"synthetic":true}\n')
            return {"args": args, "exitCode": 0 if inference else smoke_exit,
                    "timedOut": False, "elapsedSeconds": 0.01,
                    "logSha256": self.real_digest(log_path)}
        return execute

    def run_fixture(self):
        result = runner.run(self.inputs, self.cache, self.python, self.output)
        self.assertEqual(len(result["attempts"]), 10)
        self.assertEqual(len({row["id"] for row in result["attempts"]}), 10)
        self.assertEqual(json.loads((self.output / "generation-receipt.json").read_text()), result)
        self.no_process.assert_not_called()
        return result

    def test_produced_coordinate_survives_missing_confidence(self):
        self.mocked_preflight()
        with patch.object(runner, "command", side_effect=self.fake_command(missing_confidence=(1, 2))) as command:
            result = self.run_fixture()
        self.assertEqual(command.call_count, 3)  # smoke and both fixed seeds
        self.assertEqual(result["status"], "GENERATION_WITH_FAILURES")
        self.assertTrue(all(row["status"] == "generated" for row in result["attempts"]))
        row = next(row for row in result["attempts"] if row["id"] == "seed1_model_2")
        self.assertEqual(row["confidenceStatus"], "missing")
        self.assertNotIn("confidence", row["artifacts"])
        coordinate = row["artifacts"]["coordinate"]
        self.assertEqual(coordinate["sha256"], self.real_digest(self.output / coordinate["path"]))
        self.assertGreater(coordinate["bytes"], 0)

    def test_post_inference_digest_failure_reconciles_readable_coordinate_and_unlaunched_seed(self):
        self.mocked_preflight()
        failures = 0

        def once_unreadable(filename):
            nonlocal failures
            if Path(filename).name == "3P0G_seed1_model_0.cif" and not failures:
                failures += 1
                raise OSError("Synthetic first-read failure after inference")
            return self.real_digest(filename)

        with patch.object(runner, "command", side_effect=self.fake_command()) as command, \
                patch.object(runner, "digest", side_effect=once_unreadable):
            result = self.run_fixture()
        self.assertEqual(command.call_count, 2)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["errorType"], "OSError")
        launched = [row for row in result["attempts"] if row["seed"] == 1]
        unlaunched = [row for row in result["attempts"] if row["seed"] == 2]
        self.assertTrue(all(row["status"] == "accounting-failed" for row in launched))
        self.assertTrue(all(row["status"] == "not-run" and row["artifacts"] == {} for row in unlaunched))
        for row in launched:
            coordinate = row["artifacts"]["coordinate"]
            self.assertEqual(coordinate["sha256"], self.real_digest(self.output / coordinate["path"]))
            self.assertNotIn("accountingError", coordinate)

    def test_persistently_unreadable_partial_coordinate_retains_path_and_explicit_error(self):
        self.mocked_preflight()

        def unreadable(filename):
            if Path(filename).name == "3P0G_seed1_model_0.cif":
                raise OSError("Synthetic persistent coordinate read error")
            return self.real_digest(filename)

        with patch.object(runner, "command", side_effect=self.fake_command()) as command, \
                patch.object(runner, "digest", side_effect=unreadable):
            result = self.run_fixture()
        self.assertEqual(command.call_count, 2)
        self.assertEqual(result["status"], "FAILED")
        row = next(row for row in result["attempts"] if row["id"] == "seed1_model_0")
        self.assertEqual(row["status"], "accounting-failed")
        coordinate = row["artifacts"]["coordinate"]
        self.assertTrue(coordinate["path"].endswith("3P0G_seed1_model_0.cif"))
        self.assertEqual(coordinate["accountingError"], "OSError")
        self.assertIn("Synthetic persistent", coordinate["error"])
        self.assertNotIn("sha256", coordinate)
        self.assertTrue((self.output / coordinate["path"]).is_file())
        indexed = next(item for item in result["outputFiles"] if item["path"] == coordinate["path"])
        self.assertEqual(indexed["accountingError"], "OSError")
        self.assertTrue(all(row["status"] == "not-run" for row in result["attempts"] if row["seed"] == 2))

    def test_missing_input_fails_before_any_child_or_cache_preparation(self):
        (self.inputs / "manifest.json").unlink()
        with patch.object(runner, "command") as command, patch.object(runner, "prepare_molecules") as prepare:
            result = self.run_fixture()
        command.assert_not_called()
        prepare.assert_not_called()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["errorType"], "ValueError")
        self.assertEqual(result["runs"], [])
        self.assertTrue(all(row["status"] == "not-run" for row in result["attempts"]))

    def test_failed_runtime_smoke_prevents_all_inference(self):
        self.mocked_preflight()
        with patch.object(runner, "command", side_effect=self.fake_command(smoke_exit=1)) as command:
            result = self.run_fixture()
        self.assertEqual(command.call_count, 1)
        self.assertEqual(result["status"], "FAILED")
        self.assertIn("GPU runtime smoke check failed", result["error"])
        self.assertEqual(result["runs"], [])
        self.assertTrue(all(row["status"] == "not-run" for row in result["attempts"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
