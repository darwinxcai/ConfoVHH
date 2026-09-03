/**
 * Pose geometry for the local-SE(3) panel extension.
 *
 * Transcribed from scripts/run-dockq-development-pilot.mjs, which is hash-pinned
 * by the v0.5 DockQ regression attestation and exports nothing. A transcription
 * is a place for silent error — a transposed matrix index or a byte offset off
 * by four would still produce plausible-looking poses — so it is not trusted.
 *
 * scripts/verify-panel-extension-gate.mjs recomputes the seed digest, rotation
 * axis, translation direction, translation vector and full 4x4 affine matrix for
 * every one of the pilot's 360 recorded poses and requires them to match the
 * frozen ledger exactly. That checks this module against 360 independent cases
 * spanning the whole rotation and translation grid.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export function seedDigest(benchmarkId, targetId, angleDegrees, translationMagnitudeAngstrom, replicate) {
  return createHash("sha256")
    .update([benchmarkId, targetId, angleDegrees, translationMagnitudeAngstrom, replicate].join("|"))
    .digest();
}

/**
 * A deterministic unit vector read out of the seed digest. Three big-endian
 * uint32s are mapped to [-1, 1] and normalised; a degenerate near-zero draw
 * falls back to a fixed axis chosen by the offset so the two vectors a pose
 * needs can never collapse onto each other.
 */
export function unitVector(digest, byteOffset) {
  const components = [0, 4, 8].map((offset) => (
    digest.readUInt32BE(byteOffset + offset) / 0xffff_ffff * 2 - 1
  ));
  const norm = Math.hypot(...components);
  if (norm < 1e-12) return byteOffset === 0 ? [1, 0, 0] : [0, 1, 0];
  return components.map((component) => component / norm);
}

/** Right-handed Rodrigues rotation about a unit axis. */
export function rodrigues(axis, angleDegrees) {
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

/** Active transform x' = R(x - pivot) + pivot + translation, as a row-major 4x4. */
export function affineMatrix(rotation, pivot, translation) {
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

/**
 * Everything a single grid cell determines, derived from the seed alone. The
 * gate replays this against the pilot ledger, so it is the one function whose
 * correctness the whole generated distribution rests on.
 */
export function poseTransform({ benchmarkId, targetId, angleDegrees, translationMagnitudeAngstrom, replicate, pivot }) {
  const digest = seedDigest(benchmarkId, targetId, angleDegrees, translationMagnitudeAngstrom, replicate);
  const rotationAxis = unitVector(digest, 0);
  const translationDirection = unitVector(digest, 12);
  const translationVectorAngstrom = translationDirection.map((value) => value * translationMagnitudeAngstrom);
  const rotation = rodrigues(rotationAxis, angleDegrees);
  return {
    deterministicSeedSha256: digest.toString("hex"),
    rotationAxis,
    translationDirection,
    translationVectorAngstrom,
    matrixRowMajor4x4: affineMatrix(rotation, pivot, translationVectorAngstrom),
  };
}

export function transformPoint(matrix, atom) {
  return [
    matrix[0][0] * atom.x + matrix[0][1] * atom.y + matrix[0][2] * atom.z + matrix[0][3],
    matrix[1][0] * atom.x + matrix[1][1] * atom.y + matrix[1][2] * atom.z + matrix[1][3],
    matrix[2][0] * atom.x + matrix[2][1] * atom.y + matrix[2][2] * atom.z + matrix[2][3],
  ];
}

export function centroid(points) {
  const result = [0, 0, 0];
  for (const point of points) {
    for (let index = 0; index < 3; index += 1) result[index] += point[index];
  }
  return result.map((value) => value / points.length);
}

export function coordinateRmsd(left, right) {
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

export function poseToken(value) {
  return Math.round(Number(value) * 10).toString().padStart(4, "0");
}
