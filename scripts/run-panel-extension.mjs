#!/usr/bin/env node
/**
 * Local-SE(3) panel extension: execute validation/panel-extension-v1/study-spec.json.
 *
 * The shipped ranking policy was measured on five targets and selected on those
 * same five. This runs the pilot's own perturbation generator across all
 * seventeen structures of the public regression panel and scores the shipped
 * policy against the pilot's baselines, so the question "did the ordering
 * transfer, or was it five targets" gets a number.
 *
 * Order of operations is not arbitrary. Nothing is downloaded and no pose is
 * generated until (a) the frozen spec still matches its pre-registered digest
 * and (b) the re-implemented estimator has reproduced the pilot's recorded
 * numbers. A study whose protocol drifted, or whose estimator is not the one the
 * comparison baseline was computed with, produces a number that cannot be read.
 *
 * Generation is label-blind by construction: DockQ is not installed into the
 * generating process, is invoked only after every pose is frozen to disk with
 * its digest recorded, and no eligibility or exclusion decision consults it.
 *
 * Usage:
 *   node scripts/run-panel-extension.mjs [--targets 3P0G,4MQS] [--skip-gate]
 *
 * --skip-gate exists only for iterating on the generator; it refuses to write a
 * results artifact, so it cannot produce a publishable number.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { analyzeInterface, CONFOVHH_VERSION, parsePdb } from "../lib/confovhh.ts";
import {
  calculatePerTarget,
  classifyDockq,
  clusterBootstrap,
  macroFromPerTarget,
} from "./panel-extension/metrics.mjs";
import {
  centroid,
  coordinateRmsd,
  poseToken,
  poseTransform,
  transformPoint,
} from "./panel-extension/geometry.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STUDY = path.join(ROOT, "validation", "panel-extension-v1");
const PANEL_ATTESTATION = path.join(
  ROOT, "validation", "v0.5-public-regression-attestation-v1", "native-interfaces.json",
);
const PYTHON = path.join(ROOT, ".bench-venv", "bin", "python");
const DOCKQ_HELPER = path.join(ROOT, "scripts", "dockq-batch.py");
const WORK = path.join(ROOT, ".panel-extension-work");

const STUDY_ARMS = Object.freeze([
  "pose_ranking_v0_6",
  "confovhh_evidence_v0_4",
  "delta_sasa",
  "contact_count",
  "clash_burden",
  "cdr_contact_share",
  "random_all_tied",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  return value;
}

// ---------------------------------------------------------------------------
// Canonical PDB emission. Geometry lives in panel-extension/geometry.mjs, which
// the equivalence gate replays against all 360 recorded pilot transforms.
// ---------------------------------------------------------------------------

function atomNameField(name) {
  const clean = name.slice(0, 4);
  if (clean.length === 4 || /^\d/.test(clean)) return clean.padEnd(4);
  return ` ${clean}`.padEnd(4);
}

function pdbAtomLine(atom, residue, chainId, serial) {
  assert.ok(serial <= 99_999, "Canonical PDB atom serial exceeded five columns");
  assert.ok(
    residue.number >= -999 && residue.number <= 9_999,
    "Canonical PDB residue number is out of range",
  );
  const coordinate = (value) => {
    assert.ok(
      value > -1_000 && value < 10_000,
      "Canonical PDB coordinate is out of the 8.3 field range",
    );
    return value.toFixed(3).padStart(8);
  };
  const bFactor = Number.isFinite(atom.bFactor) ? atom.bFactor : 0;
  return [
    "ATOM  ", String(serial).padStart(5), " ", atomNameField(atom.name), " ",
    residue.name.slice(0, 3).padStart(3), " ", chainId,
    String(residue.number).padStart(4), (residue.insertionCode || " ").slice(0, 1), "   ",
    coordinate(atom.x), coordinate(atom.y), coordinate(atom.z),
    "  1.00", bFactor.toFixed(2).padStart(6), "          ",
    atom.element.slice(0, 2).padStart(2),
  ].join("");
}

function canonicalPairPdb(structure, receptorChainId, vhhChainId) {
  const specifications = [[receptorChainId, "A"], [vhhChainId, "B"]];
  const lines = ["REMARK 950 CONFOVHH CANONICAL A=RECEPTOR B=VHH"];
  let serial = 1;
  for (const [sourceChainId, outputChainId] of specifications) {
    const chain = structure.chains.find((candidate) => candidate.id === sourceChainId);
    assert.ok(chain, `Missing selected chain ${sourceChainId}`);
    for (const residue of chain.residues) {
      for (const atom of residue.atoms) {
        lines.push(pdbAtomLine(atom, residue, outputChainId, serial));
        serial += 1;
      }
    }
    lines.push(`TER   ${String(serial).padStart(5)}      ${outputChainId}`);
    serial += 1;
  }
  lines.push("END");
  return `${lines.join("\n")}\n`;
}

function chainAlphaCarbons(structure, chainId) {
  const chain = structure.chains.find((candidate) => candidate.id === chainId);
  assert.ok(chain, `Missing chain ${chainId} for C-alpha coordinates`);
  const coordinates = [];
  for (const residue of chain.residues) {
    const atom = residue.atoms.find((candidate) => candidate.name === "CA");
    if (atom) coordinates.push([atom.x, atom.y, atom.z]);
  }
  assert.ok(coordinates.length >= 3, `Chain ${chainId} has too few C-alpha atoms`);
  return coordinates;
}

/** Rewrite one chain's atoms in place on a clone, leaving the other untouched. */
function transformedStructure(structure, chainId, matrix) {
  const transformed = structuredClone(structure);
  const chain = transformed.chains.find((candidate) => candidate.id === chainId);
  assert.ok(chain, `Missing chain ${chainId} while applying a perturbation`);
  for (const residue of chain.residues) {
    for (const atom of residue.atoms) {
      const [x, y, z] = transformPoint(matrix, atom);
      atom.x = finite(x, "transformed x coordinate");
      atom.y = finite(y, "transformed y coordinate");
      atom.z = finite(z, "transformed z coordinate");
    }
  }
  return transformed;
}

