"""Rebuild this metadata-only, non-dispositive review from archived inputs."""
import datetime
import hashlib
import json
from pathlib import Path

from lxml import html

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "validation/hard-decoy-holdout-v3"
OUT = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rows(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line]


def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def jsonl(name, values):
    (OUT / name).write_text("".join(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n" for value in values))


def entity_fields(entity):
    return {key: entity[key] for key in ["entityId", "description", "sequenceLength", "sequenceSha256", "authAsymIds", "labelAsymIds", "referenceSequences"]}


queue = rows(BASE / "rcsb-recent-screen-2026-09-04/review-queue.jsonl")
entries = {entry["pdbId"]: entry for entry in rows(BASE / "rcsb-recent-discovery-2026-09-04/entries.jsonl")}
screen = rows(BASE / "rcsb-recent-screen-2026-09-04/entity-screens.jsonl")
assert len(queue) == 24 and len({row["pdbId"] for row in queue}) == 11
assert sum(row["numberedHeavyDomainCallCount"] > 0 for row in queue) == 11

paper_text = (OUT / "sources/gaba-primary-paper.html").read_text()
paper = html.fromstring(paper_text)
subjects = sorted(set(" ".join(item.itertext()).strip() for item in paper.xpath('//a[contains(@href,"/subjects/")]')))
assert "Ligand-gated ion channels" in subjects
assert paper.xpath('//meta[@name="citation_doi"]/@content') == ["10.1038/s41467-026-76879-5"]
headings = [" ".join(item.itertext()).strip() for item in paper.xpath("//h2|//h3")]
assert "Introduction" not in headings and "Methods" not in headings
assert any("creativecommons.org/licenses/by/4.0" in url for url in paper.xpath('//a[contains(@href,"creativecommons")]/@href'))
uniprot = json.loads((OUT / "sources/gabra4-uniprot.json").read_text())
functions = [text["value"] for comment in uniprot["comments"] if comment["commentType"] == "FUNCTION" for text in comment["texts"]]
assert any("heteropentameric ligand-gated chloride channel" in text for text in functions)

write("source-facts.json", {
    "schemaVersion": "1.0.0",
    "sources": [
        {"id": "archived-entry-metadata", "path": "validation/hard-decoy-holdout-v3/rcsb-recent-discovery-2026-09-04/entries.jsonl", "evidenceType": "repeated-public-deposition-metadata", "fact": "Exact entry titles, polymer descriptions, sequences, chain identifiers and primary-citation records are retained. These establish complex context, not independently verified direct receptor-VHH interfaces."},
        {"id": "gaba-primary-paper", "doi": "10.1038/s41467-026-76879-5", "url": "https://www.nature.com/articles/s41467-026-76879-5", "captureFile": "sources/gaba-primary-paper.html", "license": "CC BY 4.0", "evidenceType": "primary-publisher-article-metadata-and-abstract", "observedSubjects": subjects, "fact": "The primary publisher classifies this GABAA receptor paper under ligand-gated ion channels. Its DOI is the primary citation of 9SL1, 9SLD and 9SLM.", "fullMethodsOrDetailedBinderRoleReviewed": False, "limitation": "The retrieved publisher page exposes abstract and metadata but no Introduction, Methods or main Results sections. No detailed Nb24/Mb30 interface-role claim is taken from inaccessible full text."},
        {"id": "gabra4-uniprot", "accession": "P48169", "url": "https://rest.uniprot.org/uniprotkb/P48169.json", "captureFile": "sources/gabra4-uniprot.json", "evidenceType": "curated-protein-functional-annotation", "fact": "GABRA4 is annotated as a subunit of a heteropentameric GABA-gated chloride channel, independently supporting the ion-channel classification.", "underlyingEvidence": "The function annotation cites PubMed 35355020 and separately marks some statements as by-similarity evidence; no interface geometry is used here."},
        {"id": "gaba-publication-metadata", "url": "https://api.crossref.org/works/10.1038%2Fs41467-026-76879-5", "captureFile": "sources/gaba-crossref.json", "evidenceType": "publisher-deposited-bibliographic-record", "fact": "Crossref identifies the GABAA receptor paper and DOI. Bibliographic identity does not substitute for a detailed binder-role review."},
    ],
    "scientificInterpretation": "The reviewed alpha4/beta3/delta GABAA channels belong outside the GPCR target population. GABAA channels must not be confused with GABAB GPCRs. Their positive channel identity supports the scope decision; a negative sequence screen is not needed for that distinction.",
    "figuresInspected": False, "nativeCoordinatesAccessed": False, "nativeRelativeBinderPosesInspected": False,
})

IGE = {"30AC", "30AD", "30AE", "30AF"}
GABA = {"9SL1", "9SLD", "9SLM"}
SHORT = {"9SQK", "9SS3", "9SVO"}
entity_reviews = []
entry_reviews = []
for pdb_id in sorted({row["pdbId"] for row in queue}):
    entry = entries[pdb_id]
    selected = [row for row in queue if row["pdbId"] == pdb_id]
    if pdb_id in IGE:
        category = "IGE_FC_WITH_CONVENTIONAL_FAB"
        scope = "OUTSIDE_GPCR_TARGET_SCOPE"
        reason = "Deposited target is IgE-Fc (immunoglobulin constant epsilon; P01854), with named anti-IgE Fab heavy and light chains. A heavy-variable-domain call in a conventional Fab does not establish a single-domain VHH."
        sources = ["archived-entry-metadata"]
        follow = ["Primary publication DOI/PMID is absent; retain unresolved publication provenance."]
    elif pdb_id in GABA:
        category = "GABAA_LIGAND_GATED_CHANNEL_WITH_NB_OR_MB"
        scope = "OUTSIDE_GPCR_TARGET_SCOPE"
        reason = "Deposited alpha4/beta3/delta GABAA subunits, primary-paper subject classification and curated receptor identity support a ligand-gated ion-channel complex, not a GABAB GPCR complex."
        sources = ["archived-entry-metadata", "gaba-primary-paper", "gabra4-uniprot"]
        follow = ["Resolve Nb24/Mb30 experimental constructs and direct target-binding roles from accessible primary methods.", "Reconcile deposited sequence, UniProt assignment, receptor fusion and megabody scaffold records before generator inputs.", "Audit target-family, binder-lineage, publication and prior-development exposure in the separate membrane-protein study."]
    elif pdb_id == "9X9T":
        category = "VIRAL_SPIKE_RBD_WITH_CONVENTIONAL_FABS"
        scope = "OUTSIDE_GPCR_TARGET_SCOPE"
        reason = "The entry identifies SARS-CoV-2 spike RBD with two Fabs, a spike S1 entity referencing P0DTC2, and paired heavy/light entities. Heavy-variable domains here establish neither standalone VHHs nor a GPCR target."
        sources = ["archived-entry-metadata"]
        follow = ["Detailed Fab-lineage review is not completed; this scope assessment uses the deposited complex identity."]
    else:
        assert pdb_id in SHORT
        category = "ASF1_WITH_NONCANONICAL_SHORT_PEPTIDE"
        scope = "NON_GPCR_TARGET_CONTEXT_SEQUENCE_IDENTITY_UNRESOLVED"
        reason = "Entry title and Q9Y294 reference identify histone chaperone ASF1A as the target. The cr peptide has an X-containing deposited sequence; a noncanonical-sequence flag is not a VHH detection or an absence proof."
        sources = ["archived-entry-metadata"]
        follow = ["Resolve chemical identities represented by X from primary peptide/foldamer documentation if needed; do not guess residues or replace sequences."]
    for entity in entry["polymerEntities"]:
        assert entity["sequence"] is None or sha(entity["sequence"].encode()) == entity["sequenceSha256"]
    entry_reviews.append({"pdbId": pdb_id, "entryTitle": entry["title"], "primaryCitation": entry["primaryCitation"], "category": category, "gpcrScopeAssessment": scope, "evidenceSources": sources, "reasonedInterpretation": reason, "allDepositedEntities": [entity_fields(entity) for entity in entry["polymerEntities"]], "reviewedQueueEntityIds": [row["entityId"] for row in selected], "heavyDomainPositiveEntityIds": [row["entityId"] for row in selected if row["numberedHeavyDomainCallCount"] > 0], "membraneStudyCandidateSeed": pdb_id in GABA, "nextEvidenceRequired": follow, "formalDispositionAssigned": False, "formalGpcrLedgerChanged": False})
    for row in selected:
        entity = next(entity for entity in entry["polymerEntities"] if entity["entityId"] == row["entityId"])
        assert row["sequenceSha256"] == entity["sequenceSha256"]
        entity_reviews.append({"pdbId": pdb_id, **entity_fields(entity), "sourceScreenStatus": row["status"], "heavyVariableDomainDetected": row["numberedHeavyDomainCallCount"] > 0, "sourceScreenDevelopmentSequenceMatch": row["developmentSequenceMatch"], "sourceScreenPriorSequenceExposure": row["priorSequenceExposure"], "category": category, "gpcrScopeAssessment": scope, "evidenceSources": sources, "scientificInterpretation": reason, "sequenceIdentityResolution": "UNRESOLVED_NONCANONICAL_RESIDUES" if pdb_id in SHORT else "DEPOSITED_SEQUENCE_HASH_VERIFIED_NOT_CANONICAL_CONSTRUCT_ADJUDICATION", "noncanonicalXCount": entity["sequence"].count("X") if pdb_id in SHORT else None, "formalVhhIdentityEstablished": False, "directReceptorVhhInterfaceEstablished": False, "absenceOfHiddenVhhEstablished": False, "formalDispositionAssigned": False, "formalLedgerChanged": False, "wholeCensusAuthority": False, "targetFreezePermitted": False})
assert len(entity_reviews) == 24
jsonl("entity-reviews.jsonl", entity_reviews)
jsonl("entry-reviews.jsonl", entry_reviews)

long_nb = next(entity for entity in entries["9SL1"]["polymerEntities"] if entity["description"] == "Nanobody Nb24")
short_nb = next(entity for entity in entries["9SLM"]["polymerEntities"] if entity["description"] == "Nanobody Nb24")
assert long_nb["sequence"] == short_nb["sequence"] + "HHHHHHEPEA"
for entity_id in ["1", "2", "3"]:
    assert len({next(entity["sequenceSha256"] for entity in entries[pdb_id]["polymerEntities"] if entity["entityId"] == entity_id) for pdb_id in GABA}) == 1
write("membrane-study-seed.json", {
    "schemaVersion": "1.0.0", "status": "SEPARATE_MEMBRANE_STUDY_METADATA_SEED_ONLY", "pdbIds": sorted(GABA), "targetClass": "GABAA ligand-gated ion channel", "primaryDoi": "10.1038/s41467-026-76879-5", "sharedPublicationProvisionalComponentUpperBound": 1, "componentBoundAssumption": "The separate draft study joins entries that share a primary publication. This is a conditional metadata bound, not a frozen leakage-graph result.", "independentEligibleComponentCount": None, "developmentAndFamilyExposureResolved": False, "formalGraphComputed": False, "gpcrStudyPoolingPermitted": False, "currentGpcrEligibleTargetsAdded": 0,
    "evidenceForDependence": ["All three entries cite the same primary DOI.", "All three receptor-subunit sequence hashes match across entries, despite differences in descriptions and reference accessions.", "Nb24 sequences share an identical 123-residue prefix; the longer deposited sequence adds HHHHHHEPEA."],
    "binderInventory": [{"pdbId": pdb_id, "entities": [entity_fields(entity) for entity in entries[pdb_id]["polymerEntities"] if entity["description"] in ["Nanobody Nb24", "Megabody Mb30"]]} for pdb_id in sorted(GABA)],
    "constructObservations": [
        {"fact": "9SLM contains Nb24 only; 9SL1 and 9SLD contain Nb24 and a deposited entity named Mb30.", "inference": "Do not describe all three as containing both binders."},
        {"fact": "The deposited Mb30 entity is 138 residues long.", "inference": "Its name does not establish that the sequence represents the complete experimentally used megabody. Scaffold and construct completeness remain unresolved."},
        {"fact": "The 133-residue Nb24 sequence equals the 123-residue 9SLM sequence followed by HHHHHHEPEA.", "inference": "The suffix is consistent with purification/detection tags, but its experimental provenance is unreviewed. No sequence is silently trimmed."},
        {"fact": "9SL1/9SLD alpha4 references P48169, while the identical 9SLM alpha4 sequence references F6UBA8 and Q9D6F4. Beta3/fusion descriptions also differ despite identical sequence hashes.", "inference": "Canonical receptor identity, species and engineered construct mapping require reconciliation before generation or evaluation."},
    ],
    "requiredBeforeEligibility": ["Accessible primary methods defining binder origin, architecture, production and direct target role", "Complete assembly/entity and experimental construct consistency review", "Separate family and binder-lineage dependency graph containing prior-development exposure nodes", "Generator training-overlap records and per-target provenance", "Separate power/precision planning and protocol gates without transferring GPCR thresholds across folds"],
    "directBindingOrEfficacyValidatedHere": False, "nativeRelativePosesInspected": False, "modelGenerationAuthorized": False, "nativeLabelsAuthorized": False, "formalFreezePermitted": False,
})

fungal = entries["9SH6"]
fungal_screen = [row for row in screen if row["pdbId"] == "9SH6"]
assert len(fungal_screen) == len(fungal["polymerEntities"])
assert not any(row["numberedHeavyDomainCallCount"] for row in fungal_screen)
write("fungal-gpcr-context.json", {"pdbId": "9SH6", "reviewQueueMember": False, "purpose": "Retain positive GPCR metadata context alongside the negative heavy-domain screen without inferring VHH absence.", "entryTitle": fungal["title"], "primaryCitation": fungal["primaryCitation"], "allDepositedEntities": [entity_fields(entity) for entity in fungal["polymerEntities"]], "screenEntityCount": len(fungal_screen), "heavyVariableDomainPositiveEntityCount": 0, "sourceScreenStatuses": [{"entityId": row["entityId"], "status": row["status"]} for row in fungal_screen], "scopeEvidence": "The entry title and pheromone alpha-factor receptor entity provide positive GPCR context.", "scientificInterpretation": "No confident heavy-domain call is an algorithmic negative. It cannot establish absence of an unrecognized, truncated or noncanonical VHH and cannot alone justify formal census exclusion.", "absenceOfHiddenVhhEstablished": False, "newEligibleGpcrVhhComplexEstablished": False, "formalDispositionAssigned": False})

summary = {"schemaVersion": "1.0.0", "studyId": "confovhh-hard-decoy-holdout-v3", "reviewDate": "2026-09-04", "status": "RECENT_PRIORITY_QUEUE_SCOPE_REVIEWED_FORMAL_LEDGER_UNCHANGED", "queueEntityCount": 24, "queueEntryCount": 11, "heavyVariableDomainPositiveEntityCount": 11, "heavyVariableDomainPositiveEntryCount": 8, "positiveEntityBreakdown": {"conventionalAntiIgEFabHeavyChains": 4, "conventionalViralRbdFabHeavyChains": 2, "gabaNb24OrMb30Chains": 5}, "noncanonicalShortPeptideEntityCount": 3, "additionalLexicalOnlyOrLightChainEntities": 10, "positiveEntriesOutsideGpcrScope": 8, "newEligibleGpcrVhhComplexesEstablished": 0, "formalWholeCensusUpperBound": None, "separateMembraneSeedEntryCount": 3, "separateMembraneSeedProvisionalComponentUpperBound": 1, "separateMembraneSeedEligibleIndependentComponentCount": None, "wholeCensusAuthority": False, "broaderDiscoveryComplete": False, "formalProtocolStatus": "DRAFT", "targetFreezeGate": "BLOCKED", "nativeCoordinatesAccessed": False, "nativeRelativeBinderPosesInspected": False, "figuresInspected": False, "dockqLabelsAccessed": False, "executionAuthorized": False, "interpretation": "The heavy-variable-domain positives occur in conventional antibodies or ion-channel complexes; they do not establish eight additional GPCR-VHH targets. This queue review does not establish whole-census absence or exclusions. Three GABA structures form a separate membrane-study lead with at most one shared-publication component, whose eligibility remains unresolved."}
write("summary.json", summary)
inputs = [BASE / f"rcsb-recent-screen-2026-09-04/{name}" for name in ["review-queue.jsonl", "entity-screens.jsonl", "summary.json", "checksums.sha256"]]
inputs += [BASE / f"rcsb-recent-discovery-2026-09-04/{name}" for name in ["entries.jsonl", "checksums.sha256"]]
inputs += [ROOT / "validation/membrane-vhh-feasibility-draft/README.md"]
write("manifest.json", {"schemaVersion": "1.0.0", "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "inputDigests": {str(file.relative_to(ROOT)): sha(file.read_bytes()) for file in inputs}, "generatorScript": str(Path(__file__).resolve().relative_to(ROOT)), "generatorScriptSha256": sha(Path(__file__).read_bytes()), "reviewMethod": "Metadata scope assessment; exact entity sequence hashes are checked against source entry records. Primary-publisher subject classification and curated receptor identity distinguish GABAA ion channels from GPCRs. No formal ledger is mutated.", "sourceCaptures": "source-capture-records.json", "scopeNotes": "All 24 queued entities are retained. The separate 9SH6 context note is outside this 24-row queue.", "formalLedgerModified": False})
print(json.dumps(summary, indent=2))
