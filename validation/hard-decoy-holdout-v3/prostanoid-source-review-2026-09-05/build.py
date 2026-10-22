#!/usr/bin/env python3
"""Offline source/sequence reconciliation; no eligibility or geometric authority."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
BASE = "validation/hard-decoy-holdout-v3/"
PAPERS = {
    "ep2-ep4": {"doi": "10.1038/s44318-025-00611-0", "pmid": "41162752", "pmcid": "PMC12669672",
                "entries": ["9JRO", "9JRT", "9JQY", "9JQZ"], "methods": ["Sec11", "Sec12"], "availability": "notes2"},
    "dp1-nature": {"doi": "10.1038/s41467-025-64002-z", "pmid": "41062467", "pmcid": "PMC12508460",
                   "entries": ["9AU0", "9E9S", "9EE5", "9EI5", "9EKH"], "methods": ["Sec12", "Sec13", "Sec14", "Sec15", "Sec16", "Sec17"], "availability": None},
    "dp1-pnas": {"doi": "10.1073/pnas.2501902122", "pmid": "40440061", "pmcid": "PMC12146711",
                 "entries": ["8ZVZ", "8ZW0", "9UWD"], "methods": ["s9", "s10", "s11", "s12", "s13"], "availability": "s22"},
}
INPUTS = ["HARD_DECOY_PROTOCOL_V3.md"] + [BASE + p for p in [
    "global-text-discovery-2026-09-04/entries.jsonl", "global-text-discovery-2026-09-04/manifest.json",
    "domain-remainder-2026-09-04/entries.jsonl", "domain-remainder-2026-09-04/manifest.json",
    "global-text-screen-2026-09-04/entity-screens.jsonl", "global-text-screen-2026-09-04/sequence-screens.jsonl",
    "domain-remainder-screen-2026-09-04/entity-screens.jsonl", "domain-remainder-screen-2026-09-04/sequence-screens.jsonl",
    "vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl",
    "receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl",
    "receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl",
    "vhh-sequence-contract-2026-08-29.json", "receptor-tm-contract-2026-08-30.json",
    "entry-metadata-snapshot-2026-08-29/entities.jsonl",
]] + ["scripts/hard-decoy-v3/compare-domain-remainder-development.mjs",
      "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs", "scripts/hard-decoy/v3-receptor-tm-pregraph.mjs",
      "node_modules/immunum/immunum.js", "node_modules/immunum/immunum_bg.wasm"]
AUTHORITY = {"formalEligibilityAuthority": False, "formalExclusionAuthority": False,
             "formalLeakageEdgeAuthority": False, "formalNoEdgeAuthority": False,
             "newFormallyClearedIndependentComponents": 0, "wholeCensusUpperBound": None,
             "targetFreezePermitted": False, "studyStatus": "DRAFT", "freezeStatus": "BLOCKED"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dump(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def text(node):
    return " ".join(" ".join(node.itertext()).split())


def extract_article(raw, key):
    spec = PAPERS[key]
    root = ET.fromstring(raw)
    meta = root.find("./front/article-meta")
    ids = {n.get("pub-id-type"): text(n) for n in meta.findall("article-id")}
    assert ids.get("doi", "").lower() == spec["doi"], "Article DOI mismatch"
    assert ids.get("pmid") == spec["pmid"], "Article PMID mismatch"
    parent = {child: n for n in root.iter() for child in n}
    selected = []
    for section_id in spec["methods"]:
        matches = [n for n in root.iter("sec") if n.get("id") == section_id]
        assert len(matches) == 1, "Missing or duplicate allowed section"
        n = matches[0]
        ancestors = []
        cursor = n
        while cursor in parent:
            cursor = parent[cursor]
            if cursor.tag == "sec":
                ancestors.append(text(cursor.find("title")))
        assert any("methods" in title.lower() for title in ancestors), "Allowed section moved outside Methods"
        assert not any("result" in title.lower() for title in ancestors), "Results cannot become allowed Methods"
        assert not any(c.tag in {"fig", "caption", "table-wrap", "graphic", "supplementary-material", "sec"} for c in n.iter() if c is not n), "Unexpected nested content in allowed Methods"
        selected.append({"sectionId": section_id, "title": text(n.find("title")), "paragraphs": [text(p) for p in n.findall("p")]})
    if spec["availability"]:
        available = [n for n in root.iter("sec") if n.get("id") == spec["availability"]]
    else:
        available = [n for n in root.iter("notes") if n.get("notes-type") == "data-availability"]
    assert len(available) == 1, "Data availability missing or ambiguous"
    assert not any(c.tag in {"fig", "caption", "table-wrap", "graphic", "supplementary-material"} for c in available[0].iter()), "Unexpected availability assets"
    availability = [text(p) for p in available[0].findall("p")]
    for pdb in spec["entries"]:
        assert re.search(r"\b" + pdb + r"\b", " ".join(availability)), "Primary deposition link missing"
    return {"doi": spec["doi"], "pmid": spec["pmid"], "pmcid": spec["pmcid"],
            "title": text(meta.find("./title-group/article-title")),
            "authors": [text(n) for n in meta.findall("./contrib-group/contrib/name")],
            "permissions": [text(n) for n in meta.findall("permissions")],
            "sourceXmlSha256": sha(raw), "allowedMethods": selected, "depositionParagraphs": availability,
            "linkedEntries": spec["entries"], "boundary": "Only named preparation Methods and data availability extracted. Full XML is retained unmodified; Results, captions, figures, model-building and contact tables are not rendered or inspected."}


def canonical_comparison(entity, record):
    sequence = entity["sequence"]
    canonical = record["sequence"]["value"]
    matcher = difflib.SequenceMatcher(None, canonical, sequence, autojunk=False)
    blocks = [{"canonicalStart0": a, "depositedStart0": b, "length": n,
               "sequenceSha256": sha(canonical[a:a+n].encode())} for a, b, n in matcher.get_matching_blocks() if n >= 12]
    tms = []
    for feature in record.get("features", []):
        if feature["type"] == "Transmembrane":
            start, end = feature["location"]["start"]["value"], feature["location"]["end"]["value"]
            tms.append({"canonicalStart1": start, "canonicalEnd1": end,
                        "exactCompleteCanonicalSegmentPresent": canonical[start-1:end] in sequence})
    return {"canonicalAccession": record["primaryAccession"], "canonicalLength": len(canonical),
            "canonicalSequenceSha256": sha(canonical.encode()), "depositedLength": len(sequence),
            "exactFullCanonicalSubstringStart0": sequence.find(canonical), "exactMatchingBlocksAtLeast12Residues": blocks,
            "canonicalTransmembraneSegments": tms,
            "boundary": "Deterministic exact matching anchors only, not an optimal alignment, construct adjudication, frozen receptor-threshold calculation, resolved coordinates, or proof of missing helices."}


def construct_checks(entries, canonicals):
    index = {e["pdbId"]: e for e in entries}
    def receptor(pdb, accession):
        hits = [e for e in index[pdb]["polymerEntities"] if any(r["databaseAccession"] == accession for r in e["referenceSequences"])]
        assert len(hits) == 1
        return hits[0]["sequence"]
    def mutated(accession, substitutions):
        value = list(canonicals[accession]["sequence"]["value"])
        for pos, old, new in substitutions:
            assert value[pos-1] == old
            value[pos-1] = new
        return "".join(value)
    ep4 = mutated("P35408", [(7, "N", "Q"), (177, "N", "Q"), (62, "A", "L"), (106, "G", "R")])
    ep4_fragment = ep4[3:217] + ep4[259:366]
    for pdb in ["9JQY", "9JQZ"]:
        s = receptor(pdb, "P35408")
        assert len(s) == 549 and s[228:] == ep4_fragment
    dp1 = canonicals["Q13258"]["sequence"]["value"]
    for pdb in ["9AU0", "9E9S"]:
        s = receptor(pdb, "Q13258")
        assert len(s) == 385 and s[26:] == dp1
    for pdb in ["8ZVZ", "8ZW0"]:
        s = receptor(pdb, "Q13258")
        assert len(s) == 468 and s[128:] == dp1[:340]
    dp1_mutant = mutated("Q13258", [(130, "C", "R"), (263, "H", "A"), (319, "D", "N")])
    for pdb in ["9EE5", "9EI5", "9EKH"]:
        s = receptor(pdb, "Q13258")
        assert len(s) == 495 and s[26:259] == dp1_mutant[:233] and s[372:474] == dp1_mutant[257:]
        assert s[365:372] == "ERARSTL" and s[474:] == "GRPLEVLFQGPHHHHHHHHHH"
    ep2 = canonicals["P43116"]["sequence"]["value"]
    for pdb in ["9JRO", "9JRT"]:
        s = receptor(pdb, "P43116")
        assert len(s) == 684 and s[246:470] == ep2[:224] and s[582:] == ep2[256:]
        assert s[470:475] == "ARRQL" and s[575:582] == "ERARSTL"
    s = receptor("9UWD", "Q13258")
    assert len(s) == 428 and s[:227] == dp1[:227] and s[345:] == dp1[257:340]
    return {
        "coordinateConvention": "All reported canonical ranges below are one-based inclusive; code slices are zero-based half-open.",
        "ep4": {"entries": ["9JQY", "9JQZ"], "depositedLength": 549, "prefixLength": 228,
                "exactMutatedCanonicalRanges": [[4, 217], [260, 366]], "substitutions": ["N7Q", "A62L", "G106R", "N177Q"],
                "methodsStatedCterminalDeletion": [347, 488], "depositedCanonicalExtensionBeyondStatedBoundary": [347, 366],
                "discrepancyResolved": False},
        "ep2": {"entries": ["9JRO", "9JRT"], "prefixLength": 246, "exactCanonicalRanges": [[1, 224], [257, 358]],
                "interveningSequenceLength": 112, "linkersVerified": ["ARRQL", "ERARSTL"], "fullFusionProvenanceResolved": False},
        "dp1NatureActive": {"entries": ["9AU0", "9E9S"], "prefixLength": 26, "exactCanonicalRange": [1, 359], "depositedSuffixLength": 0},
        "dp1NatureInactive": {"entries": ["9EE5", "9EI5", "9EKH"], "prefixLength": 26,
                              "exactMutatedCanonicalRanges": [[1, 233], [258, 359]], "substitutions": ["C130R", "H263A", "D319N"],
                              "interveningSequenceLength": 113, "linkerVerified": "ERARSTL", "suffixLength": 21,
                              "depositedTerminalHistidineCount": 10, "methodsReportedHistidineTagCount": 8, "tagDiscrepancyResolved": False},
        "dp1PnasActive": {"entries": ["8ZVZ", "8ZW0"], "prefixLength": 128, "exactCanonicalRange": [1, 340],
                          "depositedSuffixLength": 0, "methodsReportCterminalLgBiTAndOMBP_MBP": True, "expressionToDepositionReconciled": False},
        "dp1PnasInactive": {"entry": "9UWD", "exactCanonicalRanges": [[1, 227], [258, 340]], "interveningSequenceLength": 118,
                            "experimentalConstructProvenanceResolved": False},
        "boundary": "Exact metadata sequence equalities and source discrepancies, not resolved structure coverage or experimental construct certification."}


def build(repository):
    all_ids = {pdb for spec in PAPERS.values() for pdb in spec["entries"]}
    entries = []
    for name in ["global-text-discovery", "domain-remainder"]:
        for e in rows(repository / BASE / (name + "-2026-09-04/entries.jsonl")):
            if e["pdbId"] in all_ids:
                entries.append({**e, "inputInventory": name + "-2026-09-04/entries.jsonl"})
    assert len(entries) == len(all_ids) == 12 and {e["pdbId"] for e in entries} == all_ids
    screens = {}
    for name in ["global-text-screen", "domain-remainder-screen"]:
        for s in rows(repository / BASE / (name + "-2026-09-04/entity-screens.jsonl")):
            if s["pdbId"] in all_ids:
                key = (s["pdbId"], s["entityId"])
                assert key not in screens
                screens[key] = s
    assert len(screens) == 47
    sources = {key: extract_article((HERE / "sources" / (key + "-article.body")).read_bytes(), key) for key in PAPERS}
    for key, spec in PAPERS.items():
        bibliography = json.loads((HERE / "sources" / (key + "-bibliography.body")).read_text())
        matching = [r for r in bibliography["resultList"]["result"] if r.get("doi", "").lower() == spec["doi"]]
        assert len(matching) == 1 and matching[0]["id"] == spec["pmid"] and matching[0]["pmcid"] == spec["pmcid"]
    canonicals = {a: json.loads((HERE / "sources" / ("uniprot-" + a + ".body")).read_text()) for a in ["P43116", "P35408", "Q13258", "P0ABE7"]}
    for a, c in canonicals.items():
        assert c["primaryAccession"] == a and len(c["sequence"]["value"]) == c["sequence"]["length"]
    inventory = []
    for entry in sorted(entries, key=lambda e: e["pdbId"]):
        paper = next(k for k, spec in PAPERS.items() if entry["pdbId"] in spec["entries"])
        assert entry["primaryCitation"]["doi"].lower() == PAPERS[paper]["doi"]
        assert len(entry["polymerEntities"]) == entry["polymerEntityCountReported"]
        polymers = []
        for entity in entry["polymerEntities"]:
            assert len(entity["sequence"]) == entity["sequenceLength"]
            assert sha(entity["sequence"].encode()) == entity["sequenceSha256"]
            screen = screens[(entry["pdbId"], entity["entityId"])]
            assert screen["sequenceSha256"] == entity["sequenceSha256"]
            comparisons = [canonical_comparison(entity, canonicals[r["databaseAccession"]])
                           for r in entity["referenceSequences"] if r["databaseName"] == "UniProt" and r["databaseAccession"] in canonicals]
            polymers.append({**entity, "numberedHeavyDomainCallCount": screen["numberedHeavyDomainCallCount"],
                             "canonicalSequenceAnchors": comparisons})
        inventory.append({"pdbId": entry["pdbId"], "paper": paper, "inputInventory": entry["inputInventory"],
                          "primaryDepositionLinkVerified": True, "polymers": polymers})
    development = json.loads(subprocess.check_output(["node", str(HERE / "development.mjs"), str(repository)], text=True))
    assert development["summary"]["sourcePolymerEntityCount"] == 47
    historical = rows(repository / BASE / "entry-metadata-snapshot-2026-08-29/entities.jsonl")
    reference = [e for e in historical if e["pdbId"] == "8TB7" and str(e["entityId"]) == "3"]
    assert len(reference) == 1
    ep2_nb = next(e for e in entries if e["pdbId"] == "9JRO")["polymerEntities"][2]
    assert ep2_nb["entityId"] == "3" and ep2_nb["sequence"] == reference[0]["sequence"]
    groups = []
    for key, spec in PAPERS.items():
        members = [e for e in inventory if e["paper"] == key]
        groups.append({"paper": key, "doi": spec["doi"], "entries": spec["entries"],
                       "polymerCount": sum(len(e["polymers"]) for e in members), "independentComponentClaim": False})
    discrepancy = next(e for e in inventory if e["pdbId"] == "9UWD")
    assert len(discrepancy["polymers"]) == 1 and discrepancy["polymers"][0]["numberedHeavyDomainCallCount"] == 0
    report = {"schemaVersion": "1.0", "groups": groups, "entries": inventory,
              "constructChecks": construct_checks(entries, canonicals),
              "historicalEp2NbMatch": {"candidate": "9JRO_3", "reference": "8TB7_3", "length": ep2_nb["sequenceLength"], "sequenceSha256": ep2_nb["sequenceSha256"], "roleProofBySequenceAlone": False},
              "sourceFacts": {
                "ep2-ep4": ["Sec11 identifies anti-BRIL Fab and anti-Fab nanobody and mixes them with EP2 at 1:1.2:1.5.",
                            "Sec11 describes BRIL insertion between EP2 R224 and A257 with ARRQL and ERARSTL linkers, HA/FLAG/eight-His engineering.",
                            "Sec12 describes EP4 deletions 1-3, 218-259 and 347-488, N7Q/N177Q/A62L/G106R substitutions, and anti-EP4 Fab001 rather than a VHH reagent.",
                            "The four exact PDB identifiers are present in the primary deposition statement."],
                "dp1-nature": ["Sec13/14 identify BAG2 as anti-BRIL Fab and the Nb as anti-Fab; Sec16 explicitly calls the Nb Fab-stabilizing.",
                               "Sec12 describes replacement of DP1 R234-P257 with BRIL, an ERARSTL linker and C130R/H263A/D319N substitutions.",
                               "Sec17 describes co-expression of DP1 and Gs and addition of Nb35; the HA/FLAG/receptor/3C/linker/eGFP/eight-His construct is described in Sec12.",
                               "Data availability links all five entries and distinguishes BRIL/BAG2/Nb from Gs/Nb35 samples."],
                "dp1-pnas": ["s9 describes DP1 residues 1-340 with N-terminal prolactin/BRIL and C-terminal LgBiT/OMBP-MBP engineering.",
                             "s11 reports C-terminal six-His Nb35; s12 adds Nb35 to the DP1/Gs preparation.",
                             "s13 describes inactive DP1 receptor preparation with FabBRIL and NbFab; s22 links 9UWD as inactive apo-DP1.",
                             "The retained 9UWD inventory contains one receptor polymer and no positive heavy-domain call. This does not establish absent experimental antibodies or a binder fusion."]},
              "interpretations": ["EP2 and Nature DP1 preparation Methods support auxiliary anti-Fab roles. Sequence matches do not independently establish binding roles.",
                                  "EP4 Methods describe a conventional anti-receptor Fab, not evidence of an eligible VHH.",
                                  "The four DP1/Gs/Nb35 deposits support Nb35-containing sample identity. Direct binding role and full construct/tag reconciliation remain separate checks.",
                                  "All eight DP1 deposits share canonical receptor annotation Q13258 across two publications; publication count is not independent-component count."],
              "openItems": ["Reconcile deposited GFP-like EP2/EP4 sequence with Methods that do not explicitly describe that fusion.",
                            "Resolve EP4 deposited canonical residues 347-366 despite the stated deletion of residues 347-488.",
                            "Resolve Nature DP1 inactive deposited ten-His terminus versus the reported eight-His tag.",
                            "Adjudicate deposited versus expressed boundaries, cleavage products and terminal tags in all construct classes.",
                            "Resolve 9UWD single-polymer coverage versus the primary FabBRIL/NbFab preparation without guessing absent chains or fusion topology.",
                            "Formally adjudicate development connections, binder lineage and prior exposure before eligibility or exclusion.",
                            "No new whole-census coverage or independent-component upper bound follows from this 12-entry review."],
              "coverageDiscrepancy": {"entry": "9UWD", "retainedPolymerCount": 1, "heavyDomainCallCount": 0,
                                      "paperDescribesFabAndNbPreparation": True, "binderAbsenceEstablished": False, "binderFusionEstablished": False},
              "exposure": {"rawXmlRetainedUnmodified": True, "inspectedContent": "Bibliographic identifiers, Methods subsection titles, allowlisted preparation paragraphs, deposition statements, canonical sequences and annotations only.",
                           "nativeCoordinatesAccessed": False, "nativePoseImagesAccessed": False, "structuralResultsInspected": False,
                           "structuralContactTablesInspected": False, "predictionOutputsAccessed": False, "evaluationLabelsAccessed": False,
                           "priorExposureRecordsRemainApplicable": True, "cleanBlindCertification": False},
              "authority": AUTHORITY}
    return {"allowed-sections.json": dump(sources), "source-review.json": dump(report), "development-review.json": dump(development)}


def bindings(repository):
    return {name: {"sha256": sha((repository / name).read_bytes()), "bytes": (repository / name).stat().st_size} for name in INPUTS}


def retained_files():
    files = [p for p in HERE.rglob("*") if p.is_file() and p.name != "checksums.sha256"]
    assert not any(p.is_symlink() for p in HERE.rglob("*")), "Symlink in packet"
    return sorted(files)


def checksums():
    return "".join(sha(p.read_bytes()) + "  " + p.relative_to(HERE).as_posix() + "\n" for p in retained_files()).encode()


def verify_captures():
    for name in [key + suffix for key in PAPERS for suffix in ["-bibliography", "-article"]] + ["uniprot-" + a for a in ["P43116", "P35408", "Q13258", "P0ABE7"]]:
        record = json.loads((HERE / "sources" / (name + ".json")).read_text())
        raw = (HERE / "sources" / (name + ".body")).read_bytes()
        assert record["status"] == 200 and record["bytes"] == len(raw) and record["sha256"] == sha(raw), "Capture binding mismatch"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["collect", "verify"])
    parser.add_argument("--repository-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    repository = args.repository_root.resolve()
    if args.mode == "verify":
        assert (HERE / "checksums.sha256").read_bytes() == checksums(), "Exact packet inventory mismatch"
        manifest = json.loads((HERE / "manifest.json").read_text())
        assert manifest["inputBindings"] == bindings(repository), "Repository input binding mismatch"
    verify_captures()
    outputs = build(repository)
    if args.mode == "collect":
        assert not (HERE / "manifest.json").exists(), "Refusing to rewrite existing packet"
        for name, data in outputs.items():
            assert not (HERE / name).exists()
            (HERE / name).write_bytes(data)
        manifest = {"schemaVersion": "1.0", "inputBindings": bindings(repository), "authority": AUTHORITY,
                    "outputBindings": {name: {"bytes": len(data), "sha256": sha(data)} for name, data in outputs.items()}}
        (HERE / "manifest.json").write_bytes(dump(manifest))
        (HERE / "checksums.sha256").write_bytes(checksums())
    else:
        for name, data in outputs.items():
            assert (HERE / name).read_bytes() == data, "Offline replay mismatch: " + name
            assert manifest["outputBindings"][name] == {"bytes": len(data), "sha256": sha(data)}
        assert manifest["authority"] == AUTHORITY
    print(json.dumps({"status": "PASS", "entryCount": 12, "polymerCount": 47, "newIndependentComponents": 0, "freezeStatus": "BLOCKED"}))


if __name__ == "__main__":
    main()
