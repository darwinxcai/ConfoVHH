#!/usr/bin/env python3
"""Two bounded GPCRdb captures of one previously missing canonical receptor."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent


def capture(name, url):
    for attempt in range(1, 4):
        stem = HERE / "sources" / (name + "-attempt-" + str(attempt))
        body_path, record_path = stem.with_suffix(".body"), stem.with_suffix(".json")
        assert not body_path.exists() and not record_path.exists(), "Refusing to overwrite capture"
        record = {"url": url, "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "captureScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "planSha256": hashlib.sha256((HERE / "capture-plan.json").read_bytes()).hexdigest()}
        body = b""
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "ConfoVHH-canonical-DP1-review/1.0"})
            try:
                response = urllib.request.urlopen(request, timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(8 * 1024 * 1024 + 1)
                assert len(body) <= 8 * 1024 * 1024, "Response exceeds bound"
                record.update(status=response.status, finalUrl=response.url)
        except (urllib.error.URLError, TimeoutError) as error:
            record.update(status=None, errorType=type(error).__name__)
        record.update(finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        body_path.write_bytes(body)
        record_path.write_text(json.dumps(record, indent=2) + "\n")
        if record["status"] == 200:
            return json.loads(body)
        time.sleep(0.75 * attempt)
    raise RuntimeError("Bounded capture attempts exhausted")


if __name__ == "__main__":
    (HERE / "sources").mkdir(exist_ok=True)
    plan = json.loads((HERE / "capture-plan.json").read_text())
    for repeat in range(1, 3):
        protein = capture("protein-" + str(repeat), plan["proteinEndpoint"])
        assert protein["accession"] == "Q13258"
        name = protein["entry_name"]
        assert re.fullmatch(r"[a-z0-9_-]+", name)
        residues = capture("residues-" + str(repeat), plan["residuesEndpointTemplate"].replace("{entry_name}", name))
        print(json.dumps({"capture": repeat, "accession": protein["accession"], "entryName": name, "residueRows": len(residues)}), flush=True)
