#!/usr/bin/env python3
"""Detached, stop-only Runpod deadline guard. Python standard library only."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.runpod.io/v2/pods/"
MAX_CUMULATIVE_SECONDS = 11100.0
MIN_PREVIOUS_SECONDS = 7485.271
STOP_MARGIN_SECONDS = 60.0


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def epoch(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("UTC offset required")
    return parsed.timestamp()


def load_config(path):
    raw = Path(path).read_bytes()
    config = json.loads(raw)
    return validate_config(config, raw)


def validate_config(config, raw):
    if not re.fullmatch(r"[A-Za-z0-9_-]{5,80}", config["pod_id"]):
        raise ValueError("Invalid pod ID")
    prior = float(config["previous_gpu_seconds"])
    cap = float(config["approved_cumulative_gpu_seconds"])
    start = epoch(config["allocation_counted_from_utc"])
    hard = epoch(config["hard_deadline_utc"])
    if config.get("expected_created_at_utc"):
        epoch(config["expected_created_at_utc"])
    if not all(math.isfinite(n) for n in (prior, cap, start, hard)):
        raise ValueError("Nonfinite budget")
    if prior < MIN_PREVIOUS_SECONDS or not prior < cap <= MAX_CUMULATIVE_SECONDS:
        raise ValueError("Configuration exceeds recorded pilot authorization")
    if not 0 < hard - start <= cap - prior + 0.001:
        raise ValueError("Deadline exceeds remaining cumulative GPU allowance")
    config.update(hard_epoch=hard, stop_epoch=hard - STOP_MARGIN_SECONDS,
                  config_sha256=hashlib.sha256(raw).hexdigest())
    return config


def credential(path=None):
    if path:
        p = Path(path)
        info = p.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Credential must be a regular 0600 file")
        if info.st_uid != os.geteuid():
            raise ValueError("Credential must be owned by daemon user")
        key = p.read_text().strip()
    else:
        key = os.environ.get("RUNPOD_API_KEY", "").strip()
    if not key or any(ch.isspace() for ch in key):
        raise ValueError("Required Runpod credential unavailable or malformed")
    return key


def request_child():
    """Secret is supplied on stdin and never printed, even on provider errors."""
    request = json.load(sys.stdin)
    method, pod_id = request["method"], request["pod_id"]
    if method not in ("GET", "POST") or not re.fullmatch(r"[A-Za-z0-9_-]{5,80}", pod_id):
        raise ValueError("Only fixed GET/stop routes permitted")
    url = API + pod_id + ("/action" if method == "POST" else "")
    body = b'{"action":"stop"}' if method == "POST" else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": "Bearer " + request["key"],
        "Content-Type": "application/json", "User-Agent": "ConfoVHH-deadline-daemon-v1"})
    try:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with urllib.request.build_opener(NoRedirect).open(req, timeout=5) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("Oversized provider reply")
            payload = json.loads(raw)
            selected = {k: payload.get(k) for k in
                        ("id", "createdAt", "startedAt", "status", "actions", "locked", "cloud")}
            result = {"ok": True, "http_status": response.status, "pod": selected,
                      "response_sha256": hashlib.sha256(raw).hexdigest()}
    except urllib.error.HTTPError as exc:
        result = {"ok": False, "http_status": exc.code, "error_type": "HTTPError"}
    except Exception as exc:
        result = {"ok": False, "error_type": type(exc).__name__}
    print(json.dumps(result), flush=True)


def request_process(request, max_seconds, command=None):
    """A process wall deadline also bounds DNS/TLS hangs that urllib cannot."""
    child_env = dict(os.environ)
    child_env.pop("RUNPOD_API_KEY", None)
    command = command or [sys.executable, "-I", str(Path(__file__).resolve()), "_request"]
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, start_new_session=True, env=child_env)
    try:
        stdout, _ = child.communicate(json.dumps(request).encode(), timeout=max_seconds)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.communicate(timeout=2)
        return {"ok": False, "error_type": "REQUEST_WALL_TIMEOUT"}
    if child.returncode != 0:
        return {"ok": False, "error_type": "REQUEST_CHILD_FAILED"}
    try:
        return json.loads(stdout)
    except Exception:
        return {"ok": False, "error_type": "INVALID_CHILD_REPLY"}


class Provider:
    def __init__(self, pod_id, key):
        self.pod_id, self.key = pod_id, key

    def __call__(self, method, timeout):
        return request_process({"method": method, "pod_id": self.pod_id, "key": self.key}, timeout)


def identity(config, result):
    if not result.get("ok"):
        return False
    pod = result.get("pod", {})
    if pod.get("id") != config["pod_id"]:
        raise ValueError("Provider pod ID differs from configured identity")
    if config.get("expected_created_at_utc") and epoch(pod["createdAt"]) != epoch(config["expected_created_at_utc"]):
        raise ValueError("Provider creation time differs from configured identity")
    return True


def probe(config, provider):
    result = provider("GET", 8)
    if not identity(config, result):
        raise ValueError("Read-only credential/identity preflight failed")
    pod = result["pod"]
    if not config.get("expected_created_at_utc"):
        config["expected_created_at_utc"] = pod["createdAt"]
    if pod.get("locked"):
        raise ValueError("Pod is locked against stop")
    if pod["status"] not in ("EXITED", "TERMINATED") and "stop" not in (pod.get("actions") or []):
        raise ValueError("Provider does not currently advertise a stop transition")
    return result


def run_guard(config, provider, clock, sleep, emit, initial=None):
    initial = initial or probe(config, provider)
    emit({"event": "ARMED", "read_only_preflight": initial,
          "stop_permission_proven_by_read_only_probe": False,
          "hard_deadline_utc": config["hard_deadline_utc"],
          "stop_at_utc": stamp(config["stop_epoch"]), "pid": os.getpid()})
    if initial["pod"]["status"] in ("EXITED", "TERMINATED"):
        emit({"event": "CONFIRMED_NOT_RUNNING", "provider_status": initial["pod"]["status"]})
        return
    next_stop = config["stop_epoch"]
    while True:
        now = clock()
        if now >= next_stop:
            emit({"event": "STOP_REQUEST_BEGIN", "over_hard_deadline": now >= config["hard_epoch"]})
            result = provider("POST", 8)
            emit({"event": "STOP_REQUEST_RESULT", "result": result})
            next_stop = clock() + 5
            if identity(config, result) and result["pod"]["status"] in ("EXITED", "TERMINATED"):
                emit({"event": "CONFIRMED_NOT_RUNNING", "provider_status": result["pod"]["status"]})
                return
        remaining_to_stop = next_stop - clock()
        if remaining_to_stop <= 0:
            continue
        result = provider("GET", max(0.05, min(8, remaining_to_stop)))
        emit({"event": "STATE_READ", "result": result})
        if identity(config, result) and result["pod"]["status"] in ("EXITED", "TERMINATED"):
            emit({"event": "CONFIRMED_NOT_RUNNING", "provider_status": result["pod"]["status"]})
            return
        if result.get("http_status") == 404:
            emit({"event": "RESOURCE_NOT_FOUND_AFTER_VERIFIED_IDENTITY"})
            return
        sleep(max(0, min(30, next_stop - clock())))


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "_request":
        request_child()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("probe", "run", "launch"))
    parser.add_argument("--config", type=Path)
    parser.add_argument("--pod-id")
    parser.add_argument("--hard-deadline-utc")
    parser.add_argument("--expected-created-at-utc")
    parser.add_argument("--allocation-counted-from-utc")
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.config:
        if args.pod_id or args.hard_deadline_utc:
            parser.error("Use config or direct deadline flags, not both")
        config = load_config(args.config)
    else:
        if not args.pod_id or not args.hard_deadline_utc:
            parser.error("Config or both pod ID and hard deadline required")
        raw_config = {"pod_id": args.pod_id,
                      "expected_created_at_utc": args.expected_created_at_utc,
                      "hard_deadline_utc": args.hard_deadline_utc,
                      "previous_gpu_seconds": MIN_PREVIOUS_SECONDS,
                      "approved_cumulative_gpu_seconds": MAX_CUMULATIVE_SECONDS,
                      "allocation_counted_from_utc": args.allocation_counted_from_utc or
                      stamp(epoch(args.hard_deadline_utc) - (MAX_CUMULATIVE_SECONDS - MIN_PREVIOUS_SECONDS)),
                      "deadline_source": "Explicit coordinating-controller UTC deadline"}
        config = validate_config(raw_config, json.dumps(raw_config, sort_keys=True).encode())
    key = credential(args.key_file)
    provider = Provider(config["pod_id"], key)
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.mode == "launch":
        # Launch never reports armed merely because Popen returned a PID.
        # Save only nonsecret settings; direct CLI flags become an immutable config.
        launch_config = args.output / "launch-config.json"
        if launch_config.exists():
            raise ValueError("Refuse to replace an existing launch config")
        launch_config.write_text(json.dumps({k: v for k, v in config.items() if k not in
                                 ("hard_epoch", "stop_epoch", "config_sha256")}, indent=2) + "\n")
        launch_config_sha256 = hashlib.sha256(launch_config.read_bytes()).hexdigest()
        command = [sys.executable, "-I", str(Path(__file__).resolve()), "run", "--config",
                   str(launch_config.resolve()), "--output", str(args.output.resolve())]
        if args.key_file:
            command += ["--key-file", str(args.key_file.resolve())]
        with (args.output / "daemon-console.log").open("ab", buffering=0) as console:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=console,
                                       stderr=console, start_new_session=True, close_fds=True)
        value = {"event": "DETACHED_PROCESS_STARTED_NOT_YET_ARMED", "pid": process.pid,
                 "config_sha256": launch_config_sha256, "output": str(args.output.resolve())}
        (args.output / "launcher-receipt.json").write_text(json.dumps(value, indent=2) + "\n")
        print(json.dumps(value), flush=True)
        return
    journal = args.output / "events.jsonl"
    if journal.exists():
        raise ValueError("Refuse to replace an existing daemon journal")
    wall_anchor, monotonic_anchor = time.time(), time.monotonic()
    clock = lambda: max(time.time(), wall_anchor + time.monotonic() - monotonic_anchor)
    def emit(row):
        row.update(utc=stamp(clock()), pod_id=config["pod_id"], config_sha256=config["config_sha256"])
        try:
            with journal.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            if row["event"] == "ARMED":
                (args.output / "armed-receipt.json").write_text(json.dumps(row, indent=2) + "\n")
            elif row["event"] in ("CONFIRMED_NOT_RUNNING", "RESOURCE_NOT_FOUND_AFTER_VERIFIED_IDENTITY"):
                (args.output / "final-receipt.json").write_text(json.dumps(row, indent=2) + "\n")
        except OSError:
            # A full evidence disk must not disable the stop attempt.
            pass
    initial = probe(config, provider)
    if args.mode == "probe":
        emit({"event": "READ_ONLY_PREFLIGHT_PASS", "result": initial,
              "stop_permission_proven_by_read_only_probe": False})
    else:
        run_guard(config, provider, clock, time.sleep, emit, initial)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Deliberately omit exception text, request headers, response bodies and env.
        print(json.dumps({"event": "DAEMON_FAILED", "error_type": type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
