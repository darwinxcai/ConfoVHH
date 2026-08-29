#!/usr/bin/env python3
"""Score an explicit, frozen list of canonical A:B complexes with DockQ.

The JavaScript pilot runner owns pose generation and ConfoVHH auditing. This
small adapter keeps DockQ in one pinned Python process, preserves failures as
records, and clears every known DockQ memoization cache between models.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import traceback

import importlib.metadata
import DockQ.DockQ as dockq


CACHE_NAMES = (
    "align_chains",
    "get_aligned_residues",
    "get_residue_distances",
    "list_atoms_per_residue",
    "subset_atoms",
    "run_on_chains",
)


def clear_dockq_caches() -> None:
    for name in CACHE_NAMES:
        function = getattr(dockq, name, None)
        clear = getattr(function, "cache_clear", None)
        if clear is not None:
            clear()


def finite_number(value):
    number = float(value)
    if not (-float("inf") < number < float("inf")):
        raise ValueError(f"DockQ returned a non-finite value: {value!r}")
    return number


def score_job(job: dict, native_cache: dict[str, object]) -> dict:
    native_path = str(Path(job["nativePath"]).resolve())
    model_path = str(Path(job["modelPath"]).resolve())
    native = native_cache.get(native_path)
    if native is None:
        native = dockq.load_PDB(native_path, chains=["A", "B"])
        native_cache[native_path] = native
    model = dockq.load_PDB(model_path, chains=["A", "B"])
    mapping, total = dockq.run_on_all_native_interfaces(
        model,
        native,
        chain_map={"A": "A", "B": "B"},
    )
    if set(mapping) != {"AB"}:
        raise ValueError(f"Expected exactly the A:B interface, received {sorted(mapping)}")
    result = mapping["AB"]
    chain_map = result.get("chain_map")
    if chain_map != {"A": "A", "B": "B"}:
        raise ValueError(f"Unexpected DockQ chain map: {chain_map!r}")
    return {
        "jobId": job["jobId"],
        "targetId": job["targetId"],
        "kind": job["kind"],
        "ok": True,
        "dockqVersion": importlib.metadata.version("DockQ"),
        "mapping": "AB:AB",
        "interface": "A:B",
        "DockQ": finite_number(result["DockQ"]),
        "F1": finite_number(result["F1"]),
        "iRMSD": finite_number(result["iRMSD"]),
        "LRMSD": finite_number(result["LRMSD"]),
        "fnat": finite_number(result["fnat"]),
        "fnonnat": finite_number(result["fnonnat"]),
        "nativeContacts": int(result["nat_total"]),
        "nativeContactsRecovered": int(result["nat_correct"]),
        "modelContacts": int(result["model_total"]),
        "nonNativeContacts": int(result["nonnat_count"]),
        "clashes": int(result["clashes"]),
        "globalDockQ": finite_number(total),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    jobs = payload.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("The DockQ batch manifest must contain a non-empty jobs list.")

    native_cache: dict[str, object] = {}
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        for index, job in enumerate(jobs, start=1):
            try:
                record = score_job(job, native_cache)
            except Exception as error:  # failures must remain visible in the ledger
                record = {
                    "jobId": job.get("jobId"),
                    "targetId": job.get("targetId"),
                    "kind": job.get("kind"),
                    "ok": False,
                    "errorType": type(error).__name__,
                    "error": str(error),
                    "traceback": traceback.format_exc(limit=8),
                }
            finally:
                clear_dockq_caches()
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
            handle.flush()
            if index % 25 == 0 or index == len(jobs):
                print(f"DockQ {index}/{len(jobs)}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
