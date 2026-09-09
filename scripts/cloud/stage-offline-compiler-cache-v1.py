#!/usr/bin/env python3
"""Diagnose APT acquisition and pre-stage only captured compiler .deb bytes.

Run in a CPU control container after disconnecting its network. The original
offline install is an expected-failure negative control; if it unexpectedly
installs anything, record non-reproduction and stop without applying a remedy.
On the expected path, only captured archive files are staged; the unchanged
bundle helper performs the actual restore afterward. No inference is invoked.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import time
from urllib.parse import unquote

SCHEMA = "confovhh.offline-compiler-cache-stage.v1"
BASE = "docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3"
EXPECTED_BUNDLE = "b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c"


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def package_map(text):
    result = {}
    for line in text.splitlines():
        name, version, architecture = line.split("\t")
        result[name.split(":", 1)[0]+":"+architecture] = version
    return result


def parse_simulation(raw, captured):
    result = []
    by_name = {row["package"].split(":", 1)[0]: row for row in captured}
    for line in raw.splitlines():
        if line.startswith("Remv "):
            raise ValueError("APT simulation would remove a package")
        if not line.startswith("Inst "):
            continue
        match = re.match(r"^Inst (\S+)(?: \[[^]]+\])? \((\S+)", line)
        if match is None:
            raise ValueError("Unrecognized APT install-plan line")
        name, version = match.groups()
        row = by_name.get(name.split(":", 1)[0])
        if row is None or row["version"] != version:
            raise ValueError("APT selected an unbundled package/version: "+name+"="+version)
        result.append({"package": row["package"], "version": version, "rawLine": line})
    if len({row["package"] for row in result}) != len(result):
        raise ValueError("Duplicate planned package")
    return result


def parse_uris(raw, captured):
    by_filename = {unquote(Path(row["path"]).name): row for row in captured}
    result = []
    for line in raw.splitlines():
        if not line.startswith("'"):
            continue
        fields = shlex.split(line)
        if len(fields) not in {3,4} or not fields[2].isdigit():
            raise ValueError("Unrecognized APT URI-plan line")
        uri, filename, size = fields[:3]
        apt_hash = fields[3] if len(fields)==4 else None
        if Path(filename).name != filename or filename in {".", ".."}:
            raise ValueError("Unsafe APT archive-cache name")
        row = by_filename.get(unquote(filename))
        if row is None or row["bytes"] != int(size):
            raise ValueError("APT requested bytes outside the captured compiler closure: "+filename)
        result.append({"uri": uri, "cacheFilename": filename, "bytes": int(size), "aptReportedHash": apt_hash, "package": row["package"], "version": row["version"], "bundlePath": row["path"], "sha256": row["sha256"]})
    if len({row["cacheFilename"] for row in result}) != len(result):
        raise ValueError("Duplicate APT archive-cache filename")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-bundle-sha256", required=True)
    parser.add_argument("--max-seconds", type=int, default=180)
    args = parser.parse_args()
    if os.geteuid() != 0 or not 30 <= args.max_seconds <= 600:
        parser.error("root and a 30..600-second deadline are required")
    args.output.mkdir(parents=True, exist_ok=False)
    deadline = time.monotonic()+args.max_seconds
    receipt = {"schema": SCHEMA, "status": "FAIL", "startedAtUtc": now(), "bundleManifestSha256": args.expected_bundle_sha256, "packagesInstalledByThisHelper": False, "networkFallbackAllowed": False, "originalRestoreHelperModified": False, "commands": []}
    def run(command, label, permitted_codes=(0,)):
        timeout = deadline-time.monotonic()
        if timeout <= 0:
            raise TimeoutError("Offline package diagnostic deadline exhausted")
        row = {"command": command, "startedAtUtc": now(), "timeoutSeconds": timeout}
        out, err = args.output/(label+".stdout.log"), args.output/(label+".stderr.log")
        with out.open("xb") as stdout, err.open("xb") as stderr:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True, env=dict(os.environ, DEBIAN_FRONTEND="noninteractive"))
            try:
                child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                row["timedOut"] = True
        row.update(exitCode=child.returncode, finishedAtUtc=now())
        for kind,path in (("stdout",out),("stderr",err)):
            row[kind] = {"path":path.name,"bytes":path.stat().st_size,"sha256":digest(path)}
        receipt["commands"].append(row)
        if child.returncode not in permitted_codes or row.get("timedOut"):
            raise RuntimeError(label+" failed; raw output preserved")
        return row, out.read_text(), err.read_text()
    try:
        if args.expected_bundle_sha256 != EXPECTED_BUNDLE or digest(args.bundle/"bundle.json") != EXPECTED_BUNDLE:
            raise ValueError("Unchanged source bundle identity differs")
        data = json.loads((args.bundle/"bundle.json").read_text())
        if data["baseImage"] != BASE or data["status"] != "EXPORTED_REQUIRES_RESTORE_AND_GPU_CHECKS":
            raise ValueError("Unexpected source runtime identity")
        interfaces = sorted(p.name for p in Path("/sys/class/net").iterdir())
        receipt["networkInterfaces"] = interfaces
        receipt["routeTable"] = Path("/proc/net/route").read_text()
        if interfaces != ["lo"]:
            raise ValueError("CPU control must disconnect container networking before this helper")
        debs = data["debs"]
        if len(debs) != len(data["osPackageDelta"]):
            raise ValueError("Captured OS closure accounting differs")
        paths = []
        for row in debs:
            path = args.bundle/row["path"]
            if path.is_symlink() or path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
                raise ValueError("Captured package bytes differ: "+row["path"])
            paths.append(str(path.resolve()))
        _,text,_ = run(["dpkg-query","-W","-f=${binary:Package}\t${Version}\t${Architecture}\n"],"installed-packages-before")
        before = package_map(text)
        for key,version in data["baseOsPackages"].items():
            if before.get(key) not in {version,data["installedOsPackages"][key]}:
                raise ValueError("Unexpected base package state: "+key)
        run(["apt-config","dump"],"apt-configuration")
        _,text,_ = run(["apt-config","shell","ARCHIVES","Dir::Cache::Archives/d"],"apt-archive-directory")
        assignments = shlex.split(text)
        if len(assignments)!=1 or assignments[0]!="ARCHIVES=/var/cache/apt/archives/":
            raise ValueError("Unexpected APT archive-cache directory")
        cache = Path("/var/cache/apt/archives")
        receipt["archiveCacheBefore"] = [{"name":p.name,"bytes":p.stat().st_size,"sha256":digest(p)} for p in sorted(cache.glob("*.deb")) if p.is_file()]
        _,text,_ = run(["apt-get","--simulate","--no-install-recommends","-o","Debug::pkgProblemResolver=true","-o","Debug::pkgDepCache::AutoInstall=true","install",*paths],"resolver-simulation")
        actions = parse_simulation(text,debs)
        expected = {key:version for key,version in data["osPackageDelta"].items() if before.get(key)!=version}
        if {row["package"]:row["version"] for row in actions} != expected:
            raise ValueError("APT install plan differs from exact captured target transaction")
        receipt["installPlan"] = actions
        _,text,_ = run(["apt-get","--print-uris","--download-only","--no-install-recommends","-y","install",*paths],"acquisition-uri-plan")
        uris = parse_uris(text,debs)
        if {row["package"]:row["version"] for row in uris} != expected:
            raise ValueError("APT URI plan differs from exact captured target transaction")
        receipt["acquisitionPlan"] = uris
        original_command = ["apt-get","--no-download","--no-install-recommends","-y","install",*paths]
        old,_,error = run(original_command,"original-offline-install-negative-control",(0,100))
        receipt["priorFailureReproducedWithoutInstallation"] = old["exitCode"]==100 and "Unable to fetch some archives" in error
        _,text,_ = run(["dpkg-query","-W","-f=${binary:Package}\t${Version}\t${Architecture}\n"],"installed-packages-after-negative-control")
        negative_after = package_map(text)
        receipt["packagesInstalledByThisHelper"] = negative_after != before
        if not receipt["priorFailureReproducedWithoutInstallation"]:
            receipt["nonReproduction"] = {"originalCommandExitCode":old["exitCode"],"packageStateChanged":negative_after != before,"cacheRemedyApplied":False,"causalFixClaimed":False}
            raise RuntimeError("Prior acquisition failure did not reproduce; no cache remedy applied")
        if negative_after!=before:
            raise ValueError("Failing original command unexpectedly changed package state")
        # Supplemental acquisition-only debug probe cannot install packages.
        probe = ["apt-get","--no-download","--download-only","--no-install-recommends","-y","-o","Debug::pkgAcquire=true","-o","Debug::pkgAcquire::Auth=true","install",*paths]
        run(probe,"no-download-acquisition-debug-negative-control",(100,))
        _,text,_ = run(["dpkg-query","-W","-f=${binary:Package}\t${Version}\t${Architecture}\n"],"installed-packages-after-probe")
        if package_map(text)!=before:
            raise ValueError("Read-only acquisition probe changed package state")
        staged = []
        for row in uris:
            target = cache/row["cacheFilename"]
            if target.exists() or target.is_symlink():
                if target.is_symlink() or target.stat().st_size!=row["bytes"] or digest(target)!=row["sha256"]:
                    raise ValueError("Existing cache entry has unexpected bytes; refusing overwrite")
                copied = False
            else:
                with (args.bundle/row["bundlePath"]).open("rb") as source, target.open("xb") as destination:
                    shutil.copyfileobj(source,destination,1024*1024)
                target.chmod(0o644)
                copied = True
            if target.stat().st_size!=row["bytes"] or digest(target)!=row["sha256"]:
                raise ValueError("Staged archive checksum differs")
            staged.append({"path":str(target),"sha256":row["sha256"],"bytes":row["bytes"],"copied":copied})
        receipt["stagedArchives"] = staged
        run(probe,"same-no-download-acquisition-after-cache-stage")
        _,text,_ = run(["dpkg-query","-W","-f=${binary:Package}\t${Version}\t${Architecture}\n"],"installed-packages-after-cache-stage")
        if package_map(text)!=before:
            raise ValueError("Cache staging/acquisition control installed or changed packages")
        receipt["status"] = "CAPTURED_ARCHIVES_STAGED_NO_DOWNLOAD_PROBE_PASSED"
        receipt["diagnosis"] = "Same exact-version acquisition failed before and passed after staging the identical captured bytes in APT's canonical cache, with networking disabled and no package-state changes. URI/debug logs distinguish chosen remote acquisition sources from supplied local alternatives."
    except BaseException as exc:
        receipt["failure"] = {"type":type(exc).__name__,"message":str(exc)}
        raise
    finally:
        receipt["completedAtUtc"] = now()
        (args.output/"cache-stage-receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
    print(json.dumps({"status":receipt["status"],"output":str(args.output)}))


if __name__=="__main__":
    main()
