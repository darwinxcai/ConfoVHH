import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

import {
  analyzeInterface,
  CONFOVHH_VERSION,
  parsePdb,
} from "../lib/confovhh.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACT_DIRECTORY = path.join(ROOT, "validation", "dockq-development-pilot-v1");
const SPEC_PATH = path.join(ARTIFACT_DIRECTORY, "pilot-spec.json");
const SOURCE_MANIFEST_PATH = path.join(ARTIFACT_DIRECTORY, "source-manifest.json");
const PYTHON = path.join(ROOT, ".bench-venv", "bin", "python");
const DOCKQ_CLI = path.join(ROOT, ".bench-venv", "bin", "DockQ");
const DOCKQ_HELPER = path.join(ROOT, "scripts", "dockq-batch.py");
const BOOTSTRAP_REPLICATES = 10_000;
const BOOTSTRAP_SEED = 90_420_260_827;
const SCORE_ARMS = [
  "confovhh_evidence_v0_4",
  "contact_count",
  "delta_sasa",
  "clash_burden",
  "cdr_contact_share",
  "random_all_tied",
];
const METRIC_KEYS = [
  "averagePrecision",
  "averagePrecisionLift",
  "auroc",
  "precisionAt1",
  "precisionAt5",
  "precisionAt10",
  "successAt1",
  "successAt5",
  "successAt10",
  "enrichmentFactor1Percent",
  "enrichmentFactor5Percent",
  "kendallTauB",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  return value;
}

