#!/usr/bin/env python3
"""One-time public provenance cleanup for the reviewed maintenance branch."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def replace_exact(pathname: str, old: str, new: str, expected: int = 1) -> None:
    path = Path(pathname)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(
            f"{pathname}: expected {expected} occurrence(s), found {count}: {old[:160]!r}"
        )
    path.write_text(text.replace(old, new), encoding="utf-8")


def patch_repository_files() -> None:
    replace_exact(
        "README.md",
        "- Assigns sequence-aligned IMGT framework/CDR regions with pinned `immunum 1.2.0`.",
        "- Assigns sequence-aligned IMGT framework/CDR regions under the validated v0.6 numbering policy using pinned `immunum 1.3.0`, with exact coordinate-sequence map-back and independent number/segment agreement.",
    )
    replace_exact(
        "README.md",
        "The repository's `package.json` version remains `0.5.0` because it identifies the scientific-core lineage.",
        "The repository's `package.json` and canonical audit version remain `0.5.0` for compatibility with the attested geometry-core lineage.",
    )
    replace_exact(
        "README.md",
        "Researcher-facing capabilities and pre-label protocol artifacts advance independently as product release `0.9.1`; changes outside the scientific calculations do not relabel the frozen v0.5 validation artifacts.",
        "Researcher-facing capabilities advance independently as product release `0.9.1`, while promoted components carry their own versioned records: production VHH numbering and pose ranking are v0.6 policies.",
    )
    replace_exact(
        "README.md",
        "The current product preserves the attested v0.5 scientific-core source and executed `immunum 1.2.0` bytes, but it uses a separately patched dependency/build environment and does **not** claim byte-identical equivalence to the historical v0.5 lockfile.",
        "Historical v0.5 scientific-core objects and the executed `immunum 1.2.0` distribution remain preserved byte-for-byte, while current production VHH numbering uses pinned `immunum 1.3.0` under the validated v0.6 policy. The current dependency/build environment is separately patched and is not represented as the historical v0.5 lockfile.",
    )
    replace_exact(
        "README.md",
        "A checksummed [supplemental implementation snapshot](./validation/v0.5-engine-implementation-snapshot-v1/) preserves the exact historical objects named by both unchanged v0.5 attestations.",
        "The checksummed [v0.5 implementation snapshot](./validation/v0.5-engine-implementation-snapshot-v1/) preserves the historical objects, and the [v0.6 implementation snapshot](./validation/v0.6-engine-implementation-snapshot-v1/) binds the scientific-core bytes the current product executes after the numbering promotion.",
    )
    replace_exact(
        "README.md",
        "ConfoVHH was created by [Darwin Cai](https://github.com/darwinxcai).",
        "ConfoVHH is designed, scientifically directed, and maintained by [Darwin Cai](https://github.com/darwinxcai). AI-assisted coding tools have supported implementation, debugging, testing, and documentation under his review; scientific claims and release decisions remain the maintainer's responsibility.",
    )

    replace_exact(
        "PROVENANCE.md",
        "ConfoVHH uses two version namespaces:\n\n- the researcher-facing product release, currently 0.9.1;\n- the v0.5.0 scientific-core lineage, whose historical execution environments remain digest-attested.\n\nProduct changes do not relabel the scientific engine or frozen validation evidence.\n\nThe current product retains byte-identical attested v0.5 scientific-core source and executed `immunum 1.2.0` bytes, but its root dependency/build environment is security-patched. It therefore does not claim that the current lockfile is the historical attested lockfile. The supplemental `validation/v0.5-engine-implementation-snapshot-v1/` package preserves every implementation object named by both unchanged v0.5 summaries and reconstructs their original combined digests.",
        "ConfoVHH uses separately versioned layers:\n\n- the researcher-facing product release, currently 0.9.1;\n- the canonical audit and geometry lineage, which remains version 0.5.0 for compatibility with the frozen v0.5 studies;\n- promoted VHH-numbering and pose-ranking policies, both versioned 0.6.0 with additive promotion and validation records.\n\nA component promotion does not rewrite or relabel frozen historical evidence. The `validation/v0.5-engine-implementation-snapshot-v1/` package preserves the scientific-core objects and executed `immunum 1.2.0` bytes used by the v0.5 studies. Current production VHH numbering uses pinned `immunum 1.3.0`; `validation/v0.6-engine-implementation-snapshot-v1/` binds the exact current scientific-core bytes and records that `lib/vhh-numbering.ts` is the sole promoted file in the pinned scientific-core set. The root dependency/build environment is separately security-patched and is not represented as the historical attested lockfile.",
    )

    replace_exact(
        "DEPENDENCY_POLICY.md",
        "The live root manifests now describe the security-patched product environment. The package version remains `0.5.0` as the scientific-core lineage identifier, but the current lockfile is explicitly **not** represented as the historical attested environment. Tests require the scientific-core source and executed `immunum 1.2.0` bytes to remain identical while recording `dependencyEnvironmentMatchesAttestedV05: false`.",
        "The live root manifests describe the security-patched product environment. The package and canonical audit version remain `0.5.0` for compatibility with the attested geometry-core lineage, but the current lockfile is explicitly **not** represented as the historical attested environment. Tests preserve the historical v0.5 source and executed `immunum 1.2.0` bytes in the v0.5 snapshot while separately binding the current production scientific-core bytes and executed `immunum 1.3.0` engine in the v0.6 snapshot; `dependencyEnvironmentMatchesAttestedV05` remains false.",
    )

    replace_exact(
        "VALIDATION.md",
        "# ConfoVHH v0.5 scientific-engine validation record",
        "# ConfoVHH validation record",
    )
    replace_exact(
        "VALIDATION.md",
        "The current researcher-facing product is release 0.9.1. Its fixed contact, clash, SASA, PAE-summary, IMGT, ensemble, and paired-comparison source remains byte-identical to the attested v0.5.0 scientific core, and the executed `immunum 1.2.0` bytes still match.",
        "The current researcher-facing product is release 0.9.1. Its contact, clash, SASA, PAE-summary, ensemble, and paired-comparison source remains byte-identical to the attested v0.5.0 geometry core. Production VHH numbering is the sole promoted file in the pinned scientific-core set: it now uses the validated v0.6 policy and pinned `immunum 1.3.0`, while the historical v0.5 objects and executed `immunum 1.2.0` bytes remain preserved byte-for-byte.",
    )
    replace_exact(
        "VALIDATION.md",
        "The product now uses a separately patched dependency/build environment, so byte-identical equivalence to the historical v0.5 lockfile is not claimed.",
        "Pose ranking is separately versioned as a v0.6 product policy that orders poses by the existing evidence tier and then half-ΔSASA burial; its reported performance remains development evidence on native-derived perturbation decoys, not validation on prediction-pipeline output. The product uses a separately patched dependency/build environment, so byte-identical equivalence to the historical v0.5 lockfile is not claimed.",
    )
    replace_exact(
        "VALIDATION.md",
        "The exact historical implementation objects are preserved in `validation/v0.5-engine-implementation-snapshot-v1/` without changing either frozen v0.5 evidence package.",
        "The exact historical implementation objects are preserved in `validation/v0.5-engine-implementation-snapshot-v1/` without changing either frozen v0.5 evidence package; `validation/v0.6-engine-implementation-snapshot-v1/` binds the current production scientific-core bytes after the numbering promotion.",
    )
    replace_exact(
        "VALIDATION.md",
        "- formal IMGT positions, FR/CDR boundaries, terminal tags, and long-CDR3 insertion labels with exactly pinned `immunum 1.2.0`;",
        "- formal IMGT positions, FR/CDR boundaries, terminal tags, and long-CDR3 insertion labels under the validated v0.6 policy with pinned `immunum 1.3.0`, exact coordinate-sequence map-back, complete seven-region coverage, and independent number/segment agreement;",
    )
    replace_exact(
        "VALIDATION.md",
        "The complete product, scientific-engine, release-integrity, provenance, and protocol repository result is **454/454 ordinary tests passed**.",
        "The current complete product, scientific-engine, release-integrity, provenance, and protocol repository result is **526/526 ordinary tests passed** as of 2026-09-03.",
    )

    replace_exact(
        "lib/release-validation.ts",
        "  schemaVersion: \"1.5.0\",\n  softwareVersion: \"0.5.0\",\n  engineLineage: {\n    scientificCoreSourceMatchesAttestedV05: true,\n    executedImmunumMatchesAttestedV05: true,\n    dependencyEnvironmentMatchesAttestedV05: false,\n    implementationSnapshot: \"validation/v0.5-engine-implementation-snapshot-v1\",\n    statement: \"The current product preserves the v0.5 scientific-core source and executed immunum 1.2.0 bytes, but uses a separately patched dependency/build environment. Byte-identical equivalence to the historical v0.5 lockfile is not claimed.\",\n  },",
        "  schemaVersion: \"1.6.0\",\n  softwareVersion: \"0.5.0\",\n  engineLineage: {\n    canonicalAuditVersion: \"0.5.0\",\n    currentScientificLineage: \"0.6.0\",\n    scientificCoreSourceMatchesAttestedV05: false,\n    executedImmunumMatchesAttestedV05: false,\n    v05HistoricalArtifactsPreservedByteForByte: true,\n    dependencyEnvironmentMatchesAttestedV05: false,\n    implementationSnapshot: \"validation/v0.6-engine-implementation-snapshot-v1\",\n    historicalImplementationSnapshot: \"validation/v0.5-engine-implementation-snapshot-v1\",\n    currentVhhNumberingPolicy: \"0.6.0\",\n    currentExecutedImmunum: \"1.3.0\",\n    statement: \"The canonical audit and geometry version remains 0.5.0, but production VHH numbering is the validated v0.6 policy and executes immunum 1.3.0. Historical v0.5 scientific-core objects and executed immunum 1.2.0 bytes remain preserved byte-for-byte; the current dependency/build environment is separately patched and is not the historical v0.5 lockfile.\",\n  },",
    )

    replace_exact(
        "tests/benchmark-artifacts.test.mjs",
        "  assert.equal(RELEASE_VALIDATION.schemaVersion, \"1.5.0\");\n  assert.equal(RELEASE_VALIDATION.engineLineage.scientificCoreSourceMatchesAttestedV05, true);\n  assert.equal(RELEASE_VALIDATION.engineLineage.executedImmunumMatchesAttestedV05, true);\n  assert.equal(RELEASE_VALIDATION.engineLineage.dependencyEnvironmentMatchesAttestedV05, false);\n  assert.equal(RELEASE_VALIDATION.softwareVersion, \"0.5.0\");",
        "  assert.equal(RELEASE_VALIDATION.schemaVersion, \"1.6.0\");\n  assert.equal(RELEASE_VALIDATION.engineLineage.canonicalAuditVersion, \"0.5.0\");\n  assert.equal(RELEASE_VALIDATION.engineLineage.currentScientificLineage, \"0.6.0\");\n  assert.equal(RELEASE_VALIDATION.engineLineage.scientificCoreSourceMatchesAttestedV05, false);\n  assert.equal(RELEASE_VALIDATION.engineLineage.executedImmunumMatchesAttestedV05, false);\n  assert.equal(RELEASE_VALIDATION.engineLineage.v05HistoricalArtifactsPreservedByteForByte, true);\n  assert.equal(RELEASE_VALIDATION.engineLineage.dependencyEnvironmentMatchesAttestedV05, false);\n  assert.equal(\n    RELEASE_VALIDATION.engineLineage.implementationSnapshot,\n    \"validation/v0.6-engine-implementation-snapshot-v1\",\n  );\n  assert.equal(\n    RELEASE_VALIDATION.engineLineage.historicalImplementationSnapshot,\n    \"validation/v0.5-engine-implementation-snapshot-v1\",\n  );\n  assert.equal(RELEASE_VALIDATION.engineLineage.currentVhhNumberingPolicy, \"0.6.0\");\n  assert.equal(RELEASE_VALIDATION.engineLineage.currentExecutedImmunum, \"1.3.0\");\n  assert.equal(RELEASE_VALIDATION.softwareVersion, \"0.5.0\");",
    )


def clean_pull_request_bodies() -> None:
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        raise SystemExit("GITHUB_REPOSITORY is required")
    marker = "\n\n🤖 Generated with [Claude Code]"
    disclosure = (
        "\n\n---\nDevelopment note: AI-assisted coding tools supported implementation "
        "and documentation under Darwin Cai's scientific direction and review."
    )

    for pr_number in range(21, 27):
        raw = subprocess.check_output(
            ["gh", "api", f"repos/{repo}/pulls/{pr_number}"],
            text=True,
        )
        payload = json.loads(raw)
        body = payload.get("body") or ""
        if marker not in body:
            raise SystemExit(f"PR #{pr_number}: expected generated footer was not found")
        cleaned = body.split(marker, 1)[0].rstrip() + disclosure
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
            json.dump({"body": cleaned}, handle, ensure_ascii=False)
            request_path = handle.name
        try:
            subprocess.run(
                [
                    "gh",
                    "api",
                    "--method",
                    "PATCH",
                    f"repos/{repo}/pulls/{pr_number}",
                    "--input",
                    request_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        finally:
            os.unlink(request_path)
        print(f"Updated PR #{pr_number}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("patch-files", "clean-prs"))
    args = parser.parse_args()
    if args.mode == "patch-files":
        patch_repository_files()
    else:
        clean_pull_request_bodies()


if __name__ == "__main__":
    main()