function auditSnapshot(audit) {
  return {
    softwareVersion: audit.version,
    confidenceMode: audit.confidenceMode,
    evidenceLevel: audit.evidenceLevel,
    contactPairCount: audit.contactPairCount,
    atomContactCount: audit.atomContactCount,
    receptorInterfaceResidues: audit.receptorInterfaceResidues,
    vhhInterfaceResidues: audit.vhhInterfaceResidues,
    severeClashCount: audit.severeClashCount,
    maximumOverlapAngstrom: audit.maximumOverlapAngstrom,
    polarContactProxyCount: audit.polarContactProxyCount,
    saltBridgeProxyCount: audit.saltBridgeProxyCount,
    possibleInterchainDisulfideCount: audit.possibleInterchainDisulfideCount,
    deltaSasaAngstrom2: audit.deltaSasaAngstrom2,
    halfDeltaSasaInterfaceAreaAngstrom2: audit.halfDeltaSasaInterfaceAreaAngstrom2,
    cdrContactShare: audit.paratopeProxyShare,
    cdr3ContactShare: audit.cdr3ProxyShare,
    imgtNumberingStatus: audit.vhhNumbering.status,
    imgtNumberingEngine: audit.vhhNumbering.engine,
    paeAttached: false,
    plddtInterpreted: false,
  };
}

// ---------------------------------------------------------------------------
// Per-target generation. Runs in a worker so seventeen targets share the cores.
// ---------------------------------------------------------------------------

