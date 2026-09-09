#!/usr/bin/env python3
"""Preserve a quiescent execution; never stop or terminate cloud resources."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import tarfile
import time

DEADLINE = None


def check_time():
    if DEADLINE is not None and time.monotonic() >= DEADLINE:
        raise TimeoutError('External preservation deadline reached; partial archive is not verified')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            check_time(); h.update(block)
    return h.hexdigest()


def record(path, root):
    before = path.stat()
    h = sha(path)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError('File changed while preserving: ' + str(path))
    return {'path': path.relative_to(root).as_posix(), 'bytes': after.st_size, 'sha256': h}


def save(path, data):
    with path.open('x') as f:
        json.dump(data, f, indent=2, sort_keys=True); f.write('\n')


def safe_relative(text):
    p = PurePosixPath(text)
    if p.is_absolute() or '..' in p.parts or str(p) != text:
        raise ValueError('Include paths must be normalized relative paths')
    return Path(text)


def workload_processes(workspace, execution, python):
    """Recognize exact script/console arguments in both /opt and legacy paths."""
    output = execution / '3p0g-pilot-output'
    forbidden = {str(workspace / p) for p in [
        'run-frozen.sh', 'install-runtime.sh', 'fetch-frozen-cache.py', 'monitor-frozen.py',
        'monitor-frozen-v2.py', 'restore-runtime.sh',
        'ConfoVHH/scripts/cloud/check-boltz-runtime.py',
        'ConfoVHH/scripts/cloud/check-boltz-toolchain.py',
        'ConfoVHH/scripts/paper/run-single-case-generation.py',
        'confovhh-boltz/bin/boltz']}
    forbidden |= {str(python.parent / 'boltz'),
        '/opt/confovhh-runtime/check-boltz-runtime.py', '/opt/confovhh-runtime/check-boltz-toolchain.py'}
    findings = []
    for p in Path('/proc').iterdir():
        if not p.name.isdigit() or int(p.name) == os.getpid():
            continue
        try:
            argv = [x.decode(errors='replace') for x in (p / 'cmdline').read_bytes().split(b'\0') if x]
        except OSError:
            continue
        exact_script = any(a in forbidden for a in argv)
        diagnostic = any(Path(a).name in {'diagnose-boltz-startup.py', 'boltz-runtime-bundle.py'} for a in argv if a.startswith('/'))
        execution_command = str(output) in argv or (str(execution.name) in argv and any(Path(a).name.startswith('monitor-frozen') for a in argv if a.startswith('/')))
        if exact_script or diagnostic or execution_command:
            findings.append({'pid': int(p.name), 'argv': argv})
    return findings


def main():
    global DEADLINE
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--workspace', type=Path, default=Path('/workspace'))
    ap.add_argument('--execution-id', required=True)
    ap.add_argument('--python', type=Path, required=True)
    ap.add_argument('--pod-id', required=True)
    ap.add_argument('--output-prefix', required=True)
    ap.add_argument('--deadline-utc', required=True)
    ap.add_argument('--include', action='append', default=[], help='Additional normalized relative file/tree to preserve')
    args = ap.parse_args()
    for name in [args.execution_id, args.output_prefix]:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name):
            ap.error('Unsafe execution ID or archive prefix')
    stamp = datetime.fromisoformat(args.deadline_utc.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp.timestamp() <= time.time():
        ap.error('Preservation deadline must be a future timezone-aware timestamp')
    DEADLINE = time.monotonic() + stamp.timestamp() - time.time()
    root = args.workspace.absolute()
    execution = root / 'executions' / args.execution_id
    if not execution.is_dir() or execution.is_symlink():
        ap.error('Execution tree missing or symlinked')
    archive = root / (args.output_prefix + '.tar.gz')
    manifest_path = root / (args.output_prefix + '-manifest.json')
    receipt_path = root / (args.output_prefix + '-receipt.json')
    failure_path = root / (args.output_prefix + '-failure.json')
    if any(p.exists() or p.is_symlink() for p in [archive, manifest_path, receipt_path, failure_path]):
        ap.error('Output already exists; use a new archive prefix')
    started = time.monotonic()
    receipt = {'schema': 'confovhh.execution-backup.v2', 'podId': args.pod_id,
               'executionId': args.execution_id, 'startedAtUtc': datetime.now(timezone.utc).isoformat(),
               'deadlineUtc': args.deadline_utc, 'status': 'PRESERVATION_IN_PROGRESS',
               'cloudActionTaken': False, 'localBackupVerified': False}
    try:
        active = workload_processes(root, execution, args.python.absolute())
        if active:
            receipt['activeWorkloadProcesses'] = active
            raise RuntimeError('Workload remains active; archive would not be quiescent')
        ledger = execution / 'runtime-results/controller-attempt-ledger.json'
        blocked = execution / 'runtime-results/gate-blocked-execution.json'
        if ledger.is_file():
            data = json.loads(ledger.read_text()); rows = data.get('attempts', [])
        elif blocked.is_file():
            data = json.loads(blocked.read_text()); rows = data.get('plannedSlots', [])
        else:
            raise RuntimeError('Ten-slot ledger or gate-blocked disposition is required before final preservation')
        expected_ids = sorted(f'seed{s}_model_{m}' for s in (1, 2) for m in range(5))
        if len(rows) != 10 or sorted(r.get('id', '') for r in rows) != expected_ids:
            raise RuntimeError('Exactly ten unique frozen slots must be accounted for')
        receipt['tenSlotRecordSha256'] = sha(ledger if ledger.is_file() else blocked)
        include = [execution.relative_to(root), Path('generation-inputs'), Path('ConfoVHH'),
                   Path('bootstrap-results'), Path('ConfoVHH_3P0G_generation_inputs_20260909.zip'),
                   Path('generation-only-runtime.tar.gz')]
        include.extend(safe_relative(p) for p in args.include)
        # Small controller/source/identity files at /workspace root are evidence.
        # Large environment/checkpoint payloads remain in independently verified bundles.
        suffixes = {'.py', '.sh', '.json', '.sha256', '.lock', '.md'}
        include.extend(p.relative_to(root) for p in root.iterdir()
                       if p.is_file() and not p.is_symlink() and p.suffix in suffixes
                       and p not in {archive, manifest_path, receipt_path, failure_path})
        files = {}
        for relative in include:
            check_time()
            p = root / relative
            if not p.exists():
                continue
            if p.is_symlink():
                raise ValueError('Symlink excluded from evidence policy: ' + str(p))
            candidates = sorted(p.rglob('*')) if p.is_dir() else [p]
            for f in candidates:
                check_time()
                if f.is_symlink():
                    raise ValueError('Symlink inside evidence tree: ' + str(f))
                if f.is_file():
                    row = record(f, root)
                    files[row['path']] = row
        active = workload_processes(root, execution, args.python.absolute())
        if active:
            receipt['activeWorkloadProcesses'] = active
            raise RuntimeError('Workload became active during inventory')
        manifest = {'schema': 'confovhh.execution-output-manifest.v2', 'podId': args.pod_id,
                    'executionId': args.execution_id, 'createdAtUtc': datetime.now(timezone.utc).isoformat(),
                    'files': list(files.values()), 'archive': archive.name,
                    'excludedReproduciblePayloads': ['Reusable environment bundle preserved separately by exact manifest checksum',
                                                   'Checkpoint/chemical payloads identified by verified frozen hashes and fixed URLs'],
                    'priorExecutions': 'Retained separately without modification'}
        save(manifest_path, manifest)
        with tarfile.open(archive, 'x:gz') as tf:
            for name in sorted(files):
                check_time()
                tf.add(root / name, arcname=name, recursive=False)
            tf.add(manifest_path, arcname=manifest_path.name, recursive=False)
        # Check every live source again, ensuring archive creation saw no mutation.
        for name, expected in files.items():
            if record(root / name, root) != expected:
                raise RuntimeError('Evidence changed while archiving: ' + name)
        expected = dict(files)
        expected[manifest_path.name] = record(manifest_path, root)
        with tarfile.open(archive, 'r:gz') as tf:
            members = tf.getmembers()
            if len(members) != len(expected) or {m.name for m in members} != set(expected):
                raise RuntimeError('Archive member inventory differs')
            for member in members:
                check_time()
                if not member.isfile():
                    raise ValueError('Non-file archive member')
                h, size = hashlib.sha256(), 0
                with tf.extractfile(member) as f:
                    for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
                        check_time(); h.update(block); size += len(block)
                if size != expected[member.name]['bytes'] or h.hexdigest() != expected[member.name]['sha256']:
                    raise RuntimeError('Archive member hash differs: ' + member.name)
        receipt.update(status='REMOTE_ARCHIVE_VERIFIED_REQUIRES_LOCAL_VERIFICATION',
                       archive=record(archive, root), manifest=record(manifest_path, root),
                       fileCount=len(files), onPodArchiveMemberVerification='PASS',
                       completedAtUtc=datetime.now(timezone.utc).isoformat(),
                       elapsedSeconds=time.monotonic() - started)
        save(receipt_path, receipt)
        print(json.dumps(receipt, indent=2))
    except BaseException as exc:
        receipt.update(status='PRESERVATION_FAILED', errorType=type(exc).__name__, error=str(exc),
                       completedAtUtc=datetime.now(timezone.utc).isoformat(), elapsedSeconds=time.monotonic() - started)
        save(failure_path, receipt)
        raise


if __name__ == '__main__':
    main()
