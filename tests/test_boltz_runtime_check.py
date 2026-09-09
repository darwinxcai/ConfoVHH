"""Offline control-flow tests only; these tests produce no GPU runtime evidence."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("boltz_runtime_check", ROOT / "scripts/cloud/check-boltz-runtime.py")
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
LOCK = "boltz==2.2.1 " + "\\" + "\n    --hash=sha256:" + "a" * 64 + "\n"
LOCK += "torch==2.7.1 --hash=sha256:" + "b" * 64 + "\n"


class RuntimeCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock = self.root / "requirements.lock"
        self.lock.write_text(LOCK)
        self.output = self.root / "receipt.json"
        self.runtime = {"python": "3.11.0", "python_major_minor": [3, 11],
                        "implementation": "CPython", "system": "Linux", "machine": "x86_64",
                        "python_executable": str(self.root / "bin/python"),
                        "prefix": str(self.root), "isolated_venv": True}
        self.inventory = {"boltz": ["2.2.1"], "torch": ["2.7.1"], "pip": ["25.0"]}
        environment = patch.dict(checker.os.environ, {"PYTHONPATH": "", "PYTHONHOME": ""})
        environment.start()
        self.addCleanup(environment.stop)

    def invoke(self):
        with redirect_stdout(io.StringIO()):
            code = checker.main(["--lock", str(self.lock), "--output", str(self.output)])
        return code, json.loads(self.output.read_text())

    def test_cpu_only_runtime_fails_and_preserves_receipt(self):
        fake_torch = SimpleNamespace(__version__="2.7.1+cpu", version=SimpleNamespace(cuda=None),
                                     cuda=SimpleNamespace(is_available=lambda: False))
        with patch.object(checker, "runtime_info", return_value=self.runtime), \
                patch.object(checker, "installed_inventory", return_value=self.inventory), \
                patch.object(checker.importlib, "import_module", return_value=fake_torch):
            code, receipt = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(receipt["status"], "FAIL")
        self.assertFalse(receipt["scientific_readiness"])
        self.assertEqual(receipt["model_inference_runs"], 0)
        self.assertIn("gpu_required", [item["check"] for item in receipt["failures"]])
        self.assertFalse(receipt["torch_cuda"]["matmul"]["executed"])
        self.assertFalse(receipt["distributions"]["installed_file_hashes_verified"])

    def test_mismatched_version_fails_before_imports_or_subprocess(self):
        self.inventory["boltz"] = ["2.2.0"]
        with patch.object(checker, "runtime_info", return_value=self.runtime), \
                patch.object(checker, "installed_inventory", return_value=self.inventory), \
                patch.object(checker.importlib, "import_module") as imported, \
                patch.object(checker.subprocess, "run") as process:
            code, receipt = self.invoke()
        self.assertEqual(code, 1)
        imported.assert_not_called()
        process.assert_not_called()
        boltz = next(row for row in receipt["distributions"]["locked_distributions"] if row["name"] == "boltz")
        self.assertFalse(boltz["matches_lock"])
        self.assertEqual(boltz["installed_versions"], ["2.2.0"])
        self.assertEqual(receipt["torch_cuda"]["status"], "SKIPPED")

    def test_distribution_local_suffix_is_not_silently_accepted(self):
        inventory = {"boltz": ["2.2.1"], "torch": ["2.7.1+cu126"]}
        result = checker.check_distributions(checker.parse_lock(LOCK.encode()), inventory)
        self.assertFalse(result["matches_lock"])

    def test_unpinned_or_unhashed_lock_retains_failure_receipt(self):
        self.lock.write_text("boltz==2.2.1\ntorch>=2.7.1\n")
        with patch.object(checker, "runtime_info", return_value=self.runtime):
            code, receipt = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(receipt["failures"][0]["check"], "dependency_lock")
        self.assertIn("sha256", receipt["lock"])

    def test_import_exception_does_not_dump_exception_secrets(self):
        with patch.object(checker, "runtime_info", return_value=self.runtime), \
                patch.object(checker, "installed_inventory", return_value=self.inventory), \
                patch.object(checker.importlib, "import_module", side_effect=RuntimeError("secret-token=do-not-save")):
            code, receipt = self.invoke()
        self.assertEqual(code, 1)
        self.assertNotIn("secret-token", self.output.read_text())
        self.assertEqual(receipt["failures"][0]["exception_type"], "RuntimeError")

    def test_help_uses_absolute_venv_command_and_timeout(self):
        executable = self.root / "bin/boltz"
        executable.parent.mkdir()
        executable.write_text(f"#!{self.root}/bin/python\n# test fixture; never executed\n")
        executable.chmod(0o700)
        receipt = {"runtime": self.runtime, "failures": []}
        result = subprocess.CompletedProcess([], 0, stdout=b"Usage: boltz predict [OPTIONS]", stderr=b"")
        with patch.object(checker.subprocess, "run", return_value=result) as process, \
                patch.dict(checker.os.environ, {"PYTHONPATH": "sensitive-override", "PYTHONHOME": "sensitive-home"}):
            checker.check_boltz_help(receipt)
        self.assertEqual(process.call_args.args[0], [str(executable), "predict", "--help"])
        self.assertEqual(process.call_args.kwargs["timeout"], 60)
        self.assertFalse(process.call_args.kwargs["shell"])
        self.assertNotIn("PYTHONPATH", process.call_args.kwargs["env"])
        self.assertNotIn("PYTHONHOME", process.call_args.kwargs["env"])
        self.assertEqual(receipt["boltz_predict_help"]["status"], "PASS")
        self.assertEqual(receipt["failures"], [])

    def test_help_timeout_records_hashes_without_raw_output(self):
        executable = self.root / "bin/boltz"
        executable.parent.mkdir()
        executable.write_text(f"#!{self.root}/bin/python\n# test fixture; never executed\n")
        executable.chmod(0o700)
        receipt = {"runtime": self.runtime, "failures": []}
        error = subprocess.TimeoutExpired([], 60, output=b"secret-in-stdout", stderr=b"secret-in-stderr")
        with patch.object(checker.subprocess, "run", side_effect=error):
            checker.check_boltz_help(receipt)
        self.assertTrue(receipt["boltz_predict_help"]["timed_out"])
        self.assertEqual(receipt["boltz_predict_help"]["status"], "FAIL")
        self.assertNotIn("secret-in", json.dumps(receipt))

    def test_duplicate_normalized_distribution_is_rejected(self):
        duplicate = LOCK + "some-package==1.0 --hash=sha256:" + "c" * 64 + "\n"
        duplicate += "Some_Package==1.0 --hash=sha256:" + "c" * 64 + "\n"
        with self.assertRaisesRegex(ValueError, "Duplicate normalized"):
            checker.parse_lock(duplicate.encode())

    def test_venv_with_system_site_packages_is_not_isolated(self):
        (self.root / "pyvenv.cfg").write_text("include-system-site-packages = true\n")
        with patch.object(checker.sys, "prefix", str(self.root)), \
                patch.object(checker.sys, "base_prefix", str(self.root / "base")):
            runtime = checker.runtime_info()
        self.assertTrue(runtime["active_venv"])
        self.assertTrue(runtime["system_site_packages_enabled"])
        self.assertFalse(runtime["isolated_venv"])

    def test_boltz_stale_shebang_does_not_execute_another_python(self):
        executable = self.root / "bin/boltz"
        executable.parent.mkdir()
        executable.write_text("#!/different-environment/bin/python\n# not executed\n")
        executable.chmod(0o700)
        receipt = {"runtime": self.runtime, "failures": []}
        with patch.object(checker.subprocess, "run") as process:
            checker.check_boltz_help(receipt)
        process.assert_not_called()
        self.assertEqual(receipt["boltz_predict_help"]["status"], "FAIL")
        self.assertEqual(receipt["failures"][0]["check"], "boltz_cli_interpreter")

    def test_existing_receipt_is_preserved_before_checks(self):
        original = '{"status":"FAIL","attempt":"previous"}\n'
        self.output.write_text(original)
        with patch.object(checker, "run_checks") as checks, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                self.invoke()
        self.assertEqual(raised.exception.code, 2)
        checks.assert_not_called()
        self.assertEqual(self.output.read_text(), original)

    def test_nonempty_python_import_overrides_fail_without_recording_values(self):
        for name in ("PYTHONPATH", "PYTHONHOME"):
            with self.subTest(name=name):
                self.output = self.root / f"{name}-receipt.json"
                with patch.object(checker, "runtime_info", return_value=dict(self.runtime)), \
                        patch.object(checker, "installed_inventory", return_value=self.inventory), \
                        patch.object(checker.importlib, "import_module") as imported, \
                        patch.object(checker.subprocess, "run") as process, \
                        patch.dict(checker.os.environ, {name: "sensitive-override-value"}):
                    code, receipt = self.invoke()
                self.assertEqual(code, 1)
                imported.assert_not_called()
                process.assert_not_called()
                self.assertIn("python_import_environment", [item["check"] for item in receipt["failures"]])
                self.assertTrue(receipt["runtime"]["python_environment_overrides_nonempty"][name])
                self.assertNotIn("sensitive-override-value", self.output.read_text())


if __name__ == "__main__":
    unittest.main()