async function generateTarget(payload) {
  const { benchmarkId, target, sourceText, targetDirectory, generator } = payload;
  await mkdir(targetDirectory, { recursive: true });
  const source = parsePdb(sourceText);
  const receptor = source.chains.find((chain) => chain.id === target.receptorChain);
  const vhh = source.chains.find((chain) => chain.id === target.vhhChain);
  assert.ok(receptor, `${target.targetId}: missing receptor chain ${target.receptorChain}`);
  assert.ok(vhh, `${target.targetId}: missing VHH chain ${target.vhhChain}`);

  const canonicalNativeText = canonicalPairPdb(source, receptor.id, vhh.id);
  const canonicalNative = parsePdb(canonicalNativeText);
  const nativePath = path.join(targetDirectory, "native.pdb");
  await writeFile(nativePath, canonicalNativeText, "utf8");
  const nativeAudit = auditSnapshot(analyzeInterface(canonicalNative, "A", "B", "none"));
  const pivot = centroid(chainAlphaCarbons(canonicalNative, "B"));

  const farMatrix = [[1, 0, 0, 1_000], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const farText = canonicalPairPdb(
    transformedStructure(source, vhh.id, farMatrix), receptor.id, vhh.id,
  );
  const farPath = path.join(targetDirectory, "far-translation.pdb");
  await writeFile(farPath, farText, "utf8");
  const farAudit = auditSnapshot(analyzeInterface(parsePdb(farText), "A", "B", "none"));

  const dockqJobs = [
    { jobId: `${target.targetId}:control:native-self`, targetId: target.targetId, kind: "native-self-control", nativePath, modelPath: nativePath },
    { jobId: `${target.targetId}:control:far-translation`, targetId: target.targetId, kind: "far-translation-control", nativePath, modelPath: farPath },
  ];
  const poses = [];
  const acceptedCoordinates = [];

  for (const angleDegrees of generator.rotationAnglesDegrees) {
    for (const translationMagnitudeAngstrom of generator.translationMagnitudesAngstrom) {
      for (let replicate = 1; replicate <= generator.replicatesPerGridCell; replicate += 1) {
        const poseId = `${target.targetId}-rot${poseToken(angleDegrees)}-trans${poseToken(translationMagnitudeAngstrom)}-rep${replicate}`;
        const transform = poseTransform({
          benchmarkId,
          targetId: target.targetId,
          angleDegrees,
          translationMagnitudeAngstrom,
          replicate,
          pivot,
        });
        const matrix = transform.matrixRowMajor4x4;
        const baseRecord = {
          schemaVersion: "1.0.0",
          benchmarkId,
          dataRole: "development",
          poseId,
          targetId: target.targetId,
          generator: "local-SE3-grid",
          stratum: { angleDegrees, translationMagnitudeAngstrom, replicate },
          deterministicSeedSha256: transform.deterministicSeedSha256,
          transform: {
            pivotAngstrom: pivot,
            rotationAxis: transform.rotationAxis,
            angleDegrees,
            translationDirection: transform.translationDirection,
            translationMagnitudeAngstrom,
            translationVectorAngstrom: transform.translationVectorAngstrom,
            matrixRowMajor4x4: matrix,
            convention: "active x'=R(x-pivot)+pivot+translation",
            coordinateUnits: "angstrom",
          },
          sourceCoordinateSha256: sha256(canonicalNativeText),
          sourceCoordinateBytes: Buffer.byteLength(canonicalNativeText),
          eligibility: "pending",
          deduplication: null,
          errorState: null,
        };
        try {
          const generatedText = canonicalPairPdb(
            transformedStructure(source, vhh.id, matrix), receptor.id, vhh.id,
          );
          // Regenerating from the same matrix must produce the same bytes; a
          // drift here would mean the recorded transform does not describe the
          // recorded coordinates.
          const regeneratedText = canonicalPairPdb(
            transformedStructure(source, vhh.id, matrix), receptor.id, vhh.id,
          );
          assert.equal(
            sha256(regeneratedText), sha256(generatedText),
            `${poseId}: transform reconstruction changed bytes`,
          );
          const generated = parsePdb(generatedText);
          const coordinates = chainAlphaCarbons(generated, "B");
          let nearest = null;
          for (const accepted of acceptedCoordinates) {
            const rmsd = coordinateRmsd(coordinates, accepted.coordinates);
            if (!nearest || rmsd < nearest.rmsd) nearest = { poseId: accepted.poseId, rmsd };
          }
          if (nearest && nearest.rmsd < generator.deduplication.cutoffAngstrom) {
            poses.push({
              ...baseRecord,
              generatedCoordinateSha256: sha256(generatedText),
              generatedCoordinateBytes: Buffer.byteLength(generatedText),
              eligibility: "excluded-duplicate",
              deduplication: {
                cutoffAngstrom: generator.deduplication.cutoffAngstrom,
                duplicateOfPoseId: nearest.poseId,
                vhhCaRmsdAngstrom: nearest.rmsd,
                keeperPolicy: generator.deduplication.keeper,
              },
              exclusionReason: `VHH C-alpha RMSD ${nearest.rmsd.toFixed(6)} A is below ${generator.deduplication.cutoffAngstrom} A`,
            });
            continue;
          }
          const modelPath = path.join(targetDirectory, `${poseId}.pdb`);
          await writeFile(modelPath, generatedText, "utf8");
          const audit = analyzeInterface(generated, "A", "B", "none");
          acceptedCoordinates.push({ poseId, coordinates });
          poses.push({
            ...baseRecord,
            generatedCoordinateSha256: sha256(generatedText),
            generatedCoordinateBytes: Buffer.byteLength(generatedText),
            eligibility: "retained",
            deduplication: {
              cutoffAngstrom: generator.deduplication.cutoffAngstrom,
              nearestPriorPoseId: nearest?.poseId ?? null,
              nearestPriorVhhCaRmsdAngstrom: nearest?.rmsd ?? null,
              keeperPolicy: generator.deduplication.keeper,
            },
            audit: auditSnapshot(audit),
          });
          dockqJobs.push({ jobId: poseId, targetId: target.targetId, kind: "ranking-pose", nativePath, modelPath });
        } catch (error) {
          poses.push({
            ...baseRecord,
            eligibility: "excluded-error",
            exclusionReason: error instanceof Error ? error.message : "Unknown generation error",
            errorState: {
              type: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }
  }

  return {
    targetRecord: {
      schemaVersion: "1.0.0",
      benchmarkId,
      dataRole: "development",
      targetId: target.targetId,
      pdb: target.pdb,
      component: target.component,
      pilotReuse: target.pilotReuse,
      sourceUrl: `https://files.rcsb.org/download/${target.pdb}.pdb`,
      sourceBytes: payload.sourceBytes,
      sourceSha256: payload.sourceSha256,
      selectedModelId: source.selectedModelId,
      availableModelIds: source.availableModelIds,
      originalChainMapping: { receptor: target.receptorChain, vhh: target.vhhChain },
      canonicalDockqChainMapping: { receptor: "A", vhh: "B", explicitMapping: "AB:AB" },
      receptorSequenceSha256: sha256(receptor.sequence),
      vhhSequenceSha256: sha256(vhh.sequence),
      receptorObservedResidues: receptor.residueCount,
      vhhObservedResidues: vhh.residueCount,
      canonicalNativeCoordinateSha256: sha256(canonicalNativeText),
      canonicalNativeCoordinateBytes: Buffer.byteLength(canonicalNativeText),
      nativeAudit,
      controls: {
        nativeSelf: { jobId: `${target.targetId}:control:native-self`, coordinateSha256: sha256(canonicalNativeText) },
        farTranslation: {
          jobId: `${target.targetId}:control:far-translation`,
          transformMatrixRowMajor4x4: farMatrix,
          coordinateSha256: sha256(farText),
          audit: farAudit,
        },
      },
    },
    poses,
    dockqJobs,
  };
}

if (!isMainThread) {
  generateTarget(workerData)
    .then((result) => parentPort.postMessage({ ok: true, result }))
    .catch((error) => parentPort.postMessage({ ok: false, error: error?.stack ?? String(error) }));
}

function runTargetWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: payload });
    worker.once("message", (message) => {
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Target worker stopped with exit code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipGate = args.includes("--skip-gate");
  const targetFilterIndex = args.indexOf("--targets");
  const targetFilter = targetFilterIndex === -1
    ? null
    : new Set(args[targetFilterIndex + 1].split(",").map((value) => value.trim()));

  // 1. The freeze must be intact.
  const checksums = await readFile(path.join(STUDY, "checksums.sha256"), "utf8");
  for (const line of checksums.split("\n").filter((row) => row.trim())) {
    const [digest, name] = line.trim().split(/\s+/u);
    const actual = sha256(await readFile(path.join(STUDY, name)));
    assert.equal(
      actual, digest,
      `${name} no longer matches its pre-registered digest. The protocol drifted ` +
        "between freeze and run; the study cannot proceed.",
    );
  }
  const spec = JSON.parse(await readFile(path.join(STUDY, "study-spec.json"), "utf8"));

  // 2. The estimator must be the pilot's estimator, or the comparison is void.
  if (skipGate) {
    process.stderr.write(
      "WARNING: --skip-gate. No results artifact will be written.\n",
    );
  } else {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "verify-panel-extension-gate.mjs")], {
      cwd: ROOT, stdio: ["ignore", "inherit", "inherit"],
    });
  }

  // 3. Sources, verified against digests frozen before this study existed.
  const attestation = JSON.parse(await readFile(PANEL_ATTESTATION, "utf8"));
  const attested = new Map(attestation.results.map((row) => [row.pdb, row]));
  const targets = spec.targets.filter((target) => !targetFilter || targetFilter.has(target.pdb));
  assert.ok(targets.length, "No targets selected");

  await mkdir(WORK, { recursive: true });
  const sources = new Map();
  for (const target of targets) {
    const expected = attested.get(target.pdb);
    assert.ok(expected, `${target.pdb} is absent from the v0.5 public regression attestation`);
    assert.equal(
      `${target.receptorChain}:${target.vhhChain}`, expected.pair,
      `${target.pdb}: the spec's chain pair disagrees with the attestation`,
    );
    const cachePath = path.join(WORK, `${target.pdb}.pdb`);
    let bytes;
    try {
      bytes = await readFile(cachePath);
    } catch {
      const url = `https://files.rcsb.org/download/${target.pdb}.pdb`;
      const response = await fetch(url);
      assert.ok(response.ok, `${target.pdb}: download failed with HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(cachePath, bytes);
    }
    // Both, not either: a byte count alone is a weak check and a digest alone
    // would not catch a truncation that happened to be re-hashed.
    assert.equal(bytes.byteLength, expected.sourceBytes, `${target.pdb}: byte count differs from the attestation`);
    assert.equal(sha256(bytes), expected.sourceSha256, `${target.pdb}: SHA-256 differs from the attestation`);
    sources.set(target.pdb, bytes.toString("utf8"));
  }
  process.stderr.write(`Verified ${sources.size} source structures against the frozen attestation.\n`);

  // 4. Generation, label-blind.
  const targetRecords = [];
  const allPoses = [];
  const dockqJobs = [];
  const concurrency = Math.max(1, Math.min(4, targets.length));
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const target = queue.shift();
      const result = await runTargetWorker({
        benchmarkId: spec.benchmarkId,
        target,
        sourceText: sources.get(target.pdb),
        sourceBytes: attested.get(target.pdb).sourceBytes,
        sourceSha256: attested.get(target.pdb).sourceSha256,
        targetDirectory: path.join(WORK, target.targetId),
        generator: spec.generator,
      });
      targetRecords.push(result.targetRecord);
      allPoses.push(...result.poses);
      dockqJobs.push(...result.dockqJobs);
      process.stderr.write(
        `generated ${target.targetId}: ${result.poses.filter((pose) => pose.eligibility === "retained").length} retained ` +
        `of ${result.poses.length}\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // 5. Labelling. Only now does DockQ enter the process at all.
  const manifestPath = path.join(WORK, "dockq-jobs.json");
  const dockqOutputPath = path.join(WORK, "dockq-results.jsonl");
  await writeFile(manifestPath, `${JSON.stringify({ jobs: dockqJobs }, null, 2)}\n`, "utf8");
  execFileSync(PYTHON, [DOCKQ_HELPER, manifestPath, dockqOutputPath], {
    cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024,
  });
  const dockqById = new Map();
  for (const line of (await readFile(dockqOutputPath, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    dockqById.set(record.jobId, record);
  }

  // 6. Controls, checked before anything is scored.
  const controlFailures = [];
  for (const record of targetRecords) {
    const self = dockqById.get(record.controls.nativeSelf.jobId);
    if (!self?.ok || Math.abs(self.DockQ - 1) > 1e-6) {
      controlFailures.push(`${record.targetId}: native-self DockQ ${self?.DockQ ?? self?.error}`);
    }
    const far = dockqById.get(record.controls.farTranslation.jobId);
    if (far?.ok && far.DockQ >= 0.01) {
      controlFailures.push(`${record.targetId}: far-translation DockQ ${far.DockQ} is not below 0.01`);
    }
    const farAudit = record.controls.farTranslation.audit;
    if (farAudit.contactPairCount !== 0 || farAudit.deltaSasaAngstrom2 !== 0) {
      controlFailures.push(
        `${record.targetId}: far-translation audit reports ${farAudit.contactPairCount} contacts ` +
        `and ${farAudit.deltaSasaAngstrom2} A^2 delta SASA`,
      );
    }
  }
  assert.equal(controlFailures.length, 0, `Control failures:\n  ${controlFailures.join("\n  ")}`);

  // 7. Scoring.
  const posesByTarget = new Map();
  for (const pose of allPoses) {
    const dockq = dockqById.get(pose.poseId);
    pose.dockq = dockq?.ok ? dockq : null;
    pose.capriClass = pose.dockq ? classifyDockq(pose.dockq.DockQ) : null;
    if (!posesByTarget.has(pose.targetId)) posesByTarget.set(pose.targetId, []);
    posesByTarget.get(pose.targetId).push(pose);
  }

  const cutoff = 0.23;
  const perTarget = calculatePerTarget(posesByTarget, STUDY_ARMS, cutoff);
  const primaryIds = targets.filter((target) => !target.pilotReuse).map((target) => target.targetId);
  const reusedIds = targets.filter((target) => target.pilotReuse).map((target) => target.targetId);

  const clusters = [...new Map(
    targets.map((target) => [target.component, []]),
  )].map(([component]) => ({
    component,
    targetIds: targets.filter((target) => target.component === component).map((target) => target.targetId),
  }));
  const primaryClusters = clusters
    .map((cluster) => ({
      component: cluster.component,
      targetIds: cluster.targetIds.filter((targetId) => primaryIds.includes(targetId)),
    }))
    .filter((cluster) => cluster.targetIds.length);

  const populations = {
    primaryPreviouslyUnused: {
      description: "the structures the DockQ development pilot never used; the study's primary endpoint",
      contaminated: false,
      targetIds: primaryIds,
      macro: macroFromPerTarget(perTarget, STUDY_ARMS, primaryIds),
      bootstrap: primaryIds.length
        ? clusterBootstrap({
          perTarget, arms: STUDY_ARMS, clusters: primaryClusters,
          replicates: spec.bootstrap.replicates, seed: spec.bootstrap.seed,
        })
        : null,
    },
    allSeventeen: {
      description: "every panel structure; CONTAMINATED because the policy was selected on five of them",
      contaminated: true,
      targetIds: targets.map((target) => target.targetId),
      macro: macroFromPerTarget(perTarget, STUDY_ARMS, null),
      bootstrap: clusterBootstrap({
        perTarget, arms: STUDY_ARMS, clusters,
        replicates: spec.bootstrap.replicates, seed: spec.bootstrap.seed,
      }),
    },
    pilotReusedOnly: {
      description: "the five structures the policy was selected on; CONTAMINATED, reported for contrast",
      contaminated: true,
      targetIds: reusedIds,
      macro: reusedIds.length ? macroFromPerTarget(perTarget, STUDY_ARMS, reusedIds) : null,
      bootstrap: null,
    },
  };

  // 8. Which prespecified branch fired. Read off the frozen rules, not chosen.
  const primaryMacro = populations.primaryPreviouslyUnused.macro;
  const shipped = primaryMacro.pose_ranking_v0_6;
  const tied = primaryMacro.random_all_tied;
  const previous = primaryMacro.confovhh_evidence_v0_4;
  const beatsControl = shipped.averagePrecision.value > tied.averagePrecision.value;
  const beatsPrevious = shipped.averagePrecision.value > previous.averagePrecision.value;
  const precisionAt1 = shipped.precisionAt1.value;
  let outcome;
  if (!beatsControl || precisionAt1 < 0.5) outcome = "failsToGeneralize";
  else if (!beatsPrevious || precisionAt1 < 0.8) outcome = "partial";
  else outcome = "generalizes";

  const results = {
    schemaVersion: "1.0.0",
    studyId: "confovhh-local-se3-panel-extension-v1",
    benchmarkId: spec.benchmarkId,
    status: "EXECUTED",
    dataRole: "development",
    runCompletedAt: new Date().toISOString(),
    frozenSpecification: {
      path: "validation/panel-extension-v1/study-spec.json",
      sha256: sha256(await readFile(path.join(STUDY, "study-spec.json"))),
    },
    software: {
      confovhh: CONFOVHH_VERSION,
      node: process.version,
      dockq: dockqById.values().next().value?.dockqVersion ?? null,
    },
    poseAccounting: {
      targets: targetRecords.length,
      generated: allPoses.length,
      retained: allPoses.filter((pose) => pose.eligibility === "retained").length,
      excludedDuplicate: allPoses.filter((pose) => pose.eligibility === "excluded-duplicate").length,
      excludedError: allPoses.filter((pose) => pose.eligibility === "excluded-error").length,
      labelled: allPoses.filter((pose) => pose.dockq).length,
      dockqPositive: allPoses.filter((pose) => pose.dockq && pose.dockq.DockQ >= cutoff).length,
    },
    dockqPositiveCutoff: cutoff,
    arms: STUDY_ARMS,
    perTarget,
    populations,
    prespecifiedOutcome: {
      branch: outcome,
      rule: spec.prespecifiedOutcomes[outcome],
      evaluatedOn: "primaryPreviouslyUnused",
      shippedAveragePrecision: shipped.averagePrecision.value,
      allTiedAveragePrecision: tied.averagePrecision.value,
      previousOrderingAveragePrecision: previous.averagePrecision.value,
      shippedExpectedPrecisionAt1: precisionAt1,
    },
    claimFlags: { ...spec.claimFlags, improvesCandidateRankingOnDevelopmentData: outcome !== "failsToGeneralize" },
    accessBoundary: spec.accessBoundary,
    interpretationBoundary: spec.interpretationBoundary,
  };

  if (skipGate) {
    process.stderr.write("--skip-gate was set; refusing to write a results artifact.\n");
    process.stdout.write(`${JSON.stringify(results.prespecifiedOutcome, null, 2)}\n`);
    return;
  }

  await writeFile(path.join(STUDY, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(STUDY, "poses.jsonl"),
    `${allPoses.map((pose) => JSON.stringify(pose)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    path.join(STUDY, "targets.jsonl"),
    `${targetRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const generated = ["results.json", "poses.jsonl", "targets.jsonl"];
  const rows = [];
  for (const name of generated) {
    rows.push(`${sha256(await readFile(path.join(STUDY, name)))}  ${name}`);
  }
  await writeFile(path.join(STUDY, "results.sha256"), `${rows.join("\n")}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    outcome,
    poseAccounting: results.poseAccounting,
    primary: {
      targets: primaryIds.length,
      shipped: shipped.averagePrecision.value,
      previousOrdering: previous.averagePrecision.value,
      allTiedControl: tied.averagePrecision.value,
      shippedAuroc: shipped.auroc.value,
      shippedPrecisionAt1: precisionAt1,
    },
  }, null, 2)}\n`);
}

if (isMainThread) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
