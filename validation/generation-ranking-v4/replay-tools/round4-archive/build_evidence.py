"""Append the finite round4 evidence to the byte-preserved full v3 payload."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
from pathlib import Path
import stat
import zipfile
import archive_common as c


def stream_member(source, archive, name, expected=None):
    digest = hashlib.sha256(); size = 0
    with archive.open(name, 'w', force_zip64=True) as dest:
        for block in iter(lambda: source.read(1024*1024), b''):
            dest.write(block); digest.update(block); size += len(block)
    result = {'bytes': size, 'sha256': digest.hexdigest()}
    c.check(expected is None or result == expected, 'Bytes changed while copying: ' + name)
    return result


def copy_base(base, archive):
    records = {}; folded = set()
    with zipfile.ZipFile(base) as old:
        for entry in old.infolist():
            c.safe_relative(entry.filename)
            c.check(not entry.is_dir() and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), 'Nonregular historical archive member')
            c.check(entry.filename not in records and entry.filename.casefold() not in folded, 'Duplicate/colliding historical member')
            folded.add(entry.filename.casefold())
            with old.open(entry) as f:
                records[entry.filename] = stream_member(f, archive, entry.filename)
    return records


def build(root, output):
    root = root.resolve(); output = output.resolve()
    c.check(root == c.ROOT and output.parent == root and not output.exists(), 'Archive output must be a new root-level file')
    c.check(output.name not in c.TOP_FILES and output.suffix == '.zip', 'Unexpected archive output filename')
    final_map_path = c.regular(root, c.MAP_NAME); final_map = c.load(final_map_path)
    c.validate_final_map(root, final_map); c.phase_receipts(root, final_map)
    base = c.bound(root, final_map['baseArchive'])
    items, omitted = c.selected(root); before = c.snapshot(items)
    proofs = c.public_msa_proofs(root, final_map); scan_records = {}; synthetic_records = {}
    # The historical base was previously published and is accepted only by exact SHA.
    # Every newly selected file (binary as well as text) is scanned without echoing bytes.
    for name, path in sorted(items.items()):
        result = c.scan_file(path, before[name], proofs)
        if result['formatAwarePublicMsa']: scan_records[name] = result
        if 'reviewedSyntheticCredentialFixture' in result: synthetic_records[name] = result
    part = output.with_name(output.name + '.part')
    c.check(not part.exists(), 'Prior partial archive retained; inspect it before retrying')
    with zipfile.ZipFile(part, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                         allowZip64=True, strict_timestamps=False) as archive:
        base_records = copy_base(base, archive); records = dict(base_records); folded = {x.casefold() for x in records}
        c.check(c.MANIFEST_NAME not in records, 'Historical payload collides with new manifest')
        for name, path in sorted(items.items()):
            c.safe_relative(name)
            if name in records:
                c.check(before[name] == records[name], 'Historical scientific evidence changed: ' + name)
                continue
            c.check(name.casefold() not in folded, 'Case-insensitive member collision'); folded.add(name.casefold())
            c.check({'bytes': path.stat().st_size, 'sha256': c.sha(path)} == before[name], 'Selected file changed before copy')
            with path.open('rb') as f:
                records[name] = stream_member(f, archive, name, before[name])
        manifest = {'schema': 'confovhh-round4-evidence-manifest-v1',
            'createdUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'baseArchive': final_map['baseArchive'],
            'basePayloadFiles': base_records, 'basePayloadInventorySha256': hashlib.sha256(c.packed(base_records)).hexdigest(),
            'finalArtifactMap': c.binding(root, final_map_path), 'payloadFileCount': len(records),
            'payloadBytes': sum(x['bytes'] for x in records.values()), 'files': records,
            'selectedSourceSnapshot': before, 'excludedFiles': omitted,
            'metadataScan': {'scanner': c.binding(root, Path(c.__file__).resolve()), 'formatAwareMembers': scan_records,
                'reviewedSyntheticCredentialFixtures': synthetic_records,
                'policy': 'Metadata-bound public MSA sequence fields may omit ambiguous AWS-ID matching; headers/other fields and other credential patterns remain checked. One exact SHA-bound reviewed test source may retain its sole known all-A dummy key identifier. Both exception rosters replay from fresh extracted bytes. All other new file bytes receive the generic scan.'},
            'payloadPolicy': 'Unchanged full v3 member bytes plus all selected finite round4 scientific trees. Keys/private backups/caches/partials/redundant transport archives/portable environment excluded. Original public MSA server replies retained when capture receipts bind them.',
            'replayScope': 'Source/contact features and ranks, raw/canonical integrity, fixed sequence correspondence, saved DockQ aggregation, generation comparison, independent model-fit evidence, final selection and reserved summary. Numerical production DockQ is not recomputed.'}
        archive.writestr(c.MANIFEST_NAME, c.packed(manifest))
    c.unchanged(root, before)
    c.check(c.sha(base) == c.BASE_SHA, 'Historical archive changed during assembly')
    part.rename(output)
    receipt = {'schema': 'confovhh-round4-archive-receipt-v1', 'archive': c.binding(root, output),
        'manifestSha256': hashlib.sha256(c.packed(manifest)).hexdigest(), 'baseArchiveSha256': c.BASE_SHA,
        'basePayloadInventorySha256': manifest['basePayloadInventorySha256'], 'payloadFileCount': len(records),
        'payloadBytes': manifest['payloadBytes'], 'finalArtifactMap': manifest['finalArtifactMap'],
        'builder': c.binding(root, Path(__file__).resolve()), 'freshReplayComplete': False}
    target = root / 'round4-archive-receipt.json'
    with target.open('xb') as f: f.write(c.packed(receipt))
    print(c.packed(receipt).decode(), end='')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=c.ROOT)
    parser.add_argument('--output', type=Path, default=c.ROOT/'confovhh-source-first-ranking-v4.zip')
    args = parser.parse_args(); build(args.artifacts, args.output)
