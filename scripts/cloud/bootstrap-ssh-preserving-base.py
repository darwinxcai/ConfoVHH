#!/usr/bin/env python3
"""Bounded SSH preparation that refuses changes to installed base packages.

CPU control uses prepare-only default. A live pod may use --serve and a
previously verified package plan; no credential/token is required by apt.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time


def now():
    return datetime.now(timezone.utc).isoformat()


def packages(raw):
    result = {}
    for line in raw.decode().splitlines():
        name, version, architecture = line.split("\t")
        result[name] = {"version": version, "architecture": architecture}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-seconds", type=int, default=240)
    parser.add_argument("--package-plan", type=Path)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0 or not 30 <= args.max_seconds <= 600:
        parser.error("root and a 30..600-second deadline are required")
    args.output.mkdir(parents=True, exist_ok=False)
    deadline = time.monotonic() + args.max_seconds
    receipt = {"schema": "confovhh.base-preserving-ssh-bootstrap.v1", "status": "FAIL", "startedAtUtc": now(), "requestedPackages": ["openssh-server"], "basePackageUpgradesPermitted": False, "serveRequested": args.serve, "commands": []}
    def run(command, label, data=None, rollback=False):
        timeout = 15 if rollback else deadline-time.monotonic()
        if timeout <= 0:
            raise TimeoutError("SSH preparation deadline exhausted")
        row = {"command": command, "timeoutSeconds": timeout, "startedAtUtc": now()}
        out = args.output / (label + ".stdout.log")
        err = args.output / (label + ".stderr.log")
        with out.open("xb") as stdout, err.open("xb") as stderr:
            child = subprocess.Popen(command, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True, env=dict(os.environ, DEBIAN_FRONTEND="noninteractive"))
            try:
                child.communicate(input=data, timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.communicate(timeout=5)
                row["timedOut"] = True
        row["exitCode"] = child.returncode
        row["finishedAtUtc"] = now()
        for kind, path in (("stdout", out), ("stderr", err)):
            raw = path.read_bytes()
            row[kind] = {"path": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        receipt["commands"].append(row)
        if child.returncode != 0 or row.get("timedOut"):
            raise RuntimeError(label + " failed; raw logs preserved")
        return out.read_bytes()
    selection = None
    try:
        before = packages(run(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"], "packages-before"))
        receipt["basePackagesBefore"] = before
        selection = run(["dpkg", "--get-selections"], "package-selections-before")
        expected_plan = None
        requested = ["openssh-server"]
        if args.package_plan:
            plan = json.loads(args.package_plan.read_text())
            expected_plan = plan["addedPackages"]
            if "openssh-server" not in expected_plan:
                raise ValueError("Verified SSH plan must include openssh-server")
            requested = []
            for name, row in sorted(expected_plan.items()):
                if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?", name) or not re.fullmatch(r"[0-9A-Za-z.+:~_-]+", row["version"]):
                    raise ValueError("Invalid package plan identity")
                requested.append(name + "=" + row["version"])
            receipt["packagePlanSha256"] = hashlib.sha256(args.package_plan.read_bytes()).hexdigest()
        receipt["requestedPackages"] = requested
        run(["apt-mark", "hold", *sorted(before)], "hold-installed-base-packages")
        run(["apt-get", "update"], "apt-index-refresh")
        run(["apt-get", "install", "-y", "--no-install-recommends", "--no-upgrade", *requested], "minimal-ssh-install")
        after = packages(run(["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${Architecture}\n"], "packages-after"))
        changed = {name: {"before": row, "after": after.get(name)} for name, row in before.items() if after.get(name) != row}
        receipt["basePackageChanges"] = changed
        if changed:
            raise ValueError("SSH preparation changed installed base package identity")
        added = {name: row for name, row in after.items() if name not in before}
        if expected_plan is not None and added != expected_plan:
            raise ValueError("SSH package closure differs from the verified CPU plan")
        receipt["addedPackages"] = added
        (args.output / "ssh-package-plan.json").write_text(json.dumps({"schema": "confovhh.base-preserving-ssh-package-plan.v1", "addedPackages": added}, indent=2)+"\n")
        Path("/run/sshd").mkdir(parents=True, exist_ok=True)
        run(["ssh-keygen", "-A"], "host-key-generation")
        run(["/usr/sbin/sshd", "-t", "-o", "PasswordAuthentication=no", "-o", "PermitRootLogin=prohibit-password", "-o", "PubkeyAuthentication=yes"], "sshd-configuration-check")
        if args.serve:
            key = os.environ.get("PILOT_SSH_PUBLIC_KEY", "").strip()
            if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?", key):
                raise ValueError("Expected one explicit Ed25519 public key")
            ssh = Path("/root/.ssh")
            ssh.mkdir(mode=0o700, parents=True, exist_ok=True)
            ssh.chmod(0o700)
            authorized = ssh / "authorized_keys"
            if authorized.exists() or authorized.is_symlink():
                raise ValueError("Refusing to overwrite existing authorized keys")
            authorized.write_text(key+"\n")
            authorized.chmod(0o600)
        receipt["status"] = "BASE_PRESERVED_SSH_PREPARED"
    except BaseException as exc:
        receipt["failure"] = {"type": type(exc).__name__, "message": str(exc)}
        raise
    finally:
        if selection is not None:
            try:
                run(["dpkg", "--set-selections"], "restore-original-package-selections", selection, rollback=True)
                receipt["originalPackageSelectionsRestored"] = True
            except Exception as exc:
                receipt["status"] = "FAIL"
                receipt["selectionRestoreFailure"] = {"type": type(exc).__name__, "message": str(exc)}
        receipt["completedAtUtc"] = now()
        (args.output / "bootstrap-receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
    if receipt["status"] != "BASE_PRESERVED_SSH_PREPARED":
        raise RuntimeError("SSH preparation or original package selection restoration failed")
    print(json.dumps({"status": receipt["status"], "output": str(args.output)}), flush=True)
    if args.serve:
        os.execv("/usr/sbin/sshd", ["/usr/sbin/sshd", "-D", "-e", "-o", "PasswordAuthentication=no", "-o", "PermitRootLogin=prohibit-password", "-o", "PubkeyAuthentication=yes", "-o", "AuthorizedKeysFile=/root/.ssh/authorized_keys"])


if __name__ == "__main__":
    main()
