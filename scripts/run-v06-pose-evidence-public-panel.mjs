#!/usr/bin/env node
/**
 * v0.6 pose-evidence candidate — public 17-structure coordinate panel.
 *
 * This is the candidate's third promotion gate: run the public coordinate panel
 * and account for every ranking change against the shipped v0.5 ordinal.
 *
 * The panel is 17 published GPCR–VHH complexes spanning fourteen receptors
 * (ADRB2, CHRM2, US28, AGTR1, OPRK1, SUCNR1, APLNR, ADRA1A, OPRM1, RHO, HCRTR2,
 * SMO, FZD3, ADRB1) plus two inactive-state controls. That is a far broader
 * receptor set than the five-target DockQ development pilot, so it tests whether
 * the candidate's structural behaviour holds outside the pilot — but each
 * structure contributes one native pose, so it measures behaviour, not ranking
 * accuracy. Nothing here is a performance claim.
 *
 * What it actually establishes:
 *
 *   1. Tier carrying. The candidate's primary key is the shipped v0.5 evidence
 *      level, carried through unchanged. This confirms that on all 17 structures,
 *      for real crystal coordinates rather than perturbed ones.
 *   2. Caution calibration. The interpenetration caution reuses the shipped 1.5 Å
 *      overlap boundary. On a native crystal structure it should almost never
 *      fire. If it fires often here, the boundary is mis-set — and that is worth
 *      knowing before the boundary is ever relied on.
 *   3. Fail-closed behaviour on real separations. Each structure also yields six
 *      translated controls with the VHH moved 1000 Å along each axis. These have
 *      no contacts at all, so they must come back not-assessable and must rank
 *      below the native. This is a trivial ordering, recorded as a sanity check
 *      and not as evidence of discrimination.
 *
 * Coordinates are downloaded from RCSB and verified byte-for-byte against the
 * frozen v0.5 public-regression attestation before anything is computed. The
 * recomputed audits are then checked against that attestation's recorded values,
 * so a drifted environment fails loudly rather than producing a quiet new number.
 *
 * Usage:
 *   node scripts/run-v06-pose-evidence-public-panel.mjs [--write]
 *
 * Requires outbound network access to files.rcsb.org.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeInterface, parsePdb } from "../lib/confovhh.ts";
import {
  POSE_EVIDENCE_V06_POLICY,
  POSE_EVIDENCE_V06_TIER_ORDER,
  poseEvidenceInputFromAuditV06,
  rankPosesWithinTargetV06,
  scorePoseEvidenceV06,
} from "../lib/pose-evidence-v06.ts";
import { downloadPublicCoordinate } from "./public-coordinate-download.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = path.join(
  root,
  "validation",
  "v0.5-public-regression-attestation-v1",
  "native-interfaces.json",
);
const OUT_DIR = path.join(root, "validation", "v0.6-pose-evidence-candidate-v2");
const RECORDED_DATE = "2026-09-02";

/** Transcribed from scripts/benchmark-public-pdbs.mjs so the controls match. */
const CONTROL_TRANSLATIONS = [
  [1_000, 0, 0],
  [-1_000, 0, 0],
  [0, 1_000, 0],
  [0, -1_000, 0],
  [0, 0, 1_000],
  [0, 0, -1_000],
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round = (value) => (Number.isFinite(value) ? Number(value.toFixed(12)) : null);

/** Transcribed from scripts/benchmark-public-pdbs.mjs. */
function translatedControl(structure, vhhChainId, [dx, dy, dz]) {
  const moved = structuredClone(structure);
  const chain = moved.chains.find((candidate) => candidate.id === vhhChainId);
  assert.ok(chain, `Missing chain ${vhhChainId} while creating a translated control`);
  for (const residue of chain.residues) {
    for (const atom of residue.atoms) {
      atom.x += dx;
      atom.y += dy;
      atom.z += dz;
    }
  }
  return moved;
}

async function main() {
  const write = process.argv.includes("--write");
  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  assert.equal(baseline.schemaVersion, "1.0.0");
  assert.equal(baseline.softwareVersion, "0.5.0");
  assert.equal(baseline.structures, 17);
  assert.equal(baseline.results.length, 17);

  const records = [];
  let tierChanges = 0;
  let auditDrift = 0;
  let interpenetrationCautions = 0;
  let sparseCautions = 0;
  let numberingCautions = 0;
  let nativeRankedFirst = 0;
  let controlsNotAssessable = 0;
  let controlsTotal = 0;

  for (const entry of baseline.results) {
    const source = await downloadPublicCoordinate(
      `https://files.rcsb.org/download/${entry.pdb}.pdb`,
      entry.pdb,
    );
    // Verify before computing: a drifted source must fail here, not silently
    // produce a new number that looks like a result.
    assert.equal(source.byteLength, entry.sourceBytes, `${entry.pdb}: source-byte drift`);
    assert.equal(sha256(source), entry.sourceSha256, `${entry.pdb}: source-hash drift`);

    const [receptorChain, vhhChain] = entry.pair.split(":");
    const structure = parsePdb(source.toString("utf8"));
    const audit = analyzeInterface(structure, receptorChain, vhhChain, "none");

    // The recomputed audit must reproduce the frozen attestation, or the
    // candidate is being measured in an environment the panel does not describe.
    const drift = [];
    if (audit.contactPairCount !== entry.contactPairs) drift.push("contactPairCount");
    if (audit.severeClashCount !== entry.severeClashPairs) drift.push("severeClashCount");
    if (audit.evidenceLevel !== entry.evidenceBand) drift.push("evidenceLevel");
    if (audit.vhhNumbering.status !== entry.imgtNumbering) drift.push("imgtNumbering");
    if (
      Math.abs(
        Number(audit.halfDeltaSasaInterfaceAreaAngstrom2.toFixed(1)) -
          entry.interfaceAreaAngstrom2,
      ) > 0.05
    ) {
      drift.push("interfaceArea");
    }
    if (drift.length) auditDrift += 1;

    const evidence = scorePoseEvidenceV06(poseEvidenceInputFromAuditV06(audit));

    // The safety property, checked rather than argued: the candidate's primary
    // key must be exactly the tier the shipped policy assigned.
    const expectedTier = POSE_EVIDENCE_V06_TIER_ORDER[entry.evidenceBand] ?? 0;
    if (evidence.evidenceTier !== expectedTier) tierChanges += 1;

    const codes = evidence.cautions.map((caution) => caution.code);
    if (codes.includes("interpenetration-suspected")) interpenetrationCautions += 1;
    if (codes.includes("sparse-interface")) sparseCautions += 1;
    if (codes.includes("numbering-unavailable")) numberingCautions += 1;

    // Native against its six translated controls.
    const controls = CONTROL_TRANSLATIONS.map((translation, index) => {
      const controlAudit = analyzeInterface(
        translatedControl(structure, vhhChain, translation),
        receptorChain,
        vhhChain,
        "none",
      );
      return {
        poseId: `${entry.pdb}-control-${index}`,
        audit: controlAudit,
        evidence: scorePoseEvidenceV06(poseEvidenceInputFromAuditV06(controlAudit)),
      };
    });
    controlsTotal += controls.length;
    controlsNotAssessable += controls.filter(
      (control) => control.evidence.assessability === "not-assessable",
    ).length;

    const ranked = rankPosesWithinTargetV06([
      { poseId: `${entry.pdb}-native`, evidence },
      ...controls.map(({ poseId, evidence: controlEvidence }) => ({
        poseId,
        evidence: controlEvidence,
      })),
    ]);
    if (ranked[0].poseId === `${entry.pdb}-native`) nativeRankedFirst += 1;

    records.push({
      pdb: entry.pdb,
      receptor: entry.receptor,
      pair: entry.pair,
      sourceSha256: entry.sourceSha256,
      shippedEvidenceLevel: entry.evidenceBand,
      candidateTier: evidence.evidenceTier,
      tierCarriedUnchanged: evidence.evidenceTier === expectedTier,
      assessability: evidence.assessability,
      burialAngstrom2: round(evidence.burialScore),
      contactPairCount: audit.contactPairCount,
      severeOverlapCount: audit.severeClashCount,
      maximumOverlapAngstrom: round(audit.maximumOverlapAngstrom),
      imgtNumbering: audit.vhhNumbering.status,
      cautions: codes,
      auditDriftFields: drift,
      controlsNotAssessable: controls.filter(
        (control) => control.evidence.assessability === "not-assessable",
      ).length,
      nativeRankedFirst: ranked[0].poseId === `${entry.pdb}-native`,
    });

    process.stdout.write(
      `${entry.pdb.padEnd(6)} ${entry.receptor.padEnd(16)} ` +
        `tier ${evidence.evidenceTier} (${entry.evidenceBand.padEnd(11)}) ` +
        `burial ${String(round(evidence.burialScore) ?? "n/a").slice(0, 7).padStart(7)} Å²  ` +
        `overlap ${audit.maximumOverlapAngstrom.toFixed(2)} Å  ` +
        `${codes.length ? codes.join(",") : "no cautions"}` +
        `${drift.length ? `  DRIFT: ${drift.join(",")}` : ""}\n`,
    );
  }

  const overlaps = records.map((record) => record.maximumOverlapAngstrom).sort((a, b) => a - b);
  const record = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-v0.6-pose-evidence-public-panel-v1",
    candidateId: "confovhh-v0.6-pose-evidence-candidate-v2",
    recordedDate: RECORDED_DATE,
    status: "EXECUTED_PUBLIC_COORDINATE_PANEL_NOT_PRODUCTION_VALIDATION",
    sourcePanel: {
      path: "validation/v0.5-public-regression-attestation-v1/native-interfaces.json",
      softwareVersion: baseline.softwareVersion,
      structures: baseline.structures,
      allSourceBytesAndSha256Reverified: true,
    },
    candidatePolicy: POSE_EVIDENCE_V06_POLICY,
    accounting: {
      structures: records.length,
      tierChangesAgainstShippedOrdinal: tierChanges,
      structuresWithAuditDrift: auditDrift,
      interpenetrationCautions,
      sparseInterfaceCautions: sparseCautions,
      numberingUnavailableCautions: numberingCautions,
      nativeRankedFirstAgainstTranslatedControls: nativeRankedFirst,
      translatedControls: controlsTotal,
      translatedControlsNotAssessable: controlsNotAssessable,
    },
    nativeOverlapDistributionAngstrom: {
      minimum: overlaps[0] ?? null,
      median: overlaps[Math.floor((overlaps.length - 1) / 2)] ?? null,
      maximum: overlaps.at(-1) ?? null,
      cautionBoundary: 1.5,
      note:
        "Maximum cross-chain van der Waals overlap on published crystal " +
        "coordinates. The interpenetration caution reuses the shipped 1.5 Å " +
        "boundary; how often it fires here is how well that boundary separates " +
        "real packing from real interpenetration.",
    },
    records,
    integrity: {
      historicalArtifactsModified: false,
      candidateV1ArtifactsModified: false,
      productionIntegrated: false,
      usesDockqLabels: false,
      usesNativeHoldoutCoordinates: false,
      usesNativeHoldoutRelativePoses: false,
      usesNativeHoldoutEpitopes: false,
    },
    claimFlags: {
      improvesBindingPrediction: false,
      improvesAffinityPrediction: false,
      improvesPoseCorrectnessPrediction: false,
      validatesCandidateRanking: false,
      establishesGeneralization: false,
      constitutesIndependentHoldoutEvidence: false,
      establishesExperimentalBinding: false,
    },
    interpretationBoundary:
      "One native pose per structure, so this panel measures structural " +
      "behaviour and caution calibration, not ranking accuracy. The translated " +
      "controls are separated by 1000 Å and have no contacts at all; ranking the " +
      "native above them is trivial and is recorded as a fail-closed sanity " +
      "check, not as discrimination. The prospectively specified hard-decoy " +
      "protocol remains unexecuted.",
  };

  console.log();
  console.log(`Structures                              ${records.length}`);
  console.log(`Tier changes against the shipped ordinal ${tierChanges}   (must be 0)`);
  console.log(`Structures with audit drift              ${auditDrift}   (must be 0)`);
  console.log(`Interpenetration cautions on natives     ${interpenetrationCautions}/${records.length}`);
  console.log(`Native ranked first vs translated controls ${nativeRankedFirst}/${records.length}`);
  console.log(
    `Translated controls not-assessable       ${controlsNotAssessable}/${controlsTotal}`,
  );
  console.log(
    `Native max-overlap range                 ${overlaps[0]?.toFixed(2)} – ${overlaps.at(-1)?.toFixed(2)} Å ` +
      `(caution boundary 1.5 Å)`,
  );

  assert.equal(tierChanges, 0, "the candidate must never reorder across shipped tiers");
  assert.equal(auditDrift, 0, "recomputed audits must reproduce the frozen public attestation");
  assert.equal(
    controlsNotAssessable,
    controlsTotal,
    "every 1000 Å translated control must fail closed",
  );

  if (write) {
    await mkdir(OUT_DIR, { recursive: true });
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    const target = path.join(OUT_DIR, "public-panel.json");
    await writeFile(target, serialized);
    const digest = sha256(serialized);
    // Written to its own checksum file so re-running the development replay,
    // which owns checksums.sha256, cannot silently drop this record.
    await writeFile(path.join(OUT_DIR, "public-panel.sha256"), `${digest}  public-panel.json\n`);
    console.log(`\nWrote ${path.relative(root, target)}`);
    console.log(`sha256 ${digest}`);
  }
}

await main();
