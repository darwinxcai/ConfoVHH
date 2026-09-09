#!/usr/bin/env python3
"""Stage the unchanged, CPU-proven compiler archives; installs nothing.

This production helper does not repeat negative controls or disable SSH.
The unchanged bundle restorer subsequently installs with --no-download.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

BUNDLE_SHA = 'b2ea93126a22099ba7861dbd4822b29e075739c028f47934eebb98db6e6caa3c'
MAPPING_SHA = '181ff9b1f7e4fdf7093d1b85eea5b72a4702ef42014e5f473722096f0539b7b6'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def regular_under(root, relative):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe relative path')
    candidate = root / path
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError('Archive must be a regular file: ' + str(path))
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError('Archive escaped bundle')
    return candidate


def verified_plan(bundle, mapping_path):
    if sha(bundle / 'bundle.json') != BUNDLE_SHA or sha(mapping_path) != MAPPING_SHA:
        raise ValueError('Independent bundle/mapping identity mismatch')
    manifest = json.loads((bundle / 'bundle.json').read_text())
    mapping = json.loads(mapping_path.read_text())
    if mapping['bundleManifestSha256'] != BUNDLE_SHA:
        raise ValueError('Mapping is for another bundle')
    source = {item['path']: item for item in manifest['debs']}
    items = mapping['archives']
    if len(source) != 45 or len(items) != 45 or {x['bundlePath'] for x in items} != set(source):
        raise ValueError('Incomplete or duplicated compiler closure')
    if len({x['cacheFilename'] for x in items}) != 45:
        raise ValueError('Duplicate cache target')
    plan = []
    for item in items:
        name = item['cacheFilename']
        if Path(name).name != name or not name.endswith('.deb'):
            raise ValueError('Unsafe cache filename')
        origin = source[item['bundlePath']]
        for field in ('bytes', 'sha256', 'package', 'version'):
            if item[field] != origin[field]:
                raise ValueError('Mapping differs from compiler manifest')
        path = regular_under(bundle, item['bundlePath'])
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('Compiler archive identity mismatch: ' + name)
        plan.append((path, item))
    return plan


def stage_verified(plan, cache):
    if cache.is_symlink() or not cache.is_dir() or cache.resolve() != cache.absolute():
        raise ValueError('APT cache must be an existing directory without symlink parents')
    # Refuse a conflicting cache before copying any archive.
    for _, item in plan:
        target = cache / item['cacheFilename']
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_file() or sha(target) != item['sha256']:
                raise ValueError('Conflicting existing APT cache entry: ' + target.name)
    staged = []
    for source, item in plan:
        target = cache / item['cacheFilename']
        copied = not target.exists()
        if copied:
            with target.open('xb') as out, source.open('rb') as inp:
                shutil.copyfileobj(inp, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())
            target.chmod(0o644)
        if target.stat().st_size != item['bytes'] or sha(target) != item['sha256']:
            raise ValueError('Staged archive verification failed: ' + target.name)
        staged.append(dict(item, path=str(target), copied=copied))
    return staged


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--bundle', type=Path, required=True)
    p.add_argument('--mapping', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    receipt = {'schema': 'confovhh.production-compiler-cache.v1',
               'status': 'STARTED', 'startedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'bundleManifestSha256': BUNDLE_SHA, 'mappingSha256': MAPPING_SHA,
               'packagesInstalledByThisHelper': False, 'networkDownloadsRequested': False,
               'negativeControlRepeated': False, 'networkConfigurationChanged': False}
    try:
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise ValueError('Run only as root on the pinned Linux target')
        plan = verified_plan(args.bundle, args.mapping)
        proc = subprocess.run(['apt-config', 'shell', 'ARCHIVES', 'Dir::Cache::Archives/d'],
                              capture_output=True, timeout=10)
        (args.output / 'apt-cache-path.stdout.log').write_bytes(proc.stdout)
        (args.output / 'apt-cache-path.stderr.log').write_bytes(proc.stderr)
        if proc.returncode != 0 or proc.stdout.decode().strip() != "ARCHIVES='/var/cache/apt/archives/'":
            raise ValueError('APT cache configuration differs from the verified CPU target')
        receipt['archives'] = stage_verified(plan, Path('/var/cache/apt/archives'))
        receipt['status'] = 'VERIFIED_COMPILER_ARCHIVES_STAGED'
    except BaseException as exc:
        receipt.update(status='FAIL', error=repr(exc))
        raise
    finally:
        receipt['completedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