function round(value, digits = 12) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function mean(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function quantile(values, probability) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function unitVector(digest, byteOffset) {
  const components = [0, 4, 8].map((offset) => (
    digest.readUInt32BE(byteOffset + offset) / 0xffff_ffff * 2 - 1
  ));
  const norm = Math.hypot(...components);
  if (norm < 1e-12) return byteOffset === 0 ? [1, 0, 0] : [0, 1, 0];
  return components.map((component) => component / norm);
}

function rodrigues(axis, angleDegrees) {
  const [x, y, z] = axis;
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const complement = 1 - cosine;
  return [
    [cosine + x * x * complement, x * y * complement - z * sine, x * z * complement + y * sine],
    [y * x * complement + z * sine, cosine + y * y * complement, y * z * complement - x * sine],
    [z * x * complement - y * sine, z * y * complement + x * sine, cosine + z * z * complement],
  ];
}

function affineMatrix(rotation, pivot, translation) {
  const rotatedPivot = rotation.map((row) => (
    row[0] * pivot[0] + row[1] * pivot[1] + row[2] * pivot[2]
  ));
  const offset = pivot.map((component, index) => (
    component - rotatedPivot[index] + translation[index]
  ));
  return [
    [rotation[0][0], rotation[0][1], rotation[0][2], offset[0]],
    [rotation[1][0], rotation[1][1], rotation[1][2], offset[1]],
    [rotation[2][0], rotation[2][1], rotation[2][2], offset[2]],
    [0, 0, 0, 1],
  ];
}

function transformPoint(matrix, atom) {
  return [
    matrix[0][0] * atom.x + matrix[0][1] * atom.y + matrix[0][2] * atom.z + matrix[0][3],
    matrix[1][0] * atom.x + matrix[1][1] * atom.y + matrix[1][2] * atom.z + matrix[1][3],
    matrix[2][0] * atom.x + matrix[2][1] * atom.y + matrix[2][2] * atom.z + matrix[2][3],
  ];
}

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

function atomNameField(name) {
  const clean = name.slice(0, 4);
  if (clean.length === 4 || /^\d/.test(clean)) return clean.padEnd(4);
  return ` ${clean}`.padEnd(4);
}

function pdbAtomLine(atom, residue, chainId, serial) {
  assert.ok(serial <= 99_999, "Canonical PDB atom serial exceeded five columns");
  assert.ok(residue.number >= -999 && residue.number <= 9_999, "Canonical PDB residue number is out of range");
  const coordinate = (value) => {
    assert.ok(value > -1_000 && value < 10_000, "Canonical PDB coordinate is out of the 8.3 field range");
    return value.toFixed(3).padStart(8);
  };
  const bFactor = Number.isFinite(atom.bFactor) ? atom.bFactor : 0;
  return [
    "ATOM  ",
    String(serial).padStart(5),
    " ",
    atomNameField(atom.name),
    " ",
    residue.name.slice(0, 3).padStart(3),
    " ",
    chainId,
    String(residue.number).padStart(4),
    (residue.insertionCode || " ").slice(0, 1),
    "   ",
    coordinate(atom.x),
    coordinate(atom.y),
    coordinate(atom.z),
    "  1.00",
    bFactor.toFixed(2).padStart(6),
    "          ",
    atom.element.slice(0, 2).padStart(2),
  ].join("");
}

function canonicalPairPdb(structure, receptorChainId, vhhChainId) {
  const specifications = [
    [receptorChainId, "A"],
    [vhhChainId, "B"],
  ];
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

function centroid(points) {
  const result = [0, 0, 0];
  for (const point of points) {
    for (let index = 0; index < 3; index += 1) result[index] += point[index];
  }
  return result.map((value) => value / points.length);
}

function coordinateRmsd(left, right) {
  assert.equal(left.length, right.length, "C-alpha arrays differ in length");
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const dx = left[index][0] - right[index][0];
    const dy = left[index][1] - right[index][1];
    const dz = left[index][2] - right[index][2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / left.length);
}

function poseToken(value) {
  return Math.round(Number(value) * 10).toString().padStart(4, "0");
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

function compareAuditReproduction(sourceAudit, canonicalAudit) {
  const exactFields = [
    "softwareVersion",
    "confidenceMode",
    "evidenceLevel",
    "contactPairCount",
    "atomContactCount",
    "receptorInterfaceResidues",
    "vhhInterfaceResidues",
    "severeClashCount",
    "polarContactProxyCount",
    "saltBridgeProxyCount",
    "possibleInterchainDisulfideCount",
    "cdrContactShare",
    "cdr3ContactShare",
    "imgtNumberingStatus",
    "imgtNumberingEngine",
    "paeAttached",
    "plddtInterpreted",
  ];
  const exactMatches = Object.fromEntries(exactFields.map((field) => [
    field,
    Object.is(sourceAudit[field], canonicalAudit[field]),
  ]));
  const numericToleranceChecks = {
    maximumOverlapAngstrom: {
      absoluteDifference: Math.abs(sourceAudit.maximumOverlapAngstrom - canonicalAudit.maximumOverlapAngstrom),
      tolerance: 0.002,
    },
    deltaSasaAngstrom2: {
      absoluteDifference: Math.abs(sourceAudit.deltaSasaAngstrom2 - canonicalAudit.deltaSasaAngstrom2),
      tolerance: 0.5,
    },
    halfDeltaSasaInterfaceAreaAngstrom2: {
      absoluteDifference: Math.abs(
        sourceAudit.halfDeltaSasaInterfaceAreaAngstrom2 -
        canonicalAudit.halfDeltaSasaInterfaceAreaAngstrom2,
      ),
      tolerance: 0.25,
    },
  };
  const passed = (
    Object.values(exactMatches).every(Boolean) &&
    Object.values(numericToleranceChecks).every((check) => check.absoluteDifference <= check.tolerance)
  );
  return {
    policy: "Exact discrete audit fields; maximum overlap within 0.002 A; delta SASA within 0.5 A^2; half-delta-SASA area within 0.25 A^2 after canonical PDB rounding.",
    sourceAuditSha256: sha256(JSON.stringify(sourceAudit)),
    canonicalAuditSha256: sha256(JSON.stringify(canonicalAudit)),
    exactMatches,
    numericToleranceChecks,
    passed,
  };
}

async function generateTarget(workerPayload) {
  const {
    benchmarkId,
    target,
    sourceBytes,
    sourceSha256,
    sourceText,
    targetDirectory,
    retrievedAt,
  } = workerPayload;
  await mkdir(targetDirectory, { recursive: true });
  const source = parsePdb(sourceText);
  const receptor = source.chains.find((chain) => chain.id === target.receptorChain);
  const vhh = source.chains.find((chain) => chain.id === target.vhhChain);
  assert.ok(receptor, `${target.targetId}: missing receptor chain`);
  assert.ok(vhh, `${target.targetId}: missing VHH chain`);

  const sourceAudit = auditSnapshot(analyzeInterface(source, receptor.id, vhh.id, "none"));
  const canonicalNativeText = canonicalPairPdb(source, receptor.id, vhh.id);
  const canonicalNative = parsePdb(canonicalNativeText);
  const nativePath = path.join(targetDirectory, "native.pdb");
  await writeFile(nativePath, canonicalNativeText, "utf8");
  const nativeAudit = analyzeInterface(canonicalNative, "A", "B", "none");
  const nativeAuditSnapshot = auditSnapshot(nativeAudit);
  const auditReproduction = compareAuditReproduction(sourceAudit, nativeAuditSnapshot);
  const nativeCa = chainAlphaCarbons(canonicalNative, "B");
  const pivot = centroid(nativeCa);

  const farMatrix = [
    [1, 0, 0, 1_000],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const farSource = transformedStructure(source, vhh.id, farMatrix);
  const farText = canonicalPairPdb(farSource, receptor.id, vhh.id);
  const farPath = path.join(targetDirectory, "far-translation.pdb");
  await writeFile(farPath, farText, "utf8");
  const farAudit = analyzeInterface(parsePdb(farText), "A", "B", "none");

  const dockqJobs = [
    {
      jobId: `${target.targetId}:control:native-self`,
      targetId: target.targetId,
      kind: "native-self-control",
      nativePath,
      modelPath: nativePath,
    },
    {
      jobId: `${target.targetId}:control:far-translation`,
      targetId: target.targetId,
      kind: "far-translation-control",
      nativePath,
      modelPath: farPath,
    },
  ];
  const poses = [];
  const acceptedCoordinates = [];
  const rotations = [2, 5, 10, 20, 40, 80];
  const translations = [0.5, 1, 2, 4, 8, 16];

  for (const angleDegrees of rotations) {
    for (const translationMagnitudeAngstrom of translations) {
      for (let replicate = 1; replicate <= 2; replicate += 1) {
        const poseId = `${target.targetId}-rot${poseToken(angleDegrees)}-trans${poseToken(translationMagnitudeAngstrom)}-rep${replicate}`;
        const seedMaterial = [
          benchmarkId,
          target.targetId,
          angleDegrees,
          translationMagnitudeAngstrom,
          replicate,
        ].join("|");
        const digest = createHash("sha256").update(seedMaterial).digest();
        const rotationAxis = unitVector(digest, 0);
        const translationDirection = unitVector(digest, 12);
        const translationVector = translationDirection.map((value) => (
          value * translationMagnitudeAngstrom
        ));
        const rotation = rodrigues(rotationAxis, angleDegrees);
        const matrix = affineMatrix(rotation, pivot, translationVector);
        const baseRecord = {
          schemaVersion: "1.0.0",
          benchmarkId,
          dataRole: "development",
          poseId,
          targetId: target.targetId,
          generator: "local-SE3-grid",
          stratum: { angleDegrees, translationMagnitudeAngstrom, replicate },
          deterministicSeedSha256: digest.toString("hex"),
          transform: {
            pivotAngstrom: pivot,
            rotationAxis,
            angleDegrees,
            translationDirection,
            translationMagnitudeAngstrom,
            translationVectorAngstrom: translationVector,
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
          const transformed = transformedStructure(source, vhh.id, matrix);
          const generatedText = canonicalPairPdb(transformed, receptor.id, vhh.id);
          const regeneratedText = canonicalPairPdb(
            transformedStructure(source, vhh.id, matrix),
            receptor.id,
            vhh.id,
          );
          assert.equal(sha256(regeneratedText), sha256(generatedText), `${poseId}: transform reconstruction changed bytes`);
          const generated = parsePdb(generatedText);
          const coordinates = chainAlphaCarbons(generated, "B");
          let nearest = null;
          for (const accepted of acceptedCoordinates) {
            const rmsd = coordinateRmsd(coordinates, accepted.coordinates);
            if (!nearest || rmsd < nearest.rmsd) nearest = { poseId: accepted.poseId, rmsd };
          }
          if (nearest && nearest.rmsd < 0.5) {
            poses.push({
              ...baseRecord,
              generatedCoordinateSha256: sha256(generatedText),
              generatedCoordinateBytes: Buffer.byteLength(generatedText),
              eligibility: "excluded-duplicate",
              deduplication: {
                cutoffAngstrom: 0.5,
                duplicateOfPoseId: nearest.poseId,
                vhhCaRmsdAngstrom: nearest.rmsd,
                keeperPolicy: "lexicographically first pose ID",
              },
              exclusionReason: `VHH C-alpha RMSD ${nearest.rmsd.toFixed(6)} A is below 0.5 A`,
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
              cutoffAngstrom: 0.5,
              nearestPriorPoseId: nearest?.poseId ?? null,
              nearestPriorVhhCaRmsdAngstrom: nearest?.rmsd ?? null,
              keeperPolicy: "lexicographically first pose ID",
            },
            audit: auditSnapshot(audit),
            _modelPath: modelPath,
            _nativePath: nativePath,
          });
          dockqJobs.push({
            jobId: poseId,
            targetId: target.targetId,
            kind: "ranking-pose",
            nativePath,
            modelPath,
          });
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
      sourceUrl: `https://files.rcsb.org/download/${target.pdb}.pdb`,
      retrievedAt,
      sourceBytes,
      sourceSha256,
      coordinateFormat: "pdb",
      coordinateScope: "as-supplied",
      selectedModelId: source.selectedModelId,
      availableModelIds: source.availableModelIds,
      originalChainMapping: {
        receptor: target.receptorChain,
        vhh: target.vhhChain,
      },
      canonicalDockqChainMapping: {
        receptor: "A",
        vhh: "B",
        explicitMapping: "AB:AB",
      },
      receptorFamilyCluster: target.receptorFamilyCluster,
      developmentReuse: target.developmentReuse,
      receptorSequenceSha256: sha256(receptor.sequence),
      vhhSequenceSha256: sha256(vhh.sequence),
      receptorObservedResidues: receptor.residueCount,
      vhhObservedResidues: vhh.residueCount,
      canonicalNativeCoordinateSha256: sha256(canonicalNativeText),
      canonicalNativeCoordinateBytes: Buffer.byteLength(canonicalNativeText),
      nativeAudit: nativeAuditSnapshot,
      controls: {
        nativeSelf: {
          jobId: `${target.targetId}:control:native-self`,
          coordinateSha256: sha256(canonicalNativeText),
          auditReproduction,
        },
        farTranslation: {
          jobId: `${target.targetId}:control:far-translation`,
          transformMatrixRowMajor4x4: farMatrix,
          coordinateSha256: sha256(farText),
          audit: auditSnapshot(farAudit),
        },
      },
    },
    poses,
    dockqJobs,
  };
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

function classifyDockq(value) {
  if (value >= 0.8) return "high";
  if (value >= 0.49) return "medium";
  if (value >= 0.23) return "acceptable";
  return "incorrect";
}

function scoreForArm(pose, arm) {
  if (arm === "confovhh_evidence_v0_4") {
    return pose.audit.evidenceLevel === "supported"
      ? 2
      : pose.audit.evidenceLevel === "mixed" ? 1 : 0;
  }
  if (arm === "contact_count") return pose.audit.contactPairCount;
  if (arm === "delta_sasa") return pose.audit.deltaSasaAngstrom2;
  if (arm === "clash_burden") return -pose.audit.severeClashCount;
  if (arm === "cdr_contact_share") {
    if (pose.audit.imgtNumberingStatus !== "numbered") return -1;
    return pose.audit.cdrContactShare ?? 0;
  }
  if (arm === "random_all_tied") return 0;
  throw new Error(`Unknown score arm ${arm}`);
}

function groupedRows(rows) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  const groups = [];
  for (const row of ordered) {
    const last = groups.at(-1);
    if (last && Object.is(last.score, row.score)) last.rows.push(row);
    else groups.push({ score: row.score, rows: [row] });
  }
  return groups;
}

function groupedAveragePrecision(rows) {
  const positives = rows.reduce((sum, row) => sum + row.label, 0);
  if (!positives || positives === rows.length) return null;
  let cumulativePositive = 0;
  let cumulativeTotal = 0;
  let result = 0;
  for (const group of groupedRows(rows)) {
    const groupPositive = group.rows.reduce((sum, row) => sum + row.label, 0);
    cumulativePositive += groupPositive;
    cumulativeTotal += group.rows.length;
    result += groupPositive / positives * cumulativePositive / cumulativeTotal;
  }
  return result;
}

function tiedAuRoc(rows) {
  const positive = rows.filter((row) => row.label === 1);
  const negative = rows.filter((row) => row.label === 0);
  if (!positive.length || !negative.length) return null;
  let credit = 0;
  for (const left of positive) {
    for (const right of negative) {
      if (left.score > right.score) credit += 1;
      else if (left.score === right.score) credit += 0.5;
    }
  }
  return credit / (positive.length * negative.length);
}

function combinationRatioWithoutPositive(total, negative, draws) {
  if (draws <= 0) return 1;
  if (draws > negative) return 0;
  let result = 1;
  for (let index = 0; index < draws; index += 1) {
    result *= (negative - index) / (total - index);
  }
  return result;
}

function tiedTopK(rows, requestedK) {
  const k = Math.min(requestedK, rows.length);
  if (!k) return { precision: null, success: null };
  let positions = 0;
  let positivesBeforeBoundary = 0;
  for (const group of groupedRows(rows)) {
    if (positions + group.rows.length <= k) {
      positivesBeforeBoundary += group.rows.reduce((sum, row) => sum + row.label, 0);
      positions += group.rows.length;
      if (positions === k) break;
      continue;
    }
    const remaining = k - positions;
    const groupPositive = group.rows.reduce((sum, row) => sum + row.label, 0);
    const expectedPositive = positivesBeforeBoundary + remaining * groupPositive / group.rows.length;
    const success = positivesBeforeBoundary > 0
      ? 1
      : 1 - combinationRatioWithoutPositive(
        group.rows.length,
        group.rows.length - groupPositive,
        remaining,
      );
    return { precision: expectedPositive / k, success };
  }
  return {
    precision: positivesBeforeBoundary / k,
    success: positivesBeforeBoundary > 0 ? 1 : 0,
  };
}

function kendallTauB(rows) {
  if (rows.length < 2) return null;
  let concordant = 0;
  let discordant = 0;
  let scoreOnlyTies = 0;
  let dockqOnlyTies = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const scoreDifference = Math.sign(rows[left].score - rows[right].score);
      const dockqDifference = Math.sign(rows[left].dockq - rows[right].dockq);
      if (scoreDifference === 0 && dockqDifference === 0) continue;
      if (scoreDifference === 0) scoreOnlyTies += 1;
      else if (dockqDifference === 0) dockqOnlyTies += 1;
      else if (scoreDifference === dockqDifference) concordant += 1;
      else discordant += 1;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + scoreOnlyTies) *
    (concordant + discordant + dockqOnlyTies),
  );
  return denominator ? (concordant - discordant) / denominator : null;
}

function targetMetrics(poses, arm, cutoff, excludeBoundary = false) {
  const candidates = poses.filter((pose) => {
    if (pose.eligibility !== "retained" || !pose.dockq) return false;
    if (excludeBoundary && pose.dockq.DockQ >= 0.21 && pose.dockq.DockQ <= 0.25) return false;
    return true;
  });
  if (
    arm === "cdr_contact_share" &&
    candidates.every((pose) => pose.audit.imgtNumberingStatus !== "numbered")
  ) return null;
  const scored = candidates
    .map((pose) => ({
      poseId: pose.poseId,
      score: scoreForArm(pose, arm),
      dockq: pose.dockq.DockQ,
      label: pose.dockq.DockQ >= cutoff ? 1 : 0,
    }))
    .filter((row) => Number.isFinite(row.score));
  if (!scored.length) return null;
  const positives = scored.reduce((sum, row) => sum + row.label, 0);
  const prevalence = positives / scored.length;
  const averagePrecision = groupedAveragePrecision(scored);
  const top1 = tiedTopK(scored, 1);
  const top5 = tiedTopK(scored, 5);
  const top10 = tiedTopK(scored, 10);
  const top1Percent = tiedTopK(scored, Math.max(1, Math.ceil(scored.length * 0.01)));
  const top5Percent = tiedTopK(scored, Math.max(1, Math.ceil(scored.length * 0.05)));
  return {
    poseCount: scored.length,
    positiveCount: positives,
    prevalence,
    averagePrecision,
    averagePrecisionLift: averagePrecision == null || prevalence === 0
      ? null
      : averagePrecision / prevalence,
    auroc: tiedAuRoc(scored),
    precisionAt1: top1.precision,
    precisionAt5: top5.precision,
    precisionAt10: top10.precision,
    successAt1: top1.success,
    successAt5: top5.success,
    successAt10: top10.success,
    enrichmentFactor1Percent: prevalence > 0 && prevalence < 1
      ? top1Percent.precision / prevalence
      : null,
    enrichmentFactor5Percent: prevalence > 0 && prevalence < 1
      ? top5Percent.precision / prevalence
      : null,
    kendallTauB: kendallTauB(scored),
  };
}

function calculatePerTarget(posesByTarget, cutoff, excludeBoundary = false) {
  const result = {};
  for (const arm of SCORE_ARMS) {
    result[arm] = {};
    for (const [targetId, poses] of posesByTarget) {
      result[arm][targetId] = targetMetrics(poses, arm, cutoff, excludeBoundary);
    }
  }
  return result;
}

function macroFromPerTarget(perTarget) {
  const result = {};
  for (const arm of SCORE_ARMS) {
    result[arm] = {};
    for (const metric of METRIC_KEYS) {
      const values = Object.values(perTarget[arm])
        .map((target) => target?.[metric])
        .filter(Number.isFinite);
      result[arm][metric] = {
        value: round(mean(values)),
        eligibleTargets: values.length,
      };
    }
    const poseCounts = Object.values(perTarget[arm]).map((target) => target?.poseCount).filter(Number.isFinite);
    result[arm].coverage = {
      eligibleTargets: poseCounts.length,
      minimumPosesPerEligibleTarget: poseCounts.length ? Math.min(...poseCounts) : null,
      maximumPosesPerEligibleTarget: poseCounts.length ? Math.max(...poseCounts) : null,
    };
  }
  return result;
}

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function bootstrap(perTarget, targetIds) {
  const random = xorshift32(BOOTSTRAP_SEED % 0x1_0000_0000);
  const distributions = Object.fromEntries(SCORE_ARMS.map((arm) => [
    arm,
    Object.fromEntries(METRIC_KEYS.map((metric) => [metric, []])),
  ]));
  const pairedApDifferences = Object.fromEntries(SCORE_ARMS
    .filter((arm) => arm !== "random_all_tied")
    .map((arm) => [arm, []]));

  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const sampled = Array.from({ length: targetIds.length }, () => (
      targetIds[Math.floor(random() * targetIds.length)]
    ));
    const replicateAp = {};
    for (const arm of SCORE_ARMS) {
      for (const metric of METRIC_KEYS) {
        const values = sampled
          .map((targetId) => perTarget[arm][targetId]?.[metric])
          .filter(Number.isFinite);
        if (values.length) distributions[arm][metric].push(mean(values));
      }
      const apValues = sampled
        .map((targetId) => perTarget[arm][targetId]?.averagePrecision)
        .filter(Number.isFinite);
      replicateAp[arm] = apValues.length ? mean(apValues) : null;
    }
    for (const arm of Object.keys(pairedApDifferences)) {
      if (Number.isFinite(replicateAp[arm]) && Number.isFinite(replicateAp.random_all_tied)) {
        pairedApDifferences[arm].push(replicateAp[arm] - replicateAp.random_all_tied);
      }
    }
  }

  const intervals = {};
  for (const arm of SCORE_ARMS) {
    intervals[arm] = {};
    for (const metric of METRIC_KEYS) {
      const values = distributions[arm][metric];
      intervals[arm][metric] = {
        lower: round(quantile(values, 0.025)),
        upper: round(quantile(values, 0.975)),
        finiteReplicates: values.length,
      };
    }
  }
  const differences = {};
  for (const [arm, values] of Object.entries(pairedApDifferences)) {
    differences[arm] = {
      pointReference: "paired macro average-precision difference versus all-tied baseline",
      lower: round(quantile(values, 0.025)),
      upper: round(quantile(values, 0.975)),
      finiteReplicates: values.length,
    };
  }
  return { intervals, pairedAveragePrecisionDifferenceVsAllTied: differences };
}

function supportedOddsByTarget(posesByTarget, cutoff) {
  const records = {};
  for (const [targetId, poses] of posesByTarget) {
    const table = { supportedPositive: 0, supportedNegative: 0, otherPositive: 0, otherNegative: 0 };
    for (const pose of poses) {
      if (pose.eligibility !== "retained" || !pose.dockq) continue;
      const supported = pose.audit.evidenceLevel === "supported";
      const positive = pose.dockq.DockQ >= cutoff;
      if (supported && positive) table.supportedPositive += 1;
      else if (supported) table.supportedNegative += 1;
      else if (positive) table.otherPositive += 1;
      else table.otherNegative += 1;
    }
    const supportedTotal = table.supportedPositive + table.supportedNegative;
    const otherTotal = table.otherPositive + table.otherNegative;
    if (!supportedTotal || !otherTotal) {
      records[targetId] = { ...table, eligible: false, logOddsRatio: null, corrected: false };
      continue;
    }
    const cells = [table.supportedPositive, table.supportedNegative, table.otherPositive, table.otherNegative];
    const corrected = cells.some((value) => value === 0);
    const [a, b, c, d] = corrected ? cells.map((value) => value + 0.5) : cells;
    records[targetId] = {
      ...table,
      eligible: true,
      corrected,
      logOddsRatio: Math.log(a * d / (b * c)),
    };
  }
  const logs = Object.values(records).map((record) => record.logOddsRatio).filter(Number.isFinite);
  return {
    perTarget: records,
    macroOddsRatio: logs.length ? round(Math.exp(mean(logs))) : null,
    eligibleTargets: logs.length,
    correction: "0.5 Haldane-Anscombe correction applied only to eligible tables containing a zero cell",
  };
}

function evidenceBandRates(posesByTarget, cutoff) {
  const bands = ["supported", "mixed", "limited", "not-assessable"];
  const result = {};
  for (const band of bands) {
    const targetRates = [];
    let total = 0;
    let positive = 0;
    for (const poses of posesByTarget.values()) {
      const selected = poses.filter((pose) => (
        pose.eligibility === "retained" && pose.dockq && pose.audit.evidenceLevel === band
      ));
      if (!selected.length) continue;
      const targetPositive = selected.filter((pose) => pose.dockq.DockQ >= cutoff).length;
      targetRates.push(targetPositive / selected.length);
      total += selected.length;
      positive += targetPositive;
    }
    result[band] = {
      targetMacroPositiveRate: round(mean(targetRates)),
      eligibleTargets: targetRates.length,
      pooledPositiveRate: total ? round(positive / total) : null,
      pooledPoseCount: total,
    };
  }
  return result;
}

function attachBootstrap(macro, bootstrapResult) {
  for (const arm of SCORE_ARMS) {
    for (const metric of METRIC_KEYS) {
      macro[arm][metric].bootstrapDispersion95 = bootstrapResult.intervals[arm][metric];
    }
  }
}

async function cliCrossCheck(job, temporaryDirectory) {
  const outputPath = path.join(temporaryDirectory, `${job.jobId.replaceAll(":", "_")}-cli.json`);
  execFileSync(DOCKQ_CLI, [
    job.modelPath,
    job.nativePath,
    "--mapping",
    "AB:AB",
    "--json",
    outputPath,
    "--short",
  ], { stdio: "ignore", timeout: 120_000 });
  const payload = JSON.parse(await readFile(outputPath, "utf8"));
  return payload.best_result.AB.DockQ;
}

function markdownSummary(summary) {
  const primary = summary.primaryAnalysis.macro;
  const rows = SCORE_ARMS.map((arm) => {
    const metrics = primary[arm];
    return `| ${arm} | ${metrics.averagePrecision.value ?? "NA"} | ${metrics.averagePrecisionLift.value ?? "NA"} | ${metrics.auroc.value ?? "NA"} | ${metrics.successAt10.value ?? "NA"} | ${metrics.kendallTauB.value ?? "NA"} |`;
  }).join("\n");
  const capri = summary.poseAccounting.capriClasses;
  return `# ConfoVHH local-SE(3) DockQ development pilot\n\n` +
    `Status: executed as a **development-only plumbing and association study** on previously used public complexes. It is not the formal hard-decoy protocol or an independent holdout.\n\n` +
    `DockQ measures similarity to each source complex, not binding, affinity, specificity, function, or physiological validity. All near-native and preliminary-release flags remain false.\n\n` +
    `## Dataset\n\n` +
    `- Targets: ${summary.poseAccounting.targets}\n` +
    `- Grid poses generated: ${summary.poseAccounting.generatedBeforeDeduplication}\n` +
    `- Poses retained after label-blind 0.5 Å VHH C-alpha deduplication: ${summary.poseAccounting.retained}\n` +
    `- CAPRI-style classes among retained poses: ${capri.high} high, ${capri.medium} medium, ${capri.acceptable} acceptable, ${capri.incorrect} incorrect\n` +
    `- Native-self controls: ${summary.controls.nativeSelfPassed}/${summary.poseAccounting.targets} passed\n` +
    `- +1000 Å controls: ${summary.controls.farTranslationPassed}/${summary.poseAccounting.targets} passed\n` +
    `- Independent DockQ CLI cross-checks: ${summary.controls.cliCrossChecksPassed}/${summary.controls.cliCrossChecksRun} passed\n\n` +
    `## Tie-aware target-macro results at DockQ >= 0.23\n\n` +
    `| Prespecified arm | AP | AP lift | AUROC | Expected success@10 | Kendall tau-b |\n` +
    `|---|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `Intervals in the machine-readable summary are paired 10,000-replicate development-target bootstrap dispersion intervals. They are not evidence of external generalization or statistical significance.\n\n` +
    `CDR-arm clarification: numbered poses with zero contacts receive a bottom score of 0 rather than being dropped. This missing-value policy was clarified after the initial plumbing run, without fitting a threshold or weight to DockQ; the evidence-band and delta-SASA arms are unaffected.\n\n` +
    `## Interpretation boundary\n\n` +
    `This native-derived perturbation grid can reveal descriptive association inside a narrow local rigid-body distribution. It does not test blind docking, wrong-patch decoys, flexible conformational change, non-binders, unseen receptor families, unseen VHH lineages, or experimental binding. The separate prospectively specified hard-decoy protocol remains unexecuted.\n`;
}

async function implementationDigest() {
  const files = [
    "lib/confovhh.ts",
    "lib/mmcif.ts",
    "lib/vhh-numbering.ts",
    "package.json",
    "package-lock.json",
    "scripts/run-dockq-development-pilot.mjs",
    "scripts/dockq-batch.py",
    "validation/dockq-development-pilot-v1/pilot-spec.json",
    "validation/dockq-development-pilot-v1/source-manifest.json",
  ];
  const digest = createHash("sha256");
  const fileDigests = {};
  for (const relative of files) {
    const bytes = await readFile(path.join(ROOT, relative));
    const fileDigest = sha256(bytes);
    fileDigests[relative] = fileDigest;
    digest.update(relative);
    digest.update("\0");
    digest.update(bytes);
    digest.update("\0");
  }
  return { combinedSha256: digest.digest("hex"), files: fileDigests };
}

function installedDockqDistributionDigest() {
  const program = [
    "import hashlib, json",
    "from importlib.metadata import distribution",
    "dist = distribution('DockQ')",
    "records = []",
    "for relative in sorted(dist.files or [], key=lambda value: str(value)):",
    "    path = dist.locate_file(relative)",
    "    if not path.is_file() or path.suffix in {'.pyc', '.pyo'}: continue",
    "    data = path.read_bytes()",
    "    records.append({'path': str(relative), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})",
    "combined = hashlib.sha256()",
    "for record in records:",
    "    combined.update(record['path'].encode()); combined.update(b'\\0')",
    "    combined.update(record['sha256'].encode()); combined.update(b'\\0')",
    "print(json.dumps({'name': dist.metadata['Name'], 'version': dist.version, 'fileCount': len(records), 'combinedSha256': combined.hexdigest(), 'files': records}))",
  ].join("\n");
  const result = JSON.parse(execFileSync(PYTHON, ["-c", program], { encoding: "utf8" }));
  assert.equal(result.name.toLowerCase(), "dockq");
  assert.equal(result.version, "2.1.3");
  assert.ok(result.fileCount > 0);
  assert.match(result.combinedSha256, /^[a-f0-9]{64}$/);
  return result;
}

function pythonEnvironmentLock() {
  const packages = execFileSync(PYTHON, ["-m", "pip", "freeze", "--all"], {
    encoding: "utf8",
  }).trim().split("\n").map((line) => line.trim()).filter(Boolean).sort();
  assert.ok(packages.some((entry) => entry.toLowerCase() === "dockq==2.1.3"));
  const canonical = `${packages.join("\n")}\n`;
  return {
    command: "python -m pip freeze --all",
    packageCount: packages.length,
    packages,
    sha256: sha256(canonical),
  };
}

async function main() {
  const specBytes = await readFile(SPEC_PATH);
  const spec = JSON.parse(specBytes.toString("utf8"));
  const sourceManifestBytes = await readFile(SOURCE_MANIFEST_PATH);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  assert.equal(spec.statusAtFreeze, "prospectively-specified-before-dockq-labeling");
  assert.equal(spec.releaseFlags.formalHoldoutEvaluated, false);
  assert.equal(spec.releaseFlags.hardDecoyProtocolCompleted, false);
  assert.equal(spec.bootstrap.replicates, BOOTSTRAP_REPLICATES);
  assert.equal(spec.bootstrap.seed, BOOTSTRAP_SEED);
  assert.equal(CONFOVHH_VERSION, "0.4.0");
  assert.equal(sourceManifest.schemaVersion, "1.0.0");
  assert.deepEqual(
    sourceManifest.targets.map((target) => target.targetId).sort(),
    spec.targets.map((target) => target.targetId).sort(),
  );
  await readFile(PYTHON);
  await readFile(DOCKQ_CLI);

  const runStartedAt = new Date().toISOString();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "confovhh-dockq-pilot-"));
  try {
    const downloads = await Promise.all(spec.targets.map(async (target) => {
      const url = `https://files.rcsb.org/download/${target.pdb}.pdb`;
      const expectedSource = sourceManifest.targets.find((entry) => entry.targetId === target.targetId);
      assert.ok(expectedSource, `${target.targetId}: missing frozen source-integrity entry`);
      assert.equal(expectedSource.pdb, target.pdb);
      assert.equal(expectedSource.sourceUrl, url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${target.pdb}: RCSB returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.byteLength, expectedSource.sourceBytes, `${target.pdb}: public source byte count drifted`);
      assert.equal(sha256(bytes), expectedSource.sourceSha256, `${target.pdb}: public source SHA-256 drifted`);
      return {
        target,
        sourceText: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        sourceBytes: bytes.byteLength,
        sourceSha256: sha256(bytes),
        retrievedAt: new Date().toISOString(),
      };
    }));

    const generated = await Promise.all(downloads.map((download) => runTargetWorker({
      benchmarkId: spec.benchmarkId,
      ...download,
      targetDirectory: path.join(temporaryDirectory, download.target.targetId),
    })));
    const targetRecords = generated.map((result) => result.targetRecord);
    const poses = generated.flatMap((result) => result.poses);
    const dockqJobs = generated.flatMap((result) => result.dockqJobs);
    assert.equal(poses.length, spec.generator.totalPosesBeforeDeduplication);
    assert.equal(new Set(poses.map((pose) => pose.poseId)).size, poses.length);
    const retained = poses.filter((pose) => pose.eligibility === "retained");
    assert.ok(retained.length >= 250, "Unexpectedly few unique local-SE(3) poses survived label-blind deduplication");

    const batchManifestPath = path.join(temporaryDirectory, "dockq-jobs.json");
    const batchOutputPath = path.join(temporaryDirectory, "dockq-results.jsonl");
    await writeFile(batchManifestPath, `${JSON.stringify({ jobs: dockqJobs }, null, 2)}\n`, "utf8");
    execFileSync(PYTHON, [DOCKQ_HELPER, batchManifestPath, batchOutputPath], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 20 * 60_000,
    });
    const dockqResults = (await readFile(batchOutputPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(dockqResults.length, dockqJobs.length);
    const failures = dockqResults.filter((result) => !result.ok);
    assert.deepEqual(failures, [], `DockQ failures: ${JSON.stringify(failures)}`);
    assert.ok(dockqResults.every((result) => result.dockqVersion === "2.1.3"));
    const dockqByJob = new Map(dockqResults.map((result) => [result.jobId, result]));

    for (const pose of retained) {
      const result = dockqByJob.get(pose.poseId);
      assert.ok(result, `${pose.poseId}: missing DockQ result`);
      pose.dockq = {
        version: result.dockqVersion,
        mapping: result.mapping,
        interface: result.interface,
        DockQ: result.DockQ,
        F1: result.F1,
        fnat: result.fnat,
        fnonnat: result.fnonnat,
        iRMSD: result.iRMSD,
        LRMSD: result.LRMSD,
        clashes: result.clashes,
        nativeContacts: result.nativeContacts,
        nativeContactsRecovered: result.nativeContactsRecovered,
        modelContacts: result.modelContacts,
        nonNativeContacts: result.nonNativeContacts,
      };
      pose.capriClass = classifyDockq(result.DockQ);
      pose.softwareVersion = CONFOVHH_VERSION;
      pose.dockqVersion = "2.1.3";
    }

    let nativeSelfPassed = 0;
    let farTranslationPassed = 0;
    for (const target of targetRecords) {
      const nativeResult = dockqByJob.get(target.controls.nativeSelf.jobId);
      const farResult = dockqByJob.get(target.controls.farTranslation.jobId);
      assert.ok(nativeResult && farResult);
      target.controls.nativeSelf.dockq = nativeResult.DockQ;
      target.controls.farTranslation.dockq = farResult.DockQ;
      const nativePassed = (
        Math.abs(nativeResult.DockQ - 1) <= 1e-6 &&
        target.controls.nativeSelf.auditReproduction.passed
      );
      const farPassed = (
        farResult.DockQ < 0.01 &&
        target.controls.farTranslation.audit.contactPairCount === 0 &&
        target.controls.farTranslation.audit.deltaSasaAngstrom2 === 0
      );
      target.controls.nativeSelf.passed = nativePassed;
      target.controls.farTranslation.passed = farPassed;
      if (nativePassed) nativeSelfPassed += 1;
      if (farPassed) farTranslationPassed += 1;
      assert.ok(nativePassed, `${target.targetId}: native-self DockQ control failed`);
      assert.ok(farPassed, `${target.targetId}: far-translation control failed`);
    }

    const crossCheckJobs = [];
    for (const target of spec.targets) {
      const targetJobs = dockqJobs.filter((job) => (
        job.targetId === target.targetId && job.kind === "ranking-pose"
      ));
      crossCheckJobs.push(targetJobs[0], targetJobs.at(-1));
    }
    const crossChecks = [];
    for (const job of crossCheckJobs) {
      const cliDockq = await cliCrossCheck(job, temporaryDirectory);
      const batchDockq = dockqByJob.get(job.jobId).DockQ;
      const absoluteDifference = Math.abs(cliDockq - batchDockq);
      crossChecks.push({
        poseId: job.jobId,
        batchDockq,
        cliDockq,
        absoluteDifference,
        passed: absoluteDifference <= 1e-6,
      });
      assert.ok(absoluteDifference <= 1e-6, `${job.jobId}: DockQ API/CLI cross-check failed`);
    }

    const implementation = await implementationDigest();
    for (const pose of poses) {
      pose.implementationSha256 = implementation.combinedSha256;
      pose.nodeVersion = process.versions.node;
      if (pose.eligibility !== "retained") {
        pose.softwareVersion = CONFOVHH_VERSION;
        pose.dockqVersion = null;
      }
      delete pose._modelPath;
      delete pose._nativePath;
    }

    const posesByTarget = new Map(spec.targets.map((target) => [
      target.targetId,
      poses.filter((pose) => pose.targetId === target.targetId),
    ]));
    const primaryPerTarget = calculatePerTarget(posesByTarget, 0.23, false);
    const primaryMacro = macroFromPerTarget(primaryPerTarget);
    const bootstrapResult = bootstrap(primaryPerTarget, spec.targets.map((target) => target.targetId));
    attachBootstrap(primaryMacro, bootstrapResult);

    const sensitivity = {};
    for (const cutoff of [0.21, 0.23, 0.25]) {
      const perTarget = calculatePerTarget(posesByTarget, cutoff, false);
      sensitivity[String(cutoff)] = macroFromPerTarget(perTarget);
    }
    const boundaryExcludedPerTarget = calculatePerTarget(posesByTarget, 0.23, true);
    const capriClasses = { high: 0, medium: 0, acceptable: 0, incorrect: 0 };
    for (const pose of retained) capriClasses[pose.capriClass] += 1;

    await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
    const targetOutput = targetRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
    const poseOutput = poses.map((record) => JSON.stringify(record)).join("\n") + "\n";
    const targetsPath = path.join(ARTIFACT_DIRECTORY, "targets.jsonl");
    const posesPath = path.join(ARTIFACT_DIRECTORY, "poses.jsonl");
    await writeFile(targetsPath, targetOutput, "utf8");
    await writeFile(posesPath, poseOutput, "utf8");

    const summary = {
      schemaVersion: "1.0.0",
      benchmarkId: spec.benchmarkId,
      title: spec.title,
      status: "executed-development-only",
      dataRole: "development",
      protocolRelationship: spec.protocolRelationship,
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      frozenSpecification: {
        frozenAt: spec.frozenAt,
        sha256: sha256(specBytes),
      },
      software: {
        confovhhVersion: CONFOVHH_VERSION,
        dockqVersion: "2.1.3",
        nodeVersion: process.versions.node,
        pythonVersion: execFileSync(PYTHON, ["--version"], { encoding: "utf8" }).trim(),
        pythonEnvironment: pythonEnvironmentLock(),
        installedDockqDistribution: installedDockqDistributionDigest(),
        implementation,
        gitBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
        workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0,
      },
      poseAccounting: {
        targets: spec.targets.length,
        generatedBeforeDeduplication: poses.length,
        retained: retained.length,
        excludedDuplicate: poses.filter((pose) => pose.eligibility === "excluded-duplicate").length,
        excludedError: poses.filter((pose) => pose.eligibility === "excluded-error").length,
        capriClasses,
        primaryPositiveCount: retained.filter((pose) => pose.dockq.DockQ >= 0.23).length,
        primaryPositiveRate: round(retained.filter((pose) => pose.dockq.DockQ >= 0.23).length / retained.length),
      },
      controls: {
        nativeSelfPassed,
        farTranslationPassed,
        cliCrossChecksRun: crossChecks.length,
        cliCrossChecksPassed: crossChecks.filter((record) => record.passed).length,
        maximumCliAbsoluteDifference: Math.max(...crossChecks.map((record) => record.absoluteDifference)),
        crossChecks,
      },
      primaryAnalysis: {
        label: "DockQ >= 0.23",
        tiePolicy: spec.tiePolicy,
        perTarget: primaryPerTarget,
        macro: primaryMacro,
        pairedAveragePrecisionDifferenceVsAllTied: bootstrapResult.pairedAveragePrecisionDifferenceVsAllTied,
        evidenceBandPositiveRates: evidenceBandRates(posesByTarget, 0.23),
        supportedVersusOtherOddsRatio: supportedOddsByTarget(posesByTarget, 0.23),
      },
      methodClarifications: {
        cdrZeroContactPolicy: {
          status: "clarified-after-initial-development-run-before-final-attested-rerun",
          policy: "A numbered pose with zero contacts receives CDR-contact-share score 0; a target is unavailable only when every retained pose is unnumbered.",
          rationale: "Prevents label-dependent row deletion and preserves the target-level denominator.",
          dockqFittingPerformed: false,
          unaffectedPrimaryArms: ["confovhh_evidence_v0_4", "delta_sasa"],
        },
      },
      sensitivityAnalysis: {
        dockqCutoffs: sensitivity,
        excludeDockqBetween0_21And0_25: {
          perTarget: boundaryExcludedPerTarget,
          macro: macroFromPerTarget(boundaryExcludedPerTarget),
        },
      },
      bootstrap: {
        replicates: BOOTSTRAP_REPLICATES,
        seed: BOOTSTRAP_SEED,
        scheme: spec.bootstrap.scheme,
        interval: spec.bootstrap.interval,
        interpretation: spec.bootstrap.interpretation,
      },
      artifactIntegrity: {
        sourceManifestSha256: sha256(sourceManifestBytes),
        sourceManifestBytes: sourceManifestBytes.byteLength,
        targetsJsonlSha256: sha256(targetOutput),
        targetsJsonlBytes: Buffer.byteLength(targetOutput),
        posesJsonlSha256: sha256(poseOutput),
        posesJsonlBytes: Buffer.byteLength(poseOutput),
      },
      formalHoldoutEvaluated: false,
      hardDecoyProtocolCompleted: false,
      nearNativeRankingValidated: false,
      preliminaryNearNativeClaimAllowed: false,
      limitations: [
        "All five complexes were already used for development and public regression; this is not an independent holdout.",
        "The native-derived local rigid-body grid omits wrong-patch docking, tangential slides, external-generator decoys, conformational flexibility, and non-binders.",
        "DockQ measures similarity to a deposited source complex and does not establish binding, affinity, specificity, signaling, stability, or physiological validity.",
        "Bootstrap intervals describe dispersion across five development targets and do not establish external generalization or statistical significance.",
        "No thresholds or composite weights were fitted to DockQ labels, and the formal hard-decoy release gate remains unevaluated."
      ],
    };
    const summaryOutput = `${JSON.stringify(summary, null, 2)}\n`;
    const summaryPath = path.join(ARTIFACT_DIRECTORY, "summary.json");
    const markdownOutput = markdownSummary(summary);
    const markdownPath = path.join(ARTIFACT_DIRECTORY, "summary.md");
    await writeFile(summaryPath, summaryOutput, "utf8");
    await writeFile(markdownPath, markdownOutput, "utf8");

    const checksumLines = [
      [sha256(specBytes), "pilot-spec.json"],
      [sha256(sourceManifestBytes), "source-manifest.json"],
      [sha256(targetOutput), "targets.jsonl"],
      [sha256(poseOutput), "poses.jsonl"],
      [sha256(summaryOutput), "summary.json"],
      [sha256(markdownOutput), "summary.md"],
    ].map(([digest, filename]) => `${digest}  ${filename}`).join("\n") + "\n";
    await writeFile(path.join(ARTIFACT_DIRECTORY, "checksums.sha256"), checksumLines, "utf8");

    assert.equal(sha256(await readFile(targetsPath)), summary.artifactIntegrity.targetsJsonlSha256);
    assert.equal(sha256(await readFile(posesPath)), summary.artifactIntegrity.posesJsonlSha256);
    console.log(JSON.stringify({
      benchmarkId: summary.benchmarkId,
      status: summary.status,
      targets: summary.poseAccounting.targets,
      generated: summary.poseAccounting.generatedBeforeDeduplication,
      retained: summary.poseAccounting.retained,
      capriClasses: summary.poseAccounting.capriClasses,
      controls: summary.controls,
      primaryMacro: Object.fromEntries(SCORE_ARMS.map((arm) => [arm, {
        averagePrecision: primaryMacro[arm].averagePrecision.value,
        averagePrecisionLift: primaryMacro[arm].averagePrecisionLift.value,
        auroc: primaryMacro[arm].auroc.value,
        successAt10: primaryMacro[arm].successAt10.value,
        kendallTauB: primaryMacro[arm].kendallTauB.value,
      }])),
      releaseFlags: {
        formalHoldoutEvaluated: false,
        hardDecoyProtocolCompleted: false,
        nearNativeRankingValidated: false,
        preliminaryNearNativeClaimAllowed: false,
      },
    }, null, 2));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (isMainThread) {
  await main();
} else {
  try {
    const result = await generateTarget(workerData);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? `${error.stack ?? error.message}` : String(error),
    });
  }
}
