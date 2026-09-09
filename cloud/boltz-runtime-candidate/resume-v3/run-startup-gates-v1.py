#!/usr/bin/env python3
"""Bounded operational launch of unchanged GPU checks; never launch predictions."""
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

CHECKERS = {
    'check-boltz-runtime.py': 'e0e329e1c531717307c561723b46e333f374d413ebdc7a415c30d0c8a424152a',
    'check-boltz-toolchain.py': '9ab433bbe35cbb3df042dff18aaad8719448bb55b160dd27f5d2d2d9f46d6ad4',
}


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    with Path(path).open('x') as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write('\n')


def snapshot():
    result = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            result[int(path.name)] = (int(fields[1]), int(fields[2]), int(fields[19]))
        except (OSError, ValueError, IndexError):
            pass
    return result


def track(root_pid, births, groups):
    processes = snapshot()
    owned = {pid for pid, (_, _, birth) in processes.items() if births.get(pid) == birth}
    if root_pid in processes and (root_pid not in births or births[root_pid] == processes[root_pid][2]):
        owned.add(root_pid)
    while True:
        expanded = owned | {pid for pid, (parent, _, _) in processes.items() if parent in owned}
        if expanded == owned:
            break
        owned = expanded
    for pid in owned:
        _, group, birth = processes[pid]
        births[pid] = birth
        if group > 1 and group != os.getpgrp():
            groups.add(group)
    return processes


def cleanup(root_pid, births, groups):
    actions = []
    until = time.monotonic() + 3
    while True:
        processes = track(root_pid, births, groups)
        live = {group for group in groups if any(p[1] == group and births.get(pid) == p[2]
                                                for pid, p in processes.items())}
        if not live:
            return actions
        for group in live:
            try:
                os.killpg(group, signal.SIGKILL)
                actions.append({'group': group, 'signal': 'SIGKILL', 'atUtc': now()})
            except ProcessLookupError:
                pass
        if time.monotonic() >= until:
            return actions
        time.sleep(0.05)


def run_command(args, directory, label, outer_seconds, deadline):
    allowance = min(outer_seconds, deadline - time.monotonic() - 5)
    if allowance <= 0:
        raise TimeoutError('Workload deadline leaves no safe checker time')
    start = time.monotonic()
    receipt = {'command': args, 'startedAtUtc': now(), 'outerTimeoutSeconds': allowance,
               'status': 'FAIL', 'predictionRequested': False}
    save(directory / (label + '.command.json'), receipt)
    env = {k: v for k, v in os.environ.items() if k not in ('PYTHONPATH', 'PYTHONHOME')}
    env.update(CC='/usr/bin/gcc', CXX='/usr/bin/g++', PYTHONNOUSERSITE='1',
               HF_HUB_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', WANDB_MODE='disabled')
    child = None
    births, groups = {}, set()
    try:
        with (directory / (label + '.stdout.log')).open('xb') as out, (directory / (label + '.stderr.log')).open('xb') as err:
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                     env=env, start_new_session=True)
            groups.add(child.pid)
            while True:
                track(child.pid, births, groups)
                code = child.poll()
                if code is not None:
                    receipt.update(exitCode=code, timedOut=False, status='PASS' if code == 0 else 'FAIL')
                    break
                if time.monotonic() - start >= allowance:
                    receipt.update(timedOut=True, status='TIMEOUT')
                    break
                time.sleep(0.05)
    finally:
        if child is not None:
            receipt['cleanupActions'] = cleanup(child.pid, births, groups)
            try:
                receipt['exitCode'] = child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                receipt.update(status='CLEANUP_FAILED', unreapedChild=True)
        receipt.update(completedAtUtc=now(), elapsedSeconds=time.monotonic() - start)
        for stream in ('stdout', 'stderr'):
            path = directory / (label + '.' + stream + '.log')
            if path.is_file():
                receipt[stream] = {'bytes': path.stat().st_size, 'sha256': sha(path)}
        save(directory / (label + '.receipt.json'), receipt)
    return receipt


