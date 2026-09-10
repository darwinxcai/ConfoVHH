#!/usr/bin/env python3
"""Verify the preserved 3P0G development pilot without inference or networking.

This checks file identities and cross-record consistency. The separate ranking
replay executes the frozen scientific implementation; this verifier does not
recompute molecular geometry or authenticate a cloud provider's billing.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "validation/single-case-development-3p0g-2026-09-09/completed-pilot-execution03"
MANIFEST = "paper/evidence/single-case-3p0g-selection-failure-2026-09-09/claim-evidence-v1.json"
IDS = {f"seed{seed}_model_{model}" for seed in (1, 2) for model in range(5)}
PROTOCOL_SHA = "8d3174f717ede953d922466cec93e5397ff443474da6c8addbc904ce8fc8d6e9"
ORIGINAL_RECEIPT_SHA = "5deccc9f5a79b75c462534a4d3524a82b5f64b70fd8ed8b5927a21acab6efdaa"
GENERATION_SHA = "0bc29e4fe47f94aaf51b0dee2faedba663502e560833a8b6daf04f2d547e47c7"
SEQUENCE_SHAS = {
    "A": "e9052379ba6dca45a6a4148a53cc1d6ad790f05e4b4f0a9237afe2fcc8638926",
    "B": "3e4dbf73ccc8ab7a4fb2fedd17695befe7f2807f17650d8ef60080aef9a8562f",
}


class EvidenceError(ValueError):
    """The package is missing, changed, or internally inconsistent."""


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(), object_pairs_hook=strict_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          EvidenceError(f"non-finite JSON number: {value}")))


def regular_file(base, relative):
    require(isinstance(relative, str) and "\\" not in relative, "invalid artifact path")
    parts = PurePosixPath(relative)
    require(not parts.is_absolute() and bool(parts.parts)
            and ".." not in parts.parts, f"unsafe artifact path: {relative}")
    base = base.resolve()
    target = base.joinpath(*parts.parts)
    require(target.resolve() == target and target.is_file(),
            f"artifact must be a direct regular file: {relative}")
    return target


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def verify_files(base, records, label):
    require(isinstance(records, list) and records, f"empty {label} inventory")
    paths = set()
    for row in records:
        require(row["path"] not in paths, f"duplicate {label} path: {row['path']}")
        paths.add(row["path"])
        require(type(row["bytes"]) is int and row["bytes"] >= 0,
                f"invalid byte count: {row['path']}")
        require(re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is not None,
                f"invalid digest: {row['path']}")
        target = regular_file(base, row["path"])
        require(target.stat().st_size == row["bytes"], f"size mismatch: {row['path']}")
        require(digest(target) == row["sha256"], f"hash mismatch: {row['path']}")
    return paths


def candidate_map(rows, label):
    require(isinstance(rows, list) and len(rows) == 10, f"{label}: expected ten candidates")
    result = {row["id"]: row for row in rows}
    require(len(result) == 10 and set(result) == IDS, f"{label}: candidate IDs differ")
    return result


def validate_boundaries(boundaries):
    expected = {
        "developmentExposed": True, "independentValidation": False,
        "frozenV3Compatible": False, "noNewGpuGeneration": True,
        "originalNegativeResultPreserved": True, "scoringRedesignValidated": False,
        "predictionOutputsAccessed": True, "nativeReferenceAccessed": True,
        "newScientificAnalysisPerformed": True, "protectedIndependentHoldoutAccessed": False,
        "selectionSuperiorityEstablished": False, "independentEligibleGroupCount": 0,
    }
    for key, value in expected.items():
        require(type(boundaries.get(key)) is type(value) and boundaries.get(key) == value,
                f"interpretation boundary changed: {key}")


def verify_claim_text(root, claims, artifact_paths):
    require(isinstance(claims, list) and claims, "claim ledger is empty")
    ids = [claim["id"] for claim in claims]
    require(len(set(ids)) == len(ids), "duplicate claim IDs")
    for claim in claims:
        require(claim["evidenceClass"] == "DEVELOPMENT_EXPOSED_SINGLE_CASE",
                f"claim promoted beyond development evidence: {claim['id']}")
        require(isinstance(claim["statement"], str) and claim["statement"].strip(),
                f"claim statement is empty: {claim['id']}")
        require(isinstance(claim["artifacts"], list) and claim["artifacts"]
                and set(claim["artifacts"]) <= artifact_paths,
                f"claim references missing artifacts: {claim['id']}")
        manuscript = regular_file(root, claim["manuscript"]).read_text()
        text = " ".join(claim["text"].split())
        require(len(text) >= 20 and text in " ".join(manuscript.split()),
                f"claim text absent from manuscript: {claim['id']}")


def validate_original_report(report):
    require(report["inventory"] == {
        "planned": 10, "generated": 10, "audited": 10, "scored": 10,
        "generationFailures": 0, "auditFailures": 0, "dockqFailures": 0,
        "confidenceFailures": 0,
    }, "original candidate inventory changed")
    rows = candidate_map(report["candidateLedger"], "original comparison")
    require(report["failures"] == [], "original failure list changed")
    for row in rows.values():
        require(all(row[k] == "success" for k in
                    ("generationStatus", "auditStatus", "dockqStatus")),
                f"incomplete original candidate: {row['id']}")
        require(type(row["DockQ"]) in (int, float) and math.isfinite(row["DockQ"])
                and 0 <= row["DockQ"] <= 1, f"invalid DockQ: {row['id']}")
    for selector, field in (("confo", "methodTier"), ("predictor", "baselineTier")):
        best = min(row[field] for row in rows.values())
        tied = sorted(row["id"] for row in rows.values() if row[field] == best)
        summary = report[selector]
        require(sorted(summary["candidateIds"]) == tied and summary["tiedCandidates"] == len(tied),
                f"{selector} tie set inconsistent")
        values = [rows[identifier]["DockQ"] for identifier in tied]
        for key, value in (("meanDockQ", sum(values) / len(values)),
                           ("minDockQ", min(values)), ("maxDockQ", max(values))):
            require(summary[key] == value, f"{selector} {key} inconsistent")
    best_dockq = max(row["DockQ"] for row in rows.values())
    oracle = report["bestAvailableOracle"]
    require(sorted(oracle["candidateIds"]) == sorted(
        row["id"] for row in rows.values() if row["DockQ"] == best_dockq), "oracle tie set inconsistent")
    require(oracle["DockQ"] == best_dockq and oracle["completeGeneratedPool"] is True,
            "oracle incomplete or changed")
    require(report["confo"]["candidateIds"] == ["seed2_model_4"]
            and report["confo"]["meanDockQ"] == 0.1762564824406321,
            "original negative ConfoVHH result changed")
    require(report["predictor"]["candidateIds"] == ["seed2_model_0"]
            and best_dockq == 0.48462880897372757, "original confidence/oracle result changed")
    require(report["difference"]["meanDockQ"] == -0.30837232653309543,
            "original negative difference changed")
    require(report["claims"]["independentValidation"] is False,
            "original result promoted to validation")
    return rows


def verify_history(package):
    first_path = regular_file(package, "history/first-a100/generation-receipt.json")
    require(digest(first_path) == "2c216026327518cd202cba6c4602f36a2161dc6f5574a881c25325fdd36294a9",
            "first failed generation receipt changed")
    failed = candidate_map(read_json(first_path)["attempts"], "initial failed generation")
    require(all(row["status"] == "failed" and row["artifacts"] == {}
                and row["confidenceStatus"] == "missing" for row in failed.values()),
            "earlier failed attempts were erased or promoted")
    previous = [
        ("history/compiler-recovery/gate-blocked-execution.json", "compiler"),
        ("original-evaluation/historical-startup01-original.json", "startup01"),
        ("original-evaluation/historical-startup02-original.json", "startup02"),
    ]
    for path, label in previous:
        record = read_json(regular_file(package, path))
        require(record["generationRunnerLaunched"] is False and record["modelInferenceRuns"] == 0,
                f"{label}: no-inference history changed")
        rows = candidate_map(record["plannedSlots"], label)
        require(all(row["status"] == "not-run" and row["coordinate"] is None
                    and row["predictorConfidence"] is None and row["DockQ"] is None
                    for row in rows.values()), f"{label}: not-run history changed")
    return {"initialFailed": 10, "compilerNotRun": 10, "startup01NotRun": 10, "startup02NotRun": 10}


def verify(root=ROOT, manifest=None):
    root = Path(root).resolve()
    manifest = read_json(regular_file(root, MANIFEST)) if manifest is None else manifest
    require(manifest["schema"] == "confovhh.single-case-pilot-claim-evidence.v1", "wrong claim schema")
    validate_boundaries(manifest["boundaries"])
    manifest_paths = verify_files(root, manifest["artifacts"], "claim")
    verify_claim_text(root, manifest["claims"], manifest_paths)
    required = {f"{PACKAGE}/{path}" for path in (
        "preserved-files.json", "reproduction/reproduction-receipt.json",
        "reproduction/candidate-table.json", "reproduction/identity-and-source-verification.json",
        "reproduction/source-bound-replay.json", "geometry/geometry-analysis.json",
    )}
    require(required <= manifest_paths, "claim manifest omits required evidence")
    package = root / PACKAGE
    preservation = read_json(package / "preserved-files.json")
    require(preservation["schema"] == "confovhh.pilot-preserved-evidence.v1"
            and preservation["originalScientificRecordsModified"] is False,
            "preservation declaration changed")
    preserved_paths = verify_files(package, preservation["files"], "preserved")

    original = package / "original-evaluation"
    execution_path = original / "evaluation-execution-receipt.json"
    require(digest(execution_path) == ORIGINAL_RECEIPT_SHA, "original evaluation receipt changed")
    execution = read_json(execution_path)
    require(execution["status"] == "COMPLETE" and execution["sourceHashesMatchFrozenProtocol"] is True,
            "original evaluation not complete")
    require(execution["evaluationSourceCommit"] == "335617ae2744d8e9061464bafd62e166209d8c46"
            and execution["generationRecoveryCommit"] == "250350ab4b995e075edcb489c4f183e32b35efd6"
            and execution["recoveryExecutionId"] == "confovhh-3p0g-startup-recovery-20260909-03",
            "original execution identity changed")
    require(len(execution["allArtifacts"]) == 51, "original evaluation inventory changed")
    original_paths = verify_files(original, execution["allArtifacts"], "original evaluation")
    require({f"original-evaluation/{path}" for path in original_paths} <= preserved_paths,
            "preservation inventory omits original evaluation files")
    report = read_json(original / "comparison-receipt.json")["report"]
    comparisons = validate_original_report(report)
    crosscheck = read_json(original / "first-candidate-api-cli-crosscheck.json")
    require(crosscheck == {"id": "seed1_model_0", "absoluteDockqDifference": 0.0, "status": "PASS"},
            "first-candidate DockQ crosscheck changed")

    generation_path = package / "generation/generation-receipt.json"
    require(digest(generation_path) == GENERATION_SHA, "original generation receipt changed")
    generation = read_json(generation_path)
    require(generation["status"] == "GENERATION_COMPLETE" and generation["protocolSha256"] == PROTOCOL_SHA,
            "generation/protocol status changed")
    require(generation["nativeCoordinatesProvided"] is False and generation["templatesProvided"] is False,
            "generation inputs differ from frozen design")
    generated = candidate_map(generation["attempts"], "generation")
    generation_files = verify_files(package / "generation", generation["outputFiles"], "generation output")
    require({f"generation/{path}" for path in generation_files} <= preserved_paths,
            "preservation inventory omits original raw outputs")
    source_input = read_json(original / "source-bound-input.json")
    coordinates = candidate_map(source_input["coordinates"], "source-bound coordinates")
    confidence_sources = candidate_map(source_input["scoreSources"], "source-bound confidence")
    for identifier in sorted(IDS):
        row = generated[identifier]
        require(row["status"] == "generated" and row["confidenceStatus"] == "present"
                and row["seedExitCode"] == 0, f"generation incomplete: {identifier}")
        require(identifier == f"seed{row['seed']}_model_{row['modelFileIndex']}",
                f"seed/model identity changed: {identifier}")
        for name, artifact in row["artifacts"].items():
            verify_files(package / "generation", [artifact], f"{identifier} {name}")
            copied = original / "artifacts" / identifier / Path(artifact["path"]).name
            require(digest(copied) == artifact["sha256"], f"evaluation copy differs: {identifier} {name}")
        coordinate, score = coordinates[identifier], confidence_sources[identifier]
        require(coordinate["receptorChain"] == "A" and coordinate["vhhChain"] == "B"
                and coordinate["selectedModelId"] == "1" and coordinate["chainRolesConfirmed"] is True,
                f"source-bound roles changed: {identifier}")
        coordinate_sha = row["artifacts"]["coordinate"]["sha256"]
        require(coordinate["coordinateSha256"] == coordinate_sha
                == comparisons[identifier]["coordinateSha256"] == score["coordinateSha256"],
                f"coordinate binding differs: {identifier}")
        require(score["source"]["sha256"] == row["artifacts"]["confidence"]["sha256"],
                f"confidence binding differs: {identifier}")
        confidence = read_json(regular_file(package / "generation", row["artifacts"]["confidence"]["path"]))
        require(confidence["confidence_score"] == comparisons[identifier]["producerScore"],
                f"confidence value differs: {identifier}")

    reproduction = package / "reproduction"
    receipt = read_json(reproduction / "reproduction-receipt.json")
    for key in ("rankingsExactlyMatch", "fullFreshAuditsExactlyMatch", "independentContactAndClashCountsMatch",
                "independentRankTupleSortingMatches", "allCandidateIdsAndRolesAndHashesVerified",
                "noNewGpuGeneration", "originalResultPreserved"):
        require(receipt[key] is True, f"reproduction verification missing: {key}")
    require(receipt["status"] == "PASS" and receipt["candidateCount"] == 10
            and receipt["sourceFileCount"] == 41 and receipt["scoringChanges"] is False,
            "reproduction identity/status differs")
    require(digest(reproduction / "source-bound-replay.json") == receipt["replaySha256"],
            "reproduction result binding changed")
    require(digest(original / "source-bound-receipt.json") == receipt["originalSourceBoundReceiptSha256"],
            "original rank receipt binding changed")
    identity = read_json(reproduction / "identity-and-source-verification.json")
    require(identity["status"] == "PASS" and identity["protocolSha256"] == PROTOCOL_SHA
            and identity["generationReceiptSha256"] == GENERATION_SHA
            and identity["allOriginalEvaluationArtifactHashesVerified"] is True,
            "reproduction identity verification differs")
    require(len(identity["sourceFiles"]) == 41, "frozen source inventory changed")
    protocol_path = package.parent / "protocol.json"
    require(digest(protocol_path) == PROTOCOL_SHA, "frozen protocol bytes changed")
    protocol_sources = read_json(protocol_path)["method"]["sourceFiles"]
    require({row["path"]: {"bytes": row["bytes"], "sha256": row["sha256"]}
             for row in identity["sourceFiles"]} == protocol_sources,
            "reproduction source inventory differs from frozen protocol")
    verify_files(package / "frozen-source", identity["sourceFiles"], "frozen scientific source")
    replay_script = regular_file(root, "scripts/paper/reproduce-single-case-pilot-ranking.py")
    require(digest(replay_script) == receipt["scriptSha256"], "ranking replay script changed")
    identities = candidate_map(identity["candidates"], "reproduction identities")
    table = candidate_map(read_json(reproduction / "candidate-table.json"), "reproduction table")
    replay = read_json(reproduction / "source-bound-replay.json")["result"]
    previous = read_json(original / "source-bound-receipt.json")["result"]
    require(replay["comparisonFields"] == previous["comparisonFields"], "frozen rankings differ on replay")
    fresh_reports = replay["coordinateExecution"]["reports"]
    original_reports = previous["coordinateExecution"]["reports"]
    require(set(fresh_reports) == set(original_reports) == IDS, "audit report IDs changed")
    for identifier in sorted(IDS):
        fresh = json.loads(fresh_reports[identifier], object_pairs_hook=strict_pairs)
        old = json.loads(original_reports[identifier], object_pairs_hook=strict_pairs)
        # A fresh execution has a new timestamp; every other report field must agree.
        fresh.pop("generatedAt")
        old.pop("generatedAt")
        require(fresh == old, f"fresh audit differs from original: {identifier}")
    for identifier, row in table.items():
        source = comparisons[identifier]
        require(row["confoRank"] == source["methodTier"] + 1
                and row["confidenceRank"] == source["baselineTier"] + 1
                and row["DockQ"] == source["DockQ"] and row["confidence"] == source["producerScore"],
                f"candidate result changed: {identifier}")
        bound = identities[identifier]
        audit = json.loads(fresh_reports[identifier], object_pairs_hook=strict_pairs)["audit"]
        for key in ("evidenceLevel", "halfDeltaSasaInterfaceAreaAngstrom2", "severeClashCount",
                    "maximumOverlapAngstrom", "contactPairCount", "atomContactCount",
                    "receptorInterfaceResidues", "vhhInterfaceResidues"):
            require(row[key] == audit[key], f"table feature differs from audit: {identifier} {key}")
        require(row["evidenceTier"] == {"supported": 2, "mixed": 1}.get(row["evidenceLevel"]),
                f"pilot evidence-level/tier mapping changed: {identifier}")
        for key, artifact in (("coordinateSha256", "coordinate"), ("confidenceSha256", "confidence")):
            require(row[key] == bound[key] == generated[identifier]["artifacts"][artifact]["sha256"],
                    f"reproduction input binding changed: {identifier}")
        require(bound["chainA"] == "receptor" and bound["chainB"] == "VHH"
                and bound["chainAResidues"] == 501 and bound["chainBResidues"] == 126
                and bound["chainASequenceSha256"] == SEQUENCE_SHAS["A"]
                and bound["chainBSequenceSha256"] == SEQUENCE_SHAS["B"]
                and bound["labelAndAuthChainsAgree"] is True and bound["exactFrozenSequences"] is True,
                f"reproduction role/sequence binding changed: {identifier}")
    ordered = sorted(table.values(), key=lambda row: (
        -row["evidenceTier"], -row["halfDeltaSasaInterfaceAreaAngstrom2"]))
    require([row["confoRank"] for row in ordered] == list(range(1, 11)),
            "table does not obey descending frozen evidence-tier/burial ordering")
    history = verify_history(package)
    return {"status": "PASS", "claimArtifactsVerified": len(manifest_paths),
            "preservedFilesVerified": len(preserved_paths), "originalEvaluationArtifactsVerified": 51,
            "generationFilesVerified": len(generation_files), "candidateCount": 10,
            "frozenSourceFilesVerified": 41, "originalNegativeResultPreserved": True,
            "historicalAttemptCounts": history, "independentValidation": False,
            "newGpuGeneration": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        result = verify(args.repo)
    except (EvidenceError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAIL", "error": str(error)}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
