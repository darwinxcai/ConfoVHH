"""Offline fail-closed tests; no predictor, network, or frozen benchmark data."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/score-cognate-interfaces.py"
spec = importlib.util.spec_from_file_location("gpcr_paper_dockq", SCRIPT)
scorer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)


class GuardTests(unittest.TestCase):
    def test_version_and_module_changes_rejected_before_scoring(self):
        with self.assertRaisesRegex(ValueError, "Expected DockQ"):
            scorer.verify_runtime(None, version="9.0.0")
        with self.assertRaisesRegex(ValueError, "module hash mismatch"):
            scorer.verify_runtime(None, version="2.1.3", digest="0" * 64)

    def test_duplicate_predictions_are_not_independent_rows(self):
        with self.assertRaisesRegex(ValueError, "Duplicate identity"):
            scorer.index_unique([{"job": "j", "model": "0"}] * 2, ("job", "model"))

    def test_missing_and_escaping_input_paths_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                scorer.under(root, "missing.cif")
            with self.assertRaisesRegex(ValueError, "outside input root"):
                scorer.under(root, "../outside.cif")

    def test_noncognate_control_rejected_before_any_source_access(self):
        for job in ("SWAP_3P0Grec_Nb60_seed1", "IRREL_5JQHrec_lysVHH_seed1"):
            with self.subTest(job=job), self.assertRaisesRegex(ValueError, "Noncognate control"):
                scorer.validate_row({"job": job, "model": "0"}, None, None, {}, {}, None, {})

    def test_nonfinite_metrics_rejected(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.assertRaises(ValueError):
                scorer.finite(value)

    def test_failed_model_leaves_partial_ledger_and_successes_continue(self):
        rows = [{"job": "job", "model": str(i)} for i in range(3)]
        contexts = [{"request_sha256": "a", "native_to_model": {"A": "B", "B": "A"}}] * 3
        calls = []

        def fail_middle(row, root, dockq):
            calls.append(row["model"])
            if row["model"] == "1":
                raise RuntimeError("deliberate middle-model failure")
            return {"DockQ": 0.5, "chain_map": {"A": "B", "B": "A"}}

        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            out = Path(temporary)
            results, failures = scorer.score_all(rows, contexts, out, out, None, fail_middle)
            ledger = [json.loads(line) for line in (out / "per_model_ledger.jsonl").read_text().splitlines()]
            self.assertEqual(calls, ["0", "1", "2"])
            self.assertEqual((len(results), failures), (2, 1))
            self.assertEqual([r["ok"] for r in ledger], [True, False, True])
            self.assertIn("deliberate middle-model failure", ledger[1]["error"])
            self.assertTrue((out / "official_DockQ.partial.csv").exists())
            self.assertFalse((out / "official_DockQ.csv").exists())
            self.assertEqual([r["input"] for r in ledger], rows)

    def test_wrong_interface_and_nonfinite_result_clear_caches(self):
        for mapping in ({}, {"AB": {"chain_map": {"A": "B", "B": "A"}, "DockQ": float("nan")}}):
            cleared = []
            fake = types.SimpleNamespace(
                load_PDB=lambda *a, **k: None,
                run_on_all_native_interfaces=lambda *a, **k: (mapping, 0.0),
                align_chains=types.SimpleNamespace(cache_clear=lambda: cleared.append(True)))
            with self.assertRaises(ValueError):
                scorer.score_paths(Path("model"), Path("native"), {"A": "B", "B": "A"}, fake)
            self.assertEqual(cleared, [True])

    def test_missing_manifest_returns_nonzero_with_failure_receipt(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stderr(io.StringIO()):
            root = Path(temporary)
            out = root / "result"
            code = scorer.main(["--root", str(root), "--manifest", str(root / "absent.csv"),
                                "--source", str(root), "--mapping-review", str(root / "review.json"), "--out", str(out)])
            self.assertEqual(code, 1)
            receipt = json.loads((out / "run_provenance.json").read_text())
            self.assertEqual(receipt["status"], "FAILED")
            self.assertEqual(receipt["error_type"], "FileNotFoundError")
            self.assertFalse((out / "official_DockQ.csv").exists())

    def test_changed_coordinates_rejected_at_scoring_time(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "model.cif").write_text("changed")
            (root / "native.cif").write_text("native")
            with self.assertRaisesRegex(ValueError, "model changed since preflight"):
                scorer.score_row({"job": "j", "model": "0", "model_path": "model.cif", "native_path": "native.cif",
                                  "model_sha256": "0" * 64, "native_sha256": "1" * 64}, root, None)


if __name__ == "__main__":
    unittest.main()