def gate_blocked(execution_id, reason):
    return {'schema': 'confovhh.gate-blocked-execution.v1', 'executionId': execution_id,
            'createdAtUtc': now(), 'status': 'GATE_BLOCKED', 'reason': reason,
            'scientificRunnerInvoked': False, 'originalReceiptsModified': False,
            'plannedSlots': [{'id': f'seed{seed}_model_{model}', 'seed': seed, 'modelFileIndex': model,
                              'status': 'NOT_RUN', 'reason': 'Startup GPU gates did not both pass', 'artifacts': {}}
                             for seed in (1, 2) for model in range(5)]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--execution-id', required=True)
    ap.add_argument('--deadline-utc', required=True)
    args = ap.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', args.execution_id):
        ap.error('Unsafe execution ID')
    stamp = datetime.fromisoformat(args.deadline_utc.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        ap.error('Absolute deadline must include timezone')
    allowance = stamp.timestamp() - time.time()
    if not 0 < allowance <= 4484.221:
        ap.error('Deadline outside the approved remaining allowance')
    deadline = time.monotonic() + allowance
    execution = Path('/workspace/executions') / args.execution_id
    results = execution / 'runtime-results'
    if not results.is_dir() or results.is_symlink() or (execution / '3p0g-pilot-output').exists():
        ap.error('Fresh execution results and no prediction output required')
    directory = results / 'startup-gate-controller'
    directory.mkdir(mode=0o700, exist_ok=False)
    receipt = {'schema': 'confovhh.startup-gate-controller.v1', 'executionId': args.execution_id,
               'startedAtUtc': now(), 'deadlineUtc': args.deadline_utc, 'status': 'FAIL',
               'scientificRunnerInvoked': False, 'predictionRequested': False, 'checks': []}
    try:
        if any(p.exists() for p in (results / 'runtime-smoke.json', results / 'toolchain-jit', results / 'gate-blocked-execution.json')):
            raise ValueError('Prior checker evidence exists; never overwrite or reuse it')
        source = Path('/workspace/ConfoVHH/scripts/cloud')
        for name, expected in CHECKERS.items():
            path = source / name
            if path.is_symlink() or not path.is_file() or sha(path) != expected:
                raise ValueError('Unchanged checker integrity failed: ' + name)
        python = '/opt/confovhh-boltz/bin/python'
        commands = [
            ('runtime', [python, '-I', str(source / 'check-boltz-runtime.py'), '--lock',
                         '/workspace/ConfoVHH/cloud/boltz-runtime-candidate/requirements-linux-py311.lock',
                         '--output', str(results / 'runtime-smoke.json')], 180, results / 'runtime-smoke.json',
                         'confovhh.boltz-runtime-check.v1', 'runtime_gpu_smoke_only'),
            ('full-jit', [python, '-I', str(source / 'check-boltz-toolchain.py'), '--output',
                          str(results / 'toolchain-jit')], 240, results / 'toolchain-jit/receipt.json',
                          'confovhh.boltz-toolchain-check.v1', 'compiler_and_fresh_triton_jit'),
        ]
        for label, command, outer, original, schema, scope in commands:
            outcome = run_command(command, directory, label, outer, deadline)
            receipt['checks'].append({'label': label, **outcome})
            if outcome['status'] != 'PASS' or outcome.get('exitCode') != 0:
                raise RuntimeError(label + ' checker command failed or timed out')
            if original.is_symlink() or not original.is_file():
                raise ValueError(label + ' original receipt absent')
            data = json.loads(original.read_text())
            if data.get('schema') != schema or data.get('scope') != scope or data.get('status') != 'PASS' or data.get('failures') != []:
                raise ValueError(label + ' original receipt did not PASS')
            receipt['checks'][-1]['originalReceiptSha256'] = sha(original)
        receipt['status'] = 'BOTH_GPU_CHECKERS_PASSED_REQUIRES_FINAL_SOURCE_CACHE_RESTORE_GATES'
    except BaseException as error:
        receipt.update(errorType=type(error).__name__, error=str(error))
        blocked = results / 'gate-blocked-execution.json'
        if not blocked.exists():
            save(blocked, gate_blocked(args.execution_id, str(error)))
    finally:
        receipt['completedAtUtc'] = now()
        save(directory / 'receipt.json', receipt)
        print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'BOTH_GPU_CHECKERS_PASSED_REQUIRES_FINAL_SOURCE_CACHE_RESTORE_GATES' else 1


if __name__ == '__main__':
    raise SystemExit(main())
