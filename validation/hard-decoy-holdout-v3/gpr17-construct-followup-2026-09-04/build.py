#!/usr/bin/env python3
"""Capture/replay a bounded GPR17 species and deposited-sequence audit."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = next((ancestor for ancestor in HERE.parents if (ancestor / "HARD_DECOY_PROTOCOL_V3.md").is_file()), Path.cwd())
SOURCES = {
    "human-canonical": "https://rest.uniprot.org/uniprotkb/Q13304.json",
    "human-isoform-2": "https://rest.uniprot.org/uniprotkb/Q13304-2.fasta",
    "mouse-canonical": "https://rest.uniprot.org/uniprotkb/Q6NS65.json",
    "primary-paper": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9464062/fullTextXML",
}
INPUTS = {
    "validation/hard-decoy-holdout-v3/gpcrdb-complement-metadata-2026-09-04/entries.jsonl": "70c7c8a05533d2cae4841307ccc4083a7ddf136adf29e0137b97df548740630c",
    "validation/hard-decoy-holdout-v3/gpcrdb-complement-priority-review-2026-09-04/source-reviews.json": "b2cc22d3261dfbeb861af09ed1f5e65fe3ba168063ba4deee61e6eca49610f9d",
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()

def immutable(file, content):
    file.parent.mkdir(parents=True, exist_ok=True)
    if file.exists():
        assert file.read_bytes() == content, f"Immutable file changed: {file}"
    else:
        with file.open("xb") as stream:
            stream.write(content)

def capture(out, name, repeat):
    raw_name = f"raw/{name}-repeat-{repeat}.txt"
    record_name = f"captures/{name}-repeat-{repeat}.json"
    if (out / record_name).exists():
        return
    url = SOURCES[name]
    started = datetime.now(timezone.utc).isoformat()
    request = urllib.request.Request(url, headers={"User-Agent": "ConfoVHH-metadata-audit/1.0"})
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(16 * 1024 * 1024 + 1)
        assert len(data) <= 16 * 1024 * 1024
        status, final_url = response.status, response.url
        content_type, date_header = response.headers.get("content-type"), response.headers.get("date")
    immutable(out / raw_name, data)
    immutable(out / record_name, encoded({"url": url, "finalUrl": final_url, "method": "GET", "status": status,
        "startedUtc": started, "completedUtc": datetime.now(timezone.utc).isoformat(), "contentType": content_type,
        "dateHeader": date_header, "rawFile": raw_name, "bytes": len(data), "sha256": sha(data)}))

def source(out, name):
    payloads, records = [], []
    for repeat in (1, 2):
        record = json.loads((out / f"captures/{name}-repeat-{repeat}.json").read_bytes())
        data = (out / record["rawFile"]).read_bytes()
        assert record["url"] == record["finalUrl"] == SOURCES[name]
        assert record["status"] == 200 and record["bytes"] == len(data) and record["sha256"] == sha(data)
        payloads.append(data)
        records.append(record)
    assert payloads[0] == payloads[1], f"Source repeat disagreement: {name}"
    return payloads[0], records

def best_windows(deposited, reference):
    """Exhaust every contiguous window, without choosing an alignment threshold."""
    assert len(deposited) <= len(reference)
    counts = [sum(a != b for a, b in zip(deposited, reference[start:start + len(deposited)]))
              for start in range(len(reference) - len(deposited) + 1)]
    best = min(counts)
    windows = []
    for start, count in enumerate(counts):
        if count == best:
            differences = [{"depositedPosition1Based": i + 1, "referencePosition1Based": start + i + 1,
                            "depositedResidue": a, "referenceResidue": b}
                           for i, (a, b) in enumerate(zip(deposited, reference[start:start + len(deposited)])) if a != b]
            windows.append({"referenceStart1Based": start + 1, "referenceEnd1Based": start + len(deposited),
                            "differentPositions": differences})
    return {"method": "Exhaustive equal-length contiguous-window mismatch count; no indels or fitted cutoff",
            "windowsCompared": len(counts), "minimumMismatchCount": best,
            "exactContiguousMatch": best == 0, "bestWindows": windows,
            "limit": "A nonzero mismatch count is not an optimal gapped alignment or proof of species origin."}

def normalized_text(element):
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()

def paper_extract(data):
    root = ET.fromstring(data)
    ids = {node.attrib.get("pub-id-type"): normalized_text(node) for node in root.findall("./front/article-meta/article-id")}
    assert ids.get("doi") == "10.1002/mco2.159"
    allowed = {"cloning and purification of gpr17-gi complex", "cloning and purification of gpr17–gi complex", "data availability statement"}
    sections = []
    for section in root.findall(".//sec"):
        title = section.find("title")
        if title is None:
            continue
        label = normalized_text(title)
        if label.casefold().replace("‐", "-").replace("−", "-") not in allowed:
            continue
        # Direct paragraphs only: no descendant sections, figures, captions, or tables.
        paragraphs = []
        for paragraph in section.findall("p"):
            assert not any(paragraph.find(f".//{tag}") is not None for tag in ("fig", "caption", "table-wrap", "table"))
            paragraphs.append(normalized_text(paragraph))
        sections.append({"title": label, "sectionId": section.attrib.get("id"), "paragraphs": paragraphs})
    assert len(sections) == 2, f"Expected two precisely named nonstructural sections; found {len(sections)}"
    text = " ".join(paragraph for section in sections for paragraph in section["paragraphs"])
    assert "7Y89" in text and "human" in text and "scFv16" in text
    return {"articleIds": ids, "sections": sections,
            "extractionBoundary": "Exactly named construct/purification and data-availability sections; direct paragraphs only. No Results, figures, captions, contacts or coordinates inspected."}

def derive(root, out):
    capture_provenance = json.loads((out / "provenance/capture-provenance.json").read_bytes())
    assert capture_provenance["script"] == "provenance/capture-build.py"
    assert sha((out / capture_provenance["script"]).read_bytes()) == capture_provenance["sha256"]
    input_digests, inputs = {}, {}
    for relative, expected in INPUTS.items():
        data = (root / relative).read_bytes()
        if expected:
            assert sha(data) == expected, f"Pinned input changed: {relative}"
        input_digests[relative], inputs[relative] = sha(data), data
    prior_path = list(INPUTS)[1]
    prior = json.loads(inputs[prior_path])
    prior_review = next(row for row in prior["reviews"] if row["pdbId"] == "7Y89")
    assert prior_review["entryDisposition"] == "PENDING_REQUIRED_METADATA"
    entries = [json.loads(line) for line in inputs[list(INPUTS)[0]].splitlines()]
    entry = next(row for row in entries if row["pdbId"] == "7Y89")
    entity = next(row for row in entry["polymerEntities"] if row["entityId"] == "5")
    deposited = entity["sequence"]
    assert sha(deposited.encode()) == entity["sequenceSha256"] and len(deposited) == 293
    sources, references = {}, []
    for name, accession, taxon in (("human-canonical", "Q13304", 9606), ("mouse-canonical", "Q6NS65", 10090)):
        data, records = source(out, name)
        value = json.loads(data)
        assert value["primaryAccession"] == accession and value["organism"]["taxonId"] == taxon
        sequence = value["sequence"]["value"]
        assert len(sequence) == value["sequence"]["length"]
        sources[name] = records
        references.append({"accession": accession, "organism": value["organism"], "length": len(sequence),
            "sequenceSha256": sha(sequence.encode()), "sequence": sequence, "comparison": best_windows(deposited, sequence)})
    data, records = source(out, "human-isoform-2")
    fasta = data.decode().splitlines()
    assert len([line for line in fasta if line.startswith(">")]) == 1 and "Q13304-2" in fasta[0] and "OS=Homo sapiens" in fasta[0]
    sequence = "".join(fasta[1:])
    assert re.fullmatch("[A-Z]+", sequence)
    sources["human-isoform-2"] = records
    references.append({"accession": "Q13304-2", "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
        "length": len(sequence), "sequenceSha256": sha(sequence.encode()), "sequence": sequence,
        "comparison": best_windows(deposited, sequence)})
    data, records = source(out, "primary-paper")
    sources["primary-paper"] = records
    extract = paper_extract(data)
    inventory = [{key: row[key] for key in ("entityId", "description", "sequenceLength", "sequenceSha256", "sourceOrganisms", "referenceSequences")}
                 for row in entry["polymerEntities"]]
    report = {"schemaVersion": "1.0.0", "pdbId": "7Y89", "scope": "Species-annotation and deposited receptor sequence follow-up; no formal disposition change",
        "inputDigests": input_digests, "replayScriptSha256": sha(Path(__file__).read_bytes()),
        "captureScriptProvenance": capture_provenance, "sourceCaptures": sources,
        "depositedReceptor": {"entityId": "5", "length": len(deposited), "sequence": deposited,
            "sequenceSha256": entity["sequenceSha256"], "sourceOrganisms": entity["sourceOrganisms"],
            "referenceSequences": entity["referenceSequences"]}, "allDepositedPolymerEntities": inventory,
        "references": references, "primarySourceExtractSha256": sha(encoded(extract)),
        "priorEntryDisposition": prior_review["entryDisposition"], "entryDisposition": "PENDING_REQUIRED_METADATA",
        "formalProtocolStatus": "DRAFT", "targetFreezeGate": "BLOCKED", "formalComponentCertificationComplete": False,
        "independentComponentsAdded": 0, "wholeCensusComponentUpperBound": None,
        "accessFlagScope": "This follow-up only; these flags do not certify historical reviews or exposure status.",
        "nativeCoordinatesAccessed": False, "structuralResultsInspected": False, "nativeFiguresInspected": False,
        "labelsAccessed": False, "performanceOutputsAccessed": False}
    return {"sequence-audit.json": encoded(report), "primary-source-extract.json": encoded(extract)}

def verify(root, out):
    expected = derive(root, out)
    for name, content in expected.items():
        assert (out / name).read_bytes() == content, f"Replay mismatch: {name}"
    listed = {}
    for line in (out / "checksums.sha256").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert name not in listed
        listed[name] = digest
    actual = {str(file.relative_to(out)): sha(file.read_bytes()) for file in out.rglob("*") if file.is_file() and file.name != "checksums.sha256"}
    assert listed == actual, "Exact file inventory mismatch"
    return json.loads(expected["sequence-audit.json"])

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("capture", "build", "verify"))
    parser.add_argument("--repository-root", type=Path, default=ROOT)
    parser.add_argument("--output-directory", type=Path, default=HERE)
    args = parser.parse_args()
    if args.command == "capture":
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            # Both repeat responses are independent requests, retained byte for byte.
            futures = [pool.submit(capture, args.output_directory, name, repeat) for name in SOURCES for repeat in (1, 2)]
            for future in futures:
                future.result()
    elif args.command == "build":
        for name, content in derive(args.repository_root, args.output_directory).items():
            immutable(args.output_directory / name, content)
    else:
        report = verify(args.repository_root, args.output_directory)
        print(json.dumps({"verified": True, "pdbId": report["pdbId"], "references": [{"accession": row["accession"], "minimumWindowMismatches": row["comparison"]["minimumMismatchCount"]} for row in report["references"]]}))
