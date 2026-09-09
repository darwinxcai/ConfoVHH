#!/usr/bin/env python3
"""Real Linux process-group smoke test, only toy Python/sleep processes.

Does not import Boltz, invoke the scientific runner, construct candidate records,
read model inputs, access cloud services, or request a GPU. Hard limit: 110 s
plus bounded cleanup; normal run takes less than ten seconds.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import select
import signal
import subprocess
import sys
import time
import traceback


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--monitor', type=Path,
        default=Path(__file__).with_name('monitor-frozen-v2.py'))
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    if platform.system() != 'Linux' or not Path('/proc/self/stat').is_file():
        ap.error('This smoke test requires a real Linux /proc filesystem')
    if args.output.exists() or args.output.is_symlink():
        ap.error('Use a new output directory to preserve previous evidence')
    args.output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location('controller_under_test', args.monitor)
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)
    receipt = {'schema': 'confovhh.linux-controller-processgroups-smoke.v1',
        'startedAtUtc': now(), 'status': 'RUNNING', 'monitorSha256': sha(args.monitor),
        'scriptSha256': sha(Path(__file__)), 'scientificRunnerInvoked': False,
        'predictionCommandsInvoked': False, 'cloudActionsTaken': False,
        'hardTimeoutSeconds': 110, 'tests': [], 'events': []}
    launched = []
    launcher = None
    known_groups = set()
    births = {}
    started = time.monotonic()
    def event(kind, **data):
        receipt['events'].append({'atUtc': now(), 'event': kind, **data})
    def alarm(_signal, _frame):
        raise TimeoutError('Linux controller smoke exceeded its 110-second hard limit')
    def active(p):
        return p is not None and p.get('state') not in ('Z', 'X')
    def wait_for(predicate, seconds=5):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            snapshot = monitor.process_snapshot()
            if predicate(snapshot):
                return snapshot
            time.sleep(0.05)
        raise AssertionError('Expected toy process state was not reached within bounded wait')
    def run_cli_case(name, deadline, expected_message):
        # Invalid deadlines must be rejected before any workspace/source access.
        command = [sys.executable, '-I', str(args.monitor.absolute()),
            '--execution-id', 'linux-controller-smoke', '--workspace', '/__nonexistent_smoke_workspace__',
            '--python', sys.executable, '--wrapper', '/__nonexistent_smoke_wrapper__.sh',
            '--deadline-utc', deadline]
        out = args.output / (name + '.stdout.log')
        err = args.output / (name + '.stderr.log')
        with out.open('xb') as stdout, err.open('xb') as stderr:
            result = subprocess.run(command, stdout=stdout, stderr=stderr,
                                    stdin=subprocess.DEVNULL, timeout=5, check=False)
        assert result.returncode == 2, (name, result.returncode)
        assert expected_message in err.read_text(), (name, err.read_text())
        receipt['tests'].append({'name': name, 'status': 'PASS', 'exitCode': result.returncode,
            'stdoutSha256': sha(out), 'stderrSha256': sha(err)})
    old_handler = signal.signal(signal.SIGALRM, alarm)
    signal.alarm(110)
    try:
        # Actual CLI behavior: no scientific source file is opened for these cases.
        run_cli_case('reject-over-3284-second-deadline',
            (datetime.now(timezone.utc) + timedelta(seconds=3290)).isoformat(), '3284.221')
        run_cli_case('reject-expired-deadline',
            (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), '3284.221')
        run_cli_case('reject-timezone-less-deadline',
            (datetime.now() + timedelta(seconds=30)).isoformat(), 'timezone')
        # Deterministic exact boundary and monotonic conversion, without clock jitter.
        start_epoch, mono = 0, 123.0
        upper = datetime.fromtimestamp(3284.221, timezone.utc).isoformat()
        converted, seconds = monitor.deadline_to_monotonic(upper, utc_epoch=start_epoch, monotonic_now=mono)
        assert abs(seconds - 3284.221) < 1e-9 and abs(converted - (mono + 3284.221)) < 1e-9
        for value in [3284.222, 0, -1]:
            try:
                monitor.deadline_to_monotonic(datetime.fromtimestamp(value, timezone.utc).isoformat(),
                                              utc_epoch=start_epoch, monotonic_now=mono)
            except ValueError:
                pass
            else:
                raise AssertionError('Invalid deadline boundary accepted')
        receipt['tests'].append({'name': 'exact-deadline-boundary-and-monotonic-conversion', 'status': 'PASS'})

        # Independent control process must survive every controller signal test.
        control = subprocess.Popen([sys.executable, '-I', '-c', 'import time; time.sleep(90)'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        launched.append(control)
        # Launcher owns A (its own group plus a sleeping descendant) and B (own group).
        child_code = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-I","-c","import time; time.sleep(90)"]); time.sleep(90)'
        launcher_code = '''import subprocess,sys,time,json,os
child_code = sys.argv[1]
a = subprocess.Popen([sys.executable,"-I","-c",child_code], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
b = subprocess.Popen([sys.executable,"-I","-c","import time; time.sleep(90)"], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(json.dumps({"launcher":os.getpid(),"a":a.pid,"b":b.pid}),flush=True)
time.sleep(90)
'''
        launcher = subprocess.Popen([sys.executable, '-I', '-u', '-c', launcher_code, child_code],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        launched.append(launcher)
        ready, _, _ = select.select([launcher.stdout], [], [], 5)
        assert ready, 'Toy launcher did not report its children'
        line = launcher.stdout.readline()
        (args.output / 'toy-launcher.stdout.log').write_bytes(line)
        pids = json.loads(line)
        assert pids['launcher'] == launcher.pid
        known_groups.update(pids.values())
        snapshot = wait_for(lambda s: all(pid in s for pid in [launcher.pid, control.pid, pids['a'], pids['b']])
                            and any(p['ppid'] == pids['a'] for p in s.values()))
        owned = monitor.owned_processes(snapshot, launcher.pid,
            Path('/__never_scientific_runner__'), Path('/__never_prediction_output__'), Path('/__never_boltz_console__'))
        assert launcher.pid in owned and pids['a'] in owned and pids['b'] in owned
        grandchildren = [p for p in owned.values() if p['ppid'] == pids['a']]
        assert grandchildren and all(p['pgid'] == pids['a'] for p in grandchildren)
        assert control.pid not in owned
        births.update({pid: p['start_ticks'] for pid, p in owned.items()})
        known_groups.update(p['pgid'] for p in owned.values())
        receipt['toyProcessIdentity'] = {'launcher': launcher.pid, 'a': pids['a'], 'b': pids['b'],
            'grandchildren': [p['pid'] for p in grandchildren], 'unrelatedControl': control.pid}
        receipt['tests'].append({'name': 'real-proc-ancestry-groups-and-unrelated-exclusion', 'status': 'PASS'})

        # Reject unowned and own monitor group before sending any signal.
        for group in [control.pid, os.getpgrp()]:
            try:
                monitor.signal_owned_group(group, signal.SIGKILL, known_groups, births, event, 'must-refuse')
            except RuntimeError:
                pass
            else:
                raise AssertionError('Unowned or monitor-own group was not rejected')
        assert control.poll() is None
        receipt['tests'].append({'name': 'unowned-and-self-groups-refused', 'status': 'PASS'})
        # A mismatched birth identity simulates PID reuse and must not signal A.
        false_births = {pid: ticks + 1 for pid, ticks in births.items()}
        result = monitor.signal_owned_group(pids['a'], signal.SIGKILL, known_groups,
                                           false_births, event, 'stale-birth-test')
        assert result is False and active(monitor.process_snapshot().get(pids['a']))
        receipt['tests'].append({'name': 'stale-process-birth-identity-refused', 'status': 'PASS'})

        assert monitor.signal_owned_group(pids['a'], signal.SIGKILL, known_groups, births, event, 'kill-owned-A')
        snapshot = wait_for(lambda s: not any(active(p) and p['pgid'] == pids['a'] for p in s.values()))
        assert active(snapshot.get(pids['b'])) and active(snapshot.get(launcher.pid)) and control.poll() is None
        receipt['tests'].append({'name': 'owned-group-A-and-grandchild-stopped-B-control-survive', 'status': 'PASS'})
        assert monitor.signal_owned_group(pids['b'], signal.SIGKILL, known_groups, births, event, 'kill-owned-B')
        snapshot = wait_for(lambda s: not active(s.get(pids['b'])))
        assert active(snapshot.get(launcher.pid)) and control.poll() is None
        assert monitor.signal_owned_group(launcher.pid, signal.SIGKILL, known_groups, births, event, 'kill-owned-launcher')
        launcher.wait(timeout=3)
        assert control.poll() is None
        receipt['tests'].append({'name': 'all-owned-groups-stopped-unrelated-control-survives', 'status': 'PASS'})
        receipt['status'] = 'PASS'
    except BaseException as exc:
        receipt['status'] = 'FAIL'
        receipt['error'] = {'type': type(exc).__name__, 'message': str(exc)}
        (args.output / 'failure.log').write_text(traceback.format_exc())
    finally:
        signal.alarm(0)
        # All test groups are disposable and were created solely by this test.
        # The unrelated control is explicitly cleaned up only after assertions.
        if launcher is not None:
            # Recover ownership even if a failure occurred before the ready-line
            # or before the normal /proc ownership snapshot completed.
            remaining_owned = monitor.owned_processes(monitor.process_snapshot(), launcher.pid,
                Path('/__never_scientific_runner__'), Path('/__never_prediction_output__'), Path('/__never_boltz_console__'))
            known_groups.update(p['pgid'] for p in remaining_owned.values())
        cleanup_groups = set(known_groups) | {p.pid for p in launched}
        for pgid in sorted(cleanup_groups):
            if pgid == os.getpgrp() or pgid <= 1:
                continue
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for process in launched:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                receipt['status'] = 'FAIL'
                receipt.setdefault('cleanupErrors', []).append({'pid': process.pid, 'error': 'Process did not reap'})
        if launcher is not None and launcher.poll() is not None:
            for stream, handle in [('stdout', launcher.stdout), ('stderr', launcher.stderr)]:
                if handle is not None:
                    remaining_raw = handle.read()
                    with (args.output / ('toy-launcher.' + stream + '.log')).open('ab') as f:
                        f.write(remaining_raw)
        signal.signal(signal.SIGALRM, old_handler)
        receipt['completedAtUtc'] = now()
        receipt['elapsedSeconds'] = time.monotonic() - started
        receipt['cleanupPerformed'] = True
        receipt['files'] = [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha(p)}
                            for p in sorted(args.output.iterdir()) if p.is_file()]
        with (args.output / 'receipt.json').open('x') as f:
            json.dump(receipt, f, indent=2, sort_keys=True); f.write('\n')
        print(json.dumps(receipt, indent=2))
    return 0 if receipt['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
