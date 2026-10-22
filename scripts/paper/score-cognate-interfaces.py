#!/usr/bin/env python3
"""Rescore the reviewed developmental GPCR cohort with unmodified DockQ 2.1.3.

This is an explicitly retrospective, target-limited analysis. Its locked source
manifest is not an independent validation set or a general ranking benchmark.
Original coordinates, requests and legacy scores are never rewritten.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import traceback

PINNED_VERSION = "2.1.3"
PINNED_MODULE_SHA256 = "7b9d112c9abd18711de43f1f56145301944460dc59b8bc52853b464cf6d7a887"
PINNED_SOURCE_FILES = {
    "parsers.py": "878921b9b4d6f2e92cd39920dd1abc83142511c06956afb4c5e4c22dcb1f76e0",
    "constants.py": "431767db749faa74e2cb876f768cee6e43cfbb30da263725d47d6574fed3ec18",
    "operations.pyx": "30f8d89f273796189b10983cb6d9c9b0bee6603472cef7fe4823ca1825910512",
    "operations_nocy.py": "e76216611fd5d901ced99efb38c98c2d53f332091272edde737109f95da5d0d3",
}
REVIEWED_MANIFEST_SHA256 = "8fe08b09d4d647024b3b4a978da164d60b000af6a695d787b408212f6dd39c48"
PINNED_DEPENDENCIES = {"biopython": "1.88", "colorama": "0.4.6", "dockq": "2.1.3",
                       "networkx": "3.6.1", "numpy": "1.26.4", "parallelbar": "2.5", "tqdm": "4.70.0"}
CACHE_NAMES = ("align_chains", "get_aligned_residues", "get_residue_distances",
               "list_atoms_per_residue", "subset_atoms", "run_on_chains")
METRICS = ("DockQ", "iRMSD", "LRMSD", "fnat", "fnonnat", "F1")
COUNTS = ("nat_total", "nat_correct", "model_total", "nonnat_count", "clashes")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, sort_keys=True, indent=2, allow_nan=False) + "\n")


def finite(value) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite score: {value!r}")
    return result


def under(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Path outside input root: {relative}")
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def clear_caches(dockq) -> None:
    for name in CACHE_NAMES:
        clear = getattr(getattr(dockq, name, None), "cache_clear", None)
        if clear is not None:
            clear()


def verify_runtime(dockq, version=None, digest=None) -> dict:
    version = importlib.metadata.version("DockQ") if version is None else version
    if version != PINNED_VERSION:
        raise ValueError(f"Expected DockQ {PINNED_VERSION}; found {version}")
    digest = sha256(Path(dockq.__file__)) if digest is None else digest
    if digest != PINNED_MODULE_SHA256:
        raise ValueError(f"DockQ module hash mismatch: {digest}")
    source_hashes = {name: sha256(Path(dockq.__file__).parent / name) for name in PINNED_SOURCE_FILES}
    if source_hashes != PINNED_SOURCE_FILES:
        raise ValueError(f"DockQ supporting source differs from recorded historical distribution: {source_hashes}")
    versions = {name: importlib.metadata.version(name) for name in PINNED_DEPENDENCIES}
    if versions != PINNED_DEPENDENCIES:
        raise ValueError(f"Dependency versions differ from reviewed environment: {versions}")
    dist = importlib.metadata.distribution("DockQ")
    files = []
    for rel in sorted(dist.files or [], key=str):
        if "__pycache__" in str(rel) or str(rel).endswith(".pyc"):
            continue
        path = Path(dist.locate_file(rel))
        if not path.is_file():
            raise FileNotFoundError(f"Missing installed DockQ distribution file: {rel}")
        files.append({"path": str(rel), "sha256": sha256(path)})
    if not files:
        raise ValueError("DockQ distribution file inventory is empty")
    canonical = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    return {"DockQ_version": version, "DockQ_module_sha256": digest,
            "supporting_source_sha256": source_hashes,
            "supporting_source_pin_origin": "validation/dockq-development-pilot-v1/summary.json software.installedDockqDistribution.files; historical artifact read only",
            "distribution_files": files,
            "distribution_fingerprint_sha256": hashlib.sha256(canonical).hexdigest(),
            "dependencies": versions,
            "all_installed_distributions": sorted(
                [{"name": d.metadata["Name"], "version": d.version} for d in importlib.metadata.distributions()],
                key=lambda d: d["name"].lower()),
            "python": sys.version, "python_executable": sys.executable,
            "platform": platform.platform()}


def index_unique(rows: list[dict], keys: tuple[str, ...]) -> dict:
    result = {}
    for row in rows:
        key = tuple(row[k] for k in keys)
        if key in result:
            raise ValueError(f"Duplicate identity: {key}")
        result[key] = row
    return result


def request_for_job(source: Path, job: str) -> tuple[Path, dict]:
    path = under(source, f"S4_job_requests/fold_{job.lower()}_job_request.json")
    payload = json.loads(path.read_text())
    if not isinstance(payload, list) or len(payload) != 1 or payload[0].get("name") != job:
        raise ValueError(f"Request identity mismatch: {job}")
    return path, payload[0]


def is_subsequence(short: str, long: str) -> bool:
    iterator = iter(long)
    return bool(short) and all(character in iterator for character in short)


def validate_row(row: dict, root: Path, source: Path, metrics: dict,
                 jobs: dict, dockq, native_cache: dict) -> dict:
    job, model = row["job"], row["model"]
    if job.upper().startswith(("SWAP_", "IRREL_")):
        raise ValueError(f"Noncognate control cannot be scored as native-interface recovery: {job}")
    key = (job, model)
    metric = metrics[key]
    source_job = jobs[(job,)]
    if int(source_job["n_chains"]) != 2 or int(metric["n_chains"]) != 2:
        raise ValueError(f"Not a two-protein cognate complex: {job}")
    if int(source_job["n_models"]) != 5 or not 0 <= int(model) < 5:
        raise ValueError(f"Unexpected model identity: {key}")
    if metric["reference"] != row["reference"] or not job.upper().startswith(
            (row["reference"], f"RESCUE_{row['reference']}")):
        raise ValueError(f"Reference identity mismatch: {key}")
    if finite(metric["DockQ"]) != finite(row["legacy_custom_score"]):
        raise ValueError(f"Legacy source metric mismatch: {key}")
    if finite(row["binder_aligned_identity"]) != 1.0:
        raise ValueError(f"Reviewed manifest does not establish cognate binder: {key}")
    expected_model = f"runs/{job}/fold_{job.lower()}_model_{model}.cif"
    if row["model_path"] != expected_model:
        raise ValueError(f"Model path/identity mismatch: {key}")
    if row["native_path"] not in (f"references/{row['reference']}.cif.gz", f"references/{row['reference']}.cif"):
        raise ValueError(f"Native path/identity mismatch: {key}")
    model_path, native_path = (under(root, row[f"{kind}_path"]) for kind in ("model", "native"))
    for kind, path in (("model", model_path), ("native", native_path)):
        if sha256(path) != row[f"{kind}_sha256"]:
            raise ValueError(f"{kind} hash mismatch: {key}")
        chains = [row[f"{kind}_receptor"], row[f"{kind}_binder"]]
        if len(set(chains)) != 2 or any(len(c) != 1 for c in chains):
            raise ValueError(f"Invalid explicit chain map: {key}")
    request_path, request = request_for_job(source, job)
    raw_request = under(root, f"runs/{job}/fold_{job.lower()}_job_request.json")
    if sha256(request_path) != sha256(raw_request):
        raise ValueError(f"Raw/source request hash mismatch: {job}")
    if request.get("modelSeeds") != [source_job["seed"]]:
        raise ValueError(f"Request seed mismatch: {job}")
    proteins = [item.get("proteinChain") for item in request.get("sequences", [])]
    if len(proteins) != 2 or any(not p or p.get("count") != 1 for p in proteins):
        raise ValueError(f"Request must contain exactly two single-copy proteins: {job}")
    sequences = [p["sequence"] for p in proteins]
    if len(set(sequences)) != 2:
        raise ValueError(f"Ambiguous sequence roles in request: {job}")
    model_structure = dockq.load_PDB(str(model_path), chains=[row["model_receptor"], row["model_binder"]])
    native_key = (str(native_path), row["native_receptor"], row["native_binder"])
    if native_key not in native_cache:
        native_cache[native_key] = dockq.load_PDB(str(native_path), chains=list(native_key[1:]))
    native_structure = native_cache[native_key]
    roles = {}
    sequence_indices = set()
    for role in ("receptor", "binder"):
        model_sequence = model_structure[row[f"model_{role}"]].sequence
        native_sequence = native_structure[row[f"native_{role}"]].sequence
        matches = [i for i, sequence in enumerate(sequences) if sequence == model_sequence]
        if len(matches) != 1:
            raise ValueError(f"Model {role} does not exactly match one request protein: {key}")
        sequence_indices.add(matches[0])
        if not is_subsequence(native_sequence, model_sequence):
            raise ValueError(f"Native {role} is not an exact ordered subsequence of requested protein: {key}")
        roles[role] = {"request_sequence_index": matches[0], "model_residues": len(model_sequence),
                       "native_parser_residues": len(native_sequence),
                       "model_sequence_sha256": hashlib.sha256(model_sequence.encode()).hexdigest(),
                       "native_parser_sequence_sha256": hashlib.sha256(native_sequence.encode()).hexdigest(),
                       "native_is_exact_ordered_subsequence": True}
    if len(sequence_indices) != 2:
        raise ValueError(f"Both chains assigned to same request sequence: {key}")
    return {"request_path": str(request_path.relative_to(source)),
            "request_sha256": sha256(request_path), "request_seed": source_job["seed"],
            "source_metric_row": metric, "source_job_row": source_job, "sequence_roles": roles,
            "native_to_model": {row["native_receptor"]: row["model_receptor"],
                                row["native_binder"]: row["model_binder"]}}


def score_paths(model_path: Path, native_path: Path, native_map: dict, dockq) -> dict:
    try:
        model = dockq.load_PDB(str(model_path), chains=list(native_map.values()))
        native = dockq.load_PDB(str(native_path), chains=list(native_map))
        results, total = dockq.run_on_all_native_interfaces(
            model, native, chain_map=native_map, no_align=False, capri_peptide=False)
        expected = "".join(native_map)
        if set(results) != {expected}:
            raise ValueError(f"Expected one mapped native interface {expected}; received {list(results)}")
        result = results[expected]
        if result.get("chain_map") != native_map:
            raise ValueError(f"Returned chain map changed: {result.get('chain_map')}")
        output = {name: finite(result[name]) for name in METRICS}
        if not 0.0 <= output["DockQ"] <= 1.0 or abs(finite(total) - output["DockQ"]) > 1e-12:
            raise ValueError("Invalid DockQ range or interface total")
        output.update({name: int(result[name]) for name in COUNTS})
        if output["nat_total"] <= 0:
            raise ValueError("Native reference contains no evaluated contacts")
        output["chain_map"] = native_map
        output["interface"] = expected
        return output
    finally:
        clear_caches(dockq)


def score_row(row: dict, root: Path, dockq) -> dict:
    model_path, native_path = (under(root, row[f"{kind}_path"]) for kind in ("model", "native"))
    for kind, path in (("model", model_path), ("native", native_path)):
        if sha256(path) != row[f"{kind}_sha256"]:
            raise ValueError(f"{kind} changed since preflight: {row['job']} model {row['model']}")
    return score_paths(model_path, native_path,
                       {row["native_receptor"]: row["model_receptor"],
                        row["native_binder"]: row["model_binder"]}, dockq)


def source_controls(rows: list, root: Path, out: Path, dockq) -> list:
    from Bio.PDB import PDBIO
    import numpy as np
    unique = {row["reference"]: row for row in rows}
    checks = []
    with tempfile.TemporaryDirectory(prefix="gpcr-dockq-source-controls-") as temporary:
        for reference, row in sorted(unique.items()):
            native_path = under(root, row["native_path"])
            receptor, binder = row["native_receptor"], row["native_binder"]
            mapping = {receptor: receptor, binder: binder}
            positive = score_paths(native_path, native_path, mapping, dockq)
            if abs(positive["DockQ"] - 1.0) > 1e-10:
                raise ValueError(f"Native self-control failed: {reference}")
            moved = copy.deepcopy(dockq.load_PDB(str(native_path), chains=[receptor, binder]))
            for atom in moved[binder].get_atoms():
                atom.set_coord(atom.coord + np.array([100.0, 0.0, 0.0]))
            negative_path = Path(temporary) / f"{reference}_binder_translated_100A.pdb"
            writer = PDBIO()
            writer.set_structure(moved)
            writer.save(str(negative_path))
            negative = score_paths(negative_path, native_path, mapping, dockq)
            if negative["DockQ"] >= 0.23 or negative["fnat"] != 0.0:
                raise ValueError(f"Far-translated binder control failed: {reference}")
            checks.append({"reference": reference, "native_sha256": row["native_sha256"],
                           "native_to_model": mapping, "self": positive,
                           "binder_translated_100A": negative,
                           "negative_coordinate_sha256": sha256(negative_path),
                           "negative_serialization": "Temporary PDB from official protein parser; binder +100 Angstrom x translation; PDB coordinates rounded to 0.001 Angstrom. Only this synthetic sanity control is serialized; genuine predictions and natives remain original CIF bytes.",
                           "ok": True})
    write_json(out / "source_controls.json", {"controls": checks,
                                              "limitation": "Sanity checks of sign, scale and mapping; do not independently validate metric definition or biology."})
    return checks


def score_all(rows, contexts, root, out, dockq, scorer=score_row) -> tuple[list, int]:
    successes, failures = [], 0
    with (out / "per_model_ledger.jsonl").open("w") as ledger:
        for index, (row, context) in enumerate(zip(rows, contexts, strict=True), 1):
            record = {"input": row, "binding": context, "DockQ_version": PINNED_VERSION}
            try:
                record["official_result"] = scorer(row, root, dockq)
                record["ok"] = True
                result = {**row, "request_sha256": context["request_sha256"],
                          "native_to_model": json.dumps(context["native_to_model"], sort_keys=True),
                          "official_DockQ_version": PINNED_VERSION,
                          **{f"official_{k}": v for k, v in record["official_result"].items()
                             if k != "chain_map"}}
                successes.append(result)
            except Exception as error:
                failures += 1
                record.update(ok=False, error_type=type(error).__name__, error=str(error),
                              traceback=traceback.format_exc(limit=8))
            finally:
                clear_caches(dockq)
            ledger.write(json.dumps(record, sort_keys=True, allow_nan=False) + "\n")
            ledger.flush()
            print(f"DockQ {index}/{len(rows)}: {row['job']} model {row['model']} {'OK' if record['ok'] else 'FAILED'}", flush=True)
    if successes:
        output = out / ("official_DockQ.csv" if not failures else "official_DockQ.partial.csv")
        with output.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(successes[0]))
            writer.writeheader()
            writer.writerows(successes)
    return successes, failures


def crosscheck_cli(rows: list, results: list, root: Path, out: Path) -> list:
    """Compare real predictions with official CLI at exactly the same fixed map.

    The CLI is an invocation crosscheck, not an independent DockQ implementation.
    Choose first input per (reference, map), without selecting on observed score.
    """
    selected, seen = [], set()
    by_key = {(r["job"], r["model"]): r for r in results}
    for row in rows:
        key = (row["reference"], row["model_receptor"], row["model_binder"],
               row["native_receptor"], row["native_binder"])
        if key not in seen:
            selected.append(row)
            seen.add(key)
    directory = out / "cli_crosschecks"
    directory.mkdir()
    checks = []
    for row in selected:
        map_string = f"{row['model_receptor']}{row['model_binder']}:{row['native_receptor']}{row['native_binder']}"
        stem = f"{row['job']}_model_{row['model']}"
        output_path = directory / f"{stem}.json"
        command = [sys.executable, "-m", "DockQ.DockQ", str(under(root, row["model_path"])),
                   str(under(root, row["native_path"])), "--mapping", map_string,
                   "--n_cpu", "1", "--json", str(output_path)]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=60)
        (directory / f"{stem}.log").write_text(completed.stdout + completed.stderr)
        if completed.returncode != 0 or not output_path.is_file():
            raise ValueError(f"Official CLI failed for {stem}: exit {completed.returncode}")
        payload = json.loads(output_path.read_text())
        mapping = {row["native_receptor"]: row["model_receptor"], row["native_binder"]: row["model_binder"]}
        expected_interface = "".join(mapping)
        if payload["best_mapping"] != mapping or set(payload["best_result"]) != {expected_interface}:
            raise ValueError(f"CLI returned an unexpected interface/map for {stem}")
        cli = payload["best_result"][expected_interface]
        api = by_key[(row["job"], row["model"])]
        differences = {name: abs(finite(cli[name]) - finite(api[f"official_{name}"])) for name in METRICS}
        if any(value > 1e-12 for value in differences.values()):
            raise ValueError(f"Official API/CLI disagreement for {stem}: {differences}")
        if any(int(cli[name]) != api[f"official_{name}"] for name in COUNTS):
            raise ValueError(f"Official API/CLI contact-count disagreement for {stem}")
        checks.append({"job": row["job"], "model": row["model"], "model_sha256": row["model_sha256"],
                       "native_sha256": row["native_sha256"], "command": command,
                       "native_to_model": mapping, "absolute_metric_differences": differences,
                       "ok": True, "cli_json_sha256": sha256(output_path)})
    write_json(out / "api_cli_crosschecks.json", {"selection": "First input per reference and explicit chain-map tuple; selected without using score",
                                                "same_implementation_not_independent_method_validation": True,
                                                "checks": checks})
    return checks


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--mapping-review", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    root, source, out = (p.resolve() for p in (args.root, args.source, args.out))
    if out.exists():
        parser.error(f"Output exists; select a fresh directory: {out}")
    out.mkdir(parents=True)
    provenance = {"status": "INITIALIZING", "started_at_unix": time.time(),
                  "developmental_retrospective_only": True, "argv": sys.argv,
                  "script_sha256": sha256(Path(__file__)), "raw_root": str(root),
                  "cache_clear_functions": list(CACHE_NAMES),
                  "parameters": {"no_align": False, "capri_peptide": False,
                                 "explicit_native_to_model_mapping": True,
                                 "optimize_chain_mapping": False,
                                 "original_coordinates": True},
                  "interpretation": "Native interface recovery for four retrospective cognate reference complexes; not biological affinity, selectivity, independent generalization, or model superiority."}
    try:
        if sha256(args.manifest) != REVIEWED_MANIFEST_SHA256:
            raise ValueError("Manifest differs from the independently reviewed immutable 165-model cohort")
        provenance["manifest_sha256"] = sha256(args.manifest)
        shutil.copyfile(args.manifest, out / "reviewed_scoring_manifest.csv")
        import DockQ.DockQ as dockq
        provenance["runtime"] = verify_runtime(dockq)
        rows = list(csv.DictReader(args.manifest.open()))
        index_unique(rows, ("job", "model"))
        if len(rows) != 165 or len({r["job"] for r in rows}) != 33:
            raise ValueError("Expected the reviewed 165 models in 33 jobs")
        source_paths = {name: under(source, name) for name in ("S1_job_manifest.csv", "S2_per_model_metrics.csv")}
        provenance["source_files_sha256"] = {name: sha256(path) for name, path in source_paths.items()}
        review = json.loads(args.mapping_review.read_text())
        if (review.get("sourceManifestSha256") != REVIEWED_MANIFEST_SHA256
                or review.get("sourceS2Sha256") != provenance["source_files_sha256"]["S2_per_model_metrics.csv"]
                or review.get("reviewedCognateModels") != 165
                or review.get("reviewedCognateJobs") != 33
                or review.get("currentS2EqualsRecoveredExpectedRows") is not True
                or review.get("unexpectedRawModels") != []
                or review.get("duplicateRawCoordinateHashes") != []):
            raise ValueError("Independent mapping review does not match the exact source cohort")
        provenance["independent_mapping_review"] = {"path": str(args.mapping_review.resolve()),
                                                   "sha256": sha256(args.mapping_review),
                                                   "sourceS5Sha256": review["sourceS5Sha256"]}
        provenance["known_parser_limitation"] = "Unmodified official protein parser excludes HETATM YCM57 from native 5C1M receptor (295 recognized residues vs 296 when YCM is interpreted as C for independent sequence review). Original coordinates and default official scoring remain unchanged."
        metrics = index_unique(list(csv.DictReader(source_paths["S2_per_model_metrics.csv"].open())), ("job", "model"))
        jobs = index_unique(list(csv.DictReader(source_paths["S1_job_manifest.csv"].open())), ("job",))
        contexts, preflight_failures, cache = [], [], {}
        with (out / "preflight_ledger.jsonl").open("w") as ledger:
            for row in rows:
                record = {"input": row}
                try:
                    context = validate_row(row, root, source, metrics, jobs, dockq, cache)
                    contexts.append(context)
                    record.update(ok=True, binding=context)
                except Exception as error:
                    record.update(ok=False, error_type=type(error).__name__, error=str(error))
                    preflight_failures.append(record)
                finally:
                    clear_caches(dockq)
                ledger.write(json.dumps(record, sort_keys=True, allow_nan=False) + "\n")
                ledger.flush()
        provenance["preflight_completed"] = len(rows)
        provenance["preflight_failures"] = len(preflight_failures)
        if preflight_failures:
            raise ValueError(f"{len(preflight_failures)} preflight failures; no scores computed; see preflight_ledger.jsonl")
        print(f"PREFLIGHT OK: {len(rows)} models, {len(jobs)} source jobs", flush=True)
        if args.dry_run:
            provenance.update(status="DRY_RUN_ONLY", completed_models=0)
        else:
            provenance["status"] = "SCORING"
            write_json(out / "run_provenance.json", provenance)
            provenance["source_reference_controls"] = len(source_controls(rows, root, out, dockq))
            results, failures = score_all(rows, contexts, root, out, dockq)
            provenance.update(completed_models=len(results), failed_models=failures,
                              status="FAILED_PARTIAL" if failures else "COMPLETE")
            if failures:
                raise ValueError(f"{failures} scoring failures; explicit partial results retained")
            provenance["api_cli_crosschecks"] = len(crosscheck_cli(rows, results, root, out))
            provenance["official_DockQ_csv_sha256"] = sha256(out / "official_DockQ.csv")
        provenance["completed_at_unix"] = time.time()
        write_json(out / "run_provenance.json", provenance)
        print("DRY RUN OK" if args.dry_run else "OFFICIAL DOCKQ BUILD OK", flush=True)
        return 0
    except Exception as error:
        if provenance["status"] != "FAILED_PARTIAL":
            provenance["status"] = "FAILED"
        provenance.update(error_type=type(error).__name__, error=str(error), completed_at_unix=time.time())
        write_json(out / "run_provenance.json", provenance)
        print(f"OFFICIAL DOCKQ FAILED: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
