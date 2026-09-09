#!/usr/bin/env python3
"""Export/verify/restore a same-base Boltz environment, without predictions.

Run export in the CPU-built recovery image. Run restore as root only after the
allocation controller verifies the exact base image. This helper neither
allocates resources nor changes or passes either frozen GPU runtime gate.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time

BASE = "docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3"
COMMIT = "250350ab4b995e075edcb489c4f183e32b35efd6"
ROOTS = ("opt/confovhh-boltz", "opt/confovhh-runtime")
LOCKED = {
    "opt/confovhh-runtime/bootstrap.lock": "0c36241dd159935b274c1e2d24edc4d3c98e880fac6da444914736bd255d9956",
    "opt/confovhh-runtime/requirements.lock": "8f30f92bd06772f5bb86d0ce6e0e38daa8f4465fecdbd2bf11eeb23ddd19bb7a",
    "opt/confovhh-runtime/check-boltz-runtime.py": "e0e329e1c531717307c561723b46e333f374d413ebdc7a415c30d0c8a424152a",
    "opt/confovhh-runtime/check-boltz-toolchain.py": "9ab433bbe35cbb3df042dff18aaad8719448bb55b160dd27f5d2d2d9f46d6ad4",
}
CHUNK = 512 * 1024 * 1024
DEADLINE = None


def now():
    return datetime.now(timezone.utc).isoformat()


def remaining():
    value = DEADLINE - time.monotonic()
    if value <= 0:
        raise TimeoutError("Environment bundle controller deadline reached")
    return value


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while block := handle.read(1024 * 1024):
            remaining()
            h.update(block)
    return h.hexdigest()


def identity(path, relative_to):
    path = Path(path)
    return {"path": path.relative_to(relative_to).as_posix(),
            "bytes": path.stat().st_size, "sha256": digest(path)}


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def run(command, logs, name, cwd=None, environment=None):
    logs.mkdir(parents=True, exist_ok=True)
    stdout, stderr = logs / (name + ".stdout.log"), logs / (name + ".stderr.log")
    started = time.monotonic()
    row = {"command": command, "startedAtUtc": now()}
    with stdout.open("xb") as out, stderr.open("xb") as err:
        process = subprocess.Popen(command, cwd=cwd, env=environment, stdout=out,
                                   stderr=err, start_new_session=True)
        try:
            row["returncode"] = process.wait(timeout=remaining())
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            row["returncode"] = process.wait(timeout=5)
            row["timedOut"] = True
    row["elapsedSeconds"] = round(time.monotonic() - started, 6)
    # Retain command evidence even when the operation deadline is exhausted.
    save(logs / (name + ".command.json"), row)
    if row["returncode"] != 0 or row.get("timedOut"):
        raise RuntimeError(f"{name} failed; see retained raw logs")
    return stdout


def parse_packages(text):
    result = {}
    for line in text.splitlines():
        name, version, architecture = line.split("\t")
        key = name.split(":", 1)[0] + ":" + architecture
        if key in result:
            raise ValueError("Duplicate package identity")
        result[key] = version
    return result


def inventory(logs, name):
    output = run(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"], logs, name)
    return parse_packages(output.read_text())


def python_identity(logs, name):
    code = """import json,platform,sys,sysconfig
