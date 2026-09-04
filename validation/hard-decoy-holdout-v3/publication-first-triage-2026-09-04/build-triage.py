"""Rebuild record-level bibliography triage from archived metadata and reviews."""
import collections
import datetime
import hashlib
import html
import json
import re
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "validation/hard-decoy-holdout-v3"
OUT = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()
read_json = lambda file: json.loads(file.read_text())
read_rows = lambda file: [json.loads(line) for line in file.read_text().splitlines() if line]
clean = lambda text: html.unescape(re.sub(r"<[^>]+>", "", html.unescape(text)))


def write(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def jsonl(name, values):
    (OUT / name).write_text("".join(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n" for value in values))


publication_path = BASE / "publication-first-discovery-2026-09-04/publications.jsonl"
priority_path = BASE / "publication-accession-review-2026-09-04/priority-reviews.json"
frozen_path = BASE / "entry-metadata-snapshot-2026-08-29/entries.jsonl"
publications = read_rows(publication_path)
priority = {review["doi"]: review for review in read_json(priority_path)["reviews"]}
core = read_json(OUT / "sources/europepmc-core.json")
assert core["hitCount"] == 23 and len(core["resultList"]["result"]) == 23
metadata = {row["id"]: row for row in core["resultList"]["result"]}
assert set(metadata) == {row["pmid"] for row in publications if row["pmid"]}
assert len(publications) == 24 and len(priority) == 5
for row in publications:
    if row["pmid"]:
        assert metadata[row["pmid"]]["doi"].lower() == row["doi"]
        assert metadata[row["pmid"]].get("abstractText")

preprint = read_json(OUT / "sources/preprint-crossref.json")["message"]
published = read_json(OUT / "sources/published-crossref.json")["message"]
assert preprint["DOI"].lower() == "10.1101/783290"
assert published["DOI"].lower() == "10.1073/pnas.2011560117"
assert any(row["id-type"] == "doi" and row["id"].lower() == published["DOI"].lower() for row in preprint["relation"]["is-preprint-of"])
assert any(row["id-type"] == "doi" and row["id"].lower() == preprint["DOI"].lower() for row in published["relation"]["has-preprint"])
version_link = {"preprintDoi": preprint["DOI"].lower(), "publishedDoi": published["DOI"].lower(), "evidence": [{"sourceFile": "sources/preprint-crossref.json", "field": "message.relation.is-preprint-of", "assertedBy": "subject"}, {"sourceFile": "sources/published-crossref.json", "field": "message.relation.has-preprint", "assertedBy": "object"}], "titleSimilarityUsedAsAuthority": False}

# These are record-level assessments of explicit abstracts and article text.
# They are not automatic experimental-entry exclusions.
decisions = {
    "29208950": ("METHODS_OR_COMPUTATIONAL_REUSE", "PDB_DIFFRACTION_DATA_REANALYSIS", "The abstract describes a comparative diffraction-anisotropy analysis. Primary methods explicitly mine existing PDB structure-factor data; this is a data-reuse study, not evidence of a newly deposited GPCR-VHH complex.", False),
    "29507218": ("METHODS_OR_COMPUTATIONAL_REUSE", "M2_NANOBODY_MOLECULAR_DYNAMICS", "The abstract explicitly reports Gaussian accelerated molecular-dynamics simulation of M2 receptor/nanobody binding. Comparison with a prior experimental structure does not make the simulation a new experimental deposition.", False),
    "31990273": ("NON_GPCR_TARGET_STUDY", "ELIC_AND_5HT3_ION_CHANNELS", "The abstract identifies pentameric ligand-gated ion channels and experimental ELIC/nanobody cocrystals. The 5-HT3 receptor is an ion channel in this work; these targets are outside GPCR scope.", True),
    "33139559": ("NON_GPCR_TARGET_STUDY", "PATCHED1_NANOBODY", "The abstract identifies PTCH1 as the nanobody target and describes a sterol-conduit/transport mechanism. This is a Patched1 study, not a nanobody-bound Smoothened GPCR study.", True),
    "35211467": ("REVIEW_OR_PERSPECTIVE", "PHOTOSWITCHABLE_INTERACTION_PERSPECTIVE", "Although indexed as a brief report, the abstract explicitly calls the article a perspective that categorizes existing design approaches. It is a literature lead rather than a new GPCR-VHH structural case.", False),
    "35379919": ("METHODS_OR_COMPUTATIONAL_REUSE", "CRYOEM_RECONSTRUCTION_METHOD", "The paper evaluates reconstruction methods using existing ribosome and PTCH1-TI23 datasets. Its data statement names reused EMD/EMPIAR records and a software repository, not a newly established GPCR-VHH atomic deposition.", False),
    "35858343": ("EXPERIMENTAL_GPCR_STRUCTURAL_CANDIDATE", "GPBAR_GS_EXISTING_DEPOSITION", "The abstract reports an experimental R399-bound GPBAR-Gs structure. Primary data availability names 7XTQ, already in the historical 287-entry inventory. The deposited antibody-like entity is named Nanobody-35; this review does not assign its formal role or establish a direct GPCR-VHH benchmark case.", False),
    "37457453": ("EXPERIMENTAL_GPCR_NONSTRUCTURAL_STUDY", "BETA2AR_NATIVE_MASS_SPECTROMETRY", "The abstract reports beta2AR/ligand complexes with mini-Gs or Nb80 measured by native mass spectrometry and compared with functional assays. This supports experimental complex/function work, not an experimentally determined atomic receptor-VHH reference pose.", False),
    "37500769": ("EXPERIMENTAL_GPCR_NONSTRUCTURAL_STUDY", "ENDOSOME_POSITIONING_AND_SIGNALING", "The abstract describes manipulation of receptor-containing endosomes and optical transcriptional/signaling readouts in cells. A new atomic receptor-VHH reference pose is not established by that evidence.", False),
    "38381130": ("NON_GPCR_TARGET_STUDY", "MELB_SUGAR_TRANSPORTER", "The abstract identifies bacterial MelB, an MFS sugar transporter, and an experimentally studied conformation-selective nanobody. This is a separate membrane-protein lead, not a GPCR target.", True),
    "42161902": ("NON_GPCR_TARGET_STUDY", "STAPHYLOCOCCAL_TOXIN_NANOBODIES", "The abstract identifies Hla and bacterial superantigens SEB, SEC and TSST-1 as nanobody targets. These toxin complexes do not establish GPCR-targeted reference cases.", False),
}
review_ids = {"26677230", "38898362", "40588530", "40694881", "41097828", "41627946", "41795245"}
for pmid in review_ids:
    assert any(value.lower() == "review" for value in metadata[pmid]["pubTypeList"]["pubType"])
    decisions[pmid] = ("REVIEW_OR_PERSPECTIVE", "REVIEW_REFERENCE_MINING_PENDING", "Explicit Review publication metadata and the abstract identify a synthesis of prior work. References may yield discovery leads, but this record itself is not an additional experimental structural case.", False)

primary_facts = [
    {"pmid": "29208950", "sourceFile": "sources/diffraction-method-paper.xml", "section": "Materials and Methods / PDB data mining and curation", "fact": "The study mines existing PDB structure-factor data for comparative analysis."},
    {"pmid": "35379919", "sourceFile": "sources/cryoem-method-paper.xml", "section": "Data availability and experimental dataset descriptions", "fact": "The evaluated data include reused ribosome datasets and PTCH1-TI23 dataset EMPIAR-10328, alongside EMD-3508, EMD-2660 and EMPIAR-10028. These are not new GPCR-VHH depositions."},
    {"pmid": "35858343", "sourceFile": "sources/gpbar-paper.xml", "section": "Data Availability", "fact": "The authors deposit the R399-bound GPBAR-G complex under PDB 7XTQ and EMDB EMD-33452."},
    {"pmid": "29507218", "sourceFile": "sources/europepmc-core.json", "section": "Abstract", "fact": "The study reports molecular-dynamics simulation, compared with an existing experimental structure.", "fullTextRetrievalGap": "The attempted Europe PMC fullTextXML request returned HTTP 404; no full-text absence/deposition conclusion is made from that failed response."},
]
for filename in ["gpbar-paper.xml", "diffraction-method-paper.xml", "cryoem-method-paper.xml"]:
    article = etree.fromstring((OUT / "sources" / filename).read_bytes())
    assert article.tag == "article"
    for element in article.xpath("//fig|//table-wrap|//ref-list"):
        element.getparent().remove(element)
    text = " ".join(article.itertext())
    if filename == "gpbar-paper.xml":
        assert "7XTQ" in text and "EMD-33452" in text
    elif filename == "cryoem-method-paper.xml":
        assert "EMPIAR-10328" in text and "PTCH1" in text

index_results = [read_json(OUT / "sources" / f"deposition-index-{repeat}.json") for repeat in [1, 2]]
index_ids = []
for result in index_results:
    assert result["result_type"] == "entry" and result["total_count"] == len(result["result_set"])
    identifiers = [row["identifier"] for row in result["result_set"]]
    assert identifiers == sorted(set(identifiers))
    index_ids.append(identifiers)
assert index_ids[0] == index_ids[1]
frozen = {entry["pdbId"]: entry for entry in read_rows(frozen_path)}
assert frozen["7XTQ"]["primaryCitation"]["doi"] == "10.1073/pnas.2117054119"
associated = {doi: review["depositedPdbIdsNamedByThisPaper"] for doi, review in priority.items()}
associated["10.1073/pnas.2117054119"] = ["7XTQ"]
assert sorted({pdb_id for identifiers in associated.values() for pdb_id in identifiers}) == index_ids[0]

reviews = []
families = {}
for row in publications:
    pmid = row["pmid"]
    doi = row["doi"]
    sources = ["publication-first-discovery-2026-09-04/publications.jsonl"]
    retained_priority = None
    if pmid:
        sources.append("sources/europepmc-core.json")
    if doi in priority:
        retained_priority = priority[doi]
        structural = doi in {"10.1038/s41467-024-50827-7", "10.1073/pnas.2423931122", "10.1038/s41589-025-01896-2"}
        category = "EXPERIMENTAL_GPCR_STRUCTURAL_CANDIDATE" if structural else "EXPERIMENTAL_GPCR_BINDER_NO_NEW_COMPLEX_REFERENCE"
        subtype = retained_priority["reviewOutcome"]
        reason = retained_priority["inference"]
        membrane_lead = False
        sources.append("publication-accession-review-2026-09-04/priority-reviews.json")
    elif doi == "10.1101/783290":
        category = "NON_GPCR_TARGET_STUDY"
        subtype = "LINKED_PATCHED1_PREPRINT_VERSION"
        reason = "Crossref explicitly links this preprint DOI to the published PTCH1-nanobody paper. It remains a distinct bibliographic record but is not counted as a second publication family."
        membrane_lead = False
        sources += ["sources/preprint-crossref.json", "sources/published-crossref.json"]
    else:
        category, subtype, reason, membrane_lead = decisions[pmid]
    sources += [fact["sourceFile"] for fact in primary_facts if fact["pmid"] == pmid and fact["sourceFile"] not in sources]
    family = published["DOI"].lower() if doi == preprint["DOI"].lower() else doi
    families.setdefault(family, []).append(row["sourceId"])
    reviews.append({
        "sourceId": row["sourceId"], "pmid": pmid, "pmcid": row["pmcid"], "doi": doi, "title": clean(row["title"]), "firstPublicationDate": row["firstPublicationDate"], "sourceQueryIds": row["queryIds"], "publicationTypes": row["publicationTypes"],
        "category": category, "subtype": subtype, "evidenceSources": sources, "sourceBasedInterpretation": reason,
        "abstractMetadataCaptured": bool(pmid), "publicationFamilyId": family, "isLinkedPreprintVersion": doi == preprint["DOI"].lower(), "separateMembraneStudyLeadPossible": membrane_lead,
        "pdbAccessionsEstablishedByExistingSourceReview": associated.get(doi, []),
        "priorPriorityReviewRetained": retained_priority is not None,
        "priorPriorityReviewOutcome": retained_priority["reviewOutcome"] if retained_priority else None,
        "remainingEvidence": retained_priority["unresolvedEvidence"] if retained_priority else (["Backward citation mining and primary-source accession adjudication of referenced studies remain pending."] if category == "REVIEW_OR_PERSPECTIVE" else ["No additional experimental GPCR-VHH pose or independent benchmark component is established by this record-level assessment."]),
        "formalEntryExclusionAssigned": False, "formalCensusLedgerChanged": False, "eligibleIndependentComponentIncrementEstablished": False, "wholeCensusAuthority": False,
    })
assert len(reviews) == 24 and len(families) == 23
counts = dict(sorted(collections.Counter(row["category"] for row in reviews).items()))
write("publication-families.json", {"inputRecordCount": 24, "publicationFamilyCount": 23, "linkageRule": "Merge only explicitly documented DOI version relationships. All unlinked DOIs remain separate even when titles or topics resemble one another.", "verifiedVersionLinks": [version_link], "families": [{"familyId": family, "sourceIds": members} for family, members in sorted(families.items())], "publicationFamilyCountIsIndependentBenchmarkN": False})
jsonl("bibliographic-reviews.jsonl", reviews)
write("primary-source-facts.json", {"facts": primary_facts, "inheritedPriorityReviewCount": 5, "inheritedPriorityReviewPath": "validation/hard-decoy-holdout-v3/publication-accession-review-2026-09-04/priority-reviews.json", "figuresOrCoordinateFilesFetched": False})
request = read_json(OUT / "deposition-index-request.json")
queried_dois = request["query"]["parameters"]["value"]
assert len(queried_dois) == 9 and request["query"]["parameters"]["operator"] == "in"
write("deposition-reconciliation.json", {"queryType": "EXACT_PRIMARY_CITATION_DOI", "queriedDoiCount": len(queried_dois), "queriedDois": queried_dois, "requestFile": "deposition-index-request.json", "repeatAgreement": True, "responseTotalCounts": [result["total_count"] for result in index_results], "returnedPdbIds": index_ids[0], "newAccessionsBeyondPriorPriorityReviewsAndHistoricalMetadata": [], "nextMetadataCaptureIdsEstablished": [], "perPublication": [{"doi": doi, "indexedPdbIds": associated.get(doi, []), "associationEvidence": "prior-priority-review" if doi in priority else "historical-entry-metadata" if doi == "10.1073/pnas.2117054119" else "NO_MATCH_IN_CAPTURED_EXACT_DOI_INDEX", "absenceOfIndexedAccessionProvesNoDeposition": False} for doi in queried_dois], "gpbarContext": {"pdbId": "7XTQ", "historicalKeywordIntersectionMember": True, "antibodyLikeEntity": {key: frozen["7XTQ"]["polymerEntities"][3][key] for key in ["entityId", "description", "sequenceLength", "sequenceSha256"]}, "formalBinderRoleAssigned": False}, "limitations": ["Only the nine GPCR-relevant original-study DOIs were queried; review reference lists were not mined by this operation.", "Missing or delayed citation indexing, another paper's primary citation, and supplemental/unregistered resources can defeat an exact-DOI search.", "Existing indexed accessions include isolated binders and engineered fusions; accession retrieval is not experimental reference-pose or independent-component validation."]})
summary = {"schemaVersion": "1.0.0", "status": "ALL_CAPTURED_PUBLICATION_RECORDS_TRIAGED_ENTRY_DISPOSITIONS_PENDING", "inputPublicationRecordCount": 24, "recordLevelTriageCount": 24, "abstractRecordsCaptured": 23, "retainedPriorPriorityReviews": 5, "newlyTriagedRecords": 19, "documentedPreprintPublicationLinks": 1, "publicationFamilyCount": 23, "categoryCounts": counts, "exactDoiSearchPaperCount": 9, "repeatConfirmedIndexedPdbCount": 7, "additionalPdbAccessionsBeyondKnownReviewsAndHistoricalMetadata": 0, "newEligibleIndependentGpcrVhhComponentsEstablished": 0, "referenceCitationMiningComplete": False, "broaderDiscoveryComplete": False, "formalWholeCensusUpperBound": None, "formalCensusLedgerChanged": False, "formalProtocolStatus": "DRAFT", "targetFreezeGate": "BLOCKED", "nativeCoordinatesAccessed": False, "nativeRelativeBinderPosesInspected": False, "figuresInspected": False, "dockqLabelsAccessed": False, "executionAuthorized": False, "interpretation": "All 24 retrieved records now have an evidence-based article-level category. DOI linkage merges one preprint/publication pair without dropping either record. Repeated exact-citation search found only seven already known accessions; no further accession or independent GPCR-VHH component is established. Review reference mining and whole-census completeness remain open."}
write("summary.json", summary)
inputs = [publication_path, priority_path, frozen_path, BASE / "publication-first-discovery-2026-09-04/checksums.sha256"]
write("manifest.json", {"schemaVersion": "1.0.0", "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "inputDigests": {str(file.relative_to(ROOT)): sha(file.read_bytes()) for file in inputs}, "generatorScript": str(Path(__file__).resolve().relative_to(ROOT)), "generatorScriptSha256": sha(Path(__file__).read_bytes()), "sourceCaptureRecords": "source-capture-records.json", "reviewBoundary": "Record-level bibliography triage and deposition-index reconciliation only. No atomic coordinates or figure assets fetched; no scientific entry exclusions assigned."})
print(json.dumps(summary, indent=2))
