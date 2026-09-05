#!/usr/bin/env python3
"""Descriptive selection audit of the already published 165-model development set.

No policy fitting, predictor reruns, random draws, or independent-sample tests.
Producer baseline means maximal exported ranking_score, retaining every tie.
"""
import argparse
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import statistics

THRESHOLD = 0.23
PAIRED_SHA256 = "94a0182d5e960e75641f5f891a2a8fefc8ac1fc942134cff253e83a1b5d3bc2c"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def number(value, name):
    if isinstance(value, bool):
        raise ValueError(f"Boolean {name}")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"Nonfinite {name}")
    return value


def integer(value, name, lo, hi):
    value = number(value, name)
    if not value.is_integer() or not lo <= value <= hi:
        raise ValueError(f"Invalid integer {name}")
    return int(value)


def validate_rows(rows):
    if not rows:
        raise ValueError("Empty cohort")
    groups = defaultdict(list)
    seen = set()
    refs, conditions = {}, {}
    for source in rows:
        row = dict(source)
        job = row["job"]
        if not isinstance(job, str) or not re.fullmatch(r"[A-Za-z0-9_]+_seed[1-9][0-9]*", job):
            raise ValueError("Unexpected job identity")
        if job.upper().startswith(("SWAP_", "IRREL_")):
            raise ValueError("Noncognate control is outside this cohort")
        row["model"] = integer(row["model"], "model", 0, 4)
        row["confovhh_evidence_rank"] = integer(row["confovhh_evidence_rank"], "evidence rank", 1, 5)
        row["official_DockQ"] = number(row["official_DockQ"], "DockQ")
        if not 0 <= row["official_DockQ"] <= 1:
            raise ValueError("DockQ outside [0,1]")
        row["source_reported_ranking_score"] = number(row["source_reported_ranking_score"], "exported ranking score")
        if row["condition"] != job.rsplit("_seed", 1)[0]:
            raise ValueError("Condition/job mismatch")
        for field in ("model_sha256", "request_sha256", "native_sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", row[field]):
                raise ValueError(f"Invalid {field}")
        key = job, row["model"]
        if key in seen:
            raise ValueError("Duplicate model identity")
        seen.add(key)
        if row["reference"] in refs and refs[row["reference"]] != row["native_sha256"]:
            raise ValueError("Native hash changes within a reference")
        refs[row["reference"]] = row["native_sha256"]
        if row["condition"] in conditions and conditions[row["condition"]] != row["reference"]:
            raise ValueError("Reference changes within a condition")
        conditions[row["condition"]] = row["reference"]
        groups[job].append(row)
    for group in groups.values():
        if sorted(row["model"] for row in group) != list(range(5)):
            raise ValueError("Every job requires exactly model indices 0..4")
        for field in ("request_sha256", "native_sha256", "reference", "condition"):
            if len({row[field] for row in group}) != 1:
                raise ValueError(f"Mixed {field} within job")
        group.sort(key=lambda row: row["model"])
    return dict(sorted(groups.items()))


def selection_statistics(selected):
    scores = [row["official_DockQ"] for row in selected]
    acceptable = [float(score >= THRESHOLD) for score in scores]
    return {"models": [row["model"] for row in selected],
            "model_sha256": [row["model_sha256"] for row in selected],
            "count": len(selected), "acceptable_min": min(acceptable),
            "acceptable_max": max(acceptable), "acceptable_expected": statistics.mean(acceptable),
            "DockQ_min": min(scores), "DockQ_max": max(scores), "DockQ_expected": statistics.mean(scores)}


def evaluate_selection(group, key, minimize=False):
    best = (min if minimize else max)(row[key] for row in group)
    selected = sorted((row for row in group if row[key] == best), key=lambda row: row["model"])
    return selection_statistics(selected)


