"""Synthetic join/ranking fixtures only. No generated points are study results."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/summarize-gpcr-development.py"
SPEC = importlib.util.spec_from_file_location("gpcr_summary", SCRIPT)
summary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(summary)


def fixture():
    official, audits, source = [], [], []
    for job, reference in [("SYNTHETIC_A_seed1", "SYNTH_A"),
                           ("SYNTHETIC_A_seed2", "SYNTH_A"),
                           ("SYNTHETIC_B_seed1", "SYNTH_B")]:
        for model, dq in enumerate([.1, .23, .3, .7, .9]):
            hashes = {
                "model": hashlib.sha256(f"synthetic:{job}:{model}:model".encode()).hexdigest(),
                "request": hashlib.sha256(f"synthetic:{job}:request".encode()).hexdigest(),
                "native": hashlib.sha256(f"synthetic:{reference}:native".encode()).hexdigest(),
            }
            official.append({"job": job, "model": str(model), "reference": reference,
                             "model_receptor": "A", "model_binder": "B",
                             "model_sha256": hashes["model"], "request_sha256": hashes["request"],
                             "native_sha256": hashes["native"], "official_DockQ_version": "2.1.3",
                             "official_DockQ": str(dq), "official_fnat": ".5",
                             "official_iRMSD": "1.2", "official_LRMSD": "2.1", "legacy_custom_score": ".4"})
            audits.append({"job": job, "modelIndex": model, "reference": reference,
                           "chains": {"receptor": "A", "vhh": "B"},
                           "modelSha256": hashes["model"], "requestSha256": hashes["request"],
                           "nativeSha256": hashes["native"], "paeStatus": "not-provided",
                           "evidenceLevel": "supported", "evidenceRank": [2, 1, 1, 3, 4][model],
                           "evidenceTier": "synthetic", "interfaceBurialAngstrom2": 100.,
                           "contactPairCount": 12, "severeClashCount": 0, "cdrContactShare": .8,
                           "numberingStatus": "synthetic", "recurrenceRank": 1})
            source.append({"job": job, "model": str(model), "reference": reference, "DockQ": ".4",
                           "tm3_tm6_A": "12.0", "iptm": ".7",
                           "ranking_score": str([.5, .9, .9, .2, .1][model])})
    return official, audits, source


class SummaryTest(unittest.TestCase):
    def setUp(self):
        self.official, self.audits, self.source = fixture()

    def join(self):
        return summary.join_results(self.official, self.audits, self.source, expected=15)

    def test_grouping_preserves_five_models_and_all_ties(self):
        rows = self.join()
        jobs, conditions, references = summary.summaries(rows)
        self.assertEqual(len(rows), 15)
        self.assertEqual(len(jobs), 3)
        self.assertEqual(len(conditions), 2)
        self.assertEqual(len(references), 2)
        self.assertEqual([row["models"] for row in jobs], [5, 5, 5])
        for row in jobs:
            self.assertEqual(row["confovhh_top_models"], "1;2")
            self.assertEqual(row["source_producer_top_models"], "1;2")
            self.assertEqual(row["confovhh_top_DockQ_min"], .23)
            self.assertEqual(row["confovhh_top_DockQ_max"], .3)
            self.assertEqual(row["source_producer_top_DockQ_min"], .23)
            self.assertEqual(row["source_producer_top_DockQ_max"], .3)
            self.assertEqual(row["official_at_least_acceptable_models"], 4)
        self.assertEqual(conditions[0]["retained_seeds"], "1;2")
        self.assertEqual(conditions[0]["retained_jobs"], 2)
        self.assertEqual(conditions[0]["retained_models"], 10)
        self.assertEqual(references[0]["models"], 10)
        self.assertEqual(references[0]["confovhh_supported_below_DockQ_023"], 2)

    def test_input_order_does_not_change_grouping_or_tie_membership(self):
        original = summary.summaries(self.join())
        self.official.reverse()
        self.audits.reverse()
        self.source.reverse()
        self.assertEqual(summary.summaries(self.join()), original)

    def test_model_request_and_reference_hash_mismatch_rejected(self):
        for field in ["modelSha256", "requestSha256", "nativeSha256"]:
            with self.subTest(field=field):
                official, audits, source = fixture()
                audits[0][field] = "0" * 64
                with self.assertRaisesRegex(ValueError, "Identity/provenance mismatch"):
                    summary.join_results(official, audits, source, expected=15)

    def test_swapped_receptor_binder_roles_rejected_despite_matching_file_hashes(self):
        self.audits[0]["chains"] = {"receptor": "B", "vhh": "A"}
        with self.assertRaisesRegex(ValueError, "chain|role"):
            self.join()

    def test_duplicate_rows_in_each_input_rejected(self):
        for index in range(3):
            with self.subTest(index=index):
                rows = list(fixture())
                rows[index].append(copy.deepcopy(rows[index][0]))
                with self.assertRaisesRegex(ValueError, "Duplicate model identity"):
                    summary.join_results(*rows, expected=15)

    def test_dropped_or_extra_official_or_audit_row_rejected(self):
        for index in [0, 1]:
            for action in ["drop", "extra"]:
                with self.subTest(index=index, action=action):
                    rows = list(fixture())
                    if action == "drop":
                        rows[index].pop()
                    else:
                        extra = copy.deepcopy(rows[index][-1])
                        extra["model" if index == 0 else "modelIndex"] = 5
                        rows[index].append(extra)
                    with self.assertRaises(ValueError):
                        summary.join_results(*rows, expected=15)

    def test_matching_truncated_inputs_are_rejected(self):
        self.official.pop()
        self.audits.pop()
        with self.assertRaises(ValueError):
            self.join()

    def test_missing_source_model_is_rejected(self):
        self.source.pop()
        with self.assertRaises((ValueError, KeyError)):
            self.join()

    def test_unscored_source_rows_remain_permitted(self):
        extra = copy.deepcopy(self.source[-1])
        extra["job"] = "SYNTHETIC_EXCLUDED_seed1"
        self.source.append(extra)
        self.assertEqual(len(self.join()), 15)

    def test_changed_legacy_binding_and_scorer_version_rejected(self):
        for field, value in [("legacy_custom_score", ".5"), ("official_DockQ_version", "2.1.4")]:
            with self.subTest(field=field):
                official, audits, source = fixture()
                official[0][field] = value
                with self.assertRaises(ValueError):
                    summary.join_results(official, audits, source, expected=15)

    def test_nonfinite_primary_numbers_rejected(self):
        fields = [(0, key) for key in ["official_DockQ", "official_fnat", "official_iRMSD", "official_LRMSD", "legacy_custom_score"]]
        fields += [(1, "interfaceBurialAngstrom2")]
        fields += [(2, key) for key in ["DockQ", "tm3_tm6_A", "iptm", "ranking_score"]]
        for index, field in fields:
            for value in ["NaN", "Infinity", "-Infinity"]:
                with self.subTest(index=index, field=field, value=value):
                    rows = list(fixture())
                    rows[index][0][field] = value
                    with self.assertRaises(ValueError):
                        summary.join_results(*rows, expected=15)

    def test_five_unique_indices_are_required(self):
        self.official[0]["model"] = "5"
        self.audits[0]["modelIndex"] = 5
        self.source[0]["model"] = "5"
        with self.assertRaises(ValueError):
            self.join()

    def test_fractional_rank_or_counts_must_not_be_silently_truncated(self):
        for field in ["evidenceRank", "contactPairCount", "severeClashCount"]:
            with self.subTest(field=field):
                official, audits, source = fixture()
                audits[0][field] = 1.9
                with self.assertRaises(ValueError):
                    summary.join_results(official, audits, source, expected=15)

    def test_mixed_references_within_one_job_are_rejected(self):
        self.official[0]["reference"] = "SYNTH_OTHER"
        self.audits[0]["reference"] = "SYNTH_OTHER"
        self.source[0]["reference"] = "SYNTH_OTHER"
        with self.assertRaises(ValueError):
            self.join()

    def test_nonfinite_optional_numeric_fields_rejected(self):
        for field in ["cdrContactShare", "recurrenceRank"]:
            with self.subTest(field=field):
                official, audits, source = fixture()
                audits[0][field] = float("nan")
                with self.assertRaises(ValueError):
                    summary.join_results(official, audits, source, expected=15)

    def test_reviewed_manifest_exact_set_and_field_binding(self):
        fields = ["job", "model", "reference", "model_sha256", "request_sha256", "native_sha256"]
        reviewed = [{key: row[key] for key in fields} for row in self.official]
        result = summary.join_results(self.official, self.audits, self.source, expected=15, reviewed=reviewed)
        self.assertEqual(len(result), 15)
        for field in ["model_sha256", "request_sha256", "native_sha256"]:
            with self.subTest(field=field):
                altered = copy.deepcopy(reviewed)
                altered[0][field] = "0" * 64
                with self.assertRaisesRegex(ValueError, "reviewed manifest"):
                    summary.join_results(self.official, self.audits, self.source, expected=15, reviewed=altered)

    def test_same_size_whole_job_substitution_is_rejected_by_reviewed_manifest(self):
        fields = ["job", "model", "reference", "model_sha256", "request_sha256", "native_sha256"]
        reviewed = [{key: row[key] for key in fields} for row in self.official]
        for rows in [self.official, self.audits, self.source]:
            for row in rows:
                if row["job"] == "SYNTHETIC_B_seed1":
                    row["job"] = "SYNTHETIC_REPLACEMENT_seed1"
        with self.assertRaisesRegex(ValueError, "reviewed cohort"):
            summary.join_results(self.official, self.audits, self.source, expected=15, reviewed=reviewed)

    def test_duplicate_missing_and_extra_reviewed_rows_are_rejected(self):
        fields = ["job", "model", "reference", "model_sha256", "request_sha256", "native_sha256"]
        base = [{key: row[key] for key in fields} for row in self.official]
        for action in ["duplicate", "missing", "extra"]:
            with self.subTest(action=action):
                reviewed = copy.deepcopy(base)
                if action == "duplicate":
                    reviewed.append(copy.deepcopy(reviewed[0]))
                elif action == "missing":
                    reviewed.pop()
                else:
                    extra = copy.deepcopy(reviewed[0])
                    extra["job"] = "SYNTHETIC_OTHER_seed1"
                    reviewed.append(extra)
                with self.assertRaises(ValueError):
                    summary.join_results(self.official, self.audits, self.source, expected=15, reviewed=reviewed)


if __name__ == "__main__":
    unittest.main()
