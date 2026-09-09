#!/usr/bin/env python3
"""Admit unchanged frozen inference only after this execution's restored GPU gates."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time

BASE = 'docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3'
BUNDLE_SHA = 'b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c'
ENVIRONMENT = '/opt/confovhh-boltz'
MAX_SECONDS = 3284.221
SOURCES = {
    'cloud/boltz-runtime-candidate/bootstrap-linux-py311.lock': '0c36241dd159935b274c1e2d24edc4d3c98e880fac6da444914736bd255d9956',
    'cloud/boltz-runtime-candidate/requirements-linux-py311.lock': '8f30f92bd06772f5bb86d0ce6e0e38daa8f4465fecdbd2bf11eeb23ddd19bb7a',
    'scripts/cloud/check-boltz-runtime.py': 'e0e329e1c531717307c561723b46e333f374d413ebdc7a415c30d0c8a424152a',
    'scripts/cloud/check-boltz-toolchain.py': '9ab433bbe35cbb3df042dff18aaad8719448bb55b160dd27f5d2d2d9f46d6ad4',
    'scripts/paper/run-single-case-generation.py': '2865eea96212b3733687c2dd459bb5a48096a842e0d61361ea86617a1b0d9745',
}
CACHE = {
    'boltz2_conf.ckpt': (2286561469, '090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1'),
    'boltz2_aff.ckpt': (2062139170, 'dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e'),
    'mols.tar': (1855662080, '39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7'),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read(path):
    require(path.is_file() and not path.is_symlink(), 'Required direct receipt absent: ' + str(path))
    return json.loads(path.read_text())


def remaining(value, current_epoch=None):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None, 'Deadline must include a timezone')
    seconds = stamp.timestamp() - (time.time() if current_epoch is None else current_epoch)
    require(0 < seconds <= MAX_SECONDS, 'Deadline must be within the remaining 3284.221-second cap')
    return seconds


def restored_gate(restore, base, base_sha):
    require(restore.get('schema') == 'confovhh.same-base-runtime-restore.v1', 'Restore schema differs')
    require(restore.get('status') == 'RESTORED_REQUIRES_ORIGINAL_RUNTIME_AND_FULL_GPU_JIT', 'Successful restore required')
    require(restore.get('bundleSha256') == BUNDLE_SHA, 'Restored bundle hash differs')
    require(restore.get('environmentVerifiedBeforeExecution') is True, 'Restored environment was not verified')
    require(restore.get('baseIdentityReceiptSha256') == base_sha, 'Restore is not bound to local base identity receipt')
    require(base.get('verified') is True and base.get('verifiedBaseImageRef') == BASE, 'Pinned live base identity required')


def runtime_gate(smoke):
    require(smoke.get('schema') == 'confovhh.boltz-runtime-check.v1', 'Original runtime receipt schema differs')
    require(smoke.get('status') == 'PASS' and smoke.get('scope') == 'runtime_gpu_smoke_only', 'Original runtime PASS required')
    require(smoke.get('failures') == [], 'Original runtime recorded failures')
    require(smoke.get('script_sha256') == SOURCES['scripts/cloud/check-boltz-runtime.py'], 'Original runtime checker identity differs')
    require(smoke['lock']['sha256'] == SOURCES['cloud/boltz-runtime-candidate/requirements-linux-py311.lock'], 'Runtime lock differs')
    runtime = smoke['runtime']
    require(runtime['python_executable'] == ENVIRONMENT + '/bin/python' and runtime['prefix'] == ENVIRONMENT,
            'Runtime check used a different environment')
    require(runtime['python_major_minor'] == [3, 11] and runtime['isolated_venv'] is True, 'Isolated Python 3.11 required')
    require(smoke['distributions']['matches_lock'] is True, 'Pinned distribution identities required')
    help_check = smoke['boltz_predict_help']
    require(help_check['status'] == 'PASS' and help_check['timeout_seconds'] == 60, 'Original 60-second CLI help PASS required')
    require(help_check['command'] == [ENVIRONMENT + '/bin/boltz', 'predict', '--help'], 'Help command differs')
    require(smoke['torch_cuda']['status'] == 'PASS' and smoke['torch_cuda']['matmul']['executed'] is True, 'Real GPU matrix PASS required')


def jit_gate(jit):
    require(jit.get('schema') == 'confovhh.boltz-toolchain-check.v1', 'Toolchain schema differs')
    require(jit.get('status') == 'PASS' and jit.get('scope') == 'compiler_and_fresh_triton_jit', 'Full GPU JIT PASS required')
    require(jit.get('failures') == [], 'Toolchain recorded failures')
    require(jit['compiler']['status'] == 'PASS' and jit['python_headers']['status'] == 'PASS', 'Compiler/header PASS required')
    require(jit['triton_jit']['status'] == 'PASS', 'Triton GPU JIT PASS required')
    result = jit['triton_jit']['result']
    require(result['status'] == 'PASS' and result['kernel_executed'] is True and result['cuda_synchronized'] is True,
            'Fresh CUDA kernel must execute and synchronize')
    require(result['non_block_multiple'] is True and result['fresh_cache_cubin_count'] > 0 and result['max_absolute_error'] == 0,
            'Fresh non-block-multiple GPU numerical JIT check required')
    require(jit['checker']['sha256'] == SOURCES['scripts/cloud/check-boltz-toolchain.py'], 'Toolchain checker identity differs')
    require(jit['runtime']['prefix'] == ENVIRONMENT, 'Toolchain check used a different environment')
    require(result['python_executable'] == ENVIRONMENT + '/bin/python', 'GPU JIT used a different interpreter')


def cache_gate(receipt, directory):
    require(receipt.get('status') == 'PASS', 'Frozen cache PASS required')
    require(receipt.get('revision') == '6fdef46d763fee7fbb83ca5501ccceff43b85607', 'Frozen cache revision differs')
    rows = receipt['files']
    require(len(rows) == 3 and {r['filename'] for r in rows} == set(CACHE), 'Cache receipt must list exactly three frozen files')
    for row in rows:
        size, digest = CACHE[row['filename']]
        require(row['bytes'] == size and row['sha256'] == digest and row['matchesFrozenManifest'] is True,
                'Cache receipt identity differs: ' + row['filename'])
        path = directory / row['filename']
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == size,
                'Frozen cache file absent or wrong size: ' + row['filename'])
        require(sha(path) == digest, 'Frozen cache file hash differs: ' + row['filename'])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('execution_id')
    ap.add_argument('deadline_utc')
    args = ap.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', args.execution_id):
        ap.error('Unsafe execution ID')
    remaining(args.deadline_utc)
    source = Path('/workspace/ConfoVHH')
    results = Path('/workspace/executions') / args.execution_id / 'runtime-results'
    require(results.is_dir() and not results.is_symlink(), 'Direct current execution results directory required')
    output = results / 'startup-gates-receipt.json'
    require(not output.exists(), 'Prior startup gate receipt exists; use a new execution ID')
    receipt = {'schema': 'confovhh.startup-gates.v1', 'executionId': args.execution_id,
               'deadlineUtc': args.deadline_utc, 'createdAtUtc': datetime.now(timezone.utc).isoformat(),
               'status': 'FAIL', 'predictionRequested': False, 'oldInstallExitAccepted': False,
               'python': ENVIRONMENT + '/bin/python', 'sourceSha256': {}, 'receiptSha256': {}}
    try:
        for name, digest in SOURCES.items():
            path = source / name
            require(path.is_file() and not path.is_symlink(), 'Required direct source absent: ' + name)
            receipt['sourceSha256'][name] = sha(path)
            require(receipt['sourceSha256'][name] == digest, 'Frozen source identity differs: ' + name)
        paths = {'restore': results / 'restore/restore-receipt.json',
                 'base': results / 'live-base-identity.json', 'runtime': results / 'runtime-smoke.json',
                 'jit': results / 'toolchain-jit/receipt.json', 'cache': results / 'cache-download-receipt.json'}
        data = {name: read(path) for name, path in paths.items()}
        receipt['receiptSha256'] = {name: sha(path) for name, path in paths.items()}
        restored_gate(data['restore'], data['base'], receipt['receiptSha256']['base'])
        runtime_gate(data['runtime'])
        jit_gate(data['jit'])
        cache_gate(data['cache'], Path('/workspace/boltz-cache'))
        receipt['secondsRemainingAtAdmission'] = remaining(args.deadline_utc)
        receipt.update(status='PASS', restore='PASS', originalRuntime='PASS', fullGpuJit='PASS',
                       frozenSourceIntegrity='PASS', frozenCacheBytes='PASS')
    except Exception as error:
        receipt.update(errorType=type(error).__name__, error=str(error))
    with output.open('x') as handle:
        json.dump(receipt, handle, indent=2, sort_keys=True)
        handle.write('\n')
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
