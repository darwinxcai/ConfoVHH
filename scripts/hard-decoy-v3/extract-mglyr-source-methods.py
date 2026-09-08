"""Offline extraction of five licensed preparation paragraphs from one pinned XML.

Supply only the permitted publisher/Europe PMC article XML. No network requests,
figures, captions, results, coordinate files or supplementary tables are emitted.
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

SOURCE_SHA = "5841cd77f7242c75562f2eb1237edb2ee43720f2cbf71bb70bf1b202f6890776"
SELECTIONS = [
    ("Sec11", 0, "d8836cc14669c1a90798541934762cf2825e9e195190bae151c8febb20a47051"),
    ("Sec13", 0, "36be7276e4a5ff2096b5ddda1fea0d369a2e188bb197050e59d7f6c43168f9ad"),
    ("Sec13", 9, "5e7caff275c5c6fc29ba2e7959c5eca4b79e2fb9ce3982840870105bb8faa6f7"),
    ("Sec14", 0, "72d4cec5093b72439e5b8c75f8e1d405a781f30c8303bc7ac86400b23044151e"),
    ("Sec15", 0, "221285e6848061d0b2e7ea4fb55a7c7fbfe45719c022d679deb22cd47281e540"),
]


def extract(raw):
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise ValueError("Article XML differs from the exact permitted source capture")
    document = ET.fromstring(raw)
    paragraphs = []
    for section_id, paragraph_index, expected_sha in SELECTIONS:
        section = document.find(f'./body/sec/sec[@id="{section_id}"]')
        paragraph = section.findall("p")[paragraph_index]
        text = " ".join("".join(paragraph.itertext()).split())
        if hashlib.sha256(text.encode()).hexdigest() != expected_sha:
            raise ValueError("Selected preparation paragraph differs from its pinned text")
        paragraphs.append({
            "id": f"{section_id}.p{paragraph_index}",
            "sectionId": section_id,
            "sectionTitle": " ".join("".join(section.find("title").itertext()).split()),
            "paragraphIndex": paragraph_index,
            "text": text,
            "textSha256": expected_sha,
        })
    return {
        "schema": "confovhh-mglyr-selected-methods-v1",
        "sourceDoi": "10.1038/s41467-026-68339-x",
        "sourcePmcid": "PMC12834959",
        "sourceUrl": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12834959/fullTextXML",
        "sourceResponseSha256": SOURCE_SHA,
        "normalization": "sha256(UTF8(' '.join(''.join(p.itertext()).split())))",
        "paragraphs": paragraphs,
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 extract-mglyr-source-methods.py permitted-article.xml new-output.json")
    source_path, output_path = map(Path, sys.argv[1:])
    if source_path.is_symlink() or not source_path.is_file() or source_path.stat().st_size > 200000:
        raise SystemExit("Input must be the bounded regular XML capture")
    selected = extract(source_path.read_bytes())
    with output_path.open("x", encoding="utf-8") as destination:
        destination.write(json.dumps(selected, indent=2, ensure_ascii=False) + "\n")
    print("Extracted five pinned preparation Methods paragraphs; no scientific adjudication performed.")
