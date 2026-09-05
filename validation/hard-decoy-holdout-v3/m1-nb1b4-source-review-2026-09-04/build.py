"""Rebuild the bounded source review offline; never render excluded article sections."""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = HERE.parent
DOI = "10.1073/pnas.2508879122"
METHODS = {
    "s14": "Expression and Purification of the Receptors.",
    "s15": "Cryo-EM Grid Preparation.",
    "s20": "Conformationally Selective Nanobody Screening.",
    "s21": "On-Yeast Titration Assay.",
    "s22": "Expression and Purification of Nanobodies.",
}
REFS = ["r6", "r9", "r11", "r56", "r59", "r60", "r61"]
PINS = {
    "source-capture/primary-article.xml": "503f0a22ad359331689046d116048a997afe5652b28043c26f87f0f227b98f17",
    "source-capture/epmc-doi-query.json": "f62b1283b28231d64fe2510fb47ae1e8a36441675a08f208f13456e337a2758b",
}
AUTHORITY = {
    "formalLeakageEdgeAuthority": False, "formalNoEdgeAuthority": False,
    "formalExclusionAuthority": False, "formalTargetEligibilityAuthority": False,
    "wholeCensusAuthority": False, "targetFreezePermitted": False,
    "formallyClearedIndependentComponentCount": 0,
    "nativeCoordinatesAccessed": False, "nativePoseImagesAccessed": False,
    "contactTablesAccessed": False, "labelsAccessed": False,
    "performanceOutputsAccessed": False,
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


def text(element):
    return " ".join("".join(element.itertext()).split())


def extract_allowed_article_sections(body):
    root = ET.fromstring(body)
    assert root.find("./front/article-meta/article-id[@pub-id-type='doi']").text == DOI
    result = {"abstracts": [text(a) for a in root.findall("./front/article-meta/abstract")],
              "methods": [], "references": []}
    container = root.find("./body/sec[@id='s11']")
    assert container is not None and container.get("sec-type") == "materials|methods"
    assert text(container.find("title")).strip(". ") == "Materials and Methods"
    for identity, title in METHODS.items():
        section = container.find(f"./sec[@id='{identity}']")
        assert section is not None and text(section.find("title")) == title
        assert not any(section.findall(f".//{tag}") for tag in ["fig", "caption", "table-wrap", "sec"])
        result["methods"].append({"id": identity, "title": title,
                                  "paragraphs": [text(p) for p in section.findall("p")]})
    for section in root.findall("./back/sec"):
        title = section.find("title")
        if title is not None and text(title) == "Data, Materials, and Software Availability":
            result["dataAvailability"] = {"id": section.get("id"), "paragraphs": [text(p) for p in section.findall("p")]}
    assert "dataAvailability" in result
    for identity in REFS:
        reference = root.find(f"./back/ref-list/ref[@id='{identity}']")
        assert reference is not None
        result["references"].append({"id": identity, "text": text(reference)})
    result["license"] = text(root.find("./front/article-meta/permissions"))
    result["extractionPolicy"] = {
        "exactMethodSectionIds": list(METHODS), "exactReferenceIds": REFS,
        "resultsOrDiscussionRendered": False, "figureCaptionsRendered": False,
        "tablesRendered": False, "computationalDesignSectionsRendered": False,
        "dataProcessingOrModelRefinementSectionsRendered": False,
        "rawFullArticleXmlArchivedWithoutRenderingExcludedSections": True,
    }
    return result


def build():
    inputs = {}

    def read(path, expected=None):
        data = path.read_bytes()
        if expected:
            assert digest(data) == expected, f"Pinned input drift: {path.name}"
        inputs[str(path.relative_to(ROOT))] = {"sha256": digest(data), "bytes": len(data)}
        return data

    for relative, expected in PINS.items():
        read(HERE / relative, expected)
    bibliography = json.loads(read(HERE / "source-capture/epmc-doi-query.json"))
    assert bibliography["request"]["queryString"] == f"DOI:{DOI}" and bibliography["hitCount"] == 1
    paper = bibliography["resultList"]["result"][0]
    assert paper["doi"] == DOI and paper["pmid"] == "41187083" and paper["pmcid"] == "PMC12625997"
    sections = extract_allowed_article_sections(read(HERE / "source-capture/primary-article.xml"))
    capture_inventory = []
    for meta_path in sorted((HERE / "source-capture").glob("*.meta.json")):
        meta = json.loads(read(meta_path))
        body = read(meta_path.parent / meta["file"])
        assert digest(body) == meta["sha256"] and len(body) == meta["bytes"]
        capture_inventory.append({k: meta[k] for k in ["file", "url", "status", "bytes", "sha256"]})
    entries = [json.loads(line) for line in read(BASE / "global-text-discovery-2026-09-04/entries.jsonl", "fde2a0de338d34ea0e2baf56924b20bbc2de113b821a30af9c976b064d3a92d0").decode().splitlines()]
    screens = [json.loads(line) for line in read(BASE / "global-text-screen-2026-09-04/entity-screens.jsonl", "ddf6eef4bbd5f16bac633f5049e52ec5541d3f3a0ccbc9d8cf27020a28b2a267").decode().splitlines()]
    related = [r for r in entries if r["pdbId"] in ["9UAP", "9UAZ", "9UCP"]]
    assert len(related) == 3 and all(r["primaryCitation"]["doi"] == DOI for r in related)
    reference_text = {r["id"]: r["text"] for r in sections["references"]}
    for reference, accession in [("r59", "9UCP"), ("r60", "9UAP"), ("r61", "9UAZ")]:
        assert f"https://www.rcsb.org/structure/{accession}" in reference_text[reference]
    assert "Nb1B4" in reference_text["r59"] and "NbA12" in reference_text["r61"]
    metadata = []
    for entry in related:
        rows = []
        for entity in entry["polymerEntities"]:
            assert digest(entity["sequence"].encode()) == entity["sequenceSha256"]
            screen = next(r for r in screens if r["pdbId"] == entry["pdbId"] and r["entityId"] == entity["entityId"])
            assert screen["sequenceSha256"] == entity["sequenceSha256"]
            rows.append({**{k: entity[k] for k in ["entityId", "description", "sequenceLength", "sequenceSha256", "referenceSequences"]},
                         "retainedHeavyDomainCallCount": screen["numberedHeavyDomainCallCount"],
                         "screenStatus": screen["status"]})
        metadata.append({"pdbId": entry["pdbId"], "primaryCitation": entry["primaryCitation"], "entities": rows})
    main = next(r for r in related if r["pdbId"] == "9UCP")
    nb = next(r for r in main["polymerEntities"] if r["entityId"] == "3")
    assert nb["sequenceLength"] == 122 and not nb["sequence"].endswith("HHHHHH")
    receptor = next(r for r in main["polymerEntities"] if r["entityId"] == "1")
    assert receptor["sequenceLength"] == 435 and receptor["referenceSequences"] == []
    assert receptor["sequence"].endswith("HHHHHH")
    sequence_summary = json.loads(read(HERE / "sequence-evidence/summary.json", "6f92f02d540294f8bf9ce2c92ce0eb6d821cd7b79614587092225795556447f1"))
    receptor_comparisons = [json.loads(line) for line in read(HERE / "sequence-evidence/conditional-development-receptor-comparison.jsonl").decode().splitlines()]
    m2 = next(row for row in receptor_comparisons if row["developmentNodeId"] == "development:4MQS")
    assert len(receptor_comparisons) == 17 and m2["conditionalPrimarySignal"]
    assert m2["alignment"]["identicalResidueColumns"] == 153 and m2["alignment"]["alignmentColumns"] == 238
    assert sequence_summary["developmentVhhPairsCompared"] == 18 and not sequence_summary["positiveDevelopmentVhhProfiles"]
    review = {
        "schemaVersion": "1.0.0", "status": "SOURCE_AND_SEQUENCE_REVIEW_REMAINS_BLOCKED_FOR_FORMAL_ADJUDICATION",
        "doi": DOI, "pmid": paper["pmid"], "pmcid": paper["pmcid"], "title": paper["title"],
        "primarySource": "https://www.pnas.org/doi/10.1073/pnas.2508879122",
        "retainedPrimarySourceXml": "source-capture/primary-article.xml",
        "sourceFacts": [
            {"source": "front abstracts", "fact": "The primary abstract describes an engineered M1 receptor fusion and selection of conformation-sensitive nanobodies from a synthetic yeast-display library."},
            {"source": "Methods s20", "fact": "The synthetic library was supplied by the Kruse and Manglik laboratories, with the platform source explicitly cited as reference 9 (DOI 10.1038/s41594-018-0028-6). The screen used purified FLAG-tagged M1 constructs and MACS/FACS enrichment."},
            {"source": "Methods s22", "fact": "Nb1B4 is explicitly among selected nanobodies produced in HEK293F using pcDNA3.4, an N-terminal mouse immunoglobulin heavy-chain signal peptide and a C-terminal histidine tag."},
            {"source": "Methods s14", "fact": "The M1 constructs were expressed in Sf9 cells and purified through nickel, FLAG and size-exclusion steps. Exact de novo fusion sequence boundaries and the specific 9UCP construct designation are not established by these reviewed preparation paragraphs alone."},
            {"source": "Methods s15", "fact": "The authors describe preparation of purified M1 receptor–nanobody complexes for cryo-EM; no images or resulting poses are reviewed."},
            {"source": "Methods s21", "fact": "The on-yeast titration paragraph names Nb11. It is not used as evidence for Nb1B4 affinity, state specificity or direct binding."},
            {"source": "back data availability and refs r59–r61", "fact": "The primary publication links 9UCP to M1/G11-alpha5/iperoxo/Nb1B4, 9UAP to ligand-free M1/G11-alpha5, and 9UAZ to M1/atropine/NbA12."},
        ],
        "metadataFacts": {
            "mainEntry": "9UCP", "receptorContainingEntity": "1", "receptorContainingEntityLength": 435,
            "receptorDepositedUniprotMappingPresent": False, "receptorDepositedSequenceEndsWithSixHistidines": True,
            "nb1b4Entity": "3", "nb1b4DepositedLength": 122, "nb1b4DepositedSequenceHasTerminalSixHistidines": False,
            "g11Alpha5Entity": "2", "g11Alpha5Length": 27, "g11Alpha5RetainedAccession": "P29992",
        },
        "boundedInterpretations": [
            "The primary deposition citation and nanobody-expression Methods support that Nb1B4 is an intended nanobody partner in the M1 construct study. Exact receptor-directed role, binding specificity and construct relevance remain subject to formal review; native contact evidence is not consulted.",
            "The library provenance is context, not proof that Nb1B4 shares a known individual VHH parent with development references.",
            "The experimental expression construct includes a histidine tag whereas the deposited 122-aa sequence has no terminal polyhistidine tract. Tag omission, cleavage or unresolved residues cannot be assigned from the reviewed evidence.",
            "The new canonical human M1 reference is independently supported by UniProt/GPCRdb name, species and sequence. Comparisons to it remain conditional because the deposited receptor has no accession annotation and the engineered construct is not fully adjudicated.",
        ],
        "relatedPublicationMetadata": metadata,
        "coverageDiscrepancy": {
            "entry": "9UAZ", "primaryDepositionCitationNamesNbA12": True,
            "retainedProteinEntityCount": 1, "retainedHeavyDomainCallCount": 0,
            "absenceOfVhhEstablished": False, "binderFusionEstablished": False,
            "reviewRequired": "Reconcile primary citation and deposited polymer metadata without treating a negative screen or missing separate binder entity as absence evidence.",
        },
        "openItems": [
            "Exact 9UCP receptor-fusion sequence, de novo design component, mutation and cloning-boundary provenance.",
            "Nb1B4 expression-tag versus deposited-sequence reconciliation.",
            "Exact binder specificity/role and state-selectivity provenance independent of native structural contacts.",
            "9UAZ/NbA12 deposition-metadata discrepancy.",
            "Formal canonical receptor assignment, family/parent/publication leakage adjudication and prior exposure review.",
        ],
        "boundedAccess": {"publisherSupplementHttpStatus": 403, "supplementContentsInspected": False,
                          "noRepeatedAccessRetriesAfter403": True, "resultsInspected": False, "captionsInspected": False,
                          "computationalDesignOrModelRefinementSectionsInspected": False,
                          "rawArticleDownloadedButExcludedSectionsNotRendered": True},
        "sequenceFindings": {
            "evidenceDirectory": "sequence-evidence/", "developmentVhhProfilesCompared": 18,
            "positiveVhhThresholdMatchCount": 0, "noLeakageEstablished": False,
            "conditionalCanonicalReceptorComparisons": 17,
            "conditionalPrimaryReceptorSignal": {"proposedReference": "P11229 / human M1",
                "developmentNode": "development:4MQS", "developmentReference": "P08172 / M2",
                "identicalCanonicalTmResidues": 153, "canonicalTmAlignmentColumns": 238,
                "coverageEachSequence": 1, "gapColumns": 0,
                "assignedCanonicalAccessionToDepositedConstruct": False, "formalLeakageEdgeAuthority": False},
            "conditionalSensitivityReceptorNodeCount": len(sequence_summary["conditionalSensitivityReceptorSignalNodes"]),
        }, "authority": AUTHORITY,
    }
    files = {"allowed-source-sections.json": encode(sections), "source-review.json": encode(review),
             "source-capture-inventory.json": encode(capture_inventory)}
    files["README.md"] = ("# M1 / Nb1B4 bounded source review\n\n"
        "Primary paper: Zhang et al., DOI 10.1073/pnas.2508879122, PMID 41187083, PMC12625997. "
        "The author-deposited citation connects 9UCP to Nb1B4 and identifies the related 9UAP and 9UAZ entries. "
        "Reviewed preparation Methods identify synthetic-library selection and Nb1B4 secretion expression. "
        "This is a source/sequence review; no eligibility, formal leakage edges, exclusions or independent-component gains are declared.\n\n"
        "The 435-aa receptor-containing entity lacks a deposited UniProt mapping. Independent UniProt/GPCRdb captures provide a proposed canonical human M1 reference for conditional sequence/TM comparisons. "
        "The 122-aa Nb1B4 deposited entity lacks the expression construct's reported C-terminal histidine tag, so exact construct provenance remains open. "
        "All 18 development VHH comparisons are negative under the frozen sequence criterion; this does not establish no leakage. "
        "The proposed canonical M1 reference instead has a conditional receptor signal against development M2/4MQS: 153 of 238 TM residues identical (64.29%), with full coverage and no gaps. "
        "The source citation names NbA12 for 9UAZ, but retained metadata contains one 487-aa entity with no detected heavy domain. Neither absence nor a binder fusion is inferred.\n\n"
        "Raw article XML is retained with its CC BY-NC-ND 4.0 source attribution. Only the explicitly allowed front abstracts, Methods s14/s15/s20/s21/s22, deposition text and cited references are rendered. "
        "Results, captions, native coordinates, pose images, contact tables, labels and model outputs are not inspected. The publisher supplement returned 403; the failed response is retained.\n\n"
        "First restore the exact retained global metadata with `node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs`; these large inputs are stored compressed in Git. Then run `python3 -B validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/build.py verify`. "
        "The sequence-evidence directory has its own portable replay command and input bindings. The root checksum inventory covers all retained source and sequence files; no external source is fetched during verification. "
        "Target freeze remains blocked and the whole-census independent-component upper bound remains unknown.\n").encode()
    read(HERE / "build.py")
    files["manifest.json"] = encode({"schemaVersion": "1.0.0", "inputDigests": inputs, "authority": AUTHORITY})
    return files


def main(mode):
    assert mode in ["collect", "verify"]
    files = build()
    for name, value in files.items():
        path = HERE / name
        if mode == "collect":
            path.write_bytes(value)
        else:
            assert path.read_bytes() == value, f"Offline source replay mismatch: {name}"
    retained = sorted(p for p in HERE.rglob("*") if p.is_file() and p != HERE / "checksums.sha256")
    inventory = "".join(f"{digest(p.read_bytes())}  {p.relative_to(HERE).as_posix()}\n" for p in retained).encode()
    if mode == "collect":
        (HERE / "checksums.sha256").write_bytes(inventory)
    else:
        assert (HERE / "checksums.sha256").read_bytes() == inventory, "Exact package inventory or digest mismatch"
    print(json.dumps({"status": "PASS", "retainedFileCountExcludingRootChecksum": len(retained),
                      "sourceReviewSha256": digest(files["source-review.json"]), "targetFreezePermitted": False}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "verify")