print(json.dumps({'executable':sys.executable,'prefix':sys.prefix,'base_prefix':sys.base_prefix,'version':sys.version,'hexversion':sys.hexversion,'machine':platform.machine(),'system':platform.system(),'SOABI':sysconfig.get_config_var('SOABI'),'include':sysconfig.get_path('include'),'base_executable':sys._base_executable}))
"""
    output = run(["/opt/conda/bin/python", "-I", "-c", code], logs, name)
    result = json.loads(output.read_text())
    if result["system"] != "Linux" or result["machine"] not in {"x86_64", "amd64"}:
        raise ValueError("The exact Linux/amd64 environment is required")
    if result["hexversion"] >> 16 != (3 << 8 | 11):
        raise ValueError("Python 3.11 is required")
    executable = Path("/opt/conda/bin/python").resolve()
    header = Path(result["include"]) / "Python.h"
    result["executableRealPath"] = str(executable)
    result["executableSha256"] = digest(executable)
    result["pythonHeaderSha256"] = digest(header)
    return result


def environment_entries(root=Path("/")):
    entries = []
    for prefix in ROOTS:
        top = root / prefix
        if not top.is_dir() or top.is_symlink():
            raise ValueError("Missing or symlinked environment root: " + str(top))
        paths = [top]
        for directory, dirs, files in os.walk(top, followlinks=False):
            paths.extend(Path(directory) / name for name in dirs + files)
        for path in sorted(set(paths)):
            remaining()
            data = path.lstat()
            row = {"path": path.relative_to(root).as_posix(), "mode": stat.S_IMODE(data.st_mode), "mtimeNs": data.st_mtime_ns}
            if stat.S_ISREG(data.st_mode):
                row.update(type="file", bytes=data.st_size, sha256=digest(path))
            elif stat.S_ISDIR(data.st_mode):
                row["type"] = "directory"
            elif stat.S_ISLNK(data.st_mode):
                row.update(type="symlink", target=os.readlink(path))
            else:
                raise ValueError("Unsupported environment file type: " + str(path))
            entries.append(row)
    return entries


def locked_sources(entries):
    indexed = {row["path"]: row for row in entries}
    for path, expected in LOCKED.items():
        if indexed.get(path, {}).get("sha256") != expected:
            raise ValueError("Frozen runtime source or lock differs: " + path)


def export_bundle(args):
    if os.geteuid() != 0:
        raise ValueError("Export requires root in the CPU-built image")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    logs = output / "export-logs"
    receipt = {"schema": "confovhh.same-base-runtime-bundle.v1", "status": "FAIL",
               "createdAtUtc": now(), "baseImage": BASE, "recoveryCommit": COMMIT,
               "prefixes": ["/" + p for p in ROOTS], "predictionRequested": False,
               "gpuRuntimePassAsserted": False, "gpuJitPassAsserted": False,
               "baseImageIdentitySource": "Controller-supplied exact base inventory; digest is verified outside the container"}
    try:
        base = parse_packages(args.base_os_inventory.read_text())
        current = inventory(logs, "installed-os-packages")
        if set(base) - set(current):
            raise ValueError("Candidate unexpectedly removed base OS packages")
        receipt["baseOsPackages"] = base
        receipt["installedOsPackages"] = current
        receipt["pythonIdentity"] = python_identity(logs, "base-python-identity")
        run(["/opt/confovhh-boltz/bin/python", "-I", "-m", "pip", "check"], logs, "pip-check")
        delta = {k: v for k, v in current.items() if base.get(k) != v}
        receipt["osPackageDelta"] = delta
        debs = output / "debs"
        debs.mkdir()
        if delta:
            run(["apt-get", "update"], logs, "apt-index-refresh")
            run(["apt-get", "download"] + [f"{name}={version}" for name, version in sorted(delta.items())], logs, "exact-os-package-download", cwd=debs)
        packages = []
        observed = {}
        for i, path in enumerate(sorted(debs.glob("*.deb"))):
            result = run(["dpkg-deb", "-f", str(path), "Package", "Version", "Architecture"], logs, f"deb-identity-{i:03}")
            fields = dict(line.split(": ", 1) for line in result.read_text().splitlines())
            package_key = fields["Package"] + ":" + fields["Architecture"]
            if observed.get(package_key) is not None:
                raise ValueError("Duplicate package archive")
            observed[package_key] = fields["Version"]
            packages.append(dict(identity(path, output), package=package_key, version=fields["Version"]))
        if observed != delta:
            raise ValueError("Downloaded compiler OS package closure differs from captured transaction")
        receipt["debs"] = packages
        entries = environment_entries()
        locked_sources(entries)
        receipt["environmentEntries"] = entries
        archive = output / "runtime.tar.gz"
        run(["tar", "--format=pax", "--sort=name", "--hard-dereference", "--numeric-owner", "--owner=0", "--group=0", "--mtime=@0", "-I", "gzip -1 -n", "-C", "/", "-cf", str(archive), "--", *ROOTS], logs, "environment-archive")
        if environment_entries() != entries:
            raise ValueError("Environment changed during export; do not run concurrent diagnostics/imports")
        archive_identity = identity(archive, output)
        parts = output / "parts"
        parts.mkdir()
        receipt["parts"] = []
        whole = hashlib.sha256()
        with archive.open("rb") as source:
            index = 0
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                part = parts / f"runtime.tar.gz.part{index:04}"
                count = 0
                h = hashlib.sha256()
                with part.open("xb") as target:
                    while block:
                        remaining()
                        target.write(block)
                        h.update(block)
                        whole.update(block)
                        count += len(block)
                        if count == CHUNK:
                            break
                        block = source.read(min(1024 * 1024, CHUNK - count))
                receipt["parts"].append({"path": part.relative_to(output).as_posix(), "bytes": count, "sha256": h.hexdigest()})
                index += 1
        if whole.hexdigest() != archive_identity["sha256"] or sum(p["bytes"] for p in receipt["parts"]) != archive_identity["bytes"]:
            raise ValueError("Split archive verification failed")
        receipt["archive"] = archive_identity
        archive.unlink()
        receipt["logs"] = [identity(p, output) for p in sorted(logs.iterdir()) if p.is_file()]
        receipt["status"] = "EXPORTED_REQUIRES_RESTORE_AND_GPU_CHECKS"
        receipt["completedAtUtc"] = now()
        save(output / "bundle.json", receipt)
        print(json.dumps({"status": receipt["status"], "bundle": str(output / "bundle.json"), "sha256": digest(output / "bundle.json"), "archiveBytes": archive_identity["bytes"], "parts": len(receipt["parts"])}))
    except Exception as exc:
        receipt["failure"] = {"type": type(exc).__name__, "message": str(exc)}
        receipt["completedAtUtc"] = now()
        save(output / "failed-export.json", receipt)
        raise


def safe_relative(value):
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value:
        raise ValueError("Unsafe archive path")
    return path


class PartStream:
    """Read split files sequentially without recreating a multi-GB archive."""
    def __init__(self, paths):
        self.paths = iter(paths)
        self.current = None

    def read(self, count):
        if count < 0:
            raise ValueError("Unbounded stream read is disabled")
        blocks = []
        left = count
        while left:
            remaining()
            if self.current is None:
                path = next(self.paths, None)
                if path is None:
                    break
                self.current = path.open("rb")
            block = self.current.read(left)
            if not block:
                self.current.close()
                self.current = None
            else:
                blocks.append(block)
                left -= len(block)
        return b"".join(blocks)

    def close(self):
        if self.current is not None:
            self.current.close()


def verify_environment_archive(paths, entries):
    indexed = {row["path"]: row for row in entries}
    if len(indexed) != len(entries):
        raise ValueError("Duplicate environment manifest path")
    observed = set()
    stream = PartStream(paths)
    try:
        with tarfile.open(fileobj=stream, mode="r|gz") as source:
            for member in source:
                remaining()
                name = member.name.rstrip("/")
                safe_relative(name)
                row = indexed.get(name)
                if row is None or name in observed or member.mode != row["mode"]:
                    raise ValueError("Archive member differs from environment manifest")
                observed.add(name)
                if row["type"] == "directory" and member.isdir():
                    pass
                elif row["type"] == "symlink" and member.issym() and member.linkname == row["target"]:
                    pass
                elif row["type"] == "file" and member.isfile() and member.size == row["bytes"]:
                    h = hashlib.sha256()
                    with source.extractfile(member) as original:
                        while block := original.read(1024 * 1024):
                            remaining()
                            h.update(block)
                    if h.hexdigest() != row["sha256"]:
                        raise ValueError("Archived environment file checksum differs")
                else:
                    raise ValueError("Archived file type or link differs")
        if observed != set(indexed):
            raise ValueError("Archive omitted environment files")
    finally:
        stream.close()


def verify_bundle(bundle, expected):
    bundle = bundle.resolve()
    if digest(bundle / "bundle.json") != expected:
        raise ValueError("Bundle manifest checksum differs from preserved external receipt")
    data = json.loads((bundle / "bundle.json").read_text())
    if data.get("schema") != "confovhh.same-base-runtime-bundle.v1" or data.get("status") != "EXPORTED_REQUIRES_RESTORE_AND_GPU_CHECKS":
        raise ValueError("Incomplete or unsupported bundle")
    if data["baseImage"] != BASE or data["recoveryCommit"] != COMMIT or data["prefixes"] != ["/" + p for p in ROOTS]:
        raise ValueError("Bundle base, source or prefixes differ")
    locked_sources(data["environmentEntries"])
    names = set()
    for row in data["debs"] + data["parts"] + data["logs"]:
        relative = str(safe_relative(row["path"]))
        if relative in names:
            raise ValueError("Duplicate bundle file")
        names.add(relative)
        path = bundle / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
            raise ValueError("Bundle file identity differs: " + relative)
    actual = {p.relative_to(bundle).as_posix() for p in bundle.rglob("*") if p.is_file() or p.is_symlink()}
    if actual != names | {"bundle.json"}:
        raise ValueError("Bundle has unrecorded or missing files")
    whole = hashlib.sha256()
    size = 0
    for part in data["parts"]:
        with (bundle / part["path"]).open("rb") as source:
            while block := source.read(1024 * 1024):
                remaining()
                size += len(block)
                whole.update(block)
    if whole.hexdigest() != data["archive"]["sha256"] or size != data["archive"]["bytes"]:
        raise ValueError("Concatenated archive identity differs")
    verify_environment_archive([bundle / p["path"] for p in data["parts"]], data["environmentEntries"])
    return data


def extract_environment(archive, entries, destination_root=Path("/")):
    indexed = {row["path"]: row for row in entries}
    if len(indexed) != len(entries):
        raise ValueError("Duplicate environment manifest path")
    for row in entries:
        name = str(safe_relative(row["path"]))
        if not any(name == prefix or name.startswith(prefix + "/") for prefix in ROOTS):
            raise ValueError("Environment entry outside fixed roots")
    observed = set()
    directories = []
    with tarfile.open(archive, "r|gz") as source:
        for member in source:
            remaining()
            name = member.name.rstrip("/")
            row = indexed.get(name)
            if row is None or name in observed:
                raise ValueError("Unknown or duplicate tar member")
            observed.add(name)
            path = destination_root / name
            if any(parent.is_symlink() for parent in path.parents):
                raise ValueError("Archive extraction would traverse a symlink")
            if member.mode != row["mode"]:
                raise ValueError("Tar mode differs from environment manifest")
            path.parent.mkdir(parents=True, exist_ok=True)
            if row["type"] == "directory" and member.isdir():
                path.mkdir(exist_ok=True)
                directories.append((path, row["mode"], row["mtimeNs"]))
            elif row["type"] == "symlink" and member.issym() and member.linkname == row["target"]:
                os.symlink(row["target"], path)
                os.utime(path, ns=(row["mtimeNs"], row["mtimeNs"]), follow_symlinks=False)
            elif row["type"] == "file" and member.isfile() and member.size == row["bytes"]:
                h = hashlib.sha256()
                with source.extractfile(member) as original, path.open("xb") as target:
                    while block := original.read(1024 * 1024):
                        remaining()
                        target.write(block)
                        h.update(block)
                if h.hexdigest() != row["sha256"]:
                    raise ValueError("Extracted file checksum differs")
                path.chmod(row["mode"])
                os.utime(path, ns=(row["mtimeNs"], row["mtimeNs"]))
            else:
                raise ValueError("Tar type or link differs from environment manifest")
    if observed != set(indexed):
        raise ValueError("Archive omitted environment files")
    for path, mode, mtime in reversed(directories):
        path.chmod(mode)
        os.utime(path, ns=(mtime, mtime))


def restore_bundle(args):
    if os.geteuid() != 0:
        raise ValueError("Restore requires root in the pinned base")
    data = verify_bundle(args.bundle, args.expected_bundle_sha256)
    evidence = json.loads(args.base_identity_receipt.read_text())
    if evidence.get("verifiedBaseImageRef") != BASE or evidence.get("verified") is not True:
        raise ValueError("Controller must first verify the exact live base image")
    if any(Path("/" + prefix).exists() or Path("/" + prefix).is_symlink() for prefix in ROOTS):
        raise ValueError("Restore refuses to overwrite an existing environment")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    logs = output / "restore-logs"
    receipt = {"schema": "confovhh.same-base-runtime-restore.v1", "status": "FAIL", "startedAtUtc": now(), "bundleSha256": args.expected_bundle_sha256, "baseIdentityReceiptSha256": digest(args.base_identity_receipt), "gpuRuntimePassAsserted": False, "gpuJitPassAsserted": False}
    archive = output / "runtime.tar.gz"
    try:
        if python_identity(logs, "base-python-before") != data["pythonIdentity"]:
            raise ValueError("Base interpreter identity or Python ABI differs")
        before = inventory(logs, "os-packages-before")
        for key, version in data["baseOsPackages"].items():
            if before.get(key) not in {version, data["installedOsPackages"][key]}:
                raise ValueError("Base OS package missing or unexpectedly changed: " + key)
        paths = [str((args.bundle / row["path"]).resolve()) for row in data["debs"]]
        if paths:
            environment = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
            run(["apt-get", "--no-download", "--no-install-recommends", "-y", "install", *paths], logs, "offline-compiler-restore", environment=environment)
        after = inventory(logs, "os-packages-after")
        for key, version in data["installedOsPackages"].items():
            if after.get(key) != version:
                raise ValueError("Restored OS package identity differs: " + key)
        if python_identity(logs, "base-python-after") != data["pythonIdentity"]:
            raise ValueError("Base interpreter changed during offline package restoration")
        with archive.open("xb") as target:
            for part in data["parts"]:
                with (args.bundle / part["path"]).open("rb") as source:
                    while block := source.read(1024 * 1024):
                        remaining()
                        target.write(block)
        if digest(archive) != data["archive"]["sha256"]:
            raise ValueError("Restaged runtime archive checksum differs")
        extract_environment(archive, data["environmentEntries"])
        if environment_entries() != data["environmentEntries"]:
            raise ValueError("Restored environment file, symlink, or mode differs")
        receipt["environmentVerifiedBeforeExecution"] = True
        run(["/opt/confovhh-boltz/bin/python", "-I", "-m", "pip", "check"], logs, "pip-check")
        receipt["extraOsPackages"] = {k: v for k, v in after.items() if k not in data["installedOsPackages"]}
        receipt["status"] = "RESTORED_REQUIRES_ORIGINAL_RUNTIME_AND_FULL_GPU_JIT"
        archive.unlink()
    except Exception as exc:
        receipt["failure"] = {"type": type(exc).__name__, "message": str(exc)}
        raise
    finally:
        receipt["completedAtUtc"] = now()
        save(output / "restore-receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(output / "restore-receipt.json")}))


def main():
    global DEADLINE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-seconds", type=int, default=1800)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--max-seconds", type=int, default=argparse.SUPPRESS)
    export.add_argument("--base-os-inventory", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    for name in ("verify", "restore"):
        command = commands.add_parser(name)
        command.add_argument("--max-seconds", type=int, default=argparse.SUPPRESS)
        command.add_argument("--bundle", type=Path, required=True)
        command.add_argument("--expected-bundle-sha256", required=True)
        if name == "restore":
            command.add_argument("--base-identity-receipt", type=Path, required=True)
            command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.max_seconds <= 3600:
        parser.error("max-seconds must be 1..3600")
    DEADLINE = time.monotonic() + args.max_seconds
    if args.command == "export":
        export_bundle(args)
    elif args.command == "restore":
        restore_bundle(args)
    else:
        data = verify_bundle(args.bundle, args.expected_bundle_sha256)
        print(json.dumps({"status": "BUNDLE_BYTES_VERIFIED_ONLY", "environmentEntries": len(data["environmentEntries"]), "parts": len(data["parts"]), "predictionRequested": False}))


if __name__ == "__main__":
    main()
