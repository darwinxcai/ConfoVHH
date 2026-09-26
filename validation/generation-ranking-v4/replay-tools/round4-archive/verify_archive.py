"""Hash-check a fresh extraction and replay its scientific evidence in isolation."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile
import zipfile
import archive_common as c

NODE = '/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'

# The audit hook blocks Python access to original scientific artifacts and
# network/subprocess escape. The only child is a Node permission-mode wrapper,
# whose filesystem access is restricted to the fresh extraction.
BOOTSTRAP = r'''
import os,pathlib,runpy,sys
sys.dont_write_bytecode=True
original=pathlib.Path(sys.argv[1]).resolve()
script=pathlib.Path(sys.argv[2]).resolve()
extracted=script.parents[1]
runtime=pathlib.Path(sys.prefix).resolve()
node=pathlib.Path(os.environ['CONFOVHH_NODE_BINARY']).resolve()
def audit(event,args):
    if event.startswith('socket.'):
        raise PermissionError('Network access forbidden during archive replay')
    if event=='subprocess.Popen':
        executable=pathlib.Path(os.fsdecode(args[0])).resolve()
        if executable!=node:
            raise PermissionError('Uncontrolled subprocess forbidden; only filesystem-guarded Node is permitted')
        argv=args[1]
        if not isinstance(argv,(list,tuple)) or len(argv)<2 or pathlib.Path(os.fsdecode(argv[0])).resolve()!=node:
            raise PermissionError('Node invocation shape forbidden')
        values=[os.fsdecode(v) for v in argv[1:]]
        if values!=['--version']:
            target=pathlib.Path(values[0])
            if not target.is_absolute() or target.resolve()!=target or not target.is_relative_to(extracted) or target.suffix!='.mjs' or not target.is_file():
                raise PermissionError('Node must execute a direct extracted mjs script')
        blocked=('--allow-','--permission','--no-permission','--require','--import','--eval','--experimental-loader','--loader')
        if any(v.startswith(blocked) or v in ('-r','-e','-p','--print') for v in values):
            raise PermissionError('Node permission or executable injection option forbidden')
        environment=args[3] if args[3] is not None else os.environ
        if environment.get('NODE_OPTIONS') or environment.get('NODE_PATH'):
            raise PermissionError('Node environment injection forbidden')
    if event in ('os.system','os.posix_spawn','os.exec','os.fork','os.forkpty'):
        raise PermissionError('Uncontrolled process launch forbidden during archive replay')
    if event not in ('open','os.listdir','os.scandir'):return
    value=args[0] if args else None
    if value is None:value=os.getcwd()
    if isinstance(value,int):return
    candidate=pathlib.Path(os.fsdecode(value)).resolve()
    if candidate.is_relative_to(original) and not candidate.is_relative_to(runtime):
        raise PermissionError('Original scientific artifact access forbidden during archive replay')
sys.addaudithook(audit)
sys.path.insert(0,str(script.parent))
sys.argv=[str(script),*sys.argv[3:]]
runpy.run_path(str(script),run_name='__main__')
'''


def archive_members(z):
    entries = z.infolist(); names = [e.filename for e in entries]
    c.check(len(names) == len(set(names)) == len({x.casefold() for x in names}), 'Duplicate/colliding archive member')
    c.check(len(names) <= 250000, 'Archive member budget exceeded')
    for e in entries:
        c.safe_relative(e.filename)
        c.check(not e.is_dir() and stat.S_IFMT(e.external_attr >> 16) in (0, stat.S_IFREG), 'Symlink/special archive member')
        c.check(not e.flag_bits & 1, 'Encrypted archive member unsupported')
    return entries


def extract_verified(archive, destination, receipt):
    c.check(destination.resolve() == destination and destination.is_dir() and not any(destination.iterdir()), 'Extraction must use empty direct directory')
    with zipfile.ZipFile(archive) as z:
        entries = archive_members(z); names = {e.filename for e in entries}
        c.check(c.MANIFEST_NAME in names, 'Manifest absent')
        raw = z.read(c.MANIFEST_NAME)
        c.check(hashlib.sha256(raw).hexdigest() == receipt['manifestSha256'], 'Manifest hash differs')
        m = c.strict(raw)
        c.check(m['schema'] == 'confovhh-round4-evidence-manifest-v1', 'Wrong manifest schema')
        files = m['files']; base = m['basePayloadFiles']
        c.check(type(files) is dict and type(base) is dict and base, 'Invalid payload inventory')
        c.check(names == set(files) | {c.MANIFEST_NAME}, 'Manifest membership differs')
        c.check(all(type(v) is int and v >= 0 for v in [m['payloadFileCount'], receipt['payloadFileCount'], m['payloadBytes'], receipt['payloadBytes']]), 'Invalid payload count/size types')
        c.check(m['payloadFileCount'] == receipt['payloadFileCount'] == len(files), 'Payload count differs')
        total = sum(v['bytes'] for v in files.values())
        c.check(type(total) is int and total <= 200*1024**3 and m['payloadBytes'] == receipt['payloadBytes'] == total, 'Payload size differs/budget exceeded')
        c.check(m['baseArchive']['sha256'] == receipt['baseArchiveSha256'] == c.BASE_SHA, 'Base identity differs')
        c.check(m['baseArchive']['path'] == c.BASE_NAME and m['finalArtifactMap'] == receipt['finalArtifactMap'], 'Base/map binding differs')
        base_digest = hashlib.sha256(c.packed(base)).hexdigest()
        c.check(base_digest == m['basePayloadInventorySha256'] == receipt['basePayloadInventorySha256'], 'Base payload inventory differs')
        for name, b in files.items():
            c.binding_shape({'path': name, **b}); c.check(set(b) == {'bytes', 'sha256'}, 'Extra inventory fields')
        for name, b in base.items():
            c.check(files.get(name) == b, 'Historical payload omitted or changed')
        selected = m['selectedSourceSnapshot']
        c.check(type(selected) is dict and all(files.get(n) == b for n, b in selected.items()), 'Selected snapshot differs from payload')
        c.check(set(files) == set(base) | set(selected), 'Payload contains unselected additions')
        for e in entries:
            expected = files.get(e.filename)
            if expected is not None: c.check(e.file_size == expected['bytes'], 'ZIP declared size differs')
            dest = destination / e.filename; dest.parent.mkdir(parents=True, exist_ok=True)
            c.check(dest.parent.resolve() == dest.parent and not dest.exists(), 'Extraction path collision')
            h = hashlib.sha256(); count = 0
            with z.open(e) as source, dest.open('xb') as output:
                for block in iter(lambda: source.read(1024*1024), b''):
                    count += len(block); c.check(count <= e.file_size, 'Expanded ZIP member exceeds declaration')
                    output.write(block); h.update(block)
            if expected is not None: c.check(count == expected['bytes'] and h.hexdigest() == expected['sha256'], 'Extracted bytes differ')
    for name, b in files.items(): c.bound(destination, {'path': name, **b}, files)
    final_map = c.load(c.bound(destination, m['finalArtifactMap'], files))
    c.validate_final_map(destination, final_map, files); c.phase_receipts(destination, final_map, files)
    return m, final_map


def compare_original_base(base_archive, manifest):
    """Original base ZIP is checked by the outer verifier, never a replay input."""
    c.check(c.sha(base_archive) == c.BASE_SHA, 'Original full v3 archive differs')
    expected = manifest['basePayloadFiles']
    with zipfile.ZipFile(base_archive) as z:
        entries = archive_members(z)
        c.check({e.filename for e in entries} == set(expected), 'Original base payload roster differs')
        for e in entries:
            with z.open(e) as f: actual = hashlib.file_digest(f, 'sha256').hexdigest()
            c.check(e.file_size == expected[e.filename]['bytes'] and actual == expected[e.filename]['sha256'], 'Original base member bytes differ')


def node_wrapper(destination, executable):
    folder = destination / '.archive-replay-runtime'; folder.mkdir()
    path = folder / 'node-guarded'
    text = '''#!/bin/sh
set -eu
root=''' + shlex.quote(str(destination)) + '''
case "${1-}" in
  --version) [ "$#" -eq 1 ] || exit 97 ;;
  "$root"/*.mjs) [ -f "$1" ] && [ ! -L "$1" ] || exit 97 ;;
  *) echo 'Node invocation forbidden' >&2; exit 97 ;;
esac
for value in "$@"; do
  case "$value" in
    --allow-*|--permission*|--no-permission*|--require*|--import*|--eval*|--experimental-loader*|--loader*|-r|-e|-p|--print)
      echo 'Node option override forbidden' >&2; exit 97 ;;
  esac
done
[ -z "${NODE_OPTIONS-}${NODE_PATH-}" ] || exit 97
exec ''' + shlex.quote(str(executable)) + ' --permission --allow-fs-read=' + shlex.quote(str(destination)) + ' --allow-fs-write=' + shlex.quote(str(destination)) + ' "$@"\n'
    path.write_text(text); path.chmod(0o700)
    return path


def isolated_environment(destination, guarded_node):
    home = destination / '.archive-replay-runtime/home'; home.mkdir()
    tmp = destination / '.archive-replay-runtime/tmp'; tmp.mkdir()
    return {'PATH': '/usr/bin:/bin', 'HOME': str(home), 'TMPDIR': str(tmp), 'LC_ALL': 'C',
            'PYTHONDONTWRITEBYTECODE': '1', 'CONFOVHH_NODE_BINARY': str(guarded_node)}


def verify(root, python, node):
    root = root.resolve(); receipt = c.load(c.regular(root, 'round4-archive-receipt.json'))
    c.check(receipt['schema'] == 'confovhh-round4-archive-receipt-v1', 'Wrong archive receipt')
    archive = c.bound(root, receipt['archive'])
    destination = Path(tempfile.mkdtemp(prefix='confovhh-round4-verified-')).resolve() / 'execution-20260924'
    destination.mkdir(); manifest, final_map = extract_verified(archive, destination, receipt)
    proofs = c.public_msa_proofs(destination, final_map); replayed_scan = {}; replayed_synthetic = {}
    for name, identity in manifest['selectedSourceSnapshot'].items():
        scanned = c.scan_file(c.regular(destination, name), identity, proofs)
        if scanned['formatAwarePublicMsa']: replayed_scan[name] = scanned
        if 'reviewedSyntheticCredentialFixture' in scanned: replayed_synthetic[name] = scanned
    c.bound(destination, manifest['metadataScan']['scanner'], manifest['files'])
    c.check(replayed_scan == manifest['metadataScan']['formatAwareMembers'], 'Public MSA credential-scan provenance did not replay')
    c.check(replayed_synthetic == manifest['metadataScan']['reviewedSyntheticCredentialFixtures'],
            'Reviewed synthetic credential-fixture provenance did not replay')
    # This optional comparison is available on the builder host. The portable
    # archive also retains the complete per-member historical payload proof.
    base = root / c.BASE_NAME; base_compared = base.is_file()
    if base_compared: compare_original_base(base, manifest)
    python = Path(python).absolute(); node = Path(node).resolve()
    c.check(python.is_file() and node.is_file(), 'Explicit Python/Node runtime unavailable')
    guarded_node = node_wrapper(destination, node); env = isolated_environment(destination, guarded_node)
    script = c.regular(destination, 'round4-archive/replay_science.py')
    command = [str(python), '-I', '-B', '-c', BOOTSTRAP, str(root), str(script), '--output', str(destination/'fresh-archive-replay.json')]
    log = root / 'round4-archive-replay.log'
    with log.open('x') as f:
        subprocess.run(command, cwd=destination, env=env, stdout=f, stderr=subprocess.STDOUT, check=True)
    replay = c.load(c.regular(destination, 'fresh-archive-replay.json'))
    c.check(replay['status'] == 'PASS' and replay['numericalDockQRecomputed'] is False, 'Unexpected scientific replay scope')
    # Read-only replay must not silently rewrite any archived scientific input.
    for name, b in manifest['files'].items(): c.bound(destination, {'path': name, **b}, manifest['files'])
    result = {'schema': 'confovhh-round4-fresh-archive-verification-v1', 'status': 'PASS',
        'completedUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'archive': receipt['archive'],
        'extractedRoot': str(destination), 'payloadFileCount': len(manifest['files']),
        'allExtractedHashesVerifiedBeforeAndAfterReplay': True, 'basePayloadBytePreserved': True,
        'newFileCredentialScanAndPublicMsaProvenanceReplayed': True,
        'originalBaseArchiveIndependentlyCompared': base_compared, 'originalScientificInputsUsed': False,
        'pythonOriginalArtifactReadGuard': True, 'pythonNetworkAndChildLaunchGuard': True,
        'nodeFilesystemPermissionGuard': True, 'isolatedPython': True, 'cleanEnvironment': True,
        'runtime': {'python': str(python), 'node': str(node), 'scope': 'Installed pinned runtime dependencies reused; scientific files only from fresh extraction'},
        'replay': replay, 'replaySha256': c.sha(destination/'fresh-archive-replay.json'),
        'verifier': c.binding(root, Path(__file__).resolve())}
    with (root/'round4-archive-verification.json').open('xb') as f: f.write(c.packed(result))
    print(c.packed({'status': 'PASS', 'extractedRoot': str(destination), 'payloadFileCount': len(manifest['files'])}).decode(), end='')
    return result


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--artifacts', type=Path, default=c.ROOT)
    ap.add_argument('--python', type=Path, default=c.ROOT/'.venv/bin/python')
    ap.add_argument('--node', type=Path, default=Path(NODE))
    args = ap.parse_args(); verify(args.artifacts, args.python, args.node)
