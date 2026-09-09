#!/usr/bin/env python3
"""Check the active C/Python toolchain and a fresh, tiny Triton GPU compilation.

Invoke with the intended venv's absolute Python executable and -I. A fresh output
directory receives a receipt, probe sources, and private raw subprocess logs,
including failures. --compiler-only is a limited CPU control, never a GPU PASS.
No model, checkpoint, sequence, template, or inference input is used.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import sysconfig
import tempfile


SCHEMA = "confovhh.boltz-toolchain-check.v1"
JIT_TIMEOUT_SECONDS = 120
REQUIRED_VERSIONS = {"torch": "2.7.1", "triton": "3.3.1"}
TRITON_BUILD_SOURCE = {
    "url": "https://github.com/triton-lang/triton/blob/v3.3.1/python/triton/runtime/build.py",
    "sha256": "080b3fac37f0380980543c8d48f2e227bae8860760eb66b23c81c4781fd259c2",
    "compiler_rule": "CC when present (one executable, no shell); otherwise gcc, then clang",
    "include_rule": "active sysconfig default scheme include; posix_local becomes posix_prefix",
}

# A real file is necessary: triton.jit obtains the kernel source with inspect.
JIT_SOURCE = '''import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import traceback

result = {"status": "FAIL", "kernel_executed": False, "cuda_synchronized": False}
try:
    result["python_executable"] = sys.executable
    result["isolated_flag"] = bool(sys.flags.isolated)
    result["distributions"] = {name: importlib.metadata.version(name)
                               for name in ("torch", "triton")}
    if result["distributions"] != {"torch": "2.7.1", "triton": "3.3.1"}:
        raise RuntimeError("Pinned torch/triton distributions are required")
    import torch
    import triton
    import triton.language as tl
    import triton.runtime.build as triton_build
    result["torch_import_version"] = str(torch.__version__)
    result["triton_import_version"] = str(triton.__version__)
    result["torch_cuda_build_version"] = torch.version.cuda
    result["modules"] = {}
    for name, module in (("torch", torch), ("triton", triton), ("triton.runtime.build", triton_build)):
        path = Path(module.__file__).resolve()
        result["modules"][name] = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    if str(torch.__version__).split("+", 1)[0] != "2.7.1" or str(triton.__version__) != "3.3.1":
        raise RuntimeError("Imported torch/triton versions do not match the pinned runtime")
    if not torch.version.cuda or not torch.cuda.is_available():
        raise RuntimeError("CUDA-enabled torch and an available GPU are required")
    if os.environ.get("TRITON_INTERPRET") != "0":
        raise RuntimeError("The real Triton compiler is required")
    torch.cuda.set_device(0)
    properties = torch.cuda.get_device_properties(0)
    result["device"] = {"index": 0, "name": str(properties.name),
                        "compute_capability": [properties.major, properties.minor],
                        "total_memory_bytes": int(properties.total_memory)}

    @triton.jit
    def add_kernel(left, right, output, count, BLOCK: tl.constexpr):
        indices = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
        mask = indices < count
        a = tl.load(left + indices, mask=mask, other=0)
        b = tl.load(right + indices, mask=mask, other=0)
        tl.store(output + indices, a + b, mask=mask)

    count, block = 1003, 256
    left_values = [float((i % 31) - 15) / 8 for i in range(count)]
    right_values = [float((i % 19) - 9) / 16 for i in range(count)]
    expected = torch.tensor([a + b for a, b in zip(left_values, right_values)], dtype=torch.float32)
    with torch.no_grad():
        left = torch.tensor(left_values, dtype=torch.float32, device="cuda:0")
        right = torch.tensor(right_values, dtype=torch.float32, device="cuda:0")
        output = torch.full_like(left, float("nan"))
        torch.cuda.synchronize(0)
        compiled = add_kernel[(triton.cdiv(count, block),)](left, right, output, count, BLOCK=block)
        result["kernel_executed"] = True
        torch.cuda.synchronize(0)
        result["cuda_synchronized"] = True
        actual = output.cpu()
    if not torch.isfinite(actual).all().item():
        raise RuntimeError("Triton returned nonfinite values")
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    if "cubin" not in compiled.asm:
        raise RuntimeError("The NVIDIA kernel binary was not produced")
    cubins = list(Path(os.environ["TRITON_CACHE_DIR"]).rglob("*.cubin"))
    if not cubins:
        raise RuntimeError("The fresh Triton cache has no compiled NVIDIA kernel")
    result.update({"status": "PASS", "vector_length": count, "block_size": block,
                   "non_block_multiple": count % block != 0, "max_absolute_error": 0.0,
                   "reference": "independent deterministic CPU values; exact float32 comparison",
                   "cubin_sha256": hashlib.sha256(compiled.asm["cubin"]).hexdigest(),
                   "fresh_cache_cubin_count": len(cubins)})
except Exception as exc:
    result["exception_type"] = type(exc).__name__
    traceback.print_exc()
finally:
    with Path(sys.argv[1]).open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write("\\n")
sys.exit(0 if result["status"] == "PASS" else 1)
'''


def file_identity(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path.absolute()), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def write_private(path, text):
    with Path(path).open("x", encoding="utf-8") as handle:
        os.chmod(path, 0o600)
        handle.write(text)


def failure(receipt, check, message, exception=None):
    row = {"check": check, "message": message}
    if exception is not None:
        # Exception text and ambient environment values never enter the receipt.
        row["exception_type"] = type(exception).__name__
    receipt["failures"].append(row)


def runtime_info():
    include_system = None
    try:
        for line in (Path(sys.prefix) / "pyvenv.cfg").read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip().lower() == "include-system-site-packages":
                include_system = value.strip().lower() != "false"
    except OSError:
        pass
    return {"python": platform.python_version(), "python_major_minor": list(sys.version_info[:2]),
            "python_hexversion": sys.hexversion, "implementation": platform.python_implementation(),
            "system": platform.system(), "machine": platform.machine(),
            "python_executable": file_identity(sys.executable), "prefix": sys.prefix,
            "base_prefix": sys.base_prefix, "isolated_flag": bool(sys.flags.isolated),
            "isolated_venv": sys.prefix != sys.base_prefix and include_system is False}


def distribution_versions():
    versions = {name: [] for name in (*REQUIRED_VERSIONS, "boltz")}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name", "").lower().replace("_", "-")
        if name in versions:
            versions[name].append(distribution.version)
    return {name: sorted(items) for name, items in versions.items()}


def resolve_compiler():
    # Matches Triton 3.3.1: an explicitly empty/invalid CC must not fall back.
    override = os.environ.get("CC")
    if override is not None:
        selected = shutil.which(override) if override else None
        if selected is None:
            raise ValueError("CC is set but does not name one executable; no fallback is allowed")
        method = "CC"
    else:
        selected = shutil.which("gcc")
        method = "gcc"
        if selected is None:
            selected = shutil.which("clang")
            method = "clang"
        if selected is None:
            raise ValueError("No C compiler found; install gcc or clang, or set CC to one executable")
    return str(Path(selected).absolute()), method


def run_logged(command, output, label, timeout, environment):
    """Keep raw output private, bound the entire process group, and hash logs."""
    row = {"command": command, "timeout_seconds": timeout, "status": "FAIL"}
    stdout_path, stderr_path = output / f"{label}.stdout.log", output / f"{label}.stderr.log"
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        os.chmod(stdout_path, 0o600)
        os.chmod(stderr_path, 0o600)
        try:
            process = subprocess.Popen(command, stdout=stdout, stderr=stderr, env=environment,
                                       shell=False, start_new_session=True)
            try:
                row["returncode"] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                row["timed_out"] = True
                os.killpg(process.pid, signal.SIGKILL)
                row["returncode"] = process.wait(timeout=5)
            if row.get("returncode") == 0 and not row.get("timed_out"):
                row["status"] = "PASS"
        except Exception as exc:
            row["exception_type"] = type(exc).__name__
    row.update({"stdout": file_identity(stdout_path), "stderr": file_identity(stderr_path)})
    return row


def check_compiler(receipt, output):
    evidence = {"status": "FAIL", "resolution_reference": TRITON_BUILD_SOURCE,
                "cc_override_present": "CC" in os.environ}
    receipt["compiler"] = evidence
    try:
        compiler, method = resolve_compiler()
    except ValueError as exc:
        failure(receipt, "compiler_resolution", str(exc))
        return
    evidence.update({"resolution_method": method, "executable": file_identity(compiler),
                     "resolved_executable": file_identity(Path(compiler).resolve())})
    environment = dict(os.environ)
    evidence["version"] = run_logged([compiler, "--version"], output, "compiler-version", 10, environment)
    if evidence["version"]["status"] != "PASS":
        failure(receipt, "compiler_version", "The selected compiler could not report its version")
        return
    # Version text lives in the hashed raw log; do not print arbitrary subprocess text.
    scheme = sysconfig.get_default_scheme()
    if scheme == "posix_local":
        scheme = "posix_prefix"
    include = Path(sysconfig.get_paths(scheme=scheme)["include"])
    headers = {"status": "FAIL", "sysconfig_scheme": scheme, "include_directory": str(include),
               "required_python_hexversion": sys.hexversion, "files": {}}
    receipt["python_headers"] = headers
    for name in ("Python.h", "patchlevel.h", "pyconfig.h"):
        path = include / name
        if not path.is_file():
            failure(receipt, "python_headers", f"Missing {name} in the active interpreter's sysconfig include directory")
            return
        headers["files"][name] = file_identity(path)
    source = output / "compiler-probe.c"
    source_text = ("#include <Python.h>\n#include <stdio.h>\n"
                   f"_Static_assert(PY_VERSION_HEX == {sys.hexversion}, \"Python headers differ from active runtime\");\n"
                   "int main(void) { printf(\"CONFOVHH_C_OK:%u\\n\", (unsigned)PY_VERSION_HEX); return 0; }\n")
    write_private(source, source_text)
    evidence["source"] = file_identity(source)
    executable = output / "compiler-probe"
    evidence["compile"] = run_logged([compiler, str(source), "-std=c11", "-O0", f"-I{include}",
                                       "-o", str(executable)], output, "compiler-build", 30, environment)
    if evidence["compile"]["status"] != "PASS" or not executable.is_file():
        failure(receipt, "c_compile", "The C probe failed to compile with the active Python headers; inspect compiler-build.stderr.log")
        return
    evidence["probe_executable"] = file_identity(executable)
    evidence["run"] = run_logged([str(executable)], output, "compiler-run", 10, environment)
    expected = f"CONFOVHH_C_OK:{sys.hexversion}\n".encode()
    matched = (output / "compiler-run.stdout.log").read_bytes() == expected
    evidence["run"]["expected_output_matched"] = matched
    if evidence["run"]["status"] != "PASS" or not matched:
        failure(receipt, "c_execute", "The compiled C probe failed to run or returned unexpected output")
        return
    headers["status"] = "PASS"
    headers["exact_runtime_version_compile_assertion"] = True
    evidence["status"] = "PASS"


def check_jit(receipt, output):
    evidence = {"status": "FAIL", "timeout_seconds": JIT_TIMEOUT_SECONDS}
    receipt["triton_jit"] = evidence
    child = output / "triton-jit-probe.py"
    child_receipt = output / "triton-jit-result.json"
    write_private(child, JIT_SOURCE)
    evidence["source"] = file_identity(child)
    with tempfile.TemporaryDirectory(prefix="confovhh-triton-fresh-") as cache:
        triton_cache, inductor_cache = Path(cache) / "triton", Path(cache) / "inductor"
        triton_cache.mkdir()
        inductor_cache.mkdir()
        evidence["cache"] = {"fresh_empty_directories": True, "temporary": True,
                              "triton": str(triton_cache), "torchinductor": str(inductor_cache)}
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("TRITON_", "TORCHINDUCTOR_"))
                       and key not in {"PYTHONPATH", "PYTHONHOME"}}
        environment.update({"TRITON_CACHE_DIR": str(triton_cache),
                            "TORCHINDUCTOR_CACHE_DIR": str(inductor_cache), "TRITON_INTERPRET": "0",
                            "CC": receipt["compiler"]["executable"]["path"],
                            "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "WANDB_MODE": "disabled"})
        evidence["child"] = run_logged([sys.executable, "-I", str(child), str(child_receipt)],
                                        output, "triton-jit", JIT_TIMEOUT_SECONDS, environment)
        evidence["cache"]["triton_file_count"] = sum(path.is_file() for path in triton_cache.rglob("*"))
        if child_receipt.is_file():
            os.chmod(child_receipt, 0o600)
            evidence["result_file"] = file_identity(child_receipt)
            evidence["result"] = json.loads(child_receipt.read_text())
    result = evidence.get("result", {})
    if (evidence["child"]["status"] != "PASS" or result.get("status") != "PASS"
            or not result.get("kernel_executed") or not result.get("cuda_synchronized")
            or not result.get("non_block_multiple") or not result.get("fresh_cache_cubin_count")):
        failure(receipt, "triton_jit", "Fresh Triton GPU compilation or numeric verification failed; inspect triton-jit.stderr.log")
        return
    evidence["status"] = "PASS"


def run_checks(receipt, output, compiler_only):
    receipt["runtime"] = runtime_info()
    runtime = receipt["runtime"]
    if not runtime["isolated_flag"]:
        failure(receipt, "python_isolation", "Invoke this helper with the active Python executable and -I")
    if runtime["implementation"] != "CPython" or runtime["system"] != "Linux":
        failure(receipt, "platform", "A Linux CPython runtime is required")
    if not compiler_only:
        if runtime["python_major_minor"] != [3, 11]:
            failure(receipt, "python_version", "GPU mode requires Python 3.11")
        if runtime["machine"].lower() not in {"x86_64", "amd64"}:
            failure(receipt, "platform", "GPU mode requires Linux x86_64")
        if not runtime["isolated_venv"]:
            failure(receipt, "venv", "GPU mode requires a venv with system site packages disabled")
        receipt["distributions"] = distribution_versions()
        if any(receipt["distributions"][name] != [version] for name, version in REQUIRED_VERSIONS.items()):
            failure(receipt, "distribution_versions", "GPU mode requires exactly torch==2.7.1 and triton==3.3.1 distributions")
    if receipt["failures"]:
        return
    check_compiler(receipt, output)
    if receipt["failures"]:
        return
    if compiler_only:
        receipt["status"] = "COMPILER_ONLY_PASS"
        return
    check_jit(receipt, output)
    if not receipt["failures"]:
        receipt["status"] = "PASS"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="new directory; existing paths are never overwritten")
    parser.add_argument("--compiler-only", action="store_true", help="limited CPU control; skips GPU and pinned-venv validation")
    args = parser.parse_args(argv)
    output = args.output.absolute()
    try:
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    except FileExistsError:
        parser.error("output already exists; choose a fresh directory to preserve prior evidence")
    except OSError:
        parser.error("could not create output directory")
    receipt = {"schema": SCHEMA, "status": "FAIL", "scope": "compiler_only" if args.compiler_only else "compiler_and_fresh_triton_jit",
               "scientific_readiness": False, "model_inference_runs": 0, "failures": [],
               "created_at_utc": datetime.now(timezone.utc).isoformat(),
               "compiler": {"status": "SKIPPED"}, "python_headers": {"status": "SKIPPED"},
               "triton_jit": {"status": "SKIPPED"},
               "limitations": ["No model, input data, checkpoint, inference, or scientific output was exercised.",
                               "The frozen runtime check must be run separately; this helper does not replace it.",
                               "Compiler-only success proves no GPU or Boltz runtime readiness.",
                               "Source/executable identities are recorded; installed wheel contents are not reverified."]}
    try:
        receipt["checker"] = file_identity(__file__)
        run_checks(receipt, output, args.compiler_only)
    except Exception as exc:
        failure(receipt, "toolchain_check", "The toolchain check raised an exception; available subprocess logs were preserved", exc)
    receipt["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    write_private(output / "receipt.json", json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"status": receipt["status"], "output": str(output), "failure_count": len(receipt["failures"]),
                      "scientific_readiness": False}))
    return 0 if receipt["status"] in {"PASS", "COMPILER_ONLY_PASS"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
