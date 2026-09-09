#!/usr/bin/env python3
"""Run the frozen ten-pose 3P0G pilot; never open experimental coordinates.

This does not allocate or terminate a cloud Pod. The cloud controller must
enforce the separately quoted session/billing limit and preserve results.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tarfile
import time


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL_SHA = "8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9"
INPUT_MANIFEST_SHA = "1a236f8141f281c0da04979fc182461c8c68cf76d20795b00f44b3ceb1e0bc82"
CACHE = {
    "boltz2_conf.ckpt": (2286561469, "090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1"),
    "boltz2_aff.ckpt": (2062139170, "dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e"),
    "mols.tar": (1855662080, "39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7"),
}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def save(path, value):
    with Path(path).open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
        handle.write("\n")


def file_record(path, output):
    """Retain an unreadable artifact as an accounting failure, never erase it."""
    item = {"path": path.relative_to(output).as_posix()}
    try:
        item.update({"bytes": path.stat().st_size, "sha256": digest(path)})
    except OSError as error:
        item.update({"accountingError": type(error).__name__, "error": str(error)})
    return item


def checked(path, expected_sha, expected_bytes=None):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Required direct file absent: {path.name}")
    if expected_bytes is not None and path.stat().st_size != expected_bytes:
        raise ValueError(f"Byte count mismatch: {path.name}")
    if digest(path) != expected_sha:
        raise ValueError(f"Digest mismatch: {path.name}")
    return path


def prepare_molecules(cache):
    """Recreate missing CCD files from the verified tar; verify existing bytes."""
    inventory, expected = [], set()
    with tarfile.open(cache / "mols.tar", "r:") as archive:
        for member in archive:
            relative = Path(member.name)
            if (relative.is_absolute() or ".." in relative.parts
                    or not relative.parts or relative.parts[0] != "mols"
                    or not (member.isfile() or member.isdir())):
                raise ValueError("Unsafe or unexpected chemical-cache member")
            target = cache / relative
            for ancestor in [target, *target.parents]:
                if ancestor == cache:
                    break
                if ancestor.is_symlink():
                    raise ValueError("Symlinked chemical-cache path")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if member.name in expected:
                raise ValueError("Duplicate chemical-cache member")
            expected.add(member.name)
            raw = archive.extractfile(member).read()
            h = hashlib.sha256(raw).hexdigest()
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                checked(target, h, len(raw))
            else:
                with target.open("xb") as handle:
                    handle.write(raw)
            inventory.append({"path": member.name, "bytes": len(raw), "sha256": h})
    actual = {p.relative_to(cache).as_posix() for p in (cache / "mols").rglob("*") if p.is_file()}
    if actual != expected or "mols/P0G.pkl" not in expected:
        raise ValueError("Chemical-cache inventory differs or lacks the agonist")
    return inventory


def command(args, log_path, timeout, env):
    started = time.monotonic()
    with log_path.open("xb") as log:
        child = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT,
                                 env=env, start_new_session=True)
        try:
            code = child.wait(timeout=timeout)
            timed_out = False
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            code = child.wait()
            timed_out = True
    return {"args": args, "exitCode": code, "timedOut": timed_out,
            "elapsedSeconds": time.monotonic() - started, "logSha256": digest(log_path)}


def run(inputs, cache, python, output):
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=False)
    receipt = {"schema": "confovhh-3p0g-generation-execution-v1", "status": "PREFLIGHT",
               "startedAtUtc": now(), "protocolSha256": PROTOCOL_SHA,
               "scriptSha256": digest(__file__), "runs": [], "attempts": [],
               "nativeCoordinatesProvided": False, "templatesProvided": False,
               "cloudAllocationOrBillingControlledByThisScript": False}
    env = {k: v for k, v in os.environ.items() if k not in {"PYTHONPATH", "PYTHONHOME"}}
    env.update({"PYTHONNOUSERSITE": "1", "HF_HUB_OFFLINE": "1", "WANDB_MODE": "disabled"})
    launched_seeds = set()
    try:
        manifest = json.loads(checked(inputs / "manifest.json", INPUT_MANIFEST_SHA).read_text())
        plan = json.loads(checked(inputs / "protocol.json", PROTOCOL_SHA).read_text())
        actual = {p.relative_to(inputs).as_posix() for p in inputs.rglob("*") if p.is_file()}
        if actual != set(manifest["files"]) | {"manifest.json"}:
            raise ValueError("Generation input tree must contain exactly the frozen files")
        for name, item in manifest["files"].items():
            checked(inputs / name, item["sha256"], item["bytes"])
        for name, (size, h) in CACHE.items():
            checked(cache / name, h, size)
        receipt["chemicalCacheFiles"] = prepare_molecules(cache)
        lock = ROOT / "cloud/boltz-runtime-candidate/requirements-linux-py311.lock"
        checked(lock, "8f30f92bd06772f5bb86d0ce6e0e38daa8f4465fecdbd2bf11eeb23ddd19bb7a")
        checker = ROOT / "scripts/cloud/check-boltz-runtime.py"
        receipt["runtimeCheckerSha256"] = digest(checker)
        smoke = command([str(python), "-I", str(checker), "--lock", str(lock),
                         "--output", str(output / "runtime-smoke.json")],
                        output / "runtime-smoke.log", 180, env)
        receipt["runtimeSmoke"] = smoke
        if smoke["exitCode"] != 0:
            raise RuntimeError("GPU runtime smoke check failed; no inference attempted")
        executable = python.parent / "boltz"
        for seed in plan["generator"]["seeds"]:
            remaining = 6600 - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError("Pilot process deadline reached; no next seed launched")
            name = f"3P0G_seed{seed}"
            proteins = [{"protein": {"id": row["chain"], "sequence": row["sequence"],
                                      "msa": str(inputs / "msa" / f"chain_{row['chain']}.a3m")}}
                        for row in plan["case"]["inputProteins"]]
            document = {"version": 1, "sequences": proteins + [{"ligand": {"id": "C", "ccd": "P0G"}}]}
            yaml = output / f"{name}.yaml"
            save(yaml, document)  # JSON is a YAML subset; absolute local MSA paths only.
            args = [str(executable), "predict", str(yaml), "--out_dir", str(output / "raw"),
                    "--cache", str(cache), "--checkpoint", str(cache / "boltz2_conf.ckpt"),
                    "--affinity_checkpoint", str(cache / "boltz2_aff.ckpt"), "--model", "boltz2",
                    "--accelerator", "gpu", "--devices", "1", "--seed", str(seed),
                    "--diffusion_samples", "5", "--max_parallel_samples", "5",
                    "--recycling_steps", "3", "--sampling_steps", "200", "--step_scale", "1.5",
                    "--output_format", "mmcif", "--write_full_pae", "--use_potentials"]
            launched_seeds.add(seed)
            result = command(args, output / f"{name}.log", remaining, env)
            result.update({"seed": seed, "inputSha256": digest(yaml)})
            receipt["runs"].append(result)
            prediction = output / "raw" / f"boltz_results_{name}" / "predictions" / name
            for model in range(5):
                coordinate = prediction / f"{name}_model_{model}.cif"
                confidence = prediction / f"confidence_{name}_model_{model}.json"
                row = {"id": f"seed{seed}_model_{model}", "seed": seed, "modelFileIndex": model,
                       "status": "generated", "reason": "", "artifacts": {}}
                for role, filename in [("coordinate", coordinate), ("confidence", confidence)]:
                    if filename.is_file():
                        row["artifacts"][role] = {"path": filename.relative_to(output).as_posix(),
                                                  "sha256": digest(filename), "bytes": filename.stat().st_size}
                row["seedExitCode"] = result["exitCode"]
                row["confidenceStatus"] = "present" if "confidence" in row["artifacts"] else "missing"
                # A produced coordinate cannot disappear merely because its
                # confidence file or another sample failed. Audit every such
                # coordinate later; missing confidence withholds paired ranks.
                if "coordinate" not in row["artifacts"]:
                    row.update({"status": "failed", "reason": "Planned coordinate file missing; retain any partial outputs"})
                receipt["attempts"].append(row)
            save(output / f"seed{seed}-receipt.json", {"run": result, "attempts": receipt["attempts"][-5:]})
        complete = (all(r["status"] == "generated" and r["confidenceStatus"] == "present" for r in receipt["attempts"])
                    and all(r["exitCode"] == 0 for r in receipt["runs"]))
        receipt["status"] = "GENERATION_COMPLETE" if complete else "GENERATION_WITH_FAILURES"
    except Exception as error:
        receipt.update({"status": "FAILED", "errorType": type(error).__name__, "error": str(error)})
    finally:
        attempted = {r["id"] for r in receipt["attempts"]}
        for seed in [1, 2]:
            for model in range(5):
                name = f"seed{seed}_model_{model}"
                if name not in attempted:
                    row = {"id": name, "seed": seed, "modelFileIndex": model,
                           "status": "not-run", "reason": "Seed command was not attempted", "artifacts": {}}
                    if seed in launched_seeds:
                        row.update({"status": "accounting-failed",
                                    "reason": "Seed command attempted; sample accounting incomplete. Reconcile before comparison."})
                        prefix = f"3P0G_seed{seed}"
                        prediction = output / "raw" / f"boltz_results_{prefix}" / "predictions" / prefix
                        for role, filename in [("coordinate", f"{prefix}_model_{model}.cif"),
                                               ("confidence", f"confidence_{prefix}_model_{model}.json")]:
                            path = prediction / filename
                            if path.exists():
                                row["artifacts"][role] = file_record(path, output)
                    receipt["attempts"].append(row)
        receipt["completedAtUtc"] = now()
        receipt["elapsedSeconds"] = time.monotonic() - started
        receipt["outputFiles"] = [file_record(p, output) for p in sorted(output.rglob("*")) if p.is_file()]
        save(output / "generation-receipt.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["inputs", "cache", "python", "output"]:
        parser.add_argument(f"--{name}", required=True, type=Path)
    args = parser.parse_args()
    paths = {name: getattr(args, name).absolute() for name in ["inputs", "cache", "python", "output"]}
    result = run(**paths)
    print(json.dumps({"status": result["status"], "generated": sum(r["status"] == "generated" for r in result["attempts"]),
                      "receipt": str(paths["output"] / "generation-receipt.json")}))
    return 0 if result["status"] == "GENERATION_COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