def aggregate(per_job):
    if not per_job:
        return {"jobs": 0}
    result = {"jobs": len(per_job), "models": len(per_job) * 5,
              "conditions": len({row["condition"] for row in per_job}),
              "references": sorted({row["reference"] for row in per_job}),
              "all_acceptable_jobs": sum(row["classification"] == "all_acceptable" for row in per_job),
              "all_below_threshold_jobs": sum(row["classification"] == "all_below_threshold" for row in per_job),
              "mixed_jobs": sum(row["classification"] == "mixed" for row in per_job)}
    for method in ("confovhh", "exported_score", "uniform", "best_available"):
        result[method] = {
            "acceptable_count_min": math.fsum(row[method]["acceptable_min"] for row in per_job),
            "acceptable_count_max": math.fsum(row[method]["acceptable_max"] for row in per_job),
            "acceptable_count_expected": math.fsum(row[method]["acceptable_expected"] for row in per_job),
            "equal_job_mean_DockQ": statistics.mean(row[method]["DockQ_expected"] for row in per_job),
            "equal_job_mean_DockQ_min": statistics.mean(row[method]["DockQ_min"] for row in per_job),
            "equal_job_mean_DockQ_max": statistics.mean(row[method]["DockQ_max"] for row in per_job),
        }
    result["exported_score_top_tied_jobs"] = sum(row["exported_score"]["count"] > 1 for row in per_job)
    result["confovhh_top_tied_jobs"] = sum(row["confovhh"]["count"] > 1 for row in per_job)
    counts = {"wins": 0, "ties": 0, "losses": 0, "ambiguous_due_to_ties": 0}
    for row in per_job:
        a, b = row["confovhh"], row["exported_score"]
        if a["acceptable_min"] > b["acceptable_max"]:
            counts["wins"] += 1
        elif a["acceptable_max"] < b["acceptable_min"]:
            counts["losses"] += 1
        elif a["acceptable_min"] == a["acceptable_max"] == b["acceptable_min"] == b["acceptable_max"]:
            counts["ties"] += 1
        else:
            counts["ambiguous_due_to_ties"] += 1
    result["confovhh_vs_exported_score_binary_outcomes"] = counts
    result["equal_job_mean_DockQ_difference_confovhh_minus_exported_score_uniform_ties"] = statistics.mean(
        row["confovhh"]["DockQ_expected"] - row["exported_score"]["DockQ_expected"] for row in per_job)
    return result


def analyze(rows):
    groups = validate_rows(rows)
    per_job = []
    for job, group in groups.items():
        acceptable = sum(row["official_DockQ"] >= THRESHOLD for row in group)
        classification = "all_acceptable" if acceptable == 5 else "all_below_threshold" if acceptable == 0 else "mixed"
        per_job.append({"job": job, "condition": group[0]["condition"], "reference": group[0]["reference"],
                        "acceptable_models": acceptable, "classification": classification,
                        "confovhh": evaluate_selection(group, "confovhh_evidence_rank", minimize=True),
                        "exported_score": evaluate_selection(group, "source_reported_ranking_score"),
                        "uniform": selection_statistics(group),
                        "best_available": evaluate_selection(group, "official_DockQ")})
    references = sorted({row["reference"] for row in per_job})
    return {"per_job": per_job, "summary": aggregate(per_job),
            "mixed_job_summary": aggregate([row for row in per_job if row["classification"] == "mixed"]),
            "by_reference": {ref: aggregate([row for row in per_job if row["reference"] == ref]) for ref in references}}


