#!/usr/bin/env python3
"""Capture canonical sequence annotations, not structure coordinates."""
import concurrent.futures
import json
from capture import capture


def run(accession):
    record, body = capture("uniprot-" + accession, "https://rest.uniprot.org/uniprotkb/" + accession + ".json")
    if record["status"] != 200:
        raise RuntimeError("Canonical capture failed")
    data = json.loads(body)
    assert data["primaryAccession"] == accession
    return {"accession": accession, "length": data["sequence"]["length"], "sha256": record["sha256"]}


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(run, ["P43116", "P35408", "Q13258", "P0ABE7"]):
            print(json.dumps(result), flush=True)
