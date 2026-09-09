#!/usr/bin/env python3
"""Bounded, help-only Boltz startup diagnosis. Never runs predictions or a GPU gate.

Run with the pinned base Python and --python pointing to the isolated pinned venv.
The exact CLI diagnostic runs first (60 s); the instrumented CLI runs once next
(300 s) and may benefit from filesystem caches warmed by the first invocation.
Neither result replaces, reruns, modifies, or certifies the frozen runtime checker.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
import traceback

SCHEMA = "confovhh.boltz-startup-diagnostic.v1"
EXACT_LIMIT_SECONDS = 60
INSTRUMENTED_LIMIT_SECONDS = 300
STACK_INTERVAL_SECONDS = 15
PRIOR_FAILED_RECEIPT_SHA256 = "d46d33cc01a85d0d80c42147e8f36db8e9edbfc2abf788dae17e8e5105b377ec"
FROZEN_CHECKER_SHA256 = "e0e329e1c531717307c561723b46e333f374d413ebdc7a415c30d0c8a424152a"
FROZEN_RUNNER_SHA256 = "2865eea96212b3733687c2dd459bb5a48096a842e0d61361ea86617a1b0d9745"

# Only the console entry point with the literal help-only arguments is invoked.
# Keep faulthandler active across runpy import and all console startup imports.
INSTRUMENTED_CODE = r'''
import faulthandler, sys, time
faulthandler.enable(file=sys.stderr, all_threads=True)
faulthandler.dump_traceback_later(15, repeat=True, file=sys.stderr, exit=False)
started = time.monotonic()
print("DIAGNOSTIC_PHASE instrumented-entrypoint-start", time.time(), flush=True, file=sys.stderr)
try:
    import runpy
    console_path = sys.argv[1]
    sys.argv = [console_path, "predict", "--help"]
    runpy.run_path(console_path, run_name="__main__")
finally:
    print("DIAGNOSTIC_PHASE instrumented-entrypoint-finish", time.time(),
          "elapsed_seconds", time.monotonic() - started, flush=True, file=sys.stderr)
    faulthandler.cancel_dump_traceback_later()
'''.strip()

# No heavyweight imports: inventory the active interpreter and distribution
# metadata after both startup measurements, so this probe cannot warm them first.
IDENTITY_CODE = r'''
import importlib.metadata as m, json, platform, sys, sysconfig
print(json.dumps({"python": platform.python_version(), "executable": sys.executable,
 "prefix": sys.prefix, "base_prefix": sys.base_prefix, "system": platform.system(),
 "machine": platform.machine(), "sysconfig_include": sysconfig.get_path("include"),
 "distributions": sorted([{"name": d.metadata.get("Name"), "version": d.version}
                           for d in m.distributions()], key=lambda x: str(x["name"]))}, sort_keys=True))
'''.strip()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def file_record(path, root):
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": digest(path)}


def event(root, phase, kind, **fields):
    value = {"at_utc": utc_now(), "phase": phase, "event": kind, **fields}
    with (root / "controller-events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, sort_keys=True) + "\n")
        handle.flush()
    print(json.dumps(value, sort_keys=True), flush=True)


def resource_snapshot():
    """Read only public host/resource facts; do not serialize environment values."""
    data = {"at_utc": utc_now(), "platform": platform.platform(),
            "machine": platform.machine(), "cpu_count": os.cpu_count()}
    if hasattr(os, "sched_getaffinity"):
        data["allowed_cpu_count"] = len(os.sched_getaffinity(0))
    paths = {
        "mountinfo": "/proc/self/mountinfo", "cpu_cgroup_membership": "/proc/self/cgroup",
        "cpu_max": "/sys/fs/cgroup/cpu.max", "cpu_stat": "/sys/fs/cgroup/cpu.stat",
        "memory_max": "/sys/fs/cgroup/memory.max", "memory_current": "/sys/fs/cgroup/memory.current",
        "memory_events": "/sys/fs/cgroup/memory.events", "io_stat": "/sys/fs/cgroup/io.stat",
        "cpu_quota_v1": "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
        "cpu_period_v1": "/sys/fs/cgroup/cpu/cpu.cfs_period_us",
        "load_average": "/proc/loadavg", "memory_info": "/proc/meminfo",
    }
    for label, filename in paths.items():
        try:
            data[label] = Path(filename).read_text()[:262144]
        except OSError as exc:
            data[label] = {"unavailable": type(exc).__name__}
    return data


def usage_children():
    try:
        import resource
        r = resource.getrusage(resource.RUSAGE_CHILDREN)
        return {"user_cpu_seconds": r.ru_utime, "system_cpu_seconds": r.ru_stime,
                "minor_page_faults": r.ru_minflt, "major_page_faults": r.ru_majflt,
                "block_input_operations": r.ru_inblock, "block_output_operations": r.ru_oublock,
                "voluntary_context_switches": r.ru_nvcsw,
                "involuntary_context_switches": r.ru_nivcsw}
    except (ImportError, OSError):
        return {}


def kill_group(process, result, reason):
    try:
        os.killpg(process.pid, signal.SIGKILL)
        result.setdefault("signals", []).append({"signal": "SIGKILL", "reason": reason,
                                                "at_utc": utc_now()})
    except ProcessLookupError:
        pass


def run_command(name, argv, limit, root, environment):
    """Save raw bytes directly; kill the entire group at the absolute deadline."""
    stdout_path, stderr_path = root / f"{name}.stdout.log", root / f"{name}.stderr.log"
    result = {"phase": name, "command": argv, "timeout_seconds": limit,
              "started_at_utc": utc_now(), "timed_out": False,
              "model_inference_requested": False, "signals": []}
    started = time.monotonic()
    deadline = started + limit
    before = usage_children()
    event(root, name, "start", command=argv, timeout_seconds=limit)
    process = None
    try:
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            process = subprocess.Popen(argv, stdout=stdout, stderr=stderr,
                stdin=subprocess.DEVNULL, cwd=root, env=environment,
                start_new_session=True, shell=False)
            result["pid"] = process.pid
            try:
                result["exit_code"] = process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                result["timed_out"] = True
                result["stop_reason"] = "absolute_diagnostic_deadline"
                kill_group(process, result, "deadline")
                try:
                    result["exit_code"] = process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    result["exit_code"] = None
                    result["reap_failed_after_sigkill"] = True
            finally:
                # An entry point that exits early must not leave background
                # descendants alive and writing to its evidence streams.
                kill_group(process, result, "cleanup_any_remaining_descendants")
                if process.poll() is None:
                    try:
                        result["exit_code"] = process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        result["reap_failed_after_sigkill"] = True
    except BaseException as exc:
        if process is not None:
            kill_group(process, result, "controller_exception")
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                result["reap_failed_after_sigkill"] = True
        result["controller_error"] = {"type": type(exc).__name__, "message": str(exc)}
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            result["controller_interrupted"] = True
    finally:
        result["finished_at_utc"] = utc_now()
        result["elapsed_seconds"] = time.monotonic() - started
        after = usage_children()
        result["child_resource_usage_delta"] = {k: after[k] - before.get(k, 0) for k in after}
        for label, path in [("stdout", stdout_path), ("stderr", stderr_path)]:
            if path.is_file():
                result[label] = file_record(path, root)
        event(root, name, "finish", elapsed_seconds=result["elapsed_seconds"],
              exit_code=result.get("exit_code"), timed_out=result["timed_out"],
              controller_error=result.get("controller_error"))
        with (root / f"{name}.receipt.json").open("x", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, sort_keys=True)
            handle.write("\n")
    return result


def help_outcome(result, output):
    raw = output.read_bytes() if output.is_file() else b""
    result["expected_help_text_present"] = b"Usage:" in raw and b"predict" in raw
    result["startup_completed_within_diagnostic_limit"] = (
        result.get("exit_code") == 0 and not result["timed_out"]
        and result["expected_help_text_present"] and "controller_error" not in result)
    result["frozen_runtime_gate_pass"] = False
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, type=Path,
                        help="Absolute interpreter path in the pinned isolated Python 3.11 venv")
    parser.add_argument("--output", required=True, type=Path, help="New evidence directory; must not exist")
    args = parser.parse_args(argv)
    python = args.python
    if not python.is_absolute() or not python.is_file() or not os.access(python, os.X_OK):
        parser.error("--python must be an absolute executable interpreter path")
    console = python.parent / "boltz"
    if not console.is_file() or not os.access(console, os.X_OK):
        parser.error("the selected venv has no executable bin/boltz")
    prefix = python.parent.parent
    if not (prefix / "pyvenv.cfg").is_file():
        parser.error("the selected interpreter is not inside a venv")
    config = (prefix / "pyvenv.cfg").read_text()
    if "include-system-site-packages = false" not in config.lower():
        parser.error("the selected venv must exclude system site packages")
    with console.open("rb") as handle:
        first_line = handle.readline(512).decode("utf-8").strip()
    if not first_line.startswith("#!"):
        parser.error("bin/boltz lacks an interpreter shebang")
    shebang = Path(first_line[2:])
    if (not shebang.is_absolute() or shebang.parent.resolve() != python.parent.resolve()
            or shebang.resolve() != python.resolve()):
        parser.error("bin/boltz must use the selected venv interpreter")
    root = args.output.absolute()
    if root.exists() or root.is_symlink():
        parser.error("output exists; use a new directory to preserve evidence")
    root.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ)
    removed = [k for k in ("PYTHONPATH", "PYTHONHOME") if k in environment]
    for k in ("PYTHONPATH", "PYTHONHOME"):
        environment.pop(k, None)
    environment.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                        "WANDB_MODE": "disabled"})
    receipt = {"schema": SCHEMA, "status": "DIAGNOSTIC_RUNNING", "started_at_utc": utc_now(),
       "script_sha256": digest(Path(__file__)), "python_path": str(python),
       "console_path": str(console), "console_sha256": digest(console),
       "prior_failed_runtime_receipt_sha256": PRIOR_FAILED_RECEIPT_SHA256,
       "frozen_runtime_checker_sha256": FROZEN_CHECKER_SHA256,
       "frozen_generation_runner_sha256": FROZEN_RUNNER_SHA256,
       "frozen_runtime_modified": False, "frozen_runtime_gate_rerun": False,
       "frozen_runtime_gate_result": "PRIOR_FAIL_PRESERVED",
       "model_inference_runs": 0, "gpu_certification": False,
       "environment_policy": {"removed_variable_names": removed,
          "safe_overrides": {k: environment[k] for k in
                             ["HF_HUB_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "WANDB_MODE"]},
          "other_environment_values_saved": False},
       "execution_order": ["exact-cli-help", "instrumented-cli-help", "interpreter-identity"],
       "cache_caveat": "The exact help invocation runs first. The instrumented invocation may benefit from filesystem and shared caches it warmed. No cache was cleared. Instrumentation and -I add diagnostic differences; results are not selectively rerun.",
       "instrumented_stack_interval_seconds": STACK_INTERVAL_SECONDS,
       "instrumented_python_code": INSTRUMENTED_CODE,
       "commands": [], "resources_before": resource_snapshot()}
    try:
        exact = run_command("exact-cli-help", [str(console), "predict", "--help"],
                            EXACT_LIMIT_SECONDS, root, environment)
        receipt["commands"].append(help_outcome(exact, root / "exact-cli-help.stdout.log"))
        if exact.get("controller_interrupted") or exact.get("reap_failed_after_sigkill"):
            raise RuntimeError("Controller interrupted or child could not be reaped; no next phase")
        instrumented = run_command("instrumented-cli-help",
           [str(python), "-I", "-u", "-X", "importtime", "-c", INSTRUMENTED_CODE, str(console)],
           INSTRUMENTED_LIMIT_SECONDS, root, environment)
        receipt["commands"].append(help_outcome(instrumented, root / "instrumented-cli-help.stdout.log"))
        if instrumented.get("controller_interrupted") or instrumented.get("reap_failed_after_sigkill"):
            raise RuntimeError("Controller interrupted or child could not be reaped; no next phase")
        identity = run_command("interpreter-identity", [str(python), "-I", "-c", IDENTITY_CODE],
                               30, root, environment)
        receipt["commands"].append(identity)
        if identity.get("exit_code") == 0 and not identity["timed_out"]:
            observed = json.loads((root / "interpreter-identity.stdout.log").read_text())
            receipt["interpreter_identity"] = observed
            expected = {"boltz": "2.2.1", "torch": "2.7.1", "triton": "3.3.1"}
            installed = {}
            for distribution in observed.get("distributions", []):
                name = str(distribution.get("name", "")).lower().replace("_", "-")
                installed.setdefault(name, []).append(distribution.get("version"))
            receipt["identity_checks"] = {
                "linux_x86_64": observed.get("system") == "Linux" and observed.get("machine") in ["x86_64", "amd64"],
                "python_3_11": str(observed.get("python", "")).startswith("3.11."),
                "selected_venv": observed.get("prefix") == str(prefix) and observed.get("base_prefix") != str(prefix),
                "boltz_torch_triton_versions_match": all(installed.get(k) == [v] for k, v in expected.items()),
                "all_dependency_locks_verified_by_this_helper": False}
            receipt["identity_checks"]["basic_pinned_identity_matches"] = all(
                receipt["identity_checks"][k] for k in ["linux_x86_64", "python_3_11", "selected_venv", "boltz_torch_triton_versions_match"])
        receipt["status"] = "DIAGNOSTIC_COMPLETE"
    except BaseException as exc:
        receipt["status"] = "DIAGNOSTIC_CONTROLLER_FAILED"
        receipt["controller_error"] = {"type": type(exc).__name__, "message": str(exc)}
        (root / "controller-error.log").write_text(traceback.format_exc())
    finally:
        receipt["resources_after"] = resource_snapshot()
        receipt["finished_at_utc"] = utc_now()
        receipt["files"] = [file_record(p, root) for p in sorted(root.iterdir()) if p.is_file()]
        with (root / "receipt.json").open("x", encoding="utf-8") as handle:
            json.dump(receipt, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print(json.dumps({"status": receipt["status"], "output": str(root),
                          "model_inference_runs": 0, "gpu_certification": False}), flush=True)
    return 0 if receipt["status"] == "DIAGNOSTIC_COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