def verify_confidence_files(rows, raw_root, audit_receipt):
    expected = {(job["job"], file["filename"]): file for job in audit_receipt["jobs"] for file in job["ignoredSummaryFiles"]}
    root = raw_root.resolve()
    verified = []
    for row in sorted(rows, key=lambda row: (row["job"], int(row["model"]))):
        filename = f"fold_{row['job'].lower()}_summary_confidences_{row['model']}.json"
        relative = Path("runs") / row["job"] / filename
        source = root / relative
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(root):
            raise ValueError(f"Missing/direct-source confidence file: {relative}")
        recorded = expected[(row["job"], filename)]
        if source.stat().st_size != recorded["bytes"] or sha256(source) != recorded["sha256"]:
            raise ValueError(f"Confidence file hash mismatch: {relative}")
        value = number(json.loads(source.read_text())["ranking_score"], "original exported score")
        if value != number(row["source_reported_ranking_score"], "CSV exported score"):
            raise ValueError(f"CSV and original confidence score differ: {relative}")
        verified.append({"job": row["job"], "model": int(row["model"]), "path": relative.as_posix(),
                         "sha256": recorded["sha256"], "bytes": recorded["bytes"], "ranking_score": value})
    return {"status": "VERIFIED_AGAINST_ORIGINAL_EXPORTED_JSON", "verified_models": len(verified), "files": verified,
            "limit": "Verifies exported values, not unrounded internal scores or the predictor's original tie-breaking policy."}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--raw-root", type=Path)
    args = parser.parse_args()
    source = args.study / "paper-evidence/results/paired-model-metrics.csv"
    if sha256(source) != PAIRED_SHA256:
        raise ValueError("Paired input differs from the published reviewed cohort")
    with source.open() as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 165:
        raise ValueError("Expected all 165 published models")
    result = analyze(rows)
    confidence = {"status": "PUBLISHED_CSV_ONLY", "limit": "Original summary JSON not rechecked in this invocation."}
    receipt_path = args.study / "confovhh-audit/audit-summary.json"
    if args.raw_root:
        receipt = json.loads(receipt_path.read_text())
        if receipt["state"] != "CONFO_VHH_DEVELOPMENT_AUDIT_OK" or receipt["completedModels"] != 165:
            raise ValueError("Original confidence inventory is incomplete")
        confidence = verify_confidence_files(rows, args.raw_root, receipt)
    args.out.mkdir(parents=True, exist_ok=False)
    write_json(args.out / "selection-analysis.json", result)
    write_json(args.out / "confidence-source-verification.json", confidence)
    flat = []
    for job in result["per_job"]:
        row = {key: job[key] for key in ("job", "condition", "reference", "acceptable_models", "classification")}
        for method in ("confovhh", "exported_score", "uniform", "best_available"):
            row[f"{method}_models"] = ";".join(str(value) for value in job[method]["models"])
            for key in ("acceptable_min", "acceptable_max", "acceptable_expected", "DockQ_min", "DockQ_max", "DockQ_expected"):
                row[f"{method}_{key}"] = job[method][key]
        flat.append(row)
    with (args.out / "per-job-selection.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(flat[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(flat)
    write_json(args.out / "provenance.json", {
        "status": "COMPLETE", "schema": "confovhh.gpcr-selection-development.v1",
        "source_paired_csv_sha256": PAIRED_SHA256, "script_sha256": sha256(__file__),
        "runtime": {"python_version": platform.python_version(),
                    "python_implementation": platform.python_implementation(),
                    "dependencies": "Python standard library only"},
        "confidence_inventory_sha256": sha256(receipt_path) if args.raw_root else None,
        "models": 165, "jobs": result["summary"]["jobs"], "threshold": THRESHOLD,
        "threshold_origin": "Existing official DockQ acceptability boundary; not fitted in this analysis",
        "tie_policy": "Preserve all exact exported-score maxima; show outcome bounds and uniform-among-ties expectations. Expectations are assumptions for summaries, not observed random draws.",
        "uniform_baseline": "Analytic expectation of uniform selection among the five models in each job; no simulation or sampling",
        "best_available": "Uses native labels and is a retrospective selection ceiling, not a deployable method",
        "weighting": "Equal job weight for descriptive means; reference-specific summaries retained",
        "interpretation": "Retrospective development analysis of coordinate-only ConfoVHH ranking against exported-confidence and other descriptive baselines; no independent-sample hypothesis test, calibrated efficacy estimate, ranking-policy change, binding claim or state-selectivity claim",
        "outputs_sha256": {p.name: sha256(p) for p in sorted(args.out.iterdir())},
    })
    print(f"GPCR SELECTION AUDIT OK: {len(rows)} models, {result['summary']['jobs']} jobs, {result['summary']['mixed_jobs']} mixed-label jobs")


if __name__ == "__main__":
    main()
