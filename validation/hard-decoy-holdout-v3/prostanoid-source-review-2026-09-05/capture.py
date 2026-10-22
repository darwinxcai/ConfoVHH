#!/usr/bin/env python3
"""Capture bibliography/full XML without displaying structural Results or figures."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
PAPERS = {
    "ep2-ep4": "10.1038/s44318-025-00611-0",
    "dp1-nature": "10.1038/s41467-025-64002-z",
    "dp1-pnas": "10.1073/pnas.2501902122",
}


def capture(name, url):
    body_path = HERE / "sources" / (name + ".body")
    record_path = HERE / "sources" / (name + ".json")
    if body_path.exists() or record_path.exists():
        raise RuntimeError("Refusing to overwrite retained capture: " + name)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    request = urllib.request.Request(url, headers={"User-Agent": "ConfoVHH-source-audit/1.0"})
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024:
            raise RuntimeError("Response exceeds capture bound")
        record = {"url": url, "finalUrl": response.url, "status": response.status,
                  "startedUtc": started, "finishedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                  "contentType": response.headers.get("Content-Type")}
    body_path.write_bytes(body)
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    return record, body


def run(item):
    key, doi = item
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode(
        {"query": 'DOI:"' + doi + '"', "format": "json", "resultType": "core"})
    record, body = capture(key + "-bibliography", url)
    if record["status"] != 200:
        return {"paper": key, "status": record["status"]}
    results = json.loads(body)["resultList"]["result"]
    matches = [r for r in results if r.get("doi", "").lower() == doi]
    if len(matches) != 1:
        return {"paper": key, "exactDoiMatches": len(matches)}
    result = matches[0]
    pmcid = result.get("pmcid")
    summary = {"paper": key, "doi": doi, "pmid": result.get("id"), "pmcid": pmcid}
    if pmcid:
        xml_record, xml = capture(key + "-article", "https://www.ebi.ac.uk/europepmc/webservices/rest/" + pmcid + "/fullTextXML")
        summary["xmlStatus"] = xml_record["status"]
        if xml_record["status"] == 200:
            root = ET.fromstring(xml)
            ids = {x.get("pub-id-type"): "".join(x.itertext()) for x in root.findall("./front/article-meta/article-id")}
            if ids.get("doi", "").lower() != doi:
                raise RuntimeError("Article DOI mismatch")
            methods = [s for s in root.findall("./body/sec") if "method" in "".join(s.findtext("title", "")).lower()]
            summary["methodSections"] = [{"id": s.get("id"), "title": s.findtext("title")} for m in methods for s in m.iter("sec")]
            summary["availabilitySections"] = [{"id": s.get("id"), "title": s.findtext("title")} for s in root.iter("sec") if "availability" in s.findtext("title", "").lower()]
    return summary


if __name__ == "__main__":
    (HERE / "sources").mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(run, PAPERS.items()):
            print(json.dumps(result), flush=True)
