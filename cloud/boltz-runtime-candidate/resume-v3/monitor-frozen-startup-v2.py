#!/usr/bin/env python3
"""Approved startup monitor v2: twenty extra minutes; frozen runner unchanged."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import time
import traceback

FROZEN_SHA = '2865eea96212b3733687c2dd459bb5a48096a842e0d61361ea86617a1b0d9745'
IDS = [f'seed{s}_model_{m}' for s in (1, 2) for m in range(5)]


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def save(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write('\n')


def process_snapshot():
    result = {}
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            pid = int(p.name)
            status = (p / 'stat').read_text().rsplit(')', 1)[1].split()
            result[pid] = {'pid': pid, 'ppid': int(status[1]), 'pgid': int(status[2]),
                'start_ticks': int(status[19]), 'state': status[0],
                'argv': [x.decode(errors='replace') for x in (p / 'cmdline').read_bytes().split(b'\0') if x]}
        except (OSError, ValueError, IndexError):
            pass
    return result


def contains_sequence(argv, sequence):
    return any(argv[i:i + len(sequence)] == sequence for i in range(len(argv) - len(sequence) + 1))


def owned_processes(snapshot, wrapper_pid, runner, output, console):
    owned = {wrapper_pid}
    changed = True
    while changed:
        changed = False
        for pid, p in snapshot.items():
            if pid not in owned and p['ppid'] in owned:
                owned.add(pid)
                changed = True
    roles = {}
    for pid, p in snapshot.items():
        argv = p['argv']
        role = None
        if str(runner) in argv and str(output) in argv:
            role = 'generation-parent'
        for seed in (1, 2):
            if contains_sequence(argv, [str(console), 'predict', str(output / f'3P0G_seed{seed}.yaml')]):
                role = f'predictor-seed{seed}'
        if role:
            owned.add(pid)
        if pid in owned:
            roles[pid] = dict(p, role=role or ('wrapper' if pid == wrapper_pid else 'owned-child'))
    return roles


def inventory_artifact(path, output):
    if not path.is_file() or path.is_symlink():
        return None
    st = path.stat()
    h = sha(path)
    after = path.stat()
    if (st.st_size, st.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError('Artifact changed during final accounting: ' + str(path))
    return {'path': path.relative_to(output).as_posix(), 'bytes': after.st_size, 'sha256': h}


def administrative_ledger(output, execution_id, observed_seeds, stop_reason):
    source = output / 'generation-receipt.json'
    source_data = None
    notes = []
    if source.is_file():
        try:
            source_data = json.loads(source.read_text())
            rows = source_data.get('attempts', [])
            if len(rows) != 10 or sorted(x.get('id', '') for x in rows) != sorted(IDS):
                raise ValueError('Frozen receipt does not contain exactly all ten unique IDs')
        except (OSError, ValueError, TypeError) as exc:
            notes.append('Original generation receipt retained but unusable: ' + str(exc))
            source_data = None
    seed_rows = {}
    for seed in (1, 2):
        path = output / f'seed{seed}-receipt.json'
        if path.is_file():
            try:
                data = json.loads(path.read_text())
                rows = data['attempts']
                expected = [f'seed{seed}_model_{m}' for m in range(5)]
                if len(rows) != 5 or sorted(x['id'] for x in rows) != expected:
                    raise ValueError('Seed receipt IDs differ')
                seed_rows.update({r['id']: r for r in rows})
            except (OSError, ValueError, TypeError, KeyError) as exc:
                notes.append(f'Seed {seed} receipt retained but unusable: {exc}')
    final_rows = {r['id']: r for r in source_data['attempts']} if source_data else {}
    result = []
    for seed in (1, 2):
        for model in range(5):
            ident = f'seed{seed}_model_{model}'
            original = final_rows.get(ident) or seed_rows.get(ident)
            row = {'id': ident, 'seed': seed, 'modelFileIndex': model, 'executionId': execution_id,
                   'artifacts': {}, 'predictorProcessObserved': seed in observed_seeds}
            if original:
                row.update({'status': original.get('status', 'accounting-unresolved'),
                            'originalRecord': original,
                            'recordSource': 'generation-receipt.json' if ident in final_rows else f'seed{seed}-receipt.json'})
            elif not (output / f'3P0G_seed{seed}.yaml').exists() and seed not in observed_seeds:
                row.update(status='not-run', reason='No seed input was created; unchanged runner writes input before launching predictions')
            else:
                row.update(status='accounting-unresolved', reason='Seed may have launched, but no complete original attempt record survived')
            name = f'3P0G_seed{seed}'
            directory = output / 'raw' / f'boltz_results_{name}' / 'predictions' / name
            for role, filename in [('coordinate', f'{name}_model_{model}.cif'), ('confidence', f'confidence_{name}_model_{model}.json')]:
                artifact = inventory_artifact(directory / filename, output)
                if artifact:
                    row['artifacts'][role] = artifact
            if original:
                expected_artifacts = original.get('artifacts', {})
                mismatches = []
                for role in ('coordinate', 'confidence'):
                    expected, actual = expected_artifacts.get(role), row['artifacts'].get(role)
                    if bool(expected) != bool(actual) or (expected and actual and any(
                            expected.get(k) != actual.get(k) for k in ('path', 'bytes', 'sha256'))):
                        mismatches.append(role)
                if mismatches:
                    row.update(status='accounting-unresolved',
                        artifactMismatchesAgainstOriginalReceipt=mismatches,
                        reason='Current artifact inventory differs from preserved original attempt record')
            result.append(row)
    return {'schema': 'confovhh.external-attempt-ledger.v2', 'executionId': execution_id,
            'createdAtUtc': now(), 'originalReceiptsModified': False,
            'frozenRunnerReceiptComplete': source_data is not None,
            'originalGenerationReceiptSha256': sha(source) if source.is_file() else None,
            'stopReason': stop_reason, 'notes': notes, 'attempts': result,
            'limitations': 'Administrative reconciliation; unresolved records must not be silently accepted as complete scientific results.'}



def deadline_to_monotonic(value, utc_epoch=None, monotonic_now=None):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Deadline must include a timezone')
    utc_epoch = time.time() if utc_epoch is None else utc_epoch
    monotonic_now = time.monotonic() if monotonic_now is None else monotonic_now
    allowance = stamp.timestamp() - utc_epoch
    if allowance <= 0 or allowance > 4484.221:
        raise ValueError('Deadline must be within the currently remaining 4484.221 seconds')
    return monotonic_now + allowance, allowance


def signal_owned_group(pgid, sig, owned_groups, known_process_births, record, reason):
    """Signal only a proven live owned group; reject self/unowned/recycled IDs."""
    if pgid <= 1 or pgid == os.getpgrp() or pgid not in owned_groups:
        raise RuntimeError('Refusing unowned process group')
    current = process_snapshot()
    members = [p for p in current.values() if p['pgid'] == pgid]
    if not members:
        return False
    if not any(known_process_births.get(p['pid']) == p['start_ticks'] for p in members):
        record('skip-stale-or-unrecognized-group', pgid=pgid, reason=reason)
        return False
    try:
        os.killpg(pgid, sig)
        record('signal-process-group', pgid=pgid, signal=sig.name, reason=reason)
        return True
    except ProcessLookupError:
        return False


def wrapper_command(wrapper, execution_id, deadline_utc):
    return ['/bin/bash', str(wrapper), execution_id, deadline_utc]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--workspace', type=Path, default=Path('/workspace'))
    ap.add_argument('--execution-id', required=True)
    ap.add_argument('--python', type=Path, required=True)
    ap.add_argument('--wrapper', type=Path, required=True)
    ap.add_argument('--deadline-utc', required=True)
    args = ap.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', args.execution_id):
        ap.error('Unsafe execution ID')
    try:
        deadline, allowance = deadline_to_monotonic(args.deadline_utc)
    except ValueError as exc:
        ap.error(str(exc))
    root = args.workspace.absolute()
    execution = root / 'executions' / args.execution_id
    results = execution / 'runtime-results'
    output = execution / '3p0g-pilot-output'
    python = args.python.absolute()
    console = python.parent / 'boltz'
    runner = root / 'ConfoVHH/scripts/paper/run-single-case-generation.py'
    if sha(runner) != FROZEN_SHA:
        ap.error('Frozen generator SHA256 differs')
    if not args.wrapper.is_absolute() or not args.wrapper.is_file():
        ap.error('Wrapper must be an absolute existing file')
    if not python.is_file() or not console.is_file():
        ap.error('Selected venv is unavailable')
    if not results.is_dir() or output.exists():
        ap.error('New execution requires existing results directory and absent generation output')
    marker = results / 'controller-monitor-launch.json'
    if marker.exists():
        ap.error('Controller already launched; preserve this execution and use a new ID')
    started = time.monotonic()
    receipt = {'schema': 'confovhh.external-frozen-startup-monitor.v2', 'executionId': args.execution_id,
               'startedAtUtc': now(), 'generationDeadlineUtc': args.deadline_utc,
               'startingSecondsToDeadline': allowance, 'deadlineUsesMonotonicClock': True,
               'frozenRunnerSha256': FROZEN_SHA, 'frozenRunnerChanged': False,
               'python': str(python), 'console': str(console), 'wrapper': str(args.wrapper),
               'wrapperSha256': sha(args.wrapper), 'billingControlledHere': False,
               'wrapperArguments': [args.execution_id, args.deadline_utc],
               'status': 'RUNNING', 'actions': []}
    def record(event, **detail):
        row = {'atUtc': now(), 'event': event, **detail}
        receipt['actions'].append(row)
        with (results / 'controller-monitor-actions.jsonl').open('a') as f:
            f.write(json.dumps(row) + '\n'); f.flush(); os.fsync(f.fileno())
    wrapper = None
    owned_groups = set()
    known_process_births = {}
    observed_seeds = set()
    observed_receipts = set()
    signaled_groups = {}
    signaled_parents = set()
    stop_started = None
    stop_reason = None
    previous_roles = {}
    def signal_group(pgid, sig, reason):
        return signal_owned_group(pgid, sig, owned_groups, known_process_births, record, reason)
    def cleanup(reason):
        for pgid in sorted(owned_groups):
            signal_group(pgid, signal.SIGKILL, reason)
    try:
        with (results / 'controller-wrapper.stdout.log').open('xb') as out, (results / 'controller-wrapper.stderr.log').open('xb') as err:
            wrapper = subprocess.Popen(wrapper_command(args.wrapper, args.execution_id, args.deadline_utc), stdin=subprocess.DEVNULL,
                stdout=out, stderr=err, start_new_session=True)
        owned_groups.add(wrapper.pid)
        initial = process_snapshot().get(wrapper.pid)
        if initial:
            known_process_births[wrapper.pid] = initial['start_ticks']
        receipt['wrapperPID'] = wrapper.pid
        save(marker, {'executionId': args.execution_id, 'monitorPID': os.getpid(), 'wrapperPID': wrapper.pid,
             'startedAtUtc': now(), 'generationDeadlineUtc': args.deadline_utc,
             'wrapperSha256': receipt['wrapperSha256'], 'frozenRunnerSha256': FROZEN_SHA})
        while True:
            snapshot = process_snapshot()
            roles = owned_processes(snapshot, wrapper.pid, runner, output, console)
            for pid, p in roles.items():
                known_process_births[pid] = p['start_ticks']
                if p['pgid'] != os.getpgrp() and p['pgid'] > 1:
                    owned_groups.add(p['pgid'])
                if p['role'].startswith('predictor-seed'):
                    seed = int(p['role'][-1]); observed_seeds.add(seed)
                    if pid not in previous_roles:
                        record('predictor-process-observed', seed=seed, pid=pid, pgid=p['pgid'], argv=p['argv'])
            previous_roles = roles
            for seed in (1, 2):
                path = output / f'seed{seed}-receipt.json'
                if seed in observed_receipts or not path.is_file():
                    continue
                try:
                    data = json.loads(path.read_text())
                    run = data['run']; attempts = data['attempts']
                except (OSError, ValueError, KeyError):
                    continue
                observed_receipts.add(seed)
                failed = (run['exitCode'] != 0 or run['timedOut'] or len(attempts) != 5 or
                    any(r.get('status') != 'generated' or r.get('confidenceStatus') != 'present' for r in attempts))
                record('seed-receipt-observed', seed=seed, failure=failed, receiptSha256=sha(path))
                if failed and stop_started is None:
                    stop_started = time.monotonic(); stop_reason = 'seed-failed-or-required-artifact-missing'
                    record('stop-after-failure', seed=seed)
            if time.monotonic() >= deadline and stop_started is None:
                stop_started = time.monotonic(); stop_reason = 'external-workload-deadline'
                record('stop-at-deadline')
            if stop_started is not None:
                elapsed_stop = time.monotonic() - stop_started
                active_predictor_groups = {p['pgid'] for p in roles.values() if p['role'].startswith('predictor-seed')}
                for pgid in active_predictor_groups | set(signaled_groups):
                    last = signaled_groups.get(pgid)
                    if last is None:
                        sig = signal.SIGINT
                    elif elapsed_stop >= 15 and last != signal.SIGKILL:
                        sig = signal.SIGKILL
                    elif elapsed_stop >= 10 and last == signal.SIGINT:
                        sig = signal.SIGTERM
                    else:
                        continue
                    signal_group(pgid, sig, stop_reason); signaled_groups[pgid] = sig
                # Internal checker/JIT children can have their own sessions.
                # The wrapper/parent group is spared until its accounting window.
                if elapsed_stop >= 2 and not active_predictor_groups:
                    for pgid in owned_groups - {wrapper.pid} - set(signaled_groups):
                        signal_group(pgid, signal.SIGKILL, 'stop-owned-checker-or-descendant')
                if elapsed_stop >= 20 and not active_predictor_groups:
                    for pid, p in roles.items():
                        if p['role'] == 'generation-parent' and pid not in signaled_parents:
                            try:
                                os.kill(pid, signal.SIGINT); signaled_parents.add(pid)
                                record('signal-generation-parent', pid=pid, signal='SIGINT', reason=stop_reason)
                            except ProcessLookupError:
                                pass
                if elapsed_stop >= 45:
                    record('finalization-deadline-exhausted')
                    cleanup('bounded-finalization-exhausted')
                    break
            code = wrapper.poll()
            if code is not None:
                receipt['wrapperExitCode'] = code
                if code != 0 and stop_reason is None:
                    stop_reason = 'wrapper-or-gate-failed'
                cleanup('wrapper-ended-cleanup')
                break
            time.sleep(min(0.1, max(0.001, deadline - time.monotonic())) if stop_started is None else 0.1)
        if wrapper.poll() is None:
            try:
                receipt['wrapperExitCode'] = wrapper.wait(timeout=5)
            except subprocess.TimeoutExpired:
                receipt['wrapperReapFailed'] = True
        ledger = administrative_ledger(output, args.execution_id, observed_seeds, stop_reason)
        save(results / 'controller-attempt-ledger.json', ledger)
        good = (receipt.get('wrapperExitCode') == 0 and stop_reason is None and
                ledger['frozenRunnerReceiptComplete'] and all(r['status'] == 'generated' and
                set(r['artifacts']) == {'coordinate', 'confidence'} for r in ledger['attempts']))
        receipt['status'] = 'COMPLETE' if good else 'STOPPED_OR_FAILED'
        receipt['attemptRecordCount'] = 10
    except BaseException as error:
        receipt['status'] = 'MONITOR_FAILED'
        receipt['exceptionType'] = type(error).__name__
        receipt['exception'] = str(error)
        record('monitor-exception', exceptionType=type(error).__name__)
        cleanup('monitor-exception')
        (results / 'controller-exception.log').write_text(traceback.format_exc())
        path = results / 'controller-attempt-ledger.json'
        if not path.exists():
            try:
                save(path, administrative_ledger(output, args.execution_id, observed_seeds, 'monitor-exception'))
            except Exception as ledger_error:
                receipt['administrativeLedgerError'] = str(ledger_error)
    finally:
        receipt.update(completedAtUtc=now(), elapsedSeconds=time.monotonic() - started, stopReason=stop_reason)
        save(results / 'controller-monitor-receipt.json', receipt)
        print(json.dumps({k: v for k, v in receipt.items() if k != 'actions'}), flush=True)
    return 0 if receipt['status'] == 'COMPLETE' else 1


if __name__ == '__main__':
    raise SystemExit(main())
