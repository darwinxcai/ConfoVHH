"""Synthetic selection fixtures only; these points never enter paper outputs."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import random
import sys
import unittest

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "scripts/paper/audit-gpcr-selection.py"
SPEC = importlib.util.spec_from_file_location("gpcr_selection", SCRIPT)
selection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selection)


def fixture(job="SYNTHETIC_MIXED_seed1", dockqs=None, ranks=None, scores=None):
    dockqs = dockqs if dockqs is not None else [.229999999, .23, .9, .1, .8]
    ranks = ranks if ranks is not None else [1, 1, 2, 3, 4]
    scores = scores if scores is not None else [.9, .9, .8, .3, .2]
    reference = "SYNTHETIC_REFERENCE"
    return [{
        "job": job, "model": str(model), "reference": reference,
        "condition": job.rsplit("_seed", 1)[0],
        "official_DockQ": str(dockqs[model]),
        "confovhh_evidence_rank": str(ranks[model]),
        "source_reported_ranking_score": str(scores[model]),
        "model_sha256": hashlib.sha256(f"synthetic:{job}:model:{model}".encode()).hexdigest(),
        "request_sha256": hashlib.sha256(f"synthetic:{job}:request".encode()).hexdigest(),
        "native_sha256": hashlib.sha256(f"synthetic:{reference}:native".encode()).hexdigest(),
    } for model in range(5)]


def group(rows=None):
    rows = fixture() if rows is None else rows
    normalized = selection.validate_rows(rows)
    return normalized[rows[0]["job"]]


class SelectionTest(unittest.TestCase):
    def test_acceptability_boundary_is_inclusive_point_two_three(self):
        rows = fixture(ranks=[2, 1, 3, 4, 5])
        result = selection.evaluate_selection(group(rows), "confovhh_evidence_rank", minimize=True)
        self.assertEqual(result["models"], [1])
        for key in ["acceptable_min", "acceptable_max", "acceptable_expected"]:
            self.assertEqual(result[key], 1)
        self.assertEqual(result["DockQ_expected"], .23)
        rows = fixture(ranks=[1, 2, 3, 4, 5])
        result = selection.evaluate_selection(group(rows), "confovhh_evidence_rank", minimize=True)
        self.assertEqual(result["models"], [0])
        self.assertEqual(result["acceptable_expected"], 0)

    def test_mixed_quality_tie_keeps_both_models_and_mean_of_indicators(self):
        for key, minimize in [("confovhh_evidence_rank", True),
                              ("source_reported_ranking_score", False)]:
            with self.subTest(key=key):
                result = selection.evaluate_selection(group(), key, minimize=minimize)
                self.assertEqual(result["models"], [0, 1])
                self.assertEqual(result["acceptable_min"], 0)
                self.assertEqual(result["acceptable_max"], 1)
                self.assertEqual(result["acceptable_expected"], .5)
                self.assertEqual(result["DockQ_min"], .229999999)
                self.assertEqual(result["DockQ_max"], .23)
                self.assertAlmostEqual(result["DockQ_expected"], (.229999999 + .23) / 2)
                self.assertLess(result["DockQ_expected"], .23)

    def test_high_mean_dockq_tie_still_preserves_the_bad_model(self):
        rows = fixture(dockqs=[.1, .9, .8, .4, .5])
        result = selection.evaluate_selection(group(rows), "confovhh_evidence_rank", minimize=True)
        self.assertEqual(result["models"], [0, 1])
        self.assertEqual(result["acceptable_expected"], .5)
        self.assertEqual(result["DockQ_expected"], .5)
        self.assertEqual(result["DockQ_min"], .1)

    def test_all_tied_baseline_uses_all_five_predictions(self):
        rows = fixture(ranks=[1, 1, 1, 1, 1], scores=[.5] * 5)
        for key, minimize in [("confovhh_evidence_rank", True),
                              ("source_reported_ranking_score", False)]:
            with self.subTest(key=key):
                result = selection.evaluate_selection(group(rows), key, minimize=minimize)
                self.assertEqual(result["models"], [0, 1, 2, 3, 4])
                self.assertAlmostEqual(result["acceptable_expected"], 3 / 5)
                self.assertAlmostEqual(result["DockQ_expected"], sum(float(row["official_DockQ"]) for row in rows) / 5)

    def test_score_direction_is_explicit_and_not_selected_using_outcomes(self):
        rows = fixture(dockqs=[.1, .2, .3, .4, .9], ranks=[1, 2, 3, 4, 5], scores=[.9, .8, .7, .6, .1])
        normalized = group(rows)
        evidence = selection.evaluate_selection(normalized, "confovhh_evidence_rank", minimize=True)
        producer = selection.evaluate_selection(normalized, "source_reported_ranking_score")
        self.assertEqual(evidence["models"], [0])
        self.assertEqual(producer["models"], [0])
        self.assertEqual(evidence["acceptable_expected"], 0)
        self.assertEqual(producer["acceptable_expected"], 0)

    def test_permutation_does_not_choose_a_favorable_tie_member(self):
        baseline = fixture()
        expected = selection.evaluate_selection(group(baseline), "confovhh_evidence_rank", minimize=True)
        expected_analysis = selection.analyze(baseline)
        for seed in [0, 1, 11, 91]:
            rows = copy.deepcopy(baseline)
            random.Random(seed).shuffle(rows)
            with self.subTest(seed=seed):
                self.assertEqual(selection.evaluate_selection(group(rows), "confovhh_evidence_rank", minimize=True), expected)
                self.assertEqual(selection.analyze(rows), expected_analysis)

    def test_mixed_jobs_are_separated_from_all_good_and_all_bad_jobs(self):
        rows = fixture()
        rows += fixture("SYNTHETIC_ALLGOOD_seed1", dockqs=[.23, .3, .5, .9, 1.0])
        rows += fixture("SYNTHETIC_ALLBAD_seed1", dockqs=[0., .1, .2, .22, .229999999])
        result = selection.analyze(rows)
        classes = {row["job"]: row["classification"] for row in result["per_job"]}
        self.assertEqual(classes, {
            "SYNTHETIC_MIXED_seed1": "mixed",
            "SYNTHETIC_ALLGOOD_seed1": "all_acceptable",
            "SYNTHETIC_ALLBAD_seed1": "all_below_threshold",
        })
        totals = result["summary"]
        self.assertEqual(totals["jobs"], 3)
        self.assertEqual(totals["models"], 15)
        self.assertEqual(totals["all_acceptable_jobs"], 1)
        self.assertEqual(totals["all_below_threshold_jobs"], 1)
        self.assertEqual(totals["mixed_jobs"], 1)
        self.assertEqual(totals["confovhh"]["acceptable_count_min"], 1)
        self.assertEqual(totals["confovhh"]["acceptable_count_max"], 2)
        self.assertEqual(totals["confovhh"]["acceptable_count_expected"], 1.5)
        self.assertAlmostEqual(totals["uniform"]["acceptable_count_expected"], 1.6)
        self.assertEqual(totals["best_available"]["acceptable_count_expected"], 2)
        self.assertEqual(result["mixed_job_summary"]["jobs"], 1)
        self.assertEqual(result["mixed_job_summary"]["models"], 5)
        self.assertEqual(result["mixed_job_summary"]["confovhh"]["acceptable_count_expected"], .5)

    def test_ambiguous_tie_comparisons_are_not_counted_as_wins_or_losses(self):
        rows = fixture(scores=[.1, .1, .9, .3, .2])
        rows += fixture("SYNTHETIC_ALLGOOD_seed1", dockqs=[.23, .3, .5, .9, 1.0])
        rows += fixture("SYNTHETIC_ALLBAD_seed1", dockqs=[0., .1, .2, .22, .229999999])
        result = selection.analyze(rows)
        self.assertEqual(result["summary"]["confovhh_vs_exported_score_binary_outcomes"], {
            "wins": 0, "ties": 2, "losses": 0, "ambiguous_due_to_ties": 1,
        })
        self.assertEqual(result["summary"]["exported_score_top_tied_jobs"], 2)
        self.assertEqual(result["summary"]["confovhh_top_tied_jobs"], 3)

    def test_definite_pairwise_win_and_loss_require_nonoverlapping_outcome_bounds(self):
        dockqs = [.1, .9, .4, .1, .3]
        won = fixture("SYNTHETIC_WON_seed1", dockqs=dockqs, ranks=[2, 1, 3, 4, 5], scores=[.9, .2, .3, .4, .5])
        lost = fixture("SYNTHETIC_LOST_seed1", dockqs=dockqs, ranks=[1, 2, 3, 4, 5], scores=[.1, .9, .3, .4, .5])
        self.assertEqual(selection.analyze(won + lost)["summary"]["confovhh_vs_exported_score_binary_outcomes"], {
            "wins": 1, "ties": 0, "losses": 1, "ambiguous_due_to_ties": 0,
        })

    def test_duplicate_or_missing_models_fail_even_when_the_rest_are_valid(self):
        rows = fixture(); rows.append(copy.deepcopy(rows[0]))
        with self.assertRaises(ValueError):
            selection.validate_rows(rows)
        rows = fixture(); rows.pop()
        with self.assertRaises(ValueError):
            selection.validate_rows(rows)
        rows = fixture(); rows[0]["model"] = "5"
        with self.assertRaises(ValueError):
            selection.validate_rows(rows)

    def test_nonfinite_numeric_fields_are_rejected(self):
        for field in ["official_DockQ", "confovhh_evidence_rank", "source_reported_ranking_score"]:
            for value in ["NaN", "Infinity", "-Infinity"]:
                with self.subTest(field=field, value=value):
                    rows = fixture(); rows[0][field] = value
                    with self.assertRaises(ValueError):
                        selection.validate_rows(rows)

    def test_fractional_model_indices_and_ranks_are_not_truncated(self):
        for field in ["model", "confovhh_evidence_rank"]:
            for value in ["1.5", 1.9]:
                with self.subTest(field=field, value=value):
                    rows = fixture(); rows[0][field] = value
                    with self.assertRaises(ValueError):
                        selection.validate_rows(rows)

    def test_dockq_range_is_checked_before_thresholding(self):
        for value in ["-0.001", "1.001"]:
            with self.subTest(value=value):
                rows = fixture(); rows[0]["official_DockQ"] = value
                with self.assertRaises(ValueError):
                    selection.validate_rows(rows)

    def test_within_job_reference_request_and_native_identity_cannot_change(self):
        for field in ["reference", "condition", "request_sha256", "native_sha256"]:
            with self.subTest(field=field):
                rows = fixture(); rows[0][field] = "0" * 64 if field.endswith("sha256") else "SYNTHETIC_OTHER"
                with self.assertRaises(ValueError):
                    selection.validate_rows(rows)


if __name__ == "__main__":
    unittest.main()
