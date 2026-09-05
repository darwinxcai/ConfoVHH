#!/usr/bin/env python3
"""Join independently computed results by identity and digest; descriptive only."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def unique(rows, keys):
    result = {}
    for row in rows:
        key = tuple(str(row[k]) for k in keys)
        if key in result:
            raise ValueError(f"Duplicate model identity: {key}")
        result[key] = row
    return result


def number(value, name):
    if isinstance(value, bool):
        raise ValueError(f"Boolean {name}")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Nonfinite {name}")
    return result


def integer(value, name, low=0, high=None):
    result = number(value, name)
    if not result.is_integer() or result < low or (high is not None and result > high):
        raise ValueError(f"Invalid integer {name}: {value}")
    return int(result)


def bounded(value, name, low=0, high=None):
    result = number(value, name)
    if result < low or (high is not None and result > high):
        raise ValueError(f"Out-of-range {name}: {value}")
    return result


def join_results(official, audits, source, expected=165, reviewed=None):
    scores = unique(official, ("job", "model"))
    poses = unique(audits, ("job", "modelIndex"))
    legacy = unique(source, ("job", "model"))
    if len(scores) != expected or scores.keys() != poses.keys():
        raise ValueError("Official and ConfoVHH model sets must match the complete reviewed cohort")
    if reviewed is not None:
        cohort = unique(reviewed, ("job", "model"))
        if cohort.keys() != scores.keys():
            raise ValueError("Scored models differ from the reviewed cohort")
        for key, score in scores.items():
            if any(str(score[k]) != str(v) for k, v in cohort[key].items()):
                raise ValueError(f"Scored identity differs from reviewed manifest: {key}")
    output = []
    for key, score in sorted(scores.items()):
        pose, original = poses[key], legacy[key]
        if key[0].upper().startswith(("SWAP_", "IRREL_")):
            raise ValueError("Noncognate control in cognate-quality cohort")
        for a, b in ((score["model_sha256"], pose["modelSha256"]),
                     (score["request_sha256"], pose["requestSha256"]),
                     (score["native_sha256"], pose["nativeSha256"]),
                     (score["reference"], pose["reference"]),
                     (score["reference"], original["reference"])):
            if a != b:
                raise ValueError(f"Identity/provenance mismatch: {key}")
        if score["official_DockQ_version"] != "2.1.3":
            raise ValueError("Unexpected official scorer version")
        if (pose["chains"]["receptor"] != score["model_receptor"]
                or pose["chains"]["vhh"] != score["model_binder"]):
            raise ValueError(f"Explicit model-chain roles disagree between audits: {key}")
        dq = number(score["official_DockQ"], "official DockQ")
        old = bounded(original["DockQ"], "legacy custom score", high=1)
        if not 0 <= dq <= 1 or old != number(score["legacy_custom_score"], "legacy binding"):
            raise ValueError(f"Invalid score or legacy-source binding: {key}")
        if pose["paeStatus"] != "not-provided":
            raise ValueError("This reviewed archive has no full PAE matrices")
        row = {
            "job": key[0], "model": integer(key[1], "model", high=4),
            "condition": key[0].rsplit("_seed", 1)[0],
            "seed": int(key[0].rsplit("_seed", 1)[1]),
            "reference": score["reference"],
            "model_sha256": score["model_sha256"],
            "request_sha256": score["request_sha256"],
            "native_sha256": score["native_sha256"],
            "official_DockQ": dq,
            "official_at_least_acceptable": dq >= 0.23,
            "official_fnat": bounded(score["official_fnat"], "fnat", high=1),
            "official_iRMSD_A": bounded(score["official_iRMSD"], "iRMSD"),
            "official_LRMSD_A": bounded(score["official_LRMSD"], "LRMSD"),
            "legacy_custom_score": old,
            "official_minus_legacy": dq - old,
            "source_reported_tm3_tm6_A": number(original["tm3_tm6_A"], "source TM6"),
            "source_reported_iptm": number(original["iptm"], "source ipTM"),
            "source_reported_ranking_score": number(original["ranking_score"], "source ranking"),
            "confovhh_evidence_level": pose["evidenceLevel"],
            "confovhh_evidence_rank": integer(pose["evidenceRank"], "evidence rank", low=1, high=5),
            "confovhh_evidence_tier": pose["evidenceTier"],
            "interface_burial_A2": bounded(pose["interfaceBurialAngstrom2"], "burial"),
            "contact_pairs": integer(pose["contactPairCount"], "contacts"),
            "severe_clashes": integer(pose["severeClashCount"], "clashes"),
            "cdr_contact_share": None if pose["cdrContactShare"] is None else bounded(pose["cdrContactShare"], "CDR share", high=1),
            "numbering_status": pose["numberingStatus"],
            "pae_status": pose["paeStatus"],
            "recurrence_rank_within_job": None if pose["recurrenceRank"] is None else integer(pose["recurrenceRank"], "recurrence rank", low=1, high=5),
        }
        output.append(row)
    groups = {}
    for row in output:
        groups.setdefault(row["job"], []).append(row)
    if any(sorted(r["model"] for r in rows) != list(range(5)) for rows in groups.values()):
        raise ValueError("Every retained job must contain exactly five model indices 0..4")
    conditions = {}
    for row in output:
        conditions.setdefault(row["condition"], []).append(row)
    if any(len({r["reference"] for r in group}) != 1 for group in conditions.values()):
        raise ValueError("Mixed reference identities within a condition or job")
    if any(len({r["request_sha256"] for r in group}) != 1 for group in groups.values()):
        raise ValueError("Mixed request identities within a job")
    return output


def write_csv(path, rows):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def join_endpoints(rows, endpoints):
    measured = unique(endpoints, ("job", "model"))
    for row in rows:
        endpoint = measured[(row["job"], str(row["model"]))]
        if (endpoint["coordinateSha256"] != row["model_sha256"]
                or endpoint["requestSha256"] != row["request_sha256"]
                or endpoint["reference"] != row["reference"]):
            raise ValueError("Endpoint and interface computations used different inputs")
        value = bounded(endpoint["distanceAngstrom"], "recomputed endpoint")
        if f"{value:.3f}" != f"{row['source_reported_tm3_tm6_A']:.3f}":
            raise ValueError("Endpoint does not reproduce source at declared precision")
        row["recomputed_tm3_tm6_A"] = value
    return rows


def summaries(rows):
    jobs, conditions, targets = {}, {}, {}
    for row in rows:
        jobs.setdefault(row["job"], []).append(row)
        conditions.setdefault(row["condition"], []).append(row)
        targets.setdefault(row["reference"], []).append(row)
    job_rows = []
    for job, group in sorted(jobs.items()):
        top_rank = min(r["confovhh_evidence_rank"] for r in group)
        conf = [r for r in group if r["confovhh_evidence_rank"] == top_rank]
        top_producer = max(r["source_reported_ranking_score"] for r in group)
        producer = [r for r in group if r["source_reported_ranking_score"] == top_producer]
        job_rows.append({
            "job": job, "condition": group[0]["condition"], "seed": group[0]["seed"],
            "reference": group[0]["reference"], "models": len(group),
            "official_DockQ_mean": statistics.mean(r["official_DockQ"] for r in group),
            "official_DockQ_min": min(r["official_DockQ"] for r in group),
            "official_DockQ_max": max(r["official_DockQ"] for r in group),
            "official_at_least_acceptable_models": sum(r["official_at_least_acceptable"] for r in group),
            "recomputed_tm3_tm6_mean_A": statistics.mean(r["recomputed_tm3_tm6_A"] for r in group) if "recomputed_tm3_tm6_A" in group[0] else None,
            "confovhh_top_models": ";".join(str(r["model"]) for r in conf),
            "confovhh_top_DockQ_min": min(r["official_DockQ"] for r in conf),
            "confovhh_top_DockQ_max": max(r["official_DockQ"] for r in conf),
            "source_producer_top_models": ";".join(str(r["model"]) for r in producer),
            "source_producer_top_DockQ_min": min(r["official_DockQ"] for r in producer),
            "source_producer_top_DockQ_max": max(r["official_DockQ"] for r in producer),
        })
    condition_rows = [{
        "condition": condition, "reference": group[0]["reference"],
        "retained_seeds": ";".join(str(s) for s in sorted({r["seed"] for r in group})),
        "retained_jobs": len({r["job"] for r in group}), "retained_models": len(group),
        "official_DockQ_mean": statistics.mean(r["official_DockQ"] for r in group),
        "official_DockQ_min": min(r["official_DockQ"] for r in group),
        "official_DockQ_max": max(r["official_DockQ"] for r in group),
        "official_at_least_acceptable_models": sum(r["official_at_least_acceptable"] for r in group),
        "recomputed_tm3_tm6_mean_A": statistics.mean(r["recomputed_tm3_tm6_A"] for r in group) if "recomputed_tm3_tm6_A" in group[0] else None,
    } for condition, group in sorted(conditions.items())]
    target_rows = []
    for target, group in sorted(targets.items()):
        target_rows.append({
            "reference": target, "models": len(group), "jobs": len({r["job"] for r in group}),
            "conditions": len({r["condition"] for r in group}),
            "official_at_least_acceptable_models": sum(r["official_at_least_acceptable"] for r in group),
            "official_DockQ_median": statistics.median(r["official_DockQ"] for r in group),
            "median_absolute_score_correction": statistics.median(abs(r["official_minus_legacy"]) for r in group),
            "maximum_absolute_score_correction": max(abs(r["official_minus_legacy"]) for r in group),
            "confovhh_supported_models": sum(r["confovhh_evidence_level"] == "supported" for r in group),
            "confovhh_supported_below_DockQ_023": sum(r["confovhh_evidence_level"] == "supported" and r["official_DockQ"] < .23 for r in group),
        })
    return job_rows, condition_rows, target_rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    study, out = args.study, args.out
    files = {
        "official": study / "official-dockq/official_DockQ.csv",
        "audits": study / "confovhh-audit/pose-audits.jsonl",
        "source": study / "source/S2_per_model_metrics.csv",
        "endpoints": study / "endpoint-recompute/per_model.csv",
    }
    provenance = json.loads((study / "official-dockq/run_provenance.json").read_text())
    manifest = study / "official-dockq/reviewed_scoring_manifest.csv"
    if (provenance["status"] != "COMPLETE" or provenance["completed_models"] != 165
            or digest(files["official"]) != provenance["official_DockQ_csv_sha256"]
            or digest(files["source"]) != provenance["source_files_sha256"]["S2_per_model_metrics.csv"]
            or digest(manifest) != "8fe08b09d4d647024b3b4a978da164d60b000af6a695d787b408212f6dd39c48"):
        raise ValueError("Official scoring is incomplete or differs from its reviewed receipt")
    with manifest.open() as f:
        reviewed = list(csv.DictReader(f))
    with files["official"].open() as f:
        official = list(csv.DictReader(f))
    with files["source"].open() as f:
        source = list(csv.DictReader(f))
    audit_receipt = json.loads((study / "confovhh-audit/audit-summary.json").read_text())
    if (audit_receipt["state"] != "CONFO_VHH_DEVELOPMENT_AUDIT_OK"
            or audit_receipt["completedModels"] != 165 or audit_receipt["completedJobs"] != 33
            or digest(files["audits"]) != audit_receipt["outputSha256"]["pose-audits.jsonl"]):
        raise ValueError("ConfoVHH audit receipt changed or is incomplete")
    audits = [json.loads(line) for line in files["audits"].read_text().splitlines()]
    endpoint_receipt = json.loads((study / "endpoint-recompute/summary.json").read_text())
    if (endpoint_receipt["status"] != "COMPLETE"
            or endpoint_receipt["rawModelsRecomputed"] != 355
            or digest(files["endpoints"]) != endpoint_receipt["outputSha256"]["per_model.csv"]
            or digest(files["source"]) != endpoint_receipt["sourceS2Sha256"]):
        raise ValueError("Endpoint recomputation receipt changed or is incomplete")
    rows = join_results(official, audits, source, reviewed=reviewed)
    with files["endpoints"].open() as f:
        endpoints = list(csv.DictReader(f))
    if len(endpoints) != 355:
        raise ValueError("Endpoint inventory is incomplete")
    rows = join_endpoints(rows, endpoints)
    job_rows, condition_rows, target_rows = summaries(rows)
    out.mkdir(parents=True, exist_ok=False)
    write_csv(out / "paired-model-metrics.csv", rows)
    write_csv(out / "per-job-summary.csv", job_rows)
    write_csv(out / "per-condition-summary.csv", condition_rows)
    write_csv(out / "per-reference-summary.csv", target_rows)
    summary = {
        "schema": "confovhh.gpcr-paired-development-summary.v1", "status": "COMPLETE",
        "models": len(rows), "jobs": len(job_rows), "conditions": len(condition_rows),
        "reference_complexes": len(target_rows), "receptor_targets": 3,
        "scope": "Retrospective descriptive development analysis; models, jobs and conditions are nested within four reference complexes from three receptor targets. No independent efficacy estimate or hypothesis test.",
        "ranking_policy": "Unchanged production ConfoVHH policy; rank only within each five-model job. All equal source ranking-score maxima retained; no favorable tie breaking.",
        "pae": "No full residue PAE supplied for any of these 165 models; summary confidence values are source-reported context only.",
        "threshold": {"official_DockQ_at_least_acceptable": .23, "applies_to_legacy": False},
        "source_reported_metrics": ["tm3_tm6_A", "iptm", "ranking_score"],
        "source_sha256": {k: digest(v) for k, v in files.items()},
        "script_sha256": digest(__file__),
        "outputs_sha256": {p.name: digest(p) for p in sorted(out.glob("*.csv"))},
        "by_reference": target_rows,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    print(f"PAIRED SUMMARY BUILD OK: {len(rows)} models, {len(job_rows)} jobs, {len(target_rows)} reference complexes")


if __name__ == "__main__":
    main()
