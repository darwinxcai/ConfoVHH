"""Offline controls; mocked GPU success is not GPU execution evidence."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import sysconfig
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("boltz_toolchain_check", ROOT / "scripts/cloud/check-boltz-toolchain.py")
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class ToolchainCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "new-output"
        self.runtime = {"python_major_minor": [3, 11], "implementation": "CPython",
                        "system": "Linux", "machine": "x86_64", "isolated_flag": True,
                        "isolated_venv": True}

    def invoke(self, compiler_only=False):
        arguments = ["--output", str(self.output)] + (["--compiler-only"] if compiler_only else [])
        with patch.object(checker, "runtime_info", return_value=self.runtime), redirect_stdout(io.StringIO()):
            code = checker.main(arguments)
        return code, json.loads((self.output / "receipt.json").read_text())

    def fake_logged(self, command, output, label, timeout, environment, status="PASS"):
        for stream in ("stdout", "stderr"):
            (output / f"{label}.{stream}.log").write_bytes(b"")
        return {"status": status, "returncode": 0 if status == "PASS" else 1}

    def compiler_pass(self, receipt, output):
        receipt["compiler"] = {"status": "PASS", "executable": {"path": sys.executable}}
        receipt["python_headers"] = {"status": "PASS"}

    def test_missing_compiler_fails_and_writes_receipt(self):
        with patch.dict(checker.os.environ, {}, clear=True), \
                patch.object(checker.shutil, "which", return_value=None), \
                patch.object(checker, "run_logged") as process:
            code, receipt = self.invoke(compiler_only=True)
        self.assertEqual(code, 1)
        self.assertEqual(receipt["status"], "FAIL")
        self.assertEqual(receipt["failures"][0]["check"], "compiler_resolution")
        self.assertIn("No C compiler", receipt["failures"][0]["message"])
        process.assert_not_called()

    def test_invalid_or_empty_cc_never_falls_back_or_records_value(self):
        for index, value in enumerate(("", "missing-secret-token", "gcc --bad-option")):
            self.output = self.root / f"invalid-{index}"
            with patch.dict(checker.os.environ, {"CC": value}, clear=True), \
                    patch.object(checker.shutil, "which", return_value=None) as which:
                code, receipt = self.invoke(compiler_only=True)
            self.assertEqual(code, 1)
            self.assertTrue(receipt["compiler"]["cc_override_present"])
            self.assertIn("no fallback", receipt["failures"][0]["message"])
            if value:
                which.assert_called_once_with(value)
                self.assertNotIn(value, json.dumps(receipt))
            else:
                which.assert_not_called()

    def test_gcc_then_clang_resolution_matches_triton(self):
        with patch.dict(checker.os.environ, {}, clear=True), \
                patch.object(checker.shutil, "which", side_effect=lambda name: "/bin/" + name):
            self.assertEqual(checker.resolve_compiler(), ("/bin/gcc", "gcc"))
        with patch.dict(checker.os.environ, {}, clear=True), \
                patch.object(checker.shutil, "which", side_effect=lambda name: None if name == "gcc" else "/bin/clang"):
            self.assertEqual(checker.resolve_compiler(), ("/bin/clang", "clang"))

    def test_missing_active_python_headers_fails_before_compile(self):
        with patch.object(checker, "resolve_compiler", return_value=(sys.executable, "CC")), \
                patch.object(checker, "run_logged", side_effect=self.fake_logged) as process, \
                patch.object(checker.sysconfig, "get_paths", return_value={"include": str(self.root)}):
            code, receipt = self.invoke(compiler_only=True)
        self.assertEqual(code, 1)
        self.assertEqual(receipt["failures"][0]["check"], "python_headers")
        self.assertIn("active interpreter", receipt["failures"][0]["message"])
        self.assertEqual(process.call_count, 1)

    def test_failed_compilation_stops_jit(self):
        for name in ("Python.h", "patchlevel.h", "pyconfig.h"):
            (self.root / name).write_text("/* mock headers; not compiled */\n")

        def logged(command, output, label, timeout, environment):
            return self.fake_logged(command, output, label, timeout, environment,
                                    "FAIL" if label == "compiler-build" else "PASS")

        with patch.object(checker, "resolve_compiler", return_value=(sys.executable, "CC")), \
                patch.object(checker.sysconfig, "get_paths", return_value={"include": str(self.root)}), \
                patch.object(checker, "run_logged", side_effect=logged), \
                patch.object(checker, "check_jit") as jit:
            code, receipt = self.invoke(compiler_only=True)
        self.assertEqual(code, 1)
        self.assertEqual(receipt["failures"][0]["check"], "c_compile")
        self.assertEqual(receipt["compiler"]["status"], "FAIL")
        self.assertIn(f"PY_VERSION_HEX == {sys.hexversion}", (self.output / "compiler-probe.c").read_text())
        jit.assert_not_called()

    def test_bad_runtime_or_versions_prevent_toolchain_execution(self):
        cases = (({"isolated_flag": False}, ["2.7.1"]),
                 ({"isolated_venv": False}, ["2.7.1"]),
                 ({"python_major_minor": [3, 12]}, ["2.7.1"]),
                 ({}, ["2.7.1+cu126"]), ({}, ["2.7.1", "2.7.1"]))
        for index, (runtime_change, torch_versions) in enumerate(cases):
            self.output = self.root / f"bad-runtime-{index}"
            with patch.dict(self.runtime, runtime_change), \
                    patch.object(checker, "distribution_versions", return_value={"torch": torch_versions, "triton": ["3.3.1"]}), \
                    patch.object(checker, "check_compiler") as compiler:
                code, receipt = self.invoke()
            self.assertEqual(code, 1)
            self.assertEqual(receipt["status"], "FAIL")
            compiler.assert_not_called()

    def test_jit_failure_prevents_pass_and_preserves_child_logs(self):
        def failed_child(command, output, label, timeout, environment):
            row = self.fake_logged(command, output, label, timeout, environment, "FAIL")
            (output / "triton-jit.stderr.log").write_text("mock Triton compiler error\n")
            return row

        with patch.object(checker, "distribution_versions", return_value={"torch": ["2.7.1"], "triton": ["3.3.1"]}), \
                patch.object(checker, "check_compiler", side_effect=self.compiler_pass), \
                patch.object(checker, "run_logged", side_effect=failed_child):
            code, receipt = self.invoke()
        self.assertEqual(code, 1)
        self.assertEqual(receipt["status"], "FAIL")
        self.assertEqual(receipt["triton_jit"]["status"], "FAIL")
        self.assertIn("triton_jit", [row["check"] for row in receipt["failures"]])
        self.assertTrue((self.output / "triton-jit.stderr.log").is_file())
        self.assertTrue((self.output / "triton-jit-probe.py").is_file())

    def test_fresh_jit_uses_file_isolation_timeout_and_does_not_change_environment(self):
        observed = {}

        def child(command, output, label, timeout, environment):
            observed.update({"command": command, "timeout": timeout, "environment": environment})
            for name in ("TRITON_CACHE_DIR", "TORCHINDUCTOR_CACHE_DIR"):
                self.assertEqual(list(Path(environment[name]).iterdir()), [])
            Path(command[-1]).write_text(json.dumps({"status": "PASS", "kernel_executed": True,
                "cuda_synchronized": True, "non_block_multiple": True, "fresh_cache_cubin_count": 1}))
            return self.fake_logged(command, output, label, timeout, environment)

        with patch.dict(checker.os.environ, {"TRITON_CACHE_DIR": "old-cache", "TRITON_INTERPRET": "1",
                                             "TRITON_CACHE_MANAGER": "custom", "TORCHINDUCTOR_CACHE_DIR": "old-inductor"}), \
                patch.object(checker, "distribution_versions", return_value={"torch": ["2.7.1"], "triton": ["3.3.1"]}), \
                patch.object(checker, "check_compiler", side_effect=self.compiler_pass), \
                patch.object(checker, "run_logged", side_effect=child):
            before = dict(os.environ)
            code, receipt = self.invoke()
            self.assertEqual(dict(os.environ), before)
        self.assertEqual(code, 0)  # Mocked control-flow success only.
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(observed["command"][:2], [sys.executable, "-I"])
        self.assertTrue(Path(observed["command"][2]).is_file())
        self.assertLessEqual(observed["timeout"], 120)
        self.assertEqual(observed["environment"]["TRITON_INTERPRET"], "0")
        self.assertNotIn("TRITON_CACHE_MANAGER", observed["environment"])
        self.assertFalse(Path(observed["environment"]["TRITON_CACHE_DIR"]).exists())

    def test_existing_output_is_preserved(self):
        self.output.mkdir()
        previous = self.output / "receipt.json"
        previous.write_text('{"status":"FAIL","previous":true}\n')
        with patch.object(checker, "run_checks") as checks, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                self.invoke()
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(previous.read_text(), '{"status":"FAIL","previous":true}\n')
        checks.assert_not_called()

    def test_unexpected_failure_writes_sanitized_receipt(self):
        with patch.object(checker, "runtime_info", side_effect=RuntimeError("secret-token")), redirect_stdout(io.StringIO()):
            code = checker.main(["--output", str(self.output), "--compiler-only"])
        receipt = json.loads((self.output / "receipt.json").read_text())
        self.assertEqual(code, 1)
        self.assertNotIn("secret-token", json.dumps(receipt))
        self.assertEqual(receipt["failures"][0]["exception_type"], "RuntimeError")

    def test_subprocess_timeout_retains_raw_logs_and_hashes(self):
        self.output.mkdir()
        row = checker.run_logged([sys.executable, "-I", "-c",
                                  "import time; print('before timeout', flush=True); time.sleep(10)"],
                                 self.output, "timeout", 0.2, dict(os.environ))
        self.assertEqual(row["status"], "FAIL")
        self.assertTrue(row["timed_out"])
        self.assertIn(b"before timeout", (self.output / "timeout.stdout.log").read_bytes())
        self.assertEqual(row["stdout"]["sha256"], checker.file_identity(self.output / "timeout.stdout.log")["sha256"])
        self.assertEqual((self.output / "timeout.stdout.log").stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(shutil.which("gcc") and (Path(sysconfig.get_path("include")) / "Python.h").is_file(),
                         "requires a local CPU C compiler and active Python headers")
    def test_real_cpu_compiler_control_is_never_full_pass(self):
        with patch.dict(checker.os.environ, {"CC": shutil.which("gcc")}):
            code, receipt = self.invoke(compiler_only=True)
        self.assertEqual(code, 0)
        self.assertEqual(receipt["status"], "COMPILER_ONLY_PASS")
        self.assertEqual(receipt["compiler"]["compile"]["status"], "PASS")
        self.assertTrue(receipt["compiler"]["run"]["expected_output_matched"])
        self.assertTrue(receipt["python_headers"]["exact_runtime_version_compile_assertion"])
        self.assertEqual(receipt["triton_jit"]["status"], "SKIPPED")
        self.assertFalse(receipt["scientific_readiness"])

    @unittest.skipUnless(shutil.which("gcc"), "requires a local CPU C compiler")
    def test_real_compiler_rejects_headers_for_another_python_version(self):
        (self.root / "Python.h").write_text(f"#define PY_VERSION_HEX {sys.hexversion - 0x10000}\n")
        for name in ("patchlevel.h", "pyconfig.h"):
            (self.root / name).write_text("/* deliberately mismatched header fixture */\n")
        with patch.dict(checker.os.environ, {"CC": shutil.which("gcc")}), \
                patch.object(checker.sysconfig, "get_paths", return_value={"include": str(self.root)}):
            code, receipt = self.invoke(compiler_only=True)
        self.assertEqual(code, 1)
        self.assertEqual(receipt["failures"][0]["check"], "c_compile")
        self.assertEqual(receipt["compiler"]["compile"]["status"], "FAIL")
        self.assertIn("Python headers differ from active runtime", (self.output / "compiler-build.stderr.log").read_text())


if __name__ == "__main__":
    unittest.main()
