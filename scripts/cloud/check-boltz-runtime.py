#!/usr/bin/env python3
"""Record a bounded GPU/runtime check, without model downloads or inference.

Installed distribution versions are compared with a hash-pinned pip lock. This
does not reverify installed files against wheel archives and does not establish
scientific readiness. Only ``boltz predict --help`` and a tiny GPU matmul run.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time


SCHEMA = "confovhh.boltz-runtime-check.v1"
HELP_TIMEOUT_SECONDS = 60
REQUIRED_VERSIONS = {"boltz": "2.2.1", "torch": "2.7.1"}
REQUIREMENT = re.compile(r"([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*)")
HASH = re.compile(r"--hash=sha256:([0-9a-fA-F]{64})")


def canonical_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_lock(data):
    """Accept exact, unconditional requirements with one or more SHA256 hashes."""
    entries = {}
    pending = ""
    for line_number, raw in enumerate(data.decode("utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        continuation = line.endswith("\\")
        pending += " " + (line[:-1] if continuation else line)
        if continuation:
            continue
        tokens = pending.split()
        pending = ""
        requirement = REQUIREMENT.fullmatch(tokens[0])
        hashes = [HASH.fullmatch(token) for token in tokens[1:]]
        if requirement is None or not hashes or any(item is None for item in hashes):
            raise ValueError(f"Lock entry ending at line {line_number} is not an exact SHA256-pinned requirement")
        name, version = requirement.groups()
        name = canonical_name(name)
        if name in entries:
            raise ValueError(f"Duplicate normalized package at line {line_number}")
        entries[name] = {"version": version,
                         "artifact_sha256_allowlist": sorted({item.group(1).lower() for item in hashes})}
    if pending:
        raise ValueError("Lock ends with an incomplete continuation")
    if not entries:
        raise ValueError("Lock has no requirements")
    for name, version in REQUIRED_VERSIONS.items():
        if name not in entries or entries[name]["version"] != version:
            raise ValueError(f"Lock must pin {name}=={version}")
    return entries


def runtime_info():
    config = Path(sys.prefix) / "pyvenv.cfg"
    include_system_packages = None
    try:
        for line in config.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip().lower() == "include-system-site-packages":
                include_system_packages = value.strip().lower() != "false"
    except OSError:
        pass
    active_venv = sys.prefix != sys.base_prefix
    return {"python": platform.python_version(),
            "python_major_minor": list(sys.version_info[:2]),
            "implementation": platform.python_implementation(),
            "system": platform.system(), "machine": platform.machine(),
            "python_executable": str(Path(sys.executable).absolute()),
            "prefix": str(Path(sys.prefix).absolute()),
            "active_venv": active_venv,
            "system_site_packages_enabled": include_system_packages,
            "isolated_venv": active_venv and include_system_packages is False}


def installed_inventory():
    inventory = {}
    for distribution in importlib.metadata.distributions():
        name = canonical_name(distribution.metadata["Name"])
        inventory.setdefault(name, []).append(distribution.version)
    return {name: sorted(versions) for name, versions in sorted(inventory.items())}


def failure(receipt, check, message, exception=None):
    row = {"check": check, "message": message}
    if exception is not None:
        # Arbitrary exception text can contain paths, URLs or credentials.
        row["exception_type"] = type(exception).__name__
    receipt["failures"].append(row)


def check_distributions(lock, inventory):
    rows = []
    for name, pinned in sorted(lock.items()):
        installed = inventory.get(name, [])
        rows.append({"name": name, "locked_version": pinned["version"],
                     "installed_versions": installed,
                     "matches_lock": installed == [pinned["version"]]})
    return {"matches_lock": all(row["matches_lock"] for row in rows),
            "comparison": "exact installed distribution version strings; no local-version normalization",
            "installed_file_hashes_verified": False,
            "wheel_archive_hashes_reverified": False,
            "locked_distributions": rows,
            "unlocked_distributions": [{"name": name, "installed_versions": versions}
                                       for name, versions in sorted(inventory.items()) if name not in lock]}


def check_gpu(receipt):
    evidence = {"status": "FAIL", "matmul": {"executed": False}}
    receipt["torch_cuda"] = evidence
    try:
        torch = importlib.import_module("torch")
        evidence.update({"torch_import_version": str(torch.__version__),
                         "torch_cuda_build_version": torch.version.cuda,
                         "cuda_available": bool(torch.cuda.is_available())})
        # Distribution metadata was matched exactly above. A compiled torch
        # module can additionally report its build suffix, e.g. +cu126.
        if str(torch.__version__).split("+", 1)[0] != REQUIRED_VERSIONS["torch"]:
            failure(receipt, "torch_import_version", "Imported torch has the wrong public version")
            return
        if not evidence["cuda_available"] or not evidence["torch_cuda_build_version"]:
            failure(receipt, "gpu_required", "CUDA-enabled torch and an available GPU are required")
            return
        count = int(torch.cuda.device_count())
        evidence["gpu_count"] = count
        evidence["devices"] = []
        if count < 1:
            failure(receipt, "gpu_required", "No CUDA devices were enumerated")
            return
        for index in range(count):
            properties = torch.cuda.get_device_properties(index)
            evidence["devices"].append({"index": index, "model": str(properties.name),
                                        "total_memory_bytes": int(properties.total_memory),
                                        "compute_capability": [int(properties.major), int(properties.minor)]})
        size = 32
        left_values = [[((i * size + k) % 17 - 8) / 8 for k in range(size)] for i in range(size)]
        right_values = [[((k * size + j) % 13 - 6) / 8 for j in range(size)] for k in range(size)]
        device = "cuda:0"
        with torch.no_grad():
            left = torch.tensor(left_values, dtype=torch.float32, device=device)
            right = torch.tensor(right_values, dtype=torch.float32, device=device)
            torch.cuda.synchronize(0)
            started = time.perf_counter()
            result = torch.matmul(left, right)
            torch.cuda.synchronize(0)
            elapsed = time.perf_counter() - started
            evidence["matmul"] = {"executed": True, "device": str(result.device),
                                  "shape": list(result.shape), "dtype": str(result.dtype),
                                  "elapsed_seconds": elapsed}
            actual = result.cpu().tolist()
        if str(result.device) != device or list(result.shape) != [size, size]:
            failure(receipt, "gpu_matmul", "Matmul did not produce the expected CUDA tensor")
            return
        finite = all(math.isfinite(value) for row in actual for value in row)
        evidence["matmul"]["all_values_finite"] = finite
        if not finite:
            failure(receipt, "gpu_matmul", "GPU matmul returned nonfinite values")
            return
        expected = [[sum(left_values[i][k] * right_values[k][j] for k in range(size))
                     for j in range(size)] for i in range(size)]
        maximum_error = max(abs(actual[i][j] - expected[i][j]) for i in range(size) for j in range(size))
        evidence["matmul"].update({"cpu_reference_max_absolute_error": maximum_error,
                                    "allowed_max_absolute_error": 0.0001,
                                    "result_sum": sum(sum(row) for row in actual)})
        if maximum_error > 0.0001:
            failure(receipt, "gpu_matmul", "GPU matmul differs from the independent small CPU reference")
            return
        evidence["status"] = "PASS"
    except Exception as exc:
        failure(receipt, "torch_cuda", "Torch import or CUDA runtime check raised an exception", exc)


def output_summary(data):
    data = data or b""
    if isinstance(data, str):
        data = data.encode("utf-8", errors="replace")
    return {"bytes": len(data), "sha256": sha256(data)}


def check_boltz_help(receipt):
    executable = Path(receipt["runtime"]["prefix"]) / "bin" / "boltz"
    evidence = {"status": "FAIL", "command": [str(executable), "predict", "--help"],
                "timeout_seconds": HELP_TIMEOUT_SECONDS, "model_inference_requested": False}
    receipt["boltz_predict_help"] = evidence
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK):
        failure(receipt, "boltz_predict_help", "The absolute venv Boltz executable is missing or not executable")
        return
    try:
        executable.resolve().relative_to(Path(receipt["runtime"]["prefix"]).resolve())
    except ValueError:
        failure(receipt, "boltz_predict_help", "Boltz executable resolves outside the active venv")
        return
    try:
        with executable.open("rb") as handle:
            first_line = handle.readline(512).decode("utf-8").strip()
        interpreter = Path(first_line[2:]) if first_line.startswith("#!") else None
        expected_interpreter = Path(receipt["runtime"]["python_executable"])
        # Checking only the resolved binary is insufficient: a venv Python
        # symlink and the base Python may resolve to the same executable.
        if (interpreter is None or not interpreter.is_absolute()
                or interpreter.parent.resolve() != executable.parent.resolve()
                or interpreter.resolve() != expected_interpreter.resolve()):
            failure(receipt, "boltz_cli_interpreter", "Boltz CLI must use the active venv Python in its shebang")
            return
        evidence["interpreter"] = str(interpreter)
        evidence["executable_sha256"] = sha256(executable.read_bytes())
        environment = dict(os.environ)
        environment.pop("PYTHONPATH", None)
        environment.pop("PYTHONHOME", None)
        environment.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "WANDB_MODE": "disabled"})
        completed = subprocess.run(evidence["command"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   timeout=HELP_TIMEOUT_SECONDS, check=False, shell=False, env=environment)
        evidence.update({"returncode": completed.returncode,
                         "stdout": output_summary(completed.stdout),
                         "stderr": output_summary(completed.stderr),
                         "predict_usage_present": b"Usage:" in completed.stdout and b"predict" in completed.stdout})
        if completed.returncode != 0 or not evidence["predict_usage_present"]:
            failure(receipt, "boltz_predict_help", "Boltz predict help failed or lacked the expected usage text")
            return
        evidence["status"] = "PASS"
    except subprocess.TimeoutExpired as exc:
        evidence.update({"timed_out": True, "stdout": output_summary(exc.stdout),
                         "stderr": output_summary(exc.stderr)})
        failure(receipt, "boltz_predict_help", "Boltz predict help exceeded its timeout")
    except Exception as exc:
        failure(receipt, "boltz_predict_help", "Boltz predict help could not run", exc)


def run_checks(lock_path):
    receipt = {"schema": SCHEMA, "status": "FAIL", "scope": "runtime_gpu_smoke_only",
               "scientific_readiness": False, "model_inference_runs": 0,
               "created_at_utc": datetime.now(timezone.utc).isoformat(),
               "script_sha256": sha256(Path(__file__).read_bytes()), "failures": [],
               "runtime": runtime_info(),
               "lock": {"path": str(Path(lock_path).absolute())},
               "torch_cuda": {"status": "SKIPPED", "matmul": {"executed": False}},
               "boltz_predict_help": {"status": "SKIPPED"},
               "limitations": ["No checkpoint, sequence, template, or model inference was exercised.",
                               "A passing runtime check does not establish scientific readiness.",
                               "Installed distribution versions are checked; installed file and wheel archive hashes are not reverified."]}
    runtime = receipt["runtime"]
    runtime["python_environment_overrides_nonempty"] = {
        name: bool(os.environ.get(name)) for name in ("PYTHONPATH", "PYTHONHOME")}
    if any(runtime["python_environment_overrides_nonempty"].values()):
        failure(receipt, "python_import_environment", "Nonempty PYTHONPATH or PYTHONHOME must be unset before this check")
    if runtime["python_major_minor"] != [3, 11]:
        failure(receipt, "python_version", "Python 3.11 is required")
    if runtime["system"] != "Linux" or runtime["machine"].lower() not in {"x86_64", "amd64"}:
        failure(receipt, "platform", "Linux x86_64 is required")
    if not runtime["isolated_venv"]:
        failure(receipt, "venv", "An isolated Python venv is required")
    try:
        data = Path(lock_path).read_bytes()
        receipt["lock"].update({"sha256": sha256(data), "bytes": len(data)})
        lock = parse_lock(data)
        receipt["lock"]["requirements"] = lock
        receipt["distributions"] = check_distributions(lock, installed_inventory())
        if not receipt["distributions"]["matches_lock"]:
            failure(receipt, "distribution_versions", "One or more installed distributions are missing, duplicated, or differ from the lock")
    except Exception as exc:
        failure(receipt, "dependency_lock", "Dependency lock could not be parsed or installed distribution inventory could not be read", exc)
    if not receipt["failures"]:
        check_gpu(receipt)
        check_boltz_help(receipt)
    else:
        receipt["torch_cuda"]["skip_reason"] = "prerequisite_check_failed"
        receipt["boltz_predict_help"]["skip_reason"] = "prerequisite_check_failed"
    if not receipt["failures"]:
        receipt["status"] = "PASS"
    receipt["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.output.resolve() in {args.lock.resolve(), Path(__file__).resolve()}:
        parser.error("output must not overwrite the dependency lock or checker")
    if args.output.exists() or args.output.is_symlink():
        parser.error("output already exists; use a fresh path to preserve prior receipts")
    receipt = run_checks(args.lock)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Write failures too. No environment values or raw subprocess output are saved.
    with args.output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"status": receipt["status"], "output": str(args.output.absolute()),
                      "scientific_readiness": False, "failure_count": len(receipt["failures"])}))
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
