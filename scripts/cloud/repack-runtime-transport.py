#!/usr/bin/env python3
"""Repack an already verified bundle into connector-sized transport artifacts.

No environment installation, source mutation, registry publication or prediction.
The source bundle is kept unchanged. Each 480 MiB part fits below the connector's
512 MiB ZIP limit with room for ZIP headers.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tarfile
import time

PART_BYTES = 480 * 1024 * 1024
MAX_PARTS = 10
STORAGE_CEILING = 12 * 1024 * 1024 * 1024


def repack(bundle, expected, output, metadata, source_artifacts, evidence, max_seconds):
    deadline = time.monotonic() + max_seconds
    def check():
        if time.monotonic() >= deadline:
            raise TimeoutError("Transport repacking deadline reached")
    def sha(path):
        h = hashlib.sha256()
        with path.open("rb") as original:
            while block := original.read(1024 * 1024):
                check()
                h.update(block)
        return h.hexdigest()
    if sha(bundle / "bundle.json") != expected:
        raise ValueError("Original manifest identity differs")
    original = json.loads((bundle / "bundle.json").read_text())
    if original.get("schema") != "confovhh.same-base-runtime-bundle.v1" or original.get("status") != "EXPORTED_REQUIRES_RESTORE_AND_GPU_CHECKS":
        raise ValueError("Source is not a completed reusable bundle")
    output.mkdir(parents=True, exist_ok=False)
    metadata.parent.mkdir(parents=True, exist_ok=True)
    archive = output / "runtime-bundle.tar"
    record = {"schema": "confovhh.runtime-bundle-transport.v1", "status": "FAIL", "startedAtUtc": datetime.now(timezone.utc).isoformat(), "originalBundleManifestSha256": expected, "sourceRunId": 34398379988, "sourceCommit": "257945495d8382702f2305a56e56ae662c628ef1", "sourceRuntimeArtifactId": 10122737648, "predictionRequested": False, "sourceBundleModified": False, "parts": []}
    try:
        source_files = []
        with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT) as target:
            paths = [bundle, *sorted(bundle.rglob("*"))]
            for path in paths:
                check()
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise ValueError("Source transport tree contains an unsupported file type")
                relative = Path("reusable") / path.relative_to(bundle)
                info = target.gettarinfo(str(path), arcname=relative.as_posix())
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                info.mtime = 0
                info.pax_headers = {}
                if path.is_file():
                    source_files.append({"path": path.relative_to(bundle).as_posix(), "bytes": path.stat().st_size, "sha256": sha(path)})
                    with path.open("rb") as original_file:
                        target.addfile(info, original_file)
                else:
                    target.addfile(info)
        record["sourceFiles"] = source_files
        record["archive"] = {"path": "runtime-bundle.tar", "bytes": archive.stat().st_size, "sha256": sha(archive), "prefix": "reusable/"}
        combined = hashlib.sha256()
        with archive.open("rb") as source:
            for index in range(MAX_PARTS):
                first = source.read(min(1024 * 1024, PART_BYTES))
                if not first:
                    break
                part = output / f"runtime-bundle.part{index:02d}"
                count = 0
                h = hashlib.sha256()
                with part.open("xb") as target:
                    block = first
                    while block:
                        check()
                        target.write(block)
                        h.update(block)
                        combined.update(block)
                        count += len(block)
                        if count == PART_BYTES:
                            break
                        block = source.read(min(1024 * 1024, PART_BYTES-count))
                record["parts"].append({"path": part.name, "index": index, "bytes": count, "sha256": h.hexdigest()})
            if source.read(1):
                raise ValueError("Transport exceeds ten 480 MiB artifacts")
        if combined.hexdigest() != record["archive"]["sha256"] or sum(p["bytes"] for p in record["parts"]) != record["archive"]["bytes"]:
            raise ValueError("Transport concatenation verification failed")
        for row in source_files:
            path = bundle / row["path"]
            if path.stat().st_size != row["bytes"] or sha(path) != row["sha256"]:
                raise ValueError("Original bundle changed during repacking")
        prior = json.loads(source_artifacts.read_text())
        source_stored = sum(a["size_in_bytes"] for a in prior["artifacts"])
        # A failed restore may retain a reconstructed archive. Its identity is
        # recorded in evidence, but this reproducible staging copy is not uploaded.
        diagnostic_bytes = sum(p.stat().st_size for p in evidence.rglob("*") if p.is_file() and p.relative_to(evidence).as_posix() != "restore/runtime.tar.gz")
        reserve = 128 * 1024 * 1024
        total = source_stored + record["archive"]["bytes"] + diagnostic_bytes + reserve
        record["storageAccounting"] = {"sourceArtifactsReportedBytes": source_stored, "transportPartBytes": record["archive"]["bytes"], "diagnosticBytesBeforeFinalManifests": diagnostic_bytes, "zipAndMetadataOverheadReserveBytes": reserve, "combinedUpperAllowanceBytes": total, "ceilingBytes": STORAGE_CEILING}
        if diagnostic_bytes > 400 * 1024 * 1024 or total > STORAGE_CEILING:
            raise ValueError("Connector evidence size or combined artifact storage ceiling exceeded")
        archive.unlink()
        record["status"] = "TRANSPORT_BYTES_VERIFIED"
    except BaseException as exc:
        record["failure"] = {"type": type(exc).__name__, "message": str(exc)}
        raise
    finally:
        record["completedAtUtc"] = datetime.now(timezone.utc).isoformat()
        with metadata.open("x") as target:
            json.dump(record, target, indent=2)
            target.write("\n")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("bundle", "output", "metadata", "source-artifacts", "evidence"):
        parser.add_argument("--"+name, required=True, type=Path)
    parser.add_argument("--expected-bundle-sha256", required=True)
    parser.add_argument("--max-seconds", type=int, default=600)
    args = parser.parse_args()
    if not 30 <= args.max_seconds <= 900:
        parser.error("max-seconds must be 30..900")
    record = repack(args.bundle, args.expected_bundle_sha256, args.output, args.metadata, args.source_artifacts, args.evidence, args.max_seconds)
    print(json.dumps({"status": record["status"], "parts": len(record["parts"]), "archive": record["archive"]}))


if __name__ == "__main__":
    main()
