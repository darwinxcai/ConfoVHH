#!/usr/bin/env python3
"""Bounded source/input staging, frozen-cache fetch and offline /opt restoration.

Never runs runtime/JIT gates or predictions. The external cloud controller owns
billing and the cumulative allocation deadline. All outputs are new-only.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import math
import os
import signal
import subprocess
import tarfile
import time
import traceback
import zipfile

EXECUTION_ID = 'confovhh-3p0g-startup-recovery-20260909-01'
BASE = 'docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3'
SOURCE_COMMIT = '250350ab4b995e075edcb489c4f183e32b35efd6'
BUNDLE_SHA = 'b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c'
EXPECTED = {
    'generation-only-runtime.tar.gz': '9e38450099b4bd1cbba4018e96ecdd5a5257de2dadeac8528439464ed1f0b363',
    'ConfoVHH_3P0G_generation_inputs_20260909.zip': '044c90df183a4d015a24f0ea1ad415231f96377c4cfde14bd48ce981db2d5b0c',
    'runtime-bundle.tar': '4a2c2862c100ae1dc49a886b3533b6da23e80678a7323bc450b4946d0d98471f',
}
DEADLINE = None


def now():
    return datetime.now(timezone.utc).isoformat()


def remaining():
    value = DEADLINE - time.monotonic()
    if value <= 0:
        raise TimeoutError('Absolute preparation deadline reached')
    return value


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for data in iter(lambda: f.read(4 * 1024 * 1024), b''):
            remaining(); h.update(data)
    return h.hexdigest()


def raw_sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for data in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def save(path, data):
    with path.open('x') as f:
        json.dump(data, f, indent=2, sort_keys=True); f.write('\n')


def relative(value, required_top=None):
    clean = value.rstrip('/')
    p = PurePosixPath(clean)
    if p.is_absolute() or '..' in p.parts or not p.parts or str(p) != clean:
        raise ValueError('Unsafe archive/manifest path: ' + value)
    if required_top and p.parts[0] != required_top:
        raise ValueError('Unexpected archive top directory: ' + value)
    return Path(clean)


def extract_regular_tar(path, destination, top, expected_files=None):
    if (destination / top).exists() or (destination / top).is_symlink():
        raise ValueError('Refusing to overwrite extracted tree: ' + top)
    with tarfile.open(path, 'r:*') as tf:
        members = tf.getmembers()
        paths = [relative(m.name, top).as_posix() for m in members]
        if len(paths) != len(set(paths)):
            raise ValueError('Duplicate archive member')
        if any(not (m.isfile() or m.isdir()) for m in members):
            raise ValueError('Only regular files and directories are allowed in transport/source archives')
        regular_count = sum(m.isfile() for m in members)
        if expected_files is not None and regular_count != expected_files:
            raise ValueError('Archive regular-file count differs')
        for m, name in zip(members, paths):
            remaining()
            target = destination / name
            if any(p.is_symlink() for p in target.parents if p != destination.parent):
                raise ValueError('Symlink in extraction destination')
            if m.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tf.extractfile(m) as src, target.open('xb') as out:
                    while data := src.read(4 * 1024 * 1024):
                        remaining(); out.write(data)
        return regular_count


def proc_snapshot():
    data = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            stat = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            data[int(path.name)] = {'ppid': int(stat[1]), 'pgid': int(stat[2]), 'birth': int(stat[19])}
        except (OSError, ValueError, IndexError):
            pass
    return data


def deadline_from_utc(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Preparation deadline must include timezone')
    seconds = stamp.timestamp() - time.time()
    if not 0 < seconds <= 4484.221:
        raise ValueError('Preparation deadline must fit the approved 4484.221 seconds remaining')
    return time.monotonic() + seconds


def main():
    global DEADLINE
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pod-id', required=True)
    p.add_argument('--deadline-utc', required=True)
    p.add_argument('--workspace', type=Path, default=Path('/workspace'))
    p.add_argument('--compiler-cache-helper', type=Path, default=Path('/workspace/prepare-compiler-cache-v1.py'))
    p.add_argument('--bundle-helper', type=Path, default=Path('/workspace/boltz-runtime-bundle.py'))
    p.add_argument('--compiler-mapping', type=Path, default=Path('/workspace/compiler-cache-mapping-v1.json'))
    args = p.parse_args()
    try:
        DEADLINE = deadline_from_utc(args.deadline_utc)
    except ValueError as exc:
        p.error(str(exc))
    root = args.workspace.absolute()
    results = root / 'executions' / EXECUTION_ID / 'runtime-results'
    if results.exists() or os.path.lexists(root / 'runtime-results'):
        p.error('Preparation output/compatibility alias already exists; preserve prior execution')
    results.mkdir(parents=True, exist_ok=False)
    (root / 'runtime-results').symlink_to(results, target_is_directory=True)
    receipt = {'schema': 'confovhh.startup-runtime-preparation.v1', 'executionId': EXECUTION_ID,
        'podId': args.pod_id, 'startedAtUtc': now(), 'deadlineUtc': args.deadline_utc,
        'status': 'PREPARING', 'sourceCommit': SOURCE_COMMIT, 'baseImage': BASE,
        'runtimeOrGpuJitGateExecuted': False, 'predictionsLaunched': 0,
        'billingControlledHere': False, 'commands': [], 'actions': []}
    children = []
    known_births = {}
    owned_groups = set()
    def event(name, **data):
        row = {'atUtc': now(), 'event': name, **data}; receipt['actions'].append(row)
        with (results / 'preparation-actions.jsonl').open('a') as f:
            f.write(json.dumps(row) + '\n'); f.flush()
    def track():
        snap = proc_snapshot(); owned = {c['process'].pid for c in children if c['process'].poll() is None}
        changed = True
        while changed:
            changed = False
            for pid, item in snap.items():
                if item['ppid'] in owned and pid not in owned:
                    owned.add(pid); changed = True
        for pid in owned:
            if pid in snap:
                known_births[pid] = snap[pid]['birth']; owned_groups.add(snap[pid]['pgid'])
        return snap
    def stop_children(reason):
        snap = track()
        for pgid in sorted(owned_groups):
            if pgid <= 1 or pgid == os.getpgrp():
                continue
            if not any(x['pgid'] == pgid and known_births.get(pid) == x['birth'] for pid, x in snap.items()):
                continue
            try:
                os.killpg(pgid, signal.SIGKILL); event('stop-owned-group', pgid=pgid, reason=reason)
            except ProcessLookupError:
                pass
        for child in children:
            try:
                child['process'].wait(timeout=3)
            except subprocess.TimeoutExpired:
                event('child-reap-timeout', pid=child['process'].pid)
    def start(name, argv):
        remaining()
        stdout, stderr = results / (name + '.stdout.log'), results / (name + '.stderr.log')
        with stdout.open('xb') as out, stderr.open('xb') as err:
            process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                env={k: v for k, v in dict(os.environ, CC='/usr/bin/gcc', CXX='/usr/bin/g++').items() if k not in {'PYTHONPATH', 'PYTHONHOME'}},
                start_new_session=True)
        item = {'name': name, 'command': argv, 'pid': process.pid, 'startedAtUtc': now(), 'stdout': stdout.name, 'stderr': stderr.name}
        receipt['commands'].append(item)
        children.append({'process': process, 'record': item})
        owned_groups.add(process.pid)
        snap = proc_snapshot()
        if process.pid in snap:
            known_births[process.pid] = snap[process.pid]['birth']
        event('child-start', **item)
        return process
    def wait_for(primary):
        while True:
            remaining(); track()
            for child in children:
                code = child['process'].poll()
                row = child['record']
                if code is not None and 'exitCode' not in row:
                    row.update(exitCode=code, finishedAtUtc=now()); event('child-exit', name=row['name'], exitCode=code)
                if code is not None and code != 0:
                    raise RuntimeError(f"Preparation child {row['name']} failed with exit {code}; no next stage")
            if primary.poll() is not None:
                return
            time.sleep(min(0.2, remaining()))
    old_handlers = {}
    def abort(signum, _frame):
        raise TimeoutError('Preparation interrupted by signal ' + str(signum))
    try:
        for sig in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT):
            old_handlers[sig] = signal.signal(sig, abort)
        signal.alarm(max(1, math.ceil(remaining())))
        launch = json.loads((root / 'launch-manifest.json').read_text())
        if launch.get('executionId') != EXECUTION_ID:
            raise ValueError('Launch manifest execution ID differs')
        computed_hashes = {}
        for name, item in launch['files'].items():
            path = root / relative(name)
            if path.is_symlink() or path.stat().st_size != item['bytes']:
                raise ValueError('Launch manifest file differs: ' + name)
            computed_hashes[name] = sha(path)
            if computed_hashes[name] != item['sha256']:
                raise ValueError('Launch manifest file differs: ' + name)
        # Every executable helper and mapping must be bound by the manifest.
        for path in [Path(__file__).absolute(), args.compiler_cache_helper, args.bundle_helper, args.compiler_mapping, root / 'fetch-frozen-cache.py']:
            if path.relative_to(root).as_posix() not in launch['files']:
                raise ValueError('Preparation helper/mapping absent from launch manifest: ' + str(path))
        for name, expected in EXPECTED.items():
            observed = computed_hashes[name] if name in computed_hashes else sha(root / name)
            if observed != expected:
                raise ValueError('Frozen archive identity differs: ' + name)
        live = json.loads((root / 'live-base-identity.json').read_text())
        if live.get('verified') is not True or live.get('verifiedBaseImageRef') != BASE or live.get('podId') != args.pod_id:
            raise ValueError('Provider-verified live base receipt missing or for another pod')
        (results / 'live-base-identity.json').write_bytes((root / 'live-base-identity.json').read_bytes())
        save(results / 'launch-manifest.json', launch)
        source_files = extract_regular_tar(root / 'generation-only-runtime.tar.gz', root, 'ConfoVHH')
        if (root / 'generation-inputs').exists():
            raise ValueError('Generation inputs already exist')
        with zipfile.ZipFile(root / 'ConfoVHH_3P0G_generation_inputs_20260909.zip') as z:
            members = z.infolist(); paths = [relative(m.filename, 'generation-inputs') for m in members]
            if len({str(x) for x in paths}) != len(paths) or any(m.is_dir() for m in members):
                raise ValueError('Input ZIP inventory differs')
            for item, path in zip(members, paths):
                target = root / path; target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(item) as src, target.open('xb') as out:
                    while block := src.read(4 * 1024 * 1024):
                        remaining(); out.write(block)
        inputs = root / 'generation-inputs'
        if sha(inputs / 'manifest.json') != '1a236f8141f281c0da04979fc182461c8c68cf76d20795b00f44b3ceb1e0bc82':
            raise ValueError('Frozen input manifest differs')
        input_manifest = json.loads((inputs / 'manifest.json').read_text())
        if {p.relative_to(inputs).as_posix() for p in inputs.rglob('*') if p.is_file()} != set(input_manifest['files']) | {'manifest.json'}:
            raise ValueError('Generation input file set differs')
        for name, item in input_manifest['files'].items():
            path = inputs / relative(name)
            if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
                raise ValueError('Frozen input differs: ' + name)
        source = json.loads((root / 'ConfoVHH/source-subset-receipt.json').read_text())
        if source['commit'] != SOURCE_COMMIT:
            raise ValueError('Frozen source commit differs')
        for name, item in source['files'].items():
            path = root / 'ConfoVHH' / relative(name)
            if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
                raise ValueError('Frozen source differs: ' + name)
        transport_files = extract_regular_tar(root / 'runtime-bundle.tar', root, 'reusable', expected_files=206)
        if sha(root / 'reusable/bundle.json') != BUNDLE_SHA:
            raise ValueError('Reusable bundle manifest differs')
        save(results / 'remote-input-verification.json', {'verifiedAtUtc': now(), 'executionId': EXECUTION_ID,
            'sourceCommit': SOURCE_COMMIT, 'sourceFiles': source_files, 'transportRegularFiles': transport_files,
            'bundleManifestSha256': BUNDLE_SHA, 'archives': EXPECTED, 'generationInputsVerified': True,
            'sourceFilesVerified': True, 'referenceCoordinatesProvided': False, 'predictionsLaunched': 0})
        cache = start('frozen-cache-download', ['/opt/conda/bin/python', '-I', str(root / 'fetch-frozen-cache.py')])
        cache_stage = start('compiler-cache-stage', ['/opt/conda/bin/python', '-I', str(args.compiler_cache_helper),
            '--bundle', str(root / 'reusable'), '--mapping', str(args.compiler_mapping), '--output', str(results / 'compiler-cache')])
        wait_for(cache_stage)
        cache_receipt = json.loads((results / 'compiler-cache/receipt.json').read_text())
        if cache_receipt['status'] != 'VERIFIED_COMPILER_ARCHIVES_STAGED':
            raise ValueError('Compiler cache staging receipt did not succeed')
        restore = start('offline-runtime-restore', ['/opt/conda/bin/python', '-I', str(args.bundle_helper),
            'restore', '--max-seconds', str(max(1, min(660, int(remaining())))), '--bundle', str(root / 'reusable'),
            '--expected-bundle-sha256', BUNDLE_SHA, '--base-identity-receipt', str(results / 'live-base-identity.json'),
            '--output', str(results / 'restore')])
        wait_for(restore); wait_for(cache)
        restored = json.loads((results / 'restore/restore-receipt.json').read_text())
        downloaded = json.loads((results / 'cache-download-receipt.json').read_text())
        if restored['status'] != 'RESTORED_REQUIRES_ORIGINAL_RUNTIME_AND_FULL_GPU_JIT' or not restored['environmentVerifiedBeforeExecution']:
            raise ValueError('Offline environment restoration did not verify')
        if downloaded['status'] != 'PASS':
            raise ValueError('Frozen cache download did not verify')
        receipt['status'] = 'PREPARATION_COMPLETE_REQUIRES_BOTH_GPU_GATES'
        receipt['restoreReceiptSha256'] = sha(results / 'restore/restore-receipt.json')
        receipt['cacheReceiptSha256'] = sha(results / 'cache-download-receipt.json')
    except BaseException as exc:
        receipt.update(status='PREPARATION_FAILED', errorType=type(exc).__name__, error=str(exc))
        signal.alarm(0)
        stop_children('preparation-failure-or-deadline')
        (results / 'preparation-error.log').write_text(traceback.format_exc())
        save(results / 'gate-blocked-execution.json', {
            'schema': 'confovhh.preparation-blocked-execution.v1', 'executionId': EXECUTION_ID,
            'podId': args.pod_id, 'createdAtUtc': now(), 'status': 'STOPPED_BEFORE_GPU_GATES_AND_INFERENCE',
            'generationRunnerLaunched': False, 'modelInferenceRuns': 0, 'runtimeGate': 'NOT_RUN',
            'fullGpuJitGate': 'NOT_RUN', 'reason': receipt['error'],
            'plannedSlots': [{'id': f'seed{seed}_model_{model}', 'executionId': EXECUTION_ID,
                'status': 'not-run', 'reason': 'Runtime preparation failed before either GPU gate or inference',
                'coordinate': None, 'predictorConfidence': None, 'DockQ': None}
                for seed in (1, 2) for model in range(5)]})
    finally:
        signal.alarm(0)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        for child in children:
            row = child['record']; row.setdefault('exitCode', child['process'].poll())
            for stream in ('stdout', 'stderr'):
                path = results / row[stream]
                row[stream + 'Bytes'] = path.stat().st_size
                row[stream + 'Sha256'] = raw_sha(path)
        receipt['completedAtUtc'] = now()
        save(results / 'preparation-receipt.json', receipt)
        print(json.dumps(receipt, indent=2), flush=True)
    return 0 if receipt['status'] == 'PREPARATION_COMPLETE_REQUIRES_BOTH_GPU_GATES' else 1


if __name__ == '__main__':
    raise SystemExit(main())
