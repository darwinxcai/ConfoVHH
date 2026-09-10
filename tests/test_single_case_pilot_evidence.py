"""Offline evidence-integrity tests; none launches prediction or network access."""

import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "pilot_evidence", ROOT / "scripts/paper/verify-single-case-pilot-evidence.py")
EVIDENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVIDENCE)


class PilotEvidenceTests(unittest.TestCase):
    def report(self):
        return EVIDENCE.read_json(
            ROOT / EVIDENCE.PACKAGE / "original-evaluation/comparison-receipt.json")["report"]

    def test_complete_preserved_pilot_and_replay(self):
        result = EVIDENCE.verify(ROOT)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["candidateCount"], 10)
        self.assertEqual(result["originalEvaluationArtifactsVerified"], 51)
        self.assertEqual(result["frozenSourceFilesVerified"], 41)
        self.assertEqual(result["historicalAttemptCounts"], {
            "initialFailed": 10, "compilerNotRun": 10,
            "startup01NotRun": 10, "startup02NotRun": 10,
        })
        self.assertFalse(result["independentValidation"])
        self.assertFalse(result["newGpuGeneration"])

    def test_same_length_artifact_mutation_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            artifact = base / "coordinates.cif"
            artifact.write_bytes(b"original coordinate bytes")
            records = [{"path": artifact.name, "bytes": artifact.stat().st_size,
                        "sha256": EVIDENCE.digest(artifact)}]
            EVIDENCE.verify_files(base, records, "fixture")
            artifact.write_bytes(b"modified coordinate bytes")
            with self.assertRaisesRegex(EVIDENCE.EvidenceError, "hash mismatch"):
                EVIDENCE.verify_files(base, records, "fixture")

    def test_rewritten_manifest_digest_fails(self):
        manifest = EVIDENCE.read_json(ROOT / EVIDENCE.MANIFEST)
        manifest["artifacts"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "hash mismatch"):
            EVIDENCE.verify(ROOT, manifest)

    def test_missing_and_duplicate_candidates_fail(self):
        report = self.report()
        report["candidateLedger"].pop()
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "expected ten"):
            EVIDENCE.validate_original_report(report)
        report = self.report()
        report["candidateLedger"][-1] = copy.deepcopy(report["candidateLedger"][0])
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "candidate IDs"):
            EVIDENCE.validate_original_report(report)

    def test_missingness_and_tie_erasure_fail(self):
        report = self.report()
        report["inventory"]["generated"] = 9
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "inventory changed"):
            EVIDENCE.validate_original_report(report)
        report = self.report()
        report["confo"]["candidateIds"] = ["seed2_model_0"]
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "tie set inconsistent"):
            EVIDENCE.validate_original_report(report)

    def test_independent_validation_promotion_fails(self):
        manifest = EVIDENCE.read_json(ROOT / EVIDENCE.MANIFEST)
        manifest["boundaries"]["independentValidation"] = True
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "independentValidation"):
            EVIDENCE.validate_boundaries(manifest["boundaries"])
        manifest["boundaries"]["independentValidation"] = False
        manifest["boundaries"]["developmentExposed"] = 1
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "developmentExposed"):
            EVIDENCE.validate_boundaries(manifest["boundaries"])

    def test_changed_manuscript_claim_fails(self):
        manifest = EVIDENCE.read_json(ROOT / EVIDENCE.MANIFEST)
        claims = manifest["claims"]
        claims[0]["text"] = "Invented claim text that does not occur in the reviewed manuscript."
        with self.assertRaisesRegex(EVIDENCE.EvidenceError, "text absent"):
            EVIDENCE.verify_claim_text(ROOT, claims,
                                       {artifact["path"] for artifact in manifest["artifacts"]})

    def test_paths_and_duplicate_json_keys_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            with self.assertRaisesRegex(EVIDENCE.EvidenceError, "unsafe"):
                EVIDENCE.regular_file(base, "../outside")
            target = base / "original.json"
            target.write_text('{"id": 1, "id": 2}')
            with self.assertRaisesRegex(EVIDENCE.EvidenceError, "duplicate JSON"):
                EVIDENCE.read_json(target)
            link = base / "link.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(EVIDENCE.EvidenceError, "direct regular file"):
                EVIDENCE.regular_file(base, "link.json")


if __name__ == "__main__":
    unittest.main()
